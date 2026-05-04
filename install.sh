#!/usr/bin/env bash
# THE LION SQUAD — eSPORTS · One-Line Installer
# ---------------------------------------------------
# Usage: ./install.sh
# Bootstraps .env from .env.example, generates a JWT secret if missing,
# starts docker compose stack, waits for backend health.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 1. Bootstrap .env
if [ ! -f .env ]; then
  echo "==> First run: copying .env.example -> .env"
  cp .env.example .env
fi

# 2. Generate JWT_SECRET if placeholder still present
if grep -q "^JWT_SECRET=$\|^JWT_SECRET=changeme$" .env 2>/dev/null; then
  SECRET="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets;print(secrets.token_hex(32))')"
  if grep -q "^JWT_SECRET=" .env; then
    sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$SECRET|" .env
  else
    echo "JWT_SECRET=$SECRET" >> .env
  fi
  rm -f .env.bak
  echo "==> Generated JWT_SECRET"
fi

# 3. Force ADMIN_PASSWORD prompt if still placeholder
if grep -q "^ADMIN_PASSWORD=changeme$" .env 2>/dev/null; then
  read -srp "Set initial admin password (min 12 chars): " PASS
  echo
  if [ "${#PASS}" -lt 12 ]; then
    echo "Password too short, aborting."; exit 1
  fi
  sed -i.bak "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$PASS|" .env
  rm -f .env.bak
fi

# 4. Pull / build / up
echo "==> Building containers (this may take a few minutes the first time)..."
docker compose pull mongo 2>/dev/null || true
docker compose build
docker compose up -d

# 5. Wait for backend
echo "==> Waiting for backend to become healthy..."
for i in $(seq 1 60); do
  if curl -fsS http://localhost:8001/api/health >/dev/null 2>&1; then
    echo "==> Backend up."
    break
  fi
  sleep 2
done

cat <<EOF

====================================================
✅  THE LION SQUAD installation complete!
   Frontend : http://localhost:3000
   Backend  : http://localhost:8001/api/health
   Admin    : admin@thelionsquad.at / (your password)

   Logs:
     docker compose logs -f backend
     docker compose logs -f frontend

   Stop:
     docker compose down
====================================================

EOF
