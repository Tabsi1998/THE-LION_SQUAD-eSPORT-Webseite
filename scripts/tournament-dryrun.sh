#!/usr/bin/env bash
# Read-only tournament survey, run inside the backend container.
#
# MongoDB is deliberately not reachable from the host - it has no published
# port and lives only on the Compose network. So the survey runs where the
# backend runs, with the same connection settings the backend already has.
#
#   bash scripts/tournament-dryrun.sh                 # Bericht in die Konsole
#   bash scripts/tournament-dryrun.sh vorher.json     # zusätzlich als JSON
#   bash scripts/tournament-dryrun.sh nachher.json vorher.json   # und vergleichen
#
# Nothing is written to the database; the script it starts cannot write.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { printf "\033[1;31m==> %s\033[0m\n" "$*" >&2; exit 1; }
info() { printf "\033[1;36m==> %s\033[0m\n" "$*" >&2; }
ok() { printf "\033[1;32m==> %s\033[0m\n" "$*" >&2; }

OUT_FILE="${1:-}"
COMPARE_FILE="${2:-}"

if [ -n "$COMPARE_FILE" ] && [ ! -f "$COMPARE_FILE" ]; then
  fail "Vergleichsdatei nicht gefunden: ${COMPARE_FILE}
    Ein Vergleich braucht eine frühere Aufnahme. Die entsteht nur, wenn beim
    Lauf ein Dateiname mitgegeben wurde:

      bash scripts/tournament-dryrun.sh ${COMPARE_FILE}

    Ohne Vorher-Aufnahme einfach ohne zweiten Namen laufen lassen - der Bericht
    zeigt den Bestand auch so."
fi

command -v docker >/dev/null || fail "docker wurde nicht gefunden."
docker compose ps backend >/dev/null 2>&1 || fail \
  "Der Backend-Dienst ist über docker compose nicht erreichbar. Im Verzeichnis der docker-compose.yml ausführen."

ARGS=(--json)
MOUNTS=(-v "${ROOT}/scripts:/app/scripts:ro")

if [ -n "$COMPARE_FILE" ]; then
  COMPARE_ABS="$(cd "$(dirname "$COMPARE_FILE")" && pwd)/$(basename "$COMPARE_FILE")"
  MOUNTS+=(-v "${COMPARE_ABS}:/app/vergleich.json:ro")
  ARGS+=(--compare /app/vergleich.json)
  info "Vergleiche gegen ${COMPARE_FILE}"
fi

info "Starte Trockenlauf im Backend-Container (nur lesend) ..."

# --no-deps: MongoDB laeuft bereits; der Lauf soll nichts neu starten.
# Der Bericht kommt ueber stderr, das JSON ueber stdout - deshalb laesst sich
# beides trennen, ohne im Container ein beschreibbares Verzeichnis zu brauchen.
set +e
if [ -n "$OUT_FILE" ]; then
  docker compose run --rm --no-deps -T \
    "${MOUNTS[@]}" \
    -e PYTHONPATH=/app \
    backend python /app/scripts/tournament-migration-dryrun.py "${ARGS[@]}" > "$OUT_FILE"
  STATUS=$?
else
  docker compose run --rm --no-deps -T \
    "${MOUNTS[@]}" \
    -e PYTHONPATH=/app \
    backend python /app/scripts/tournament-migration-dryrun.py "${ARGS[@]}" > /dev/null
  STATUS=$?
fi
set -e

if [ -n "$OUT_FILE" ] && [ -s "$OUT_FILE" ]; then
  ok "Bericht gespeichert: ${OUT_FILE}"
elif [ -n "$OUT_FILE" ]; then
  rm -f "$OUT_FILE"
  fail "Es wurde kein Bericht erzeugt - siehe Meldungen oben."
fi

if [ -n "$COMPARE_FILE" ] && [ "$STATUS" -ne 0 ]; then
  fail "Der Vergleich hat Abweichungen gefunden (siehe oben)."
fi
exit "$STATUS"
