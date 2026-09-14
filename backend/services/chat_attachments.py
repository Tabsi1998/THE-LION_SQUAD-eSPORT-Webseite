"""Bilder und Videos in Chats, die nur Chat-Teilnehmer sehen.

Uploads für Galerie, Banner und News liegen öffentlich unter
/api/static/uploads - ohne Anmeldung abrufbar. Für private Chats passt das
nicht. Chat-Anhänge liegen deshalb in einem eigenen Verzeichnis und werden nur
über /api/chat-attachments ausgeliefert, nach derselben Rechteprüfung wie der
Chat, zu dem sie gehören.

Ablauf:
  1. hochladen      -> Status "pending", sichtbar nur für den Absender
  2. mit Nachricht  -> Status "attached", Kontext des Chats wird gespeichert
  3. nie gesendet   -> der Scheduler räumt nach PENDING_TTL auf
"""
from __future__ import annotations

import logging
import os
import pathlib
import uuid
from datetime import timedelta

from fastapi import HTTPException, UploadFile

from database import get_db
from models import new_id, now_utc
from storage import PRIVATE_CHAT_DIR, ensure_directory

logger = logging.getLogger("tls-arena.chat-attachments")


def _int_from_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


MAX_ATTACHMENTS_PER_MESSAGE = 4
MAX_CHAT_IMAGE_MB = _int_from_env("MAX_CHAT_IMAGE_UPLOAD_MB", 25)
MAX_CHAT_VIDEO_MB = _int_from_env("MAX_CHAT_VIDEO_UPLOAD_MB", 100)
MAX_CHAT_POSTER_MB = 5
CHAT_UPLOAD_RATE_LIMIT = _int_from_env("CHAT_UPLOAD_RATE_LIMIT", 60)
PENDING_TTL = timedelta(hours=24)
MESSAGE_COLLECTIONS = {
    "direct_messages": "sender_id",
    "team_chat_messages": "user_id",
    "tournament_chat_messages": "user_id",
    "match_chat_messages": "user_id",
}


def attachment_path(key: str | None) -> pathlib.Path | None:
    if not key or "/" in key or "\\" in key or ".." in key or key.startswith("."):
        return None
    return PRIVATE_CHAT_DIR / key


def public_attachment(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "kind": doc.get("kind"),
        "mime": doc.get("mime"),
        "size": doc.get("size"),
        "width": doc.get("width"),
        "height": doc.get("height"),
        "url": f"/api/chat-attachments/{doc['id']}",
        "poster_url": f"/api/chat-attachments/{doc['id']}/poster" if doc.get("poster_key") else None,
    }


def attachment_preview_text(attachments: list[dict] | None) -> str:
    """Kurztext für Benachrichtigungen, wenn eine Nachricht nur Anhänge hat."""
    items = attachments or []
    if not items:
        return ""
    if len(items) > 1:
        return f"[{len(items)} Anhänge]"
    return "[Video]" if items[0].get("kind") == "video" else "[Bild]"


def chat_message_preview(message: dict, limit: int) -> str:
    text = (message.get("message") or "")[:limit] or attachment_preview_text(message.get("attachments"))
    return text or ("[Sticker]" if message.get("sticker") else "")


def _write_private(filename: str, data: bytes) -> None:
    path = PRIVATE_CHAT_DIR / filename
    try:
        ensure_directory(PRIVATE_CHAT_DIR)
        path.write_bytes(data)
    except OSError as exc:
        logger.error("[chat-attachments] failed to write %s: %s", path, exc)
        raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar.")


async def _encode_uploaded_image(file: UploadFile, max_mb: int) -> dict:
    from routes.upload_routes import _encode_image_bytes, _read_upload_limited

    data = await _read_upload_limited(file, max_mb * 1024 * 1024, max_mb)
    suffix = pathlib.Path(file.filename or "").suffix.lower()
    return _encode_image_bytes(data, file.content_type or "", suffix, file.filename or "upload")


def _upload_kind(file: UploadFile) -> str:
    from routes.upload_routes import ALLOWED_IMAGE, ALLOWED_VIDEO, IMAGE_MIME_BY_EXT, VIDEO_MIME_ALIASES, VIDEO_MIME_BY_EXT

    declared = (file.content_type or "").split(";")[0].strip().lower()
    declared_video = VIDEO_MIME_ALIASES.get(declared, declared)
    suffix = pathlib.Path(file.filename or "").suffix.lower()
    if suffix in VIDEO_MIME_BY_EXT or declared_video in ALLOWED_VIDEO:
        return "video"
    if declared in ALLOWED_IMAGE or suffix in IMAGE_MIME_BY_EXT:
        return "image"
    raise HTTPException(status_code=400, detail="Im Chat sind Bilder (PNG, JPG, WebP) und Videos (MP4, WebM, MOV) erlaubt.")


