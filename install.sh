#!/usr/bin/env bash
# THE LION SQUAD — eSPORTS · One-Line Installer
# ---------------------------------------------------
# Usage: ./install.sh [--non-interactive]
# Bootstraps .env, generates JWT secret, prompts for admin password & branding,
# starts docker compose stack, waits for backend health.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

NON_INTERACTIVE=false
for arg in "$@"; do
  case "$arg" in
    --non-interactive|-y) NON_INTERACTIVE=true ;;
  esac
done

# Colored output helper
ok()    { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
info()  { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m==> %s\033[0m\n" "$*"; }
fail()  { printf "\033[1;31m==> %s\033[0m\n" "$*" >&2; exit 1; }

# ASCII banner
cat <<'EOF'

████████╗██╗     ███████╗   ███████╗███████╗██████╗  ██████╗ ██████╗ ████████╗███████╗
╚══██╔══╝██║     ██╔════╝   ██╔════╝██╔════╝██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝
   ██║   ██║     ███████╗   █████╗  ███████╗██████╔╝██║   ██║██████╔╝   ██║   ███████╗
   ██║   ██║     ╚════██║   ██╔══╝  ╚════██║██╔═══╝ ██║   ██║██╔══██╗   ██║   ╚════██║
   ██║   ███████╗███████║   ███████╗███████║██║     ╚██████╔╝██║  ██║   ██║   ███████║
   ╚═╝   ╚══════╝╚══════╝   ╚══════╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝

           THE LION SQUAD — eSPORTS · Vereinsplattform Installer
EOF

# 0. Pre-flight
command -v docker >/dev/null 2>&1 || fail "Docker not installed. Install: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 not found. Update Docker Desktop or install compose plugin."

# 1. Bootstrap .env
if [ ! -f .env ]; then
  info "First run: copying .env.example → .env"
  cp .env.example .env
fi

set_env() {
  # set_env KEY VALUE  — replace or append in .env (idempotent)
  local key="$1" val="$2"
  if grep -q "^${key}=" .env; then
    # POSIX-safe: use a temp variable to avoid sed delimiter issues
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env > .env.tmp && mv .env.tmp .env
  else
    echo "${key}=${val}" >> .env
  fi
}

get_env() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d'=' -f2-
}

unset_env() {
  local key="$1"
  awk -v k="$key" 'BEGIN{FS="="} $1!=k{print}' .env > .env.tmp && mv .env.tmp .env
}

is_placeholder() {
  case "${1:-}" in
    ""|changeme|CHANGE_ME_*|change-me-*|*generate-with*|*replace-me*) return 0 ;;
    *) return 1 ;;
  esac
}

# 2. JWT_SECRET
CUR_SECRET="$(get_env JWT_SECRET)"
if is_placeholder "$CUR_SECRET"; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets;print(secrets.token_hex(32))')"
  set_env JWT_SECRET "$SECRET"
  ok "Generated JWT_SECRET ($(echo "$SECRET" | head -c 8)…)"
fi

# 3. Encryption and database credentials
CUR_SETTINGS_KEY="$(get_env SETTINGS_ENCRYPTION_KEY)"
if is_placeholder "$CUR_SETTINGS_KEY"; then
  SETTINGS_KEY="$(python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"
  set_env SETTINGS_ENCRYPTION_KEY "$SETTINGS_KEY"
  ok "Generated SETTINGS_ENCRYPTION_KEY"
fi

CUR_MONGO_USER="$(get_env MONGO_USERNAME)"
if [ -z "$CUR_MONGO_USER" ]; then set_env MONGO_USERNAME "tls_admin"; fi
CUR_MONGO_PASS="$(get_env MONGO_PASSWORD)"
if is_placeholder "$CUR_MONGO_PASS"; then
  MONGO_PASS="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets;print(secrets.token_hex(32))')"
  set_env MONGO_PASSWORD "$MONGO_PASS"
  set_env MONGO_URL "mongodb://$(get_env MONGO_USERNAME):${MONGO_PASS}@mongodb:27017/?authSource=admin"
  ok "Generated MongoDB credentials"
fi

