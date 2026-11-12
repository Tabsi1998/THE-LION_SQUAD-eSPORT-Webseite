"""Regelwerk der Liga (docs/LIGA.md, #1646): Nebenwirkungen - Suche, Sitemap, Vorschaukarte, Mediathek, PDF über die Route und die
Verwaltung einer Season neben dem Regeltext. Erfundene Inhalte."""
import pathlib
import sys

import pytest
import pytest_asyncio
from fastapi import HTTPException

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_rules_world import ADMIN_LEAGUES, league_scope, make_world, publish, season_page  # noqa: E402
from league_start_world import ok  # noqa: E402

pymupdf = pytest.importorskip("pymupdf", reason="pymupdf liest die erzeugten Seiten")

BASE = {"site_name": "Probe", "image": "/logo.png", "title": "Probe", "description": ""}
ORIGIN = "https://example.test"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def search(flow, needle: str) -> list[dict]:
    answer = ok(await flow.get("/api/search", params={"q": needle}))
    return [row for row in answer["items"] if row["kind"] == "league_rules"]


# ---------------------------------------------------------------- Suche

@pytest.mark.asyncio
async def test_search_finds_the_current_version_of_a_visible_season(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# Fairplay\nDas Wort Zeitstrafe gilt hier.", title="Regeln der Probe")
    flow.act_as(None)
    rows = await search(flow, "Zeitstrafe")
    assert [row["url"] for row in rows] == [f"/liga/{w['league']['slug']}/{w['season']['slug']}/regeln"]
    assert "Version 1" in rows[0]["subtitle"]


@pytest.mark.asyncio
async def test_search_ignores_old_text_drafts_and_hidden_seasons(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# A\nAltwort")
    await publish(flow, w, body="# A\nNeuwort")
    flow.act_as(w["lead"])
    await flow.put(f"/api/admin/league-rules/league_season/{w['season']['id']}/draft",
                   json={"title": "A", "body_md": "# A\nEntwurfswort", "annexes": []})
    flow.act_as(None)
    assert await search(flow, "Altwort") == [] and await search(flow, "Entwurfswort") == []
    assert await search(flow, "Neuwort")
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"visibility": "off"}})
    assert await search(flow, "Neuwort") == []


@pytest.mark.asyncio
async def test_search_finds_text_in_annexes_and_league_rules(flow):
    w = await make_world(flow)
    await publish(flow, w, scope=league_scope(w), body="# A\nText", annexes=[{"title": "B", "body_md": "Anlagenwort"}])
    flow.act_as(None)
    rows = await search(flow, "Anlagenwort")
    assert [row["url"] for row in rows] == [f"/liga/{w['league']['slug']}/regeln"]


# ---------------------------------------------------------------- Sitemap und Vorschaukarte

@pytest.mark.asyncio
async def test_sitemap_lists_the_rules_only_of_public_seasons_with_rules(flow):
    w = await make_world(flow)
    url = f"/liga/{w['league']['slug']}/{w['season']['slug']}/regeln</loc>"
    assert url not in (await flow.get("/api/sitemap.xml")).text
    await publish(flow, w)
    assert url in (await flow.get("/api/sitemap.xml")).text
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"visibility": "members", "readiness_override_reason": "Testaufbau ohne Prüfung"}))
    assert url not in (await flow.get("/api/sitemap.xml")).text


@pytest.mark.asyncio
async def test_preview_card_of_the_rules_page(flow):
    from routes.seo_render_routes import league_rules_meta

    w = await make_world(flow)
    await publish(flow, w, title="Regelwerk der Probe")
    league, season = w["league"]["slug"], w["season"]["slug"]
    meta = await league_rules_meta(flow.db, league, season, BASE, ORIGIN)
    assert meta["canonical"] == f"{ORIGIN}/liga/{league}/{season}/regeln"
    assert "Regeln" in meta["title"] and meta.get("robots") != "noindex, nofollow"
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"visibility": "members", "readiness_override_reason": "Testaufbau ohne Prüfung"}))
    restricted = await league_rules_meta(flow.db, league, season, BASE, ORIGIN)
    assert restricted["robots"] == "noindex, nofollow"
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"visibility": "off"}))
    with pytest.raises(HTTPException) as hidden:
        await league_rules_meta(flow.db, league, season, BASE, ORIGIN)
    assert hidden.value.status_code == 404


@pytest.mark.asyncio
async def test_preview_card_of_the_league_rules_page(flow):
    from routes.seo_render_routes import league_rules_meta

    w = await make_world(flow)
    meta = await league_rules_meta(flow.db, w["league"]["slug"], None, BASE, ORIGIN)
    assert meta["canonical"] == f"{ORIGIN}/liga/{w['league']['slug']}/regeln"
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"visibility": "off"}))
    with pytest.raises(HTTPException):
        await league_rules_meta(flow.db, w["league"]["slug"], None, BASE, ORIGIN)


