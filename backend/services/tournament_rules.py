"""Turnier-Regeln an einer Stelle: Austragung, Ergebniserfassung, Terminplanung und Check-in (#1132, #1135).

Ohne eigene Angabe gilt (Entscheidung des Betreibers vom 07.10.2026, Variante B):

- vor Ort: die Turnierleitung und die Station-Crew tragen die Ergebnisse ein und legen die Termine fest,
- online und hybrid: die Spieler melden ihr Ergebnis selbst, die Gegenseite bestätigt; Termine werden abgestimmt.

Dieselbe Regel rechnen die Admin-Anzeige (frontend/src/lib/tournamentRulePresets.js → effectiveRuleModes), die
Planungs-Warnung (routes/tournament_common._planning_report) und der Server bei jeder Meldung (routes/match_routes).
Eine Angabe am Spiel geht vor der an der Phase, die vor der am Turnier.

Check-in (#1135): Vor Ort checkt die Turnierleitung ein - Knopf, Startseite, Erinnerungen, Mail und Discord fragen
alle ``self_checkin_allowed``.
"""
from __future__ import annotations

EVENT_MODES = {"local", "online", "hybrid"}
RESULT_ENTRY_MODES = {"staff_only", "player_confirmed", "hybrid"}
SCHEDULE_MODES = {"fixed_by_staff", "player_proposal", "hybrid"}


def _mode_value(value: object, allowed: set[str]) -> str | None:
    text = str(value or "").strip().lower()
    return text if text in allowed else None


def _first_mode(allowed: set[str], *values: object) -> str | None:
    for value in values:
        normalized = _mode_value(value, allowed)
        if normalized:
            return normalized
    return None


def _settings(doc: dict | None) -> dict:
    settings = (doc or {}).get("settings")
    return settings if isinstance(settings, dict) else {}


def legacy_event_mode(tournament: dict | None) -> str | None:
    """Ältere Turniere kannten nur die Schalter „online“ und „hybrid“."""
    if (tournament or {}).get("is_hybrid") is True:
        return "hybrid"
    if (tournament or {}).get("is_online") is True:
        return "online"
    return None


def default_result_entry_mode(event_mode: str) -> str:
    return "staff_only" if event_mode == "local" else "player_confirmed"


def default_schedule_mode(event_mode: str) -> str:
    return "fixed_by_staff" if event_mode == "local" else "player_proposal"


def tournament_event_mode(tournament: dict | None) -> str:
    return _first_mode(EVENT_MODES, (tournament or {}).get("event_mode"), legacy_event_mode(tournament)) or "online"


def tournament_modes(tournament: dict | None) -> dict:
    """Die geltenden Regeln eines Turniers - ohne Phase und Spiel (Admin-Liste, Planungs-Warnung)."""
    event_mode = tournament_event_mode(tournament)
    return {
        "event_mode": event_mode,
        "result_entry_mode": _first_mode(RESULT_ENTRY_MODES, (tournament or {}).get("result_entry_mode"))
        or default_result_entry_mode(event_mode),
        "schedule_mode": _first_mode(SCHEDULE_MODES, (tournament or {}).get("schedule_mode"))
        or default_schedule_mode(event_mode),
    }


def match_policy(match: dict | None, tournament: dict | None = None, stage: dict | None = None) -> dict:
    """Die Regeln für ein Spiel: Spiel vor Phase vor Turnier, ohne Angabe die Regel oben."""
    match = match or {}
    match_settings = _settings(match)
    stage_settings = _settings(stage)
    event_mode = _first_mode(
        EVENT_MODES,
        match.get("event_mode"),
        match_settings.get("event_mode"),
        stage_settings.get("event_mode"),
        (stage or {}).get("event_mode"),
        (tournament or {}).get("event_mode"),
        legacy_event_mode(tournament),
    ) or "online"
    result_entry_mode = _first_mode(
        RESULT_ENTRY_MODES,
        match.get("result_entry_mode"),
        match_settings.get("result_entry_mode"),
        stage_settings.get("result_entry_mode"),
        (stage or {}).get("result_entry_mode"),
        (tournament or {}).get("result_entry_mode"),
    ) or default_result_entry_mode(event_mode)
    schedule_mode = _first_mode(
        SCHEDULE_MODES,
        match.get("schedule_mode"),
        match_settings.get("schedule_mode"),
        stage_settings.get("schedule_mode"),
        (stage or {}).get("schedule_mode"),
        (tournament or {}).get("schedule_mode"),
    ) or default_schedule_mode(event_mode)
    return {
        "event_mode": event_mode,
        "result_entry_mode": result_entry_mode,
        "schedule_mode": schedule_mode,
    }


def players_can_report(policy: dict) -> bool:
    return policy.get("result_entry_mode") in {"player_confirmed", "hybrid"}


def schedule_proposals_enabled(policy: dict) -> bool:
    return policy.get("schedule_mode") in {"player_proposal", "hybrid"}


def self_checkin_allowed(tournament: dict | None) -> bool:
    """Checken Spieler selbst ein? Vor Ort nicht - dort macht es die Turnierleitung (#1135)."""
    return tournament_event_mode(tournament) != "local"


def uses_actual_start_notifications(tournament: dict | None) -> bool:
    """Vor Ort mit festen Zeiten gibt es keine Erinnerung vorher: der Aufruf beim Reservieren der Station und
    „Match startet jetzt“ beim Start sagen, wann es losgeht (Entscheidung zu #1137)."""
    modes = tournament_modes(tournament)
    return modes["event_mode"] == "local" and modes["schedule_mode"] == "fixed_by_staff"
