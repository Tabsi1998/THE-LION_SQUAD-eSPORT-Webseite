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
from services import discord_bot, discord_guilds, discord_scheduled  # noqa: E402

TOKEN = "test" * 6 + ".fake." + "token" * 8
MAIN, COD = "600000000000000001", "600000000000000002"
ALL = {key: True for key, _, _ in discord_guilds.PERMISSIONS}


class FakeBot:
    """Termine je Server (#628): ``guild`` None ist der Hauptserver. Bearbeiten und Absagen finden einen Termin nur auf
    dem Server, auf dem er angelegt wurde - so fällt auf, wenn der Abgleich den falschen Server nennt."""

    def __init__(self):
        self.events: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.counter = 0
        self.forbidden: set = set()

    async def create_scheduled_event(self, payload, guild_id=None):
        if guild_id in self.forbidden:
            self.calls.append(("forbidden", str(guild_id)))
            return {"ok": False, "reason": "forbidden", "error": "Der Bot darf keine Termine anlegen."}
        self.counter += 1
        event_id = f"ev{self.counter}"
        self.events[event_id] = dict(payload, status="scheduled", guild=guild_id)
        self.calls.append(("create", event_id))
        return {"ok": True, "event_id": event_id}

    async def edit_scheduled_event(self, event_id, payload, guild_id=None):
        self.calls.append(("edit", event_id))
        if event_id not in self.events or self.events[event_id]["guild"] != guild_id:
            return {"ok": False, "reason": "unknown_event"}
        self.events[event_id].update(payload)
        return {"ok": True, "event_id": event_id}

    async def cancel_scheduled_event(self, event_id, guild_id=None):
        self.calls.append(("cancel", event_id))
        if event_id not in self.events or self.events[event_id]["guild"] != guild_id:
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


def seen(guild_id, name):
    return {"guild_id": guild_id, "name": name, "icon_url": None, "member_count": 10, "bot_permissions": dict(ALL)}


def on(bot, guild):
    """Was auf diesem Server als Termin steht (None = Hauptserver)."""
    return sorted(event["name"] for event in bot.events.values() if event["guild"] == guild and event["status"] == "scheduled")


async def game_server(flow):
    """Hauptserver LION und ein eingeschalteter CoD-Server; Call of Duty gehört dorthin, Schach hat keinen eigenen."""
    db = flow.db
    await discord_guilds.reconcile(db, [seen(MAIN, "LION"), seen(COD, "CoD-Server")], configured_main=MAIN)
    await discord_guilds.update_guild(db, COD, {"enabled": True})
    await db.games.insert_many([{"id": "g-cod", "name": "Call of Duty", "discord_guild_id": COD}, {"id": "g-chess", "name": "Schach"}])


