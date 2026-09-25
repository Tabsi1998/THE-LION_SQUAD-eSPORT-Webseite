"""Neue Videos des Vereinskanals auf YouTube als News (#578).

Quelle ohne Schlüssel: der öffentliche Atom-Feed des Kanals
(``https://www.youtube.com/feeds/videos.xml?channel_id=…``) - kein API-Schlüssel, kein Kontingent.
Die Kanal-ID kommt aus der hinterlegten YouTube-Adresse (Branding ``youtube_url``); ein Handle
wie ``@TheLionSquadeSports`` wird einmal über die Kanalseite aufgelöst und gespeichert.

Ein Job sieht alle 15 Minuten nach. Beim **ersten** Abruf merkt sich der Server nur, welche Videos
es schon gibt (sonst würden 15 alte Videos auf einmal News) - ab dann wird jedes neue Video genau
einmal (nach Video-ID) als News der Art „Video“ angelegt: Titel, Vorschaubild, Text aus der
Videobeschreibung, Link, und ``video_url`` für den Player auf der News-Seite. Ob die News gleich
veröffentlicht oder als Entwurf angelegt wird, ist ein Schalter des Betreibers (Standard Entwurf);
Kurzvideos (Shorts) bleiben wahlweise draußen. Eine veröffentlichte Video-News meldet der bestehende
Discord-Job wie jede News (``news.published``, #566).
"""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET

import httpx

from models import new_id, now_utc

logger = logging.getLogger("tls.youtube")

SETTINGS_ID = "youtube"
FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
SHORTS_URL = "https://www.youtube.com/shorts/{video_id}"
SYNC_INTERVAL_MINUTES = 15
USER_AGENT = "lionsquad-website/1.0 (+https://lionsquad.at)"
TIMEOUT = 30
NS = {"atom": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "media": "http://search.yahoo.com/mrss/"}
CHANNEL_ID_RE = re.compile(r"(UC[A-Za-z0-9_-]{22})")
YOUTUBE_HOSTS = ("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be")
DEFAULT_EXCERPT = "Neues Video auf dem YouTube-Kanal des Vereins."
_transport = None   # Tests hängen hier einen MockTransport ein

DEFAULTS = {"enabled": False, "publish": False, "include_shorts": False, "channel_url": ""}
# Warum nichts ankam - in Worten, für die Seite unter Verbindungen → YouTube.
ERROR_TEXTS = {
    "no_channel": "Keine YouTube-Adresse hinterlegt (Einstellungen → Branding → Social-Links → YouTube, oder hier eine Kanal-Adresse eintragen).",
    "channel_not_found": "Kanal nicht gefunden – auf der Kanalseite steht keine Kanal-ID. Stimmt die YouTube-Adresse?",
    "feed_failed": "Der Feed des Kanals antwortet nicht.",
    "feed_empty": "Der Feed des Kanals ist leer – noch kein Video, oder die Kanal-ID stimmt nicht.",
    "unreachable": "YouTube ist gerade nicht erreichbar – der nächste Abruf kommt in 15 Minuten.",
}


class YoutubeError(Exception):
    def __init__(self, kind: str, text: str | None = None):
        super().__init__(kind)
        self.kind = kind
        self.text = text or ERROR_TEXTS.get(kind, kind)


def merge_settings(stored: dict | None) -> dict:
    stored = stored or {}
    view = {key: stored.get(key, default) for key, default in DEFAULTS.items()}
    view["enabled"] = bool(view["enabled"])
    view["publish"] = bool(view["publish"])
    view["include_shorts"] = bool(view["include_shorts"])
    view["channel_url"] = str(view["channel_url"] or "").strip()
    for key in ("channel_id", "channel_id_for", "last_run_at", "last_error", "last_video", "baseline_at"):
        view[key] = stored.get(key)
    return view


def is_youtube_url(value: str) -> bool:
    raw = str(value or "").strip()
    if not raw:
        return False
    if not raw.lower().startswith(("http://", "https://")):
        raw = f"https://{raw}"
    try:
        host = httpx.URL(raw).host.lower()
    except Exception:  # noqa: BLE001
        return False
    return host in YOUTUBE_HOSTS


