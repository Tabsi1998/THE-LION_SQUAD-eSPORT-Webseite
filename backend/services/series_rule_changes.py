"""Regeländerungen einer Saison für die Serienseite (#1960) - ohne Datenbank.

Zwei Quellen, beide schon vorhanden und hier nur zusammengetragen:

- **Ab Runde X** (Ablauf je Runde, #1930, ``series.weekend.formats``): jeder Abschnitt ab Runde 2 ist eine Änderung mit
  seinen Runden („R5–R8“), dem Tag des ersten Termins dieser Runde (sobald er im Kalender steht), seinen Läufen und dem
  Hinweis aus der Verwaltung („Ab R5 kein Qualifying, Start in umgekehrter WM-Reihenfolge“).
- **Regeln der Saison** (``rules_version``, ``rules_history``): jede Version ab 2 mit Hinweis, und dem Tag, an dem sie
  galt (der Tag der Änderung, Wiener Tag). Ohne Hinweis bleibt eine Version stumm - sie steht nur im Protokoll.
"""
from __future__ import annotations

from services.reference_calendar import club_day_of
from services.round_phases import phase_ranges


def _format_changes(series: dict, rounds: list[dict]) -> list[dict]:
    formats = (series.get("weekend") or {}).get("formats") or []
    first_day: dict[int, str | None] = {}
    for rnd in rounds:
        number = rnd.get("weekend")
        if number and number not in first_day and rnd.get("club_day"):
            first_day[number] = rnd.get("club_day")
    out = []
    for phase, (start, end) in zip(formats, phase_ranges(formats)):
        if start <= 1:
            continue
        out.append({"kind": "format", "from_round": start, "to_round": end, "day": first_day.get(start),
                    "note": phase.get("note") or None,
                    "sessions": [session.get("label") for session in phase.get("sessions") or []]})
    return out


def _rules_changes(series: dict) -> list[dict]:
    history = [entry for entry in series.get("rules_history") or [] if isinstance(entry, dict)]
    replaced = {entry.get("version"): entry.get("replaced_at") for entry in history}
    versions = [(entry.get("version"), entry.get("note")) for entry in history]
    versions.append((series.get("rules_version") or 1, series.get("rules_note")))
    out = []
    for version, note in versions:
        if not isinstance(version, int) or version < 2 or not note:
            continue
        changed_at = replaced.get(version - 1) if version - 1 in replaced else None
        if version == (series.get("rules_version") or 1):
            changed_at = series.get("rules_changed_at") or changed_at
        out.append({"kind": "rules", "version": version, "day": club_day_of(changed_at) if changed_at else None,
                    "note": note})
    return out


def rule_changes(series: dict, rounds: list[dict]) -> list[dict]:
    """Alle Regeländerungen der Saison: zuerst „ab Runde X“ nach Runde, dann die Regeln nach Version. ``rounds``: der
    Kalender mit ``weekend`` (Runde) je Termin in Kalender-Reihenfolge."""
    return [*_format_changes(series, rounds), *_rules_changes(series)]
