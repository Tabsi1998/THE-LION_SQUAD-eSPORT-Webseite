#!/usr/bin/env bash
# Source after changing into the repository root; caller must use set -euo pipefail.
resolve_backup_target() {
  local resolved_target
  command -v python3 >/dev/null 2>&1 || { echo "Backup target validation requires python3." >&2; return 1; }
  resolved_target="$(docker compose config --format json \
    | python3 scripts/compose-backup-target.py --db "${DB_NAME:-}" --volume "${UPLOADS_VOLUME:-}")" || return 1
  DB_NAME="${resolved_target%%$'\n'*}"
  UPLOADS_VOLUME="${resolved_target#*$'\n'}"
  export DB_NAME UPLOADS_VOLUME
}

# Name des ausgewählten Compose-Projekts (#1010): steht im Manifest und wird beim Restore verglichen.
resolve_backup_project() {
  BACKUP_PROJECT="$(docker compose config --format json | python3 scripts/backup-manifest.py compose-project)" || return 1
  export BACKUP_PROJECT
}

# Python im Backend-Container (#1009): läuft das Backend, per exec - sonst als Einmal-Container ohne Server und ohne
# Abhängigkeiten (etwa während des Restores, wenn das Backend absichtlich steht).
backend_running() {
  [ -n "$(docker compose ps --status running -q backend 2>/dev/null)" ]
}
backend_python() {
  if backend_running; then
    docker compose exec -T backend python "$@"
  else
    docker compose run --rm --no-deps -T backend python "$@"
  fi
}

# Archivpaar und Manifest aus den Argumenten (#1010) - gleich für restore-check.sh und restore.sh:
#   <manifest.json>                      Dateien aus dem Manifest, im selben Ordner
#   <mongo.archive.gz.enc> <uploads.tar.gz.enc> [manifest]
# Ohne Manifest-Argument: tls_backup_<zeit>.manifest.json neben dem Datenbank-Archiv, sonst das alte .manifest.txt.
# Setzt MANIFEST, MANIFEST_LEGACY (true/false) und - nur bei zwei oder drei Argumenten - MONGO_ARCHIVE, UPLOADS_ARCHIVE.
resolve_backup_pair() {
  MONGO_ARCHIVE=""
  UPLOADS_ARCHIVE=""
  MANIFEST=""
  MANIFEST_LEGACY=false
  case "$#" in
    1) MANIFEST="$(realpath "$1")" ;;
    2|3)
      MONGO_ARCHIVE="$(realpath "$1")"
      UPLOADS_ARCHIVE="$(realpath "$2")"
      if [ "$#" -eq 3 ]; then
        MANIFEST="$(realpath "$3")"
      else
        local base stamp
        base="$(basename "$MONGO_ARCHIVE" .archive.gz.enc)"
        stamp="${base: -15}"
        MANIFEST="$(dirname "$MONGO_ARCHIVE")/tls_backup_${stamp}.manifest.json"
        [ -f "$MANIFEST" ] || MANIFEST="$(dirname "$MONGO_ARCHIVE")/tls_backup_${stamp}.manifest.txt"
      fi
      ;;
    *) return 2 ;;
  esac
  [ -f "$MANIFEST" ] || { echo "Manifest not found: ${MANIFEST}" >&2; return 1; }
  case "$MANIFEST" in
    *.manifest.txt)
      MANIFEST_LEGACY=true
      [ -n "$MONGO_ARCHIVE" ] || { echo "An old .manifest.txt needs both archive paths as arguments." >&2; return 1; }
      ;;
  esac
  export MANIFEST MANIFEST_LEGACY MONGO_ARCHIVE UPLOADS_ARCHIVE
}

# Lease der Schreibpause im Hintergrund verlängern (#1009), alle TTL/3 Sekunden, solange Dump, Upload-Archiv und
# Nachzählung laufen - ein langes tar darf die Pause nicht unbemerkt enden lassen. Scheitert ein Verlängern, legt der
# Hintergrundprozess die Datei <flag> an und hört auf; das Backup gilt dann als unsicher.
# Braucht PAUSE_TOKEN und backend_python. Aufruf: start_lease_renewer <ttl> <flag>, Ende: stop_lease_renewer.
LEASE_RENEWER_PID=""
start_lease_renewer() {
  local ttl="$1" flag="$2" interval
  interval=$(( ttl / 3 ))
  [ "$interval" -ge 1 ] || interval=1
  (
    trap - EXIT INT TERM
    while sleep "$interval"; do
      if ! backend_python -m services.maintenance renew --token "$PAUSE_TOKEN" --ttl "$ttl" >/dev/null 2>&1; then
        : >"$flag"
        exit 0
      fi
    done
  ) &
  LEASE_RENEWER_PID=$!
}
stop_lease_renewer() {
  [ -n "$LEASE_RENEWER_PID" ] || return 0
  kill "$LEASE_RENEWER_PID" 2>/dev/null || true
  wait "$LEASE_RENEWER_PID" 2>/dev/null || true
  LEASE_RENEWER_PID=""
}
