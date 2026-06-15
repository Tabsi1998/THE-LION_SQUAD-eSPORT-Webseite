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
import hashlib
import os
import re
from pathlib import Path
from typing import Any
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel

from database import get_db
from auth import require_admin, get_current_user
from models import now_utc

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
PUBLIC_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ADMIN_MEDIA_OWNER_ROLES = {"admin", "moderator", "tournament_admin", "club_admin", "superadmin"}
IMAGE_REFERENCE_FIELDS = [
    ("settings", {"id": "branding"}, ["logo_url", "logo_light_url", "logo_dark_url", "share_banner_url", "mascot_url", "qr_logo_url", "favicon_url", "favicon_light_url", "favicon_dark_url"]),
    ("settings", {"id": "discord"}, ["avatar_url"]),
    ("users", {}, ["avatar_url", "banner_url"]),
    ("teams", {}, ["logo_url", "banner_url"]),
    ("sponsors", {}, ["logo_url"]),
    ("partners", {}, ["logo_url"]),
    ("news_posts", {}, ["banner_url", "cover_url"]),
    ("events", {}, ["banner_url", "cover_url"]),
    ("games", {}, ["cover_url", "logo_url"]),
    ("tournaments", {}, ["banner_url", "cover_url"]),
    ("f1_challenges", {}, ["banner_url", "cover_url"]),
    ("f1_tracks", {}, ["image_url"]),
    ("seasons", {}, ["banner_url"]),
    ("gallery_albums", {}, ["cover_url"]),
    ("gallery_photos", {}, ["image_url", "thumbnail_url"]),
    ("member_benefits", {}, ["image_url"]),
    ("club_member_profiles", {}, ["photo_url", "cover_url"]),
]

TEXT_IMAGE_REFERENCE_FIELDS = [
    ("cms_pages", ["body_md"]),
    ("news_posts", ["content"]),
    ("events", ["description", "program"]),
    ("tournaments", ["description"]),
    ("f1_challenges", ["description"]),
    ("club_member_profiles", ["bio"]),
]

TEXT_IMAGE_RE = re.compile(
    r"!\[[^\]\n]*\]\((?P<md>[^)\s]+)\)|<img\b[^>]*\bsrc=[\"'](?P<html>[^\"']+)[\"']",
    re.IGNORECASE,
)


# ============= Media Browser =============
media_router = APIRouter(prefix="/api/media", tags=["media"])
admin_media_router = APIRouter(prefix="/api/admin/media", tags=["cms-admin"])


class RotateMediaBody(BaseModel):
    degrees: int = 90


def _filename_from_media_value(value: Any) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        raw = urlparse(raw).path or raw
    if not (
        raw.startswith("/api/static/uploads/")
        or raw.startswith("/static/uploads/")
        or raw.startswith("/uploads/")
        or raw.startswith("api/static/uploads/")
        or raw.startswith("static/uploads/")
        or raw.startswith("uploads/")
    ):
        return None
    name = Path(raw).name
    if not name or name.startswith(".") or Path(name).suffix.lower() not in PUBLIC_IMAGE_EXTS:
        return None
    return name


def _iter_text_media_values(value: Any) -> list[str]:
    if not isinstance(value, str) or not value:
        return []
    out: list[str] = []
    for match in TEXT_IMAGE_RE.finditer(value):
        url = match.group("md") or match.group("html")
        if url:
            out.append(url)
    return out


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


