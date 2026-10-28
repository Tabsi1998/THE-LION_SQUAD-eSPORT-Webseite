"""Staffel = Turnier: der gemeinsame Baustein für die Nebenwirkungen (docs/LIGA.md, Abschnitt 7).

Eine Liga-Staffel ist technisch ein Turnier mit ``league_context`` (``{league_id, season_id, division_id, staffel}``).
Viele Auswertungen über ``tournaments`` sollen sie nicht mitzählen (Jahreswertung, Pokale, Löwen-Rang, Startseite …)
oder sie nur kennzeichnen (Profil, Teamseite, Suche). Alle Stellen benutzen diese eine Regel:

- ``NOT_LEAGUE`` - Mongo-Filter „keine Staffel“: ``{"league_context": None}`` trifft fehlende Felder (und ``null``,
  das nie geschrieben wird). Mit ``without_league(query)`` in eine vorhandene Abfrage einbauen.
- ``ONLY_LEAGUE`` - nur Staffeln.
- ``is_league_staffel(t)`` - für Turniere, die schon geladen sind.
- ``league_label(t)`` - die Kennzeichnung „Liga · Staffel A“, sonst ``None``.
"""
from __future__ import annotations

NOT_LEAGUE: dict = {"league_context": None}
ONLY_LEAGUE: dict = {"league_context": {"$type": "object"}}
LEAGUE_FILTER_CHOICES = ("include", "exclude", "only")


def is_league_staffel(tournament: dict | None) -> bool:
    """Ist dieses Turnier eine Liga-Staffel?"""
    return isinstance((tournament or {}).get("league_context"), dict)


def league_label(tournament: dict | None) -> str | None:
    """Kennzeichnung einer Staffel - „Liga · Staffel A“; ``None`` für alle anderen Turniere."""
    if not is_league_staffel(tournament):
        return None
    staffel = str(tournament["league_context"].get("staffel") or "").strip()
    return f"Liga · Staffel {staffel}" if staffel else "Liga"


def without_league(query: dict | None = None) -> dict:
    """Eine Abfrage über ``tournaments`` ohne Staffeln. Ein vorhandenes ``league_context``-Kriterium bleibt erhalten
    (beide müssen gelten)."""
    query = dict(query or {})
    if "league_context" in query:
        return {"$and": [query, NOT_LEAGUE]}
    query.update(NOT_LEAGUE)
    return query


def league_filter(choice: str | None) -> dict:
    """``include`` (Vorgabe, alles), ``exclude`` (ohne Staffeln) oder ``only`` (nur Staffeln) als Mongo-Filter."""
    if choice == "exclude":
        return dict(NOT_LEAGUE)
    if choice == "only":
        return dict(ONLY_LEAGUE)
    return {}


async def league_tournament_ids(db, ids) -> set[str]:
    """Welche dieser Turnier-Kennungen sind Staffeln? Für Auswertungen, die über Anmeldungen oder Spiele kommen und
    das Turnier nicht selbst laden."""
    wanted = sorted({str(i) for i in ids or [] if i})
    if not wanted:
        return set()
    rows = await db.tournaments.find({"id": {"$in": wanted}, **ONLY_LEAGUE}, {"_id": 0, "id": 1}).to_list(None)
    return {row["id"] for row in rows}
