"""Jahresrückblick „Dein Jahr bei LION“ (#1195).

- ``GET /api/year-review/status``         gibt es gerade einen Rückblick für mich? (Startseite, App-Start)
- ``GET /api/year-review/me``             der Rückblick zum Durchtippen
- ``GET /api/year-review/me/card.png``    das Bild zum Teilen (1080×1920) - nur mit Anmeldung
- ``GET/PUT /api/admin/year-review``      Start und Ende (Standard 15.12. bis 31.01.), Stand der Meldungen

Mit ``vorschau=true`` sehen Content-Verwalter ihren eigenen Rückblick auch außerhalb des Zeitraums - so lässt er
sich vor dem Start prüfen.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import get_current_user, require_area
from database import get_db
from services import year_review
from services.permissions import areas_for

router = APIRouter(prefix="/api/year-review", tags=["year-review"])
admin_router = APIRouter(prefix="/api/admin/year-review", tags=["year-review"])

NOT_AVAILABLE = "Gerade gibt es keinen Jahresrückblick für dich."


async def _year_for(db, me: dict, preview: bool) -> int | None:
    settings = await year_review.load_settings(db)
    year = year_review.window_year(settings)
    if year is None and preview and "content" in await areas_for(me):
        year = year_review.window_info(settings)["year"]
    return year


@router.get("/status")
async def review_status(me: dict = Depends(get_current_user)):
    db = get_db()
    settings = await year_review.load_settings(db)
    year = year_review.window_year(settings)
    if year is None or not await year_review.has_activity(db, me["id"], year):
        return {"available": False, "year": year}
    return {"available": True, "year": year, "path": "/dein-jahr"}


@router.get("/me")
async def my_review(vorschau: bool = False, me: dict = Depends(get_current_user)):
    db = get_db()
    year = await _year_for(db, me, vorschau)
    review = await year_review.build_review(db, me, year) if year is not None else None
    if not review:
        raise HTTPException(status_code=404, detail=NOT_AVAILABLE)
    return {**review, "rows": [{"label": label, "value": value} for label, value in year_review.summary_rows(review)], "preview": bool(vorschau)}


@router.get("/me/card.png")
async def my_review_card(vorschau: bool = False, me: dict = Depends(get_current_user)):
    db = get_db()
    year = await _year_for(db, me, vorschau)
    review = await year_review.build_review(db, me, year) if year is not None else None
    if not review:
        raise HTTPException(status_code=404, detail=NOT_AVAILABLE)
    return Response(content=year_review.render(review), media_type="image/png",
                    headers={"Content-Disposition": f'inline; filename="mein-jahr-{review["year"]}.png"'})


class YearReviewSettings(BaseModel):
    start: str = Field(max_length=10)
    end: str = Field(max_length=10)


async def _admin_view(db) -> dict:
    settings = await year_review.load_settings(db)
    info = year_review.window_info(settings)
    info["notified"] = await db.year_review_notices.count_documents({"year": info["year"]})
    return info


@admin_router.get("")
async def admin_settings(_me: dict = Depends(require_area("content"))):
    return await _admin_view(get_db())


@admin_router.put("")
async def admin_save(body: YearReviewSettings, _me: dict = Depends(require_area("content"))):
    db = get_db()
    try:
        start = year_review.clean_day(body.start, year_review.START_MONTHS)
        end = year_review.clean_day(body.end, year_review.END_MONTHS)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    await db.settings.update_one({"id": year_review.SETTINGS_ID}, {"$set": {"id": year_review.SETTINGS_ID, "start": start, "end": end}}, upsert=True)
    return await _admin_view(db)
