"""Document routes for the member portal."""
import logging
import pathlib
import re
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse

from auth import get_current_user, get_optional_user, require_area
from database import get_db
from models import DocumentCreate, DocumentUpdate, new_id, now_utc
from services import dolibarr_identity
from services.dolibarr_client import DolibarrError
from services.log_safe import log_safe
from services.media_audit import still_referenced
from services.member_activity import note_document_open
from services.permissions import MFA_MESSAGE, area_refusal, can_use_area
from services.visibility import user_can_see
from storage import PRIVATE_DOC_DIR, UPLOAD_DIR

router = APIRouter(prefix="/api/documents", tags=["documents"])
logger = logging.getLogger("tls.documents")
# Vereinsdokumente: Mitglieder und wer die Vereinsverwaltung oder System hat (#1350, services/visibility.py);
# Moderatoren und die Turnierleitung sehen sie als Mitglied. Gesperrte Downloads öffnet, wer die Vereinsverwaltung hat
# (Rolle, Freigabe, Vorstandsposten, #2125), wie jeder Adminbereich nur mit bestätigter Zwei-Faktor-Anmeldung (#1469).
UNLOCK_AREA = "club"


def _normalise_visibility(value: str | None) -> str:
    return "internal" if value == "internal" else "members"


async def _unlocks_downloads(db, user: dict | None) -> bool:
    return await can_use_area(user, UNLOCK_AREA, db=db)


async def _refuse_locked_download(db, user: dict | None) -> None:
    """Gesperrter Download - mit dem Hinweis auf die Zwei-Faktor-Anmeldung, wenn nur sie fehlt (#1469)."""
    if await area_refusal(user, (UNLOCK_AREA,), db) == MFA_MESSAGE:
        raise HTTPException(403, MFA_MESSAGE)
    raise HTTPException(403, "Download ist für dieses Dokument deaktiviert.")


async def _audit(db, action: str, me: dict, doc_id: str, data: dict) -> None:
    """Nur Titel und Art, nie der Inhalt oder die Datei (#2125)."""
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"), "target_id": doc_id, "data": data, "created_at": now_utc().isoformat()})


async def _file_still_needed(db, doc: dict, path: pathlib.Path) -> bool:
    """Braucht noch etwas anderes diese Datei? Ein zweites Dokument, die Sponsoring-Mappe (selber Ordner) oder - bei alten
    Dateien im öffentlichen Upload-Ordner - irgendein Verweis, auch in Texten von Seiten, Newslettern und Rechtstexten."""
    name = path.name
    other = await db.documents.find_one({"id": {"$ne": doc["id"]}, "$or": [{"storage_key": name}, {"file_url": {"$regex": f"/{re.escape(name)}$"}}]}, {"_id": 1})
    if other or await db.settings.find_one({"pdf_key": name}, {"_id": 1}):
        return True
    if doc.get("storage_key"):
        return False
    return bool(await still_referenced(db, {name}))


async def _remove_file(db, doc: dict) -> bool:
    """Die Datei zum Eintrag mitlöschen (#2125) - Protokolle tragen Personendaten. Nur, wenn nichts anderes sie braucht."""
    path = _safe_storage_path(doc)
    if not path or not path.is_file() or await _file_still_needed(db, doc, path):
        return False
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("[documents] Datei zum gelöschten Dokument %s bleibt liegen", log_safe(doc.get("id")), exc_info=True)
        return False
    return True


async def _user_can_see(user: dict | None, visibility: str | None) -> bool:
    """Documents are never public: only active club members or admins can see them."""
    if not user:
        return False
    visibility = _normalise_visibility(visibility)
    if visibility == "internal":
        return await user_can_see(user, "internal")   # nach Bereich, wie News und Events
    return await user_can_see(user, "members")


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


def _public_doc(doc: dict, unlocks: bool = False) -> dict:
    out = dict(doc)
    out["visibility"] = _normalise_visibility(out.get("visibility"))
    out["view_url"] = _document_view_url(out["id"])
    if out.get("allow_download") or unlocks:
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
            {"k": "presentation", "l": "Präsentation"},
            {"k": "template", "l": "Vorlage"},
            {"k": "other", "l": "Sonstiges"},
        ],
        # Dieselben Wörter wie die Plakette in der Liste (#1367); die Werte bleiben.
        "visibilities": [
            {"k": "members", "l": "Mitglieder"},
            {"k": "internal", "l": "Vorstand"},
        ],
    }


