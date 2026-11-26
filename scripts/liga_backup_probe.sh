#!/usr/bin/env bash
# Backup-Probelauf der Liga (#1632, BACKUP_RESTORE.md „Probelauf vor dem Betrieb“): ein eigener Docker-Stand mit eigenem
# Projektnamen, eigenen Ports und Volumes - nie lsw-abnahme, nie Port 23000, nie Produktion. Ablauf:
#
#   1. Stand bauen und starten (docker-compose.yml + docker-compose.abnahme.yml + eine erzeugte Probe-Datei)
#   2. Liga-Daten über die Seeds anlegen: scripts/seed_abnahme_liga.py (Liga, Teams, Map-Bilder) und die erweiterte
#      Gesamtabnahme (scripts/run_liga_g1.sh mit liga-saisonende und liga-betrieb: Endstand, Playoffs, Relegation, Momente,
#      Startrechte, Vorfälle, Rundnachricht)
#   3. Bestand vorher (scripts/liga_backup_probe.py snapshot, im Backend-Container)
#   4. scripts/backup.sh mit Schreibpause - in der Pause muss ein Schreibversuch 503 bekommen
#   5. Stand frisch aufsetzen (Volumes weg), 6. scripts/restore.sh nach BACKUP_RESTORE.md
#   7. Bestand nachher und Vergleich: Zählungen, Endstand, Tabellen, Startrechte, Momente, Uploads und Indizes gleich
#   8. Stand und Volumes entfernen (PROBE_KEEP=true lässt ihn stehen)
#
#   bash scripts/liga_backup_probe.sh            # alles, einmal
#   PROBE_RUNS=2 bash scripts/liga_backup_probe.sh
#
# Umgebung (alles optional): PROBE_PROJECT (lsw-backup-probe), PROBE_DIR (.local-testing/backup-probe),
# PROBE_FRONTEND_PORT (24632), PROBE_BACKEND_PORT (29632), PROBE_MONGO_PORT (27633), PROBE_VITE_PORT (3633),
# PROBE_SPECS ("liga-saisonende liga-betrieb"), PYTHON (Python mit backend/requirements.txt für Seed und Zeit-Helfer).
# Backup-Ziel und Passwort liegen nur im Probe-Ordner (Testwerte). Versand bleibt gesperrt (OUTBOUND_DISABLED).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSIX_ROOT="$ROOT"
# Windows (Git Bash): Pfade in der Form C:/… - sonst schreibt Python nach \c\… statt in den Probe-Ordner.
if command -v cygpath >/dev/null 2>&1; then
  ROOT="$(cygpath -m "$ROOT")"
fi
cd "$ROOT"

PROJECT="${PROBE_PROJECT:-lsw-backup-probe}"
DIR_REL="${PROBE_DIR_REL:-.local-testing/backup-probe}"
DIR="$ROOT/$DIR_REL"
FRONTEND_PORT_VALUE="${PROBE_FRONTEND_PORT:-24632}"
BACKEND_PORT_VALUE="${PROBE_BACKEND_PORT:-29632}"
MONGO_PORT="${PROBE_MONGO_PORT:-27633}"
VITE_PORT="${PROBE_VITE_PORT:-3633}"
SPECS="${PROBE_SPECS:-liga-saisonende liga-betrieb}"
RUNS="${PROBE_RUNS:-1}"
PYTHON="${PYTHON:-python3}"
PROBE_DB="tls_abnahme_g1probe"

say()  { printf "\033[1;36m[probe] %s\033[0m\n" "$*"; }
good() { printf "\033[1;32m[probe] %s\033[0m\n" "$*"; }
die()  { printf "\033[1;31m[probe] %s\033[0m\n" "$*" >&2; exit 1; }

# ---------------------------------------------------------------- Schutz: nur ein eigener, lokaler Stand
case "$PROJECT" in
  lsw-abnahme|lsw-abnahme-*|tls|tls-arena|tls-staging|"") die "Projektname ${PROJECT} ist ein geteilter oder produktiver Stand - bitte PROBE_PROJECT setzen." ;;
esac
for port in "$FRONTEND_PORT_VALUE" "$BACKEND_PORT_VALUE" "$MONGO_PORT" "$VITE_PORT"; do
  [ "$port" != "23000" ] || die "Port 23000 gehört dem geteilten Abnahme-Stand."
