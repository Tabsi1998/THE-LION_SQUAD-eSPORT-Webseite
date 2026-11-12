"""Erlaubte Ausrüstung als Tabelle je Kategorie (#2305, ``layout: 5``) durch die echten Routen (docs/LIGA.md, C.4). Erfundene Namen.

Eine veröffentlichte Fassung mit ``layout: 4`` zeigt im Web und im PDF weiter Wort für Wort den Satz je Waffe; ein Schnappschuss am Spiel
bleibt. Der Baustein von heute ist die Tabelle - die Verwaltung schlägt „Regelwerk muss freigegeben werden“ vor; die neue Fassung zeigt im
PDF je Waffe ein kleines Bild und „nur erlaubt: …“, wo das kürzer ist.
"""
import json
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as match_world  # noqa: E402
from league_rules_world import make_world, publish, season_page, season_scope  # noqa: E402
from league_start_world import ok  # noqa: E402
from loadout_world import IMAGE, add_library, attachments, save_bans  # noqa: E402

BODY = "Vorwort.\n\n# § 1 Fairplay\nFair spielen.\n"
ANNEX = [{"title": "Erlaubte Ausrüstung", "body_md": "[[baustein:loadout_bans]]"}]
V4 = json.loads((pathlib.Path(__file__).resolve().parent / "golden" / "loadout_allowed_v4.json").read_text(encoding="utf-8"))
OPTICS = ("Optik 1", "Optik 2", "Optik 3", "Optik 4")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def pdf_words(content: bytes) -> tuple[str, int]:
    import pymupdf

    sheets = list(pymupdf.open(stream=content, filetype="pdf"))
    return " ".join(" ".join(sheet.get_text() for sheet in sheets).split()), sum(len(sheet.get_images()) for sheet in sheets)


def annex_of(page: dict) -> str:
    return next(row["body_md"] for row in page["sections"] if row["anchor"] == "anlage-a")


@pytest.mark.asyncio
async def test_layout_4_stays_and_the_table_comes_through_the_release(flow, tmp_path, monkeypatch):
    import pdf_service

    Image.new("RGB", (1280, 720), (41, 182, 232)).save(tmp_path / IMAGE.rsplit("/", 1)[-1], format="WEBP")
    monkeypatch.setattr(pdf_service, "PUBLIC_UPLOAD_DIR", tmp_path)
    w = await make_world(flow)
    await add_library(flow, w)
    blitz = w["items"]["Blitz 9"]["id"]
    for name in OPTICS:
        w["items"][name] = ok(await flow.post(w["library_url"], json={"category": w["cats"]["Aufsätze"], "name": name, "weapon_ids": [blitz]}))
    # Blitz 9: Rotpunkt, Griff, Optik 1-4 passen. Gesperrt: Rotpunkt, Optik 1-3 (4), erlaubt: Griff, Optik 4 (2) - „nur erlaubt“.
    ok(await save_bans(flow, w, [attachments(w, "Blitz 9", ["Rotpunkt", "Optik 1", "Optik 2", "Optik 3"])]))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    assert first["frozen"][w["season"]["id"]]["loadout_bans"]["data"]["layout"] == 5
    # So hätte die Fassung bis #2305 ausgesehen: layout 4 aus der Golden-Datei.
    old = {"label": "Erlaubte Ausrüstung", "source": {"loadout_ban_id": "alt"}, "data": V4["DOC"]["data"]}
    await flow.db.league_rules.update_one({"id": first["id"]}, {"$set": {f"frozen.{w['season']['id']}.loadout_bans": old}})

    flow.act_as(None)
    annex = annex_of(ok(await flow.get(f"{season_page(w)}?version={first['id']}")))
    assert "++Blitz 9++ alle passenden Aufsätze erlaubt, außer: Rotpunkt" in annex and "| Bild |" not in annex
    old_pdf = await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")
    words, old_images = pdf_words(old_pdf.content)
    assert "Blitz 9 – alle passenden Aufsätze erlaubt, außer: Rotpunkt" in words and "nur erlaubt" not in words

    flow.act_as(w["lead"])
    admin = ok(await flow.get(season_scope(w)))
    row = next(row for row in admin["data_changes"]["rows"] if row["block"] == "loadout_bans")
    assert "außer: Rotpunkt" in row["before"] and "| **Blitz 9** | **nur erlaubt:** Griff, Optik 4 |" in row["after"], \
        "Klartext ohne Bilder; ohne Unterkategorien kein Slot-Name"
    released = ok(await flow.post(f"{season_scope(w)}/proposal/publish", json={
        "base_version_id": first["id"], "fingerprint": admin["proposal"]["fingerprint"], "valid_from": first["valid_from"],
        "change_reason": "Tabelle je Kategorie", "requires_consent": False}))
    data = released["frozen"][w["season"]["id"]]["loadout_bans"]["data"]
    found = next(entry for entry in data["categories"][0]["sections"][0]["entries"] if entry["name"] == "Blitz 9")["attachments"]
    assert data["layout"] == 5 and (found["count"], found["only_allowed"]) == (6, True)

    flow.act_as(None)
    annex = annex_of(ok(await flow.get(f"{season_page(w)}?version={released['id']}")))
    assert "| Bild | \\+\\+Waffe\\+\\+ | Aufsätze |" not in annex, "der Kopf ist Text der Vorlage, keine geschützten Zeichen"
    assert "| Bild | ++Waffe++ | Aufsätze |" in annex and f"| ![Ausrüstung]({IMAGE}) | ++Blitz 9++ | *nur erlaubt:* ++Griff, Optik 4++ |" in annex
    assert "|  | ++Donner 4++ | *alle passenden Aufsätze erlaubt* |" in annex
    new_pdf = await flow.get(f"{season_page(w)}/versions/{released['id']}/pdf")
    assert new_pdf.status_code == 200 and new_pdf.headers["content-type"].startswith("application/pdf")
    words, new_images = pdf_words(new_pdf.content)
    assert "Bild Waffe Aufsätze" in words and "Blitz 9 nur erlaubt: Griff, Optik 4" in words
    assert "Donner 4 alle passenden Aufsätze erlaubt" in words and "[Bild:" not in words
    assert new_images == old_images + 1, "das kleine Bild von Blitz 9 steht in der Tabelle"
    # Die alte Fassung bleibt, wie sie war - Web und PDF.
    annex = annex_of(ok(await flow.get(f"{season_page(w)}?version={first['id']}")))
    assert "außer: Rotpunkt" in annex
    again = await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")
    before, after = pdf_words(old_pdf.content), pdf_words(again.content)
    assert after == before and "nur erlaubt" not in after[0]
    # Die Ligaseite liest dieselben Daten.
    public = ok(await flow.get(f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"))
    assert public["allowed_equipment"] == data


@pytest.mark.asyncio
async def test_a_layout_4_snapshot_at_a_match_stays_as_it_was(flow):
    w = await match_world(flow)
    await flow.db.loadout_allowed.insert_one({"id": "alt-4", "game_id": "probe-shooter", "data": V4["NOWHERE"]["data"],
                                              "created_at": "2026-11-04"})
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"loadout_ban_id": None, "loadout_allowed_id": "alt-4"}})
    flow.act_as(None)
    shown = ok(await flow.get(f"/api/matches/{w['match']['id']}/page"))["league"]["allowed_equipment"]
    assert shown == V4["NOWHERE"]["data"] and shown["layout"] == 4
