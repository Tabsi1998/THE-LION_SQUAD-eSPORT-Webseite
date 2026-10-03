"""Ostereiersuche (#646): die Eier einer Seite, der Fund, der eigene Korb, die Seite der Suche - und die Pflege.

Alles unter ``/api/seasonal/easter``. Die Antworten hängen an der Person (Schlüssel, Funde), deshalb nie im Cache.
Je Seite gibt es nur deren Eier (höchstens 30 Abfragen je Minute); ein Fund braucht ein Konto und den Schlüssel
aus genau dieser Abfrage.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field

from auth import get_current_user, get_optional_user, require_area
from database import get_db
from services import easter_hunt as easter
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/seasonal/easter", tags=["seasonal"])
# Verstecke und Hinweise pflegt die Redaktion oder die Vereinsleitung; ausgewertet (Gewinne) wird von der Vereinsleitung.
require_editor = require_area("content", "club")
require_drawer = require_area("club")


def _private(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"


class FindPayload(BaseModel):
    token: str = Field(min_length=10, max_length=80)


class HuntPayload(BaseModel):
    status: str | None = Field(None, max_length=10)
    hint_unlock_hours: int | None = Field(None, ge=0, le=96)
    prizes: list[dict] | None = Field(None, max_length=4)


class EggsPayload(BaseModel):
    eggs: list[dict] = Field(default_factory=list, max_length=easter.MAX_EGGS)


class ProposePayload(BaseModel):
    web: int = Field(easter.DEFAULT_EGGS["web"], ge=0, le=easter.MAX_EGGS)
    app: int = Field(easter.DEFAULT_EGGS["app"], ge=0, le=easter.MAX_EGGS)


@router.get("/eggs")
async def eggs(request: Request, response: Response, route: str = Query("/", max_length=120), channel: str = Query("web", max_length=10),
               viewer: dict | None = Depends(get_optional_user)):
    _private(response)
    await enforce_rate_limit(request, "easter_eggs", 30, 60, subject=(viewer or {}).get("id"))
    return await easter.eggs_for(get_db(), viewer, route, channel)


@router.post("/find")
async def find(payload: FindPayload, request: Request, response: Response, me: dict = Depends(get_current_user)):
    _private(response)
    await enforce_rate_limit(request, "easter_find", 40, 60, subject=me["id"])
    return await easter.find(get_db(), me, payload.token)


@router.get("/me")
async def my_basket(response: Response, me: dict = Depends(get_current_user)):
    _private(response)
    return await easter.my_state(get_db(), me)


@router.get("/page")
async def hunt_page(response: Response, viewer: dict | None = Depends(get_optional_user)):
    _private(response)
    return await easter.page(get_db(), viewer)


# ------------------------------------------------------------------ Verwaltung

@router.get("/admin/{year}")
async def admin_year(year: int, response: Response, me: dict = Depends(require_editor)):
    _private(response)
    return await easter.admin_view(get_db(), year)


@router.put("/admin/{year}")
async def admin_save_year(year: int, payload: HuntPayload, me: dict = Depends(require_editor)):
    return await easter.save_hunt(get_db(), year, payload.model_dump(exclude_none=True), me)


@router.put("/admin/{year}/eggs")
async def admin_save_eggs(year: int, payload: EggsPayload, me: dict = Depends(require_editor)):
    return await easter.save_eggs(get_db(), year, payload.eggs, me)


@router.post("/admin/{year}/propose")
async def admin_propose(year: int, payload: ProposePayload, me: dict = Depends(require_editor)):
    """Ein Vorschlag mit Saat aus dem Jahr - gespeichert wird erst mit „Übernehmen“ (PUT …/eggs)."""
    return {"eggs": easter.propose(year, payload.web, payload.app)}


@router.post("/admin/{year}/draw")
async def admin_draw(year: int, me: dict = Depends(require_drawer)):
    return await easter.draw(get_db(), year, me)


@router.get("/admin/{year}/participants.csv")
async def admin_participants(year: int, me: dict = Depends(require_area("club"))):
    """Wer mitgesucht hat - mit E-Mail, deshalb nur für die Vereinsleitung (der Vorstand übergibt die Gewinne)."""
    from fastapi.responses import Response as FileResponse

    content = await easter.participants_csv(get_db(), year)
    return FileResponse(content="﻿" + content, media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="ostereiersuche-{int(year)}.csv"', "Cache-Control": "private, no-store"})
