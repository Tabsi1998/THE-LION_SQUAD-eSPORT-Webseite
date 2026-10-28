"""Öffentliche Lese-API der Liga (docs/LIGA.md, Abschnitt 10, #1622): Ligen → Seasons → Liga N → Staffeln.

Der Schalter ist die Sichtbarkeit der Season: ``off`` sieht niemand (404), ``admins`` nur die Turnierleitung,
``members`` wie „Nur Mitglieder“ bei Turnieren, ``public`` alle. Die Navigation zeigt „Liga“ nur, wenn ``/api/leagues``
für die Person mindestens eine Season liefert. Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

ADMIN = "/api/admin/leagues"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    admin = await flow.add_staff()
    flow.act_as(admin)
    game = (await flow.post("/api/games", json={"name": "Probe Shooter", "slug": "probe-shooter"})).json()
    league = (await flow.post(ADMIN, json={"name": "Probe-Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"{ADMIN}/{league['id']}/seasons", json={
        "start_date": "2026-11-10T00:00:00", "rules_text": "Regeltext"})).json()
    division = (await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={"nickname": "Elite"})).json()
    staffel = (await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={})).json()
    member = await flow.add_user(name="mitglied")
    member["is_club_member"] = True
    guest = await flow.add_user(name="gast")
    return admin, league, season, staffel, member, guest


async def sees(flow, person) -> tuple[int, int]:
    """(Anzahl Ligen in der Liste, Status der Season-Seite) für diese Person."""
    flow.act_as(person)
    listing = (await flow.get("/api/leagues")).json()["leagues"]
    page = await flow.get("/api/leagues/probe-shooter/season-1")
    return len(listing), page.status_code


@pytest.mark.asyncio
async def test_visibility_off_admins_members_public(flow):
    admin, _league, season, _staffel, member, guest = await setup(flow)
    people = {"anonym": None, "gast": guest, "mitglied": member, "leitung": admin}

    async def matrix():
        return {name: await sees(flow, person) for name, person in people.items()}

    assert await matrix() == {"anonym": (0, 404), "gast": (0, 404), "mitglied": (0, 404), "leitung": (0, 404)}

    for visibility, expected in (
        ("admins", {"anonym": (0, 404), "gast": (0, 404), "mitglied": (0, 404), "leitung": (1, 200)}),
        ("members", {"anonym": (0, 404), "gast": (0, 404), "mitglied": (1, 200), "leitung": (1, 200)}),
        ("public", {"anonym": (1, 200), "gast": (1, 200), "mitglied": (1, 200), "leitung": (1, 200)}),
    ):
        flow.act_as(admin)
        response = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": visibility})
        assert response.status_code == 200
        assert await matrix() == expected, visibility


@pytest.mark.asyncio
async def test_the_season_page_lists_divisions_and_staffeln_with_tournament_ids(flow):
    admin, league, season, staffel, _member, _guest = await setup(flow)
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "public"})
    await flow.db.tournaments.update_one({"id": staffel["tournament_id"]}, {"$set": {"status": "registration_closed"}})
    flow.act_as(None)

    listing = (await flow.get("/api/leagues")).json()["leagues"]
    assert listing[0]["slug"] == "probe-shooter"
    assert [row["slug"] for row in listing[0]["seasons"]] == ["season-1"]

    page = (await flow.get("/api/leagues/probe-shooter/season-1")).json()
    assert page["league"]["name"] == "Probe-Liga"
    assert page["season"]["rules_text"] == "Regeltext"
    assert page["season"]["match_points"] == {"win": 3, "draw": 1, "loss": 0}
    assert "visibility" not in page["season"] and "created_by" not in page["season"]
    division = page["divisions"][0]
    assert division["label"] == "Liga 1 · Elite"
    assert division["staffeln"][0]["tournament_id"] == staffel["tournament_id"]
    assert division["staffeln"][0]["staffel"] == "A"
    assert (await flow.get("/api/leagues/probe-shooter/season-9")).status_code == 404
    assert (await flow.get("/api/leagues/unbekannt/season-1")).status_code == 404


@pytest.mark.asyncio
async def test_staffel_tournaments_follow_the_season_visibility(flow):
    admin, _league, season, staffel, member, guest = await setup(flow)
    url = f"/api/tournaments/{staffel['tournament_id']}"

    # Status bleibt Entwurf - die Turnierseite sieht nur die Leitung.
    flow.act_as(guest)
    assert (await flow.get(url)).status_code == 404

    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "members"})
    await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")
    await flow.db.tournaments.update_one({"id": staffel["tournament_id"]}, {"$set": {"status": "live"}})
    flow.act_as(member)
    assert (await flow.get(url)).status_code == 200
    flow.act_as(guest)
    assert (await flow.get(url)).status_code == 403

    flow.act_as(admin)
    await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "off"})
    await flow.post(f"{ADMIN}/seasons/{season['id']}/sync")
    stored = await flow.db.tournaments.find_one({"id": staffel["tournament_id"]}, {"_id": 0})
    assert (stored["visibility"], stored["is_public"]) == ("internal", False)
    flow.act_as(member)
    assert (await flow.get(url)).status_code == 404
