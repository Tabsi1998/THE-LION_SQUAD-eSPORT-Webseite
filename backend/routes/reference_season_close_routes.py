"""Saison abschließen (#1750) - Bereich Redaktion („content“), also der Vorstand; Captains tragen nur Ergebnisse ein.

- ``GET  /api/reference-series/admin/series/<id>/close``: Vorschlag mit Endständen (Team und Einzelwertungen), die
  Kopfdaten einer neuen Referenz, die Referenz der Saison (``current``, für „Referenz: Platz 6 von 8“) und die
  Referenzen, die schon zur Saison gehören (``candidates``, vorgewählt ``target_id``).
- ``POST /api/reference-series/admin/series/<id>/close``: bestätigen - Referenz anlegen oder aktualisieren, die Saison
  vermerkt sie (``reference_id``) und gilt als abgeschlossen. Läuft unter der Sperre der Saison: zwei schnelle
  Bestätigungen ergeben nie zwei Referenzen.

Die Logik steht in ``services/season_close.py``.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from services import reference_running_cache, reference_series, season_close

router = APIRouter(prefix="/api/reference-series", tags=["reference-series"],
                   dependencies=[Depends(reference_running_cache.reset_after_write)])


class ReferenceSeasonClose(BaseModel):
    """Welche Referenz der Saison aktualisiert wird - leer heißt neu anlegen. Hat die Saison schon ihre Referenz, gilt
    immer diese."""
    reference_id: Optional[str] = Field(default=None, max_length=80)


async def _pair(db, series_id: str) -> tuple[dict, dict]:
    series = await db.reference_series.find_one({"id": series_id}, {"_id": 0})
    if not series:
        raise HTTPException(404, "Serie nicht gefunden.")
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0}) or {}
    return series, lineage


@router.get("/admin/series/{series_id}/close")
async def close_preview(series_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    series, lineage = await _pair(db, series_id)
    return await season_close.proposal(db, series, lineage)


@router.post("/admin/series/{series_id}/close")
@reference_series.series_locked
async def close_season(series_id: str, body: ReferenceSeasonClose, me: dict = Depends(require_area("content"))):
    from routes.news_routes import _freeze_reference_members

    db = get_db()
    series, lineage = await _pair(db, series_id)
    reference_id = (body.reference_id or "").strip() or None
    result = await season_close.close(db, series, lineage, reference_id, me, _freeze_reference_members)
    saved, _ = await _pair(db, series_id)
    current, _rows = await season_close.candidates(db, saved)
    return {**result, "status": saved.get("status"), "current": season_close.reference_summary(current)}
