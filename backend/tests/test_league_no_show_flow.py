"""„Nicht erschienen?“ in der Liga (#2201, D-1). Erfundene Namen.

Online setzt niemand ``started_at``: ohne Check-in sagt ein Liga-Termin nichts darüber, ob jemand da war. Deshalb kein
automatischer Vorschlag in Liga-Staffeln - „Ergebnis fehlt“ bleibt, die Leitung kann weiter werten, solange nichts
gemeldet ist. Alte offene Vorschläge räumt der Fristen-Job ab. Andere Turniere bleiben genau, wie sie sind.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, two_nil, world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services.match_deadline_sweep import sweep  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ago(**delta) -> str:
    return (now_utc() - timedelta(**delta)).isoformat()


async def lead_kinds(flow, world) -> dict[str, dict]:
    flow.act_as(world["staff"])
    response = await flow.get(f"/api/tournaments/{world['tournament']['id']}/lead")
    assert response.status_code == 200, response.text
    return {row["kind"]: row for row in response.json()["attention"]}


def old_proposal(world, **extra) -> dict:
    return {"id": "alt", "rule": "online", "minutes": 15, "registration_ids": [world["reg_a"]["id"], world["reg_h"]["id"]],
            "due_at": ago(hours=2), "created_at": ago(hours=2), **extra}


async def decide(flow, world, **body):
    return await flow.post(f"/api/tournaments/{world['tournament']['id']}/lead/no-show/{world['match']['id']}", json=body)


async def overdue(flow, world) -> None:
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": ago(days=1)}})


@pytest.mark.asyncio
async def test_no_proposal_after_a_league_date_without_a_report_result_missing_stays(flow):
    world = await league_world(flow)
    await overdue(flow, world)
    assert (await sweep(flow.db))["proposed"] == 0
    stored = await flow.reload(world["match"])
    assert not stored.get("no_show_proposal")
    assert not await flow.db.notifications.count_documents({"kind": "match_attention", "meta.reason": "no_show"})
    kinds = await lead_kinds(flow, world)
    assert "no_show" not in kinds
    assert kinds["result_missing"]["match_id"] == world["match"]["id"]


@pytest.mark.asyncio
async def test_an_old_open_proposal_is_cleared_once_with_a_protocol_entry(flow):
    world = await league_world(flow)
    await overdue(flow, world)
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"no_show_proposal": old_proposal(world)}})
    await sweep(flow.db)
    await sweep(flow.db)
    assert not (await flow.reload(world["match"])).get("no_show_proposal")
    rows = await flow.db.audit_logs.find({"action": "match.no_show.cleared"}, {"_id": 0}).to_list(5)
    assert len(rows) == 1 and rows[0]["data"]["proposal_id"] == "alt" and rows[0]["actor_id"] is None
    assert "no_show" not in await lead_kinds(flow, world)


@pytest.mark.asyncio
async def test_an_old_proposal_shows_no_card_even_before_the_job_cleared_it(flow):
    """Die Karte verschwindet sofort - auch in einer pausierten Staffel, in der der Fristen-Job nicht läuft."""
    world = await league_world(flow)
    await overdue(flow, world)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"status": "paused"}})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"no_show_proposal": old_proposal(world)}})
    assert "no_show" not in await lead_kinds(flow, world)


@pytest.mark.asyncio
async def test_a_decided_proposal_stays_as_history(flow):
    world = await league_world(flow)
    await overdue(flow, world)
    decided = old_proposal(world, decision="confirmed", decided_by="jemand")
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"no_show_proposal": decided}})
    await sweep(flow.db)
    assert (await flow.reload(world["match"]))["no_show_proposal"]["decision"] == "confirmed"
    assert not await flow.db.audit_logs.count_documents({"action": "match.no_show.cleared"})


@pytest.mark.asyncio
async def test_the_lead_can_still_decide_without_a_proposal_while_nothing_is_reported(flow):
    world = await league_world(flow)
    await overdue(flow, world)
    flow.act_as(world["staff"])
    answer = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "forfeit"
    stored = await flow.reload(world["match"])
    assert stored["status"] == "forfeit" and stored["forfeit_registration_id"] == world["reg_h"]["id"]
    audit = await flow.db.audit_logs.find_one({"action": "match.no_show.confirmed"}, {"_id": 0})
    assert audit["actor_id"] == world["staff"]["id"] and audit["data"]["registration_id"] == world["reg_h"]["id"]
    replay = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert replay.status_code == 200 and replay.json()["idempotent_replay"] is True


@pytest.mark.asyncio
async def test_the_lead_can_confirm_an_old_proposal_before_the_job_cleared_it(flow):
    world = await league_world(flow)
    await overdue(flow, world)
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"no_show_proposal": old_proposal(world)}})
    flow.act_as(world["staff"])
    answer = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert answer.status_code == 200, answer.text
    assert (await flow.reload(world["match"]))["no_show_proposal"]["decision"] == "confirmed"


@pytest.mark.asyncio
async def test_a_report_ends_the_way_over_the_lead(flow):
    world = await league_world(flow)
    await overdue(flow, world)
    flow.act_as(world["users"]["Kapitaen"])
    report = await flow.post(f"/api/matches/{world['match']['id']}/report",
                             json=two_nil(world, lineup=ids(world, "Kapitaen", "Mila")))
    assert report.status_code == 200, report.text
    flow.act_as(world["staff"])
    refused = await decide(flow, world, action="confirm", registration_id=world["reg_h"]["id"])
    assert refused.status_code == 409, refused.text
    assert "gemeldet" in refused.json()["detail"]
    assert (await flow.reload(world["match"]))["status"] != "forfeit"


@pytest.mark.asyncio
async def test_without_a_proposal_there_is_nothing_to_extend(flow):
    world = await league_world(flow)
    flow.act_as(world["staff"])
    refused = await decide(flow, world, action="extend", minutes=5)
    assert refused.status_code == 409, refused.text


@pytest.mark.asyncio
async def test_other_tournaments_keep_their_proposal_and_need_one_for_the_lead(flow):
    """Regression: ein Liga-Format ohne ``league_context`` und ein Online-Turnier schlagen weiter vor."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    for fields in ({"format": "league"}, {"format": "single_elim"}):
        tournament, _users, _registrations = await flow.with_participants(4, event_mode="online", **fields)
        built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
        assert built.status_code == 200, built.text
        await flow.start(tournament)
        matches = await flow.matches(tournament)
        duel = next(row for row in matches if all(slot.get("registration_id") for slot in row["slots"]))
        refused = await flow.post(f"/api/tournaments/{tournament['id']}/lead/no-show/{duel['id']}",
                                  json={"action": "confirm", "registration_id": duel["slots"][0]["registration_id"]})
        assert refused.status_code == 409, "ohne Vorschlag kein Weg - außerhalb der Liga unverändert"
        await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"scheduled_at": ago(minutes=16)}})
        await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"start_date": ago(hours=2)}})
        assert (await sweep(flow.db))["proposed"] >= 1, fields
        assert (await flow.reload(duel))["no_show_proposal"]["rule"] == "online"
