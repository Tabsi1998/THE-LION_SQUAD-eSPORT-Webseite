"""„Nur meine“ und der persönliche Kalender-Link (#1189).

- `GET /api/calendar/mine` und `mine` in `GET /api/calendar`: eigene Event-Anmeldung, Turnier selbst oder mit dem Team,
  Fast Lap gefahren - nichts von anderen.
- Der persönliche Link: zufälliges Token, gespeichert nur als Hash; der Feed enthält nur eigene Termine, die die Person
  sehen darf, und bleibt in keinem Zwischenspeicher. Neu erzeugen sperrt die alte Adresse, abschalten sperrt alle,
  gesperrte Konten und gelöschte Konten bekommen nichts, zu viele Abrufe bremst der Server. Das Token steht in keinem
  Zugriffsprotokoll.
- Gegenproben: eine fremde, erfundene oder alte Adresse liefert nichts; der öffentliche Feed bleibt anonym.
"""
import logging
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import account_erasure, log_safe, personal_calendar  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def _at(days: int, hour: int = 18):
    return (now_utc() + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


async def seed(flow, paula: dict, otto: dict) -> None:
    """Paula: Event-Anmeldung, Teamturnier über ihr Team, gefahrene Fast Lap. Otto: ein eigenes Turnier."""
    await flow.db.events.insert_many([
        {"id": "e-lan", "slug": "herbst-lan", "name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "start_date": _at(10)},
        {"id": "e-fest", "slug": "sommerfest", "name": "Sommerfest", "status": "scheduled", "visibility": "public", "start_date": _at(11)},
        {"id": "e-members", "slug": "vereinsabend", "name": "Vereinsabend", "status": "scheduled", "visibility": "members", "start_date": _at(12)},
    ])
    await flow.db.tournaments.insert_many([
        {"id": "t-team", "slug": "rocket-cup", "title": "Rocket Cup", "status": "registration_open", "visibility": "public", "is_public": True,
         "event_id": "e-lan", "start_date": _at(10, 14)},
        {"id": "t-otto", "slug": "otto-cup", "title": "Ottos Cup", "status": "registration_open", "visibility": "public", "is_public": True, "start_date": _at(13)},
        {"id": "t-gone", "slug": "abgesagt", "title": "Zurückgezogen", "status": "registration_open", "visibility": "public", "is_public": True, "start_date": _at(14)},
    ])
    await flow.db.f1_challenges.insert_many([
        {"id": "f-monza", "slug": "monza", "title": "Fast Lap Monza", "status": "live", "visibility": "public", "start_date": _at(-1), "end_date": _at(5)},
        {"id": "f-spa", "slug": "spa", "title": "Fast Lap Spa", "status": "live", "visibility": "public", "start_date": _at(-1), "end_date": _at(6)},
    ])
    await flow.db.event_registrations.insert_many([
        {"id": "er-1", "event_id": "e-lan", "user_id": paula["id"], "status": "registered"},
        {"id": "er-2", "event_id": "e-members", "user_id": paula["id"], "status": "registered"},
        {"id": "er-3", "event_id": "e-fest", "user_id": otto["id"], "status": "registered"},
    ])
    await flow.db.teams.insert_one({"id": "team-lions", "name": "Lions Rocket", "member_ids": [paula["id"], "someone-else"]})
    await flow.db.tournament_registrations.insert_many([
        {"id": "tr-1", "tournament_id": "t-team", "user_id": "someone-else", "team_id": "team-lions", "status": "approved"},
        {"id": "tr-2", "tournament_id": "t-otto", "user_id": otto["id"], "status": "approved"},
        {"id": "tr-3", "tournament_id": "t-gone", "user_id": paula["id"], "status": "withdrawn"},
    ])
    await flow.db.f1_lap_times.insert_one({"id": "lap-1", "challenge_id": "f-monza", "user_id": paula["id"], "time_ms": 81234})


@pytest.mark.asyncio
async def test_mine_counts_own_team_and_driven_but_nothing_of_others(flow):
    paula = await flow.add_user(name="paula")
    otto = await flow.add_user(name="otto")
    await seed(flow, paula, otto)

    flow.act_as(paula)
    response = await flow.get("/api/calendar/mine")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    mine = response.json()
    assert set(mine["events"]) == {"e-lan", "e-members"}
    assert mine["tournaments"] == {"t-team": {"state": "approved", "label": "Du bist dabei", "team_name": "Lions Rocket"}}, "über das Team, nicht zurückgezogen"
    assert set(mine["fastlaps"]) == {"f-monza"}

    flagged = {item["id"] for item in (await flow.get("/api/calendar")).json()["items"] if item["mine"]}
    assert {"e-lan", "t-team", "f-monza"} <= flagged, "Team und gefahrene Fast Lap tragen jetzt auch im Kalender „angemeldet“"
    assert not flagged & {"e-fest", "t-otto", "t-gone", "f-spa"}

    flow.act_as(None)
    assert (await flow.get("/api/calendar/mine")).status_code == 401


@pytest.mark.asyncio
async def test_personal_link_is_stored_as_hash_and_shows_only_own_items(flow):
    paula = await flow.add_user(name="paula")
    otto = await flow.add_user(name="otto")
    await seed(flow, paula, otto)

    flow.act_as(None)
    assert (await flow.post("/api/calendar/personal")).status_code == 401, "nur mit Konto"

    flow.act_as(paula)
    assert (await flow.get("/api/calendar/personal")).json()["active"] is False
    issued = await flow.post("/api/calendar/personal")
    assert issued.status_code == 200, issued.text
    assert issued.headers["cache-control"] == "private, no-store"
    path = issued.json()["path"]
    token = path.removeprefix(personal_calendar.PATH_PREFIX).removesuffix(".ics")
    assert len(token) >= 40, "langes, zufälliges Token"

    rows = await flow.db.calendar_feed_tokens.find({}, {"_id": 0}).to_list(10)
    assert len(rows) == 1 and rows[0]["user_id"] == paula["id"]
    assert token not in str(rows), "gespeichert ist nur der Hash"
    assert rows[0]["token_hash"] == personal_calendar.token_hash(token)
    status = (await flow.get("/api/calendar/personal")).json()
    assert status["active"] is True and "path" not in status, "die Adresse gibt es nur beim Erzeugen"

    flow.act_as(None)
    feed = await flow.get(path)
    assert feed.status_code == 200, feed.text
    assert feed.headers["content-type"].startswith("text/calendar")
    assert feed.headers["cache-control"] == "private, no-store"
    text = feed.text
    assert "Herbst-LAN" in text and "Rocket Cup" in text and "Fast Lap Monza" in text
    for foreign in ("Sommerfest", "Ottos Cup", "Zurückgezogen", "Fast Lap Spa"):
        assert foreign not in text, f"{foreign} gehört nicht Paula"
    assert "Vereinsabend" not in text, "ohne Mitgliedschaft sieht Paula den Mitglieder-Termin nicht - auch nicht über den Link"
    assert (await flow.db.calendar_feed_tokens.find_one({"user_id": paula["id"]}))["last_used_at"]

    # Gegenprobe: mit aktiver Mitgliedschaft steht der Mitglieder-Termin darin.
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": paula["id"], "member_status": "active"})
    assert "Vereinsabend" in (await flow.get(path)).text

    # Der öffentliche Feed bleibt anonym: keine Mitglieder-Termine, kein Bezug zu Paula.
    public = (await flow.get("/api/calendar/feed.ics")).text
    assert "Vereinsabend" not in public and "Sommerfest" in public


@pytest.mark.asyncio
async def test_old_foreign_and_made_up_addresses_give_nothing(flow):
    paula = await flow.add_user(name="paula")
    otto = await flow.add_user(name="otto")
    await seed(flow, paula, otto)

    flow.act_as(paula)
    first = (await flow.post("/api/calendar/personal")).json()["path"]
    second = (await flow.post("/api/calendar/personal")).json()["path"]
    assert first != second
    assert await flow.db.calendar_feed_tokens.count_documents({"user_id": paula["id"]}) == 1, "je Konto ein Link"
    flow.act_as(otto)
    ottos = (await flow.post("/api/calendar/personal")).json()["path"]

    flow.act_as(None)
    assert (await flow.get(first)).status_code == 404, "neu erzeugen sperrt die alte Adresse"
    assert (await flow.get(second)).status_code == 200
    otto_text = (await flow.get(ottos)).text
    assert "Ottos Cup" in otto_text and "Sommerfest" in otto_text and "Rocket Cup" not in otto_text and "Herbst-LAN" not in otto_text
    for made_up in (personal_calendar.feed_path(personal_calendar.new_token()), personal_calendar.feed_path("kurz"),
                    personal_calendar.feed_path(personal_calendar.token_hash("x")[:43])):
        missing = await flow.get(made_up)
        assert missing.status_code == 404 and missing.headers["cache-control"] == "private, no-store"
    # Der Hash als Adresse öffnet nichts - nur das Token selbst.
    row = await flow.db.calendar_feed_tokens.find_one({"user_id": paula["id"]})
    assert (await flow.get(personal_calendar.feed_path(row["token_hash"]))).status_code == 404

    flow.act_as(paula)
    revoked = await flow.delete("/api/calendar/personal")
    assert revoked.status_code == 200 and revoked.json()["active"] is False
    flow.act_as(None)
    assert (await flow.get(second)).status_code == 404, "abgeschaltet heißt weg"


@pytest.mark.asyncio
async def test_banned_inactive_and_deleted_accounts_lose_the_feed(flow):
    paula = await flow.add_user(name="paula")
    otto = await flow.add_user(name="otto")
    await seed(flow, paula, otto)
    flow.act_as(paula)
    path = (await flow.post("/api/calendar/personal")).json()["path"]
    flow.act_as(None)
    assert (await flow.get(path)).status_code == 200

    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"is_banned": True}})
    assert (await flow.get(path)).status_code == 404, "gesperrt"
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"is_banned": False, "is_active": False}})
    assert (await flow.get(path)).status_code == 404, "abgeschaltet"
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"is_active": True}})
    assert (await flow.get(path)).status_code == 200, "Gegenprobe: wieder aktiv, wieder da"

    assert "calendar_feed_tokens" in account_erasure.PURGED
    await account_erasure.erase_related(flow.db, {"id": paula["id"]}, now_utc().isoformat())
    assert await flow.db.calendar_feed_tokens.count_documents({"user_id": paula["id"]}) == 0
    assert (await flow.get(path)).status_code == 404, "Konto gelöscht, Link weg"


