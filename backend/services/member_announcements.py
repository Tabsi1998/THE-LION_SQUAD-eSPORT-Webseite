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
    from services.news_channels import notification_meta
    from services.user_notifications import create_user_notification

    visibility = item.get("visibility") or "public"
    recipients = await recipients_for(db, visibility)
    sent = 0
    for user_id in sorted(recipients):
        created = await create_user_notification(
            user_id, title, body, url=url, kind=f"{kind_base}_{KINDS.get(visibility, 'member')}",
            # Kanal der News (#1532): „nur App“ ohne Browser und Discord, „nur Website“ ohne App-Push - Events haben keinen.
            meta={"category": "club_internal", "dedupe_key": f"{kind_base}:{item['id']}", "item_id": item["id"], "visibility": visibility,
                  **notification_meta(item)},
        )
        if created:
            sent += 1
    await collection.update_one({"id": item["id"]}, {"$set": {"members_notified_at": now_utc().isoformat(), "members_notified_count": sent}})
    return {"visibility": visibility, "recipients": len(recipients), "sent": sent}


# Öffentliche News „nur App“ (#1532, Fabian 23.11.): beim Veröffentlichen ein App-Push an alle App-Nutzer mit Zustimmung
# für „News & Events“. Sichtbarkeit „Mitglieder“ und „intern“ gehen den Weg oben (Meldung an Berechtigte).
APP_NEWS_VISIBILITIES = (None, "public", "community")


async def app_push_user_ids(db) -> list[str]:
    """Wer die App mit Push nutzt und „News & Events“ per Push bekommen will - ohne Zustimmung niemand, auch nicht still
    ins Postfach."""
    from services.notification_preferences import push_allowed

    token_users = await db.mobile_push_tokens.distinct("user_id", {"enabled": {"$ne": False}})
    if not token_users:
        return []
    users = await db.users.find(
        {"id": {"$in": token_users}, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "notification_preferences": 1, "newsletter_consent": 1},
    ).to_list(len(token_users))
    return sorted(user["id"] for user in users if push_allowed(user, "news_app", "news_events"))


# Ein ausstehender Push (``push_pending``) lag beim Abbruch eines Laufs gesammelt, aber noch nicht bei Expo - oder die Anfrage an
# Expo ist gescheitert (#2553, Fabian 24.11., F1). Ein Lauf schickt höchstens 100 gesammelte auf einmal - nach einer Minute gehört
# so eine Zeile sicher keinem laufenden Lauf mehr. Je Takt höchstens so viele Zeilen.
ORPHANED_PUSH_AFTER_SECONDS = 60
ORPHANED_PUSH_LIMIT = 500


async def _resend_orphaned_pushes(db, recipients: list[str], dedupe_key: str) -> bool:
    """Holt ausstehende Pushes nach: abgebrochene Läufe und gescheiterte Anfragen an Expo. Beansprucht und geschickt wird in
    ``send_collected_pushes`` (K1) - treffen sich Hauptweg und Nachhol-Stufe, schickt nur einer. Pushes, die die Ruhezeit
    hält, holt der Ruhezeit-Job nach, nicht diese Stufe (K2). Rückgabe: ``True``, wenn kein Push mehr aussteht - sonst bleibt
    der Beitrag unmarkiert und der nächste Takt sieht wieder nach."""
    from services.user_notifications import PUSH_CLAIM_STALE_SECONDS, send_collected_pushes

    if not recipients:
        return True
    moment = now_utc()
    open_rows = {"user_id": {"$in": recipients}, "unique_dedupe_key": dedupe_key, "push_pending": True,
                 "quiet_hold_until": {"$exists": False}}
    due = {
        **open_rows,
        "created_at": {"$lt": (moment - timedelta(seconds=ORPHANED_PUSH_AFTER_SECONDS)).isoformat()},
        "$and": [
            {"$or": [{"push_retry_at": {"$exists": False}}, {"push_retry_at": {"$lte": moment.isoformat()}}]},
            {"$or": [{"push_claim": {"$exists": False}},
                     {"push_claimed_at": {"$lt": (moment - timedelta(seconds=PUSH_CLAIM_STALE_SECONDS)).isoformat()}}]},
        ],
    }
    batch = await db.notifications.find(due, {"_id": 0}).to_list(ORPHANED_PUSH_LIMIT)
    await send_collected_pushes(batch)
    return not await db.notifications.count_documents(open_rows)


