#!/usr/bin/env bash
# THE LION SQUAD — eSPORTS · Update script
# -----------------------------------------------
# Pulls latest code, rebuilds containers, restarts the stack with no data loss.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ok()    { printf "\033[1;32m==> %s\033[0m\n" "$*"; }
info()  { printf "\033[1;36m==> %s\033[0m\n" "$*"; }
warn()  { printf "\033[1;33m==> %s\033[0m\n" "$*"; }

# 1. Git update (if this is a git checkout)
if [ -d .git ]; then
  info "Pulling latest code…"
  git pull --ff-only || warn "Git pull failed — continuing with local code."
fi

# 2. Rebuild
info "Rebuilding containers…"
docker compose pull mongodb 2>/dev/null || true
docker compose build

# 3. Restart with zero downtime where possible
info "Restarting stack…"
docker compose up -d

# 4. Wait for backend
BACKEND_PORT="$(grep -E '^BACKEND_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8001)"
info "Waiting for backend health…"
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${BACKEND_PORT:-8001}/api/health" >/dev/null 2>&1; then
    ok "Backend up."
    break
  fi
  sleep 2
done

ok "Update complete. View logs with: docker compose logs -f backend"
