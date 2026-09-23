"""Kalender der Website (#402): eine Liste mit Rechten vom Server, ein öffentlicher Abo-Feed."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id, now_utc  # noqa: E402
from services import calendar_items  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _at(days: int, hour: int = 18):
    return (now_utc() + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


async def seed(flow):
    await flow.db.events.insert_many([
        {"id": "e-fest", "slug": "sommerfest", "name": "Sommerfest", "status": "scheduled", "visibility": "public",
         "start_date": _at(10), "end_date": _at(10, 22), "location": "Vereinsheim", "city": "Telfs"},
        {"id": "e-intern", "slug": "vorstandssitzung", "name": "Vorstandssitzung", "status": "scheduled", "visibility": "internal", "start_date": _at(12)},
        {"id": "e-members", "slug": "lan", "name": "LAN im Vereinsheim", "status": "registration_open", "visibility": "members", "start_date": _at(20)},
        {"id": "e-draft", "slug": "entwurf", "name": "Entwurf", "status": "draft", "visibility": "public", "start_date": _at(30)},
        {"id": "e-alt", "slug": "alt", "name": "Ohne Datum", "status": "scheduled", "visibility": "public"},
    ])
    await flow.db.tournaments.insert_many([
        {"id": "t-cup", "slug": "autumn-cup", "title": "Autumn Cup", "status": "registration_open", "visibility": "public", "is_public": True,
         "start_date": _at(15, 19), "registration_open_until": _at(13, 23), "game_name": "Mario Kart 8"},
        {"id": "t-geheim", "slug": "geheim", "title": "Geheimes Turnier", "status": "scheduled", "visibility": "public", "is_public": False, "start_date": _at(16)},
    ])
    await flow.db.f1_challenges.insert_one(
        {"id": "f-lap", "slug": "monza", "title": "Fast Lap Monza", "status": "live", "visibility": "public", "start_date": _at(-2), "end_date": _at(5)},
    )


@pytest.mark.asyncio
async def test_anonymous_sees_public_items_and_deadlines_only(flow):
    await seed(flow)
    flow.act_as(None)
    response = await flow.get("/api/calendar")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["signed_in"] is False and payload["feed_path"] == "/api/calendar/feed.ics"
    ids = [item["id"] for item in payload["items"]]
    assert ids == ["f-lap", "e-fest", "t-cup-anmeldeschluss", "t-cup"], "nach Beginn sortiert; intern, Mitglieder, Entwurf, nicht-öffentlich und ohne Datum fehlen"
    fest = next(item for item in payload["items"] if item["id"] == "e-fest")
    assert fest["path"] == "/events/sommerfest" and fest["location"] == "Vereinsheim, Telfs" and fest["mine"] is False
    assert fest["phase"]["label"]
    deadline = next(item for item in payload["items"] if item["marker"] == "registration_close")
    assert deadline["title"] == "Anmeldeschluss: Autumn Cup" and deadline["path"] == "/tournaments/autumn-cup"


@pytest.mark.asyncio
async def test_member_sees_club_items_with_own_registrations_marked(flow):
    await seed(flow)
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.memberships.insert_one({"id": "m-paula", "user_id": paula["id"], "member_status": "active"})
    paula["is_club_member"] = True
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"is_club_member": True}})
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-members", "user_id": paula["id"], "status": "registered"})
    await flow.db.tournament_registrations.insert_many([
        {"id": new_id(), "tournament_id": "t-cup", "user_id": paula["id"], "status": "approved"},
    ])
    flow.act_as(paula)
    payload = (await flow.get("/api/calendar")).json()
    by_id = {item["id"]: item for item in payload["items"]}
    assert payload["signed_in"] is True
    assert "e-members" in by_id and "e-intern" not in by_id, "Mitglied sieht Mitglieder-Termine, nicht die des Vorstands"
    assert by_id["e-members"]["mine"] is True and by_id["e-fest"]["mine"] is False
    assert by_id["t-cup"]["mine"] is True and by_id["t-cup-anmeldeschluss"]["mine"] is True

    vorstand = await flow.add_user(role="player", name="vorstand")
    await flow.db.users.update_one({"id": vorstand["id"]}, {"$set": {"areas": ["club"]}})
    vorstand["areas"] = ["club"]
    flow.act_as(vorstand)
    ids = {item["id"] for item in (await flow.get("/api/calendar")).json()["items"]}
    assert "e-intern" in ids and "t-geheim" not in ids


@pytest.mark.asyncio
async def test_feed_is_the_anonymous_view_without_personal_data(flow):
    await seed(flow)
    paula = await flow.add_user(role="player", name="paula")
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-fest", "user_id": paula["id"], "status": "registered", "email": "paula@lionsquad-test.at"})
    flow.act_as(paula)
    response = await flow.get("/api/calendar/feed.ics")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    text = response.text
    assert text.startswith("BEGIN:VCALENDAR\r\n") and text.endswith("END:VCALENDAR\r\n")
    assert "SUMMARY:Sommerfest" in text and "SUMMARY:Anmeldeschluss: Autumn Cup" in text
    assert "LOCATION:Vereinsheim\\, Telfs" in text
    assert "UID:event-e-fest@lionsquad.at" in text and "/events/sommerfest" in text
    assert "LAN im Vereinsheim" not in text and "Vorstandssitzung" not in text and "Geheimes" not in text
    assert "paula@lionsquad-test.at" not in text and "ATTENDEE" not in text and "angemeldet" not in text.lower()


def test_ics_folds_long_lines_and_defaults_to_two_hours():
    items = [{"id": "x", "kind": "event", "title": "Ein sehr langer Titel, " * 6, "start": "2026-12-12T18:00:00+01:00", "end": None,
              "path": "/events/x", "status": "scheduled", "phase": {"label": "Angekündigt"}, "location": None}]
    text = calendar_items.ics_feed(items, origin="https://lionsquad.at", now=calendar_items._dt("2026-09-23T10:00:00Z"))
    assert "DTSTART:20261212T170000Z" in text and "DTEND:20261212T190000Z" in text
    assert all(len(line.encode("utf-8")) <= 75 for line in text.split("\r\n"))
    unfolded = text.replace("\r\n ", "")
    assert "SUMMARY:Ein sehr langer Titel\\, Ein sehr langer Titel\\," in unfolded
    assert "DESCRIPTION:Event · Angekündigt" in unfolded
