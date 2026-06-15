"""Runtime helpers for station-driven tournament operation."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from match_rules import participant_source_ids
from models import now_utc
from services.notification_preferences import send_user_template
from services.user_notifications import build_public_url, create_user_notification


def station_label(station: dict) -> str:
    parts = [station.get("name") or station.get("label") or station.get("id") or "Station"]
    if station.get("device_type"):
        parts.append(station["device_type"])
    if station.get("notes"):
        parts.append(station["notes"])
    return " - ".join(parts)


def format_de_datetime(value: Any) -> str:
    if not value:
        return "jetzt"
    try:
        dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m.%Y, %H:%M Uhr")
    except Exception:
        return "jetzt"


async def registration_label(db, registration_id: str | None) -> str:
    if not registration_id:
        return "Offen"
    reg = await db.tournament_registrations.find_one({"id": registration_id}, {"_id": 0})
    if not reg:
        return registration_id
    return reg.get("display_name") or reg.get("ingame_name") or registration_id


async def match_label(db, match: dict) -> str:
    if match.get("slots"):
        names = []
        for slot in match.get("slots") or []:
            if slot.get("registration_id"):
                names.append(await registration_label(db, slot.get("registration_id")))
        return f"{match.get('match_key') or 'Durchgang'} - {' / '.join(names[:4]) or 'Offen'}"
    a = await registration_label(db, match.get("participant_a_id"))
    b = await registration_label(db, match.get("participant_b_id"))
    return f"{a} gegen {b}"


async def _participant_users(db, match: dict) -> list[dict]:
    reg_ids = participant_source_ids(match)
    if not reg_ids:
        return []
    regs = await db.tournament_registrations.find({"id": {"$in": reg_ids}}, {"_id": 0, "user_id": 1}).to_list(64)
    user_ids = list({reg.get("user_id") for reg in regs if reg.get("user_id")})
    if not user_ids:
        return []
    return await db.users.find(
        {"id": {"$in": user_ids}, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1},
    ).to_list(64)


async def notify_match_started(db, match: dict, station: dict, collection_name: str) -> int:
    users = await _participant_users(db, match)
    if not users:
        return 0
    tournament = await db.tournaments.find_one(
        {"id": match.get("tournament_id")},
        {"_id": 0, "id": 1, "slug": 1, "title": 1},
    ) or {}
    path = f"/matches/{match.get('id')}"
    absolute_url = await build_public_url(path)
    station_name = station_label(station)
    match_name = await match_label(db, match)
    when = format_de_datetime(match.get("started_at") or match.get("scheduled_at"))
    sent = 0
    for user in users:
        dedupe_key = f"match_started:{match.get('id')}:{user.get('id')}:{station.get('id')}"
        exists = await db.notifications.find_one(
            {"user_id": user.get("id"), "kind": "match_station", "meta.dedupe_key": dedupe_key},
            {"_id": 1},
        )
        if not exists:
            created = await create_user_notification(
                user.get("id"),
                "Match startet jetzt",
                f"{tournament.get('title') or 'Turnier'}: {match_name} startet auf {station_name}.",
                url=path,
                kind="match_station",
                meta={
                    "category": "match_reminders",
                    "dedupe_key": dedupe_key,
                    "match_id": match.get("id"),
                    "match_type": collection_name,
                    "station_id": station.get("id"),
                    "tournament_id": match.get("tournament_id"),
                    "started_at": match.get("started_at") or match.get("scheduled_at"),
                },
            )
            if created:
                sent += 1
        try:
            await send_user_template(
                user,
                "match_reminder",
                tournament_title=tournament.get("title") or "Turnier",
                opponent=match_name,
                when=when,
                station=station_name,
                url=absolute_url,
                dedupe_key=f"{dedupe_key}:mail",
                mail_meta={
                    "kind": "match_started",
                    "match_id": match.get("id"),
                    "match_type": collection_name,
                    "station_id": station.get("id"),
                    "tournament_id": match.get("tournament_id"),
                    "user_id": user.get("id"),
                },
            )
        except Exception:
            pass
    return sent


async def release_station_for_match(db, match: dict, collection_name: str) -> bool:
    station_id = match.get("station_id")
    if not station_id:
        return False
    station = await db.stations.find_one({"id": station_id}, {"_id": 0})
    if not station or station.get("current_match_id") != match.get("id"):
        return False
    now = now_utc().isoformat()
    await db.stations.update_one(
        {"id": station_id},
        {"$set": {
            "current_match_id": None,
            "current_match_type": None,
            "status": "free",
            "last_match_id": match.get("id"),
            "last_match_type": collection_name,
            "freed_at": now,
            "updated_at": now,
        }},
    )
    return True
