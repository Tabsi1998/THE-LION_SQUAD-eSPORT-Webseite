"""Vorfälle im Spiel - die Ableitungen ohne Datenbank (docs/LIGA.md, „D.5/E.2-Vertrag“ → „Vorfälle“, #1619). Erfundene Namen."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from services import league_incidents as incidents  # noqa: E402

A, B = "loewen", "falken"


def game(position: int, winner: str, **extra) -> dict:
    return {"position": position, "mode": "stellung", "map_id": f"map-{position}", "winner_registration_id": winner,
            "scores": {A: 6, B: 3}, **extra}


def entry(state: str, position: int = 2, **extra) -> dict:
    return {"id": f"vorfall-{position}-{state}", "position": position, "kind": "disconnect", "state": state, "proposal": "replay",
            "reported_by": {"registration_id": A, "user_id": "u1"}, **extra}


def decided(outcome: str, position: int = 2, **decision) -> dict:
    return entry("decided", position, decision={"outcome": outcome, "settled_at": "2026-11-11T20:00:00+00:00", **decision})


def test_map_state_is_derived_from_incidents_and_games():
    match = {"incidents": [entry("in_review", 3)],
             "games": [game(1, A), game(2, B, status="replayed"), game(3, A, decision="awarded")]}
    assert [row["state"] for row in incidents.map_states(match, 5)] == ["played", "replayed", "in_clarification", "open", "open"]
    # Gegenprobe: Ohne den offenen Vorfall zählt, was in games steht.
    assert [row["state"] for row in incidents.map_states({**match, "incidents": []}, 3)] == ["played", "replayed", "awarded"]
    assert incidents.positions_in_clarification(match) == [3]
    assert incidents.positions_in_clarification({"incidents": [entry("proposed", 3)]}) == [], "erst ohne Einigung ist die Map in Klärung"


@pytest.mark.parametrize("rows,code", [
    ([], None),
    ([entry("agreed"), entry("withdrawn", 1)], None),
    ([entry("proposed")], "proposed"),
    ([entry("in_review"), entry("proposed", 1)], "in_review"),
    ([entry("decided", decision={"outcome": "no_action", "settled_at": None})], "unsettled"),
    ([decided("replay", missing_positions=[3])], "missing"),
    ([decided("no_action", missing_positions=[], surplus_positions=[3])], None),
])
def test_what_holds_a_result(rows, code):
    hold = incidents.result_block({"incidents": rows})
    assert (hold or {}).get("code") == code


def test_a_replay_marks_the_one_valid_game():
    match = {"incidents": [entry("agreed")]}
    final = incidents.final_games(match, [game(1, A), game(2, A)], sides=[A, B], needed=2)
    assert [row["position"] for row in final] == [1, 2] and "status" not in final[0]
    assert final[1]["status"] == "replayed" and final[1]["incident_id"] == "vorfall-2-agreed" and final[1]["replay_reason"]
    # Ein eigener Grund der Seiten bleibt stehen; ohne Wirkung (zurückgezogen, fortgesetzt) bleibt die Map, wie sie ist.
    own = incidents.final_games(match, [game(1, A), game(2, A, status="replayed", replay_reason="Server abgestürzt")], sides=[A, B], needed=2)
    assert own[1]["replay_reason"] == "Server abgestürzt"
    for row in (entry("withdrawn"), entry("agreed", proposal="continue_at_score"), entry("in_review")):
        untouched = incidents.final_games({"incidents": [row]}, [game(1, A), game(2, A)], sides=[A, B], needed=2)
        assert all("incident_id" not in item for item in untouched), row["state"]


def test_an_award_sets_the_winner_and_later_maps_do_not_count():
    match = {"incidents": [decided("awarded", registration_id=A, surplus_positions=[3])]}
    final = incidents.final_games(match, [game(1, A), game(2, B), game(3, A)], sides=[A, B], needed=2)
    assert [(row["position"], row["winner_registration_id"]) for row in final] == [(1, A), (2, A)]
    assert final[1]["decision"] == "awarded" and final[1]["scores"] == {}
    # Auch ohne Vermerk zählt keine Map nach der Entscheidung der Serie.
    unmarked = {"incidents": [decided("awarded", registration_id=A)]}
    assert len(incidents.final_games(unmarked, [game(1, A), game(2, B), game(3, A)], sides=[A, B], needed=2)) == 2
    # Eine spätere Entscheidung zur selben Map hebt „zugesprochen“ auf.
    later = {"incidents": [decided("awarded", registration_id=A), {**decided("no_action"), "id": "spaeter"}]}
    kept = incidents.final_games(later, [game(1, A), game(2, B), game(3, A)], sides=[A, B], needed=2)
    assert [row["winner_registration_id"] for row in kept] == [A, B, A]


def test_a_result_that_no_longer_fits_goes_to_the_lead():
    # Zugesprochen an die Falken: 1:1 nach zwei Maps, Map 3 fehlt in der Meldung - die Serie hat keinen Sieger.
    match = {"incidents": [decided("awarded", registration_id=B)]}
    with pytest.raises(incidents.IncidentProblem) as refused:
        incidents.final_games(match, [game(1, A), game(2, A)], sides=[A, B], needed=2)
    assert refused.value.status_code == 409 and "trägt die Liga-Leitung ein" in refused.value.detail
    # Eine nicht zählende Map mitten in der Serie ließe eine Lücke.
    gap = {"incidents": [decided("no_action", surplus_positions=[2])]}
    with pytest.raises(incidents.IncidentProblem):
        incidents.final_games(gap, [game(1, A), game(2, B), game(3, A)], sides=[A, B], needed=2)


def test_the_lead_keeps_winners_and_gets_the_marks():
    match = {"incidents": [entry("agreed"), decided("awarded", 3, registration_id=B)]}
    games = [game(1, A), game(2, B), game(3, B, decision="awarded", scores={})]
    marked = incidents.mark_replays(match, games)
    assert [row["winner_registration_id"] for row in marked] == [A, B, B]
    assert marked[1]["status"] == "replayed" and marked[1]["incident_id"] == "vorfall-2-agreed"
    assert marked[2]["incident_id"] == "vorfall-3-decided" and "status" not in marked[2]
    assert incidents.mark_replays(match, None) is None and incidents.mark_replays({}, games) == games


def test_quota_counts_only_own_agreed_or_decided_rehosts_and_pauses():
    rows = [
        entry("agreed", kind="rehost", counts_quota=True),
        entry("decided", kind="pause", counts_quota=True, decision={"outcome": "no_action"}),
        entry("proposed", kind="rehost", counts_quota=True),
        entry("withdrawn", kind="rehost", counts_quota=True),
        entry("agreed", kind="moss_crash", counts_quota=False),
        {**entry("agreed", 1, kind="pause", counts_quota=True), "reported_by": {"registration_id": B, "user_id": "u2"}},
    ]
    assert incidents.quota_used({"incidents": rows}) == {A: {2: 2}, B: {1: 1}}
    assert incidents.counts_quota("rehost", False) and incidents.counts_quota("pause", False)
    assert not incidents.counts_quota("pause", True), "die Map-Pause wird nur dokumentiert"
    assert not incidents.counts_quota("moss_crash", False), "der MOSS-Absturz zählt nie"
    assert not any(incidents.counts_quota(kind, False) for kind in ("disconnect", "restart_early", "replay", "other"))


def test_the_public_staffel_page_only_says_in_clarification():
    from services.league_page import public_match

    slots = [{"slot": 1, "registration_id": A}, {"slot": 2, "registration_id": B}]
    open_match = {"id": "m1", "status": "in_progress", "slots": slots, "incidents": [entry("in_review", note="geheim")]}
    shown = public_match(open_match, {})
    assert shown["in_clarification"] is True and "incidents" not in shown and "geheim" not in str(shown)
    # Gegenprobe: ein Vorfall, der nur auf Antwort wartet oder abgeschlossen ist, macht die Map nicht „in Klärung“.
    for state in ("proposed", "agreed", "withdrawn"):
        assert public_match({**open_match, "incidents": [entry(state)]}, {})["in_clarification"] is False, state
    assert public_match({**open_match, "incidents": []}, {})["in_clarification"] is False


def test_pause_series_only_refuses_later_positions():
    match = {"incidents": [entry("in_review", 2)]}
    assert "Map 3" in incidents.report_refusal(match, "pause_series", [1, 2, 3])
    assert incidents.report_refusal(match, "pause_series", [1, 2]) is None
    assert incidents.report_refusal(match, "continue", [1, 2, 3]) is None
    assert incidents.report_refusal({"incidents": [entry("proposed", 2)]}, "pause_series", [1, 2, 3]) is None
