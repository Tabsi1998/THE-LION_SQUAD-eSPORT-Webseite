#!/usr/bin/env bash
# Validates backup files before a real restore.
set -euo pipefail

ok()   { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
fail() { printf "\033[1;31m==> %s\033[0m\n" "$*"; exit 1; }

usage() {
  cat <<'EOF'
Usage:
  scripts/restore-check.sh <mongo-archive.gz> <uploads.tar.gz>

This validates archive integrity only. It does not restore or modify data.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
[ "$#" -eq 2 ] || { usage; exit 1; }

MONGO_ARCHIVE="$1"
UPLOADS_ARCHIVE="$2"

[ -f "$MONGO_ARCHIVE" ] || fail "Mongo archive not found: ${MONGO_ARCHIVE}"
[ -f "$UPLOADS_ARCHIVE" ] || fail "Uploads archive not found: ${UPLOADS_ARCHIVE}"

gzip -t "$MONGO_ARCHIVE"
tar -tzf "$UPLOADS_ARCHIVE" >/dev/null

ok "Backup files are readable and structurally valid."
