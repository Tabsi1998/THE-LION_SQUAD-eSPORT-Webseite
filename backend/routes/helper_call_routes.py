"""Helfer-Aufruf (#1197) für den Vorstand - Bereich „Verein“ (Vorstandsposten, Freigabe oder Club-Admin).

- ``GET  /api/membership/helper-calls``             kommende Veranstaltungen mit offenen Schichten, ob heute schon gerufen
- ``POST /api/membership/helper-calls/{event_id}``  „Aufruf senden“ an alle Mitglieder - höchstens einmal je Event und Tag
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from auth import require_area
from database import get_db
from services import helper_calls

router = APIRouter(prefix="/api/membership/helper-calls", tags=["membership"])


@router.get("")
async def helper_call_overview(me: dict = Depends(require_area("club"))):
    return await helper_calls.board_view(get_db(), me)


@router.post("/{event_id}")
async def send_helper_call(event_id: int, me: dict = Depends(require_area("club"))):
    return await helper_calls.send_call(get_db(), me, event_id)