async def notify_app_news(db, limit: int = 20) -> dict:
    """Je öffentliche News „nur App“ ein App-Push je Person - mindestens einmal (#2553): je Person eine Meldung mit
    eindeutigem Schlüssel (Teilindex ``user_unique_dedupe``), erst wenn kein Push mehr aussteht, wird der Beitrag als
    erledigt markiert. Bricht ein Lauf ab oder scheitert eine Anfrage an Expo, holt ein späterer Lauf den Push nach;
    beansprucht wird jede Zeile vor dem Senden (``send_collected_pushes``) - laufen zwei gleichzeitig oder trifft der
    Hauptweg die Nachhol-Stufe, bekommt trotzdem niemand etwas doppelt. Ruhezeiten gelten wie überall.
    ``app_push_count`` zählt nur echte Zustellungen (Fabian 24.11.): wer den Push auf mindestens ein Gerät bekam."""
    from services.news_channels import notification_meta, only_channel
    from services.news_publish import published_now
    from services.push_notifications import EXPO_BATCH_SIZE
    from services.user_notifications import create_user_notification, send_collected_pushes

    now_iso = now_utc().isoformat()
    cutoff = (now_utc() - timedelta(hours=MAX_AGE_HOURS)).isoformat()
    posts = await db.news_posts.find(
        {"published": True, "published_at": {"$lte": now_iso}, "channels": ["app"],
         "visibility": {"$in": list(APP_NEWS_VISIBILITIES)}, "app_push_notified_at": {"$exists": False}}, {"_id": 0},
    ).sort("published_at", 1).to_list(limit)
    results = []
    for post in posts:
        if not published_now(post) or only_channel(post) != "app":
            continue
        if str(post.get("published_at") or "") < cutoff:
            # Älter als einen Tag: kein Push - mit Grund, damit die Verteilen-Box nicht „an 0 Personen“ zeigt.
            await db.news_posts.update_one(
                {"id": post["id"], "app_push_notified_at": {"$exists": False}},
                {"$set": {"app_push_notified_at": now_iso, "app_push_count": 0, "app_push_skipped_reason": "too_old"}})
            continue
        slug = post.get("slug") or post["id"]
        dedupe_key = f"news_app:{post['id']}"
        recipients = await app_push_user_ids(db)
        if recipients:
            # Fabian 23.11. (Nr. 230): Wer zu dieser News schon eine Mitglieder- oder Vorstands-Meldung bekam (die News war
            # erst intern und wurde später öffentlich), bekommt keinen zweiten App-Push.
            notified = set(await db.notifications.distinct("user_id", {
                "user_id": {"$in": recipients}, "kind": {"$in": [f"news_{kind}" for kind in KINDS.values()]},
                "meta.dedupe_key": f"news:{post['id']}"}))
            recipients = [user_id for user_id in recipients if user_id not in notified]
        sent = 0
        # Gebündelt: je bis zu 100 Nachrichten eine Anfrage an Expo statt einer je Person.
        batch: list[dict] = []
        for user_id in recipients:
            created = await create_user_notification(
                user_id, "Neu in der LionsAPP", str(post.get("title") or "News"), url=f"/news/{slug}", kind="news_app",
                meta={"category": "news_events", "news_id": post["id"], "slug": post.get("slug"),
                      "dedupe_key": dedupe_key, "unique_dedupe": True, **notification_meta(post)},
                push_batch=batch,
            )
            if created:
                sent += 1
            if len(batch) >= EXPO_BATCH_SIZE:
                await send_collected_pushes(batch)
        await send_collected_pushes(batch)
        if not await _resend_orphaned_pushes(db, recipients, dedupe_key):
            # Ein paralleler Lauf hat noch Meldungen ohne Push in der Hand - der nächste Takt sieht wieder nach.
            results.append({"news_id": post["id"], "sent": sent})
            continue
        # Gezählt wird, wer den Push wirklich bekam - auch aus einem früheren, abgebrochenen oder parallelen Lauf.
        total = await db.notifications.count_documents(
            {"user_id": {"$in": recipients}, "unique_dedupe_key": dedupe_key, "push_sent_count": {"$gt": 0}}) if recipients else 0
        await db.news_posts.update_one({"id": post["id"]}, {"$set": {"app_push_count": total}, "$min": {"app_push_notified_at": now_iso}})
        results.append({"news_id": post["id"], "sent": sent})
    return {"items": len(results), "sent": sum(row["sent"] for row in results)}


async def notify_due(limit: int = 50) -> dict:
    """Veröffentlichte, noch nicht gemeldete interne News und Events. Öffentliche News „nur App“ (#1532) meldet
    ``notify_app_news`` im selben Minuten-Job."""
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
