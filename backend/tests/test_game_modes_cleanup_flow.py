"""Modi eines Spiels ändern (#2129, SP2) - durch die echten Routen, vor allem gegen laufende Liga-Spiele.

Ein entfernter Modus verschwindet aus den Maps, damit sie sich wieder speichern lassen. Gespeicherte Pools sind Snapshots:
Sie bleiben lesbar, und das Melden in einem laufenden Liga-Spiel prüft weiter gegen sie. Der erste Modus eines Spiels
sperrt nichts im Stillen: die Antwort nennt die Maps ohne Modus, eine Sammelaktion ordnet sie zu. Erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import GAME_ID, ids, two_nil, world  # noqa: E402
from models import new_id, now_utc  # noqa: E402

MODES = [{"mode": "stellung", "label": "Stellung"}, {"mode": "suchen", "label": "Suchen & Zerstören"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def as_admin(flow) -> dict:
    admin = await flow.add_user(role="superadmin", name="Leitung")
    flow.act_as(admin)
    return admin


async def new_game(flow, **fields) -> dict:
    created = await flow.post("/api/games", json={"name": "Probe Shooter", **fields})
    assert created.status_code == 200, created.text
    return created.json()


async def add_map(flow, game: dict, name: str, modes: list[str] | None = None) -> dict:
    created = await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes or []})
    assert created.status_code == 200, created.text
    return created.json()


async def set_modes(flow, game: dict, modes: list[dict]) -> dict:
    response = await flow.patch(f"/api/games/{game['id']}", json={"match_modes": modes})
    assert response.status_code == 200, response.text
    return response.json()


async def remove_like_before(flow, game: dict, keep: list[dict]) -> int:
    """Altbestand von vor #2206: ein verwendeter Modus wurde dem Spiel entfernt und aus den Maps genommen. Heute lehnt die API
    das ab (409, nur noch deaktivieren, siehe test_game_mode_status_flow) - alte Daten können so aber noch aussehen."""
    refused = await flow.patch(f"/api/games/{game['id']}", json={"match_modes": keep})
    assert refused.status_code == 409, refused.text
    known = {mode["mode"] for mode in keep}
    stored = (await flow.db.games.find_one({"id": game["id"]}, {"_id": 0, "match_modes": 1}))["match_modes"]
    gone = [mode["mode"] for mode in stored if mode["mode"] not in known]
    await flow.db.games.update_one({"id": game["id"]}, {"$set": {"match_modes": keep}})
    cleaned = await flow.db.game_maps.update_many({"game_id": game["id"], "modes": {"$in": gone}}, {"$pull": {"modes": {"$in": gone}}})
    return cleaned.modified_count


async def maps_by_name(flow, game: dict) -> dict:
    body = (await flow.get(f"/api/games/{game['id']}/maps")).json()
    return {row["name"]: row for row in body["maps"]}


@pytest.mark.asyncio
async def test_removing_a_mode_cleans_the_maps_so_they_can_be_saved_again(flow):
    await as_admin(flow)
    game = await new_game(flow, match_modes=MODES)
    both = await add_map(flow, game, "Hafenkante", ["stellung", "suchen"])
    await add_map(flow, game, "Nebelwerk", ["suchen"])
    await add_map(flow, game, "Glutsenke", ["stellung"])

    answer = await set_modes(flow, game, MODES[:1])

    assert answer["maps_cleaned"] == 2
    assert answer["maps_without_mode"] == 1, "Nebelwerk hat jetzt keinen Modus mehr"
    maps = await maps_by_name(flow, game)
    assert maps["Hafenkante"]["modes"] == ["stellung"] and maps["Nebelwerk"]["modes"] == []
    assert maps["Glutsenke"]["modes"] == ["stellung"], "nicht betroffen"
    # Der eigentliche Fehler: vorher scheiterte hier jedes Speichern an „Unbekannter Modus“.
    saved = await flow.patch(f"/api/games/{game['id']}/maps/{both['id']}", json={"name": "Hafenkante Neu", "modes": maps["Hafenkante"]["modes"]})
    assert saved.status_code == 200, saved.text


@pytest.mark.asyncio
async def test_renaming_or_touching_other_fields_cleans_nothing(flow):
    await as_admin(flow)
    game = await new_game(flow, match_modes=MODES)
    await add_map(flow, game, "Hafenkante", ["stellung", "suchen"])

    renamed = await set_modes(flow, game, [{"mode": "stellung", "label": "Hardpoint"}, MODES[1]])
    assert renamed["maps_cleaned"] == 0
    other = await flow.patch(f"/api/games/{game['id']}", json={"short_name": "PS"})
    assert "maps_cleaned" not in other.json(), "ohne Modi im Aufruf bleibt alles wie bisher"
    assert (await maps_by_name(flow, game))["Hafenkante"]["modes"] == ["stellung", "suchen"]


@pytest.mark.asyncio
async def test_usage_names_the_maps_pools_and_seasons_of_each_mode(flow):
    await as_admin(flow)
    game = await new_game(flow, match_modes=MODES)
    first = await add_map(flow, game, "Hafenkante", ["stellung", "suchen"])
    await add_map(flow, game, "Nebelwerk", ["suchen"])
    tournament = await flow.create_tournament(game_id=game["id"])
    saved = await flow.put(f"/api/map-pools/tournaments/{tournament['id']}",
                           json={"modes": [{"mode": "suchen", "map_ids": [first["id"]]}]})
    assert saved.status_code == 200, saved.text
    league = (await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})).json()
    await flow.db.league_seasons.insert_one({"id": new_id(), "league_id": league["id"], "game_mode_order": ["suchen"]})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"game_mode": "suchen"}})
    await flow.db.tournament_stages.insert_one({"id": new_id(), "tournament_id": tournament["id"], "settings": {"game_mode": "stellung"}})

    modes = (await flow.get(f"/api/games/{game['id']}/usage")).json()["modes"]

    # Seit #2206 dazu: jede Pool-Version, Staffeln, Spiele, Ergebnisblätter und ob der Modus verwendet ist.
    assert modes["suchen"] == {"label": "Suchen & Zerstören", "maps": 2, "pools": 1, "seasons": 1, "tournaments": 1, "stages": 0,
                               "pool_versions": 1, "staffeln": 0, "matches": 0, "references": 0, "in_use": True}
    assert modes["stellung"] == {"label": "Stellung", "maps": 1, "pools": 0, "seasons": 0, "tournaments": 0, "stages": 1,
                                 "pool_versions": 0, "staffeln": 0, "matches": 0, "references": 0, "in_use": True}


@pytest.mark.asyncio
async def test_a_saved_pool_stays_readable_and_is_flagged_after_a_mode_is_removed(flow):
    await as_admin(flow)
    game = await new_game(flow, match_modes=MODES)
    first = await add_map(flow, game, "Hafenkante", ["suchen"])
    tournament = await flow.create_tournament(game_id=game["id"])
    await flow.put(f"/api/map-pools/tournaments/{tournament['id']}", json={"modes": [{"mode": "suchen", "map_ids": [first["id"]]}]})

    await remove_like_before(flow, game, MODES[:1])

    public =(await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")).json()["tournament"]
    assert public["modes"][0]["label"] == "Suchen & Zerstören"
    assert public["modes"][0]["maps"][0]["name"] == "Hafenkante"
    admin = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}/admin")).json()["tournament"]
    assert admin["outdated_map_ids"] == [first["id"]]


@pytest.mark.asyncio
async def test_the_first_mode_locks_nothing_silently_and_the_bulk_action_frees_the_maps(flow):
    await as_admin(flow)
    game = await new_game(flow)
    await add_map(flow, game, "Hafenkante")
    await add_map(flow, game, "Nebelwerk")
    archived = await add_map(flow, game, "Altbau")
    await flow.patch(f"/api/games/{game['id']}/maps/{archived['id']}", json={"status": "archived"})

    answer = await set_modes(flow, game, MODES)
    assert answer["maps_cleaned"] == 0
    assert answer["maps_without_mode"] == 2, "die Antwort nennt, was nicht mehr wählbar ist"

    assigned = await flow.post(f"/api/games/{game['id']}/maps/assign-modes", json={"modes": ["suchen"]})
    assert assigned.status_code == 200, assigned.text
    assert assigned.json() == {"updated": 2}
    maps = await maps_by_name(flow, game)
    assert maps["Hafenkante"]["modes"] == ["suchen"] and maps["Nebelwerk"]["modes"] == ["suchen"]
    assert maps["Altbau"]["modes"] == [], "archivierte bleiben unberührt"
    # Wer schon einen Modus hat, wird nicht überschrieben.
    again = await flow.post(f"/api/games/{game['id']}/maps/assign-modes", json={"modes": ["stellung"]})
    assert again.json() == {"updated": 0}

    assert (await flow.post(f"/api/games/{game['id']}/maps/assign-modes", json={"modes": ["gibt_es_nicht"]})).status_code == 422
    assert (await flow.post(f"/api/games/{game['id']}/maps/assign-modes", json={"modes": []})).status_code == 422


@pytest.mark.asyncio
async def test_a_map_with_only_a_leftover_mode_counts_as_without_mode(flow):
    """Altbestand von vor der Bereinigung: der Modus steht noch an der Map, das Spiel kennt ihn nicht mehr."""
    await as_admin(flow)
    game = await new_game(flow, match_modes=MODES[:1])
    await flow.db.game_maps.insert_one({"id": "alt", "game_id": game["id"], "slug": "alt", "name": "Alt", "status": "active", "modes": ["weg"], "order": 1})
    assert (await flow.post(f"/api/games/{game['id']}/maps/assign-modes", json={"modes": ["stellung"]})).json() == {"updated": 1}
    assert (await maps_by_name(flow, game))["Alt"]["modes"] == ["stellung"]


# ---------------------------------------------------------------- Laufende Liga: das Ergebnis je Map bleibt

async def library_for_world(flow) -> None:
    """Das Spiel der Staffel aus ``world`` als echtes Spiel, mit den Maps seines Pools in der Bibliothek."""
    now = now_utc().isoformat()
    await flow.db.games.insert_one({"id": GAME_ID, "name": "Probe Shooter", "slug": GAME_ID, "kind": "standalone", "match_modes": MODES,
                                    "created_at": now, "updated_at": now})
    for slug, modes in (("hafen", ["stellung"]), ("nebel", ["stellung", "suchen"]), ("turm", ["suchen"])):
        await flow.db.game_maps.insert_one({"id": f"map-{slug}", "game_id": GAME_ID, "slug": slug, "name": slug.title(), "status": "active",
                                            "modes": modes, "order": 1})


@pytest.mark.asyncio
async def test_a_removed_mode_does_not_stop_reporting_from_the_pool_of_a_running_match(flow):
    w = await world(flow)
    await library_for_world(flow)
    await as_admin(flow)
    assert await remove_like_before(flow, {"id": GAME_ID}, MODES[:1]) == 2, "Nebel und Turm verlieren „Suchen“ in der Bibliothek"
    assert (await flow.db.game_maps.find_one({"id": "map-turm"}))["modes"] == []

    # Suchen & Zerstören steht weiter im Pool der Staffel - und in ihrer Reihenfolge der Modi.
    flow.act_as(w["users"]["Kapitaen"])
    reported = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert reported.status_code == 200, reported.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    games = match["reports"][-1]["games"]
    assert [(game["mode"], game["mode_label"], game["map_name"]) for game in games] == [
        ("stellung", "Stellung", "Hafen"), ("suchen", "Suchen & Zerstören", "Turm")]

    flow.act_as(w["users"]["Falke1"])
    confirmed = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Falke2"), side="reg_h"))
    assert confirmed.status_code == 200, confirmed.text
    done = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert [game["map_id"] for game in done["games"]] == ["map-hafen", "map-turm"]


@pytest.mark.asyncio
async def test_a_first_mode_does_not_stop_reporting_from_a_pool_without_modes(flow):
    """Pool ohne Modus (das Spiel hatte keine), dann bekommt das Spiel seinen ersten Modus: die Staffel meldet weiter."""
    w = await world(flow)
    now = now_utc().isoformat()
    await flow.db.games.insert_one({"id": GAME_ID, "name": "Probe Shooter", "slug": GAME_ID, "kind": "standalone", "match_modes": [],
                                    "created_at": now, "updated_at": now})
    await flow.db.game_maps.insert_one({"id": "map-hafen", "game_id": GAME_ID, "slug": "hafen", "name": "Hafen", "status": "active", "modes": [], "order": 1})
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"game_mode_order": []}})
    await flow.db.map_pools.update_one({"scope": "tournament", "scope_id": w["tournament"]["id"]}, {"$set": {"modes": [
        {"mode": None, "label": "Alle Maps", "maps": [{"map_id": "map-hafen", "slug": "hafen", "name": "Hafen", "image_url": None},
                                                      {"map_id": "map-turm", "slug": "turm", "name": "Turm", "image_url": None}]}]}})
    await as_admin(flow)
    answer = await set_modes(flow, {"id": GAME_ID}, MODES)
    assert answer["maps_without_mode"] == 1

    flow.act_as(w["users"]["Kapitaen"])
    body = two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))
    for game in body["games"]:
        game["mode"] = None
    reported = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body)
    assert reported.status_code == 200, reported.text


@pytest.mark.asyncio
async def test_a_season_keeps_its_mode_order_after_a_mode_is_removed(flow):
    await as_admin(flow)
    game = await new_game(flow, match_modes=MODES)
    league = (await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})).json()
    season = await flow.post(f"/api/admin/leagues/{league['id']}/seasons",
                             json={"name": "Season 1", "start_date": "2030-01-07T18:00:00+00:00", "game_mode_order": ["stellung", "suchen"]})
    assert season.status_code == 200, season.text
    await remove_like_before(flow, game, MODES[:1])

    # Ein anderes Speichern mit der alten Reihenfolge scheitert nicht am entfernten Modus - neu wählen geht aber nicht.
    kept = await flow.patch(f"/api/admin/leagues/seasons/{season.json()['id']}", json={"name": "Season Eins", "game_mode_order": ["stellung", "suchen"]})
    assert kept.status_code == 200, kept.text
    refused = await flow.patch(f"/api/admin/leagues/seasons/{season.json()['id']}", json={"game_mode_order": ["stellung", "gibt_es_nicht"]})
    assert refused.status_code == 422
