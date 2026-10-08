"""Turnierleitung am Handy (#1156): die Ansicht „Turnierleitung“ eines Turniers unter /tournaments/<slug>/leitung.

Nur für die Turnierleitung dieses Turniers - global (Turnierleitung als Rolle oder Freigabe) oder mit einem
Helfer-Einsatz in genau diesem Turnier. Spieler, Moderatoren ohne Einsatz und Gäste bekommen 403 bzw. 401. Eintragen
darf je Spiel nur, wer Ergebnis-Recht hat (``can_enter``) - das prüft der Ergebnis-Weg noch einmal.
"""
from fastapi import Depends, HTTPException

from auth import get_current_user
from database import get_db
from routes.tournament_common import _resolve_tid
from routes.tournament_router import router
from services.match_lead import lead_view
from services.tournament_permissions import READ_STAFF_ROLES, RESULT_STAFF_ROLES, has_tournament_staff_permission


@router.get("/{tid}/lead")
async def tournament_lead(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    if not await has_tournament_staff_permission(me, tournament_id, READ_STAFF_ROLES | RESULT_STAFF_ROLES):
        raise HTTPException(status_code=403, detail="Diese Ansicht ist nur für die Turnierleitung dieses Turniers.")
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return await lead_view(db, tournament, me)
