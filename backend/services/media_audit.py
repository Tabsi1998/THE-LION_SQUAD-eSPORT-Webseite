"""Audit and normalize stored image references."""
from __future__ import annotations

import os
import pathlib
import re
from urllib.parse import urlparse

from database import get_db
from models import now_utc


UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
LOCAL_PREFIX = "/api/static/uploads/"
PUBLIC_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
ADMIN_OWNER_ROLES = {"admin", "moderator", "tournament_admin", "club_admin", "superadmin"}
MEDIA_SCOPES = {"user", "admin", "sponsor", "branding", "gallery"}

TARGETS: list[tuple[str, list[str]]] = [
    ("settings", ["logo_url", "mascot_url", "favicon_url", "avatar_url"]),
    ("users", ["avatar_url", "banner_url"]),
    ("teams", ["logo_url", "banner_url"]),
    ("sponsors", ["logo_url"]),
    ("partners", ["logo_url"]),
    ("news_posts", ["banner_url", "cover_url"]),
    ("events", ["banner_url", "cover_url"]),
    ("games", ["cover_url", "logo_url"]),
    ("tournaments", ["banner_url", "cover_url"]),
    ("f1_challenges", ["banner_url", "cover_url"]),
    ("f1_tracks", ["image_url"]),
    ("seasons", ["banner_url"]),
    ("gallery_albums", ["cover_url"]),
    ("gallery_photos", ["image_url", "thumbnail_url"]),
    ("member_benefits", ["image_url"]),
    ("club_member_profiles", ["photo_url", "cover_url"]),
]

TEXT_TARGETS: list[tuple[str, list[str]]] = [
    ("cms_pages", ["body_md"]),
    ("news_posts", ["content"]),
    ("events", ["description", "program"]),
    ("tournaments", ["description"]),
    ("f1_challenges", ["description"]),
    ("club_member_profiles", ["bio"]),
]

SCOPE_TARGETS: list[tuple[str, list[str], str]] = [
    ("users", ["avatar_url", "banner_url"], "user"),
    ("settings", ["logo_url", "mascot_url", "favicon_url", "avatar_url"], "branding"),
    ("sponsors", ["logo_url"], "sponsor"),
    ("gallery_albums", ["cover_url"], "gallery"),
    ("gallery_photos", ["image_url", "thumbnail_url"], "gallery"),
    ("teams", ["logo_url", "banner_url"], "admin"),
    ("partners", ["logo_url"], "admin"),
    ("news_posts", ["banner_url", "cover_url"], "admin"),
    ("events", ["banner_url", "cover_url"], "admin"),
    ("games", ["cover_url", "logo_url"], "admin"),
    ("tournaments", ["banner_url", "cover_url"], "admin"),
    ("f1_challenges", ["banner_url", "cover_url"], "admin"),
    ("f1_tracks", ["image_url"], "admin"),
    ("seasons", ["banner_url"], "admin"),
    ("member_benefits", ["image_url"], "admin"),
    ("club_member_profiles", ["photo_url", "cover_url"], "admin"),
]

TEXT_IMAGE_RE = re.compile(
    r"!\[[^\]\n]*\]\((?P<md>[^)\s]+)\)|<img\b[^>]*\bsrc=[\"'](?P<html>[^\"']+)[\"']",
    re.IGNORECASE,
)


def _upload_path(value: str) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.startswith("http://") or raw.startswith("https://"):
        raw = urlparse(raw).path or raw
    normalized = raw.lstrip("/")
    if normalized.startswith("api/static/uploads/"):
        return "/" + normalized
    if normalized.startswith("static/uploads/"):
        return "/api/" + normalized
    if normalized.startswith("uploads/"):
        return "/api/static/" + normalized
    return None


def _filename_from_upload_path(path: str) -> str | None:
    filename = pathlib.PurePosixPath(path).name
    if not filename or filename.startswith(".") or "/" in filename or "\\" in filename:
        return None
    if pathlib.Path(filename).suffix.lower() not in PUBLIC_IMAGE_EXTS:
        return None
    return filename


def _file_exists(filename: str) -> bool:
    return any((base / filename).is_file() for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR))


