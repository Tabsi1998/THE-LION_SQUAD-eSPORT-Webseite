#!/usr/bin/env bash
# Explicit, validated disaster-recovery restore for MongoDB and uploads.
#
# Ablauf (#1008): erst alle Schreiber anhalten (Backend samt Scheduler - alle Container des Dienstes), den Stopp
# prüfen, dann Sicherheitsbackup, Datenbank, Uploads, Prüfung des Ergebnisses - und erst danach wieder freigeben.
# Scheitert etwas nach dem Stopp, bleibt das System gesperrt (Backend aus) und das Skript nennt den Weg zurück.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { printf "\033[1;31m==> %s\033[0m\n" "$*"; exit 1; }
info() { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m==> %s\033[0m\n" "$*"; }
ok() { printf "\033[1;32m==> %s\033[0m\n" "$*"; }

# Dienste, die in die Datenbank oder in den Upload-Ordner schreiben. Der Scheduler läuft im Backend-Prozess
# (DISABLE_SCHEDULER), ein eigener Worker existiert nicht. Weitere Schreiber (etwa ein zweiter Stack auf derselben
# Datenbank) kennt dieses Skript nicht - die hält man vor dem Aufruf selbst an.
WRITER_SERVICES="${RESTORE_WRITER_SERVICES:-backend}"
# So lange warten wir nach der Freigabe, bis das Backend wieder "healthy" meldet.
READY_TIMEOUT_SECONDS="${RESTORE_READY_TIMEOUT_SECONDS:-180}"

[ "$#" -eq 2 ] || fail "Usage: RESTORE_CONFIRM=<db-name> scripts/restore.sh <mongo.archive.gz.enc> <uploads.tar.gz.enc>"
MONGO_ARCHIVE="$(realpath "$1")"
UPLOADS_ARCHIVE="$(realpath "$2")"
source scripts/backup-target.sh
resolve_backup_target || fail "Cannot safely resolve this Compose project's restore targets."
PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-/etc/tls-arena/backup-password}"

[ "${RESTORE_CONFIRM:-}" = "$DB_NAME" ] || fail "Set RESTORE_CONFIRM=${DB_NAME} to acknowledge destructive restore."
[ -f "$MONGO_ARCHIVE" ] && [ -f "$UPLOADS_ARCHIVE" ] || fail "Both backup files must exist."
[ -r "$PASSWORD_FILE" ] || fail "Password file not readable: ${PASSWORD_FILE}"
docker volume inspect "$UPLOADS_VOLUME" >/dev/null || fail "Uploads volume not found: ${UPLOADS_VOLUME}"

BACKUP_ENCRYPTION_PASSWORD_FILE="$PASSWORD_FILE" bash scripts/restore-check.sh "$MONGO_ARCHIVE" "$UPLOADS_ARCHIVE"

# ---------------------------------------------------------------------------------------------------------------
# Schreiber anhalten und den Stopp prüfen - vor der ersten Änderung. Bei unklarem Zustand: Abbruch, nichts verändert.
# ---------------------------------------------------------------------------------------------------------------
writer_containers() {
  # shellcheck disable=SC2086 # die Dienstnamen sind absichtlich eine Liste
  docker compose ps -a -q $WRITER_SERVICES 2>/dev/null || true
}

writers_running() {
  # Gibt die Namen der noch laufenden Schreiber aus (leer = alle stehen). Ein Fehler von docker zählt als "unklar".
  local ids
  ids="$(writer_containers)"
  [ -n "$ids" ] || return 0
  # shellcheck disable=SC2086 # Container-IDs, je eine je Wort
  docker inspect -f '{{.Name}} {{.State.Running}}' $ids | awk '$2 == "true" {print $1}'
}

LOCKED=false
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$LOCKED" = true ]; then
    printf "\033[1;31m==> Restore abgebrochen (Exit %s). Das System bleibt GESPERRT: %s steht.\033[0m\n" "$status" "$WRITER_SERVICES"
    printf "\033[1;33m==> Wiederanlauf: Ursache beheben und das Skript erneut starten (es stoppt und prüft wieder).\033[0m\n"
    printf "\033[1;33m==> Zurück zum Stand vor dem Restore: scripts/restore.sh mit den Dateien des Sicherheitsbackups (siehe oben, tls_*_%s*).\033[0m\n" "$(date +%Y%m%d)"
    printf "\033[1;33m==> Nur wenn Datenbank UND Uploads nachweislich stimmen: docker compose start %s frontend\033[0m\n" "$WRITER_SERVICES"
  fi
}
trap on_exit EXIT

