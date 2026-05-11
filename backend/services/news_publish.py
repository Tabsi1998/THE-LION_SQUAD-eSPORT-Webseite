import re
from datetime import datetime, timezone

from database import get_db
from models import now_utc
from services.notification_preferences import enqueue_newsletter_for_item
from services.user_notifications import create_user_notification
from services.visibility import user_can_see

STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")
PROFILE_LINK_RE = re.compile(r"/u/([A-Za-z0-9_.-]{2,32})")


def parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def published_now(post: dict) -> bool:
    published_at = parse_dt(post.get("published_at"))
    return not published_at or published_at <= now_utc()


async def mentioned_user_ids_from_content(content: str | None, explicit_ids: list[str] | None = None) -> list[str]:
    handles: list[str] = []
    seen_handles: set[str] = set()
    for regex in (MENTION_RE, PROFILE_LINK_RE):
        for match in regex.findall(content or ""):
            handle = str(match or "").strip()
            lower = handle.lower()
            if handle and lower not in seen_handles:
                seen_handles.add(lower)
                handles.append(handle)

    ordered_ids: list[str] = []
    for user_id in explicit_ids or []:
        if user_id and user_id not in ordered_ids:
            ordered_ids.append(user_id)
    if not handles:
        return ordered_ids

    db = get_db()
    users = await db.users.find(
        {
            "is_active": True,
            "is_banned": {"$ne": True},
            "$or": [{"username": {"$regex": f"^{re.escape(handle)}$", "$options": "i"}} for handle in handles],
        },
        {"_id": 0, "id": 1, "username": 1},
    ).to_list(100)
    by_username = {(user.get("username") or "").lower(): user["id"] for user in users}
    for handle in handles:
        user_id = by_username.get(handle.lower())
        if user_id and user_id not in ordered_ids:
            ordered_ids.append(user_id)
    return ordered_ids


def user_label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


async def notify_news_mentions(db, post: dict, actor: dict | None = None) -> int:
    if not post or not post.get("published") or not published_now(post):
        return 0
    mentioned_ids = [user_id for user_id in post.get("mentioned_user_ids") or [] if user_id]
    if not mentioned_ids:
        await db.news_posts.update_one(
            {"id": post["id"]},
            {"$set": {"news_mentions_processed_at": now_utc().isoformat()}},
        )
        return 0

    actor = actor or {}
    already_notified = set(post.get("news_mention_notified_user_ids") or [])
    target_ids = [user_id for user_id in mentioned_ids if user_id not in already_notified and user_id != actor.get("id")]
    if not target_ids:
        await db.news_posts.update_one(
            {"id": post["id"]},
            {"$set": {"news_mentions_processed_at": now_utc().isoformat()}},
        )
        return 0

    users = await db.users.find(
        {
            "id": {"$in": target_ids},
            "is_active": True,
            "is_banned": {"$ne": True},
        },
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "role": 1, "privacy_public_profile": 1},
    ).to_list(200)
    notified_ids: list[str] = []
    slug_or_id = post.get("slug") or post.get("id")
    url = f"/news/{slug_or_id}"
    for user in users:
        if post.get("visibility") == "internal" and user.get("role") not in STAFF_ROLES:
            continue
        if not await user_can_see(user, post.get("visibility") or "public"):
            continue
        await create_user_notification(
            user["id"],
            title="Du wurdest in News erwähnt",
            body=f"{user_label(actor)} hat dich in \"{post.get('title') or 'News'}\" erwähnt.",
            url=url,
            kind="news_mention",
            meta={"news_id": post.get("id"), "slug": post.get("slug")},
        )
        notified_ids.append(user["id"])

    update: dict = {"$set": {"news_mentions_processed_at": now_utc().isoformat()}}
    if notified_ids:
        update["$addToSet"] = {"news_mention_notified_user_ids": {"$each": notified_ids}}
    await db.news_posts.update_one({"id": post["id"]}, update)
    return len(notified_ids)


async def finalize_due_news(limit: int = 100) -> dict:
    db = get_db()
    now_iso = now_utc().isoformat()
    query = {
        "published": True,
        "published_at": {"$lte": now_iso},
        "$or": [
            {"newsletter_sent_at": {"$exists": False}, "newsletter_skipped_reason": {"$exists": False}},
            {"news_mentions_processed_at": {"$exists": False}},
        ],
    }
    posts = await db.news_posts.find(query, {"_id": 0}).sort("published_at", 1).limit(limit).to_list(limit)
    queued = 0
    skipped = 0
    mentions = 0
    processed = 0
    for post in posts:
        if not published_now(post):
            continue
        processed += 1
        if not post.get("newsletter_sent_at") and not post.get("newsletter_skipped_reason"):
            result = await enqueue_newsletter_for_item("news", post)
            if result.get("reason") in {"internal_visibility", "not_published"}:
                skipped += 1
                await db.news_posts.update_one(
                    {"id": post["id"]},
                    {"$set": {
                        "newsletter_skipped_reason": result.get("reason"),
                        "newsletter_checked_at": now_utc().isoformat(),
                    }},
                )
            else:
                queued_count = int(result.get("queued") or 0)
                queued += queued_count
                await db.news_posts.update_one(
                    {"id": post["id"]},
                    {"$set": {
                        "newsletter_sent_at": now_utc().isoformat(),
                        "newsletter_sent_count": queued_count,
                    }},
                )
        fresh = await db.news_posts.find_one({"id": post["id"]}, {"_id": 0}) or post
        actor = {"id": fresh.get("author_id"), "display_name": fresh.get("author_name")}
        mentions += await notify_news_mentions(db, fresh, actor)
    return {"processed": processed, "newsletter_queued": queued, "newsletter_skipped": skipped, "mentions": mentions}