def _iter_text_image_urls(value: str) -> list[str]:
    urls: list[str] = []
    for match in TEXT_IMAGE_RE.finditer(str(value or "")):
        url = match.group("md") or match.group("html")
        if url and url not in urls:
            urls.append(url)
    return urls


async def audit_image_references(repair: bool = False, clear_missing: bool = False) -> dict:
    db = get_db()
    summary = {
        "scanned": 0,
        "text_scanned": 0,
        "local_ok": 0,
        "legacy_local": 0,
        "normalized": 0,
        "text_normalized": 0,
        "cleared_missing": 0,
        "external": 0,
        "missing_file": 0,
        "invalid_local": 0,
        "other": 0,
    }
    examples: dict[str, list[dict]] = {
        "legacy_local": [],
        "external": [],
        "missing_file": [],
        "invalid_local": [],
        "other": [],
    }

    def add_example(kind: str, item: dict) -> None:
        if len(examples[kind]) < 20:
            examples[kind].append(item)

    for coll_name, fields in TARGETS:
        collection = db[coll_name]
        async for doc in collection.find({}):
            updates: dict[str, str] = {}
            for field in fields:
                value = doc.get(field)
                if not value:
                    continue
                summary["scanned"] += 1
                value = str(value).strip()
                item = {
                    "collection": coll_name,
                    "id": doc.get("id") or str(doc.get("_id")),
                    "field": field,
                    "value": value,
                }
                upload_path = _upload_path(value)
                if value.startswith("http://") or value.startswith("https://"):
                    if upload_path:
                        filename = _filename_from_upload_path(upload_path)
                        if filename and _file_exists(filename):
                            summary["legacy_local"] += 1
                            add_example("legacy_local", {**item, "normalized": upload_path})
                            if repair:
                                updates[field] = upload_path
                            continue
                    summary["external"] += 1
                    add_example("external", item)
                    continue
                if upload_path:
                    filename = _filename_from_upload_path(upload_path)
                    if not filename:
                        summary["invalid_local"] += 1
                        add_example("invalid_local", item)
                        continue
                    if not _file_exists(filename):
                        summary["missing_file"] += 1
                        add_example("missing_file", {**item, "normalized": upload_path})
                        if clear_missing:
                            updates[field] = None
                        continue
                    if value != upload_path:
                        summary["legacy_local"] += 1
                        add_example("legacy_local", {**item, "normalized": upload_path})
                        if repair:
                            updates[field] = upload_path
                    else:
                        summary["local_ok"] += 1
                    continue
                summary["other"] += 1
                add_example("other", item)
            if updates:
                updates["updated_at"] = now_utc().isoformat()
                query = {"id": doc["id"]} if doc.get("id") else {"_id": doc["_id"]}
                await collection.update_one(query, {"$set": updates})
                changed_fields = [k for k in updates.keys() if k != "updated_at"]
                summary["cleared_missing"] += sum(1 for k in changed_fields if updates.get(k) is None)
                summary["normalized"] += sum(1 for k in changed_fields if updates.get(k) is not None)

    for coll_name, fields in TEXT_TARGETS:
        collection = db[coll_name]
        async for doc in collection.find({}):
            updates: dict[str, str] = {}
            for field in fields:
                text = doc.get(field)
                if not isinstance(text, str) or not text:
                    continue
                next_text = text
                for value in _iter_text_image_urls(text):
                    summary["text_scanned"] += 1
                    item = {
                        "collection": coll_name,
                        "id": doc.get("id") or doc.get("slug") or str(doc.get("_id")),
                        "field": field,
                        "value": value,
                    }
                    upload_path = _upload_path(value)
                    if value.startswith("http://") or value.startswith("https://"):
                        if upload_path:
                            filename = _filename_from_upload_path(upload_path)
                            if filename and _file_exists(filename):
                                summary["legacy_local"] += 1
                                add_example("legacy_local", {**item, "normalized": upload_path})
                                if repair:
                                    next_text = next_text.replace(value, upload_path)
                                continue
                        summary["external"] += 1
                        add_example("external", item)
                        continue
                    if upload_path:
                        filename = _filename_from_upload_path(upload_path)
                        if not filename:
                            summary["invalid_local"] += 1
                            add_example("invalid_local", item)
                            continue
                        if not _file_exists(filename):
                            summary["missing_file"] += 1
                            add_example("missing_file", {**item, "normalized": upload_path})
                            continue
                        if value != upload_path:
                            summary["legacy_local"] += 1
                            add_example("legacy_local", {**item, "normalized": upload_path})
                            if repair:
                                next_text = next_text.replace(value, upload_path)
                        else:
                            summary["local_ok"] += 1
                        continue
                    summary["other"] += 1
                    add_example("other", item)
                if next_text != text:
                    updates[field] = next_text
            if updates:
                updates["updated_at"] = now_utc().isoformat()
                query = {"id": doc["id"]} if doc.get("id") else ({"slug": doc["slug"]} if doc.get("slug") else {"_id": doc["_id"]})
                await collection.update_one(query, {"$set": updates})
                summary["text_normalized"] += len(updates) - 1

    return {"ok": True, "repair": repair, "clear_missing": clear_missing, "summary": summary, "examples": examples}


