#!/usr/bin/env python3
"""Liga-, Squad-, Match- und Map-Abläufe auf echtem MongoDB (#2200) - derselbe Aufruf in der CI und am eigenen Rechner.

Gewählt werden die Testdateien, die ``make_flow`` aus ``backend/tests/flow_harness.py`` nutzen und deren Name zum Gebiet
passt - neue Dateien laufen von selbst mit. Ohne ``FLOW_MONGO_URL`` bricht das Skript ab: Sonst liefen die Tests still auf
mongomock und meldeten trotzdem Grün.

    FLOW_MONGO_URL=mongodb://127.0.0.1:27217 python scripts/flow_mongo_tests.py -n 4
    python scripts/flow_mongo_tests.py --list

Alle weiteren Argumente gehen an pytest. Welche Adressen erlaubt sind, prüft ``backend/tests/flow_mongo.py``.
"""
from __future__ import annotations

import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TESTS = ROOT / "backend" / "tests"
# Zum Gebiet gehören auch die Abläufe rund ums Ergebnis, die Fristen und die Aufgaben, die nicht so heißen.
AREA = re.compile(r"league|squad|match|map|flow_harness|result_confirm|result_auto_confirm|result_contract|deadline_races"
                  r"|tournament_flows|dashboard_tasks|game_default_pool|platform_links|game_mode"
                  # Ausrüstung und Sperrliste (#2218): eindeutige Indizes und Versionen wie bei Maps und Pools.
                  r"|game_equipment|loadout"
                  # Unterkategorien (#2287): positionsgenaues Schreiben in den Kategorien des Spiels.
                  r"|equipment_subcategories")
USES_HARNESS = re.compile(r"\bmake_flow\b")


def selected_files(tests: pathlib.Path = TESTS) -> list[str]:
    """Testdateien des Gebiets, die wirklich über die Harness laufen - als Pfade ab dem Repo-Stamm, sortiert."""
    return sorted(
        path.relative_to(ROOT).as_posix() for path in tests.glob("test_*.py")
        if AREA.search(path.name) and USES_HARNESS.search(path.read_text(encoding="utf-8"))
    )


def main(arguments: list[str]) -> int:
    files = selected_files()
    if "--list" in arguments:
        print("\n".join(files))
        return 0
    if not os.environ.get("FLOW_MONGO_URL", "").strip():
        print("FLOW_MONGO_URL fehlt - ohne sie liefen die Tests auf mongomock. Siehe docs/entwicklung/abnahme-lokal.md.",
              file=sys.stderr)
        return 2
    return subprocess.run([sys.executable, "-m", "pytest", "-m", "not live", *files, *arguments], cwd=ROOT).returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
