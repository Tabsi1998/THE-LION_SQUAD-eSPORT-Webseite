"""Turnier nach dem Ende noch „Live“ (#2194) - für alle Turniere.

Ein Turnier, das länger läuft als geplant, zeigte nach dem eingetragenen Ende öffentlich schon „Beendet“; eines, das fertig
ist, blieb für die Leitung unbemerkt auf „Live“ (Gewinne und Saisonpunkte blieben offen).

- ``refresh`` (im Fristen-Job) hält ``tournaments.running_past_end`` aktuell: ``True``, solange der Stand ``live`` ist, das Ende
  vorbei und noch Spiele offen sind - sonst fällt das Feld weg. ``public_phase.derive_public_phase`` liest nur dieses Feld,
  ohne eigene Abfrage je Karte.
- ``ended_live_rows`` liefert der Leitung („Mein Dienst“) die Turniere, die laut Stand noch laufen, obwohl das Ende vorbei ist.
  Umgestellt wird nie automatisch.
"""
from __future__ import annotations

from datetime import datetime

from models import now_utc
from services.public_phase import parse_dt

# Offen heißt: noch zu spielen oder zu entscheiden.
OPEN_MATCH_STATUSES = ("pending", "ready", "scheduled", "in_progress", "running", "waiting_result", "disputed")
FLAG = "running_past_end"


def _open_filter(tournament_id: str) -> dict:
    return {"tournament_id": tournament_id, "status": {"$in": list(OPEN_MATCH_STATUSES)}, "is_preview": {"$ne": True}}


async def _live_past_end(db, now: datetime) -> list[dict]:
    rows = await db.tournaments.find({"status": "live", "end_date": {"$nin": [None, ""]}},
                                     {"_id": 0, "id": 1, "title": 1, "slug": 1, "end_date": 1, "league_context": 1, FLAG: 1}
                                     ).to_list(500)
    return [row for row in rows if (parse_dt(row.get("end_date")) or now) < now]


async def _has_open(db, tournament_id: str) -> bool:
    return bool(await db.matches_v2.find_one(_open_filter(tournament_id), {"_id": 1}))


async def settle(db, tournament_id: str | None) -> bool:
    """Gleich nach einem Ergebnis oder Statuswechsel: Ist nichts mehr offen oder das Turnier nicht mehr „live“, fällt das Merkmal
    sofort weg - nicht erst im nächsten Lauf. Gibt zurück, ob es entfernt wurde."""
    if not tournament_id:
        return False
    flagged = await db.tournaments.find_one({"id": tournament_id, FLAG: {"$exists": True}}, {"_id": 0, "status": 1})
    if not flagged:
        return False
    if flagged.get("status") == "live" and await _has_open(db, tournament_id):
        return False
    done = await db.tournaments.update_one({"id": tournament_id, FLAG: {"$exists": True}}, {"$unset": {FLAG: ""}})
    return bool(done.modified_count)


async def _mark(db, tournament_id: str) -> int:
    """Merkmal setzen - nur, solange der Stand „live“ ist; danach noch einmal prüfen: Endete das letzte Spiel zwischen Prüfen und
    Schreiben, nimmt ``settle`` das Merkmal sofort wieder weg (kein veraltetes ``True``)."""
    done = await db.tournaments.update_one({"id": tournament_id, "status": "live", FLAG: {"$ne": True}}, {"$set": {FLAG: True}})
    if done.modified_count and await settle(db, tournament_id):
        return 0
    return int(bool(done.modified_count))


async def refresh(db, *, now: datetime | None = None) -> dict:
    """Das Feld ``running_past_end`` an allen Turnieren auf den Stand bringen. Geschrieben wird nur, was sich ändert, und je
    Turnier mit Bedingung auf den geprüften Stand."""
    now = now or now_utc()
    counts = {"set": 0, "cleared": 0}
    past = await _live_past_end(db, now)
    running_ids = set()
    for tournament in past:
        if await _has_open(db, tournament["id"]):
            running_ids.add(tournament["id"])
            counts["set"] += await _mark(db, tournament["id"])
        elif await settle(db, tournament["id"]):
            counts["cleared"] += 1
    done = await db.tournaments.update_many({FLAG: {"$exists": True}, "id": {"$nin": sorted(running_ids)}}, {"$unset": {FLAG: ""}})
    counts["cleared"] += done.modified_count
    return counts


async def ended_live_rows(db, user: dict, *, now: datetime | None = None) -> list[dict]:
    """Für die Leitung: Turniere mit Stand „live“ nach ihrem Ende. Turnierleitung sieht Turniere ohne Liga, die Liga-Leitung mit
    „Liga verwalten“ die Staffeln ihrer Ligen."""
    from services.league_permissions import can
    from services.league_scope import is_league_staffel
    from services.permissions import is_confirmed_tournament_lead

    now = now or now_utc()
    lead = is_confirmed_tournament_lead(user)
    rows = []
    for tournament in await _live_past_end(db, now):
        if is_league_staffel(tournament):
            if not await can(user, "manage", tournament["league_context"].get("league_id"), db=db):
                continue
        elif not lead:
            continue
        open_matches = await db.matches_v2.count_documents(_open_filter(tournament["id"]))
        rows.append({
            "id": tournament["id"], "title": tournament.get("title") or "Turnier", "slug": tournament.get("slug"),
            "end_date": tournament.get("end_date"), "open_matches": open_matches, "league": is_league_staffel(tournament),
            "admin_url": f"/admin/tournaments/{tournament['id']}",
        })
    return sorted(rows, key=lambda row: str(row.get("end_date") or ""))
