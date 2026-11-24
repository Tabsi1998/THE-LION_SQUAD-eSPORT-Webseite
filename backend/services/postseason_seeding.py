"""Setzliste der Playoffs und Paarungen der Relegation aus dem Endstand (#2404, docs/LIGA.md „F.6 … Setzliste aus dem Endstand“).

Blatt-Modul ohne Datenbank: Es rechnet nur. Wer aus welcher Staffel wie platziert ist, sagen die Zeilen des Endstands; verglichen
wird über Staffeln hinweg mit ``league_cross_rank.ranked`` (Punkte je Spiel, Map-Differenz je Spiel) - hier steht keine zweite Rechnung.

- **Wer spielt** (Nr. 203): je Staffel die ersten ``per_staffel`` in der Reihenfolge der Zonen (``league_zones.ordered``), ohne
  Ausgeschiedene. Wer nach dem Abschluss ausgeschieden ist (``gone``), wird ausgelassen - der Nächste derselben Staffel rückt nach und
  übernimmt den Platz in der Platzgruppe (Nr. 217).
- **Über Kreuz** (Nr. 206, 221): Die Staffelsieger werden einmal gereiht; diese Reihenfolge der Staffeln gilt für jede Platzgruppe. Erst
  alle Ersten, dann alle Zweiten - mit der Verteilung im Baum (1-N, 2-(N−1)) ergibt das A1-B2 und B1-A2. Ab drei Staffeln wird in der
  unteren Platzgruppe getauscht, bis keine Paarung der ersten Runde aus derselben Staffel kommt.
- **Los** (Nr. 225): nur als letzter Schritt unter Gleichen und nur, wenn der Aufrufer ``lot`` mitgibt (beim Anlegen). Ohne ``lot``
  bleiben die Gleichen in der Reihenfolge der Staffeln stehen und unter ``open_lot`` genannt - so lost die Vorschau nie.
- **Relegation** (Nr. 212): die Relegationsplätze unten der oberen Liga N gegen die oben der unteren, bester Oberer gegen
  schlechtesten Unteren. Die Zahl muss aufgehen.

Auch für #1559 (Gruppen → K.-o. im Turnier) gedacht: Die Eingabe sind schlichte Tabellen, nichts hier weiß von Ligen.
"""
from __future__ import annotations

import hashlib

from services import league_cross_rank, league_zones

PLAYOFF_TIE = "playoff"
ADD_UP = ("Die Relegation geht nicht auf: {upper} {upper_word} oben ({upper_label}) gegen {lower} {lower_word} unten ({lower_label}). "
          "Bitte die Relegationsplätze der beiden Ligen angleichen.")
NO_PLACES = "In beiden Ligen ist kein Relegationsplatz eingestellt."


def _rank(row: dict) -> int:
    try:
        return int(row.get("rank") or 0)
    except (TypeError, ValueError):
        return 0


def _name(row: dict) -> str:
    return row.get("display_name") or "Team"


def qualified(rows: list[dict], per_staffel: int, gone=()) -> list[dict]:
    """Die Teams einer Staffel, die in die Playoffs kommen - in der Reihenfolge der Tabelle."""
    count = max(int(per_staffel or 0), 0)
    if not count:
        return []
    out = [row for row in league_zones.ordered(rows) if not row.get("exit") and row.get("registration_id") and row["registration_id"] not in set(gone)]
    return out[:count]


def mark(rows: list[dict], per_staffel: int) -> list[dict]:
    """Schreibt ``playoff: True`` an die qualifizierten Zeilen - erst mit dem ersten gewerteten Spiel, ohne Playoffs gar nichts."""
    if not per_staffel or not league_zones.started(rows):
        return rows
    chosen = {row["registration_id"] for row in qualified(rows, per_staffel)}
    for row in rows:
        if row.get("registration_id") in chosen:
            row["playoff"] = True
        else:
            row.pop("playoff", None)
    return rows


def boundary_ties(rows: list[dict], per_staffel: int) -> list[dict]:
    """Echter Gleichstand an der Playoff-Grenze (Nr. 203): Teams auf demselben Platz, von denen nur ein Teil hineinkäme."""
    if not per_staffel or not league_zones.started(rows):
        return []
    chosen = {row["registration_id"] for row in qualified(rows, per_staffel)}
    groups: dict[int, list[dict]] = {}
    for row in league_zones.ordered(rows):
        if not row.get("exit") and _rank(row) and row.get("registration_id"):
            groups.setdefault(_rank(row), []).append(row)
    out = []
    for rank in sorted(groups):
        group = groups[rank]
        inside = [row for row in group if row["registration_id"] in chosen]
        if len(group) > 1 and 0 < len(inside) < len(group):
            out.append({"kind": PLAYOFF_TIE, "rank": rank, "registration_ids": [row["registration_id"] for row in group],
                        "names": [_name(row) for row in group], "points": group[0].get("points")})
    return out


