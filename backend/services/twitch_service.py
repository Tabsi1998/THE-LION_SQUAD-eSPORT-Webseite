"""Phase E — Twitch Helix integration for Live-Streamer-Detection.

Polls Twitch's `/helix/streams` endpoint for all users with `twitch_handle`
or `twitch_channel` filled and persists currently-live streams in the
`live_streams` collection. Background scheduler runs every 60 s when
the admin has saved valid credentials.
"""
from __future__ import annotations
import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Iterable

import httpx

from database import get_db

logger = logging.getLogger("tls.twitch")
TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
TWITCH_STREAMS_URL = "https://api.twitch.tv/helix/streams"


async def _get_credentials() -> dict | None:
    db = get_db()
    s = await db.settings.find_one({"id": "branding"})
    if not s:
        return None
    cid = s.get("twitch_client_id") or os.environ.get("TWITCH_CLIENT_ID")
    secret = s.get("twitch_client_secret") or os.environ.get("TWITCH_CLIENT_SECRET")
    if not cid or not secret:
        return None
    return {
        "client_id": cid,
        "client_secret": secret,
        "enabled": bool(s.get("twitch_live_detection", True)),
    }


async def _get_app_token(creds: dict) -> str | None:
    db = get_db()
    cached = await db.settings.find_one({"id": "twitch_app_token"})
    if cached and cached.get("expires_at"):
        try:
            exp = datetime.fromisoformat(cached["expires_at"].replace("Z", "+00:00"))
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp > datetime.now(timezone.utc):
                return cached["access_token"]
        except Exception:
            pass
    async with httpx.AsyncClient(timeout=10) as cli:
        r = await cli.post(TWITCH_TOKEN_URL, params={
            "client_id": creds["client_id"],
            "client_secret": creds["client_secret"],
            "grant_type": "client_credentials",
        })
    if r.status_code != 200:
        logger.warning("[twitch] token fetch failed: %s", r.text[:200])
        return None
    body = r.json()
    expires_in = int(body.get("expires_in", 3600))
    exp_iso = datetime.fromtimestamp(
        datetime.now(timezone.utc).timestamp() + expires_in - 60,
        tz=timezone.utc).isoformat()
    await db.settings.update_one(
        {"id": "twitch_app_token"},
        {"$set": {"id": "twitch_app_token", "access_token": body["access_token"], "expires_at": exp_iso}},
        upsert=True,
    )
    return body["access_token"]


def _chunks(seq: list, n: int) -> Iterable[list]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


async def fetch_live_streams() -> dict:
    """Refresh `live_streams` collection. Returns summary dict."""
    creds = await _get_credentials()
    if not creds or not creds["enabled"]:
        return {"ok": False, "skipped": "no credentials or disabled"}
    db = get_db()
    # Collect all candidate Twitch usernames
    users = await db.users.find(
        {"$or": [{"twitch_handle": {"$nin": [None, ""]}},
                  {"twitch_channel": {"$nin": [None, ""]}}]},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1,
         "twitch_handle": 1, "twitch_channel": 1}
    ).to_list(2000)
    if not users:
        await db.live_streams.delete_many({})
        return {"ok": True, "live": 0, "checked": 0}
    by_login: dict[str, dict] = {}
    for u in users:
        login = (u.get("twitch_handle") or u.get("twitch_channel") or "").strip().lstrip("@").lower()
        if login:
            by_login[login] = u

    token = await _get_app_token(creds)
    if not token:
        return {"ok": False, "skipped": "no token"}
    headers = {"Client-ID": creds["client_id"], "Authorization": f"Bearer {token}"}

    all_streams: list[dict] = []
    async with httpx.AsyncClient(timeout=10) as cli:
        for batch in _chunks(list(by_login.keys()), 100):
            params = [("user_login", login) for login in batch]
            r = await cli.get(TWITCH_STREAMS_URL, params=params, headers=headers)
            if r.status_code != 200:
                logger.warning("[twitch] streams %s: %s", r.status_code, r.text[:200])
                continue
            all_streams.extend(r.json().get("data", []))

    now = datetime.now(timezone.utc).isoformat()
    seen_logins = set()
    for s in all_streams:
        login = (s.get("user_login") or "").lower()
        seen_logins.add(login)
        u = by_login.get(login)
        if not u:
            continue
        thumb = (s.get("thumbnail_url") or "").replace("{width}", "640").replace("{height}", "360")
        await db.live_streams.update_one(
            {"user_id": u["id"]},
            {"$set": {
                "user_id": u["id"],
                "username": u["username"],
                "display_name": u.get("display_name"),
                "avatar_url": u.get("avatar_url"),
                "twitch_login": login,
                "stream_id": s.get("id"),
                "title": s.get("title"),
                "game_name": s.get("game_name"),
                "viewer_count": s.get("viewer_count", 0),
                "thumbnail_url": thumb,
                "started_at": s.get("started_at"),
                "language": s.get("language"),
                "stream_url": f"https://twitch.tv/{login}",
                "updated_at": now,
            }},
            upsert=True,
        )
    # Drop offline streams
    await db.live_streams.delete_many({"twitch_login": {"$nin": list(seen_logins)}})
    return {"ok": True, "live": len(seen_logins), "checked": len(by_login), "updated_at": now}


_running = False


async def twitch_poll_loop(interval_seconds: int = 60):
    """APScheduler-friendly entrypoint — call once, it self-throttles."""
    global _running
    if _running:
        return
    _running = True
    try:
        await fetch_live_streams()
    except Exception as e:
        logger.warning("[twitch] poll failed: %s", e)
    finally:
        _running = False
