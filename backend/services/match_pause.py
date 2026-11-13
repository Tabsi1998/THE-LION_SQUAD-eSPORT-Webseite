"""Turnierpause und Spielzeit-Uhr (#1167): In einer Pause steht die Uhr jedes laufenden Spiels.

Beim Pausieren merkt sich das Turnier, seit wann (``paused_at``). Beim Weiterspielen bekommt jedes Spiel, das in der
Pause lief (gestartet, noch offen), die Pausendauer auf ``paused_seconds`` addiert - eine zweite Pause summiert sich
dazu - und ``paused_at`` fällt weg. Die Uhr rechnet dann „jetzt - Start - paused_seconds“; solange die Pause läuft, steht
sie bei ``paused_at``. Beide Felder sind optional: ohne sie zählt die Uhr wie bisher (keine Migration).

Ein Spiel, das erst in der Pause gestartet wurde, bekommt nur die Zeit ab seinem Start - seine Uhr stand bei 0.
"""
from __future__ import annotations

from datetime import datetime, timezone

from services.match_timing import OPEN_STATUSES, _parse


def _seconds(value) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def is_clock_running(match: dict) -> bool:
    """Läuft die Uhr dieses Spiels? Gestartet und noch offen (ohne Ergebnis)."""
    return bool(match.get("started_at")) and str(match.get("status") or "pending") in OPEN_STATUSES


def overlap_seconds(match: dict, paused_at, now: datetime) -> int:
    """Wie lange die laufende Pause dieses Spiel angehalten hat - ab Pausenbeginn bzw. ab seinem Start, wenn das später war."""
    started = _parse(match.get("started_at"))
    since = _parse(paused_at)
    if not started or not since:
        return 0
    return max(0, int((now - max(started, since)).total_seconds()))


def pause_seconds(match: dict, tournament: dict | None, now: datetime) -> int:
    """Die ganze Pausenzeit eines laufenden Spiels: frühere Pausen plus die laufende (für „über der Zeit“)."""
    total = _seconds(match.get("paused_seconds"))
    paused_at = (tournament or {}).get("paused_at")
    if paused_at and is_clock_running(match):
        total += overlap_seconds(match, paused_at, now)
    return total


def clock_pause_fields(match: dict, tournament: dict | None) -> dict:
    """Was die Uhr eines Spiels über Pausen wissen muss: ``paused_at`` (nur solange die Pause läuft und das Spiel läuft)
    und ``paused_seconds`` (frühere Pausen)."""
    paused_at = (tournament or {}).get("paused_at")
    return {
        "paused_at": paused_at if paused_at and is_clock_running(match) else None,
        "paused_seconds": _seconds(match.get("paused_seconds")),
    }


def with_clock_pause(matches, tournament: dict | None) -> list:
    """Schreibt die Pausenfelder der Uhr in eine Antwort (nie in die Datenbank) - für Baum, TV und App."""
    for match in matches or []:
        if isinstance(match, dict) and match.get("started_at"):
            match.update(clock_pause_fields(match, tournament))
    return matches


async def settle_pause(db, tournament: dict, now: datetime | None = None) -> int:
    """Beim Weiterspielen: die Pausendauer auf jedes Spiel addieren, das in der Pause lief. Gibt die Zahl der Spiele
    zurück. Ohne ``paused_at`` (eine Pause von vor #1167) passiert nichts."""
    paused_at = tournament.get("paused_at")
    if not paused_at or not _parse(paused_at):
        return 0
    now = now or datetime.now(timezone.utc)
    running = await db.matches_v2.find(
        {"tournament_id": tournament["id"], "started_at": {"$nin": [None, ""]}, "status": {"$in": sorted(OPEN_STATUSES)}},
        {"_id": 0, "id": 1, "started_at": 1, "status": 1},
    ).to_list(3000)
    count = 0
    for match in running:
        seconds = overlap_seconds(match, paused_at, now)
        if seconds:
            await db.matches_v2.update_one({"id": match["id"]}, {"$inc": {"paused_seconds": seconds}})
            count += 1
    return count
