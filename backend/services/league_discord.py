"""Liga im Discord (#1642): Spieltag-Zusammenfassung je Staffel und Saisonende-Meldung - je Season einstellbar.

- **Einstellung** ``league_seasons.discord_digest`` (Reiter „Termine“ der Season, ``GET|PUT /api/admin/leagues/seasons/{id}/discord``):
  ``matchday`` und ``season_end`` an/aus, ``channel_id`` (ein Kanal für beides), ``wait_hours`` (wie lange nach dem Ende der
  Spielwoche auf fehlende Ergebnisse gewartet wird), ``late`` (danach trotzdem melden, mit „x Spiele offen“) und ``table_rows``
  (Plätze im Tabellenausschnitt). **Ohne Einstellung ist alles aus** - es bleibt, wie es war. Die Folge-Season übernimmt die
  Einstellung (F.2 kopiert Season-Felder).
- **Spieltag fertig**, sobald jedes Spiel des Spieltags gewertet oder abgesagt ist - spätestens ``wait_hours`` nach dem Ende der
  Spielwoche mit den offenen Spielen dazu (nur mit ``late``). Ein Spieltag ohne ein einziges Ergebnis geht nie hinaus. Wer die
  Meldung später einschaltet, bekommt nur Spieltage, deren Frist danach endet - ohne Spielwoche zählt das letzte Ergebnis des
  Spieltags. Nichts Altes auf einmal.
- **Kanal nur aus der freigegebenen Liste** (Nr. 234): die öffentlichen „Kanäle je Zweck“ unter Verbindungen → Discord (Community,
  News, Events und Turniere - nie ein privater Zweck). Der Server prüft beim Speichern (422); fällt ein Kanal später aus der Liste,
  geht nichts mehr hinein und der Kasten sagt es.
- **Saisonende**, sobald die Season „beendet“ ist (alle Staffeln abgeschlossen, ``league_final._season_follows``): Meister, Auf- und
  Absteiger je Liga N (``league_final.build_pages``-Rechnung aus ``league_finale``), Link zur öffentlichen Season-Seite.
- **Nur, was Gäste sehen**: Season öffentlich (``public_season``), Staffel als Turnier sichtbar. Interne oder Leitungs-Seasons gehen
  nie hinaus, auch nicht mit Einstellung.
- **Nie doppelt** (``league_discord_posts``, eindeutiger ``dedupe_key``): Vor dem Senden wird der Schlüssel belegt, nur wer ihn
  belegt, sendet. Ein zweiter Lauf des Jobs - auch gleichzeitig auf zwei Servern - findet ihn und sendet nichts. Ein Fehlschlag
  wird höchstens ``MAX_ATTEMPTS``-mal wiederholt, frühestens nach ``RETRY_MINUTES`` - aber nur, wenn sicher nichts hinausging
  (``retryable``). Nach einem unklaren Fehler (Zeitüberschreitung, Discord 5xx) bleibt der Merker „unclear“ stehen und die Leitung
  sieht den Hinweis im Kasten (``problems``) - ebenso bei einem „sending“, das länger als ``RETRY_MINUTES`` hängt (Lauf abgebrochen),
  und bei einer Meldung, die sich nicht aufbauen ließ. Nach dem Nachsehen im Kanal gibt die Leitung sie mit „Noch einmal senden“
  frei (``release``, Nr. 239): Der nächste Lauf sendet sie genau einmal.
- **Nach einem Ausfall** (Nr. 240): Je Staffel geht nur der neueste fertige Spieltag hinaus; ältere, die liegen geblieben sind,
  bekommen den Merker „skipped“ (Grund ``missed``) und gehen nie hinaus.
- **Kein Rückfall**: ohne Kanal, ohne Bot oder mit Discord aus wird nichts gesendet und nichts belegt.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_discord")

FIELD = "discord_digest"
COLLECTION = "league_discord_posts"
DEFAULTS = {"matchday": False, "season_end": False, "channel_id": "", "wait_hours": 48, "late": True, "table_rows": 5}
RANGES = {"wait_hours": (0, 336), "table_rows": (0, 20)}
MAX_ATTEMPTS = 3
RETRY_MINUTES = 30
MAX_POSTS_PER_RUN = 10
SEASON_LIMIT = 200
MATCH_LIMIT = 2000
SETTLED = frozenset({"completed", "forfeit", "cancelled", "archived", "bye"})
DECIDED = frozenset({"completed", "forfeit"})
COLOR = 0x29B6E8
GOLD = 0xD4A84B
# Ein Embed trägt höchstens 4096 Zeichen Beschreibung und 1024 je Feld - darüber fallen ganze Zeilen weg, nie ein halber Name.
DESCRIPTION_MAX = 3900
FIELD_MAX = 1000
# Und insgesamt (Titel, Text, alle Felder) höchstens 6000 - darüber fallen ganze Liga N weg, mit Hinweis auf die Season-Seite.
EMBED_MAX = 5900
# Sicher nichts hinausgegangen: Bot nicht verbunden, Kanal unbekannt, keine Schreibrechte - und eine 4xx-Antwort (abgewiesen).
SAFE_REASONS = frozenset({"bot_offline", "unknown_channel", "forbidden"})
UNCLEAR = "unclear"
SKIPPED = "skipped"
# Discord nimmt höchstens 10 Felder je Embed: 9 Liga N und der Hinweis „Weitere Ligen“ (K1).
MAX_LEAGUE_FIELDS = 9
UNCLEAR_TEXT = "Ob die Meldung ankam, ist unklar. Bitte im Kanal nachsehen - fehlt sie dort, gibst du sie mit „Noch einmal senden“ frei."
BUILD_TEXT = "Die Meldung ließ sich nicht aufbauen. Ist der Fehler behoben, gibst du sie mit „Noch einmal senden“ frei."
NOT_APPROVED = ("Dieser Kanal ist nicht freigegeben. Wählbar sind die öffentlichen Kanäle unter Verbindungen → Discord → "
                "Kanäle je Zweck (Community, News, Events und Turniere).")
MOVE_SIGNS = {"up": "▲", "down": "▼", "out": "✕"}


class DigestProblem(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.detail = message
        self.status_code = status_code


# ---------------------------------------------------------------- Einstellung

def _number(value, key: str) -> int:
    low, high = RANGES[key]
    if value is None or value == "" or isinstance(value, bool):
        return DEFAULTS[key]
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise DigestProblem(f"Bitte eine ganze Zahl von {low} bis {high} eintragen.") from None
    if not low <= number <= high:
        raise DigestProblem(f"Bitte eine ganze Zahl von {low} bis {high} eintragen.")
    return number


def channel_of(value) -> str:
    text = str(value or "").strip()
    return text if text.isdigit() else ""


def settings_of(season: dict | None) -> dict:
    """Die geltende Einstellung - fehlt sie oder ein Wert, gilt die Vorgabe (alles aus)."""
    raw = (season or {}).get(FIELD)
    raw = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULTS)
    out["matchday"] = raw.get("matchday") is True
    out["season_end"] = raw.get("season_end") is True
    out["late"] = raw.get("late") is not False
    out["channel_id"] = channel_of(raw.get("channel_id"))
    for key in RANGES:
        try:
            out[key] = _number(raw.get(key), key)
        except DigestProblem:
            out[key] = DEFAULTS[key]
    if raw.get("matchday_since"):
        out["matchday_since"] = raw["matchday_since"]
    return out


def normalize(body: dict, before: dict | None, now: datetime, approved: dict | None = None) -> dict:
    """Die Eingabe der Leitung geprüft. Wer etwas einschaltet, braucht einen Kanal - aus der freigegebenen Liste (``approved``,
    Kanal-ID → Zweck; ``None`` prüft nicht). ``matchday_since`` merkt sich, ab wann die Spieltag-Meldung gilt - frühere Spieltage
    gehen nicht nachträglich hinaus."""
    current = settings_of({FIELD: before or {}})
    out = {**current}
    for key in ("matchday", "season_end", "late"):
        if key in body and body[key] is not None:
            out[key] = bool(body[key])
    if "channel_id" in body and body["channel_id"] is not None:
        raw = str(body["channel_id"]).strip()
        if raw and not raw.isdigit():
            raise DigestProblem("Die Kanal-ID besteht nur aus Ziffern (in Discord: Rechtsklick auf den Kanal → Kanal-ID kopieren).")
        out["channel_id"] = raw
    for key in RANGES:
        if key in body:
            out[key] = _number(body[key], key)
    if (out["matchday"] or out["season_end"]) and not out["channel_id"]:
        raise DigestProblem("Bitte einen Kanal wählen - ohne Kanal geht nichts hinaus.")
    if approved is not None and (out["matchday"] or out["season_end"]) and out["channel_id"] not in approved:
        raise DigestProblem(NOT_APPROVED)
    if out["matchday"] and not current["matchday"]:
        out["matchday_since"] = now.isoformat()
    elif not out["matchday"]:
        out.pop("matchday_since", None)
    return out


# ---------------------------------------------------------------- Texte

def _esc(value) -> str:
    from services.discord_design import escape_markdown

    return escape_markdown(" ".join(str(value or "").split()))


def _fit(lines: list[str], limit: int, more: str) -> str:
    """Ganze Zeilen, bis das Feld voll ist - dann ein Satz, wie viele fehlen. Nie ein abgeschnittener Name."""
    out: list[str] = []
    used = 0
    for index, line in enumerate(lines):
        rest = len(lines) - index
        tail = len(more.format(n=rest)) + 1 if rest > 1 else 0
        if used + len(line) + 1 + tail > limit:
            out.append(more.format(n=rest))
            break
        out.append(line)
        used += len(line) + 1
    return "\n".join(out)


def result_line(match: dict) -> str:
    """Ein Spiel als Zeile: „Lions **2 : 0** Tigers“ - kampflos, abgesagt oder offen mit Wort."""
    home = _esc((match.get("home") or {}).get("name") or "offen")
    away = _esc((match.get("away") or {}).get("name") or "offen")
    status = match.get("status")
    if status == "cancelled":
        return f"{home} – {away} · abgesagt"
    if not match.get("done"):
        return f"{home} – {away} · offen"
    if match.get("double_forfeit"):
        return f"{home} – {away} · beide nicht angetreten"
    hs, aw = (match.get("home") or {}).get("score"), (match.get("away") or {}).get("score")
    score = f"**{_score(hs)} : {_score(aw)}**" if hs is not None and aw is not None else "**gewertet**"
    if match.get("forfeit"):
        winner = match.get("winner_registration_id")
        side = home if winner and winner == (match.get("home") or {}).get("registration_id") else away
        return f"{home} {score} {away} · kampflos für {side}"
    return f"{home} {score} {away}"


def _score(value) -> str:
    return str(int(value)) if isinstance(value, float) and value.is_integer() else str(value)


def open_text(count: int) -> str:
    return "1 Spiel offen" if count == 1 else f"{count} Spiele offen"


def table_lines(rows: list[dict], limit: int) -> list[str]:
    out = []
    for row in rows[:limit]:
        sign = {"promotion": " ▲", "relegation": " ▼", "out": " ✕"}.get(row.get("zone") or "", "")
        points = row.get("points")
        tail = f" · {_score(points)} Pkt." if isinstance(points, (int, float)) and not isinstance(points, bool) else ""
        out.append(f"{row.get('rank') or '–'}. {_esc(row.get('display_name') or 'Team')}{tail}{sign}")
    return out


def matchday_message(context: dict) -> dict:
    """Die Spieltag-Zusammenfassung: Titel, Text, Tabellenausschnitt, Link. ``context``: ``league``, ``season``, ``division``,
    ``staffel`` (nur bei mehreren Staffeln je Liga N), ``number``, ``matches`` (wie die Ligaseite), ``open``, ``table``, ``table_rows``, ``url``."""
    head = " · ".join(part for part in (f"Spieltag {context['number']}", context.get("division"),
                                         f"Staffel {context['staffel']}" if context.get("staffel") else None) if part)
    intro = " · ".join(_esc(part) for part in (context.get("league"), context.get("season")) if part)
    lines = [result_line(match) for match in context.get("matches") or []]
    opened = int(context.get("open") or 0)
    footer = open_text(opened) if opened else "Alle Spiele gewertet"
    body = _fit(lines, DESCRIPTION_MAX - len(intro) - len(footer) - 4, "… und {n} weitere Spiele auf der Ligaseite")
    fields = []
    rows = table_lines(context.get("table") or [], int(context.get("table_rows") or 0))
    if rows:
        more = len(context.get("table") or []) - len(rows)
        if more > 0:
            rows.append("… ganze Tabelle auf der Ligaseite")
        fields.append({"name": "Tabelle", "value": _fit(rows, FIELD_MAX, "… und {n} weitere Plätze"), "inline": False})
    return {"title": head, "description": "\n\n".join(part for part in (intro, body, f"*{footer}*") if part), "fields": fields,
            "url": context.get("url"), "color": COLOR, "buttons": [{"label": "Zur Ligaseite", "url": context["url"]}] if context.get("url") else []}


def mover_line(row: dict) -> str:
    name = _esc(row.get("name") or "Team")
    staffel = f" (Staffel {row['staffel']})" if row.get("staffel") else ""
    if row.get("move") == "out":
        return f"{MOVE_SIGNS['out']} {name}{staffel} scheidet aus"
    target = f" → {row['target']}" if row.get("target") else ""
    return f"{MOVE_SIGNS.get(row.get('move'), '')} {name}{staffel}{target}"


def season_end_message(context: dict) -> dict:
    """Die Saisonende-Meldung: Meister, je Liga N die Auf- und Absteiger, Link zur Season-Seite. ``context``: ``league``,
    ``season``, ``champions`` (Liste ``{name, staffel}``), ``pages`` (``league_finale.build_pages``), ``url``."""
    champions = context.get("champions") or []
    if len(champions) == 1:
        title_line = f"Meister: **{_esc(champions[0]['name'])}**"
    elif champions:
        title_line = "\n".join(f"Meister Staffel {row['staffel']}: **{_esc(row['name'])}**" if row.get("staffel")
                               else f"Meister: **{_esc(row['name'])}**" for row in champions)
    else:
        title_line = ""
    intro = f"{_esc(context.get('league'))}: Die Season ist abgeschlossen." if context.get("league") else "Die Season ist abgeschlossen."
    title = f"Saisonende · {context.get('season') or 'Season'}"
    description = "\n".join(part for part in (intro, title_line) if part)
    pages = (context.get("pages") or [])[:20]
    fields = []
    rest = "Weitere Ligen"
    # Platz für den Hinweis auf weggefallene Liga N bleibt immer frei - der Rest geht an die Liga N der Reihe nach.
    budget = EMBED_MAX - len(title) - len(description) - len(rest) - 60
    for index, page in enumerate(pages):
        lines = [mover_line(row) for row in page.get("rows") or []]
        if page.get("more"):
            lines.append(f"… und {page['more']} weitere auf der Season-Seite")
        value = _fit(lines, min(FIELD_MAX, budget - len(page["label"])), "… und {n} weitere auf der Season-Seite")
        if not value or len(page["label"]) + len(value) > budget:
            left = len(pages) - index
            fields.append({"name": rest, "value": f"… und {left} weitere Liga N auf der Season-Seite" if left > 1
                           else "… und eine weitere Liga N auf der Season-Seite", "inline": False})
            break
        fields.append({"name": page["label"], "value": value, "inline": False})
        budget -= len(page["label"]) + len(value)
    if not fields:
        fields.append({"name": "Auf- und Abstieg", "value": "In dieser Season steigt niemand auf oder ab.", "inline": False})
    return {"title": title, "description": description, "fields": fields, "url": context.get("url"), "color": GOLD,
            "buttons": [{"label": "Zur Season", "url": context["url"]}] if context.get("url") else []}


# ---------------------------------------------------------------- Spieltag fertig?

def matchday_due(games: list[dict], window_end: datetime | None, settings: dict, now: datetime) -> tuple[bool, int]:
    """Ist der Spieltag zu melden - und wie viele Spiele sind offen? Fertig: alles gewertet oder abgesagt. Mit ``late`` spätestens
    ``wait_hours`` nach dem Ende der Spielwoche, dann mit den offenen Spielen. Ohne ein einziges Ergebnis nie."""
    open_count = sum(1 for game in games if game.get("status") not in SETTLED)
    if not any(game.get("status") in DECIDED for game in games):
        return False, open_count
    if not open_count:
        return True, 0
    if not settings.get("late") or window_end is None:
        return False, open_count
    return now >= window_end + timedelta(hours=int(settings.get("wait_hours") or 0)), open_count


def _parse(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else None


# ---------------------------------------------------------------- Merker gegen Doppelversand

def retryable(result: dict) -> bool:
    """Ging sicher nichts hinaus? Nur dann darf derselbe Schlüssel noch einmal senden. Ein Fehler nach dem Absenden (Zeitüberschreitung,
    Discord 5xx, unbekannt) kann die Nachricht schon zugestellt haben - lieber keine zweite als eine doppelte."""
    reason = (result or {}).get("reason")
    if reason in SAFE_REASONS:
        return True
    if reason == "http":
        status = str((result or {}).get("error") or "").removeprefix("Discord ").split(":", 1)[0].strip()
        return status.isdigit() and 400 <= int(status) < 500
    return False


async def blocked(db, key: str, now: datetime) -> bool:
    """Vorprüfung ohne Belegen: gesendet, unterwegs, unklar, aufgegeben oder noch in der Wartezeit vor dem nächsten Versuch - dann
    braucht der Lauf weder Namen noch Tabelle."""
    row = await db[COLLECTION].find_one({"dedupe_key": key}, {"_id": 0, "status": 1, "attempts": 1, "claimed_at": 1})
    if not row:
        return False
    if row.get("status") != "failed":
        return True
    cutoff = (now - timedelta(minutes=RETRY_MINUTES)).isoformat()
    return int(row.get("attempts") or 0) >= MAX_ATTEMPTS or str(row.get("claimed_at") or "") >= cutoff

async def claim(db, key: str, doc: dict, now: datetime) -> bool:
    """Den Schlüssel belegen - ``True`` nur für den, der ihn belegt hat. Ein Fehlschlag darf nach ``RETRY_MINUTES`` noch einmal,
    insgesamt höchstens ``MAX_ATTEMPTS``-mal. Ein Eintrag „sending“ (Lauf abgebrochen) bleibt: lieber keine als zwei Meldungen."""
    stamp = now.isoformat()
    try:
        result = await db[COLLECTION].update_one(
            {"dedupe_key": key},
            {"$setOnInsert": {**doc, "dedupe_key": key, "status": "sending", "attempts": 1, "claimed_at": stamp, "created_at": stamp}},
            upsert=True)
    except DuplicateKeyError:
        return False
    if getattr(result, "upserted_id", None) is not None:
        return True
    cutoff = (now - timedelta(minutes=RETRY_MINUTES)).isoformat()
    retried = await db[COLLECTION].update_one(
        {"dedupe_key": key, "status": "failed", "attempts": {"$lt": MAX_ATTEMPTS}, "claimed_at": {"$lt": cutoff}},
        {"$set": {"status": "sending", "claimed_at": stamp}, "$inc": {"attempts": 1}})
    return bool(retried.modified_count)


async def _send(db, key: str, channel_id: str, message: dict, now: datetime) -> bool:
    from services import discord_links
    from services.discord_runtime import bot

    # Der Aufbau gehört mit ins try (M2): Wirft er, ging sicher nichts hinaus - die Meldung gilt sofort als aufgegeben und steht im
    # Kasten, statt still als „sending“ zu hängen.
    try:
        embed = await discord_links.build_embed(message["title"], message["description"], color=message["color"], url=message.get("url"),
                                                fields=message.get("fields"))
        buttons = await discord_links.resolve_buttons(message.get("buttons"))
    except Exception:  # noqa: BLE001 - ein Fehler beim Aufbau darf den Job nicht abbrechen
        logger.warning("[league_discord] Meldung %s nicht aufgebaut", log_safe(key), exc_info=True)
        await db[COLLECTION].update_one({"dedupe_key": key}, {"$set": {"status": "failed", "attempts": MAX_ATTEMPTS, "channel_id": channel_id,
                                                                       "error": "build"}})
        return False
    try:
        result = await bot.send_embed(channel_id, embed, buttons)
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf den Job nicht abbrechen
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if result.get("ok"):
        await db[COLLECTION].update_one({"dedupe_key": key}, {"$set": {"status": "sent", "message_id": str(result.get("message_id") or ""),
                                                                       "channel_id": channel_id, "sent_at": now.isoformat(), "error": None}})
        return True
    status = "failed" if retryable(result) else UNCLEAR
    await db[COLLECTION].update_one({"dedupe_key": key}, {"$set": {"status": status, "channel_id": channel_id,
                                                                   "error": str(result.get("reason") or result.get("error") or "error")[:200]}})
    logger.info("[league_discord] Meldung %s nicht gesendet: %s", log_safe(key), log_safe(result.get("reason")))
    return False


# ---------------------------------------------------------------- Der Job

def approved_channels(discord_settings: dict | None) -> dict[str, str]:
    """Die freigegebenen Kanäle (Nr. 234): die öffentlichen „Kanäle je Zweck“ des Hauptservers - Kanal-ID → Zweck. Private Zwecke
    (Vorstand, Betrieb, Test, Mitglieder) nie: Hier steht nur, was Gäste sehen."""
    from services.discord_targets import PUBLIC_TARGETS, TARGET_LABELS

    stored = (discord_settings or {}).get("channels")
    stored = stored if isinstance(stored, dict) else {}
    out: dict[str, str] = {}
    for target in PUBLIC_TARGETS:
        channel = channel_of(stored.get(target))
        if channel and channel not in out:
            out[channel] = TARGET_LABELS[target].replace(" (Standard)", "")
    return out


async def approved(db) -> dict[str, str]:
    return approved_channels(await db.settings.find_one({"id": "discord"}, {"_id": 0, "channels": 1}))


async def _discord_ready(db) -> bool:
    from services.discord_runtime import bot_settings

    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    return bool(settings.get("enabled", True)) and bot_settings(settings)["enabled"]


async def _names(db, tournament_id: str) -> dict:
    from services import league_page

    registrations = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": {"$in": [*league_page.PUBLIC_REGISTRATION_STATUSES, "withdrawn", "disqualified"]}},
        {"_id": 0, "id": 1, "display_name": 1, "team_name": 1, "squad_name": 1, "team_id": 1}).to_list(500)
    return {row["id"]: league_page.registration_view(row) for row in registrations if row.get("id")}


async def _table(db, tournament: dict) -> list[dict]:
    from routes.tournament_view_routes import _standing_rows

    try:
        rows = await _standing_rows(db, tournament, None, False)
    except Exception:  # noqa: BLE001 - ohne Tabelle geht die Zusammenfassung trotzdem hinaus
        logger.warning("[league_discord] Tabelle %s nicht lesbar", log_safe(tournament.get("id")), exc_info=True)
        return []
    return [row for row in rows if row.get("registration_id")]


def season_url(league: dict | None, season: dict | None, page: str = "") -> str | None:
    if not (league or {}).get("slug") or not (season or {}).get("slug"):
        return None
    return f"/liga/{league['slug']}/{season['slug']}{page}"


async def matchday_posts(db, season: dict, league: dict, settings: dict, now: datetime, budget: int) -> int:
    """Je Staffel der Season, die Gäste sehen: jeder fertige Spieltag genau einmal."""
    from services import league_page
    from services.league_finale import guest_sees_staffel
    from services.league_scope import ONLY_LEAGUE
    from services.league_service import division_label
    from services.matchday_schedule import matchday_number_of, tournament_matchday_window

    since = _parse(settings.get("matchday_since"))
    sent = 0
    staffeln = await db.tournaments.find({"league_context.season_id": season["id"], **ONLY_LEAGUE,
                                          "status": {"$nin": ["draft", "cancelled", "archived"]}}, {"_id": 0}).to_list(SEASON_LIMIT)
    divisions = {row["id"]: row for row in await db.league_divisions.find({"season_id": season["id"]}, {"_id": 0}).to_list(50)}
    per_division: dict[str, int] = {}
    for staffel in staffeln:
        per_division[(staffel.get("league_context") or {}).get("division_id")] = per_division.get(
            (staffel.get("league_context") or {}).get("division_id"), 0) + 1
    for staffel in sorted(staffeln, key=lambda row: str(row.get("title") or "")):
        if sent >= budget:
            break
        if not await guest_sees_staffel(staffel):
            continue
        context_ids = staffel.get("league_context") or {}
        matches = await db.matches_v2.find({"tournament_id": staffel["id"], "is_preview": {"$ne": True}}, {"_id": 0}).to_list(MATCH_LIMIT)
        by_day: dict[int, list[dict]] = {}
        for match in matches:
            number = matchday_number_of(match)
            if number:
                by_day.setdefault(number, []).append(match)
        names = None
        table = None
        for number in sorted(by_day):
            if sent >= budget:
                break
            try:
                window_end = tournament_matchday_window(staffel, number).end
            except Exception:  # noqa: BLE001 - ohne Spielwoche (kein Start) zählt nur „alles gewertet“
                window_end = None
            due, open_count = matchday_due(by_day[number], window_end, settings, now)
            if not due:
                continue
            # Später eingeschaltet: nur Spieltage, deren Meldefrist danach endet - ohne Spielwoche, deren letztes Ergebnis danach kam.
            if since and _before_switch_on(by_day[number], window_end, settings, since):
                continue
            key = f"matchday:{staffel['id']}:{number}"
            if await blocked(db, key, now):
                continue
            if names is None:
                names = await _names(db, staffel["id"])
                table = await _table(db, staffel)
            division = divisions.get(context_ids.get("division_id")) or {}
            games = sorted(by_day[number], key=lambda match: (match.get("order") or 0, match.get("match_key") or ""))
            message = matchday_message({
                "league": league.get("name"), "season": season.get("name"),
                "division": division_label(division) if division.get("level") is not None else None,
                "staffel": context_ids.get("staffel") if per_division.get(context_ids.get("division_id"), 0) > 1 else None,
                "number": number, "matches": [league_page.public_match(match, names) for match in games], "open": open_count,
                "table": table or [], "table_rows": settings["table_rows"], "url": season_url(league, season, "/spieltage"),
            })
            if not await claim(db, key, {"kind": "matchday", "season_id": season["id"], "tournament_id": staffel["id"], "matchday": number,
                                         "open": open_count}, now):
                continue
            await _send(db, key, settings["channel_id"], message, now)
            sent += 1
    return sent


def _last_result(games: list[dict]) -> datetime | None:
    stamps = [_parse(game.get("completed_at") or game.get("confirmed_at") or game.get("updated_at")) for game in games]
    stamps = [stamp for stamp in stamps if stamp]
    return max(stamps) if stamps else None


def _before_switch_on(games: list[dict], window_end: datetime | None, settings: dict, since: datetime) -> bool:
    """Gehört der Spieltag in die Zeit vor dem Einschalten? Mit Spielwoche: Die Meldefrist endete davor. Ohne: Das letzte Ergebnis kam
    davor - ohne jede Zeitangabe gilt er als alt (lieber keine Meldung als alte auf einmal)."""
    if window_end is not None:
        return window_end + timedelta(hours=int(settings.get("wait_hours") or 0)) < since
    last = _last_result(games)
    return last is None or last < since


async def season_end_post(db, season: dict, league: dict, settings: dict, now: datetime) -> int:
    """Ist die Season beendet: einmal die Meldung mit Meister, Auf- und Absteigern."""
    from services.league_finale import season_finals, season_pages

    if season.get("status") != "completed":
        return 0
    key = f"season_end:{season['id']}"
    if await blocked(db, key, now):
        return 0
    staffeln, finals = await season_finals(db, season)
    if not finals:
        return 0
    letters = {row["id"]: (row.get("league_context") or {}).get("staffel") for row in staffeln}
    with_champion = [final for final in finals if (final.get("champion") or {}).get("display_name")]
    champions = [{"name": final["champion"]["display_name"],
                  "staffel": letters.get(final.get("tournament_id")) if len(with_champion) > 1 else None}
                 for final in sorted(with_champion, key=lambda final: str(letters.get(final.get("tournament_id")) or ""))]
    message = season_end_message({"league": league.get("name"), "season": season.get("name"), "champions": champions,
                                  "pages": await season_pages(db, season), "url": season_url(league, season)})
    if not await claim(db, key, {"kind": "season_end", "season_id": season["id"]}, now):
        return 0
    await _send(db, key, settings["channel_id"], message, now)
    return 1


async def sweep(db, *, now: datetime | None = None) -> dict:
    """Der Job (Scheduler „league_discord“, alle 15 Minuten auf genau einem Server): je Season mit Einstellung melden, was fertig ist."""
    from services.profile_visibility import public_season

    current = now or now_utc()
    counts = {"matchday": 0, "season_end": 0}
    query = {"$or": [{f"{FIELD}.matchday": True}, {f"{FIELD}.season_end": True}], "status": {"$in": ["active", "completed"]},
             "visibility": "public"}
    seasons = await db.league_seasons.find(query, {"_id": 0}).to_list(SEASON_LIMIT)
    if not seasons or not await _discord_ready(db):
        return counts
    allowed = await approved(db)
    for season in seasons:
        settings = settings_of(season)
        if not settings["channel_id"] or settings["channel_id"] not in allowed or not public_season(season):
            continue
        league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "id": 1, "name": 1, "slug": 1}) or {}
        try:
            if settings["matchday"]:
                counts["matchday"] += await matchday_posts(db, season, league, settings, current, MAX_POSTS_PER_RUN - counts["matchday"])
            if settings["season_end"]:
                counts["season_end"] += await season_end_post(db, season, league, settings, current)
        except Exception:  # noqa: BLE001 - eine Season hält die anderen nicht auf
            logger.warning("[league_discord] Season %s nicht gemeldet", log_safe(season.get("id")), exc_info=True)
    return counts


# ---------------------------------------------------------------- Hinweise für die Leitung

PROBLEM_LIMIT = 20


def _open_query(season_id: str, now: datetime) -> dict:
    """Was die Leitung prüfen und freigeben kann: unklar, aufgegeben oder länger als ``RETRY_MINUTES`` „sending“ (Lauf abgebrochen)."""
    cutoff = (now - timedelta(minutes=RETRY_MINUTES)).isoformat()
    return {"season_id": season_id, "$or": [{"status": UNCLEAR}, {"status": "failed", "attempts": {"$gte": MAX_ATTEMPTS}},
                                            {"status": "sending", "claimed_at": {"$lt": cutoff}}]}


async def problems(db, season_id: str, now: datetime | None = None) -> list[dict]:
    """Was die Leitung wissen muss: Meldungen, deren Zustellung unklar ist (auch ein hängendes „sending“ - nie von selbst wiederholt),
    und solche, die aufgegeben wurden. Neueste zuerst; ``key`` ist der Schlüssel für „Noch einmal senden“."""
    from discord_service import REASON_TEXTS

    query = _open_query(season_id, now or now_utc())
    rows = await db[COLLECTION].find(query, {"_id": 0}).sort("claimed_at", -1).to_list(PROBLEM_LIMIT)
    titles = {}
    ids = sorted({row["tournament_id"] for row in rows if row.get("tournament_id")})
    if ids:
        titles = {row["id"]: row.get("title") or "" for row in await db.tournaments.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(len(ids))}
    out = []
    for row in rows:
        what = "Saisonende" if row.get("kind") == "season_end" else " · ".join(
            part for part in (f"Spieltag {row.get('matchday')}", titles.get(row.get("tournament_id"))) if part)
        status = UNCLEAR if row.get("status") in (UNCLEAR, "sending") else "failed"
        if status == UNCLEAR:
            text = UNCLEAR_TEXT
        elif row.get("error") == "build":
            text = BUILD_TEXT
        else:
            reason = REASON_TEXTS.get(row.get("error") or "") or "Discord hat die Meldung nicht angenommen."
            text = f"Nach {row.get('attempts')} Versuchen nicht gesendet. {reason}"
        out.append({"key": row["dedupe_key"], "kind": row.get("kind"), "label": what, "status": status, "text": text, "at": row.get("claimed_at")})
    return out


async def release(db, season_id: str, key: str, actor: dict | None, now: datetime | None = None) -> None:
    """„Noch einmal senden“ (Nr. 239): Die Leitung hat im Kanal nachgesehen, die Meldung fehlt. Atomar zurück auf „einen Versuch offen“
    - der nächste Lauf sendet sie genau einmal; ein zweiter Klick (oder ein zweites Fenster) findet nichts mehr freizugeben (409)."""
    current = now or now_utc()
    stamp = current.isoformat()
    freed = await db[COLLECTION].update_one(
        {"dedupe_key": key, **_open_query(season_id, current)},
        {"$set": {"status": "failed", "attempts": MAX_ATTEMPTS - 1, "claimed_at": "", "error": None,
                  "released_by": (actor or {}).get("id"), "released_at": stamp}})
    if not freed.modified_count:
        exists = await db[COLLECTION].count_documents({"dedupe_key": key, "season_id": season_id}, limit=1)
        raise DigestProblem("Diese Meldung ist schon freigegeben oder gesendet." if exists else "Diese Meldung gibt es nicht.",
                            409 if exists else 404)
    await db.audit_logs.insert_one({"id": new_id(), "action": "league.season.discord_release", "target_id": season_id,
                                    "actor_id": (actor or {}).get("id"), "data": {"key": key}, "created_at": stamp})
