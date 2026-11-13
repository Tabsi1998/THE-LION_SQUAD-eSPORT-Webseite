#!/usr/bin/env python3
"""Liga-, Squad-, Match- und Map-Abläufe auf echtem MongoDB (#2200) - derselbe Aufruf in der CI und am eigenen Rechner.

Gewählt werden die Testdateien, die ``make_flow`` aus ``backend/tests/flow_harness.py`` nutzen und deren Name zum Gebiet
passt - neue Dateien laufen von selbst mit. Ohne ``FLOW_MONGO_URL`` bricht das Skript ab: Sonst liefen die Tests still auf
mongomock und meldeten trotzdem Grün.

    FLOW_MONGO_URL=mongodb://127.0.0.1:27217 python scripts/flow_mongo_tests.py -n 4
    FLOW_MONGO_URL=mongodb://127.0.0.1:27217 python scripts/flow_mongo_tests.py --all --chunk 60 -n 4
    python scripts/flow_mongo_tests.py --list [--all]

``--all`` nimmt jede Datei, die ``make_flow`` nutzt, nicht nur das Gebiet (#2216) - für einen Lauf außerhalb des CI-Budgets
(über 500 Dateien, lokal rund 21 Minuten mit ``-n 4``). Viele Dateien in einem Aufruf sammeln sehr langsam; ``--chunk N``
teilt sie in Aufrufe zu N Dateien. Rot ist der Lauf, sobald ein Aufruf rot ist.

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
                  r"|equipment_subcategories"
                  # Einladung durch die Verwaltung (#932): zwei Protokollzeilen unter dem eindeutigen Index audit_logs.id.
                  r"|admin_user_invite")
USES_HARNESS = re.compile(r"\bmake_flow\b")


def selected_files(tests: pathlib.Path = TESTS, *, everything: bool = False) -> list[str]:
    """Testdateien des Gebiets (mit ``everything`` alle), die wirklich über die Harness laufen - als Pfade ab dem
    Repo-Stamm, sortiert."""
    return sorted(
        path.relative_to(ROOT).as_posix() for path in tests.glob("test_*.py")
        if (everything or AREA.search(path.name)) and USES_HARNESS.search(path.read_text(encoding="utf-8"))
    )


def split_options(arguments: list[str]) -> tuple[bool, int, list[str]]:
    """``--all`` und ``--chunk N`` herausnehmen, den Rest für pytest lassen. Größe 0: ein Aufruf für alle Dateien."""
    everything, size, rest, index = False, 0, [], 0
    while index < len(arguments):
        argument = arguments[index]
        if argument == "--all":
            everything = True
        elif argument == "--chunk" and index + 1 < len(arguments):
            size = max(0, int(arguments[index + 1]))
            index += 1
        else:
            rest.append(argument)
        index += 1
    return everything, size, rest


def chunks(files: list[str], size: int) -> list[list[str]]:
    return [files[start:start + size] for start in range(0, len(files), size)] if size > 0 else [files]


def main(arguments: list[str]) -> int:
    everything, size, arguments = split_options(arguments)
    files = selected_files(everything=everything)
    if "--list" in arguments:
        print("\n".join(files))
        return 0
    if not os.environ.get("FLOW_MONGO_URL", "").strip():
        print("FLOW_MONGO_URL fehlt - ohne sie liefen die Tests auf mongomock. Siehe docs/entwicklung/abnahme-lokal.md.",
              file=sys.stderr)
        return 2
    failed = 0
    for part in chunks(files, size):
        result = subprocess.run([sys.executable, "-m", "pytest", "-m", "not live", *part, *arguments], cwd=ROOT)
        failed = failed or result.returncode
    return failed


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
