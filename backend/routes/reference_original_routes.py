"""Original-Bilder des Veranstalters je Termin (#1933) - Regeln und Ablage in ``services/reference_originals.py``.

**Verwaltung** unter ``/api/reference-series/admin/series/{series_id}/rounds/{round_id}/originals`` - Vorstand
(Bereich Redaktion) und gültige Captains der Saison (``require_series_editor``, wie beim Ergebnisblatt); der Termin
muss zur Serie aus dem Pfad gehören (sonst 404):

- ``GET`` - die Bilder des Termins (``items``, je Bild ``shown`` und ``hidden_reason``: ``admin_only``, ``draft``,
  ``archived``, ``not_published``, ``hidden_name``) und die Grenzen (``max_mb``, ``max_per_round``, ``formats``,
  ``kinds``, ``max_map``), dazu ``can_delete`` (nur der Vorstand).
- ``POST ?kind=…&map=…&origin=upload|reading`` - Body ist das Bild selbst (PNG, JPG oder WebP; geprüft wird der Inhalt,
  nicht der angegebene Typ). Ohne ``kind`` gilt die Art des Laufs (Rennliga) bzw. „Sonstiges“. ``origin: reading``
  heißt: aus der Bild-Erkennung (#1756), angehängt beim Übernehmen des Blatts. Rate-Limit je Konto.
  Vorstand und Captains mit Recht zum Veröffentlichen: freigegeben; sonst Entwurf bis zur Freigabe des Ergebnisses.
- ``PATCH …/{id}`` - ``{kind?, map?, source_url?, public?, release?}``. Der Vorstand ändert jedes Bild und gibt frei
  (``release: true``); ein Captain nur eigene Entwürfe und ohne Freigabe.
- ``DELETE …/{id}`` - nur der Vorstand, mit Eintrag im Adminprotokoll (``reference_original.delete``).
- ``GET …/{id}/file?w=…`` - das Bild bzw. ein Vorschaubild (Breiten wie ``image_variants``), nie zwischengespeichert.

**Öffentlich:** ``GET /api/reference-series/public/{spur}/{saison}/originals/{id}?w=…`` - nur wenn Spur und Saison
für die Person sichtbar sind und das Bild öffentlich ist (``reference_originals.is_public``), sonst 404. Die Liste je
Termin steht in der Serienseite (``originals``) und je Lauf in der Rundenseite (``sessions[].originals``).
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from auth import get_optional_user
from database import get_db
from models import new_id, now_utc
from routes.reference_round_routes import visible_series
from services import race_weekend, reference_originals
from services.rate_limit import enforce_rate_limit, keyed_subject
from services.reference_series_access import SeriesAccess, require_series_editor

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

BASE = "/admin/series/{series_id}/rounds/{round_id}/originals"
RATE_LIMIT = reference_originals.RATE_LIMIT
RATE_WINDOW_SECONDS = reference_originals.RATE_WINDOW_SECONDS
NOT_FOUND = "Bild nicht gefunden."
TOO_MANY = "Zu viele Bilder in kurzer Zeit. Bitte warte noch {wait}."
OWN_DRAFTS_ONLY = "Captains ändern nur eigene Bilder, solange sie Entwurf sind."
RELEASE_BOARD_ONLY = "Bilder gibt der Vorstand frei - mit dem Ergebnis oder einzeln."
# Verwaltung: nie zwischenspeichern. Öffentlich: kurz und nur im Browser - „nur Verwaltung“ wirkt so bald.
ADMIN_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
                 "Cache-Control": "private, no-store"}
PUBLIC_HEADERS = {"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline",
                  "Cache-Control": "private, max-age=300"}


class OriginalPatch(BaseModel):
    kind: Optional[Literal["qualifying", "sprint", "race", "scoreboard", "table", "other"]] = None
    map: Optional[int] = Field(default=None, ge=1, le=reference_originals.MAX_MAP)
    source_url: Optional[str] = Field(default=None, max_length=reference_originals.MAX_URL)
    public: Optional[bool] = None
    release: Optional[bool] = None

    @field_validator("source_url")
    @classmethod
    def _source(cls, value):
        return reference_originals.clean_source_url(value)


def _file(found, headers: dict) -> FileResponse:
    if found is None:
        raise HTTPException(404, NOT_FOUND)
    path, media_type = found
    return FileResponse(path, media_type=media_type, headers=headers)


async def _image(access: SeriesAccess, round_id: str, image_id: str) -> tuple[dict, dict]:
    round_doc = await access.round(round_id)
    doc = await get_db().reference_round_originals.find_one(
        {"id": image_id, "series_id": access.series_id, "round_id": round_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, NOT_FOUND)
    return round_doc, doc


async def _default_kind(access: SeriesAccess, round_doc: dict) -> str:
    """Ohne Angabe: die Art des Laufs in einer Rennliga (Rennen, Sprint, Qualifying), sonst „Sonstiges“."""
    lineage = await get_db().reference_lineages.find_one({"id": access.series.get("lineage_id")}, {"_id": 0, "kind": 1})
    if (lineage or {}).get("kind") == "racing":
        return race_weekend.session_kind(round_doc.get("session"))
    return "other"


@router.get(BASE)
async def list_originals(series_id: str, round_id: str, access: SeriesAccess = Depends(require_series_editor)):
    round_doc = await access.round(round_id)
    items = await reference_originals.admin_list(get_db(), series_id, round_doc, board=access.is_board,
                                                 user_id=access.user["id"])
    return {"items": items, "can_delete": access.is_board, "can_release": access.is_board,
            "default_kind": await _default_kind(access, round_doc), **reference_originals.limits()}


@router.post(BASE)
async def upload_original(series_id: str, round_id: str, request: Request, kind: Optional[str] = None,
                          map_number: Optional[int] = Query(default=None, alias="map"), origin: str = "upload",
                          access: SeriesAccess = Depends(require_series_editor)):
    db = get_db()
    round_doc = await access.round(round_id)
    kind, map_number = reference_originals.check_kind(kind or await _default_kind(access, round_doc), map_number)
    await enforce_rate_limit(request, "reference_original", RATE_LIMIT, RATE_WINDOW_SECONDS,
                             subject=keyed_subject(access.user["id"]), message=TOO_MANY)
    state = reference_originals.RELEASED if access.can_publish else reference_originals.DRAFT
    doc = await reference_originals.store(db, series_id=series_id, round_doc=round_doc, user=access.user, kind=kind,
                                          map_number=map_number, origin=origin, state=state,
                                          body=await reference_originals.read_body(request))
    return await reference_originals.admin_item(db, series_id, round_doc, doc, board=access.is_board,
                                                user_id=access.user["id"])


@router.patch(BASE + "/{image_id}")
async def update_original(series_id: str, round_id: str, image_id: str, body: OriginalPatch,
                          access: SeriesAccess = Depends(require_series_editor)):
    db = get_db()
    round_doc, doc = await _image(access, round_id, image_id)
    raw = body.model_dump(exclude_unset=True)
    if raw.get("release") and not access.is_board:
        raise HTTPException(403, RELEASE_BOARD_ONLY)
    if not access.is_board and (doc.get("created_by") != access.user["id"]
                                or doc.get("state") != reference_originals.DRAFT):
        raise HTTPException(403, OWN_DRAFTS_ONLY)
    kind = raw.get("kind") or doc.get("kind")
    # Eine andere Art als Scoreboard nimmt die Map-Nummer mit - außer sie wird ausdrücklich mitgeschickt.
    map_number = raw["map"] if "map" in raw else (doc.get("map") if kind == "scoreboard" else None)
    kind, map_number = reference_originals.check_kind(kind, map_number)
    now = now_utc().isoformat()
    updates = {"kind": kind, "map": map_number, "updated_at": now, "updated_by": access.user["id"]}
    if "source_url" in raw:
        updates["source_url"] = raw["source_url"]
    if raw.get("public") is not None:
        updates["public"] = raw["public"]
    if raw.get("release") and doc.get("state") != reference_originals.RELEASED:
        updates.update({"state": reference_originals.RELEASED, "released_at": now, "released_by": access.user["id"]})
    await db.reference_round_originals.update_one({"id": image_id}, {"$set": updates})
    return await reference_originals.admin_item(db, series_id, round_doc, {**doc, **updates}, board=access.is_board,
                                                user_id=access.user["id"])


@router.delete(BASE + "/{image_id}")
async def delete_original(series_id: str, round_id: str, image_id: str,
                          access: SeriesAccess = Depends(require_series_editor)):
    access.require_board()
    db = get_db()
    _, doc = await _image(access, round_id, image_id)
    await reference_originals.delete(db, doc)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "reference_original.delete", "actor_id": access.user["id"], "target_id": doc["id"],
        "data": {"series_id": series_id, "round_id": round_id, "kind": doc.get("kind"), "map": doc.get("map"),
                 "state": doc.get("state"), "public": doc.get("public"), "origin": doc.get("origin"),
                 "size": doc.get("size"), "created_by": doc.get("created_by"), "created_at": doc.get("created_at")},
        "created_at": now_utc().isoformat(),
    })
    return {"deleted": doc["id"]}


@router.get(BASE + "/{image_id}/file")
async def original_file(series_id: str, round_id: str, image_id: str, w: Optional[int] = None,
                        access: SeriesAccess = Depends(require_series_editor)):
    _, doc = await _image(access, round_id, image_id)
    return _file(reference_originals.file_for(doc, w), ADMIN_HEADERS)


@router.get("/public/{lineage_slug}/{season_slug}/originals/{image_id}")
async def public_original(lineage_slug: str, season_slug: str, image_id: str, w: Optional[int] = None,
                          user: dict | None = Depends(get_optional_user)):
    """Ein öffentliches Original - 404 für alles andere (auch ob es das Bild gibt, erfährt sonst niemand)."""
    db = get_db()
    _, series = await visible_series(db, user, lineage_slug, season_slug)
    doc = await db.reference_round_originals.find_one({"id": image_id, "series_id": series["id"]}, {"_id": 0})
    if not doc or not await reference_originals.is_public(db, doc):
        raise HTTPException(404, NOT_FOUND)
    return _file(reference_originals.file_for(doc, w), PUBLIC_HEADERS)
