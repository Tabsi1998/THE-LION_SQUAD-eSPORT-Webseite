"""Turnier-Bracket als Einbettung im Discord (#571).

Wer im Discord mitfiebert, sieht das Bracket dort: je laufendem Turnier eine Nachricht im Kanal
„Events und Turniere“ - Runden als Felder, je Zeile „**Paula** 2 : 1 Leon“, offene Partien mit
Termin; Gruppen- und Ligaphasen als Tabelle (Top 8); Link „Bracket ansehen“. Der Bot postet die
Nachricht einmal, pinnt sie und **bearbeitet** sie bei jedem bestätigten Ergebnis - gebremst auf eine
Bearbeitung pro Minute wie die anderen Einbettungen (#569); nach dem Turnierende ein letztes Mal als
„Endstand“ mit Podium. Große Brackets: nur die aktuelle und die nächste Runde vollständig, frühere und
spätere Runden zusammengefasst (Discord: höchstens 25 Felder, 1024 Zeichen je Feld, 6000 gesamt).
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from models import now_utc

logger = logging.getLogger("tls.discord.bracket")

FIELD = "discord_bracket_embed"
MIN_EDIT_SECONDS = 60
MAX_FIELDS = 12
FIELD_LIMIT = 1000
TOTAL_LIMIT = 5500
TOP_TABLE = 8
DONE = {"completed", "forfeit"}
LIVE = {"live", "in_progress", "running"}
TABLE_STAGE_TYPES = {"round_robin_groups", "round_robin", "league", "swiss"}
FINAL_STATUSES = {"completed", "results_published", "archived"}
SECTION_LABELS = {"wb": "Winner Bracket", "winner": "Winner Bracket", "main": "", "lb": "Loser Bracket", "loser": "Loser Bracket",
                  "gf": "Grand Final", "grand_final": "Grand Final", "final": "Finale", "bronze": "Spiel um Platz 3"}
VIENNA = ZoneInfo("Europe/Vienna")
_dirty: dict[str, bool] = {}   # Turnier-ID → letzte Fassung („Endstand“) gewünscht


def request_refresh(tournament_id: str, *, final: bool = False) -> None:
    if tournament_id:
        _dirty[tournament_id] = bool(_dirty.get(tournament_id)) or final


def pending() -> dict[str, bool]:
    return dict(_dirty)


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def section_label(section) -> str:
    key = str(section or "").strip()
    if not key:
        return ""
    if key.lower() in SECTION_LABELS:
        return SECTION_LABELS[key.lower()]
    if key.lower().startswith("group_"):
        return f"Gruppe {key[6:].upper()}"
    return key


def round_label(match: dict) -> str:
    name = str(match.get("round_name") or "").strip()
    if name:
        return name.replace("Round ", "Runde ").replace("Bronze Match", "Spiel um Platz 3")
    number = _safe_int(match.get("round"))
    return f"Runde {number}" if number else "Runde"


def _score(result: dict | None):
    if not result:
        return None
    for key in ("score", "points"):
        if result.get(key) is not None:
            return result[key]
    return None


def match_line(match: dict, names: dict[str, str]) -> str:
    """Eine Partie als Zeile: fertig mit Ergebnis (Sieger fett), offen mit Termin."""
    slots = sorted(match.get("slots") or [], key=lambda slot: _safe_int(slot.get("position"), 999))
    results = {row.get("registration_id"): row for row in match.get("results") or []}

    def name_of(slot):
        if not slot:
            return "offen"
        source = slot.get("source") or {}
        if not slot.get("registration_id"):
            return "Freilos" if source.get("type") == "bye" else "offen"
        return names.get(slot.get("registration_id")) or "Teilnehmer"

    a = slots[0] if slots else None
    b = slots[1] if len(slots) > 1 else None
    name_a, name_b = name_of(a), name_of(b)
    status = str(match.get("status") or "").lower()
    if status in DONE:
        result_a = results.get((a or {}).get("registration_id"))
        result_b = results.get((b or {}).get("registration_id"))
        winner_a = bool(result_a and result_a.get("outcome") == "winner")
        winner_b = bool(result_b and result_b.get("outcome") == "winner")
        left = f"**{name_a}**" if winner_a else name_a
        right = f"**{name_b}**" if winner_b else name_b
        score_a, score_b = _score(result_a), _score(result_b)
        if status == "forfeit":
            return f"{left} – {right} (kampflos)"
        if score_a is not None or score_b is not None:
            return f"{left} {score_a if score_a is not None else '–'} : {score_b if score_b is not None else '–'} {right}"
        return f"{left} – {right}"
    when = _dt(match.get("scheduled_at"))
    tail = " · live" if status in LIVE else (f" · {when.astimezone(VIENNA).strftime('%d.%m., %H:%M')} Uhr" if when else "")
    return f"{name_a} – {name_b}{tail}"


def _stage_of(match: dict, stages_by_id: dict[str, dict]) -> dict:
    return stages_by_id.get(match.get("stage_id")) or {}


def bracket_fields(matches: list[dict], stages: list[dict], registrations: list[dict], names: dict[str, str]) -> list[dict]:
    """Runden als Felder: die aktuelle und die nächste Runde je Abschnitt vollständig, der Rest als Zeile."""
    from services.competition_standings import round_robin_standings, stage_standings, swiss_standings

    stages_by_id = {stage.get("id"): stage for stage in stages if stage.get("id")}
    fields: list[dict] = []
    # Tabellenphasen: Top 8.
    table_stage_ids = {stage_id for stage_id, stage in stages_by_id.items() if str(stage.get("stage_type") or "") in TABLE_STAGE_TYPES}
    for stage_id in table_stage_ids:
        stage = stages_by_id[stage_id]
        stage_matches = [match for match in matches if match.get("stage_id") == stage_id]
        kind = str(stage.get("stage_type") or "")
        rows = swiss_standings(stage_matches, registrations) if kind == "swiss" else round_robin_standings(stage_matches, registrations) if kind in ("round_robin_groups", "round_robin", "league") else stage_standings(stage_matches, registrations)
        lines = []
        for index, row in enumerate(rows[:TOP_TABLE], start=1):
            points = row.get("points", 0)
            wins = row.get("won", row.get("wins", 0))
            lines.append(f"{index}. {row.get('display_name') or 'Teilnehmer'} · {points} Pkt · {wins} Siege")
        fields.append({"name": f"{stage.get('name') or 'Tabelle'} (Top {TOP_TABLE})"[:256], "value": ("\n".join(lines) or "Noch keine Partie gespielt.")[:FIELD_LIMIT], "inline": False})

    # Bracket-Phasen: je Abschnitt Runden.
    groups: dict[tuple, dict[int, list[dict]]] = {}
    for match in matches:
        if match.get("stage_id") in table_stage_ids or match.get("is_preview"):
            continue
        key = (_safe_int(_stage_of(match, stages_by_id).get("number"), _safe_int(match.get("stage_number"))), str(match.get("section") or "main").lower())
        groups.setdefault(key, {}).setdefault(_safe_int(match.get("round"), 1), []).append(match)
    for (stage_number, section), rounds in sorted(groups.items()):
        numbers = sorted(rounds)
        open_rounds = [number for number in numbers if any(str(m.get("status") or "").lower() not in DONE for m in rounds[number])]
        current = open_rounds[0] if open_rounds else numbers[-1]
        detailed = {current, current + 1}
        label = section_label(section)
        for number in numbers:
            round_matches = sorted(rounds[number], key=lambda m: _safe_int(m.get("order"), 0))
            title = " · ".join(part for part in (label, round_label(round_matches[0])) if part)
            done = sum(1 for m in round_matches if str(m.get("status") or "").lower() in DONE)
            if number in detailed:
                value = "\n".join(match_line(m, names) for m in round_matches)
            elif number < current:
                value = f"{done} von {len(round_matches)} Partien gespielt"
            else:
                value = f"{len(round_matches)} Partien, noch offen"
            fields.append({"name": title[:256], "value": (value or "–")[:FIELD_LIMIT], "inline": False})
    # Grenzen: höchstens MAX_FIELDS Felder und TOTAL_LIMIT Zeichen - Tabellen und die aktuellen Runden zuerst.
    total = 0
    kept: list[dict] = []
    for field in fields:
        size = len(field["name"]) + len(field["value"])
        if len(kept) >= MAX_FIELDS or total + size > TOTAL_LIMIT:
            break
        kept.append(field)
        total += size
    return kept


def podium_lines(matches: list[dict], registrations: list[dict]) -> list[str]:
    from services.competition_standings import elimination_standings

    rows = elimination_standings(matches, registrations)
    medals = ["🥇", "🥈", "🥉"]
    return [f"{medals[index]} {row.get('display_name') or 'Teilnehmer'}" for index, row in enumerate(rows[:3])]


def bracket_embed(tournament: dict, matches: list[dict], stages: list[dict], registrations: list[dict], origin: str,
                  now: datetime | None = None, *, final: bool = False) -> dict:
    """Die ganze Einbettung - reine Rechnung, damit der Test sie ohne Discord prüft."""
    names = {}
    for registration in registrations:
        if registration.get("id"):
            names[registration["id"]] = registration.get("display_name") or registration.get("ingame_name") or (registration.get("user") or {}).get("display_name") or "Teilnehmer"
    title = f"🏆 {tournament.get('title') or 'Turnier'} – {'Endstand' if final else 'Bracket'}"
    slug = tournament.get("slug") or tournament.get("id")
    link = f"{origin}/tournaments/{slug}/bracket"
    done = sum(1 for m in matches if str(m.get("status") or "").lower() in DONE)
    if final:
        lines = podium_lines(matches, registrations) or ["Kein Ergebnis eingetragen."]
        lines.append(f"\n{done} Partien gespielt. Alle Ergebnisse: {link}")
    else:
        lines = [f"{done} von {len(matches)} Partien gespielt – Bracket ansehen: {link}"] if matches else [f"Noch keine Partien – Bracket ansehen: {link}"]
    stamp = (now or now_utc()).astimezone(VIENNA).strftime("%d.%m.%Y, %H:%M")
    return {"title": title[:256], "description": "\n".join(lines)[:4000], "color": 0xFFD700 if final else 0x29B6E8, "url": link,
            "fields": bracket_fields(matches, stages, registrations, names), "image_url": None,
            "footer": f"{'Endstand' if final else 'Stand'}: {stamp} Uhr"}


def content_hash(embed: dict) -> str:
    body = {key: value for key, value in embed.items() if key != "footer"}
    return hashlib.sha1(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


async def build(db, tournament: dict, now: datetime | None = None, *, final: bool = False) -> dict:
    from services.competition_read import load_competition_read_model
    from services.competition_snapshot import adapt_stage_matches
    from services.platform_links import frontend_url

    read_model = await load_competition_read_model(db, tournament["id"])
    matches = adapt_stage_matches(read_model.stage_matches)
    registrations = await db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "user_id": 1}).to_list(500)
    origin = (frontend_url() or "https://lionsquad.at").rstrip("/")
    return bracket_embed(tournament, matches, read_model.stages, registrations, origin, now, final=final)


async def refresh(db, tournament_id: str, *, force: bool = False, final: bool | None = None, now: datetime | None = None) -> dict:
    """Die Bracket-Nachricht eines Turniers aktuell halten - posten, pinnen, bearbeiten; nach dem Ende einmal „Endstand“."""
    from discord_service import REASON_TEXTS, _get_discord_config, build_embed, resolve_target
    from services.discord_bot import bot

    current = now or now_utc()
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if not tournament:
        _dirty.pop(tournament_id, None)
        return {"ok": False, "reason": "unknown_tournament"}
    state = tournament.get(FIELD) or {}
    if final is None:
        final = str(tournament.get("status") or "") in FINAL_STATUSES
    if tournament.get("is_public") is False or (tournament.get("visibility") or "public") != "public":
        _dirty.pop(tournament_id, None)
        return {"ok": False, "reason": "private_visibility"}
    if state.get("final") and not force:
        _dirty.pop(tournament_id, None)
        return {"ok": False, "reason": "final", "message_id": state.get("message_id")}
    cfg = await _get_discord_config()
    if not cfg["master"]:
        return {"ok": False, "reason": "disabled", "error": REASON_TEXTS["disabled"]}
    if not cfg["bot"]["enabled"]:
        return {"ok": False, "reason": "bot_off", "error": REASON_TEXTS["bot_off"]}
    resolved = resolve_target(cfg, "events")
    channel_id = str(state.get("channel_id") or resolved["channel_id"] or "")
    if not channel_id:
        return {"ok": False, "reason": "channel_missing", "error": REASON_TEXTS["channel_missing"]}
    last = _dt(state.get("updated_at"))
    if last and current - last < timedelta(seconds=MIN_EDIT_SECONDS) and not (final and not state.get("final")):
        _dirty[tournament_id] = bool(_dirty.get(tournament_id)) or bool(final)
        return {"ok": False, "reason": "throttled"}

    raw = await build(db, tournament, current, final=bool(final))
    digest = content_hash(raw)
    if state.get("message_id") and state.get("hash") == digest and not force and not final:
        _dirty.pop(tournament_id, None)
        return {"ok": True, "reason": "unchanged", "message_id": state.get("message_id")}
    embed = await build_embed(raw["title"], raw["description"], color=raw["color"], url=raw["url"], fields=raw["fields"], footer=raw["footer"])
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
    except Exception as exc:  # noqa: BLE001
        logger.warning("[discord-bracket] %s: %s", tournament_id, type(exc).__name__)
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    stamp = current.isoformat()
    if result.get("ok"):
        patch = {"channel_id": channel_id, "message_id": str(result.get("message_id") or message_id), "hash": digest, "updated_at": stamp,
                 "error": None, "final": bool(final), "last_action": action}
        if action == "posted":
            patch["posted_at"] = stamp
        await db.tournaments.update_one({"id": tournament_id}, {"$set": {FIELD: {**state, **patch}}})
        _dirty.pop(tournament_id, None)
        return {"ok": True, "reason": action, "message_id": patch["message_id"], "final": bool(final), "pinned": result.get("pinned")}
    error = result.get("error") or REASON_TEXTS.get(result.get("reason") or "", "") or str(result.get("reason") or "error")
    await db.tournaments.update_one({"id": tournament_id}, {"$set": {f"{FIELD}.error": error}})
    return {"ok": False, "reason": result.get("reason") or "error", "error": error}


async def sweep(db, *, full: bool = False) -> dict:
    """Job: die vorgemerkten Turniere; alle zehn Minuten jedes laufende Turnier (und Beendete ein letztes Mal)."""
    outcome = {"checked": 0, "edited": 0, "posted": 0, "errors": 0, "throttled": 0}
    if full:
        live = await db.tournaments.find({"status": "live", "is_public": {"$ne": False}}, {"_id": 0, "id": 1}).to_list(200)
        ended = await db.tournaments.find({"status": {"$in": list(FINAL_STATUSES)}, f"{FIELD}.message_id": {"$exists": True}, f"{FIELD}.final": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(200)
        targets = {row["id"]: False for row in live}
        targets.update({row["id"]: True for row in ended})
    else:
        targets = dict(_dirty)
    for tournament_id, final in targets.items():
        outcome["checked"] += 1
        result = await refresh(db, tournament_id, final=True if final else None, force=full and not final)
        if result.get("ok") and result.get("reason") in ("edited", "posted"):
            outcome[result["reason"]] += 1
        elif result.get("reason") == "throttled":
            outcome["throttled"] += 1
        elif not result.get("ok") and result.get("reason") not in ("unchanged", "final", "private_visibility", "unknown_tournament"):
            outcome["errors"] += 1
    return outcome