async def _collect_media_usage(filenames: set[str]) -> dict[str, list[dict[str, Any]]]:
    if not filenames:
        return {}
    db = get_db()
    usage: dict[str, list[dict[str, Any]]] = {name: [] for name in filenames}

    def add_ref(filename: str | None, ref: dict[str, Any]) -> None:
        if filename in usage and len(usage[filename]) < 20:
            usage[filename].append(ref)

    for collection, base_filter, fields in IMAGE_REFERENCE_FIELDS:
        col = getattr(db, collection)
        projection = {"_id": 0, "id": 1, "slug": 1, "name": 1, "title": 1, **{field: 1 for field in fields}}
        async for doc in col.find(base_filter, projection):
            doc_id = doc.get("id") or doc.get("slug")
            for field in fields:
                filename = _filename_from_media_value(doc.get(field))
                add_ref(filename, {
                    "collection": collection,
                    "id": doc_id,
                    "field": field,
                    "label": doc.get("title") or doc.get("name") or doc_id,
                })

    for collection, fields in TEXT_IMAGE_REFERENCE_FIELDS:
        col = getattr(db, collection)
        projection = {"_id": 0, "id": 1, "slug": 1, "name": 1, "title": 1, **{field: 1 for field in fields}}
        async for doc in col.find({}, projection):
            doc_id = doc.get("id") or doc.get("slug")
            for field in fields:
                for value in _iter_text_media_values(doc.get(field)):
                    filename = _filename_from_media_value(value)
                    add_ref(filename, {
                        "collection": collection,
                        "id": doc_id,
                        "field": field,
                        "label": doc.get("title") or doc.get("name") or doc_id,
                        "text_reference": True,
                    })

    return usage


async def _list_media_items(
    owner_id: str | None = None,
    include_untracked: bool = True,
    exclude_user_scope: bool = False,
    user_scope_only: bool = False,
    include_usage: bool = False,
) -> list[dict]:
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
    duplicate_lookup: dict[str, list[str]] = {}
    if include_usage:
        by_size: dict[int, list[Path]] = {}
        for path in candidates:
            try:
                by_size.setdefault(path.stat().st_size, []).append(path)
            except OSError:
                continue
        for same_size_paths in by_size.values():
            if len(same_size_paths) < 2:
                continue
            by_digest: dict[str, list[Path]] = {}
            for path in same_size_paths:
                try:
                    by_digest.setdefault(_file_digest(path), []).append(path)
                except OSError:
                    continue
            for same_content_paths in by_digest.values():
                if len(same_content_paths) < 2:
                    continue
                names = sorted({path.name for path in same_content_paths})
                for name in names:
                    duplicate_lookup[name] = names
    filenames = [p.name for p in candidates]
    usage = await _collect_media_usage(set(filenames)) if include_usage else {}
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
        media_scope = (meta.get("media_scope") or "legacy") if meta else "legacy"
        is_user_media = media_scope == "user" or (
            media_scope == "legacy" and meta and meta.get("owner_role") not in ADMIN_MEDIA_OWNER_ROLES
        )
        if user_scope_only and not is_user_media:
            continue
        if exclude_user_scope and is_user_media:
            continue
        stat = p.stat()
        refs = usage.get(p.name) or []
        items.append({
            "filename": p.name,
            "url": f"/api/static/uploads/{p.name}",
            "size": stat.st_size,
            "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            "ext": p.suffix.lower().lstrip("."),
            "owner_id": meta.get("owner_id") if meta else None,
            "owner_role": meta.get("owner_role") if meta else None,
            "media_scope": media_scope,
            "original_filename": meta.get("original_filename") if meta else None,
            "created_at": meta.get("created_at") if meta else None,
            "tracked": bool(meta),
            "usage_count": len(refs) if include_usage else None,
            "references": refs[:6],
            "is_unused": (len(refs) == 0) if include_usage else None,
            "duplicate_count": len(duplicate_lookup.get(p.name) or []),
            "duplicate_filenames": (duplicate_lookup.get(p.name) or [])[:8],
        })
    return items[:500]


@media_router.get("")
async def list_media(me: dict = Depends(get_current_user)):
    """List uploaded images visible in the current user's media picker."""
    return await _list_media_items(owner_id=me["id"], include_untracked=False, user_scope_only=True)


@admin_media_router.get("")
async def admin_list_media(include_user_uploads: bool = False, include_usage: bool = False, me: dict = Depends(require_admin())):
    """List CMS/admin files in the upload directory with metadata."""
    return await _list_media_items(exclude_user_scope=not include_user_uploads, include_usage=include_usage)


