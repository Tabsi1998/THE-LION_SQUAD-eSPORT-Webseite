"""Aufsätze je Waffe (#2299) und „nur in …“ (#2298) durch die echten Routen (docs/LIGA.md, C.4). Erfundene Namen.

Die Verwaltung sperrt Aufsätze an einer Waffe je Aufsatz in eigenen Modi; Ligaseite und Regelwerk zeigen die Aufsätze an der Waffe und „nur
in …“, wenn ein Eintrag in mehr Modi der Season gesperrt ist als erlaubt. Veröffentlichte Fassungen (layout 3) und Schnappschüsse am Spiel
bleiben, wie sie waren; die neue Darstellung kommt über „Regelwerk muss freigegeben werden“.
"""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as match_world  # noqa: E402
from league_rules_world import make_world, publish, season_page, season_scope  # noqa: E402
from league_start_world import ok  # noqa: E402
from loadout_world import IMAGE, add_library, attachments, bans_url, item, save_bans  # noqa: E402

BODY = "Vorwort.\n\n# § 1 Fairplay\nFair spielen.\n"
ANNEX = [{"title": "Erlaubte Ausrüstung", "body_md": "[[baustein:loadout_bans]]"}]
V3 = json.loads((pathlib.Path(__file__).resolve().parent / "golden" / "loadout_allowed_v3.json").read_text(encoding="utf-8"))


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def ready(flow, *, kapern: bool = False) -> dict:
    """Bibliothek aus ``loadout_world``; mit ``kapern`` hat Spiel und Season einen dritten Modus „Kapern“ (Modusfolge)."""
    w = await make_world(flow)
    await add_library(flow, w)
    if kapern:
        await flow.db.games.update_one({"id": w["game"]["id"]}, {"$push": {"match_modes": {"mode": "kapern", "label": "Kapern"}}})
        await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"game_mode_order": ["stellung", "suchen", "kapern"]}})
    return w


def ids(w: dict, *names: str) -> list[str]:
    return [w["items"][name]["id"] for name in names]


def public_url(w: dict) -> str:
    return f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"


def weapons(data: dict) -> dict:
    return {entry["name"]: entry for section in data["categories"][0]["sections"] for entry in section["entries"]}


# ---------------------------------------------------------------- Verwaltung

@pytest.mark.asyncio
async def test_modes_per_attachment_are_saved_shown_and_compared(flow):
    w = await ready(flow)
    row = {**attachments(w, "Donner 4", ["Lauf", "Griff"]), "attachment_modes": {w["items"]["Lauf"]["id"]: ["suchen"]}}
    saved = ok(await save_bans(flow, w, [row]))
    lauf, griff = sorted(saved["entries"][0]["attachments"], key=lambda entry: entry["name"], reverse=True)
    assert (lauf["name"], lauf["modes"], lauf["mode_labels"]) == ("Lauf", ["suchen"], ["Suchen"])
    assert griff["name"] == "Griff" and "modes" not in griff, "ohne eigene Modi: die der Zeile"
    stored = await flow.db.loadout_bans.find_one({"id": saved["id"]}, {"_id": 0})
    assert next(entry for entry in stored["entries"][0]["attachments"] if entry["name"] == "Lauf")["mode_labels"] == ["Suchen"]
    view = ok(await flow.get(bans_url(w)))["list"]
    assert next(entry for entry in view["entries"][0]["attachments"] if entry["name"] == "Lauf")["modes"] == ["suchen"]

    # Modi nur für Aufsätze der Zeile, nur Modi des Spiels, nur an einer Waffe.
    stray = await save_bans(flow, w, [{**attachments(w, "Donner 4", ["Lauf"]), "attachment_modes": {w["items"]["Griff"]["id"]: ["suchen"]}}])
    assert stray.status_code == 422 and "nicht gesperrt" in stray.json()["detail"]
    unknown = await save_bans(flow, w, [{**attachments(w, "Donner 4", ["Lauf"]), "attachment_modes": {w["items"]["Lauf"]["id"]: ["gibt-es-nicht"]}}])
    assert unknown.status_code == 422
    not_weapon = await save_bans(flow, w, [{**item(w, "Leise Sohlen"), "attachment_modes": {w["items"]["Lauf"]["id"]: ["suchen"]}}])
    assert not_weapon.status_code == 422

    # Andere Modi an einem Aufsatz: der Vergleich nennt sie.
    ok(await save_bans(flow, w, [{**row, "attachment_modes": {w["items"]["Lauf"]["id"]: ["stellung"]}}]))
    diff = ok(await flow.get(f"{bans_url(w)}/compare", params={"base": 1, "target": 2}))
    assert diff["changed"][0]["attachments"] == ["Griff", "Lauf (in Stellung)"]


