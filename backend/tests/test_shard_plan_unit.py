"""Die CI schneidet die Backend-Suite in Teile (#2054): jede Datei genau einmal, gleich lange Teile, und die
Gegenprobe nach dem Lauf erkennt eine fehlende oder doppelte Datei."""

import importlib.util
import json
from pathlib import Path

import pytest
import shard_plan

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location(
    "test_shards_script", ROOT / "scripts" / "test-shards.py"
)
test_shards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(test_shards)

COUNTS = {"a.py": 10, "b.py": 4, "c.py": 30, "d.py": 1, "e.py": 7, "neu.py": 5}
DURATIONS = {"a.py": 100.0, "b.py": 20.0, "c.py": 60.0, "d.py": 50.0, "e.py": 5.0}


@pytest.mark.parametrize("total", [1, 2, 3, 4, 8])
def test_every_file_lands_in_exactly_one_shard(total):
    shards = shard_plan.plan(COUNTS, total, DURATIONS)
    placed = [name for shard in shards for name in shard]
    assert sorted(placed) == sorted(COUNTS)
    assert len(shards) == total


def test_the_plan_is_balanced_and_deterministic():
    shards = shard_plan.plan(COUNTS, 2, DURATIONS)
    assert shards == shard_plan.plan(dict(reversed(list(COUNTS.items()))), 2, DURATIONS)
    # neu.py ohne Messwert: 5 Tests mal (235 s / 52 Tests).
    estimate = {**DURATIONS, "neu.py": 5 * 235 / 52}
    loads = [sum(estimate[name] for name in shard) for shard in shards]
    assert abs(loads[0] - loads[1]) <= max(estimate.values())


@pytest.mark.parametrize("value", ["", "0/3", "4/3", "eins/zwei", "1-3"])
def test_a_wrong_shard_value_stops_the_run(value):
    with pytest.raises(pytest.UsageError):
        shard_plan.parse_shard(value)


def _reports(tmp_path, shards):
    every = sorted({name for files in shards for name in files})
    paths = []
    for index, files in enumerate(shards, start=1):
        path = tmp_path / f"shard-{index}.json"
        path.write_text(
            json.dumps(
                {
                    "shard": index,
                    "total": len(shards),
                    "collected": 3,
                    "collection_sha256": "x",
                    "selected": len(files),
                    "files": files,
                    "all_files": every,
                }
            ),
            encoding="utf-8",
        )
        paths.append(str(path))
    return paths


def test_the_check_passes_a_clean_split(tmp_path, capsys):
    assert test_shards.check(_reports(tmp_path, [["a.py", "b.py"], ["c.py"]])) == 0
    assert "Alle 3 Tests liefen in genau einem Teil" in capsys.readouterr().out


def test_the_check_finds_a_file_in_two_shards(tmp_path, capsys):
    assert test_shards.check(_reports(tmp_path, [["a.py", "b.py"], ["b.py"]])) == 1
    assert "b.py lief in Teil 1 und in Teil 2" in capsys.readouterr().out


def test_the_check_finds_a_missing_shard(tmp_path, capsys):
    paths = _reports(tmp_path, [["a.py"], ["b.py"], ["c.py"]])
    assert test_shards.check(paths[:2]) == 1
    assert "erwartet Teile 1..3" in capsys.readouterr().out
