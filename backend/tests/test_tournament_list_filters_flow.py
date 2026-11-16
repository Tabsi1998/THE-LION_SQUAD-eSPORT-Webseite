"""Turnierliste nach Spiel, online/vor Ort und „Nur meine“ filtern (#1276).

- ``game=<slug>`` (so verlinkt das Spiele-Regal, #1333) oder wie bisher ``game_id``.
- ``mode=online`` bzw. ``mode=local``: ein hybrides Turnier zählt zu beiden; ohne Angabe gilt ein Turnier als online
  (dieselbe Regel wie ``tournament_rules.tournament_event_mode``).
- ``mine=true``: nur Turniere mit eigener Anmeldung oder einer des eigenen Teams - ein Gast bekommt nichts.
- Alles wirkt zusammen mit der Phase (``status``). Mit ``paged=true`` nennt ``games`` die Spiele, zu denen es Turniere
  gibt (für die Chips), unabhängig von den gewählten Filtern.
Erfundene Turniere und Spiele."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def seed(flow):
    await flow.db.games.insert_many([
        {"id": "g-mk", "slug": "mario-kart", "name": "Mario Kart World"},
        {"id": "g-ssb", "slug": "smash", "name": "Super Smash Bros."},
        {"id": "g-leer", "slug": "ohne-turnier", "name": "Ohne Turnier"},
    ])
    rows = [
        ("t-mk-local", "g-mk", {"event_mode": "local"}, "registration_open"),
        ("t-mk-online", "g-mk", {"event_mode": "online"}, "live"),
        ("t-ssb-hybrid", "g-ssb", {"event_mode": "hybrid"}, "registration_open"),
        ("t-ssb-legacy", "g-ssb", {}, "registration_open"),
        ("t-ssb-legacy-hybrid", "g-ssb", {"is_hybrid": True}, "completed"),
        ("t-mk-draft", "g-mk", {"event_mode": "local"}, "draft"),
    ]
    for tid, game_id, fields, status in rows:
        await flow.create_tournament(id=tid, slug=f"cup-{tid}", game_id=game_id, status=status, **fields)


async def ids(flow, **params) -> set[str]:
    response = await flow.get("/api/tournaments", params={"compact": "true", "league": "exclude", **params})
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()}


@pytest.mark.asyncio
async def test_filter_by_game_slug_and_by_mode(flow):
    await seed(flow)
    flow.act_as(None)

    assert await ids(flow, game="mario-kart") == {"t-mk-local", "t-mk-online"}
    assert await ids(flow, game="gibt-es-nicht") == set()
    assert await ids(flow, mode="local") == {"t-mk-local", "t-ssb-hybrid", "t-ssb-legacy-hybrid"}
    assert await ids(flow, mode="online") == {"t-mk-online", "t-ssb-hybrid", "t-ssb-legacy", "t-ssb-legacy-hybrid"}
    assert await ids(flow, game="smash", mode="local", status="registration_open") == {"t-ssb-hybrid"}
    refused = await flow.get("/api/tournaments", params={"mode": "irgendwo"})
    assert refused.status_code == 422


@pytest.mark.asyncio
async def test_only_mine_shows_own_and_team_registrations_and_nothing_for_guests(flow):
    await seed(flow)
    player = await flow.add_user(name="Spielerin")
    other = await flow.add_user(name="Jemand")
    await flow.db.tournament_registrations.insert_many([
        {"id": "r1", "tournament_id": "t-mk-local", "user_id": player["id"], "status": "approved"},
        {"id": "r2", "tournament_id": "t-ssb-hybrid", "team_id": "team-1", "status": "checked_in"},
        {"id": "r3", "tournament_id": "t-mk-online", "user_id": player["id"], "status": "rejected"},
        {"id": "r4", "tournament_id": "t-ssb-legacy", "user_id": other["id"], "status": "approved"},
    ])
    await flow.db.team_members.insert_one({"team_id": "team-1", "user_id": player["id"]})

    flow.act_as(player)
    assert await ids(flow, mine="true") == {"t-mk-local", "t-ssb-hybrid"}
    assert await ids(flow, mine="true", game="smash") == {"t-ssb-hybrid"}
    assert await ids(flow, mine="true", mode="online") == {"t-ssb-hybrid"}

    flow.act_as(None)
    assert await ids(flow, mine="true") == set(), "ein Gast hat keine eigenen Anmeldungen"


@pytest.mark.asyncio
async def test_paged_list_names_the_games_with_tournaments_for_the_chips(flow):
    await seed(flow)
    flow.act_as(None)

    page = (await flow.get("/api/tournaments", params={
        "compact": "true", "paged": "true", "league": "exclude", "game": "mario-kart", "mode": "local"})).json()
    assert {row["id"] for row in page["items"]} == {"t-mk-local"}
    assert page["total"] == 1
    assert page["games"] == [
        {"id": "g-mk", "slug": "mario-kart", "name": "Mario Kart World"},
        {"id": "g-ssb", "slug": "smash", "name": "Super Smash Bros."},
    ], "nur Spiele mit Turnieren - auch wenn gerade nach einem Spiel gefiltert ist"


# ---------------------------------------------------------------- Review #1276

@pytest.mark.asyncio
async def test_game_chips_follow_the_visibility_of_the_list(flow):
    await seed(flow)
    await flow.db.games.insert_one({"id": "g-club", "slug": "vereinsspiel", "name": "Vereinsspiel"})
    await flow.create_tournament(id="t-club", slug="cup-club", game_id="g-club", status="registration_open",
                                 visibility="members")
    await flow.create_tournament(id="t-hidden", slug="cup-hidden", game_id="g-leer", status="registration_open",
                                 is_public=False)

    flow.act_as(None)
    guest = (await flow.get("/api/tournaments", params={"compact": "true", "paged": "true", "league": "exclude"})).json()
    assert [game["slug"] for game in guest["games"]] == ["mario-kart", "smash"], "keine Chips für Unsichtbares"

    player = await flow.add_user(name="Mitspielerin")
    await flow.db.tournament_registrations.insert_one(
        {"id": "r-club", "tournament_id": "t-club", "user_id": player["id"], "status": "approved"})
    flow.act_as(player)
    own = (await flow.get("/api/tournaments", params={"compact": "true", "paged": "true", "league": "exclude"})).json()
    assert "vereinsspiel" in [game["slug"] for game in own["games"]], "eigene Turniere zählen immer"


@pytest.mark.asyncio
async def test_games_only_on_the_first_page_old_slugs_and_a_length_limit(flow):
    await seed(flow)
    await flow.db.games.update_one({"id": "g-mk"}, {"$set": {"slug_history": ["mk8"]}})
    flow.act_as(None)

    later = (await flow.get("/api/tournaments", params={"compact": "true", "paged": "true", "offset": 1})).json()
    assert "games" not in later
    assert await ids(flow, game="mk8") == {"t-mk-local", "t-mk-online"}, "ein alter Kurzname aus einem Link"
    too_long = await flow.get("/api/tournaments", params={"game": "x" * 121})
    assert too_long.status_code == 422
