"""Anpassungen einer Saison (#1960) - Bereich Redaktion („content“), also der Vorstand; Captains tragen nur Ergebnisse ein.

±Punkte in der Gesamtwertung ohne Rennergebnis, je Teilnehmer oder Team, mit Grund, Tag und optional dem Termin, um
den es geht (etwa −5 für Nichtteilnahme nach Anmeldung). Gespeichert in der Saison (``reference_series.adjustments``),
gerechnet im Rechenkern (``services/series_adjustments.py``). Jede Änderung läuft unter der Sperre der Saison, steht im
Adminprotokoll und rechnet die Stände neu. Öffentlich erscheinen Punkte und Grund - der Grund ist also für alle lesbar.

- ``POST   /api/reference-series/admin/series/<id>/adjustments``: anlegen
- ``PATCH  /api/reference-series/admin/series/<id>/adjustments/<kennung>``: ändern (alle Felder wie beim Anlegen)
- ``DELETE /api/reference-series/admin/series/<id>/adjustments/<kennung>``: entfernen
Alle antworten mit der Liste der Anpassungen der Saison.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from models import new_id, now_utc
from services import reference_running_cache, reference_series, series_adjustments

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])

BASE = "/admin/series/{series_id}/adjustments"
TOO_MANY = f"Höchstens {series_adjustments.MAX_ADJUSTMENTS} Anpassungen je Saison."


class AdjustmentBody(BaseModel):
    """Eine Anpassung: für einen Teilnehmer der Saison oder ein Team, Punkte (±, nicht 0), Grund, Tag, Termin."""
    kind: Literal["participant", "team"] = "participant"
    participant_id: Optional[str] = Field(default=None, max_length=80)
    team: Optional[str] = Field(default=None, max_length=120)
    points: float = Field(ge=-series_adjustments.MAX_POINTS, le=series_adjustments.MAX_POINTS, allow_inf_nan=False)
    reason: str = Field(min_length=1, max_length=series_adjustments.MAX_REASON)
    day: str = Field(min_length=10, max_length=10)
    round_id: Optional[str] = Field(default=None, max_length=80)


async def _series(db, series_id: str) -> dict:
    found = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not found:
        raise HTTPException(404, "Serie nicht gefunden.")
    return found


async def _clean(db, series_id: str, body: AdjustmentBody) -> dict:
    try:
        clean = series_adjustments.normalize(body.model_dump())
    except ValueError as exc:
        raise HTTPException(422, f"Anpassung: {exc}") from exc
    if clean["participant_id"] and not await db.reference_participants.find_one(
            {"id": clean["participant_id"], "series_id": series_id}, {"_id": 1}):
        raise HTTPException(404, "Teilnehmer nicht gefunden.")
    if clean["round_id"] and not await db.reference_rounds.find_one(
            {"id": clean["round_id"], "series_id": series_id}, {"_id": 1}):
        raise HTTPException(404, "Termin nicht gefunden.")
    return clean


async def _finish(db, me: dict, series_id: str, action: str, data: dict) -> dict:
    """Protokoll, Neurechnen und die Antwort: alle Anpassungen der Saison."""
    await db.audit_logs.insert_one({"id": new_id(), "action": f"reference_series.adjustment_{action}",
                                    "actor_id": me["id"], "target_id": series_id, "data": data,
                                    "created_at": now_utc().isoformat()})
    saved = await _series(db, series_id)
    await reference_series.recompute_standings(db, saved)
    return {"adjustments": saved.get("adjustments") or []}


@router.post(BASE)
@reference_series.series_locked
async def create_adjustment(series_id: str, body: AdjustmentBody, me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    if len(series.get("adjustments") or []) >= series_adjustments.MAX_ADJUSTMENTS:
        raise HTTPException(422, TOO_MANY)
    now = now_utc().isoformat()
    doc = {"id": new_id(), **await _clean(db, series_id, body), "created_at": now, "created_by": me["id"],
           "updated_at": now, "updated_by": me["id"]}
    await db.reference_series.update_one({"id": series_id}, {"$push": {"adjustments": doc}})
    return await _finish(db, me, series_id, "create", {"adjustment": series_adjustments.public(doc),
                                                       "kind": doc["kind"], "participant_id": doc["participant_id"],
                                                       "team": doc["team"]})


@router.patch(f"{BASE}/{{adjustment_id}}")
@reference_series.series_locked
async def update_adjustment(series_id: str, adjustment_id: str, body: AdjustmentBody,
                            me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    items = list(series.get("adjustments") or [])
    index = next((at for at, item in enumerate(items) if item.get("id") == adjustment_id), None)
    if index is None:
        raise HTTPException(404, "Anpassung nicht gefunden.")
    before = items[index]
    items[index] = {**before, **await _clean(db, series_id, body), "updated_at": now_utc().isoformat(),
                    "updated_by": me["id"]}
    await db.reference_series.update_one({"id": series_id}, {"$set": {"adjustments": items}})
    return await _finish(db, me, series_id, "update", {"before": series_adjustments.public(before),
                                                       "after": series_adjustments.public(items[index])})


@router.delete(f"{BASE}/{{adjustment_id}}")
@reference_series.series_locked
async def delete_adjustment(series_id: str, adjustment_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    series = await _series(db, series_id)
    items = list(series.get("adjustments") or [])
    gone = next((item for item in items if item.get("id") == adjustment_id), None)
    if gone is None:
        raise HTTPException(404, "Anpassung nicht gefunden.")
    await db.reference_series.update_one({"id": series_id},
                                         {"$set": {"adjustments": [item for item in items if item is not gone]}})
    return await _finish(db, me, series_id, "delete", {"adjustment": series_adjustments.public(gone),
                                                       "kind": gone.get("kind"),
                                                       "participant_id": gone.get("participant_id"),
                                                       "team": gone.get("team")})
