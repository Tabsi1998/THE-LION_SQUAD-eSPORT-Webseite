"""Wann ist ein Spiel offen, wie lange läuft es, wann fehlt sein Ergebnis? (#1156, #1160)

Gemeinsame Grundlage für die Ansicht „Turnierleitung“ (``match_lead``) und „Braucht Aufmerksamkeit“
(``match_attention``) - hier, damit sich die beiden nicht gegenseitig importieren.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.match_duration import DEFAULT_MATCH_DURATION_MINUTES, effective_match_duration

# Spiele, für die ein Ergebnis eingetragen werden kann - sobald beide Seiten feststehen.
OPEN_STATUSES = {"pending", "ready", "scheduled", "in_progress", "running", "waiting_result", "disputed"}
RUNNING_STATUSES = {"in_progress", "running", "waiting_result"}
# „Ergebnis fehlt“: geplante Zeit plus Dauer plus diese Minuten vorbei (#1160).
MISSING_AFTER_MINUTES = 5
DEFAULT_DURATION_MINUTES = DEFAULT_MATCH_DURATION_MINUTES


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def as_int(value, fallback: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def filled_slots(match: dict) -> list[dict]:
    return sorted(
        [slot for slot in match.get("slots") or [] if slot.get("registration_id")],
        key=lambda slot: as_int(slot.get("slot"), 999),
    )


def registration_name(registration: dict | None) -> str:
    return (registration or {}).get("display_name") or (registration or {}).get("ingame_name") or (registration or {}).get("team_name") or "Teilnehmer"


def duration_minutes(match: dict, tournament: dict | None, stage: dict | None = None) -> int:
    return effective_match_duration(match, stage=stage, tournament=tournament)


def timing(match: dict, tournament: dict | None, now: datetime) -> dict:
    """Wie lange läuft das Spiel, und wie weit ist es über der Zeit? Ohne geplante Zeit (und ohne Start an einer
    Station) gibt es kein „Ergebnis fehlt“ (#1160)."""
    started = _parse(match.get("started_at"))
    base = _parse(match.get("scheduled_at")) or (started if match.get("station_id") else None)
    out: dict = {"running_minutes": None, "overdue_minutes": None, "missing": False, "due_at": None}
    if started and str(match.get("status") or "") in RUNNING_STATUSES | {"scheduled", "ready"}:
        out["running_minutes"] = max(0, int((now - started).total_seconds() // 60))
    if base:
        planned_end = base + timedelta(minutes=duration_minutes(match, tournament))
        due = planned_end + timedelta(minutes=MISSING_AFTER_MINUTES)
        out["due_at"] = due.isoformat()
        if now > planned_end:
            out["overdue_minutes"] = int((now - planned_end).total_seconds() // 60)
        out["missing"] = now >= due
    return out
