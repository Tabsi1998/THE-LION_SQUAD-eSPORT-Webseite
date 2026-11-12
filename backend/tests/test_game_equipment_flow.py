"""Ausrüstungs-Bibliothek je Spiel (docs/LIGA.md, C.4 #2218) - durch die echten Routen.

Kategorien je Spiel mit Rolle (Waffe, Aufsatz, sonstige), Einträge mit Bild nur aus dem eigenen Upload, Name je Kategorie einmal,
Zustand wie bei Maps, Aufsatz zu Waffe, Löschen nur ohne Sperrliste, Import aus einer anderen Spielversion, Rechte wie die Maps.
Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_start_world import ok  # noqa: E402

GAME = {"name": "Probe Shooter", "match_modes": [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen"}]}
IMAGE = "/api/static/uploads/blitz-1.webp"
CATEGORIES = [{"label": "Waffen", "role": "weapon"}, {"label": "Aufsätze", "role": "attachment"}, {"label": "Perks", "role": "item"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def register(flow, *urls: str, scope: str = "admin", owner: str | None = None) -> None:
    """Bilder in der Mediathek eintragen - nur solche nimmt die Bibliothek (wie das Regelwerk, #2230)."""
    for url in urls:
        name = url.rsplit("/", 1)[-1]
        await flow.db.media_uploads.insert_one({"id": new_id(), "filename": name, "url": url, "media_type": "image",
                                                "media_scope": scope, "owner_id": owner, "owner_role": "admin"})


async def setup(flow, categories=CATEGORIES) -> dict:
    await register(flow, IMAGE, "/api/static/uploads/neu-2.png")
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = ok(await flow.post("/api/games", json=GAME))
    saved = ok(await flow.put(f"/api/games/{game['id']}/equipment/categories", json={"categories": categories}))["categories"]
    return {"admin": admin, "game": game, "cats": {row["label"]: row["key"] for row in saved}}


def url(w: dict, rest: str = "") -> str:
    return f"/api/games/{w['game']['id']}/equipment{rest}"


async def add(flow, w: dict, category: str, name: str, **fields) -> dict:
    return ok(await flow.post(url(w), json={"category": w["cats"][category], "name": name, **fields}))


# ---------------------------------------------------------------- Kategorien

@pytest.mark.asyncio
async def test_a_game_starts_without_categories_and_offers_a_suggestion(flow):
    flow.act_as(await flow.add_staff())
    game = ok(await flow.post("/api/games", json=GAME))
    body = ok(await flow.get(f"/api/games/{game['id']}/equipment"))
    assert body["categories"] == [] and body["items"] == []
    assert [row["role"] for row in body["suggested_categories"]] == ["weapon", "attachment", "item", "item", "item"]
    assert [mode["mode"] for mode in body["game"]["modes"]] == ["stellung", "suchen"]


@pytest.mark.asyncio
async def test_categories_keep_their_key_when_renamed_and_adopt_it_by_name(flow):
    w = await setup(flow)
    key = w["cats"]["Waffen"]
    renamed = ok(await flow.put(url(w, "/categories"), json={"categories": [
        {"key": key, "label": "Primärwaffen", "role": "weapon"}, {"label": "aufsätze", "role": "attachment"},
        {"label": "Perks", "role": "item"}]}))["categories"]
    assert renamed[0] == {"key": key, "label": "Primärwaffen", "role": "weapon", "subcategories": []}
    assert renamed[1]["key"] == w["cats"]["Aufsätze"], "gleicher Name ohne Kennung behält die Kennung"
    audit = await flow.db.audit_logs.find_one({"action": "game.equipment.categories"}, {"_id": 0})
    assert audit["target_id"] == w["game"]["id"] and "label" not in str(audit["data"])


@pytest.mark.asyncio
async def test_a_category_with_entries_cannot_be_removed_or_change_its_role(flow):
    w = await setup(flow)
    await add(flow, w, "Perks", "Leise Sohlen")
    removed = await flow.put(url(w, "/categories"), json={"categories": CATEGORIES[:2]})
    assert removed.status_code == 409 and "1 Eintrag" in removed.json()["detail"]
    rerole = await flow.put(url(w, "/categories"), json={"categories": [*CATEGORIES[:2], {"key": w["cats"]["Perks"], "label": "Perks",
                                                                                          "role": "weapon"}]})
    assert rerole.status_code == 409
    # Ohne Einträge geht beides.
    ok(await flow.put(url(w, "/categories"), json={"categories": [CATEGORIES[0], CATEGORIES[2]]}))


@pytest.mark.asyncio
async def test_category_names_are_unique_and_limited(flow):
    w = await setup(flow)
    twice = await flow.put(url(w, "/categories"), json={"categories": [{"label": "Waffen", "role": "weapon"},
                                                                       {"label": " waffen ", "role": "item"}]})
    assert twice.status_code == 422 and "zweimal" in twice.json()["detail"]
    many = await flow.put(url(w, "/categories"), json={"categories": [{"label": f"Art {index}", "role": "item"} for index in range(21)]})
    assert many.status_code == 422 and "20" in many.json()["detail"]


# ---------------------------------------------------------------- Einträge

@pytest.mark.asyncio
async def test_an_entry_has_image_note_and_a_name_once_per_category(flow):
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9", image_url=IMAGE, note="nur intern")
    assert (weapon["status"], weapon["image_url"], weapon["note"], weapon["created_by"]) == ("active", IMAGE, "nur intern", w["admin"]["id"])
    twice = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "  blitz   9 "})
    assert twice.status_code == 409 and "Waffen" in twice.json()["detail"]
    # Derselbe Name in einer anderen Kategorie ist ein anderer Eintrag.
    perk = await add(flow, w, "Perks", "Blitz 9")
    assert perk["category"] == w["cats"]["Perks"]
    listed = ok(await flow.get(url(w)))
    assert [row["name"] for row in listed["items"]] == ["Blitz 9", "Blitz 9"]
    assert listed["items"][0]["in_lists"] == 0 and listed["categories"][0]["count"] == 1


