"""Turniertage einer Turnierserie (#1961) - ohne Datenbank: Runden innerhalb eines Termins, Tagessumme und Tagesplatz,
Double Up, eigene Sonderboni und geteilte Plätze. Die Regeln dazu normalisiert ``scoring_rules.normalize_rules``
(``day_rounds``, ``custom_bonuses``, ``tiebreak_top_n``).

- **Runden je Termin** (Zeile ``day_rounds``): je Runde ``{place, points, lobby}`` oder ``None`` (nicht gespielt, etwa
  nach „Ausgestiegen“ - zählt 0). Stehen Punkte da, gelten sie wie gelesen: Bots in einer Lobby verschieben die Punkte
  der Menschen, das Blatt rechnet sie darum nie aus der Reihenfolge der Menschen neu. Ohne Punkte kommen sie aus dem
  Platz in der Lobby samt Bots und dem Rundenschema der Saison (Vorgabe 8…1). Die Lobby ist optional.
- **Tagessumme** (GES P): die Summe der Runden. Trägt die Zeile die Summe des Veranstalters (``day_points``), gilt
  diese - weicht sie von den Runden ab, warnt das Blatt (``day_points_differ``).
- **Tagesplatz:** Ohne eingetragenen Platz bestimmt die Tagessumme den Platz - Wettbewerbsrang (4, 4, 6). Bei Double Up
  zählt ein Paar als eine Einheit (1, 1, 2, 2 …). Die Saisonpunkte kommen wie bisher aus dem Platz (Schema der Saison)
  oder laut Veranstalter.
- **Double Up:** Zwei Zeilen sind Partner (``partner_id``), beide haben denselben Platz und dieselben Punkte.
- **Geteilte Plätze** (``shared_place_problems``): zweimal „4.“ mit gleicher Tagessumme oder mit Lücke danach (4, 4, 6)
  ist ein Gleichstand, ein Paar im Double Up ein Platz - beides ohne Meldung.
- **Sonderboni** (Zeile ``bonus_keys``): je Zeile abhakbar, Punkte aus ``custom_bonuses``. Sie zählen getrennt von den
  Saisonpunkten der Zeile - wie Aktivitätspunkte nie gestrichen - und stehen im Stand als ``bonus_points``.
"""
from __future__ import annotations

import math

from services.scoring_rules import place_points

MAX_LOBBY = 20


