"""Phase A: Bulk-migrate external image URLs in DB to local uploads.

Scans all configured image reference fields and downloads any external
(http/https) image URL, stores it under the configured UPLOAD_DIR and rewrites
the field to the local /api/static/uploads/{filename} URL.

Idempotent: skips URLs that already point at /api/static/uploads/.
Safe: errors per row are logged and don't abort the whole run.
"""
import logging
import os
import uuid
import pathlib
import asyncio
import mimetypes
import re
from typing import Optional

import httpx

from database import get_db

logger = logging.getLogger("tls.image_migrate")

UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PUBLIC_UPLOAD_DIR = UPLOAD_DIR / "public"
PUBLIC_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# (collection, list of fields, optional pointer to nested list of {url_field}, optional sub-doc field-name)
TARGETS: list[tuple[str, list[str]]] = [
    ("settings", ["logo_url", "logo_light_url", "logo_dark_url", "share_banner_url", "mascot_url", "qr_logo_url", "favicon_url", "favicon_light_url", "favicon_dark_url", "avatar_url"]),
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

TEXT_IMAGE_RE = re.compile(
    r"!\[[^\]\n]*\]\((?P<md>[^)\s]+)\)|<img\b[^>]*\bsrc=[\"'](?P<html>[^\"']+)[\"']",
    re.IGNORECASE,
)

LOCAL_PREFIX = "/api/static/uploads/"


def _is_external(url: Optional[str]) -> bool:
    if not url:
        return False
    if url.startswith("/"):
        return False
    if url.startswith(LOCAL_PREFIX):
        return False
    return url.startswith("http://") or url.startswith("https://")


async def _download_to_local(url: str, client: httpx.AsyncClient) -> Optional[str]:
    try:
        resp = await client.get(url, follow_redirects=True, timeout=15)
        if resp.status_code != 200:
            logger.warning(f"[image-migrate] {url} → HTTP {resp.status_code}")
            return None
        ct = resp.headers.get("content-type", "").split(";")[0].strip().lower()
        ext = mimetypes.guess_extension(ct) or pathlib.Path(url).suffix or ".bin"
        # Normalise weird extensions
        if ext == ".jpe":
            ext = ".jpg"
        # Reject non-images
        if not ct.startswith("image/"):
            logger.warning(f"[image-migrate] skip (not an image): {url} ct={ct}")
            return None
        # Size cap 8 MB
        if len(resp.content) > 8 * 1024 * 1024:
            logger.warning(f"[image-migrate] skip (too large): {url}")
            return None
        filename = f"{uuid.uuid4().hex}{ext}"
        (PUBLIC_UPLOAD_DIR / filename).write_bytes(resp.content)
        return f"{LOCAL_PREFIX}{filename}"
    except Exception as exc:
        logger.warning(f"[image-migrate] failed {url}: {exc}")
        return None


async def migrate_all() -> dict:
    """Run the migration. Returns counts per collection."""
    db = get_db()
    summary: dict[str, dict[str, int]] = {}
    cache: dict[str, Optional[str]] = {}
    async with httpx.AsyncClient(headers={"User-Agent": "TLS-ImageMigrate/1.0"}) as client:
        for coll_name, fields in TARGETS:
            scanned = 0
            updated = 0
            failed = 0
            cursor = db[coll_name].find({})
            async for doc in cursor:
                scanned += 1
                updates: dict[str, str] = {}
                for f in fields:
                    val = doc.get(f)
                    if not _is_external(val):
                        continue
                    if val not in cache:
                        cache[val] = await _download_to_local(val, client)
                    new_url = cache[val]
                    if new_url:
                        updates[f] = new_url
                    else:
                        failed += 1
                if updates:
                    await db[coll_name].update_one({"id": doc["id"]} if doc.get("id") else {"_id": doc["_id"]}, {"$set": updates})
                    updated += 1
            summary[coll_name] = {"scanned": scanned, "updated": updated, "failed": failed}
        for coll_name, fields in TEXT_TARGETS:
            scanned = 0
            updated = 0
            failed = 0
            cursor = db[coll_name].find({})
            async for doc in cursor:
                scanned += 1
                updates: dict[str, str] = {}
                for f in fields:
                    text = doc.get(f)
                    if not isinstance(text, str) or not text:
                        continue
                    next_text = text
                    for match in TEXT_IMAGE_RE.finditer(text):
                        val = match.group("md") or match.group("html")
                        if not _is_external(val):
                            continue
                        if val not in cache:
                            cache[val] = await _download_to_local(val, client)
                        new_url = cache[val]
                        if new_url:
                            next_text = next_text.replace(val, new_url)
                        else:
                            failed += 1
                    if next_text != text:
                        updates[f] = next_text
                if updates:
                    query = {"id": doc["id"]} if doc.get("id") else ({"slug": doc["slug"]} if doc.get("slug") else {"_id": doc["_id"]})
                    await db[coll_name].update_one(query, {"$set": updates})
                    updated += 1
            key = f"{coll_name}:text"
            summary[key] = {"scanned": scanned, "updated": updated, "failed": failed}
    logger.info(f"[image-migrate] done: {summary}")
    return summary


# CLI entrypoint
if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    import logging
    logging.basicConfig(level=logging.INFO)
    print(asyncio.run(migrate_all()))
