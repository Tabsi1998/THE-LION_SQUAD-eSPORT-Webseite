"""Maps aus einer anderen Spielversion übernehmen (#2129, SP4) - durch die echten Routen.

Die neuen Maps gehören dem Zielspiel, ohne Doppel, das Bild wird mitverwendet, Modi nur soweit das Ziel sie kennt. Die Quelle
und gespeicherte Pools bleiben unberührt. Nur erfundene Map-Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

IMAGE = "/api/static/uploads/hafenkante-1.webp"
OLD_MODES = [{"mode": "stellung", "label": "Stellung"}, {"mode": "snd", "label": "Suchen"}, {"mode": "alt", "label": "Nur Alt"}]
NEW_MODES = [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen_neu", "label": "suchen"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def two_versions(flow) -> tuple[dict, dict, dict]:
    admin = await flow.add_user(role="superadmin", name="Leitung")
    flow.act_as(admin)
    parent = (await flow.post("/api/games", json={"name": "Probe Reihe", "kind": "series"})).json()
    old = (await flow.post("/api/games", json={"name": "Teil 1", "kind": "edition", "parent_game_id": parent["id"], "match_modes": OLD_MODES})).json()
    new = (await flow.post("/api/games", json={"name": "Teil 2", "kind": "edition", "parent_game_id": parent["id"], "match_modes": NEW_MODES})).json()
    maps = {}
    for name, fields in (("Hafenkante", {"image_url": IMAGE, "modes": ["stellung", "snd", "alt"], "aliases": ["Harbour"], "note": "Bei Nacht", "external_ref": "map_hafen"}),
                         ("Nebelwerk", {"modes": ["alt"]}), ("Altbau", {"modes": []})):
        created = await flow.post(f"/api/games/{old['id']}/maps", json={"name": name, **fields})
        assert created.status_code == 200, created.text
        maps[name] = created.json()
    await flow.patch(f"/api/games/{old['id']}/maps/{maps['Altbau']['id']}", json={"status": "archived"})
    return old, new, maps


@pytest.mark.asyncio
async def test_sources_and_candidates_show_what_can_be_taken(flow):
    old, new, maps = await two_versions(flow)
    await flow.post(f"/api/games/{new['id']}/maps", json={"name": "Neu Eigen", "aliases": ["Harbour"]})
    unrelated = (await flow.post("/api/games", json={"name": "Ein Anderes"})).json()
    await flow.post(f"/api/games/{unrelated['id']}/maps", json={"name": "Fremdkarte"})

    sources = (await flow.get(f"/api/games/{new['id']}/maps/import-sources")).json()
    assert [(row["id"], row["maps"], row["related"]) for row in sources] == [(old["id"], 2, True), (unrelated["id"], 1, False)]
    assert sources[0]["name"] == "Probe Reihe: Teil 1"

    candidates = (await flow.get(f"/api/games/{new['id']}/maps/import-sources/{old['id']}")).json()
    rows = {row["name"]: row for row in candidates["maps"]}
    assert set(rows) == {"Hafenkante", "Nebelwerk"}, "archivierte stehen nicht zur Wahl"
    assert rows["Hafenkante"]["exists"] is True, "die Schreibweise „Harbour“ führt dort schon zu einer Map"
    assert rows["Nebelwerk"]["exists"] is False
    assert rows["Hafenkante"]["modes"] == ["Stellung", "suchen"], "gleiche Kennung oder gleicher Name"


@pytest.mark.asyncio
async def test_taking_over_copies_maps_with_image_and_known_modes_and_leaves_the_source_alone(flow):
    old, new, maps = await two_versions(flow)
    tournament = await flow.create_tournament(game_id=old["id"])
    saved_pool = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json={"modes": [{"mode": "snd", "map_ids": [maps["Hafenkante"]["id"]]}]})
    assert saved_pool.status_code == 200, saved_pool.text

    answer = await flow.post(f"/api/games/{new['id']}/maps/import", json={"source_game_id": old["id"], "map_ids": [maps["Hafenkante"]["id"], maps["Nebelwerk"]["id"]]})

    assert answer.status_code == 200, answer.text
    assert answer.json()["skipped"] == []
    body = (await flow.get(f"/api/games/{new['id']}/maps")).json()
    rows = {row["name"]: row for row in body["maps"]}
    copied = rows["Hafenkante"]
    assert copied["id"] != maps["Hafenkante"]["id"] and copied["game_id"] == new["id"]
    assert copied["image_url"] == IMAGE and copied["slug"] == maps["Hafenkante"]["slug"]
    assert copied["aliases"] == ["Harbour"] and copied["note"] == "Bei Nacht" and copied["external_ref"] == "map_hafen"
    assert copied["modes"] == ["stellung", "suchen_neu"] and copied["in_pools"] == 0
    assert rows["Nebelwerk"]["modes"] == [], "ohne passenden Modus: der Hinweis fängt sie auf"
    # Die Quelle und ihr Pool sind unverändert.
    source = {row["name"]: row for row in (await flow.get(f"/api/games/{old['id']}/maps")).json()["maps"]}
    assert source["Hafenkante"]["in_pools"] == 1 and source["Hafenkante"]["modes"] == ["stellung", "snd", "alt"]
    pool = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")).json()["tournament"]
    assert pool["modes"][0]["maps"][0]["map_id"] == maps["Hafenkante"]["id"]


@pytest.mark.asyncio
async def test_no_doubles_and_the_reason_is_named(flow):
    old, new, maps = await two_versions(flow)
    payload = {"source_game_id": old["id"], "map_ids": [maps["Hafenkante"]["id"]]}
    assert (await flow.post(f"/api/games/{new['id']}/maps/import", json=payload)).json()["skipped"] == []

    again = await flow.post(f"/api/games/{new['id']}/maps/import", json=payload)

    assert again.status_code == 200 and again.json()["created"] == []
    assert again.json()["skipped"][0]["name"] == "Hafenkante" and "schon" in again.json()["skipped"][0]["reason"]
    assert await flow.db.game_maps.count_documents({"game_id": new["id"]}) == 1
    # Nur nach Kennung gewählte Maps der Quelle zählen - fremde Kennungen fallen still weg, archivierte auch.
    other = await flow.post(f"/api/games/{new['id']}/maps/import", json={"source_game_id": old["id"], "map_ids": ["unbekannt", maps["Altbau"]["id"]]})
    assert other.json() == {"created": [], "skipped": []}


@pytest.mark.asyncio
async def test_the_source_must_exist_and_be_another_game(flow):
    old, new, maps = await two_versions(flow)
    same = await flow.post(f"/api/games/{old['id']}/maps/import", json={"source_game_id": old["id"], "map_ids": [maps["Hafenkante"]["id"]]})
    assert same.status_code == 422
    unknown = await flow.post(f"/api/games/{new['id']}/maps/import", json={"source_game_id": "gibt-es-nicht", "map_ids": ["x"]})
    assert unknown.status_code == 404
    assert (await flow.post(f"/api/games/{new['id']}/maps/import", json={"source_game_id": old["id"], "map_ids": []})).status_code == 422


@pytest.mark.asyncio
async def test_the_map_limit_is_reported_not_hidden(flow, monkeypatch):
    from services import game_maps

    old, new, maps = await two_versions(flow)
    monkeypatch.setattr(game_maps, "MAPS_PER_GAME_MAX", 1)
    answer = await flow.post(f"/api/games/{new['id']}/maps/import", json={"source_game_id": old["id"], "map_ids": [maps["Hafenkante"]["id"], maps["Nebelwerk"]["id"]]})
    assert len(answer.json()["created"]) == 1
    assert "Höchstens" in answer.json()["skipped"][0]["reason"]
