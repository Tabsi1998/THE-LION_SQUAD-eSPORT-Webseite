"""Hinweis der Turnierleitung (#1166) - Logik in ``services/tournament_notices.py``.

- ``GET    /api/tournaments/{tid}/notices``: die stehenden Hinweise für das Banner der Turnierseite - nur Text und Zeit,
  sichtbar wie das Turnier.
- ``GET    /api/tournaments/{tid}/lead/notices``: Reiter „Hinweis“ - die letzten Hinweise mit Protokoll.
- ``POST   /api/tournaments/{tid}/lead/notices/preview``: wie viele Personen den Hinweis bekämen.
- ``POST   /api/tournaments/{tid}/lead/notices``: schreiben, einmal je ``request_id``. Die Antwort kommt sofort, verschickt
  wird im Hintergrund (wie die Rundnachricht aus E.4).
- ``DELETE /api/tournaments/{tid}/lead/notices/{notice_id}``: entfernen - Banner und TV zeigen ihn nicht mehr.

Schreiben und entfernen: Organisation und Schiedsrichter mit Einsatz für das ganze Turnier, die Turnierleitung als Rolle
oder Freigabe; in einer Staffel das Liga-Recht „Spiele betreuen“. Ziel „ganzes Event“: wer das in allen Turnieren des
Events darf.
"""
from __future__ import annotations

from typing import Literal

from fastapi import BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user, get_optional_user
from database import get_db
from routes.tournament_common import _get_visible_tournament, _resolve_tid
from routes.tournament_router import router
from services import tournament_notices as notices

DENIED = "Hinweise schreibt die Turnierleitung dieses Turniers."
CLOSED = "Für dieses Turnier gehen keine Hinweise mehr hinaus."


class NoticeTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: Literal["tournament", "event"] = "tournament"


class NoticeBody(NoticeTarget):
    request_id: str = Field(min_length=8, max_length=80)
    text: str = Field(max_length=notices.TEXT_MAX + 200)
    show_on_tv: bool = False
    duration_minutes: int = Field(default=notices.DURATION_DEFAULT, ge=notices.DURATION_MIN, le=notices.DURATION_MAX)


def _raise(problem: notices.NoticeProblem):
    raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


async def _lead_tournament(db, tid: str, me: dict) -> dict:
    tournament_id = await _resolve_tid(tid)
    if not await notices.can_write(me, tournament_id):
        raise HTTPException(status_code=403, detail=DENIED)
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return tournament


async def _check_target(db, tournament: dict, me: dict, target: str) -> None:
    if target != "event":
        return
    if not tournament.get("event_id"):
        raise HTTPException(status_code=409, detail=notices.NO_EVENT)
    if not await notices.can_write_event(db, me, tournament["event_id"]):
        raise HTTPException(status_code=403, detail="An das ganze Event schreibt, wer in allen Turnieren des Events Hinweise schreiben darf.")


@router.get("/{tid}/notices")
async def public_notices(tid: str, response: Response, user: dict | None = Depends(get_optional_user)):
    """Banner der Turnierseite: die stehenden Hinweise dieses Turniers und die an sein ganzes Event."""
    db = get_db()
    tournament = await _get_visible_tournament(await _resolve_tid(tid), user)
    # Ein entfernter Hinweis soll sofort verschwinden - kein gemeinsamer Zwischenspeicher.
    response.headers["Cache-Control"] = "no-store"
    return {"items": await notices.for_tournament(db, tournament)}


@router.get("/{tid}/lead/notices")
async def lead_notices(tid: str, response: Response, me: dict = Depends(get_current_user)):
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    tournament = await _lead_tournament(db, tid, me)
    return await notices.lead_list(db, tournament, me)


@router.post("/{tid}/lead/notices/preview")
async def lead_notice_preview(tid: str, body: NoticeTarget, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament = await _lead_tournament(db, tid, me)
    await _check_target(db, tournament, me, body.target)
    try:
        return await notices.preview(db, tournament, target=body.target, sender_id=me.get("id"))
    except notices.NoticeProblem as problem:
        _raise(problem)


@router.post("/{tid}/lead/notices")
async def lead_notice_send(tid: str, body: NoticeBody, background: BackgroundTasks, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament = await _lead_tournament(db, tid, me)
    if tournament.get("status") in notices.SKIPPED_TOURNAMENT_STATUSES:
        raise HTTPException(status_code=409, detail=CLOSED)
    await _check_target(db, tournament, me, body.target)
    try:
        answer, job = await notices.send(db, tournament, me, request_id=body.request_id, text=body.text, target=body.target,
                                         show_on_tv=body.show_on_tv, duration_minutes=body.duration_minutes)
    except notices.NoticeProblem as problem:
        _raise(problem)
    if job:
        background.add_task(notices.deliver, db, **job)
    return answer


@router.delete("/{tid}/lead/notices/{notice_id}")
async def lead_notice_remove(tid: str, notice_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament = await _lead_tournament(db, tid, me)
    try:
        return await notices.remove(db, tournament, me, notice_id)
    except notices.NoticeProblem as problem:
        _raise(problem)
