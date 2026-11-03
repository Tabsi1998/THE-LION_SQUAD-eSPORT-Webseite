"""Sperrliste im Regelwerk (docs/LIGA.md, C.4 #2218): Baustein ``[[baustein:loadout_bans]]`` mit Bildern im Web und als saubere Liste
im PDF, eingefroren je Fassung, Vorschlag einer neuen Fassung mit markierten Unterschieden, Bilder unveränderlich in der Mediathek.
Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import make_world, publish, season_page, season_scope  # noqa: E402
from league_start_world import ok  # noqa: E402
from loadout_world import IMAGE, add_library, attachments, bans_url, item, save_bans, standard  # noqa: E402

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
    w = await make_world(flow)
    await add_library(flow, w)
    return w


def annex_body(page: dict) -> str:
    return next(row["body_md"] for row in page["sections"] if row["anchor"] == "anlage-a")


@pytest.mark.asyncio
async def test_the_block_shows_images_on_the_web_and_a_clean_list_in_the_pdf(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    version = await publish(flow, w, body=BODY, annexes=ANNEX)
    frozen = version["frozen"][w["season"]["id"]]["loadout_bans"]
    assert f"![Blitz 9]({IMAGE})" in frozen["markdown"] and "| Bild | Name | Gilt in |" in frozen["markdown"]
    assert "![" not in frozen["text"] and "- Leise Sohlen – gilt in: Suchen" in frozen["text"]
    assert "- Donner 4: Griff, Lauf – gilt in: alle Modi" in frozen["text"]
    assert frozen["source"]["loadout_ban_version"] == 1
    assert IMAGE in version["frozen_images"]

    flow.act_as(None)
    page = ok(await flow.get(season_page(w)))
    assert f"![Blitz 9]({IMAGE})" in annex_body(page) and "**Aufsätze an erlaubten Waffen**" in annex_body(page)

    from services import league_rules

    league = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season = await flow.db.league_seasons.find_one({"id": w["season"]["id"]}, {"_id": 0})
    stored = await flow.db.league_rules.find_one({"id": version["id"]}, {"_id": 0})
    document = league_rules._pdf_document(league, season, stored, None, False)
    annex = next(row["body_md"] for row in document["sections"] if row["anchor"] == "anlage-a")
    assert "![" not in annex and "- Blitz 9 – gilt in: alle Modi" in annex
    pdf = await flow.get(f"{season_page(w)}/versions/{version['id']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")


@pytest.mark.asyncio
async def test_without_a_list_the_block_says_everything_is_allowed(flow):
    w = await ready(flow)
    version = await publish(flow, w, body=BODY, annexes=ANNEX)
    frozen = version["frozen"][w["season"]["id"]]["loadout_bans"]
    assert "keine Sperrliste" in frozen["markdown"] and "alles ist erlaubt" in frozen["text"]
    assert version["frozen_images"] == []


@pytest.mark.asyncio
async def test_a_changed_list_suggests_a_new_version_and_each_version_keeps_its_list(flow):
    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    first = await publish(flow, w, body=BODY, annexes=ANNEX)
    view = ok(await flow.get(bans_url(w)))
    assert view["rules"] == {"uses_block": True, "outdated": False, "version": 1,
                             "admin_url": f"/admin/leagues/rules/league_season/{w['season']['id']}"}

    saved = ok(await save_bans(flow, w, [item(w, "Blitz 9", ["stellung"]), attachments(w, "Donner 4", ["Lauf"]), item(w, "Rotpunkt")]))
    assert saved["rules"]["outdated"] is True
    changes = ok(await flow.get(season_scope(w)))["data_changes"]
    row = next(row for row in changes["rows"] if row["block"] == "loadout_bans")
    assert row["status"] == "changed" and changes["version_id"] == first["id"]
    assert {"op": "ins", "text": "Rotpunkt"} in [{"op": op["op"], "text": op["text"].strip()} for op in row["ops"]]
    assert not any("![" in op["text"] for op in row["ops"]), "markiert wird ohne Bild-Markdown"
    assert await flow.db.league_rules.count_documents({"status": "published"}) == 1, "nichts veröffentlicht sich selbst"

    prepared = ok(await flow.post(f"{season_scope(w)}/draft/from-version", json={}))
    second = await publish(flow, w, body=prepared["body_md"], annexes=prepared["annexes"], reason="Neue Sperrliste", requires_consent=True)
    assert second["requires_consent"] is True and "Rotpunkt" in second["frozen"][w["season"]["id"]]["loadout_bans"]["markdown"]
    assert ok(await flow.get(bans_url(w)))["rules"]["outdated"] is False

    flow.act_as(None)
    old = ok(await flow.get(f"{season_page(w)}?version={first['id']}"))
    assert "Rotpunkt" not in annex_body(old) and "Leise Sohlen" in annex_body(old)
    diff = ok(await flow.get(f"{season_page(w)}/compare?base={first['id']}&target={second['id']}"))
    assert "![" not in str(diff["sections"])


@pytest.mark.asyncio
async def test_a_season_without_the_block_gets_no_hint(flow):
    w = await ready(flow)
    await publish(flow, w, body=BODY, annexes=[])
    ok(await save_bans(flow, w, standard(w)))
    assert ok(await flow.get(bans_url(w)))["rules"]["uses_block"] is False
    assert ok(await flow.get(season_scope(w)))["data_changes"] is None


@pytest.mark.asyncio
async def test_the_media_library_keeps_images_of_a_published_list_unchanged(flow):
    from services import media_audit

    w = await ready(flow)
    ok(await save_bans(flow, w, standard(w)))
    # Schon die gespeicherte Version der Sperrliste ist unveränderlich, danach auch die Fassung des Regelwerks.
    assert await media_audit.frozen_usages(flow.db, "blitz-1.webp") == ["Sperrliste, Version 1"]
    assert await media_audit.still_referenced(flow.db, {"blitz-1.webp"}) == {"blitz-1.webp"}
    await publish(flow, w, body=BODY, annexes=ANNEX)
    assert await media_audit.frozen_usages(flow.db, "blitz-1.webp") == ["Regelwerk, Version 1", "Sperrliste, Version 1"]
    places = {(collection, field) async for collection, _doc, field, _name, _text in media_audit.iter_usages(flow.db, {"sohlen-2.png"})}
    assert {("game_equipment", "image_url"), ("loadout_bans", "entries.image_url"), ("league_rules", "frozen_images")} <= places
