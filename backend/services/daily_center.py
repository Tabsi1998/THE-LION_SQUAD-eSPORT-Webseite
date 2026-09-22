"""Tageszentrale (#227): was heute ansteht und was auf jemanden wartet.

Ergänzt die Zähler der Admin-Startseite um das, was bisher auf anderen Seiten lag: gemeldete
Ergebnisse, die auf Bestätigung warten; Moderationsmeldungen; Kontaktanfragen; Terminvorschläge,
deren Frist bald verfällt - und „Termine heute“ als Liste (Matches, Check-ins, Events), nicht nur
als Zahl. „Heute“ ist der Vereinstag (Europe/Vienna), nicht der UTC-Tag des Servers.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.dolibarr_policy import CLUB_TZ

SOON_HOURS = 24
TODAY_MATCH_STATUSES = ("scheduled", "ready", "in_progress", "waiting_result")


def club_day_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Mitternacht bis Mitternacht in Wien, als UTC."""
    moment = (now or datetime.now(timezone.utc)).astimezone(CLUB_TZ)
    start = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def task_counts(db, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    soon = (now + timedelta(hours=SOON_HOURS)).isoformat()
    return {
        # Gemeldet, noch nicht bestätigt - nur Konflikte standen bisher in der Zentrale.
        "reported_results": await db.matches_v2.count_documents({"status": "waiting_result"}) + await db.matches.count_documents({"status": "waiting_result"}),
        "moderation_reports": await db.user_reports.count_documents({"status": "open"}),
        "contact_messages": await db.contact_messages.count_documents({"status": "new"}),
        # Vorschläge ohne Antwort, deren Frist in den nächsten 24 Stunden abläuft (oder schon abgelaufen ist).
        "schedule_deadlines": await db.matches_v2.count_documents({"schedule_status": "proposed", "schedule_deadline_at": {"$lte": soon}}),
    }


async def today_items(db, now: datetime | None = None, limit: int = 30) -> list[dict]:
    """Matches, Check-ins und Events des Vereinstags, nach Uhrzeit."""
    now = now or datetime.now(timezone.utc)
    start, end = club_day_window(now)
    items: list[dict] = []

    tournaments: dict[str, dict] = {}

    async def tournament_of(tid: str | None) -> dict:
        if not tid:
            return {}
        if tid not in tournaments:
            tournaments[tid] = await db.tournaments.find_one({"id": tid}, {"_id": 0, "id": 1, "title": 1, "slug": 1, "status": 1}) or {}
        return tournaments[tid]

    match_query = {"scheduled_at": {"$gte": start.isoformat(), "$lt": end.isoformat()}, "status": {"$in": list(TODAY_MATCH_STATUSES)}, "is_preview": {"$ne": True}}
    async for match in db.matches_v2.find(match_query, {"_id": 0, "id": 1, "tournament_id": 1, "scheduled_at": 1, "status": 1, "match_key": 1, "round_name": 1, "station_label": 1}).sort("scheduled_at", 1).limit(limit):
        tournament = await tournament_of(match.get("tournament_id"))
        items.append({
            "kind": "match", "at": match["scheduled_at"], "title": f"{tournament.get('title') or 'Turnier'} – {match.get('match_key') or match.get('round_name') or 'Match'}",
            "status": match.get("status"), "url": f"/matches/{match['id']}", "detail": match.get("station_label") or "",
        })

    # Check-ins: Turniere, die heute im Check-in stehen oder deren Check-in heute öffnet (`check_in_from`).
    async for tournament in db.tournaments.find({"$or": [{"status": {"$in": ["check_in", "checkin_open"]}}, {"check_in_from": {"$gte": start.isoformat(), "$lt": end.isoformat()}}]},
                                              {"_id": 0, "id": 1, "title": 1, "slug": 1, "check_in_from": 1, "start_date": 1, "status": 1}).limit(limit):
        at = tournament.get("check_in_from") or tournament.get("start_date") or start.isoformat()
        items.append({"kind": "check_in", "at": at, "title": f"Check-in: {tournament.get('title') or 'Turnier'}", "status": tournament.get("status"),
                      "url": f"/admin/tournaments/{tournament['id']}", "detail": ""})

    event_query = {"status": {"$nin": ["draft", "archived", "cancelled"]}, "start_date": {"$lt": end.isoformat()},
                   "$or": [{"end_date": {"$gte": start.isoformat()}}, {"end_date": None}, {"end_date": {"$exists": False}}]}
    async for event in db.events.find(event_query, {"_id": 0, "id": 1, "name": 1, "slug": 1, "start_date": 1, "end_date": 1, "status": 1, "location": 1}).sort("start_date", 1).limit(limit):
        starts = _parse(event.get("start_date"))
        if starts and starts >= end:
            continue
        if starts and starts < start and not event.get("end_date"):
            continue   # ohne Ende: nur am Starttag
        items.append({"kind": "event", "at": event.get("start_date"), "title": event.get("name") or "Event", "status": event.get("status"),
                      "url": f"/events/{event.get('slug') or event['id']}", "detail": event.get("location") or ""})

    items.sort(key=lambda item: str(item.get("at") or ""))
    return items[:limit]
