"""Phase A: Bulk-migrate external image URLs in DB to local uploads.

Scans all configured image reference fields and downloads any external
(http/https) image URL, stores it under the configured UPLOAD_DIR and rewrites
the field to the local /api/static/uploads/{filename} URL.

Idempotent: skips URLs that already point at /api/static/uploads/.
Safe: errors per row are logged and don't abort the whole run.
"""
import logging
import uuid
import pathlib
import asyncio
import mimetypes
from functools import partial
from typing import Optional

import httpx

from database import get_db
from services import media_audit, svg_logo
from services.image_upload import looks_like_svg
from storage import PUBLIC_UPLOAD_DIR, ensure_directory

logger = logging.getLogger("tls.image_migrate")

# Dieselben Stellen wie Kontolöschung und Mediathek (#1471), auch verschachtelte Felder (``media_audit.usage_places``).
# Videos lädt die Migration nicht: sie nimmt nur Bilder an und müsste ein Video erst ganz herunterladen.
SKIPPED_FIELDS = {("gallery_photos", "video_url")}

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
        if ct == "image/svg+xml" or ext == ".svg" or looks_like_svg("", "", resp.content):
            # SVG (#1952): nie roh ablegen - nur bereinigt, mit PNG-Fassung daneben; was nicht geht, bleibt extern.
            try:
                stored = await asyncio.to_thread(svg_logo.store, resp.content, trim=False, directory=PUBLIC_UPLOAD_DIR)
            except svg_logo.SvgRejected as rejected:
                logger.warning("[image-migrate] skip (svg %s): %s", rejected.code, url)
                return None
            return f"{LOCAL_PREFIX}{stored['filename']}"
        filename = f"{uuid.uuid4().hex}{ext}"
        ensure_directory(PUBLIC_UPLOAD_DIR)
        (PUBLIC_UPLOAD_DIR / filename).write_bytes(resp.content)
        return f"{LOCAL_PREFIX}{filename}"
    except Exception as exc:
        logger.warning(f"[image-migrate] failed {url}: {exc}")
        return None


def _external_urls(value, text: bool) -> list[str]:
    """Externe Bildadressen in einem Wert: das Feld selbst oder die Bilder in einem Text."""
    if not isinstance(value, str):
        return []
    if not text:
        return [value] if _is_external(value) else []
    urls = (match.group("md") or match.group("html") for match in media_audit.TEXT_IMAGE_RE.finditer(value))
    return [url for url in urls if _is_external(url)]


def _localized(value, text: bool, cache: dict[str, Optional[str]]):
    """Der Wert mit den heruntergeladenen Adressen statt der externen; was scheiterte, bleibt."""
    for url in _external_urls(value, text):
        value = value.replace(url, cache.get(url) or url) if text else (cache.get(url) or url)
    return value


async def migrate_all() -> dict:
    """Run the migration. Returns counts per collection."""
    db = get_db()
    summary: dict[str, dict[str, int]] = {}
    cache: dict[str, Optional[str]] = {}
    grouped: dict[str, list[tuple[str, bool]]] = {}
    for coll_name, fields, text in media_audit.usage_places():
        grouped.setdefault(coll_name, []).extend((f, text) for f in fields if (coll_name, f) not in SKIPPED_FIELDS)
    async with httpx.AsyncClient(headers={"User-Agent": "TLS-ImageMigrate/1.0"}) as client:
        for coll_name, fields in grouped.items():
            scanned = 0
            updated = 0
            failed = 0
            cursor = db[coll_name].find({})
            async for doc in cursor:
                scanned += 1
                changed = dict(doc)
                for f, text in fields:
                    for value in media_audit.values_at(doc, f):
                        for url in _external_urls(value, text):
                            if url not in cache:
                                cache[url] = await _download_to_local(url, client)
                            if not cache[url]:
                                failed += 1
                    top, *rest = f.split(".")
                    if top in changed:
                        localize = partial(_localized, text=text, cache=cache)
                        changed[top] = media_audit.replace_values(changed[top], rest, localize)
                updates = {key: value for key, value in changed.items() if value != doc.get(key)}
                if updates:
                    query = {"id": doc["id"]} if doc.get("id") else {"_id": doc["_id"]}
                    await db[coll_name].update_one(query, {"$set": updates})
                    updated += 1
            summary[coll_name] = {"scanned": scanned, "updated": updated, "failed": failed}
    logger.info(f"[image-migrate] done: {summary}")
    return summary


# CLI entrypoint
if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    logging.basicConfig(level=logging.INFO)
    print(asyncio.run(migrate_all()))
