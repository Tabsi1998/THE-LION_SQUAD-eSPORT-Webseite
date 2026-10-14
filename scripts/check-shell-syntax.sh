#!/usr/bin/env bash
# Syntaxprüfung jeder Shell-Datei einzeln mit bash -n (#980).
#
# `bash -n a.sh b.sh` prüft nur a.sh, alle weiteren Namen sind bloß Argumente; ein Fehler in b.sh ging so durch.
# Ohne Argumente: alle *.sh, die Git kennt (derselbe Umfang wie der Schritt "shell" in scripts/local_check.py).
# Mit Argumenten: genau diese Dateien. Namen mit Leerzeichen sind erlaubt. Jede fehlerhafte Datei wird genannt.
set -euo pipefail

if [ "$#" -gt 0 ]; then
  scripts=("$@")
else
  cd "$(dirname "$0")/.."
  scripts=()
  while IFS= read -r -d '' script; do
    scripts+=("$script")
  done < <(git ls-files -z -- '*.sh')
fi

if [ "${#scripts[@]}" -eq 0 ]; then
  echo "Keine Shell-Dateien gefunden - das ist kein Grün, sondern eine falsche Dateiauswahl." >&2
  exit 1
fi

failed=0
for script in "${scripts[@]}"; do
  if [ ! -f "$script" ]; then
    echo "FEHLER: $script gibt es nicht." >&2
    failed=$((failed + 1))
  elif ! output="$(bash -n -- "$script" 2>&1)"; then
    # Als GitHub-Hinweis an der Datei und im Klartext im Log.
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
      echo "::error file=$script::bash -n: Syntaxfehler in $script"
    fi
    echo "FEHLER: Syntaxfehler in $script" >&2
    printf '%s\n' "$output" >&2
    failed=$((failed + 1))
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "$failed von ${#scripts[@]} Shell-Dateien fehlerhaft." >&2
  exit 1
fi
echo "${#scripts[@]} Shell-Dateien einzeln mit bash -n geprüft, alle in Ordnung."
