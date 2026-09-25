"""Turniere und Vereins-Events als Discord-Termine (#570).

Discord hat eigene Termine mit „Interessiert“-Knopf, Erinnerung und Anzeige oben in der Serverliste.
Ein Job gleicht alle fünf Minuten ab: jedes öffentliche Event und Turnier mit Beginn in der Zukunft
bekommt genau **einen** Discord-Termin (Name, Beschreibung, Beginn/Ende, Ort oder Link zur Website als
„extern“); ändern sich Zeit, Titel, Ort oder Text, wird der Termin bearbeitet; wird das Event
abgesagt, zum Entwurf oder „Ohne Discord“, wird der Termin abgesagt. Die Termin-ID steht am Event
(``discord_scheduled_event``), dazu ein Hash des Inhalts - gleicher Inhalt heißt kein Aufruf.

Interne Events (nur Mitglieder oder Vorstand) kommen nur mit dem Schalter „auch interne“ - der Server
ist dann als intern gedacht. Ein manuell im Discord gelöschter Termin wird beim nächsten Abgleich neu
angelegt, solange das Event noch ansteht; ein abgesagter bleibt abgesagt, bis das Event wieder aktiv wird.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone

from models import now_utc

logger = logging.getLogger("tls.discord.scheduled")

SETTINGS_KEY = "scheduled_events"
FIELD = "discord_scheduled_event"
DEFAULT_HOURS = {"event": 2, "tournament": 4}
MAX_OPS_PER_RUN = 20
ACTIVE_STATUSES = {"scheduled", "registration_open", "registration_closed", "checkin_open", "check_in", "live", "paused"}
REASON_TEXTS = {
    "disabled": "Discord-Termine sind ausgeschaltet (Verbindungen → Discord → Discord-Termine).",
    "author_opt_out": "„Ohne Discord“ ist angehakt – kein Termin.",
    "not_public": "Nur für Mitglieder oder den Vorstand sichtbar – Termine dafür nur mit dem Schalter „auch interne“.",
    "hidden": "Nicht öffentlich – kein Termin.",
    "status": "In diesem Stand (Entwurf, abgesagt, vorbei) gibt es keinen Termin.",
    "no_date": "Ohne Beginn kein Termin.",
    "past": "Der Beginn liegt in der Vergangenheit – Discord nimmt keine vergangenen Termine.",
}


def _dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _settings_view(discord_settings: dict | None) -> dict:
    stored = (discord_settings or {}).get(SETTINGS_KEY) if isinstance((discord_settings or {}).get(SETTINGS_KEY), dict) else {}
    return {"enabled": bool(stored.get("enabled")), "internal": bool(stored.get("internal")),
            "last_run_at": stored.get("last_run_at"), "last_result": stored.get("last_result")}


def scheduled_payload(kind: str, doc: dict, origin: str, now: datetime | None = None) -> dict | None:
    """Was Discord bekommt - reine Rechnung, damit Vorschau und Abgleich dasselbe zeigen."""
    from services.discord_announcements import plain_text

    start = _dt(doc.get("start_date"))
    if not start:
        return None
    end = _dt(doc.get("end_date"))
    if not end or end <= start:
        end = start + timedelta(hours=DEFAULT_HOURS.get(kind, 2))
    slug = doc.get("slug") or doc.get("id")
    link = f"{origin}/{'events' if kind == 'event' else 'tournaments'}/{slug}"
    text = plain_text(doc.get("short_description") or doc.get("description"), 800)
    description = (text + "\n\n" if text else "") + link
    if kind == "event":
        place = ", ".join(part for part in (doc.get("location"), doc.get("city")) if part)
        location = place or link
    else:
        location = link
    return {
        "name": str(doc.get("name") or doc.get("title") or "Termin")[:100],
        "description": description[:1000],
        "start": start.isoformat(),
        "end": end.isoformat(),
        "location": location[:100],
        "url": link,
    }


def payload_hash(payload: dict) -> str:
    return hashlib.sha1(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def wants_event(kind: str, doc: dict, cfg: dict, now: datetime | None = None) -> tuple[bool, str | None]:
    """Soll dieses Event/Turnier einen Discord-Termin haben - und wenn nicht, warum."""
    if not cfg.get("enabled"):
        return False, "disabled"
    if doc.get("discord_skip"):
        return False, "author_opt_out"
    if str(doc.get("status") or "") not in ACTIVE_STATUSES:
        return False, "status"
    if doc.get("is_public") is False:
        return False, "hidden"
    if (doc.get("visibility") or "public") != "public" and not cfg.get("internal"):
        return False, "not_public"
    start = _dt(doc.get("start_date"))
    if not start:
        return False, "no_date"
    if start <= (now or now_utc()):
        return False, "past"
    return True, None


async def _origin() -> str:
    from services.platform_links import frontend_url

    return (frontend_url() or "https://lionsquad.at").rstrip("/")


async def preview_for(db, kind: str, doc: dict, now: datetime | None = None) -> dict:
    """Für das Formular: so erscheint der Termin - oder warum nicht."""
    cfg = _settings_view(await db.settings.find_one({"id": "discord"}, {"_id": 0, SETTINGS_KEY: 1}))
    wanted, reason = wants_event(kind, doc, cfg, now)
    payload = scheduled_payload(kind, doc, await _origin(), now) if wanted else None
    stored = doc.get(FIELD) or {}
    return {"would_create": bool(wanted and payload), "reason": reason if not wanted else None,
            "reason_text": REASON_TEXTS.get(reason) if reason else None, "payload": payload,
            "existing_id": stored.get("id") if not stored.get("cancelled_at") else None}


async def _candidates(db) -> list[tuple[str, object, dict]]:
    rows: list[tuple[str, object, dict]] = []
    query = {"$or": [{"status": {"$in": list(ACTIVE_STATUSES)}}, {f"{FIELD}.id": {"$exists": True}}]}
    fields = {"_id": 0, "id": 1, "slug": 1, "name": 1, "title": 1, "status": 1, "visibility": 1, "is_public": 1, "discord_skip": 1,
              "start_date": 1, "end_date": 1, "location": 1, "city": 1, "short_description": 1, "description": 1, FIELD: 1}
    for doc in await db.events.find(query, fields).sort("start_date", 1).to_list(500):
        rows.append(("event", db.events, doc))
    for doc in await db.tournaments.find(query, fields).sort("start_date", 1).to_list(500):
        rows.append(("tournament", db.tournaments, doc))
    return rows


async def sync(db, *, now: datetime | None = None, limit: int = MAX_OPS_PER_RUN) -> dict:
    """Abgleich: anlegen, ändern, absagen - höchstens ``limit`` Aufrufe je Lauf (Discord-Limits)."""
    from services.discord_bot import bot, bot_settings

    current = now or now_utc()
    settings = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    cfg = _settings_view(settings)
    outcome = {"created": 0, "updated": 0, "cancelled": 0, "errors": 0, "skipped": None, "checked": 0}
    if not cfg["enabled"]:
        outcome["skipped"] = "disabled"
        return outcome
    if not bool(settings.get("enabled", True)) or not bot_settings(settings)["enabled"]:
        outcome["skipped"] = "bot_off"
        return outcome
    origin = await _origin()
    ops = 0
    for kind, collection, doc in await _candidates(db):
        outcome["checked"] += 1
        stored = doc.get(FIELD) or {}
        wanted, reason = wants_event(kind, doc, cfg, current)
        payload = scheduled_payload(kind, doc, origin, current) if wanted else None
        try:
            if payload:
                digest = payload_hash(payload)
                live_id = stored.get("id") if stored.get("id") and not stored.get("cancelled_at") else ""
                if live_id and stored.get("hash") == digest:
                    continue
                result: dict = {"ok": False, "reason": "unknown_event"}
                action = "updated"
                if live_id:
                    result = await bot.edit_scheduled_event(live_id, payload)
                if not live_id or (not result.get("ok") and result.get("reason") == "unknown_event"):
                    action = "created"
                    result = await bot.create_scheduled_event(payload)
                ops += 1
                if result.get("ok"):
                    await collection.update_one({"id": doc["id"]}, {"$set": {FIELD: {"id": str(result.get("event_id") or live_id), "hash": digest,
                                                                                       "updated_at": current.isoformat(), "cancelled_at": None, "error": None}}})
                    outcome[action] += 1
                else:
                    outcome["errors"] += 1
                    await collection.update_one({"id": doc["id"]}, {"$set": {f"{FIELD}.error": result.get("error") or result.get("reason") or "error"}})
                    if result.get("reason") in ("bot_offline", "no_guild"):
                        break
            elif stored.get("id") and not stored.get("cancelled_at"):
                result = await bot.cancel_scheduled_event(stored["id"])
                ops += 1
                if result.get("ok") or result.get("reason") == "unknown_event":
                    await collection.update_one({"id": doc["id"]}, {"$set": {f"{FIELD}.cancelled_at": current.isoformat(), f"{FIELD}.cancel_reason": reason, f"{FIELD}.error": None}})
                    outcome["cancelled"] += 1
                else:
                    outcome["errors"] += 1
                    if result.get("reason") in ("bot_offline", "no_guild"):
                        break
        except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf den Abgleich nicht anhalten
            logger.warning("[discord-scheduled] %s %s: %s", kind, doc.get("id"), type(exc).__name__)
            outcome["errors"] += 1
        if ops >= limit:
            break
    await db.settings.update_one({"id": "discord"}, {"$set": {f"{SETTINGS_KEY}.last_run_at": current.isoformat(), f"{SETTINGS_KEY}.last_result": outcome},
                                                     "$setOnInsert": {"id": "discord"}}, upsert=True)
    return outcome


async def scheduled_status(db) -> dict:
    """Für Verbindungen → Discord: Schalter, letzter Lauf, wie viele Termine gerade stehen."""
    cfg = _settings_view(await db.settings.find_one({"id": "discord"}, {"_id": 0, SETTINGS_KEY: 1}))
    query = {f"{FIELD}.id": {"$exists": True}, f"{FIELD}.cancelled_at": None}
    cfg["active"] = await db.events.count_documents(query) + await db.tournaments.count_documents(query)
    return cfg
