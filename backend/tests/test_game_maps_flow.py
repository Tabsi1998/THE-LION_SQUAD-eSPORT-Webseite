"""Map-Bibliothek je Spiel (#1616) - durch die echten Routen.

Eine Map gehört genau einem Spiel (oder einer Spielversion), hat einen eindeutigen Slug je Spiel, ein optionales Bild
aus dem eigenen Upload, eine Reihenfolge und ist aktiv oder archiviert. Die Zuordnung zu den Modi des Spiels
(``games.match_modes``) ist M:N - es gibt kein zweites Modussystem. Gelöscht wird nur, was nie in einem Pool stand.
Nur erfundene Map-Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

SHOOTER = {
    "name": "Probe Shooter",
    "match_modes": [
        {"mode": "stellung", "label": "Stellung"},
        {"mode": "snd", "label": "Suchen & Zerstören", "minutes": 25},
        {"mode": "kontrolle", "label": "Kontrolle"},
    ],
}
IMAGE = "/api/static/uploads/hafenkante-1.webp"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def as_admin(flow):
    admin = await flow.add_user(role="superadmin", name="admin")
    flow.act_as(admin)
    return admin


async def new_game(flow, **fields):
    response = await flow.post("/api/games", json={**SHOOTER, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def add_map(flow, game, **fields):
    response = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante", **fields})
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------- Modi: kompatibel erweitert

@pytest.mark.asyncio
async def test_a_mode_without_minutes_is_a_mode_for_maps_and_keeps_its_key(flow):
    await as_admin(flow)
    game = await new_game(flow)
    modes = {mode["mode"]: mode for mode in game["match_modes"]}
    assert modes["stellung"]["minutes"] is None and modes["snd"]["minutes"] == 25

    # Umbenennen behält die Kennung - die Maps zeigen weiter auf denselben Modus.
    renamed = await flow.patch(f"/api/games/{game['id']}", json={"match_modes": [
        {"mode": "stellung", "label": "Hardpoint"}, {"mode": "snd", "label": "Suchen & Zerstören", "minutes": 25}]})
    assert renamed.status_code == 200, renamed.text
    assert [mode["mode"] for mode in renamed.json()["match_modes"]] == ["stellung", "snd"]
    assert renamed.json()["match_modes"][0]["label"] == "Hardpoint"


# ---------------------------------------------------------------- Bibliothek anlegen und pflegen

@pytest.mark.asyncio
async def test_a_map_is_created_with_slug_image_modes_and_order(flow):
    admin = await as_admin(flow)
    game = await new_game(flow)
    first = await add_map(flow, game, image_url=IMAGE, modes=["stellung", "snd"], note="Hafen bei Nacht",
                          external_ref="map_hafen")
    second = await add_map(flow, game, name="Nebelwerk", modes=["kontrolle"])

    assert (first["slug"], first["status"], first["modes"], first["image_url"]) == (
        "hafenkante", "active", ["stellung", "snd"], IMAGE)
    assert (first["note"], first["external_ref"], first["game_id"], first["created_by"]) == (
        "Hafen bei Nacht", "map_hafen", game["id"], admin["id"])
    assert second["order"] > first["order"]

    listed = await flow.get(f"/api/games/{game['id']}/maps")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert [item["name"] for item in body["maps"]] == ["Hafenkante", "Nebelwerk"]
    assert [mode["mode"] for mode in body["game"]["modes"]] == ["stellung", "snd", "kontrolle"]
    assert body["maps"][0]["in_pools"] == 0


@pytest.mark.asyncio
async def test_the_slug_is_unique_per_game_but_the_same_name_in_another_game_is_its_own_map(flow):
    await as_admin(flow)
    game = await new_game(flow)
    other = await new_game(flow, name="Probe Shooter Zwei")
    await add_map(flow, game)

    twice = await flow.post(f"/api/games/{game['id']}/maps", json={"name": " hafenkante "})
    assert twice.status_code == 409
    same_slug = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafen Kante", "slug": "hafenkante"})
    assert same_slug.status_code == 409

    elsewhere = await add_map(flow, other)
    assert elsewhere["slug"] == "hafenkante" and elsewhere["game_id"] == other["id"]


@pytest.mark.asyncio
async def test_only_own_uploads_and_known_modes_are_accepted(flow):
    await as_admin(flow)
    game = await new_game(flow)
    foreign_image = await flow.post(f"/api/games/{game['id']}/maps",
                                    json={"name": "Nebelwerk", "image_url": "https://example.org/nebel.png"})
    assert foreign_image.status_code == 422
    svg = await flow.post(f"/api/games/{game['id']}/maps",
                          json={"name": "Nebelwerk", "image_url": "/api/static/uploads/nebel.svg"})
    assert svg.status_code == 422
    unknown_mode = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Nebelwerk", "modes": ["teamdeathmatch"]})
    assert unknown_mode.status_code == 422
    assert "teamdeathmatch" in unknown_mode.text


@pytest.mark.asyncio
async def test_rename_reorder_and_archive_keep_the_id_and_slug(flow):
    await as_admin(flow)
    game = await new_game(flow)
    first = await add_map(flow, game, modes=["stellung"])
    second = await add_map(flow, game, name="Nebelwerk")

    renamed = await flow.patch(f"/api/games/{game['id']}/maps/{first['id']}",
                               json={"name": "Hafenkante (Nacht)", "modes": ["stellung", "kontrolle"], "image_url": None})
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["id"], renamed.json()["slug"], renamed.json()["name"]) == (
        first["id"], "hafenkante", "Hafenkante (Nacht)")
    assert renamed.json()["modes"] == ["stellung", "kontrolle"]

    ordered = await flow.put(f"/api/games/{game['id']}/maps/order", json={"ids": [second["id"], first["id"]]})
    assert ordered.status_code == 200, ordered.text
    listed = (await flow.get(f"/api/games/{game['id']}/maps")).json()["maps"]
    assert [item["id"] for item in listed] == [second["id"], first["id"]]

    archived = await flow.patch(f"/api/games/{game['id']}/maps/{second['id']}", json={"status": "archived"})
    assert archived.status_code == 200 and archived.json()["status"] == "archived"
    assert archived.json()["archived_at"]
    restored = await flow.patch(f"/api/games/{game['id']}/maps/{second['id']}", json={"status": "active"})
    assert restored.json()["status"] == "active" and restored.json()["archived_at"] is None


@pytest.mark.asyncio
async def test_a_map_of_another_game_cannot_be_changed_through_this_game(flow):
    await as_admin(flow)
    game = await new_game(flow)
    other = await new_game(flow, name="Probe Kart", match_modes=[{"label": "Grand Prix", "minutes": 12}])
    foreign = await add_map(flow, other, name="Kupfermine")

    renamed = await flow.patch(f"/api/games/{game['id']}/maps/{foreign['id']}", json={"name": "X"})
    deleted = await flow.delete(f"/api/games/{game['id']}/maps/{foreign['id']}")
    assert (renamed.status_code, deleted.status_code) == (404, 404)
    mixed = await flow.put(f"/api/games/{game['id']}/maps/order", json={"ids": [foreign["id"]]})
    assert mixed.status_code == 422


@pytest.mark.asyncio
async def test_an_unused_map_can_be_deleted_a_used_one_only_archived(flow):
    await as_admin(flow)
    game = await new_game(flow)
    unused = await add_map(flow, game, name="Glutsenke")
    used = await add_map(flow, game, modes=["stellung"])
    tournament = await flow.create_tournament(game_id=game["id"])
    saved = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                           json={"modes": [{"mode": "stellung", "map_ids": [used["id"]]}]})
    assert saved.status_code == 200, saved.text

    deleted = await flow.delete(f"/api/games/{game['id']}/maps/{unused['id']}")
    assert deleted.status_code == 200
    refused = await flow.delete(f"/api/games/{game['id']}/maps/{used['id']}")
    assert refused.status_code == 409
    assert "archiv" in refused.json()["detail"].lower()
    listed = (await flow.get(f"/api/games/{game['id']}/maps")).json()["maps"]
    assert [(item["name"], item["in_pools"]) for item in listed] == [("Hafenkante", 1)]


@pytest.mark.asyncio
async def test_only_the_game_administration_writes_the_library(flow):
    await as_admin(flow)
    game = await new_game(flow)
    member = await flow.add_user(name="mitglied-mia")
    flow.act_as(member)
    created = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante"})
    assert created.status_code == 403
    assert (await flow.get(f"/api/games/{game['id']}/maps")).status_code == 403
    flow.act_as(None)
    assert (await flow.get(f"/api/games/{game['id']}/maps")).status_code in (401, 403)


@pytest.mark.asyncio
async def test_the_library_has_a_limit_but_no_fixed_number_of_maps(flow):
    from services import game_maps

    await as_admin(flow)
    game = await new_game(flow)
    await flow.db.game_maps.insert_many([
        {"id": f"m{index}", "game_id": game["id"], "slug": f"karte-{index}", "name": f"Karte {index}", "modes": [],
         "order": index, "status": "active"} for index in range(game_maps.MAPS_PER_GAME_MAX)])
    full = await flow.post(f"/api/games/{game['id']}/maps", json={"name": "Eine zu viel"})
    assert full.status_code == 422


@pytest.mark.asyncio
async def test_two_parallel_creates_of_the_same_map_give_one_map_and_one_conflict(flow, monkeypatch):
    """Die Bibliothek hat keine Versionen, aber einen eindeutigen Slug je Spiel (database.py): legen zwei gleichzeitig
    dieselbe Map an, bekommt der zweite 409 statt 500."""
    import asyncio

    import routes.game_map_routes as map_routes
    from flow_harness import InterleavedReads

    await as_admin(flow)
    game = await new_game(flow)
    await flow.db.game_maps.create_index([("game_id", 1), ("slug", 1)], unique=True)
    gate = InterleavedReads(flow.db, "game_maps")
    monkeypatch.setattr(map_routes, "get_db", lambda: gate)
    first, second = await asyncio.gather(
        flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante"}),
        flow.post(f"/api/games/{game['id']}/maps", json={"name": "Hafenkante"}))

    assert sorted([first.status_code, second.status_code]) == [200, 409]
    assert await flow.db.game_maps.count_documents({"game_id": game["id"]}) == 1


@pytest.mark.asyncio
async def test_a_map_image_stays_in_use_while_a_saved_pool_shows_it(flow):
    from services import media_audit

    await as_admin(flow)
    game = await new_game(flow)
    hafen = await add_map(flow, game, image_url=IMAGE, modes=["stellung"])
    tournament = await flow.create_tournament(game_id=game["id"])
    await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                   json={"modes": [{"mode": "stellung", "map_ids": [hafen["id"]]}]})
    await flow.patch(f"/api/games/{game['id']}/maps/{hafen['id']}", json={"image_url": "/api/static/uploads/neu.webp"})

    places = [(collection, field) async for collection, _doc, field, _name, _text
              in media_audit.iter_usages(flow.db, {"hafenkante-1.webp", "neu.webp"})]
    assert ("map_pools", "modes.maps.image_url") in places  # das alte Bild im Snapshot
    assert ("game_maps", "image_url") in places
    assert media_audit.place_label("map_pools", "modes.maps.image_url") == "Map-Pool · Bild einer Map"
