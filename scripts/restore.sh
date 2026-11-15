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

# Sammlungen im Ziel, die nicht im Backup stehen (#1010): mongorestore --drop lässt sie stehen. Ohne Entscheidung bricht
# der Restore ab und nennt sie. keep: bleiben stehen (mit Hinweis), drop: werden nach dem Restore entfernt (sie sind
# im Sicherheitsbackup). Nie still.
EXTRA_COLLECTIONS_MODE="${RESTORE_EXTRA_COLLECTIONS:-}"

USAGE="Usage: RESTORE_CONFIRM=<db-name> scripts/restore.sh <tls_backup_*.manifest.json> | <mongo.archive.gz.enc> <uploads.tar.gz.enc> [manifest]"
[ "$#" -ge 1 ] && [ "$#" -le 3 ] || fail "$USAGE"
source scripts/backup-target.sh
resolve_backup_target || fail "Cannot safely resolve this Compose project's restore targets."
resolve_backup_project || fail "Cannot resolve this Compose project's name."
resolve_backup_pair "$@" || fail "Backup pair or manifest not found. ${USAGE}"
PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-/etc/tls-arena/backup-password}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ "${RESTORE_CONFIRM:-}" = "$DB_NAME" ] || fail "Set RESTORE_CONFIRM=${DB_NAME} to acknowledge destructive restore."
[ -r "$PASSWORD_FILE" ] || fail "Password file not readable: ${PASSWORD_FILE}"
docker volume inspect "$UPLOADS_VOLUME" >/dev/null || fail "Uploads volume not found: ${UPLOADS_VOLUME}"
case "$EXTRA_COLLECTIONS_MODE" in ""|keep|drop) ;; *) fail "RESTORE_EXTRA_COLLECTIONS must be keep or drop." ;; esac

mongo_eval() {
  # JavaScript über eine Umgebungsvariable - so braucht es kein Quoting im Befehl. Letzte Zeile der Ausgabe.
  docker compose exec -T -e TLS_JS="$1" -e TLS_DROP="${TLS_DROP:-}" mongodb sh -ec 'mongosh --quiet --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin "$1" --eval "$TLS_JS"' sh "$DB_NAME" \
    | tr -d '\r' | tail -1
}

# 1. Dasselbe Manifest wie die Vorprüfung: Prüfsummen, Paar, Projekt, Datenbank, Inhalt der Archive.
BACKUP_ENCRYPTION_PASSWORD_FILE="$PASSWORD_FILE" bash scripts/restore-check.sh "$@" || fail "Backup pair rejected: nothing was changed."
if [ "$MANIFEST_LEGACY" != true ]; then
  CHECKED="$(python3 scripts/backup-manifest.py verify --manifest "$MANIFEST" --mongo "$MONGO_ARCHIVE" --uploads "$UPLOADS_ARCHIVE" \
    --project "$BACKUP_PROJECT" --db "$DB_NAME" --allow-project "${RESTORE_ALLOW_FOREIGN_PROJECT:-}")" || fail "Backup pair rejected: nothing was changed."
  MONGO_ARCHIVE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["mongo"])' "$CHECKED")"
  UPLOADS_ARCHIVE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["uploads"])' "$CHECKED")"
fi

# 2. Versionen und Zielbestand - noch vor dem Stopp, ohne Änderung.
DROP_EXTRAS=""
KEPT_EXTRAS=""
if [ "$MANIFEST_LEGACY" = true ]; then
  warn "Old manifest: versions and the set of collections in the target cannot be checked."
else
  info "Checking versions against the target (code, MongoDB)"
  CODE_INFO="$(backend_python -m services.backup_inventory code-info | tr -d '\r' | tail -1)" || fail "Cannot read the code version of the target; nothing was changed."
  TARGET_MONGO="$(mongo_eval 'print(db.version())')" || fail "Cannot read the MongoDB version of the target; nothing was changed."
  python3 - "$CODE_INFO" "$TARGET_MONGO" "$BACKUP_PROJECT" "$DB_NAME" >"${WORK}/target.json" <<'PY'
import json, sys
info = json.loads(sys.argv[1])
print(json.dumps({"code_schema_version": info.get("code_schema_version"), "mongo_version": sys.argv[2],
                  "project": sys.argv[3], "db_name": sys.argv[4]}))
