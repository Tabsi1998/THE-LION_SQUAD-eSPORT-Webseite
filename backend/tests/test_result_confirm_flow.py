"""Ergebnis der Gegenseite mit einem Tipp bestätigen (#1159).

Meldet eine Seite, kommt bei der anderen sofort „Frostbiss meldet 2:1 für dich. Stimmt das?“ - in der Glocke mit dem,
was „Stimmt“ schickt. „Stimmt“ ist die zweite gleiche Meldung: das Spiel ist entschieden, der Sieger rückt weiter. Nur
die Gegenseite darf; wer gemeldet hat, bekommt keine Bestätigen-Knöpfe; Team-Mitglieder sehen die Meldung, bestätigen
kann die Teamleitung. Namen sind erfunden.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.match_notifications import proposal_sentence  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def bracket(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, result_entry_mode="player_confirmed")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    match = matches[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    others = [users[index] for index, reg in enumerate(registrations) if reg["id"] not in {first, second}]
    return tournament, match, first, second, player, others


def duel(winner, loser, score=(2, 1)):
    return {"results": [{"registration_id": winner, "rank": 1, "score": score[0]}, {"registration_id": loser, "rank": 2, "score": score[1]}]}


@pytest.mark.asyncio
async def test_other_side_gets_the_question_and_one_tap_decides(flow):
    tournament, match, first, second, player, others = await bracket(flow)
    flow.act_as(player[second])
    reported = await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second))
    assert reported.status_code == 200, reported.text

    asked = await flow.db.notifications.find({"kind": "match_report"}, {"_id": 0}).to_list(10)
    assert [row["user_id"] for row in asked] == [player[first]["id"]]
    assert asked[0]["body"].endswith(f"{player[second]['display_name']} meldet 2:1 für dich. Stimmt das?")
    assert asked[0]["meta"]["confirm_results"] == [{"registration_id": first, "rank": 1, "score": 2.0}, {"registration_id": second, "rank": 2, "score": 1.0}]

    # Wer selbst gemeldet hat, sieht keine Bestätigen-Knöpfe.
    own = (await flow.get(f"/api/matches/{match['id']}/page")).json()["report_state"]
    assert own["status"] == "waiting" and "proposal_text" not in own

    flow.act_as(player[first])
    state = (await flow.get(f"/api/matches/{match['id']}/page")).json()["report_state"]
    assert state["status"] == "confirm" and state["can_confirm"] is True
    assert state["proposal_text"] == f"{player[second]['display_name']} meldet 2:1 für dich."
    assert state["proposal_by"] == player[second]["display_name"] and state["proposal_at"]

    # Unbeteiligte dürfen nicht bestätigen.
    flow.act_as(others[0])
    assert (await flow.post(f"/api/matches/{match['id']}/report", json={"results": asked[0]["meta"]["confirm_results"]})).status_code == 403

    flow.act_as(player[first])
    confirmed = await flow.post(f"/api/matches/{match['id']}/report", json={"results": asked[0]["meta"]["confirm_results"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["awaiting_confirmation"] is False
    assert (await flow.reload(match))["status"] == "completed"
    assert await flow.match_for(tournament, first, after_round=match["round"]) is not None, "der Sieger rückt weiter"


@pytest.mark.asyncio
async def test_team_members_see_the_report_but_only_the_lead_confirms(flow):
    captain, member, rival = [await flow.add_user(name=name) for name in ("Kapitaen", "Mitglied", "Gegner")]
    tournament = await flow.create_tournament(team_mode="team", status="live", result_entry_mode="player_confirmed")
    team = {"id": new_id(), "name": "Loewen", "tag": "LOE", "leader_id": captain["id"], "co_leader_ids": [], "member_ids": [captain["id"], member["id"]]}
    await flow.db.teams.insert_one(dict(team))
    lions = {"id": new_id(), "tournament_id": tournament["id"], "team_id": team["id"], "user_id": captain["id"], "display_name": "[LOE] Loewen", "status": "approved"}
    rivals = {"id": new_id(), "tournament_id": tournament["id"], "user_id": rival["id"], "display_name": "Gegner", "status": "approved"}
    for reg in (lions, rivals):
        await flow.db.tournament_registrations.insert_one(dict(reg))
    match = {"id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_key": "A", "match_type": "duel", "status": "in_progress",
             "updated_at": now_utc().isoformat(), "slots": [{"slot": 1, "status": "filled", "registration_id": lions["id"]},
                                                           {"slot": 2, "status": "filled", "registration_id": rivals["id"]}],
             "reports": [{"user_id": rival["id"], "registration_id": rivals["id"], "at": now_utc().isoformat(),
                          "results": [{"registration_id": rivals["id"], "rank": 1, "score": 3}, {"registration_id": lions["id"], "rank": 2, "score": 0}]}]}
    await flow.db.matches_v2.insert_one(dict(match))

    flow.act_as(member)
    seen = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert seen["report_state"]["status"] == "confirm" and seen["report_state"]["can_confirm"] is False
    assert seen["report_state"]["proposal_text"] == "Gegner meldet 3:0 für sich."
    assert seen["can_player_report_result"] is False
    flow.act_as(captain)
    lead = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert lead["report_state"]["can_confirm"] is True and lead["can_player_report_result"] is True


def test_sentences_from_the_viewers_side():
    regs = {"a": {"display_name": "NeonFalke"}, "b": {"display_name": "Frostbiss"}}
    win_b = [{"registration_id": "b", "rank": 1, "score": 2}, {"registration_id": "a", "rank": 2, "score": 1}]
    assert proposal_sentence(win_b, regs, "b", "a") == "Frostbiss meldet 2:1 für sich."
    win_a = [{"registration_id": "a", "rank": 1, "score": 2}, {"registration_id": "b", "rank": 2, "score": 1}]
    assert proposal_sentence(win_a, regs, "b", "a") == "Frostbiss meldet 2:1 für dich."
    draw = [{"registration_id": "a", "rank": 1, "score": 1}, {"registration_id": "b", "rank": 1, "score": 1}]
    assert proposal_sentence(draw, regs, "b", "a") == "Frostbiss meldet ein Unentschieden 1:1."
    assert proposal_sentence([{"registration_id": "a", "rank": 1}, {"registration_id": "b", "rank": 2}], regs, "b", "a") == "Frostbiss meldet einen Sieg für dich."
