"""Ruhezeit (#1206) ohne Datenbank: Zeiten lesen, das Fenster in Wiener Zeit und die Ausnahmen als Text.

Ein Blatt-Modul (nur Standardbibliothek): Profil-Modell, Einstellungen und Versand (``services/quiet_hours.py``) lesen
dieselben Regeln, ohne einander zu importieren.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

VIENNA = ZoneInfo("Europe/Vienna")
SUGGESTED_START = "22:00"
SUGGESTED_END = "07:00"

EXEMPT_KINDS = frozenset({"match_call", "match_station"})
ACTIVE_TOURNAMENT_STATUSES = frozenset({"check_in", "live", "paused"})
EXEMPTION_TEXTS = (
    "Aufruf zu deinem Spiel und „Match startet jetzt“",
    "Liga: Check-in offen und Veto – ihr seid am Zug, für dein eigenes Spiel",
    "Für die Turnierleitung: „Braucht Aufmerksamkeit“, solange dein Turnier läuft",
)


def parse_time(value: Any) -> int | None:
    """``"HH:MM"`` als Minuten nach Mitternacht - sonst ``None``. Ohne Regex: zwei Zahlen und ein Doppelpunkt."""
    text = str(value or "").strip()
    hours, sep, minutes = text.partition(":")
    if not sep or len(hours) != 2 or len(minutes) != 2 or not hours.isdigit() or not minutes.isdigit():
        return None
    h, m = int(hours), int(minutes)
    if h > 23 or m > 59:
        return None
    return h * 60 + m


def _raw(user: dict | None) -> dict:
    value = (user or {}).get("quiet_hours")
    return value if isinstance(value, dict) else {}


def settings_payload(user: dict | None) -> dict[str, Any]:
    """Für die Einstellungen: an oder aus, von, bis - ohne gespeicherten Wert der Vorschlag 22:00 bis 7:00."""
    raw = _raw(user)
    start = raw.get("start") if parse_time(raw.get("start")) is not None else SUGGESTED_START
    end = raw.get("end") if parse_time(raw.get("end")) is not None else SUGGESTED_END
    return {"enabled": bool(raw.get("enabled")), "start": start, "end": end}


def window(user: dict | None) -> tuple[int, int] | None:
    """Beginn und Ende in Minuten, wenn die Ruhezeit an ist - gleiche Zeiten heißen: keine Ruhezeit."""
    raw = _raw(user)
    if not raw.get("enabled"):
        return None
    start, end = parse_time(raw.get("start")), parse_time(raw.get("end"))
    if start is None or end is None or start == end:
        return None
    return start, end


def crosses_midnight(user: dict | None) -> bool:
    found = window(user)
    return bool(found and found[0] > found[1])


def quiet_until(user: dict | None, now: datetime | None = None) -> datetime | None:
    """Liegt ``now`` in der Ruhezeit, das Ende dieser Ruhezeit (UTC) - sonst ``None``.

    Gerechnet wird in Wiener Wanduhrzeit: 22:00 bis 7:00 bleibt 22:00 bis 7:00, auch in der Nacht der Zeitumstellung."""
    found = window(user)
    if not found:
        return None
    start, end = found
    local = (now or datetime.now(timezone.utc)).astimezone(VIENNA)
    minute = local.hour * 60 + local.minute
    day = local.date()
    if start < end:
        if not (start <= minute < end):
            return None
    else:
        if not (minute >= start or minute < end):
            return None
        if minute >= start:
            day = day + timedelta(days=1)
    end_local = datetime(day.year, day.month, day.day, end // 60, end % 60, tzinfo=VIENNA)
    return end_local.astimezone(timezone.utc)
