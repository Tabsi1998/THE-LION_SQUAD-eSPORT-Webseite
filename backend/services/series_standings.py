"""Zwischenstände externer Serien (#1741) - ohne Datenbank, gerechnet beim Schreiben und gespeichert je Runde.

``compute_standings`` bekommt Regeln, Kalender, die veröffentlichten Ergebnisblätter und die Teilnehmer und liefert je
gewerteter Runde einen Stand je Wertung (``scope``):

- ``drivers``: Fahrer bzw. Spieler - gezählte und gestrichene Runden, Aktivitätspunkte, Vorrang bei Gleichstand
  (``tiebreak`` nennt das Kriterium, das gegen die Zeile darüber entschieden hat) und der offizielle Wert des
  Veranstalters (``official_totals`` im Blatt der Runde) mit Abweichung zur eigenen Summe.
- ``teams``: Teamwertung, wenn eingeschaltet - je Rennen die besten ``counting_drivers`` eines Teams (Team je Rennen
  aus der Zeile; leer oder ``no_team_names`` wie „Ersatzfahrer“: kein Team, #1960). Mit
  ``team_scoring.mode = current_lineup`` (#1960) ist Gesamt die Summe der Saisonpunkte der Fahrer, deren aktuelles Team
  es ist; ein Gast zählt fürs Team, wenn ``guests_count`` an ist. Die Teamwertung laut Veranstalter
  (``official_team_totals``) gilt für Platz und Punkte. Ohne ein einziges Team gibt es keinen (leeren) Teamstand.
- Anpassungen (#1960, ``series_adjustments``): ±Punkte ohne Rennergebnis je Fahrer bzw. Team, ab ihrem Stand.
- ``table``: Tabelle einer Team-Liga aus den eingetragenen Spielen; hat das Blatt die Tabelle des Veranstalters
  (``official_table``), gilt sie für Teams und Plätze: Teams aus den Spielen in anderer Schreibweise zählen für ihre
  Zeile (``team_names.align_to_table``), ohne passende Zeile bekommen sie keine eigene, und offizielle Plätze werden nie
  neu gerechnet. Abgeglichen wird das eigene Team (``own_teams``).

Gewertet wird eine Runde mit Status ``scored`` und Blatt; Runden mit ``counts=False`` (etwa ein Finale außerhalb der
Wertung) bleiben draußen. Eine abgesagte Runde hat keinen Stand und zählt nicht zu den Runden des Kalenders, behält aber
ihre Nummer (``round_seq``). Namen stehen nicht im Stand, nur Kennungen - sie kommen beim Lesen dazu, damit Umbenennen
und Ausblenden nicht neu rechnen müssen. Gleiche Eingaben ergeben immer denselben Stand, egal in welcher Reihenfolge.

Turniertage (#1961, ``services/tournament_days.py``): Jedes Ergebnis trägt - wo eingetragen - die Runden des Termins
(``day_rounds`` mit den Punkten, die zählen), die Tagessumme (``day_points``), den Partner im Double Up (``partner_id``)
und seine Sonderboni (``bonus``, ``bonus_keys``). Sonderboni zählen wie Aktivitätspunkte getrennt (``bonus_points``) und
werden nie gestrichen. Der Vorrang ``top_n`` zählt Plätze unter den besten ``tiebreak_top_n``.
"""
from __future__ import annotations

import math

from services import series_adjustments, tournament_days
from services.own_teams import Matcher
from services.scoring_rules import (
    counted_results, is_no_team, league_table, normalize_rules, rank_with_ties, result_points, validate_sheet,
)
from services.team_names import align_to_table

WORST = -math.inf
TABLE_FIELDS = ("played", "won", "drawn", "lost", "score_for", "score_against", "score_diff")
RESULT_FIELDS = ("round_id", "place", "points", "source", "marks", "team")
# Angaben aus dem Rennergebnis (#1927) - nur, wo eingetragen: Startnummer, Startplatz, Zeit, Abstand, schnellste Runde
# mit Zeit und Fahrer des Tages.
RACE_DETAILS = ("start_number", "grid", "time", "gap", "fastest_lap_time", "driver_of_the_day")
# Turniertag (#1961) - nur, wo eingetragen: Runden des Termins, Tagessumme, Partner im Double Up, Sonderboni.
DAY_DETAILS = ("day_rounds", "day_points", "partner_id", "bonus", "bonus_keys")


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


