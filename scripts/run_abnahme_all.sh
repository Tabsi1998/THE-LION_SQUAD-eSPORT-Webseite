#!/usr/bin/env bash
# Der ganze Abend als Abnahme (#1656): eigener Abnahme-Stand (docs/entwicklung/abnahme-lokal.md), dann jede
# Abnahme-Spec aus frontend/e2e/abnahme/ der Reihe nach - und vor jeder Spec frisch geseedet. Die Specs verbrauchen
# Testdaten (advancement-modes spielt die Show-Runde, die tv-abnahme danach noch braucht); der Seed legt bei jedem
# Aufruf neue Turniere an und schreibt die Stand-Datei neu, so beginnt jede Spec auf einem unberührten Abend.
# Der nächtliche Workflow (.github/workflows/nightly-abnahme.yml) und der Lauf am eigenen Rechner nutzen dieses Skript.
#
#   scripts/run_abnahme_all.sh up     Stand bauen und starten, auf Health warten
#   scripts/run_abnahme_all.sh run    alle Abnahme-Specs mit frischem Seed davor, Bericht nach $ABNAHME_RESULTS
#   scripts/run_abnahme_all.sh down   Stand samt Testdatenbank entfernen (nur dieses Projekt)
#
# Umgebung (alles optional):
#   ABNAHME_PROJECT   Projektname (Vorgabe lsw-abnahme-nacht; den gemeinsamen Stand lsw-abnahme fasst das Skript nie an)
#   FRONTEND_PORT     Web (Vorgabe 24500), BACKEND_PORT Backend (Vorgabe 29501)
#   ABNAHME_SOURCE    Ordner, aus dem gebaut wird (Vorgabe: dieser Repo-Ordner; ohne frontend/node_modules)
#   ABNAHME_STATE     Stand-Datei (Vorgabe .local-testing/abnahme/state-<Projekt>.json); Fast Lap bekommt eine eigene
#   ABNAHME_RESULTS   Ergebnisse je Spec, runs.tsv und summary.md (Vorgabe .local-testing/abnahme/nacht-<Projekt>)
#   ABNAHME_SHOTS     Bilder der Specs, je Spec ein Unterordner (optional)
#   ABNAHME_SPECS     nur diese Specs, durch Leerzeichen getrennt (z. B. "tv-abnahme matchplan-abnahme")
#   PYTHON            Python 3.11 für Seed und Bericht (Vorgabe python3)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Unter Git Bash (Windows) Pfade als C:/…, damit Node, Python und Docker sie ebenfalls verstehen.
if command -v cygpath >/dev/null 2>&1; then
  ROOT="$(cygpath -m "$ROOT")"
fi

export ABNAHME_PROJECT="${ABNAHME_PROJECT:-lsw-abnahme-nacht}"
if [ "$ABNAHME_PROJECT" = "lsw-abnahme" ]; then
  echo "ABNAHME_PROJECT=lsw-abnahme ist der gemeinsame Stand - dieses Skript baut und löscht seinen Stand, bitte einen eigenen Namen wählen." >&2
  exit 2
fi
export FRONTEND_PORT="${FRONTEND_PORT:-24500}"
export BACKEND_PORT="${BACKEND_PORT:-29501}"
WEB_URL="http://127.0.0.1:${FRONTEND_PORT}"
export FRONTEND_URL="$WEB_URL" PUBLIC_BACKEND_URL="$WEB_URL" CORS_ORIGINS="$WEB_URL"
STATE="${ABNAHME_STATE:-$ROOT/.local-testing/abnahme/state-${ABNAHME_PROJECT}.json}"
STATE_FASTLAP="${STATE%.json}-fastlap.json"
RESULTS="${ABNAHME_RESULTS:-$ROOT/.local-testing/abnahme/nacht-${ABNAHME_PROJECT}}"
PYTHON="${PYTHON:-python3}"

# Im Workflow faltet GitHub die Ausgabe je Spec zusammen; am eigenen Rechner nur eine Überschrift.
group() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then echo "::group::$1"; else echo "=== $1"; fi
}
endgroup() {
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then echo "::endgroup::"; fi
}

compose() {
  docker compose -p "$ABNAHME_PROJECT" --env-file "$ROOT/.env.abnahme.example" \
    -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.abnahme.yml" "$@"
}

cmd_up() {
  compose up -d --build
  for _ in $(seq 1 60); do
    if curl --fail --silent "$WEB_URL/health" >/dev/null && \
       curl --fail --silent "http://127.0.0.1:${BACKEND_PORT}/api/health/ready" >/dev/null; then
      echo "Abnahme-Stand $ABNAHME_PROJECT bereit: $WEB_URL"
      return 0
    fi
    sleep 3
  done
  compose logs --no-color --tail=200
  echo "Abnahme-Stand $ABNAHME_PROJECT wurde nicht gesund." >&2
  return 1
}

cmd_down() {
  compose down --volumes --remove-orphans
}

