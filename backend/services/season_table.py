"""Saisontabelle des Veranstalters einlesen (#1928) - ohne Datenbank: Wer eine laufende Saison später anlegt, liest die
Gesamttabelle (Fahrer, Team, Punkte je Runde, Gesamt) ein, statt jede vergangene Runde einzeln einzutragen. Je Runde
entsteht ein Ergebnis-Entwurf; Laden, Prüfen und Speichern machen die Routen
(``routes/reference_season_table_routes.py``) mit denselben Bausteinen wie das Eintragen (#1744) und die
Partner-Plattform (#1964).

- **Zellen** (``read_cell``): Zahl = Punkte, „OUT“/„DNF“ = Ausfall, „DSQ“, „DNS“; „--“ bzw. leer = nicht angetreten
  (keine Zeile im Blatt). Was sich nicht lesen lässt, ist ein Fehler der Spalte - nichts wird still verschluckt.
- **Spalten → Termine** (``match_columns``): Gewählt geht vor; sonst das Kürzel („R1“, mit Lauf „R1 Sprint“, #1930),
  dann Strecke bzw. Titel, dann die Flagge bzw. das Land, zuletzt die Reihenfolge der Runden im Kalender. Jeder Termin
  höchstens einmal; abgesagte und archivierte stehen nicht zur Wahl. Eine Runde mit Läufen nimmt ohne Lauf im Kopf das
  Rennen (das letzte, wenn es mehrere gibt).
- **Platz aus den Punkten** (``place_candidates``, ``build_column``): über das Punkteschema des Termins (je Lauf, #1930)
  samt Boni - schnellste Runde und Pole mit Punkten, eigene Sonderboni (#1961, „21 = 18 + 3 Bingo“). Eindeutig heißt
  genau ein Platz; mehrere Möglichkeiten werden mit den übrigen Plätzen derselben Runde eingegrenzt. Gelb zum Klären
  bleiben: mehrere Plätze, ein Bonus im Wert, Punkte außerhalb des Schemas und zwei Fahrer auf demselben Platz. Bis zur
  Klärung zählt der Wert der Tabelle ohne Platz, damit die Summe stimmt - übernommen wird so eine Runde erst geklärt.
  0 Punkte heißt „hinter den Punkterängen“: ohne Platz, ohne Meldung.
- **Punkte laut Veranstalter** (``organizer``): ohne Rückrechnung, der Wert zählt wie eingetragen - mit Hinweis, wenn
  er nicht im Schema liegt. Eine Saison „Punkte laut Veranstalter“ rechnet nie zurück.
- **Abgleich** (``explain_total``): die eigene Rechnung gegen die Spalte „Gesamt“; eine Abweichung ist erklärt, wenn
  sie genau aus Streichresultaten, Anpassungen, Aktivitäts- bzw. Sonderpunkten, nicht übernommenen Spalten oder Runden
  außerhalb der Tabelle entsteht.
"""
from __future__ import annotations

import math
from collections import Counter
from itertools import combinations

from services import race_weekend
from services.round_countries import COUNTRIES, detect_country
from services.scoring_rules import result_points
from services.series_identity import normalize_name
from services.series_results import clean, number
from services.series_standings import ordered_rounds
from services.tournament_days import bonus_points

MAX_COLUMNS = 60
MAX_ROWS = 300
MAX_CELL = 20
MAX_BONUS_ITEMS = 3

ABSENT = frozenset({"", "-", "--", "---", "–", "—", "/", "n/a"})
MARK_WORDS = {"out": "dnf", "dnf": "dnf", "ret": "dnf", "ausfall": "dnf", "dnf/out": "dnf", "out/dnf": "dnf",
              "dsq": "dsq", "dq": "dsq", "disq": "dsq", "dns": "dns"}
