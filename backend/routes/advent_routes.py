"""Adventkalender (#641): der Kalender für alle, das Öffnen, das Quiz - und die Pflege für die Verwaltung.

Alles unter ``/api/seasonal/advent``. Die Antworten hängen an der Person (was sie geöffnet hat), deshalb nie
im Cache. Vor seinem Tag gibt ein Türchen nichts preis; die Verwaltung sieht über die Vorschau jeden Tag
des Kalenders, ohne dass dabei etwas gezählt wird.
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from auth import get_optional_user, require_area
from database import get_db
from models import new_id, now_utc
from services import advent_calendar as advent
from services import seasons
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/seasonal/advent", tags=["seasonal"])
# Türchen sind Inhalte wie News - die Redaktion pflegt sie, die Vereinsleitung auch.
require_editor = require_area("content", "club")


def _private(response: Response) -> None:
    response.headers["Cache-Control"] = "private, no-store"


class QuizAnswer(BaseModel):
    answer: int = Field(ge=0, le=advent.QUIZ_ANSWERS - 1)


class QuizPayload(BaseModel):
    question: str = Field("", max_length=400)
    answers: list[str] = Field(default_factory=list, max_length=6)
    correct: int | None = None
    explanation: str = Field("", max_length=800)


class DoorPayload(BaseModel):
    kind: str = Field(min_length=2, max_length=40)
    title: str = Field("", max_length=200)
    body: str = Field("", max_length=6000)
    media_url: str | None = Field(None, max_length=400)
    video_url: str | None = Field(None, max_length=400)
    clip_url: str | None = Field(None, max_length=400)
    ref_id: str | None = Field(None, max_length=80)
    consent_confirmed: bool = False
    sticker_id: str | None = Field(None, max_length=120)
    quiz: QuizPayload | None = None
    link_url: str | None = Field(None, max_length=400)
    link_label: str | None = Field(None, max_length=80)


class CopyPayload(BaseModel):
    source_year: int = Field(ge=2024, le=2100)


# ------------------------------------------------------------------ Für alle

@router.get("")
async def calendar(response: Response, opened: str | None = Query(None, max_length=120), user: dict | None = Depends(get_optional_user)):
    """Der Kalender: 24 Türchen mit Zustand. Inhalt tragen nur die geöffneten - angemeldet die eigenen, für Gäste
    die, die ihr Browser als geöffnet nennt (und die schon offen sein dürfen)."""
    _private(response)
    return await advent.calendar_view(get_db(), user if user and user.get("id") else None, guest_opened=advent.parse_days(opened))


@router.post("/{day}/open")
async def open_door(day: int, request: Request, response: Response, user: dict | None = Depends(get_optional_user)):
    _private(response)
    viewer = user if user and user.get("id") else None
    await enforce_rate_limit(request, "advent_open", 60, 60, subject=(viewer or {}).get("id"))
    return await advent.open_door(get_db(), viewer, day)


@router.post("/{day}/quiz")
async def answer_quiz(day: int, body: QuizAnswer, request: Request, response: Response, user: dict | None = Depends(get_optional_user)):
    _private(response)
    viewer = user if user and user.get("id") else None
    await enforce_rate_limit(request, "advent_quiz", 30, 60, subject=(viewer or {}).get("id"))
    return await advent.answer_quiz(get_db(), viewer, day, body.answer)


# ------------------------------------------------------------------ Verwaltung

async def _audit(db, actor: dict, action: str, year: int, details: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "actor_id": actor["id"], "action": action, "entity_id": f"advent:{year}", "details": details, "created_at": now_utc().isoformat()})


@router.get("/admin/{year}")
async def admin_calendar(year: int, response: Response, me: dict = Depends(require_editor)):
    _private(response)
    return await advent.admin_view(get_db(), year)


@router.get("/admin/{year}/preview")
async def admin_preview(year: int, response: Response, at: str | None = Query(None, max_length=40), me: dict = Depends(require_editor)):
    """Der Kalender, wie ihn Gäste zu einem gewählten Zeitpunkt sähen - alle bis dahin offenen Türchen mit Inhalt.
    Ohne Zeitpunkt der Heilige Abend zu Mittag: alles offen."""
    _private(response)
    year = advent.check_year(year)
    if at:
        try:
            moment = seasons.to_vienna(datetime.fromisoformat(at.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Diesen Zeitpunkt verstehe ich nicht.") from None
    else:
        moment = seasons.at(date(year, 12, advent.DOORS), 12)
    open_days = {day for day in advent.DOOR_DAYS if advent.is_open(year, day, moment)}
    view = await advent.calendar_view(get_db(), None, now=moment, guest_opened=open_days, year=year, record=False)
    return {**view, "preview": True}


@router.put("/admin/{year}/{day}")
async def admin_save_door(year: int, day: int, body: DoorPayload, response: Response, me: dict = Depends(require_editor)):
    _private(response)
    db = get_db()
    door = await advent.save_door(db, year, day, body.model_dump(), me)
    await _audit(db, me, "advent.door.save", year, {"day": day, "kind": door["kind"]})
    return door


@router.delete("/admin/{year}/{day}")
async def admin_delete_door(year: int, day: int, response: Response, me: dict = Depends(require_editor)):
    _private(response)
    db = get_db()
    if not await advent.delete_door(db, year, day):
        raise HTTPException(status_code=404, detail="Für diesen Tag ist nichts eingetragen.")
    await _audit(db, me, "advent.door.delete", year, {"day": day})
    return {"ok": True}


@router.post("/admin/{year}/copy")
async def admin_copy_year(year: int, body: CopyPayload, response: Response, me: dict = Depends(require_editor)):
    _private(response)
    db = get_db()
    result = await advent.copy_year(db, body.source_year, year, me)
    await _audit(db, me, "advent.copy", year, {"source": body.source_year, "copied": len(result["copied"]), "skipped": len(result["skipped"])})
    return result
