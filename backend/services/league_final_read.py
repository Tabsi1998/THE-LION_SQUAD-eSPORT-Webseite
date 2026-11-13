"""Der Endstand einer Liga-Staffel zum Lesen (F.1, #1645, docs/LIGA.md „F.1 Saisonabschluss“).

Blatt-Modul: Die Tabellen-Route (``tournament_view_routes._standing_rows``) fragt hier, ob eine Staffel abgeschlossen ist, ohne die
Abläufe in ``league_final`` zu laden - die brauchen ihrerseits die Tabelle (kein Import-Kreis).
"""
from __future__ import annotations

import copy

from fastapi import HTTPException

from services.league_scope import is_league_staffel

CLOSED_LOCK = "Die Staffel ist abgeschlossen. Erst im Reiter „Abschluss“ wieder öffnen, dann korrigieren."


def is_closed(tournament: dict | None) -> bool:
    return isinstance((tournament or {}).get("final_table"), dict)


async def active_final(db, tournament_id: str) -> dict | None:
    """Die geltende Fassung des Endstands - ``None``, solange die Staffel nicht abgeschlossen ist."""
    return await db.league_final_tables.find_one({"tournament_id": tournament_id, "active": True}, {"_id": 0})


async def frozen_rows(db, tournament: dict | None) -> list[dict] | None:
    """Die Tabelle des Endstands - ``None``, solange die Staffel nicht abgeschlossen ist (dann wird gerechnet)."""
    if not is_league_staffel(tournament):
        return None
    final = await active_final(db, tournament["id"])
    return copy.deepcopy(final.get("rows") or []) if final else None


async def closed_refusal(db, tournament_id: str | None) -> str | None:
    """Die eine Schreibsperre nach dem Abschluss (H1): Ist die Staffel abgeschlossen, der Satz dazu - sonst ``None``. Jeder Weg, der
    Ergebnis, Stand oder Wertung eines Spiels schreibt, fragt hier, vor und unter der Schreibsperre des Turniers."""
    if not tournament_id:
        return None
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "final_table": 1})
    return CLOSED_LOCK if is_closed(tournament) else None


async def ensure_not_closed(db, tournament_id: str | None) -> None:
    """409 mit ``CLOSED_LOCK``, wenn die Staffel abgeschlossen ist - für Routen."""
    refusal = await closed_refusal(db, tournament_id)
    if refusal:
        raise HTTPException(status_code=409, detail=refusal)
