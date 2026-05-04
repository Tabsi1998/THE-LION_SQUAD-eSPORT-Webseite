"""News, Sponsors & Gallery routes — Vereins-CMS Phase 3."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from database import get_db
from auth import require_admin, get_optional_user
from services.visibility import user_can_see, filter_visible
from models import (
    NewsCreate, NewsUpdate, SponsorCreate,
    GalleryAlbumCreate, GalleryAlbumUpdate,
    GalleryPhotoCreate, GalleryPhotoUpdate,
    now_utc, new_id,
)

router = APIRouter(prefix="/api", tags=["news"])


# ---------- Visibility helper (delegates to shared module) ----------
async def _user_can_see(user: dict | None, visibility: str) -> bool:
    return await user_can_see(user, visibility)


async def _filter_visible(items: list, user: dict | None) -> list:
    return await filter_visible(items, user)


# ---------- News ----------
@router.get("/news")
async def list_news(
    category: Optional[str] = None,
    pinned_only: bool = False,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    is_admin = user and user.get("role") in ("moderator", "tournament_admin", "club_admin", "superadmin")
    q: dict = {} if is_admin else {"published": True}
    if category:
        q["category"] = category
    if pinned_only:
        q["pinned"] = True
    posts = await db.news_posts.find(q, {"_id": 0}).sort([("pinned", -1), ("created_at", -1)]).to_list(200)
    return await _filter_visible(posts, user)


@router.get("/news/{slug_or_id}")
async def get_news(slug_or_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    p = await db.news_posts.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Beitrag nicht gefunden.")
    if not await _user_can_see(user, p.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Nicht sichtbar.")
    # Resolve linked entities
    db = get_db()
    if p.get("linked_event_ids"):
        p["linked_events"] = await db.events.find(
            {"id": {"$in": p["linked_event_ids"]}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "start_date": 1},
        ).to_list(50)
    if p.get("linked_tournament_ids"):
        p["linked_tournaments"] = await db.tournaments.find(
            {"id": {"$in": p["linked_tournament_ids"]}}, {"_id": 0, "id": 1, "title": 1, "slug": 1, "start_date": 1},
        ).to_list(50)
    if p.get("linked_team_ids"):
        p["linked_teams"] = await db.teams.find(
            {"id": {"$in": p["linked_team_ids"]}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "logo_url": 1},
        ).to_list(50)
    return p


@router.get("/admin/news")
async def admin_list_news(me: dict = Depends(require_admin())):
    db = get_db()
    posts = await db.news_posts.find({}, {"_id": 0}).sort([("pinned", -1), ("created_at", -1)]).to_list(500)
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
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["author_id"] = me["id"]
    doc["author_name"] = me.get("display_name") or me.get("username")
    await db.news_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/news/{nid}")
async def update_news(nid: str, body: NewsUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    update = body.model_dump(exclude_unset=True)
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
    if update.get("published_at"):
        update["published_at"] = update["published_at"].isoformat()
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
@router.get("/sponsors")
async def list_sponsors():
    db = get_db()
    sp = await db.sponsors.find({}, {"_id": 0}).to_list(100)
    return sp


@router.post("/sponsors")
async def create_sponsor(body: SponsorCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    await db.sponsors.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/sponsors/{sid}")
async def update_sponsor(sid: str, body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.items() if k in {"name", "logo_url", "link", "description", "tier"}}
    if not updates:
        return {"ok": True}
    await db.sponsors.update_one({"id": sid}, {"$set": updates})
    return {"ok": True}


@router.delete("/sponsors/{sid}")
async def delete_sponsor(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.sponsors.delete_one({"id": sid})
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
    if not a:
        raise HTTPException(404, "Album nicht gefunden.")
    if not await _user_can_see(user, a.get("visibility") or "public"):
        raise HTTPException(403, "Nicht sichtbar.")
    a["photos"] = await db.gallery_photos.find({"album_id": a["id"]}, {"_id": 0}).sort("order_index", 1).to_list(2000)
    if a.get("event_id"):
        a["event"] = await db.events.find_one(
            {"id": a["event_id"]}, {"_id": 0, "id": 1, "name": 1, "slug": 1},
        )
    return a


@router.get("/admin/gallery")
async def admin_list_albums(me: dict = Depends(require_admin())):
    db = get_db()
    albums = await db.gallery_albums.find({}, {"_id": 0}).sort("order_index", 1).to_list(1000)
    for a in albums:
        a["photo_count"] = await db.gallery_photos.count_documents({"album_id": a["id"]})
    return albums


@router.post("/gallery")
async def create_album(body: GalleryAlbumCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.gallery_albums.find_one({"slug": body.slug}):
        raise HTTPException(409, "Slug bereits vergeben.")
    doc = body.model_dump()
    if doc.get("taken_at"):
        doc["taken_at"] = doc["taken_at"].isoformat()
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.gallery_albums.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/gallery/{aid}")
async def update_album(aid: str, body: GalleryAlbumUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    update = body.model_dump(exclude_unset=True)
    if update.get("taken_at"):
        update["taken_at"] = update["taken_at"].isoformat()
    update["updated_at"] = now_utc().isoformat()
    res = await db.gallery_albums.update_one({"id": aid}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Album nicht gefunden.")
    return await db.gallery_albums.find_one({"id": aid}, {"_id": 0})


@router.delete("/gallery/{aid}")
async def delete_album(aid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.gallery_photos.delete_many({"album_id": aid})
    await db.gallery_albums.delete_one({"id": aid})
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
    await db.gallery_photos.delete_one({"id": pid})
    return {"ok": True}