@pytest.mark.asyncio
async def test_game_server_gets_its_tournaments_and_main_mirrors_them_until_switched_off(flow, bot):
    """#628: Ein Turnier mit eigenem Spielserver steht dort als Termin - und, solange „Termine auch am Hauptserver“ an
    ist, auch am Hauptserver. Änderung und Absage gehen an beide; ohne eigenen Server nur der Hauptserver."""
    await configure(flow)
    await game_server(flow)
    db = flow.db
    await db.tournaments.insert_many([
        {"id": "t-cod", "slug": "cod-cup", "title": "CoD-Cup", "game_id": "g-cod", "status": "registration_open", "visibility": "public", "is_public": True,
         "start_date": _at(4)},
        {"id": "t-chess", "slug": "schach", "title": "Schach-Abend", "game_id": "g-chess", "status": "registration_open", "visibility": "public", "is_public": True,
         "start_date": _at(5)},
    ])
    await db.events.insert_one({"id": "e1", "slug": "lan", "name": "LAN-Party", "status": "scheduled", "visibility": "public", "start_date": _at(3)})

    first = await discord_scheduled.sync(db)
    assert first["created"] == 4 and first["errors"] == 0, first
    assert on(bot, None) == ["CoD-Cup", "LAN-Party", "Schach-Abend"] and on(bot, COD) == ["CoD-Cup"]
    assert (await discord_scheduled.sync(db))["created"] == 0, "kein Doppel"

    await db.tournaments.update_one({"id": "t-cod"}, {"$set": {"title": "CoD-Cup 2026"}})
    edited = await discord_scheduled.sync(db)
    assert edited["updated"] == 2 and edited["created"] == 0 and "CoD-Cup 2026" in on(bot, None) and on(bot, COD) == ["CoD-Cup 2026"]

    # „Termine auch am Hauptserver“ aus: dort abgesagt, am Spielserver bleibt er.
    assert (await flow.patch(f"/api/settings/discord/guilds/{COD}", json={"mirror_events": False})).status_code == 200
    mirror_off = await discord_scheduled.sync(db)
    assert mirror_off["cancelled"] == 1 and on(bot, None) == ["LAN-Party", "Schach-Abend"] and on(bot, COD) == ["CoD-Cup 2026"]
    stored = await db.tournaments.find_one({"id": "t-cod"}, {"_id": 0})
    assert stored["discord_scheduled_event"]["cancel_reason"] == "mirror_off" and stored["discord_scheduled_guilds"][COD]["cancelled_at"] is None
    status = (await flow.get("/api/settings/discord")).json()["scheduled_events"]
    assert status["active"] == 2 and status["servers"] == [{"guild_id": COD, "name": "CoD-Server", "active": 1, "mirror_events": False}]

    # Server aus: das Turnier fällt auf den Hauptserver zurück, der Termin am Spielserver wird abgesagt.
    await discord_guilds.update_guild(db, COD, {"enabled": False})
    moved = await discord_scheduled.sync(db)
    assert moved["created"] == 1 and moved["cancelled"] == 1 and "CoD-Cup 2026" in on(bot, None) and on(bot, COD) == []
    assert (await db.tournaments.find_one({"id": "t-cod"}, {"_id": 0}))["discord_scheduled_guilds"][COD]["cancel_reason"] == "moved"

    # Wieder an, Spiegelung an: der Spielserver bekommt ihn neu, am Hauptserver bleibt der eine.
    await discord_guilds.update_guild(db, COD, {"enabled": True, "mirror_events": True})
    back = await discord_scheduled.sync(db)
    assert back["created"] == 1 and back["cancelled"] == 0 and on(bot, None).count("CoD-Cup 2026") == 1 and on(bot, COD) == ["CoD-Cup 2026"]

    # Absage: an beiden Servern, und nur einmal.
    await db.tournaments.update_one({"id": "t-cod"}, {"$set": {"status": "cancelled"}})
    gone = await discord_scheduled.sync(db)
    assert gone["cancelled"] == 2 and "CoD-Cup 2026" not in on(bot, None) and on(bot, COD) == []
    assert (await discord_scheduled.sync(db))["cancelled"] == 0


@pytest.mark.asyncio
async def test_member_tournaments_stay_on_main_and_a_blocked_game_server_does_not_starve_it(flow, bot):
    """Nur-Mitglieder-Turniere (mit „auch interne“) kommen nie auf einen Spielserver. Darf der Bot dort keine Termine
    anlegen, versucht der Lauf es einmal und überspringt den Server dann - der Hauptserver kommt trotzdem dran."""
    await configure(flow, internal=True)
    await game_server(flow)
    db = flow.db
    await db.tournaments.insert_many(
        [{"id": "t-intern", "slug": "vm", "title": "Vereinsmeisterschaft", "game_id": "g-cod", "status": "registration_open", "visibility": "members",
          "is_public": True, "start_date": _at(4)}]
        + [{"id": f"t{i}", "slug": f"abend-{i}", "title": f"CoD-Abend {i}", "game_id": "g-cod", "status": "registration_open", "visibility": "public",
            "is_public": True, "start_date": _at(5 + i)} for i in range(3)])
    bot.forbidden.add(COD)

    result = await discord_scheduled.sync(db)
    assert on(bot, COD) == [] and on(bot, None) == ["CoD-Abend 0", "CoD-Abend 1", "CoD-Abend 2", "Vereinsmeisterschaft"]
    assert [call for call in bot.calls if call[0] == "forbidden"] == [("forbidden", COD)], "einmal versucht, dann übersprungen"
    assert result["created"] == 4 and result["errors"] == 1
    assert "discord_scheduled_guilds" not in await db.tournaments.find_one({"id": "t-intern"}, {"_id": 0})

    bot.forbidden.clear()
    healed = await discord_scheduled.sync(db)
    assert healed["created"] == 3 and on(bot, COD) == ["CoD-Abend 0", "CoD-Abend 1", "CoD-Abend 2"]
    assert (await flow.patch(f"/api/settings/discord/guilds/{MAIN}", json={"mirror_events": False})).status_code == 400, "nur für Unterserver"