@admin_media_router.get("/audit")
async def admin_media_audit(me: dict = Depends(require_admin())):
    """Return media-library health information for the admin media dashboard."""
    items = await _list_media_items(exclude_user_scope=False, include_usage=True)
    db = get_db()
    by_scope: dict[str, int] = {}
    total_size = 0
    for item in items:
        by_scope[item.get("media_scope") or "legacy"] = by_scope.get(item.get("media_scope") or "legacy", 0) + 1
        total_size += int(item.get("size") or 0)
    duplicate_groups: dict[str, list[str]] = {}
    for item in items:
        names = item.get("duplicate_filenames") or []
        if len(names) > 1:
            duplicate_groups["|".join(names)] = names

    missing_meta_count = 0
    missing_meta: list[dict[str, Any]] = []
    async for row in db.media_uploads.find({}, {"_id": 0, "filename": 1, "url": 1, "media_scope": 1, "owner_id": 1, "created_at": 1}).sort("created_at", -1).limit(5000):
        filename = row.get("filename") or _filename_from_media_value(row.get("url"))
        if not filename:
            continue
        if not (PUBLIC_UPLOAD_DIR / filename).is_file() and not (UPLOAD_DIR / filename).is_file():
            missing_meta_count += 1
            if len(missing_meta) < 20:
                missing_meta.append(row)

    from services.media_audit import audit_image_references
    reference_audit = await audit_image_references(repair=False)
    return {
        "ok": True,
        "total": len(items),
        "total_size": total_size,
        "by_scope": by_scope,
        "unused": sum(1 for item in items if item.get("is_unused")),
        "untracked": sum(1 for item in items if not item.get("tracked")),
        "duplicate_files": sum(len(names) for names in duplicate_groups.values()),
        "duplicate_groups": len(duplicate_groups),
        "duplicate_examples": list(duplicate_groups.values())[:10],
        "metadata_missing_files": missing_meta_count,
        "metadata_missing_examples": missing_meta,
        "reference_summary": reference_audit.get("summary") or {},
        "reference_examples": reference_audit.get("examples") or {},
        "recent_uploads": sorted(items, key=lambda item: item.get("created_at") or item.get("mtime") or "", reverse=True)[:10],
    }


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


def _media_file_path(filename: str) -> Path:
    safe_name = Path(filename).name
    if safe_name != filename or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,180}", safe_name):
        raise HTTPException(400, "Ungültiger Dateiname.")
    if Path(safe_name).suffix.lower() not in PUBLIC_IMAGE_EXTS:
        raise HTTPException(404, "Datei nicht gefunden.")
    for base_dir in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR):
        base = base_dir.resolve(strict=False)
        candidate = (base / safe_name).resolve(strict=False)
        try:
            candidate.relative_to(base)
        except ValueError:
            continue
        if candidate.exists() and candidate.is_file():
            return candidate
    raise HTTPException(404, "Datei nicht gefunden.")


@admin_media_router.post("/{filename}/rotate")
async def admin_rotate_media(filename: str, body: RotateMediaBody, me: dict = Depends(require_admin())):
    """Rotate an uploaded public image in place."""
    p = _media_file_path(filename)
    ext = p.suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(400, "Dieses Bildformat kann hier nicht gedreht werden.")
    degrees = int(round((body.degrees or 0) / 90) * 90)
    if degrees % 360 == 0:
        stat = p.stat()
        return {"ok": True, "filename": filename, "url": f"/api/static/uploads/{filename}", "size": stat.st_size}
    try:
        with Image.open(p) as source:
            img = ImageOps.exif_transpose(source)
            rotated = img.rotate(-degrees, expand=True)
        save_kwargs: dict[str, Any] = {}
        if ext in {".jpg", ".jpeg"}:
            rotated = rotated.convert("RGB")
            image_format = "JPEG"
            save_kwargs = {"quality": 88, "optimize": True}
        elif ext == ".png":
            rotated = rotated.convert("RGBA" if rotated.mode in ("RGBA", "LA", "P") else "RGB")
            image_format = "PNG"
            save_kwargs = {"optimize": True}
        else:
            if rotated.mode not in ("RGB", "RGBA"):
                rotated = rotated.convert("RGBA" if "A" in rotated.getbands() else "RGB")
            image_format = "WEBP"
            save_kwargs = {"quality": 88, "method": 6}
        rotated.save(p, format=image_format, **save_kwargs)
    except UnidentifiedImageError:
        raise HTTPException(400, "Ungültige Bilddatei.")
    except OSError as exc:
        raise HTTPException(500, "Drehen fehlgeschlagen.")

    stat = p.stat()
    updated_at = now_utc().isoformat()
    await get_db().media_uploads.update_many(
        {"filename": filename},
        {"$set": {"size": stat.st_size, "updated_at": updated_at}},
    )
    return {
        "ok": True,
        "filename": filename,
        "url": f"/api/static/uploads/{filename}",
        "size": stat.st_size,
        "updated_at": updated_at,
    }


