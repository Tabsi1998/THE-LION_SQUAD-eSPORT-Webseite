"""Zwischenstände externer Serien (#1741) - ohne Datenbank, gerechnet beim Schreiben und gespeichert je Runde.

``compute_standings`` bekommt Regeln, Kalender, die veröffentlichten Ergebnisblätter und die Teilnehmer und liefert je
gewerteter Runde einen Stand je Wertung (``scope``):

- ``drivers``: Fahrer bzw. Spieler - gezählte und gestrichene Runden, Aktivitätspunkte, Vorrang bei Gleichstand
  (``tiebreak`` nennt das Kriterium, das gegen die Zeile darüber entschieden hat) und der offizielle Wert des
  Veranstalters (``official_totals`` im Blatt der Runde) mit Abweichung zur eigenen Summe.
- ``teams``: Teamwertung, wenn eingeschaltet - je Rennen die besten ``counting_drivers`` eines Teams (Team je Rennen
  aus der Zeile, sonst das Standard-Team); ein Gast zählt fürs Team, wenn ``guests_count`` an ist. Ohne ein einziges
  Team gibt es keinen (leeren) Teamstand.
- ``table``: Tabelle einer Team-Liga aus den eingetragenen Spielen; hat das Blatt die Tabelle des Veranstalters
  (``official_table``), gilt sie, abgeglichen wird das eigene Team (``own_teams``).

Gewertet wird eine Runde mit Status ``scored`` und Blatt; Runden mit ``counts=False`` (etwa ein Finale außerhalb der
Wertung) bleiben draußen. Eine abgesagte Runde hat keinen Stand und zählt nicht zu den Runden des Kalenders, behält aber
ihre Nummer (``round_seq``). Namen stehen nicht im Stand, nur Kennungen - sie kommen beim Lesen dazu, damit Umbenennen
und Ausblenden nicht neu rechnen müssen. Gleiche Eingaben ergeben immer denselben Stand, egal in welcher Reihenfolge.
"""
from __future__ import annotations

import math

from services.own_teams import Matcher
from services.scoring_rules import (
    counted_results, league_table, normalize_rules, rank_with_ties, result_points, validate_sheet,
)

WORST = -math.inf
TABLE_FIELDS = ("played", "won", "drawn", "lost", "score_for", "score_against", "score_diff")
RESULT_FIELDS = ("round_id", "place", "points", "source", "marks", "team")
# Angaben aus dem Rennergebnis (#1927) - nur, wo eingetragen: Startnummer, Startplatz, Zeit, Abstand, schnellste Runde
# mit Zeit und Fahrer des Tages.
RACE_DETAILS = ("start_number", "grid", "time", "gap", "fastest_lap_time", "driver_of_the_day")


def ordered_rounds(rounds: list[dict]) -> list[dict]:
    """Kalender-Reihenfolge: ``order``, dann Startzeit, dann Kennung."""
    return sorted(rounds, key=lambda item: (item.get("order") or 0, str(item.get("starts_at") or ""),
                                            str(item.get("id"))))


def _number(value) -> float:
    return int(value) if isinstance(value, float) and value.is_integer() else value


# ---------------------------------------------------------------- Vorrang
def _stats(results: list[dict]) -> dict:
    """Siege, Podeste und Plätze aus Ergebnissen mit Wertung (ohne Nichtstart und Disqualifikation)."""
    places = [item["place"] for item in results
              if item["participated"] and item.get("place") and "dsq" not in item["marks"]]
    return {"places": places, "wins": places.count(1), "podiums": sum(1 for place in places if place <= 3),
            "best_place": min(places) if places else None,
            "by_round": {item["round_id"]: item["place"] for item in results
                         if item["participated"] and item.get("place") and "dsq" not in item["marks"]}}


def _criterion(name: str, stats: dict, max_place: int, latest_first: list[str]):
    if name == "wins":
        return stats["wins"]
    if name == "podiums":
        return stats["podiums"]
    if name == "countback":
        return tuple(stats["places"].count(place) for place in range(1, max_place + 1))
    if name == "best_place":
        return -stats["best_place"] if stats["best_place"] else WORST
    if name == "latest_result":
        by_round = stats["by_round"]
        return tuple(-by_round[round_id] if round_id in by_round else WORST for round_id in latest_first)
    raise ValueError(name)