@pytest.mark.asyncio
async def test_a_foreign_image_and_an_unknown_category_are_refused(flow):
    w = await setup(flow)
    foreign = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "Fremd", "image_url": "https://example.test/x.png"})
    assert foreign.status_code == 422 and "Hochladen" in foreign.json()["detail"]
    unknown = await flow.post(url(w), json={"category": "gibt-es-nicht", "name": "Fremd"})
    assert unknown.status_code == 422


@pytest.mark.asyncio
async def test_an_image_needs_its_entry_in_the_media_library(flow):
    """Nur das Format zu prüfen reicht nicht (Review C.4): Eine Adresse ohne Eintrag in der Mediathek nimmt die Bibliothek nicht."""
    w = await setup(flow)
    unknown = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "Ohne Eintrag",
                                            "image_url": "/api/static/uploads/gibt-es-nicht.webp"})
    weapon = await add(flow, w, "Waffen", "Blitz 9")
    changed = await flow.patch(url(w, f"/{weapon['id']}"), json={"image_url": "/api/static/uploads/gibt-es-nicht.webp"})
    assert (unknown.status_code, changed.status_code) == (422, 422)
    assert "Mediathek" in unknown.json()["detail"]


@pytest.mark.asyncio
async def test_without_a_media_role_only_own_uploads_go_in(flow):
    """Wie im Regelwerk (#2230): Wer die Bibliothek über eine Freigabe pflegt, aber keine Medienrolle hat, nimmt nur eigene Bilder."""
    w = await setup(flow)
    keeper = await flow.add_user(name="Freigabe Turnierleitung")
    await flow.db.users.update_one({"id": keeper["id"]}, {"$set": {"areas": ["tournaments"]}})
    keeper["areas"] = ["tournaments"]
    own, other = "/api/static/uploads/eigen-3.png", "/api/static/uploads/fremd-4.png"
    await register(flow, own, scope="user", owner=keeper["id"])
    await register(flow, other, scope="user", owner="jemand-anders")
    weapon = await add(flow, w, "Waffen", "Blitz 9", image_url=IMAGE)
    flow.act_as(keeper)
    created = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "Eigen", "image_url": own})
    refused = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "Fremd", "image_url": other})
    club = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "Verein", "image_url": IMAGE})
    renamed = await flow.patch(url(w, f"/{weapon['id']}"), json={"name": "Blitz X", "image_url": IMAGE})
    assert created.status_code == 200, created.text
    assert (refused.status_code, club.status_code) == (422, 422)
    assert renamed.status_code == 200, "ein Bild, das der Eintrag schon hat, bleibt"


