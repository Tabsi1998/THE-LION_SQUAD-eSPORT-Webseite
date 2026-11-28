"""Einstellungen für Playoffs und Relegation (#2404, docs/LIGA.md „F.6 … Einstellungen im Einzelnen“; Entscheidungen Nr. 203-219, 222).

Die Vorlage steht an der Season (``league_seasons.postseason``), jede Liga N kann abweichen (``league_divisions.postseason``): Ein Teil,
der dort fehlt, heißt „wie die Season“ (Nr. 218). **Ohne Feld gibt es nichts davon** - keine Playoffs, Relegation nur farbig, Meister aus
der Tabelle. Hier steht nur Prüfen, Zusammenführen und der Kalender der Playoff-Wochen; ohne Datenbank.

- ``clean_season`` / ``clean_division``: die Eingabe der Leitung geprüft, mit deutschem Klartext (``PostseasonProblem``, 422).
- ``effective(season, division, best_of)``: was in dieser Liga N gilt, alle Vorgaben aufgelöst.
- ``sport_key``: die Werte, die ab dem ersten Abschluss feststehen (Nr. 228) - an/aus, Plätze je Staffel, Relegation an/aus.
- ``weeks``: Runde N liegt in der N-ten aktiven Woche ab dem Start (Nr. 208) - Sperrzeiten zählen nicht mit.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from services.league_calendar import VIENNA, local_day, week_days
from services.date_text import format_moment

FIELD = "postseason"
END_FIELD = "postseason_end"
BEST_OF = (1, 3, 5, 7)
PER_STAFFEL_MIN, PER_STAFFEL_MAX = 1, 16
ROUND_MAX = 6
SINGLE_ELIM = "single_elim"
FORMATS = (SINGLE_ELIM,)
CROSS = "cross"
SEEDINGS = (CROSS,)
BETTER_SEED, DRAW = "better_seed", "draw"
HOMES = (BETTER_SEED, DRAW)
TABLE, PLAYOFFS = "table", "playoffs"
CHAMPION_SOURCES = (TABLE, PLAYOFFS)
HINT, BLOCK = "hint", "block"
REOPEN_GUARDS = (HINT, BLOCK)

PLAYOFF_DEFAULTS = {"enabled": False, "per_staffel": None, "format": SINGLE_ELIM, "seeding": CROSS, "best_of": None, "best_of_rounds": [],
                    "third_place": False, "home": BETTER_SEED, "start_date": None}
RELEGATION_DEFAULTS = {"enabled": False, "best_of": None, "start_date": None}
HOME_LABELS = {BETTER_SEED: "Der besser Gesetzte hat Heimrecht und ist Team A im Veto", DRAW: "Team A im Veto wird je Spiel gelost"}
CHAMPION_LABELS = {TABLE: "aus der Tabelle", PLAYOFFS: "aus den Playoffs"}
REOPEN_LABELS = {HINT: "Wiederöffnen bleibt möglich, die Playoffs laufen mit ihrer Setzliste weiter",
                 BLOCK: "Wiederöffnen ist gesperrt, sobald ein Playoff- oder Relegationsspiel gespielt ist"}

PER_STAFFEL_NEEDED = f"Bitte angeben, wie viele Teams je Staffel in die Playoffs kommen ({PER_STAFFEL_MIN} bis {PER_STAFFEL_MAX})."
PER_STAFFEL_TOO_MANY = "{count} Plätze je Staffel sind mehr als Teams in einer Staffel ({size})."
BEST_OF_WRONG = "Best of muss 1, 3, 5 oder 7 sein."
FORMAT_WRONG = "Für die Playoffs gibt es derzeit nur Einfach-K.-o."
SEEDING_WRONG = "Für die Setzung gibt es derzeit nur „über Kreuz“."
HOME_WRONG = "Heimrecht: bitte „besser Gesetzter“ oder „Los“ wählen."
CHAMPION_WRONG = "Meister aus: bitte „Tabelle“ oder „Playoffs“ wählen."
REOPEN_WRONG = "Wiederöffnen nach dem Start der Playoffs: bitte „Hinweis“ oder „Sperre“ wählen."
DATE_WRONG = "Bitte den Start als Datum angeben (JJJJ-MM-TT)."
DATE_EARLY = "Der Start liegt in der regulären Season. Frühestens geht {day} - der Tag nach der letzten Spielwoche."
ROUND_WRONG = f"Best of je Runde: Die Runde muss zwischen 1 und {ROUND_MAX} liegen, jede Runde höchstens einmal."


class PostseasonProblem(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------- Prüfen

def _best_of(value, *, optional: bool = True) -> int | None:
    if value in (None, ""):
        if optional:
            return None
        raise PostseasonProblem(BEST_OF_WRONG)
    if isinstance(value, bool):
        raise PostseasonProblem(BEST_OF_WRONG)
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise PostseasonProblem(BEST_OF_WRONG) from None
    if number not in BEST_OF:
        raise PostseasonProblem(BEST_OF_WRONG)
    return number


def _day(value, season: dict | None) -> str | None:
    """Ein Wiener Kalendertag (JJJJ-MM-TT) - frühestens der Tag nach der letzten regulären Spielwoche."""
    if value in (None, ""):
        return None
    try:
        day = date.fromisoformat(str(value)[:10])
    except ValueError:
        raise PostseasonProblem(DATE_WRONG) from None
    earliest = regular_end_day(season or {})
    if earliest and day <= earliest:
        raise PostseasonProblem(DATE_EARLY.format(day=format_moment(earliest + timedelta(days=1))))
    return day.isoformat()


def _rounds(raw) -> list[dict]:
    out: dict[int, int] = {}
    for row in raw or []:
        if not isinstance(row, dict):
            raise PostseasonProblem(ROUND_WRONG)
        try:
            number = int(row.get("round"))
        except (TypeError, ValueError):
            raise PostseasonProblem(ROUND_WRONG) from None
        if not 1 <= number <= ROUND_MAX or number in out:
            raise PostseasonProblem(ROUND_WRONG)
        out[number] = _best_of(row.get("best_of"), optional=False)
    return [{"round": number, "best_of": out[number]} for number in sorted(out)]


def _playoffs(raw: dict | None, season: dict | None, *, staffel_size: int | None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    out = dict(PLAYOFF_DEFAULTS)
    out["enabled"] = bool(raw.get("enabled"))
    per = raw.get("per_staffel")
    if per in (None, ""):
        if out["enabled"]:
            raise PostseasonProblem(PER_STAFFEL_NEEDED)
    else:
        try:
            count = int(per)
        except (TypeError, ValueError):
            raise PostseasonProblem(PER_STAFFEL_NEEDED) from None
        if isinstance(per, bool) or not PER_STAFFEL_MIN <= count <= PER_STAFFEL_MAX:
            raise PostseasonProblem(PER_STAFFEL_NEEDED)
        if staffel_size and count > int(staffel_size):
            raise PostseasonProblem(PER_STAFFEL_TOO_MANY.format(count=count, size=int(staffel_size)))
        out["per_staffel"] = count
    if (raw.get("format") or SINGLE_ELIM) not in FORMATS:
        raise PostseasonProblem(FORMAT_WRONG)
    if (raw.get("seeding") or CROSS) not in SEEDINGS:
        raise PostseasonProblem(SEEDING_WRONG)
    home = raw.get("home") or BETTER_SEED
    if home not in HOMES:
        raise PostseasonProblem(HOME_WRONG)
    out.update({"home": home, "best_of": _best_of(raw.get("best_of")), "best_of_rounds": _rounds(raw.get("best_of_rounds")),
                "third_place": bool(raw.get("third_place")), "start_date": _day(raw.get("start_date"), season)})
    return out


def _relegation(raw: dict | None, season: dict | None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {"enabled": bool(raw.get("enabled")), "best_of": _best_of(raw.get("best_of")), "start_date": _day(raw.get("start_date"), season)}


def clean_season(raw: dict | None, season: dict | None = None) -> dict:
    """Die Vorlage der Season, vollständig und geprüft."""
    raw = raw if isinstance(raw, dict) else {}
    source = raw.get("champion_source") or TABLE
    if source not in CHAMPION_SOURCES:
        raise PostseasonProblem(CHAMPION_WRONG)
    guard = raw.get("reopen_guard") or HINT
    if guard not in REOPEN_GUARDS:
        raise PostseasonProblem(REOPEN_WRONG)
    return {"playoffs": _playoffs(raw.get("playoffs"), season, staffel_size=(season or {}).get("max_staffel_size")),
            "relegation": _relegation(raw.get("relegation"), season), "champion_source": source, "reopen_guard": guard}


def clean_division(raw: dict | None, season: dict | None = None, *, staffel_size: int | None = None) -> dict | None:
    """Die Abweichung einer Liga N: nur die Teile, die sie selbst trägt. ``None``: wie die Season."""
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    if isinstance(raw.get("playoffs"), dict):
        out["playoffs"] = _playoffs(raw["playoffs"], season, staffel_size=staffel_size)
    if isinstance(raw.get("relegation"), dict):
        out["relegation"] = _relegation(raw["relegation"], season)
    return out or None


# ---------------------------------------------------------------- Was gilt

def stored(season: dict | None) -> dict:
    """Die Vorlage der Season, wie sie gespeichert ist - mit den Vorgaben für alles, was fehlt."""
    raw = (season or {}).get(FIELD) if isinstance((season or {}).get(FIELD), dict) else {}
    return {"playoffs": {**PLAYOFF_DEFAULTS, **(raw.get("playoffs") or {})}, "relegation": {**RELEGATION_DEFAULTS, **(raw.get("relegation") or {})},
            "champion_source": raw.get("champion_source") if raw.get("champion_source") in CHAMPION_SOURCES else TABLE,
            "reopen_guard": raw.get("reopen_guard") if raw.get("reopen_guard") in REOPEN_GUARDS else HINT}


def effective(season: dict | None, division: dict | None, best_of: int | None = None) -> dict:
    """Was in dieser Liga N gilt: die Vorlage der Season, darüber die Teile der Liga N. ``best_of``: das Best of der Liga N
    (Season plus Abweichung) - die Vorgabe für Playoffs und Relegation."""
    base = stored(season)
    own = (division or {}).get(FIELD) if isinstance((division or {}).get(FIELD), dict) else {}
    playoffs = {**PLAYOFF_DEFAULTS, **(own["playoffs"] if isinstance(own.get("playoffs"), dict) else base["playoffs"])}
    relegation = {**RELEGATION_DEFAULTS, **(own["relegation"] if isinstance(own.get("relegation"), dict) else base["relegation"])}
    fallback = int(best_of or (season or {}).get("best_of") or 1)
    playoffs["enabled"] = bool(playoffs.get("enabled")) and bool(playoffs.get("per_staffel"))
    playoffs["best_of"] = int(playoffs.get("best_of") or fallback)
    relegation["enabled"] = bool(relegation.get("enabled"))
    relegation["best_of"] = int(relegation.get("best_of") or fallback)
    return {"playoffs": playoffs, "relegation": relegation, "champion_source": base["champion_source"], "reopen_guard": base["reopen_guard"],
            "own": {"playoffs": isinstance(own.get("playoffs"), dict), "relegation": isinstance(own.get("relegation"), dict)}}


def any_enabled(season: dict | None) -> bool:
    """Trägt die Season überhaupt etwas davon? Ohne Feld kostet das keine Abfrage."""
    return isinstance((season or {}).get(FIELD), dict)


def sport_key(found: dict) -> tuple:
    """Was ab dem ersten Abschluss einer Staffel der Liga N feststeht (Nr. 228)."""
    playoffs = found["playoffs"]
    return (bool(playoffs["enabled"]), int(playoffs.get("per_staffel") or 0) if playoffs["enabled"] else 0, bool(found["relegation"]["enabled"]))


def best_of_for(playoffs: dict, round_number: int) -> int:
    """Das Best of einer Runde (Nr. 207): die Zeile der Runde, sonst das Best of der Playoffs."""
    for row in playoffs.get("best_of_rounds") or []:
        if int(row.get("round") or 0) == int(round_number):
            return int(row["best_of"])
    return int(playoffs.get("best_of") or 1)


def round_label(round_number: int, total: int) -> str:
    """„Finale“, „Halbfinale“, „Viertelfinale“, „Achtelfinale“ - davor „Runde N“."""
    left = total - round_number
    return {0: "Finale", 1: "Halbfinale", 2: "Viertelfinale", 3: "Achtelfinale"}.get(left, f"Runde {round_number}")


# ---------------------------------------------------------------- Kalender

def regular_end_day(season: dict) -> date | None:
    """Der letzte Tag der letzten regulären Spielwoche."""
    weeks = week_days(season)
    return weeks[-1][1] if weeks else None


def _periods(season: dict) -> list[tuple[date, date]]:
    out = []
    for period in (season or {}).get("blocked_periods") or []:
        try:
            out.append((date.fromisoformat(period["start_date"]), date.fromisoformat(period["end_date"])))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _blocked(first: date, days: int, periods: list[tuple[date, date]]) -> bool:
    """Eine Woche ist gesperrt, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt - wie ``league_service.blocked_weeks``."""
    hit = sum(1 for offset in range(days) if any(start <= first + timedelta(days=offset) <= end for start, end in periods))
    return hit * 2 > days


def default_start(season: dict) -> date | None:
    """Vorgabe für den Start: der Tag nach der letzten regulären Spielwoche (die erste aktive Woche ergibt sich in ``weeks``)."""
    end = regular_end_day(season)
    return end + timedelta(days=1) if end else None


def weeks(season: dict, start, count: int) -> dict:
    """Die Wochen ab ``start`` für ``count`` Runden: ``rounds`` (``{round, start_day, end_day}``), ``blocked`` (gesperrte Kalenderwochen
    ab dem Start, 1-basiert - so trägt sie die Staffel in ``matchday_blocked_weeks``) und ``end_day``. Ohne Start leer."""
    first = start if isinstance(start, date) and not isinstance(start, datetime) else (date.fromisoformat(str(start)[:10]) if start else None)
    if first is None or count < 1:
        return {"rounds": [], "blocked": [], "end_day": None, "start_day": first.isoformat() if first else None}
    days = int((season or {}).get("matchday_days") or 7)
    periods = _periods(season)
    rounds, blocked, week = [], [], 0
    while len(rounds) < count and week < count + 104:
        week += 1
        begin = first + timedelta(days=days * (week - 1))
        if _blocked(begin, days, periods):
            blocked.append(week)
            continue
        rounds.append({"round": len(rounds) + 1, "start_day": begin.isoformat(), "end_day": (begin + timedelta(days=days - 1)).isoformat()})
    return {"rounds": rounds, "blocked": blocked, "start_day": first.isoformat(), "end_day": rounds[-1]["end_day"] if rounds else None}


def start_of(settings_part: dict, season: dict) -> date | None:
    """Der wirksame Start: der eingestellte Tag, sonst der Tag nach der letzten regulären Spielwoche."""
    if settings_part.get("start_date"):
        try:
            return date.fromisoformat(str(settings_part["start_date"])[:10])
        except ValueError:
            return default_start(season)
    return default_start(season)


def day_start_iso(day: date | str | None) -> str | None:
    """Mitternacht (Wien) dieses Tages als UTC - so trägt ein Turnier ``start_date``."""
    if not day:
        return None
    value = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    return datetime.combine(value, time.min, tzinfo=VIENNA).astimezone(timezone.utc).isoformat()


def day_end_iso(day: date | str | None) -> str | None:
    """Das Ende dieses Tages (Wien, 23:59:59) als UTC - wie ``league_service.season_end``."""
    if not day:
        return None
    value = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    return datetime(value.year, value.month, value.day, 23, 59, 59, tzinfo=VIENNA).astimezone(timezone.utc).isoformat()


def local_start_day(tournament: dict | None) -> date | None:
    return local_day((tournament or {}).get("start_date"))


def without_dates(raw: dict | None) -> dict:
    """Die Einstellungen ohne ihre Termine - so gehen sie in die neue Season (F.2, Nr. 161: Zeitraum und Termine neu setzen)."""
    out = {key: (dict(value) if isinstance(value, dict) else value) for key, value in (raw or {}).items()}
    for part in ("playoffs", "relegation"):
        if isinstance(out.get(part), dict):
            out[part]["start_date"] = None
    return out