REASONS = {
    "ignored": "nicht übernommene Spalten",
    "sheet": "Punkte im Blatt anders als in der Zelle (Schlüssel, Boni, Termin ohne Wertung)",
    "dropped": "Streichresultate",
    "activity": "Aktivitätspunkte",
    "adjustment": "Anpassungen",
    "other": "Runden ohne Spalte in der Tabelle",
}
REGIONAL_A = 0x1F1E6


# ---------------------------------------------------------------- Zellen
def _number(text: str):
    """Zahl wie „25“, „12,5“, „-3“ - ohne regulären Ausdruck; sonst ``None``."""
    body = text[1:] if text[:1] in ("-", "+") else text
    digits = separators = 0
    for char in body:
        if char.isascii() and char.isdigit():
            digits += 1
        elif char in ",." and digits and not separators:
            separators += 1
        else:
            return None
    if not digits or body.endswith((",", ".")):
        return None
    value = float(text.replace(",", "."))
    return number(value) if math.isfinite(value) else None


def read_cell(text) -> dict:
    """Eine Zelle: ``{"kind": "points", "value"}``, ``{"kind": "mark", "mark"}``, ``{"kind": "absent"}`` oder
    ``{"kind": "unreadable"}``."""
    value = clean(text)
    if value.casefold() in ABSENT:
        return {"kind": "absent"}
    mark = MARK_WORDS.get("".join(value.split()).casefold())
    if mark:
        return {"kind": "mark", "mark": mark}
    points = _number(value)
    if points is None:
        return {"kind": "unreadable"}
    return {"kind": "points", "value": points}


# ---------------------------------------------------------------- Spalten → Termine
def header_country(text) -> str | None:
    """Land aus dem Kopf einer Spalte: Flagge (zwei Regionalbuchstaben), ISO-Code oder Land, Strecke bzw. Stadt."""
    value = clean(text)
    letters = [ord(char) - REGIONAL_A for char in value if REGIONAL_A <= ord(char) <= REGIONAL_A + 25]
    if len(letters) == 2:
        code = chr(65 + letters[0]) + chr(65 + letters[1])
        return code if code in COUNTRIES else None
    if len(value) == 2 and value.upper() in COUNTRIES:
        return value.upper()
    return detect_country(value)


def round_choices(rounds: list[dict]) -> list[dict]:
    """Termine, die eine Spalte bekommen können: nicht archiviert, nicht abgesagt - in Kalender-Reihenfolge."""
    return [item for item in ordered_rounds(rounds)
            if not item.get("archived_at") and item.get("status") != "cancelled"]


def _groups(choices: list[dict], weekend: dict | None) -> list[list[dict]]:
    return [group["rounds"] for group in race_weekend.weekend_groups(choices, weekend)]


def _pick_run(runs: list[dict], session: str | None) -> dict | None:
    """Der Lauf einer Runde: der im Kopf genannte, sonst das Rennen (das letzte), sonst der einzige Termin."""
    if session:
        kind = race_weekend.session_kind(session)
        wanted = race_weekend.label_key(session)
        named = [item for item in runs if race_weekend.label_key(item.get("session")) == wanted]
        same_kind = [item for item in runs if race_weekend.session_kind(item.get("session")) == kind]
        found = named or same_kind
        return found[-1] if found else None
    races = [item for item in runs if race_weekend.session_kind(item.get("session")) == "race"]
    return (races or runs)[-1] if runs else None


def _by_code(label: str, groups: list[list[dict]], used: set[str]) -> dict | None:
    code, session, rest = race_weekend.take_code(label)
    if not code or clean(rest):
        return None
    key = "".join(code.split()).casefold()
    for runs in groups:
        if race_weekend.weekend_key(runs[0]) == key:
            found = _pick_run([item for item in runs if item["id"] not in used], session)
            return found
    return None


