"""Erreichbarkeit (#1657): Website, API und Datenbank im Takt prüfen, Ausfall und Wiederkehr je einmal melden, die
öffentliche Statusseite schaltet zwischen „Alles läuft“ und „Störung“ um - ohne Einzelheiten."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from flow_harness import make_flow  # noqa: E402

from models import now_utc  # noqa: E402
from services import ops_alerts, ops_reachability  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_memory():
    """Der Stand im Speicher gehört zum Prozess - jeder Test beginnt wie ein frisch gestarteter Server."""
    ops_reachability._memory.clear()
    yield
    ops_reachability._memory.clear()


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest_asyncio.fixture
async def discord_recorder(monkeypatch):
    import discord_service

    calls = []

    async def fake_send(title, description="", **kwargs):
        calls.append({"title": title, "description": description, **kwargs})
        return {"ok": True, "status_code": 204}

    monkeypatch.setattr(discord_service, "send_ops_discord", fake_send)
    return calls


class Switch:
    """Eine Prüfung, die man von außen auf „antwortet“ oder „antwortet nicht“ stellt."""

    def __init__(self):
        self.up = True

    async def __call__(self) -> bool:
        return self.up


def probes(web, api=None, database=None):
    async def fine():
        return True

    return {"web": web, "api": api or fine, "database": database or fine}


async def status(flow) -> dict:
    response = await flow.client.get("/api/ops/status")
    assert response.status_code == 200
    assert response.headers.get("cache-control") == "no-store"
    return response.json()


def reach_calls(calls):
    return [call for call in calls if call.get("event_key") == "ops_reachability"]


@pytest.mark.asyncio
async def test_an_outage_and_the_return_are_reported_once_each_and_switch_the_status_page(flow, discord_recorder):
    web = Switch()
    await ops_reachability.run_reachability(flow.db, probes(web))
    assert (await status(flow))["state"] == "ok"

    web.up = False
    await ops_reachability.run_reachability(flow.db, probes(web))
    assert reach_calls(discord_recorder) == [], "ein einzelner Fehlversuch ist noch kein Ausfall (Vorgabe: 2)"
    assert (await status(flow))["state"] == "ok"

    await ops_reachability.run_reachability(flow.db, probes(web))
    await ops_reachability.run_reachability(flow.db, probes(web))
    down = reach_calls(discord_recorder)
    assert len(down) == 1 and down[0]["title"] == "Betrieb: Website nicht erreichbar"
    public = await status(flow)
    assert public["state"] == "disturbance"
    assert set(public) == {"state", "checked_at"}, "die Statusseite bekommt keine Einzelheiten"

    web.up = True
    await ops_reachability.run_reachability(flow.db, probes(web))
    await ops_reachability.run_reachability(flow.db, probes(web))
    calls = reach_calls(discord_recorder)
    assert [call["title"] for call in calls] == ["Betrieb: Website nicht erreichbar", "Betrieb: Website wieder erreichbar"]
    assert (await status(flow))["state"] == "ok"
    rows = [row for row in await ops_alerts.recent_alerts(flow.db) if row["kind"] == "reachability"]
    assert len(rows) == 2 and all(row.get("resolved_at") for row in rows), "mit der Wiederkehr gilt der Ausfall als behoben"


@pytest.mark.asyncio
async def test_a_probe_that_raises_counts_as_down_and_the_threshold_is_a_setting(flow, discord_recorder):
    await ops_alerts.save_alert_settings(flow.db, {"reach_fail_threshold": 1})

    async def broken():
        raise RuntimeError("Datenbank weg")

    await ops_reachability.run_reachability(flow.db, probes(Switch(), database=broken))
    assert [call["title"] for call in reach_calls(discord_recorder)] == ["Betrieb: Datenbank nicht erreichbar"]
    assert (await status(flow))["state"] == "disturbance"


@pytest.mark.asyncio
async def test_a_target_without_address_is_not_checked(flow, discord_recorder):
    await ops_reachability.run_reachability(flow.db, {"web": None, "api": None, "database": Switch()})
    state = await flow.db.settings.find_one({"id": ops_reachability.STATE_ID}, {"_id": 0})
    assert state["targets"]["web"]["state"] == "unchecked"
    assert (await status(flow))["state"] == "ok"


@pytest.mark.asyncio
async def test_a_stale_or_unreadable_state_shows_a_disturbance(flow, monkeypatch):
    assert (await status(flow))["state"] == "ok", "nie geprüft (frische Installation): kein Alarm auf der Statusseite"
    await ops_reachability.run_reachability(flow.db, probes(Switch()))
    old = (now_utc() - timedelta(minutes=ops_reachability.STALE_MINUTES + 5)).isoformat()
    await flow.db.settings.update_one({"id": ops_reachability.STATE_ID}, {"$set": {"checked_at": old}})
    assert (await status(flow))["state"] == "disturbance", "prüft niemand mehr, ist etwas faul"

    async def broken_find(*args, **kwargs):
        raise RuntimeError("keine Datenbank")

    monkeypatch.setattr(ops_reachability, "_load_state", broken_find)
    assert (await status(flow))["state"] == "disturbance"


@pytest.mark.asyncio
async def test_a_failed_notice_is_sent_on_the_next_run(flow, discord_recorder, monkeypatch):
    await ops_alerts.save_alert_settings(flow.db, {"reach_fail_threshold": 1})
    web = Switch()
    web.up = False
    real_notify = ops_alerts.notify
    attempts = {"n": 0}

    async def flaky_notify(*args, **kwargs):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise RuntimeError("Datenbank kurz weg")
        return await real_notify(*args, **kwargs)

    monkeypatch.setattr(ops_alerts, "notify", flaky_notify)
    await ops_reachability.run_reachability(flow.db, probes(web))
    assert reach_calls(discord_recorder) == []
    await ops_reachability.run_reachability(flow.db, probes(web))
    await ops_reachability.run_reachability(flow.db, probes(web))
    assert [call["title"] for call in reach_calls(discord_recorder)] == ["Betrieb: Website nicht erreichbar"]


@pytest.mark.asyncio
async def test_without_any_way_set_up_nothing_is_retried_every_minute(flow, discord_recorder):
    await ops_alerts.save_alert_settings(flow.db, {"reach_fail_threshold": 1, "rules": {"reachability": {"discord": False, "email": False}}})
    web = Switch()
    web.up = False
    for _ in range(4):
        await ops_reachability.run_reachability(flow.db, probes(web))
    rows = [row for row in await ops_alerts.recent_alerts(flow.db) if row["kind"] == "reachability"]
    assert len(rows) == 1, "einmal im Verlauf, dann still"
    assert (await status(flow))["state"] == "disturbance", "die Statusseite schaltet auch ohne Meldeweg"


@pytest.mark.asyncio
async def test_without_a_readable_state_the_run_keeps_its_own_memory(flow, discord_recorder, monkeypatch):
    await ops_alerts.save_alert_settings(flow.db, {"reach_fail_threshold": 2})
    web = Switch()
    web.up = False
    await ops_reachability.run_reachability(flow.db, probes(web))

    async def unreadable(db):
        raise RuntimeError("keine Datenbank")

    monkeypatch.setattr(ops_reachability, "_load_state", unreadable)
    state = await ops_reachability.run_reachability(flow.db, probes(web))
    assert state["targets"]["web"]["state"] == "down", "der zweite Fehlversuch zählt, obwohl der Stand nicht lesbar war"


@pytest.mark.asyncio
async def test_a_database_outage_is_reported_when_the_database_is_back(flow, discord_recorder, monkeypatch):
    """Ohne Datenbank kann nichts gemeldet und nichts gespeichert werden. Der Stand im Speicher trägt den Ausfall, und mit
    der Wiederkehr kommt eine Meldung, die sagt, seit wann sie weg war."""
    await ops_reachability.run_reachability(flow.db, probes(Switch()))
    database = Switch()
    database.up = False

    async def gone(*args, **kwargs):
        raise RuntimeError("keine Datenbank")

    with monkeypatch.context() as outage:
        outage.setattr(ops_reachability, "_load_state", gone)
        outage.setattr(ops_reachability, "_save_state", gone)
        outage.setattr(ops_alerts, "notify", gone)
        for _ in range(3):
            await ops_reachability.run_reachability(flow.db, probes(Switch(), database=database))
    assert reach_calls(discord_recorder) == []

    database.up = True
    await ops_reachability.run_reachability(flow.db, probes(Switch(), database=database))
    calls = reach_calls(discord_recorder)
    assert [call["title"] for call in calls] == ["Betrieb: Datenbank wieder erreichbar"]
    assert "Ausfall seit" in calls[0]["description"]
    assert (await status(flow))["state"] == "ok"
