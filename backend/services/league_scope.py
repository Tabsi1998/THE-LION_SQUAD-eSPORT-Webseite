"""Staffel = Turnier: der gemeinsame Baustein für die Nebenwirkungen (docs/LIGA.md, Abschnitt 7).

Eine Liga-Staffel ist technisch ein Turnier mit ``league_context`` (``{league_id, season_id, division_id, staffel}``).
Viele Auswertungen über ``tournaments`` sollen sie nicht mitzählen (Jahreswertung, Pokale, Löwen-Rang, Startseite …)
oder sie nur kennzeichnen (Profil, Teamseite, Suche). Alle Stellen benutzen diese eine Regel:

- ``NOT_LEAGUE`` - Mongo-Filter „keine Staffel“: ``{"league_context": None}`` trifft fehlende Felder (und ``null``,
  das nie geschrieben wird). Mit ``without_league(query)`` in eine vorhandene Abfrage einbauen.
- ``ONLY_LEAGUE`` - nur Staffeln.
- ``is_league_staffel(t)`` - für Turniere, die schon geladen sind.
- ``league_label(t)`` - die Kennzeichnung „Liga · Staffel A“, sonst ``None``.

**Staffel-Art** (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“): Eine Staffel mit ``league_context.kind`` ist die Playoff- bzw.
Relegations-Staffel einer Liga N. Fehlt das Feld, ist es eine reguläre Staffel - den Wert ``"regular"`` gibt es nicht.

- ``staffel_kind(t)`` - ``None`` (regulär oder gar keine Staffel), ``"playoff"`` oder ``"relegation"``.
- ``REGULAR_ONLY`` - Mongo-Filter „nur reguläre Staffeln“ (trifft das fehlende Feld), zusätzlich zu ``ONLY_LEAGUE``.
- ``staffel_label(t)`` - „Staffel A“, „Playoffs“ oder „Relegation“; der Server liefert das Wort fertig mit.
"""
from __future__ import annotations

NOT_LEAGUE: dict = {"league_context": None}
ONLY_LEAGUE: dict = {"league_context": {"$type": "object"}}
LEAGUE_FILTER_CHOICES = ("include", "exclude", "only")

PLAYOFF, RELEGATION = "playoff", "relegation"
POSTSEASON_KINDS = (PLAYOFF, RELEGATION)
# Die Staffel-Kennung in ``league_context.staffel``: mehrstellig, kann nie mit einem Buchstaben A-Z kollidieren.
STAFFEL_CODES = {PLAYOFF: "PO", RELEGATION: "REL"}
KIND_LABELS = {PLAYOFF: "Playoffs", RELEGATION: "Relegation"}
REGULAR_ONLY: dict = {"league_context.kind": None}


def is_league_staffel(tournament: dict | None) -> bool:
    """Ist dieses Turnier eine Liga-Staffel?"""
    return isinstance((tournament or {}).get("league_context"), dict)


def staffel_kind(tournament: dict | None) -> str | None:
    """Die Art einer Staffel: ``None`` für die reguläre (und für Turniere ohne Liga), sonst ``playoff`` oder ``relegation``."""
    if not is_league_staffel(tournament):
        return None
    kind = tournament["league_context"].get("kind")
    return kind if kind in POSTSEASON_KINDS else None


def is_regular_staffel(tournament: dict | None) -> bool:
    return is_league_staffel(tournament) and staffel_kind(tournament) is None


def context_label(context: dict | None) -> str | None:
    """Wie ``staffel_label``, aber aus dem ``league_context`` allein - für Stellen, die nur ihn in der Hand haben."""
    context = context if isinstance(context, dict) else {}
    if context.get("kind") in POSTSEASON_KINDS:
        return KIND_LABELS[context["kind"]]
    staffel = str(context.get("staffel") or "").strip()
    return f"Staffel {staffel}" if staffel else None


def staffel_label(tournament: dict | None) -> str | None:
    """„Staffel A“, „Playoffs“ oder „Relegation“ - ``None`` für Turniere ohne Liga und für eine Staffel ohne Kennung."""
    if not is_league_staffel(tournament):
        return None
    return context_label(tournament["league_context"])


def league_label(tournament: dict | None) -> str | None:
    """Kennzeichnung einer Staffel - „Liga · Staffel A“ bzw. „Liga · Playoffs“; ``None`` für alle anderen Turniere."""
    if not is_league_staffel(tournament):
        return None
    label = staffel_label(tournament)
    return f"Liga · {label}" if label else "Liga"


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
