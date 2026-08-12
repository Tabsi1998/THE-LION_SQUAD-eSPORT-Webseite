#!/usr/bin/env bash
set -euo pipefail

container_name="tls-public-routes-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d \
  --name "$container_name" \
  --add-host backend:127.0.0.1 \
  --publish 127.0.0.1::80 \
  --volume "$PWD/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  --volume "$PWD/frontend/public:/usr/share/nginx/html:ro" \
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
  local headers status location
  headers="$(request_headers "$path" "$host")"
  status="$(printf '%s\n' "$headers" | awk 'NR == 1 { print $2 }')"
  location="$(printf '%s\n' "$headers" | awk 'BEGIN { IGNORECASE=1 } /^Location:/ { sub(/^[^:]+:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit }')"
  test "$status" = "301" && test "$location" = "$target" || {
    printf 'Expected 301 -> %s for %s, received %s -> %s\n%s\n' "$target" "$path" "$status" "$location" "$headers" >&2
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

for path in / /about /esports /tournaments /fastlap /galerie /players; do
  expect_status "$path" 200
done

while IFS='|' read -r legacy canonical; do
  expect_redirect "$legacy" "https://lionsquad.at${canonical}"
done <<'ROUTES'
/der-verein|/about
/ueber-uns/|/about
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

expect_redirect "/esports?view=live" "https://lionsquad.at/esports?view=live" "www.lionsquad.at"

printf 'Public route contract passed.\n'