def _criterion(name: str, stats: dict, max_place: int, latest_first: list[str], top_n: int = 4):
    if name == "wins":
        return stats["wins"]
    if name == "top_n":
        return sum(1 for place in stats["places"] if place <= top_n)
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


def _rank(rows: list[dict], criteria: list[str], upto: list[dict], sort_name, top_n: int = 4) -> None:
    """Rang nach Punkten und Vorrang, gleichrangige nach ``sort_name``; ``tiebreak`` an jeder Zeile, die bei gleichen
    Punkten wegen eines Kriteriums hinter der darüber steht."""
    max_place = max([place for row in rows for place in row["_stats"]["places"]] or [1])
    latest_first = [item["id"] for item in reversed(upto)]
    for row in rows:
        row["_criteria"] = [_criterion(name, row["_stats"], max_place, latest_first, top_n) for name in criteria]
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
            own_rules = (round_rules or {}).get(item["id"], rules)
            scored = result_points(row, own_rules)
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
                **details, **_day_details(row, own_rules),
            })
    return found


def _day_details(row: dict, rules: dict) -> dict:
    """Turniertag (#1961) - nur, was die Zeile trägt: Runden mit den Punkten, die zählen, Tagessumme, Partner, Boni."""
    out: dict = {}
    if row.get("day_rounds"):
        out["day_rounds"] = tournament_days.rounds_with_points(row, rules)
    total = tournament_days.day_total(row, rules)
    if total is not None:
        out["day_points"] = total
    if row.get("partner_id"):
        out["partner_id"] = row["partner_id"]
    bonus, keys = tournament_days.bonus_points(row, rules)
    if keys:
        out["bonus"], out["bonus_keys"] = bonus, keys
    return out


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
                 unit_seq: dict | None = None, adjustments=()) -> list[dict]:
    activity = rules["activity_points"]
    official = sheets[upto[-1]["id"]].get("official_totals") or {}
    unit_of, unit_seq = unit_of or {}, unit_seq or {}
    # Anpassungen (#1960): ±Punkte ohne Rennergebnis - wer nur eine Anpassung hat, steht trotzdem in der Tabelle.
    adjusted: dict[str, list[dict]] = {}
    for item in adjustments or ():
        if item.get("kind", "participant") == "participant" and item.get("participant_id"):
            adjusted.setdefault(item["participant_id"], []).append(item)
    found = _results_by_participant(rules, upto, sheets, seq_of, round_rules)
    for pid in adjusted:
        found.setdefault(pid, [])
    rows = []
    for pid, results in found.items():
        # Gezählt, gestrichen, Aktivitätspunkte und gefahrene Runden je Einheit - mit Läufen je Runde (#1930).
        units = _per_unit(results, unit_of, unit_seq)
        kept, gone = counted_results(units, rules, total_rounds)
        counted = [item["round_id"] for item in results if unit_of.get(item["round_id"], item["round_id"]) in kept]
        dropped = [item["round_id"] for item in results if unit_of.get(item["round_id"], item["round_id"]) in gone]
        counted_points = sum(item["points"] for item in results if item["round_id"] in counted)
        bonus = sum(activity["points"] for item in units
                    if item["participated"] and item["seq"] >= activity["from_round"])
        # Sonderboni (#1961): getrennt wie Aktivitätspunkte, nie gestrichen.
        extra = sum(item.get("bonus") or 0 for item in results)
        stats = _stats(results)
        # Anpassungen (#1960): getrennt von Sonderboni und Aktivitätspunkten ausgewiesen - jede zählt genau einmal.
        adjust = sum(item["points"] for item in adjusted.get(pid, []))
        row = {
            "participant_id": pid, "computed_points": _number(counted_points + bonus + extra + adjust),
            "activity_points": _number(bonus), "bonus_points": _number(extra), "adjustment_points": _number(adjust),
            "adjustments": [series_adjustments.public(item) for item in adjusted.get(pid, [])],
            "counted_round_ids": counted, "dropped_round_ids": dropped,
            "results": [{**{key: item[key] for key in RESULT_FIELDS},
                         **{key: item[key] for key in (*RACE_DETAILS, *DAY_DETAILS) if key in item}}
                        for item in results],
            "wins": stats["wins"], "podiums": stats["podiums"],
            "rounds_played": sum(1 for item in units if item["participated"]), "_stats": stats,
        }
        _official(row, official.get(pid))
        rows.append(row)

    def by_name(row: dict) -> tuple:
        return str((people.get(row["participant_id"]) or {}).get("name") or "").casefold(), row["participant_id"]

    _rank(rows, rules["tiebreakers"], upto, by_name, rules["tiebreak_top_n"])
    return rows


