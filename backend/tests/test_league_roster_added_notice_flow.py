"""Hinweis bei späterer Kaderaufnahme (docs/LIGA.md, #2202 D-16): Wer während der Season ohne Spiel-ID oder nach dem Stichtag
ins Co-Team kommt, erfährt es - genau wie beim Zuteilen, zusammen mit den Verantwortlichen und nur einmal. Erfundene Namen."""

import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world  # noqa: E402
from test_league_roster_flow import id_world  # noqa: E402

PAST_DAY = "2026-01-01"
REASONS = ["league_id_missing", "league_id_missing_team", "league_late", "league_late_team"]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def set_kader(flow, w: dict, squad: dict, names: list[str]):
    flow.act_as(w["users"]["LoeLeitung"])
    response = await flow.patch(f"/api/teams/{w['lions']['id']}/squads/{squad['id']}",
                                json={"member_ids": [w["users"][name]["id"] for name in names]})
    assert response.status_code == 200, response.text
    return response


async def notes(flow, w: dict, name: str) -> list[dict]:
    return await flow.db.notifications.find(
        {"user_id": w["users"][name]["id"], "meta.reason": {"$in": REASONS}}, {"_id": 0}).to_list(None)


@pytest.mark.asyncio
async def test_a_new_player_without_id_and_the_captain_are_told(flow):
    w = await id_world(flow, without=("Ida",))

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    player = await notes(flow, w, "Ida")
    assert [row["meta"]["reason"] for row in player] == ["league_id_missing"]
    assert player[0]["url"] == "/profile?tab=gaming" and "Activision-ID" in player[0]["body"]
    captain = await notes(flow, w, "Kapitaen")
    assert [row["meta"]["reason"] for row in captain] == ["league_id_missing_team"]
    assert "Ida" in captain[0]["body"]
    assert await notes(flow, w, "Mila") == [], "der übrige Kader bekommt nichts"


@pytest.mark.asyncio
async def test_a_new_player_after_the_deadline_and_the_captain_are_told(flow):
    w = await id_world(flow, deadline=PAST_DAY)

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    player = await notes(flow, w, "Ida")
    assert [row["meta"]["reason"] for row in player] == ["league_late"]
    assert "erst freigeben" in player[0]["body"]
    captain = await notes(flow, w, "Kapitaen")
    assert [row["meta"]["reason"] for row in captain] == ["league_late_team"]
    assert "Ida" in captain[0]["body"] and "Freigabe" in captain[0]["body"]


@pytest.mark.asyncio
async def test_without_captain_the_team_leadership_is_told(flow):
    w = await id_world(flow, without=("Ida",))
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$unset": {"captain_id": ""}})

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    assert [row["meta"]["reason"] for row in await notes(flow, w, "LoeLeitung")] == ["league_id_missing_team"]


@pytest.mark.asyncio
async def test_leaving_and_coming_back_does_not_tell_twice(flow):
    w = await id_world(flow, without=("Ida",))

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])
    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom"])
    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    assert len(await notes(flow, w, "Ida")) == 1
    assert len(await notes(flow, w, "Kapitaen")) == 1


@pytest.mark.asyncio
async def test_a_second_new_player_is_told_about_too(flow):
    w = await id_world(flow, without=("Ida", "LoeLeitung"))

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])
    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida", "LoeLeitung"])

    bodies = [row["body"] for row in await notes(flow, w, "Kapitaen")]
    assert len(bodies) == 2 and "Ida" in bodies[0] and "LoeLeitung" in bodies[1]


@pytest.mark.asyncio
async def test_nobody_is_told_when_the_id_is_fine(flow):
    w = await id_world(flow)

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    assert await notes(flow, w, "Ida") == [] and await notes(flow, w, "Kapitaen") == []


@pytest.mark.asyncio
async def test_a_game_without_a_required_id_tells_nobody(flow):
    w = await world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Testliga", "slug": "testliga", "game_id": "probe-shooter"})

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    assert await notes(flow, w, "Ida") == [] and await notes(flow, w, "Kapitaen") == []


@pytest.mark.asyncio
async def test_a_banned_new_player_is_not_told_about_a_missing_id(flow):
    w = await id_world(flow, without=("Ida",))
    await flow.db.users.update_one({"id": w["users"]["Ida"]["id"]}, {"$set": {"is_banned": True}})

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    assert await notes(flow, w, "Ida") == [] and await notes(flow, w, "Kapitaen") == []


@pytest.mark.asyncio
async def test_a_finished_staffel_tells_nobody(flow):
    w = await id_world(flow, without=("Ida",))
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": {"status": "completed"}})

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    assert await notes(flow, w, "Ida") == []


@pytest.mark.asyncio
async def test_an_archived_co_team_tells_nobody_but_keeps_the_roster_entry(flow):
    w = await id_world(flow, without=("Ida",))
    await flow.db.team_squads.update_one({"id": w["squad_a"]["id"]}, {"$set": {"status": "archived"}})

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    assert await notes(flow, w, "Ida") == [] and await notes(flow, w, "Kapitaen") == []
    entry = await flow.db.league_rosters.find_one({"season_id": w["season_id"], "user_id": w["users"]["Ida"]["id"]}, {"_id": 0})
    assert entry and w["squad_a"]["id"] in entry["squad_ids"], "der Kader der Season bleibt vollständig"


@pytest.mark.asyncio
async def test_a_failing_notice_does_not_undo_the_change(flow, monkeypatch):
    from services import user_notifications

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Nachricht klemmt")

    monkeypatch.setattr(user_notifications, "create_user_notification", broken)
    w = await id_world(flow, without=("Ida",))

    await set_kader(flow, w, w["squad_a"], ["Kapitaen", "Mila", "Tom", "Ida"])

    stored = await flow.db.team_squads.find_one({"id": w["squad_a"]["id"]}, {"_id": 0})
    assert w["users"]["Ida"]["id"] in stored["member_ids"]
