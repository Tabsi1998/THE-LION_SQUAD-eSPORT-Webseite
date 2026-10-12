"""Kalender-Ansicht (#1190, #1271): Versammlungen und eigene Helferschichten stehen für Mitglieder in `GET /api/calendar`,
für alle anderen nicht; der Vorstand sieht seine Sitzungen. Ein mehrtägiges Event nennt an jedem Tag seinen Namen, damit
die Liste es zu einer Zeile zusammenfassen kann. Der öffentliche Feed bleibt ohne Vereinstermine."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member, pin_club_clock  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client, dolibarr_identity  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    dolibarr_identity.reset_cache()
    pin_club_clock(monkeypatch)
    return instance


async def connect(flow):
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1, "type_map": {"2": "ordinary"},
    }}, upsert=True)


async def bind(flow, code: str) -> None:
    response = await flow.post("/api/membership/me/identity", json={"code": code})
    assert response.status_code == 200 and response.json()["status"] == "bound", response.text


def club_ids(payload: dict) -> list[str]:
    return [item["id"] for item in payload["items"] if item["kind"] == "club"]


@pytest.mark.asyncio
async def test_member_board_and_others_in_the_calendar(flow, fake):
    await connect(flow)
    fake.add(member(12), email="paula@example.test")
    fake.add(member(99, firstname="Vera", lastname="Vorstand"), email="vera@example.test")
    fake.add_meeting(7, invited=[(12, True), (99, True)])
    fake.add_meeting(8, kind="board", title="Vorstandssitzung Oktober", day="2026-10-01", format="virtual", invited=[(99, True)])
    fake.add_event(5, label="Sommerfest 2026", day="2026-10-10", place="Vereinsheim", visibility="members", registration=("dolibarr", ""), shifts=[
        {"id": 51, "label": "Aufbau", "day": "2026-10-10", "start": "14:00", "end": "16:00", "capacity": 2},
        {"id": 52, "label": "Bar", "day": "2026-10-10", "start": "22:00", "end": "01:00", "capacity": 1},
    ])
    fake.request_shift(5, 52, 12)
    fake.invite("PAULA", 12, capabilities=("documents", "meetings", "events"))
    fake.invite("VERA", 99, capabilities=("documents", "meetings", "events"))

    flow.act_as(None)
    guest = (await flow.get("/api/calendar")).json()
    assert club_ids(guest) == [], "Gäste sehen keine Vereinstermine"

    otto = await flow.add_user(role="player", name="otto")
    flow.act_as(otto)
    assert club_ids((await flow.get("/api/calendar")).json()) == [], "ohne Weg zur Vereinsakte keine Vereinstermine"

    paula = await flow.add_user(role="player", name="paula")
    paula["is_club_member"] = True
    flow.act_as(paula)
    await bind(flow, "PAULA")
    payload = (await flow.get("/api/calendar")).json()
    assert sorted(club_ids(payload)) == ["meeting-7", "shift-5-52"], "eigene Versammlung und eigene Schicht, nicht die freie, nicht die des Vorstands"
    by_id = {item["id"]: item for item in payload["items"]}
    meeting, shift = by_id["meeting-7"], by_id["shift-5-52"]
    assert meeting["club_kind"] == "meeting" and meeting["path"] == "/members/meetings?meeting=7"
    assert meeting["start"].startswith("2026-10-24T16:00:00"), "18 Uhr Wiener Zeit"
    assert shift["club_kind"] == "shift" and shift["path"] == "/members/helfen?event=5" and shift["mine"] is True
    assert shift["start"].startswith("2026-10-10T20:00:00") and shift["end"].startswith("2026-10-10T23:00:00"), "über Mitternacht"
    starts = [item["start"] for item in payload["items"]]
    assert starts == sorted(starts), "Vereinstermine stehen nach Beginn zwischen den anderen"
    for private in ("meet.example.test", "Bericht des Vorstands"):
        assert private not in str(payload), f"{private} gehört nicht in den Kalender"

    vera = await flow.add_user(role="player", name="vera")
    vera["is_club_member"] = True
    flow.act_as(vera)
    await bind(flow, "VERA")
    assert sorted(club_ids((await flow.get("/api/calendar")).json())) == ["meeting-7", "meeting-8"], "der Vorstand sieht seine Sitzungen"

    flow.act_as(None)
    feed = await flow.get("/api/calendar/feed.ics")
    assert feed.status_code == 200 and "Generalversammlung" not in feed.text and "Helferschicht" not in feed.text, "der Abo-Feed bleibt öffentlich"


@pytest.mark.asyncio
async def test_days_of_a_multi_day_event_carry_its_name(flow):
    await flow.db.events.insert_one({
        "id": "e-messe", "slug": "messe", "name": "Gaming-Messe", "status": "scheduled", "visibility": "public",
        "start_date": "2027-03-11T08:00:00+00:00", "end_date": "2027-03-14T17:00:00+00:00",
        "days": [
            {"date": "2027-03-11", "start_at": "2027-03-11T08:00:00+00:00", "end_at": "2027-03-11T17:00:00+00:00"},
            {"date": "2027-03-12", "start_at": "2027-03-12T08:00:00+00:00", "end_at": "2027-03-12T17:00:00+00:00"},
        ],
    })
    flow.act_as(None)
    items = [item for item in (await flow.get("/api/calendar")).json()["items"] if item["kind"] == "event"]
    assert [item["title"] for item in items] == ["Gaming-Messe – Tag 1/2", "Gaming-Messe – Tag 2/2"]
    assert {item["event_id"] for item in items} == {"e-messe"} and {item["event_name"] for item in items} == {"Gaming-Messe"}


@pytest.mark.asyncio
async def test_personal_calendar_stays_out_of_caches_public_one_may_be_cached(flow):
    """Codex-Prüfung #1460: mit Login trägt die Liste Persönliches - nie zwischenspeichern; ohne Login ist sie für alle gleich."""
    flow.act_as(None)
    public = await flow.get("/api/calendar")
    assert public.status_code == 200 and public.headers["cache-control"] == "public, max-age=60"
    assert "Cookie" in public.headers["vary"] and "Authorization" in public.headers["vary"]

    paula = await flow.add_user(role="player", name="paula")
    flow.act_as(paula)
    personal = await flow.get("/api/calendar")
    assert personal.status_code == 200 and personal.headers["cache-control"] == "private, no-store"

    flow.act_as(None)
    missing = await flow.get("/api/calendar/events/gibt-es-nicht.ics")
    assert missing.status_code == 404 and missing.headers["cache-control"] == "no-store", "Fehler ohne eigene Regel: no-store"


