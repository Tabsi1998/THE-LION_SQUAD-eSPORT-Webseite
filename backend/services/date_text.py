"""Ein Datumsformat für Mails, Discord, Teilen-Bilder und Kalender-Texte (#1307).

Dieselbe Regel wie die Website (``frontend/src/lib/datetime.js``) und die App, geprüft mit denselben Fällen
(``docs/date-cases.json``):

- ``format_when``: „Sa 23. Mai · 18:00“ - Wochentag kurz, Monat ausgeschrieben („Jänner“ wie in Österreich), das
  Jahr nur, wenn es nicht das laufende ist. Nahes heißt „heute 18:00“ und „morgen 18:00“. ``relative=False`` lässt
  „heute“ und „morgen“ weg - für Sätze wie „Gesendet am Mi 20. Mai · 18:00“.
- ``format_range``: Zeiträume nach Wiener Tagen, „Fr 19. – Sa 20. Juni“, „Mo 30. November – Mi 2. Dezember“.
- ``format_ago``: Vergangenes in Listen, „gerade eben“, „vor 12 Min.“, „vor 3 Std.“, „gestern“, danach der Tag.
- ``format_clock``: nur die Uhrzeit, „18:00“.
- ``format_official_date``: das amtliche „23.05.2026“ - allein für Rechnungen, Urkunden und PDF-Listen.

Gerechnet wird in Wiener Zeit. Werte kommen, wie sie kommen: ein ``datetime`` mit Zone so, wie er ist, ohne Zone als
UTC (so liefert die Datenbank); ein Text mit Zone so, wie er dasteht, ohne Zone als Wiener Uhr (so trägt der Verein
ein, wie auf der Website); ein reiner Tag (``date`` oder „2026-05-23“) bleibt dieser Tag und hat keine Uhrzeit.
Andere Datumsformen schreibt der Server nicht selbst - das prüft ``tests/test_date_text_inventory_unit.py``.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from models import now_utc

VIENNA = ZoneInfo("Europe/Vienna")
WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")
MONTHS = ("Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November",
          "Dezember")
_PURE_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_WALL_CLOCK = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$")


def is_pure_day(value) -> bool:
    """Ein Kalendertag ohne Uhrzeit: ``date`` (nicht ``datetime``) oder Text „JJJJ-MM-TT“."""
    if isinstance(value, datetime):
        return False
    if isinstance(value, date):
        return True
    return isinstance(value, str) and bool(_PURE_DAY.match(value.strip()))


def as_vienna(value) -> datetime | None:
    """Ein Wert als Zeitpunkt in Wiener Zeit - ``None`` ohne gültigen Wert."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return moment.astimezone(VIENNA)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, 12, tzinfo=VIENNA)
    if not isinstance(value, str):
        return None
    text = value.strip()
    try:
        if _PURE_DAY.match(text):
            day = date.fromisoformat(text)
            return datetime(day.year, day.month, day.day, 12, tzinfo=VIENNA)
        if _WALL_CLOCK.match(text):
            return datetime.fromisoformat(text.replace(" ", "T")).replace(tzinfo=VIENNA)
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).astimezone(VIENNA)


def vienna_day(value) -> date | None:
    """Der Kalendertag in Wien."""
    local = as_vienna(value)
    return local.date() if local else None


def _today(now) -> date:
    return vienna_day(now if now is not None else now_utc())


def _day_text(day: date, *, with_month: bool = True, with_year: bool = False) -> str:
    text = f"{WEEKDAYS[day.weekday()]} {day.day}."
    if with_month:
        text += f" {MONTHS[day.month - 1]}"
        if with_year:
            text += f" {day.year}"
    return text


def format_clock(value) -> str:
    """Nur die Uhrzeit in Wien: „18:00“. Leer ohne gültigen Wert."""
    local = as_vienna(value)
    return f"{local:%H:%M}" if local else ""


def format_when(value, *, now=None, time: bool = True, relative: bool = True, fallback: str = "") -> str:
    """Wann etwas ist: „Sa 23. Mai · 18:00“, „heute 18:00“, „morgen 18:00“, „Sa 23. Mai 2027 · 18:00“.

    ``time=False`` nur der Tag („Sa 23. Mai“, „heute“); ein reiner Tag steht immer ohne Uhrzeit. ``now`` ist der
    Bezugszeitpunkt (Standard: jetzt).
    """
    local = as_vienna(value)
    if not local:
        return fallback
    with_clock = time and not is_pure_day(value)
    clock = f"{local:%H:%M}"
    day = local.date()
    today = _today(now)
    if relative and day == today:
        return f"heute {clock}" if with_clock else "heute"
    if relative and day == today + timedelta(days=1):
        return f"morgen {clock}" if with_clock else "morgen"
    text = _day_text(day, with_year=day.year != today.year)
    return f"{text} · {clock}" if with_clock else text


def format_date(value, *, now=None, relative: bool = True, fallback: str = "") -> str:
    """Nur der Tag: „Sa 23. Mai“ (wie ``format_when`` mit ``time=False``)."""
    return format_when(value, now=now, time=False, relative=relative, fallback=fallback)


def format_range(start, end, *, now=None, fallback: str = "") -> str:
    """Ein Zeitraum nach Wiener Tagen: „Fr 19. – Sa 20. Juni“, „Mo 30. November – Mi 2. Dezember“.

    Über den Jahreswechsel mit beiden Jahren, ganz in einem anderen Jahr mit dem Jahr am Ende. An einem Tag oder ohne
    Ende nur der Tag. Ein Ende um 00:30 ist in Wien schon der nächste Tag.
    """
    first = vienna_day(start)
    if not first:
        return fallback
    last = vienna_day(end) or first
    this_year = _today(now).year
    if last <= first:
        return _day_text(first, with_year=first.year != this_year)
    same_year = first.year == last.year
    same_month = same_year and first.month == last.month
    head = _day_text(first, with_month=not same_month, with_year=not same_year)
    tail = _day_text(last, with_year=not same_year or last.year != this_year)
    return f"{head} – {tail}"


def format_ago(value, *, now=None, fallback: str = "") -> str:
    """Vergangenes in Listen: „gerade eben“, „vor 12 Min.“, am selben Wiener Tag „vor 3 Std.“, „gestern“, danach
    der Tag („Sa 16. Mai“). Was deutlich in der Zukunft liegt, steht wie bei ``format_when``."""
    moment = as_vienna(value)
    if not moment:
        return fallback
    current = as_vienna(now if now is not None else now_utc())
    seconds = (current - moment).total_seconds()
    if seconds < -60:
        return format_when(moment, now=current)
    if seconds < 60:
        return "gerade eben"
    if seconds < 3600:
        return f"vor {int(seconds // 60)} Min."
    if moment.date() == current.date():
        return f"vor {int(seconds // 3600)} Std."
    if moment.date() == current.date() - timedelta(days=1):
        return "gestern"
    return format_when(moment, now=current, time=False)


def format_official_date(value) -> str:
    """Das amtliche Datum „23.05.2026“ in Wiener Zeit - nur für Rechnungen, Urkunden und PDF-Listen."""
    day = vienna_day(value)
    return f"{day.day:02d}.{day.month:02d}.{day.year}" if day else ""