done
# Alles, was der Probelauf anlegt oder löscht, liegt unter <Repo>/.local-testing/ - nie anderswo (Pfad ohne „..“).
SCRATCH="$ROOT/.local-testing/"
case "$DIR_REL" in *..*|/*|[A-Za-z]:*) die "PROBE_DIR_REL muss ein Pfad unter .local-testing/ sein, ohne „..“: ${DIR_REL}" ;; esac
case "$DIR" in "$SCRATCH"[!/]*) ;; *) die "Probe-Ordner ${DIR} liegt nicht unter ${SCRATCH}." ;; esac
mkdir -p "$DIR"

# Ordner löschen nur nach Prüfung: absolut, unter <Repo>/.local-testing/<Name>, ohne „..“ und nie .local-testing selbst -
# sonst Abbruch statt Löschen.
safe_remove_dir() {
  local target="$1"
  while [ "${target%/}" != "$target" ]; do target="${target%/}"; done
  case "$target" in *..*) die "Löschen verweigert (enthält ..): ${target}" ;; esac
  case "$target" in "$SCRATCH"[!/]*) ;; *) die "Löschen verweigert (nicht unter ${SCRATCH}): ${target}" ;; esac
  rm -rf -- "$target"
}

# Windows (Git Bash): Docker-Pfade nicht umschreiben; python3 ist dort oft nur ein Platzhalter des Stores.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    export MSYS_NO_PATHCONV=1
    # mktemp in backup.sh/restore.sh: ein Ordner, den auch das Windows-Python dort lesen kann (nicht /tmp/…).
    mkdir -p "$DIR/tmp"
    export TMPDIR="$DIR/tmp"
    ;;
esac
if ! python3 -c 'import sys' >/dev/null 2>&1; then
  mkdir -p "$DIR/bin"
  printf '#!/bin/sh\nexec "%s" "$@"\n' "$PYTHON" >"$DIR/bin/python3"
  chmod +x "$DIR/bin/python3"
  export PATH="$POSIX_ROOT/$DIR_REL/bin:$PATH"  # PATH trennt mit „:“ - hier nie C:/…
fi

# ---------------------------------------------------------------- Auswahl des Compose-Projekts (wie BACKUP_RESTORE.md „Zielauswahl“)
cat >"$DIR/compose.probe.yml" <<YAML
# Erzeugt von scripts/liga_backup_probe.sh - nur für den Probelauf.
services:
  mongodb:
    ports:
      - "127.0.0.1:${MONGO_PORT}:27017"
  backend:
    environment:
      APP_ENV: test
      DB_NAME: ${PROBE_DB}
      DISABLE_SCHEDULER: "true"
      SCHEDULER_JOBS: ""
      OUTBOUND_DISABLED: "true"
YAML
export COMPOSE_PROJECT_NAME="$PROJECT"
export COMPOSE_PATH_SEPARATOR=":"
export COMPOSE_FILE="docker-compose.yml:docker-compose.abnahme.yml:${DIR_REL}/compose.probe.yml"
export COMPOSE_ENV_FILES=".env.abnahme.example"
export COMPOSE_DISABLE_ENV_FILE=true
export ABNAHME_PROJECT="$PROJECT"
export FRONTEND_PORT="$FRONTEND_PORT_VALUE" BACKEND_PORT="$BACKEND_PORT_VALUE"
export FRONTEND_URL="http://127.0.0.1:${VITE_PORT}" PUBLIC_BACKEND_URL="http://127.0.0.1:${FRONTEND_PORT_VALUE}"
export CORS_ORIGINS="http://127.0.0.1:${VITE_PORT},http://127.0.0.1:${FRONTEND_PORT_VALUE}" TRUSTED_HOSTS="127.0.0.1,localhost"
# Derselbe Test-Schlüssel wie scripts/run_liga_g1.sh: Der Seed verschlüsselt das Zwei-Faktor-Geheimnis, das Backend liest es.
export SETTINGS_ENCRYPTION_KEY="NQBHeGtQg5HYMo1HzvJtSQPN7X8YpJrZDvw-XMz0Bm8="
export DB_NAME="$PROBE_DB"
export BACKUP_DIR="$DIR/backups"
export BACKUP_ENCRYPTION_PASSWORD_FILE="$DIR/backup-password"
export BACKUP_REMOTE_OPTIONAL=true

mongo_url() {
  # Zugang des Probe-MongoDB aus der aufgelösten Konfiguration (Testwerte aus .env.abnahme.example) - nie ausgeben.
  docker compose config --format json | python3 -c '
import json, sys, urllib.parse
env = json.load(sys.stdin)["services"]["mongodb"]["environment"]
user = urllib.parse.quote(env["MONGO_INITDB_ROOT_USERNAME"], safe="")
password = urllib.parse.quote(env["MONGO_INITDB_ROOT_PASSWORD"], safe="")
print(f"mongodb://{user}:{password}@127.0.0.1:" + sys.argv[1] + "/?authSource=admin")' "$MONGO_PORT"
}

stack_up() {
  say "Stand ${PROJECT} starten (Backend ${BACKEND_PORT_VALUE}, Web ${FRONTEND_PORT_VALUE}, MongoDB ${MONGO_PORT})"
  docker compose up -d ${1:-} --wait --wait-timeout 900 >"$DIR/compose-up.log" 2>&1 || { tail -n 40 "$DIR/compose-up.log"; die "Stand startet nicht."; }
}

stack_down() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}

snapshot() {
  docker compose exec -T backend python - snapshot <scripts/liga_backup_probe.py >"$1"
}

seed() {
  say "Liga-Daten über die Seeds: seed_abnahme_liga.py und die erweiterte Gesamtabnahme (${SPECS})"
  ABNAHME_STATE="$DIR/state-liga.json" "$PYTHON" scripts/seed_abnahme_liga.py >"$DIR/seed-liga.log" 2>&1 || { tail -n 20 "$DIR/seed-liga.log"; die "seed_abnahme_liga.py scheiterte."; }
  local url
  url="$(mongo_url)"
  (
    export G1_MONGO_URL="$url" G1_DB_NAME="$PROBE_DB" G1_DIR="$DIR/g1" G1_STATE="$DIR/g1/state.json" G1_SPECS="$SPECS" G1_TRACE=off
    export BACKEND_PORT="$BACKEND_PORT_VALUE" FRONTEND_PORT="$VITE_PORT" PYTHON="$PYTHON"
    bash scripts/run_liga_g1.sh seed >"$DIR/g1-seed.log" 2>&1 || { tail -n 20 "$DIR/g1-seed.log"; exit 1; }
    bash scripts/run_liga_g1.sh run >"$DIR/g1-run.log" 2>&1 || { grep -E "✘|failed|Error" "$DIR/g1-run.log" | head -20; exit 1; }
  ) || die "Die Gesamtabnahme auf dem Probe-Stand ist rot - ohne vollständige Daten kein Probelauf."
  good "Liga-Daten angelegt ($(grep -Eo '[0-9]+ passed' "$DIR/g1-run.log" | tail -1))"
}

backup() {
  say "Backup mit Schreibpause (scripts/backup.sh)"
  safe_remove_dir "$BACKUP_DIR"; mkdir -p "$BACKUP_DIR"
  [ -s "$BACKUP_ENCRYPTION_PASSWORD_FILE" ] || (umask 077; openssl rand -base64 48 >"$BACKUP_ENCRYPTION_PASSWORD_FILE")
  BACKUP_WRITE_PAUSE_SETTLE_SECONDS=5 bash scripts/backup.sh >"$DIR/backup.log" 2>&1 &
  local pid=$! status code=""
  # In der Pause: Lesen geht, Schreiben bekommt 503 (auch ohne Anmeldung, vor jeder Rechteprüfung).
  for _ in $(seq 1 120); do
    if docker compose exec -T backend python -m services.maintenance status 2>/dev/null | grep -q '"active": true'; then
      code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:${BACKEND_PORT_VALUE}/api/games")"
      break
    fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  set +e; wait "$pid"; status=$?; set -e
  [ "$status" -eq 0 ] || { tail -n 30 "$DIR/backup.log"; die "backup.sh endete mit ${status}."; }
  [ "$code" = "503" ] || die "Schreibversuch in der Pause bekam ${code:-keine Antwort} statt 503."
  MANIFEST="$(ls -1 "$BACKUP_DIR"/tls_backup_*.manifest.json | tail -1)"
  [ "$(python3 scripts/backup-manifest.py field --manifest "$MANIFEST" --name consistent)" = "True" ] || die "Manifest sagt consistent=false."
  good "Backup fertig: $(basename "$MANIFEST"), Schreibversuch in der Pause: ${code}, $(grep -Eo 'pause [0-9]+s' "$DIR/backup.log" | tail -1)"
}

restore() {
  say "Stand frisch aufsetzen (Volumes weg) und nach BACKUP_RESTORE.md wiederherstellen"
  stack_down
  stack_up
  RESTORE_CONFIRM="$PROBE_DB" bash scripts/restore.sh "$MANIFEST" >"$DIR/restore.log" 2>&1 || { tail -n 40 "$DIR/restore.log"; die "restore.sh scheiterte."; }
  good "Restore fertig ($(grep -c . "$DIR/restore.log") Zeilen Protokoll)"
}

one_run() {
  local run="$1"
  say "Lauf ${run} von ${RUNS}"
  stack_down
  stack_up --build
  seed
  snapshot "$DIR/before-${run}.json"
  backup
  restore
  snapshot "$DIR/after-${run}.json"
  python3 scripts/liga_backup_probe.py compare "$DIR/before-${run}.json" "$DIR/after-${run}.json" | tee "$DIR/compare-${run}.txt"
  local result=${PIPESTATUS[0]}
  [ "$result" -eq 0 ] || die "Lauf ${run}: Bestand nach dem Restore weicht ab (siehe ${DIR_REL}/compare-${run}.txt)."
  good "Lauf ${run}: alles gleich."
}

trap '[ "${PROBE_KEEP:-false}" = true ] || stack_down' EXIT
for run in $(seq 1 "$RUNS"); do
  one_run "$run"
done
good "Backup-Probelauf: ${RUNS} von ${RUNS} gleich."