# Alle Abnahme-Specs, alphabetisch - neue kommen von selbst dazu. Die README-Bilder sind keine Abnahme (eigener
# Workflow), sie bleiben draußen.
list_specs() {
  if [ -n "${ABNAHME_SPECS:-}" ]; then
    for name in $ABNAHME_SPECS; do
      name="${name%.spec.js}"
      if ! [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || [ ! -f "$ROOT/frontend/e2e/abnahme/$name.spec.js" ]; then
        echo "Keine Abnahme-Spec: $name" >&2
        return 1
      fi
      echo "$ROOT/frontend/e2e/abnahme/$name.spec.js"
    done
    return
  fi
  find "$ROOT/frontend/e2e/abnahme" -maxdepth 1 -name '*.spec.js' ! -name 'readme-screenshots.spec.js' | LC_ALL=C sort
}

cmd_run() {
  local specs spec name out seed state seed_rc spec_rc started seeded finished last_minute=""
  specs="$(list_specs)"
  mkdir -p "$RESULTS"
  : > "$RESULTS/runs.tsv"
  while IFS= read -r spec; do
    [ -n "$spec" ] || continue
    name="$(basename "$spec" .spec.js)"
    out="$RESULTS/$name"
    mkdir -p "$out"
    # Die Fast-Lap-Abnahme hat ihren eigenen Seed und eigene Konten - und deshalb eine eigene Stand-Datei (die
    # gespeicherten Sitzungen hängen am Namen der Stand-Datei).
    if grep -q 'seed_abnahme_fastlap.py' "$spec"; then
      seed="seed_abnahme_fastlap.py"
      state="$STATE_FASTLAP"
    else
      seed="seed_abnahme.py"
      state="$STATE"
    fi
    # Nie zwei Seeds in derselben Minute: Turniertitel tragen die Uhrzeit auf die Minute, und das Anlegen eines Turniers
    # mit gleichem Inhalt liefert das schon vorhandene zurück (idempotent) - der zweite Seed bekäme den Cup des ersten,
    # der dann schon live ist (beim ersten lokalen Lauf nach zwei kurzen Specs passiert). Gemerkt wird die Minute am
    # ENDE des vorigen Seeds: sein Zeitstempel kann auch in der Minute nach dem Start entstehen (erster Nachtlauf
    # 19.10.: Start um :58, Stempel in der nächsten Minute, der folgende Seed bekam dessen Turnier).
    while [ "$(date -u +%Y%m%d%H%M)" = "$last_minute" ]; do sleep 2; done
    group "$name (Seed: $seed)"
    started=$(date +%s)
    set +e
    # Die Zeile mit dem Stand (Zugänge) bleibt in der Stand-Datei und erscheint weder im Log noch im Artefakt.
    ABNAHME_STATE="$state" "$PYTHON" "$ROOT/scripts/$seed" 2>&1 | grep -v '^ABNAHME-STATE ' > "$out/seed.log"
    seed_rc=${PIPESTATUS[0]}
    last_minute="$(date -u +%Y%m%d%H%M)"
    set -e
    seeded=$(date +%s)
    spec_rc=0
    if [ "$seed_rc" -eq 0 ]; then
      set +e
      (
        cd "$ROOT/frontend" && \
        ABNAHME=1 ABNAHME_STATE="$state" E2E_BASE_URL="$WEB_URL" \
        ABNAHME_SHOTS="${ABNAHME_SHOTS:+$ABNAHME_SHOTS/$name}" \
        PLAYWRIGHT_JSON_OUTPUT_FILE="$out/report.json" \
        PLAYWRIGHT_HTML_OUTPUT_DIR="$out/playwright-report" PLAYWRIGHT_HTML_OPEN=never \
        npx playwright test "e2e/abnahme/$name.spec.js" --project=chromium --workers=1 --retries=0 \
          --trace="${ABNAHME_TRACE:-retain-on-failure}" --output="$out/test-results" --reporter=line,json,html
      ) 2>&1 | tee "$out/spec.log"
      spec_rc=${PIPESTATUS[0]}
      set -e
    else
      echo "Seed fehlgeschlagen (Exit $seed_rc):"
      tail -n 20 "$out/seed.log"
    fi
    finished=$(date +%s)
    printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$seed_rc" "$((seeded - started))" "$spec_rc" "$((finished - seeded))" >> "$RESULTS/runs.tsv"
    endgroup
  done <<< "$specs"

  "$PYTHON" "$ROOT/scripts/nightly_abnahme_report.py" summary --results "$RESULTS" --out "$RESULTS/summary.md" > "$RESULTS/status.txt"
  cat "$RESULTS/summary.md"
  grep -qx 'status=green' "$RESULTS/status.txt"
}

case "${1:-}" in
  up) cmd_up ;;
  run) cmd_run ;;
  down) cmd_down ;;
  *)
    echo "Aufruf: $0 up|run|down" >&2
    exit 2
    ;;
esac
