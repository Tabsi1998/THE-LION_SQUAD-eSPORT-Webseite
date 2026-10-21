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

# key, Anzeigename, Feld am Partner - die Kanäle mit eigener Funktion (Seite, Discord-Widget, Twitch-Live).
CHANNELS = (
    ("website", "Website", "link"),
    ("discord", "Discord", "discord_invite"),
    ("twitch", "Twitch", "twitch_channel"),
)
URL_FIELDS = {
    "link": "Website", "youtube_url": "YouTube", "x_url": "X", "instagram_url": "Instagram", "tiktok_url": "TikTok",
}
# Die vier festen Social-Felder von früher (#469): bleiben lesbar, die Verwaltung schreibt seit #967 in ``social_links``.
LEGACY_SOCIAL_FIELDS = (("youtube", "youtube_url"), ("x", "x_url"), ("instagram", "instagram_url"), ("tiktok", "tiktok_url"))
# Socials eines Partners (#967): dieselbe Liste wie unter Einstellungen → Socials (frontend/src/lib/socialIcons.js).
# Je Plattform die Hosts, zu denen eine Adresse gehören muss - sonst steht bei „Facebook“ ein Link irgendwohin.
SOCIAL_PLATFORMS: dict[str, tuple[str, tuple[str, ...] | None]] = {
    "discord": ("Discord", ("discord.gg", "discord.com")),
    "whatsapp": ("WhatsApp", ("whatsapp.com", "wa.me")),
    "telegram": ("Telegram", ("t.me", "telegram.me", "telegram.org")),
    "facebook": ("Facebook", ("facebook.com", "fb.com", "fb.me")),
    "instagram": ("Instagram", ("instagram.com",)),
    "threads": ("Threads", ("threads.net", "threads.com")),
    "x": ("X", ("x.com", "twitter.com")),
    "bluesky": ("Bluesky", ("bsky.app",)),
    "mastodon": ("Mastodon", None),
    "tiktok": ("TikTok", ("tiktok.com",)),
    "youtube": ("YouTube", ("youtube.com", "youtu.be")),
    "twitch": ("Twitch", ("twitch.tv",)),
    "kick": ("Kick", ("kick.com",)),
    "linkedin": ("LinkedIn", ("linkedin.com",)),
    "reddit": ("Reddit", ("reddit.com",)),
    "steam": ("Steam", ("steamcommunity.com", "steampowered.com")),
    "github": ("GitHub", ("github.com",)),
    "snapchat": ("Snapchat", ("snapchat.com",)),
    "pinterest": ("Pinterest", ("pinterest.com", "pinterest.at", "pinterest.de", "pin.it")),
    "vimeo": ("Vimeo", ("vimeo.com",)),
    "spotify": ("Spotify", ("spotify.com",)),
    "email": ("E-Mail", None),
    "website": ("Website", None),
    "custom": ("Eigener Link", None),
}
MAX_SOCIAL_LINKS = 20
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


def _host_of(url: str) -> str:
    from urllib.parse import urlparse

    return str(urlparse(url).hostname or "").lower()


