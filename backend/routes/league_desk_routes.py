"""Leitstand der Season in der Verwaltung (E.4, docs/LIGA.md „E.4 Leitstand“, Nr. 152 und 153).

- ``GET  /api/admin/leagues/seasons/{season_id}/desk``: alle offenen Aufgaben der Season, je Gruppe - nur die Gruppen der eigenen
  Zuständigkeiten, eigene Spiele mit dem Hinweis auf die Befangenheit.
- ``GET  …/desk/log?page=``: das Protokoll der Season, seitenweise, ohne freien Text.
- ``POST …/broadcast/preview``: wie viele Personen eine Rundnachricht bekämen - vor dem Senden.
- ``POST …/broadcast``: die Rundnachricht anlegen, einmal je ``request_id`` (Doppelklick, zweiter Versuch). Die Antwort kommt sofort
  mit ``state: sending``, verschickt wird danach im Hintergrund - kein Zeitlimit eines Proxys lässt jemanden mit neuer Kennung doppelt senden.
- ``GET  …/broadcast/{request_id}``: Stand und Fortschritt für den Dialog.

Lesen darf jede Zuständigkeit der Liga, schicken nur „Liga verwalten“ oder „Season konfigurieren“. Logik in
``services/league_desk.py``.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from database import get_db
from services import league_desk as desk
from services.league_permissions import ANY, require_league

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])

require_any = require_league(ANY, via="season_id")
require_broadcast = require_league(desk.BROADCAST_CAPABILITIES, via="season_id")


class AudienceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audience: Literal["captains", "players"] = "captains"
    scope: Literal["season", "division", "staffel"] = "season"
    scope_id: Optional[str] = Field(default=None, max_length=100)


class BroadcastBody(AudienceBody):
    request_id: str = Field(min_length=8, max_length=80)
    title: str = Field(max_length=desk.TITLE_MAX + 40)
    text: str = Field(max_length=desk.TEXT_MAX + 200)
    mail: bool = False


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


def _raise(problem: desk.BroadcastProblem):
    raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


@admin_router.get("/seasons/{season_id}/desk")
async def season_desk(season_id: str, me: dict = Depends(require_any)):
    db = get_db()
    return await desk.season_desk(db, await _season(db, season_id), me)


@admin_router.get("/seasons/{season_id}/desk/log")
async def season_log(season_id: str, page: int = Query(1, ge=1, le=10000), _me: dict = Depends(require_any)):
    db = get_db()
    return await desk.season_log(db, await _season(db, season_id), page)


@admin_router.post("/seasons/{season_id}/broadcast/preview")
async def broadcast_preview(season_id: str, body: AudienceBody, me: dict = Depends(require_broadcast)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await desk.preview(db, season, audience=body.audience, scope=body.scope, scope_id=body.scope_id, sender_id=me.get("id"))
    except desk.BroadcastProblem as problem:
        _raise(problem)


@admin_router.post("/seasons/{season_id}/broadcast")
async def broadcast_send(season_id: str, body: BroadcastBody, background: BackgroundTasks, me: dict = Depends(require_broadcast)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        answer, job = await desk.send(db, season, me, request_id=body.request_id, title=body.title, text=body.text, audience=body.audience,
                                      scope=body.scope, scope_id=body.scope_id, mail=body.mail)
    except desk.BroadcastProblem as problem:
        _raise(problem)
    if job:
        background.add_task(desk.deliver, db, **job)
    return answer


@admin_router.get("/seasons/{season_id}/broadcast/{request_id}")
async def broadcast_status(season_id: str, request_id: str, _me: dict = Depends(require_broadcast)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        return await desk.status(db, season, request_id)
    except desk.BroadcastProblem as problem:
        _raise(problem)