def _rank(rows: list[dict], criteria: list[str], upto: list[dict], sort_name) -> None:
    """Rang nach Punkten und Vorrang, gleichrangige nach ``sort_name``; ``tiebreak`` an jeder Zeile, die bei gleichen
    Punkten wegen eines Kriteriums hinter der darüber steht."""
    max_place = max([place for row in rows for place in row["_stats"]["places"]] or [1])
    latest_first = [item["id"] for item in reversed(upto)]
    for row in rows:
        row["_criteria"] = [_criterion(name, row["_stats"], max_place, latest_first) for name in criteria]
    rank_with_ties(rows, lambda row: (row["points"], *row["_criteria"]))
    rows.sort(key=lambda row: (row["rank"], *sort_name(row)))
    for above, row in zip([None, *rows], rows):
        row["tiebreak"] = None
        if above and above["points"] == row["points"] and above["rank"] != row["rank"]:
            row["tiebreak"] = next(name for name, high, low in zip(criteria, above["_criteria"], row["_criteria"])
                                   if high != low)
    for row in rows:
        row.pop("_criteria", None)
        row.pop("_stats", None)


def _movement(rows: list[dict], key: str, previous: dict | None) -> dict:
    for row in rows:
        before = (previous or {}).get(row[key])
        row["rank_change"] = None if before is None else before - row["rank"]
    return {row[key]: row["rank"] for row in rows}


def _official(row: dict, official) -> None:
    row["official_points"] = None if official is None else _number(official)
    row["points"] = row["computed_points"] if official is None else row["official_points"]
    row["deviation"] = None if official is None else _number(row["official_points"] - row["computed_points"])


# ---------------------------------------------------------------- Fahrer und Spieler
def _results_by_participant(rules: dict, upto: list[dict], sheets: dict, seq_of: dict,
                            round_rules: dict | None = None) -> dict[str, list[dict]]:
    found: dict[str, list[dict]] = {}
    # Jeder Teilnehmer steht höchstens einmal im Blatt - das prüft validate_sheet vor dem Rechnen.
    for item in upto:
        sheet = sheets[item["id"]]
        fastest = sheet.get("fastest_lap") or {}
        for row in sheet.get("rows") or []:
            pid = row.get("participant_id")
            if not pid:
                continue
            # Punkte je Lauf (#1930): ein Sprint kann ein eigenes Schema haben.
            scored = result_points(row, (round_rules or {}).get(item["id"], rules))
            details = {key: row[key] for key in ("start_number", "grid", "time", "gap")
                       if row.get(key) not in (None, "")}
            if fastest.get("participant_id") == pid and fastest.get("time"):
                details["fastest_lap_time"] = fastest["time"]
            if sheet.get("driver_of_the_day") == pid:
                details["driver_of_the_day"] = True
            found.setdefault(pid, []).append({
                "round_id": item["id"], "seq": seq_of[item["id"]], "place": row.get("place") or None,
                "marks": sorted(set(row.get("marks") or [])), "team": row.get("team") or None,
                "points": scored["points"], "source": scored["source"], "participated": scored["participated"],
                **details,
            })
    return found


def _per_unit(results: list[dict], unit_of: dict, unit_seq: dict) -> list[dict]:
    """Ergebnisse je Einheit (#1930): mit Läufen eine Runde (Summe ihrer Läufe), sonst der Termin selbst."""
    units: dict = {}
    for item in results:
        key = unit_of.get(item["round_id"], item["round_id"])
        entry = units.setdefault(key, {"round_id": key, "seq": unit_seq.get(key, item["seq"]), "points": 0,
                                       "participated": False})
        entry["points"] += item["points"]
        entry["participated"] = entry["participated"] or item["participated"]
    return list(units.values())


def _driver_rows(rules: dict, upto: list[dict], sheets: dict, seq_of: dict, total_rounds: int,
                 people: dict, round_rules: dict | None = None, unit_of: dict | None = None,
                 unit_seq: dict | None = None) -> list[dict]:
    activity = rules["activity_points"]
    official = sheets[upto[-1]["id"]].get("official_totals") or {}
    unit_of, unit_seq = unit_of or {}, unit_seq or {}
    rows = []
    for pid, results in _results_by_participant(rules, upto, sheets, seq_of, round_rules).items():
        # Gezählt, gestrichen, Aktivitätspunkte und gefahrene Runden je Einheit - mit Läufen je Runde (#1930).
        units = _per_unit(results, unit_of, unit_seq)
        kept, gone = counted_results(units, rules, total_rounds)
        counted = [item["round_id"] for item in results if unit_of.get(item["round_id"], item["round_id"]) in kept]
        dropped = [item["round_id"] for item in results if unit_of.get(item["round_id"], item["round_id"]) in gone]
        counted_points = sum(item["points"] for item in results if item["round_id"] in counted)
        bonus = sum(activity["points"] for item in units
                    if item["participated"] and item["seq"] >= activity["from_round"])
        stats = _stats(results)
        row = {
            "participant_id": pid, "computed_points": _number(counted_points + bonus),
            "activity_points": _number(bonus),
            "counted_round_ids": counted, "dropped_round_ids": dropped,
            "results": [{**{key: item[key] for key in RESULT_FIELDS},
                         **{key: item[key] for key in RACE_DETAILS if key in item}} for item in results],
            "wins": stats["wins"], "podiums": stats["podiums"],
            "rounds_played": sum(1 for item in units if item["participated"]), "_stats": stats,
        }
        _official(row, official.get(pid))
        rows.append(row)

    def by_name(row: dict) -> tuple:
        return str((people.get(row["participant_id"]) or {}).get("name") or "").casefold(), row["participant_id"]

    _rank(rows, rules["tiebreakers"], upto, by_name)
    return rows