async def store_chat_upload(file: UploadFile, owner: dict, poster: UploadFile | None = None) -> dict:
    """Speichert einen Anhang als "pending". Erst eine Nachricht ordnet ihn einem Chat zu."""
    from routes.upload_routes import VIDEO_SNIFF_BYTES, _detect_video_upload, _write_upload_stream_limited

    kind = _upload_kind(file)
    stem = uuid.uuid4().hex
    poster_key = None
    if kind == "image":
        encoded = await _encode_uploaded_image(file, MAX_CHAT_IMAGE_MB)
        storage_key = f"{stem}{encoded['ext']}"
        _write_private(storage_key, encoded["data"])
        mime, size = encoded["content_type"], len(encoded["data"])
        width, height = encoded["width"], encoded["height"]
    else:
        head = await file.read(VIDEO_SNIFF_BYTES)
        if not head:
            raise HTTPException(status_code=400, detail="Leere Videodatei")
        suffix = pathlib.Path(file.filename or "").suffix.lower()
        mime, ext = _detect_video_upload(head, file.content_type or "", suffix)
        storage_key = f"{stem}{ext}"
        size = await _write_upload_stream_limited(
            file, PRIVATE_CHAT_DIR / storage_key, head,
            MAX_CHAT_VIDEO_MB * 1024 * 1024, MAX_CHAT_VIDEO_MB,
        )
        width = height = None
        if poster is not None and (poster.filename or poster.content_type):
            # Das Standbild erzeugt der Browser oder die App; im Container gibt es kein ffmpeg.
            encoded_poster = await _encode_uploaded_image(poster, MAX_CHAT_POSTER_MB)
            poster_key = f"{stem}-poster{encoded_poster['ext']}"
            _write_private(poster_key, encoded_poster["data"])
            width, height = encoded_poster["width"], encoded_poster["height"]

    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "owner_id": owner["id"],
        "kind": kind,
        "mime": mime,
        "size": size,
        "width": width,
        "height": height,
        "storage_key": storage_key,
        "poster_key": poster_key,
        "original_filename": (file.filename or "")[:200],
        "status": "pending",
        "context": None,
        "created_at": now,
        "updated_at": now,
    }
    await get_db().chat_attachments.insert_one(dict(doc))
    return public_attachment(doc)


async def claim_attachments(db, owner_id: str, attachment_ids: list[str] | None, context: dict) -> list[dict]:
    """Ordnet eigene, noch nicht gesendete Anhänge einer Nachricht zu.

    Fremde oder bereits gesendete Anhänge werden abgelehnt: sonst könnte man
    ein Bild aus einem Chat, den man sehen darf, in einen anderen weiterreichen.
    """
    ids = list(dict.fromkeys(item for item in (attachment_ids or []) if isinstance(item, str) and item))
    if not ids:
        return []
    if len(ids) > MAX_ATTACHMENTS_PER_MESSAGE:
        raise HTTPException(status_code=400, detail=f"Höchstens {MAX_ATTACHMENTS_PER_MESSAGE} Anhänge pro Nachricht.")
    query = {"id": {"$in": ids}, "owner_id": owner_id, "status": "pending"}
    rows = await db.chat_attachments.find(query, {"_id": 0}).to_list(len(ids))
    if len(rows) != len(ids):
        raise HTTPException(status_code=400, detail="Anhang nicht gefunden oder bereits gesendet.")
    result = await db.chat_attachments.update_many(
        query,
        {"$set": {"status": "attached", "context": context, "updated_at": now_utc().isoformat()}},
    )
    if result.modified_count != len(ids):
        raise HTTPException(status_code=409, detail="Anhang wurde gleichzeitig verwendet.")
    by_id = {row["id"]: row for row in rows}
    return [public_attachment({**by_id[item], "status": "attached"}) for item in ids]


async def can_access(attachment: dict, user: dict | None) -> bool:
    """Wer den Chat lesen darf, darf auch seine Anhänge sehen - niemand sonst."""
    if attachment.get("status") != "attached":
        return bool(user and user.get("id") == attachment.get("owner_id"))

    context = attachment.get("context") or {}
    kind = context.get("type")
    db = get_db()
    if kind == "direct":
        return bool(user and user.get("id") in (context.get("user_ids") or []))
    if kind == "team":
        from routes.team_routes import _chat_allowed

        team = await db.teams.find_one({"id": context.get("team_id")}, {"_id": 0})
        return bool(team and _chat_allowed(team, user))
    if kind == "tournament":
        from routes.tournament_chat_routes import _can_use_tournament_chat

        tournament = await db.tournaments.find_one({"id": context.get("tournament_id")}, {"_id": 0})
        return bool(tournament and await _can_use_tournament_chat(tournament, user))
    if kind == "match":
        from routes.match_routes import _assert_match_visible, _find_match_any

        try:
            match, _collection = await _find_match_any(context.get("match_id"))
            await _assert_match_visible(match, user)
        except HTTPException:
            return False
        return True
    return False


def _remove_files(doc: dict) -> None:
    from services.image_variants import VARIANT_WIDTHS, variant_path

    for key in (doc.get("storage_key"), doc.get("poster_key")):
        path = attachment_path(key)
        if path is None:
            continue
        path.unlink(missing_ok=True)
        for width in VARIANT_WIDTHS:
            variant_path(path, width).unlink(missing_ok=True)


async def purge_stale_attachments(now=None) -> int:
    """Entfernt hochgeladene, aber nie gesendete Anhänge."""
    cutoff = ((now or now_utc()) - PENDING_TTL).isoformat()
    db = get_db()
    rows = await db.chat_attachments.find(
        {"status": "pending", "created_at": {"$lt": cutoff}}, {"_id": 0},
    ).to_list(500)
    for row in rows:
        _remove_files(row)
    if rows:
        await db.chat_attachments.delete_many({"id": {"$in": [row["id"] for row in rows]}})
    return len(rows)


async def delete_user_attachments(db, user_id: str) -> int:
    """Kontolöschung: Dateien und Einträge weg, Nachrichten verlieren ihre Anhänge."""
    rows = await db.chat_attachments.find({"owner_id": user_id}, {"_id": 0}).to_list(None)
    for row in rows:
        _remove_files(row)
    await db.chat_attachments.delete_many({"owner_id": user_id})
    for collection, author_field in MESSAGE_COLLECTIONS.items():
        await db[collection].update_many({author_field: user_id}, {"$set": {"attachments": []}})
    return len(rows)
