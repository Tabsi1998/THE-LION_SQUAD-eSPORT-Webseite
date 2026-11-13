"""Zonen für Auf- und Abstieg je Liga N (F.2, #1627, docs/LIGA.md „F.2 Neue Season aus dem Vorgänger“; Entscheidungen Nr. 158, 159).

Blatt-Modul ohne schwere Importe: die Tabellen-Route (``tournament_view_routes._standing_rows``), der Abschluss (``league_final``) und
die neue Season (``league_successor``) lesen dieselbe Rechnung.

- **Einstellung** ``league_divisions.zones``: ``promote`` (Aufsteiger), ``relegate`` (Absteiger), ``playoff_promote`` und
  ``playoff_relegate`` (Relegationsplätze). Fehlt das Feld, gilt 1/1 ohne Relegation. Die oberste aktive Liga N hat keinen Aufstieg,
  die unterste keinen Abstieg - egal, was eingestellt ist (``effective``).
- **Je Staffel** gelten die Zahlen (zwei Staffeln einer Liga N mit je einem Aufsteiger: zwei Aufsteiger).
- **Tabellenende** (Nr. 43, 159): Ausgeschiedene und Disqualifizierte stehen für die Zonen immer hinten, auch wenn die Regel ``half``
  sie rechnerisch vorn lässt. Sie steigen nie auf, belegen zuerst die Abstiegsplätze und fallen aus der Liga heraus (``out``).
- **Relegation** ist vorbereitet: Die Plätze stehen farbig in der Tabelle, eine Wirkung auf die neue Season haben sie noch nicht -
  die Teams bleiben in ihrer Liga N (``MOVES``).
"""
from __future__ import annotations

PROMOTION = "promotion"
PLAYOFF_PROMOTION = "playoff_promotion"
PLAYOFF_RELEGATION = "playoff_relegation"
RELEGATION = "relegation"
OUT = "out"

FIELDS = ("promote", "relegate", "playoff_promote", "playoff_relegate")
DEFAULTS = {"promote": 1, "relegate": 1, "playoff_promote": 0, "playoff_relegate": 0}
FIELD_MAX = 10
LABELS = {
    PROMOTION: "Aufstieg", PLAYOFF_PROMOTION: "Relegation um den Aufstieg", PLAYOFF_RELEGATION: "Relegation gegen den Abstieg",
    RELEGATION: "Abstieg", OUT: "Scheidet aus",
}
# Wohin ein Team in der neuen Season geht: -1 eine Liga N höher, +1 eine tiefer, 0 bleibt. Relegation ist vorbereitet, ohne Wirkung.
MOVES = {PROMOTION: -1, RELEGATION: 1, PLAYOFF_PROMOTION: 0, PLAYOFF_RELEGATION: 0, None: 0}
OVERLAP = ("Die Zonen überschneiden sich: Aufsteiger, Absteiger und Relegationsplätze zusammen sind mehr als Teams in einer Staffel "
           "({size}). Bitte weniger Plätze eintragen.")


