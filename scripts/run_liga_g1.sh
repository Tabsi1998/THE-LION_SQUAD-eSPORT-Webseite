#!/usr/bin/env bash
# Liga-Gesamtabnahme G.1 (#1632, docs/liga/abnahme.md): echtes Backend (uvicorn) gegen ein echtes MongoDB, das Frontend
# über den Vite-Server (startet Playwright selbst), dann die Specs aus frontend/e2e/liga-abnahme/ im Browser.
# Kein Docker-Stand: Das MongoDB stellt der Workflow als Dienst (.github/workflows/liga-abnahme-nacht.yml) bzw. am
# eigenen Rechner ein eigener Container (docs/liga/abnahme.md, Abschnitt „Lokal“). Nur Testdaten, nie Produktion.
#
#   scripts/run_liga_g1.sh up     Backend starten, auf Bereitschaft warten
#   scripts/run_liga_g1.sh seed   Testwelt anlegen (scripts/seed_liga_g1.py), Stand-Datei schreiben
#   scripts/run_liga_g1.sh run    Specs laufen lassen (Seed vorher nötig)
#   scripts/run_liga_g1.sh down   Backend stoppen
#
# Umgebung (alles optional):
#   G1_MONGO_URL      Vorgabe mongodb://127.0.0.1:27017 (nur dieser Rechner; der Seed prüft das)
#   G1_DB_NAME        Vorgabe tls_abnahme_g1 (muss mit tls_abnahme beginnen)
#   BACKEND_PORT      Vorgabe 8011, FRONTEND_PORT Vorgabe 3311
#   G1_DIR            Arbeitsordner für Log, Stand-Datei, Uploads, Ergebnisse (Vorgabe .local-testing/liga-g1)
#   G1_SPECS          nur diese Specs (Dateinamen ohne .spec.js, durch Leerzeichen getrennt)
#   G1_TRACE          Playwright-Trace (Vorgabe retain-on-failure; nachts off, das Artefakt ist öffentlich)
#   PYTHON            Python mit den Paketen aus backend/requirements.txt (Vorgabe python3)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  ROOT="$(cygpath -m "$ROOT")"
fi
export PYTHON="${PYTHON:-python3}"
export BACKEND_PORT="${BACKEND_PORT:-8011}"
export FRONTEND_PORT="${FRONTEND_PORT:-3311}"
G1_DIR="${G1_DIR:-$ROOT/.local-testing/liga-g1}"
mkdir -p "$G1_DIR/uploads"
WEB_URL="http://127.0.0.1:${FRONTEND_PORT}"
API_URL="http://127.0.0.1:${BACKEND_PORT}"

# Dieselbe Umgebung für Backend, Seed und Zeit-Helfer der Specs (scripts/seed_liga_g1.py --job …). Testwerte wie in
# .env.abnahme.example - nichts davon erreicht ein echtes System. APP_ENV=test: Ergebnisse der Leitung gelten sofort
# (keine 10-Sekunden-Haltezeit), Uploads ohne Virenscanner. Kein Zeitplan: die Zeit-Jobs stößt die Spec gezielt an.
export APP_ENV=test
export DISABLE_SCHEDULER=true
export OUTBOUND_DISABLED=true
export MONGO_URL="${G1_MONGO_URL:-mongodb://127.0.0.1:27017}"
export DB_NAME="${G1_DB_NAME:-tls_abnahme_g1}"
export JWT_SECRET="abnahme-nur-lokal-jwt-mit-mindestens-32-zeichen"
export SETTINGS_ENCRYPTION_KEY="NQBHeGtQg5HYMo1HzvJtSQPN7X8YpJrZDvw-XMz0Bm8="
export FRONTEND_URL="$WEB_URL" CORS_ORIGINS="$WEB_URL" TRUSTED_HOSTS="127.0.0.1,localhost"
export UPLOAD_DIR="$G1_DIR/uploads"
export G1_API="$API_URL"
export G1_STATE="${G1_STATE:-$G1_DIR/state.json}"

cmd_up() {
  # Umleitung für die ganze Gruppe: sonst hielte die Hintergrund-Shell die Ausgabe des Aufrufers offen.
  (cd "$ROOT/backend" && exec "$PYTHON" -m uvicorn server:app --host 127.0.0.1 --port "$BACKEND_PORT") \
    < /dev/null > "$G1_DIR/backend.log" 2>&1 &
  echo $! > "$G1_DIR/backend.pid"
  for _ in $(seq 1 90); do
    if curl --fail --silent "$API_URL/api/health/ready" >/dev/null; then
      echo "Backend bereit: $API_URL (Datenbank $DB_NAME)"
      return 0
    fi
    sleep 2
  done
  tail -n 80 "$G1_DIR/backend.log"
  echo "Backend wurde nicht bereit." >&2
  return 1
}

cmd_down() {
  if [ -f "$G1_DIR/backend.pid" ]; then
    kill "$(cat "$G1_DIR/backend.pid")" 2>/dev/null || true
    rm -f "$G1_DIR/backend.pid"
  fi
}

cmd_seed() {
  # Die Zeile mit dem Stand (Zugänge) bleibt in der Stand-Datei und erscheint weder im Log noch im Artefakt.
  "$PYTHON" "$ROOT/scripts/seed_liga_g1.py"
}

list_specs() {
  if [ -n "${G1_SPECS:-}" ]; then
    for name in $G1_SPECS; do
      name="${name%.spec.js}"
      if ! [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || [ ! -f "$ROOT/frontend/e2e/liga-abnahme/$name.spec.js" ]; then
        echo "Keine G.1-Spec: $name" >&2
        return 1
      fi
      echo "e2e/liga-abnahme/$name.spec.js"
    done
    return
  fi
  echo "e2e/liga-abnahme"
}

cmd_run() {
  local specs
  specs="$(list_specs)"
  mkdir -p "$G1_DIR/results"
  # shellcheck disable=SC2086 # Specs bewusst als einzelne Argumente
  (
    cd "$ROOT/frontend" && \
    LIGA_ABNAHME=1 ABNAHME=1 ABNAHME_STATE="$G1_STATE" ABNAHME_SHOTS="${ABNAHME_SHOTS:-}" E2E_PORT="$FRONTEND_PORT" VITE_DEV_BACKEND_URL="$API_URL" E2E_ISOLATED=1 \
    PLAYWRIGHT_JSON_OUTPUT_FILE="$G1_DIR/results/report.json" \
    PLAYWRIGHT_HTML_OUTPUT_DIR="$G1_DIR/results/playwright-report" PLAYWRIGHT_HTML_OPEN=never \
    npx playwright test $specs --project=chromium --workers=1 --retries=0 \
      --trace="${G1_TRACE:-retain-on-failure}" --output="$G1_DIR/results/test-results" --reporter=line,json,html
  )
}

case "${1:-}" in
  up) cmd_up ;;
  seed) cmd_seed ;;
  run) cmd_run ;;
  down) cmd_down ;;
  *)
    echo "Aufruf: $0 up|seed|run|down" >&2
    exit 2
    ;;
esac
