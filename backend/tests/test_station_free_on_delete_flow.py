"""Jeder Weg, der Spiele löscht, gibt deren Stationen frei (#2386, Folge aus #1162).

Je Weg dieselbe Probe: drei Stationen - eine hält ein Spiel, das gleich gelöscht wird, eine defekte hält ein zweites,
eine dritte hält ein fremdes Spiel. Danach ist die erste frei, die defekte bleibt defekt (aber ohne Spiel), und die
dritte ist unberührt.

„Letzte Runde zurücknehmen“ (Schweizer System) fehlt hier mit Absicht: Es lehnt ab, solange ein Spiel der Runde an
einer Station steht (#2120), es kann also keine Station hängen lassen.
"""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

FOREIGN_MATCH = "fremdes-spiel"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def hold(flow, tournament: dict, matches: list[dict]) -> dict:
    """Station „held“ hält das erste Spiel (aufgerufen), die defekte das zweite, „other“ ein fremdes Spiel."""
    called = now_utc().isoformat()
    docs = {
        "held": {"current_match_id": matches[0]["id"], "current_match_type": "matches_v2", "status": "reserved",
                 "called_at": called},
        "broken": {"current_match_id": matches[1]["id"], "current_match_type": "matches_v2", "status": "broken",
                   "called_at": called},
        "other": {"current_match_id": FOREIGN_MATCH, "current_match_type": "matches_v2", "status": "occupied"},
    }
    stations = {}
    for name, fields in docs.items():
        doc = {"id": new_id(), "name": name, "device_type": "switch2", "tournament_id": tournament["id"], **fields}
        await flow.db.stations.insert_one(dict(doc))
        stations[name] = doc
    return stations


async def assert_released(flow, stations: dict) -> None:
    held = await flow.db.stations.find_one({"id": stations["held"]["id"]}, {"_id": 0})
    assert held["current_match_id"] is None, "die Station hält kein gelöschtes Spiel mehr"
    assert held["status"] == "free"
    assert "called_at" not in held
    broken = await flow.db.stations.find_one({"id": stations["broken"]["id"]}, {"_id": 0})
    assert broken["current_match_id"] is None
    assert broken["status"] == "broken", "eine defekte Station bleibt defekt"
    other = await flow.db.stations.find_one({"id": stations["other"]["id"]}, {"_id": 0})
    assert other["current_match_id"] == FOREIGN_MATCH, "eine Station mit einem anderen Spiel bleibt, wie sie ist"
    assert other["status"] == "occupied"


async def tournament_with_bracket(flow, *, preview: bool, count: int = 4, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(count, **fields)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview={str(preview).lower()}")
    assert built.status_code == 200, built.text
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("id")))
    assert len(matches) >= 2
    return staff, tournament, matches


