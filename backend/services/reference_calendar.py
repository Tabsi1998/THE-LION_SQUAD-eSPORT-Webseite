"""Kalender externer Serien (#1742) - ohne Datenbank: Wiener Tag eines Termins, Status je Termin, Hinweise auf Lücken
und der Parser für eingefügte Terminlisten.

- **Zeit:** ein Termin hat einen Wiener Tag (``club_day``, „JJJJ-MM-TT“) und, wenn eine Uhrzeit bekannt ist, einen
  Zeitpunkt in UTC (``starts_at``). Gezählt wird nur in Wiener Tagen; „heute“ liefert ``dolibarr_policy.club_today()``.
  Zur Zeitumstellung: eine Uhrzeit, die es nicht gibt, wird abgelehnt; eine doppelte meint die erste (Sommerzeit).
  So kann der Vereinskalender (``calendar_items``, Stufe 2) Titel, Ort, Tag und Zeitpunkt später unverändert übernehmen.
- **Status** (``round_status``): gespeichert sind nur geplant, gewertet, abgesagt und verschoben; gerechnet werden
  „heute“ und „Ergebnis fehlt“ (Tag vorbei, kein veröffentlichtes Ergebnis). Abgesagt fehlt nie.
- **Hinweis:** ein Termin ohne Ergebnis, nach dem schon eine Runde gewertet ist, wird genannt („abgesagt?“) statt still
  übergangen.
- **Einfügen** (``parse_round_lines``): je Zeile Kürzel, Datum, optional Uhrzeit und Ort in beliebiger Reihenfolge,
  getrennt durch Leerzeichen, ``·``, ``|``, ``;`` oder Tabulator - etwa „R1 · 05.11. · Ort“. Ohne Jahr gilt das erste
  Jahr der Saison, und springt das Datum zurück, das nächste Jahr. Ohne Datum folgt der nächste Standard-Wochentag der
  Serie (sonst eine Woche) nach der Zeile davor, ohne Uhrzeit die Standard-Uhrzeit.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from services.dolibarr_policy import CLUB_TZ
from services.series_standings import ordered_rounds

STATES = ("planned", "today", "missing", "cancelled", "postponed", "scored")
MAX_LINES = 200
MAX_CODE = 20
MAX_VENUE = 160

_ISO_DATE = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_DOT_DATE = re.compile(r"(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?![\d])")
_CLOCK = re.compile(r"(?<![\d:])(\d{1,2}):(\d{2})(?:\s*Uhr)?(?![\d:])", re.IGNORECASE)
_CODE = re.compile(r"^\s*([A-Za-zÄÖÜäöü]{1,6}\s?\d{1,3}|\d{1,3})\.?(?=[\s·|;\t]|$)")
_SPLIT = re.compile(r"\s*[·|;\t]\s*|\s+[–-]\s+")
_YEAR = re.compile(r"(?<!\d)(\d{4})(?!\d)")


# ---------------------------------------------------------------- Zeit
class ClockError(ValueError):
    """Eine Wiener Uhrzeit, die es an diesem Tag nicht gibt (Umstellung auf Sommerzeit)."""


def vienna_start(day: str | None, clock: str | None) -> str | None:
    """Wiener Tag und Uhrzeit („HH:MM“) als Zeitpunkt in UTC (ISO); ohne Uhrzeit ``None`` - dann zählt nur der Tag.

    Zeitumstellung: Eine Uhrzeit, die es nicht gibt (letzter Sonntag im März, 02:00–02:59), lehnt ``ClockError`` ab.
    Eine Uhrzeit, die es zweimal gibt (letzter Sonntag im Oktober, 02:00–02:59), meint die erste - noch Sommerzeit,
    wie ``fromViennaInput`` im Web."""
    if not day or not clock:
        return None
    wall = datetime.combine(date.fromisoformat(day), datetime.strptime(clock, "%H:%M").time())
    instant = wall.replace(tzinfo=CLUB_TZ, fold=0).astimezone(timezone.utc)
    if instant.astimezone(CLUB_TZ).replace(tzinfo=None) != wall:
        raise ClockError(f"{clock} Uhr gibt es am {wall:%d.%m.%Y} in Wien nicht (Umstellung auf Sommerzeit).")
    return instant.isoformat()


def club_day_of(value) -> str | None:
    """Der Wiener Tag eines Zeitpunkts (Text oder datetime; ohne Zone gilt UTC)."""
    if not value:
        return None
    moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(CLUB_TZ).date().isoformat()


def vienna_clock(value) -> str | None:
    """Die Wiener Uhrzeit („HH:MM“) eines Zeitpunkts."""
    if not value:
        return None
    moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(CLUB_TZ).strftime("%H:%M")


# ---------------------------------------------------------------- Status
def round_status(rnd: dict, has_result: bool, today: str) -> str:
    """Status eines Termins am Wiener Tag ``today``: ``planned``, ``today``, ``missing`` (Ergebnis fehlt),
    ``cancelled``, ``postponed`` (neuer Tag liegt noch vor uns) oder ``scored``."""
    stored = rnd.get("status") or "planned"
    if stored == "cancelled":
        return "cancelled"
    if has_result or stored == "scored":
        return "scored"
    day = rnd.get("club_day") or club_day_of(rnd.get("starts_at"))
    if day and day == today:
        return "today"
    if day and day < today:
        return "missing"
    return "postponed" if stored == "postponed" else "planned"


def round_label(rnd: dict, position: int) -> str:
    return (rnd.get("code") or "").strip() or f"Termin {position}"


def calendar_view(rounds: list[dict], result_round_ids, today: str) -> dict:
    """Der Kalender einer Serie in Reihenfolge, ohne archivierte Termine: je Termin ``position`` und ``state``, dazu
    ``counts`` je Status und ``hints`` für Termine ohne Ergebnis, nach denen schon gewertet wurde."""
    with_results = set(result_round_ids or ())
    active = [item for item in ordered_rounds(rounds) if not item.get("archived_at")]
    out = []
    for position, item in enumerate(active, start=1):
        out.append({**item, "position": position,
                    "state": round_status(item, item.get("id") in with_results, today)})
    counts = {state: sum(1 for item in out if item["state"] == state) for state in STATES}
    hints = []
    for index, item in enumerate(out):
        if item["state"] != "missing":
            continue
        later = next((other for other in out[index + 1:] if other["state"] == "scored"), None)
        if later:
            label = round_label(item, item["position"])
            hints.append({"round_id": item["id"], "text": (
                f"{label} hat kein Ergebnis, obwohl {round_label(later, later['position'])} schon gewertet ist – "
                "abgesagt?")})
    return {"rounds": out, "counts": counts, "hints": hints}


# ---------------------------------------------------------------- Einfügen
def _next_weekday(after: date, weekday: int | None) -> date:
    if weekday is None:
        return after + timedelta(days=7)
    return after + timedelta(days=(weekday - after.weekday() - 1) % 7 + 1)


def _clean_venue(text: str) -> str:
    parts = [part.strip(" ,") for part in _SPLIT.split(text)]
    return " · ".join(" ".join(part.split()) for part in parts if part.strip(" ,"))


def parse_round_lines(text: str, *, season: str | None, today: str, default_weekday: int | None,
                      default_time: str | None) -> dict:
    """Eine eingefügte Terminliste als ``{"rows": [...], "errors": [...]}``. Hat eine Zeile einen Fehler, gibt es keine
    Zeilen - übernommen wird nur eine fehlerfreie Liste. Jede Zeile nennt ihre Nummer (``line``)."""
    lines = [(number, raw.strip()) for number, raw in enumerate(str(text or "").splitlines(), start=1)]
    lines = [(number, raw) for number, raw in lines if raw and not raw.startswith("#")]
    if len(lines) > MAX_LINES:
        return {"rows": [], "errors": [{"line": None, "text": "",
                                        "message": f"Höchstens {MAX_LINES} Termine auf einmal."}]}
    year_match = _YEAR.search(str(season or ""))
    year = int(year_match.group(1)) if year_match else int(today[:4])
    rows, errors = [], []
    previous: date | None = None
    for number, raw in lines:
        rest = raw
        day: date | None = None
        error = None
        iso = _ISO_DATE.search(rest)
        dot = None if iso else _DOT_DATE.search(rest)
        if iso or dot:
            match = iso or dot
            if iso:
                y, m, d = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
                shown = match.group(0)
            else:
                d, m = int(dot.group(1)), int(dot.group(2))
                given = dot.group(3)
                y = (2000 + int(given) if len(given) == 2 else int(given)) if given else None
                shown = f"{d:02d}.{m:02d}." + (given or "")
            rest = rest[:match.start()] + " " + rest[match.end():]
            try:
                if y is None:
                    y = year
                    day = date(y, m, d)
                    if previous and day < previous:
                        day = date(y + 1, m, d)
                else:
                    day = date(y, m, d)
            except ValueError:
                error = f"Datum {shown} gibt es nicht."
        clock = None
        found = _CLOCK.search(rest)
        if found and not error:
            hours, minutes = int(found.group(1)), int(found.group(2))
            if hours > 23 or minutes > 59:
                error = f"Uhrzeit {found.group(1)}:{found.group(2)} gibt es nicht."
            clock = f"{hours:02d}:{minutes:02d}"
            rest = rest[:found.start()] + " " + rest[found.end():]
        code = None
        found_code = _CODE.match(rest)
        if found_code:
            code = " ".join(found_code.group(1).split())
            rest = rest[found_code.end():]
        venue = _clean_venue(rest) or None
        if not error and day is None:
            if previous is None:
                error = "Datum fehlt (TT.MM.)."
            else:
                day = _next_weekday(previous, default_weekday)
                undated = True
        else:
            undated = False
        if not error and venue and len(venue) > MAX_VENUE:
            error = f"Ort ist zu lang (höchstens {MAX_VENUE} Zeichen)."
        if not error and code and len(code) > MAX_CODE:
            error = f"Kürzel ist zu lang (höchstens {MAX_CODE} Zeichen)."
        clock = clock or default_time
        starts_at = None
        if not error:
            try:
                starts_at = vienna_start(day.isoformat(), clock)
            except ClockError as exc:
                error = str(exc)
        if error:
            errors.append({"line": number, "text": raw, "message": error})
            continue
        previous = day
        warning = None
        if default_weekday is not None and not undated and day.weekday() != default_weekday:
            warning = "Nicht am Standard-Wochentag."
        rows.append({"line": number, "text": raw, "code": code, "venue": venue, "day": day.isoformat(),
                     "time": clock, "starts_at": starts_at, "derived_day": undated,
                     "warning": warning})
    return {"rows": [] if errors else rows, "errors": errors}
