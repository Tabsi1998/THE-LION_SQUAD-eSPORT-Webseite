#!/usr/bin/env bash
set -euo pipefail

container_name="tls-public-routes-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
web_root="$(mktemp -d)"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf -- "$web_root"
}
trap cleanup EXIT

cp -a "$PWD/frontend/public/." "$web_root/"
cp "$PWD/frontend/index.html" "$web_root/index.html"

docker run --rm -d \
  --name "$container_name" \
  --add-host backend:127.0.0.1 \
  --publish 127.0.0.1::80 \
  --volume "$PWD/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  --volume "$web_root:/usr/share/nginx/html:ro" \
  nginx:alpine >/dev/null

port="$(docker port "$container_name" 80/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
base_url="http://127.0.0.1:${port}"

for attempt in {1..20}; do
  if curl --silent --fail --head --header "Host: lionsquad.at" "${base_url}/health" >/dev/null; then
    break
  fi
  if test "$attempt" = "20"; then
    printf 'Nginx route-contract container did not become ready.\n' >&2
    docker logs "$container_name" >&2
    exit 1
  fi
  sleep 0.25
done

request_headers() {
  local path="$1"
  local host="${2:-lionsquad.at}"
  curl --silent --show-error --head --header "Host: ${host}" "${base_url}${path}"
}

expect_status() {
  local path="$1"
  local expected="$2"
  local headers status
  headers="$(request_headers "$path")"
  status="$(printf '%s\n' "$headers" | awk 'NR == 1 { print $2 }')"
  test "$status" = "$expected" || {
    printf 'Expected %s for %s, received %s\n%s\n' "$expected" "$path" "$status" "$headers" >&2
    return 1
  }
}

expect_redirect() {
  local path="$1"
  local target="$2"
  local host="${3:-lionsquad.at}"
  local expected_status="${4:-301}"
  local headers status location
  headers="$(request_headers "$path" "$host")"
  status="$(printf '%s\n' "$headers" | awk 'NR == 1 { print $2 }')"
  location="$(printf '%s\n' "$headers" | awk 'BEGIN { IGNORECASE=1 } /^Location:/ { sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }')"
  test "$status" = "$expected_status" && test "$location" = "$target" || {
    printf 'Expected %s -> %s for %s, received %s -> %s\n%s\n' "$expected_status" "$target" "$path" "$status" "$location" "$headers" >&2
    return 1
  }
}

expect_gone() {
  local path="$1"
  local headers status robots
  headers="$(request_headers "$path")"
  status="$(printf '%s\n' "$headers" | awk 'NR == 1 { print $2 }')"
  robots="$(printf '%s\n' "$headers" | awk 'BEGIN { IGNORECASE=1 } /^X-Robots-Tag:/ { sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }')"
  test "$status" = "410" && test "$robots" = "noindex, nofollow" || {
    printf 'Expected 410 with noindex, nofollow for %s, received %s with %s\n%s\n' "$path" "$status" "$robots" "$headers" >&2
    return 1
  }
}

expect_nonce_csp() {
  local response headers body nonce
  response="$(curl --silent --show-error --include --header "Host: lionsquad.at" "${base_url}/about")"
  headers="${response%%$'\r\n\r\n'*}"
  body="${response#*$'\r\n\r\n'}"
  nonce="$(printf '%s\n' "$headers" | sed -nE "s/.*script-src 'self' 'nonce-([^']+)'.*/\1/p" | head -n 1)"
  test -n "$nonce" || {
    printf 'Expected a per-request script nonce in Content-Security-Policy.\n%s\n' "$headers" >&2
    return 1
  }
  printf '%s' "$headers" | grep -Fq "script-src 'self' 'unsafe-inline'" && {
    printf 'script-src must not allow unsafe-inline.\n%s\n' "$headers" >&2
    return 1
  }
  printf '%s' "$body" | grep -Fq "<meta name=\"csp-nonce\" content=\"$nonce\" />" || {
    printf 'HTML CSP nonce does not match its response header.\n' >&2
    return 1
  }
}

