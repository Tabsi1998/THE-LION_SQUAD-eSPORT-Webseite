"""Die Minuten-Jobs erreichen jedes laufende Turnier (#1940): Show-Auslosung und Fristen suchen gezielt die Turniere, an
deren Spielen etwas fällig sein kann - nicht mehr nur die ersten 200 mit Status „live“. Ein Stand mit vielen alten
„live“-Turnieren (Seeds, Probeläufe) versteckt den Cup des Abends nicht mehr; ungewöhnlich viele melden sich im Log.
"""
import logging
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import live_sweep  # noqa: E402
from services.draw_show import sweep as draw_sweep  # noqa: E402
from services.match_deadline_sweep import sweep as deadline_sweep  # noqa: E402

FILLERS = 250


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture(autouse=True)
def fresh_warning_clock(monkeypatch):
    monkeypatch.setattr(live_sweep, "_last_warned", {})


@pytest.fixture(autouse=True)
def motor_like_to_list(monkeypatch):
    """mongomock_motor gibt bei ``to_list(n)`` alles zurück, Motor höchstens ``n`` - hier wie Motor, sonst bliebe die
    alte Grenze von 200 im Test unsichtbar."""
    from mongomock_motor import AsyncCursor

    original = AsyncCursor.to_list

    async def to_list(self, length=None, *args, **kwargs):
        rows = await original(self, length, *args, **kwargs)
        return rows[:length] if length else rows

    monkeypatch.setattr(AsyncCursor, "to_list", to_list)


async def many_live_tournaments(flow, count: int = FILLERS) -> None:
    """Alte „live“-Turniere aus Seeds und Probeläufen - vor dem Cup des Abends angelegt, also vorne in der Sammlung."""
    await flow.db.tournaments.insert_many([
        {"id": f"alt-{index:03d}", "slug": f"alt-{index:03d}", "title": f"Alter Probelauf {index}", "status": "live"}
        for index in range(count)
    ])


def ranking(match: dict) -> dict:
    regs = [slot["registration_id"] for slot in match["slots"] if slot.get("registration_id")]
    return {"results": [{"registration_id": regs[0], "rank": 1, "score": 2}, {"registration_id": regs[1], "rank": 2, "score": 0}]}


async def show_cup(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(8, advancement_mode="draw_show", draw_show_minutes=3, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    first_round = [m for m in await flow.matches(tournament) if m.get("round") == 1 and m.get("section") == "WB"]
    for match in first_round:
        played = await flow.post(f"/api/matches/{match['id']}/result", json=ranking(match))
        assert played.status_code == 200, played.text
    waiting = [m for m in await flow.matches(tournament) if isinstance(m.get("draw_ready"), dict)]
    assert waiting, "die Runde wartet auf das Los"
    return staff, tournament, waiting


async def wait_since(flow, matches, minutes: float) -> None:
    await flow.db.matches_v2.update_many({"id": {"$in": [m["id"] for m in matches]}},
                                         {"$set": {"draw_ready.since": (now_utc() - timedelta(minutes=minutes)).isoformat()}})


@pytest.mark.asyncio
async def test_the_show_job_reminds_and_draws_a_cup_behind_250_live_tournaments(flow):
    await many_live_tournaments(flow)
    staff, tournament, waiting = await show_cup(flow)

    await wait_since(flow, waiting, 4)
    assert await draw_sweep(flow.db) == {"reminded": 1, "drawn": 0}, "Erinnerung nach 3 Minuten"
    note = await flow.db.notifications.find_one({"meta.reason": "draw_ready"}, {"_id": 0})
    assert note and note["user_id"] == staff["id"]

    await wait_since(flow, waiting, 7)
    assert await draw_sweep(flow.db) == {"reminded": 0, "drawn": 1}, "Los nach 6 Minuten"
    drawn = [await flow.reload(m) for m in waiting]
    assert all((m.get("draw") or {}).get("trigger") == "timeout" for m in drawn)


@pytest.mark.asyncio
async def test_the_show_job_leaves_tournaments_alone_that_no_longer_run(flow):
    _staff, tournament, waiting = await show_cup(flow)
    await wait_since(flow, waiting, 30)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "paused"}})
    assert await draw_sweep(flow.db) == {"reminded": 0, "drawn": 0}
    reloaded = [await flow.reload(m) for m in waiting]
    assert all(not m.get("draw") for m in reloaded)


@pytest.mark.asyncio
async def test_the_deadline_job_proposes_a_no_show_in_a_cup_behind_250_live_tournaments(flow):
    await many_live_tournaments(flow)
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _registrations = await flow.with_participants(4, event_mode="local")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    called = (now_utc() - timedelta(minutes=11)).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": "station-1", "called_at": called}})

    assert (await deadline_sweep(flow.db))["proposed"] == 1
    assert (await flow.reload(match))["no_show_proposal"]["rule"] == "on_site"


@pytest.mark.asyncio
async def test_many_live_tournaments_are_reported_once_an_hour(flow, caplog):
    await many_live_tournaments(flow, 60)
    with caplog.at_level(logging.WARNING, logger="tls.live_sweep"):
        await draw_sweep(flow.db)
        await deadline_sweep(flow.db)
        await draw_sweep(flow.db)
    warnings = [record.getMessage() for record in caplog.records if record.name == "tls.live_sweep"]
    assert len(warnings) == 2, warnings
    assert all("60 Turniere" in text for text in warnings)


@pytest.mark.asyncio
async def test_a_handful_of_live_tournaments_stays_quiet(flow, caplog):
    await many_live_tournaments(flow, 5)
    with caplog.at_level(logging.WARNING, logger="tls.live_sweep"):
        await draw_sweep(flow.db)
        await deadline_sweep(flow.db)
    assert not [record for record in caplog.records if record.name == "tls.live_sweep"]


def test_the_jobs_find_their_matches_through_an_index():
    import asyncio

    import database
    from mongomock_motor import AsyncMongoMockClient

    async def scenario(db):
        await database.init_indexes()
        names = set(await db.matches_v2.index_information())
        assert "draw_ready_pending" in names, "wartende Auslosungen"
        assert "status_1_tournament_id_1" in names, "offene Spiele je Turnier"

    db = AsyncMongoMockClient()["indizes_sweep"]
    original = database.get_db
    database.get_db = lambda: db
    try:
        asyncio.run(scenario(db))
    finally:
        database.get_db = original
