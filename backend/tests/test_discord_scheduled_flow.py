"""Discord-Termine (#570): je Event und Turnier genau ein Termin - angelegt, bei Änderung bearbeitet, bei
Absage abgesagt; interne nur mit Schalter; „Ohne Discord“ gilt; Vorschau im Formular - mit nachgestelltem Bot."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_bot, discord_scheduled  # noqa: E402

TOKEN = "test" * 6 + ".fake." + "token" * 8


class FakeBot:
    def __init__(self):
        self.events: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.counter = 0

    async def create_scheduled_event(self, payload):
        self.counter += 1
        event_id = f"ev{self.counter}"
        self.events[event_id] = dict(payload, status="scheduled")
        self.calls.append(("create", event_id))
        return {"ok": True, "event_id": event_id}

    async def edit_scheduled_event(self, event_id, payload):
        self.calls.append(("edit", event_id))
        if event_id not in self.events:
            return {"ok": False, "reason": "unknown_event"}
        self.events[event_id].update(payload)
        return {"ok": True, "event_id": event_id}

    async def cancel_scheduled_event(self, event_id):
        self.calls.append(("cancel", event_id))
        if event_id not in self.events:
            return {"ok": False, "reason": "unknown_event"}
        self.events[event_id]["status"] = "cancelled"
        return {"ok": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def bot(monkeypatch):
    fake = FakeBot()
    for name in ("create_scheduled_event", "edit_scheduled_event", "cancel_scheduled_event"):
        monkeypatch.setattr(discord_bot.bot, name, getattr(fake, name))

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    return fake


def _at(days: float, hour: int = 18):
    return (now_utc() + timedelta(days=days)).replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


async def configure(flow, **scheduled):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "scheduled_events": {"enabled": True, **scheduled}})
    assert response.status_code == 200, response.text
    return admin


def test_payload_and_rules_are_pure():
    now = now_utc()
    event = {"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public", "start_date": _at(3), "location": "Vereinsheim", "city": "Telfs",
             "short_description": "<p>Zwei Tage <b>zocken</b></p>"}
    payload = discord_scheduled.scheduled_payload("event", event, "https://lionsquad.at", now)
    assert payload["name"] == "LAN-Party" and payload["location"] == "Vereinsheim, Telfs" and payload["description"].startswith("Zwei Tage zocken\n\nhttps://lionsquad.at/events/lan")
    assert discord_scheduled._dt(payload["end"]) - discord_scheduled._dt(payload["start"]) == timedelta(hours=2), "ohne Ende zwei Stunden"
    tournament = {"id": "t1", "slug": "cup", "title": "Sommer-Cup", "status": "registration_open", "start_date": _at(5)}
    t_payload = discord_scheduled.scheduled_payload("tournament", tournament, "https://lionsquad.at", now)
    assert t_payload["location"] == "https://lionsquad.at/tournaments/cup" and discord_scheduled._dt(t_payload["end"]) - discord_scheduled._dt(t_payload["start"]) == timedelta(hours=4)
    assert discord_scheduled.payload_hash(payload) == discord_scheduled.payload_hash(dict(payload)) != discord_scheduled.payload_hash(t_payload)
    assert discord_scheduled.scheduled_payload("event", {"id": "x"}, "https://lionsquad.at") is None

    cfg = {"enabled": True, "internal": False}
    assert discord_scheduled.wants_event("event", event, cfg, now) == (True, None)
    assert discord_scheduled.wants_event("event", event, {"enabled": False}, now) == (False, "disabled")
    assert discord_scheduled.wants_event("event", {**event, "discord_skip": True}, cfg, now) == (False, "author_opt_out")
    assert discord_scheduled.wants_event("event", {**event, "status": "cancelled"}, cfg, now) == (False, "status")
    assert discord_scheduled.wants_event("event", {**event, "visibility": "members"}, cfg, now) == (False, "not_public")
    assert discord_scheduled.wants_event("event", {**event, "visibility": "members"}, {"enabled": True, "internal": True}, now) == (True, None)
    assert discord_scheduled.wants_event("tournament", {**tournament, "is_public": False}, {"enabled": True, "internal": True}, now) == (False, "hidden")
    assert discord_scheduled.wants_event("event", {**event, "start_date": _at(-1)}, cfg, now) == (False, "past")


@pytest.mark.asyncio
async def test_sync_creates_edits_and_cancels_exactly_one_event_each(flow, bot):
    await configure(flow)
    await flow.db.events.insert_many([
        {"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public", "start_date": _at(3), "location": "Vereinsheim"},
        {"id": "e2", "slug": "intern", "name": "Vorstandssitzung", "status": "scheduled", "visibility": "internal", "start_date": _at(4)},
        {"id": "e3", "slug": "skip", "name": "Ohne Discord", "status": "scheduled", "visibility": "public", "start_date": _at(5), "discord_skip": True},
        {"id": "e4", "slug": "alt", "name": "Vorbei", "status": "scheduled", "visibility": "public", "start_date": _at(-2)},
        {"id": "e5", "slug": "entwurf", "name": "Entwurf", "status": "draft", "visibility": "public", "start_date": _at(6)},
    ])
    await flow.db.tournaments.insert_many([
        {"id": "t1", "slug": "cup", "title": "Sommer-Cup", "status": "registration_open", "visibility": "public", "is_public": True, "start_date": _at(7, 19)},
        {"id": "t2", "slug": "geheim", "title": "Geheim", "status": "registration_open", "is_public": False, "start_date": _at(8)},
    ])
    first = await discord_scheduled.sync(flow.db)
    assert first["created"] == 2 and first["updated"] == 0 and first["cancelled"] == 0 and first["errors"] == 0, first
    assert sorted(bot.events[e]["name"] for e in bot.events) == ["LAN-Party", "Sommer-Cup"]
    lan = await flow.db.events.find_one({"id": "e1"}, {"_id": 0})
    assert lan["discord_scheduled_event"]["id"] == "ev1" and lan["discord_scheduled_event"]["hash"]
    assert "discord_scheduled_event" not in await flow.db.events.find_one({"id": "e2"}, {"_id": 0}), "intern ohne Schalter: kein Termin"

    again = await discord_scheduled.sync(flow.db)
    assert again["created"] == 0 and again["updated"] == 0 and len(bot.calls) == 2, "kein Doppel, kein Aufruf ohne Änderung"

    await flow.db.events.update_one({"id": "e1"}, {"$set": {"start_date": _at(3, 20), "name": "LAN-Party (neu)"}})
    edited = await discord_scheduled.sync(flow.db)
    assert edited["updated"] == 1 and bot.calls[-1] == ("edit", "ev1") and bot.events["ev1"]["name"] == "LAN-Party (neu)"

    await flow.db.events.update_one({"id": "e1"}, {"$set": {"status": "cancelled"}})
    cancelled = await discord_scheduled.sync(flow.db)
    assert cancelled["cancelled"] == 1 and bot.events["ev1"]["status"] == "cancelled"
    stored = (await flow.db.events.find_one({"id": "e1"}, {"_id": 0}))["discord_scheduled_event"]
    assert stored["cancelled_at"] and stored["cancel_reason"] == "status"
    assert (await discord_scheduled.sync(flow.db))["cancelled"] == 0, "einmal absagen reicht"

    # Manuell im Discord gelöscht: beim nächsten Abgleich neu angelegt, solange das Turnier ansteht.
    del bot.events["ev2"]
    await flow.db.tournaments.update_one({"id": "t1"}, {"$set": {"title": "Sommer-Cup 2026"}})
    recreated = await discord_scheduled.sync(flow.db)
    assert recreated["created"] == 1 and bot.calls[-2:] == [("edit", "ev2"), ("create", "ev3")]
    assert (await flow.db.tournaments.find_one({"id": "t1"}, {"_id": 0}))["discord_scheduled_event"]["id"] == "ev3"

    # Schalter „auch interne“: die Vorstandssitzung bekommt einen Termin.
    await flow.put("/api/settings/discord", json={"scheduled_events": {"internal": True}})
    assert (await discord_scheduled.sync(flow.db))["created"] == 1 and bot.events["ev4"]["name"] == "Vorstandssitzung"

    status = (await flow.get("/api/settings/discord")).json()["scheduled_events"]
    assert status["enabled"] is True and status["internal"] is True and status["active"] == 2 and status["last_result"]["created"] == 1


@pytest.mark.asyncio
async def test_disabled_switch_and_preview_in_the_form(flow, bot):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    assert (await discord_scheduled.sync(flow.db))["skipped"] == "disabled"
    assert (await flow.put("/api/settings/discord", json={"scheduled_events": {"enabled": "ja"}})).status_code == 422, "kein Wahrheitswert: das Modell lehnt ab"
    assert (await flow.put("/api/settings/discord", json={"scheduled_events": {"unbekannt": True}})).status_code == 400

    item = {"name": "LAN-Party", "status": "scheduled", "visibility": "public", "start_date": _at(3), "location": "Vereinsheim", "slug": "lan"}
    off = (await flow.post("/api/settings/discord/preview", json={"kind": "event", "item": item})).json()
    assert off["scheduled_event"]["would_create"] is False and off["scheduled_event"]["reason"] == "disabled"

    await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True, "scheduled_events": {"enabled": True}})
    on = (await flow.post("/api/settings/discord/preview", json={"kind": "event", "item": item})).json()
    assert on["scheduled_event"]["would_create"] is True and on["scheduled_event"]["payload"]["name"] == "LAN-Party" and on["scheduled_event"]["payload"]["location"] == "Vereinsheim"
    skipped = (await flow.post("/api/settings/discord/preview", json={"kind": "event", "item": {**item, "discord_skip": True}})).json()
    assert skipped["scheduled_event"]["reason"] == "author_opt_out" and "Ohne Discord" in skipped["scheduled_event"]["reason_text"]
    news = (await flow.post("/api/settings/discord/preview", json={"kind": "news", "item": {"title": "x"}})).json()
    assert news.get("scheduled_event") is None
