"""Phase F.2 + Phase G — Media Browser, Navigation Editor, SEO routes.

Endpoints:
  GET    /api/admin/media                       — list uploaded files
  DELETE /api/admin/media/{filename}            — delete uploaded file

  GET    /api/nav                               — public nav structure
  GET    /api/admin/nav                         — admin (with hidden items)
  PUT    /api/admin/nav                         — replace full nav structure

  GET    /sitemap.xml                           — search-engine sitemap
  GET    /robots.txt                            — search-engine robots
"""
import os
import re
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from database import get_db
from auth import require_admin, get_current_user
from models import now_utc

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
PUBLIC_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
IMAGE_REFERENCE_FIELDS = [
    ("settings", {"id": "branding"}, ["logo_url", "mascot_url", "favicon_url"]),
    ("settings", {"id": "discord"}, ["avatar_url"]),
    ("users", {}, ["avatar_url", "banner_url"]),
    ("teams", {}, ["logo_url", "banner_url"]),
    ("sponsors", {}, ["logo_url"]),
    ("news_posts", {}, ["banner_url", "cover_url"]),
    ("events", {}, ["banner_url", "cover_url"]),
    ("games", {}, ["cover_url", "logo_url"]),
    ("tournaments", {}, ["banner_url", "cover_url"]),
    ("f1_challenges", {}, ["banner_url", "cover_url"]),
    ("f1_tracks", {}, ["image_url"]),
    ("gallery_albums", {}, ["cover_url"]),
    ("gallery_photos", {}, ["image_url", "thumbnail_url"]),
    ("member_benefits", {}, ["image_url"]),
]


# ============= Media Browser =============
media_router = APIRouter(prefix="/api/media", tags=["media"])
admin_media_router = APIRouter(prefix="/api/admin/media", tags=["cms-admin"])


ADMIN_MEDIA_ROLES = {"tournament_admin", "club_admin", "superadmin"}


async def _list_media_items(owner_id: str | None = None, include_untracked: bool = True) -> list[dict]:
    if not UPLOAD_DIR.exists():
        return []
    candidates: list[Path] = []
    for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR):
        if base.exists():
            candidates.extend([p for p in base.iterdir() if p.is_file()])
    candidates = [
        p for p in candidates
        if not p.name.startswith(".") and p.suffix.lower() in PUBLIC_IMAGE_EXTS
    ]
    filenames = [p.name for p in candidates]
    media_meta: dict[str, dict[str, Any]] = {}
    if filenames:
        db = get_db()
        meta_query: dict[str, Any] = {"filename": {"$in": filenames}}
        if owner_id:
            meta_query["owner_id"] = owner_id
        rows = await db.media_uploads.find(meta_query, {"_id": 0}).to_list(len(filenames))
        media_meta = {row["filename"]: row for row in rows if row.get("filename")}
    items: list[dict] = []
    for p in sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True):
        meta = media_meta.get(p.name)
        if owner_id and not meta:
            continue
        if not include_untracked and not meta:
            continue
        stat = p.stat()
        items.append({
            "filename": p.name,
            "url": f"/api/static/uploads/{p.name}",
            "size": stat.st_size,
            "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "ext": p.suffix.lower().lstrip("."),
            "owner_id": meta.get("owner_id") if meta else None,
            "owner_role": meta.get("owner_role") if meta else None,
            "original_filename": meta.get("original_filename") if meta else None,
            "created_at": meta.get("created_at") if meta else None,
        })
    return items[:500]


@media_router.get("")
async def list_media(me: dict = Depends(get_current_user)):
    """List uploaded images visible in the current user's media picker."""
    if me.get("role") in ADMIN_MEDIA_ROLES:
        return await _list_media_items()
    return await _list_media_items(owner_id=me["id"], include_untracked=False)


@admin_media_router.get("")
async def admin_list_media(me: dict = Depends(require_admin())):
    """List all files in the upload directory with metadata."""
    return await _list_media_items()


async def _clear_media_references(url: str) -> int:
    db = get_db()
    cleared = 0
    for collection, base_filter, fields in IMAGE_REFERENCE_FIELDS:
        col = getattr(db, collection)
        for field in fields:
            res = await col.update_many(
                {**base_filter, field: {"$regex": f"{re.escape(url)}$"}},
                {"$set": {field: None, "updated_at": now_utc().isoformat()}},
            )
            cleared += res.modified_count
    return cleared


