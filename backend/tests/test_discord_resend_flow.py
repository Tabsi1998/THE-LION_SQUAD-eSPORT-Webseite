"""Discord „Erneut senden“ (#2112): atomar von „failed“ auf „resending“ - ein zweiter Klick bekommt 409, keine doppelte
Meldung. Scheitert das Senden, steht die Meldung wieder auf „failed“. Discord selbst ist eine Attrappe."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def failed_entry(flow):
    await flow.db.email_logs.insert_one({"id": "log1", "channel": "discord", "target": "community", "event_key": "news",
                                         "status": "failed", "payload": {"title": "News", "description": "neu"}})
    flow.act_as(await flow.add_user(role="superadmin", name="system"))


@pytest.mark.asyncio
async def test_a_second_click_while_sending_gets_409(flow, monkeypatch):
    import discord_service

    await failed_entry(flow)
    seen = {}

    async def send_to(*_args, **_kwargs):
        seen["status"] = (await flow.db.email_logs.find_one({"id": "log1"}))["status"]
        second = await flow.post("/api/settings/discord/resend/log1")
        seen["second"] = second.status_code
        return {"ok": True}

    monkeypatch.setattr(discord_service, "send_to", send_to)
    response = await flow.post("/api/settings/discord/resend/log1")
    assert response.status_code == 200, response.text
    assert seen == {"status": "resending", "second": 409}
    assert (await flow.db.email_logs.find_one({"id": "log1"}))["status"] == "resent"


@pytest.mark.asyncio
async def test_a_failed_resend_can_be_tried_again(flow, monkeypatch):
    import discord_service

    await failed_entry(flow)
    calls = []

    async def send_to(*_args, **_kwargs):
        calls.append(1)
        return {"ok": False, "reason": "forbidden", "error": "Missing Access"}

    monkeypatch.setattr(discord_service, "send_to", send_to)
    first = await flow.post("/api/settings/discord/resend/log1")
    assert first.status_code == 200 and first.json()["ok"] is False
    assert (await flow.db.email_logs.find_one({"id": "log1"}))["status"] == "failed"
    again = await flow.post("/api/settings/discord/resend/log1")
    assert again.status_code == 200
    assert len(calls) == 2
