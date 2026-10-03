"""Willkommensnachricht (#574) durch die echte Anwendung: Standard aus, Text im Admin mit Vorschau, beim Beitritt
genau eine Direktnachricht je Person mit „Auf der Website anmelden“ und „Konto verknüpfen“; ohne Erlaubnis still
mit Zähler, Bots nie, ein vorübergehender Fehler darf noch einmal. Gemerkt wird nur ein Hash der Kennung."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import discord_bot, discord_welcome  # noqa: E402

TOKEN = "test" * 6 + ".fake." + "token" * 8
NEWCOMER = "300000000000000001"
ADMIN_DISCORD = "300000000000000009"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class Calls(list):
    answers: dict


@pytest.fixture
def dms(monkeypatch):
    calls = Calls()
    answers = {"next": {"ok": True}}

    async def fake_dm(discord_user_id, embed, buttons=None):
        calls.append({"to": discord_user_id, "embed": embed, "buttons": buttons})
        answer = dict(answers["next"])
        return {**answer, "message_id": f"d{len(calls)}"} if answer.get("ok") else answer

    async def fake_apply():
        return True

    monkeypatch.setattr(discord_bot.bot, "send_dm", fake_dm)
    monkeypatch.setattr(discord_bot.bot, "apply_settings", fake_apply)
    calls.answers = answers
    return calls


async def admin(flow):
    user = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(user)
    response = await flow.put("/api/settings/discord", json={"bot_token": TOKEN, "bot_enabled": True})
    assert response.status_code == 200, response.text
    return user


@pytest.mark.asyncio
async def test_off_by_default_with_template_preview_and_validated_text(flow, dms):
    await admin(flow)
    welcome = (await flow.get("/api/settings/discord")).json()["welcome"]
    assert welcome["enabled"] is False and welcome["custom"] is False and welcome["text"] == discord_welcome.DEFAULT_TEXT
    assert welcome["preview"]["embed"]["title"] == "Willkommen bei THE LION SQUAD!"
    assert welcome["preview"]["embed"]["description"].startswith("Hallo Paula, schön, dass du da bist!")
    assert [(b["label"], b["url"].split("://", 1)[-1].split("/", 1)[-1]) for b in welcome["preview"]["buttons"]] == [
        ("Auf der Website anmelden", "register"), ("Konto verknüpfen", "profile?tab=socials")]
    assert welcome["stats"] == {"sent": 0, "dm_closed": 0, "error": 0, "last_at": None}

    # Nichts gesendet, solange der Schalter aus ist.
    assert (await discord_welcome.greet(flow.db, NEWCOMER, "Leon"))["reason"] == "disabled" and dms == []

    saved = await flow.put("/api/settings/discord", json={"welcome": {"enabled": True, "text": "Servus {name}! Schön bei {verein}."}})
    assert saved.status_code == 200, saved.text
    welcome = (await flow.get("/api/settings/discord")).json()["welcome"]
    assert welcome["enabled"] is True and welcome["custom"] is True and welcome["preview"]["embed"]["description"] == "Servus Paula! Schön bei THE LION SQUAD."
    assert (await flow.put("/api/settings/discord", json={"welcome": {"text": "x" * 1501}})).status_code == 400
    assert (await flow.put("/api/settings/discord", json={"welcome": {"channel": "1"}})).status_code == 400
    preview = (await flow.post("/api/settings/discord/welcome/preview", json={"text": "Hey {name} 👋"})).json()
    assert preview["embed"]["description"] == "Hey Paula 👋" and len(preview["buttons"]) == 2

    # Leerer Text heißt wieder Vorlage.
    await flow.put("/api/settings/discord", json={"welcome": {"text": ""}})
    assert (await flow.get("/api/settings/discord")).json()["welcome"]["custom"] is False

    flow.act_as(await flow.add_user(role="player", name="paula"))
    assert (await flow.post("/api/settings/discord/welcome/preview", json={})).status_code in (401, 403)
    assert (await flow.put("/api/settings/discord", json={"welcome": {"enabled": False}})).status_code in (401, 403)


@pytest.mark.asyncio
async def test_one_message_per_person_bots_never_and_closed_dms_stay_quiet(flow, dms):
    await admin(flow)
    await flow.put("/api/settings/discord", json={"welcome": {"enabled": True}})

    first = await discord_welcome.greet(flow.db, NEWCOMER, "Leon")
    assert first == {"ok": True, "reason": None} and dms[0]["to"] == NEWCOMER
    assert dms[0]["embed"]["description"].startswith("Hallo Leon,") and [b["label"] for b in dms[0]["buttons"]] == ["Auf der Website anmelden", "Konto verknüpfen"]
    assert (await discord_welcome.greet(flow.db, NEWCOMER, "Leon"))["reason"] == "already_greeted" and len(dms) == 1, "einmal je Person"
    assert (await discord_welcome.greet(flow.db, "300000000000000002", "Helfer-Bot", is_bot=True))["reason"] == "bot_account" and len(dms) == 1

    # Direktnachrichten zu: kein Fehler, nur der Zähler - und nie wieder.
    dms.answers["next"] = {"ok": False, "reason": "forbidden"}
    assert (await discord_welcome.greet(flow.db, "300000000000000003", "Mira"))["reason"] == "dm_closed"
    assert (await discord_welcome.greet(flow.db, "300000000000000003", "Mira"))["reason"] == "already_greeted" and len(dms) == 2

    # Ein vorübergehender Fehler darf beim nächsten Beitritt noch einmal.
    dms.answers["next"] = {"ok": False, "reason": "http", "error": "Discord 500"}
    assert (await discord_welcome.greet(flow.db, "300000000000000004", "Kai"))["reason"] == "error"
    dms.answers["next"] = {"ok": True}
    assert (await discord_welcome.greet(flow.db, "300000000000000004", "Kai"))["ok"] is True and len(dms) == 4

    stats = (await flow.get("/api/settings/discord")).json()["welcome"]["stats"]
    assert stats["sent"] == 2 and stats["dm_closed"] == 1 and stats["error"] == 0 and stats["last_at"]
    rows = await flow.db.discord_welcomes.find({}, {"_id": 0}).to_list(10)
    assert len(rows) == 3 and all(set(row) == {"key", "outcome", "created_at", "updated_at"} for row in rows)
    assert NEWCOMER not in str(rows) and "Leon" not in str(rows), "nur ein Hash - weder Kennung noch Name"


@pytest.mark.asyncio
async def test_send_to_me_needs_a_linked_account_and_does_not_count(flow, dms):
    me = await admin(flow)
    missing = (await flow.post("/api/settings/discord/welcome/test", json={})).json()
    assert missing["ok"] is False and missing["reason"] == "not_linked" and dms == []
    await flow.db.platform_links.insert_one({"id": "l-admin", "user_id": me["id"], "platform": "discord", "external_id": ADMIN_DISCORD, "handle": "admin"})
    sent = (await flow.post("/api/settings/discord/welcome/test", json={"text": "Probe für {name}"})).json()
    assert sent == {"ok": True} and dms[0]["to"] == ADMIN_DISCORD and dms[0]["embed"]["description"].startswith("Probe für ")
    stats = (await flow.get("/api/settings/discord")).json()["welcome"]["stats"]
    assert stats["sent"] == 0, "ein Test zählt nicht"
    dms.answers["next"] = {"ok": False, "reason": "forbidden"}
    closed = (await flow.post("/api/settings/discord/welcome/test", json={})).json()
    assert closed["reason"] == "dm_forbidden" and "Direktnachrichten" in closed["error"]
