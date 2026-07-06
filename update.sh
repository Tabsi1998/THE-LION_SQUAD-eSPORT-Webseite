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

env_int() {
  local key="$1"
  local fallback="$2"
  local value
  value="${!key:-}"
  if [ -z "$value" ]; then
    value="$(grep -E "^${key}=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
  fi
  value="${value:-$fallback}"
  case "$value" in
    ''|*[!0-9]*) printf "%s" "$fallback" ;;
    *) printf "%s" "$value" ;;
  esac
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
  TARGET_BRANCH="${DEPLOY_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
  [ -n "$TARGET_BRANCH" ] && [ "$TARGET_BRANCH" != "HEAD" ] || fail "Cannot determine git branch. Set DEPLOY_BRANCH=<branch>."

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    fail "Tracked local changes detected. Commit, stash, or revert them before updating."
  fi

  info "Pulling latest code for branch ${TARGET_BRANCH}..."
  git fetch --prune origin "$TARGET_BRANCH"

  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
    if git show-ref --verify --quiet "refs/heads/${TARGET_BRANCH}"; then
      git switch "$TARGET_BRANCH"
    else
      git switch -c "$TARGET_BRANCH" --track "origin/${TARGET_BRANCH}"
    fi
  fi

  git pull --ff-only origin "$TARGET_BRANCH"
  ok "Code ready: $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"
fi

# Optional backup before containers are recreated.
if [ "${PRE_UPDATE_BACKUP:-false}" = "true" ]; then
  info "Creating pre-update backup..."
  bash scripts/backup.sh
fi

MIN_VIDEO_UPLOAD_MB=1536
MIN_ORIGINAL_UPLOAD_MB=1536
MIN_PROXY_UPLOAD_LIMIT_MB=1700
MAX_VIDEO_UPLOAD_MB="$(env_int MAX_VIDEO_UPLOAD_MB "$MIN_VIDEO_UPLOAD_MB")"
MAX_ORIGINAL_UPLOAD_MB="$(env_int MAX_ORIGINAL_UPLOAD_MB "$MIN_ORIGINAL_UPLOAD_MB")"
PROXY_UPLOAD_LIMIT_MB="$(env_int PROXY_UPLOAD_LIMIT_MB "$MIN_PROXY_UPLOAD_LIMIT_MB")"
if [ "$MAX_VIDEO_UPLOAD_MB" -lt "$MIN_VIDEO_UPLOAD_MB" ]; then
  warn "MAX_VIDEO_UPLOAD_MB (${MAX_VIDEO_UPLOAD_MB} MB) is below the supported gallery video default. Using ${MIN_VIDEO_UPLOAD_MB} MB for this update."
  warn "Update .env to persist this: MAX_VIDEO_UPLOAD_MB=${MIN_VIDEO_UPLOAD_MB}"
  MAX_VIDEO_UPLOAD_MB="$MIN_VIDEO_UPLOAD_MB"
fi
if [ "$MAX_ORIGINAL_UPLOAD_MB" -lt "$MIN_ORIGINAL_UPLOAD_MB" ]; then
  warn "MAX_ORIGINAL_UPLOAD_MB (${MAX_ORIGINAL_UPLOAD_MB} MB) is below the supported media original default. Using ${MIN_ORIGINAL_UPLOAD_MB} MB for this update."
  warn "Update .env to persist this: MAX_ORIGINAL_UPLOAD_MB=${MIN_ORIGINAL_UPLOAD_MB}"
  MAX_ORIGINAL_UPLOAD_MB="$MIN_ORIGINAL_UPLOAD_MB"
fi
if [ "$PROXY_UPLOAD_LIMIT_MB" -lt "$MIN_PROXY_UPLOAD_LIMIT_MB" ]; then
  warn "PROXY_UPLOAD_LIMIT_MB (${PROXY_UPLOAD_LIMIT_MB} MB) is below the recommended internal proxy limit. Using ${MIN_PROXY_UPLOAD_LIMIT_MB} MB for this update."
  warn "Update .env and your external reverse proxy to persist this: PROXY_UPLOAD_LIMIT_MB=${MIN_PROXY_UPLOAD_LIMIT_MB}"
  PROXY_UPLOAD_LIMIT_MB="$MIN_PROXY_UPLOAD_LIMIT_MB"
fi
export MAX_VIDEO_UPLOAD_MB MAX_ORIGINAL_UPLOAD_MB PROXY_UPLOAD_LIMIT_MB
if [ "$PROXY_UPLOAD_LIMIT_MB" -lt "$MAX_VIDEO_UPLOAD_MB" ]; then
  warn "PROXY_UPLOAD_LIMIT_MB (${PROXY_UPLOAD_LIMIT_MB} MB) is lower than MAX_VIDEO_UPLOAD_MB (${MAX_VIDEO_UPLOAD_MB} MB)."
  warn "Direct gallery video uploads can fail with HTTP 413 until the reverse proxy body limit is raised."
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
check_frontend_route "$FRONTEND_LOCAL_URL" "/galerie" "local"

FRONTEND_PUBLIC_URL="$(grep -E '^FRONTEND_URL=' .env 2>/dev/null | cut -d= -f2- || true)"
if [ -n "${FRONTEND_PUBLIC_URL:-}" ]; then
  info "Checking public frontend URL…"
  if ! check_frontend_route "${FRONTEND_PUBLIC_URL%/}" "/community" "public" "soft"; then
    warn "Public proxy still serves stale HTML for /community. Clear the proxy cache or check Nginx Proxy Manager caching."
  fi
fi

ok "Update complete. View logs with: docker compose logs -f backend"
