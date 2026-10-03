"""Stream-Meldungen je Stream (#866): eine Nachricht, sobald jemand aus dem Verein live geht - wie bei Stream-Bots.

Der Twitch-Abruf (jede Minute) ruft ``sync``: Ein neuer Stream bekommt eine Meldung im gewählten Kanal (Vorlage
„Stream gestartet“ aus der Gestaltung), ein laufender wird höchstens alle zehn Minuten aktualisiert (Zuschauer, Titel,
Spiel, neues Vorschaubild), ein beendeter wird zur Vorlage „Stream beendet“ - oder verschwindet, je nach Einstellung.

Gemeldet wird nur, wer auch auf der Startseite erscheinen darf (aktive Mitgliedschaft und Mitgliederprofil,
``stream_visibility``). Ohne Schalter, ohne Kanal, ohne Bot: keine Meldung - und kein Rückfall auf einen anderen Kanal.
Erwähnt wird höchstens die gewählte Rolle, und nur beim ersten Posten.

Einstellung ``settings.discord.streams``: ``enabled``, ``channel_id``, ``on_end`` („edit“ oder „delete“), ``role_id``.
Je Stream ein Eintrag in ``discord_stream_posts`` (Stream-ID, Kanal, Nachricht, Zeitpunkte, Inhalt-Hash).
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta

from models import now_utc
from services import discord_design

logger = logging.getLogger("tls.discord.streams")

COLLECTION = "discord_stream_posts"
UPDATE_MINUTES = 10
MAX_POSTS_PER_RUN = 5
END_MODES = ("edit", "delete")
REASON_TEXTS = {
    "disabled": "Stream-Meldungen sind aus (Verbindungen → Discord → Einbettungen & Termine → Stream-Meldungen).",
    "channel_missing": "Kein Kanal für Stream-Meldungen gewählt (Verbindungen → Discord → Einbettungen & Termine).",
}


def _dt(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else None


def config(settings: dict | None) -> dict:
    raw = (settings or {}).get("streams") if isinstance((settings or {}).get("streams"), dict) else {}
    # Vorgabe „löschen“ (#883): dann zeigt der Kanal immer, wer gerade live ist.
    on_end = raw.get("on_end") if raw.get("on_end") in END_MODES else "delete"
    role_id = str(raw.get("role_id") or "").strip()
    return {"enabled": bool(raw.get("enabled")), "channel_id": str(raw.get("channel_id") or "").strip(), "on_end": on_end,
            "role_id": role_id if role_id.isdigit() else ""}


def duration_text(start: datetime | None, end: datetime | None) -> str:
    """„2 Std. 14 Min.“ - unter einer Stunde nur Minuten."""
    if not start or not end or end < start:
        return ""
    minutes = int((end - start).total_seconds() // 60)
    hours, rest = divmod(minutes, 60)
    return f"{hours} Std. {rest} Min." if hours else f"{rest} Min."


async def stream_values(stream: dict, verdict: dict, common: dict, *, now: datetime) -> dict:
    """Die Werte einer Vorlage für einen Stream - Name und Bild aus dem Mitgliederprofil."""
    from discord_service import _public_avatar_url

    profile = (verdict or {}).get("member_profile") or {}
    origin = common["site"]
    login = str(stream.get("twitch_login") or "").strip()
    url = stream.get("stream_url") or (f"https://twitch.tv/{login}" if login else "")
    preview = str(stream.get("thumbnail_url") or "").strip()
    if preview:
        # Discord merkt sich Bilder nach Adresse - ein neuer Zusatz je zehn Minuten holt das aktuelle Vorschaubild.
        preview = f"{preview}{'&' if '?' in preview else '?'}t={int(now.timestamp() // (UPDATE_MINUTES * 60))}"
    avatar = await _public_avatar_url(profile.get("photo_url") or stream.get("avatar_url")) or ""
    slug = profile.get("slug")
    started = stream.get("started_at")
    return {
        **common,
        "streamer": profile.get("gamertag") or profile.get("display_name") or stream.get("display_name") or stream.get("username") or login,
        "login": login,
        "title": stream.get("title") or "",
        "game": stream.get("game_name") or "",
        "viewers": str(int(stream.get("viewer_count") or 0)),
        "url": url,
        "preview": preview,
        "avatar": avatar,
        "started": discord_design.vienna_time(started),
        "profile": f"{origin}/members/{slug}" if slug else "",
        "platform": "Twitch",
        "timestamp_iso": started or now.isoformat(),
    }


def _hash(rendered: dict) -> str:
    """Was zählt, ob bearbeitet wird: Inhalt ohne Zeitstempel und ohne den Zusatz am Vorschaubild."""
    embed = {key: value for key, value in rendered["embed"].items() if key not in ("timestamp", "image")}
    return hashlib.sha1(json.dumps({"content": rendered.get("content"), "embed": embed}, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


async def _visible_streams(db) -> list[tuple[dict, dict]]:
    from services.stream_visibility import homepage_visibility

    streams = await db.live_streams.find({}, {"_id": 0}).sort("viewer_count", -1).to_list(100)
    verdicts = await homepage_visibility(db, [stream.get("user_id") for stream in streams])
    return [(stream, verdicts[stream["user_id"]]) for stream in streams
            if stream.get("stream_id") and (verdicts.get(stream.get("user_id")) or {}).get("visible")]


async def _save_state(db, **fields) -> None:
    await db.settings.update_one({"id": "discord"}, {"$set": {f"streams_state.{key}": value for key, value in fields.items()},
                                                     "$setOnInsert": {"id": "discord"}}, upsert=True)


async def sync(db, *, now: datetime | None = None) -> dict:
    """Melden, aktualisieren, abschließen - einmal je Twitch-Abruf."""
    from services.discord_bot import bot, bot_settings

    current = now or now_utc()
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    cfg = config(settings)
    counts = {"posted": 0, "updated": 0, "ended": 0, "errors": 0}
    if not cfg["enabled"]:
        return {**counts, "reason": "disabled"}
    if not cfg["channel_id"]:
        return {**counts, "reason": "channel_missing"}
    if not bool(settings.get("enabled", True)) or not bot_settings(settings)["enabled"]:
        return {**counts, "reason": "bot_off"}

    common = await discord_design.common_values(db, current)
    live_template = await discord_design.template_for(db, "stream_live")
    end_template = await discord_design.template_for(db, "stream_ended")
    open_posts = {doc["stream_id"]: doc async for doc in db[COLLECTION].find({"ended_at": {"$exists": False}}, {"_id": 0})}
    live_ids: set[str] = set()
    last_error = None

    for stream, verdict in await _visible_streams(db):
        stream_id = str(stream["stream_id"])
        live_ids.add(stream_id)
        values = await stream_values(stream, verdict, common, now=current)
        post = open_posts.get(stream_id)
        buttons = [{"label": "Zuschauen", "url": values["url"]}] if values["url"] else None
        if post is None:
            if counts["posted"] >= MAX_POSTS_PER_RUN or await db[COLLECTION].count_documents({"stream_id": stream_id}, limit=1):
                continue
            role = f"<@&{cfg['role_id']}>" if cfg["role_id"] else ""
            rendered = discord_design.render("stream_live", live_template, {**values, "role": role}, now=current)
            result = await bot.send_embed(cfg["channel_id"], rendered["embed"], buttons, content=rendered["content"],
                                          mention_role_ids=[cfg["role_id"]] if cfg["role_id"] else None)
            if result.get("ok"):
                counts["posted"] += 1
                await db[COLLECTION].insert_one({"stream_id": stream_id, "user_id": stream.get("user_id"), "channel_id": cfg["channel_id"],
                                                 "message_id": str(result.get("message_id")), "posted_at": current.isoformat(),
                                                 "updated_at": current.isoformat(), "hash": _hash(rendered), "buttons": buttons or []})
            else:
                counts["errors"] += 1
                last_error = result.get("error") or result.get("reason")
            continue
        last = _dt(post.get("updated_at"))
        if last and current - last < timedelta(minutes=UPDATE_MINUTES):
            continue
        rendered = discord_design.render("stream_live", live_template, {**values, "role": ""}, now=current)
        digest = _hash(rendered)
        # Auch ohne neuen Inhalt alle zehn Minuten: das Vorschaubild ändert sich, der Hash sieht es nicht.
        result = await bot.edit_embed(post["channel_id"], post["message_id"], rendered["embed"], content=rendered["content"])
        if result.get("ok"):
            counts["updated"] += 1
            await db[COLLECTION].update_one({"stream_id": stream_id}, {"$set": {"updated_at": current.isoformat(), "hash": digest}})
        elif result.get("reason") == "unknown_message":
            # Jemand hat die Meldung gelöscht - dann bleibt es dabei, kein neues Posten.
            await db[COLLECTION].update_one({"stream_id": stream_id}, {"$set": {"ended_at": current.isoformat(), "end": "deleted_by_someone"}})
        else:
            counts["errors"] += 1
            last_error = result.get("error") or result.get("reason")

    for stream_id, post in open_posts.items():
        if stream_id in live_ids:
            continue
        session = await db.twitch_stream_sessions.find_one({"stream_id": stream_id}, {"_id": 0}) or {}
        if cfg["on_end"] == "delete":
            result = await bot.delete_message(post["channel_id"], post["message_id"])
        else:
            from services.stream_visibility import homepage_visibility

            verdict = (await homepage_visibility(db, [post.get("user_id")])).get(post.get("user_id")) or {}
            stream = {**session, "user_id": post.get("user_id"), "viewer_count": session.get("viewer_count_peak")}
            values = await stream_values(stream, verdict, common, now=current)
            ended_at = _dt(session.get("ended_at") or session.get("last_seen_at")) or current
            values.update({"duration": duration_text(_dt(session.get("started_at")), ended_at),
                           "peak": str(int(session.get("viewer_count_peak") or 0)), "preview": "", "timestamp_iso": ended_at.isoformat()})
            rendered = discord_design.render("stream_ended", end_template, values, now=current)
            result = await bot.edit_embed(post["channel_id"], post["message_id"], rendered["embed"], buttons=post.get("buttons") or [],
                                          content=rendered["content"] or "")
        if result.get("ok") or result.get("reason") == "unknown_message":
            counts["ended"] += 1
            await db[COLLECTION].update_one({"stream_id": stream_id}, {"$set": {"ended_at": current.isoformat(), "end": cfg["on_end"]}})
        elif result.get("reason") != "bot_offline":
            counts["errors"] += 1
            last_error = result.get("error") or result.get("reason")

    await _save_state(db, last_run_at=current.isoformat(), last_error=last_error, **({"last_posted_at": current.isoformat()} if counts["posted"] else {}))
    return counts


async def status(db) -> dict:
    """Für den Admin: Einstellung, laufende Meldungen, letzter Lauf und Fehler."""
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    state = settings.get("streams_state") if isinstance(settings.get("streams_state"), dict) else {}
    cfg = config(settings)
    reason = None if cfg["enabled"] and cfg["channel_id"] else ("disabled" if not cfg["enabled"] else "channel_missing")
    return {**cfg, "open": await db[COLLECTION].count_documents({"ended_at": {"$exists": False}}),
            "last_run_at": state.get("last_run_at"), "last_posted_at": state.get("last_posted_at"), "last_error": state.get("last_error"),
            "reason": reason, "reason_text": REASON_TEXTS.get(reason) if reason else None}