class ZoneProblem(ValueError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def _count(value, fallback: int) -> int:
    if value is None or isinstance(value, bool):
        return fallback
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(0, min(FIELD_MAX, number))


def settings_of(division: dict | None) -> dict:
    """Die eingestellten Zonen einer Liga N - fehlt ein Wert, gilt die Vorgabe 1/1 ohne Relegation."""
    raw = (division or {}).get("zones") or {}
    return {key: _count(raw.get(key), DEFAULTS[key]) for key in FIELDS}


def clean(raw: dict | None, staffel_size: int | None) -> dict:
    """Die Eingabe der Leitung geprüft: ganze Zahlen 0–10, zusammen nicht mehr als Teams in einer Staffel (sonst überschneiden sich die
    Zonen). Fehlende Werte nehmen die Vorgabe."""
    out = {key: _count((raw or {}).get(key), DEFAULTS[key]) for key in FIELDS}
    size = int(staffel_size or 0)
    if size and sum(out.values()) > size:
        raise ZoneProblem(OVERLAP.format(size=size))
    return out


def effective(division: dict | None, levels: list[int]) -> dict:
    """Was in dieser Liga N gilt: oberste ohne Aufstieg, unterste ohne Abstieg. ``levels``: die Stufen der aktiven Liga N der Season."""
    zones = settings_of(division)
    level = (division or {}).get("level")
    known = sorted({item for item in levels if isinstance(item, int)})
    top = not known or level is None or level <= known[0]
    bottom = not known or level is None or level >= known[-1]
    if top:
        zones["promote"] = zones["playoff_promote"] = 0
    if bottom:
        zones["relegate"] = zones["playoff_relegate"] = 0
    return {**zones, "top": top, "bottom": bottom}


def _rank(row: dict) -> int:
    try:
        return int(row.get("rank") or 0)
    except (TypeError, ValueError):
        return 0


def ordered(rows: list[dict]) -> list[dict]:
    """Die Reihenfolge für die Zonen: wer in der Wertung steht nach Platz, Ausgeschiedene dahinter (Nr. 43) in ihrer Reihenfolge."""
    active = [row for row in rows if not row.get("exit")]
    gone = [row for row in rows if row.get("exit")]
    return sorted(active, key=lambda row: (_rank(row) or 10**6)) + gone


def started(rows: list[dict]) -> bool:
    """Zonen gibt es erst mit dem ersten gewerteten Spiel - vorher stehen alle gleich."""
    return any(int(row.get("played") or 0) > 0 for row in rows) and any(_rank(row) > 0 for row in rows)


def assign(rows: list[dict], zones: dict | None) -> dict[str, str | None]:
    """Je Anmeldung die Zone: ``promotion``, ``playoff_promotion``, ``playoff_relegation``, ``relegation``, ``out`` oder ``None``."""
    out: dict[str, str | None] = {}
    if not zones:
        return out
    order = ordered(rows)
    size = len(order)
    up, up_playoff = zones.get("promote") or 0, zones.get("playoff_promote") or 0
    down, down_playoff = zones.get("relegate") or 0, zones.get("playoff_relegate") or 0
    for index, row in enumerate(order):
        key = row.get("registration_id")
        if not key:
            continue
        if row.get("exit"):
            out[key] = OUT
        elif index < up:
            out[key] = PROMOTION
        elif index < up + up_playoff:
            out[key] = PLAYOFF_PROMOTION
        elif index >= size - down:
            out[key] = RELEGATION
        elif index >= size - down - down_playoff:
            out[key] = PLAYOFF_RELEGATION
        else:
            out[key] = None
    return out


def mark(rows: list[dict], zones: dict | None) -> list[dict]:
    """Schreibt ``zone`` an jede Zeile (auch ``None``) - erst mit dem ersten gewerteten Spiel."""
    found = assign(rows, zones) if zones and started(rows) else {}
    for row in rows:
        row["zone"] = found.get(row.get("registration_id"))
    return rows


def boundary_ties(rows: list[dict], zones: dict | None) -> list[dict]:
    """Echte Gleichstände an einer Zonengrenze (Nr. 156 „später Auf-/Abstieg“): Teams auf demselben Platz bekämen nach ``assign`` verschiedene
    Zonen. Liegen alle gleich Platzierten in derselben Zone (auch bei Zonen, die sich überlappen), ist nichts zu entscheiden."""
    if not zones or not started(rows):
        return []
    found = assign(rows, zones)
    groups: dict[int, list[dict]] = {}
    for row in ordered(rows):
        if not row.get("exit") and _rank(row) and row.get("registration_id"):
            groups.setdefault(_rank(row), []).append(row)
    out = []
    for rank in sorted(groups):
        group = groups[rank]
        if len(group) > 1 and len({found.get(row["registration_id"]) for row in group}) > 1:
            out.append({"kind": "zone", "rank": rank, "registration_ids": [row["registration_id"] for row in group],
                        "names": [row.get("display_name") or "Team" for row in group], "points": group[0].get("points")})
    return out


def summary(zones: dict | None) -> str:
    """Ein Satz für Verwaltung und Vorschau: „1 Aufsteiger · 1 Absteiger“ - mit den Randfällen."""
    if not zones:
        return ""
    parts = []
    if zones.get("top"):
        parts.append("oberste Liga: kein Aufstieg")
    elif zones.get("promote"):
        parts.append(f"{zones['promote']} Aufsteiger")
    else:
        parts.append("kein Aufstieg")
    if zones.get("playoff_promote"):
        parts.append(f"{zones['playoff_promote']} Relegation oben")
    if zones.get("playoff_relegate"):
        parts.append(f"{zones['playoff_relegate']} Relegation unten")
    if zones.get("bottom"):
        parts.append("unterste Liga: kein Abstieg")
    elif zones.get("relegate"):
        parts.append(f"{zones['relegate']} Absteiger")
    else:
        parts.append("kein Abstieg")
    return " · ".join(parts)


async def season_levels(db, season_id: str | None) -> list[int]:
    rows = await db.league_divisions.find({"season_id": season_id, "status": {"$ne": "archived"}}, {"_id": 0, "level": 1}).to_list(50)
    return sorted({row["level"] for row in rows if isinstance(row.get("level"), int)})


async def for_tournament(db, tournament: dict | None) -> dict | None:
    """Die geltenden Zonen einer Liga-Staffel - ``None`` bei anderen Turnieren."""
    context = (tournament or {}).get("league_context") or {}
    if not context.get("division_id"):
        return None
    division = await db.league_divisions.find_one({"id": context["division_id"]}, {"_id": 0, "id": 1, "level": 1, "zones": 1})
    if not division:
        return None
    return effective(division, await season_levels(db, context.get("season_id")))


async def mark_rows(db, tournament: dict | None, rows: list[dict]) -> list[dict]:
    """Die Tabelle einer Liga-Staffel bekommt ihre Zonen - andere Turniere bleiben, wie sie sind."""
    zones = await for_tournament(db, tournament)
    if zones is None:
        return rows
    return mark(rows, zones)