# ---------------------------------------------------------------- Baum

def bracket_size(count: int) -> int:
    size = 2
    while size < count:
        size *= 2
    return size


def rounds(count: int) -> int:
    """Wie viele Runden ein Einfach-K.-o. mit ``count`` Teams hat (zwei Teams: eine)."""
    size, out = bracket_size(max(count, 2)), 0
    while size > 1:
        size //= 2
        out += 1
    return out


def byes(count: int) -> int:
    return bracket_size(max(count, 2)) - count if count >= 2 else 0


def _positions(size: int) -> list[int]:
    """Die Verteilung der Setzplätze im Baum - dieselbe wie ``custom_bracket._seed_positions`` (ein Test hält beide gleich)."""
    if size <= 1:
        return [1]
    out = []
    for seed in _positions(size // 2):
        out += [seed, size + 1 - seed]
    return out


def first_round(count: int) -> list[dict]:
    """Die Paarungen der ersten Runde als Setzplätze: ``{order, a, b}`` - ``b`` ist ``None`` bei einem Freilos."""
    if count < 2:
        return []
    order = _positions(bracket_size(count))
    return [{"order": index // 2 + 1, "a": order[index] if order[index] <= count else None,
             "b": order[index + 1] if order[index + 1] <= count else None} for index in range(0, len(order), 2)]


# ---------------------------------------------------------------- Setzliste

def _order_groups(rows: list[dict], lot) -> tuple[list[dict], list[list[dict]], list[dict]]:
    """Zeilen über Staffeln hinweg gereiht: (Reihenfolge aus ``league_cross_rank.ranked``, offene Gruppen Gleicher, geloste Gruppen)."""
    draws: list[dict] = []

    def record(group: list[dict]) -> list[dict]:
        ordered = list(lot(list(group)))
        draws.append({"registration_ids": [row["registration_id"] for row in group], "names": [_name(row) for row in group],
                      "order": [row["registration_id"] for row in ordered]})
        return ordered

    order = league_cross_rank.ranked(rows, lot=record if lot else None)
    open_groups: list[list[dict]] = []
    if not lot:
        by_place: dict[int, list[dict]] = {}
        for item in order:
            by_place.setdefault(item["place"], []).append(item["row"])
        open_groups = [group for group in by_place.values() if len(group) > 1]
    return order, open_groups, draws


def _conflicts(entries: list[dict]) -> list[tuple[int, int]]:
    """Paarungen der ersten Runde aus derselben Staffel - als Stellen in ``entries`` (0-basiert)."""
    out = []
    for pair in first_round(len(entries)):
        if pair["a"] and pair["b"] and entries[pair["a"] - 1]["tournament_id"] == entries[pair["b"] - 1]["tournament_id"]:
            out.append((min(pair["a"], pair["b"]) - 1, max(pair["a"], pair["b"]) - 1))
    return out


def _untangle(entries: list[dict]) -> int:
    """Tauscht benachbarte Setzplätze derselben Platzgruppe, bis keine Erstrundenpaarung mehr aus derselben Staffel kommt (Nr. 221).
    Gibt zurück, wie oft getauscht wurde. Findet sich kein Tausch, der hilft, bleibt die Paarung stehen."""
    swaps = 0
    for _guard in range(len(entries) * len(entries) + 1):
        found = _conflicts(entries)
        if not found:
            break
        improved = False
        for _upper, lower in found:
            group = entries[lower]["group"]
            near = sorted((index for index, entry in enumerate(entries) if entry["group"] == group and index != lower),
                          key=lambda index: (abs(index - lower), index))
            for other in near:
                entries[lower], entries[other] = entries[other], entries[lower]
                if len(_conflicts(entries)) < len(found):
                    swaps += 1
                    improved = True
                    break
                entries[lower], entries[other] = entries[other], entries[lower]
            if improved:
                break
        if not improved:
            break
    return swaps


def seed(tables: list[dict], per_staffel: int, *, gone=(), lot=None) -> dict:
    """Die Setzliste einer Liga N. ``tables``: je reguläre Staffel ``{tournament_id, staffel, rows}`` in der Reihenfolge der Staffeln.
    ``lot(gruppe) -> gruppe`` ordnet gleich stehende Staffelsieger (nur beim Anlegen, Nr. 225).

    Antwort: ``seeds`` (``{seed, registration_id, display_name, tournament_id, staffel, rank, tie}`` - ``tie`` sagt, was die Staffel
    von der davor trennt), ``order`` (die Staffeln in der Reihenfolge der Setzung), ``open_lot`` (Namen gleich stehender Staffelsieger,
    solange nicht gelost ist), ``draws`` (was gelost wurde) und ``swaps`` (Tausche gegen staffelgleiche Paarungen)."""
    chosen = {table["tournament_id"]: qualified(table.get("rows") or [], per_staffel, gone) for table in tables}
    present = [table for table in tables if chosen[table["tournament_id"]]]
    if not present:
        return {"seeds": [], "order": [], "open_lot": [], "draws": [], "swaps": 0}
    origin = {chosen[table["tournament_id"]][0]["registration_id"]: table for table in present}
    order, open_groups, draws = _order_groups([chosen[table["tournament_id"]][0] for table in present], lot)
    staffeln = [(origin[item["row"]["registration_id"]], item["by"]) for item in order]
    entries: list[dict] = []
    depth = max(len(rows) for rows in chosen.values())
    for group in range(depth):
        for table, by in staffeln:
            rows = chosen[table["tournament_id"]]
            if group < len(rows):
                row = rows[group]
                entries.append({"group": group, "registration_id": row["registration_id"], "display_name": _name(row),
                                "tournament_id": table["tournament_id"], "staffel": table.get("staffel"), "rank": row.get("rank"),
                                "tie": by, "points_per_game": round(float(league_cross_rank.per_game(row)[0]), 3),
                                "map_diff_per_game": round(float(league_cross_rank.per_game(row)[1]), 3)})
    swaps = _untangle(entries) if len(present) > 1 else 0
    seeds = [{"seed": index + 1, **{key: value for key, value in entry.items() if key != "group"}} for index, entry in enumerate(entries)]
    return {"seeds": seeds, "order": [table["tournament_id"] for table, _by in staffeln],
            "open_lot": [[_name(row) for row in group] for group in open_groups], "draws": draws, "swaps": swaps}


# ---------------------------------------------------------------- Relegation

def _zone_side(tables: list[dict], zone: str, lot) -> tuple[list[dict], list[list[str]], list[dict]]:
    """Die Teams einer Seite der Relegation, vom besten zum schlechtesten: erst nach dem Platz in der Zone, unter gleich Platzierten
    verschiedener Staffeln nach ``league_cross_rank`` (zuletzt das Los, wenn eines mitgegeben ist)."""
    groups: dict[int, list[dict]] = {}
    origin: dict[str, dict] = {}
    for table in tables:
        inside = [row for row in league_zones.ordered(table.get("rows") or []) if row.get("zone") == zone and not row.get("exit")
                  and row.get("registration_id")]
        for index, row in enumerate(inside):
            groups.setdefault(index, []).append(row)
            origin[row["registration_id"]] = table
    out, open_lot, draws = [], [], []
    for index in sorted(groups):
        order, open_groups, drawn = _order_groups(groups[index], lot)
        draws += drawn
        open_lot += [[_name(row) for row in group] for group in open_groups]
        for item in order:
            row, table = item["row"], origin[item["row"]["registration_id"]]
            out.append({"registration_id": row["registration_id"], "display_name": _name(row), "tournament_id": table["tournament_id"],
                        "staffel": table.get("staffel"), "rank": row.get("rank"), "tie": item["by"]})
    return out, open_lot, draws


def relegation_pairs(upper_tables: list[dict], lower_tables: list[dict], *, lot=None, upper_label: str = "obere Liga",
                     lower_label: str = "untere Liga") -> dict:
    """Die Paarungen der Relegation (Nr. 212): ``pairs`` (``{upper, lower}``, das obere Team hat Heimrecht), ``problem`` (Klartext,
    wenn die Zahl nicht aufgeht oder es keine Plätze gibt), ``open_lot`` und ``draws`` wie bei der Setzliste."""
    upper, open_upper, draws_upper = _zone_side(upper_tables, league_zones.PLAYOFF_RELEGATION, lot)
    lower, open_lower, draws_lower = _zone_side(lower_tables, league_zones.PLAYOFF_PROMOTION, lot)
    base = {"upper_count": len(upper), "lower_count": len(lower), "open_lot": open_upper + open_lower, "draws": draws_upper + draws_lower}
    if not upper and not lower:
        return {**base, "pairs": [], "problem": NO_PLACES}
    if len(upper) != len(lower):
        return {**base, "pairs": [], "problem": ADD_UP.format(
            upper=len(upper), upper_word="Team" if len(upper) == 1 else "Teams", upper_label=upper_label,
            lower=len(lower), lower_word="Team" if len(lower) == 1 else "Teams", lower_label=lower_label)}
    return {**base, "pairs": [{"upper": upper[index], "lower": lower[-(index + 1)]} for index in range(len(upper))], "problem": None}


# ---------------------------------------------------------------- Fingerabdruck

def stamp(parts, *extra) -> str:
    """Der Fingerabdruck der benutzten Fassungen (dieselbe Bauart wie in ``league_successor``): ändert sich ein Endstand, eine
    Einstellung oder wer ausgeschieden ist, ändert er sich. Ohne Fassungen leer."""
    rows = sorted(str(part) for part in parts or [])
    if not rows:
        return ""
    return hashlib.sha1("|".join([*rows, *(str(item) for item in extra)]).encode("utf-8")).hexdigest()[:12]
