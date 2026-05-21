import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.match_routes import _match_policy, _players_can_report, _schedule_proposals_enabled


def test_legacy_local_matches_default_to_staff_only_and_fixed_schedule():
    policy = _match_policy({"id": "m1"}, "matches", {"id": "t1", "event_mode": "local"})

    assert policy["event_mode"] == "local"
    assert policy["result_entry_mode"] == "staff_only"
    assert policy["schedule_mode"] == "fixed_by_staff"
    assert not _players_can_report(policy)
    assert not _schedule_proposals_enabled(policy)


def test_legacy_online_matches_default_to_player_confirmed_and_player_schedule():
    policy = _match_policy({"id": "m1"}, "matches", {"id": "t1", "event_mode": "online"})

    assert policy["event_mode"] == "online"
    assert policy["result_entry_mode"] == "player_confirmed"
    assert policy["schedule_mode"] == "player_proposal"
    assert _players_can_report(policy)
    assert _schedule_proposals_enabled(policy)


def test_legacy_stage_settings_override_tournament_policy():
    policy = _match_policy(
        {"id": "m1"},
        "matches",
        {"id": "t1", "event_mode": "local", "result_entry_mode": "staff_only", "schedule_mode": "fixed_by_staff"},
        {"id": "s1", "settings": {"event_mode": "hybrid", "result_entry_mode": "hybrid", "schedule_mode": "hybrid"}},
    )

    assert policy["event_mode"] == "hybrid"
    assert policy["result_entry_mode"] == "hybrid"
    assert policy["schedule_mode"] == "hybrid"
    assert _players_can_report(policy)
    assert _schedule_proposals_enabled(policy)


def test_legacy_v2_collection_defaults_to_staff_result_entry():
    policy = _match_policy({"id": "m1"}, "matches_v2", {"id": "t1", "event_mode": "online"})

    assert policy["event_mode"] == "online"
    assert policy["result_entry_mode"] == "staff_only"
    assert policy["schedule_mode"] == "player_proposal"
    assert not _players_can_report(policy)
    assert _schedule_proposals_enabled(policy)