async def _infer_scope_from_references(filename: str) -> tuple[str | None, dict | None]:
    db = get_db()
    suffix_re = f"{re.escape(filename)}$"
    for coll_name, fields, scope in SCOPE_TARGETS:
        collection = db[coll_name]
        for field in fields:
            doc = await collection.find_one({field: {"$regex": suffix_re}}, {"_id": 0, "id": 1, field: 1})
            if doc:
                return scope, {
                    "collection": coll_name,
                    "id": doc.get("id"),
                    "field": field,
                    "scope": scope,
                }
    for coll_name, fields in TEXT_TARGETS:
        collection = db[coll_name]
        for field in fields:
            doc = await collection.find_one({field: {"$regex": re.escape(filename)}}, {"_id": 0, "id": 1, "slug": 1})
            if doc:
                return "admin", {
                    "collection": coll_name,
                    "id": doc.get("id") or doc.get("slug"),
                    "field": field,
                    "scope": "admin",
                }
    return None, None


async def audit_media_scopes(repair: bool = False) -> dict:
    """Classify legacy media metadata into user/admin/CMS scopes.

    This only changes metadata in media_uploads. Files and image references are
    left untouched.
    """
    db = get_db()
    summary = {
        "scanned": 0,
        "already_scoped": 0,
        "updated": 0,
        "unresolved": 0,
        "user": 0,
        "admin": 0,
        "sponsor": 0,
        "branding": 0,
        "gallery": 0,
    }
    examples: dict[str, list[dict]] = {
        "updated": [],
        "unresolved": [],
        "already_scoped": [],
    }

    def add_example(kind: str, item: dict) -> None:
        if len(examples[kind]) < 20:
            examples[kind].append(item)

    async for media in db.media_uploads.find({}, {"_id": 0}):
        summary["scanned"] += 1
        filename = media.get("filename")
        current_scope = str(media.get("media_scope") or "").strip().lower()
        if current_scope in MEDIA_SCOPES:
            summary["already_scoped"] += 1
            summary[current_scope] += 1
            add_example("already_scoped", {"filename": filename, "scope": current_scope})
            continue
        if not filename:
            summary["unresolved"] += 1
            add_example("unresolved", {"id": media.get("id"), "reason": "filename fehlt"})
            continue
        inferred_scope, source = await _infer_scope_from_references(filename)
        if not inferred_scope:
            inferred_scope = "admin" if media.get("owner_role") in ADMIN_OWNER_ROLES else "user"
            source = {"reason": "Fallback über Besitzerrolle", "scope": inferred_scope}
        summary[inferred_scope] += 1
        item = {"filename": filename, "scope": inferred_scope, "source": source}
        if repair:
            await db.media_uploads.update_one(
                {"filename": filename},
                {"$set": {"media_scope": inferred_scope, "updated_at": now_utc().isoformat()}},
            )
            summary["updated"] += 1
            add_example("updated", item)
        else:
            add_example("unresolved", item)

    return {"ok": True, "repair": repair, "summary": summary, "examples": examples}