def channel_id_from_url(url: str) -> str:
    """``…/channel/UC…`` trägt die Kanal-ID schon; ein Handle nicht."""
    match = re.search(r"/channel/(UC[A-Za-z0-9_-]{22})", str(url or ""))
    return match.group(1) if match else ""


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transport, follow_redirects=True,
                             headers={"User-Agent": USER_AGENT, "Accept-Language": "de-AT,de;q=0.9,en;q=0.5"})


async def resolve_channel_id(client: httpx.AsyncClient, url: str) -> str:
    """Die Kanal-ID zu einer Adresse: direkt aus ``/channel/UC…`` oder einmal von der Kanalseite."""
    direct = channel_id_from_url(url)
    if direct:
        return direct
    page = str(url or "").strip()
    if not page.lower().startswith(("http://", "https://")):
        page = f"https://{page}"
    response = await client.get(page)
    if response.status_code != 200:
        raise YoutubeError("channel_not_found", f"YouTube antwortet {response.status_code} für die Kanalseite – stimmt die Adresse?")
    text = response.text
    match = (re.search(r'"channelId"\s*:\s*"(UC[A-Za-z0-9_-]{22})"', text)
             or re.search(r'channel_id=(UC[A-Za-z0-9_-]{22})', text)
             or re.search(r'itemprop="identifier"\s+content="(UC[A-Za-z0-9_-]{22})"', text))
    if not match:
        raise YoutubeError("channel_not_found")
    return match.group(1)


