import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.season_service import _summarise_point_entries


def test_summarise_point_entries_groups_sources_and_drops_worst():
    summary = _summarise_point_entries([
        {"id": "a", "source_type": "tournament", "total_points": 100, "raw_points": 100, "bonus_points": 0, "rank": 1},
        {"id": "b", "source_type": "fastlap", "total_points": 40, "raw_points": 80, "bonus_points": 10, "rank": 4, "farming_capped": True},
        {"id": "c", "source_type": "event", "total_points": 10, "raw_points": 10, "bonus_points": 0, "rank": None},
    ], drop_worst=1)

    assert summary["dropped_events"] == 1
    assert summary["dropped_points"] == 10.0
    assert summary["source_breakdown"][0]["source_type"] == "tournament"
    assert summary["source_breakdown"][0]["total_points"] == 100.0
    assert summary["source_breakdown"][0]["wins"] == 1
    assert summary["source_breakdown"][1]["source_type"] == "fastlap"
    assert summary["source_breakdown"][1]["farming_capped_entries"] == 1
