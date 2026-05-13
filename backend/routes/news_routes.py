"""News, Sponsors & Gallery routes — Vereins-CMS Phase 3."""
import re
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
from database import get_db
from auth import require_admin, get_optional_user
from services.visibility import user_can_see, filter_visible
from services.content_embed_service import resolve_content_embeds
from services.sponsor_utils import dedupe_public_sponsors
from services.notification_preferences import enqueue_newsletter_for_item
from services.user_notifications import create_user_notification
from models import (
    NewsCreate, NewsUpdate, SponsorCreate, SponsorUpdate,
    PartnerCreate, PartnerUpdate, ReferenceCreate, ReferenceUpdate,
    GalleryAlbumCreate, GalleryAlbumUpdate,
    GalleryPhotoCreate, GalleryPhotoUpdate,
    now_utc, new_id,
)

router = APIRouter(prefix="/api", tags=["news"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")
PROFILE_LINK_RE = re.compile(r"/u/([A-Za-z0-9_.-]{2,32})")


# ---------- Visibility helper (delegates to shared module) ----------
async def _user_can_see(user: dict | None, visibility: str) -> bool:
    return await user_can_see(user, visibility)


async def _filter_visible(items: list, user: dict | None) -> list:
    return await filter_visible(items, user)


async def _filter_linked_items(items: list[dict], user: dict | None, is_staff: bool, kind: str) -> list[dict]:
    out: list[dict] = []
    for item in items:
        if not is_staff and item.get("status") == "draft":
            continue
        if kind == "tournament" and not is_staff and item.get("is_public") is False:
            continue
        if await _user_can_see(user, item.get("visibility") or "public"):
            out.append(item)
    return out


async def _visible_event_summary(event_id: str, user: dict | None) -> dict | None:
    db = get_db()
    event = await db.events.find_one(
        {"id": event_id},
        {"_id": 0, "id": 1, "name": 1, "slug": 1, "status": 1, "visibility": 1},
    )
    if not event:
        return None
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    if event.get("status") == "draft" and not is_staff:
        return None
    if not await _user_can_see(user, event.get("visibility") or "public"):
        return None
    return event


def _parse_dt(value):
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


def _published_now(post: dict) -> bool:
    published_at = _parse_dt(post.get("published_at"))
    return not published_at or published_at <= now_utc()


async def _mentioned_user_ids_from_content(content: str | None, explicit_ids: list[str] | None = None) -> list[str]:
    handles: list[str] = []
    seen_handles: set[str] = set()
    for regex in (MENTION_RE, PROFILE_LINK_RE):
        for match in regex.findall(content or ""):
            handle = str(match or "").strip()
            lower = handle.lower()
            if handle and lower not in seen_handles:
                seen_handles.add(lower)
                handles.append(handle)

    db = get_db()
    ordered_ids: list[str] = []
    for user_id in explicit_ids or []:
        if user_id and user_id not in ordered_ids:
            ordered_ids.append(user_id)
    if not handles:
        return ordered_ids

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


def _user_label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


async def _notify_news_mentions(db, post: dict, actor: dict) -> None:
    if not post or not post.get("published") or not _published_now(post):
        return
    mentioned_ids = [user_id for user_id in post.get("mentioned_user_ids") or [] if user_id]
    if not mentioned_ids:
        return
    already_notified = set(post.get("news_mention_notified_user_ids") or [])
    target_ids = [user_id for user_id in mentioned_ids if user_id not in already_notified and user_id != actor.get("id")]
    if not target_ids:
        return

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
        if not await _user_can_see(user, post.get("visibility") or "public"):
            continue
        await create_user_notification(
            user["id"],
            title="Du wurdest in News erwähnt",
            body=f"{_user_label(actor)} hat dich in \"{post.get('title') or 'News'}\" erwähnt.",
            url=url,
            kind="news_mention",
            meta={"news_id": post.get("id"), "slug": post.get("slug")},
        )
        notified_ids.append(user["id"])
    if notified_ids:
        await db.news_posts.update_one(
            {"id": post["id"]},
            {"$addToSet": {"news_mention_notified_user_ids": {"$each": notified_ids}}},
        )


# ---------- News ----------
@router.get("/news")
async def list_news(
    category: Optional[str] = None,
    pinned_only: bool = False,
    sort: Optional[str] = None,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    is_admin = user and user.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin")
    q: dict = {} if is_admin else {"published": True}
    if category:
        q["category"] = category
    if pinned_only:
        q["pinned"] = True
    posts = await db.news_posts.find(q, {"_id": 0}).sort([("published_at", -1), ("created_at", -1)]).to_list(200)
    if not is_admin:
        posts = [p for p in posts if _published_now(p)]
    posts = await _filter_visible(posts, user)
    if sort == "latest":
        posts.sort(
            key=lambda p: (_parse_dt(p.get("published_at") or p.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc), bool(p.get("pinned"))),
            reverse=True,
        )
    else:
        posts.sort(
            key=lambda p: (bool(p.get("pinned")), _parse_dt(p.get("published_at") or p.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)),
            reverse=True,
        )
    return posts


@router.get("/news/{slug_or_id}")
async def get_news(slug_or_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    p = await db.news_posts.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Beitrag nicht gefunden.")
    is_staff = bool(user and user.get("role") in STAFF_ROLES)
    if p.get("published") is False and not is_staff:
        raise HTTPException(status_code=404, detail="Beitrag nicht gefunden.")
    if not is_staff and not _published_now(p):
        raise HTTPException(status_code=404, detail="Beitrag nicht gefunden.")
    if not await _user_can_see(user, p.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Nicht sichtbar.")
    # Resolve linked entities
    db = get_db()
    if p.get("linked_event_ids"):
        items = await db.events.find(
            {"id": {"$in": p["linked_event_ids"]}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "start_date": 1, "status": 1, "visibility": 1},
        ).to_list(50)
        p["linked_events"] = await _filter_linked_items(items, user, is_staff, "event")
    if p.get("linked_tournament_ids"):
        items = await db.tournaments.find(
            {"id": {"$in": p["linked_tournament_ids"]}}, {"_id": 0, "id": 1, "title": 1, "slug": 1, "start_date": 1, "status": 1, "visibility": 1, "is_public": 1},
        ).to_list(50)
        p["linked_tournaments"] = await _filter_linked_items(items, user, is_staff, "tournament")
    if p.get("linked_f1_challenge_ids"):
        items = await db.f1_challenges.find(
            {"id": {"$in": p["linked_f1_challenge_ids"]}}, {"_id": 0, "id": 1, "title": 1, "slug": 1, "start_date": 1, "status": 1, "visibility": 1, "registration_enabled": 1, "online_registration_enabled": 1, "registration_open_from": 1, "registration_open_until": 1},
        ).to_list(50)
        p["linked_f1_challenges"] = await _filter_linked_items(items, user, is_staff, "fastlap")
    if p.get("linked_team_ids"):
        p["linked_teams"] = await db.teams.find(
            {"id": {"$in": p["linked_team_ids"]}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "logo_url": 1},
        ).to_list(50)
    if p.get("mentioned_user_ids"):
        users = await db.users.find(
            {
                "id": {"$in": p["mentioned_user_ids"]},
                "is_active": True,
                "is_banned": {"$ne": True},
                "privacy_public_profile": True,
            },
            {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
        ).to_list(50)
        user_order = {user_id: index for index, user_id in enumerate(p["mentioned_user_ids"])}
        users.sort(key=lambda user: user_order.get(user["id"], 999))
        p["mentioned_users"] = users
    p["content_embeds"] = await resolve_content_embeds(db, p.get("content"), user)
    return p


@router.get("/admin/news")
async def admin_list_news(me: dict = Depends(require_admin())):
    db = get_db()
    posts = await db.news_posts.find({}, {"_id": 0}).sort([("pinned", -1), ("published_at", -1), ("created_at", -1)]).to_list(500)
    return posts


@router.post("/news")
async def create_news(body: NewsCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.news_posts.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben.")
    doc = body.model_dump()
    if doc.get("published_at"):
        doc["published_at"] = doc["published_at"].isoformat()
    doc["mentioned_user_ids"] = await _mentioned_user_ids_from_content(doc.get("content"), doc.get("mentioned_user_ids") or [])
    doc["id"] = new_id()
    created_at = now_utc().isoformat()
    doc["created_at"] = created_at
    doc["updated_at"] = created_at
    if doc.get("published") and not doc.get("published_at"):
        doc["published_at"] = created_at
    doc["author_id"] = me["id"]
    doc["author_name"] = me.get("display_name") or me.get("username")
    await db.news_posts.insert_one(doc)
    if doc.get("published") and _published_now(doc):
        result = await enqueue_newsletter_for_item("news", doc)
        if result.get("reason") not in {"internal_visibility", "not_published"}:
            doc["newsletter_sent_at"] = now_utc().isoformat()
            doc["newsletter_sent_count"] = int(result.get("queued") or 0)
            await db.news_posts.update_one(
                {"id": doc["id"]},
                {"$set": {
                    "newsletter_sent_at": doc["newsletter_sent_at"],
                    "newsletter_sent_count": doc["newsletter_sent_count"],
                }},
            )
        await _notify_news_mentions(db, doc, me)
    doc.pop("_id", None)
    return doc


@router.put("/news/{nid}")
@router.patch("/news/{nid}")
async def update_news(nid: str, body: NewsUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    existing = await db.news_posts.find_one({"id": nid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Beitrag nicht gefunden.")
    update = body.model_dump(exclude_unset=True)
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
    if update.get("published_at"):
        update["published_at"] = update["published_at"].isoformat()
    if "content" in update or "mentioned_user_ids" in update:
        next_content = update.get("content", existing.get("content"))
        update["mentioned_user_ids"] = await _mentioned_user_ids_from_content(
            next_content,
            update.get("mentioned_user_ids", existing.get("mentioned_user_ids") or []),
        )
    if update.get("published") is True and "published_at" not in update:
        existing = await db.news_posts.find_one({"id": nid}, {"_id": 0, "published_at": 1})
        if existing and not existing.get("published_at"):
            update["published_at"] = now_utc().isoformat()
    update["updated_at"] = now_utc().isoformat()
    res = await db.news_posts.update_one({"id": nid}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Beitrag nicht gefunden.")
    saved = await db.news_posts.find_one({"id": nid}, {"_id": 0})
    if saved and saved.get("published") and _published_now(saved) and not saved.get("newsletter_sent_at"):
        result = await enqueue_newsletter_for_item("news", saved)
        if result.get("reason") not in {"internal_visibility", "not_published"}:
            await db.news_posts.update_one(
                {"id": nid},
                {"$set": {
                    "newsletter_sent_at": now_utc().isoformat(),
                    "newsletter_sent_count": int(result.get("queued") or 0),
                }},
            )
            saved = await db.news_posts.find_one({"id": nid}, {"_id": 0})
    if saved:
        await _notify_news_mentions(db, saved, me)
        saved = await db.news_posts.find_one({"id": nid}, {"_id": 0}) or saved
    return saved


@router.delete("/news/{nid}")
async def delete_news(nid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.news_posts.delete_one({"id": nid})
    return {"ok": True}


@router.get("/news-meta")
async def news_meta():
    """Public: list of valid categories and visibility options."""
    return {
        "categories": [
            {"k": "club", "l": "Verein"},
            {"k": "tournaments", "l": "Turniere"},
            {"k": "events", "l": "Events"},
            {"k": "community", "l": "Community"},
            {"k": "sponsors", "l": "Sponsoren"},
            {"k": "members", "l": "Mitglieder"},
            {"k": "teams", "l": "Teams"},
            {"k": "announcement", "l": "Ankündigung"},
            {"k": "recap", "l": "Rückblick"},
            {"k": "maintenance", "l": "Wartung"},
        ],
        "visibilities": [
            {"k": "public", "l": "Öffentlich"},
            {"k": "community", "l": "Nur registrierte Community"},
            {"k": "members", "l": "Nur Vereinsmitglieder"},
            {"k": "internal", "l": "Nur intern (Admins)"},
        ],
    }


# ---------- Sponsors ----------

_TIER_ORDER = {"main": 0, "platinum": 1, "gold": 2, "silver": 3, "bronze": 4}
_LEGACY_TIER_MAP = {"supporter": "bronze", "partner": "bronze"}
_SPONSOR_PLACEMENT_FIELDS = ("show_on_home", "show_on_footer", "show_on_events", "show_on_tv", "show_in_emails")
_SPONSOR_CONTRACT_STATUSES = {"planned", "active", "paused", "expired", "cancelled"}
_TIER_PLACEMENT_DEFAULTS = {
    "main": {"show_on_home": True, "show_on_footer": True, "show_on_events": False, "show_on_tv": True, "show_in_emails": True},
    "platinum": {"show_on_home": True, "show_on_footer": True, "show_on_events": False, "show_on_tv": True, "show_in_emails": False},
    "gold": {"show_on_home": False, "show_on_footer": True, "show_on_events": False, "show_on_tv": False, "show_in_emails": False},
    "silver": {"show_on_home": False, "show_on_footer": True, "show_on_events": False, "show_on_tv": False, "show_in_emails": False},
    "bronze": {"show_on_home": False, "show_on_footer": False, "show_on_events": False, "show_on_tv": False, "show_in_emails": False},
}


def _normalize_tier(t: str | None) -> str:
    """Map legacy tiers to new 5-tier system. Default = bronze."""
    if not t:
        return "bronze"
    return _LEGACY_TIER_MAP.get(t, t if t in _TIER_ORDER else "bronze")


def _sponsor_effective_flag(doc: dict, field: str) -> bool:
    return bool(doc.get(field))


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _clean_date(value) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    return raw[:10]


def _sponsor_effective_status(doc: dict) -> str:
    if doc.get("is_active") is False:
        return "inactive"
    status = str(doc.get("contract_status") or "active").strip().lower()
    if status not in _SPONSOR_CONTRACT_STATUSES:
        status = "active"
    if status in {"paused", "cancelled"}:
        return status
    today = _today_iso()
    start = _clean_date(doc.get("contract_start"))
    end = _clean_date(doc.get("contract_end"))
    if start and start > today:
        return "planned"
    if end and end < today:
        return "expired"
    return "active" if status in {"active", "expired", "planned"} else status


def _sponsor_is_public_active(doc: dict) -> bool:
    return _sponsor_effective_status(doc) == "active"


def _sponsor_defaults(doc: dict) -> dict:
    """Resolve tier-based placement suggestions when fields are missing."""
    tier = _normalize_tier(doc.get("tier"))
    doc["tier"] = tier
    status = str(doc.get("contract_status") or "active").strip().lower()
    doc["contract_status"] = status if status in _SPONSOR_CONTRACT_STATUSES else "active"
    doc["contract_start"] = _clean_date(doc.get("contract_start"))
    doc["contract_end"] = _clean_date(doc.get("contract_end"))
    defaults = _TIER_PLACEMENT_DEFAULTS.get(tier, _TIER_PLACEMENT_DEFAULTS["bronze"])
    for field in _SPONSOR_PLACEMENT_FIELDS:
        if doc.get(field) is None:
            doc[field] = defaults[field]
    if doc.get("event_ids") is None:
        doc["event_ids"] = []
    if doc.get("is_active") is None:
        doc["is_active"] = True
    doc["effective_status"] = _sponsor_effective_status(doc)
    doc["is_currently_visible"] = _sponsor_is_public_active(doc)
    return doc


@router.get("/sponsors")
async def list_sponsors(placement: Optional[str] = None):
    """Public list. ?placement=home/footer/events/tv/emails filters by enabled placement."""
    db = get_db()
    q = {"is_active": {"$ne": False}}
    sp = await db.sponsors.find(q, {"_id": 0}).to_list(500)
    # Normalize legacy tiers in-flight
    for s in sp:
        _sponsor_defaults(s)
    sp = [s for s in sp if _sponsor_is_public_active(s)]
    # Apply placement filter
    if placement == "home":
        sp = [s for s in sp if s["show_on_home"]]
    elif placement == "footer":
        sp = [s for s in sp if s["show_on_footer"]]
    elif placement == "events":
        sp = [s for s in sp if s["show_on_events"]]
    elif placement == "tv":
        sp = [s for s in sp if s["show_on_tv"]]
    elif placement == "emails":
        sp = [s for s in sp if s["show_in_emails"]]
    # Sort by tier then order_index
    sp.sort(key=lambda s: (_TIER_ORDER.get(s["tier"], 99), s.get("order_index") or 0, s.get("name") or ""))
    return dedupe_public_sponsors(sp)


@router.get("/sponsors/admin")
async def admin_list_sponsors(me: dict = Depends(require_admin())):
    db = get_db()
    sp = await db.sponsors.find({}, {"_id": 0}).to_list(500)
    for s in sp:
        _sponsor_defaults(s)
    sp.sort(key=lambda s: (_TIER_ORDER.get(s["tier"], 99), s.get("order_index") or 0, s.get("name") or ""))
    return sp


@router.post("/sponsors")
async def create_sponsor(body: SponsorCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    doc = _sponsor_defaults(doc)
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    await db.sponsors.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/sponsors/{sid}")
@router.patch("/sponsors/{sid}")
async def update_sponsor(sid: str, body: SponsorUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {
        "logo_url", "link", "description", "event_ids",
        "contract_start", "contract_end", "contact_name", "contact_email",
        "contact_phone", "internal_notes",
    }
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not updates:
        return {"ok": True}
    updates["updated_at"] = now_utc().isoformat()
    res = await db.sponsors.update_one({"id": sid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Sponsor nicht gefunden.")
    saved = await db.sponsors.find_one({"id": sid}, {"_id": 0})
    return _sponsor_defaults(saved) if saved else {"ok": True}


@router.delete("/sponsors/{sid}")
async def delete_sponsor(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.sponsors.delete_one({"id": sid})
    return {"ok": True}


# ---------- Partners ----------
def _partner_defaults(doc: dict) -> dict:
    if doc.get("is_active") is None:
        doc["is_active"] = True
    if not doc.get("kind"):
        doc["kind"] = "verein"
    return doc


def _medal_for_placement(placement: int | None) -> str | None:
    if placement == 1:
        return "gold"
    if placement == 2:
        return "silver"
    if placement == 3:
        return "bronze"
    return None


def _reference_summary(items: list[dict]) -> dict:
    placements = [int(item["placement"]) for item in items if item.get("placement")]
    return {
        "total": len(items),
        "active": sum(1 for item in items if (item.get("status") or "completed") == "active"),
        "planned": sum(1 for item in items if (item.get("status") or "completed") == "planned"),
        "podiums": sum(1 for place in placements if place <= 3),
        "gold": sum(1 for place in placements if place == 1),
        "silver": sum(1 for place in placements if place == 2),
        "bronze": sum(1 for place in placements if place == 3),
        "top10": sum(1 for place in placements if place <= 10),
        "games": len({item.get("game_id") or item.get("game_name") for item in items if item.get("game_id") or item.get("game_name")}),
    }


async def _enrich_references(items: list[dict]) -> list[dict]:
    db = get_db()
    game_ids = list({item.get("game_id") for item in items if item.get("game_id")})
    games = {}
    if game_ids:
        games = {g["id"]: g for g in await db.games.find({"id": {"$in": game_ids}}, {"_id": 0}).to_list(200)}
    parent_ids = list({g.get("parent_game_id") for g in games.values() if g.get("parent_game_id")})
    parents = {}
    if parent_ids:
        parents = {g["id"]: g for g in await db.games.find({"id": {"$in": parent_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "short_name": 1}).to_list(200)}
    lineup_user_ids = list({
        member.get("user_id")
        for item in items
        for member in (item.get("lineup_members") or [])
        if isinstance(member, dict) and member.get("user_id")
    })
    users_by_id = {}
    if lineup_user_ids:
        users_by_id = {
            user["id"]: user
            for user in await db.users.find(
                {"id": {"$in": lineup_user_ids}, "privacy_public_profile": True, "is_active": True, "is_banned": {"$ne": True}},
                {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
            ).to_list(500)
        }
    for item in items:
        game = games.get(item.get("game_id"))
        if game:
            parent = parents.get(game.get("parent_game_id"))
            game_name = (game.get("name") or "").strip()
            parent_name = ((parent or {}).get("name") or "").strip()
            if game.get("kind") == "edition" and parent_name and game_name and not game_name.lower().startswith(f"{parent_name.lower()}:") and game_name.lower() != parent_name.lower():
                display_name = f"{parent_name}: {game_name}"
            else:
                display_name = game_name
            item["game"] = {
                "id": game.get("id"),
                "name": game.get("name"),
                "display_name": display_name,
                "slug": game.get("slug"),
                "short_name": game.get("short_name"),
                "logo_url": game.get("logo_url"),
                "cover_url": game.get("cover_url"),
            }
            item["game_name"] = item.get("game_name") or display_name
        item["medal"] = _medal_for_placement(item.get("placement"))
        item["lineup_members"] = [
            {
                **member,
                "username": users_by_id.get(member.get("user_id"), {}).get("username"),
                "avatar_url": users_by_id.get(member.get("user_id"), {}).get("avatar_url"),
                "profile_url": f"/u/{users_by_id[member.get('user_id')]['username']}" if users_by_id.get(member.get("user_id")) else None,
            }
            for member in (item.get("lineup_members") or [])
            if isinstance(member, dict)
        ]
    return items


def _clean_reference_profile_ids(value: list | None) -> list[str]:
    seen = set()
    ids: list[str] = []
    for raw in value or []:
        profile_id = str(raw or "").strip()
        if profile_id and profile_id not in seen:
            seen.add(profile_id)
            ids.append(profile_id)
    return ids


def _reference_member_snapshot(profile: dict) -> dict:
    display_name = (
        profile.get("gamertag")
        or profile.get("display_name")
        or profile.get("real_name")
        or "Unbekannt"
    )
    return {
        "profile_id": profile.get("id"),
        "user_id": profile.get("user_id"),
        "display_name": display_name,
        "profile_name": profile.get("display_name") or display_name,
        "gamertag": profile.get("gamertag"),
        "slug": profile.get("slug"),
        "is_active": profile.get("is_active") is not False,
    }


async def _freeze_reference_members(db, doc: dict, existing: dict | None = None) -> None:
    profile_ids = _clean_reference_profile_ids(doc.get("member_profile_ids"))
    previous = {
        item.get("profile_id"): item
        for item in ((existing or {}).get("lineup_members") or doc.get("lineup_members") or [])
        if isinstance(item, dict) and item.get("profile_id")
    }
    profiles = {}
    if profile_ids:
        profiles = {
            row["id"]: row
            for row in await db.club_member_profiles.find(
                {"id": {"$in": profile_ids}}, {"_id": 0}
            ).to_list(500)
        }
    doc["member_profile_ids"] = profile_ids
    doc["lineup_members"] = [
        _reference_member_snapshot(profiles[profile_id])
        if profile_id in profiles
        else previous.get(profile_id, {"profile_id": profile_id, "display_name": "Ehemaliges Mitglied"})
        for profile_id in profile_ids
    ]


def _sort_references(items: list[dict]) -> list[dict]:
    status_rank = {"active": 0, "planned": 1, "completed": 2, "archived": 3}

    def date_ts(item: dict) -> float:
        value = item.get("start_date") or item.get("end_date")
        if not value:
            return 0
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0

    return sorted(items, key=lambda item: (
        status_rank.get(item.get("status") or "completed", 2),
        -(item.get("order_index") or 0),
        -date_ts(item),
        item.get("title") or "",
    ))


@router.get("/partners")
async def list_partners():
    db = get_db()
    partners = await db.partners.find({"is_active": {"$ne": False}}, {"_id": 0}).to_list(500)
    partners.sort(key=lambda p: (p.get("order_index") or 0, p.get("name") or ""))
    return partners


@router.get("/partners/admin")
async def admin_list_partners(me: dict = Depends(require_admin())):
    db = get_db()
    partners = await db.partners.find({}, {"_id": 0}).to_list(500)
    partners.sort(key=lambda p: (p.get("order_index") or 0, p.get("name") or ""))
    return partners


@router.post("/partners")
async def create_partner(body: PartnerCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = _partner_defaults(body.model_dump())
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.partners.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/partners/{pid}")
@router.patch("/partners/{pid}")
async def update_partner(pid: str, body: PartnerUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"logo_url", "link", "description"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not updates:
        return {"ok": True}
    updates["updated_at"] = now_utc().isoformat()
    res = await db.partners.update_one({"id": pid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Partner nicht gefunden.")
    return await db.partners.find_one({"id": pid}, {"_id": 0})


@router.delete("/partners/{pid}")
async def delete_partner(pid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.partners.delete_one({"id": pid})
    return {"ok": True}


# ---------- References ----------
@router.get("/references")
async def list_references(game_id: Optional[str] = None, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    query = {"is_active": {"$ne": False}}
    if game_id:
        query["game_id"] = game_id
    refs = await db.references.find(query, {"_id": 0}).to_list(1000)
    refs = await _filter_visible(refs, user)
    refs = _sort_references(await _enrich_references(refs))
    return {"items": refs, "summary": _reference_summary(refs)}


@router.get("/references/admin")
async def admin_list_references(me: dict = Depends(require_admin())):
    db = get_db()
    refs = await db.references.find({}, {"_id": 0}).to_list(1000)
    refs = _sort_references(await _enrich_references(refs))
    return {"items": refs, "summary": _reference_summary(refs)}


@router.get("/references/{rid}")
async def get_reference(rid: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    ref = await db.references.find_one({"id": rid, "is_active": {"$ne": False}}, {"_id": 0})
    if not ref:
        raise HTTPException(404, "Referenz nicht gefunden.")
    visible = await _filter_visible([ref], user)
    if not visible:
        raise HTTPException(404, "Referenz nicht gefunden.")
    return (await _enrich_references(visible))[0]


@router.post("/references")
async def create_reference(body: ReferenceCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    if doc.get("game_id") and not await db.games.find_one({"id": doc["game_id"]}, {"id": 1}):
        raise HTTPException(404, "Spiel nicht gefunden.")
    await _freeze_reference_members(db, doc)
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.references.insert_one(doc)
    doc.pop("_id", None)
    return (await _enrich_references([doc]))[0]


@router.put("/references/{rid}")
@router.patch("/references/{rid}")
async def update_reference(rid: str, body: ReferenceUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {
        "organizer", "game_id", "game_name", "team_name", "placement", "placement_label",
        "participant_count", "team_count", "start_date", "end_date", "location",
        "external_url", "bracket_url", "match_url", "result_url", "description", "highlights",
    }
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if updates.get("game_id") and not await db.games.find_one({"id": updates["game_id"]}, {"id": 1}):
        raise HTTPException(404, "Spiel nicht gefunden.")
    existing = None
    if "member_profile_ids" in updates or "lineup_members" in updates:
        existing = await db.references.find_one({"id": rid}, {"_id": 0})
        if not existing:
            raise HTTPException(404, "Referenz nicht gefunden.")
        await _freeze_reference_members(db, updates, existing)
    if not updates:
        return {"ok": True}
    updates["updated_at"] = now_utc().isoformat()
    res = await db.references.update_one({"id": rid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Referenz nicht gefunden.")
    saved = await db.references.find_one({"id": rid}, {"_id": 0})
    return (await _enrich_references([saved]))[0]


@router.delete("/references/{rid}")
async def delete_reference(rid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.references.delete_one({"id": rid})
    return {"ok": True}


# ---------- Gallery ----------
@router.get("/gallery")
async def list_albums(
    event_id: Optional[str] = None,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    q: dict = {"published": True}
    if event_id:
        q["event_id"] = event_id
    albums = await db.gallery_albums.find(q, {"_id": 0}).sort([("order_index", 1), ("taken_at", -1)]).to_list(500)
    visible = await _filter_visible(albums, user)
    # attach photo count
    for a in visible:
        a["photo_count"] = await db.gallery_photos.count_documents({"album_id": a["id"]})
    return visible


@router.get("/gallery/{slug_or_id}")
async def get_album(slug_or_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    a = await db.gallery_albums.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not a or not a.get("published", True):
        raise HTTPException(404, "Album nicht gefunden.")
    if not await _user_can_see(user, a.get("visibility") or "public"):
        raise HTTPException(403, "Nicht sichtbar.")
    a["photos"] = await db.gallery_photos.find({"album_id": a["id"]}, {"_id": 0}).sort("order_index", 1).to_list(2000)
    if a.get("event_id"):
        event = await _visible_event_summary(a["event_id"], user)
        if event:
            a["event"] = event
    return a


@router.get("/admin/gallery")
async def admin_list_albums(me: dict = Depends(require_admin())):
    db = get_db()
    albums = await db.gallery_albums.find({}, {"_id": 0}).sort("order_index", 1).to_list(1000)
    for a in albums:
        a["photo_count"] = await db.gallery_photos.count_documents({"album_id": a["id"]})
    return albums


@router.get("/admin/gallery/{aid}")
async def admin_get_album(aid: str, me: dict = Depends(require_admin())):
    db = get_db()
    a = await db.gallery_albums.find_one({"$or": [{"id": aid}, {"slug": aid}]}, {"_id": 0})
    if not a:
        raise HTTPException(404, "Album nicht gefunden.")
    a["photos"] = await db.gallery_photos.find({"album_id": a["id"]}, {"_id": 0}).sort("order_index", 1).to_list(2000)
    return a


@router.post("/gallery")
async def create_album(body: GalleryAlbumCreate, me: dict = Depends(require_admin())):
    db = get_db()
    slug = (body.slug or "").strip().lower()
    if await db.gallery_albums.find_one({"slug": slug}):
        raise HTTPException(409, f"Slug bereits vergeben: {slug}")
    doc = body.model_dump()
    doc["slug"] = slug
    if doc.get("taken_at"):
        doc["taken_at"] = doc["taken_at"].isoformat()
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.gallery_albums.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/gallery/{aid}")
@router.patch("/gallery/{aid}")
async def update_album(aid: str, body: GalleryAlbumUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    album = await db.gallery_albums.find_one({"$or": [{"id": aid}, {"slug": aid}]}, {"_id": 0, "id": 1})
    if not album:
        raise HTTPException(404, "Album nicht gefunden.")
    update = body.model_dump(exclude_unset=True)
    if "slug" in update and update["slug"]:
        update["slug"] = update["slug"].strip().lower()
        existing = await db.gallery_albums.find_one({"slug": update["slug"], "id": {"$ne": album["id"]}}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(409, f"Slug bereits vergeben: {update['slug']}")
    if update.get("taken_at"):
        update["taken_at"] = update["taken_at"].isoformat()
    update["updated_at"] = now_utc().isoformat()
    res = await db.gallery_albums.update_one({"id": album["id"]}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Album nicht gefunden.")
    return await db.gallery_albums.find_one({"id": album["id"]}, {"_id": 0})


@router.delete("/gallery/{aid}")
async def delete_album(aid: str, me: dict = Depends(require_admin())):
    db = get_db()
    album = await db.gallery_albums.find_one({"$or": [{"id": aid}, {"slug": aid}]}, {"_id": 0, "id": 1})
    if not album:
        raise HTTPException(404, "Album nicht gefunden.")
    await db.gallery_photos.delete_many({"album_id": album["id"]})
    await db.gallery_albums.delete_one({"id": album["id"]})
    return {"ok": True}


@router.post("/gallery/{aid}/photos")
async def add_photo(aid: str, body: GalleryPhotoCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if not await db.gallery_albums.find_one({"id": aid}):
        raise HTTPException(404, "Album nicht gefunden.")
    doc = {
        "id": new_id(), "album_id": aid,
        **body.model_dump(),
        "uploaded_at": now_utc().isoformat(),
        "uploaded_by": me["id"],
    }
    await db.gallery_photos.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/gallery/photos/{pid}")
@router.patch("/gallery/photos/{pid}")
async def update_photo(pid: str, body: GalleryPhotoUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    update = body.model_dump(exclude_unset=True)
    res = await db.gallery_photos.update_one({"id": pid}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Foto nicht gefunden.")
    return await db.gallery_photos.find_one({"id": pid}, {"_id": 0})


@router.delete("/gallery/photos/{pid}")
async def delete_photo(pid: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.gallery_photos.delete_one({"id": pid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Foto nicht gefunden.")
    return {"ok": True}