@pytest.mark.asyncio
async def test_multi_day_event_gets_one_scheduled_event_per_day(flow, bot):
    """Mehrtägige Events (#884): je Tag ein Termin, keiner für das ganze Event; fällt ein Tag weg, geht nur sein
    Termin; wird das Event wieder eintägig, gehen die Tagestermine und der eine Termin kommt."""
    from services import event_days

    await configure(flow)
    first_day = (now_utc() + timedelta(days=3)).astimezone(event_days.VIENNA).date()
    dates = [(first_day + timedelta(days=i)).isoformat() for i in range(3)]
    days = event_days.normalize_days([{"date": d, "start": "10:00", "end": "22:00"} for d in dates])
    await flow.db.events.insert_one({"id": "e9", "slug": "lan-we", "name": "LAN-Wochenende", "status": "scheduled", "visibility": "public",
                                     "location": "Vereinsheim", "days": days, **event_days.derived_range(days)})

    first = await discord_scheduled.sync(flow.db)
    assert first["created"] == 3 and first["cancelled"] == 0 and first["errors"] == 0, first
    assert sorted(e["name"] for e in bot.events.values()) == ["LAN-Wochenende – Tag 1/3", "LAN-Wochenende – Tag 2/3", "LAN-Wochenende – Tag 3/3"]
    stored = await flow.db.events.find_one({"id": "e9"}, {"_id": 0})
    assert not (stored.get("discord_scheduled_event") or {}).get("id"), "kein Termin für das ganze Event"
    assert sorted(stored["discord_scheduled_days"]) == dates and all(entry["id"] for entry in stored["discord_scheduled_days"].values())
    assert (await discord_scheduled.sync(flow.db))["created"] == 0, "kein Doppel"

    # Die Vorschau im Formular nennt die Tage.
    preview = await discord_scheduled.preview_for(flow.db, "event", stored)
    assert preview["days"] == 3 and len(preview["payloads"]) == 3 and preview["would_create"] is True and preview["existing_id"]
    assert preview["payloads"][2]["name"] == "LAN-Wochenende – Tag 3/3"

    # Ein Tag fällt weg: sein Termin wird abgesagt, die zwei anderen heißen jetzt „Tag 1/2“ und „Tag 2/2“.
    shorter = event_days.normalize_days([{"date": d, "start": "10:00", "end": "22:00"} for d in dates[:2]])
    await flow.db.events.update_one({"id": "e9"}, {"$set": {"days": shorter, **event_days.derived_range(shorter)}})
    cut = await discord_scheduled.sync(flow.db)
    assert cut["cancelled"] == 1 and cut["created"] == 0 and cut["updated"] == 2, cut
    assert sorted(e["name"] for e in bot.events.values() if e["status"] == "scheduled") == ["LAN-Wochenende – Tag 1/2", "LAN-Wochenende – Tag 2/2"]
    stored = await flow.db.events.find_one({"id": "e9"}, {"_id": 0})
    assert stored["discord_scheduled_days"][dates[2]]["cancel_reason"] == "day_removed"
    assert (await discord_scheduled.sync(flow.db))["cancelled"] == 0

    # Wieder eintägig: die Tagestermine gehen, ein Termin für das Event kommt.
    await flow.db.events.update_one({"id": "e9"}, {"$unset": {"days": ""}, "$set": {"start_date": _at(3), "end_date": None}})
    single = await discord_scheduled.sync(flow.db)
    assert single["cancelled"] == 2 and single["created"] == 1, single
    assert [e["name"] for e in bot.events.values() if e["status"] == "scheduled"] == ["LAN-Wochenende"]
    stored = await flow.db.events.find_one({"id": "e9"}, {"_id": 0})
    assert stored["discord_scheduled_event"]["id"] and all(entry["cancelled_at"] for entry in stored["discord_scheduled_days"].values())
