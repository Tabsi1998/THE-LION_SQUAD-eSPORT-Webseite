#!/usr/bin/env python3
"""Die Teile der Backend-Suite prüfen und ihre Dauern pflegen (#2054).

    python scripts/test-shards.py check  shard-1.json shard-2.json ...
        Nach dem CI-Lauf: Haben alle Teile dieselbe Sammlung gesehen, und lief jede Testdatei in genau einem Teil?
    python scripts/test-shards.py durations backend-junit-1.xml backend-junit-2.xml ... > backend/tests/shard-durations.json
        Sekunden je Testdatei aus den JUnit-Berichten der Teile (Artefakte "backend-test-results-*" eines CI-Laufs).

Die Teile schneidet backend/tests/shard_plan.py.
"""
from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ElementTree
from pathlib import Path


def check(paths: list[str]) -> int:
    reports = [json.loads(Path(path).read_text(encoding="utf-8")) for path in paths]
    problems: list[str] = []
    if not reports:
        problems.append("keine Teilberichte gefunden")
    else:
        total = reports[0]["total"]
        shards = sorted(report["shard"] for report in reports)
        if shards != list(range(1, total + 1)) or any(report["total"] != total for report in reports):
            problems.append(f"erwartet Teile 1..{total}, gefunden {shards}")
        if len({report["collection_sha256"] for report in reports}) != 1 or len({report["collected"] for report in reports}) != 1:
            problems.append("die Teile haben nicht dieselben Tests gesammelt")
        every_file = set(reports[0]["all_files"])
        seen: dict[str, int] = {}
        for report in reports:
            for name in report["files"]:
                if name in seen:
                    problems.append(f"{name} lief in Teil {seen[name]} und in Teil {report['shard']}")
                seen[name] = report["shard"]
        for name in sorted(every_file - set(seen)):
            problems.append(f"{name} lief in keinem Teil")
        selected = sum(report["selected"] for report in reports)
        if selected != reports[0]["collected"]:
            problems.append(f"{selected} Tests in den Teilen, aber {reports[0]['collected']} gesammelt")
        for report in sorted(reports, key=lambda item: item["shard"]):
            print(f"Teil {report['shard']}/{report['total']}: {report['selected']} Tests in {len(report['files'])} Dateien")
    for problem in problems:
        print(f"::error::{problem}")
    if not problems:
        print(f"Alle {reports[0]['collected']} Tests liefen in genau einem Teil.")
    return 1 if problems else 0


def durations(paths: list[str]) -> int:
    seconds: dict[str, float] = {}
    for path in paths:
        for case in ElementTree.parse(path).iter("testcase"):
            parts = case.get("classname", "").split(".")
            # backend.tests.test_datei[.TestKlasse] -> backend/tests/test_datei.py
            if parts[:2] != ["backend", "tests"] or len(parts) < 3:
                continue
            name = "/".join(parts[:3]) + ".py"
            seconds[name] = seconds.get(name, 0.0) + float(case.get("time") or 0)
    print(json.dumps({name: round(value, 1) for name, value in sorted(seconds.items())}, indent=1))
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "check":
        return check(argv[1:])
    if len(argv) >= 2 and argv[0] == "durations":
        return durations(argv[1:])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
