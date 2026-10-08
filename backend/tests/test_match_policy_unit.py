import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.match_routes import _match_policy, _players_can_report, _schedule_proposals_enabled

# Ohne Vorgabe (Entscheidung B zu #1132): online und hybrid melden die Spieler selbst, die Gegenseite bestätigt;
# vor Ort trägt die Turnierleitung ein. Eine Angabe am Spiel geht vor der Phase, die vor dem Turnier.


def test_local_matches_default_to_staff_only_and_fixed_schedule():
    policy = _match_policy({"id": "m1"}, {"id": "t1", "event_mode": "local"})

    assert policy["event_mode"] == "local"
    assert policy["result_entry_mode"] == "staff_only"
    assert policy["schedule_mode"] == "fixed_by_staff"
    assert not _players_can_report(policy)
    assert not _schedule_proposals_enabled(policy)


def test_online_matches_default_to_player_reports_and_player_schedule():
    policy = _match_policy({"id": "m1"}, {"id": "t1", "event_mode": "online"})

    assert policy["event_mode"] == "online"
    assert policy["result_entry_mode"] == "player_confirmed"
    assert policy["schedule_mode"] == "player_proposal"
    assert _players_can_report(policy)
    assert _schedule_proposals_enabled(policy)


def test_admin_list_planning_warning_and_server_compute_the_same_default():
    """„Automatisch passend“: dieselbe Antwort im Admin (effectiveRuleModes), in der Planung und am Server."""
    from routes.tournament_common import _planning_report
    from services.tournament_rules import tournament_modes

    for tournament in ({"event_mode": "online"}, {"event_mode": "hybrid"}, {"event_mode": "local"}, {"is_online": True}, {}):
        policy = _match_policy({"id": "m1"}, tournament)
        assert tournament_modes(tournament) == policy
        assert _planning_report([], tournament)["rule_policy"] == policy
    # Eine Vor-Ort-Halle ohne eigene Angabe bleibt online, wie im Admin - der Ort allein macht kein Vor-Ort-Turnier.
    assert _match_policy({"id": "m1"}, {"location": "Vereinsheim"})["event_mode"] == "online"
    warnings = _planning_report([], {"event_mode": "online", "result_entry_mode": "staff_only"})["warnings"]
    assert any("Online-Turnier ist auf Staff-Erfassung gesetzt" in row["message"] for row in warnings)
    assert not _planning_report([], {"event_mode": "online"})["warnings"], "ohne Angabe melden online die Spieler - keine Warnung"


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