header_value() {
  local headers="$1"
  local name="$2"
  printf '%s\n' "$headers" | awk -v name="$name" 'BEGIN { IGNORECASE=1 } index(tolower($0), tolower(name) ":") == 1 { sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }'
}

visitor_headers() {
  local path="$1"
  local visitor="$2"
  curl --silent --show-error --head --header "Host: lionsquad.at" --header "X-Forwarded-For: ${visitor}" "${base_url}${path}"
}

status_of() {
  printf '%s\n' "$1" | awk 'NR == 1 { print $2 }'
}

# Teilen-Bilder (#1412): nur die öffentlichen Bilder bekommen von nginx kein "no-store" (das Backend erlaubt dort
# fünf Minuten) und haben eine Bremse je Besucher. Der Besucher ist die letzte Adresse in X-Forwarded-For, weil die
# Verbindung hier aus einem Docker-Netz kommt wie von einem Proxy. Alles andere unter /api: no-store, keine Bremse.
# Ohne Backend antwortet nginx sonst mit 502 - hier zählen nur die Kopfzeilen und die 429.
expect_share_image_rules() {
  local headers limited=""
  headers="$(visitor_headers "/api/achievements/share/route-contract.png" "203.0.113.7")"
  test "$(status_of "$headers")" != "429" && test -z "$(header_value "$headers" "Cache-Control")" \
    && test "$(header_value "$headers" "X-Content-Type-Options")" = "nosniff" || {
    printf 'Expected the share image without the nginx no-store but with the security headers.\n%s\n' "$headers" >&2
    return 1
  }
  for _ in {1..60}; do
    headers="$(visitor_headers "/api/share/result/cup/neonfalke/story.png" "203.0.113.7")"
    if test "$(status_of "$headers")" = "429"; then
      limited="yes"
      break
    fi
  done
  test -n "$limited" || {
    printf 'Expected 429 after a burst of share-image requests from one visitor.\n%s\n' "$headers" >&2
    return 1
  }
  headers="$(visitor_headers "/api/share/result/cup/neonfalke/wide.png" "198.51.100.7, 203.0.113.8")"
  test "$(status_of "$headers")" != "429" || {
    printf 'A second visitor must keep a limit of its own.\n%s\n' "$headers" >&2
    return 1
  }
  headers="$(visitor_headers "/api/year-review/me/card.png" "203.0.113.7")"
  test "$(status_of "$headers")" != "429" && test "$(header_value "$headers" "Cache-Control")" = "no-store" || {
    printf 'Expected the private year-review image without a limit and with no-store.\n%s\n' "$headers" >&2
    return 1
  }
}

for path in / /about /esports /tournaments /fastlap /galerie /players; do
  expect_status "$path" 200
done

while IFS='|' read -r legacy canonical; do
  expect_redirect "$legacy" "$canonical"
done <<'ROUTES'
/der-verein|/about
/ueber-uns/|/about
/values|/about#werte
/datenschutzerklaerung|/privacy
/datenschutz/|/privacy
/impressum|/imprint
/kontakt|/contact
/sponsoren|/sponsors
/partner|/partners
/mitglieder|/members
/mitglied-werden|/membership/join
/mitgliedschaft|/membership/join
/turniere|/tournaments
/gallerie|/galerie
/galerie-2|/galerie
/gallerie/sommerfest|/galerie/sommerfest
/gallery|/galerie
/gallery/sommerfest|/galerie/sommerfest
/server|/servers
/spielerprofil/tabsi98|/u/tabsi98
/players/tabsi98|/u/tabsi98
/lan-party-2024|/events
/f1|/fastlap
/f1/monza|/fastlap/monza
ROUTES

for path in /elements/blockquote/ /product/demo /portfolio/demo /tag/demo /category/demo /author/demo; do
  expect_gone "$path"
done

expect_redirect "/esports?view=live" "https://lionsquad.at/esports?view=live" "www.lionsquad.at" "308"
expect_nonce_csp
expect_share_image_rules

printf 'Public route contract passed.\n'
