import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from database import get_db
from models import now_utc
from services.notification_preferences import NEWSLETTER_SKIP_REASONS, enqueue_newsletter_for_item
from services.news_channels import notification_meta
from services.user_notifications import create_user_notification
from services.visibility import user_can_see

STAFF_ROLES = {"tournament_admin", "club_admin", "superadmin"}
MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")
PROFILE_LINK_RE = re.compile(r"/u/([A-Za-z0-9_.-]{2,32})")


# Felder, die nur die Redaktion braucht (#2122): wer geändert oder zurückgezogen hat, der Versandstand von Newsletter,
# Discord und Meldungen, wer schon über eine Erwähnung benachrichtigt wurde. Öffentliche Antworten (Website, App,
# Startseite) tragen sie nie - Admin → News bekommt sie über die eigenen Admin-Wege.
INTERNAL_NEWS_FIELDS = frozenset({
    "updated_by", "updated_by_name",
    "withdrawn_at", "withdrawn_by", "withdrawn_by_name", "withdrawn_was_published",
    "newsletter_sent_at", "newsletter_sent_count", "newsletter_sent_by", "newsletter_skipped_reason", "newsletter_checked_at",
    "news_mention_notified_user_ids", "news_mentions_processed_at",
    "discord_checked_at", "discord_outcome", "members_notified_at", "members_notified_count",
})


def public_news(post: dict) -> dict:
    """Ein Beitrag ohne die internen Felder der Redaktion - für jede öffentliche Antwort. ``pinned`` gilt nur bis zum
    Ende der Anheftung (#1263)."""
    row = {key: value for key, value in (post or {}).items() if key not in INTERNAL_NEWS_FIELDS}
    if "pinned" in row:
        row["pinned"] = pin_active(post)
    return row


# Angeheftete News laufen ab (#1263): ``pinned_until`` ist ein Wiener Kalendertag („JJJJ-MM-TT“), angeheftet bleibt der
# Beitrag bis zum Ende dieses Tages. Beim Anheften ohne Ende schlägt der Editor (und notfalls der Server) 14 Tage vor - ab dem
# Tag, an dem der Beitrag erscheint. Altbestand ohne Ende rechnet beim Lesen, ohne Migration (Fabian, 16.11.): erschienen + 14
# Tage, aber nie vor „Tag der Umstellung + 14“ - so verschwindet am ersten Tag keine angeheftete Alt-News.
VIENNA = ZoneInfo("Europe/Vienna")
PIN_DEFAULT_DAYS = 14
# Stichtag der Umstellung (Fabian, 16.11.: nichts wird in die Datenbank geschrieben - keine Migration, keine Einstellungszeile):
# Ältere angeheftete News ohne Ende gelten bis max(erschienen, angelegt, PIN_RULE_SINCE) + 14 Tage (Wiener Tag).
PIN_RULE_SINCE = date(2026, 11, 20)


def vienna_today(now: datetime | None = None) -> date:
    return (now or now_utc()).astimezone(VIENNA).date()


def default_pinned_until(now: datetime | None = None) -> str:
    return (vienna_today(now) + timedelta(days=PIN_DEFAULT_DAYS)).isoformat()


def parse_pin_day(value) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


def vienna_day(value) -> date | None:
    moment = parse_dt(value)
    return moment.astimezone(VIENNA).date() if moment else None


def publish_day(post: dict | None, now: datetime | None = None) -> date:
    """Ab diesem Wiener Tag ist der Beitrag zu sehen: heute oder - bei einem geplanten Beitrag - sein Termin."""
    today = vienna_today(now)
    planned = vienna_day((post or {}).get("published_at"))
    return max(today, planned) if planned else today


def pin_end(post: dict | None, now: datetime | None = None) -> date | None:
    """Bis zu welchem Wiener Tag der Beitrag angeheftet ist - ``None``, wenn er es nicht ist."""
    if not (post or {}).get("pinned"):
        return None
    until = parse_pin_day(post.get("pinned_until"))
    if until is not None:
        return until
    # Altbestand ohne Ende: erschienen (bzw. angelegt) + 14 Tage, nie vor dem Stichtag + 14 Tage.
    days = [day for day in (vienna_day(post.get("published_at")), vienna_day(post.get("created_at"))) if day]
    return max([*days, PIN_RULE_SINCE]) + timedelta(days=PIN_DEFAULT_DAYS)


def pin_active(post: dict | None, now: datetime | None = None) -> bool:
    """Ist der Beitrag gerade angeheftet? Die eine Regel für alle Leser (Website, App, Startseite, Verwaltung)."""
    end = pin_end(post, now)
    return end is not None and vienna_today(now) <= end


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
        # Empfänger aus der Datenbank: die Zwei-Faktor-Bestätigung gehört zur Anmeldung, nicht zum Konto.
        if not await user_can_see(user, post.get("visibility") or "public", for_request=False):
            continue
        await create_user_notification(
            user["id"],
            title="Du wurdest in News erwähnt",
            body=f"{user_label(actor)} hat dich in \"{post.get('title') or 'News'}\" erwähnt.",
            url=url,
            kind="news_mention",
            # Kanal der News (#1532): Push nur auf der Seite, auf der die News erscheint.
            meta={"news_id": post.get("id"), "slug": post.get("slug"), **notification_meta(post)},
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
            if result.get("reason") in NEWSLETTER_SKIP_REASONS:
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