def _by_title(label: str, choices: list[dict], used: set[str]) -> dict | None:
    """Strecke bzw. Titel: erst gleich, dann enthalten (ab vier Zeichen) - nur, wenn es genau eine Runde trifft."""
    key = normalize_name(label)
    if len(key) < 3:
        return None
    free = [item for item in choices if item["id"] not in used]
    hits = [item for item in free if key in (normalize_name(item.get("title")), normalize_name(item.get("venue")))]
    if not hits and len(key) >= 4:
        hits = [item for item in free
                if key in normalize_name(item.get("title")) or key in normalize_name(item.get("venue"))]
    units = {race_weekend.weekend_key(item) or item["id"] for item in hits}
    return _pick_run(hits, None) if len(units) == 1 else None


def _by_country(label: str, groups: list[list[dict]], used: set[str]) -> dict | None:
    code = header_country(label)
    if not code:
        return None
    for runs in groups:
        free = [item for item in runs if item["id"] not in used]
        if free and any(item.get("country_code") == code for item in runs):
            return _pick_run(free, None)
    return None


def match_columns(labels: list[str], wanted: list, rounds: list[dict], weekend: dict | None = None) -> list[dict]:
    """Je Spalte ``{"round_id", "how"}`` - ``how``: ``chosen``, ``code``, ``title``, ``country``, ``order``, ``skip``
    (Spalte nicht übernehmen) oder ``None`` (nichts gefunden). ``wanted[i]``: Kennung, ``""`` oder ``None`` (selbst)."""
    choices = round_choices(rounds)
    by_id = {item["id"]: item for item in choices}
    groups = _groups(choices, weekend)
    out: list[dict] = [{"round_id": None, "how": None} for _ in labels]
    used: set[str] = set()
    auto = []
    for index, choice in enumerate(wanted):
        if choice == "":
            out[index]["how"] = "skip"
        elif choice:
            if choice in by_id and choice not in used:
                out[index] = {"round_id": choice, "how": "chosen"}
                used.add(choice)
        else:
            auto.append(index)
    for how, finder in (("code", lambda label: _by_code(label, groups, used)),
                        ("title", lambda label: _by_title(label, choices, used)),
                        ("country", lambda label: _by_country(label, groups, used))):
        for index in auto:
            if out[index]["round_id"]:
                continue
            found = finder(clean(labels[index]))
            if found:
                out[index] = {"round_id": found["id"], "how": how}
                used.add(found["id"])
    # Reihenfolge: die k-te Spalte ist die k-te Runde des Kalenders (wenn noch kein Lauf davon vergeben ist).
    for index in auto:
        if out[index]["round_id"] or index >= len(groups):
            continue
        free = [item for item in groups[index] if item["id"] not in used]
        found = _pick_run(free, None) if len(free) == len(groups[index]) else None
        if found:
            out[index] = {"round_id": found["id"], "how": "order"}
            used.add(found["id"])
    return out


# ---------------------------------------------------------------- Rückrechnung
def _same(left, right) -> bool:
    return abs(float(left) - float(right)) < 1e-9


def _bonus_items(rules: dict) -> list[dict]:
    items = []
    for mark in ("fastest_lap", "pole"):
        config = rules["bonuses"][mark]
        if config["points"]:
            items.append({"mark": mark, "key": None, "points": config["points"], "max_place": config["max_place"]})
    for bonus in rules["custom_bonuses"]:
        if bonus["points"]:
            items.append({"mark": None, "key": bonus["key"], "points": bonus["points"], "max_place": None,
                          "label": bonus["label"]})
    return items


