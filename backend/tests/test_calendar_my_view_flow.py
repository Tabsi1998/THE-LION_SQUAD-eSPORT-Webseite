"""„Mein Kalender“ (#1788): die eigenen Termine als Ansicht - auch ohne Abo.

- `GET /api/calendar/me` liefert genau die Termine des persönlichen Feeds (dieselbe Funktion `personal_items`): eigene
  Anmeldungen (auch über das Team), gefahrene Fast Laps, zugesagte Versammlungen, eigene Schichten - Abgesagtes und
  „Nur intern“ nie, auch nicht für die Vereinsverwaltung. Je Termin der eigene Stand als Plakette.
- Dazu der Stand des Abos (ohne Adresse) und der Hinweis nach einer Anmeldung: nur ohne aktiven Link, nur einmal, am
  Konto gemerkt (`GET|POST /api/calendar/hint`).
- Gegenproben: ohne Login 401, fremde Termine nie, gesperrtes Konto bekommt nichts, nach der Abmeldung ist der Termin weg.
"""
import pathlib
import re
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import club_calendar, personal_calendar  # noqa: E402
from test_calendar_personal_feed_flow import _at, seed  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _summaries(ics: str) -> set[str]:
    unfolded = re.sub(r"\r?\n[ \t]", "", ics)
    return {line.split(":", 1)[1].replace("\\,", ",") for line in unfolded.splitlines() if line.startswith("SUMMARY:")}


@pytest.mark.asyncio
async def test_my_calendar_shows_exactly_the_feed_items_with_own_state(flow):
    paula = await flow.add_user(name="paula")
    otto = await flow.add_user(name="otto")
    await seed(flow, paula, otto)

    flow.act_as(None)
    assert (await flow.get("/api/calendar/me")).status_code == 401, "nur mit Konto"

    flow.act_as(paula)
    response = await flow.get("/api/calendar/me")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert body["subscription"] == {"active": False, "created_at": None, "last_used_at": None}, "auch ohne Abo"
    by_id = {item["id"]: item for item in body["items"]}
    assert {"e-lan", "t-team", "f-monza"} <= set(by_id)
    for foreign in ("e-fest", "t-otto", "t-gone", "f-spa", "e-members"):
        assert foreign not in by_id, f"{foreign} gehört nicht in Paulas Kalender"
    assert by_id["e-lan"]["own"]["label"] == "Angemeldet"
    assert by_id["t-team"]["own"] == {"state": "approved", "label": "Du bist dabei", "team_name": "Lions Rocket"}
    assert by_id["f-monza"]["own"]["state"] == "driven"
    assert all(item["mine"] for item in body["items"])

    # Dieselbe Regel wie der Feed: die Titel decken sich.
    path = (await flow.post("/api/calendar/personal")).json()["path"]
    shown = {item["title"] for item in (await flow.get("/api/calendar/me")).json()["items"]}
    flow.act_as(None)
    assert shown == _summaries((await flow.get(path)).text)


@pytest.mark.asyncio
async def test_my_calendar_uses_the_feed_function(flow, monkeypatch):
    """Die Rechnung steht an einer Stelle: `/me` ruft `personal_items` - nicht eine eigene Liste."""
    paula = await flow.add_user(name="paula")
    calls = []

    async def fake_items(db, user, own=None):
        calls.append(user["id"])
        return [{"id": "x-1", "kind": "event", "title": "Aus dem Feed", "start": _at(3), "mine": True}]

    monkeypatch.setattr(personal_calendar, "personal_items", fake_items)
    flow.act_as(paula)
    items = (await flow.get("/api/calendar/me")).json()["items"]
    assert calls == [paula["id"]] and [item["title"] for item in items] == ["Aus dem Feed"]


