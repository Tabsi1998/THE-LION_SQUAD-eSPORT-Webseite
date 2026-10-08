"""Adventkalender und Ostereiersuche (#1360): Redaktion und Vereinsverwaltung schalten sie auf ihrer eigenen Seite ein
und aus - nur diese zwei Jahreszeiten, mit Protokoll; alle anderen bleiben beim System."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def granted(flow, name: str, *areas: str) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


@pytest.mark.asyncio
async def test_editors_and_the_board_switch_advent_and_easter(flow):
    from services import seasons

    editor = await granted(flow, "redaktion", "content")
    flow.act_as(editor)
    state = await flow.get("/api/seasonal/switch/advent_calendar")
    assert state.status_code == 200, state.text
    assert state.json()["enabled"] is True and state.json()["label"] == "Adventkalender" and state.json()["next_start"]

    switched = await flow.put("/api/seasonal/switch/advent_calendar", json={"enabled": False})
    assert switched.status_code == 200 and switched.json()["enabled"] is False
    stored = await flow.db.settings.find_one({"id": seasons.SETTINGS_ID})
    assert stored["seasons"]["advent_calendar"]["enabled"] is False
    audit = await flow.db.audit_logs.find_one({"action": "seasons.switch", "target_id": "advent_calendar"}, {"_id": 0})
    assert audit["actor_id"] == editor["id"] and audit["data"]["changed"] == ["enabled"]

    flow.act_as(await granted(flow, "vorstand", "club"))
    app_only = await flow.put("/api/seasonal/switch/easter_hunt", json={"channels": ["app"]})
    assert app_only.status_code == 200 and app_only.json()["channels"] == ["app"]
    flow.act_as(await flow.add_user(role="superadmin", name="root"))
    back_on = await flow.put("/api/seasonal/switch/advent_calendar", json={"enabled": True})
    assert back_on.json()["enabled"] is True


@pytest.mark.asyncio
async def test_other_roles_and_other_seasons_stay_out(flow):
    for actor in (await flow.add_user(role="tournament_admin", name="turnierleitung"), await flow.add_user(role="moderator", name="moderation"),
                  await granted(flow, "kassier", "finance")):
        flow.act_as(actor)
        refused = await flow.put("/api/seasonal/switch/advent_calendar", json={"enabled": False})
        assert refused.status_code == 403, actor["username"]
    flow.act_as(await granted(flow, "redaktion", "content"))
    other = await flow.put("/api/seasonal/switch/halloween", json={"enabled": False})
    assert other.status_code == 400 and "Auftritt → Jahreszeiten" in other.json()["detail"]
    weather = await flow.get("/api/seasonal/switch/weather")
    assert weather.status_code == 400
    switched = await flow.db.audit_logs.count_documents({"action": "seasons.switch"})
    assert switched == 0
