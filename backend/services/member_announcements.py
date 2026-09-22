"""Interne Events und News melden - nur denen, die sie sehen dürfen (#342).

Ein Job sieht jede Minute nach, was veröffentlicht und noch nicht gemeldet ist, und schreibt
je Empfänger eine Benachrichtigung (in der App als Push, im Web in der Glocke). Jedes Stück wird
genau einmal geprüft (`members_notified_at`).

Empfänger nach Sichtbarkeit:
- `members`  → aktive Mitglieder (aktiv oder Ehrenmitglied)
- `internal` → nur, wer die Vereinsverwaltung hat (Rolle, Freigabe, Vorstandsposten,
               Dolibarr-Funktion)
- `public` / `community` → niemand über diesen Weg: Öffentliches hat Newsletter und Discord

Eine leere Empfängerliste bleibt leer. Es gibt keinen Rückfall auf „alle“.
"""
from __future__ import annotations

import logging

from datetime import timedelta

from database import get_db
from models import now_utc

logger = logging.getLogger("tls.members.announce")

EVENT_STATUSES = ("scheduled", "registration_open")
# Wer das Update einspielt, will nicht, dass jedes alte interne Event von 2024 nachträglich
# gemeldet wird: Älteres als einen Tag wird nur als geprüft markiert.
MAX_AGE_HOURS = 24
KINDS = {"members": "member", "internal": "board"}


async def member_user_ids(db) -> set[str]:
    rows = await db.memberships.find({"member_status": {"$in": ["active", "honorary"]}}, {"_id": 0, "user_id": 1}).to_list(10000)
    return {row["user_id"] for row in rows if row.get("user_id")}


async def club_area_user_ids(db) -> set[str]:
    """Wer die Vereinsverwaltung hat - dieselbe Regel wie der Wächter, nur für viele auf einmal."""
    from services.permissions import areas_for

    candidates = await db.users.find(
        {"is_active": True, "is_banned": {"$ne": True}, "$or": [
            {"role": {"$in": ["club_admin", "superadmin"]}},
            {"areas": "club"},
        ]},
        {"_id": 0, "id": 1, "role": 1, "areas": 1},
    ).to_list(1000)
    ids = {user["id"] for user in candidates}
    # Vorstandsposten und Dolibarr-Funktionen kennt nur `areas_for` - je Person, aber nur für die,
    # die noch nicht drin sind und einen Posten oder eine Funktion haben könnten.
    holders = set()
    async for position in db.board_positions.find({"is_active": {"$ne": False}}, {"_id": 0, "user_id": 1, "deputy_user_id": 1}):
        for key in ("user_id", "deputy_user_id"):
            if position.get(key):
                holders.add(position[key])
    profile_ids = [h for h in holders if h not in ids]
    if profile_ids:
        async for profile in db.club_member_profiles.find({"id": {"$in": profile_ids}}, {"_id": 0, "user_id": 1}):
            if profile.get("user_id"):
                holders.add(profile["user_id"])
    async for membership in db.memberships.find({"source": "dolibarr", "dolibarr.functions.0": {"$exists": True}}, {"_id": 0, "user_id": 1}):
        holders.add(membership["user_id"])
    for user_id in holders - ids:
        user = await db.users.find_one({"id": user_id, "is_active": True, "is_banned": {"$ne": True}}, {"_id": 0, "id": 1, "role": 1, "areas": 1})
        if user and "club" in await areas_for(user, db):
            ids.add(user_id)
    return ids


async def recipients_for(db, visibility: str | None) -> set[str]:
    if visibility == "members":
        return await member_user_ids(db)
    if visibility == "internal":
        return await club_area_user_ids(db)
    return set()


async def _notify(db, collection, item: dict, *, title: str, body: str, url: str, kind_base: str) -> dict:
    from services.user_notifications import create_user_notification

    visibility = item.get("visibility") or "public"
    recipients = await recipients_for(db, visibility)
    sent = 0
    for user_id in sorted(recipients):
        created = await create_user_notification(
            user_id, title, body, url=url, kind=f"{kind_base}_{KINDS.get(visibility, 'member')}",
            meta={"category": "club_internal", "dedupe_key": f"{kind_base}:{item['id']}", "item_id": item["id"], "visibility": visibility},
        )
        if created:
            sent += 1
    await collection.update_one({"id": item["id"]}, {"$set": {"members_notified_at": now_utc().isoformat(), "members_notified_count": sent}})
    return {"visibility": visibility, "recipients": len(recipients), "sent": sent}


async def notify_due(limit: int = 50) -> dict:
    """Veröffentlichte, noch nicht gemeldete interne News und Events."""
    from services.news_publish import published_now

    db = get_db()
    now_iso = now_utc().isoformat()
    results = []
    posts = await db.news_posts.find(
        {"published": True, "published_at": {"$lte": now_iso}, "visibility": {"$in": ["members", "internal"]},
         "members_notified_at": {"$exists": False}}, {"_id": 0},
    ).sort("published_at", 1).to_list(limit)
    cutoff = (now_utc() - timedelta(hours=MAX_AGE_HOURS)).isoformat()
    for post in posts:
        if not published_now(post):
            continue
        if str(post.get("published_at") or "") < cutoff:
            await db.news_posts.update_one({"id": post["id"]}, {"$set": {"members_notified_at": now_iso, "members_notified_count": 0}})
            continue
        results.append(await _notify(
            db, db.news_posts, post, kind_base="news",
            title="Interne News" if post.get("visibility") == "members" else "News für den Vorstand",
            body=str(post.get("title") or ""), url=f"/news/{post.get('slug') or post['id']}",
        ))
    events = await db.events.find(
        {"status": {"$in": list(EVENT_STATUSES)}, "visibility": {"$in": ["members", "internal"]},
         "members_notified_at": {"$exists": False}}, {"_id": 0},
    ).sort("created_at", 1).to_list(limit)
    for event in events:
        start = event.get("start_date")
        if (start and str(start) < now_iso) or str(event.get("created_at") or "") < cutoff:
            await db.events.update_one({"id": event["id"]}, {"$set": {"members_notified_at": now_iso, "members_notified_count": 0}})
            continue
        results.append(await _notify(
            db, db.events, event, kind_base="event",
            title="Vereinsevent" if event.get("visibility") == "members" else "Event für den Vorstand",
            body=str(event.get("name") or ""), url=f"/events/{event.get('slug') or event['id']}",
        ))
    return {"items": len(results), "sent": sum(r["sent"] for r in results)}
