"""Clips des Vereinskanals (#579): Schalter, Kanal-ID einmal, die meistgesehenen sechs, Fehler im Klartext,
öffentliche Route nur mit Schalter - alles mit nachgestelltem Helix."""
import pathlib
import sys

import httpx
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import twitch_clips, twitch_service  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402


def clip(clip_id: str, views: int, title: str = "Clip") -> dict:
    return {"id": clip_id, "url": f"https://clips.twitch.tv/{clip_id}", "embed_url": f"https://clips.twitch.tv/embed?clip={clip_id}", "broadcaster_name": "the_lion_squad",
            "creator_name": "Paula", "title": title, "view_count": views, "created_at": "2026-09-20T18:00:00Z", "thumbnail_url": f"https://clips-media.twitch.tv/{clip_id}-preview-480x272.jpg",
            "duration": 27.5, "game_id": "30921"}


class FakeHelix:
    def __init__(self):
        self.calls: list[str] = []
        self.users = [{"id": "424242", "login": "the_lion_squad"}]
        self.clips = [clip(f"Clip{i}", views=i * 10, title=f"Clip {i}") for i in range(1, 9)]
        self.clips_status = 200

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers.get("Client-ID") == "cid" and request.headers.get("Authorization") == "Bearer tok"
        self.calls.append(str(request.url))
        if request.url.path == "/helix/users":
            return httpx.Response(200, json={"data": self.users})
        if request.url.path == "/helix/clips":
            assert request.url.params.get("broadcaster_id") == "424242" and request.url.params.get("first") == "50"
            assert request.url.params.get("started_at", "").endswith("Z")
            return httpx.Response(self.clips_status, json={"data": self.clips})
        return httpx.Response(404, json={})


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def helix(monkeypatch):
    fake = FakeHelix()
    monkeypatch.setattr(twitch_clips, "_transport", httpx.MockTransport(fake.handle))

    async def token(creds):
        assert creds["client_id"] == "cid" and creds["client_secret"] == "geheim"
        return "tok", ""

    monkeypatch.setattr(twitch_service, "_get_app_token", token)
    return fake


async def branding(flow, **extra):
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "twitch_channel": "https://www.twitch.tv/The_Lion_Squad",
                                                                    "twitch_client_id": "cid", "twitch_client_secret": encrypt_secret("geheim"), **extra}}, upsert=True)


def test_channel_login_and_pick():
    assert twitch_clips.channel_login("https://www.twitch.tv/The_Lion_Squad/videos") == "the_lion_squad"
    assert twitch_clips.channel_login("@lions") == "lions" and twitch_clips.channel_login("") == "" and twitch_clips.channel_login("kein kanal!") == ""
    picked = twitch_clips.pick_clips([clip("a", 5), clip("b", 50), {"id": "", "view_count": 999}, clip("c", 50)], limit=2)
    assert [row["id"] for row in picked] == ["b", "c"] and picked[0]["duration"] == 27.5 and "embed_url" not in picked[0]


@pytest.mark.asyncio
async def test_clips_need_the_switch_resolve_the_channel_once_and_keep_the_top_six(flow, helix):
    await branding(flow)
    assert (await twitch_clips.fetch_clips(flow.db))["skipped"] == "disabled" and helix.calls == []
    assert (await flow.get("/api/streams/clips")).json() == []

    forced = await twitch_clips.fetch_clips(flow.db, force=True)
    assert forced["fetched"] == 8 and forced["kept"] == 6 and forced["error"] is None, forced
    assert sum(1 for url in helix.calls if "/helix/users" in url) == 1
    assert (await flow.get("/api/streams/clips")).json() == [], "ohne Schalter zeigt die Startseite nichts - auch wenn Clips abgelegt sind"

    await branding(flow, twitch_clips_enabled=True)
    again = await twitch_clips.fetch_clips(flow.db)
    assert again["kept"] == 6 and sum(1 for url in helix.calls if "/helix/users" in url) == 1, "die Kanal-ID wird nur einmal aufgelöst"
    rows = (await flow.get("/api/streams/clips")).json()
    assert [row["id"] for row in rows] == ["Clip8", "Clip7", "Clip6", "Clip5", "Clip4", "Clip3"], "die meistgesehenen zuerst"
    assert rows[0]["title"] == "Clip 8" and rows[0]["view_count"] == 80 and rows[0]["thumbnail_url"].endswith("480x272.jpg") and rows[0]["creator_name"] == "Paula"

    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    status = (await flow.get("/api/admin/streams/status")).json()
    assert status["clips"]["enabled"] is True and status["clips"]["count"] == 6 and status["clips"]["error"] is None and status["clips"]["channel"] == "the_lion_squad"
    refreshed = (await flow.post("/api/admin/streams/clips/refresh")).json()
    assert refreshed["kept"] == 6


@pytest.mark.asyncio
async def test_errors_are_plain_text_and_keep_the_old_clips(flow, helix):
    await branding(flow, twitch_clips_enabled=True)
    assert (await twitch_clips.fetch_clips(flow.db))["kept"] == 6
    helix.clips_status = 500
    broken = await twitch_clips.fetch_clips(flow.db)
    assert broken["error"] == "Twitch hat die Clips nicht geliefert. (HTTP 500)" and broken["kept"] == 0
    assert len((await flow.get("/api/streams/clips")).json()) == 6, "eine Störung löscht die Kachel nicht"
    assert (await twitch_clips.clips_status(flow.db))["error"].startswith("Twitch hat die Clips nicht geliefert")

    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"twitch_channel": ""}})
    assert (await twitch_clips.fetch_clips(flow.db))["error"].startswith("Kein Vereinskanal")
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"twitch_channel": "unbekannt"}})
    helix.users = []
    helix.clips_status = 200
    assert (await twitch_clips.fetch_clips(flow.db))["error"].startswith("Twitch kennt den Vereinskanal nicht")