async def current(flow, tournament: dict) -> dict:
    return await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_reset_bracket_frees_the_stations_of_its_matches(flow):
    _staff, tournament, matches = await tournament_with_bracket(flow, preview=False)
    stations = await hold(flow, tournament, matches)

    response = await flow.post(f"/api/tournaments/{tournament['id']}/reset-bracket?force=true")
    assert response.status_code == 200, response.text

    assert not await flow.matches(tournament)
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_rebuilding_the_bracket_from_the_format_frees_the_stations_of_the_old_matches(flow):
    _staff, tournament, matches = await tournament_with_bracket(flow, preview=False)
    stations = await hold(flow, tournament, matches)

    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false&force=true")
    assert response.status_code == 200, response.text

    assert not {match["id"] for match in matches} & {match["id"] for match in await flow.matches(tournament)}
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_deleting_a_draft_tournament_frees_the_stations_of_its_matches(flow):
    _staff, tournament, matches = await tournament_with_bracket(flow, preview=True, status="draft")
    stations = await hold(flow, tournament, matches)

    response = await flow.delete(f"/api/tournaments/{tournament['id']}")
    assert response.status_code == 200, response.text

    assert not await flow.matches(tournament)
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_changing_the_format_of_a_preview_frees_the_stations_of_the_old_preview(flow):
    _staff, tournament, matches = await tournament_with_bracket(flow, preview=True)
    stations = await hold(flow, tournament, matches)

    response = await flow.patch(f"/api/tournaments/{tournament['id']}", json={"format": "double_elim"})
    assert response.status_code == 200, response.text

    assert not {match["id"] for match in matches} & {match["id"] for match in await flow.matches(tournament)}
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_a_new_registration_refreshing_the_preview_frees_the_stations_of_the_old_preview(flow):
    from routes.tournament_registration_routes import _refresh_stage_previews_after_registration

    staff, tournament, matches = await tournament_with_bracket(flow, preview=True)
    stations = await hold(flow, tournament, matches)
    await flow.register(tournament, await flow.add_user(name="Nachzügler"))

    result = await _refresh_stage_previews_after_registration(flow.db, await current(flow, tournament), staff["id"])
    assert result and result.get("ok"), result

    assert not {match["id"] for match in matches} & {match["id"] for match in await flow.matches(tournament)}
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_the_end_of_the_check_in_fixing_the_preview_frees_the_stations_of_the_old_preview(flow):
    from routes.tournament_lifecycle_routes import _finalize_bracket_for_checkin

    _staff, tournament, matches = await tournament_with_bracket(flow, preview=True)
    stations = await hold(flow, tournament, matches)

    result = await _finalize_bracket_for_checkin(flow.db, await current(flow, tournament), None)
    assert result and result.get("ok"), result

    assert not {match["id"] for match in matches} & {match["id"] for match in await flow.matches(tournament)}
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_the_end_of_the_check_in_without_stages_frees_the_stations_of_the_dropped_matches(flow):
    """Ohne Phase und ohne Generator für das Format fallen die alten Spiele nur weg."""
    from routes import tournament_lifecycle_routes

    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(4)
    matches = [{"id": new_id(), "tournament_id": tournament["id"], "round": 1, "status": "pending",
                "is_preview": True, "slots": []} for _ in range(2)]
    await flow.db.matches_v2.insert_many([dict(match) for match in matches])
    stations = await hold(flow, tournament, matches)

    async def no_stage(*_args, **_kwargs):
        return None

    original = tournament_lifecycle_routes._create_initial_stage_bracket_preview
    tournament_lifecycle_routes._create_initial_stage_bracket_preview = no_stage
    try:
        await tournament_lifecycle_routes._finalize_bracket_for_checkin(flow.db, await current(flow, tournament), None)
    finally:
        tournament_lifecycle_routes._create_initial_stage_bracket_preview = original

    assert not await flow.matches(tournament)
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_a_staff_change_rebuilding_the_check_in_bracket_frees_the_stations_of_the_old_matches(flow):
    from routes.tournament_common import _rebuild_checkin_bracket_after_staff_change

    staff, tournament, matches = await tournament_with_bracket(flow, preview=False)
    stations = await hold(flow, tournament, matches)

    result = await _rebuild_checkin_bracket_after_staff_change(flow.db, await current(flow, tournament), staff["id"])
    assert result and result.get("ok"), result

    assert not {match["id"] for match in matches} & {match["id"] for match in await flow.matches(tournament)}
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_generating_new_groups_frees_the_stations_of_the_old_group_matches(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(8, format="groups")
    first = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": 2})
    assert first.status_code == 200, first.text
    matches = sorted(await flow.matches(tournament), key=lambda row: row["id"])
    stations = await hold(flow, tournament, matches)

    again = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate?force=true", json={"group_count": 2})
    assert again.status_code == 200, again.text

    assert not {match["id"] for match in matches} & {match["id"] for match in await flow.matches(tournament)}
    await assert_released(flow, stations)


@pytest.mark.asyncio
async def test_applying_a_structure_plan_frees_the_stations_of_the_replaced_preview(flow):
    from services.competition_structure_apply import activate_structure_plan

    _staff, tournament, matches = await tournament_with_bracket(flow, preview=True)
    stations = await hold(flow, tournament, matches)
    stored = await current(flow, tournament)
    previous_stages = await flow.db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(10)
    stage = {"id": new_id(), "tournament_id": tournament["id"], "number": 1, "stage_type": "single_elim"}
    fresh = [{"id": new_id(), "tournament_id": tournament["id"], "stage_id": stage["id"], "is_preview": True,
              "status": "pending", "round": 1, "slots": []}]

    result = await activate_structure_plan(
        flow.db, tournament=stored, engine="graph", matches=fresh, stage=stage,
        previous_stage_matches=matches, previous_stages=previous_stages,
        plan_hash="a" * 64, base_structure_hash="b" * 64, plan_version="1", actor_id=None,
    )
    assert result["ok"]

    assert [match["id"] for match in await flow.matches(tournament)] == [fresh[0]["id"]]
    await assert_released(flow, stations)


# ---------------------------------------------------------------- Aufgerufene erfahren es (#2386, Review)

async def called_on_site(flow):
    from test_live_queue_flow import call, first_round, on_site

    _staff, tournament, stations, _players = await on_site(flow)
    match = (await first_round(flow, tournament))[0]
    called = await call(flow, tournament, stations[0], match)
    assert called.status_code == 200, called.text
    return tournament, stations, match


async def withdrawn_for(flow, match) -> list[dict]:
    rows = await flow.db.notifications.find({"kind": "match_call"}, {"_id": 0}).to_list(50)
    return [row for row in rows if row["title"] == "Aufruf zurückgenommen" and row["meta"]["match_id"] == match["id"]]


@pytest.mark.asyncio
async def test_resetting_the_bracket_tells_the_called_players_and_frees_the_station(flow):
    tournament, stations, match = await called_on_site(flow)

    response = await flow.post(f"/api/tournaments/{tournament['id']}/reset-bracket?force=true")
    assert response.status_code == 200, response.text

    assert len(await withdrawn_for(flow, match)) == 2, "beide aufgerufenen Spieler"
    station = await flow.db.stations.find_one({"id": stations[0]["id"]}, {"_id": 0})
    assert station["status"] == "free" and not station.get("current_match_id")


@pytest.mark.asyncio
async def test_rebuilding_from_the_format_tells_the_called_players(flow):
    tournament, _stations, match = await called_on_site(flow)

    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false&force=true")
    assert response.status_code == 200, response.text

    assert len(await withdrawn_for(flow, match)) == 2
