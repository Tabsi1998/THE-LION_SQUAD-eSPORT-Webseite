"""Dispute (#1134): wer bis wann widersprechen darf - eine Regel für Server, Website und App.

Entscheidung des Betreibers (07.10.2026): Jeder Teilnehmer des Spiels darf in jedem Modus widersprechen, auch gegen
ein von der Turnierleitung eingetragenes Ergebnis - bis 30 Minuten nach dem Ergebnis oder bis das nächste Spiel des
Siegers beginnt, was zuerst kommt. Vor dem Ergebnis geht es immer (etwa „Gegner nicht erschienen“). Die Turnierleitung
bekommt sofort Bescheid.

„Teilnehmer“ heißt hier wie bei allen Aufgaben (#1136): wer angemeldet hat, bei Teams Teamleitung und Co-Leitung.
Website und App rechnen nicht selbst: sie zeigen ``can_dispute`` und ``dispute_until`` der Matchseite.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from models import now_utc

DISPUTE_WINDOW_MINUTES = 30
DECIDED_STATUSES = {"completed", "forfeit"}
CLOSED_STATUSES = {"cancelled", "archived", "bye"}
# Das nächste Spiel hat begonnen, sobald es läuft, auf ein Ergebnis wartet, entschieden ist - oder seine Zeit da ist.
STARTED_STATUSES = {"in_progress", "running", "waiting_result", "completed", "forfeit", "disputed"}
CLOSED_DETAIL = ("Ein Dispute ist nur bis 30 Minuten nach dem Ergebnis möglich – und nur, bis das nächste Spiel "
                 "des Siegers beginnt.")


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def decided_at(match: dict) -> datetime | None:
    """Wann das Ergebnis feststand - eingetragen, bestätigt oder als Forfeit gewertet."""
    meta = match.get("result_meta") or {}
    return _parse(match.get("completed_at")) or _parse(meta.get("confirmed_at")) or _parse(match.get("admin_decision_at"))


def winner_ids(match: dict) -> set[str]:
    return {row.get("registration_id") for row in match.get("results") or [] if row.get("registration_id") and int(row.get("rank") or 0) == 1}


async def winner_next_matches(db, match: dict) -> list[dict]:
    """Die Spiele, in die der Sieger aus diesem Spiel weitergerückt ist."""
    winners = winner_ids(match)
    if not winners or not match.get("id"):
        return []
    candidates = await db.matches_v2.find(
        {"tournament_id": match.get("tournament_id"), "slots.source_result.from_match_id": match["id"]},
        {"_id": 0, "id": 1, "status": 1, "started_at": 1, "scheduled_at": 1, "slots": 1},
    ).to_list(20)
    return [
        candidate for candidate in candidates
        if any(
            (slot.get("source_result") or {}).get("from_match_id") == match["id"] and slot.get("registration_id") in winners
            for slot in candidate.get("slots") or []
        )
    ]


async def dispute_window(db, match: dict, now: datetime | None = None) -> dict:
    """Ist ein Dispute möglich - und bis wann? ``until`` ist leer, solange es kein Ergebnis gibt."""
    now = now or now_utc()
    status = str(match.get("status") or "")
    if status in CLOSED_STATUSES:
        return {"open": False, "until": None}
    if status not in DECIDED_STATUSES:
        return {"open": True, "until": None}
    decided = decided_at(match)
    if not decided:
        return {"open": False, "until": None}
    until = decided + timedelta(minutes=DISPUTE_WINDOW_MINUTES)
    for upcoming in await winner_next_matches(db, match):
        start = _parse(upcoming.get("scheduled_at"))
        if str(upcoming.get("status") or "") in STARTED_STATUSES or upcoming.get("started_at") or (start and start <= now):
            return {"open": False, "until": None}
        if start and start < until:
            until = start
    return {"open": now < until, "until": until.isoformat() if now < until else None}
