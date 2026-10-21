"""Prüfung beim Speichern einer Referenz (#1755) - ohne Datenbank.

Tippfehler wie ein Enddatum zwei Jahre nach dem Start sollen beim Speichern auffallen. Die Prüfung meldet nur
**Warnungen**, nie einen Fehler: gespeichert wird trotzdem. Jede Warnung nennt das Feld (``end_date``,
``entries.<n>.placement`` bzw. bei alten Referenzen ohne Einträge ``placement``), einen festen Code und eine Meldung in
Klartext:

- ``end_before_start``: Ende liegt vor dem Start.
- ``too_long``: Ende liegt mehr als ``max_duration_days`` (Vorgabe 365) nach dem Start.
- ``end_in_future``: eine abgeschlossene Teilnahme endet erst nach dem heutigen Wiener Tag (abschaltbar).
- ``placement_above_count``: Platz größer als das Feld des Eintrags - bei einem Team die Zahl der Teams, bei einem
  Einzelstarter die Zahl der Teilnehmer; ist nur eine der beiden bekannt, gilt diese.

Die Grenzen liegen in ``settings`` (``id: reference_checks``) und kommen über ``normalize_settings`` mit Vorgabe.
"""
from __future__ import annotations

from datetime import date

SETTINGS_ID = "reference_checks"
DEFAULT_SETTINGS = {"max_duration_days": 365, "warn_future_end": True}
MAX_DURATION_LIMIT = 3650


def normalize_settings(raw: dict | None) -> dict:
    raw = raw or {}
    try:
        days = int(raw.get("max_duration_days"))
    except (TypeError, ValueError):
        days = 0
    if not 1 <= days <= MAX_DURATION_LIMIT:
        days = DEFAULT_SETTINGS["max_duration_days"]
    future = raw.get("warn_future_end")
    return {"max_duration_days": days,
            "warn_future_end": DEFAULT_SETTINGS["warn_future_end"] if future is None else bool(future)}


def _day(value) -> date | None:
    text = str(value or "").strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _number(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 1 else None


def _german(day: date) -> str:
    return day.strftime("%d.%m.%Y")


def _date_warnings(doc: dict, today: date | None, settings: dict) -> list[dict]:
    start, end = _day(doc.get("start_date")), _day(doc.get("end_date"))
    out = []
    if start and end and end < start:
        out.append({"field": "end_date", "code": "end_before_start",
                    "message": f"Das Ende ({_german(end)}) liegt vor dem Start ({_german(start)})."})
    elif start and end and (end - start).days > settings["max_duration_days"]:
        out.append({"field": "end_date", "code": "too_long",
                    "message": f"Das Ende liegt {(end - start).days} Tage nach dem Start - mehr als "
                               f"{settings['max_duration_days']} Tage. Tippfehler beim Jahr?"})
    finished = (doc.get("status") or "completed") == "completed"
    if finished and settings["warn_future_end"] and end and today and end > today:
        out.append({"field": "end_date", "code": "end_in_future",
                    "message": f"Die Teilnahme ist abgeschlossen, das Ende ({_german(end)}) liegt aber in der "
                               "Zukunft."})
    return out


def _field_size(entry: dict) -> tuple[int, str] | None:
    """Das Feld, gegen das der Platz zählt: bei einem Team die Teams, sonst die Teilnehmer; fehlt die passende Zahl,
    gilt die andere. Alte Referenzen ohne Art zählen wie die Anzeige zuerst die Teilnehmer."""
    people = _number(entry.get("participant_count"))
    teams = _number(entry.get("team_count"))
    first, second = ((teams, "Teams"), (people, "Teilnehmer")) if entry.get("kind") == "team" else (
        (people, "Teilnehmer"), (teams, "Teams"))
    return first if first[0] else (second if second[0] else None)


def _placement_warning(entry: dict, field: str) -> dict | None:
    place = _number(entry.get("placement"))
    size = _field_size(entry)
    if not place or not size or place <= size[0]:
        return None
    return {"field": field, "code": "placement_above_count",
            "message": f"Platz {place} ist größer als die Zahl der {size[1]} ({size[0]})."}


def check_reference(doc: dict, today: str | None, settings: dict | None = None) -> list[dict]:
    """Warnungen für eine Referenz (gespeichert oder aus dem Formular). ``today`` ist der Wiener Tag (JJJJ-MM-TT)."""
    rules = normalize_settings(settings)
    out = _date_warnings(doc or {}, _day(today), rules)
    entries = (doc or {}).get("entries")
    if isinstance(entries, list) and entries:
        for index, entry in enumerate(entries):
            warning = _placement_warning(entry if isinstance(entry, dict) else {}, f"entries.{index}.placement")
            if warning:
                out.append(warning)
    else:
        warning = _placement_warning(doc or {}, "placement")
        if warning:
            out.append(warning)
    return out
