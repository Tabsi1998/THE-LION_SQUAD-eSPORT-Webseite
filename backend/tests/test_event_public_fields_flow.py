"""Öffentliche Event-Antworten (#2127): Startseite, Event-Liste, Event-Seite und das Event am Turnier tragen nur, was
Website und App brauchen. Die Preisangabe für das Formular bleibt; die Verwaltung sieht weiter alles. Namen sind erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services.event_public import INTERNAL_EVENT_FIELDS, public_event  # noqa: E402

PAID = {"enabled": True, "positions": [{"key": "eintritt", "label": "Eintritt", "amount_cents": 1000, "basis": "per_person",
                                        "dolibarr_product_id": 7}]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def stored_event(flow, **extra):
    """Ein Event im Stand der Datenbank - mit allem, was Verwaltung und Hintergrund-Jobs daran schreiben."""
    start = now_utc() + timedelta(hours=1)
    doc = {
        "id": "ev-1", "slug": "herbst-lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public", "event_type": "lan_party",
        "start_date": start.isoformat(), "end_date": (start + timedelta(hours=5)).isoformat(), "has_registration": True, "billing": PAID,
        "created_by": "leitung-1", "newsletter_sent_at": "2026-01-01T10:00:00+00:00", "newsletter_sent_count": 12,
        "discord_checked_at": "2026-01-01T10:00:00+00:00", "discord_outcome": "sent", "members_notified_at": "2026-01-01T10:00:00+00:00",
        "members_notified_count": 3, "slug_history": ["alte-adresse"], "cancel_round": 1, **extra,
    }
    await flow.db.events.insert_one(dict(doc))
    return doc


def assert_clean(row):
    assert INTERNAL_EVENT_FIELDS.isdisjoint(row), sorted(INTERNAL_EVENT_FIELDS & set(row))
    assert "billing" not in row


@pytest.mark.asyncio
async def test_gast_sieht_kein_created_by_und_keine_internen_felder(flow):
    await stored_event(flow)
    flow.act_as(None)

    state = (await flow.get("/api/home/state")).json()
    rows = [row for group in ("live", "today", "soon", "upcoming") for row in state[group]["events"]]
    assert rows, "das Event steht heute und demnächst auf der Startseite"
    for row in rows:
        assert_clean(row)
        assert row["name"] == "Herbst-LAN" and row["public_phase"] and "schedule" in row
        assert row["offer"]["positions"][0]["amount_cents"] == 1000
        assert "dolibarr_product_id" not in row["offer"]["positions"][0]

    listed = (await flow.get("/api/events")).json()
    assert_clean(listed[0])
    assert listed[0]["offer"]["enabled"] is True and listed[0]["slug"] == "herbst-lan"

    detail = (await flow.get("/api/events/herbst-lan")).json()
    assert_clean(detail)
    assert detail["offer"]["enabled"] is True and detail["has_registration"] is True


@pytest.mark.asyncio
async def test_event_am_turnier_ohne_interne_felder(flow):
    await stored_event(flow)
    admin = await flow.add_user(role="tournament_admin", name="leitung")
    tournament = await flow.create_tournament(max_participants=4, status="registration_open", event_id="ev-1", is_public=True, visibility="public")
    flow.act_as(None)
    detail = (await flow.get(f"/api/tournaments/{tournament['id']}")).json()
    assert detail["event"]["name"] == "Herbst-LAN"
    assert_clean(detail["event"])
    listed = (await flow.get("/api/tournaments")).json()
    assert_clean(next(row for row in listed if row["id"] == tournament["id"])["event"])
    assert admin


@pytest.mark.asyncio
async def test_verwaltung_sieht_weiter_alles_mitglieder_nicht(flow):
    await stored_event(flow)
    member = await flow.add_user(role="player", name="mitglied")
    flow.act_as(member)
    assert_clean((await flow.get("/api/events/herbst-lan")).json())

    lead = await flow.add_user(role="tournament_admin", name="leitung")
    flow.act_as(lead)
    assert (await flow.get("/api/events/herbst-lan")).json()["created_by"] == "leitung-1"
    managed = (await flow.get("/api/events", params={"include_drafts": "true"})).json()
    assert managed[0]["newsletter_sent_count"] == 12
    # Die öffentliche Liste bleibt auch für sie die öffentliche Fassung.
    assert "created_by" not in (await flow.get("/api/events")).json()[0]


@pytest.mark.asyncio
async def test_oeffentlich_steht_die_warteliste_getrennt(flow):
    """EV10: „Angemeldet“ nennt nur, wer einen Platz hat - auch für die App, die nur `registrations` liest."""
    await stored_event(flow, show_participants=True, max_participants=1, status="registration_open", billing=None)
    first = await flow.add_user(role="player", name="erste")
    second = await flow.add_user(role="player", name="zweite")
    gone = await flow.add_user(role="player", name="dritte")
    for user in (first, second, gone):
        flow.act_as(user)
        assert (await flow.post("/api/events/ev-1/registrations", json={"companion_count": 0})).status_code == 200
    flow.act_as(gone)
    assert (await flow.delete("/api/events/ev-1/registrations/me")).status_code == 200

    flow.act_as(None)
    page = (await flow.get("/api/events/herbst-lan")).json()
    assert [row["user_id"] for row in page["registrations"]] == [first["id"]]
    assert [row["user_id"] for row in page["waitlist_registrations"]] == [second["id"]]

    lead = await flow.add_user(role="tournament_admin", name="leitung")
    flow.act_as(lead)
    managed = (await flow.get("/api/events/herbst-lan")).json()
    assert {row["status"] for row in managed["registrations"]} == {"registered", "waitlist", "cancelled"}
    assert "waitlist_registrations" not in managed


def test_die_uebergebene_fassung_bleibt_unveraendert():
    doc = {"id": "e", "created_by": "x", "billing": PAID}
    view = public_event(doc)
    assert "created_by" in doc and "billing" in doc
    assert "created_by" not in view and "billing" not in view and view["offer"]["enabled"] is True
    assert public_event(doc, keep_internal=True, finance=True)["billing"] == PAID
