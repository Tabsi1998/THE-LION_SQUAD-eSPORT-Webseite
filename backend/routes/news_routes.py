"""News, Sponsors & Gallery routes — Vereins-CMS Phase 3."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
from database import get_db
from auth import require_admin, get_optional_user
from services.visibility import user_can_see, filter_visible
from services.content_embed_service import resolve_content_embeds
from models import (
    NewsCreate, NewsUpdate, SponsorCreate, SponsorUpdate,
    PartnerCreate, PartnerUpdate,
    GalleryAlbumCreate, GalleryAlbumUpdate,
    GalleryPhotoCreate, GalleryPhotoUpdate,
    now_utc, new_id,
)

router = APIRouter(prefix="/api", tags=["news"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}


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
    doc["id"] = new_id()
    created_at = now_utc().isoformat()
    doc["created_at"] = created_at
    doc["updated_at"] = created_at
    if doc.get("published") and not doc.get("published_at"):
        doc["published_at"] = created_at
    doc["author_id"] = me["id"]
    doc["author_name"] = me.get("display_name") or me.get("username")
    await db.news_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/news/{nid}")
@router.patch("/news/{nid}")
async def update_news(nid: str, body: NewsUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    update = body.model_dump(exclude_unset=True)
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
    if update.get("published_at"):
        update["published_at"] = update["published_at"].isoformat()
    if update.get("published") is True and "published_at" not in update:
        existing = await db.news_posts.find_one({"id": nid}, {"_id": 0, "published_at": 1})
        if existing and not existing.get("published_at"):
            update["published_at"] = now_utc().isoformat()
    update["updated_at"] = now_utc().isoformat()
    res = await db.news_posts.update_one({"id": nid}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Beitrag nicht gefunden.")
    return await db.news_posts.find_one({"id": nid}, {"_id": 0})


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

# Tier hierarchy used for default placement & auto-flags.
# 5 tiers: Hauptsponsor (main) → Platin → Gold → Silber → Bronze.
_TIER_ORDER = {"main": 0, "platinum": 1, "gold": 2, "silver": 3, "bronze": 4}
_LEGACY_TIER_MAP = {"supporter": "bronze", "partner": "bronze"}
_SPONSOR_PLACEMENT_DEFAULTS = {
    "show_on_home": {"main", "platinum", "gold"},
    "show_on_footer": {"main", "platinum", "gold", "silver"},
    "show_on_events": {"main", "platinum", "gold"},
}


def _normalize_tier(t: str | None) -> str:
    """Map legacy tiers to new 5-tier system. Default = bronze."""
    if not t:
        return "bronze"
    return _LEGACY_TIER_MAP.get(t, t if t in _TIER_ORDER else "bronze")


def _sponsor_effective_flag(doc: dict, field: str) -> bool:
    tier = _normalize_tier(doc.get("tier"))
    raw = doc.get(field)
    if raw is None:
        return tier in _SPONSOR_PLACEMENT_DEFAULTS[field]
    return bool(raw)


def _sponsor_defaults(doc: dict) -> dict:
    """Resolve auto-derived placement flags based on tier when not explicitly set."""
    tier = _normalize_tier(doc.get("tier"))
    doc["tier"] = tier
    for field in _SPONSOR_PLACEMENT_DEFAULTS:
        if doc.get(field) is None:
            doc[field] = _sponsor_effective_flag(doc, field)
    if doc.get("event_ids") is None:
        doc["event_ids"] = []
    if doc.get("is_active") is None:
        doc["is_active"] = True
    return doc


@router.get("/sponsors")
async def list_sponsors(placement: Optional[str] = None):
    """Public list. ?placement=home → only sponsors with show_on_home,
    ?placement=footer → only show_on_footer, ?placement=all → everything."""
    db = get_db()
    q = {"is_active": {"$ne": False}}
    sp = await db.sponsors.find(q, {"_id": 0}).to_list(500)
    # Normalize legacy tiers in-flight
    for s in sp:
        _sponsor_defaults(s)
    # Apply placement filter
    if placement == "home":
        sp = [s for s in sp if s["show_on_home"]]
    elif placement == "footer":
        sp = [s for s in sp if s["show_on_footer"]]
    elif placement == "events":
        sp = [s for s in sp if s["show_on_events"]]
    # Sort by tier then order_index
    sp.sort(key=lambda s: (_TIER_ORDER.get(s["tier"], 99), s.get("order_index") or 0, s.get("name") or ""))
    return sp


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
    nullable_fields = {"logo_url", "link", "description", "event_ids"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not updates:
        return {"ok": True}
    # When tier changes without explicit placement flags, recompute all defaults together.
    placement_fields = set(_SPONSOR_PLACEMENT_DEFAULTS)
    if "tier" in updates and not any(field in updates for field in placement_fields):
        cur = await db.sponsors.find_one({"id": sid}, {"_id": 0}) or {}
        merged = {**cur, **updates, **{field: None for field in placement_fields}}
        merged = _sponsor_defaults(merged)
        for field in placement_fields:
            updates[field] = merged[field]
    updates["updated_at"] = now_utc().isoformat()
    res = await db.sponsors.update_one({"id": sid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Sponsor nicht gefunden.")
    return await db.sponsors.find_one({"id": sid}, {"_id": 0})


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
