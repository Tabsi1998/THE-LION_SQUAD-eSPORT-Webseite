"""Dispute (#1134): jeder Teilnehmer darf in jedem Modus widersprechen, die Turnierleitung erfährt sofort davon.

Entscheidung des Betreibers (07.10.2026): auch gegen ein von der Turnierleitung eingetragenes Ergebnis - bis 30
Minuten nach dem Ergebnis oder bis das nächste Spiel des Siegers beginnt, was zuerst kommt. Nachricht an die
Turnierleitung mit Ergebnis-Recht für dieses Spiel und an die anderen Spieler, an niemanden sonst. Ist der Dispute
entschieden, sagt die Nachricht das.
"""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.match_notifications import notify_dispute_opened, notify_match_result_confirmed  # noqa: E402
from services.match_overview import operational_match_overviews, own_match_overviews  # noqa: E402


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
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    match = matches[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, first, second, player


def ranking(winner: str, loser: str, score=(2, 0)) -> dict:
    return {"results": [{"registration_id": winner, "rank": 1, "score": score[0]}, {"registration_id": loser, "rank": 2, "score": score[1]}]}


async def page(flow, match) -> dict:
    response = await flow.get(f"/api/matches/{match['id']}/page")
    assert response.status_code == 200, response.text
    return response.json()


async def kinds(flow, kind: str) -> list[dict]:
    return await flow.db.notifications.find({"kind": kind}, {"_id": 0}).to_list(100)


@pytest.mark.asyncio
async def test_a_participant_disputes_in_staff_only_mode_and_staff_hears_at_once(flow):
    staff, tournament, match, first, second, player = await bracket(flow, result_entry_mode="staff_only")
    scorekeeper = await flow.add_user(name="Ergebnisdienst")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": scorekeeper["id"],
                                                           "role": "scorekeeper", "scope": "tournament", "is_active": True})
    outsider = await flow.add_user(name="Unbeteiligt")

    flow.act_as(player[first])
    data = await page(flow, match)
    assert data["result_entry_mode"] == "staff_only" and data["can_dispute"] is True, "Dispute in jedem Modus"
    assert data["dispute_until"] is None, "vor dem Ergebnis ohne Frist"
    empty = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "   "})
    assert empty.status_code == 422
    opened = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Gegner hat mit falschem Fahrer gespielt"})
    assert opened.status_code == 200, opened.text
    contested = await flow.reload(match)
    assert contested["status"] == "disputed"

    alerts = await kinds(flow, "match_attention")
    assert {row["user_id"] for row in alerts} == {staff["id"], scorekeeper["id"]}
    assert "falschem Fahrer" in alerts[0]["body"], "die Turnierleitung sieht den Grund"
    told = await kinds(flow, "match_dispute")
    assert [row["user_id"] for row in told] == [player[second]["id"]], "die Gegenseite - nicht wer widerspricht, niemand sonst"
    assert "falschem Fahrer" not in told[0]["body"], "der Grund bleibt bei der Turnierleitung"
    everyone = {row["user_id"] for row in await flow.db.notifications.find({}, {"_id": 0}).to_list(200)}
    assert outsider["id"] not in everyone and player[first]["id"] not in {row["user_id"] for row in told}
    mails = await flow.db.mail_jobs.find({"template_key": "dispute_opened"}, {"_id": 0}).to_list(10)
    assert [mail["to"] for mail in mails] == [player[second]["email"]]

    # In Klärung: oben in der Liste der Turnierleitung, beim Spieler weiter unter den aktiven Matches.
    staff_rows = await operational_match_overviews(flow.db, staff)
    assert staff_rows[0]["id"] == match["id"] and staff_rows[0]["disputed"] is True
    own_rows, _regs = await own_match_overviews(flow.db, player[first])
    assert [row["id"] for row in own_rows if row["disputed"]] == [match["id"]]

    # Entschieden: alle Spieler hören es - mit Bezug zum Dispute.
    flow.act_as(staff)
    decided = await flow.post(f"/api/matches/{match['id']}/result", json=ranking(first, second))
    assert decided.status_code == 200, decided.text
    stored = await flow.reload(match)
    assert stored["status"] == "completed" and stored["dispute_resolved_at"]
    assert all(row.get("resolved_at") for row in stored["disputes"])
    resolved = [row for row in await kinds(flow, "match_result") if row["title"] == "Dispute entschieden"]
    assert {row["user_id"] for row in resolved} == {player[first]["id"], player[second]["id"]}
    assert "Die Turnierleitung hat den Dispute entschieden." in resolved[0]["body"]
    resolved_mails = await flow.db.mail_jobs.find({"template_key": "dispute_resolved"}, {"_id": 0}).to_list(10)
    assert len(resolved_mails) == 2