# ---------------------------------------------------------------- Teams
def _team_rows(rules: dict, upto: list[dict], sheets: dict, seq_of: dict, people: dict,
               round_rules: dict | None = None) -> list[dict]:
    config = rules["team_scoring"]
    official = sheets[upto[-1]["id"]].get("official_team_totals") or {}
    teams: dict[str, dict] = {}
    for item in upto:
        per_team: dict[str, list[dict]] = {}
        for pid, results in _results_by_participant(rules, [item], sheets, seq_of, round_rules).items():
            person = people.get(pid) or {}
            if person.get("link") == "guest" and not config["guests_count"]:
                continue
            result = results[0]
            team = result["team"] or person.get("default_team")
            if team:
                per_team.setdefault(team, []).append({**result, "participant_id": pid})
        for team, drivers in per_team.items():
            drivers.sort(key=lambda entry: (-entry["points"], entry["place"] or math.inf, entry["participant_id"]))
            counting = drivers[: config["counting_drivers"]] if config["counting_drivers"] else drivers
            entry = teams.setdefault(team, {"team": team, "round_points": [], "_results": [], "_by_driver": {}})
            entry["round_points"].append({"round_id": item["id"], "points": _number(sum(d["points"] for d in counting)),
                                          "driver_ids": [d["participant_id"] for d in counting]})
            entry["_results"].extend(counting)
            for driver in counting:
                pid = driver["participant_id"]
                entry["_by_driver"][pid] = entry["_by_driver"].get(pid, 0) + driver["points"]
    rows = []
    for entry in teams.values():
        by_driver = entry.pop("_by_driver")
        entry["driver_ids"] = sorted(by_driver, key=lambda pid: (-by_driver[pid], pid))
        entry["computed_points"] = _number(sum(item["points"] for item in entry["round_points"]))
        entry["_stats"] = _stats(entry.pop("_results"))
        _official(entry, official.get(entry["team"]))
        rows.append(entry)
    _rank(rows, rules["tiebreakers"], upto, lambda row: (row["team"].casefold(), row["team"]))
    return rows


# ---------------------------------------------------------------- Tabelle der Team-Liga
def _table_rows(rules: dict, upto: list[dict], sheets: dict, own_teams: set[str]) -> list[dict]:
    computed = {row["team"]: row for row in league_table(
        [match for item in upto for match in sheets[item["id"]].get("matches") or []], rules)}
    official = {str(row.get("team") or "").strip(): row for row in sheets[upto[-1]["id"]].get("official_table") or []
                if str(row.get("team") or "").strip()}
    rows = []
    for team in sorted(set(computed) | set(official), key=lambda name: (name.casefold(), name)):
        mine, theirs = computed.get(team) or {}, official.get(team)
        row = {"team": team, **{field: mine.get(field, 0) for field in TABLE_FIELDS},
               "computed_points": mine.get("points", 0)}
        if theirs:
            row.update({field: theirs[field] for field in TABLE_FIELDS if theirs.get(field) is not None})
        has_official = bool(theirs) and theirs.get("points") is not None
        row["points"] = _number(theirs["points"]) if has_official else row["computed_points"]
        row["official_points"] = row["points"] if has_official else None
        row["deviation"] = (_number(row["official_points"] - row["computed_points"])
                            if row["official_points"] is not None and team in own_teams and team in computed else None)
        row["_official_rank"] = theirs.get("rank") if theirs else None
        rows.append(row)
    if official and all(isinstance(row["_official_rank"], int) for row in rows):
        for row in rows:
            row["rank"] = row["_official_rank"]
        rows.sort(key=lambda row: (row["rank"], row["team"].casefold()))
    else:
        field = {"score_diff": "score_diff", "score_for": "score_for", "wins": "won"}
        rank_with_ties(rows, lambda row: (row["points"], *(row[field[name]] for name in rules["table_tiebreakers"])))
        rows.sort(key=lambda row: (row["rank"], row["team"].casefold()))
    for row in rows:
        row.pop("_official_rank", None)
    return rows


