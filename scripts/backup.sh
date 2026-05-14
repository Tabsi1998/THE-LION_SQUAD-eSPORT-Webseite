#!/usr/bin/env bash
# THE LION SQUAD - production backup helper.
# Creates validated MongoDB and uploads backups without stopping the stack.
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

env_value() {
  local key="$1" default="${2:-}" value
  value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf "%s" "${value:-$default}"
}

detect_uploads_volume() {
  if [ -n "${UPLOADS_VOLUME:-}" ]; then
    printf "%s" "$UPLOADS_VOLUME"
    return
  fi

  local volume
  volume="$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)uploads_data$' | grep -Ei '(lion|tls)' | head -n 1 || true)"
  if [ -n "$volume" ]; then
    printf "%s" "$volume"
    return
  fi

  printf "%s" "the-lion_squad-esport-webseite_uploads_data"
}

require_cmd docker
require_cmd gzip
require_cmd tar

DB_NAME="${DB_NAME:-$(env_value DB_NAME tls_arena)}"
BACKUP_DIR="${BACKUP_DIR:-/opt/tls-arena/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
UPLOADS_VOLUME="$(detect_uploads_volume)"

MONGO_FILE="tls_${DB_NAME}_${TIMESTAMP}.archive.gz"
UPLOADS_FILE="tls_uploads_${TIMESTAMP}.tar.gz"
MANIFEST_FILE="tls_backup_${TIMESTAMP}.manifest.txt"

mkdir -p "$BACKUP_DIR"

info "Checking Docker Compose services"
docker compose ps mongodb >/dev/null || fail "MongoDB service is not available via docker compose."
docker compose ps backend >/dev/null || warn "Backend service not listed by docker compose."
docker compose ps frontend >/dev/null || warn "Frontend service not listed by docker compose."

info "Creating MongoDB backup for database '${DB_NAME}'"
docker compose exec -T mongodb mongodump --db "$DB_NAME" --archive --gzip > "${BACKUP_DIR}/${MONGO_FILE}"
gzip -t "${BACKUP_DIR}/${MONGO_FILE}"
ok "MongoDB backup validated: ${BACKUP_DIR}/${MONGO_FILE}"

info "Creating uploads backup from Docker volume '${UPLOADS_VOLUME}'"
docker volume inspect "$UPLOADS_VOLUME" >/dev/null || fail "Uploads volume not found: ${UPLOADS_VOLUME}. Set UPLOADS_VOLUME=... if your Compose project name differs."
docker run --rm \
  -v "${UPLOADS_VOLUME}:/uploads:ro" \
  -v "${BACKUP_DIR}:/backup" \
  alpine sh -c "tar -czf '/backup/${UPLOADS_FILE}' -C /uploads ."
tar -tzf "${BACKUP_DIR}/${UPLOADS_FILE}" >/dev/null
ok "Uploads backup validated: ${BACKUP_DIR}/${UPLOADS_FILE}"

{
  echo "created_at=${TIMESTAMP}"
  echo "db_name=${DB_NAME}"
  echo "mongo_file=${MONGO_FILE}"
  echo "uploads_file=${UPLOADS_FILE}"
  echo "uploads_volume=${UPLOADS_VOLUME}"
  echo "retention_days=${RETENTION_DAYS}"
  echo "git_commit=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${BACKUP_DIR}/${MONGO_FILE}" "${BACKUP_DIR}/${UPLOADS_FILE}"
  fi
} > "${BACKUP_DIR}/${MANIFEST_FILE}"
ok "Manifest written: ${BACKUP_DIR}/${MANIFEST_FILE}"

info "Applying retention (${RETENTION_DAYS} days)"
find "$BACKUP_DIR" -type f -name "tls_${DB_NAME}_*.archive.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name "tls_uploads_*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -type f -name "tls_backup_*.manifest.txt" -mtime +"$RETENTION_DAYS" -delete

ok "Backup complete."
