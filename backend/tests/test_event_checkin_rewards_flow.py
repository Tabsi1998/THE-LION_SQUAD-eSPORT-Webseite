"""Check-in und Belohnung (#2127, EV12): Wer den Check-in zurücknimmt, nimmt Jahrespunkte und XP mit zurück - auch bei
mehrfachem Hin und Her nie doppelt. Abgeschlossene Jahreswertungen bleiben. Namen sind erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import xp  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await xp.ensure_indexes(instance.db)
    await instance.db.seasons.insert_one({"id": "s1", "name": "Wertung 2026", "status": "active", "start_date": "2026-01-01T00:00:00+00:00"})
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    lead = await flow.add_user(role="tournament_admin", name="leitung")
    flow.act_as(lead)
    event = (await flow.post("/api/events", json={"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                  "start_date": (now_utc() + timedelta(days=3)).isoformat()})).json()
    player = await flow.add_user(role="player", name="spielerin")
    flow.act_as(player)
    reg = (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).json()
    flow.act_as(lead)
    return lead, event, player, reg


async def set_status(flow, event, reg, status):
    response = await flow.patch(f"/api/events/{event['id']}/registrations/{reg['id']}", json={"status": status})
    assert response.status_code == 200, response.text
    return response.json()


async def rewards(flow, player):
    points = await flow.db.season_points.find({"user_id": player["id"], "source_type": "event"}, {"_id": 0}).to_list(10)
    events = await flow.db.xp_events.find({"user_id": player["id"], "source": "event_attended"}, {"_id": 0}).to_list(10)
    total = int((await xp.state(player["id"])).get("total") or 0)
    return points, events, total


@pytest.mark.asyncio
async def test_rueckgaengig_nimmt_punkte_und_xp_zurueck(flow):
    _lead, event, player, reg = await setup(flow)
    await set_status(flow, event, reg, "checked_in")
    points, events, total = await rewards(flow, player)
    assert len(points) == 1 and len(events) == 1 and total >= 60

    await set_status(flow, event, reg, "registered")
    points, events, after = await rewards(flow, player)
    assert points == [] and events == [] and after == 0


@pytest.mark.asyncio
async def test_hin_und_her_vergibt_nie_doppelt(flow):
    _lead, event, player, reg = await setup(flow)
    await set_status(flow, event, reg, "checked_in")
    _points, _events, once = await rewards(flow, player)
    for _ in range(3):
        await set_status(flow, event, reg, "registered")
        assert (await rewards(flow, player))[2] == 0
        await set_status(flow, event, reg, "checked_in")
        points, events, total = await rewards(flow, player)
        assert len(points) == 1 and len(events) == 1 and total == once
    # Noch einmal „Da“ ändert nichts: kein zweiter Eintrag.
    await set_status(flow, event, reg, "checked_in")
    assert (await rewards(flow, player))[2] == once


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["no_show", "cancelled", "waitlist"])
async def test_jeder_wechsel_weg_von_da_nimmt_zurueck(flow, status):
    _lead, event, player, reg = await setup(flow)
    await set_status(flow, event, reg, "checked_in")
    await set_status(flow, event, reg, status)
    points, events, total = await rewards(flow, player)
    assert points == [] and events == [] and total == 0


@pytest.mark.asyncio
async def test_abgeschlossene_wertung_bleibt_und_kein_zweiter_eintrag(flow):
    _lead, event, player, reg = await setup(flow)
    await set_status(flow, event, reg, "checked_in")
    await flow.db.seasons.update_one({"id": "s1"}, {"$set": {"status": "completed"}})
    await flow.db.seasons.insert_one({"id": "s2", "name": "Wertung 2027", "status": "active", "start_date": "2027-01-01T00:00:00+00:00"})

    await set_status(flow, event, reg, "registered")
    points, events, _total = await rewards(flow, player)
    assert [row["season_id"] for row in points] == ["s1"], "die abgeschlossene Wertung ändert sich nicht"
    assert events == [], "XP gehören zu keiner Wertung und gehen zurück"

    await set_status(flow, event, reg, "checked_in")
    points, events, _total = await rewards(flow, player)
    assert [row["season_id"] for row in points] == ["s1"], "kein zweiter Eintrag in der neuen Wertung"
    assert len(events) == 1


@pytest.mark.asyncio
async def test_absage_nimmt_belohnung_der_eingecheckten_zurueck(flow):
    _lead, event, player, reg = await setup(flow)
    await set_status(flow, event, reg, "checked_in")
    response = await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled"})
    assert response.status_code == 200, response.text
    points, events, total = await rewards(flow, player)
    assert points == [] and events == [] and total == 0


@pytest.mark.asyncio
async def test_protokoll_nennt_die_ruecknahme(flow):
    _lead, event, _player, reg = await setup(flow)
    await set_status(flow, event, reg, "checked_in")
    await set_status(flow, event, reg, "registered")
    row = await flow.db.audit_logs.find_one({"action": "event.registration.update", "data.rewards_revoked": {"$exists": True}}, {"_id": 0})
    assert row["data"]["rewards_revoked"]["points_removed"] == 1 and row["data"]["rewards_revoked"]["xp_removed"] >= 60


@pytest.mark.asyncio
async def test_xp_ruecknahme_zweimal_und_nach_prestige(flow):
    user = await flow.add_user(role="player", name="sterne")
    await xp.grant(user["id"], "event_attended", "e:r")
    assert (await xp.revoke(user["id"], "event_attended", "e:r"))["removed"] == 60
    assert await xp.revoke(user["id"], "event_attended", "e:r") is None
    assert (await xp.state(user["id"]))["total"] == 0

    await xp.grant(user["id"], "event_attended", "e:r")
    await flow.db.user_xp.update_one({"user_id": user["id"]}, {"$set": {"total": 500, "prestige": 1, "prestige_at": "2999-01-01T00:00:00+00:00"}})
    assert (await xp.revoke(user["id"], "event_attended", "e:r"))["removed"] == 0, "aus der Zeit vor dem Prestige: der neue Stand bleibt"
    assert (await xp.state(user["id"]))["total"] == 500