@pytest.mark.asyncio
async def test_too_many_requests_are_braked(flow):
    paula = await flow.add_user(name="paula")
    flow.act_as(paula)
    path = (await flow.post("/api/calendar/personal")).json()["path"]
    flow.act_as(None)
    limit, _ = calendar_feed_limit()
    codes = [(await flow.get(path)).status_code for _ in range(limit + 1)]
    assert codes[:limit] == [200] * limit
    assert codes[-1] == 429


def calendar_feed_limit():
    from routes import calendar_routes

    return calendar_routes.PERSONAL_PER_LINK


def test_access_log_never_shows_the_token():
    token = personal_calendar.new_token()
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                               ("10.0.0.1:5000", "GET", personal_calendar.feed_path(token), "1.1", 200), None)
    assert log_safe.SecretPathFilter().filter(record) is True
    line = record.getMessage()
    assert token not in line and "/api/calendar/personal/***" in line
    # Gegenprobe: andere Adressen bleiben, wie sie sind.
    other = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                              ("10.0.0.1:5000", "GET", "/api/calendar/feed.ics", "1.1", 200), None)
    log_safe.SecretPathFilter().filter(other)
    assert "/api/calendar/feed.ics" in other.getMessage()
    # Der Filter hängt am Zugriffsprotokoll der laufenden Anwendung.
    from flow_harness import load_application

    load_application()
    assert any(isinstance(item, log_safe.SecretPathFilter) for item in logging.getLogger("uvicorn.access").filters)