@admin_media_router.delete("/{filename}")
async def admin_delete_media(filename: str, me: dict = Depends(require_admin())):
    """Delete a file from upload dir. Path-traversal protected."""
    if "/" in filename or ".." in filename or filename.startswith("."):
        raise HTTPException(400, "Ungültiger Dateiname.")
    p = PUBLIC_UPLOAD_DIR / filename
    if not p.exists():
        p = UPLOAD_DIR / filename
    if p.suffix.lower() not in PUBLIC_IMAGE_EXTS:
        raise HTTPException(404, "Datei nicht gefunden.")
    if not p.exists() or not p.is_file():
        raise HTTPException(404, "Datei nicht gefunden.")
    try:
        p.unlink()
    except OSError as e:
        raise HTTPException(500, f"Löschen fehlgeschlagen: {e}")
    cleared_refs = await _clear_media_references(f"/api/static/uploads/{filename}")
    return {"ok": True, "cleared_references": cleared_refs}


# ============= Navigation Editor =============
NAV_DOC_ID = "main_nav"

DEFAULT_NAV = {
    "id": NAV_DOC_ID,
    "items": [
        {"key": "home", "to": "/", "label": "Home", "visible": True, "order": 0},
        {"key": "news", "to": "/news", "label": "News", "visible": True, "order": 1, "children": [
            {"key": "news-overview", "to": "/news", "label": "Alle News", "visible": True},
            {"key": "news-events", "to": "/events", "label": "Events", "visible": True},
            {"key": "news-tournaments", "to": "/tournaments", "label": "Turniere", "visible": True},
            {"key": "news-fastlap", "to": "/fastlap", "label": "Fast Lap", "visible": True},
        ]},
        {"key": "events", "to": "/events", "label": "Events", "visible": True, "order": 2, "children": [
            {"key": "events-overview", "to": "/events", "label": "Alle Events", "visible": True},
            {"key": "events-tournaments", "to": "/tournaments", "label": "Turniere", "visible": True},
            {"key": "events-fastlap", "to": "/fastlap", "label": "Fast Lap", "visible": True},
            {"key": "events-gallery", "to": "/galerie", "label": "Galerie", "visible": True},
        ]},
        {"key": "club", "to": "/about", "label": "Verein", "visible": True, "order": 3, "children": [
            {"key": "about", "to": "/about", "label": "Über uns", "visible": True},
            {"key": "board", "to": "/board", "label": "Vorstand", "visible": True},
            {"key": "values", "to": "/values", "label": "Werte & Ziele", "visible": True},
            {"key": "partners", "to": "/partners", "label": "Partner", "visible": True},
            {"key": "sponsors", "to": "/sponsors", "label": "Sponsoren", "visible": True},
            {"key": "gallery", "to": "/galerie", "label": "Galerie", "visible": True},
        ]},
        {"key": "esports", "label": "eSports", "visible": True, "order": 4, "children": [
            {"key": "tournaments", "to": "/tournaments", "label": "Turniere", "visible": True},
            {"key": "fastlap", "to": "/fastlap", "label": "Fast Lap", "visible": True},
            {"key": "teams", "to": "/teams", "label": "Teams", "visible": True},
            {"key": "season", "to": "/seasons/current", "label": "Season Pass", "visible": True},
        ]},
        {"key": "community", "label": "Community", "visible": True, "order": 5, "children": [
            {"key": "members", "to": "/members", "label": "Vereinsmitglieder", "visible": True},
            {"key": "players", "to": "/players", "label": "Community-Spieler", "visible": True},
            {"key": "join", "to": "/membership/join", "label": "Mitglied werden", "visible": True},
        ]},
        {"key": "contact", "to": "/contact", "label": "Kontakt", "visible": True, "order": 6},
    ],
}


async def seed_default_nav():
    db = get_db()
    existing = await db.cms_nav.find_one({"id": NAV_DOC_ID})
    if not existing:
        await db.cms_nav.insert_one({**DEFAULT_NAV, "updated_at": now_utc().isoformat()})
    else:
        normalized = _normalize_nav_doc(existing)
        if normalized.get("items") != existing.get("items"):
            await db.cms_nav.update_one(
                {"id": NAV_DOC_ID},
                {"$set": {"items": normalized["items"], "updated_at": now_utc().isoformat()}},
            )


