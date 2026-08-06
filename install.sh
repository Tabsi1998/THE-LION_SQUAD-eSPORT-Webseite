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

# 3. Admin email + password
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

  # 4. Branding
  CUR_CLUB="$(get_env CLUB_NAME)"
  if [ -z "$CUR_CLUB" ] || [ "$CUR_CLUB" = "THE LION SQUAD" ]; then
    read -rp "Club name [THE LION SQUAD]: " IN_CLUB
    set_env CLUB_NAME "${IN_CLUB:-THE LION SQUAD}"
  fi

  # 5. Public URL
  CUR_URL="$(get_env PUBLIC_BACKEND_URL)"
  read -rp "Public backend URL [${CUR_URL:-http://localhost:8001}]: " IN_URL
  if [ -n "$IN_URL" ]; then set_env PUBLIC_BACKEND_URL "$IN_URL"; fi

  # 6. Mail provider (optional)
  echo
  echo "Mail provider for system notifications (optional):"
  echo "  1) None     — configure later in admin panel (default)"
  echo "  2) SMTP     — bring your own SMTP server"
  echo "  3) Resend   — use Resend API"
  read -rp "Choice [1]: " MP
  case "${MP:-1}" in
    2) set_env MAIL_PROVIDER smtp
       read -rp "SMTP host: " V; set_env SMTP_HOST "$V"
       read -rp "SMTP port [587]: " V; set_env SMTP_PORT "${V:-587}"
       read -rp "SMTP user: " V; set_env SMTP_USER "$V"
       read -srp "SMTP password: " V; echo; set_env SMTP_PASS "$V"
       read -rp "From address [no-reply@thelionsquad.at]: " V; set_env SMTP_FROM "${V:-no-reply@thelionsquad.at}" ;;
    3) set_env MAIL_PROVIDER resend
       read -rp "Resend API key: " V; set_env RESEND_API_KEY "$V" ;;
    *) set_env MAIL_PROVIDER none ;;
  esac
fi

if is_placeholder "$(get_env ADMIN_PASSWORD)"; then
  fail "ADMIN_PASSWORD is missing or still a placeholder. Set a unique password before non-interactive installation."
fi

chmod 600 .env

# 7. Build & up
info "Building containers (first run takes a few minutes)…"
docker compose pull mongodb 2>/dev/null || true
docker compose build
docker compose up -d

# 8. Wait for backend health
info "Waiting for backend health…"
HEALTHY=false
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:$(get_env BACKEND_PORT || echo 8001)/api/health" >/dev/null 2>&1; then
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
  export BOOTSTRAP_ADMIN_EMAIL="$(get_env ADMIN_EMAIL)"
  export BOOTSTRAP_ADMIN_PASSWORD="$(get_env ADMIN_PASSWORD)"
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

   Frontend : http://localhost:$(get_env FRONTEND_PORT || echo 3000)
   Backend  : http://localhost:$(get_env BACKEND_PORT || echo 8001)/api/health
   Admin    : $(get_env ADMIN_EMAIL)

   Next steps:
     • Open the frontend, login, and visit /admin/setup-wizard
     • Configure mail / discord / twitch in /admin/settings (or .env)

   Useful commands:
     docker compose logs -f backend
     docker compose logs -f frontend
     docker compose down
     ./update.sh         (pull & rebuild)
====================================================

EOF
