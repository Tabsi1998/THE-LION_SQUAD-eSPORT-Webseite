"""Turnierpause und Spielzeit-Uhr (#1167): In einer Pause steht die Uhr jedes laufenden Spiels.

Beim Pausieren merkt sich das Turnier, seit wann (``paused_at``). Beim Weiterspielen bekommt jedes Spiel, das in der
Pause lief (gestartet, noch offen), die Pausendauer auf ``paused_seconds`` addiert - eine zweite Pause summiert sich
dazu - und ``paused_at`` fällt weg. Die Uhr rechnet dann „jetzt - Start - paused_seconds“; solange die Pause läuft, steht
sie bei ``paused_at``. Beide Felder sind optional: ohne sie zählt die Uhr wie bisher (keine Migration).

Ein Spiel, das erst in der Pause gestartet wurde, bekommt nur die Zeit ab seinem Start - seine Uhr stand bei 0. Ein
Spiel, das in der Pause ein Ergebnis bekam, wird mit abgerechnet: Nimmt die Leitung das Ergebnis zurück, läuft seine Uhr
ohne die Pause weiter.
"""
from __future__ import annotations

from datetime import datetime, timezone

from services.match_timing import OPEN_STATUSES, _parse, active_pause, is_clock_running, overlap_seconds, whole_seconds


def clock_pause_fields(match: dict, tournament: dict | None) -> dict:
    """Was die Uhr eines Spiels über Pausen wissen muss: ``paused_at`` (nur solange die Pause läuft und das Spiel läuft)
    und ``paused_seconds`` (frühere Pausen)."""
    paused_at = active_pause(tournament)
    return {
        "paused_at": paused_at if paused_at and is_clock_running(match) else None,
        "paused_seconds": whole_seconds(match.get("paused_seconds")),
    }


def with_clock_pause(matches, tournament: dict | None) -> list:
    """Schreibt die Pausenfelder der Uhr in eine Antwort (nie in die Datenbank) - für Baum, TV und App."""
    for match in matches or []:
        if isinstance(match, dict) and match.get("started_at"):
            match.update(clock_pause_fields(match, tournament))
    return matches


async def settle_pause(db, tournament: dict, now: datetime | None = None) -> int:
    """Beim Weiterspielen: die Pausendauer auf jedes Spiel addieren, das in der Pause lief. Gibt die Zahl der Spiele
    zurück. Ohne ``paused_at`` (eine Pause von vor #1167) passiert nichts.

    Je Spiel genau einmal je Pause: ``pause_settled_for`` merkt sich, welche Pause schon abgerechnet ist. Bricht das
    Weiterspielen danach ab (``paused_at`` bleibt) und wird wiederholt, zählt nichts doppelt."""
    paused_at = tournament.get("paused_at")
    if not paused_at or not _parse(paused_at):
        return 0
    now = now or datetime.now(timezone.utc)
    # Auch Spiele, die in der Pause ein Ergebnis bekamen: wird es zurückgenommen, läuft ihre Uhr ohne die Pause weiter.
    running = await db.matches_v2.find(
        {"tournament_id": tournament["id"], "started_at": {"$nin": [None, ""]},
         "$or": [{"status": {"$in": sorted(OPEN_STATUSES)}}, {"completed_at": {"$gte": paused_at}}]},
        {"_id": 0, "id": 1, "started_at": 1, "status": 1},
    ).to_list(3000)
    count = 0
    for match in running:
        seconds = overlap_seconds(match, paused_at, now)
        if seconds:
            written = await db.matches_v2.update_one(
                {"id": match["id"], "pause_settled_for": {"$ne": paused_at}},
                {"$inc": {"paused_seconds": seconds}, "$set": {"pause_settled_for": paused_at}},
            )
            count += written.modified_count
    return count
