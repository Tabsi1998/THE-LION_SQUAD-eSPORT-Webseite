"""Live-Einbettungen im Discord (#569): eine Nachricht je Kanal, die der Bot aktuell hält.

Statt immer neuer Meldungen postet der Bot je Einbettung **eine** Nachricht, pinnt sie und
**bearbeitet** sie danach: die Rangliste der laufenden Saison (Top 10), die nächsten fünf Events
und Turniere (Wiener Zeit, Stand der Anmeldung) und wer aus dem Verein gerade streamt. Je Einbettung
wählt der Betreiber unter Verbindungen → Discord einen Kanal und schaltet sie ein.

Auslöser sind Änderungen (``request_refresh``: Ergebnis bestätigt, Event angelegt, Stream beginnt
oder endet) - gebündelt auf höchstens eine Bearbeitung je Einbettung pro Minute (Discord-Limit),
und ein Sammler alle zehn Minuten schreibt „Stand: 18:32 Uhr“ in die Fußzeile neu. Gleicher Inhalt
wird nicht noch einmal geschickt (``content_hash``). Ist die Nachricht gelöscht, postet der Bot neu.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from models import now_utc

logger = logging.getLogger("tls.discord.embeds")

KINDS = {
    "ranking": {"label": "Rangliste", "hint": "Die Jahreswertung der laufenden Saison: Top 10 mit Punkten und Link."},
    "events": {"label": "Nächste Events", "hint": "Die nächsten fünf Events und Turniere mit Wiener Zeit und Stand der Anmeldung."},
    "live": {"label": "Live jetzt", "hint": "Wer aus dem Verein gerade streamt, mit Link – leer heißt „gerade streamt niemand“."},
}
COLORS = {"ranking": 0xFFD700, "events": 0x29B6E8, "live": 0x9146FF}
MIN_EDIT_SECONDS = 60
FULL_INTERVAL_MINUTES = 10
VIENNA = ZoneInfo("Europe/Vienna")
REASON_TEXTS = {
    "disabled": "Einbettung ist ausgeschaltet.",
    "channel_missing": "Kein Kanal gewählt (Verbindungen → Discord → Einbettungen).",
    "throttled": "Höchstens eine Bearbeitung pro Minute – kommt gleich.",
    "unchanged": "Inhalt unverändert – nichts zu bearbeiten.",
}
# Was geändert wurde und noch nicht in der Nachricht steht (ein API-Prozess, siehe change_events).
_dirty: set[str] = set()


def request_refresh(*kinds: str) -> None:
    """Merken, dass sich etwas geändert hat; der Job alle 60 s bearbeitet dann die Nachricht."""
    _dirty.update(kind for kind in kinds if kind in KINDS)


def pending() -> set[str]:
    return set(_dirty)


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def stand_footer(now: datetime | None = None) -> str:
    return f"Stand: {(now or now_utc()).astimezone(VIENNA).strftime('%d.%m.%Y, %H:%M')} Uhr"


def vienna(value) -> str:
    parsed = _dt(value)
    return parsed.astimezone(VIENNA).strftime("%d.%m.%Y, %H:%M Uhr") if parsed else ""


def _embed(kind: str, title: str, description: str, *, url: str | None, now: datetime | None) -> dict:
    return {"title": title[:256], "description": description[:4000], "color": COLORS[kind], "url": url, "fields": [], "image_url": None,
            "footer": stand_footer(now)}


def ranking_embed(season: dict | None, standings: list[dict], origin: str, now: datetime | None = None) -> dict:
    """Top 10 der laufenden Saison – reine Rechnung, damit der Test sie ohne Discord prüft."""
    if not season:
        return _embed("ranking", "🏆 Rangliste", "Keine laufende Saison – die nächste Wertung startet mit der neuen Saison.", url=f"{origin}/seasons", now=now)
    lines = []
    for index, row in enumerate(standings[:10], start=1):
        name = row.get("display_name") or row.get("username") or "—"
        points = row.get("points", row.get("total_points", 0))
        try:
            points_text = f"{float(points):g}".replace(".", ",")
        except (TypeError, ValueError):
            points_text = str(points)
        medal = {1: "🥇", 2: "🥈", 3: "🥉"}.get(index, f"{index}.")
        lines.append(f"{medal} **{name}** – {points_text} Punkte")
    if not lines:
        lines.append("Noch keine Punkte vergeben.")
    slug = season.get("slug") or season.get("id")
    return _embed("ranking", f"🏆 Rangliste – {season.get('title') or season.get('name') or 'Saison'}", "\n".join(lines), url=f"{origin}/seasons/{slug}", now=now)


def events_embed(items: list[dict], origin: str, now: datetime | None = None) -> dict:
    """Die nächsten fünf Termine aus derselben Liste wie der Kalender der Website."""
    lines = []
    for item in items[:5]:
        kind = {"event": "Event", "tournament": "Turnier", "fastlap": "Fast Lap"}.get(item.get("kind"), "Termin")
        state = (item.get("phase") or {}).get("label") if isinstance(item.get("phase"), dict) else ""
        parts = [f"**{item.get('title')}**", vienna(item.get("start")), kind]
        if state:
            parts.append(state)
        lines.append(" · ".join(part for part in parts if part) + f"\n<{origin}{item.get('path')}>")
    description = "\n".join(lines) if lines else "Nichts geplant – Termine folgen."
    return _embed("events", "📅 Nächste Events und Turniere", description, url=f"{origin}/calendar", now=now)


def live_embed(streams: list[dict], origin: str, now: datetime | None = None) -> dict:
    """Wer gerade streamt – dieselbe Regel wie die Startseite (nur freigeschaltete Kanäle)."""
    lines = []
    for stream in streams[:10]:
        name = stream.get("display_name") or stream.get("username") or stream.get("twitch_login") or "—"
        what = f" spielt {stream['game_name']}" if stream.get("game_name") else " ist live"
        title = f" – „{str(stream['title'])[:80]}“" if stream.get("title") else ""
        viewers = f" · {int(stream.get('viewer_count') or 0)} Zuschauer"
        lines.append(f"🔴 **{name}**{what}{title}{viewers}\n<{stream.get('stream_url') or 'https://www.twitch.tv/' + str(stream.get('twitch_login') or '')}>")
    description = "\n".join(lines) if lines else "Gerade streamt niemand."
    return _embed("live", "🔴 Live jetzt", description, url=f"{origin}/#live", now=now)


def content_hash(embed: dict) -> str:
    """Der Inhalt ohne Fußzeile – eine neue Uhrzeit allein ist keine Änderung."""
    body = {key: value for key, value in embed.items() if key != "footer"}
    return hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


async def build(db, kind: str, now: datetime | None = None) -> dict:
    """Die Einbettung aus den echten Daten der Website."""
    from services.platform_links import frontend_url

    origin = (frontend_url() or "https://lionsquad.at").rstrip("/")
    if kind == "ranking":
        from services.season_service import _active_season, aggregate_leaderboard

        season = await _active_season(db)
        rows = await aggregate_leaderboard(season_id=season["id"], limit=10) if season else []
        return ranking_embed(season, rows, origin, now)
    if kind == "events":
        from services.calendar_items import collect

        cutoff = (now or now_utc()).isoformat()
        items = [item for item in await collect(db, None) if item.get("start") and item["start"] >= cutoff]
        return events_embed(items, origin, now)
    from services.stream_visibility import homepage_visibility

    streams = await db.live_streams.find({}, {"_id": 0}).sort("viewer_count", -1).to_list(50)
    verdicts = await homepage_visibility(db, [stream.get("user_id") for stream in streams])
    visible = [stream for stream in streams if (verdicts.get(stream.get("user_id")) or {}).get("visible")]
    return live_embed(visible, origin, now)


async def _config(db) -> tuple[dict, dict]:
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    embeds = settings.get("embeds") if isinstance(settings.get("embeds"), dict) else {}
    return settings, embeds


async def _save(db, kind: str, patch: dict, unset: tuple[str, ...] = ()) -> None:
    op: dict = {"$set": {f"embeds.{kind}.{key}": value for key, value in patch.items()}, "$setOnInsert": {"id": "discord"}}
    if unset:
        op["$unset"] = {f"embeds.{kind}.{key}": "" for key in unset}
    await db.settings.update_one({"id": "discord"}, op, upsert=True)


async def refresh(db, kind: str, *, force: bool = False, now: datetime | None = None) -> dict:
    """Eine Einbettung aktuell halten: bearbeiten, wenn sich der Inhalt geändert hat; neu posten, wenn die
    Nachricht weg ist; höchstens einmal pro Minute (``force`` überstimmt die Unveränderlichkeit, nie die Bremse)."""
    from discord_service import REASON_TEXTS as SEND_TEXTS, build_embed
    from services.discord_bot import bot, bot_settings

    if kind not in KINDS:
        raise KeyError(kind)
    settings, embeds = await _config(db)
    state = embeds.get(kind) or {}
    current = now or now_utc()
    if not state.get("enabled"):
        _dirty.discard(kind)
        return {"ok": False, "reason": "disabled", "error": REASON_TEXTS["disabled"]}
    if not str(state.get("channel_id") or "").strip():
        _dirty.discard(kind)
        return {"ok": False, "reason": "channel_missing", "error": REASON_TEXTS["channel_missing"]}
    if not bool(settings.get("enabled", True)):
        return {"ok": False, "reason": "disabled", "error": SEND_TEXTS["disabled"]}
    if not bot_settings(settings)["enabled"]:
        return {"ok": False, "reason": "bot_off", "error": SEND_TEXTS["bot_off"]}
    last = _dt(state.get("updated_at"))
    if last and current - last < timedelta(seconds=MIN_EDIT_SECONDS):
        _dirty.add(kind)
        return {"ok": False, "reason": "throttled", "error": REASON_TEXTS["throttled"]}

    raw = await build(db, kind, current)
    digest = content_hash(raw)
    if state.get("message_id") and state.get("hash") == digest and not force:
        _dirty.discard(kind)
        return {"ok": True, "reason": "unchanged", "message_id": state.get("message_id")}
    embed = await build_embed(raw["title"], raw["description"], color=raw["color"], url=raw.get("url"), fields=raw.get("fields"), footer=raw.get("footer"))
    channel_id = str(state["channel_id"])
    message_id = str(state.get("message_id") or "")
    action = "edited"
    result: dict = {"ok": False, "reason": "error"}
    try:
        if message_id:
            result = await bot.edit_embed(channel_id, message_id, embed)
            if not result.get("ok") and result.get("reason") == "unknown_message":
                message_id = ""
        if not message_id:
            action = "posted"
            result = await bot.send_embed(channel_id, embed)
            if result.get("ok"):
                pinned = await bot.pin_message(channel_id, str(result.get("message_id")))
                result["pinned"] = bool(pinned.get("ok"))
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf den Job nicht anhalten
        logger.warning("[discord-embeds] %s: %s", kind, type(exc).__name__)
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    stamp = current.isoformat()
    if result.get("ok"):
        patch = {"message_id": str(result.get("message_id") or message_id), "hash": digest, "updated_at": stamp, "error": None, "last_action": action}
        if action == "posted":
            patch["posted_at"] = stamp
        await _save(db, kind, patch)
        _dirty.discard(kind)
        return {"ok": True, "reason": action, "message_id": patch["message_id"], "pinned": result.get("pinned")}
    error = result.get("error") or SEND_TEXTS.get(result.get("reason") or "", "") or str(result.get("reason") or "error")
    await _save(db, kind, {"error": error, "updated_at": stamp if result.get("reason") not in ("bot_offline",) else state.get("updated_at")})
    return {"ok": False, "reason": result.get("reason") or "error", "error": error}


async def sweep(db, *, full: bool = False) -> dict:
    """Job: alle 60 s die geänderten Einbettungen, alle 10 min alle (mit neuem „Stand“)."""
    _, embeds = await _config(db)
    kinds = [kind for kind in KINDS if (embeds.get(kind) or {}).get("enabled")] if full else [kind for kind in list(_dirty) if (embeds.get(kind) or {}).get("enabled")]
    outcome = {"checked": len(kinds), "edited": 0, "posted": 0, "errors": 0, "throttled": 0}
    for kind in kinds:
        result = await refresh(db, kind, force=full)
        if result.get("ok") and result.get("reason") in ("edited", "posted"):
            outcome[result["reason"]] += 1
        elif result.get("reason") == "throttled":
            outcome["throttled"] += 1
        elif not result.get("ok"):
            outcome["errors"] += 1
    return outcome


async def embeds_status(db) -> dict:
    """Für Verbindungen → Discord: je Einbettung Schalter, Kanal, Nachricht, letzter Stand, Fehler."""
    from services.discord_bot import read_state

    _, embeds = await _config(db)
    names = {str(row.get("id")): row.get("name") for row in ((await read_state(db)).get("channels") or []) if row.get("id")}
    out = {}
    for kind, spec in KINDS.items():
        state = embeds.get(kind) or {}
        channel_id = str(state.get("channel_id") or "")
        out[kind] = {"label": spec["label"], "hint": spec["hint"], "enabled": bool(state.get("enabled")), "channel_id": channel_id,
                     "channel_name": names.get(channel_id), "message_id": state.get("message_id"), "posted_at": state.get("posted_at"),
                     "updated_at": state.get("updated_at"), "error": state.get("error"), "pending": kind in _dirty}
    return out
