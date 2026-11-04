"""Unterkategorien der Ausrüstung (docs/LIGA.md, C.4 #2287) - durch die echten Routen.

Eine Ebene Kategorie → Unterkategorie → Eintrag: anlegen, umbenennen (Kennung bleibt), ordnen, entfernen nur leer, Kennung nie neu
vergeben, Grenzen, Symbol nur aus dem eigenen Upload, Einträge zuordnen und verschieben, Aufsätze passen über Waffenklassen, Import mit
Unterkategorie, Altbestand ohne Unterkategorie unverändert. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_start_world import ok  # noqa: E402

GAME = {"name": "Probe Shooter", "match_modes": [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen"}]}
ICON = "/api/static/uploads/klasse-1.png"
CATEGORIES = [{"label": "Waffen", "role": "weapon"}, {"label": "Aufsätze", "role": "attachment"}, {"label": "Perks", "role": "item"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def register(flow, *urls: str) -> None:
    for url in urls:
        # Zwei Spiele im selben Test (Import): die Datei steht nur einmal in der Mediathek (eindeutiger Index im echten MongoDB).
        if await flow.db.media_uploads.find_one({"filename": url.rsplit("/", 1)[-1]}):
            continue
        await flow.db.media_uploads.insert_one({"id": new_id(), "filename": url.rsplit("/", 1)[-1], "url": url, "media_type": "image",
                                                "media_scope": "admin", "owner_role": "admin"})


async def setup(flow, name: str = "Probe Shooter") -> dict:
    await register(flow, ICON)
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = ok(await flow.post("/api/games", json={**GAME, "name": name}))
    saved = ok(await flow.put(f"/api/games/{game['id']}/equipment/categories", json={"categories": CATEGORIES}))["categories"]
    return {"admin": admin, "game": game, "cats": {row["label"]: row["key"] for row in saved}}


def url(w: dict, rest: str = "") -> str:
    return f"/api/games/{w['game']['id']}/equipment{rest}"


def subs_url(w: dict, category: str) -> str:
    return url(w, f"/categories/{w['cats'][category]}/subcategories")


async def save_subs(flow, w: dict, category: str, rows: list[dict]):
    return await flow.put(subs_url(w, category), json={"subcategories": rows})


async def add(flow, w: dict, category: str, name: str, **fields) -> dict:
    return ok(await flow.post(url(w), json={"category": w["cats"][category], "name": name, **fields}))


async def library(flow, w: dict) -> dict:
    return ok(await flow.get(url(w)))


def subs_of(body: dict, w: dict, category: str) -> list[dict]:
    return next(row for row in body["categories"] if row["key"] == w["cats"][category])["subcategories"]


# ---------------------------------------------------------------- Unterkategorien pflegen

@pytest.mark.asyncio
async def test_subcategories_are_created_renamed_ordered_and_keep_their_key(flow):
    w = await setup(flow)
    saved = ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}, {"label": "Schrotflinte", "icon_url": ICON}]))
    keys = {row["label"]: row["key"] for row in saved["subcategories"]}
    assert [row["label"] for row in saved["subcategories"]] == ["Sturmgewehr", "Schrotflinte"]
    assert saved["subcategories"][1]["icon_url"] == ICON
    body = await library(flow, w)
    assert [row["label"] for row in subs_of(body, w, "Waffen")] == ["Sturmgewehr", "Schrotflinte"]
    assert subs_of(body, w, "Perks") == []

    renamed = ok(await save_subs(flow, w, "Waffen", [{"key": keys["Schrotflinte"], "label": "Flinte", "icon_url": ICON},
                                                     {"key": keys["Sturmgewehr"], "label": "Sturmgewehr"}]))["subcategories"]
    assert [(row["key"], row["label"]) for row in renamed] == [(keys["Schrotflinte"], "Flinte"), (keys["Sturmgewehr"], "Sturmgewehr")]
    audit = await flow.db.audit_logs.find_one({"action": "game.equipment.subcategories"}, {"_id": 0})
    assert audit["target_id"] == w["game"]["id"] and "Flinte" not in str(audit["data"]), "ohne Werte aus der Anfrage"


@pytest.mark.asyncio
async def test_saving_the_categories_keeps_their_subcategories(flow):
    w = await setup(flow)
    ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}]))
    ok(await flow.put(url(w, "/categories"), json={"categories": [
        {"key": w["cats"]["Waffen"], "label": "Primärwaffen", "role": "weapon"}, {"key": w["cats"]["Aufsätze"], "label": "Aufsätze", "role": "attachment"},
        {"key": w["cats"]["Perks"], "label": "Perks", "role": "item"}]}))
    assert [row["label"] for row in subs_of(await library(flow, w), w, "Waffen")] == ["Sturmgewehr"]


@pytest.mark.asyncio
async def test_a_subcategory_with_entries_cannot_be_removed_and_a_key_is_never_given_again(flow):
    w = await setup(flow)
    keys = {row["label"]: row["key"] for row in ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}, {"label": "Pistole"}]))["subcategories"]}
    await add(flow, w, "Waffen", "Blitz 9", subcategory=keys["Sturmgewehr"])
    refused = await save_subs(flow, w, "Waffen", [{"key": keys["Pistole"], "label": "Pistole"}])
    assert refused.status_code == 409 and "Sturmgewehr" in refused.json()["detail"] and "1 Eintrag" in refused.json()["detail"]

    ok(await save_subs(flow, w, "Waffen", [{"key": keys["Sturmgewehr"], "label": "Sturmgewehr"}]))
    again = ok(await save_subs(flow, w, "Waffen", [{"key": keys["Sturmgewehr"], "label": "Sturmgewehr"}, {"label": "Pistole"}]))
    new_key = again["subcategories"][1]["key"]
    assert new_key != keys["Pistole"], "eine entfernte Kennung wird nie neu vergeben"
    # Über Kategorien hinweg ist die Kennung je Spiel eindeutig - Waffenklassen der Aufsätze nennen nur sie.
    other = ok(await save_subs(flow, w, "Aufsätze", [{"label": "Sturmgewehr"}]))["subcategories"][0]["key"]
    assert other != keys["Sturmgewehr"]


@pytest.mark.asyncio
async def test_subcategory_rules_and_limits(flow):
    w = await setup(flow)
    assert (await save_subs(flow, w, "Waffen", [{"label": "Pistole"}, {"label": " pistole "}])).status_code == 422
    assert (await save_subs(flow, w, "Waffen", [{"label": "   "}])).status_code == 422
    assert (await save_subs(flow, w, "Waffen", [{"key": "gibt-es-nicht", "label": "X"}])).status_code == 409
    assert (await save_subs(flow, w, "Waffen", [{"label": "x" * 41}])).status_code == 422
    too_many = await save_subs(flow, w, "Waffen", [{"label": f"Klasse {index}"} for index in range(31)])
    assert too_many.status_code == 422 and "30" in too_many.json()["detail"]
    foreign = await save_subs(flow, w, "Waffen", [{"label": "Pistole", "icon_url": "https://example.test/x.png"}])
    assert foreign.status_code == 422
    unknown = await save_subs(flow, w, "Waffen", [{"label": "Pistole", "icon_url": "/api/static/uploads/fremd-9.png"}])
    assert unknown.status_code == 422 and "Mediathek" in unknown.json()["detail"]
    missing = await flow.put(url(w, "/categories/gibt-es-nicht/subcategories"), json={"subcategories": []})
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_suggestions_are_generic_words_per_role_and_saved_only_on_request(flow):
    w = await setup(flow)
    body = await library(flow, w)
    assert "Sturmgewehr" in body["suggested_subcategories"]["weapon"] and "Optik" in body["suggested_subcategories"]["attachment"]
    assert body["suggested_subcategories"]["item"] == []
    assert subs_of(body, w, "Waffen") == [] and body["subcategories_limit"] == 30


@pytest.mark.asyncio
async def test_rights_are_those_of_the_library(flow):
    w = await setup(flow)
    flow.act_as(await flow.add_user())
    assert (await save_subs(flow, w, "Waffen", [{"label": "Pistole"}])).status_code == 403
    assert (await flow.post(url(w, "/move"), json={"item_ids": ["x"], "subcategory": None})).status_code == 403


# ---------------------------------------------------------------- Einträge zuordnen

@pytest.mark.asyncio
async def test_entries_get_a_subcategory_of_their_own_category_and_move_together(flow):
    w = await setup(flow)
    keys = {row["label"]: row["key"] for row in ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}, {"label": "Pistole"}]))["subcategories"]}
    perk_key = ok(await save_subs(flow, w, "Perks", [{"label": "Rot"}]))["subcategories"][0]["key"]
    blitz = await add(flow, w, "Waffen", "Blitz 9", subcategory=keys["Sturmgewehr"])
    donner = await add(flow, w, "Waffen", "Donner 4")
    assert blitz["subcategory"] == keys["Sturmgewehr"] and donner["subcategory"] is None
    wrong = await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "Falsch", "subcategory": perk_key})
    assert wrong.status_code == 422

    changed = ok(await flow.patch(url(w, f"/{blitz['id']}"), json={"subcategory": keys["Pistole"]}))
    assert changed["subcategory"] == keys["Pistole"]
    cleared = ok(await flow.patch(url(w, f"/{blitz['id']}"), json={"subcategory": None}))
    assert cleared["subcategory"] is None

    moved = ok(await flow.post(url(w, "/move"), json={"item_ids": [blitz["id"], donner["id"]], "subcategory": keys["Sturmgewehr"]}))
    assert moved == {"updated": 2}
    rows = {row["name"]: row for row in (await library(flow, w))["items"]}
    assert rows["Blitz 9"]["subcategory"] == rows["Donner 4"]["subcategory"] == keys["Sturmgewehr"]
    perk = await add(flow, w, "Perks", "Leise")
    mixed = await flow.post(url(w, "/move"), json={"item_ids": [blitz["id"], perk["id"]], "subcategory": None})
    assert mixed.status_code == 422 and "Kategorie" in mixed.json()["detail"]
    assert (await flow.post(url(w, "/move"), json={"item_ids": [blitz["id"]], "subcategory": perk_key})).status_code == 422
    audit = await flow.db.audit_logs.find_one({"action": "game.equipment.move"}, {"_id": 0})
    assert audit["data"] == {"items": 2}


@pytest.mark.asyncio
async def test_old_entries_without_subcategory_stay_valid(flow):
    """Altbestand von vor #2287: kein Feld ``subcategory`` und ``weapon_class_ids`` - lesen, ändern, Nr. 81 wie bisher."""
    w = await setup(flow)
    weapon = await add(flow, w, "Waffen", "Blitz 9")
    lonely = await add(flow, w, "Aufsätze", "Kompensator")
    await flow.db.game_equipment.update_many({"game_id": w["game"]["id"]}, {"$unset": {"subcategory": "", "weapon_class_ids": ""}})
    body = await library(flow, w)
    rows = {row["name"]: row for row in body["items"]}
    assert rows["Blitz 9"]["subcategory"] is None and rows["Kompensator"]["weapon_class_ids"] == []
    assert [row["id"] for row in body["attachments_without_weapon"]] == [lonely["id"]]
    assert ok(await flow.patch(url(w, f"/{weapon['id']}"), json={"name": "Blitz 10"}))["name"] == "Blitz 10"


