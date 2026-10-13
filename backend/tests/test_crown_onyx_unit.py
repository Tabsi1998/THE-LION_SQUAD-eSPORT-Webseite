"""Kronen (#1458): ab Level 30 trägt man die Onyx-Krone - „Obsidian“ ist seit dem Löwen-Rang der Name von Rang 10.
Gold, Silber und Bronze gehen an die besten drei ohne Onyx-Krone."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services.crown_events import ONYX_FLOOR, _split_crowns  # noqa: E402


def test_onyx_crown_for_level_30_and_podium_for_the_rest():
    rows = [
        {"user_id": "a", "points": ONYX_FLOOR + 10},
        {"user_id": "b", "points": ONYX_FLOOR - 1},
        {"user_id": "c", "points": 500},
        {"user_id": "d", "points": 300},
        {"user_id": "e", "points": 100},
    ]
    merged, rank_only = _split_crowns(rows)
    assert merged == {"a": "onyx", "b": "gold", "c": "silver", "d": "bronze"}
    assert rank_only == {"b": "gold", "c": "silver", "d": "bronze"}
    assert "obsidian" not in merged.values()