def place_candidates(value, rules: dict) -> list[dict]:
    """Welche Plätze (samt Boni) ``value`` Punkte ergeben: ``[{"place", "bonus_keys", "marks"}]`` - ohne Bonus zuerst.
    ``place`` ist ``None``, wenn der Bonus allein den Wert ergibt (hinter den Punkterängen)."""
    scheme = rules["points_by_place"]
    items = _bonus_items(rules)
    out = []
    for size in range(0, min(MAX_BONUS_ITEMS, len(items)) + 1):
        for chosen in combinations(items, size):
            rest = float(value) - sum(item["points"] for item in chosen)
            limit = min([item["max_place"] for item in chosen if item["max_place"]] or [len(scheme)])
            places = [index + 1 for index, points in enumerate(scheme) if index < limit and _same(points, rest)]
            if size and _same(rest, 0) and not places and all(item["max_place"] is None for item in chosen):
                places = [None]
            for place in places:
                out.append({"place": place, "bonus_keys": [item["key"] for item in chosen if item["key"]],
                            "marks": [item["mark"] for item in chosen if item["mark"]]})
    return out


def _label(candidate: dict, rules: dict) -> str:
    names = {bonus["key"]: bonus["label"] for bonus in rules["custom_bonuses"]}
    marks = {"fastest_lap": "schnellste Runde", "pole": "Pole"}
    parts = [f"Platz {candidate['place']}" if candidate["place"] else "ohne Platz"]
    parts += [marks[mark] for mark in candidate["marks"]] + [names.get(key, key) for key in candidate["bonus_keys"]]
    return " + ".join(parts)


def _in_scheme(value, rules: dict) -> bool:
    return any(_same(points, value) for points in rules["points_by_place"])


def _custom_points(keys, rules: dict) -> float:
    return sum(bonus["points"] for bonus in rules["custom_bonuses"] if bonus["key"] in set(keys or []))


def _narrow(pending: dict[int, list[dict]], decided: dict[int, int]) -> None:
    """Mehrere Möglichkeiten mit den übrigen Plätzen der Runde eingrenzen (an Ort und Stelle): ein Platz, den eine
    andere Zelle sicher hat, fällt weg - solange etwas übrig bleibt."""
    changed = True
    while changed:
        changed = False
        sure = [cands[0]["place"] for cands in pending.values() if len(cands) == 1 and cands[0]["place"]]
        taken = Counter([*decided.values(), *sure])
        for row, cands in pending.items():
            if len(cands) < 2:
                continue
            kept = [item for item in cands if not item["place"] or not taken[item["place"]]]
            if kept and len(kept) < len(cands):
                pending[row] = kept
                changed = True


def _decided_row(value, decision: dict, rules: dict, own_source: str) -> dict:
    if decision.get("choice") == "organizer":
        return {"place": None, "points": value, "points_source": own_source, "marks": [], "bonus_keys": []}
    known = {bonus["key"] for bonus in rules["custom_bonuses"]}
    keys = [key for key in dict.fromkeys(decision.get("bonus_keys") or []) if key in known]
    marks = sorted({mark for mark in decision.get("marks") or [] if mark in ("fastest_lap", "pole")})
    return {"place": decision.get("place"), "points": number(value - _custom_points(keys, rules)),
            "points_source": "organizer", "marks": marks, "bonus_keys": keys}


