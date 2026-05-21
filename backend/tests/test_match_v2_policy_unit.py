import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.match_v2_routes import _match_policy, _schedule_proposals_enabled


def test_v2_local_matches_default_to_staff_fixed_schedule():
    policy = _match_policy({"id": "m1"}, {"id": "t1", "event_mode": "local"}, None)

    assert policy["event_mode"] == "local"
    assert policy["result_entry_mode"] == "staff_only"
    assert policy["schedule_mode"] == "fixed_by_staff"
    assert not _schedule_proposals_enabled(policy)


def test_v2_online_matches_keep_player_schedule_by_default():
    policy = _match_policy({"id": "m1"}, {"id": "t1", "event_mode": "online"}, None)

    assert policy["event_mode"] == "online"
    assert policy["result_entry_mode"] == "staff_only"
    assert policy["schedule_mode"] == "player_proposal"
    assert _schedule_proposals_enabled(policy)


def test_v2_stage_settings_override_tournament_policy():
    policy = _match_policy(
        {"id": "m1"},
        {"id": "t1", "event_mode": "local", "schedule_mode": "fixed_by_staff"},
        {"id": "s1", "settings": {"event_mode": "hybrid", "schedule_mode": "hybrid"}},
    )

    assert policy["event_mode"] == "hybrid"
    assert policy["schedule_mode"] == "hybrid"
    assert _schedule_proposals_enabled(policy)
