"""Tageszusammenfassung (#1657): einmal am Tag ab der eingestellten Stunde (Wiener Zeit), nur wenn etwas war, nie doppelt."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from flow_harness import make_flow  # noqa: E402

from services import ops_alerts, ops_digest  # noqa: E402

# 24.11.2026 09:30 in Wien (UTC+1).
MORNING = datetime(2026, 11, 24, 8, 30, tzinfo=timezone.utc)


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


async def add_group(flow, fingerprint, *, source="web", count=3, first=None, last=None, resolved=False):
    first = first or (MORNING - timedelta(hours=2)).isoformat()
    await flow.db.ops_errors.insert_one({
        "fingerprint": fingerprint, "source": source, "error_type": "TypeError", "route": "/teams/:slug", "method": "",
        "count": count, "first_seen_at": first, "last_seen_at": last or first, "resolved_at": MORNING.isoformat() if resolved else None,
    })


def digests(calls):
    return [call for call in calls if call.get("event_key") == "ops_daily_summary"]


@pytest.mark.asyncio
async def test_a_quiet_day_sends_nothing(flow, discord_recorder):
    outcome = await ops_digest.send_daily_summary(flow.db, now=MORNING)
    assert outcome == {"sent": False, "reason": "quiet"}
    assert digests(discord_recorder) == []


@pytest.mark.asyncio
async def test_the_summary_goes_once_a_day_after_the_hour(flow, discord_recorder):
    await add_group(flow, "neu1", count=7)
    await add_group(flow, "alt1", source="server", count=40, first=(MORNING - timedelta(days=5)).isoformat(), last=(MORNING - timedelta(hours=1)).isoformat())
    await add_group(flow, "ruhig", first=(MORNING - timedelta(days=5)).isoformat())

    early = await ops_digest.send_daily_summary(flow.db, now=MORNING.replace(hour=5))
    assert early == {"sent": False, "reason": "early"}, "06:30 Wiener Zeit liegt vor 8 Uhr"

    first = await ops_digest.send_daily_summary(flow.db, now=MORNING)
    assert first["sent"] is True
    again = await ops_digest.send_daily_summary(flow.db, now=MORNING + timedelta(hours=3))
    assert again == {"sent": False, "reason": "already"}
    sent = digests(discord_recorder)
    assert len(sent) == 1
    assert sent[0]["title"] == "Betrieb: Tageszusammenfassung 24.11.2026"
    text = sent[0]["description"]
    assert "2 Fehlergruppen aktiv" in text and "1 neu" in text
    assert "TypeError auf /teams/:slug (Server)" in text and "40×" in text

    rows = [row for row in await ops_alerts.recent_alerts(flow.db) if row["kind"] == "daily_summary"]
    assert len(rows) == 1 and rows[0].get("resolved_at"), "eine Zusammenfassung ist kein offenes Problem"

    await add_group(flow, "neu2", first=(MORNING + timedelta(hours=20)).isoformat())
    tomorrow = await ops_digest.send_daily_summary(flow.db, now=MORNING + timedelta(days=1))
    assert tomorrow["sent"] is True and len(digests(discord_recorder)) == 2


@pytest.mark.asyncio
async def test_outages_count_and_the_hour_is_a_setting(flow, discord_recorder):
    await ops_alerts.save_alert_settings(flow.db, {"daily_summary_hour": 6})
    await flow.db.ops_alert_log.insert_one({"id": "a1", "kind": "reachability", "key": "reach:web", "title": "Betrieb: Website nicht erreichbar",
                                            "channels": ["discord"], "at": (MORNING - timedelta(hours=3)).isoformat()})
    outcome = await ops_digest.send_daily_summary(flow.db, now=MORNING.replace(hour=5, minute=10))
    assert outcome["sent"] is True
    assert "1 Ausfall" in digests(discord_recorder)[0]["description"]