@pytest.mark.asyncio
async def test_a_season_page_address_still_resolves_to_the_season_card(flow):
    from routes.seo_render_routes import league_season_meta

    w = await make_world(flow)
    meta = await league_season_meta(flow.db, w["league"]["slug"], w["season"]["slug"], BASE, ORIGIN)
    assert not meta["canonical"].endswith("/regeln")


# ---------------------------------------------------------------- Mediathek

@pytest.mark.asyncio
async def test_images_in_rules_count_as_used_in_every_version(flow):
    from services.media_audit import iter_usages

    w = await make_world(flow)
    for name in ("plan-eins.png", "karte-zwei.png"):
        await flow.db.media_uploads.insert_one({"id": name, "filename": name, "url": f"/api/static/uploads/{name}", "media_type": "image", "media_scope": "admin"})
    await publish(flow, w, body="# A\n![Plan](/api/static/uploads/plan-eins.png)",
                  annexes=[{"title": "B", "body_md": "![Karte](/api/static/uploads/karte-zwei.png)"}])
    await publish(flow, w, body="# A\nOhne Bild", annexes=[])
    found = [row async for row in iter_usages(flow.db, {"plan-eins.png", "karte-zwei.png"})]
    assert {(row[0], row[2]) for row in found} >= {("league_rules", "body_md"), ("league_rules", "annexes.body_md")}, (
        "die alte Fassung zeigt das Bild weiter")


# ---------------------------------------------------------------- PDF über die Route

def pdf_text(data: bytes) -> str:
    return "\n".join(page.get_text() for page in pymupdf.open(stream=data, filetype="pdf"))


@pytest.mark.asyncio
async def test_pdf_route_shows_version_marks_and_frozen_lists(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# Fairplay\nAlt\n\n# Maps\n[[baustein:map_pool]]")
    second = await publish(flow, w, body="# Fairplay\nNeu\n\n# Maps\n[[baustein:map_pool]]", reason="Fairplay neu gefasst")
    flow.act_as(None)
    answer = await flow.get(f"{season_page(w)}/versions/{second['id']}/pdf")
    assert answer.status_code == 200 and answer.headers["content-type"] == "application/pdf"
    assert "regelwerk" in answer.headers["content-disposition"] and "x-robots-tag" not in answer.headers
    text = pdf_text(answer.content)
    assert "Version 2" in text and "Fairplay neu gefasst" in text and "GEÄNDERT" in text and "Hafenkante" in text
    plain = await flow.get(f"{season_page(w)}/versions/{second['id']}/pdf", params={"marks": 0})
    assert "GEÄNDERT" not in pdf_text(plain.content) and "Hafenkante" in pdf_text(plain.content)


@pytest.mark.asyncio
async def test_an_old_pdf_keeps_its_old_lists(flow):
    from league_rules_world import save_pool

    w = await make_world(flow)
    first = await publish(flow, w)
    await save_pool(flow, w, {"stellung": ["Turmblick"], "suchen": ["Nebelwerk"]})
    await publish(flow, w)
    flow.act_as(None)
    old = pdf_text((await flow.get(f"{season_page(w)}/versions/{first['id']}/pdf")).content)
    assert "Hafenkante" in old and "Turmblick" not in old


@pytest.mark.asyncio
async def test_pdf_of_a_members_season_is_not_for_search_engines(flow):
    w = await make_world(flow, visibility="members")
    version = await publish(flow, w)
    flow.act_as({**w["lead"], "is_club_member": True})
    answer = await flow.get(f"{season_page(w)}/versions/{version['id']}/pdf")
    assert answer.status_code == 200 and answer.headers["x-robots-tag"].startswith("noindex")


@pytest.mark.asyncio
async def test_pdf_of_a_foreign_version_is_not_found(flow):
    w = await make_world(flow)
    await publish(flow, w)
    assert (await flow.get(f"{season_page(w)}/versions/unbekannt/pdf")).status_code == 404


# ---------------------------------------------------------------- Bestehendes bleibt

@pytest.mark.asyncio
async def test_the_rules_text_stays_editable_and_the_fallback_follows_it(flow):
    w = await make_world(flow, rules_text="Erster Text")
    flow.act_as(w["lead"])
    ok(await flow.patch(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}", json={"rules_text": "Zweiter Text"}))
    flow.act_as(None)
    assert ok(await flow.get(season_page(w)))["fallback_text"] == "Zweiter Text"
    flow.act_as(w["lead"])
    ok(await flow.post(f"{ADMIN_LEAGUES}/seasons/{w['season']['id']}/sync"))
    staffel = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0})
    assert staffel["rules"] == "Zweiter Text", "ohne Regelwerk überträgt die Season weiter ihren Text"