# ---------------------------------------------------------------- Eigene Teams
def sheet_teams(sheet: dict) -> list[str]:
    """Alle Teamnamen eines Blatts: Zeilen, Spiele, Tabelle und Teamwerte laut Veranstalter."""
    names = [row.get("team") for row in sheet.get("rows") or []]
    names += [match.get(side) for match in sheet.get("matches") or [] for side in ("home", "away")]
    names += [row.get("team") for row in sheet.get("official_table") or []]
    names += list((sheet.get("official_team_totals") or {}).keys())
    return [name for name in names if name]


def _own_spelling(sheet: dict, matcher: Matcher) -> dict:
    """Ein Blatt mit den Namen der eigenen Teams (#1926): Name, Alias und eindeutige Schreibweisen eines eigenen Teams
    werden zu seinem Namen - in Zeilen, Spielen, Tabelle und Teamwerten laut Veranstalter. Steht im selben Blatt ein
    wörtlich anderes Team mit derselben Schreibweise, bleibt es getrennt (``Matcher.resolve``). Fremde Teams bleiben."""
    others = sheet_teams(sheet)

    def own(name):
        return matcher.canonical(name, others)

    out = dict(sheet)
    out["rows"] = [{**row, "team": own(row.get("team"))} for row in sheet.get("rows") or []]
    out["matches"] = [{**match, "home": own(match.get("home")), "away": own(match.get("away"))}
                      for match in sheet.get("matches") or []]
    out["official_table"] = [{**row, "team": own(row.get("team"))} for row in sheet.get("official_table") or []]
    totals = sheet.get("official_team_totals") or {}
    out["official_team_totals"] = {own(team): value for team, value in totals.items()}
    return out


# ---------------------------------------------------------------- Alles zusammen
def compute_standings(*, rules: dict, rounds: list[dict], sheets: dict[str, dict], participants: list[dict],
                      own_teams=(), round_rules: dict | None = None, units: dict | None = None) -> list[dict]:
    """Je gewerteter Runde und Wertung ein Stand: ``{"round_id", "round_seq", "scope", "rows"}`` in
    Kalender-Reihenfolge. ``own_teams``: die eigenen Teams (Namen oder ``{name, aliases}``, #1926) - ihre
    Schreibweisen zählen als ein Team. ``round_rules``: normalisierte Regeln je Termin, die für die Punkte einer Zeile
    statt ``rules`` gelten (Punkte je Lauf, #1930, ``services/race_weekend.py``). ``units``: Termin → Runde - dann zählen
    Aktivitätspunkte, gefahrene Runden und Streichergebnisse je Runde (Summe ihrer Läufe) statt je Termin."""
    rules = normalize_rules(rules)
    matcher = Matcher(own_teams)
    if matcher:
        sheets = {round_id: _own_spelling(sheet, matcher) for round_id, sheet in sheets.items()}
        defaults = [person.get("default_team") for person in participants if person.get("default_team")]
        participants = [{**person, "default_team": matcher.canonical(person.get("default_team"), defaults)}
                        for person in participants]
    counting = [item for item in ordered_rounds(rounds) if item.get("counts", True) is not False]
    seq_of = {item["id"]: index for index, item in enumerate(counting, start=1)}
    unit_of = {item["id"]: (units or {}).get(item["id"], item["id"]) for item in counting}
    unit_seq: dict = {}
    for item in counting:
        unit_seq.setdefault(unit_of[item["id"]], len(unit_seq) + 1)
    total_rounds = len({unit_of[item["id"]] for item in counting if item.get("status") != "cancelled"})
    scored = [item for item in counting if item.get("status") == "scored" and item["id"] in sheets]
    for item in scored:
        validate_sheet(sheets[item["id"]], item["id"])
    people = {person["id"]: person for person in participants if person.get("id")}
    own = set(matcher.names)
    snapshots: list[dict] = []
    previous: dict[str, dict] = {}
    for index, item in enumerate(scored):
        upto = scored[: index + 1]
        scopes = []
        if any(sheets[done["id"]].get("rows") for done in upto):
            drivers = _driver_rows(rules, upto, sheets, seq_of, total_rounds, people, round_rules, unit_of,
                                   unit_seq)
            scopes.append(("drivers", "participant_id", drivers))
            teams = (_team_rows(rules, upto, sheets, seq_of, people, round_rules)
                     if rules["team_scoring"]["enabled"] else [])
            if teams:
                scopes.append(("teams", "team", teams))
        if any(sheets[done["id"]].get("matches") or sheets[done["id"]].get("official_table") for done in upto):
            scopes.append(("table", "team", _table_rows(rules, upto, sheets, own)))
        for scope, key, rows in scopes:
            previous[scope] = _movement(rows, key, previous.get(scope))
            snapshots.append({"round_id": item["id"], "round_seq": seq_of[item["id"]], "scope": scope, "rows": rows})
    return snapshots
