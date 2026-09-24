import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.match_routes import _match_policy, _players_can_report, _schedule_proposals_enabled

# Seit #231 gibt es nur noch den Graph-Speicher: ohne Vorgabe trägt die Turnierleitung die Ergebnisse ein,
# egal ob online oder vor Ort; wer Spieler melden lassen will, sagt es am Turnier oder an der Stage.


def test_local_matches_default_to_staff_only_and_fixed_schedule():
    policy = _match_policy({"id": "m1"}, {"id": "t1", "event_mode": "local"})

    assert policy["event_mode"] == "local"
    assert policy["result_entry_mode"] == "staff_only"
    assert policy["schedule_mode"] == "fixed_by_staff"
    assert not _players_can_report(policy)
    assert not _schedule_proposals_enabled(policy)


def test_online_matches_default_to_staff_result_entry_and_player_schedule():
    policy = _match_policy({"id": "m1"}, {"id": "t1", "event_mode": "online"})

    assert policy["event_mode"] == "online"
    assert policy["result_entry_mode"] == "staff_only"
    assert policy["schedule_mode"] == "player_proposal"
    assert not _players_can_report(policy)
    assert _schedule_proposals_enabled(policy)


def test_tournament_can_let_players_report():
    policy = _match_policy({"id": "m1"}, {"id": "t1", "event_mode": "online", "result_entry_mode": "player_confirmed"})

    assert policy["result_entry_mode"] == "player_confirmed"
    assert _players_can_report(policy)


def test_stage_settings_override_tournament_policy():
    policy = _match_policy(
        {"id": "m1"},
        {"id": "t1", "event_mode": "local", "result_entry_mode": "staff_only", "schedule_mode": "fixed_by_staff"},
        {"id": "s1", "settings": {"event_mode": "hybrid", "result_entry_mode": "hybrid", "schedule_mode": "hybrid"}},
    )

    assert policy["event_mode"] == "hybrid"
    assert policy["result_entry_mode"] == "hybrid"
    assert policy["schedule_mode"] == "hybrid"
    assert _players_can_report(policy)
    assert _schedule_proposals_enabled(policy)
