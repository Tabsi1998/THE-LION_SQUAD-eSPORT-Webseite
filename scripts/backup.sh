#!/usr/bin/env bash
# THE LION SQUAD - production backup helper.
#
# Datenbank und Uploads werden als PAAR gesichert (#1009): Das Backend schaltet für die Dauer von Dump und
# Upload-Archiv eine kurze Schreibpause ein (services/maintenance.py, meist 10 bis 60 Sekunden). Lesen geht weiter,
# Schreiben bekommt 503 "gleich wieder da". Die Pause hat eine Lease mit Ablaufzeit: Sie endet am Ende des Skripts,
# bei jedem Fehler (trap) und spätestens nach BACKUP_WRITE_PAUSE_TTL Sekunden von selbst.
# Danach entsteht ein Manifest (#1010) mit Paar-ID, Projekt, Datenbank, Versionen, Prüfsummen, Sammlungen und Summen.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ok()    { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
info()  { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m==> %s\033[0m\n" "$*"; }
fail()  { printf "\033[1;31m==> %s\033[0m\n" "$*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_cmd docker
require_cmd gzip
require_cmd tar
require_cmd openssl
require_cmd python3

# Resolve both targets from the selected project before creating any backup files.
source scripts/backup-target.sh
source scripts/backup-offsite-policy.sh
resolve_backup_target || fail "Cannot safely resolve this Compose project's backup targets."
resolve_backup_project || fail "Cannot resolve this Compose project's name."
BACKUP_DIR="${BACKUP_DIR:-/opt/tls-arena/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_ENCRYPTION_PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-/etc/tls-arena/backup-password}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
BACKUP_REMOTE_OPTIONAL="${BACKUP_REMOTE_OPTIONAL:-false}"
# Schreibpause (#1009): true (Standard) oder false. Lease in Sekunden, Wartezeit bis alle Prozesse die Pause sehen,
# Höchstwartezeit auf laufende Schreibvorgänge.
BACKUP_WRITE_PAUSE="${BACKUP_WRITE_PAUSE:-true}"
BACKUP_WRITE_PAUSE_TTL="${BACKUP_WRITE_PAUSE_TTL:-120}"
BACKUP_WRITE_PAUSE_SETTLE_SECONDS="${BACKUP_WRITE_PAUSE_SETTLE_SECONDS:-3}"
BACKUP_WRITE_PAUSE_DRAIN_SECONDS="${BACKUP_WRITE_PAUSE_DRAIN_SECONDS:-60}"
# Datei-Verweise in der Pause mitzählen (für den fachlichen Restore-Vergleich). false verkürzt die Pause.
BACKUP_REFERENCE_SCAN="${BACKUP_REFERENCE_SCAN:-true}"
RESOLVED_APP_ENV="$(resolve_app_env .env)"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
PAIR_ID="$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"

# Checked before any archive is written so a misconfigured off-site target fails
# fast instead of after a long dump.
if ! OFFSITE_BLOCK_REASON="$(offsite_backup_allowed "$BACKUP_REMOTE" "$RESOLVED_APP_ENV" "$BACKUP_REMOTE_OPTIONAL")"; then
  fail "$OFFSITE_BLOCK_REASON"
fi

MONGO_FILE="tls_${DB_NAME}_${TIMESTAMP}.archive.gz.enc"
UPLOADS_FILE="tls_uploads_${TIMESTAMP}.tar.gz.enc"
MANIFEST_FILE="tls_backup_${TIMESTAMP}.manifest.json"

mkdir -p "$BACKUP_DIR"
[ -r "$BACKUP_ENCRYPTION_PASSWORD_FILE" ] || fail "Encrypted backups require readable BACKUP_ENCRYPTION_PASSWORD_FILE=${BACKUP_ENCRYPTION_PASSWORD_FILE}"

info "Checking Docker Compose services"
docker compose ps mongodb >/dev/null || fail "MongoDB service is not available via docker compose."
docker compose ps frontend >/dev/null || warn "Frontend service not listed by docker compose."

WORK="$(mktemp -d)"
PAUSE_TOKEN=""
PAUSE_STARTED=0
COMPLETE=false

json_field() {
  # Ein Feld aus einer JSON-Datei (Ausgaben der Backend-Befehle).
  python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get(sys.argv[2]); print("" if v is None else (json.dumps(v) if isinstance(v,(list,dict,bool)) else v))' "$1" "$2"
}

end_pause() {
  [ -n "$PAUSE_TOKEN" ] || return 0
  local token="$PAUSE_TOKEN"
  PAUSE_TOKEN=""
  if backend_python -m services.maintenance off --token "$token" >"${WORK}/pause-off.json" 2>/dev/null; then
    ok "Write pause ended after $(( $(date +%s) - PAUSE_STARTED ))s"
  else
    warn "Write pause could not be ended explicitly; its lease expires on its own within ${BACKUP_WRITE_PAUSE_TTL}s."
  fi
}

on_exit() {
  local status=$?
  end_pause
  if [ "$COMPLETE" != true ]; then
    # Ein halbes Paar ist kein Backup: die Dateien dieses Laufs wieder entfernen.
    rm -f "${BACKUP_DIR}/${MONGO_FILE}" "${BACKUP_DIR}/${UPLOADS_FILE}" "${BACKUP_DIR}/${MANIFEST_FILE}"
    if [ "$status" -ne 0 ]; then
      printf "\033[1;31m==> Backup failed (exit %s); incomplete files of this run were removed.\033[0m\n" "$status"
    fi
  fi
  rm -rf "$WORK"
}
trap on_exit EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------------------------------------------------------------------
# Schreibpause einschalten (nur wenn das Backend läuft - steht es, schreibt ohnehin niemand).
# ---------------------------------------------------------------------------------------------------------------------
PAUSE_MODE="none"
if ! backend_running; then
  PAUSE_MODE="writers_stopped"
  info "Backend is not running: no writers, no pause needed"
elif [ "$BACKUP_WRITE_PAUSE" = "true" ]; then
  info "Starting write pause (lease ${BACKUP_WRITE_PAUSE_TTL}s): reads continue, writes get 503 for a moment"
  PAUSE_STARTED="$(date +%s)"
  set +e
  backend_python -m services.maintenance on --ttl "$BACKUP_WRITE_PAUSE_TTL" --reason backup \
    --settle "$BACKUP_WRITE_PAUSE_SETTLE_SECONDS" --drain-timeout "$BACKUP_WRITE_PAUSE_DRAIN_SECONDS" >"${WORK}/pause.json"
  pause_status=$?
  set -e
  [ "$pause_status" -eq 0 ] || fail "Write pause could not be started (exit ${pause_status}: $(cat "${WORK}/pause.json" 2>/dev/null)); no backup written."
  PAUSE_TOKEN="$(json_field "${WORK}/pause.json" token)"
  [ -n "$PAUSE_TOKEN" ] || fail "Write pause did not return a token; no backup written."
  PAUSE_MODE="pause"
  if [ "$(json_field "${WORK}/pause.json" drained)" != "true" ]; then
    warn "Running writes did not finish within ${BACKUP_WRITE_PAUSE_DRAIN_SECONDS}s: $(json_field "${WORK}/pause.json" busy) - noted in the manifest."
  fi
else
  warn "BACKUP_WRITE_PAUSE=${BACKUP_WRITE_PAUSE}: database and uploads are saved without a write pause and may not match."
fi
[ -f "${WORK}/pause.json" ] || echo '{}' >"${WORK}/pause.json"

info "Counting collections, totals and uploads before the dump"
backend_python -m services.backup_inventory snapshot >"${WORK}/before.json" || fail "Inventory before the dump failed."

info "Creating encrypted MongoDB backup for database '${DB_NAME}'"
docker compose exec -T mongodb sh -ec 'mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db "$1" --archive --gzip' sh "$DB_NAME" \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 -pass "file:${BACKUP_ENCRYPTION_PASSWORD_FILE}" -out "${BACKUP_DIR}/${MONGO_FILE}"

LEASE_LAPSED=false
if [ -n "$PAUSE_TOKEN" ]; then
  if ! backend_python -m services.maintenance renew --token "$PAUSE_TOKEN" --ttl "$BACKUP_WRITE_PAUSE_TTL" >"${WORK}/renew.json"; then
    LEASE_LAPSED=true
    warn "Write pause lease expired during the dump - writes may have happened; noted in the manifest. Consider a larger BACKUP_WRITE_PAUSE_TTL."
  fi
fi

info "Creating uploads backup from Docker volume '${UPLOADS_VOLUME}'"
docker volume inspect "$UPLOADS_VOLUME" >/dev/null || fail "Uploads volume not found: ${UPLOADS_VOLUME}. Check the selected Compose project."
docker run --rm \
  -v "${UPLOADS_VOLUME}:/uploads:ro" \
  alpine tar -czf - -C /uploads . \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 -pass "file:${BACKUP_ENCRYPTION_PASSWORD_FILE}" -out "${BACKUP_DIR}/${UPLOADS_FILE}"

info "Counting again after the dump (shows writes that bypassed the pause)"
SNAPSHOT_ARGS=(snapshot)
if [ "$BACKUP_REFERENCE_SCAN" = "true" ]; then SNAPSHOT_ARGS+=(--references); fi
backend_python -m services.backup_inventory "${SNAPSHOT_ARGS[@]}" >"${WORK}/after.json" || fail "Inventory after the dump failed."
PAUSE_SECONDS=0
if [ "$PAUSE_STARTED" -gt 0 ]; then PAUSE_SECONDS=$(( $(date +%s) - PAUSE_STARTED )); fi
end_pause

# ---------------------------------------------------------------------------------------------------------------------
# Prüfen und Manifest - nach der Pause, damit sie so kurz wie möglich bleibt.
# ---------------------------------------------------------------------------------------------------------------------
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass "file:${BACKUP_ENCRYPTION_PASSWORD_FILE}" -in "${BACKUP_DIR}/${MONGO_FILE}" | gzip -t
ok "MongoDB backup validated: ${BACKUP_DIR}/${MONGO_FILE}"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass "file:${BACKUP_ENCRYPTION_PASSWORD_FILE}" -in "${BACKUP_DIR}/${UPLOADS_FILE}" \
  | python3 scripts/backup-manifest.py tar-digest >"${WORK}/uploads.json"
ok "Uploads backup validated: ${BACKUP_DIR}/${UPLOADS_FILE} ($(json_field "${WORK}/uploads.json" count) files)"

python3 - "${WORK}/pause.json" "$PAUSE_MODE" "$LEASE_LAPSED" "$PAUSE_SECONDS" >"${WORK}/pause-summary.json" <<'PY'
import json, sys
raw = json.load(open(sys.argv[1]))
print(json.dumps({"mode": sys.argv[2], "drained": bool(raw.get("drained", sys.argv[2] != "pause")),
                  "busy": raw.get("busy") or [], "lease_lapsed": sys.argv[3] == "true", "seconds": int(sys.argv[4])}))
PY

APP_VERSION="$(python3 -c 'import json; print(json.load(open(".release-please-manifest.json")).get(".", "unknown"))' 2>/dev/null || echo unknown)"
python3 scripts/backup-manifest.py build \
  --out "${BACKUP_DIR}/${MANIFEST_FILE}" --project "$BACKUP_PROJECT" --db "$DB_NAME" --timestamp "$TIMESTAMP" \
  --pair-id "$PAIR_ID" --mongo-file "${BACKUP_DIR}/${MONGO_FILE}" --uploads-file "${BACKUP_DIR}/${UPLOADS_FILE}" \
  --app-version "$APP_VERSION" --git-commit "$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
  --before "${WORK}/before.json" --after "${WORK}/after.json" --uploads-listing "${WORK}/uploads.json" \
  --pause "${WORK}/pause-summary.json" --retention-days "$RETENTION_DAYS"
UNSTABLE="$(python3 scripts/backup-manifest.py field --manifest "${BACKUP_DIR}/${MANIFEST_FILE}" --name unstable_collections)"
[ "$UNSTABLE" = "[]" ] || warn "Changed during the pause (the restore compares them loosely): ${UNSTABLE}"
ok "Manifest written: ${BACKUP_DIR}/${MANIFEST_FILE} (pair ${PAIR_ID}, pause ${PAUSE_SECONDS}s)"
COMPLETE=true

if [ -n "$BACKUP_REMOTE" ]; then
  require_cmd rclone
  info "Copying encrypted backup set to off-site remote '${BACKUP_REMOTE}'"
  rclone copyto "${BACKUP_DIR}/${MONGO_FILE}" "${BACKUP_REMOTE%/}/${MONGO_FILE}"
  rclone copyto "${BACKUP_DIR}/${UPLOADS_FILE}" "${BACKUP_REMOTE%/}/${UPLOADS_FILE}"
  rclone copyto "${BACKUP_DIR}/${MANIFEST_FILE}" "${BACKUP_REMOTE%/}/${MANIFEST_FILE}"
  ok "Off-site copy complete."
else
  warn "BACKUP_REMOTE is empty: encrypted backup exists locally only. Configure an rclone remote for off-site resilience."
  warn "Accepted because APP_ENV='${RESOLVED_APP_ENV:-unset}' and BACKUP_REMOTE_OPTIONAL='${BACKUP_REMOTE_OPTIONAL}'."
fi

info "Applying retention (${RETENTION_DAYS} days)"
find "$BACKUP_DIR" -type f -name "tls_${DB_NAME}_*.archive.gz.enc" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name "tls_uploads_*.tar.gz.enc" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name "tls_backup_*.manifest.txt" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name "tls_backup_*.manifest.json" -mtime +"$RETENTION_DAYS" -delete

ok "Backup complete."
