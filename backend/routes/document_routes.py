"""Document routes for the member portal."""
import logging
import pathlib
import re
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse

from auth import get_optional_user, require_club_admin, require_area
from database import get_db
from models import DocumentCreate, DocumentUpdate, new_id, now_utc
from services import dolibarr_identity
from services.dolibarr_client import DolibarrError
from services.member_activity import note_document_open
from services.visibility import user_can_see
from storage import PRIVATE_DOC_DIR, UPLOAD_DIR

router = APIRouter(prefix="/api/documents", tags=["documents"])
logger = logging.getLogger("tls.documents")
# Vereinsdokumente: Mitglieder und diese Rollen; Moderatoren moderieren und sehen sie als Mitglied.
ADMIN_ROLES = {"tournament_admin", "club_admin", "superadmin"}


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
        return await user_can_see(user, "internal")   # nach Bereich, wie News und Events
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
    # Dokumente aus der Vereinsakte (#324 Teil 1): nur für Mitglieder, nie ein Fehler für die Seite.
    if user and (user.get("is_club_member") or _is_admin(user)):
        try:
            from_dolibarr = await dolibarr_identity.documents_for(db, user)
        except Exception as exc:  # noqa: BLE001 - die Liste der eigenen Unterlagen darf nie an Dolibarr scheitern
            logger.warning("[documents] Vereinsakte nicht lesbar: %s", exc)
            from_dolibarr = []
        out.extend(doc for doc in from_dolibarr if not category or doc.get("category") == category)
    return out


def _module_filename(disposition_header: str | None, fallback: str) -> str:
    """Der Dateiname aus der Antwort des Moduls (`filename="…"`) - nur harmlose Zeichen, sonst der Ersatz."""
    match = re.search(r'filename="?([^";]+)"?', str(disposition_header or ""))
    name = (match.group(1) if match else "").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name).strip()
    return name or fallback


async def _dolibarr_file_response(dolibarr_id: int, user: dict, disposition: str, request: Request) -> Response | None:
    """Ein Dokument der Vereinsakte als Datei (#849): ETag (Prüfsumme), 304 auf `If-None-Match`, Teilabruf mit `Range`
    (206, 416) - so lädt die App nur Geändertes und setzt abgebrochene Downloads fort. None, wenn das Modul `…/file`
    noch nicht kennt."""
    conditional = {name: request.headers.get(name) for name in ("If-None-Match", "Range", "If-Range") if request.headers.get(name)}
    answer = await dolibarr_identity.document_file(get_db(), user, dolibarr_id, conditional)
    if answer is None:
        return None
    module = answer["headers"]
    headers = {"Cache-Control": "private, no-store", "Accept-Ranges": "bytes"}
    if module.get("ETag"):
        headers["ETag"] = module["ETag"]
    if answer["status"] == 304:
        return Response(status_code=304, headers=headers)
    if answer["status"] == 416:
        return Response(status_code=416, headers={**headers, "Content-Range": module.get("Content-Range") or "bytes */*"})
    filename = _module_filename(module.get("Content-Disposition"), f"dokument-{dolibarr_id}.pdf")
    headers["Content-Disposition"] = f'{disposition}; filename="{filename}"'
    headers["X-Content-Type-Options"] = "nosniff"
    if answer["status"] == 206 and module.get("Content-Range"):
        headers["Content-Range"] = module["Content-Range"]
    media_type = str(module.get("Content-Type") or "application/pdf").split(";")[0].strip() or "application/pdf"
    return Response(content=answer["content"], status_code=answer["status"], media_type=media_type, headers=headers)


