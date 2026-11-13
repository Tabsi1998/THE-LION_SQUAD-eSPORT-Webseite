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


# ---------------------------------------------------------------- Turnierpause (#1167, services/match_pause.py)

def whole_seconds(value) -> int:
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
    total = whole_seconds(match.get("paused_seconds"))
    paused_at = (tournament or {}).get("paused_at")
    if paused_at and is_clock_running(match):
        total += overlap_seconds(match, paused_at, now)
    return total


def duration_minutes(match: dict, tournament: dict | None, stage: dict | None = None, game: dict | None = None) -> int:
    return effective_match_duration(match, stage=stage, tournament=tournament, game=game)


def timing(match: dict, tournament: dict | None, now: datetime, *, stage: dict | None = None, game: dict | None = None) -> dict:
    """Wie lange läuft das Spiel, und wie weit ist es über der Zeit? Ohne geplante Zeit (und ohne Start an einer
    Station) gibt es kein „Ergebnis fehlt“ (#1160).

    Live vor Ort (#1556): Gezählt wird ab dem echten Start. Ein Spiel, das an seiner Station noch wartet, hat Verzug
    (den zeigt die Warteschlange), aber kein fehlendes Ergebnis.

    Turnierpause (#1167): Pausen zählen nicht als Spielzeit - weder bei „läuft N Min.“ noch bei „über der Zeit“; solange
    die Pause läuft, wird kein Ergebnis fällig."""
    started = _parse(match.get("started_at"))
    paused = timedelta(seconds=pause_seconds(match, tournament, now)) if started else timedelta(0)
    if started:
        base = started
    elif match.get("station_id"):
        base = None
    else:
        base = _parse(match.get("scheduled_at"))
    out: dict = {"running_minutes": None, "overdue_minutes": None, "missing": False, "due_at": None, "duration_minutes": None}
    if started and str(match.get("status") or "") in RUNNING_STATUSES | {"scheduled", "ready"}:
        out["running_minutes"] = max(0, int((now - started - paused).total_seconds() // 60))
    if base:
        minutes = duration_minutes(match, tournament, stage, game)
        # Die Dauer, mit der gerechnet wird (#1167): die Spielzeit-Uhr der Leitung zeigt „12:06 / 20 Min.“ damit.
        out["duration_minutes"] = minutes
        planned_end = base + timedelta(minutes=minutes) + paused
        due = planned_end + timedelta(minutes=MISSING_AFTER_MINUTES)
        out["due_at"] = due.isoformat()
        if now > planned_end:
            out["overdue_minutes"] = int((now - planned_end).total_seconds() // 60)
        out["missing"] = now >= due
    return out