# 4. Admin email + password
CUR_EMAIL="$(get_env ADMIN_EMAIL)"
CUR_PASS="$(get_env ADMIN_PASSWORD)"
if ! $NON_INTERACTIVE; then
  if [ -z "$CUR_EMAIL" ] || [ "$CUR_EMAIL" = "admin@thelionsquad.at" ]; then
    read -rp "Admin email [admin@thelionsquad.at]: " IN_EMAIL
    set_env ADMIN_EMAIL "${IN_EMAIL:-admin@thelionsquad.at}"
  fi
  if is_placeholder "$CUR_PASS"; then
    while true; do
      read -srp "Set admin password (min 12 chars): " PASS; echo
      if [ "${#PASS}" -lt 12 ]; then warn "Too short, try again."; continue; fi
      read -srp "Confirm password: " PASS2; echo
      if [ "$PASS" != "$PASS2" ]; then warn "Passwords do not match."; continue; fi
      break
    done
    set_env ADMIN_PASSWORD "$PASS"
  fi

  # 5. Public URL. Branding and providers are configured in the admin UI.
  CUR_URL="$(get_env FRONTEND_URL)"
  read -rp "Public site URL [${CUR_URL:-https://lionsquad.at}]: " IN_URL
  SITE_URL="${IN_URL:-${CUR_URL:-https://lionsquad.at}}"
  set_env FRONTEND_URL "$SITE_URL"
  set_env PUBLIC_BACKEND_URL "$SITE_URL"
  set_env CORS_ORIGINS "$SITE_URL"
fi

if is_placeholder "$(get_env ADMIN_PASSWORD)"; then
  fail "ADMIN_PASSWORD is missing or still a placeholder. Set a unique password before non-interactive installation."
fi

chmod 600 .env

# 6. Prepare the host-side backup encryption password when the installer has
# permission. It is intentionally stored outside the repository and .env.
BACKUP_PASSWORD_FILE="${BACKUP_ENCRYPTION_PASSWORD_FILE:-/etc/tls-arena/backup-password}"
if [ ! -e "$BACKUP_PASSWORD_FILE" ]; then
  if mkdir -p "$(dirname "$BACKUP_PASSWORD_FILE")" 2>/dev/null; then
    (umask 077; openssl rand -base64 48 > "$BACKUP_PASSWORD_FILE")
    chmod 600 "$BACKUP_PASSWORD_FILE"
    ok "Generated backup encryption password at ${BACKUP_PASSWORD_FILE}"
  else
    warn "Could not create ${BACKUP_PASSWORD_FILE}. Complete the one-time backup setup in BACKUP_RESTORE.md."
  fi
fi

# 7. Build & up
info "Building containers (first run takes a few minutes)…"
docker compose pull mongodb 2>/dev/null || true
docker compose build
docker compose up -d

# 8. Wait for backend health
info "Waiting for backend readiness…"
HEALTHY=false
BACKEND_PORT_VALUE="$(get_env BACKEND_PORT)"
BACKEND_PORT_VALUE="${BACKEND_PORT_VALUE:-8001}"
FRONTEND_PORT_VALUE="$(get_env FRONTEND_PORT)"
FRONTEND_PORT_VALUE="${FRONTEND_PORT_VALUE:-3000}"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:${BACKEND_PORT_VALUE}/api/health/ready" >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  printf "."
  sleep 2
done
echo
if $HEALTHY; then ok "Backend up."; else warn "Backend did not become healthy within 120s — check 'docker compose logs backend'."; fi

# 9. Create the first admin once. The API process never creates, promotes, or
# reactivates accounts during normal startup.
if $HEALTHY; then
  info "Creating the initial superadmin if none exists…"
  # Erst zuweisen, dann exportieren (ShellCheck SC2155); "|| true" hält den bisherigen Stand: ohne Eintrag leer.
  BOOTSTRAP_ADMIN_EMAIL="$(get_env ADMIN_EMAIL || true)"
  BOOTSTRAP_ADMIN_PASSWORD="$(get_env ADMIN_PASSWORD || true)"
  export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
  docker compose run --rm --no-deps \
    -e BOOTSTRAP_ADMIN_EMAIL \
    -e BOOTSTRAP_ADMIN_PASSWORD \
    backend python bootstrap_admin.py
  unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
  unset_env ADMIN_PASSWORD
  chmod 600 .env
  ok "Initial admin bootstrap complete; ADMIN_PASSWORD was removed from .env."
fi

cat <<EOF

====================================================
✅  THE LION SQUAD installation complete!

   Frontend : http://localhost:${FRONTEND_PORT_VALUE:-3000}
   Backend  : http://localhost:${BACKEND_PORT_VALUE}/api/health/ready
   Admin    : $(get_env ADMIN_EMAIL)

   Next steps:
     • Open the frontend, login, and visit /setup
     • Configure branding, mail, Discord, Twitch and Google in /admin/settings
     • Verify encrypted off-site backups using BACKUP_RESTORE.md

   Useful commands:
     docker compose logs -f backend
     docker compose logs -f frontend
     docker compose down
     ./update.sh         (pull & rebuild)
====================================================

EOF