def test_nginx_writes_no_access_log_for_the_personal_feed():
    nginx = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    start = nginx.index("location ~ ^/api/calendar/personal/")
    block = nginx[start:nginx.index("}", start)]
    assert "access_log off;" in block and "proxy_pass http://backend:8001;" in block


@pytest.mark.asyncio
async def test_without_a_session_the_lead_exception_does_not_apply(flow):
    """Die Turnierleitung sieht „Nur Mitglieder“ nur mit bestätigter Zwei-Faktor-Anmeldung - der Link hat keine."""
    lead = await flow.add_user(role="tournament_admin", name="leitung")
    await flow.db.events.insert_one({"id": "e-members", "slug": "vereinsabend", "name": "Vereinsabend", "status": "scheduled",
                                     "visibility": "members", "start_date": _at(12)})
    await flow.db.event_registrations.insert_one({"id": "er-1", "event_id": "e-members", "user_id": lead["id"], "status": "registered"})
    flow.act_as(lead)
    assert any(item["id"] == "e-members" for item in (await flow.get("/api/calendar")).json()["items"]), "mit Sitzung und 2FA sichtbar"
    path = (await flow.post("/api/calendar/personal")).json()["path"]
    flow.act_as(None)
    assert "Vereinsabend" not in (await flow.get(path)).text


