"""Clips des Vereinskanals auf der Startseite (#579).

Stündlich holt der Server die meistgesehenen Clips des Vereinskanals aus den letzten 30 Tagen
(Helix ``clips``, mit der Twitch-App, die für die Live-Erkennung eingerichtet ist) und legt bis zu
sechs davon ab: Titel, Vorschaubild, Dauer, Aufrufe, Link, Ersteller. Die Startseite zeigt sie als
Kachel „Clips“; der Clip-Player lädt erst nach Zustimmung zu externen Medien. Schalter im Admin
(Verbindungen → Twitch), Standard aus - ohne Schalter kein Abruf und keine Kachel.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

import httpx

from services.secret_store import decrypt_secret

logger = logging.getLogger("tls.twitch.clips")

STATE_ID = "twitch_clips_state"
USERS_URL = "https://api.twitch.tv/helix/users"
CLIPS_URL = "https://api.twitch.tv/helix/clips"
DAYS = 30
MAX_CLIPS = 6
FETCH_FIRST = 50
TIMEOUT = 15
_transport = None   # Tests hängen hier einen MockTransport ein

ERROR_TEXTS = {
    "disabled": "Clips sind ausgeschaltet (Verbindungen → Twitch → „Clips auf der Startseite“).",
    "not_configured": "Client-ID oder Client-Secret der Twitch-App fehlt.",
    "no_channel": "Kein Vereinskanal eingetragen (Verbindungen → Twitch → „TLS Twitch Channel“).",
    "token_rejected": "Twitch lehnt Client-ID oder Client-Secret ab.",
    "channel_not_found": "Twitch kennt den Vereinskanal nicht – stimmt der Kanalname?",
    "clips_failed": "Twitch hat die Clips nicht geliefert.",
}


def channel_login(value: str | None) -> str:
    """``https://www.twitch.tv/the_lion_squad`` oder ``@the_lion_squad`` → ``the_lion_squad``."""
    raw = str(value or "").strip()
    match = re.search(r"twitch\.tv/([A-Za-z0-9_]{2,64})", raw)
    login = match.group(1) if match else raw.lstrip("@").split("/")[0]
    return login.lower() if re.fullmatch(r"[A-Za-z0-9_]{2,64}", login) else ""


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport)


def pick_clips(rows: list[dict], limit: int = MAX_CLIPS) -> list[dict]:
    """Die meistgesehenen zuerst, höchstens ``limit`` - nur die Felder, die die Seite braucht."""
    cleaned = []
    for row in rows or []:
        clip_id = str(row.get("id") or "").strip()
        if not clip_id:
            continue
        cleaned.append({
            "id": clip_id, "url": row.get("url") or f"https://clips.twitch.tv/{clip_id}", "title": str(row.get("title") or "Clip")[:200],
            "creator_name": row.get("creator_name") or "", "view_count": int(row.get("view_count") or 0), "created_at": row.get("created_at"),
            "thumbnail_url": row.get("thumbnail_url") or "", "duration": float(row.get("duration") or 0), "game_id": row.get("game_id") or "",
        })
    cleaned.sort(key=lambda row: (-row["view_count"], row.get("created_at") or ""))
    return cleaned[:limit]


async def _save(db, patch: dict) -> None:
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, **patch}}, upsert=True)


async def fetch_clips(db, *, force: bool = False) -> dict:
    """Die Top-Clips holen und ablegen. ``force`` auch bei ausgeschaltetem Schalter („Jetzt laden“ im Admin)."""
    from services.twitch_service import _get_app_token

    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "twitch_channel": 1, "twitch_client_id": 1, "twitch_client_secret": 1, "twitch_clips_enabled": 1}) or {}
    now = datetime.now(timezone.utc)
    outcome = {"fetched": 0, "kept": 0, "error": None, "skipped": None}
    if not branding.get("twitch_clips_enabled") and not force:
        outcome["skipped"] = "disabled"
        return outcome

    async def fail(kind: str, detail: str = "") -> dict:
        text = ERROR_TEXTS.get(kind, kind) + (f" ({detail})" if detail else "")
        outcome["error"] = text
        await _save(db, {"fetched_at": now.isoformat(), "error": text})
        return outcome

    login = channel_login(branding.get("twitch_channel"))
    if not login:
        return await fail("no_channel")
    try:
        secret = decrypt_secret(branding.get("twitch_client_secret"))
    except RuntimeError:
        secret = None
    if not branding.get("twitch_client_id") or not secret:
        return await fail("not_configured")
    token, problem = await _get_app_token({"client_id": branding["twitch_client_id"], "client_secret": secret})
    if not token:
        return await fail("token_rejected", problem)
    headers = {"Client-ID": branding["twitch_client_id"], "Authorization": f"Bearer {token}"}
    state = await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {}
    try:
        async with _client() as client:
            broadcaster_id = state.get("broadcaster_id") if state.get("broadcaster_login") == login else ""
            if not broadcaster_id:
                users = await client.get(USERS_URL, params={"login": login}, headers=headers)
                rows = (users.json().get("data") or []) if users.status_code == 200 else []
                if not rows:
                    return await fail("channel_not_found", f"HTTP {users.status_code}" if users.status_code != 200 else "")
                broadcaster_id = str(rows[0].get("id") or "")
                await _save(db, {"broadcaster_id": broadcaster_id, "broadcaster_login": login})
            response = await client.get(CLIPS_URL, headers=headers, params={
                "broadcaster_id": broadcaster_id, "first": FETCH_FIRST,
                "started_at": (now - timedelta(days=DAYS)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                "ended_at": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            })
    except httpx.HTTPError as exc:
        return await fail("clips_failed", type(exc).__name__)
    if response.status_code != 200:
        return await fail("clips_failed", f"HTTP {response.status_code}")
    data = response.json().get("data") or []
    clips = pick_clips(data)
    await _save(db, {"fetched_at": now.isoformat(), "error": None, "clips": clips, "channel": login})
    outcome.update({"fetched": len(data), "kept": len(clips)})
    return outcome


async def clips_for_site(db) -> list[dict]:
    """Für die Startseite: nur mit Schalter, nur was abgelegt ist."""
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "twitch_clips_enabled": 1, "twitch_channel": 1}) or {}
    if not branding.get("twitch_clips_enabled"):
        return []
    state = await db.settings.find_one({"id": STATE_ID}, {"_id": 0, "clips": 1}) or {}
    return list(state.get("clips") or [])[:MAX_CLIPS]


async def clips_status(db) -> dict:
    """Für Verbindungen → Twitch: Schalter, letzter Abruf, Anzahl, Fehler."""
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "twitch_clips_enabled": 1}) or {}
    state = await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {}
    return {"enabled": bool(branding.get("twitch_clips_enabled")), "fetched_at": state.get("fetched_at"), "count": len(state.get("clips") or []),
            "error": state.get("error"), "channel": state.get("channel") or state.get("broadcaster_login") or ""}