@admin_media_router.delete("/{filename}")
async def admin_delete_media(filename: str, me: dict = Depends(require_admin())):
    """Delete a file from upload dir. Path-traversal protected."""
    p = _media_file_path(filename)
    try:
        p.unlink()
    except OSError as e:
        raise HTTPException(500, "Löschen fehlgeschlagen.")
    cleared_refs = await _clear_media_references(f"/api/static/uploads/{filename}")
    meta = await get_db().media_uploads.delete_many({"filename": filename})
    return {"ok": True, "cleared_references": cleared_refs, "deleted_metadata": meta.deleted_count}


# ============= Navigation Editor =============
NAV_DOC_ID = "main_nav"

DEFAULT_NAV = {
    "id": NAV_DOC_ID,
    "items": [
        {"key": "home", "to": "/", "label": "Home", "visible": True, "order": 0},
        {"key": "news", "to": "/news", "label": "News", "visible": True, "order": 1},
        {"key": "events", "to": "/events", "label": "Events", "visible": True, "order": 2},
        {"key": "club", "to": "/about", "label": "Verein", "visible": True, "order": 3, "children": [
            {"key": "about", "to": "/about", "label": "Über uns", "visible": True},
            {"key": "board", "to": "/board", "label": "Vorstand", "visible": True},
            {"key": "values", "to": "/values", "label": "Werte & Ziele", "visible": True},
            {"key": "partners", "to": "/partners", "label": "Partner", "visible": True},
            {"key": "sponsors", "to": "/sponsors", "label": "Sponsoren", "visible": True},
            {"key": "members", "to": "/members", "label": "Vereinsmitglieder", "visible": True},
            {"key": "join", "to": "/membership/join", "label": "Mitglied werden", "visible": True},
            {"key": "gallery", "to": "/galerie", "label": "Galerie", "visible": True},
            {"key": "references", "to": "/references", "label": "Referenzen", "visible": True},
        ]},
        {"key": "esports", "to": "/esports", "label": "eSports", "visible": True, "order": 4, "children": [
            {"key": "esports_overview", "to": "/esports", "label": "Übersicht", "visible": True},
            {"key": "tournaments", "to": "/tournaments", "label": "Turniere", "visible": True},
            {"key": "fastlap", "to": "/fastlap", "label": "Fast Lap", "visible": True},
            {"key": "season", "to": "/seasons/current", "label": "Jahreswertung", "visible": True},
        ]},
        {"key": "community", "label": "Community", "visible": True, "order": 5, "children": [
            {"key": "community_overview", "to": "/community", "label": "Übersicht", "visible": True},
            {"key": "servers", "to": "/servers", "label": "Server", "visible": True},
            {"key": "players", "to": "/players", "label": "Community-Spieler", "visible": True},
            {"key": "community_teams", "to": "/teams", "label": "Teams", "visible": True},
        ]},
        {"key": "contact", "to": "/contact", "label": "Kontakt", "visible": True, "order": 6},
    ],
}