async def _dolibarr_file(dolibarr_id: int, user: dict | None, disposition: str, *, statute: bool = False, request: Request | None = None) -> Response:
    """Ein PDF aus der Vereinsakte über denselben Weg wie die eigenen Dateien - Web und App kennen nur den."""
    if not user or not (user.get("is_club_member") or _is_admin(user)):
        raise HTTPException(403, "Nur für Mitglieder.")
    try:
        if not statute and request is not None:
            response = await _dolibarr_file_response(dolibarr_id, user, disposition, request)
            if response is not None:
                return response
        if statute:
            content, data = await dolibarr_identity.statute_pdf(get_db(), user, dolibarr_id)
        else:
            content, data = await dolibarr_identity.document_pdf(get_db(), user, dolibarr_id)
    except DolibarrError as exc:
        if exc.kind in ("not_found", "forbidden"):
            raise HTTPException(404, "Dieses Dokument gibt es nicht oder es ist für dich nicht freigegeben.")
        if exc.kind == "invalid_response":
            raise HTTPException(502, "Die Datei aus Dolibarr passt nicht zur Prüfsumme der Vereinsakte – bitte im Vereinsmodul prüfen.")
        raise HTTPException(503, "Die Vereinsakte ist gerade nicht erreichbar.")
    filename = str(data.get("filename") or f"dokument-{dolibarr_id}.pdf").replace("\\", "/").rsplit("/", 1)[-1].replace('"', "") or f"dokument-{dolibarr_id}.pdf"
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'{disposition}; filename="{filename}"', "Cache-Control": "private, no-store"})


@router.get("/admin")
async def admin_list_documents(me: dict = Depends(require_area("club"))):
    db = get_db()
    docs = await db.documents.find({}, {"_id": 0}).sort([("pinned", -1), ("order_index", 1)]).to_list(1000)
    return [_public_doc(doc, me) for doc in docs]


@router.post("")
async def create_document(body: DocumentCreate, me: dict = Depends(require_area("club"))):
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
async def update_document(doc_id: str, body: DocumentUpdate, me: dict = Depends(require_area("club"))):
    db = get_db()
    nullable_fields = {"description", "storage_key", "original_filename", "file_size", "mime", "tags"}
    raw = body.model_dump(exclude_unset=True)
    update = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not update:
        raise HTTPException(400, "Keine Änderungen.")
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
async def delete_document(doc_id: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    res = await db.documents.delete_one({"id": doc_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Dokument nicht gefunden.")
    return {"ok": True}


@router.get("/{doc_id}/view")
async def view_document(doc_id: str, request: Request, user: dict | None = Depends(get_optional_user)):
    """Inline stream a document after membership/internal checks."""
    db = get_db()
    dolibarr_id = dolibarr_identity.parse_doc_id(doc_id)
    if dolibarr_id is not None:
        response = await _dolibarr_file(dolibarr_id, user, "inline", request=request)
        await note_document_open(db, user, doc_id)
        return response
    statute_id = dolibarr_identity.parse_statute_id(doc_id)
    if statute_id is not None:
        response = await _dolibarr_file(statute_id, user, "inline", statute=True)
        await note_document_open(db, user, doc_id)
        return response
    doc, path = await _load_authorized_doc(doc_id, user)
    await db.documents.update_one({"id": doc_id}, {"$inc": {"view_count": 1}})
    # Papierkram (#615): das erste Öffnen je Person und Dokument zählt - nach der Rechteprüfung.
    await note_document_open(db, user, doc_id)
    return _file_response(doc, path, "inline")


@router.get("/{doc_id}/download")
async def download_document(doc_id: str, request: Request, user: dict | None = Depends(get_optional_user)):
    """Download only when explicitly enabled. Admins can always download."""
    db = get_db()
    dolibarr_id = dolibarr_identity.parse_doc_id(doc_id)
    if dolibarr_id is not None:
        response = await _dolibarr_file(dolibarr_id, user, "attachment", request=request)
        await note_document_open(db, user, doc_id)
        return response
    statute_id = dolibarr_identity.parse_statute_id(doc_id)
    if statute_id is not None:
        response = await _dolibarr_file(statute_id, user, "attachment", statute=True)
        await note_document_open(db, user, doc_id)
        return response
    doc, path = await _load_authorized_doc(doc_id, user)
    if not doc.get("allow_download") and not _is_admin(user):
        raise HTTPException(403, "Download ist für dieses Dokument deaktiviert.")
    await db.documents.update_one({"id": doc_id}, {"$inc": {"download_count": 1}})
    await note_document_open(db, user, doc_id)
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
        raise HTTPException(403, "Download ist für dieses Dokument deaktiviert.")
    await db.documents.update_one({"id": doc_id}, {"$inc": {"download_count": 1}})
    return {"ok": True, "url": _document_url(doc_id)}
