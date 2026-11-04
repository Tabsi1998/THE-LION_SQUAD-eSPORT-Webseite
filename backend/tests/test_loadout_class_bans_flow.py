"""Ganze Klassen sperren und das Regelwerk gruppiert (docs/LIGA.md, C.4 #2287) - durch die echten Routen.

Eine Unterkategorie ganz sperren, auch je Modus; später angelegte Einträge sind mitgesperrt (Ligaseite, Matchseite, Regelwerk) und lösen
„Regelwerk muss freigegeben werden“ aus. Die Version hält Klasse und Einträge zum Zeitpunkt fest. Aufsätze passen über Waffenklassen,
Nr. 81 gilt weiter. Altbestand ohne Unterkategorie und alte Fassungen bleiben unverändert. Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import GAME_ID, duel, ids, two_nil, world as match_world  # noqa: E402
from league_rules_world import make_world, publish, season_page, season_scope  # noqa: E402
from league_start_world import ok  # noqa: E402
from loadout_world import IMAGE, add_library, attachments, bans_url, item, save_bans, standard  # noqa: E402
from models import now_utc  # noqa: E402

BODY = "Vorwort.\n\n# § 1 Fairplay\nFair spielen.\n"
ANNEX = [{"title": "Sperrliste", "body_md": "[[baustein:loadout_bans]]"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def ready(flow) -> dict:
    """Bibliothek aus ``loadout_world`` plus Waffenklassen Sturmgewehr (Blitz 9) und Schrotflinte (Hagel, Bö) sowie die leere Klasse
    Raketenwerfer."""
    w = await make_world(flow)
    await add_library(flow, w)
    saved = ok(await flow.put(f"{w['library_url']}/categories/{w['cats']['Waffen']}/subcategories", json={"subcategories": [
        {"label": "Sturmgewehr"}, {"label": "Schrotflinte"}, {"label": "Raketenwerfer"}]}))["subcategories"]
    w["subs"] = {row["label"]: row["key"] for row in saved}
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Blitz 9']['id']}", json={"subcategory": w["subs"]["Sturmgewehr"]}))
    for name in ("Hagel", "Bö"):
        w["items"][name] = ok(await flow.post(w["library_url"], json={"category": w["cats"]["Waffen"], "name": name,
                                                                       "subcategory": w["subs"]["Schrotflinte"]}))
    return w


def klass(w: dict, label: str, modes=()) -> dict:
    return {"kind": "class", "subcategory": w["subs"][label], "modes": list(modes)}


async def add_weapon(flow, w: dict, name: str, label: str) -> dict:
    flow.act_as(w["lead"])
    w["items"][name] = ok(await flow.post(w["library_url"], json={"category": w["cats"]["Waffen"], "name": name,
                                                                   "subcategory": w["subs"][label]}))
    return w["items"][name]


def public_url(w: dict) -> str:
    return f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"


# ---------------------------------------------------------------- Speichern

@pytest.mark.asyncio
async def test_a_class_ban_holds_the_class_and_its_entries_at_the_time(flow):
    w = await ready(flow)
    saved = ok(await save_bans(flow, w, [klass(w, "Schrotflinte", ["suchen"]), item(w, "Leise Sohlen")]))
    row = next(row for row in saved["entries"] if row["kind"] == "class")
    assert (row["subcategory"], row["subcategory_label"], row["name"], row["category_label"]) == (
        w["subs"]["Schrotflinte"], "Schrotflinte", "Schrotflinte", "Waffen")
    assert row["item_id"] is None and row["mode_labels"] == ["Suchen"]
    assert [entry["name"] for entry in row["items"]] == ["Bö", "Hagel"]
    stored = await flow.db.loadout_bans.find_one({"id": saved["id"]}, {"_id": 0})
    assert [entry["name"] for entry in next(e for e in stored["entries"] if e["kind"] == "class")["items"]] == ["Bö", "Hagel"]

    # Später neu in der Klasse: die gespeicherte Version bleibt, die Verwaltung sagt, was mitgesperrt ist.
    await add_weapon(flow, w, "Sturm 12", "Schrotflinte")
    stored = await flow.db.loadout_bans.find_one({"id": saved["id"]}, {"_id": 0})
    assert [entry["name"] for entry in next(e for e in stored["entries"] if e["kind"] == "class")["items"]] == ["Bö", "Hagel"]
    view = ok(await flow.get(bans_url(w)))
    assert view["list"]["class_new_items"] == [{"subcategory": w["subs"]["Schrotflinte"], "label": "Schrotflinte", "names": ["Sturm 12"]}]
    live = next(row for row in view["list"]["entries"] if row["kind"] == "class")
    assert [entry["name"] for entry in live["items"]] == ["Bö", "Hagel", "Sturm 12"]
    # Nr. 81 (Codex Runde 1): Der Kompensator passt zu keiner Waffe - der Editor nennt ihn, erlaubt ist er nicht.
    assert {"id": w["items"]["Kompensator"]["id"], "name": "Kompensator", "reason": "keiner Waffe zugeordnet"} in view["unusable_attachments"]
    # Der Editor kennt Unterkategorie und Waffenklassen der Bibliothek.
    hagel = next(row for row in view["library"] if row["name"] == "Hagel")
    assert hagel["subcategory"] == w["subs"]["Schrotflinte"] and hagel["weapon_class_ids"] == []
    assert [sub["label"] for sub in view["categories"][0]["subcategories"]] == ["Sturmgewehr", "Schrotflinte", "Raketenwerfer"]


@pytest.mark.asyncio
async def test_class_ban_rules(flow):
    w = await ready(flow)
    twice = await save_bans(flow, w, [klass(w, "Schrotflinte"), klass(w, "Schrotflinte", ["suchen"])])
    assert twice.status_code == 422 and "zweimal" in twice.json()["detail"]
    unknown = await save_bans(flow, w, [{"kind": "class", "subcategory": "gibt-es-nicht", "modes": []}])
    assert unknown.status_code == 422
    missing = await save_bans(flow, w, [{"kind": "class", "modes": []}])
    assert missing.status_code == 422
    # Einzelne Zeile in einer Klasse, die in allen Modi gesperrt ist: braucht es nicht.
    double = await save_bans(flow, w, [klass(w, "Schrotflinte"), item(w, "Hagel", ["suchen"])])
    assert double.status_code == 422 and "Schrotflinte" in double.json()["detail"]
    # Nur in einem Modus: einzeln zusätzlich geht.
    ok(await save_bans(flow, w, [klass(w, "Schrotflinte", ["suchen"]), item(w, "Hagel", ["stellung"])]))
    # Leere Klasse: geht - sie gilt ab dem ersten Eintrag.
    empty = ok(await save_bans(flow, w, [klass(w, "Raketenwerfer")]))
    assert empty["entries"][0]["items"] == []


@pytest.mark.asyncio
async def test_attachments_at_a_weapon_of_a_fully_banned_class_are_refused(flow):
    w = await ready(flow)
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Griff']['id']}", json={"weapon_class_ids": [w["subs"]["Schrotflinte"]]}))
    refused = await save_bans(flow, w, [klass(w, "Schrotflinte"), attachments(w, "Hagel", ["Griff"])])
    assert refused.status_code == 422 and "Schrotflinte" in refused.json()["detail"]
    ok(await save_bans(flow, w, [attachments(w, "Hagel", ["Griff"])]))


@pytest.mark.asyncio
async def test_an_attachment_fits_through_its_weapon_class_and_rule_81_stays(flow):
    w = await ready(flow)
    # Rotpunkt passt nur zu Blitz 9; über die Klasse Schrotflinte passt er auch zu Hagel und einer neuen Schrotflinte.
    refused = await save_bans(flow, w, [attachments(w, "Hagel", ["Rotpunkt"])])
    assert refused.status_code == 422 and "passt nicht" in refused.json()["detail"]
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Rotpunkt']['id']}", json={"weapon_class_ids": [w["subs"]["Schrotflinte"]]}))
    ok(await save_bans(flow, w, [attachments(w, "Hagel", ["Rotpunkt"])]))
    await add_weapon(flow, w, "Sturm 12", "Schrotflinte")
    ok(await save_bans(flow, w, [attachments(w, "Sturm 12", ["Rotpunkt"])]))
    # Nr. 81: ohne Waffe und ohne Klasse passt der Kompensator zu keiner.
    lonely = await save_bans(flow, w, [attachments(w, "Hagel", ["Kompensator"])])
    assert lonely.status_code == 422 and "keiner Waffe zugeordnet" in lonely.json()["detail"]


@pytest.mark.asyncio
async def test_items_carry_their_subcategory_and_old_snapshots_stay(flow):
    w = await ready(flow)
    saved = ok(await save_bans(flow, w, standard(w)))
    blitz = next(row for row in saved["entries"] if row["name"] == "Blitz 9")
    assert (blitz["subcategory"], blitz["subcategory_label"]) == (w["subs"]["Sturmgewehr"], "Sturmgewehr")
    sohlen = next(row for row in saved["entries"] if row["name"] == "Leise Sohlen")
    assert sohlen["subcategory"] is None
    # Eine Version von vor #2287 (ohne Felder) liest sich unverändert; die neue Zuordnung zählt als „geändert seit dieser Version“.
    stored = await flow.db.loadout_bans.find_one({"id": saved["id"]}, {"_id": 0})
    old = [{key: value for key, value in entry.items() if not key.startswith("subcategory")} for entry in stored["entries"]]
    await flow.db.loadout_bans.update_one({"id": saved["id"]}, {"$set": {"entries": old}})
    view = ok(await flow.get(bans_url(w)))
    assert [row["name"] for row in view["list"]["entries"]] == ["Blitz 9", "Leise Sohlen", "Donner 4"]
    assert view["list"]["entries"][0]["subcategory"] is None
    assert view["list"]["outdated_item_ids"] == [w["items"]["Blitz 9"]["id"]]


@pytest.mark.asyncio
async def test_compare_names_a_class_and_a_subcategory_used_by_a_version_stays(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, [item(w, "Leise Sohlen")]))
    ok(await save_bans(flow, w, [item(w, "Leise Sohlen"), klass(w, "Raketenwerfer", ["suchen"])]))
    diff = ok(await flow.get(f"{bans_url(w)}/compare?base=1&target=2"))
    assert [(row["kind"], row["name"], row["modes"]) for row in diff["added"]] == [("class", "Raketenwerfer", ["Suchen"])]
    flow.act_as(w["lead"])
    kept = await flow.put(f"{w['library_url']}/categories/{w['cats']['Waffen']}/subcategories", json={"subcategories": [
        {"key": w["subs"]["Sturmgewehr"], "label": "Sturmgewehr"}, {"key": w["subs"]["Schrotflinte"], "label": "Schrotflinte"}]})
    assert kept.status_code == 409 and "Raketenwerfer" in kept.json()["detail"] and "Sperrliste" in kept.json()["detail"]


@pytest.mark.asyncio
async def test_an_entry_of_a_class_in_a_saved_list_cannot_be_deleted(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, [klass(w, "Schrotflinte")]))
    flow.act_as(w["lead"])
    refused = await flow.delete(f"{w['library_url']}/{w['items']['Hagel']['id']}")
    assert refused.status_code == 409
    body = ok(await flow.get(w["library_url"]))
    assert next(row for row in body["items"] if row["name"] == "Hagel")["in_lists"] == 1


# ---------------------------------------------------------------- Zur Laufzeit

@pytest.mark.asyncio
async def test_the_public_season_shows_the_class_with_todays_entries(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, [klass(w, "Schrotflinte")]))
    await add_weapon(flow, w, "Sturm 12", "Schrotflinte")
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Bö']['id']}", json={"status": "archived"}))
    flow.act_as(None)
    public = ok(await flow.get(public_url(w)))["loadout_bans"]
    [row] = public["entries"]
    assert row["kind"] == "class" and row["subcategory_label"] == "Schrotflinte"
    assert [entry["name"] for entry in row["items"]] == ["Hagel", "Sturm 12"], "neu mitgesperrt, archiviert nicht mehr"


async def class_version(flow, tournament: dict, version: int) -> dict:
    doc = {"id": new_id(), "scope": "tournament", "scope_id": tournament["id"], "tournament_id": tournament["id"], "game_id": GAME_ID,
           "version": version, "cleared": False, "note": None, "created_at": now_utc().isoformat(), "created_by": "test",
           "entries": [{"kind": "class", "item_id": None, "name": "Schrotflinte", "category": "waffen", "category_label": "Waffen",
                        "role": "weapon", "subcategory": "schrot", "subcategory_label": "Schrotflinte", "image_url": None, "modes": [],
                        "mode_labels": [], "items": [{"item_id": "alt", "name": "Hagel", "image_url": None}], "attachments": []}]}
    await flow.db.loadout_bans.insert_one(dict(doc))
    return doc


@pytest.mark.asyncio
async def test_the_match_page_shows_the_list_that_applies_with_class_entries(flow):
    w = await match_world(flow)
    await class_version(flow, w["tournament"], 1)
    await flow.db.game_equipment.insert_one({"id": "neu", "game_id": GAME_ID, "category": "waffen", "subcategory": "schrot",
                                             "name": "Sturm 12", "name_key": "sturm 12", "status": "active"})
    flow.act_as(None)
    page = ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))
    [row] = page["league"]["loadout_bans"]["entries"]
    assert [entry["name"] for entry in row["items"]] == ["Sturm 12"], "offen: die Einträge von heute"

    from services import loadout_bans

    stamped = {**(await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})),
               "loadout_ban_id": (await loadout_bans.current(flow.db, "tournament", w["tournament"]["id"]))["id"]}
    held = await loadout_bans.effective(flow.db, w["tournament"], stamped)
    assert [entry["name"] for entry in held["entries"][0]["items"]] == ["Hagel"], "festgehalten: der Stand von damals"


# ---------------------------------------------------------------- Regelwerk

@pytest.mark.asyncio
async def test_the_rules_show_what_is_allowed_and_new_entries_ask_for_release(flow):
    """Fabian, Nr. 99: Das Regelwerk zeigt, was ERLAUBT ist - je Kategorie und Unterkategorie, mit „nicht in …“ und „nicht an …“; eine
    ganz gesperrte Klasse ist eine kurze Zeile. Ein neuer Eintrag (erlaubt oder in einer gesperrten Klasse) verlangt die Freigabe."""
    import pymupdf
    from services import league_rule_blocks, league_rules

    w = await ready(flow)
    ok(await save_bans(flow, w, [klass(w, "Schrotflinte"), klass(w, "Raketenwerfer"), item(w, "Blitz 9", ["suchen"]),
                                 attachments(w, "Donner 4", ["Griff"])]))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    frozen = first["frozen"][w["season"]["id"]]["loadout_bans"]
    assert frozen["data"]["layout"] == 3 and frozen["data"]["list"] is True
    sections = {row["label"]: row for row in frozen["data"]["categories"][0]["sections"]}
    assert list(sections) == [None, "Sturmgewehr", "Schrotflinte", "Raketenwerfer"]
    assert sections["Schrotflinte"]["state"] == "banned" and sections["Schrotflinte"]["banned"] == ["Bö", "Hagel"]
    assert sections["Sturmgewehr"]["entries"] == [{"name": "Blitz 9", "image_url": IMAGE, "not_in": ["Suchen"], "not_at": []}]
    web = league_rule_blocks.plain_value("loadout_bans", frozen, "markdown")
    assert "*Schrotflinte* · **nicht erlaubt** (Bö, Hagel)" in web and "*Raketenwerfer* · **nicht erlaubt**" in web
    assert f"- ![Ausrüstung]({IMAGE}) ++Blitz 9++ *nicht in Suchen*" in web and "- ++Griff++ *nicht an Donner 4*" in web
    assert "++Hagel++" not in web, "eine gesperrte Klasse zeigt keine Karten"
    text = league_rule_blocks.plain_value("loadout_bans", frozen, "text")
    assert "| Waffen | Schrotflinte | nicht erlaubt (Bö, Hagel) | – |" in text and "| Perks | – | alle: Leise Sohlen | – |" in text
    flow.act_as(None)
    pdf = await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")
    words = "\n".join(sheet.get_text() for sheet in pymupdf.open(stream=pdf.content, filetype="pdf"))
    assert "Einschränkungen" in words and "nicht erlaubt (Bö, Hagel)" in words and "nicht an Donner 4" in words
    # Die Liga- und die Matchseite lesen dasselbe (``allowed_equipment``).
    public = ok(await flow.get(public_url(w)))
    assert public["allowed_equipment"] == frozen["data"]

    # Nichts geändert: kein Vorschlag.
    flow.act_as(w["lead"])
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None
    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    assert await league_rules.pending_release(flow.db, league, season) is None

    # Neue Schrotflinte: mitgesperrt, ohne neue Version der Sperrliste - Regelwerk muss freigegeben werden.
    await add_weapon(flow, w, "Sturm 12", "Schrotflinte")
    admin = ok(await flow.get(season_scope(w)))
    row = next(row for row in admin["data_changes"]["rows"] if row["block"] == "loadout_bans")
    assert "Sturm 12" in row["after"] and "Sturm 12" not in row["before"]
    assert (await league_rules.pending_release(flow.db, league, season))["kind"] == "changed"
    released = ok(await flow.post(f"{season_scope(w)}/proposal/publish", json={
        "base_version_id": first["id"], "fingerprint": admin["proposal"]["fingerprint"], "valid_from": first["valid_from"],
        "change_reason": "Neue Schrotflinte nicht erlaubt", "requires_consent": False}))
    shotguns = next(row for row in released["frozen"][w["season"]["id"]]["loadout_bans"]["data"]["categories"][0]["sections"]
                    if row["label"] == "Schrotflinte")
    assert shotguns["banned"] == ["Bö", "Hagel", "Sturm 12"]

    # Neuer aktiver Eintrag in einer freien Klasse: erlaubt - auch das will freigegeben werden.
    await add_weapon(flow, w, "Neu 1", "Sturmgewehr")
    row = next(row for row in ok(await flow.get(season_scope(w)))["data_changes"]["rows"] if row["block"] == "loadout_bans")
    assert "Neu 1" in row["after"] and "Neu 1" not in row["before"]
    # Die erste Fassung bleibt, wie sie war.
    flow.act_as(None)
    old = ok(await flow.get(f"{season_page(w)}?version={first['id']}"))
    annex = next(row["body_md"] for row in old["sections"] if row["anchor"] == "anlage-a")
    assert "Sturm 12" not in annex and "Hagel" in annex and "Neu 1" not in annex


@pytest.mark.asyncio
async def test_an_old_version_with_bans_stays_as_published(flow):
    """Eine Fassung von vor Nr. 99 hat die Sperren eingefroren (``groups``/``weapons``, ohne ``layout``): Seite und PDF zeigen sie Wort für
    Wort weiter. Der heutige Baustein zeigt die erlaubte Ausrüstung - darum schlägt die Verwaltung einmal eine neue Fassung vor."""
    import pymupdf

    w = await make_world(flow)
    await add_library(flow, w)
    ok(await save_bans(flow, w, standard(w)))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    old = {"label": "Sperrliste", "source": {"loadout_ban_id": "alt"}, "data": {
        "list": True, "groups": [{"label": "Waffen", "entries": [{"name": "Blitz 9", "image_url": IMAGE, "modes": []}]}],
        "weapons": [{"name": "Donner 4", "image_url": None, "modes": [], "attachments": ["Griff", "Lauf"]}]}}
    await flow.db.league_rules.update_one({"id": first["id"]}, {"$set": {f"frozen.{w['season']['id']}.loadout_bans": old}})
    flow.act_as(None)
    page = ok(await flow.get(f"{season_page(w)}?version={first['id']}"))
    annex = next(row["body_md"] for row in page["sections"] if row["anchor"] == "anlage-a")
    assert annex.startswith("*Gesperrt ist nur, was hier steht – alles andere ist erlaubt.*")
    assert f"| ![Blitz 9]({IMAGE}) | Blitz 9 | alle Modi |" in annex and "| – | Donner 4 | Griff, Lauf | alle Modi |" in annex
    pdf = await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")
    words = "\n".join(sheet.get_text() for sheet in pymupdf.open(stream=pdf.content, filetype="pdf"))
    assert "Blitz 9 – gilt in: alle Modi" in words and "Erlaubt" not in words
    flow.act_as(w["lead"])
    assert ok(await flow.get(season_scope(w)))["data_changes"] is not None


@pytest.mark.asyncio
async def test_images_of_class_entries_are_usages_in_the_media_library(flow):
    from services import media_audit

    w = await ready(flow)
    ok(await flow.patch(f"{w['library_url']}/{w['items']['Hagel']['id']}", json={"image_url": IMAGE}))
    ok(await save_bans(flow, w, [klass(w, "Schrotflinte")]))
    places = {(collection, field) async for collection, _doc, field, _name, _text in media_audit.iter_usages(flow.db, {"blitz-1.webp"})}
    assert ("loadout_bans", "entries.items.image_url") in places


# ---------------------------------------------------------------- Erlaubte Ausrüstung am Spiel (Codex Runde 1, Fund 1)

async def match_library(flow) -> None:
    await flow.db.game_equipment_categories.insert_one({"game_id": GAME_ID, "categories": [
        {"key": "waffen", "label": "Waffen", "role": "weapon", "subcategories": []}]})
    for item_id, name in (("e1", "Blitz 9"), ("e2", "Donner 4")):
        await flow.db.game_equipment.insert_one({"id": item_id, "game_id": GAME_ID, "category": "waffen", "name": name,
                                                 "name_key": name.casefold(), "status": "active"})


def allowed_names(page: dict) -> list[str]:
    data = page["league"]["allowed_equipment"] or {}
    return [entry["name"] for category in data.get("categories") or [] for section in category["sections"] for entry in section["entries"]]


@pytest.mark.asyncio
async def test_a_finished_match_keeps_its_allowed_list(flow):
    """Nach dem Ergebnis gilt, was damals erlaubt war: ein neuer, ein umbenannter oder ein deaktivierter Eintrag ändert die Matchseite nicht
    mehr. Ein offenes Spiel liest die Bibliothek von heute."""
    w = await match_world(flow)
    await match_library(flow)
    flow.act_as(None)
    assert allowed_names(ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))) == ["Blitz 9", "Donner 4"]
    flow.act_as(w["users"]["Kapitaen"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))))
    flow.act_as(w["users"]["Falke1"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Falke2"), side="reg_h")))
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["status"] == "completed" and stored.get("loadout_allowed_id")
    flow.act_as(None)
    held = ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["allowed_equipment"]

    await flow.db.game_equipment.insert_one({"id": "e3", "game_id": GAME_ID, "category": "waffen", "name": "Neu", "name_key": "neu",
                                             "status": "active"})
    await flow.db.game_equipment.update_one({"id": "e1"}, {"$set": {"name": "Blitz 10"}})
    await flow.db.game_equipment.update_one({"id": "e2"}, {"$set": {"status": "inactive"}})
    assert ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["allowed_equipment"] == held
    later = await duel(flow, w["tournament"], w["reg_a"], w["reg_h"], matchday=2)
    assert allowed_names(ok(await flow.get(f"/api/matches/{later['id']}/page"))) == ["Blitz 10", "Neu"]

@pytest.mark.asyncio
async def test_deleting_a_subcategory_while_banning_it_leaves_no_retired_key(flow, monkeypatch):
    """Codex Runde 1, Fund 2: Löscht A eine leere Unterkategorie, während B sie als ganze Klasse sperrt, steht danach nie eine Sperrliste mit
    der entfernten Kennung da."""
    import asyncio

    from services import game_equipment

    w = await ready(flow)
    original = game_equipment._refuse_banned_class

    async def slow_refuse(db, game_id, key, label):
        await original(db, game_id, key, label)
        await asyncio.sleep(0.3)  # das Fenster zwischen Prüfen und Schreiben

    monkeypatch.setattr(game_equipment, "_refuse_banned_class", slow_refuse)
    # Die Sperre lebt vom eindeutigen Index (init_indexes) - im Speicher-Mongo hier von Hand.
    await flow.db.mutation_locks.create_index("resource", unique=True)
    flow.act_as(w["lead"])
    keep = [{"key": w["subs"][label], "label": label} for label in ("Sturmgewehr", "Schrotflinte")]
    remove, banned = await asyncio.gather(
        flow.put(f"{w['library_url']}/categories/{w['cats']['Waffen']}/subcategories", json={"subcategories": keep}),
        flow.put(bans_url(w), json={"entries": [klass(w, "Raketenwerfer")]}))
    doc = await flow.db.game_equipment_categories.find_one({"game_id": w["game"]["id"]}, {"_id": 0})
    retired = set(doc.get("retired_subcategory_keys") or [])
    used = {entry.get("subcategory") async for version in flow.db.loadout_bans.find({}, {"_id": 0}) for entry in version["entries"]}
    assert not used & retired, (remove.text, banned.text)
    assert sorted([remove.status_code, banned.status_code]) in ([200, 409], [200, 422])

@pytest.mark.asyncio
async def test_a_snapshot_written_at_the_same_time_is_no_error():
    """Codex Runde 2: Zwei Ergebnisse schreiben gleichzeitig denselben Schnappschuss - der zweite trifft den eindeutigen Index und nimmt
    den vorhandenen, statt mit 500 abzubrechen."""
    from types import SimpleNamespace

    from pymongo.errors import DuplicateKeyError
    from services import loadout_bans

    class Clash:
        async def update_one(self, *_args, **_kwargs):
            raise DuplicateKeyError("E11000 duplicate key")

        async def find_one(self, query, *_args, **_kwargs):
            return {"id": query["id"]}

    key = await loadout_bans.hold_allowed(SimpleNamespace(loadout_allowed=Clash()), "spiel", {"layout": 3, "categories": []})
    assert len(key) == 64