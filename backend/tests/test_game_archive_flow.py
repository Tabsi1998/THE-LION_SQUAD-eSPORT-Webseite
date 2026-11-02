"""Spiele archivieren statt löschen (#2129, SP1) - durch die echten Routen.

Löschen geht nur ohne Verwendung, sonst 409 mit Zählung. Archiviert: beim Anlegen nicht mehr zur Wahl, alles Bestehende
zeigt und nutzt das Spiel weiter, ``GET /api/games`` bleibt lesbar. Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402

SHOOTER = {"name": "Probe Shooter", "match_modes": [{"mode": "stellung", "label": "Stellung"}]}
SERIES = "/api/reference-series/admin"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup_game(flow, **fields) -> dict:
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    created = await flow.post("/api/games", json={**SHOOTER, **fields})
    assert created.status_code == 200, created.text
    return created.json()


async def archive(flow, game: dict) -> dict:
    response = await flow.patch(f"/api/games/{game['id']}", json={"status": "archived"})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_an_unused_game_can_be_deleted_with_its_default_pool(flow):
    game = await setup_game(flow)
    used = (await flow.get(f"/api/games/{game['id']}/usage")).json()
    assert used["total"] == 0 and used["text"] == ""
    await flow.db.map_pools.insert_one({"id": new_id(), "scope": "game_default", "scope_id": game["id"], "version": 1,
                                        "game_id": game["id"], "modes": []})
    assert (await flow.get(f"/api/games/{game['id']}/usage")).json()["total"] == 0, "der eigene Standard-Pool zählt nicht"

    deleted = await flow.delete(f"/api/games/{game['id']}")
    assert deleted.status_code == 200, deleted.text
    assert await flow.db.games.find_one({"id": game["id"]}) is None
    assert await flow.db.map_pools.count_documents({"scope_id": game["id"]}) == 0
    gone = await flow.delete(f"/api/games/{game['id']}")
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_a_used_game_refuses_deletion_with_a_count_and_stays(flow):
    game = await setup_game(flow)
    await flow.create_tournament(game_id=game["id"])
    await flow.create_tournament(game_id=game["id"])
    await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante", "modes": ["stellung"]})
    await flow.post("/api/games", json={"name": "Probe Version", "kind": "edition", "parent_game_id": game["id"]})

    refused = await flow.delete(f"/api/games/{game['id']}")

    assert refused.status_code == 409
    assert "2 Turniere" in refused.json()["detail"] and "1 Map" in refused.json()["detail"]
    assert "1 Spielversion" in refused.json()["detail"] and "Archiviere" in refused.json()["detail"]
    assert await flow.db.games.find_one({"id": game["id"]}), "das Spiel bleibt"
    counts = (await flow.get(f"/api/games/{game['id']}/usage")).json()["counts"]
    assert counts["tournaments"] == 2 and counts["maps"] == 1 and counts["editions"] == 1


@pytest.mark.asyncio
async def test_usage_counts_series_servers_stations_teams_and_profiles(flow):
    game = await setup_game(flow)
    for collection in ("reference_lineages", "references", "reference_aliases", "f1_challenges", "game_servers", "stations", "team_squads", "leagues"):
        await getattr(flow.db, collection).insert_one({"id": new_id(), "game_id": game["id"]})
    mila = await flow.add_user(name="Mila")
    await flow.db.users.update_one({"id": mila["id"]}, {"$set": {"game_ids": {game["slug"]: {"id": "Probe#1"}}}})
    await flow.post("/api/games", json={"name": "Quelle", "identity_source_game_id": game["id"]})

    counts = (await flow.get(f"/api/games/{game['id']}/usage")).json()["counts"]

    for key in ("series", "references", "name_links", "challenges", "servers", "stations", "teams", "leagues", "profiles", "identity_sources"):
        assert counts[key] == 1, key
    refused = await flow.delete(f"/api/games/{game['id']}")
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_an_archived_game_is_read_like_before_and_can_be_brought_back(flow):
    game = await setup_game(flow)
    tournament = await flow.create_tournament(game_id=game["id"])

    archived = await archive(flow, game)
    assert archived["status"] == "archived" and archived["archived_at"]

    # Die Liste, die alle lesen, bleibt vollständig - nur um das Feld reicher.
    listed = (await flow.get("/api/games")).json()
    assert [row["id"] for row in listed] == [game["id"]] and listed[0]["status"] == "archived"
    assert (await flow.get(f"/api/games/{game['slug']}")).status_code == 200
    # Das Turnier zeigt das Spiel weiter.
    shown = (await flow.get(f"/api/tournaments/{tournament['id']}")).json()
    assert shown["game"]["id"] == game["id"]
    # Maps und Pools lassen sich weiter pflegen.
    assert (await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Nebelwerk", "modes": ["stellung"]})).status_code == 200

    back = await flow.patch(f"/api/games/{game['id']}", json={"status": "active"})
    assert back.json()["status"] == "active" and back.json()["archived_at"] is None


@pytest.mark.asyncio
async def test_an_archived_game_cannot_be_chosen_anew_but_keeps_what_chose_it(flow):
    game = await setup_game(flow)
    other = (await flow.post("/api/games", json={"name": "Probe Racer"})).json()
    tournament = await flow.create_tournament(game_id=game["id"])
    other_tournament = await flow.create_tournament(game_id=other["id"])
    server = (await flow.post("/api/game-servers", json={"name": "Probe Server", "game_id": game["id"]})).json()
    await archive(flow, game)

    new_tournament = await flow.post("/api/tournaments", json={"title": "Probe Cup", "game_id": game["id"],
                                                               "start_date": "2030-01-01T18:00:00+00:00"})
    assert new_tournament.status_code == 422 and "archiviert" in new_tournament.json()["detail"]
    # Ein unverändertes Spiel stört kein anderes Speichern, ein Wechsel darauf geht nicht.
    same = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"game_id": game["id"], "title": "Neuer Titel"})
    assert same.status_code == 200, same.text
    changed = await flow.patch(f"/api/tournaments/{other_tournament['id']}", json={"game_id": game["id"]})
    assert changed.status_code == 422

    assert (await flow.post("/api/game-servers", json={"name": "Zweiter Server", "game_id": game["id"]})).status_code == 422
    assert (await flow.patch(f"/api/game-servers/{server['id']}", json={"game_id": game["id"], "name": "Umbenannt"})).status_code == 200

    league = await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})
    assert league.status_code == 422 and "archiviert" in league.json()["detail"]
    lineage = await flow.post(f"{SERIES}/lineages", json={"title": "Probe Spur", "kind": "series", "game_id": game["id"]})
    assert lineage.status_code == 422
    edition = await flow.post("/api/games", json={"name": "Version", "kind": "edition", "parent_game_id": game["id"]})
    assert edition.status_code == 422
    station = await flow.post("/api/stations", json={"name": "Station 1", "device_type": "switch", "game_id": game["id"]})
    assert station.status_code == 422 and "archiviert" in station.json()["detail"]
    many = await flow.post("/api/stations/bulk", json={"count": 2, "game_id": game["id"]})
    assert many.status_code == 422 and "archiviert" in many.json()["detail"]
    assert await flow.db.stations.count_documents({"game_id": game["id"]}) == 0
    free = await flow.post("/api/stations", json={"name": "Station 1", "device_type": "switch"})
    assert free.status_code == 200, free.text


@pytest.mark.asyncio
async def test_a_running_league_goes_on_with_an_archived_game(flow):
    game = await setup_game(flow)
    league = await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})
    assert league.status_code == 200, league.text
    await archive(flow, game)

    season = await flow.post(f"/api/admin/leagues/{league.json()['id']}/seasons",
                             json={"name": "Season 2", "start_date": "2030-01-07T18:00:00+00:00"})
    assert season.status_code == 200, season.text
    admin_list = (await flow.get("/api/admin/leagues")).json()
    assert admin_list["games"][0]["status"] == "archived"
    assert admin_list["leagues"][0]["game_name"] == game["name"]
