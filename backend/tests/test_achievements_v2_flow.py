"""Erfolge II (#611): Stufenleiter Holz → Diamant mit Legendär und Geheim - jede Stufe trägt Material und
Rang, das alte Level bleibt 1–5 für alte Clients, Vergaben speichern das Material, geheime Gruppen zeigen
sich erst nach der Freischaltung, der Admin legt Stufen mit Material an, und die Migration hebt alte
Vergaben ohne Verlust und ohne zweites Fest in die neue Welt."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
import achievement_catalog as catalog  # noqa: E402
import badges  # noqa: E402
from services import achievement_migration as migration  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


# ------------------------------------------------------------------ Katalog

def test_stufenleiter_und_alte_level():
    assert list(catalog.MATERIALS) == ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"]
    assert [catalog.MATERIALS[m]["rank"] for m in catalog.MATERIALS] == list(range(1, 10))
    assert catalog.LADDERS[7] == ["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond"]
    assert catalog.legacy_level("wood") == 1 and catalog.legacy_level("diamond") == 4 and catalog.legacy_level("legendary") == 5
    assert catalog.material_for_legacy(5, {"is_negative": True}) == "hidden"
    assert catalog.material_for_legacy(5, {"is_special": True}) == "legendary"
    assert catalog.material_for_legacy(2) == "silver"
    assert catalog.ladder_targets([1, 5, 15, 40, 100]) == [("bronze", 1), ("silver", 5), ("gold", 15), ("platinum", 40), ("diamond", 100)]
    with pytest.raises(ValueError):
        catalog.ladder_targets([1, 2])
    assert catalog.category_v2("content") == "creator" and catalog.category_v2("progression") == "profile" and catalog.category_v2("club") == "club"


def test_jede_alte_stufe_traegt_material_rang_und_level():
    for tier in catalog.ACHIEVEMENT_TIERS:
        assert tier["material"] in catalog.MATERIALS, tier["code"]
        assert tier["rank"] == catalog.MATERIALS[tier["material"]]["rank"]
        assert tier["level"] in (1, 2, 3, 4, 5)
        assert tier["material_name"] and tier["material_color"].startswith("#")
        assert tier["art"] and "how_to" in tier
    for group in catalog.ACHIEVEMENT_GROUPS:
        assert catalog.apply_category_overrides(group)["category"] in catalog.CATEGORIES, group["code"]
    assert set(catalog.CATEGORY_OVERRIDES.values()) <= set(catalog.CATEGORIES)


def test_neue_stufe_mit_material():
    tier = catalog.tier("x_diamond", "x", "diamond", "X VII", "Erreiche 100.", condition_key="matches_won", progress_target=100, icon="trophy")
    assert (tier["material"], tier["rank"], tier["level"], tier["points"], tier["art"], tier["how_to"]) == ("diamond", 7, 4, 160, "trophy", "Erreiche 100.")
    assert catalog.tier("y", "x", "legendary", "Y", "Z", points=999)["points"] == 999
    with pytest.raises(ValueError):
        catalog.tier("z", "x", "steel", "Z", "Z")


# ------------------------------------------------------------------ API

@pytest.mark.asyncio
async def test_oeffentlicher_katalog_traegt_material_alte_felder_bleiben(flow):
    flow.act_as(None)
    groups = (await flow.get("/api/achievements/groups")).json()
    match_master = next(g for g in groups if g["code"] == "match_master")
    tiers = match_master["tiers"]
    assert [t["material"] for t in tiers] == ["bronze", "silver", "gold", "platinum", "legendary"]
    assert [t["rank"] for t in tiers] == [3, 4, 5, 6, 8] and [t["level"] for t in tiers] == [1, 2, 3, 4, 5]
    assert tiers[0]["material_name"] == "Bronze" and tiers[0]["level_name"] == "Bronze" and tiers[0]["level_color"] == "#CD7F32"
    assert match_master["category"] == "match" and match_master["hidden"] is False and match_master["highest_earned_rank"] == 0
    categories = {g["category"] for g in groups}
    assert categories <= set(catalog.CATEGORIES) and "creator" in categories and "profile" in categories
    assert not any(g.get("hidden") for g in groups), "geheime Gruppen zeigt der Katalog anonym nie"


@pytest.mark.asyncio
async def test_vergabe_speichert_material_und_rang(flow):
    user = await flow.add_user(name="Spielerin")
    assert await badges.award_achievement(user["id"], "match_master_s")
    award = await flow.db.user_achievements.find_one({"user_id": user["id"], "tier_code": "match_master_s"}, {"_id": 0})
    assert award["material"] == "silver" and award["rank"] == 4 and award["level"] == 2
    flow.act_as(user)
    shown = (await flow.get(f"/api/achievements/user/{user['id']}")).json()
    mine = next(a for a in shown["awards"] if a["code"] == "match_master_s")  # die Vergabeliste trägt den Stufen-Code als „code“
    assert mine["material"] == "silver" and mine["material_color"] == "#C0C0C0" and mine["level_name"] == "Silber"


@pytest.mark.asyncio
async def test_geheime_gruppe_erst_nach_freischaltung(flow):
    await flow.db.achievement_groups.insert_one({"code": "secret_konami", "id": "secret_konami", "name": "Geheim: Konami", "category": "hidden", "hidden": True, "public": True,
                                                 "is_special": False, "is_negative": False, "icon": "eye-off", "accent_color": "#A855F7", "description": "Psst.", "sort_order": 950})
    await flow.db.achievements.insert_one(catalog.tier("secret_konami_1", "secret_konami", "hidden", "Konami", "Tastenfolge gefunden.", manual_only=True) | {"id": "secret_konami_1"})
    user = await flow.add_user(name="Sucher")
    admin = await flow.add_user(role="club_admin", name="Admin")
    flow.act_as(None)
    assert "secret_konami" not in {g["code"] for g in (await flow.get("/api/achievements/groups")).json()}
    flow.act_as(user)
    assert "secret_konami" not in {g["code"] for g in (await flow.get("/api/achievements/me")).json()["groups"]}
    flow.act_as(admin)
    assert "secret_konami" in {g["code"] for g in (await flow.get("/api/achievements/me")).json()["groups"]}, "Admins sehen alles"
    assert await badges.award_achievement(user["id"], "secret_konami_1")
    flow.act_as(user)
    mine = next(g for g in (await flow.get("/api/achievements/me")).json()["groups"] if g["code"] == "secret_konami")
    assert mine["hidden"] is True and [t["material"] for t in mine["tiers"]] == ["hidden"] and mine["tiers"][0]["earned"] is True
    assert mine["tiers"][0]["level_name"] == "Geheim" and mine["tiers"][0]["level"] == 5


@pytest.mark.asyncio
async def test_admin_legt_stufen_mit_material_an(flow):
    admin = await flow.add_user(role="club_admin", name="Admin")
    flow.act_as(admin)
    res = await flow.post("/api/admin/achievements/groups", json={"code": "creator_x", "name": "Creator X", "category": "creator"})
    assert res.status_code == 200 and res.json()["hidden"] is False
    assert (await flow.post("/api/admin/achievements/groups", json={"code": "nope", "name": "Nope", "category": "unsinn"})).status_code == 400
    res = await flow.post("/api/admin/achievements/tiers", json={"code": "creator_x_7", "group_code": "creator_x", "material": "diamond", "name": "Creator X VII", "condition_key": "twitch_live_sessions", "progress_target": 250})
    assert res.status_code == 200, res.text
    doc = res.json()
    assert (doc["material"], doc["rank"], doc["level"], doc["points"], doc["material_name"]) == ("diamond", 7, 4, 160, "Diamant")
    assert (await flow.post("/api/admin/achievements/tiers", json={"code": "creator_x_8", "group_code": "creator_x", "material": "steel", "name": "Stahl"})).status_code == 400
    # Altes Formular: Level ohne Material → Material folgt dem Level.
    res = await flow.post("/api/admin/achievements/tiers", json={"code": "creator_x_1", "group_code": "creator_x", "level": 1, "name": "Creator X I", "points": 7})
    assert res.json()["material"] == "bronze" and res.json()["points"] == 7
    res = await flow.patch("/api/admin/achievements/tiers/creator_x_1", json={"material": "wood"})
    assert (res.json()["material"], res.json()["rank"], res.json()["level"]) == ("wood", 1, 1)
    res = await flow.patch("/api/admin/achievements/tiers/creator_x_1", json={"level": 3})
    assert res.json()["material"] == "gold"
    listed = (await flow.get("/api/admin/achievements/tiers?group_code=creator_x")).json()
    assert [t["code"] for t in listed] == ["creator_x_1", "creator_x_7"], "nach Rang sortiert"


# ------------------------------------------------------------------ Migration

@pytest.mark.asyncio
async def test_migration_annotiert_und_bildet_alte_gruppen_ab(flow):
    db = flow.db
    user = await flow.add_user(name="Veteranin")
    other = await flow.add_user(name="Neuling")
    # Alte Gruppe mit zwei Stufen, eine Vergabe ohne Material (wie vor #611 gespeichert).
    await db.achievement_groups.insert_one({"code": "oldg", "id": "oldg", "name": "Alte Gruppe", "category": "match", "public": True, "is_special": False, "is_negative": False, "icon": "swords", "accent_color": "#fff", "description": "alt", "sort_order": 1})
    await db.achievements.insert_many([
        {"code": "oldg_1", "id": "oldg_1", "group_code": "oldg", "level": 1, "name": "Alt I", "description": "", "condition_key": "matches_played", "progress_target": 1, "points": 10},
        {"code": "oldg_2", "id": "oldg_2", "group_code": "oldg", "level": 2, "name": "Alt II", "description": "", "condition_key": "matches_played", "progress_target": 10, "points": 25},
    ])
    await db.user_achievements.insert_one({"id": "a1", "user_id": user["id"], "tier_code": "oldg_1", "group_code": "oldg", "level": 1, "earned_at": "2025-03-01T10:00:00+00:00", "context": {}})
    await db.user_achievements.insert_one({"id": "a2", "user_id": other["id"], "tier_code": "oldg_1", "group_code": "oldg", "level": 1, "earned_at": "2026-01-01T10:00:00+00:00", "context": {}})
    annotated = await migration.annotate_awards(db)
    assert annotated["updated"] == 2
    stored = await db.user_achievements.find_one({"id": "a1"}, {"_id": 0})
    assert stored["material"] == "bronze" and stored["rank"] == 3
    # Neue Gruppe mit der Leiter, Zähler der Person: 3 Matches → Holz und Eisen erreicht, Bronze nicht.
    await db.achievement_groups.insert_one({"code": "newg", "id": "newg", "name": "Spielmacher", "category": "match", "public": True, "is_special": False, "is_negative": False, "icon": "swords", "accent_color": "#fff", "description": "neu", "sort_order": 2})
    await db.achievements.insert_many([catalog.tier(f"newg_{i}", "newg", material, f"Spielmacher {i}", "Spiele.", condition_key="matches_played", progress_target=target) | {"id": f"newg_{i}"}
                                       for i, (material, target) in enumerate(catalog.ladder_targets([1, 3, 5, 25, 75, 200, 500]), start=1)])
    counters = {user["id"]: {"matches_played": 3}, other["id"]: {"matches_played": 0}}

    async def fake_progress(user_id):
        return counters[user_id]

    dry = await migration.apply_group_mapping(db, {"oldg": "newg"}, dry_run=True, compute_progress=fake_progress)
    assert dry["groups"][0]["awards"] == 2 and await db.achievement_groups.find_one({"code": "oldg"}), "Trockenlauf schreibt nichts"
    report = await migration.apply_group_mapping(db, {"oldg": "newg"}, compute_progress=fake_progress)
    moves = {m["user_id"]: m for m in report["groups"][0]["moves"]}
    assert moves[user["id"]]["new_tiers"] == ["newg_1", "newg_2"] and moves[other["id"]]["new_tiers"] == []
    mine = await db.user_achievements.find({"user_id": user["id"]}, {"_id": 0}).sort("rank", 1).to_list(10)
    assert [(a["tier_code"], a["material"], a["earned_at"]) for a in mine] == [("newg_1", "wood", "2025-03-01T10:00:00+00:00"), ("newg_2", "iron", "2025-03-01T10:00:00+00:00")]
    assert mine[0]["context"]["migrated_from"] == "oldg" and mine[0].get("migrated_at")
    assert await db.user_achievements.count_documents({"user_id": other["id"]}) == 0, "wer nichts erreicht hat, behält nichts Falsches"
    assert await db.achievement_groups.find_one({"code": "oldg"}) is None and await db.achievements.count_documents({"group_code": "oldg"}) == 0
    assert await db.achievement_outbox.count_documents({}) == 0, "keine Meldung, kein zweites Fest"
    again = await migration.apply_group_mapping(db, {"oldg": "newg"}, compute_progress=fake_progress)
    assert again["groups"] == [], "jede alte Gruppe genau einmal"
    marker = await db.settings.find_one({"id": migration.MARKER_ID}, {"_id": 0})
    assert marker["applied"] == ["oldg"]


@pytest.mark.asyncio
async def test_migration_ohne_gegenstueck_wird_vermaechtnis(flow):
    db = flow.db
    user = await flow.add_user(name="Ehrenmitglied")
    await db.achievement_groups.insert_one({"code": "manual_old", "id": "manual_old", "name": "Ehrensache", "category": "special", "public": True, "is_special": True, "is_negative": False, "icon": "star", "accent_color": "#fff", "description": "von Hand", "sort_order": 1})
    await db.achievements.insert_one({"code": "manual_old_1", "id": "manual_old_1", "group_code": "manual_old", "level": 5, "name": "Ehrensache", "description": "", "condition_key": None, "progress_target": None, "points": 100, "manual_only": True})
    await db.user_achievements.insert_one({"id": "m1", "user_id": user["id"], "tier_code": "manual_old_1", "group_code": "manual_old", "level": 5, "earned_at": "2024-06-01T10:00:00+00:00", "context": {"manual": True}})
    report = await migration.apply_group_mapping(db, {"manual_old": None}, compute_progress=lambda user_id: {})
    assert report["groups"][0]["mode"] == "legacy"
    legacy_group = await db.achievement_groups.find_one({"code": "legacy_manual_old"}, {"_id": 0})
    assert legacy_group["legacy"] is True and legacy_group["name"] == "Vermächtnis: Ehrensache" and legacy_group["public"] is True
    award = await db.user_achievements.find_one({"id": "m1"}, {"_id": 0})
    assert award["tier_code"] == "legacy_manual_old_1" and award["group_code"] == "legacy_manual_old" and award["earned_at"] == "2024-06-01T10:00:00+00:00"
    assert await db.achievement_groups.find_one({"code": "manual_old"}) is None
    flow.act_as(user)
    shown = (await flow.get(f"/api/achievements/user/{user['id']}")).json()
    assert "legacy_manual_old_1" in {a["code"] for a in shown["awards"]}, "im Profil bleibt die Vergabe sichtbar"
    assert "legacy_manual_old" in {g["code"] for g in shown["groups"]}
