"""Der Endstand einer Liga-Staffel zum Lesen (F.1, #1645, docs/LIGA.md „F.1 Saisonabschluss“).

Blatt-Modul: Die Tabellen-Route (``tournament_view_routes._standing_rows``) fragt hier, ob eine Staffel abgeschlossen ist, ohne die
Abläufe in ``league_final`` zu laden - die brauchen ihrerseits die Tabelle (kein Import-Kreis).
"""
from __future__ import annotations

import copy

from services.league_scope import is_league_staffel


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
