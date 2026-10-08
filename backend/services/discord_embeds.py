"""Live-Einbettungen im Discord (#569): eine Nachricht je Kanal, die der Bot aktuell hält.

Statt immer neuer Meldungen postet der Bot je Einbettung **eine** Nachricht, pinnt sie und
**bearbeitet** sie danach: die Rangliste der laufenden Saison (Top 10), die nächsten fünf Events
und Turniere (Wiener Zeit, Stand der Anmeldung) und den Erfolg der Woche. Je Einbettung wählt der
Betreiber unter Verbindungen → Discord einen Kanal und schaltet sie ein. Wer gerade streamt, zeigen seit
#883 die Stream-Meldungen (``discord_streams``) - die frühere Übersicht „Live jetzt“ räumt ``retire`` ab.

Auslöser sind Änderungen (``request_refresh``: Ergebnis bestätigt, Event angelegt) - gebündelt auf
höchstens eine Bearbeitung je Einbettung pro Minute (Discord-Limit),
und ein Sammler alle zehn Minuten schreibt „Stand: 18:32 Uhr“ in die Fußzeile neu. Gleicher Inhalt
wird nicht noch einmal geschickt (``content_hash``). Ist die Nachricht gelöscht, postet der Bot neu.

Das Aussehen kommt seit #866 aus der Gestaltung (``discord_design``): hier entstehen nur die Werte (``*_context``),
die Vorlage - eigene Fassung oder Standard - macht daraus die Einbettung.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from models import now_utc
from services import discord_design
from services.log_safe import log_safe

logger = logging.getLogger("tls.discord.embeds")

KINDS = {
    "ranking": {"label": "Rangliste", "hint": "Die Jahreswertung der laufenden Saison: Top 10 mit Punkten und Link."},
    "events": {"label": "Nächste Events", "hint": "Die nächsten fünf Events und Turniere mit Wiener Zeit und Stand der Anmeldung."},
    # Erfolge II (#622): einmal je Woche neu, nur Personen mit öffentlichem Profil und öffentlichen Erfolgen.
    "achievement_week": {"label": "Erfolg der Woche", "hint": "Die seltenste Freischaltung der letzten Woche – mit Person (nur öffentliche Profile), Material und Seltenheit."},
}
COLORS = {"ranking": 0xFFD700, "events": 0x29B6E8, "live": 0x9146FF, "achievement_week": 0xA66BFF}
# Unterserver (#628): Rangliste und nächste Termine je Server - nur mit den Spielen dieses Servers. Der Erfolg der Woche
# gilt für den ganzen Verein und bleibt am Hauptserver. Der Zustand steht am Server-Eintrag (``discord_guilds.embeds``).
SUB_KINDS = ("ranking", "events")
# „Live jetzt“ (#883, Entscheidung des Betreibers vom 03.10.2026): keine angeheftete Übersicht mehr - wer live ist, zeigen
# die Stream-Meldungen (eine Nachricht je Stream, am Ende gelöscht). Die Vorlage „live“ bleibt für /wer-streamt.
RETIRED = ("live",)
MIN_EDIT_SECONDS = 60
FULL_INTERVAL_MINUTES = 10
VIENNA = ZoneInfo("Europe/Vienna")
REASON_TEXTS = {
    "disabled": "Einbettung ist ausgeschaltet.",
    "channel_missing": "Kein Kanal gewählt (Verbindungen → Discord → Einbettungen).",
    "throttled": "Höchstens eine Bearbeitung pro Minute – kommt gleich.",
    "unchanged": "Inhalt unverändert – nichts zu bearbeiten.",
    "build_failed": "Die Nachricht ließ sich nicht aufbauen",
    "server_off": "Der Server ist aus oder der Bot nicht mehr dort – nichts wird aktualisiert.",
    "no_games": "Diesem Server ist noch kein Spiel zugeordnet (Spiele → Spiel bearbeiten → Discord-Server).",
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


WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def vienna_day(value) -> str:
    """„Sa, 03.10.2026 · 18:00 Uhr“ - für die Feldnamen der Termine."""
    parsed = _dt(value)
    if not parsed:
        return ""
    local = parsed.astimezone(VIENNA)
    return f"{WEEKDAYS[local.weekday()]}, {local.strftime('%d.%m.%Y · %H:%M')} Uhr"


def _points(value) -> str:
    try:
        return f"{float(value):g}".replace(".", ",")
    except (TypeError, ValueError):
        return str(value)


def ranking_context(season: dict | None, standings: list[dict], origin: str, scope: str = "") -> tuple[dict, list[dict]]:
    """Top 10 der laufenden Saison als Werte - reine Rechnung, damit der Test sie ohne Discord prüft.
    ``scope`` (#628): die Spiele eines Unterservers - sie stehen hinter dem Saisonnamen."""
    if not season:
        return {"season": "keine laufende Saison", "season_url": f"{origin}/seasons"}, []
    rows = []
    for index, row in enumerate(standings[:10], start=1):
        rows.append({"medal": {1: "🥇", 2: "🥈", 3: "🥉"}.get(index, f"{index}."), "rank": str(index),
                     "name": row.get("display_name") or row.get("username") or "—",
                     "points": _points(row.get("points", row.get("total_points", 0)))})
    slug = season.get("slug") or season.get("id")
    title = season.get("title") or season.get("name") or "Saison"
    return {"season": f"{title} · {scope}" if scope else title, "season_url": f"{origin}/seasons/{slug}"}, rows


def events_context(items: list[dict], origin: str) -> tuple[dict, list[dict]]:
    """Die nächsten Termine aus derselben Liste wie der Kalender der Website."""
    rows = []
    for item in items[:25]:
        kind = item.get("kind")
        state = (item.get("phase") or {}).get("label") if isinstance(item.get("phase"), dict) else ""
        rows.append({"icon": {"event": "📅", "tournament": "🏆", "fastlap": "🏁"}.get(kind, "📅"), "date": vienna_day(item.get("start")),
                     "name": item.get("title") or "", "link": f"{origin}{item.get('path') or ''}",
                     "kind": {"event": "Event", "tournament": "Turnier", "fastlap": "Fast Lap"}.get(kind, "Termin"), "state": state or ""})
    return {}, rows


def live_context(streams: list[dict], origin: str, verdicts: dict | None = None) -> tuple[dict, list[dict]]:
    """Wer gerade streamt – dieselbe Regel wie die Startseite (nur freigeschaltete Kanäle); Name aus dem Mitgliederprofil."""
    rows = []
    for stream in streams[:25]:
        profile = ((verdicts or {}).get(stream.get("user_id")) or {}).get("member_profile") or {}
        login = str(stream.get("twitch_login") or "")
        rows.append({"streamer": profile.get("gamertag") or profile.get("display_name") or stream.get("display_name") or stream.get("username") or login or "—",
                     "login": login, "title": stream.get("title") or "", "game": stream.get("game_name") or "",
                     "viewers": str(int(stream.get("viewer_count") or 0)), "url": stream.get("stream_url") or (f"https://www.twitch.tv/{login}" if login else ""),
                     "preview": stream.get("thumbnail_url") or "", "avatar": "", "started": discord_design.vienna_time(stream.get("started_at")),
                     "profile": f"{origin}/members/{profile['slug']}" if profile.get("slug") else "", "platform": "Twitch"})
    return {}, rows


def achievement_week_context(doc: dict | None, origin: str) -> tuple[dict, list[dict]]:
    """Der Erfolg der Woche (#622): was die Website-Kachel zeigt - die Person nur mit öffentlichem Profil (das prüft
    schon die Auswahl), sonst „diese Woche keiner“."""
    award = (doc or {}).get("award")
    if not award:
        return {"achievement": "Diese Woche keiner", "description": "Diese Woche wurde kein Erfolg freigeschaltet, den wir zeigen dürfen – nächster Versuch am Montag.",
                "link": f"{origin}/achievements", "material_color": "#A66BFF", "group": "Erfolge"}, []
    user = award.get("user") or {}
    holders = int(award.get("holders") or 0)
    rarity = f"{float(award.get('percent') or 0):g}".replace(".", ",")
    color = str(award.get("material_color") or "").strip()
    return {"achievement": award.get("name") or "", "description": str(award.get("description") or "")[:300],
            "person": user.get("display_name") or user.get("username") or "", "material": award.get("material_name") or "",
            "rarity": f"{rarity} % – {'nur diese Person' if holders <= 1 else f'{holders} Personen'}", "group": award.get("group_name") or "Erfolge",
            "link": f"{origin}/u/{user.get('username')}" if user.get("username") else f"{origin}/achievements",
            "avatar": user.get("avatar_url") if str(user.get("avatar_url") or "").startswith("http") else "",
            "material_color": color if len(color.lstrip("#")) == 6 else "#A66BFF"}, []


def _common(origin: str, now: datetime | None) -> dict:
    return {"site": origin, "club": "THE LION SQUAD", "logo": f"{origin}/assets/brand/tls-favicon.png",
            "now": (now or now_utc()).astimezone(VIENNA).strftime("%d.%m.%Y, %H:%M Uhr")}


def _standard(kind: str, context: tuple[dict, list[dict]], origin: str, now: datetime | None) -> dict:
    values, rows = context
    return discord_design.render(kind, discord_design.default_template(kind), {**_common(origin, now), **values}, rows, now=now)["embed"]


def ranking_embed(season: dict | None, standings: list[dict], origin: str, now: datetime | None = None) -> dict:
    """Die Rangliste im Standard-Aussehen – für Tests und als Rückfall."""
    return _standard("ranking", ranking_context(season, standings, origin), origin, now)


def events_embed(items: list[dict], origin: str, now: datetime | None = None) -> dict:
    return _standard("events", events_context(items, origin), origin, now)


def live_embed(streams: list[dict], origin: str, now: datetime | None = None, verdicts: dict | None = None) -> dict:
    return _standard("live", live_context(streams, origin, verdicts), origin, now)


def achievement_week_embed(doc: dict | None, origin: str, now: datetime | None = None) -> dict:
    return _standard("achievement_week", achievement_week_context(doc, origin), origin, now)


def content_hash(rendered: dict) -> str:
    """Der Inhalt ohne Fußzeile und Zeitstempel – eine neue Uhrzeit allein ist keine Änderung."""
    embed = rendered.get("embed") if isinstance(rendered.get("embed"), dict) else rendered
    body = {key: value for key, value in embed.items() if key not in ("footer", "timestamp")}
    if rendered.get("content"):
        body["__content"] = rendered["content"]
    return hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


async def server_games(db, guild_id: str) -> tuple[set[str], str]:
    """Die Spiele eines Unterservers (#628) - eigene und geerbte Editionen - und ihre Namen für die Überschrift."""
    from services.discord_guild_store import games_by_guild

    games = (await games_by_guild(db)).get(str(guild_id)) or []
    names = [str(game.get("name") or "") for game in games if not game.get("inherited") and game.get("name")]
    return {game["id"] for game in games}, ", ".join(names)


async def _game_sources(db, games: set[str]) -> tuple[set[str], set[str]]:
    """Turniere und Fast-Lap-Challenges dieser Spiele - daran hängen Saisonpunkte und Termine."""
    wanted = {"game_id": {"$in": sorted(games)}}
    tournaments = {doc["id"] for doc in await db.tournaments.find(wanted, {"_id": 0, "id": 1}).to_list(5000)}
    fastlaps = {doc["id"] for doc in await db.f1_challenges.find(wanted, {"_id": 0, "id": 1}).to_list(5000)}
    return tournaments, fastlaps


def _of_games(item: dict, tournaments: set[str], fastlaps: set[str]) -> bool:
    """Gehört dieser Kalendereintrag zu den Spielen des Servers? Events tragen kein Spiel - sie bleiben am Hauptserver."""
    item_id = str(item.get("id") or "")
    if item.get("kind") == "tournament":
        return item_id.removesuffix("-anmeldeschluss") in tournaments
    return item.get("kind") == "fastlap" and item_id in fastlaps


async def context(db, kind: str, now: datetime | None = None, *, games: set[str] | None = None, scope: str = "") -> tuple[dict, list[dict]]:
    """Die Werte einer Einbettung aus den echten Daten der Website. ``games`` (#628): nur diese Spiele (Unterserver);
    ohne - am Hauptserver - alles."""
    from services.platform_links import frontend_url

    origin = (frontend_url() or "https://lionsquad.at").rstrip("/")
    if kind == "ranking":
        from services.season_service import _active_season, aggregate_leaderboard

        season = await _active_season(db)
        if not season:
            return ranking_context(None, [], origin)
        if games is None:
            return ranking_context(season, await aggregate_leaderboard(season_id=season["id"], limit=10), origin)
        tournaments, fastlaps = await _game_sources(db, games)
        rows = await aggregate_leaderboard(season_id=season["id"], limit=10, source_ids=sorted(tournaments | fastlaps)) if tournaments or fastlaps else []
        return ranking_context(season, rows, origin, scope)
    if kind == "events":
        from services.calendar_items import collect

        cutoff = (now or now_utc()).isoformat()
        items = [item for item in await collect(db, None) if item.get("start") and item["start"] >= cutoff]
        if games is not None:
            tournaments, fastlaps = await _game_sources(db, games)
            items = [item for item in items if _of_games(item, tournaments, fastlaps)]
        return events_context(items, origin)
    if kind == "achievement_week":
        from services.achievement_visibility import achievement_of_week

        return achievement_week_context(await achievement_of_week(db, now=now), origin)
    from services.stream_visibility import homepage_visibility

    streams = await db.live_streams.find({}, {"_id": 0}).sort("viewer_count", -1).to_list(50)
    verdicts = await homepage_visibility(db, [stream.get("user_id") for stream in streams])
    visible = [stream for stream in streams if (verdicts.get(stream.get("user_id")) or {}).get("visible")]
    return live_context(visible, origin, verdicts)


async def build(db, kind: str, now: datetime | None = None, *, games: set[str] | None = None, scope: str = "") -> dict:
    """Die Einbettung aus den echten Daten der Website im Aussehen der Gestaltung: ``{"content", "embed"}``."""
    values, rows = await context(db, kind, now, games=games, scope=scope)
    common = await discord_design.common_values(db, now)
    template = await discord_design.template_for(db, kind)
    return discord_design.render(kind, template, {**common, **values}, rows, now=now)


async def _config(db) -> tuple[dict, dict]:
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    embeds = settings.get("embeds") if isinstance(settings.get("embeds"), dict) else {}
    return settings, embeds


async def _save(db, kind: str, patch: dict, unset: tuple[str, ...] = (), *, guild_id: str | None = None) -> None:
    """Zustand einer Einbettung schreiben - am Hauptserver unter ``settings.discord.embeds``, sonst am Server-Eintrag (#628)."""
    if guild_id:
        from services.discord_guild_store import COLLECTION

        op: dict = {"$set": {f"embeds.{kind}.{key}": value for key, value in patch.items()}}
        if unset:
            op["$unset"] = {f"embeds.{kind}.{key}": "" for key in unset}
        await db[COLLECTION].update_one({"guild_id": guild_id}, op)
        return
    op = {"$set": {f"embeds.{kind}.{key}": value for key, value in patch.items()}, "$setOnInsert": {"id": "discord"}}
    if unset:
        op["$unset"] = {f"embeds.{kind}.{key}": "" for key in unset}
    await db.settings.update_one({"id": "discord"}, op, upsert=True)


async def _note(db, kind: str, now: datetime, paused: str, *, guild_id: str | None = None) -> None:
    """Der Lauf hat geprüft, durfte aber nichts schreiben (#883) - mit Grund, damit die Seite nicht still „Nachricht steht“ zeigt."""
    await _save(db, kind, {"checked_at": now.isoformat(), "paused": paused}, guild_id=guild_id)


async def refresh(db, kind: str, *, force: bool = False, now: datetime | None = None, guild_id: str | None = None) -> dict:
    """Eine Einbettung aktuell halten: bearbeiten, wenn sich der Inhalt geändert hat; neu posten, wenn die
    Nachricht weg ist; höchstens einmal pro Minute (``force`` überstimmt die Unveränderlichkeit, nie die Bremse).
    Jeder Lauf hält ``checked_at`` fest; bricht er ab, steht der Grund in ``paused`` bzw. ``error`` (#883).
    ``guild_id`` (#628): die Einbettung dieses Unterservers - nur mit den Spielen dieses Servers. Die Merkliste
    ``_dirty`` führt dann ``sweep``, nicht diese Funktion."""
    from discord_service import REASON_TEXTS as SEND_TEXTS
    from services.discord_bot import bot, bot_settings

    if kind not in KINDS or (guild_id and kind not in SUB_KINDS):
        raise KeyError(kind)
    settings, embeds = await _config(db)
    current = now or now_utc()
    games: set[str] | None = None
    scope = ""
    main = not guild_id
    if guild_id:
        from services.discord_guild_store import COLLECTION

        row = await db[COLLECTION].find_one({"guild_id": str(guild_id)}, {"_id": 0, "guild_id": 1, "role": 1, "enabled": 1, "left_at": 1, "embeds": 1})
        if not row or row.get("role") == "main":
            raise LookupError(guild_id)
        guild_id = row["guild_id"]
        state = (row.get("embeds") or {}).get(kind) or {}
    else:
        state = embeds.get(kind) or {}
    if not state.get("enabled"):
        if main:
            _dirty.discard(kind)
        return {"ok": False, "reason": "disabled", "error": REASON_TEXTS["disabled"]}
    if not str(state.get("channel_id") or "").strip():
        if main:
            _dirty.discard(kind)
        return {"ok": False, "reason": "channel_missing", "error": REASON_TEXTS["channel_missing"]}
    if not main and (not row.get("enabled") or row.get("left_at")):
        return {"ok": False, "reason": "server_off", "error": REASON_TEXTS["server_off"]}
    if not bool(settings.get("enabled", True)):
        await _note(db, kind, current, SEND_TEXTS["disabled"], guild_id=guild_id)
        return {"ok": False, "reason": "disabled", "error": SEND_TEXTS["disabled"]}
    if not bot_settings(settings)["enabled"]:
        await _note(db, kind, current, SEND_TEXTS["bot_off"], guild_id=guild_id)
        return {"ok": False, "reason": "bot_off", "error": SEND_TEXTS["bot_off"]}
    if not main:
        games, scope = await server_games(db, guild_id)
        if not games:
            await _note(db, kind, current, REASON_TEXTS["no_games"], guild_id=guild_id)
            return {"ok": False, "reason": "no_games", "error": REASON_TEXTS["no_games"]}
    last = _dt(state.get("updated_at"))
    if last and current - last < timedelta(seconds=MIN_EDIT_SECONDS):
        if main:
            _dirty.add(kind)
        return {"ok": False, "reason": "throttled", "error": REASON_TEXTS["throttled"]}

    try:
        rendered = await build(db, kind, current, games=games, scope=scope)
    except Exception as exc:  # noqa: BLE001 - ein Fehler beim Aufbauen darf den Job nicht still anhalten (#883)
        logger.warning("[discord-embeds] %s: Aufbau fehlgeschlagen: %s", log_safe(kind), type(exc).__name__)
        error = f"{REASON_TEXTS['build_failed']} ({type(exc).__name__})."
        await _save(db, kind, {"error": error, "checked_at": current.isoformat()}, guild_id=guild_id)
        return {"ok": False, "reason": "build_failed", "error": error}
    digest = content_hash(rendered)
    if state.get("message_id") and state.get("hash") == digest and not force:
        if main:
            _dirty.discard(kind)
        await _save(db, kind, {"checked_at": current.isoformat()}, unset=("paused",), guild_id=guild_id)
        return {"ok": True, "reason": "unchanged", "message_id": state.get("message_id")}
    embed = rendered["embed"]
    channel_id = str(state["channel_id"])
    message_id = str(state.get("message_id") or "")
    action = "edited"
    result: dict = {"ok": False, "reason": "error"}
    try:
        if message_id:
            result = await bot.edit_embed(channel_id, message_id, embed, content=rendered.get("content") or "")
            if not result.get("ok") and result.get("reason") == "unknown_message":
                message_id = ""
        if not message_id:
            action = "posted"
            result = await bot.send_embed(channel_id, embed, content=rendered.get("content"))
            if result.get("ok"):
                pinned = await bot.pin_message(channel_id, str(result.get("message_id")))
                result["pinned"] = bool(pinned.get("ok"))
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf den Job nicht anhalten
        logger.warning("[discord-embeds] %s: %s", log_safe(kind), type(exc).__name__)
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    stamp = current.isoformat()
    if result.get("ok"):
        patch = {"message_id": str(result.get("message_id") or message_id), "hash": digest, "updated_at": stamp, "checked_at": stamp, "error": None,
                 "last_action": action}
        if action == "posted":
            patch["posted_at"] = stamp
        await _save(db, kind, patch, unset=("paused",), guild_id=guild_id)
        if main:
            _dirty.discard(kind)
        return {"ok": True, "reason": action, "message_id": patch["message_id"], "pinned": result.get("pinned")}
    error = result.get("error") or SEND_TEXTS.get(result.get("reason") or "", "") or str(result.get("reason") or "error")
    await _save(db, kind, {"error": error, "checked_at": stamp,
                           "updated_at": stamp if result.get("reason") not in ("bot_offline",) else state.get("updated_at")}, guild_id=guild_id)
    return {"ok": False, "reason": result.get("reason") or "error", "error": error}


async def retire(db) -> dict:
    """Einmal aufräumen (#883): die angeheftete Nachricht einer weggefallenen Einbettung löscht der Bot - es ist seine eigene.
    Ihr Kanal geht als Vorschlag an die Stream-Meldungen, solange dort keiner steht; sind sie noch aus, steht „Wenn der Stream
    endet“ auf löschen. Eingeschaltet wird nichts. Ist der Bot gerade nicht verbunden, versucht es der nächste Lauf wieder."""
    from services.discord_bot import bot

    settings, embeds = await _config(db)
    streams = settings.get("streams") if isinstance(settings.get("streams"), dict) else {}
    retired = []
    for kind in RETIRED:
        state = embeds.get(kind)
        if not isinstance(state, dict):
            continue
        channel_id = str(state.get("channel_id") or "").strip()
        message_id = str(state.get("message_id") or "").strip()
        if channel_id and message_id:
            result = await bot.delete_message(channel_id, message_id)
            if not result.get("ok") and result.get("reason") in ("bot_offline", "http", "error"):
                continue
            if not result.get("ok"):
                logger.warning("[discord-embeds] alte Nachricht „%s“ nicht gelöscht: %s", kind, result.get("reason"))
        patch: dict = {}
        if channel_id and not str(streams.get("channel_id") or "").strip():
            patch["streams.channel_id"] = channel_id
        if not streams.get("enabled"):
            patch["streams.on_end"] = "delete"
        op: dict = {"$unset": {f"embeds.{kind}": ""}}
        if patch:
            op["$set"] = patch
        await db.settings.update_one({"id": "discord"}, op)
        retired.append(kind)
    return {"retired": retired}


async def _targets(db, kinds: list[str], embeds: dict) -> list[tuple[str, str | None]]:
    """Welche Nachrichten ein Lauf anfasst: je Art der Hauptserver (wenn an) und jeder eingeschaltete Unterserver,
    auf dem diese Art an ist (#628)."""
    from services.discord_guild_store import COLLECTION

    subs = await db[COLLECTION].find({"role": "sub", "enabled": True, "left_at": None}, {"_id": 0, "guild_id": 1, "embeds": 1}).to_list(200)
    targets: list[tuple[str, str | None]] = []
    for kind in kinds:
        if (embeds.get(kind) or {}).get("enabled"):
            targets.append((kind, None))
        if kind in SUB_KINDS:
            targets.extend((kind, row["guild_id"]) for row in subs if ((row.get("embeds") or {}).get(kind) or {}).get("enabled"))
    return targets


async def sweep(db, *, full: bool = False) -> dict:
    """Job: alle 60 s die geänderten Einbettungen, alle 10 min alle (mit neuem „Stand“) - dann auch das Aufräumen (#883).
    Je Art alle Server, auf denen sie an ist (#628); gebremst bleibt die Art vorgemerkt, bis jede Nachricht dran war."""
    if full:
        try:
            await retire(db)
        except Exception as exc:  # noqa: BLE001 - das Aufräumen darf die Einbettungen nicht aufhalten
            logger.warning("[discord-embeds] Aufräumen fehlgeschlagen: %s", type(exc).__name__)
    _, embeds = await _config(db)
    kinds = list(KINDS) if full else [kind for kind in KINDS if kind in _dirty]
    targets = await _targets(db, kinds, embeds)
    outcome = {"checked": len(targets), "edited": 0, "posted": 0, "errors": 0, "throttled": 0}
    throttled: set[str] = set()
    for kind, guild_id in targets:
        try:
            result = await refresh(db, kind, force=full, guild_id=guild_id)
        except LookupError:
            continue
        if result.get("ok") and result.get("reason") in ("edited", "posted"):
            outcome[result["reason"]] += 1
        elif result.get("reason") == "throttled":
            outcome["throttled"] += 1
            throttled.add(kind)
        elif not result.get("ok"):
            outcome["errors"] += 1
    _dirty.difference_update(set(kinds) - throttled)
    _dirty.update(throttled)
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
                     "updated_at": state.get("updated_at"), "checked_at": state.get("checked_at"), "paused": state.get("paused"),
                     "error": state.get("error"), "pending": kind in _dirty}
    return out
