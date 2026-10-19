"""Druckansicht (#1283): die Check-in-Liste eines Turniers für den Ausdruck - nur mit Check-in-Recht im Turnier.

Baum, Spielplan und Tagesplan druckt die Website aus den öffentlichen Antworten; nur die Liste mit Kästchen zum Abhaken
braucht diesen Weg. Die Logik steht in ``services/tournament_print.py``.
"""
from fastapi import Depends, HTTPException, Response

from auth import get_current_user
from database import get_db
from routes.tournament_common import _resolve_tid
from routes.tournament_router import router
from services import tournament_print
from services.tournament_permissions import CHECKIN_STAFF_ROLES, require_tournament_staff_permission


@router.get("/{tid}/print/checkin")
async def tournament_print_checkin(tid: str, response: Response, me: dict = Depends(get_current_user)):
    # Namen der Angemeldeten: nie in einem gemeinsamen Zwischenspeicher.
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tournament_id, CHECKIN_STAFF_ROLES)
    tournament = await db.tournaments.find_one(
        {"id": tournament_id}, {"_id": 0, "id": 1, "slug": 1, "title": 1, "team_mode": 1})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return await tournament_print.checkin_list(db, tournament)