# ---------------------------------------------------------------- Aufsätze passen zu Waffenklassen

@pytest.mark.asyncio
async def test_an_attachment_fits_a_weapon_class_and_new_weapons_of_it(flow):
    w = await setup(flow)
    rifle = ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}]))["subcategories"][0]["key"]
    optic = ok(await save_subs(flow, w, "Aufsätze", [{"label": "Optik"}]))["subcategories"][0]["key"]
    sight = await add(flow, w, "Aufsätze", "Rotpunkt", subcategory=optic, weapon_class_ids=[rifle])
    assert sight["weapon_class_ids"] == [rifle] and sight["weapon_ids"] == []
    body = await library(flow, w)
    assert body["attachments_without_weapon"] == [], "eine Klasse ist eine Zuordnung"
    # Nur Waffenklassen: eine Unterkategorie der Aufsätze ist keine.
    assert (await flow.post(url(w), json={"category": w["cats"]["Aufsätze"], "name": "X", "weapon_class_ids": [optic]})).status_code == 422
    assert (await flow.post(url(w), json={"category": w["cats"]["Waffen"], "name": "Y", "weapon_class_ids": [rifle]})).status_code == 422

    from services import game_equipment

    later = await add(flow, w, "Waffen", "Neu 1", subcategory=rifle)
    other = await add(flow, w, "Waffen", "Andere")
    stored = await flow.db.game_equipment.find_one({"id": sight["id"]}, {"_id": 0})
    assert game_equipment.fits(stored, later) is True, "eine neue Waffe der Klasse passt sofort"
    assert game_equipment.fits(stored, other) is False
    # Nr. 81: ohne Waffe und ohne Klasse passt ein Aufsatz zu keiner.
    assert game_equipment.fits({"weapon_ids": [], "weapon_class_ids": []}, later) is False


