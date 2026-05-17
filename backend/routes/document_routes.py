"""Document routes for the member portal."""
import os
import pathlib
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from auth import get_optional_user, require_admin
from database import get_db
from models import DocumentCreate, DocumentUpdate, new_id, now_utc

router = APIRouter(prefix="/api/documents", tags=["documents"])
UPLOAD_DIR = pathlib.Path(os.environ.get("UPLOAD_DIR", "/app/backend/uploads"))
PRIVATE_DOC_DIR = UPLOAD_DIR / "documents"
PRIVATE_DOC_DIR.mkdir(parents=True, exist_ok=True)

ADMIN_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
INTERNAL_ROLES = {"club_admin", "superadmin"}


def _normalise_visibility(value: str | None) -> str:
    return "internal" if value == "internal" else "members"


def _is_admin(user: dict | None) -> bool:
    return bool(user and user.get("role") in ADMIN_ROLES)


async def _user_can_see(user: dict | None, visibility: str | None) -> bool:
    """Documents are never public: only active club members or admins can see them."""
    if not user:
        return False
    visibility = _normalise_visibility(visibility)
    if visibility == "internal":
        return user.get("role") in INTERNAL_ROLES
    return bool(user.get("is_club_member") or _is_admin(user))


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


def _document_view_url(doc_id: str) -> str:
    return f"/api/documents/{doc_id}/view"


def _document_url(doc_id: str) -> str:
    return f"/api/documents/{doc_id}/download"


def _public_doc(doc: dict, user: dict | None = None) -> dict:
    out = dict(doc)
    out["visibility"] = _normalise_visibility(out.get("visibility"))
    out["view_url"] = _document_view_url(out["id"])
    if out.get("allow_download") or _is_admin(user):
        out["download_url"] = _document_url(out["id"])
    else:
        out.pop("download_url", None)
    return out


def _file_response(doc: dict, path: pathlib.Path, disposition: str) -> FileResponse:
    original = (doc.get("original_filename") or path.name).replace("\\", "/").rsplit("/", 1)[-1]
    original = original.replace("\r", "").replace("\n", "") or path.name
    return FileResponse(
        path,
        media_type=doc.get("mime") or "application/octet-stream",
        filename=original,
        headers={
            "Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(original, safe='')}",
            "X-Content-Type-Options": "nosniff",
        },
    )


async def _load_authorized_doc(doc_id: str, user: dict | None) -> tuple[dict, pathlib.Path]:
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Dokument nicht gefunden.")
    if not await _user_can_see(user, doc.get("visibility") or "members"):
        raise HTTPException(403, "Kein Zugriff.")
    path = _safe_storage_path(doc)
    if not path or not path.exists() or not path.is_file():
        raise HTTPException(404, "Datei nicht gefunden.")
    return doc, path


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
            {"k": "presentation", "l": "Praesentation"},
            {"k": "template", "l": "Vorlage"},
            {"k": "other", "l": "Sonstiges"},
        ],
        "visibilities": [
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
    query: dict = {}
    if category:
        query["category"] = category
    docs = await db.documents.find(query, {"_id": 0}).sort(
        [("pinned", -1), ("order_index", 1), ("created_at", -1)]
    ).to_list(500)
    out = []
    for doc in docs:
        if await _user_can_see(user, doc.get("visibility") or "members"):
            out.append(_public_doc(doc, user))
    return out


@router.get("/admin")
async def admin_list_documents(me: dict = Depends(require_admin())):
    db = get_db()
    docs = await db.documents.find({}, {"_id": 0}).sort([("pinned", -1), ("order_index", 1)]).to_list(1000)
    return [_public_doc(doc, me) for doc in docs]


@router.post("")
async def create_document(body: DocumentCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    doc["visibility"] = _normalise_visibility(doc.get("visibility"))
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    doc["uploader_name"] = me.get("display_name") or me.get("username")
    doc["download_count"] = 0
    doc["view_count"] = 0
    if doc.get("storage_key"):
        doc["file_url"] = _document_url(doc["id"])
    await db.documents.insert_one(doc)
    doc.pop("_id", None)
    return _public_doc(doc, me)


@router.put("/{doc_id}")
@router.patch("/{doc_id}")
async def update_document(doc_id: str, body: DocumentUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"description", "storage_key", "original_filename", "file_size", "mime", "tags"}
    raw = body.model_dump(exclude_unset=True)
    update = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not update:
        raise HTTPException(400, "Keine Aenderungen.")
    if "visibility" in update:
        update["visibility"] = _normalise_visibility(update.get("visibility"))
    if update.get("storage_key"):
        update["file_url"] = _document_url(doc_id)
    update["updated_at"] = now_utc().isoformat()
    res = await db.documents.update_one({"id": doc_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, "Dokument nicht gefunden.")
    updated = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    return _public_doc(updated, me)


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.documents.delete_one({"id": doc_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Dokument nicht gefunden.")
    return {"ok": True}


@router.get("/{doc_id}/view")
async def view_document(doc_id: str, user: dict | None = Depends(get_optional_user)):
    """Inline stream a document after membership/internal checks."""
    db = get_db()
    doc, path = await _load_authorized_doc(doc_id, user)
    await db.documents.update_one({"id": doc_id}, {"$inc": {"view_count": 1}})
    return _file_response(doc, path, "inline")


@router.get("/{doc_id}/download")
async def download_document(doc_id: str, user: dict | None = Depends(get_optional_user)):
    """Download only when explicitly enabled. Admins can always download."""
    db = get_db()
    doc, path = await _load_authorized_doc(doc_id, user)
    if not doc.get("allow_download") and not _is_admin(user):
        raise HTTPException(403, "Download ist fuer dieses Dokument deaktiviert.")
    await db.documents.update_one({"id": doc_id}, {"$inc": {"download_count": 1}})
    return _file_response(doc, path, "attachment")


@router.post("/{doc_id}/track-download")
async def track_download(doc_id: str, user: dict | None = Depends(get_optional_user)):
    """Increment download counter only when downloads are enabled."""
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Dokument nicht gefunden.")
    if not await _user_can_see(user, doc.get("visibility") or "members"):
        raise HTTPException(403, "Kein Zugriff.")
    if not doc.get("allow_download") and not _is_admin(user):
        raise HTTPException(403, "Download ist fuer dieses Dokument deaktiviert.")
    await db.documents.update_one({"id": doc_id}, {"$inc": {"download_count": 1}})
    return {"ok": True, "url": _document_url(doc_id)}
