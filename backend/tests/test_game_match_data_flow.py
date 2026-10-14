"""Spiel-Daten und Spieldauer an einer Stelle (#1554) - durch die echten Routen.

Das Game kennt Dauer je Modus, Spieler je Lauf, Gerät, Aufbauzeit, Punktetabelle und Best-of-Vorgabe; alles ist
freiwillig, alte Spiele bleiben gültig. Erzeugte Spiele und Phasen bekommen keine Dauer mehr hineinkopiert: ohne
eigenen Wert folgen sie dem Turnier und - wenn das Turnier nichts sagt - dem Game.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402

MK8 = {
    "name": "Mario Kart 8 Deluxe",
    "match_modes": [
        {"mode": "gp4", "label": "Grand Prix 4 Rennen", "minutes": 12},
        {"mode": "race", "label": "Einzelrennen", "minutes": 4, "per_game": True},
    ],
    "players_per_run_local": 4,
    "players_per_run_online": 12,
    "station_devices": ["switch"],
    "setup_minutes": 3,
    "points_table": [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    "default_best_of": 3,
}


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
    response = await flow.post("/api/games", json={**MK8, **fields})
    assert response.status_code == 200, response.text
    return response.json()


async def on_site(flow, count=4, **fields):
    start = (now_utc() + timedelta(hours=1)).replace(microsecond=0)
    tournament, _users, _registrations = await flow.with_participants(
        count, event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode=None, start_date=start.isoformat(), **fields)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    return tournament


async def stations(flow, tournament, *devices):
    for index, device in enumerate(devices, start=1):
        await flow.db.stations.insert_one({"id": new_id(), "name": str(index), "device_type": device, "tournament_id": tournament["id"],
                                           "status": "free", "current_match_id": None, "notes": None})


async def planned_minutes(flow, tournament):
    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    return planned.json()


# ---------------------------------------------------------------- Spiele-API

@pytest.mark.asyncio
async def test_a_game_keeps_all_new_fields(flow):
    await as_admin(flow)
    game = await new_game(flow)
    stored = (await flow.get(f"/api/games/{game['id']}")).json()
    assert [mode["mode"] for mode in stored["match_modes"]] == ["gp4", "race"]
    assert stored["match_modes"][1]["per_game"] is True and stored["match_modes"][0]["per_game"] is False
    assert stored["players_per_run_local"] == 4 and stored["players_per_run_online"] == 12
    assert stored["station_devices"] == ["switch"] and stored["setup_minutes"] == 3
    assert stored["points_table"][:4] == [15, 12, 10, 9] and stored["default_best_of"] == 3


@pytest.mark.asyncio
async def test_a_mode_without_key_gets_one_from_its_label_and_devices_are_cleaned(flow):
    await as_admin(flow)
    game = await new_game(flow, match_modes=[{"label": "Grand Prix (4 Rennen)", "minutes": 12}], station_devices=[" Switch ", "switch", "PS5"])
    assert game["match_modes"][0]["mode"] == "grand_prix_4_rennen"
    assert game["station_devices"] == ["switch", "ps5"]


@pytest.mark.asyncio
@pytest.mark.parametrize("fields", [
    {"match_modes": [{"mode": "x", "label": "X", "minutes": 0}]},
    {"match_modes": [{"mode": "x", "label": "", "minutes": 10}]},
    {"match_modes": [{"mode": "x", "label": "X", "minutes": 10}, {"mode": "x", "label": "Y", "minutes": 5}]},
    {"match_modes": [{"mode": f"m{i}", "label": f"M{i}", "minutes": 5} for i in range(21)]},
    {"players_per_run_local": 0},
    {"players_per_run_online": 65},
    {"station_devices": ["Play Station!"]},
    {"setup_minutes": -1},
    {"points_table": [15, -1]},
    {"points_table": list(range(65))},
    {"default_best_of": 0},
    {"default_best_of": 16},
])
async def test_unusable_game_data_is_refused(flow, fields):
    await as_admin(flow)
    response = await flow.post("/api/games", json={**MK8, **fields})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_an_old_game_without_the_new_fields_stays_valid(flow):
    await as_admin(flow)
    old = {"id": new_id(), "name": "Altspiel", "slug": "altspiel", "platforms": ["PC"]}
    await flow.db.games.insert_one(dict(old))
    listed = (await flow.get("/api/games")).json()
    assert any(row["id"] == old["id"] for row in listed)
    renamed = await flow.patch(f"/api/games/{old['id']}", json={"name": "Altspiel 2"})
    assert renamed.status_code == 200, renamed.text
    assert "match_modes" not in renamed.json()
    # Und ein Turnier mit diesem Spiel plant wie bisher 30 Minuten.
    tournament = await on_site(flow, game_id=old["id"], match_duration_minutes=None)
    await stations(flow, tournament, "switch", "switch")
    plan = await planned_minutes(flow, tournament)
    assert {item["duration_minutes"] for item in plan["assignments"]} == {30}


@pytest.mark.asyncio
async def test_game_values_can_be_cleared_again(flow):
    await as_admin(flow)
    game = await new_game(flow)
    cleared = await flow.patch(f"/api/games/{game['id']}", json={"match_modes": [], "players_per_run_local": None, "setup_minutes": None,
                                                                  "points_table": [], "default_best_of": None, "station_devices": []})
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["match_modes"] == [] and body["players_per_run_local"] is None and body["setup_minutes"] is None
    assert body["points_table"] == [] and body["default_best_of"] is None and body["station_devices"] == []


# ---------------------------------------------------------------- Dauer folgt Turnier und Game

@pytest.mark.asyncio
async def test_generated_matches_and_stages_carry_no_copied_duration(flow):
    await as_admin(flow)
    tournament = await on_site(flow, match_duration_minutes=45)
    matches = await flow.matches(tournament)
    assert matches and all(match.get("duration_minutes") is None for match in matches)
    assert all((match.get("settings") or {}).get("duration_minutes") is None for match in matches)
    stages = await flow.db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(10)
    assert stages and all("duration_minutes" not in (stage.get("settings") or {}) for stage in stages)


@pytest.mark.asyncio
async def test_a_change_at_the_tournament_reaches_matches_without_own_value(flow):
    await as_admin(flow)
    tournament = await on_site(flow, match_duration_minutes=30)
    await stations(flow, tournament, "switch", "switch")
    assert {item["duration_minutes"] for item in (await planned_minutes(flow, tournament))["assignments"]} == {30}

    changed = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"match_duration_minutes": 50})
    assert changed.status_code == 200, changed.text
    assert {item["duration_minutes"] for item in (await planned_minutes(flow, tournament))["assignments"]} == {50}


@pytest.mark.asyncio
async def test_without_a_tournament_value_the_game_mode_counts_and_follows_the_game(flow):
    await as_admin(flow)
    game = await new_game(flow)
    tournament = await on_site(flow, game_id=game["id"], match_duration_minutes=None)
    await stations(flow, tournament, "switch", "switch")
    # Erster Modus (Grand Prix, 12 Min.) plus 3 Min. Aufbau.
    assert {item["duration_minutes"] for item in (await planned_minutes(flow, tournament))["assignments"]} == {15}

    await flow.patch(f"/api/tournaments/{tournament['id']}", json={"game_mode": "race", "best_of": 3})
    # Einzelrennen 4 Min. × Bo3 (2,5 Spiele) = 10, plus 3 Min. Aufbau.
    assert {item["duration_minutes"] for item in (await planned_minutes(flow, tournament))["assignments"]} == {13}

    await flow.patch(f"/api/games/{game['id']}", json={"setup_minutes": 0})
    assert {item["duration_minutes"] for item in (await planned_minutes(flow, tournament))["assignments"]} == {10}


@pytest.mark.asyncio
async def test_a_new_tournament_leaves_the_duration_to_the_game_and_can_clear_its_own(flow):
    await as_admin(flow)
    game = await new_game(flow)
    created = await flow.post("/api/tournaments", json={"title": "Kart-Cup", "game_id": game["id"]})
    assert created.status_code == 200, created.text
    assert created.json()["match_duration_minutes"] is None
    tid = created.json()["id"]
    assert (await flow.patch(f"/api/tournaments/{tid}", json={"match_duration_minutes": 20})).json()["match_duration_minutes"] == 20
    cleared = await flow.patch(f"/api/tournaments/{tid}", json={"match_duration_minutes": None, "game_mode": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["match_duration_minutes"] is None


@pytest.mark.asyncio
async def test_applying_a_plan_does_not_freeze_the_duration(flow):
    await as_admin(flow)
    tournament = await on_site(flow, match_duration_minutes=30)
    await stations(flow, tournament, "switch", "switch")
    plan = await planned_minutes(flow, tournament)
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply", json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})
    assert applied.status_code == 200, applied.text
    assert all(match.get("duration_minutes") is None for match in await flow.matches(tournament))


@pytest.mark.asyncio
async def test_the_planner_only_uses_stations_with_a_device_of_the_game(flow):
    await as_admin(flow)
    game = await new_game(flow, station_devices=["switch"])
    tournament = await on_site(flow, game_id=game["id"])
    await stations(flow, tournament, "pc", "switch")
    plan = await planned_minutes(flow, tournament)
    used = {item["station_name"] for item in plan["assignments"]}
    assert used == {"2"}, "die PC-Station passt nicht zu einem Switch-Spiel"


@pytest.mark.asyncio
async def test_the_bracket_payload_names_the_game_duration_data(flow):
    await as_admin(flow)
    game = await new_game(flow)
    tournament = await on_site(flow, game_id=game["id"], match_duration_minutes=None)
    bracket = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).json()
    assert bracket["duration_game"]["match_modes"][0]["minutes"] == 12
    assert bracket["duration_game"]["setup_minutes"] == 3
