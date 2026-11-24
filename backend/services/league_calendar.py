"""Kalender einer Liga-Season als Blatt-Modul (docs/LIGA.md): Spielwochen und Season-Ende.

Ohne weitere Importe aus der Liga: ``league_service`` (Verwaltung), ``match_proof_retention`` (Aufbewahrung) und
``league_sanction_bans`` (Sperren, E.3) lesen dieselbe Rechnung, ohne dass sich ein Import-Kreis schließt.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

VIENNA = ZoneInfo("Europe/Vienna")


def aware(value) -> datetime | None:
    """Ein Zeitpunkt als UTC. Ohne Zeitzone ist er Wiener Wanduhrzeit - so gibt die Verwaltung den Beginn ein."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=VIENNA)
    return moment.astimezone(timezone.utc)


def _utc(value) -> datetime | None:
    """Ein gespeicherter Zeitstempel - ohne Zeitzone UTC (so schreibt der Server)."""
    if not value:
        return None
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------- Einmal gestartet bleibt gestartet (#2404, Nr. 253)

STARTED_AT = "started_at"


def start_value(season: dict | None):
    """Der Start, der für Sperren und Fristen gilt - so, wie er gespeichert ist: der gemerkte Start (``started_at``), sonst der
    eingestellte Beginn der ersten Spielwoche. Für Module, die den Wert selbst lesen (``league_late``)."""
    row = season or {}
    return row.get(STARTED_AT) or row.get("start_date")


def start_moment(season: dict | None) -> datetime | None:
    """``start_value`` als Zeitpunkt (UTC) - ``None`` ohne Beginn."""
    row = season or {}
    return aware(row.get(STARTED_AT)) or aware(row.get("start_date"))


def season_started(season: dict | None, now: datetime | None = None) -> bool:
    """Hat die Season begonnen? Ist der Start einmal gemerkt (``started_at``), bleibt es dabei - auch wenn das Startdatum danach in
    die Zukunft rückt oder die Season wieder Entwurf wird. Ohne das Feld (keine Migration) gilt, was das Datum sagt: im Entwurf nie,
    sonst ab dem Beginn der ersten Spielwoche."""
    if not season:
        return False
    if aware(season.get(STARTED_AT)):
        return True
    if (season.get("status") or "draft") == "draft":
        return False
    start = aware(season.get("start_date"))
    return bool(start and (now or datetime.now(timezone.utc)) >= start)


def start_stamp(season: dict | None, now: datetime | None = None):
    """Was beim nächsten Schreiben als ``started_at`` festzuhalten ist: der Beginn, wie er jetzt gespeichert ist - sobald er erreicht
    und noch nicht gemerkt ist. Sonst ``None`` (idempotent). Der Wert bleibt in der gespeicherten Form, damit jedes Modul ihn liest
    wie bisher das Startdatum."""
    if not season or season.get(STARTED_AT) or not season_started(season, now):
        return None
    return season.get("start_date")


def local_day(value) -> date | None:
    moment = aware(value)
    return moment.astimezone(VIENNA).date() if moment else None


def week_days(season: dict) -> list[tuple[date, date]]:
    """Je Spielwoche (1-basiert) der erste und letzte Wiener Kalendertag."""
    first = local_day(season.get("start_date"))
    if first is None:
        return []
    days = int(season.get("matchday_days") or 7)
    return [(first + timedelta(days=days * index), first + timedelta(days=days * index + days - 1))
            for index in range(int(season.get("weeks_total") or 0))]


def season_end_at(season: dict | None) -> datetime | None:
    """Wann die Season zu Ende ist: der Abschluss durch die Leitung (``closed_at``, kommt mit F.1) - bis dahin das Ende des
    letzten Tages der letzten Spielwoche. Spielt die Season Playoffs oder eine Relegation (#2404, F.6), endet sie erst mit deren
    letzter Woche (``postseason_end``, vom Server gepflegt) - Spielsperren und Nachweise enden nicht davor. ``None``: nicht bestimmbar."""
    if not season:
        return None
    closed = _utc(season.get("closed_at"))
    if closed:
        return closed
    weeks = week_days(season)
    if not weeks:
        return None
    regular = datetime.combine(weeks[-1][1] + timedelta(days=1), time.min, tzinfo=VIENNA).astimezone(timezone.utc)
    after = _utc(season.get("postseason_end"))
    return after if after and after > regular else regular