def _num(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else number


def _place(value) -> int | None:
    try:
        place = int(value)
    except (TypeError, ValueError):
        return None
    return place if 1 <= place <= 1000 else None


# ---------------------------------------------------------------- Runden einer Zeile
def clean_rounds(entries) -> list[dict | None]:
    """Runden einer Zeile aufbereitet: je Runde ``{place, points, lobby}`` (nur was angegeben ist) oder ``None``; leere
    Runden am Ende fallen weg."""
    out: list[dict | None] = []
    for entry in entries or []:
        if not isinstance(entry, dict):
            out.append(None)
            continue
        item = {}
        place = _place(entry.get("place"))
        if place is not None:
            item["place"] = place
        points = _num(entry.get("points"))
        if points is not None:
            item["points"] = points
        lobby = " ".join(str(entry.get("lobby") or "").split())[:MAX_LOBBY]
        if lobby:
            item["lobby"] = lobby
        out.append(item if ("place" in item or "points" in item) else None)
    while out and out[-1] is None:
        out.pop()
    return out


def round_points(entry: dict | None, rules: dict):
    """Punkte einer Runde: wie gelesen, sonst aus dem Platz in der Lobby; ``None`` heißt nicht gespielt."""
    if not entry:
        return None
    if entry.get("points") is not None:
        return entry["points"]
    return place_points(entry.get("place"), rules["day_rounds"]["points_by_place"])


def rounds_with_points(row: dict, rules: dict) -> list[dict | None]:
    """Runden einer Zeile mit den Punkten, die zählen (``points``) - für Anzeige und Stand."""
    out = []
    for entry in row.get("day_rounds") or []:
        if not entry:
            out.append(None)
            continue
        out.append({**entry, "points": round_points(entry, rules)})
    return out


def rounds_total(row: dict, rules: dict):
    """Summe der Runden - ``None`` ohne eine einzige Runde."""
    points = [round_points(entry, rules) for entry in row.get("day_rounds") or []]
    if not any(value is not None for value in points):
        return None
    total = sum(value for value in points if value is not None)
    return int(total) if isinstance(total, float) and total.is_integer() else total


def day_total(row: dict, rules: dict):
    """Tagessumme (GES P): die des Veranstalters, sonst die Summe der Runden; ``None`` ohne beides."""
    given = _num(row.get("day_points"))
    return given if given is not None else rounds_total(row, rules)


def bonus_points(row: dict, rules: dict) -> tuple[float, list[str]]:
    """Sonderboni einer Zeile: Summe und die Kennungen, die es in der Saison gibt (in der Reihenfolge der Saison)."""
    keys = set(row.get("bonus_keys") or [])
    chosen = [bonus for bonus in rules["custom_bonuses"] if bonus["key"] in keys]
    total = sum(bonus["points"] for bonus in chosen)
    return (int(total) if isinstance(total, float) and total.is_integer() else total), [b["key"] for b in chosen]


# ---------------------------------------------------------------- Einheiten (Double Up)
def units(rows: list[dict]) -> list[list[dict]]:
    """Zeilen als Einheiten: ein Paar im Double Up (``partner_id`` gegenseitig oder einseitig) ist eine Einheit, jede
    andere Zeile ihre eigene. Reihenfolge wie die erste Zeile der Einheit."""
    by_pid = {row.get("participant_id"): row for row in rows if row.get("participant_id")}
    taken: set[int] = set()
    out = []
    for row in rows:
        if id(row) in taken:
            continue
        group = [row]
        taken.add(id(row))
        partner = by_pid.get(row.get("partner_id")) if row.get("partner_id") else None
        mutual = partner is not None and partner.get("partner_id") in (None, "", row.get("participant_id"))
        if mutual and id(partner) not in taken:
            group.append(partner)
            taken.add(id(partner))
        out.append(group)
    return out


def derive_places(rows: list[dict], rules: dict) -> None:
    """Platz aus der Tagessumme für Zeilen ohne Platz (an Ort und Stelle): Wettbewerbsrang über die Einheiten, ein Paar
    teilt seinen Platz. Nichtstart bekommt keinen Platz."""
    ranked = []
    for group in units([row for row in rows if "dns" not in (row.get("marks") or [])]):
        totals = [day_total(row, rules) for row in group]
        total = next((value for value in totals if value is not None), None)
        if total is not None:
            ranked.append((total, group))
    ranked.sort(key=lambda item: -item[0])
    previous, place = None, 0
    for index, (total, group) in enumerate(ranked, start=1):
        if total != previous:
            place, previous = index, total
        for row in group:
            if not row.get("place"):
                row["place"] = place


# ---------------------------------------------------------------- Geteilte Plätze
def shared_place_problems(rows: list[dict], rules: dict) -> tuple[list[tuple[int, list[int]]], list[int]]:
    """Doppelte Plätze, die kein Gleichstand sind, und fehlende Plätze. ``rows`` mit ``index``, ``place``,
    ``participant_id``, ``partner_id``. Ein Paar im Double Up zählt als eine Einheit. Mehrere Einheiten auf einem Platz
    sind ein Gleichstand, wenn ihre Tagessummen gleich sind oder der nächste belegte Platz genau dahinter liegt
    (4, 4, 6) - dann gilt der übersprungene Platz nicht als Lücke. Liefert ``([(Platz, Zeilen)], [fehlende Plätze])``.
    """
    by_place: dict[int, list[list[dict]]] = {}
    for group in units([row for row in rows if row.get("place")]):
        places = {row["place"] for row in group}
        if len(places) > 1:  # Partner mit verschiedenen Plätzen: je Platz eine eigene Einheit
            for row in group:
                by_place.setdefault(row["place"], []).append([row])
            continue
        by_place.setdefault(group[0]["place"], []).append(group)
    occupied = sorted(by_place)
    twice, covered = [], set()
    for position, place in enumerate(occupied):
        groups = by_place[place]
        count = len(groups)
        following = occupied[position + 1] if position + 1 < len(occupied) else None
        totals = [day_total(group[0], rules) for group in groups]
        tie = count > 1 and (following in (None, place + count)
                             or (None not in totals and len(set(totals)) == 1))
        if count > 1 and not tie:
            twice.append((place, sorted(row["index"] for group in groups for row in group)))
        covered.update(range(place, place + (count if tie else 1)))
    missing = [place for place in range(1, (occupied[-1] if occupied else 0) + 1) if place not in covered]
    return twice, missing