@pytest.mark.asyncio
async def test_removing_a_weapon_class_drops_it_from_attachments(flow):
    w = await setup(flow)
    keys = {row["label"]: row["key"] for row in ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}, {"label": "Pistole"}]))["subcategories"]}
    sight = await add(flow, w, "Aufsätze", "Rotpunkt", weapon_class_ids=[keys["Sturmgewehr"], keys["Pistole"]])
    ok(await save_subs(flow, w, "Waffen", [{"key": keys["Sturmgewehr"], "label": "Sturmgewehr"}]))
    stored = await flow.db.game_equipment.find_one({"id": sight["id"]}, {"_id": 0})
    assert stored["weapon_class_ids"] == [keys["Sturmgewehr"]]


@pytest.mark.asyncio
async def test_assigning_weapons_in_bulk_also_takes_classes(flow):
    w = await setup(flow)
    rifle = ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}]))["subcategories"][0]["key"]
    lonely = await add(flow, w, "Aufsätze", "Kompensator")
    assert ok(await flow.post(url(w, "/assign-weapons"), json={"weapon_ids": [], "weapon_class_ids": [rifle]})) == {"updated": 1}
    stored = await flow.db.game_equipment.find_one({"id": lonely["id"]}, {"_id": 0})
    assert stored["weapon_class_ids"] == [rifle] and stored["weapon_ids"] == []
    assert (await flow.post(url(w, "/assign-weapons"), json={"weapon_ids": [], "weapon_class_ids": []})).status_code == 422