def parse_feed(text: str) -> list[dict]:
    """Die Einträge des Atom-Feeds - älteste zuerst, damit neue Videos in der richtigen Reihenfolge News werden."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise YoutubeError("feed_failed", f"Der Feed ist kein gültiges XML ({exc}).") from exc
    entries = []
    for entry in root.findall("atom:entry", NS):
        video_id = (entry.findtext("yt:videoId", default="", namespaces=NS) or "").strip()
        if not video_id:
            continue
        link = entry.find("atom:link", NS)
        group = entry.find("media:group", NS)
        thumbnail = group.find("media:thumbnail", NS) if group is not None else None
        entries.append({
            "video_id": video_id,
            "title": (entry.findtext("atom:title", default="", namespaces=NS) or "").strip(),
            "published_at": (entry.findtext("atom:published", default="", namespaces=NS) or "").strip(),
            "url": (link.get("href") if link is not None else "") or f"https://www.youtube.com/watch?v={video_id}",
            "thumbnail_url": (thumbnail.get("url") if thumbnail is not None else "") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "description": (group.findtext("media:description", default="", namespaces=NS) if group is not None else "").strip(),
        })
    entries.sort(key=lambda row: row["published_at"])
    return entries


async def is_short(client: httpx.AsyncClient, video_id: str) -> bool:
    """Kurzvideo? ``/shorts/<id>`` antwortet 200 für Shorts und leitet bei normalen Videos auf ``/watch`` um."""
    try:
        response = await client.head(SHORTS_URL.format(video_id=video_id), follow_redirects=False)
    except httpx.HTTPError:
        return False
    return response.status_code == 200


def excerpt_of(description: str) -> str:
    first = next((line.strip() for line in str(description or "").splitlines() if line.strip()), "")
    if not first:
        return DEFAULT_EXCERPT
    return first if len(first) <= 300 else first[:299].rstrip() + "…"


def video_news(entry: dict, *, publish: bool, slug: str) -> dict:
    """Die News zu einem Video - so, wie der Admin sie auch von Hand anlegen würde."""
    now = now_utc().isoformat()
    body = str(entry.get("description") or "").strip()
    content = (body + "\n\n" if body else "") + f"[Auf YouTube ansehen]({entry['url']})"
    return {
        "id": new_id(), "title": (entry.get("title") or "Neues Video")[:200], "slug": slug, "excerpt": excerpt_of(body), "content": content,
        "banner_url": entry.get("thumbnail_url") or None, "video_url": entry["url"], "category": "video", "visibility": "public",
        "published": bool(publish), "published_at": now if publish else None, "discord_skip": False, "share_preview": True, "pinned": False,
        "linked_event_ids": [], "linked_tournament_ids": [], "linked_f1_challenge_ids": [], "linked_team_ids": [], "mentioned_user_ids": [],
        "author_id": None, "author_name": "YouTube", "source": "youtube", "youtube_video_id": entry["video_id"],
        "created_at": now, "updated_at": now,
    }


async def _save(db, patch: dict) -> None:
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": patch, "$setOnInsert": {"id": SETTINGS_ID}}, upsert=True)


async def sync(db, *, force: bool = False) -> dict:
    """Den Feed holen und neue Videos als News anlegen. ``force`` auch bei ausgeschaltetem Abruf („Jetzt abrufen“)."""
    from services.slug_utils import unique_slug

    settings = merge_settings(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))
    outcome = {"created": 0, "seen": 0, "skipped_shorts": 0, "baseline": False, "error": None, "skipped": None}
    if not settings["enabled"] and not force:
        outcome["skipped"] = "disabled"
        return outcome
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "youtube_url": 1}) or {}
    url = settings["channel_url"] or str(branding.get("youtube_url") or "").strip()
    now = now_utc().isoformat()
    try:
        if not url:
            raise YoutubeError("no_channel")
        async with _client() as client:
            channel_id = settings.get("channel_id") if settings.get("channel_id_for") == url else ""
            if not channel_id:
                channel_id = await resolve_channel_id(client, url)
                await _save(db, {"channel_id": channel_id, "channel_id_for": url})
            response = await client.get(FEED_URL.format(channel_id=channel_id))
            if response.status_code != 200:
                raise YoutubeError("feed_failed", f"Der Feed antwortet {response.status_code}.")
            entries = parse_feed(response.text)
            if not entries:
                raise YoutubeError("feed_empty")
            known = {row["video_id"] async for row in db.youtube_videos.find({"channel_id": channel_id}, {"_id": 0, "video_id": 1})}
            first_run = not known and not settings.get("baseline_at")
            for entry in entries:
                if entry["video_id"] in known:
                    continue
                row = {"id": new_id(), "channel_id": channel_id, "video_id": entry["video_id"], "title": entry["title"],
                       "published_at": entry["published_at"], "url": entry["url"], "seen_at": now, "news_id": None, "outcome": "baseline"}
                if not first_run:
                    if not settings["include_shorts"] and await is_short(client, entry["video_id"]):
                        row["outcome"] = "short_skipped"
                        outcome["skipped_shorts"] += 1
                    else:
                        slug = await unique_slug(db.news_posts, entry["title"], fallback="video")
                        doc = video_news(entry, publish=settings["publish"], slug=slug)
                        await db.news_posts.insert_one(doc)
                        row["news_id"] = doc["id"]
                        row["outcome"] = "published" if settings["publish"] else "draft"
                        outcome["created"] += 1
                await db.youtube_videos.insert_one(row)
                outcome["seen"] += 1
            outcome["baseline"] = first_run
            newest = entries[-1]
            patch = {"last_run_at": now, "last_error": None,
                     "last_video": {"video_id": newest["video_id"], "title": newest["title"], "published_at": newest["published_at"], "url": newest["url"]}}
            if first_run:
                patch["baseline_at"] = now
            await _save(db, patch)
    except YoutubeError as exc:
        outcome["error"] = exc.text
        await _save(db, {"last_run_at": now, "last_error": exc.text})
    except httpx.HTTPError as exc:
        logger.warning("[youtube] %s", type(exc).__name__)
        outcome["error"] = ERROR_TEXTS["unreachable"]
        await _save(db, {"last_run_at": now, "last_error": ERROR_TEXTS["unreachable"]})
    return outcome


async def status(db) -> dict:
    """Für die Seite unter Verbindungen → YouTube: Schalter, Kanal, letzter Abruf, letztes Video, Zähler."""
    settings = merge_settings(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "youtube_url": 1}) or {}
    channel_id = settings.get("channel_id") or ""
    return {
        "enabled": settings["enabled"], "publish": settings["publish"], "include_shorts": settings["include_shorts"],
        "channel_url": settings["channel_url"], "branding_url": str(branding.get("youtube_url") or "").strip(),
        "channel_id": channel_id, "feed_url": FEED_URL.format(channel_id=channel_id) if channel_id else "",
        "last_run_at": settings.get("last_run_at"), "last_error": settings.get("last_error"), "last_video": settings.get("last_video"),
        "baseline_at": settings.get("baseline_at"), "interval_minutes": SYNC_INTERVAL_MINUTES,
        "videos_seen": await db.youtube_videos.count_documents({}),
        "news_created": await db.youtube_videos.count_documents({"news_id": {"$ne": None}}),
    }