# ---------------------------------------------------------------- Teams
def _ride_team(result: dict, rules: dict) -> str | None:
    """Für welches Team eine Fahrt zählt (#1960): was im Feld steht. Ein leeres Feld heißt kein Team - kein stiller
    Rückfall aufs Stammteam (neue Zeilen bekommen es beim Eintragen sichtbar vorbelegt, Altdaten hat Migration 10
    gefüllt). Ein Ersatz-Einsatz (``team_scoring.no_team_names``, etwa „Ersatzfahrer“) zählt ebenso für kein Team."""
    team = result["team"]
    return None if not team or not str(team).strip() or is_no_team(team, rules) else team


def _current_teams(rules: dict, upto: list[dict], sheets: dict, seq_of: dict, people: dict, pids,
                   round_rules: dict | None = None) -> dict[str, str]:
    """Aktuelles Team je Fahrer (#1960, Modus ``current_lineup``): das Team seiner letzten Fahrt, die kein Ersatz-Einsatz
    war, in Rundenreihenfolge bis zu diesem Stand. Ist er nie für ein Team gefahren, gilt das Stammteam. Ein Team von
    Hand am Teilnehmer (``current_team``) geht vor - ein Name aus ``no_team_names`` heißt dort: in keinem Team."""
    current: dict[str, str] = {}
    for item in upto:
        for pid, results in _results_by_participant(rules, [item], sheets, seq_of, round_rules).items():
            team = _ride_team(results[0], rules)
            if team:
                current[pid] = team
    out: dict[str, str] = {}
    for pid in pids:
        person = people.get(pid) or {}
        manual = " ".join(str(person.get("current_team") or "").split())
        default = person.get("default_team")
        team = manual or current.get(pid) or (default if default and not is_no_team(default, rules) else None)
        if team and not is_no_team(team, rules):
            out[pid] = team
    return out


