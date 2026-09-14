#!/usr/bin/env python3
"""Ordnet geänderte Dateien den CI-Jobs zu.

GitHub-CI und der lokale CI-Spiegel benutzen dieselben Regeln. Im Zweifel läuft
ein Job lieber einmal zu viel: ein Pfad, den keine Regel kennt, löst alle Jobs aus.
Der Geheimnis-Scan hängt nicht davon ab, er läuft bei jeder Änderung.

Ausgabe auf stdout im Format von $GITHUB_OUTPUT (backend=true ...),
eine lesbare Zusammenfassung auf stderr.

  ci-changed-areas.py --base <sha> --head <sha>   Pull Request auf GitHub
  ci-changed-areas.py --local [--base origin/main] Commits plus nicht committete Änderungen
  ci-changed-areas.py --all                        alle Jobs (manueller Lauf)
"""
from __future__ import annotations

import argparse
import subprocess
import sys

AREAS = ("backend", "frontend", "mobile", "container")

# Dateien, die keinen Job brauchen. Der Geheimnis-Scan läuft trotzdem.
NO_JOB = {".gitignore", "LICENSE", ".editorconfig"}


def areas_for(path: str) -> set[str]:
    name = path.rsplit("/", 1)[-1]
    if path.startswith(".github/") or path == "scripts/ci-changed-areas.py":
        return set(AREAS)
    if path in NO_JOB:
        return set()
    if path.endswith(".md"):
        return {"backend"}  # Linkprüfung der Dokumentation

    hits: set[str] = set()
    compose = name.startswith("docker-compose") and name.endswith((".yml", ".yaml"))
    env_example = name in {".env.example", ".env.staging.example"}

    if path.startswith(("backend/", "scripts/")) or path in {"install.sh", "update.sh", "frontend/nginx.conf", ".flake8"}:
        hits.add("backend")
    if (path.startswith("frontend/") or compose or env_example
            or path in {"scripts/check-public-routes.sh", "scripts/compose-backup-target.py"}):
        hits.add("frontend")
    if path.startswith("mobile/"):
        hits.add("mobile")
    if (path.startswith(("backend/", "frontend/")) or compose or env_example
            or name.startswith("Dockerfile") or name == ".dockerignore"
            or path in {"scripts/staging-preflight.py", "scripts/check-web-update.py"}):
        hits.add("container")
    return hits or set(AREAS)


def git_lines(*args: str) -> list[str]:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=True)
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def changed_files(args: argparse.Namespace) -> list[str]:
    if args.local:
        files = set(git_lines("diff", "--name-only", f"{args.base}...HEAD"))
        files |= set(git_lines("diff", "--name-only", "HEAD"))
        files |= set(git_lines("ls-files", "--others", "--exclude-standard"))
        return sorted(files)
    return git_lines("diff", "--name-only", f"{args.base}...{args.head}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Welche CI-Jobs braucht dieser Änderungsstand?")
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--local", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    if args.all:
        needed, files = set(AREAS), []
    else:
        try:
            files = changed_files(args)
        except subprocess.CalledProcessError as error:
            print(f"Änderungen nicht ermittelbar ({error.stderr.strip()}); alle Jobs laufen.", file=sys.stderr)
            needed, files = set(AREAS), []
        else:
            needed = set().union(*(areas_for(path) for path in files)) if files else set()

    for area in AREAS:
        print(f"{area}={'true' if area in needed else 'false'}")
    print(f"{len(files)} geänderte Datei(en) -> Jobs: {', '.join(a for a in AREAS if a in needed) or 'keine'}",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
