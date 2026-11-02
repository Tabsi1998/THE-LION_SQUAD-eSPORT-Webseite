"""Standard-Pool je Spiel und „Übernehmen von“ (#2129, SP3) - durch die echten Routen.

Der Standard-Pool ist nur eine Vorlage: Er taucht beim Lesen der Editoren auf und ändert keinen gespeicherten Pool, kein
Melden, keine Pool-Zählung und kein Löschen einer Map. Nur erfundene Map-Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

SHOOTER = {"name": "Probe Shooter", "match_modes": [{"mode": "stellung", "label": "Stellung"}, {"mode": "snd", "label": "Suchen"}]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def library(flow) -> tuple[dict, dict]:
    admin = await flow.add_user(role="superadmin", name="Leitung")
    flow.act_as(admin)
    game = (await flow.post("/api/games", json=SHOOTER)).json()
    maps = {}
    for name, modes in (("Hafenkante", ["stellung", "snd"]), ("Nebelwerk", ["snd"])):
        maps[name] = (await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes})).json()
    return game, maps


def body_of(mode: str, *items: dict, **extra) -> dict:
    return {"modes": [{"mode": mode, "map_ids": [item["id"] for item in items]}], **extra}


@pytest.mark.asyncio
async def test_a_game_saves_versions_of_its_default_pool_and_can_clear_it(flow):
    game, maps = await library(flow)
    url = f"/api/games/{game['id']}/default-pool"
    assert (await flow.get(f"/api/games/{game['id']}/maps")).json()["default_pool"] is None

    saved = await flow.put(url, json=body_of("snd", maps["Nebelwerk"], expected_version=0))
    assert saved.status_code == 200, saved.text
    assert saved.json()["origin"] == "game_default" and saved.json()["version"] == 1
    entry = (await flow.get(f"/api/games/{game['id']}/maps")).json()["default_pool"]
    assert entry["modes"][0]["maps"][0]["name"] == "Nebelwerk"

    stale = await flow.put(url, json=body_of("snd", maps["Hafenkante"], expected_version=0))
    assert stale.status_code == 409, "gleichzeitiges Überschreiben wie bei jedem Pool"
    locked = await flow.put(url, json=body_of("stellung", maps["Nebelwerk"]))
    assert locked.status_code == 422, "dieselben Regeln: Nebelwerk ist für Stellung nicht freigegeben"

    assert (await flow.delete(url)).status_code == 200
    assert (await flow.get(f"/api/games/{game['id']}/maps")).json()["default_pool"] is None


@pytest.mark.asyncio
async def test_the_editors_read_the_default_pool_alongside_their_own(flow):
    game, maps = await library(flow)
    tournament = await flow.create_tournament(game_id=game["id"])
    overview = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}/admin")).json()
    assert overview["default_pool"] is None

    await flow.put(f"/api/games/{game['id']}/default-pool", json=body_of("snd", maps["Hafenkante"]))

    overview = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}/admin")).json()
    assert overview["default_pool"]["modes"][0]["maps"][0]["name"] == "Hafenkante"
    assert overview["tournament"] is None, "die Vorlage legt keinen Pool an"
    public = (await flow.get(f"/api/map-pools/tournaments/{tournament['id']}")).json()
    assert "default_pool" not in public and public["tournament"] is None, "öffentlich gibt es keine Vorlage"

    league = (await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"/api/admin/leagues/{league['id']}/seasons", json={"name": "Season 1", "start_date": "2030-01-07T18:00:00+00:00"})).json()
    season_view = (await flow.get(f"/api/admin/leagues/seasons/{season['id']}")).json()
    assert season_view["default_pool"]["modes"][0]["maps"][0]["name"] == "Hafenkante"
    assert season_view["map_pool"] is None


@pytest.mark.asyncio
async def test_the_default_pool_holds_no_map_and_does_not_count_as_use(flow):
    game, maps = await library(flow)
    await flow.put(f"/api/games/{game['id']}/default-pool", json=body_of("snd", maps["Hafenkante"]))

    listed = {row["name"]: row for row in (await flow.get(f"/api/games/{game['id']}/maps")).json()["maps"]}
    assert listed["Hafenkante"]["in_pools"] == 0
    usage = (await flow.get(f"/api/games/{game['id']}/usage")).json()
    assert usage["counts"]["pools"] == 0 and usage["modes"]["snd"]["pools"] == 0
    # Die Map lässt sich weiter löschen; die Vorlage zeigt sie dann noch, der Editor bietet sie nicht mehr an.
    assert (await flow.delete(f"/api/games/{game['id']}/maps/{maps['Hafenkante']['id']}")).status_code == 200


@pytest.mark.asyncio
async def test_a_tournament_pool_can_take_over_from_other_tournaments_and_seasons_of_the_game(flow):
    game, maps = await library(flow)
    target = await flow.create_tournament(game_id=game["id"], title="Ziel Cup")
    source = await flow.create_tournament(game_id=game["id"], title="Quelle Cup")
    await flow.put(f"/api/map-pools/tournaments/{source['id']}", json=body_of("snd", maps["Nebelwerk"]))
    other_game = (await flow.post("/api/games", json={"name": "Probe Racer"})).json()
    foreign = await flow.create_tournament(game_id=other_game["id"], title="Fremd Cup")
    assert foreign["game_id"] != game["id"]

    league = (await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"/api/admin/leagues/{league['id']}/seasons", json={"name": "Season 1", "start_date": "2030-01-07T18:00:00+00:00"})).json()
    saved = await flow.put(f"/api/admin/leagues/seasons/{season['id']}/map-pool", json=body_of("snd", maps["Hafenkante"]))
    assert saved.status_code == 200, saved.text
    # Eine Staffel ist nur eine Kopie ihrer Season.
    staffel = await flow.create_tournament(game_id=game["id"], title="Staffel A", league_context={"league_id": league["id"], "season_id": season["id"], "division_id": "d", "staffel": "A"})
    await flow.put(f"/api/map-pools/tournaments/{staffel['id']}", json=body_of("snd", maps["Hafenkante"]))
    # Sich selbst übernimmt man nicht.
    await flow.put(f"/api/map-pools/tournaments/{target['id']}", json=body_of("stellung", maps["Hafenkante"]))

    sources = (await flow.get(f"/api/map-pools/tournaments/{target['id']}/admin")).json()["sources"]

    labels = {row["label"]: row for row in sources}
    assert set(labels) == {"Turnier: Quelle Cup", "Liga-Season: Season 1"}
    assert labels["Turnier: Quelle Cup"]["pool"]["modes"][0]["maps"][0]["name"] == "Nebelwerk"
    assert "tournament" not in labels["Turnier: Quelle Cup"], "die Sichtbarkeitsprüfung bleibt innen"

    # Ein entfernter Pool steht nicht mehr zur Wahl.
    await flow.delete(f"/api/map-pools/tournaments/{source['id']}")
    sources = (await flow.get(f"/api/map-pools/tournaments/{target['id']}/admin")).json()["sources"]
    assert [row["label"] for row in sources] == ["Liga-Season: Season 1"]


@pytest.mark.asyncio
async def test_sources_respect_what_a_helper_may_see(flow):
    game, maps = await library(flow)
    target = await flow.create_tournament(game_id=game["id"], title="Ziel Cup")
    hidden = await flow.create_tournament(game_id=game["id"], title="Geheim Cup", is_public=False)
    await flow.put(f"/api/map-pools/tournaments/{hidden['id']}", json=body_of("snd", maps["Nebelwerk"]))
    visible = await flow.create_tournament(game_id=game["id"], title="Offen Cup", status="registration_open")
    await flow.put(f"/api/map-pools/tournaments/{visible['id']}", json=body_of("snd", maps["Nebelwerk"]))
    league = (await flow.post("/api/admin/leagues", json={"name": "Probe Liga", "game_id": game["id"]})).json()
    season = (await flow.post(f"/api/admin/leagues/{league['id']}/seasons", json={"name": "Season 1", "start_date": "2030-01-07T18:00:00+00:00"})).json()
    await flow.put(f"/api/admin/leagues/seasons/{season['id']}/map-pool", json=body_of("snd", maps["Hafenkante"]))
    helper = await flow.add_user(name="Helfer")
    await flow.db.tournament_staff_assignments.insert_one({"id": "st1", "tournament_id": target["id"], "user_id": helper["id"],
                                                           "role": "referee", "scope": "tournament", "is_active": True})
    flow.act_as(helper)

    answer = await flow.get(f"/api/map-pools/tournaments/{target['id']}/admin")

    assert answer.status_code == 200, answer.text
    assert [row["label"] for row in answer.json()["sources"]] == ["Turnier: Offen Cup"]
