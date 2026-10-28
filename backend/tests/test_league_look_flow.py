"""Gestaltung der Liga (#2107): Emblem, Banner mit Fokuspunkt, Akzentfarbe je Liga und Gewinne je Season bzw. Liga N.

- Bilder nur aus der eigenen Mediathek (Upload über die Logo- bzw. Bild-Route) - eine fremde Adresse oder eine Datei,
  die es nicht gibt, lehnt der Server ab.
- Rückfälle: Season → Liga → Standard (nichts); Gewinne: Liga N → Season.
- Die Akzentfarbe muss auf dem dunklen Grund lesbar sein (Kontrast), sonst 422; ohne Farbe gilt die Vereinsfarbe.
- Staffeln bekommen das Banner (die App zeigt Turnierbanner) - ein eigenes Turnierbanner bleibt.
- Kein Bezug zu XP oder Pokalen: Gewinne sind reine Anzeige.
Nur erfundene Namen, keine echten Logos.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

ADMIN = "/api/admin/leagues"
PAGE = "/api/leagues/probe-shooter/season-1"
EMBLEM_LEAGUE = "/api/static/uploads/probe-emblem-liga.png"
EMBLEM_SEASON = "/api/static/uploads/probe-emblem-season.svg"
BANNER_LEAGUE = "/api/static/uploads/probe-banner-liga.webp"
BANNER_SEASON = "/api/static/uploads/probe-banner-season.webp"
PRIZE_IMAGE = "/api/static/uploads/probe-pokal.png"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def uploaded(flow, *urls):
    for url in urls:
        await flow.db.media_uploads.insert_one({"id": url, "url": url, "media_type": "image"})


async def setup(flow):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter"})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={
        "start_date": "2026-11-10T00:00:00", "visibility": "public"})).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    await uploaded(flow, EMBLEM_LEAGUE, EMBLEM_SEASON, BANNER_LEAGUE, BANNER_SEASON, PRIZE_IMAGE)
    return admin, league, season, division


@pytest.mark.asyncio
async def test_emblem_and_banner_fall_back_from_season_to_league_to_nothing(flow):
    admin, league, season, _division = await setup(flow)

    page = (await flow.get(PAGE)).json()
    assert page["look"] == {"emblem_url": None, "banner": None, "accent_color": None}

    saved = await flow.patch(f"{ADMIN}/{league['id']}", json={
        "emblem_url": EMBLEM_LEAGUE, "banner_url": BANNER_LEAGUE,
        "banner_focus": {"x": 30, "y": 60, "mobile_x": 70, "mobile_y": 40}, "accent_color": "#7FD1FF"})
    assert saved.status_code == 200, saved.text
    assert sorted(saved.json()["changed"]) == ["accent_color", "banner_focus", "banner_url", "emblem_url"]
    page = (await flow.get(PAGE)).json()
    assert page["look"]["emblem_url"] == EMBLEM_LEAGUE
    assert page["look"]["banner"] == {"url": BANNER_LEAGUE, "x": 30, "y": 60, "mobile_x": 70, "mobile_y": 40}
    assert page["look"]["accent_color"] == "#7FD1FF"
    assert page["league"]["emblem_url"] == EMBLEM_LEAGUE

    saved = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"emblem_url": EMBLEM_SEASON,
                                                                       "banner_url": BANNER_SEASON})
    assert saved.status_code == 200, saved.text
    assert saved.json()["staffeln_to_sync"] == 0, "Gestaltung braucht kein Übertragen"
    page = (await flow.get(PAGE)).json()
    assert page["look"]["emblem_url"] == EMBLEM_SEASON
    # Ohne eigenen Fokuspunkt steht das Season-Banner mittig.
    assert page["look"]["banner"] == {"url": BANNER_SEASON, "x": 50, "y": 50, "mobile_x": 50, "mobile_y": 50}
    listing = (await flow.get("/api/leagues")).json()["leagues"][0]
    assert listing["emblem_url"] == EMBLEM_LEAGUE and listing["accent_color"] == "#7FD1FF"
    assert listing["seasons"][0]["emblem_url"] == EMBLEM_SEASON
    assert listing["seasons"][0]["banner"]["url"] == BANNER_SEASON

    # Leeren heißt: wieder die Liga.
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"emblem_url": None, "banner_url": None})
    page = (await flow.get(PAGE)).json()
    assert page["look"]["emblem_url"] == EMBLEM_LEAGUE and page["look"]["banner"]["url"] == BANNER_LEAGUE


@pytest.mark.asyncio
async def test_images_only_from_the_own_media_library(flow):
    _admin, league, season, _division = await setup(flow)
    for body in ({"emblem_url": "https://fremd.example/logo.png"}, {"banner_url": "javascript:alert(1)"},
                 {"banner_url": "/api/static/uploads/probe-banner.svg"}):
        response = await flow.patch(f"{ADMIN}/{league['id']}", json=body)
        assert response.status_code == 422, body
    missing = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"emblem_url": "/api/static/uploads/gibts-nicht.png"})
    assert missing.status_code == 422
    assert "Mediathek" in missing.json()["detail"]
    prize = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={
        "prizes": [{"place": 1, "text": "Pokal", "image_url": "/api/static/uploads/gibts-nicht.png"}]})
    assert prize.status_code == 422
    stored = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert not stored.get("emblem_url") and not stored.get("prizes")


@pytest.mark.asyncio
async def test_accent_color_needs_contrast_on_the_dark_page(flow):
    _admin, league, _season, _division = await setup(flow)
    dark = await flow.patch(f"{ADMIN}/{league['id']}", json={"accent_color": "#1A1A40"})
    assert dark.status_code == 422 and "Kontrast" in dark.json()["detail"]
    assert (await flow.patch(f"{ADMIN}/{league['id']}", json={"accent_color": "blau"})).status_code == 422
    ok = await flow.patch(f"{ADMIN}/{league['id']}", json={"accent_color": "#ffb020"})
    assert ok.status_code == 200 and ok.json()["accent_color"] == "#FFB020"
    cleared = await flow.patch(f"{ADMIN}/{league['id']}", json={"accent_color": None})
    assert cleared.status_code == 200
    assert (await flow.get(PAGE)).json()["look"]["accent_color"] is None, "Rückfall: Vereinsfarbe im Web"


@pytest.mark.asyncio
async def test_prizes_per_season_and_optionally_per_division(flow):
    admin, _league, season, division = await setup(flow)
    second = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={})).json()
    response = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"prizes": [
        {"place": 2, "text": "  Gutschein   Probe-Shop "}, {"place": 1, "text": "Pokal und Trikot", "image_url": PRIZE_IMAGE}]})
    assert response.status_code == 200, response.text
    assert [row["place"] for row in response.json()["prizes"]] == [1, 2]
    assert response.json()["prizes"][1]["text"] == "Gutschein Probe-Shop"
    double = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"prizes": [
        {"place": 1, "text": "A"}, {"place": 1, "text": "B"}]})
    assert double.status_code == 422

    own = await flow.patch(f"{ADMIN}/divisions/{second['id']}", json={"prizes": [{"place": 1, "text": "Aufstieg und Medaille"}]})
    assert own.status_code == 200, own.text
    page = (await flow.get(PAGE)).json()
    assert [row["text"] for row in page["prizes"]] == ["Pokal und Trikot", "Gutschein Probe-Shop"]
    by_level = {row["level"]: row for row in page["divisions"]}
    assert by_level[division["level"]]["prizes"] is None, "Liga 1 spielt um die Gewinne der Season"
    assert [row["text"] for row in by_level[second["level"]]["prizes"]] == ["Aufstieg und Medaille"]

    # Gewinne sind reine Anzeige: kein Feld am Staffel-Turnier, keine Pokale, keine XP.
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    staffel = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    assert not staffel.get("prize_pool") and not staffel.get("prize_places") and not staffel.get("prizes")


@pytest.mark.asyncio
async def test_staffeln_carry_the_banner_for_the_app_but_keep_their_own(flow):
    _admin, league, season, division = await setup(flow)
    await flow.patch(f"{ADMIN}/{league['id']}", json={"banner_url": BANNER_LEAGUE})
    first = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    second = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()

    async def banner(created):
        row = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
        return row.get("banner_url")

    assert await banner(first) == BANNER_LEAGUE, "neue Staffel trägt das geltende Banner"
    own = "/api/static/uploads/probe-eigenes-turnierbanner.webp"
    await flow.db.tournaments.update_one({"id": second["tournament_id"]}, {"$set": {"banner_url": own}})

    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"banner_url": BANNER_SEASON})
    assert await banner(first) == BANNER_SEASON, "Season-Banner gilt sofort"
    assert await banner(second) == own, "ein eigenes Turnierbanner bleibt"

    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"banner_url": None})
    assert await banner(first) == BANNER_LEAGUE
    await flow.patch(f"{ADMIN}/{league['id']}", json={"banner_url": None})
    assert not await banner(first)
    assert await banner(second) == own


@pytest.mark.asyncio
async def test_only_the_tournament_lead_designs(flow):
    _admin, league, season, division = await setup(flow)
    member = await flow.add_user(name="mitglied")
    flow.act_as(member)
    assert (await flow.patch(f"{ADMIN}/{league['id']}", json={"emblem_url": EMBLEM_LEAGUE})).status_code in (401, 403)
    assert (await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"prizes": []})).status_code in (401, 403)
    assert (await flow.patch(f"{ADMIN}/divisions/{division['id']}", json={"prizes": []})).status_code in (401, 403)


@pytest.mark.asyncio
async def test_team_page_and_seo_show_the_look(flow):
    from routes.seo_render_routes import league_season_meta

    admin, league, season, division = await setup(flow)
    await flow.patch(f"{ADMIN}/{league['id']}", json={"emblem_url": EMBLEM_LEAGUE, "banner_url": BANNER_LEAGUE})
    base = {"site_name": "Probe", "image": "/logo.png", "title": "Probe", "description": ""}
    meta = await league_season_meta(flow.db, "probe-shooter", "season-1", base, "https://example.test")
    assert meta["image"] == f"https://example.test{BANNER_LEAGUE}"
    await flow.patch(f"{ADMIN}/{league['id']}", json={"banner_url": None})
    meta = await league_season_meta(flow.db, "probe-shooter", "season-1", base, "https://example.test")
    assert meta["image"].endswith("/logo.png")

    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    await flow.db.teams.insert_one({"id": "team-probe", "name": "Probe Löwen", "member_ids": [], "leader_id": admin["id"]})
    await flow.db.tournament_registrations.insert_one({
        "id": "reg-probe", "tournament_id": created["tournament_id"], "team_id": "team-probe", "status": "approved",
        "registration_type": "team", "display_name": "Probe Löwen · Probe B", "squad_name": "Probe B",
        "identity_key": f"{created['tournament_id']}:team:team-probe"})
    await flow.db.tournaments.update_one({"id": created["tournament_id"]}, {"$set": {"status": "live"}})
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"emblem_url": EMBLEM_SEASON})
    flow.act_as(None)
    from services.team_page import team_overview

    overview = await team_overview(flow.db, {"id": "team-probe", "name": "Probe Löwen"}, None, insider=True)
    assert overview["league"][0]["emblem_url"] == EMBLEM_SEASON


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _length=None):
        return [dict(row) for row in self.rows]


class _StaleTournaments:
    """Liest einen alten Stand (Staffel ohne Banner), schreibt aber in die echte Sammlung - wie ein gleichzeitiges
    Speichern in der Turnierverwaltung zwischen Lesen und Schreiben."""

    def __init__(self, real, rows):
        self.real, self.rows = real, rows

    def find(self, *_args, **_kwargs):
        return _Cursor(self.rows)

    async def update_one(self, *args, **kwargs):
        return await self.real.update_one(*args, **kwargs)


@pytest.mark.asyncio
async def test_apply_banner_keeps_an_own_banner_set_at_the_same_time(flow):
    from services import league_service

    _admin, league, season, division = await setup(flow)
    created = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    stale = [{"id": created["tournament_id"], "banner_url": None}]
    own = "/api/static/uploads/probe-eigenes-turnierbanner.webp"
    await flow.db.tournaments.update_one({"id": created["tournament_id"]}, {"$set": {"banner_url": own}})

    class StaleDb:
        tournaments = _StaleTournaments(flow.db.tournaments, stale)

    league_doc = {**(await flow.db.leagues.find_one({"id": league["id"]}, {"_id": 0})), "banner_url": BANNER_LEAGUE}
    season_doc = await flow.db.league_seasons.find_one({"id": season["id"]}, {"_id": 0})
    assert await league_service.apply_banner(StaleDb(), league_doc, season_doc) == 0
    row = await flow.db.tournaments.find_one({"id": created["tournament_id"]}, {"_id": 0})
    assert row["banner_url"] == own, "das gleichzeitig gesetzte eigene Banner bleibt"
