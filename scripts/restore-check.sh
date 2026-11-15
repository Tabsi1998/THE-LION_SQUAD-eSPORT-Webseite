#!/usr/bin/env bash
# Validates a backup pair before a real restore (#1010). Changes nothing.
#
# Geprüft wird gegen das Manifest des Paares (scripts/backup-manifest.py), derselbe Vertrag wie in restore.sh:
# Manifest lesbar und vollständig, beide Dateinamen und SHA-256-Prüfsummen passen, Projekt und Datenbank passen zum
# Ziel, beide Archive lassen sich entschlüsseln, und der Inhalt des Upload-Archivs ist der aus dem Manifest.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ok()   { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m==> %s\033[0m\n" "$*"; }
fail() { printf "\033[1;31m==> %s\033[0m\n" "$*"; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  scripts/restore-check.sh <tls_backup_YYYYMMDD_HHMMSS.manifest.json>
  scripts/restore-check.sh <mongo-archive.gz.enc> <uploads.tar.gz.enc> [manifest]

Checks manifest, checksums, pair, project, database and archive contents. It does not restore or modify data.
Old backups with a .manifest.txt need both archive paths and RESTORE_ALLOW_LEGACY_MANIFEST=true.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
[ "$#" -ge 1 ] && [ "$#" -le 3 ] || { usage; exit 1; }

source scripts/backup-target.sh
if [ -z "${BACKUP_PROJECT:-}" ]; then
  resolve_backup_target || fail "Cannot safely resolve this Compose project's restore targets."
  resolve_backup_project || fail "Cannot resolve this Compose project's name."
fi
resolve_backup_pair "$@" || fail "Backup pair or manifest not found (see above)."
BACKUP_ENCRYPTION_PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-/etc/tls-arena/backup-password}"
[ -r "$BACKUP_ENCRYPTION_PASSWORD_FILE" ] || fail "Password file not readable: ${BACKUP_ENCRYPTION_PASSWORD_FILE}"

if [ "$MANIFEST_LEGACY" = true ]; then
  [ "${RESTORE_ALLOW_LEGACY_MANIFEST:-false}" = "true" ] \
    || fail "Old manifest without project, versions and inventory: ${MANIFEST}. Only checksums can be checked; set RESTORE_ALLOW_LEGACY_MANIFEST=true to accept that."
  python3 scripts/backup-manifest.py verify-legacy --manifest "$MANIFEST" --mongo "$MONGO_ARCHIVE" --uploads "$UPLOADS_ARCHIVE" --db "$DB_NAME" >/dev/null \
    || fail "Backup pair rejected (old manifest): nothing was changed."
  warn "Old manifest: checksums and database checked; project, versions and inventory cannot be checked."
else
  CHECKED="$(python3 scripts/backup-manifest.py verify --manifest "$MANIFEST" --mongo "$MONGO_ARCHIVE" --uploads "$UPLOADS_ARCHIVE" \
    --project "$BACKUP_PROJECT" --db "$DB_NAME" --allow-project "${RESTORE_ALLOW_FOREIGN_PROJECT:-}")" \
    || fail "Backup pair rejected: nothing was changed."
  MONGO_ARCHIVE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["mongo"])' "$CHECKED")"
  UPLOADS_ARCHIVE="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["uploads"])' "$CHECKED")"
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass "file:${BACKUP_ENCRYPTION_PASSWORD_FILE}" -in "$MONGO_ARCHIVE" | gzip -t \
  || fail "Database archive cannot be decrypted or is not a valid gzip stream."
LISTING="$(openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass "file:${BACKUP_ENCRYPTION_PASSWORD_FILE}" -in "$UPLOADS_ARCHIVE" \
  | python3 scripts/backup-manifest.py tar-digest)" || fail "Uploads archive cannot be decrypted or is not a valid tar.gz."
if [ "$MANIFEST_LEGACY" != true ]; then
  EXPECTED="$(python3 scripts/backup-manifest.py field --manifest "$MANIFEST" --name uploads.digest)"
  ACTUAL="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["digest"])' "$LISTING")"
  [ "$EXPECTED" = "$ACTUAL" ] || fail "Uploads archive content differs from the manifest; nothing was changed."
fi

if [ "$MANIFEST_LEGACY" != true ] && [ "$(python3 scripts/backup-manifest.py field --manifest "$MANIFEST" --name consistent 2>/dev/null)" != "True" ]; then
  warn "This backup is marked unsafe: the write pause did not hold (see write_pause in the manifest). Database and uploads may not match exactly."
fi
ok "Backup pair checked: ${MANIFEST}"
