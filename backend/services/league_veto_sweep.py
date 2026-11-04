"""Der Zeit-Job des Liga-Vetos (docs/LIGA.md, „D.3 Veto“, #1618) - als eigener Job ``league_veto`` alle 10 Sekunden und im
Fristen-Job (``match_deadline_sweep``) mit denselben laufenden Turnieren.

Nach Ablauf der Zeit je Schritt (Nr. 23) wählt das System zufällig und gleichverteilt aus den Maps, die die Serie vervollständigbar
lassen (``league_veto.settle_due``). Gefragt wird nur nach laufenden Vetos mit erreichter Frist (Teil-Index ``veto_deadline``), geschrieben
unter der Turniersperre mit Bedingung auf die Version - ein zweiter Lauf findet nichts mehr, auch nach einem Neustart.
"""
from __future__ import annotations

import logging
from datetime import datetime

from models import now_utc
from services import league_veto
from services.league_veto_rules import RUNNING, veto_of
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

logger = logging.getLogger("tls.league_veto_sweep")


async def _settle(db, row: dict, now: datetime) -> int:
    """Ein fälliges Veto unter der Turniersperre auflösen - gibt zurück, wie viele Schritte das System gesetzt hat."""
    try:
        async with mutation_lock(db, tournament_write_resource(row["tournament_id"]), wait_seconds=2.0):
            tournament = await db.tournaments.find_one({"id": row["tournament_id"]}, {"_id": 0, "creation_key": 0, "billing": 0})
            match = await db.matches_v2.find_one({"id": row["id"]}, {"_id": 0})
            if not tournament or not match or tournament.get("locked_at"):
                return 0
            before = len((veto_of(match) or {}).get("steps") or [])
            after = await league_veto.settle_due(db, match, tournament, now=now)
            return len((veto_of(after) or {}).get("steps") or []) - before
    except MutationLockBusy:
        logger.info("Veto für match=%s wartet auf die Turniersperre", row.get("id"))
        return 0


async def sweep(db, tournaments: list[dict] | None = None, *, now: datetime | None = None) -> dict:
    """Ein Lauf: alle laufenden Vetos mit erreichter Frist - mit ``tournaments`` nur die dieser Turniere (Fristen-Job)."""
    now = now or now_utc()
    query = {"flow.veto.status": RUNNING, "flow.veto.deadline_at": {"$lte": now.isoformat()}, "started_at": None}
    if tournaments is not None:
        ids = [row.get("id") for row in tournaments if row.get("id")]
        if not ids:
            return {"auto": 0}
        query["tournament_id"] = {"$in": ids}
    rows = await db.matches_v2.find(query, {"_id": 0, "id": 1, "tournament_id": 1}).to_list(500)
    counts = {"auto": 0}
    for row in rows:
        try:
            counts["auto"] += await _settle(db, row, now)
        except Exception:  # noqa: BLE001 - ein Spiel hält die anderen nicht auf
            logger.warning("[league_veto_sweep] Spiel %s nicht aufgelöst", row.get("id"), exc_info=True)
    return counts