@pytest.mark.asyncio
async def test_import_skips_an_image_without_entry_in_the_media_library(flow):
    w = await setup(flow)
    await flow.db.game_equipment.insert_one({"id": "alt", "game_id": w["game"]["id"], "category": w["cats"]["Perks"], "name": "Altbild",
                                             "name_key": "altbild", "image_url": "/api/static/uploads/weg-5.webp", "status": "active",
                                             "weapon_ids": []})
    target = ok(await flow.post("/api/games", json={**GAME, "name": "Probe Shooter 2"}))
    result = ok(await flow.post(f"/api/games/{target['id']}/equipment/import", json={"source_game_id": w["game"]["id"], "item_ids": ["alt"]}))
    assert result["created"] == [] and "Mediathek" in result["skipped"][0]["reason"]


@pytest.mark.asyncio
async def test_attachments_without_weapon_get_weapons_in_one_step(flow):
    """Wie „Maps ohne Modus“: Aufsätze ohne Waffe passen zu keiner; ein Schritt ordnet ihnen die gewählten Waffen zu (Obmann, 03.11.)."""
    w = await setup(flow)
    blitz, donner = await add(flow, w, "Waffen", "Blitz 9"), await add(flow, w, "Waffen", "Donner 4")
    perk = await add(flow, w, "Perks", "Leise Sohlen")
    lone = [await add(flow, w, "Aufsätze", name) for name in ("Griff", "Lauf")]
    done = await add(flow, w, "Aufsätze", "Rotpunkt", weapon_ids=[blitz["id"]])
    archived = await add(flow, w, "Aufsätze", "Alt")
    ok(await flow.patch(url(w, f"/{archived['id']}"), json={"status": "archived"}))

    answer = ok(await flow.post(url(w, "/assign-weapons"), json={"weapon_ids": [blitz["id"], donner["id"]]}))
    assert answer["updated"] == 2
    for row in lone:
        assert (await flow.db.game_equipment.find_one({"id": row["id"]}))["weapon_ids"] == [blitz["id"], donner["id"]]
    assert (await flow.db.game_equipment.find_one({"id": done["id"]}))["weapon_ids"] == [blitz["id"]], "Zugeordnete bleiben"
    assert (await flow.db.game_equipment.find_one({"id": archived["id"]}))["weapon_ids"] == [], "Archivierte bleiben"
    assert ok(await flow.get(url(w)))["attachments_without_weapon"] == []
    wrong = await flow.post(url(w, "/assign-weapons"), json={"weapon_ids": [perk["id"]]})
    empty = await flow.post(url(w, "/assign-weapons"), json={"weapon_ids": []})
    assert (wrong.status_code, empty.status_code) == (422, 422)
    assert await flow.db.audit_logs.count_documents({"action": "game.equipment.assign_weapons"}) == 1


