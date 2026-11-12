"""Turnierliste der Verwaltung (#2111): bis zu 500 Turniere, ohne jedes einzeln nachzufragen.

Die lange Liste liefert dieselben Felder wie vorher und wie das einzelne Turnier - Spiel, Event, Partner und
Teilnehmerzahl kommen aber mit einer Abfrage für alle. Erfundene Turniere.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import tournament_crud_routes as crud  # noqa: E402

ADDED = ("game", "event", "partners", "participant_count", "league_label")


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def seed(flow):
    await flow.db.games.insert_many([
        {"id": "g-reihe", "name": "Probe-Reihe", "slug": "reihe"},
        {"id": "g-1", "name": "Teil 1", "kind": "edition", "parent_game_id": "g-reihe", "slug": "teil-1"},
    ])
    await flow.db.events.insert_many([
        {"id": "e-offen", "slug": "e-offen", "name": "Offenes Event", "status": "published", "visibility": "public", "tournaments": ["x"]},
        {"id": "e-entwurf", "slug": "e-entwurf", "name": "Entwurf", "status": "draft", "visibility": "public"},
        {"id": "e-intern", "slug": "e-intern", "name": "Internes Event", "status": "published", "visibility": "members"},
    ])
    await flow.db.partners.insert_many([
        {"id": "p-1", "slug": "partner-1", "name": "Partner 1", "kind": "club"},
        {"id": "p-aus", "slug": "partner-aus", "name": "Partner aus", "is_active": False},
    ])
    await flow.create_tournament(id="t-a", slug="a", game_id="g-1", event_id="e-offen", partner_ids=["p-1", "p-aus"],
                                 created_at="2026-01-03T10:00:00+00:00")
    await flow.create_tournament(id="t-b", slug="b", game_id="g-1", event_id="e-entwurf", created_at="2026-01-02T10:00:00+00:00")
    await flow.create_tournament(id="t-c", slug="c", game_id="fehlt", event_id="e-intern", created_at="2026-01-01T10:00:00+00:00")
    tournament = await flow.db.tournaments.find_one({"id": "t-a"}, {"_id": 0})
    await flow.register(tournament, await flow.add_user(name="Dabei"), status="approved")
    await flow.register(tournament, await flow.add_user(name="Da"), status="checked_in")
    await flow.register(tournament, await flow.add_user(name="Abgelehnt"), status="rejected")


@pytest.mark.asyncio
async def test_the_list_says_the_same_as_each_single_tournament(flow):
    await seed(flow)
    flow.act_as(None)
    listed = {row["id"]: row for row in (await flow.get("/api/tournaments")).json()}
    assert set(listed) == {"t-a", "t-b", "t-c"}

    for tid, row in listed.items():
        single = await crud._enrich_tournament(await flow.db.tournaments.find_one({"id": tid}, {"_id": 0}), None)
        for key in ADDED:
            assert row.get(key) == single.get(key), (tid, key)
        assert row["public_phase"]["state"] == single["public_phase"]["state"], tid

    first = listed["t-a"]
    assert first["participant_count"] == 2
    assert first["game"]["display_name"] == "Probe-Reihe: Teil 1"
    assert first["event"]["name"] == "Offenes Event" and "tournaments" not in first["event"]
    assert [partner["id"] for partner in first["partners"]] == ["p-1"]
    assert "event" not in listed["t-b"] and listed["t-b"]["participant_count"] == 0
    assert "event" not in listed["t-c"] and listed["t-c"]["game"] is None


@pytest.mark.asyncio
async def test_the_long_list_asks_once_not_per_tournament(flow, monkeypatch):
    await flow.db.games.insert_one({"id": "g-1", "name": "Teil 1", "slug": "teil-1"})
    await flow.db.events.insert_one({"id": "e-1", "slug": "e-1", "name": "Event", "status": "published", "visibility": "public"})
    for number in range(40):
        await flow.create_tournament(id=f"t-{number:02d}", slug=f"t-{number:02d}", game_id="g-1", event_id="e-1", partner_ids=["p-1"])
    staff = await flow.add_staff()
    flow.act_as(staff)

    calls = {"single": 0, "games": 0}
    original_identity = crud._enrich_game_identity

    async def single(*_args, **_kwargs):
        calls["single"] += 1

    async def identity(db, game):
        calls["games"] += 1
        return await original_identity(db, game)

    monkeypatch.setattr(crud, "_enrich_tournament", single)
    monkeypatch.setattr(crud, "_enrich_game_identity", identity)
    response = await flow.get("/api/tournaments", params={"include_drafts": "true", "managed": "true", "limit": 500})
    assert response.status_code == 200, response.text
    assert len(response.json()) == 40
    assert calls == {"single": 0, "games": 1}, "ein Spiel, das in 40 Turnieren vorkommt, wird einmal aufbereitet"
    games = [row["game"] for row in response.json()]
    assert all(game["id"] == "g-1" for game in games) and len({id(game) for game in games}) == 40
