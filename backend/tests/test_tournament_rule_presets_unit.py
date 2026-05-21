import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.tournament_routes import _planning_report


def _warning_types(report):
    return {row.get("type") for row in report.get("warnings", [])}


def test_local_tournament_with_player_flows_warns_admin():
    report = _planning_report([], {
        "event_mode": "local",
        "result_entry_mode": "player_confirmed",
        "schedule_mode": "player_proposal",
    })

    assert "rule_mode_conflict" in _warning_types(report)
    assert report["warning_count"] == 2


def test_local_staff_only_preset_has_no_rule_warning():
    report = _planning_report([], {
        "event_mode": "local",
        "result_entry_mode": "staff_only",
        "schedule_mode": "fixed_by_staff",
    })

    assert "rule_mode_conflict" not in _warning_types(report)
    assert report["warning_count"] == 0


def test_online_staff_only_warns_that_players_cannot_report():
    report = _planning_report([], {
        "event_mode": "online",
        "result_entry_mode": "staff_only",
        "schedule_mode": "player_proposal",
    })

    assert "rule_mode_conflict" in _warning_types(report)
    assert report["warning_count"] == 1