def _team_rows(rules: dict, upto: list[dict], sheets: dict, seq_of: dict, people: dict,
               round_rules: dict | None = None, adjustments=(), driver_points: dict | None = None) -> list[dict]:
    """Teamwertung. Je Rennen (die Zellen) zählen die besten ``counting_drivers`` eines Teams - immer für das Team, für
    das in diesem Rennen gefahren wurde (``_ride_team``); ein Ersatz-Einsatz zählt für keines, ein Team ohne Fahrt in
    der Runde hat keine Zelle. Gesamt im Modus ``per_race`` (Vorgabe): die Summe der Zellen. Im Modus
    ``current_lineup`` (#1960, wie beim Veranstalter): die Saisonpunkte aller Fahrer, deren aktuelles Team es ist
    (``driver_points``: Punkte der Fahrerwertung, samt Ersatz-Einsätzen und Abzügen) - eine Abweichung zur Summe der
    Zellen ist dann gewollt. Dazu Team-Anpassungen und die Teamwertung laut Veranstalter (``official_team_totals`` des
    letzten Blatts) - sie gilt für Platz und Punkte, auch für ein Team, das nur dort steht."""
    config = rules["team_scoring"]
    official = {series_adjustments.team_key(team): value
                for team, value in (sheets[upto[-1]["id"]].get("official_team_totals") or {}).items()}
    teams: dict[str, dict] = {}
    for item in upto:
        per_team: dict[str, list[dict]] = {}
        for pid, results in _results_by_participant(rules, [item], sheets, seq_of, round_rules).items():
            person = people.get(pid) or {}
            if person.get("link") == "guest" and not config["guests_count"]:
                continue
            result = results[0]
            team = _ride_team(result, rules)
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
    by_key = {series_adjustments.team_key(name): entry for name, entry in teams.items()}

    def entry_for(name: str) -> dict:
        key = series_adjustments.team_key(name)
        if key not in by_key:
            by_key[key] = teams.setdefault(name, {"team": name, "round_points": [], "_results": [],
                                                  "_by_driver": {}})
        return by_key[key]

    lineup = config.get("mode") == "current_lineup"
    members: dict[str, dict[str, float]] = {}
    if lineup:
        # Fahrer-Anpassungen (#2000) stecken in den Saisonpunkten: mit Haken bleiben sie drin und stehen beim Team, ohne
        # werden sie für die Teamsumme herausgerechnet - nie doppelt.
        outside: dict[str, float] = {}
        flagged: dict[str, list[dict]] = {}
        for item in adjustments or ():
            pid = item.get("participant_id")
            if item.get("kind", "participant") != "participant" or not pid:
                continue
            if item.get("counts_for_team"):
                flagged.setdefault(pid, []).append(item)
            else:
                outside[pid] = outside.get(pid, 0) + item["points"]
        points = {pid: value - outside.get(pid, 0) for pid, value in (driver_points or {}).items()
                  if not ((people.get(pid) or {}).get("link") == "guest" and not config["guests_count"])}
        for pid, team in _current_teams(rules, upto, sheets, seq_of, people, points, round_rules).items():
            entry = entry_for(team)
            members.setdefault(series_adjustments.team_key(entry["team"]), {})[pid] = points[pid]
            entry.setdefault("_driver_adjust", []).extend(flagged.get(pid, []))
    for item in adjustments or ():
        if item.get("kind") == "team" and item.get("team") and not is_no_team(item["team"], rules):
            entry_for(item["team"]).setdefault("_adjust", []).append(item)
        elif not lineup and item.get("counts_for_team") and item.get("credited_team"):
            # Je Rennen (#2000): für das Team, für das der Fahrer im Termin gefahren ist (``_credit_team``).
            entry_for(item["credited_team"]).setdefault("_driver_adjust", []).append(item)
    for name in sheets[upto[-1]["id"]].get("official_team_totals") or {}:
        if not is_no_team(name, rules):
            entry_for(name)
    rows = []
    for entry in teams.values():
        by_driver = entry.pop("_by_driver")
        adjusted = entry.pop("_adjust", [])
        extra = sum(item["points"] for item in adjusted)
        from_drivers = entry.pop("_driver_adjust", [])
        driver_extra = sum(item["points"] for item in from_drivers)
        if lineup:
            current = members.get(series_adjustments.team_key(entry["team"]), {})
            entry["driver_ids"] = sorted(current, key=lambda pid: (-current[pid], pid))
            # Die Fahrer-Anpassungen mit Haken stecken schon in ``current`` - nicht noch einmal dazu.
            entry["computed_points"] = _number(sum(current.values()) + extra)
        else:
            entry["driver_ids"] = sorted(by_driver, key=lambda pid: (-by_driver[pid], pid))
            entry["computed_points"] = _number(sum(item["points"] for item in entry["round_points"]) + extra +
                                               driver_extra)
        entry["adjustment_points"] = _number(extra)
        entry["adjustments"] = [series_adjustments.public(item) for item in adjusted]
        # #2000: Fahrer-Anpassungen, die fürs Team zählen - getrennt von den Team-Anpassungen, mit Fahrer-Kennung.
        entry["driver_adjustment_points"] = _number(driver_extra)
        entry["driver_adjustments"] = [{**series_adjustments.public(item), "credited_team": entry["team"],
                                        "participant_id": item["participant_id"]} for item in from_drivers]
        entry["_stats"] = _stats(entry.pop("_results"))
        _official(entry, official.get(series_adjustments.team_key(entry["team"])))
        rows.append(entry)
    _rank(rows, rules["tiebreakers"], upto, lambda row: (row["team"].casefold(), row["team"]),
          rules["tiebreak_top_n"])
    return rows


# ---------------------------------------------------------------- Fahrer-Anpassungen in der Teamwertung (#2000)
def _credit_team(item: dict, rules: dict, scored: list[dict], sheets: dict, people: dict,
                 position: dict[str, int]) -> tuple[str | None, str | None]:
    """Für welches Team eine Fahrer-Anpassung im Modus ``per_race`` zählt - ``(Team, None)`` oder ``(None, Hinweis)``.
    Mit Termin, in dem der Fahrer gefahren ist: das Team dieser Fahrt (Ersatz-Einsatz ``substitute``, leer
    ``no_team``). Sonst die letzte Fahrt mit Team bis zum Termin bzw. - ohne Termin - bis zum Tag der Anpassung
    (keine: ``no_ride``). Ein Gast zählt nur mit ``guests_count`` (sonst ``guest``). Fahrten danach ändern nichts."""
    pid = item.get("participant_id")
    if (people.get(pid) or {}).get("link") == "guest" and not rules["team_scoring"]["guests_count"]:
        return None, "guest"

    def ride(round_id: str) -> dict | None:
        return next((row for row in sheets[round_id].get("rows") or [] if row.get("participant_id") == pid), None)

    round_id = item.get("round_id")
    if round_id in {entry["id"] for entry in scored}:
        row = ride(round_id)
        if row is not None:
            team = _ride_team({"team": row.get("team")}, rules)
            if team:
                return team, None
            return None, "substitute" if str(row.get("team") or "").strip() else "no_team"
    if round_id in position:
        before = [entry for entry in scored if position.get(entry["id"], -1) <= position[round_id]]
    else:
        day = str(item.get("day") or "")
        before = [entry for entry in scored if str(entry.get("club_day") or "") and str(entry["club_day"]) <= day]
    for entry in reversed(before):
        row = ride(entry["id"])
        team = _ride_team({"team": row.get("team")}, rules) if row else None
        if team:
            return team, None
    return None, "no_ride"


