"""Staffel = Turnier: Nebenwirkungen (docs/LIGA.md, Abschnitt 7, #1622).

Eine Liga-Staffel ist ein Turnier mit ``league_context``. Jahreswertung, Pokale, XP, Turnierzähler, Team-Stufe,
Startseite, öffentlicher Kalender, App-Startseite, Jahresrückblick, Sponsoring-Zahlen und Stream-Meldung lassen sie
aus; Profil, Teamseite, Suche und SEO kennzeichnen sie („Liga · Staffel A“). Jeder Test prüft daneben ein normales
Turnier, das sich verhalten muss wie bisher. Nur erfundene Namen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

CONTEXT = {"league_id": "liga-1", "season_id": "season-1", "division_id": "division-1", "staffel": "A"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def pair(flow, **fields):
    """Ein normales Turnier und eine Staffel mit denselben Feldern - zum Vergleichen."""
    normal = await flow.create_tournament(title="Herbst-Cup", slug="herbst-cup", **fields)
    staffel = await flow.create_tournament(title="Probe-Liga Season 1 · Liga 1 · Staffel A", slug="probe-liga-a",
                                           league_context=dict(CONTEXT), format="league", team_mode="team",
                                           **fields)
    return normal, staffel


async def ids_of(rows) -> set:
    return {row.get("id") for row in rows}


# ---------------------------------------------------------------- Turnierliste

@pytest.mark.asyncio
async def test_tournament_list_includes_by_default_and_filters_on_request(flow):
    normal, staffel = await pair(flow)
    flow.act_as(None)

    everything = (await flow.get("/api/tournaments")).json()
    assert await ids_of(everything) == {normal["id"], staffel["id"]}  # die App ohne neuen Build sieht die Staffel
    assert next(row for row in everything if row["id"] == staffel["id"])["league_label"] == "Liga · Staffel A"
    assert "league_label" not in next(row for row in everything if row["id"] == normal["id"])

    web = (await flow.get("/api/tournaments", params={"league": "exclude", "compact": "true"})).json()
    assert await ids_of(web) == {normal["id"]}
    only = (await flow.get("/api/tournaments", params={"league": "only", "compact": "true"})).json()
    assert await ids_of(only) == {staffel["id"]}
    assert only[0]["league_context"]["staffel"] == "A" and only[0]["league_label"] == "Liga · Staffel A"
    compact_normal = (await flow.get("/api/tournaments", params={"compact": "true"})).json()
    assert "league_context" not in next(row for row in compact_normal if row["id"] == normal["id"])
    assert (await flow.get("/api/tournaments", params={"league": "sonstwas"})).status_code == 422


# ---------------------------------------------------------------- Jahreswertung, Pokale, XP

@pytest.mark.asyncio
async def test_publishing_results_of_a_staffel_awards_no_season_points_xp_or_trophies(flow, monkeypatch):
    import badges
    from services import season_service

    normal, staffel = await pair(flow, status="completed")
    for tournament in (normal, staffel):
        for index in (1, 2):
            await flow.register(tournament, await flow.add_user(name=f"Spieler {index}"))
    points, xp_calls = [], []

    async def fake_award_points(**kwargs):
        points.append(kwargs["source_id"])

    async def fake_xp(user_id, source, ref, **kwargs):
        xp_calls.append(ref)

    monkeypatch.setattr(season_service, "award_points", fake_award_points)
    monkeypatch.setattr(badges, "_xp", fake_xp)
    flow.act_as(await flow.add_staff())

    for tournament in (normal, staffel):
        published = await flow.post(f"/api/tournaments/{tournament['id']}/status",
                                    json={"status": "results_published", "force": True})
        assert published.status_code == 200, published.text

    assert set(points) == {normal["id"]}
    assert staffel["id"] not in xp_calls
    assert await flow.db.tournament_awards.count_documents({"tournament_id": staffel["id"]}) == 0


@pytest.mark.asyncio
async def test_awards_backfill_and_xp_for_registration_skip_staffeln(flow, monkeypatch):
    import badges
    from services import awards

    normal, staffel = await pair(flow, status="results_published")
    assert await awards.record_tournament_awards(flow.db, staffel["id"]) == 0
    assert (await awards.rebuild_all_awards(flow.db))["tournaments"] == 1

    granted = []

    async def fake_xp(user_id, source, ref, **kwargs):
        granted.append((source, ref))

    async def no_progress(*args, **kwargs):
        return None

    monkeypatch.setattr(badges, "_xp", fake_xp)
    monkeypatch.setattr(badges, "evaluate_user_progress", no_progress)
    for tournament in (normal, staffel):
        await badges.on_tournament_registered("person-1", tournament["id"])
        await badges.on_checked_in("person-1", tournament["id"])
        await badges.on_tournament_completed(tournament["id"], [{"user_id": "person-1", "rank": 1}])
    assert {ref for _source, ref in granted} == {normal["id"]}


# ---------------------------------------------------------------- Zähler, Team-Stufe, Jahreswertung

@pytest.mark.asyncio
async def test_tournament_counters_skip_staffeln_but_keep_normal_tournaments(flow):
    from services import achievement_progress
    from services.achievement_counters import REGISTRY, Context

    normal, staffel = await pair(flow, status="completed", game_id="spiel-1")
    player = await flow.add_user(name="Zaehlerin")
    await flow.register(normal, player)
    await flow.register(staffel, player)

    progress = await achievement_progress.compute_user_progress(player["id"])
    assert progress["tournaments_registered"] == 1
    ctx = Context(flow.db, player["id"])
    assert await REGISTRY["tournaments_registered"].compute(ctx) == 1
    assert await REGISTRY["tournaments_completed"].compute(ctx) == 1
    assert set(await ctx.tournaments()) == {normal["id"]}


@pytest.mark.asyncio
async def test_team_level_counts_only_normal_tournaments(flow):
    from services import team_levels

    normal, staffel = await pair(flow, winner_team_id="team-1")
    await flow.db.teams.insert_one({"id": "team-1", "name": "Probe-Team", "member_ids": []})
    for tournament in (normal, staffel):
        await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": tournament["id"],
                                                           "team_id": "team-1", "status": "approved"})
    stats = (await team_levels.compute_all_team_levels())["team-1"]
    assert stats["tournaments"] == 1 and stats["wins"] == 1


@pytest.mark.asyncio
async def test_season_sources_ignore_staffeln_even_when_listed(flow):
    from routes.season_routes import _resolve_season_sources

    normal, staffel = await pair(flow, status="completed")
    automatic, _ = await _resolve_season_sources({})
    assert set(automatic) == {normal["id"]}
    listed, _ = await _resolve_season_sources({"tournament_ids": [normal["id"], staffel["id"]],
                                               "f1_challenge_ids": ["fastlap-1"]})
    assert listed == [normal["id"]]


# ---------------------------------------------------------------- Startseite, Kalender, App, Zahlen

@pytest.mark.asyncio
async def test_home_calendar_app_and_numbers_leave_staffeln_out(flow):
    from routes.home_routes import _club_numbers
    from routes.mobile_routes import _public_upcoming
    from routes.sponsoring_routes import counted_numbers
    from services import calendar_items

    soon = (now_utc() + timedelta(days=2)).isoformat()
    normal, staffel = await pair(flow, status="live", start_date=soon,
                                 end_date=(now_utc() + timedelta(days=60)).isoformat())
    flow.act_as(None)

    home = (await flow.get("/api/home/state")).json()
    live_ids = {row["id"] for row in home["live"]["tournaments"]}
    assert normal["id"] in live_ids and staffel["id"] not in live_ids

    public = await calendar_items.collect(flow.db, None)
    assert {item["id"] for item in public if item["kind"] == "tournament"} == {normal["id"]}
    player = await flow.add_user(name="Kalender")
    own = {"events": {}, "tournaments": {staffel["id"]: {"state": "approved"}}, "fastlaps": {}}
    personal = await calendar_items.collect(flow.db, player, own, include_own=True)
    assert staffel["id"] in {item["id"] for item in personal if item["kind"] == "tournament"}

    upcoming = await _public_upcoming(None)
    assert staffel["id"] not in {row.get("id") for row in upcoming.get("tournaments") or []}

    numbers = await _club_numbers(flow.db)
    assert numbers["tournaments"] == 1
    yesterday = (now_utc() - timedelta(days=1)).isoformat()
    await flow.db.tournaments.update_many({}, {"$set": {"start_date": yesterday}})
    assert (await counted_numbers(flow.db))["tournaments_year"] == 1


@pytest.mark.asyncio
async def test_stream_announcements_skip_staffeln(flow, monkeypatch):
    from services import tournament_streams

    normal, staffel = await pair(flow, status="live")
    asked = []

    async def fake_streams(db, tournament, **kwargs):
        asked.append(tournament["id"])
        return []

    monkeypatch.setattr(tournament_streams, "live_streams_for_tournament", fake_streams)
    await tournament_streams.sync(flow.db)
    assert asked == [normal["id"]]


@pytest.mark.asyncio
async def test_year_review_counts_no_staffel(flow):
    from services import year_review

    normal, staffel = await pair(flow, status="completed", start_date="2026-11-10T10:00:00+00:00")
    assert set(await year_review._year_tournaments(flow.db, 2026)) == {normal["id"]}


# ---------------------------------------------------------------- Kennzeichnen: Profil, Suche, SEO

@pytest.mark.asyncio
async def test_public_profile_lists_the_staffel_marked_but_does_not_count_it(flow):
    normal, staffel = await pair(flow, status="completed")
    player = await flow.add_user(name="profilperson")
    await flow.db.users.update_one({"id": player["id"]}, {"$set": {"privacy_public_profile": True}})
    for tournament in (normal, staffel):
        await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": tournament["id"],
                                                           "user_id": player["id"], "status": "approved",
                                                           "final_position": 1})
    flow.act_as(None)
    profile = await flow.get(f"/api/users/public/{player['username']}")
    assert profile.status_code == 200, profile.text
    body = profile.json()
    listed = {row["id"]: row for row in body["tournaments"]}
    assert set(listed) == {normal["id"], staffel["id"]}
    assert listed[staffel["id"]]["league_label"] == "Liga · Staffel A"
    assert "league_label" not in listed[normal["id"]]
    assert body["stats"]["tournaments"] == 1 and body["stats"]["wins"] == 1


@pytest.mark.asyncio
async def test_team_page_marks_the_staffel(flow):
    from services.team_page import team_overview

    normal, staffel = await pair(flow, status="registration_closed")
    team = {"id": "team-1", "name": "Probe-Team", "member_ids": []}
    await flow.db.teams.insert_one(dict(team))
    for tournament in (normal, staffel):
        await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": tournament["id"],
                                                           "team_id": "team-1", "status": "approved"})
    overview = await team_overview(flow.db, team, None, insider=True)
    cards = {row["tournament"]["id"]: row["tournament"] for row in overview["upcoming"]}
    # Die App ohne neuen Build liest „upcoming“ - die Staffel bleibt dort, gekennzeichnet.
    assert cards[staffel["id"]]["league_label"] == "Liga · Staffel A"
    assert "league_label" not in cards[normal["id"]]


@pytest.mark.asyncio
async def test_search_and_seo_mark_a_staffel(flow):
    from routes.seo_render_routes import tournament_meta

    normal, staffel = await pair(flow, status="live")
    flow.act_as(None)
    rows = (await flow.get("/api/search", params={"q": "Staffel"})).json()["items"]
    staffel_row = next(row for row in rows if row.get("url") == f"/tournaments/{staffel['slug']}")
    assert staffel_row["subtitle"].startswith("Liga · Staffel A")
    plain_rows = (await flow.get("/api/search", params={"q": "Herbst"})).json()["items"]
    assert not next(row for row in plain_rows if row["kind"] == "tournament")["subtitle"].startswith("Liga")

    base = {"site_name": "Probe", "image": "/logo.png", "title": "Probe", "description": ""}
    meta = await tournament_meta(flow.db, staffel["slug"], "", base, "https://example.test")
    assert meta["description"].startswith("Liga · Staffel A")
    plain = await tournament_meta(flow.db, normal["slug"], "", base, "https://example.test")
    assert plain["description"].startswith("eSports Turnier")