@pytest.mark.asyncio
async def test_cancelled_and_internal_never_reach_the_link_even_for_club_admins(flow):
    """Codex-Prüfung #1473: der Link wirkt ohne Sitzung - Abgesagtes und „Nur intern“ gehören nie hinein, egal mit welcher
    Rolle. In der Liste mit Sitzung sieht die Vereinsverwaltung den internen Termin weiter."""
    admin = await flow.add_user(role="club_admin", name="verwaltung")
    await flow.db.events.insert_many([
        {"id": "e-ok", "slug": "lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public", "start_date": _at(10)},
        {"id": "e-intern", "slug": "klausur", "name": "Vorstandsklausur", "status": "scheduled", "visibility": "internal", "start_date": _at(11)},
        {"id": "e-abgesagt", "slug": "grillabend", "name": "Grillabend", "status": "cancelled", "visibility": "public", "start_date": _at(12)},
    ])
    await flow.db.tournaments.insert_one({"id": "t-abgesagt", "slug": "abgesagter-cup", "title": "Abgesagter Cup", "status": "cancelled",
                                          "visibility": "public", "is_public": True, "start_date": _at(13)})
    await flow.db.event_registrations.insert_many([
        {"id": f"er-{event_id}", "event_id": event_id, "user_id": admin["id"], "status": "registered"} for event_id in ("e-ok", "e-intern", "e-abgesagt")
    ])
    await flow.db.tournament_registrations.insert_one({"id": "tr-1", "tournament_id": "t-abgesagt", "user_id": admin["id"], "status": "approved"})

    flow.act_as(admin)
    listed = {item["id"] for item in (await flow.get("/api/calendar")).json()["items"] if item["mine"]}
    assert {"e-ok", "e-intern"} <= listed, "mit Sitzung sieht die Verwaltung ihren internen Termin"
    path = (await flow.post("/api/calendar/personal")).json()["path"]

    flow.act_as(None)
    text = (await flow.get(path)).text
    assert "Herbst-LAN" in text, "Gegenprobe: der eigene öffentliche Termin steht drin"
    for hidden in ("Vorstandsklausur", "Grillabend", "Abgesagter Cup"):
        assert hidden not in text, f"{hidden} gehört nicht in den Link"