def build_column(cells: list, rules: dict, *, names: list[str], teams: list, organizer: bool = False,
                 decisions: dict[int, dict] | None = None) -> dict:
    """Das Blatt einer Spalte: ``rows`` (Zeilen wie beim Eintragen, ``ResultSheetInput``), ``row_of`` (Zeile der Tabelle
    je Zeile), ``cells`` (je gefüllter Zelle Zustand und Vorschläge), ``unclear`` (offene gelbe Zellen), ``errors`` und
    ``placeless`` (Zeilen ohne Platz mit Absicht - die Meldung „Platz fehlt“ gilt dort nicht)."""
    decisions = decisions or {}
    by_organizer = rules["points_mode"] == "organizer"
    back = not organizer and not by_organizer
    own_source = "organizer" if by_organizer else "manual"
    entries: dict[int, dict] = {}
    states: dict[int, dict] = {}
    pending: dict[int, list[dict]] = {}
    decided: dict[int, int] = {}
    errors = []
    for row, text in enumerate(cells):
        cell = read_cell(text)
        if cell["kind"] == "absent":
            continue
        base = {"row": row, "text": clean(text)[:MAX_CELL], **cell}
        if cell["kind"] == "unreadable":
            message = (f"„{base['text']}“ bei „{names[row]}“ ist keine Punktzahl - erlaubt sind Zahlen, OUT, DNF, DSQ, "
                       "DNS, -- oder leer.")
            states[row] = {**base, "state": "error", "code": "unreadable", "message": message}
            errors.append({"code": "unreadable_cell", "message": message, "rows": [row]})
            continue
        if cell["kind"] == "mark":
            points = 0 if by_organizer and cell["mark"] != "dns" else None
            entries[row] = {"place": None, "points": points, "points_source": own_source if points is not None
                            else "scheme", "marks": [cell["mark"]], "bonus_keys": []}
            states[row] = {**base, "state": "ok", "code": "mark"}
            continue
        value = cell["value"]
        decision = decisions.get(row)
        if decision and (back or decision.get("choice") == "organizer"):
            entries[row] = _decided_row(value, decision, rules, own_source)
            if entries[row]["place"]:
                decided[row] = entries[row]["place"]
            states[row] = {**base, "state": "ok", "code": "decided", "place": entries[row]["place"]}
            continue
        if not back:
            entries[row] = {"place": None, "points": value, "points_source": own_source, "marks": [], "bonus_keys": []}
            outside = not by_organizer and not _same(value, 0) and not _in_scheme(value, rules)
            states[row] = {**base, "state": "note" if outside else "ok",
                           "code": "outside_scheme" if outside else "organizer"}
            continue
        if _same(value, 0):
            entries[row] = {"place": None, "points": 0, "points_source": "organizer", "marks": [], "bonus_keys": []}
            states[row] = {**base, "state": "ok", "code": "zero"}
            continue
        pending[row] = place_candidates(value, rules)

    _narrow(pending, decided)
    singles = Counter(cands[0]["place"] for cands in pending.values() if len(cands) == 1 and cands[0]["place"])
    singles.update(decided.values())
    for row, cands in pending.items():
        value = read_cell(cells[row])["value"]
        base = {"row": row, "text": clean(cells[row])[:MAX_CELL], "kind": "points", "value": value}
        labelled = [{**item, "label": _label(item, rules)} for item in cands]
        single = cands[0] if len(cands) == 1 else None
        if single and single["place"] and singles[single["place"]] > 1:
            code = "shared"
        elif not cands:
            code = "outside"
        elif len(cands) > 1:
            code = "ambiguous"
        elif single["bonus_keys"] or single["marks"] or not single["place"]:
            code = "bonus"
        else:
            entries[row] = {"place": single["place"], "points": value, "points_source": "organizer", "marks": [],
                            "bonus_keys": []}
            states[row] = {**base, "state": "ok", "code": "place", "place": single["place"]}
            continue
        # Gelb: bis zur Klärung zählt der Wert der Tabelle ohne Platz.
        entries[row] = {"place": None, "points": value, "points_source": own_source, "marks": [], "bonus_keys": []}
        states[row] = {**base, "state": "unclear", "code": code, "candidates": labelled}

    rows, row_of, placeless = [], [], []
    for row in sorted(entries):
        team = clean(teams[row] if row < len(teams) else None)[:120] or None
        entry = {"name": names[row], "team": team, **entries[row]}
        if not entry["place"]:
            placeless.append(len(rows))
        rows.append(entry)
        row_of.append(row)
    ordered = [states[row] for row in sorted(states)]
    return {"rows": rows, "row_of": row_of, "cells": ordered, "errors": errors, "placeless": placeless,
            "unclear": sum(1 for item in ordered if item["state"] == "unclear")}


