"""Das Gründungsdatum des Vereins (Vereinsgeburtstag S13 #644).

Eine Quelle für den Vereinsgeburtstag (Saison ``club_birthday``), „Jahre aktiv“ (Über uns, Erfolge) und die Hinweise
im Admin: Mit dem Schalter „Vereinsdaten aus Dolibarr“ und einem Datum dort gilt Dolibarr, sonst das Handfeld unter
Verein → Über uns. Ein Gründungsjahr ohne Tag reicht für „Jahre aktiv“, nicht für den Geburtstag.
"""
from __future__ import annotations

from datetime import date

ABOUT_SETTINGS_ID = "about_page"


def parse_day(value) -> str | None:
    """Ein Tag als „JJJJ-MM-TT“ - oder None, wenn es kein gültiges Datum zwischen 1900 und 2100 ist."""
    text = str(value or "").strip()[:10]
    try:
        day = date.fromisoformat(text)
    except ValueError:
        return None
    return day.isoformat() if 1900 <= day.year <= 2100 else None


def parse_year(value) -> int | None:
    text = str(value if value is not None else "").strip()
    return int(text) if text.isdigit() and 1900 <= int(text) <= 2100 else None


def resolve(manual_on, manual_year, dolibarr_founded=None, dolibarr_on: bool = False) -> dict:
    """Die Rechnung ohne Datenbank: Handfelder und - wenn der Schalter an ist - was Dolibarr als Gründung kennt."""
    founded_on = parse_day(manual_on)
    founded_year = parse_year(manual_year) or (int(founded_on[:4]) if founded_on else None)
    source = "manual"
    if dolibarr_on:
        raw = str(dolibarr_founded or "").strip()
        day = parse_day(raw)
        year = int(day[:4]) if day else parse_year(raw[:4])
        if year:
            # Kennt Dolibarr nur das Jahr, bleibt der Tag aus dem Handfeld - wenn er in dieses Jahr fällt.
            founded_on = day or (founded_on if founded_on and int(founded_on[:4]) == year else None)
            founded_year = year
            source = "dolibarr"
    return {"founded_on": founded_on, "founded_year": founded_year, "source": source}


async def founding(db) -> dict:
    """``{"founded_on": "JJJJ-MM-TT" | None, "founded_year": int | None, "source": "dolibarr" | "manual"}``."""
    from services import club_facts

    about = await db.settings.find_one({"id": ABOUT_SETTINGS_ID}, {"_id": 0, "founded_on": 1, "founded_year": 1}) or {}
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    _overlay, legal_source = await club_facts.public_legal_source(db, branding)
    dolibarr_founded = None
    if legal_source.get("dolibarr"):
        state = await club_facts.snapshot(db)
        public = club_facts.organization_public(state.get("organization")) if state.get("organization") else None
        dolibarr_founded = (public or {}).get("founded")
    return resolve(about.get("founded_on"), about.get("founded_year"), dolibarr_founded, bool(legal_source.get("dolibarr")))


def years_on(founded_on: str | None, day: date) -> int | None:
    """Wie viele Jahre der Verein an diesem Tag alt ist (am Gründungstag selbst schon das neue Jahr)."""
    start = parse_day(founded_on)
    if not start:
        return None
    born = date.fromisoformat(start)
    years = day.year - born.year - ((day.month, day.day) < (born.month, born.day))
    return max(0, years)
