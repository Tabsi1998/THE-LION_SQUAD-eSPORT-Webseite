"""Document/Download routes for member portal — Phase 4."""
import os
import pathlib
from urllib.parse import quote
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse
from typing import Optional
from database import get_db
from auth import require_admin, get_optional_user
from services.visibility import user_can_see
from models import DocumentCreate, DocumentUpdate, now_utc, new_id

router = APIRouter(prefix="/api/documents", tags=["documents"])
UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PRIVATE_DOC_DIR = UPLOAD_DIR / "documents"
PRIVATE_DOC_DIR.mkdir(parents=True, exist_ok=True)


async def _user_can_see(user: dict | None, visibility: str) -> bool:
    return await user_can_see(user, visibility)


def _safe_storage_path(doc: dict) -> pathlib.Path | None:
    key = doc.get("storage_key")
    if key and "/" not in key and "\\" not in key and ".." not in key and not key.startswith("."):
        return PRIVATE_DOC_DIR / key
    file_url = doc.get("file_url") or ""
    if file_url.startswith("/api/static/uploads/"):
        legacy = pathlib.Path(file_url.rsplit("/", 1)[-1])
        if "/" not in legacy.name and "\\" not in legacy.name and ".." not in legacy.name:
            return UPLOAD_DIR / legacy.name
    return None


def _document_url(doc_id: str) -> str:
    return f"/api/documents/{doc_id}/download"


@router.get("/meta")
async def documents_meta():
    return {
        "categories": [
            {"k": "statutes", "l": "Statuten"},
            {"k": "minutes", "l": "Protokolle"},
            {"k": "form", "l": "Formular"},
            {"k": "regulations", "l": "Regelwerk"},
            {"k": "guideline", "l": "Leitlinie"},
            {"k": "download", "l": "Download"},
            {"k": "media_kit", "l": "Media Kit"},
            {"k": "presentation", "l": "Präsentation"},
            {"k": "template", "l": "Vorlage"},
            {"k": "other", "l": "Sonstiges"},
        ],
        "visibilities": [
            {"k": "public", "l": "Öffentlich"},
            {"k": "community", "l": "Nur registrierte Community"},
            {"k": "members", "l": "Nur Vereinsmitglieder"},
            {"k": "internal", "l": "Nur intern (Admins)"},
        ],
    }


@router.get("")
async def list_documents(
    category: Optional[str] = None,
    user: dict | None = Depends(get_optional_user),
):
    db = get_db()
    q: dict = {}
    if category:
        q["category"] = category
    docs = await db.documents.find(q, {"_id": 0}).sort([("pinned", -1), ("order_index", 1), ("created_at", -1)]).to_list(500)
    out = []
    for d in docs:
        if await _user_can_see(user, d.get("visibility") or "members"):
            out.append(d)
    return out


@router.get("/admin")
async def admin_list_documents(me: dict = Depends(require_admin())):
    db = get_db()
    docs = await db.documents.find({}, {"_id": 0}).sort([("pinned", -1), ("order_index", 1)]).to_list(1000)
    return docs


@router.post("")
async def create_document(body: DocumentCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    doc["uploader_name"] = me.get("display_name") or me.get("username")
    doc["download_count"] = 0
    if doc.get("storage_key"):
        doc["file_url"] = _document_url(doc["id"])
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{doc_id}")
@router.patch("/{doc_id}")
async def update_document(doc_id: str, body: DocumentUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {
        "description", "storage_key", "original_filename", "file_size", "mime", "tags",
    }
    raw = body.model_dump(exclude_unset=True)
    update = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
    if update.get("storage_key"):
        update["file_url"] = _document_url(doc_id)
    update["updated_at"] = now_utc().isoformat()
    res = await db.documents.update_one({"id": doc_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Dokument nicht gefunden.")
    return await db.documents.find_one({"id": doc_id}, {"_id": 0})


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.documents.delete_one({"id": doc_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Dokument nicht gefunden.")
    return {"ok": True}


@router.get("/{doc_id}/download")
async def download_document(doc_id: str, user: dict | None = Depends(get_optional_user)):
    """Stream a document only after visibility checks."""
    db = get_db()
    d = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Dokument nicht gefunden.")
    if not await _user_can_see(user, d.get("visibility") or "members"):
        raise HTTPException(403, "Kein Zugriff.")
    path = _safe_storage_path(d)
    if not path or not path.exists() or not path.is_file():
        raise HTTPException(404, "Datei nicht gefunden.")
    await db.documents.update_one({"id": doc_id}, {"$inc": {"download_count": 1}})
    original = (d.get("original_filename") or path.name).replace("\\", "/").rsplit("/", 1)[-1]
    original = original.replace("\r", "").replace("\n", "") or path.name
    return FileResponse(
        path,
        media_type=d.get("mime") or "application/octet-stream",
        filename=original,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(original, safe='')}"},
    )


@router.post("/{doc_id}/track-download")
async def track_download(doc_id: str, user: dict | None = Depends(get_optional_user)):
    """Increment download counter (visibility-aware)."""
    db = get_db()
    d = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Dokument nicht gefunden.")
    if not await _user_can_see(user, d.get("visibility") or "members"):
        raise HTTPException(403, "Kein Zugriff.")
    await db.documents.update_one({"id": doc_id}, {"$inc": {"download_count": 1}})
    return {"ok": True, "url": _document_url(doc_id)}
