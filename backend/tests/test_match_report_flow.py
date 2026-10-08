"""Ergebnis melden (#1132): online melden die Spieler selbst, die Gegenseite bestätigt.

Entscheidung des Betreibers (07.10.2026, Variante B): Online-Turniere ohne eigene Angabe lassen die Spieler melden;
vor Ort trägt die Turnierleitung ein. Nach der ersten Meldung bekommt die Gegenseite eine Nachricht; weichen zwei
Meldungen ab, erfährt die Turnierleitung mit Ergebnis-Recht für dieses Spiel davon - niemand sonst.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def bracket(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, first, second, player


def duel(winner: str, loser: str, winner_score=None, loser_score=None) -> dict:
    rows = [{"registration_id": winner, "rank": 1}, {"registration_id": loser, "rank": 2}]
    if winner_score is not None:
        rows[0]["score"], rows[1]["score"] = winner_score, loser_score
    return {"results": rows}


async def page(flow, match) -> dict:
    response = await flow.get(f"/api/matches/{match['id']}/page")
    assert response.status_code == 200, response.text
    return response.json()


async def notes(flow, kind: str) -> list[dict]:
    return await flow.db.notifications.find({"kind": kind}, {"_id": 0}).to_list(100)


@pytest.mark.asyncio
async def test_online_without_own_setting_players_see_the_form_on_site_and_staff_only_do_not(flow):
    _staff, _tournament, match, first, _second, player = await bracket(flow, result_entry_mode=None, event_mode="online")
    flow.act_as(player[first])
    data = await page(flow, match)
    assert data["result_entry_mode"] == "player_confirmed", "online ohne Angabe: Spieler melden selbst"
    assert data["can_player_report_result"] is True
    assert data["report_state"]["status"] == "open"
    assert data["allows_draw"] is False, "im K.-o.-Baum gibt es kein Unentschieden"

    for fields in ({"event_mode": "local", "result_entry_mode": None}, {"event_mode": "online", "result_entry_mode": "staff_only"}):
        _other_staff, _other_tournament, other_match, other_first, other_second, other_player = await bracket(flow, **fields)
        flow.act_as(other_player[other_first])
        data = await page(flow, other_match)
        assert data["can_player_report_result"] is False and data["report_state"] is None
        refused = await flow.post(f"/api/matches/{other_match['id']}/report", json=duel(other_first, other_second))
        assert refused.status_code == 403


@pytest.mark.asyncio
async def test_first_report_asks_the_other_side_and_confirming_decides_the_match(flow):
    _staff, tournament, match, first, second, player = await bracket(flow, result_entry_mode=None)
    flow.act_as(player[first])
    reported = await flow.post(f"/api/matches/{match['id']}/report", json={**duel(first, second, 2, 1), "note": "GG"})
    assert reported.status_code == 200, reported.text
    assert reported.json()["report_status"] == "waiting"

    asked = await notes(flow, "match_report")
    assert [row["user_id"] for row in asked] == [player[second]["id"]], "nur die Gegenseite - nicht der Melder, niemand sonst"
    assert asked[0]["title"] == "Ergebnis gemeldet – bitte bestätigen"
    assert "gewinnt 2:1." in asked[0]["body"]
    mails = await flow.db.mail_jobs.find({"template_key": "score_reported"}, {"_id": 0}).to_list(10)
    assert [mail["to"] for mail in mails] == [player[second]["email"]]

    mine = (await page(flow, match))["report_state"]
    assert mine["status"] == "waiting" and "2:1" in mine["own_summary"]

    flow.act_as(player[second])
    theirs = (await page(flow, match))["report_state"]
    assert theirs["status"] == "confirm"
    assert theirs["proposal"] == [{"registration_id": first, "rank": 1, "score": 2.0}, {"registration_id": second, "rank": 2, "score": 1.0}]
    assert "note" not in str(theirs), "die Notiz der Gegenseite bleibt bei ihr"
    confirmed = await flow.post(f"/api/matches/{match['id']}/report", json={"results": theirs["proposal"]})
    assert confirmed.status_code == 200, confirmed.text

    decided = await flow.reload(match)
    assert decided["status"] == "completed"
    assert [row["registration_id"] for row in decided["results"] if row["rank"] == 1] == [first]
    follow_up = await flow.match_for(tournament, first, after_round=match["round"])
    assert follow_up is not None, "der Sieger rückt weiter"
    alerts = await notes(flow, "match_attention")
    assert not alerts


@pytest.mark.asyncio
async def test_different_reports_alert_the_result_staff_of_this_match_only(flow):
    staff, tournament, match, first, second, player = await bracket(flow, result_entry_mode=None)
    scorekeeper = await flow.add_user(name="Ergebnisdienst")
    stream_helper = await flow.add_user(name="Stream")
    elsewhere = await flow.add_user(name="AndererTurnierHelfer")
    for user, role, tid in ((scorekeeper, "scorekeeper", tournament["id"]), (stream_helper, "stream_operator", tournament["id"]),
                            (elsewhere, "scorekeeper", "anderes-turnier")):
        await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": tid, "user_id": user["id"],
                                                               "role": role, "scope": "tournament", "is_active": True})

    flow.act_as(player[first])
    await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second, 2, 1))
    flow.act_as(player[second])
    # Gleicher Sieger, anderer Spielstand: das ist nicht „dasselbe“ - die Turnierleitung entscheidet.
    answer = await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second, 2, 0))
    assert answer.status_code == 200, answer.text
    assert answer.json()["report_status"] == "conflict"

    stored = await flow.reload(match)
    assert stored["status"] != "completed" and not stored.get("results")
    alerted = {row["user_id"] for row in await notes(flow, "match_attention")}
    assert alerted == {staff["id"], scorekeeper["id"]}, "Turnierleitung und Ergebnisdienst dieses Turniers - kein Stream-Helfer, kein fremdes Turnier"
    told = [row for row in await notes(flow, "match_report") if row["title"] == "Ergebnis in Klärung"]
    assert [row["user_id"] for row in told] == [player[first]["id"]], "die erste Seite erfährt, dass die Turnierleitung entscheidet"
    seen = await page(flow, match)
    assert seen["report_state"]["status"] == "conflict"


@pytest.mark.asyncio
async def test_no_reports_on_decided_or_contested_matches_and_broken_reports_are_refused(flow):
    _staff, _tournament, match, first, second, player = await bracket(flow, result_entry_mode=None)
    flow.act_as(player[first])
    incomplete = await flow.post(f"/api/matches/{match['id']}/report", json={"results": [{"registration_id": first, "rank": 1}]})
    assert incomplete.status_code == 422, "jede Meldung nennt alle Teilnehmer"
    stranger = await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, "fremd"))
    assert stranger.status_code == 422

    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "disputed"}})
    contested = await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second))
    assert contested.status_code == 409 and "Klärung" in contested.json()["detail"]
    seen = await page(flow, match)
    assert seen["can_player_report_result"] is False

    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"status": "completed"}})
    decided = await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second))
    assert decided.status_code == 409
