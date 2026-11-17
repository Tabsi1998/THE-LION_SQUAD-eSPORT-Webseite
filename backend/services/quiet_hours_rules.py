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
# So lange muss zwischen Ende und nächstem Beginn mindestens Zeit sein (07:05–07:00 wäre fast immer still).
MIN_GAP_MINUTES = 15

# ``admin_push_test``: der Push-Test der Verwaltung (Admin → System → Push-Tests) soll auch nachts zeigen, ob Push ankommt.
EXEMPT_KINDS = frozenset({"match_call", "match_station", "admin_push_test"})
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
    if not sep or len(hours) != 2 or len(minutes) != 2 or not text.isascii() or not hours.isdigit() or not minutes.isdigit():
        return None
    h, m = int(hours), int(minutes)
    if h > 23 or m > 59:
        return None
    return h * 60 + m


def _raw(user: dict | None) -> dict:
    value = (user or {}).get("quiet_hours")
    return value if isinstance(value, dict) else {}


def effective(user: dict | None) -> dict[str, Any]:
    """Der Stand, der gilt - für Anzeige und Wirkung gleich: an oder aus, von, bis; fehlt eine Zeit oder ist sie ungültig, gilt
    der Vorschlag 22:00 bis 7:00."""
    raw = _raw(user)
    start = raw.get("start") if parse_time(raw.get("start")) is not None else SUGGESTED_START
    end = raw.get("end") if parse_time(raw.get("end")) is not None else SUGGESTED_END
    return {"enabled": bool(raw.get("enabled")), "start": start, "end": end}


def settings_payload(user: dict | None) -> dict[str, Any]:
    """Für die Einstellungen - derselbe Stand wie ``effective``."""
    return effective(user)


def gap_minutes(start: int, end: int) -> int:
    """Wie lange zwischen Ende und nächstem Beginn keine Ruhezeit ist."""
    return (start - end) % (24 * 60)


def gap_problem(start: Any, end: Any) -> str | None:
    """Warum ``start``–``end`` keine Ruhezeit sein kann - ``None``: passt. Ohne Lücke von ``MIN_GAP_MINUTES`` käme nie etwas."""
    first, last = parse_time(start), parse_time(end)
    if first is None or last is None:
        return "Bitte eine Uhrzeit wie 22:00 angeben."
    if gap_minutes(first, last) < MIN_GAP_MINUTES:
        return f"Zwischen Ende und Beginn der Ruhezeit müssen mindestens {MIN_GAP_MINUTES} Minuten liegen."
    return None


def window(user: dict | None) -> tuple[int, int] | None:
    """Beginn und Ende in Minuten, wenn die Ruhezeit an ist - mit derselben Rückfallregel wie die Anzeige."""
    current = effective(user)
    if not current["enabled"] or gap_problem(current["start"], current["end"]):
        return None
    return parse_time(current["start"]), parse_time(current["end"])


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
    # Der Vergleichszeitpunkt bleibt die UTC-Zeit selbst: aus der Wiener Zeit zurückgerechnet hinge er an ``fold`` - und
    # das geht etwa beim Umwandeln in eine Unterklasse von ``datetime`` verloren (02:15 MEZ würde zu 02:15 MESZ).
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    local = moment.astimezone(VIENNA)
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
    # In der Nacht der Rückstellung gibt es 02:00–02:59 zweimal: das erste Ende, das noch vor uns liegt (fold 0, dann 1).
    for fold in (0, 1):
        until = datetime(day.year, day.month, day.day, end // 60, end % 60, tzinfo=VIENNA, fold=fold).astimezone(timezone.utc)
        if until > moment:
            return until
    return None