@pytest.mark.asyncio
async def test_an_attachment_belongs_to_weapons_of_the_same_game_only(flow):
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9")
    perk = await add(flow, w, "Perks", "Leise Sohlen")
    scope = await add(flow, w, "Aufsätze", "Rotpunkt", weapon_ids=[weapon["id"], weapon["id"]])
    assert scope["weapon_ids"] == [weapon["id"]]
    grip = await add(flow, w, "Aufsätze", "Griff")
    assert grip["weapon_ids"] == [], "speichern geht - leer heißt aber: passt zu keiner Waffe"
    listed = ok(await flow.get(url(w)))
    assert listed["attachments_without_weapon"] == [{"id": grip["id"], "name": "Griff"}]
    no_weapon = await flow.post(url(w), json={"category": w["cats"]["Aufsätze"], "name": "Lauf", "weapon_ids": [perk["id"]]})
    assert no_weapon.status_code == 422
    on_perk = await flow.post(url(w), json={"category": w["cats"]["Perks"], "name": "Zäh", "weapon_ids": [weapon["id"]]})
    assert on_perk.status_code == 422 and "Nur Aufsätze" in on_perk.json()["detail"]


@pytest.mark.asyncio
async def test_an_entry_changes_name_image_and_state_and_remembers_old_images(flow):
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9", image_url=IMAGE)
    changed = ok(await flow.patch(url(w, f"/{weapon['id']}"), json={"name": "Blitz X", "image_url": "/api/static/uploads/neu-2.png",
                                                                    "status": "inactive"}))
    assert (changed["name"], changed["status"]) == ("Blitz X", "inactive")
    stored = await flow.db.game_equipment.find_one({"id": weapon["id"]}, {"_id": 0})
    assert stored["image_history"] == [IMAGE] and stored["name_key"] == "blitz x"
    archived = ok(await flow.patch(url(w, f"/{weapon['id']}"), json={"status": "archived"}))
    assert archived["status"] == "archived" and archived["archived_at"]
    audit = await flow.db.audit_logs.find_one({"action": "game.equipment.update"}, {"_id": 0})
    assert audit["data"]["fields"] == ["image_url", "name", "status"]


@pytest.mark.asyncio
async def test_deleting_a_weapon_drops_it_from_attachments(flow):
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9")
    other = await add(flow, w, "Waffen", "Donner 4")
    scope = await add(flow, w, "Aufsätze", "Rotpunkt", weapon_ids=[weapon["id"], other["id"]])
    ok(await flow.delete(url(w, f"/{weapon['id']}")))
    assert (await flow.db.game_equipment.find_one({"id": scope["id"]}))["weapon_ids"] == [other["id"]]
    assert await flow.db.game_equipment.count_documents({"id": weapon["id"]}) == 0


@pytest.mark.asyncio
async def test_an_entry_on_a_saved_ban_list_is_archived_not_deleted(flow):
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9")
    await flow.db.loadout_bans.insert_one({"id": new_id(), "scope": "league_season", "scope_id": "s1", "game_id": w["game"]["id"],
                                           "version": 1, "entries": [{"kind": "item", "item_id": weapon["id"], "name": "Blitz 9"}]})
    refused = await flow.delete(url(w, f"/{weapon['id']}"))
    assert refused.status_code == 409 and "archivieren" in refused.json()["detail"]
    assert ok(await flow.get(url(w)))["items"][0]["in_lists"] == 1


@pytest.mark.asyncio
async def test_an_attachment_on_a_saved_ban_list_counts_as_used(flow):
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9")
    scope = await add(flow, w, "Aufsätze", "Rotpunkt")
    await flow.db.loadout_bans.insert_one({"id": new_id(), "scope": "league_season", "scope_id": "s1", "game_id": w["game"]["id"],
                                           "version": 1, "entries": [{"kind": "attachments", "item_id": weapon["id"],
                                                                      "attachments": [{"item_id": scope["id"]}]}]})
    refused = await flow.delete(url(w, f"/{scope['id']}"))
    assert refused.status_code == 409


