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
fail()  { printf "\033[1;31m==> %s\033[0m\n" "$*"; exit 1; }

fetch_html() {
  curl -fsSL -H "Cache-Control: no-cache" -H "Pragma: no-cache" "$1"
}

extract_main_assets() {
  grep -oE 'static/(js|css)/main\.[^" ]+' | sort -u
}

check_frontend_route() {
  local base_url="$1"
  local route="$2"
  local label="$3"
  local mode="${4:-strict}"
  local root_assets route_assets asset status

  root_assets="$(fetch_html "${base_url}/" | extract_main_assets || true)"
  route_assets="$(fetch_html "${base_url}${route}" | extract_main_assets || true)"

  if [ -z "$root_assets" ]; then
    [ "$mode" = "soft" ] && { warn "Frontend check failed (${label}): no main assets found on /"; return 1; }
    fail "Frontend check failed (${label}): no main assets found on /"
  fi
  if [ -z "$route_assets" ]; then
    [ "$mode" = "soft" ] && { warn "Frontend check failed (${label}): no main assets found on ${route}"; return 1; }
    fail "Frontend check failed (${label}): no main assets found on ${route}"
  fi

  if [ "$root_assets" != "$route_assets" ]; then
    warn "Frontend route ${route} serves different assets than /. This usually means stale prerendered HTML or proxy cache."
    warn "/ assets: ${root_assets//$'\n'/, }"
    warn "${route} assets: ${route_assets//$'\n'/, }"
    return 1
  fi

  while IFS= read -r asset; do
    [ -n "$asset" ] || continue
    status="$(curl -sS -o /dev/null -w "%{http_code}" -H "Cache-Control: no-cache" "${base_url}/${asset}" || true)"
    if [ "$status" != "200" ]; then
      [ "$mode" = "soft" ] && { warn "Frontend check failed (${label}): ${asset} returned HTTP ${status}"; return 1; }
      fail "Frontend check failed (${label}): ${asset} returned HTTP ${status}"
    fi
  done <<< "$route_assets"

  ok "Frontend route ${route} is serving current assets (${label})."
}

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
docker compose up -d --force-recreate frontend backend

# 4. Wait for backend
BACKEND_PORT="$(grep -E '^BACKEND_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8001)"
info "Waiting for backend health…"
BACKEND_READY=false
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${BACKEND_PORT:-8001}/api/health" >/dev/null 2>&1; then
    ok "Backend up."
    BACKEND_READY=true
    break
  fi
  sleep 2
done
[ "$BACKEND_READY" = "true" ] || fail "Backend did not become healthy within 120s."

# 5. Wait for frontend and verify SPA fallback routes
FRONTEND_PORT="$(grep -E '^FRONTEND_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 3000)"
FRONTEND_LOCAL_URL="http://localhost:${FRONTEND_PORT:-3000}"
info "Waiting for frontend health…"
FRONTEND_READY=false
for i in $(seq 1 60); do
  if curl -fsS "${FRONTEND_LOCAL_URL}/health" >/dev/null 2>&1; then
    ok "Frontend up."
    FRONTEND_READY=true
    break
  fi
  sleep 2
done
[ "$FRONTEND_READY" = "true" ] || fail "Frontend did not become healthy within 120s."

info "Checking frontend SPA routes…"
check_frontend_route "$FRONTEND_LOCAL_URL" "/community" "local"
check_frontend_route "$FRONTEND_LOCAL_URL" "/seasons/current" "local"

FRONTEND_PUBLIC_URL="$(grep -E '^FRONTEND_URL=' .env 2>/dev/null | cut -d= -f2- || true)"
if [ -n "${FRONTEND_PUBLIC_URL:-}" ]; then
  info "Checking public frontend URL…"
  if ! check_frontend_route "${FRONTEND_PUBLIC_URL%/}" "/community" "public" "soft"; then
    warn "Public proxy still serves stale HTML for /community. Clear the proxy cache or check Nginx Proxy Manager caching."
  fi
fi

ok "Update complete. View logs with: docker compose logs -f backend"
