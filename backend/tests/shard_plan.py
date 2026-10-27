"""Die Backend-Suite in gleich lange Teile schneiden (#2054).

Die CI lässt die Suite in mehreren Teilen gleichzeitig laufen (``TEST_SHARD=2/3``). Jede Testdatei bleibt ganz in
einem Teil; verteilt wird nach der gemessenen Dauer je Datei (``shard-durations.json``), die längsten zuerst auf den
Teil mit der wenigsten Arbeit. Neue Dateien ohne Messwert zählen mit der mittleren Dauer je Test. Jeder Teil rechnet
denselben Plan aus derselben Sammlung, so läuft jede Datei in genau einem Teil; ``scripts/check-test-shards.py``
prüft das nach dem Lauf anhand der Berichte, die hier geschrieben werden (``TEST_SHARD_REPORT``).

Ohne ``TEST_SHARD`` ändert sich nichts: lokal läuft wie bisher die ganze Suite.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

import pytest

DURATIONS_FILE = Path(__file__).with_name("shard-durations.json")


def parse_shard(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*/\s*(\d+)\s*", value or "")
    if not match or not 1 <= int(match.group(1)) <= int(match.group(2)):
        raise pytest.UsageError(f'TEST_SHARD als "n/gesamt" angeben, nicht "{value}"')
    return int(match.group(1)), int(match.group(2))


def plan(
    counts: dict[str, int], total: int, durations: dict[str, float]
) -> list[list[str]]:
    """Dateien (mit ihrer Testzahl) auf ``total`` Teile verteilen, die längsten zuerst auf den freiesten Teil."""
    known = [name for name in counts if isinstance(durations.get(name), (int, float))]
    known_tests = sum(counts[name] for name in known)
    per_test = (
        sum(durations[name] for name in known) / known_tests if known_tests else 1.0
    )

    def estimate(name: str) -> float:
        value = durations.get(name)
        return (
            float(value) if isinstance(value, (int, float)) else counts[name] * per_test
        )

    loads = [0.0] * total
    shards: list[list[str]] = [[] for _ in range(total)]
    for name in sorted(counts, key=lambda name: (-estimate(name), name)):
        target = min(range(total), key=lambda index: (loads[index], index))
        loads[target] += estimate(name)
        shards[target].append(name)
    return shards


class ShardPlugin:
    def __init__(self, current: int, total: int, report: str | None):
        self.current = current
        self.total = total
        self.report = report

    # Nach allen anderen: erst wenn "-m 'not live'" & Co. ausgewählt haben, wird geschnitten.
    @pytest.hookimpl(trylast=True)
    def pytest_collection_modifyitems(self, config, items):
        def name(item) -> str:
            return item.path.relative_to(config.rootpath).as_posix()

        counts: dict[str, int] = {}
        for item in items:
            counts[name(item)] = counts.get(name(item), 0) + 1
        durations = (
            json.loads(DURATIONS_FILE.read_text(encoding="utf-8"))
            if DURATIONS_FILE.is_file()
            else {}
        )
        mine = set(plan(counts, self.total, durations)[self.current - 1])

        selected = [item for item in items if name(item) in mine]
        deselected = [item for item in items if name(item) not in mine]
        if deselected:
            config.hook.pytest_deselected(items=deselected)
        items[:] = selected

        # Mit pytest-xdist sammelt jeder Worker selbst; der Bericht kommt einmal (vom ersten Worker oder ohne xdist).
        if self.report and os.environ.get("PYTEST_XDIST_WORKER", "gw0") == "gw0":
            every_id = sorted(item.nodeid for item in selected + deselected)
            Path(self.report).parent.mkdir(parents=True, exist_ok=True)
            Path(self.report).write_text(
                json.dumps(
                    {
                        "shard": self.current,
                        "total": self.total,
                        "collected": len(every_id),
                        "collection_sha256": hashlib.sha256(
                            "\n".join(every_id).encode()
                        ).hexdigest(),
                        "selected": len(selected),
                        "files": sorted(mine),
                        "all_files": sorted(counts),
                    },
                    indent=1,
                )
                + "\n",
                encoding="utf-8",
            )


def configure(config) -> None:
    value = os.environ.get("TEST_SHARD", "").strip()
    if value:
        current, total = parse_shard(value)
        config.pluginmanager.register(
            ShardPlugin(current, total, os.environ.get("TEST_SHARD_REPORT")),
            "tls-shard",
        )