# ---------------------------------------------------------------- Import

@pytest.mark.asyncio
async def test_import_brings_subcategories_and_weapon_classes_and_says_what_is_new(flow):
    source = await setup(flow, "Probe Alt")
    rifle = ok(await save_subs(flow, source, "Waffen", [{"label": "Sturmgewehr", "icon_url": ICON}]))["subcategories"][0]["key"]
    optic = ok(await save_subs(flow, source, "Aufsätze", [{"label": "Optik"}]))["subcategories"][0]["key"]
    blitz = await add(flow, source, "Waffen", "Blitz 9", subcategory=rifle)
    sight = await add(flow, source, "Aufsätze", "Rotpunkt", subcategory=optic, weapon_class_ids=[rifle])
    plain = await add(flow, source, "Perks", "Leise")

    target = await setup(flow, "Probe Neu")
    known = ok(await save_subs(flow, target, "Aufsätze", [{"label": "optik"}]))["subcategories"][0]["key"]
    flow.act_as(target["admin"])
    preview = {row["name"]: row for row in ok(await flow.get(url(target, f"/import-sources/{source['game']['id']}")))["items"]}
    assert (preview["Blitz 9"]["subcategory_label"], preview["Blitz 9"]["subcategory_new"]) == ("Sturmgewehr", True)
    assert (preview["Rotpunkt"]["subcategory_label"], preview["Rotpunkt"]["subcategory_new"]) == ("Optik", False)
    assert (preview["Leise"]["subcategory_label"], preview["Leise"]["subcategory_new"]) == (None, False)

    result = ok(await flow.post(url(target, "/import"), json={"source_game_id": source["game"]["id"],
                                                              "item_ids": [blitz["id"], sight["id"], plain["id"]]}))
    assert result["skipped"] == [] and result["notes"] == []
    body = await library(flow, target)
    created = subs_of(body, target, "Waffen")
    assert [(row["label"], row["icon_url"]) for row in created] == [("Sturmgewehr", ICON)]
    rows = {row["name"]: row for row in body["items"]}
    assert rows["Blitz 9"]["subcategory"] == created[0]["key"]
    assert rows["Rotpunkt"]["subcategory"] == known, "über den Namen gefunden"
    assert rows["Rotpunkt"]["weapon_class_ids"] == [created[0]["key"]]
    assert rows["Leise"]["subcategory"] is None