PY
  COMPAT_ARGS=()
  if [ "${RESTORE_ALLOW_VERSION_MISMATCH:-false}" = "true" ]; then COMPAT_ARGS+=(--allow-version-mismatch); fi
  python3 scripts/backup-manifest.py compat --manifest "$MANIFEST" --target "${WORK}/target.json" "${COMPAT_ARGS[@]}" \
    || fail "Versions do not fit: nothing was changed."

  mongo_eval 'print(JSON.stringify(db.getCollectionNames()))' >"${WORK}/target-collections.json" \
    || fail "Cannot list the collections of the target; nothing was changed."
  EXTRAS="$(python3 scripts/backup-manifest.py extras --manifest "$MANIFEST" --target-collections "${WORK}/target-collections.json")" \
    || fail "Cannot compare the collections of the target; nothing was changed."
  if [ -n "$EXTRAS" ]; then
    EXTRAS_LIST="$(printf '%s' "$EXTRAS" | tr '\n' ',' | sed 's/,$//')"
    case "$EXTRA_COLLECTIONS_MODE" in
      "") fail "Target has collections that are not in the backup: ${EXTRAS_LIST}. mongorestore --drop would leave them. Decide explicitly: RESTORE_EXTRA_COLLECTIONS=drop (removed after the restore, kept in the safety backup) or RESTORE_EXTRA_COLLECTIONS=keep. Nothing was changed." ;;
      keep) KEPT_EXTRAS="$EXTRAS_LIST"; warn "Keeping collections that are not in the backup: ${EXTRAS_LIST}" ;;
      drop) DROP_EXTRAS="$EXTRAS_LIST"; warn "Will drop collections that are not in the backup after the restore: ${EXTRAS_LIST}" ;;
    esac
  fi
  # Entfernt wird nur, was vorher im Sicherheitsbackup steckt.
  if [ -n "$DROP_EXTRAS" ] && [ "${SKIP_PRE_RESTORE_BACKUP:-false}" = "true" ]; then
    fail "RESTORE_EXTRA_COLLECTIONS=drop needs the safety backup; it cannot be combined with SKIP_PRE_RESTORE_BACKUP=true. Nothing was changed."
  fi
fi

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
  rm -rf "$WORK"
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

if [ -n "$DROP_EXTRAS" ]; then
  info "Dropping collections that are not in the backup (RESTORE_EXTRA_COLLECTIONS=drop): ${DROP_EXTRAS}"
  DROPPED="$(TLS_DROP="$DROP_EXTRAS" mongo_eval 'const names = process.env.TLS_DROP.split(","); names.forEach((n) => db.getCollection(n).drop()); print(names.length)')" \
    || fail "Could not drop the extra collections; writers stay stopped."
  ok "Dropped ${DROPPED} collection(s)"
fi

# Der Dump entstand in der Schreibpause (#1009): Ihr Dokument kommt mit zurück. Ist das Backup jünger als die Lease,
# wäre die Website nach dem Restore noch kurz gesperrt - darum hier ausdrücklich beenden.
backend_python -m services.maintenance off --force >/dev/null \
  || fail "Could not end the write pause restored with the backup; writers stay stopped."

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

# Fachlicher Abgleich (#1009/#1010): Sammlungen mit Anzahl, Summen (Anmeldungen, Rechnungen, Bestellungen,
# Mitgliedschaften), Upload-Bestand und Datei-Verweise gegen das Manifest - der Bestand, den das Backup gesehen hat.
if [ "$MANIFEST_LEGACY" != true ]; then
  info "Comparing the restored data with the manifest (collections, totals, uploads, file references)"
  SNAPSHOT_ARGS=(snapshot)
  if python3 scripts/backup-manifest.py field --manifest "$MANIFEST" --name references >/dev/null 2>&1; then SNAPSHOT_ARGS+=(--references); fi
  backend_python -m services.backup_inventory "${SNAPSHOT_ARGS[@]}" | tr -d '\r' | tail -1 >"${WORK}/after-restore.json" \
    || fail "Could not count the restored data; writers stay stopped."
  python3 scripts/backup-manifest.py compare --manifest "$MANIFEST" --after "${WORK}/after-restore.json" --kept-extras "$KEPT_EXTRAS" \
    || fail "Restored data does not match the backup (see above); writers stay stopped."
  ok "Restored data matches the manifest (pair $(python3 scripts/backup-manifest.py field --manifest "$MANIFEST" --name pair_id))"
fi

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
