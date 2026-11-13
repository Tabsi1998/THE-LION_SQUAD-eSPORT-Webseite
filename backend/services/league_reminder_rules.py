"""Erinnerungen je Season (docs/LIGA.md, „E.5 Benachrichtigungen und Erinnerungen“, #1647).

Blatt-Modul ohne Datenbank. Das Feld ``reminder_rules`` steht an ``league_seasons`` und an der Staffel (``tournaments``); zur Laufzeit
zählt die Staffel, ohne Feld die Vorgabe aus ``league_presets.PRESETS`` - so erinnern auch ältere Staffeln wie bisher („Ergebnis
fehlt“, „Map-Veto wartet“ mit 20 s / 5 s). Übertragen wird in der Gruppe ``reminders`` von ``league_service.SYNC_GROUPS``, gespeichert
über ``…/seasons/{id}/reminder-rules`` (gilt sofort für alle nicht gesperrten Staffeln).

- ``upcoming``: Spiel steht an - ``upcoming_early_hours`` und ``upcoming_late_minutes`` vor dem Termin.
- ``unscheduled``: Termin noch offen - bei ``unscheduled_week_percent`` der Spielwoche (50 = Wochenmitte) an die Captains, spätestens
  ``unscheduled_hours_before_default`` Stunden vor dem Standardtermin (liegt er früher in der Woche).
- ``result_missing``: Ergebnis fehlt - der Zeitpunkt steht in den Terminregeln (``result_reminder_hours``).
- ``veto_turn``: Map-Veto wartet - nach ``veto_idle_seconds`` ohne Zug, nie in den letzten ``veto_min_left_seconds``.
- ``discord``: zusätzlich als Direktnachricht vom Bot an alle, die Discord in ihren Einstellungen eingeschaltet haben.
"""
from __future__ import annotations

import copy

from services.league_presets import PRESETS

FIELD = "reminder_rules"
DEFAULTS: dict = PRESETS[FIELD]
FLAGS = ("upcoming", "unscheduled", "result_missing", "veto_turn", "discord")
# Feld → (kleinster, größter Wert, Bezeichnung für die Meldung)
NUMBERS: dict[str, tuple[int, int, str]] = {
    "upcoming_early_hours": (2, 72, "Die erste Erinnerung vor dem Spiel (Stunden)"),
    "upcoming_late_minutes": (30, 720, "Die zweite Erinnerung vor dem Spiel (Minuten)"),
    "unscheduled_week_percent": (10, 90, "Der Zeitpunkt „Termin offen“ in der Spielwoche"),
    "unscheduled_hours_before_default": (1, 168, "„Termin offen“ spätestens vor dem Standardtermin (Stunden)"),
    "veto_idle_seconds": (5, 300, "„Map-Veto wartet“ nach Sekunden ohne Zug"),
    "veto_min_left_seconds": (0, 120, "„Map-Veto wartet“ nicht mehr in den letzten Sekunden"),
}
# Der Job holt eine verpasste Erinnerung so lange nach (ein Neustart, ein langsamer Lauf) - danach ist sie vorbei.
CATCH_UP_MINUTES = 30


class ReminderProblem(Exception):
    def __init__(self, detail: str, status_code: int = 422):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def defaults() -> dict:
    return copy.deepcopy(DEFAULTS)


def normalize(raw) -> dict:
    """Die Regeln aus einer Eingabe der Verwaltung - fehlende Felder mit Vorgabe, Falsches mit deutscher Meldung (422)."""
    if not isinstance(raw, dict):
        raise ReminderProblem("Die Erinnerungen fehlen.")
    if set(raw) - set(DEFAULTS):
        raise ReminderProblem("Die Erinnerungen enthalten ein unbekanntes Feld.")
    out = defaults()
    for key in FLAGS:
        value = raw.get(key)
        if value is None:
            continue
        if not isinstance(value, bool):
            raise ReminderProblem("Ein Schalter der Erinnerungen ist weder an noch aus.")
        out[key] = value
    for key, (low, high, label) in NUMBERS.items():
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            raise ReminderProblem(f"{label} muss eine ganze Zahl von {low} bis {high} sein.")
        out[key] = value
    # Die zwei Erinnerungen vor dem Spiel dürfen sich nicht überholen - mit dem Nachholfenster dazwischen.
    if out["upcoming_early_hours"] * 60 < out["upcoming_late_minutes"] + 2 * CATCH_UP_MINUTES:
        raise ReminderProblem("Die erste Erinnerung vor dem Spiel muss mindestens eine Stunde vor der zweiten liegen.")
    return out


def stored(source: dict | None) -> dict | None:
    """Was an Season oder Staffel wirklich steht (geprüft) - ``None`` ohne Feld (ältere Season)."""
    raw = (source or {}).get(FIELD)
    if not isinstance(raw, dict):
        return None
    try:
        return normalize({key: value for key, value in raw.items() if key in DEFAULTS})
    except ReminderProblem:
        # Ein von Hand verbogener Wert sperrt nichts - es gelten die Vorgaben.
        return defaults()


def rules_of(tournament: dict | None) -> dict | None:
    """Die geltenden Regeln einer Liga-Staffel - ohne Feld die Vorgabe; ``None`` für alle anderen Turniere."""
    if not isinstance((tournament or {}).get("league_context"), dict):
        return None
    return stored(tournament) or defaults()


def lead_text(minutes: int) -> str:
    """„24 Stunden“, „1 Stunde“, „45 Minuten“."""
    if minutes % 60 == 0:
        hours = minutes // 60
        return "1 Stunde" if hours == 1 else f"{hours} Stunden"
    return f"{minutes} Minuten"


def notice_meta(rules: dict | None, kind: str) -> dict:
    """Was jede Liga-Erinnerung an ``create_user_notification`` mitgibt: die Art (``league_reminder``), den eindeutigen Schlüssel
    (``unique_dedupe``: der Teilindex ``user_unique_dedupe`` hält einen doppelten Joblauf auf) und Discord nur, wenn die Season es will."""
    return {"league_reminder": kind, "unique_dedupe": True, "no_discord": not bool((rules or DEFAULTS).get("discord"))}
