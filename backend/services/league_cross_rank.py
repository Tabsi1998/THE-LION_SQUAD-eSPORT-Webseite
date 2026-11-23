"""Vergleich von Tabellenzeilen über Staffeln hinweg (#1627, Entscheidung 23.11.; für die Playoff-Setzung #2404, Nr. 206, mitgedacht).

Blatt-Modul ohne Datenbank und ohne Importe aus dem Projekt. Staffeln einer Liga N können verschieden groß sein, darum zählt nicht die
Summe, sondern der Schnitt je Spiel:

1. **Punkte je Spiel**,
2. **Map-Differenz je Spiel** (``score_diff``),
3. danach stehen die Zeilen **gleich**. Beim Auf- und Abstieg entscheidet dann die Leitung (Nr. 156, kein Los). Wer eine Reihenfolge
   ohne Lücke braucht - die Setzliste der Playoffs -, gibt ``lot`` mit: eine Funktion, die eine Gruppe Gleicher ordnet.

Gerechnet wird mit Brüchen, nicht mit Kommazahlen: 4 Punkte aus 2 Spielen und 8 aus 4 sind genau gleich.
"""
from __future__ import annotations

from fractions import Fraction

PPG, MAP_DIFF, LOT = "ppg", "map_diff", "lot"


def _number(value) -> Fraction:
    if value is None or isinstance(value, bool):
        return Fraction(0)
    try:
        return Fraction(str(value))
    except (ValueError, ZeroDivisionError):
        return Fraction(0)


def per_game(row: dict) -> tuple[Fraction, Fraction]:
    """(Punkte je Spiel, Map-Differenz je Spiel) - ohne gewertetes Spiel beides 0."""
    played = _number(row.get("played"))
    if played <= 0:
        return Fraction(0), Fraction(0)
    return _number(row.get("points")) / played, _number(row.get("score_diff")) / played


def ranked(rows: list[dict], *, lot=None) -> list[dict]:
    """Die Zeilen von der besten zur schlechtesten: ``{row, place, by, points_per_game, map_diff_per_game}``. ``place`` ist für Gleiche
    derselbe. ``by`` sagt, was die Zeile von der davor trennt (``ppg``, ``map_diff``, ``lot``) - ``None`` bei der ersten und bei Gleichen.
    ``lot(gruppe) -> gruppe`` ordnet Gleiche als letzten Schritt; ohne bleibt der Gleichstand stehen."""
    keyed = sorted(((per_game(row), index, row) for index, row in enumerate(rows)), key=lambda item: (-item[0][0], -item[0][1], item[1]))
    groups: list[list[tuple]] = []
    for item in keyed:
        if groups and groups[-1][0][0] == item[0]:
            groups[-1].append(item)
        else:
            groups.append([item])
    out: list[dict] = []
    previous = None
    for group in groups:
        key = group[0][0]
        by = None if previous is None else PPG if key[0] != previous[0] else MAP_DIFF
        members = [item[2] for item in group]
        ordered = list(lot(members)) if lot and len(members) > 1 else members
        place = len(out) + 1
        for offset, row in enumerate(ordered):
            separate = bool(lot) and len(members) > 1
            out.append({"row": row, "place": place + offset if separate else place,
                        "by": (by if offset == 0 else LOT) if separate else by,
                        "points_per_game": float(key[0]), "map_diff_per_game": float(key[1])})
        previous = key
    return out


def pick(rows: list[dict], count: int, *, worst: bool = False) -> dict:
    """Die ``count`` besten Zeilen (``worst``: die schlechtesten). ``chosen``: wer sicher dabei ist. Liegt die Grenze mitten in einer
    Gruppe Gleicher, steht die Gruppe unter ``tied`` und ``open`` sagt, wie viele aus ihr noch dazukommen - das entscheidet die Leitung.
    ``order``: alle Zeilen wie aus ``ranked``."""
    order = ranked(rows)
    count = max(int(count or 0), 0)
    line = list(reversed(order)) if worst else order
    if count >= len(line):
        return {"chosen": [item["row"] for item in line], "tied": [], "open": 0, "order": order}
    if not count:
        return {"chosen": [], "tied": [], "open": 0, "order": order}
    edge = line[count - 1]["place"]
    if line[count]["place"] != edge:
        return {"chosen": [item["row"] for item in line[:count]], "tied": [], "open": 0, "order": order}
    chosen = [item["row"] for item in line if (item["place"] > edge if worst else item["place"] < edge)]
    return {"chosen": chosen, "tied": [item["row"] for item in line if item["place"] == edge], "open": count - len(chosen), "order": order}
