"""Erfolge-Seite leichter (#1229): der Katalog kommt je Kategorie, erst beim Aufklappen; die Übersicht bringt die
Punkte je Kategorie und - angemeldet - den eigenen Stand mit, damit die Seite nicht mehr den ganzen Katalog lädt."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_visibility as visibility  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        visibility.reset_rarity_cache()
        yield instance
    finally:
        visibility.reset_rarity_cache()
        await shutdown()


async def _negative_tier(flow) -> str:
    tier = await flow.db.achievements.find_one({"group_code": {"$regex": "^neg_"}}, {"_id": 0, "code": 1}, sort=[("rank", 1)])
    assert tier
    return tier["code"]


@pytest.mark.asyncio
async def test_katalog_je_kategorie_mit_und_ohne_eigenen_fortschritt(flow):
    player = await flow.add_user(name="paula")
    assert await badges.award_achievement(player["id"], "matches_played_1")

    flow.act_as(None)
    everything = (await flow.get("/api/achievements/groups")).json()
    match = (await flow.get("/api/achievements/groups", params={"category": "match"})).json()
    assert match and {group["category"] for group in match} == {"match"}
    assert len(match) == len([group for group in everything if group["category"] == "match"])
    assert len(match) < len(everything)
    # Ohne Anmeldung gibt es keinen eigenen Fortschritt, auch nicht mit mine.
    anonymous = (await flow.get("/api/achievements/groups", params={"category": "match", "mine": "true"})).json()
    assert not any(tier["earned"] for group in anonymous for tier in group["tiers"])
    # Alte Kategorienamen gelten weiter, unbekannte nicht.
    creator = (await flow.get("/api/achievements/groups", params={"category": "content"})).json()
    assert {group["category"] for group in creator} <= {"creator", "content"}
    assert (await flow.get("/api/achievements/groups", params={"category": "quatsch"})).status_code == 422

    flow.act_as(player)
    public = (await flow.get("/api/achievements/groups", params={"category": "match"})).json()
    assert not any(tier["earned"] for group in public for tier in group["tiers"]), "ohne mine bleibt es der öffentliche Katalog"
    own = (await flow.get("/api/achievements/groups", params={"category": "match", "mine": "true"})).json()
    played = next(group for group in own if group["code"] == "matches_played")
    assert next(tier for tier in played["tiers"] if tier["code"] == "matches_played_1")["earned"] is True


@pytest.mark.asyncio
async def test_uebersicht_mit_punkten_und_eigenem_stand(flow):
    player = await flow.add_user(name="paula")
    assert await badges.award_achievement(player["id"], "matches_played_1")
    assert await badges.award_achievement(player["id"], "matches_played_2")
    negative = await _negative_tier(flow)
    assert await badges.award_achievement(player["id"], negative)
    tiers = {tier["code"]: tier async for tier in flow.db.achievements.find({}, {"_id": 0})}
    visibility.reset_rarity_cache()

    flow.act_as(None)
    data = (await flow.get("/api/achievements/overview")).json()
    assert "mine" not in data, "Gäste bekommen keinen eigenen Stand"
    match = next(row for row in data["categories"] if row["key"] == "match")
    group_codes = [group["code"] async for group in flow.db.achievement_groups.find({"category": "match", "public": True, "is_negative": {"$ne": True}}, {"_id": 0, "code": 1})]
    assert match["points"] == sum(int(tier.get("points") or 0) for tier in tiers.values() if tier.get("group_code") in group_codes)
    assert match["points"] > 0

    flow.act_as(player)
    mine = (await flow.get("/api/achievements/overview")).json()["mine"]
    assert mine["categories"] == {"match": 2}
    assert mine["count"] == 2
    assert mine["points"] == int(tiers["matches_played_1"]["points"]) + int(tiers["matches_played_2"]["points"])
    assert mine["negative"] == 1, "Negatives zählt extra, nicht in den Punkten"


@pytest.mark.asyncio
async def test_geheime_gruppen_zaehlen_im_eigenen_stand(flow):
    player = await flow.add_user(name="paula")
    await flow.db.achievement_groups.insert_one({"code": "secret_y", "id": "secret_y", "name": "Geheim: Y", "category": "hidden", "hidden": True, "public": True,
                                                 "is_special": False, "is_negative": False, "icon": "eye-off", "accent_color": "#A855F7", "description": "Psst.", "sort_order": 951})
    await flow.db.achievements.insert_one(catalog.tier("secret_y_1", "secret_y", "hidden", "Y", "Gefunden.", manual_only=True) | {"id": "secret_y_1"})
    assert await badges.award_achievement(player["id"], "secret_y_1")
    flow.act_as(player)
    mine = (await flow.get("/api/achievements/overview")).json()["mine"]
    assert mine["categories"].get("hidden") == 1
    hidden = (await flow.get("/api/achievements/groups", params={"category": "hidden", "mine": "true"})).json()
    assert [group["code"] for group in hidden] == ["secret_y"]