@pytest.mark.asyncio
async def test_import_without_room_for_a_subcategory_says_so(flow):
    source = await setup(flow, "Probe Alt")
    rifle = ok(await save_subs(flow, source, "Waffen", [{"label": "Sturmgewehr"}]))["subcategories"][0]["key"]
    blitz = await add(flow, source, "Waffen", "Blitz 9", subcategory=rifle)
    target = await setup(flow, "Probe Neu")
    ok(await save_subs(flow, target, "Waffen", [{"label": f"Klasse {index}"} for index in range(30)]))
    result = ok(await flow.post(url(target, "/import"), json={"source_game_id": source["game"]["id"], "item_ids": [blitz["id"]]}))
    assert len(result["created"]) == 1 and result["created"][0]["subcategory"] is None
    assert result["notes"][0]["name"] == "Blitz 9" and "Sturmgewehr" in result["notes"][0]["reason"]


# ---------------------------------------------------------------- Mediathek

@pytest.mark.asyncio
async def test_the_icon_of_a_subcategory_is_a_usage_in_the_media_library(flow):
    from services import media_audit

    w = await setup(flow)
    ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr", "icon_url": ICON}]))
    places = {(collection, field) async for collection, _doc, field, _name, _text in media_audit.iter_usages(flow.db, {"klasse-1.png"})}
    assert ("game_equipment_categories", "categories.subcategories.icon_url") in places
    assert await media_audit.still_referenced(flow.db, {"klasse-1.png"}) == {"klasse-1.png"}


# ---------------------------------------------------------------- Gleichzeitig (Codex Runde 1, Fund 2)

@pytest.mark.asyncio
async def test_deleting_a_subcategory_while_moving_into_it_leaves_no_retired_key(flow, monkeypatch):
    """Löscht A eine leere Unterkategorie, während B Einträge dorthin verschiebt, darf B nie die entfernte Kennung schreiben - eine Seite
    bekommt eine Absage."""
    import asyncio

    from services import game_equipment

    w = await setup(flow)
    keys = {row["label"]: row["key"] for row in ok(await save_subs(flow, w, "Waffen", [{"label": "Sturmgewehr"}, {"label": "Pistole"}]))["subcategories"]}
    blitz = await add(flow, w, "Waffen", "Blitz 9")
    original = game_equipment.subcategory_counts

    async def slow_counts(db, game_id):
        counts = await original(db, game_id)
        await asyncio.sleep(0.3)  # das Fenster zwischen Prüfen und Schreiben
        return counts

    monkeypatch.setattr(game_equipment, "subcategory_counts", slow_counts)
    # Die Sperre lebt vom eindeutigen Index (init_indexes) - im Speicher-Mongo hier von Hand.
    await flow.db.mutation_locks.create_index("resource", unique=True)
    remove, move = await asyncio.gather(
        save_subs(flow, w, "Waffen", [{"key": keys["Sturmgewehr"], "label": "Sturmgewehr"}]),
        flow.post(url(w, "/move"), json={"item_ids": [blitz["id"]], "subcategory": keys["Pistole"]}))
    doc = await flow.db.game_equipment_categories.find_one({"game_id": w["game"]["id"]}, {"_id": 0})
    stored = await flow.db.game_equipment.find_one({"id": blitz["id"]}, {"_id": 0})
    assert stored.get("subcategory") not in (doc.get("retired_subcategory_keys") or []), (remove.text, move.text)
    assert sorted([remove.status_code, move.status_code]) in ([200, 409], [200, 422])