async def _visible_documents(db, user: dict | None, category: Optional[str] = None) -> list[dict]:
    """Alles, was die Person sehen darf: die Dokumente der Website und die aus der Vereinsakte (gemischt)."""
    query: dict = {}
    if category:
        query["category"] = category
    docs = await db.documents.find(query, {"_id": 0}).sort(
        [("pinned", -1), ("order_index", 1), ("created_at", -1)]
    ).to_list(500)
    out = []
    unlocks = await _unlocks_downloads(db, user)
    for doc in docs:
        if await _user_can_see(user, doc.get("visibility") or "members"):
            out.append(_public_doc(doc, unlocks))
    # Dokumente aus der Vereinsakte (#324 Teil 1): nur für Mitglieder, nie ein Fehler für die Seite.
    if user and await user_can_see(user, "members"):
        try:
            from_dolibarr = await dolibarr_identity.documents_for(db, user)
        except Exception as exc:  # noqa: BLE001 - die Liste der eigenen Unterlagen darf nie an Dolibarr scheitern
            logger.warning("[documents] Vereinsakte nicht lesbar: %s", exc)
            from_dolibarr = []
        out.extend(doc for doc in from_dolibarr if not category or doc.get("category") == category)
    return out


async def club_documents_for(db, user: dict | None, category: Optional[str] = None) -> list[dict]:
    """Die Vereinsdokumente (#1255): für alle Mitglieder gleich - ohne persönliche Schreiben aus der Vereinsakte."""
    return [doc for doc in await _visible_documents(db, user, category) if not doc.get("personal")]


@router.get("")
async def list_documents(
    category: Optional[str] = None,
    scope: Optional[Literal["club"]] = None,
    user: dict | None = Depends(get_optional_user),
):
    """Ohne `scope` die gemischte Liste wie bisher (ältere App-Versionen zeigen dort auch die eigenen Unterlagen);
    `scope=club` nur die Vereinsdokumente (#1255) - die eigenen stehen unter /api/account/documents."""
    db = get_db()
    if scope == "club":
        return await club_documents_for(db, user, category)
    return await _visible_documents(db, user, category)


# Die eigenen Unterlagen (#1255) gehören zum Konto - wie /api/account/invoices: Profil → „Nur für dich“.
account_router = APIRouter(prefix="/api/account/documents", tags=["documents"])


@account_router.get("")
async def my_documents(user: dict = Depends(get_current_user)):
    """Nur die eigenen Unterlagen aus der Vereinsakte, neueste zuerst - Öffnen und Laden wie bei den Vereinsdokumenten
    (/api/documents/{id}/view, …/download; die prüfen bei jedem Abruf neu, ob die Person sie sehen darf)."""
    return await dolibarr_identity.own_documents(get_db(), user)


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
    if not user or not await user_can_see(user, "members"):
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
    unlocks = await _unlocks_downloads(db, me)
    return [_public_doc(doc, unlocks) for doc in docs]


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
    await _audit(db, "document.create", me, doc["id"], {"title": doc.get("title"), "category": doc.get("category"), "visibility": doc["visibility"]})
    return _public_doc(doc, await _unlocks_downloads(db, me))


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
    previous = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not previous:
        raise HTTPException(404, "Dokument nicht gefunden.")
    await db.documents.update_one({"id": doc_id}, {"$set": update})
    updated = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    # Eine neue Datei ersetzt die alte: die alte bleibt sonst unbemerkt liegen.
    replaced = "storage_key" in update and previous.get("storage_key") and update["storage_key"] != previous["storage_key"]
    file_removed = bool(replaced and await _remove_file(db, {**previous, "file_url": None}))
    changed = sorted(key for key, value in update.items() if key not in {"updated_at", "file_url"} and value != previous.get(key))
    await _audit(db, "document.update", me, doc_id, {"title": updated.get("title"), "fields": changed, **({"file_removed": file_removed} if replaced else {})})
    return _public_doc(updated, await _unlocks_downloads(db, me))


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, me: dict = Depends(require_area("club"))):
    db = get_db()
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Dokument nicht gefunden.")
    await db.documents.delete_one({"id": doc_id})
    file_removed = await _remove_file(db, doc)
    await _audit(db, "document.delete", me, doc_id, {"title": doc.get("title"), "category": doc.get("category"), "file_removed": file_removed})
    return {"ok": True, "file_removed": file_removed}


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
    if not doc.get("allow_download") and not await _unlocks_downloads(db, user):
        await _refuse_locked_download(db, user)
    await db.documents.update_one({"id": doc_id}, {"$inc": {"download_count": 1}})
    await note_document_open(db, user, doc_id)
    return _file_response(doc, path, "attachment")
