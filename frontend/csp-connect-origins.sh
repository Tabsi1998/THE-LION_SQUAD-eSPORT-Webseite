#!/bin/sh
# Trägt die Backend- und Upload-Adresse aus dem Build (VITE_BACKEND_URL, VITE_UPLOAD_BACKEND_URL) in connect-src der
# Content-Security-Policy ein. Ohne sie blockiert der Browser jeden Aufruf an einen eigenen Upload-Host (z. B.
# upload.lionsquad.at) schon vor dem Senden - in der Oberfläche nur „Network Error“.
# Aufruf: sh csp-connect-origins.sh <nginx.conf> [Adresse ...]; leere Adressen werden übersprungen. Übernommen wird nur
# Schema, Host und Port; alles andere bricht den Build ab, statt eine kaputte Policy auszuliefern.
set -eu

conf="$1"
shift

if [ "$(grep -c "connect-src 'self'" "$conf")" != "1" ]; then
  echo "csp-connect-origins: connect-src 'self' muss genau einmal in $conf stehen" >&2
  exit 1
fi

for url in "$@"; do
  [ -n "$url" ] || continue
  origin=$(printf '%s' "$url" | sed -E 's|^(https?://[^/?#]+).*$|\1|')
  if ! printf '%s' "$origin" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'; then
    echo "csp-connect-origins: ungültige Adresse für connect-src: $url" >&2
    exit 1
  fi
  if grep -Eq "connect-src 'self'( [^;]*)? $origin( |;)" "$conf"; then
    continue
  fi
  sed -i "s#connect-src 'self'#connect-src 'self' $origin#" "$conf"
done