def _with_team_credit(adjustments, rules: dict, scored: list[dict], sheets: dict, people: dict,
                      calendar: list[dict]) -> list[dict]:
    """Die Anpassungen zum Rechnen: jede Fahrer-Anpassung mit dem gelesenen Haken (``counts_for_team``, Altdaten nach
    Modus) und - je Rennen - dem Team, für das sie zählt (``credited_team``) bzw. dem Hinweis (``team_note``)."""
    position = {item["id"]: index for index, item in enumerate(calendar)}
    per_race = rules["team_scoring"]["mode"] != "current_lineup"
    out = []
    for item in adjustments or []:
        if not isinstance(item, dict) or item.get("kind", "participant") != "participant":
            out.append(item)
            continue
        flagged = series_adjustments.counts_for_team(item, rules)
        team, note = (_credit_team(item, rules, scored, sheets, people, position) if flagged and per_race
                      else (None, None))
        out.append({**item, "counts_for_team": flagged, "credited_team": team, "team_note": note})
    return out


def _mark_credit(drivers: list[dict], teams: list[dict], rules: dict, people: dict) -> None:
    """Fahrer-Detail (#2000): an jeder Anpassung mit Haken das Team, bei dem sie in diesem Stand steht - in der
    aktuellen Besetzung das aktuelle Team des Fahrers -, sonst warum für keines (Gast bzw. ohne Team)."""
    credited = {item["id"]: row["team"] for row in teams for item in row.get("driver_adjustments") or []
                if item.get("id")}
    for row in drivers:
        for item in row.get("adjustments") or []:
            if not item.get("counts_for_team"):
                continue
            if item.get("id") in credited:
                item["credited_team"] = credited[item["id"]]
                item.pop("team_note", None)
            elif not item.get("team_note"):
                item.pop("credited_team", None)
                guest = ((people.get(row["participant_id"]) or {}).get("link") == "guest" and
                         not rules["team_scoring"]["guests_count"])
                item["team_note"] = "guest" if guest else "no_team"


# ---------------------------------------------------------------- Tabelle der Team-Liga
def _team(value) -> str:
    return " ".join(str(value or "").split())


def _table_rank(rows: list[dict], rules: dict) -> None:
    field = {"score_diff": "score_diff", "score_for": "score_for", "wins": "won"}
    rank_with_ties(rows, lambda row: (row["points"], *(row[field[name]] for name in rules["table_tiebreakers"])))


