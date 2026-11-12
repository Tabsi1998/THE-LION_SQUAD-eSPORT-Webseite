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
from services.log_safe import log_safe
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


async def announce_waiting(db, season_id: str, *, now: datetime | None = None) -> int:
    """Nach dem Speichern der Vorgaben der Woche (#2326): Spiele dieser Season, deren Veto auf die Vorgabe gewartet hat
    (``flow.veto_wait``) und jetzt beginnen könnte, bekommen an beide Seiten „Vorgabe da – Veto kann starten“. **Das Veto beginnt
    dadurch nicht** - ein Captain oder Vertreter startet es auf der Matchseite, vorher läuft keine Zeit. Je Spiel und Termin einmal
    (``league_veto.announce_ready`` schreibt mit Bedingung, ohne Sperre sicher). Gibt die Zahl der benachrichtigten Spiele zurück; ein
    Spiel hält die anderen nicht auf."""
    now = now or now_utc()
    staffeln = await db.tournaments.find({"league_context.season_id": season_id, "locked_at": None},
                                         {"_id": 0, "creation_key": 0, "billing": 0}).to_list(200)
    by_id = {row["id"]: row for row in staffeln if row.get("id")}
    if not by_id:
        return 0
    rows = await db.matches_v2.find({"tournament_id": {"$in": sorted(by_id)}, "flow.veto_wait": {"$exists": True}, "started_at": None},
                                    {"_id": 0}).to_list(500)
    told = 0
    for match in rows:
        try:
            told += 1 if await league_veto.announce_ready(db, match, by_id[match["tournament_id"]], now=now) else 0
        except Exception:  # noqa: BLE001 - ein Spiel hält die anderen nicht auf
            logger.warning("[league_veto_sweep] Nachricht „Veto kann starten“ zu Spiel %s nicht verschickt", log_safe(match.get("id")), exc_info=True)
    return told


async def nudge(db, *, now: datetime | None = None) -> int:
    """Erinnerung „Map-Veto wartet“ (D.4, #1651) - im Job ``league_veto`` nach dem Auflösen der Fristen: laufende Vetos, deren Frist noch
    läuft (Teil-Index ``veto_deadline``). Fällig ist sie, wenn die Seite am Zug eine Weile nicht gezogen und das Veto nicht offen hat
    (``league_veto.nudge_target``; Schalter und Sekunden je Season, #1647, Vorgabe 20 s / 5 s) - einmal je Schritt und Seite. Gibt die Zahl
    der Erinnerungen zurück; ein Spiel hält die anderen nicht auf."""
    from services import league_reminder_rules

    now = now or now_utc()
    rows = await db.matches_v2.find(
        {"flow.veto.status": RUNNING, "flow.veto.deadline_at": {"$gt": now.isoformat()}, "started_at": None},
        # ``scheduled_at`` und ``flow.schedule_rev``: das Veto gilt nur zum geltenden Termin (``veto_of``).
        {"_id": 0, "id": 1, "tournament_id": 1, "started_at": 1, "scheduled_at": 1, "flow.schedule_rev": 1, "flow.veto": 1,
         "flow.veto_seen": 1, "flow.veto_nudge": 1}).to_list(500)
    if not rows:
        return 0
    staffeln = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": sorted({row.get("tournament_id") for row in rows if row.get("tournament_id")})}},
        {"_id": 0, "id": 1, "locked_at": 1, "league_context": 1, league_reminder_rules.FIELD: 1}).to_list(500)}

    def rules_for(row: dict) -> dict:
        return league_reminder_rules.rules_of(staffeln.get(row.get("tournament_id"))) or league_reminder_rules.defaults()

    due = [row for row in rows if league_veto.nudge_target(row, now=now, rules=rules_for(row))]
    told = 0
    for row in due:
        tournament = staffeln.get(row.get("tournament_id")) or {"id": row.get("tournament_id")}
        if tournament.get("locked_at"):
            continue
        try:
            match = await db.matches_v2.find_one({"id": row["id"]}, {"_id": 0})
            told += 1 if match and await league_veto.nudge_due(db, match, tournament, now=now) else 0
        except Exception:  # noqa: BLE001 - ein Spiel hält die anderen nicht auf
            logger.warning("[league_veto_sweep] Erinnerung „Map-Veto wartet“ zu Spiel %s nicht verschickt", log_safe(row.get("id")), exc_info=True)
    return told


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
