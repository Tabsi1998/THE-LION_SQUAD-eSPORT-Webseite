"""Geräteprüfung vor App 1.4.0 (#1296): eine Auswertung mit mehreren Erfolgen schickt eine Meldung mit dem erreichten
Level statt vier „Level X erreicht“ hintereinander; der Lese-Abruf der Profil-Vollständigkeit vergibt nichts mehr,
das Speichern des Profils stellt die Auswertung in die Warteschlange."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import badges  # noqa: E402
from services import xp  # noqa: E402

FULL_PROFILE = {
    "avatar_url": "/api/uploads/images/a.webp",
    "banner_url": "/api/uploads/images/b.webp",
    "bio": "Spielt gern Rennspiele.",
    "country": "AT",
    "city": "Wien",
    "birth_date": "2000-05-01",
    "main_platforms": ["pc"],
    "input_devices": ["controller"],
    "favorite_games": ["Mario Kart"],
    "discord_name": "racer",
    "twitch_handle": "racer",
    "privacy_public_profile": True,
}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        xp._daily_seen.clear()
        yield instance
    finally:
        await shutdown()


async def level_notes(flow, user_id):
    return await flow.db.notifications.find({"user_id": user_id, "kind": "level"}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_mehrere_aufstiege_in_einer_sammlung_melden_sich_einmal(flow):
    user = await flow.add_user(name="Sammlerin")
    async with xp.collected_level_ups():
        await xp.grant(user["id"], "correction", "k1", amount=400)
        await xp.grant(user["id"], "correction", "k2", amount=900)
        await xp.grant(user["id"], "correction", "k3", amount=1500)
    state = await xp.state(user["id"])
    notes = await level_notes(flow, user["id"])
    assert state["level"] >= 4
    assert len(notes) == 1, "eine Meldung je Auswertung"
    assert notes[0]["title"] == f"Level {state['level']} erreicht"
    assert notes[0]["meta"]["previous"] == 1


@pytest.mark.asyncio
async def test_ohne_sammlung_meldet_jeder_aufstieg_sich_wie_bisher(flow):
    user = await flow.add_user(name="Einzeln")
    await xp.grant(user["id"], "correction", "e1", amount=400)
    await xp.grant(user["id"], "correction", "e2", amount=900)
    assert len(await level_notes(flow, user["id"])) == 2


@pytest.mark.asyncio
async def test_auswertung_mit_mehreren_erfolgen_schickt_eine_level_meldung(flow):
    user = await flow.add_user(name="Vollständig")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": FULL_PROFILE})
    awarded = await badges.evaluate_user_progress(user["id"])
    assert awarded >= 2
    state = await xp.state(user["id"])
    notes = await level_notes(flow, user["id"])
    assert state["level"] >= 2
    assert len(notes) == 1
    assert notes[0]["title"] == f"Level {state['level']} erreicht"


@pytest.mark.asyncio
async def test_lese_abruf_vergibt_nichts_speichern_stellt_auswertung_an(flow):
    user = await flow.add_user(name="Leserin")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": FULL_PROFILE})
    flow.act_as(user)
    response = await flow.get("/api/users/me/profile-completeness")
    assert response.status_code == 200
    assert response.json()["score"] == 100
    assert await flow.db.user_achievements.count_documents({"user_id": user["id"]}) == 0
    assert await flow.db.notifications.count_documents({"user_id": user["id"]}) == 0
    saved = await flow.patch("/api/users/me", json={"bio": "Fährt am liebsten Rainbow Road."})
    assert saved.status_code == 200
    queued = await flow.db.achievement_eval_queue.find_one({"user_id": user["id"]}, {"_id": 0})
    assert queued and "profile" in queued.get("sources", [])