@pytest.mark.asyncio
async def test_cancelled_internal_and_lead_exception_follow_the_feed(flow):
    admin = await flow.add_user(role="club_admin", name="verwaltung")
    lead = await flow.add_user(role="tournament_admin", name="leitung")
    await flow.db.events.insert_many([
        {"id": "e-ok", "slug": "lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public", "start_date": _at(10)},
        {"id": "e-intern", "slug": "klausur", "name": "Vorstandsklausur", "status": "scheduled", "visibility": "internal", "start_date": _at(11)},
        {"id": "e-abgesagt", "slug": "grillabend", "name": "Grillabend", "status": "cancelled", "visibility": "public", "start_date": _at(12)},
        {"id": "e-members", "slug": "vereinsabend", "name": "Vereinsabend", "status": "scheduled", "visibility": "members", "start_date": _at(13)},
    ])
    await flow.db.event_registrations.insert_many(
        [{"id": f"er-{event_id}", "event_id": event_id, "user_id": admin["id"], "status": "registered"} for event_id in ("e-ok", "e-intern", "e-abgesagt")]
        + [{"id": "er-lead", "event_id": "e-members", "user_id": lead["id"], "status": "registered"}]
    )

    flow.act_as(admin)
    titles = {item["title"] for item in (await flow.get("/api/calendar/me")).json()["items"]}
    assert titles == {"Herbst-LAN"}, "Abgesagtes und „Nur intern“ nie - wie im Feed"

    flow.act_as(lead)
    assert any(item["id"] == "e-members" for item in (await flow.get("/api/calendar")).json()["items"]), "Gegenprobe: im Vereinskalender sichtbar"
    assert (await flow.get("/api/calendar/me")).json()["items"] == [], "wie der Feed: ohne die Ausnahme der Turnierleitung"


@pytest.mark.asyncio
async def test_club_items_carry_their_badge_and_cancelled_ones_stay_out(flow, monkeypatch):
    paula = await flow.add_user(name="paula")

    async def fake_club_items(db, user):
        meeting = club_calendar.meeting_item({"id": 7, "day": "2026-11-20", "time": "19:00", "title": "Jahreshauptversammlung",
                                              "kind_label": "Versammlung", "status": "planned", "response": "yes"})
        gone = club_calendar.meeting_item({"id": 8, "day": "2026-11-21", "time": "19:00", "title": "Vorstand", "status": "cancelled", "response": "yes"})
        shift = club_calendar.shift_item({"id": 3, "day": "2026-11-22", "label": "Herbst-LAN", "status": "planned"},
                                         {"id": 4, "start": "10:00", "end": "14:00", "label": "Einlass", "mine": "confirmed", "mine_label": "Bestätigt"})
        return [meeting, gone, shift]

    monkeypatch.setattr(club_calendar, "club_items", fake_club_items)
    flow.act_as(paula)
    by_id = {item["id"]: item for item in (await flow.get("/api/calendar/me")).json()["items"]}
    assert set(by_id) == {"meeting-7", "shift-3-4"}, "die abgesagte Sitzung bleibt draußen"
    assert by_id["meeting-7"]["own"]["label"] == "Zugesagt"
    assert by_id["shift-3-4"]["own"] == {"state": "confirmed", "label": "Bestätigt", "team_name": None}


@pytest.mark.asyncio
async def test_withdrawn_registration_disappears_and_banned_gets_nothing(flow):
    paula = await flow.add_user(name="paula")
    otto = await flow.add_user(name="otto")
    await seed(flow, paula, otto)
    flow.act_as(paula)
    assert any(item["id"] == "e-lan" for item in (await flow.get("/api/calendar/me")).json()["items"])
    await flow.db.event_registrations.update_one({"id": "er-1"}, {"$set": {"status": "cancelled"}})
    assert not any(item["id"] == "e-lan" for item in (await flow.get("/api/calendar/me")).json()["items"]), "abgemeldet heißt weg"

    assert await personal_calendar.my_calendar(flow.db, paula["id"]) != {"items": []}
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"is_banned": True}})
    assert (await personal_calendar.my_calendar(flow.db, paula["id"]))["items"] == [], "gesperrt: nichts - wie der Feed"


