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
    letzten Tages der letzten Spielwoche. ``None``: nicht bestimmbar."""
    if not season:
        return None
    closed = _utc(season.get("closed_at"))
    if closed:
        return closed
    weeks = week_days(season)
    if not weeks:
        return None
    return datetime.combine(weeks[-1][1] + timedelta(days=1), time.min, tzinfo=VIENNA).astimezone(timezone.utc)