def _table_rows(rules: dict, upto: list[dict], sheets: dict, own_teams: set[str]) -> list[dict]:
    matches = [match for item in upto for match in sheets[item["id"]].get("matches") or []]
    official = {_team(row.get("team")): row for row in sheets[upto[-1]["id"]].get("official_table") or []
                if _team(row.get("team"))}
    if official:
        # Die Tabelle des Veranstalters ist für Teams und Plätze maßgeblich (Prüfung #1931): ein Team aus den Spielen in
        # anderer Schreibweise zählt für seine Zeile, eines ohne passende Zeile bekommt keine eigene - die Prüfung des
        # Ergebnisblatts nennt es (``table_team_unknown``).
        mapping, _unclear = align_to_table([match.get(side) for match in matches for side in ("home", "away")],
                                           list(official))
        matches = [{**match, "home": mapping.get(_team(match.get("home")), match.get("home")),
                    "away": mapping.get(_team(match.get("away")), match.get("away"))} for match in matches]
    computed = {_team(row["team"]): row for row in league_table(matches, rules)}
    rows = []
    for team in sorted(official or computed, key=lambda name: (name.casefold(), name)):
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
    ranked = [row for row in rows if isinstance(row["_official_rank"], int)]
    if ranked:
        # Offizielle Plätze werden nie neu gerechnet; Teams ohne Platz folgen dahinter, nach Punkten.
        rest = [row for row in rows if not isinstance(row["_official_rank"], int)]
        for row in ranked:
            row["rank"] = row["_official_rank"]
        _table_rank(rest, rules)
        top = max(row["rank"] for row in ranked)
        for row in rest:
            row["rank"] += top
        rows = ranked + rest
    else:
        _table_rank(rows, rules)
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
                      own_teams=(), round_rules: dict | None = None, units: dict | None = None,
                      adjustments=None, planned_rounds: int | None = None) -> list[dict]:
    """Je gewerteter Runde und Wertung ein Stand: ``{"round_id", "round_seq", "scope", "rows"}`` in
    Kalender-Reihenfolge. ``own_teams``: die eigenen Teams (Namen oder ``{name, aliases}``, #1926) - ihre
    Schreibweisen zählen als ein Team. ``round_rules``: normalisierte Regeln je Termin, die für die Punkte einer Zeile
    statt ``rules`` gelten (Punkte je Lauf, #1930, ``services/race_weekend.py``). ``units``: Termin → Runde - dann zählen
    Aktivitätspunkte, gefahrene Runden und Streichergebnisse je Runde (Summe ihrer Läufe) statt je Termin.
    ``adjustments``: Anpassungen der Saison (#1960, ``services/series_adjustments.py``) - je Stand die, die schon
    gelten, in Fahrer- bzw. Teamwertung (``adjustment_points``, ``adjustments`` an der Zeile).
    ``planned_rounds`` (#2015): geplante Termine der Saison - solange der Kalender kürzer ist, zählen Streichergebnisse
    („Runden minus N“) mit dieser Zahl, nie mit weniger."""
    rules = normalize_rules(rules)
    matcher = Matcher(own_teams)
    if matcher:
        sheets = {round_id: _own_spelling(sheet, matcher) for round_id, sheet in sheets.items()}
        defaults = [person.get("default_team") for person in participants if person.get("default_team")]
        participants = [{**person, "default_team": matcher.canonical(person.get("default_team"), defaults),
                         "current_team": matcher.canonical(person.get("current_team"), defaults)}
                        for person in participants]
    counting = [item for item in ordered_rounds(rounds) if item.get("counts", True) is not False]
    seq_of = {item["id"]: index for index, item in enumerate(counting, start=1)}
    unit_of = {item["id"]: (units or {}).get(item["id"], item["id"]) for item in counting}
    unit_seq: dict = {}
    for item in counting:
        unit_seq.setdefault(unit_of[item["id"]], len(unit_seq) + 1)
    total_rounds = max(len({unit_of[item["id"]] for item in counting if item.get("status") != "cancelled"}),
                       int(planned_rounds or 0))
    scored = [item for item in counting if item.get("status") == "scored" and item["id"] in sheets]
    for item in scored:
        validate_sheet(sheets[item["id"]], item["id"])
    people = {person["id"]: person for person in participants if person.get("id")}
    own = set(matcher.names)
    calendar = [item for item in ordered_rounds(rounds) if not item.get("archived_at")]
    if matcher:
        adjustments = [{**item, "team": matcher.canonical(item["team"])} if item.get("team") else item
                       for item in adjustments or []]
    adjustments = _with_team_credit(adjustments, rules, scored, sheets, people, calendar)
    active = series_adjustments.active_per_snapshot(adjustments, calendar, scored)
    snapshots: list[dict] = []
    previous: dict[str, dict] = {}
    for index, item in enumerate(scored):
        upto = scored[: index + 1]
        scopes = []
        if any(sheets[done["id"]].get("rows") for done in upto):
            drivers = _driver_rows(rules, upto, sheets, seq_of, total_rounds, people, round_rules, unit_of,
                                   unit_seq, active[index])
            scopes.append(("drivers", "participant_id", drivers))
            teams = (_team_rows(rules, upto, sheets, seq_of, people, round_rules, active[index],
                                {row["participant_id"]: row["points"] for row in drivers})
                     if rules["team_scoring"]["enabled"] else [])
            _mark_credit(drivers, teams, rules, people)
            if teams:
                scopes.append(("teams", "team", teams))
        if any(sheets[done["id"]].get("matches") or sheets[done["id"]].get("official_table") for done in upto):
            scopes.append(("table", "team", _table_rows(rules, upto, sheets, own)))
        for scope, key, rows in scopes:
            previous[scope] = _movement(rows, key, previous.get(scope))
            snapshots.append({"round_id": item["id"], "round_seq": seq_of[item["id"]], "scope": scope, "rows": rows})
    return snapshots