@pytest.mark.asyncio
async def test_hint_only_without_link_and_only_once(flow):
    paula = await flow.add_user(name="paula")
    otto = await flow.add_user(name="otto")

    flow.act_as(None)
    assert (await flow.get("/api/calendar/hint")).status_code == 401
    assert (await flow.post("/api/calendar/hint")).status_code == 401

    flow.act_as(paula)
    first = await flow.get("/api/calendar/hint")
    assert first.status_code == 200 and first.headers["cache-control"] == "private, no-store"
    assert first.json() == {"due": True}
    assert (await flow.get("/api/calendar/me")).json()["hint_due"] is True
    assert (await flow.post("/api/calendar/hint")).json() == {"due": False}
    assert (await flow.get("/api/calendar/hint")).json() == {"due": False}, "einmal gezeigt, am Konto gemerkt"
    assert (await flow.db.users.find_one({"id": paula["id"]}))[personal_calendar.HINT_FIELD]

    # Mit aktivem Link nie - auch wenn der Hinweis noch nie erschien.
    flow.act_as(otto)
    await flow.post("/api/calendar/personal")
    assert (await flow.get("/api/calendar/hint")).json() == {"due": False}
    assert (await flow.get("/api/calendar/me")).json()["hint_due"] is False
    await flow.delete("/api/calendar/personal")
    assert (await flow.get("/api/calendar/hint")).json() == {"due": True}, "Gegenprobe: abgeschaltet und nie gesehen"


@pytest.mark.asyncio
async def test_onsite_qr_registration_shows_members_tournament_in_feed_and_view(flow):
    """#1830: wer sich vor Ort über den QR-Code bei „Nur Mitglieder“ anmeldet (Begleitperson ohne Mitgliedschaft), hat
    das Turnier in „Mein Kalender“ und im Feed. Ohne QR-Anmeldung, „Nur intern“ und nach der Abmeldung nicht; der
    allgemeine Kalender bleibt unverändert."""
    guest = await flow.add_user(name="gast")
    await flow.db.tournaments.insert_many([
        {"id": "t-members", "slug": "mitglieder-cup", "title": "Mitglieder-Cup", "status": "registration_open",
         "visibility": "members", "is_public": True, "start_date": _at(3)},
        {"id": "t-web", "slug": "web-cup", "title": "Web-Cup", "status": "registration_open",
         "visibility": "members", "is_public": True, "start_date": _at(4)},
        {"id": "t-intern", "slug": "intern-cup", "title": "Intern-Cup", "status": "registration_open",
         "visibility": "internal", "is_public": True, "start_date": _at(5)},
    ])
    await flow.db.tournament_registrations.insert_many([
        {"id": "tr-qr", "tournament_id": "t-members", "user_id": guest["id"], "status": "approved", "registered_via": "onsite"},
        {"id": "tr-web", "tournament_id": "t-web", "user_id": guest["id"], "status": "approved", "registered_via": "web"},
        {"id": "tr-int", "tournament_id": "t-intern", "user_id": guest["id"], "status": "approved", "registered_via": "onsite"},
    ])
    flow.act_as(guest)
    by_id = {item["id"]: item for item in (await flow.get("/api/calendar/me")).json()["items"]}
    assert "t-members" in by_id, "über den Vor-Ort-QR angemeldet: steht in Mein Kalender"
    assert by_id["t-members"]["own"]["label"] == "Du bist dabei"
    assert "t-web" not in by_id and "t-intern" not in by_id
    path = (await flow.post("/api/calendar/personal")).json()["path"]
    assert not any(item["id"] == "t-members" for item in (await flow.get("/api/calendar")).json()["items"]), \
        "der allgemeine Kalender bleibt, wie er ist"
    flow.act_as(None)
    feed = (await flow.get(path)).text
    assert "Mitglieder-Cup" in feed and "Web-Cup" not in feed and "Intern-Cup" not in feed
    assert "Mitglieder-Cup" not in (await flow.get("/api/calendar/feed.ics")).text

    await flow.db.tournament_registrations.update_one({"id": "tr-qr"}, {"$set": {"status": "withdrawn"}})
    assert "Mitglieder-Cup" not in (await flow.get(path)).text, "abgemeldet heißt weg"