@pytest.mark.asyncio
async def test_after_a_result_the_window_is_thirty_minutes_or_until_the_winners_next_match(flow):
    staff, tournament, match, first, second, player = await bracket(flow, result_entry_mode="staff_only")
    flow.act_as(staff)
    entered = await flow.post(f"/api/matches/{match['id']}/result", json=ranking(first, second))
    assert entered.status_code == 200, entered.text

    flow.act_as(player[second])
    data = await page(flow, match)
    assert data["can_dispute"] is True, "auch gegen ein eingetragenes Ergebnis"
    decided = await flow.reload(match)
    expected_until = datetime.fromisoformat(decided["completed_at"]) + timedelta(minutes=30)
    assert datetime.fromisoformat(data["dispute_until"]) == expected_until, "30 Minuten nach dem Ergebnis"

    # Das nächste Spiel des Siegers ist für in zehn Minuten geplant - die Frist endet dann.
    follow_up = await flow.match_for(tournament, first, after_round=match["round"])
    soon = (now_utc() + timedelta(minutes=10)).isoformat()
    await flow.db.matches_v2.update_one({"id": follow_up["id"]}, {"$set": {"scheduled_at": soon}})
    earlier = await page(flow, match)
    assert earlier["dispute_until"] == soon

    # Es hat begonnen: kein Dispute mehr.
    await flow.db.matches_v2.update_one({"id": follow_up["id"]}, {"$set": {"status": "in_progress"}})
    closed = await page(flow, match)
    assert closed["can_dispute"] is False and closed["dispute_until"] is None
    refused = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Zu spät"})
    assert refused.status_code == 409 and "30 Minuten" in refused.json()["detail"]

    # Ohne nächstes Spiel: nach 30 Minuten ist Schluss.
    await flow.db.matches_v2.update_one({"id": follow_up["id"]}, {"$set": {"status": "pending", "scheduled_at": None}})
    old = (now_utc() - timedelta(minutes=31)).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"completed_at": old}})
    late = await page(flow, match)
    assert late["can_dispute"] is False
    too_late = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Zu spät"})
    assert too_late.status_code == 409


@pytest.mark.asyncio
async def test_strangers_and_staff_pages_get_no_dispute_form(flow):
    staff, _tournament, match, _first, _second, _player = await bracket(flow, result_entry_mode="staff_only")
    stranger = await flow.add_user(name="Fremd")
    flow.act_as(stranger)
    stranger_view = await page(flow, match)
    assert stranger_view["can_dispute"] is False
    refused = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Lag"})
    assert refused.status_code == 403
    flow.act_as(staff)
    staff_view = await page(flow, match)
    assert staff_view["can_dispute"] is False, "die Turnierleitung korrigiert direkt"


@pytest.mark.asyncio
async def test_with_a_lineup_the_whole_team_hears_about_the_dispute(flow):
    """Team am Spieltag: Ergebnis und Aufruf gehen an die Aufstellung - ein Dispute und seine Entscheidung ans ganze
    Team, damit auch die Teamleitung neben dem Spielfeld Bescheid weiß."""
    captain, starter, bench, rival = [await flow.add_user(name=name) for name in ("Kapitaen", "Startelf", "Bank", "Gegner")]
    tournament = await flow.create_tournament(team_mode="team", status="live")
    team = {"id": new_id(), "name": "Loewen", "tag": "LOE", "leader_id": captain["id"], "co_leader_ids": [],
            "member_ids": [captain["id"], starter["id"], bench["id"]]}
    await flow.db.teams.insert_one(dict(team))
    lions = {"id": new_id(), "tournament_id": tournament["id"], "team_id": team["id"], "user_id": captain["id"],
             "display_name": "[LOE] Loewen", "status": "approved", "lineup": [starter["id"]]}
    rivals = {"id": new_id(), "tournament_id": tournament["id"], "user_id": rival["id"], "display_name": "Gegner", "status": "approved"}
    await flow.db.tournament_registrations.insert_one(dict(lions))
    await flow.db.tournament_registrations.insert_one(dict(rivals))
    match = {"id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_key": "A", "match_type": "duel",
             "status": "completed", "updated_at": now_utc().isoformat(),
             "slots": [{"slot": 1, "registration_id": lions["id"]}, {"slot": 2, "registration_id": rivals["id"]}],
             "results": [{"registration_id": lions["id"], "rank": 1, "score": 2}, {"registration_id": rivals["id"], "rank": 2, "score": 0}]}
    whole_team = {captain["id"], starter["id"], bench["id"]}

    await notify_dispute_opened(flow.db, match, {"at": now_utc().isoformat(), "reason": "Lag"}, rival["id"], rivals["id"])
    told = {row["user_id"] for row in await kinds(flow, "match_dispute")}
    assert told == whole_team
    await notify_match_result_confirmed(flow.db, match, dispute_resolved=True)
    resolved = {row["user_id"] for row in await kinds(flow, "match_result")}
    assert resolved == whole_team | {rival["id"]}
