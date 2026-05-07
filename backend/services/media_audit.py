"""Audit and normalize stored image references."""
from __future__ import annotations

import os
import pathlib
from urllib.parse import urlparse

from database import get_db
from models import now_utc


UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
LOCAL_PREFIX = "/api/static/uploads/"
PUBLIC_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

TARGETS: list[tuple[str, list[str]]] = [
    ("settings", ["logo_url", "mascot_url", "favicon_url", "avatar_url"]),
    ("users", ["avatar_url", "banner_url"]),
    ("teams", ["logo_url", "banner_url"]),
    ("sponsors", ["logo_url"]),
    ("news_posts", ["banner_url", "cover_url"]),
    ("events", ["banner_url", "cover_url"]),
    ("games", ["cover_url", "logo_url"]),
    ("tournaments", ["banner_url", "cover_url"]),
    ("f1_challenges", ["banner_url", "cover_url"]),
    ("f1_tracks", ["image_url"]),
    ("gallery_albums", ["cover_url"]),
    ("gallery_photos", ["image_url", "thumbnail_url"]),
    ("member_benefits", ["image_url"]),
]


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


async def audit_image_references(repair: bool = False) -> dict:
    db = get_db()
    summary = {
        "scanned": 0,
        "local_ok": 0,
        "legacy_local": 0,
        "normalized": 0,
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
                summary["normalized"] += len(updates) - 1

    return {"ok": True, "repair": repair, "summary": summary, "examples": examples}