@pytest.mark.asyncio
async def test_meetings_and_shifts_are_asked_at_once_and_one_failure_keeps_the_other(monkeypatch):
    """Codex-Prüfung #1460: Sitzungen und Schichten werden gleichzeitig abgefragt; fällt einer aus, kommt der andere."""
    import asyncio

    from services import club_calendar, dolibarr_helper_shifts, dolibarr_meetings

    shifts_asked = asyncio.Event()
    shift_view = {"events": [{"id": 5, "label": "Sommerfest", "day": "2026-10-10", "shifts": [
        {"id": 52, "label": "Bar", "day": "2026-10-10", "start": "22:00", "end": "01:00", "mine": "requested"}]}]}

    seen: list[bool] = []

    async def meetings(db, user):
        # Wartet auf die Schicht-Abfrage - nacheinander gefragt, käme sie nicht rechtzeitig.
        try:
            await asyncio.wait_for(shifts_asked.wait(), timeout=1)
        except asyncio.TimeoutError:
            pass
        seen.append(shifts_asked.is_set())
        raise RuntimeError("Vereinsmodul antwortet nicht")

    async def shifts(db, user):
        shifts_asked.set()
        return shift_view

    monkeypatch.setattr(dolibarr_meetings, "overview", meetings)
    monkeypatch.setattr(dolibarr_helper_shifts, "overview", shifts)
    items = await club_calendar.club_items(None, {"id": "u-paula"})
    assert seen == [True], "beide Abfragen laufen gleichzeitig"
    assert [item["id"] for item in items] == ["shift-5-52"], "ohne Sitzungen kommen die Schichten trotzdem"
