"""Partnerseiten (#469 Teil 1): Kanäle eines Partners, Twitch-Live-Stand und Discord-Widget.

Ein Partner hat außer Logo, Text und Website nun Kanäle (Discord-Einladung, Twitch, YouTube, X,
Instagram, TikTok), einen Discord-Server (Widget) und „Tools und Projekte“ (Links, auf Wunsch
eingebettet). Twitch fragt die Website mit der vorhandenen Helix-App ab (der Kanalname genügt),
Discord über das öffentliche Widget des Servers (nur, wenn der Partner es eingeschaltet hat).
Beide Antworten bleiben kurz im Speicher, damit die Seite die Dienste nicht bei jedem Aufruf fragt.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException

from services import twitch_service
from models import new_id

logger = logging.getLogger("tls.partners")

# Tests hängen hier einen MockTransport ein; im Betrieb bleibt es None.
_transport = None
TIMEOUT = 8.0
TWITCH_TTL = 120
DISCORD_TTL = 300
MAX_TOOLS = 20
DISCORD_WIDGET_URL = "https://discord.com/api/guilds/{guild_id}/widget.json"

# key, Anzeigename, Feld am Partner
CHANNELS = (
    ("website", "Website", "link"),
    ("discord", "Discord", "discord_invite"),
    ("twitch", "Twitch", "twitch_channel"),
    ("youtube", "YouTube", "youtube_url"),
    ("x", "X", "x_url"),
    ("instagram", "Instagram", "instagram_url"),
    ("tiktok", "TikTok", "tiktok_url"),
)
URL_FIELDS = {
    "link": "Website", "youtube_url": "YouTube", "x_url": "X", "instagram_url": "Instagram", "tiktok_url": "TikTok",
}
TEXT_FIELDS = ("about", "since")

_cache: dict[tuple[str, str], tuple[float, dict]] = {}


def reset_cache() -> None:
    _cache.clear()


def _cached(key: tuple[str, str]) -> dict | None:
    entry = _cache.get(key)
    if entry and entry[0] > time.monotonic():
        return entry[1]
    return None


def _remember(key: tuple[str, str], value: dict, ttl: int) -> dict:
    _cache[key] = (time.monotonic() + ttl, value)
    return value


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport)


# ---------- Felder prüfen und vereinheitlichen ----------

def clean_url(value, *, label: str) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if not re.match(r"^https?://", raw, re.IGNORECASE):
        raw = f"https://{raw}"
    if not re.match(r"^https?://[^\s/?#]+\.[^\s/?#]+", raw, re.IGNORECASE):
        raise HTTPException(400, f"{label}: bitte eine vollständige Adresse eintragen (https://…).")
    return raw


def clean_discord_invite(value) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"[A-Za-z0-9-]+", raw):
        raw = f"https://discord.gg/{raw}"
    return clean_url(raw, label="Discord-Einladung")


def clean_guild_id(value) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if not raw.isdigit() or len(raw) < 15:
        raise HTTPException(400, "Discord-Server-ID: nur die Ziffern der Server-ID (Discord → Server-Einstellungen → Widget).")
    return raw


def clean_twitch_channel(value) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    raw = re.sub(r"^https?://(www\.)?twitch\.tv/", "", raw, flags=re.IGNORECASE)
    login = raw.lstrip("@").split("/")[0].split("?")[0].lower()
    if not re.fullmatch(r"[a-z0-9_]{3,25}", login):
        raise HTTPException(400, "Twitch-Kanal: nur der Kanalname (Buchstaben, Ziffern, Unterstrich), zum Beispiel pineapps.")
    return login


def clean_tools(value) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise HTTPException(400, "Tools und Projekte: bitte als Liste.")
    if len(value) > MAX_TOOLS:
        raise HTTPException(400, f"Tools und Projekte: höchstens {MAX_TOOLS} Einträge.")
    tools: list[dict] = []
    for index, raw in enumerate(value, start=1):
        item = dict(raw or {})
        title = str(item.get("title") or "").strip()
        if not title:
            raise HTTPException(400, f"Tools und Projekte, Eintrag {index}: der Titel fehlt.")
        url = clean_url(item.get("url"), label=f"Tools und Projekte, Eintrag {index}")
        if not url:
            raise HTTPException(400, f"Tools und Projekte, Eintrag {index}: die Adresse fehlt.")
        tools.append({
            "id": str(item.get("id") or "").strip() or new_id(),
            "title": title[:120],
            "url": url,
            "description": (str(item.get("description") or "").strip() or None),
            "image_url": (str(item.get("image_url") or "").strip() or None),
            "embed": bool(item.get("embed")),
        })
    return tools


def normalize_partner_fields(raw: dict) -> dict:
    """Nur die Felder, die im Aufruf vorkommen - so passt es für Anlegen und Teil-Änderung."""
    cleaned: dict = {}
    for field, label in URL_FIELDS.items():
        if field in raw:
            cleaned[field] = clean_url(raw.get(field), label=label)
    if "discord_invite" in raw:
        cleaned["discord_invite"] = clean_discord_invite(raw.get("discord_invite"))
    if "discord_guild_id" in raw:
        cleaned["discord_guild_id"] = clean_guild_id(raw.get("discord_guild_id"))
    if "twitch_channel" in raw:
        cleaned["twitch_channel"] = clean_twitch_channel(raw.get("twitch_channel"))
    if "tools" in raw:
        cleaned["tools"] = clean_tools(raw.get("tools"))
    for field in TEXT_FIELDS:
        if field in raw:
            cleaned[field] = str(raw.get(field) or "").strip() or None
    return cleaned


# ---------- Ausgabe ----------

def channels_for(partner: dict) -> list[dict]:
    channels: list[dict] = []
    for key, label, field in CHANNELS:
        value = str(partner.get(field) or "").strip()
        if not value:
            continue
        if key == "twitch":
            channels.append({"key": key, "label": label, "url": f"https://www.twitch.tv/{value}", "handle": value})
        else:
            channels.append({"key": key, "label": label, "url": value, "handle": None})
    return channels


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def twitch_status(channel) -> dict | None:
    """Läuft der Kanal des Partners gerade? Nutzt die Helix-App der Website; ohne sie steht
    `configured: False`, und die Seite zeigt nur den Link."""
    login = clean_twitch_channel(channel) if channel else None
    if not login:
        return None
    cached = _cached(("twitch", login))
    if cached:
        return cached
    creds = await twitch_service._get_credentials()
    if creds.get("problem"):
        return _remember(("twitch", login), {"configured": False, "live": False, "checked_at": _now_iso()}, TWITCH_TTL)
    token, problem = await twitch_service._get_app_token(creds)
    if not token:
        return _remember(("twitch", login), {"configured": True, "live": False, "error": problem or "token", "checked_at": _now_iso()}, TWITCH_TTL)
    try:
        async with _client() as cli:
            response = await cli.get(
                twitch_service.TWITCH_STREAMS_URL,
                params={"user_login": login},
                headers={"Client-ID": creds["client_id"], "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as error:
        logger.warning("[partners] twitch %s unreachable: %s", login, error)
        return _remember(("twitch", login), {"configured": True, "live": False, "error": "unreachable", "checked_at": _now_iso()}, TWITCH_TTL)
    if response.status_code != 200:
        logger.warning("[partners] twitch %s: HTTP %s", login, response.status_code)
        return _remember(("twitch", login), {"configured": True, "live": False, "error": f"HTTP {response.status_code}", "checked_at": _now_iso()}, TWITCH_TTL)
    streams = (response.json() or {}).get("data") or []
    stream = streams[0] if streams else None
    if not stream:
        return _remember(("twitch", login), {"configured": True, "live": False, "checked_at": _now_iso()}, TWITCH_TTL)
    thumb = (stream.get("thumbnail_url") or "").replace("{width}", "640").replace("{height}", "360")
    return _remember(("twitch", login), {
        "configured": True,
        "live": True,
        "title": stream.get("title"),
        "viewer_count": int(stream.get("viewer_count") or 0),
        "game_name": stream.get("game_name"),
        "thumbnail_url": thumb or None,
        "started_at": stream.get("started_at"),
        "checked_at": _now_iso(),
    }, TWITCH_TTL)


async def discord_widget(guild_id) -> dict | None:
    """Wie viele sind gerade auf dem Server des Partners? Geht nur, wenn der Partner das Widget in
    seinen Server-Einstellungen eingeschaltet hat - sonst `enabled: False`, und die Seite zeigt nur
    die Einladung."""
    gid = str(guild_id or "").strip()
    if not gid:
        return None
    cached = _cached(("discord", gid))
    if cached:
        return cached
    try:
        async with _client() as cli:
            response = await cli.get(DISCORD_WIDGET_URL.format(guild_id=gid))
    except httpx.HTTPError as error:
        logger.warning("[partners] discord widget %s unreachable: %s", gid, error)
        return _remember(("discord", gid), {"enabled": False, "error": "unreachable", "checked_at": _now_iso()}, DISCORD_TTL)
    if response.status_code == 200:
        body = response.json() or {}
        return _remember(("discord", gid), {
            "enabled": True,
            "name": body.get("name"),
            "online": int(body.get("presence_count") or 0),
            "invite": body.get("instant_invite"),
            "checked_at": _now_iso(),
        }, DISCORD_TTL)
    if response.status_code in (403, 404):
        return _remember(("discord", gid), {"enabled": False, "checked_at": _now_iso()}, DISCORD_TTL)
    logger.warning("[partners] discord widget %s: HTTP %s", gid, response.status_code)
    return _remember(("discord", gid), {"enabled": False, "error": f"HTTP {response.status_code}", "checked_at": _now_iso()}, DISCORD_TTL)