@pytest.mark.asyncio
async def test_the_league_page_shows_attachments_at_the_weapon_and_only_in(flow):
    """Lauf an Donner 4 ganz gesperrt, Griff dort in Stellung und Kapern (2 von 3 Modi der Season: „nur in Suchen“); Rotpunkt „an allen
    Waffen“ gesperrt (Zeile des Aufsatzes); Leise Sohlen nur in Suchen gesperrt (1 von 3: „nicht in“)."""
    w = await ready(flow, kapern=True)
    lauf, griff = ids(w, "Lauf", "Griff")
    ok(await save_bans(flow, w, [
        item(w, "Rotpunkt"), item(w, "Leise Sohlen", ["suchen"]),
        {**attachments(w, "Donner 4", ["Lauf", "Griff"]), "attachment_modes": {griff: ["stellung", "kapern"]}}]))
    flow.act_as(None)
    data = ok(await flow.get(public_url(w)))["allowed_equipment"]
    assert data["layout"] == 4 and [row["label"] for row in data["categories"]] == ["Waffen", "Perks"]
    blitz, donner = weapons(data)["Blitz 9"], weapons(data)["Donner 4"]
    assert blitz["attachments"]["count"] == 2 and blitz["attachments"]["banned"] == ["Rotpunkt"]
    assert donner["attachments"] == {"count": 2, "banned": ["Lauf"], "groups": [{"label": None, "not_in": [], "entries": [
        {"name": "Griff", "image_url": None, "not_in": ["Stellung", "Kapern"], "only_in": ["Suchen"]}]}]}
    perk = data["categories"][1]["sections"][0]["entries"][0]
    assert perk["not_in"] == ["Suchen"] and "only_in" not in perk
    assert lauf not in json.dumps(data), "nur Klartext, keine Kennungen"


# ---------------------------------------------------------------- Regelwerk

@pytest.mark.asyncio
async def test_a_published_layout_3_stays_and_the_new_view_asks_for_release(flow):
    """Eine Fassung mit ``layout: 3`` (vor #2299) zeigt ihre Aufsatz-Liste mit „nicht an …“ weiter Wort für Wort, im Web und im PDF. Der
    Baustein von heute ist layout 4 - die Verwaltung schlägt eine neue Fassung vor; die neue zeigt die Aufsätze an der Waffe."""
    import pymupdf

    w = await ready(flow)
    ok(await save_bans(flow, w, [attachments(w, "Donner 4", ["Griff"])]))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    old = {"label": "Erlaubte Ausrüstung", "source": {"loadout_ban_id": "alt"}, "data": V3["DOC"]}
    await flow.db.league_rules.update_one({"id": first["id"]}, {"$set": {f"frozen.{w['season']['id']}.loadout_bans": old}})
    flow.act_as(None)
    page = ok(await flow.get(f"{season_page(w)}?version={first['id']}"))
    annex = next(row["body_md"] for row in page["sections"] if row["anchor"] == "anlage-a")
    assert "- ++Rotpunkt++ *nicht an Blitz 9, Donner 4 \\(in Suchen\\)*" in annex and "**Aufsätze**" in annex
    pdf = await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")
    words = " ".join(" ".join(sheet.get_text() for sheet in pymupdf.open(stream=pdf.content, filetype="pdf")).split())
    assert "nicht an Blitz 9, Donner 4 (in Suchen)" in words and "alle passenden Aufsätze" not in words

    flow.act_as(w["lead"])
    admin = ok(await flow.get(season_scope(w)))
    row = next(row for row in admin["data_changes"]["rows"] if row["block"] == "loadout_bans")
    assert "alle passenden Aufsätze erlaubt, außer: Griff" in row["after"] and "nicht an" in row["before"]
    released = ok(await flow.post(f"{season_scope(w)}/proposal/publish", json={
        "base_version_id": first["id"], "fingerprint": admin["proposal"]["fingerprint"], "valid_from": first["valid_from"],
        "change_reason": "Aufsätze je Waffe", "requires_consent": False}))
    data = released["frozen"][w["season"]["id"]]["loadout_bans"]["data"]
    assert data["layout"] == 4 and weapons(data)["Donner 4"]["attachments"]["banned"] == ["Griff"]
    flow.act_as(None)
    pdf = await flow.get(f"{season_page(w)}/versions/{released['id']}/pdf")
    words = " ".join(" ".join(sheet.get_text() for sheet in pymupdf.open(stream=pdf.content, filetype="pdf")).split())
    assert "Donner 4 – alle passenden Aufsätze erlaubt, außer: Griff" in words
    assert "Blitz 9 – alle passenden Aufsätze erlaubt" in words
    # Die erste Fassung bleibt, wie sie war.
    page = ok(await flow.get(f"{season_page(w)}?version={first['id']}"))
    assert "nicht an Blitz 9" in next(row["body_md"] for row in page["sections"] if row["anchor"] == "anlage-a")
    assert ok(await flow.get(public_url(w)))["allowed_equipment"] == data
    assert IMAGE in json.dumps(data)


# ---------------------------------------------------------------- Spiel

@pytest.mark.asyncio
async def test_an_older_snapshot_at_a_match_stays_as_it_was(flow):
    """Ein Spiel mit Schnappschuss von vor #2299 (``layout: 3``) zeigt ihn unverändert."""
    w = await match_world(flow)
    await flow.db.loadout_allowed.insert_one({"id": "alt-3", "game_id": "probe-shooter", "data": V3["DOC"], "created_at": "2026-11-01"})
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"loadout_ban_id": None, "loadout_allowed_id": "alt-3"}})
    flow.act_as(None)
    shown = ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["allowed_equipment"]
    assert shown == V3["DOC"]