RETIRED_NAV_CHILD_KEYS = {
    "esports": {"teams", "references"},
    "community": {"members", "join"},
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
    parent_key = default.get("key") or default.get("to") or default.get("label")
    default_children = default.get("children") or []
    current_children = current.get("children") or []
    if default_children:
        current_by_key = {c.get("key") or c.get("to") or c.get("label"): c for c in current_children}
        merged_children = []
        for child_default in default_children:
            key = child_default.get("key") or child_default.get("to") or child_default.get("label")
            merged_children.append(_merge_nav_item(current_by_key.pop(key, {}), child_default))
        retired = RETIRED_NAV_CHILD_KEYS.get(parent_key, set())
        merged_children.extend(
            child for key, child in current_by_key.items()
            if key not in retired
        )
        merged["children"] = merged_children
    else:
        merged.pop("children", None)
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
@seo_router.get("/robots.txt")
async def robots():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    base = (branding.get("domain") or "").rstrip("/") or os.environ.get("PUBLIC_URL", "").rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    private_rules = [
        "Allow: /",
        "Allow: /api/static/uploads/",
        "Allow: /api/manifest.webmanifest",
        "Allow: /api/seo/preview",
        "Allow: /api/seo/meta",
        "Disallow: /admin/",
        "Disallow: /dashboard",
        "Disallow: /display/",
        "Disallow: /members/area",
        "Disallow: /members/benefits",
        "Disallow: /members/documents",
        "Disallow: /members/membership",
        "Disallow: /members/news",
        "Disallow: /my/",
        "Disallow: /privacy-account",
        "Disallow: /profile",
        "Disallow: /setup",
        "Disallow: /api/",
        "Disallow: /login",
        "Disallow: /register",
        "Disallow: /forgot-password",
        "Disallow: /reset-password",
        "Disallow: /membership/apply",
        "Disallow: /matches/",
        "Disallow: /players",
    ]
    search_agents = [
        "Googlebot",
        "Google-InspectionTool",
        "GoogleOther",
        "Bingbot",
        "DuckDuckBot",
        "Applebot",
        "OAI-SearchBot",
        "ChatGPT-User",
        "Claude-SearchBot",
        "Claude-User",
        "PerplexityBot",
        "Perplexity-User",
    ]
    training_agents = [
        "GPTBot",
        "Google-Extended",
        "ClaudeBot",
        "anthropic-ai",
        "CCBot",
    ]
    body = [
        "User-agent: *",
        *private_rules,
        "",
    ]
    for agent in search_agents:
        body.extend([f"User-agent: {agent}", *private_rules, ""])
    for agent in training_agents:
        body.extend([f"User-agent: {agent}", "Disallow: /", ""])
    body.extend([
        f"Sitemap: {base}/sitemap.xml" if base else "Sitemap: /sitemap.xml",
        f"Sitemap: {base}/sitemap-news.xml" if base else "Sitemap: /sitemap-news.xml",
    ])
    return Response(content="\n".join(body).strip() + "\n", media_type="text/plain")


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
    org_name = branding.get("club_name") or "THE LION SQUAD - eSPORTS"
    base = (branding.get("domain") or os.environ.get("PUBLIC_URL", "")).strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    canonical = f"{base}/{slug}".rstrip("/") if base else f"/{slug}"
    image = (
        branding.get("share_banner_url")
        or branding.get("logo_url")
        or branding.get("logo_light_url")
        or branding.get("logo_dark_url")
        or branding.get("mascot_url")
        or "/assets/brand/og-default.png"
    )
    if image and not image.startswith(("http://", "https://")) and base:
        image = f"{base}{image if image.startswith('/') else '/' + image}"
    json_ld = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": page["title"],
        "description": page.get("meta_description") or page.get("title"),
        "url": canonical,
        "image": image,
        "isPartOf": {
            "@type": "WebSite",
            "name": org_name,
            "url": base,
        },
    }
    return {
        "title": f"{page['title']} · {org_name}",
        "description": page.get("meta_description") or page["title"],
        "canonical": canonical,
        "image": image,
        "site_name": org_name,
        "type": "website",
        "json_ld": json_ld,
    }