info "Stopping writers before the first change: ${WRITER_SERVICES} (API and scheduler)"
# shellcheck disable=SC2086
docker compose stop --timeout 60 $WRITER_SERVICES || fail "Could not stop ${WRITER_SERVICES}; nothing was changed."
LOCKED=true
STILL_RUNNING="$(writers_running)" || fail "Writer state unclear (docker inspect failed); nothing was changed."
[ -z "$STILL_RUNNING" ] || fail "Writers still running after stop: ${STILL_RUNNING}; nothing was changed."
COUNT="$(writer_containers | wc -l | tr -d ' ')"
ok "Writers stopped and verified (${COUNT} container(s) of ${WRITER_SERVICES})"

if [ "${SKIP_PRE_RESTORE_BACKUP:-false}" != "true" ]; then
  info "Creating mandatory pre-restore safety backup (writers are stopped, so DB and uploads match)"
  BACKUP_ENCRYPTION_PASSWORD_FILE="$PASSWORD_FILE" bash scripts/backup.sh
fi

info "Restoring MongoDB database '${DB_NAME}' with --drop"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass "file:${PASSWORD_FILE}" -in "$MONGO_ARCHIVE" \
  | docker compose exec -T mongodb sh -ec 'mongorestore --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db "$1" --archive --gzip --drop' sh "$DB_NAME"

info "Replacing files in uploads volume '${UPLOADS_VOLUME}'"
docker run --rm -v "${UPLOADS_VOLUME}:/uploads" alpine sh -ec 'find /uploads -mindepth 1 -delete'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass "file:${PASSWORD_FILE}" -in "$UPLOADS_ARCHIVE" \
  | docker run --rm -i -v "${UPLOADS_VOLUME}:/uploads" alpine tar -xzf - -C /uploads

# ---------------------------------------------------------------------------------------------------------------
# Prüfen, bevor irgendjemand wieder schreibt: Sammlungen und Konten da, Uploads nicht leer.
# ---------------------------------------------------------------------------------------------------------------
info "Validating the restored data before releasing writers"
COLLECTIONS="$(docker compose exec -T mongodb sh -ec 'mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin "$1" --eval "print(db.getCollectionNames().length + \" \" + db.users.countDocuments())"' sh "$DB_NAME" | tr -d '\r' | tail -1)"
COLLECTION_COUNT="${COLLECTIONS%% *}"
USER_COUNT="${COLLECTIONS##* }"
[[ "$COLLECTION_COUNT" =~ ^[0-9]+$ ]] && [ "$COLLECTION_COUNT" -gt 0 ] || fail "Restored database has no collections (${COLLECTIONS}); writers stay stopped."
[[ "$USER_COUNT" =~ ^[0-9]+$ ]] && [ "$USER_COUNT" -gt 0 ] || fail "Restored database has no user accounts (${COLLECTIONS}); writers stay stopped."
UPLOAD_FILES="$(docker run --rm -v "${UPLOADS_VOLUME}:/uploads:ro" alpine sh -ec 'find /uploads -type f | wc -l' | tr -d ' \r')"
[[ "$UPLOAD_FILES" =~ ^[0-9]+$ ]] || fail "Could not count restored uploads; writers stay stopped."
if [ "$UPLOAD_FILES" -eq 0 ]; then
  [ "${RESTORE_ALLOW_EMPTY_UPLOADS:-false}" = "true" ] || fail "Restored uploads volume is empty; set RESTORE_ALLOW_EMPTY_UPLOADS=true only if the backup really had no files. Writers stay stopped."
  warn "Uploads volume is empty (allowed by RESTORE_ALLOW_EMPTY_UPLOADS)."
fi
ok "Restored: ${COLLECTION_COUNT} collections, ${USER_COUNT} user accounts, ${UPLOAD_FILES} upload files"

# ---------------------------------------------------------------------------------------------------------------
# Freigabe: Schreiber wieder starten und warten, bis das Backend gesund ist.
# ---------------------------------------------------------------------------------------------------------------
info "Releasing writers: starting ${WRITER_SERVICES} and frontend"
# shellcheck disable=SC2086
docker compose start $WRITER_SERVICES frontend || fail "Could not start the services again; data is restored, start them by hand: docker compose start ${WRITER_SERVICES} frontend"
LOCKED=false
deadline=$(( $(date +%s) + READY_TIMEOUT_SECONDS ))
while :; do
  unhealthy=""
  for id in $(writer_containers); do
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo unknown)"
    case "$state" in healthy|running) ;; *) unhealthy="${unhealthy} ${id:0:12}=${state}" ;; esac
  done
  [ -n "$unhealthy" ] || break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    warn "Backend not healthy after ${READY_TIMEOUT_SECONDS}s:${unhealthy} - check: docker compose logs --tail=100 ${WRITER_SERVICES}"
    break
  fi
  sleep 5
done
ok "Restore completed. Verify /api/health/ready, admin login, uploads, and one historical tournament."