def with_totals(content: dict | None, rules: dict) -> dict | None:
    """Das Blatt mit ``points_total`` je Zeile - die Punkte, wie sie zählen (Schlüssel bzw. Wert samt Bonus und
    Sonderboni). Nur zum Vergleichen: ein Blatt mit Plätzen ohne Punkte und dieselbe Runde aus der Tabelle (Punkte laut
    Veranstalter) sind gleich, wenn sie gleich zählen."""
    if content is None:
        return None
    rows = []
    for row in content.get("rows") or []:
        scored = result_points(row, rules)["points"] if row.get("participant_id") else 0
        rows.append({**row, "points_total": number(scored + bonus_points(row, rules)[0])})
    return {**content, "rows": rows}


# ---------------------------------------------------------------- Abgleich mit „Gesamt“
def _total(values) -> float:
    return number(float(sum(values)))


def total_parts(values: list, mapped: list[bool], standing: dict | None, mapped_ids: set[str]) -> tuple:
    """Eine Zeile der Tabelle: Summe ihrer Zellen, die eigene Rechnung (``computed_points`` des Stands) und was beide
    trennt - so, dass ``Summe + Gründe = gerechnet`` gilt. ``values``: Punkte je Spalte (``None`` ohne Zahl),
    ``mapped``: ob die Spalte übernommen wird, ``standing``: die Zeile des Fahrers im Stand nach allen Runden."""
    cell_sum = _total(value for value in values if value is not None)
    ignored = _total(value for value, used in zip(values, mapped) if value is not None and not used)
    if not standing:
        return cell_sum, 0, {"ignored": -ignored, "sheet": -(cell_sum - ignored)}
    results = standing.get("results") or []
    dropped_ids = set(standing.get("dropped_round_ids") or [])
    inside = _total((item["points"] or 0) + (item.get("bonus") or 0) for item in results
                    if item["round_id"] in mapped_ids)
    other = _total((item["points"] or 0) + (item.get("bonus") or 0) for item in results
                   if item["round_id"] not in mapped_ids)
    dropped = _total(item["points"] or 0 for item in results if item["round_id"] in dropped_ids)
    return cell_sum, standing["computed_points"], {
        "ignored": -ignored, "sheet": number(inside - (cell_sum - ignored)), "dropped": -dropped,
        "activity": standing.get("activity_points") or 0, "adjustment": standing.get("adjustment_points") or 0,
        "other": other}


def table_ranks(ranks: list, totals: list) -> list:
    """Platz laut Tabelle: die Spalte „Platz“, sonst aus „Gesamt“ (gleiche Summe, gleicher Platz: 1, 2, 2, 4)."""
    if any(rank is not None for rank in ranks):
        return list(ranks)
    given = sorted((total for total in totals if total is not None), reverse=True)
    return [None if total is None else next(index for index, value in enumerate(given, start=1) if _same(value, total))
            for total in totals]


def explain_total(table_total, computed, components: dict) -> dict:
    """Gerechnet gegen „Gesamt“ der Tabelle. ``components``: was die eigene Rechnung von der Summe der Zellen trennt
    (``ignored``, ``sheet``, ``dropped``, ``activity``, ``adjustment``, ``other``) - je mit Vorzeichen.
    ``state``: ``ok``, ``explained`` (die Abweichung entsteht genau aus einigen Gründen), ``differs`` oder
    ``no_total``."""
    reasons = [{"kind": kind, "points": number(value), "text": REASONS.get(kind, kind)}
               for kind, value in components.items() if value and not _same(value, 0)]
    if table_total is None:
        return {"state": "no_total", "deviation": None, "reasons": reasons, "explains": []}
    deviation = number(float(computed) - float(table_total))
    if _same(deviation, 0):
        return {"state": "ok", "deviation": 0, "reasons": reasons, "explains": []}
    for size in range(1, len(reasons) + 1):
        for chosen in combinations(reasons, size):
            if _same(sum(item["points"] for item in chosen), deviation):
                return {"state": "explained", "deviation": deviation, "reasons": reasons, "explains": list(chosen)}
    return {"state": "differs", "deviation": deviation, "reasons": reasons, "explains": []}
