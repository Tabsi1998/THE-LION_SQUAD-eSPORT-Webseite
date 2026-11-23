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


def _inside(minute: int, start: int, end: int) -> bool:
    return start <= minute < end if start < end else (minute >= start or minute < end)


def _wall_minute(moment: datetime) -> int:
    local = moment.astimezone(VIENNA)
    return local.hour * 60 + local.minute


def _offset(moment: datetime) -> timedelta:
    """Wiener Uhr minus UTC für einen UTC-Zeitpunkt - aus der Wanduhr gerechnet, nicht über ``utcoffset()``: Das hinge in der
    doppelten Stunde an ``fold``, und das verliert die Ersatzuhr der Zeitreise-Probe (#2474)."""
    return moment.astimezone(VIENNA).replace(tzinfo=None) - moment.replace(tzinfo=None)


def _clock_change(after: datetime, before: datetime) -> datetime | None:
    """Der Moment (UTC), in dem die Wiener Uhr zwischen ``after`` und ``before`` umgestellt wird - ``None`` ohne Umstellung.

    Beide liegen auf vollen Minuten und weniger als einen Tag auseinander, also höchstens eine Umstellung: minutengenau durch
    Halbieren gesucht."""
    offset = _offset(after)
    if _offset(before) == offset:
        return None
    low, high = 0, (before - after) // timedelta(minutes=1)
    while high - low > 1:
        middle = (low + high) // 2
        if _offset(after + timedelta(minutes=middle)) == offset:
            low = middle
        else:
            high = middle
    return after + timedelta(minutes=high)


def quiet_until(user: dict | None, now: datetime | None = None) -> datetime | None:
    """Liegt ``now`` in der Ruhezeit, das Ende dieser Ruhezeit (UTC) - sonst ``None``.

    Gerechnet wird in Wiener Wanduhrzeit: 22:00 bis 7:00 bleibt 22:00 bis 7:00, auch in der Nacht der Zeitumstellung. Liegt
    das Ende in der Lücke der Vorstellung, endet die Ruhezeit mit der Lücke; springt die Uhr bei der Rückstellung vor den
    Beginn zurück, endet sie mit dem Sprung (#2514)."""
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
    if not _inside(minute, start, end):
        return None
    if start > end and minute >= start:
        day = day + timedelta(days=1)
    # In der Nacht der Rückstellung gibt es 02:00–02:59 zweimal: das erste Ende, das noch vor uns liegt (fold 0, dann 1).
    for fold in (0, 1):
        until = datetime(day.year, day.month, day.day, end // 60, end % 60, tzinfo=VIENNA, fold=fold).astimezone(timezone.utc)
        if until > moment:
            break
    else:
        return None
    # Eine Umstellung bis dahin beendet die Ruhezeit, wenn das Ende in ihrer Lücke liegt (00:00–02:30 im März: 03:00 statt
    # 03:30 MESZ) oder die Uhr danach außerhalb des Fensters steht (ab 02:30 im Oktober: 02:59 MESZ springt auf 02:00 MEZ).
    # Gesucht ab der vollen Minute (Umstellungen liegen auf vollen Minuten); ``_offset`` braucht dafür kein ``fold``.
    whole_minute = datetime(moment.year, moment.month, moment.day, moment.hour, moment.minute, tzinfo=timezone.utc)
    switch = _clock_change(whole_minute, until)
    if switch is not None and (_wall_minute(until) != end or not _inside(_wall_minute(switch), start, end)):
        return switch
    return until