# ---------------------------------------------------------------- Rechte

@pytest.mark.asyncio
async def test_only_who_may_keep_games_keeps_the_library(flow):
    w = await setup(flow)
    league_lead = await flow.add_user(name="Liga-Leitung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": league_lead["id"], "capabilities": ["season"]})
    for person in (await flow.add_user(name="Spieler"), league_lead):
        flow.act_as(person)
        assert (await flow.get(url(w))).status_code == 403
        created = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "X"})
        changed = await flow.put(url(w, "/categories"), json={"categories": []})
        assert (created.status_code, changed.status_code) == (403, 403)
    flow.act_as(None)
    assert (await flow.get(url(w))).status_code == 401


# ---------------------------------------------------------------- Aus einer anderen Spielversion

@pytest.mark.asyncio
async def test_import_brings_categories_weapons_and_their_attachments(flow):
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9", image_url=IMAGE)
    other = await add(flow, w, "Waffen", "Donner 4")
    scope = await add(flow, w, "Aufsätze", "Rotpunkt", weapon_ids=[weapon["id"]])
    lonely = await add(flow, w, "Aufsätze", "Lauf", weapon_ids=[other["id"]])
    perk = await add(flow, w, "Perks", "Leise Sohlen")
    archived = await add(flow, w, "Perks", "Alt")
    ok(await flow.patch(url(w, f"/{archived['id']}"), json={"status": "archived"}))
    target = ok(await flow.post("/api/games", json={**GAME, "name": "Probe Shooter 2"}))
    target_url = f"/api/games/{target['id']}/equipment"

    sources = ok(await flow.get(f"{target_url}/import-sources"))
    assert [row["items"] for row in sources if row["id"] == w["game"]["id"]] == [5]
    candidates = ok(await flow.get(f"{target_url}/import-sources/{w['game']['id']}"))["items"]
    assert {row["name"] for row in candidates} == {"Blitz 9", "Donner 4", "Rotpunkt", "Lauf", "Leise Sohlen"}

    result = ok(await flow.post(f"{target_url}/import", json={"source_game_id": w["game"]["id"],
                                                               "item_ids": [scope["id"], weapon["id"], perk["id"], lonely["id"], archived["id"]]}))
    assert sorted(row["name"] for row in result["created"]) == ["Blitz 9", "Lauf", "Leise Sohlen", "Rotpunkt"]
    assert result["skipped"] == []
    # Ohne seine Waffe kommt der Aufsatz ohne Zuordnung - er passt dann zu keiner, und die Bibliothek weist darauf hin.
    assert next(row for row in result["created"] if row["name"] == "Lauf")["weapon_ids"] == []
    assert [row["name"] for row in ok(await flow.get(target_url))["attachments_without_weapon"]] == ["Lauf"]
    new_weapon = next(row for row in result["created"] if row["name"] == "Blitz 9")
    new_scope = next(row for row in result["created"] if row["name"] == "Rotpunkt")
    assert new_scope["weapon_ids"] == [new_weapon["id"]] and new_weapon["image_url"] == IMAGE
    assert [row["label"] for row in result["categories"]] == ["Waffen", "Aufsätze", "Perks"]

    again = ok(await flow.post(f"{target_url}/import", json={"source_game_id": w["game"]["id"], "item_ids": [weapon["id"]]}))
    assert again["created"] == [] and "schon" in again["skipped"][0]["reason"]
    itself = await flow.post(f"{target_url}/import", json={"source_game_id": target["id"], "item_ids": ["x"]})
    assert itself.status_code == 422


@pytest.mark.asyncio
async def test_a_game_with_entries_cannot_be_deleted(flow):
    w = await setup(flow)
    await add(flow, w, "Waffen", "Blitz 9")
    refused = await flow.delete(f"/api/games/{w['game']['id']}")
    assert refused.status_code == 409 and "Ausrüstungs-Eintrag" in refused.json()["detail"]
