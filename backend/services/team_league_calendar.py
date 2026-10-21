"""Team-Liga im Kalender (#1931): Gegner und Spieltag-Zeitraum aus einer eingefügten Terminzeile - ohne Datenbank.

``reference_calendar.parse_round_lines`` ruft beides je Zeile auf:

- **Zeitraum** (``take_window``): „13.05.–17.05.“, „13.05.2026 - 17.05.2026“ oder kurz „13.–17.05.“. Der erste Tag
  bleibt in der Zeile (er ist der Termin), das Ende kommt als ``(Tag, Monat, Jahr oder None)`` zurück und wird mit
  ``window_end`` zum Kalendertag - ohne Jahr das Jahr des ersten Tags, springt es zurück, das nächste.
- **Gegner** (``take_opponent``): ein Abschnitt des Orts, der mit „vs“, „vs.“, „@“ oder „gegen“ beginnt. „vs Team X“
  heißt Heimspiel (``at_home`` wahr), „@ Team X“ auswärts (falsch), „gegen Team X“ sagt nichts über die Seite
  (``None``). Der Rest bleibt der Ort.

Leerraum wird vor jedem regulären Ausdruck zusammengefasst (``" ".join(text.split())``), damit kein Ausdruck bei vielen
Leerzeichen hintereinander langsam wird. Meldungen entstehen nur aus den Eingaben.
"""
from __future__ import annotations

import re
from datetime import date

MAX_OPPONENT = 120

# Nach dem Zusammenfassen steht zwischen zwei Teilen höchstens ein Leerzeichen.
_WINDOW = re.compile(
    r"(?<![\d.])(\d{1,2})\.(?:(\d{1,2})\.(\d{4}|\d{2})?)? ?[–-] ?(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)")
_PREFIXES = (("vs.", True), ("vs", True), ("@", False), ("gegen", None))


def flat(text: str) -> str:
    return " ".join(str(text or "").split())


def _year(given: str | None) -> int | None:
    if not given:
        return None
    return 2000 + int(given) if len(given) == 2 else int(given)


def take_window(text: str) -> tuple[str, tuple[int, int, int | None] | None]:
    """Einen Zeitraum aus der Zeile nehmen: liefert die Zeile mit nur dem ersten Tag und das Ende als
    ``(Tag, Monat, Jahr)`` - ohne Zeitraum die Zeile unverändert und ``None``."""
    line = flat(text)
    found = _WINDOW.search(line)
    if not found:
        return text, None
    start_day, start_month, start_year, end_day, end_month, end_year = found.groups()
    month = start_month or end_month  # „13.–17.05.“: der Monat steht nur am Ende
    year = start_year or (end_year if not start_month else None)
    start = f"{int(start_day):02d}.{int(month):02d}." + (year or "")
    return line[:found.start()] + start + line[found.end():], (int(end_day), int(end_month), _year(end_year))


def window_end(start: date, end: tuple[int, int, int | None]) -> tuple[date | None, str | None]:
    """Das Ende eines Zeitraums als Kalendertag - oder eine Meldung, wenn es den Tag nicht gibt oder er vor dem Beginn
    liegt."""
    day, month, year = end
    shown = f"{day:02d}.{month:02d}." + (str(year) if year else "")
    try:
        if year is None:
            year = start.year + (1 if (month, day) < (start.month, start.day) else 0)
        result = date(year, month, day)
    except ValueError:
        return None, f"Datum {shown} gibt es nicht."
    if result < start:
        return None, f"Der Spieltag endet am {shown}, vor seinem Beginn."
    return result, None


def take_opponent(venue: str | None) -> tuple[str | None, str | None, bool | None]:
    """Aus dem Ort (Teile mit „ · “ getrennt) den Gegner nehmen: ``(Ort ohne Gegner, Gegner, at_home)``."""
    if not venue:
        return venue, None, None
    parts = [part.strip() for part in str(venue).split(" · ")]
    for index, part in enumerate(parts):
        lower = part.casefold()
        for prefix, at_home in _PREFIXES:
            if not lower.startswith(prefix):
                continue
            rest = part[len(prefix):]
            # „vs“ und „gegen“ brauchen danach ein Leerzeichen („vsX“ ist ein Name), „@“ und „vs.“ nicht.
            if prefix in ("vs", "gegen") and rest[:1] not in (" ", ""):
                continue
            name = flat(rest).strip(" :,")
            if not name:
                continue
            others = [item for position, item in enumerate(parts) if position != index and item]
            return " · ".join(others) or None, name, at_home
    return venue, None, None
