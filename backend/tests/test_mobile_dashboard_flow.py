"""Die Startseite der App - durch die echte Anwendung geschickt.

Auf dem Handy standen unter "Meine nächsten Termine" der Summer Cup vom Mai,
ein beendetes Event und eine abgesagte Championship, und der Zähler zählte sie
mit (#212). Hier steht fest, was die Startseite liefert: nur Termine von heute
an, nichts Vorbeies, nichts Abgesagtes - und die eigene Platzierung in der
Jahreswertung.
"""
import pathlib
import sys
from datetime import timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from routes import mobile_routes, season_routes  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    mobile_routes._season_cache.update(at=None, season_id=None, standings=[])
    try:
        yield instance
    finally:
        await shutdown()


def iso(days: float) -> str:
    return (now_utc() + timedelta(days=days)).isoformat()


def earlier_today() -> str:
    """Heute, eine Minute nach Mitternacht Wiener Zeit - egal, wann der Test läuft.

    „Jetzt minus ein paar Stunden“ ist zwischen Mitternacht und dem frühen Morgen gestern; der
    Test war damit jede Nacht einige Stunden rot (aufgefallen am 22.09. um 00:02, #218).
    """
    midnight = now_utc().astimezone(mobile_routes.LOCAL_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    return (midnight + timedelta(minutes=1)).astimezone(timezone.utc).isoformat()


async def event(flow, user, *, days: float, status: str = "registration_open", name: str = "Event") -> dict:
    doc = {
        "id": new_id(), "slug": f"event-{new_id()[:8]}", "name": name, "status": status,
        "visibility": "public", "start_date": iso(days), "location": "Telfs", "city": "Telfs",
    }
    await flow.db.events.insert_one(dict(doc))
    await flow.db.event_registrations.insert_one({
        "id": new_id(), "event_id": doc["id"], "user_id": user["id"], "status": "registered",
    })
    return doc


@pytest.mark.asyncio
async def test_own_dates_show_only_today_and_later_and_nothing_cancelled(flow):
    alice = await flow.add_user(name="alice")
    summer_cup = await flow.create_tournament(title="Summer Cup", start_date=iso(-115), status="results_published")
    cancelled = await flow.create_tournament(title="Championship", start_date=iso(3), status="cancelled")
    autumn_cup = await flow.create_tournament(title="Autumn Cup", start_date=iso(46))
    today_cup = await flow.create_tournament(title="Heute-Cup", start_date=earlier_today(), status="live")
    for tournament in (summer_cup, cancelled, autumn_cup, today_cup):
        await flow.register(tournament, alice)
    await event(flow, alice, days=-115, status="completed", name="Summer Opening")
    halloween = await event(flow, alice, days=46, name="Halloween Gaming Night")
    flow.act_as(alice)

    response = await flow.get("/api/mobile/dashboard")

    assert response.status_code == 200, response.text
    data = response.json()
    assert [row["title"] for row in data["me"]["tournaments"]] == ["Heute-Cup", "Autumn Cup"]
    assert [row["id"] for row in data["me"]["events"]] == [halloween["id"]]
    assert data["stats"]["my_tournaments"] == 2
    assert data["stats"]["my_events"] == 1


@pytest.mark.asyncio
async def test_a_date_without_end_counts_for_the_whole_day(flow):
    alice = await flow.add_user(name="alice")
    # Heute um 08:00 Ortszeit begonnen, kein Ende eingetragen - bleibt heute sichtbar.
    morning = now_utc().astimezone(mobile_routes.LOCAL_TZ).replace(hour=8, minute=0, second=0, microsecond=0)
    tournament = await flow.create_tournament(title="Frühcup", start_date=morning.isoformat(), status="live")
    await flow.register(tournament, alice)
    flow.act_as(alice)

    data = (await flow.get("/api/mobile/dashboard")).json()

    assert [row["title"] for row in data["me"]["tournaments"]] == ["Frühcup"]


@pytest.mark.asyncio
async def test_the_season_row_shows_own_rank_and_the_leader(flow, monkeypatch):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    await flow.db.seasons.insert_one({
        "id": "season-2026", "slug": "jahreswertung-2026", "name": "Jahreswertung 2026",
        "status": "active", "start_date": iso(-200),
    })

    async def fake_standings(slug_or_id):
        assert slug_or_id == "season-2026"
        return {"season": {"id": "season-2026"}, "standings": [
            {"user_id": bob["id"], "display_name": "bob", "points": 200, "rank": 1},
            {"user_id": alice["id"], "display_name": "alice", "points": 120, "rank": 4},
        ]}

    monkeypatch.setattr(season_routes, "season_standings", fake_standings)

    flow.act_as(alice)
    season = (await flow.get("/api/mobile/dashboard")).json()["season"]
    assert season["name"] == "Jahreswertung 2026"
    assert (season["my_rank"], season["my_points"]) == (4, 120)
    assert season["leader"] == {"display_name": "bob", "points": 200}
    assert season["participant_count"] == 2

    flow.act_as(None)
    guest = (await flow.get("/api/mobile/dashboard")).json()["season"]
    assert guest["my_rank"] is None
    assert guest["leader"]["display_name"] == "bob"


@pytest.mark.asyncio
async def test_without_an_active_season_there_is_no_season_row(flow):
    flow.act_as(None)
    assert (await flow.get("/api/mobile/dashboard")).json()["season"] is None