nav_router = APIRouter(prefix="/api/nav", tags=["cms"])


def _filter_visible(items: list[dict]) -> list[dict]:
    out = []
    for it in items:
        if it.get("visible") is False:
            continue
        copy = {k: v for k, v in it.items() if k != "children"}
        if it.get("children"):
            copy["children"] = _filter_visible(it["children"])
        out.append(copy)
    return out


def _merge_nav_item(current: dict, default: dict) -> dict:
    merged = {**default, **current}
    default_children = default.get("children") or []
    current_children = current.get("children") or []
    if default_children:
        current_by_key = {c.get("key") or c.get("to") or c.get("label"): c for c in current_children}
        merged_children = []
        for child_default in default_children:
            key = child_default.get("key") or child_default.get("to") or child_default.get("label")
            merged_children.append(_merge_nav_item(current_by_key.pop(key, {}), child_default))
        merged_children.extend(current_by_key.values())
        merged["children"] = merged_children
    return merged


def _normalize_nav_doc(doc: dict) -> dict:
    current_items = doc.get("items") or []
    current_by_key = {it.get("key") or it.get("to") or it.get("label"): it for it in current_items}
    normalized = []
    for default_item in DEFAULT_NAV["items"]:
        key = default_item.get("key") or default_item.get("to") or default_item.get("label")
        normalized.append(_merge_nav_item(current_by_key.pop(key, {}), default_item))
    normalized.extend(current_by_key.values())
    return {**doc, "id": NAV_DOC_ID, "items": normalized}


@nav_router.get("")
async def public_nav():
    db = get_db()
    doc = await db.cms_nav.find_one({"id": NAV_DOC_ID}, {"_id": 0}) or DEFAULT_NAV
    doc = _normalize_nav_doc(doc)
    items = sorted(doc.get("items", []), key=lambda x: x.get("order", 0))
    return {"items": _filter_visible(items)}


admin_nav_router = APIRouter(prefix="/api/admin/nav", tags=["cms-admin"])


@admin_nav_router.get("")
async def admin_get_nav(me: dict = Depends(require_admin())):
    db = get_db()
    doc = await db.cms_nav.find_one({"id": NAV_DOC_ID}, {"_id": 0}) or DEFAULT_NAV
    return _normalize_nav_doc(doc)


class NavBody(BaseModel):
    items: list[Any]


@admin_nav_router.put("")
async def admin_put_nav(body: NavBody, me: dict = Depends(require_admin())):
    db = get_db()
    await db.cms_nav.update_one(
        {"id": NAV_DOC_ID},
        {"$set": {"id": NAV_DOC_ID, "items": body.items, "updated_at": now_utc().isoformat()}},
        upsert=True,
    )
    return await db.cms_nav.find_one({"id": NAV_DOC_ID}, {"_id": 0})


# ============= SEO — robots.txt =============
seo_router = APIRouter(tags=["seo"])


@seo_router.get("/api/robots.txt")
async def robots():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    base = (branding.get("domain") or "").rstrip("/") or os.environ.get("PUBLIC_URL", "").rstrip("/")
    body = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin/",
        "Disallow: /api/",
        f"Sitemap: {base}/sitemap.xml" if base else "Sitemap: /api/sitemap.xml",
    ]
    return Response(content="\n".join(filter(None, body)), media_type="text/plain")


# ============= JSON-LD endpoint per CMS page =============
seo_meta_router = APIRouter(prefix="/api/seo", tags=["seo"])


@seo_meta_router.get("/page/{slug}")
async def page_meta(slug: str):
    """Return SEO JSON-LD + meta-tags hint for a public page (used by frontend)."""
    db = get_db()
    page = await db.cms_pages.find_one({"slug": slug, "is_published": {"$ne": False}}, {"_id": 0})
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    if not page:
        raise HTTPException(404, "Seite nicht gefunden.")
    org_name = branding.get("club_name") or "THE LION SQUAD — eSPORTS"
    json_ld = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": page["title"],
        "description": page.get("meta_description") or page.get("title"),
        "isPartOf": {
            "@type": "WebSite",
            "name": org_name,
            "url": branding.get("domain") or "",
        },
    }
    return {
        "title": f"{page['title']} · {org_name}",
        "description": page.get("meta_description") or page["title"],
        "json_ld": json_ld,
    }