def clean_social_links(value) -> list[dict]:
    """Die Socials eines Partners (#967): Plattform aus der Liste, Adresse vollständig und zur Plattform passend,
    jede Adresse einmal, höchstens MAX_SOCIAL_LINKS. Leere Zeilen fallen still weg."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise HTTPException(400, "Socials: eine Liste aus Plattform und Adresse.")
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for entry in value:
        if not isinstance(entry, dict):
            raise HTTPException(400, "Socials: eine Liste aus Plattform und Adresse.")
        platform = str(entry.get("platform") or "custom").strip().lower()
        if platform not in SOCIAL_PLATFORMS:
            raise HTTPException(400, f"Socials: die Plattform „{platform}“ kennt die Website nicht.")
        name, hosts = SOCIAL_PLATFORMS[platform]
        raw = str(entry.get("url") or "").strip()
        if not raw:
            continue
        if platform == "email":
            address = raw[7:] if raw.lower().startswith("mailto:") else raw
            if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", address):
                raise HTTPException(400, "E-Mail: bitte eine Adresse wie name@verein.at eintragen.")
            url = f"mailto:{address}"
        else:
            url = clean_url(raw, label=name)
            if hosts and not any(_host_of(url) == host or _host_of(url).endswith(f".{host}") for host in hosts):
                raise HTTPException(400, f"{name}: diese Adresse gehört nicht zu {name} (erwartet {' oder '.join(hosts[:2])}).")
        key = (platform, url.lower())
        if key in seen:
            continue
        seen.add(key)
        label = str(entry.get("label") or "").strip()[:60]
        out.append({"platform": platform, "url": url, "label": label or None})
        if len(out) > MAX_SOCIAL_LINKS:
            raise HTTPException(400, f"Socials: höchstens {MAX_SOCIAL_LINKS} je Partner.")
    return out


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
    if "social_links" in raw:
        cleaned["social_links"] = clean_social_links(raw.get("social_links"))
    for field in TEXT_FIELDS:
        if field in raw:
            cleaned[field] = str(raw.get(field) or "").strip() or None
    return cleaned


# ---------- Ausgabe ----------

def channels_for(partner: dict) -> list[dict]:
    """Die Kanäle eines Partners für Website und App: erst die mit Funktion (Website, Discord, Twitch), dann die
    Socials in der gepflegten Reihenfolge (#967), dann die vier festen Felder von früher, soweit noch gefüllt - jede
    Adresse einmal."""
    channels: list[dict] = []
    seen: set[str] = set()
    for key, label, field in CHANNELS:
        value = str(partner.get(field) or "").strip()
        if not value:
            continue
        if key == "twitch":
            channels.append({"key": key, "label": label, "url": f"https://www.twitch.tv/{value}", "handle": value})
        else:
            channels.append({"key": key, "label": label, "url": value, "handle": None})
            seen.add(value.lower())
    for link in partner.get("social_links") or []:
        platform = str((link or {}).get("platform") or "custom")
        url = str((link or {}).get("url") or "").strip()
        if not url or url.lower() in seen or platform not in SOCIAL_PLATFORMS:
            continue
        seen.add(url.lower())
        channels.append({"key": platform, "label": (link or {}).get("label") or SOCIAL_PLATFORMS[platform][0], "url": url, "handle": None})
    for key, field in LEGACY_SOCIAL_FIELDS:
        value = str(partner.get(field) or "").strip()
        if value and value.lower() not in seen:
            seen.add(value.lower())
            channels.append({"key": key, "label": SOCIAL_PLATFORMS[key][0], "url": value, "handle": None})
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


# ---------- Partner an Events und Turnieren (#469 Teil 2) ----------

def partner_badge(doc: dict) -> dict:
    from services import sponsor_images

    return {"id": doc.get("id"), "slug": doc.get("slug"), "name": doc.get("name"), "logo_url": sponsor_images.pick(doc, "logo")[0], "kind": doc.get("kind")}


async def clean_partner_ids(db, ids) -> list[str]:
    """Nur echte, aktive Partner - in der Reihenfolge des Formulars, ohne Doppelte."""
    wanted = list(dict.fromkeys(str(item).strip() for item in (ids or []) if str(item or "").strip()))
    if not wanted:
        return []
    found = {row["id"] for row in await db.partners.find({"id": {"$in": wanted}, "is_active": {"$ne": False}}, {"_id": 0, "id": 1}).to_list(len(wanted))}
    return [item for item in wanted if item in found]


async def attach_partners(db, item: dict) -> None:
    """`partners` (Kurzform) an ein Event oder Turnier hängen - nur aktive Partner."""
    ids = [item_id for item_id in (item.get("partner_ids") or []) if item_id]
    if not ids:
        item["partners"] = []
        return
    rows = await db.partners.find({"id": {"$in": ids}, "is_active": {"$ne": False}},
                                  {"_id": 0, "id": 1, "slug": 1, "name": 1, "logo_url": 1, "dolibarr_images": 1, "kind": 1}).to_list(len(ids))
    by_id = {row["id"]: partner_badge(row) for row in rows}
    item["partners"] = [by_id[item_id] for item_id in ids if item_id in by_id]


async def attach_partners_many(db, items: list[dict]) -> None:
    """`partners` an viele Einträge hängen - eine Abfrage für alle."""
    ids = list({item_id for item in items for item_id in (item.get("partner_ids") or []) if item_id})
    by_id: dict[str, dict] = {}
    if ids:
        rows = await db.partners.find({"id": {"$in": ids}, "is_active": {"$ne": False}},
                                      {"_id": 0, "id": 1, "slug": 1, "name": 1, "logo_url": 1, "dolibarr_images": 1, "kind": 1}).to_list(len(ids))
        by_id = {row["id"]: partner_badge(row) for row in rows}
    for item in items:
        item["partners"] = [by_id[item_id] for item_id in (item.get("partner_ids") or []) if item_id in by_id]


def _reference_summary_for_partner(ref: dict, partner_id: str) -> dict:
    game = ref.get("game") or {}
    return {
        "id": ref.get("id"), "title": ref.get("display_title") or ref.get("title"), "organizer": ref.get("organizer"),
        "league": ref.get("league"), "season": ref.get("season"), "start_date": ref.get("start_date"), "status": ref.get("status"),
        "placement": ref.get("best_placement") if ref.get("best_placement") is not None else ref.get("placement"),
        "medal": ref.get("medal"), "game_name": game.get("display_name") or game.get("name") or ref.get("game_name"),
        "matched_by": "partner" if partner_id in (ref.get("partner_ids") or []) else "organizer",
    }


async def shared_for_partner(db, partner_id: str, *, user: dict | None, enrich_references) -> dict:
    """Events, Turniere und Referenzen mit diesem Partner - nur, was die Person sehen darf; Entwürfe nie.
    Referenzen (echte Teilnahmen des Vereins, #469 Teil 3) gehören per Haken zum Partner - oder weil er
    als Veranstalter eingetragen ist, ganz ohne Haken.

    ``enrich_references`` bereitet Referenzen so auf wie die Referenzliste der Website (``_enrich_references`` in
    routes/news_routes.py). Die Route reicht es herein, statt dass dieses Modul die Route importiert - sonst
    importierten sich beide gegenseitig (Import-Zyklus, #1408)."""
    from services.visibility import filter_visible, user_can_see

    events = []
    event_rows = await db.events.find(
        {"partner_ids": partner_id, "status": {"$ne": "draft"}},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "start_date": 1, "end_date": 1, "status": 1, "visibility": 1, "banner_url": 1, "event_type": 1},
    ).sort("start_date", -1).limit(30).to_list(30)
    for event in event_rows:
        if await user_can_see(user, event.get("visibility") or "public"):
            events.append(event)
    tournaments = []
    tournament_rows = await db.tournaments.find(
        {"partner_ids": partner_id, "status": {"$ne": "draft"}, "is_public": {"$ne": False}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "status": 1, "visibility": 1, "banner_url": 1, "game_id": 1},
    ).sort("start_date", -1).limit(30).to_list(30)
    for tournament in tournament_rows:
        if await user_can_see(user, tournament.get("visibility") or "public"):
            tournaments.append(tournament)
    game_ids = list({t.get("game_id") for t in tournaments if t.get("game_id")})
    games = {g["id"]: g for g in await db.games.find({"id": {"$in": game_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1}).to_list(len(game_ids))} if game_ids else {}
    for tournament in tournaments:
        tournament["game"] = games.get(tournament.pop("game_id", None))
    partner = await db.partners.find_one({"id": partner_id}, {"_id": 0, "name": 1})
    name = str((partner or {}).get("name") or "").strip()
    ref_query: dict = {"is_active": {"$ne": False}, "$or": [{"partner_ids": partner_id}]}
    if len(name) >= 3:
        ref_query["$or"].append({"organizer": {"$regex": re.escape(name), "$options": "i"}})
    ref_rows = await db.references.find(ref_query, {"_id": 0}).to_list(200)
    ref_rows = await enrich_references(await filter_visible(ref_rows, user))
    references = sorted((_reference_summary_for_partner(ref, partner_id) for ref in ref_rows), key=lambda r: str(r.get("start_date") or ""), reverse=True)
    return {"events": events, "tournaments": tournaments, "references": references}
