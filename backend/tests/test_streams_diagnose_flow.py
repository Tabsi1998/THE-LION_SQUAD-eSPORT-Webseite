"""Livestreams auf der Startseite (#310) durch die echte Anwendung: die Regel
bleibt, wie sie war; neu ist, dass der Admin je Kanal sagt, woran es liegt, dass
die Twitch-Abfrage ihr Ergebnis festhält statt still zu überspringen, und dass
die Redaktion keine Vereinsdaten zu sehen bekommt."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import ops_checks, twitch_service  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def add_user_with(flow, *, role="player", name=None, **fields):
    user = await flow.add_user(role=role, name=name)
    if fields:
        await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
        user.update(fields)
    return user


async def add_streamer(flow, name, *, member_status=None, profile=False, live=True, **user_fields):
    user = await add_user_with(flow, name=name, twitch_handle=name, **user_fields)
    if member_status:
        await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": member_status})
    if profile:
        await flow.db.club_member_profiles.insert_one(
            {"id": f"p-{name}", "user_id": user["id"], "slug": name, "display_name": name.title(), "is_active": True}
        )
    if live:
        await flow.db.live_streams.insert_one(
            {"user_id": user["id"], "username": name, "twitch_login": name, "stream_id": f"s-{name}", "viewer_count": 5}
        )
    return user


# ---------------------------------------------------------------- Startseite und Erklärung

@pytest.mark.asyncio
async def test_homepage_rule_is_unchanged_and_admin_names_the_reason_per_channel(flow):
    await add_streamer(flow, "mitglied", member_status="active", profile=True)
    await add_streamer(flow, "ehrenmitglied", member_status="honorary", profile=True, live=False)
    await add_streamer(flow, "ohneprofil", member_status="active")
    await add_streamer(flow, "gast")
    await add_streamer(flow, "ausgetreten", member_status="left", profile=True)
    await add_streamer(flow, "gesperrt", member_status="active", profile=True, is_banned=True)

    flow.act_as(None)
    public = await flow.get("/api/streams/live")
    assert public.status_code == 200
    assert [stream["username"] for stream in public.json()] == ["mitglied"]
    assert public.json()[0]["member_profile"]["slug"] == "mitglied"

    flow.act_as(await flow.add_user(role="club_admin"))
    status = (await flow.get("/api/admin/streams/status")).json()
    reasons = {channel["username"]: channel for channel in status["channels"]}
    assert status["channels_detailed"] is True
    assert status["channels_visible"] == 2
    assert reasons["mitglied"]["homepage_visible"] is True and reasons["mitglied"]["is_live"] is True
    assert reasons["ehrenmitglied"]["homepage_visible"] is True and reasons["ehrenmitglied"]["is_live"] is False
    assert reasons["ohneprofil"]["reason"] == "no_member_profile"
    assert "Plattform-Konto" in reasons["ohneprofil"]["reason_text"]
    assert reasons["gast"]["reason"] == "no_membership"
    assert reasons["ausgetreten"]["reason"] == "no_membership"
    assert reasons["gesperrt"]["reason"] == "account_inactive"


@pytest.mark.asyncio
async def test_redaktion_sees_that_a_channel_is_hidden_but_not_the_club_reason(flow):
    await add_streamer(flow, "gast")
    await add_streamer(flow, "mitglied", member_status="active", profile=True)

    flow.act_as(await add_user_with(flow, areas=["content"]))
    response = await flow.get("/api/admin/streams/status")
    assert response.status_code == 200
    status = response.json()
    reasons = {channel["username"]: channel for channel in status["channels"]}
    assert status["channels_detailed"] is False
    assert reasons["mitglied"]["homepage_visible"] is True
    assert reasons["gast"]["homepage_visible"] is False
    assert reasons["gast"]["reason"] == "restricted"
    assert "Mitgliedschaft" not in reasons["gast"]["reason_text"]
    assert "Vereinsverwaltung" in reasons["gast"]["reason_text"]

    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.get("/api/admin/streams/status")).status_code == 403


# ---------------------------------------------------------------- Abfrage hält ihr Ergebnis fest

@pytest.mark.asyncio
async def test_poll_records_why_it_delivers_nothing(flow):
    flow.act_as(await flow.add_user(role="club_admin"))

    first = (await flow.post("/api/admin/streams/refresh")).json()
    assert first["ok"] is False and first["reason"] == "not_configured"
    assert "fehlt" in first["skipped"]

    await flow.db.settings.update_one(
        {"id": "branding"},
        {"$set": {"id": "branding", "twitch_client_id": "cid", "twitch_client_secret": "enc:v1:kaputt"}},
        upsert=True,
    )
    unreadable = (await flow.post("/api/admin/streams/refresh")).json()
    assert unreadable["reason"] == "secret_unreadable"

    status = (await flow.get("/api/admin/streams/status")).json()
    assert status["configured"] is True
    assert status["client_secret_readable"] is False
    assert status["poll"]["reason"] == "secret_unreadable"
    assert "neu eintragen" in status["poll"]["reason_text"]

    await flow.db.settings.update_one(
        {"id": "branding"}, {"$set": {"twitch_client_secret": encrypt_secret("geheim"), "twitch_live_detection": False}}
    )
    assert (await flow.post("/api/admin/streams/refresh")).json()["reason"] == "disabled"


@pytest.mark.asyncio
async def test_failed_twitch_answer_keeps_running_streams(flow, monkeypatch):
    streamer = await add_streamer(flow, "mitglied", member_status="active", profile=True)
    await flow.db.settings.update_one(
        {"id": "branding"},
        {"$set": {"id": "branding", "twitch_client_id": "cid", "twitch_client_secret": encrypt_secret("geheim")}},
        upsert=True,
    )

    async def token(_creds):
        return "token", ""

    class Answer:
        status_code = 503
        text = "unavailable"

    class Client:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, *args, **kwargs):
            return Answer()

    monkeypatch.setattr(twitch_service, "_get_app_token", token)
    monkeypatch.setattr(twitch_service.httpx, "AsyncClient", Client)

    summary = await twitch_service.fetch_live_streams()
    assert summary["ok"] is False and summary["reason"] == "streams_failed"
    assert "HTTP 503" in summary["skipped"]
    assert await flow.db.live_streams.count_documents({"user_id": streamer["id"]}) == 1


@pytest.mark.asyncio
async def test_rejected_credentials_are_named(flow, monkeypatch):
    await add_streamer(flow, "mitglied", live=False)
    await flow.db.settings.update_one(
        {"id": "branding"},
        {"$set": {"id": "branding", "twitch_client_id": "cid", "twitch_client_secret": encrypt_secret("falsch")}},
        upsert=True,
    )

    async def no_token(_creds):
        return None, "HTTP 403"

    monkeypatch.setattr(twitch_service, "_get_app_token", no_token)
    summary = await twitch_service.fetch_live_streams()
    assert summary["reason"] == "token_rejected"
    assert "HTTP 403" in summary["skipped"]


# ---------------------------------------------------------------- Auto-Check

def test_rate_twitch_is_quiet_when_off_and_warns_when_it_should_run():
    assert ops_checks.rate_twitch(None, None) == "ok"
    assert ops_checks.rate_twitch({"reason": "not_configured", "ok": False}, 1) == "ok"
    assert ops_checks.rate_twitch({"reason": "disabled", "ok": False}, 1) == "ok"
    assert ops_checks.rate_twitch({"reason": "secret_unreadable", "ok": False}, 1) == "warn"
    assert ops_checks.rate_twitch({"reason": "ok", "ok": True}, 2) == "ok"
    assert ops_checks.rate_twitch({"reason": "ok", "ok": True}, 60) == "warn"


@pytest.mark.asyncio
async def test_check_twitch_poll_says_what_is_wrong(flow):
    quiet = await ops_checks.check_twitch_poll(flow.db)
    assert quiet["status"] == "ok" and quiet["value"] == "noch kein Lauf"

    await twitch_service.record_poll("token_rejected", detail="HTTP 400", checked=3)
    broken = await ops_checks.check_twitch_poll(flow.db)
    assert broken["status"] == "warn"
    assert broken["value"] == "liefert nichts"
    assert "HTTP 400" in broken["detail"] and "Einstellungen → Twitch" in broken["detail"]

    await twitch_service.record_poll("ok", checked=3, live=1)
    fine = await ops_checks.check_twitch_poll(flow.db)
    assert fine["status"] == "ok" and fine["value"] == "1 live von 3 Kanälen"
    assert any(key == "twitch_poll" for key, _label, _run in ops_checks.default_checks(flow.db))
