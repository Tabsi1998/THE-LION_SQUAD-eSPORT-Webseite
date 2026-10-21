"""Ergebnisse externer Serien eintragen (#1744) - ohne Datenbank: Zeilen den Teilnehmern zuordnen, Plausibilität,
Finalgrenze. Laden, Speichern und das Neurechnen der Stände machen die Routen (``routes/reference_result_routes.py``).

- **Zuordnen** (``resolve``): Eine Zeile nennt den Teilnehmer über ``participant_id`` (muss zur Serie gehören), über
  den Namen wie beim Veranstalter oder über die Startnummer. Der Name zählt vor der Startnummer: erst der volle
  Schlüssel (``series_identity.normalize_name``), dann ohne Clan-Tag; passt er auf mehrere, entscheidet die
  Startnummer, sonst ist die Zeile mehrdeutig. Passt kein Name, aber die Startnummer, gilt sie - mit Warnung, dass der
  Name abweicht. Wer gar nicht passt, ist ein **neuer Name** (Kennung ``neu:<Schlüssel>`` nur in der Vorschau); beim
  Übernehmen legt die Route ihn als offenen Teilnehmer an (Dialog „Unbekannte Namen“, #1743).
- **Plausibilität** (``check``): Fehler halten das Übernehmen auf (Teilnehmer doppelt, unbekannte Kennung, Name fehlt
  oder mehrdeutig, leeres Blatt, abgesagter oder archivierter Termin). Warnungen nicht: Platz doppelt oder Lücke,
  Platz fehlt, Nichtstart mit Platz, Punkte passen nicht zum Schlüssel oder fehlen bei „laut Veranstalter“, Maps passen
  nicht zum Ergebnis, eigenes Team fehlt im Spiel, Team doppelt in der Tabelle, Termin liegt in der Zukunft oder zählt
  nicht zur Wertung. Die Abweichung zum offiziellen Gesamtstand kommt aus dem gerechneten Stand (``official_warnings``).
- **Punkte:** Bei „Punkte nach Schlüssel“ überschreiben eingetragene Punkte den Schlüssel nur mit ``points_source``
  „manual“ (Haken „Punkte zählen statt Schlüssel“). „organizer“ speichert den Wert des Veranstalters und vergleicht
  ihn nur (Warnung ``points_differ``), gezählt wird der Schlüssel - so rechnet ``scoring_rules.result_points``. Bei
  „Punkte laut Veranstalter“ zählt jede Zeile wie eingetragen („organizer“).
- **Finalgrenze** (``final_line``): wer nach dieser Runde unter den besten ``final_top_n`` steht, wer neu drin ist und
  wer herausgefallen ist.
- **Rennergebnis** (#1927): je Zeile optional Startnummer, Startplatz (``grid``), Rennzeit (``time``), Abstand (``gap``)
  und ``dnf`` (wird zur Marke), je Rennen die schnellste Runde (``fastest_lap``: wer und Zeit) und der Fahrer des Tages
  (``driver_of_the_day``) - genau die Felder, die auch die Texterkennung (#1756) liefert. Beide müssen in der Liste
  stehen; die schnellste Runde setzt die Marke an ihrer Zeile (so zählt ein Bonus), eine Zeit ohne Namen gehört zur
  markierten Zeile. Gespeichert wird nur, was angegeben ist - ein Blatt ohne diese Felder bleibt wie bisher.
- **Team-Liga** (#1931): neben dem eigenen Spiel dürfen die übrigen Spiele des Spieltags stehen - die Warnung
  „eigenes Team fehlt“ kommt nur, wenn es in keinem Spiel spielt. Maps mit Wahl und Aufstellung je Map, Banns und der
  Termin des Spiels: ``services/team_league_sheet.py``.

Meldungen werden nur aus den Eingaben gebaut, nie aus Ausnahmen.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from services import series_identity, team_league_sheet
from services.own_teams import Matcher
from services.scoring_rules import result_points

NEW_PREFIX = "neu:"
CONTENT_FIELDS = ("rows", "matches", "official_totals", "official_team_totals", "official_table", "note",
                  "fastest_lap", "driver_of_the_day")
ROW_FIELDS = ("participant_id", "place", "team", "points", "points_source", "marks", "penalty_points", "note")
# Angaben aus Veranstalter-Grafiken (#1927): nur gespeichert, wenn eingetragen.
RACE_FIELDS = ("start_number", "grid", "time", "gap")
TABLE_NUMBERS = ("played", "won", "drawn", "lost", "score_for", "score_against", "score_diff", "points")


def clean(value) -> str:
    """Leerraum zusammengefasst - ohne regulären Ausdruck."""
    return " ".join(str(value or "").split())


def number(value):
    """Ganze Zahlen ohne „.0“, sonst der Wert."""
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return value


NO_TIME_CHARS = frozenset("-:.,–—")


def lap_text(value) -> str | None:
    """Zeit oder Abstand als Text (höchstens 20 Zeichen); ein Platzhalter wie „--:--.---“ ist keine Zeit (#1927)."""
    text = clean(value)[:20]
    return None if not text or set(text) <= NO_TIME_CHARS else text


def is_new(participant_id) -> bool:
    return str(participant_id or "").startswith(NEW_PREFIX)


def _rows_text(indices: list[int]) -> str:
    shown = ", ".join(str(index + 1) for index in indices[:8])
    return f"Zeile {shown}" if len(indices) == 1 else f"Zeilen {shown}" + (" …" if len(indices) > 8 else "")


def _problem(code: str, message: str, rows: list[int] | None = None, **extra) -> dict:
    return {"code": code, "message": message, "rows": sorted(set(rows or [])), **extra}


# ---------------------------------------------------------------- Zuordnen
class _Lookup:
    """Die Teilnehmer der Serie nach Kennung, Schlüssel (voll und ohne Clan-Tag) und Startnummer."""

    def __init__(self, participants: list[dict]):
        self.by_id = {row["id"]: row for row in participants if row.get("id")}
        self.keys = {pid: series_identity.name_keys(row.get("name")) for pid, row in self.by_id.items()}

    def by_name(self, name: str) -> tuple[list[dict], str]:
        keys = series_identity.name_keys(name)
        if not keys:
            return [], ""
        full = [row for pid, row in self.by_id.items() if self.keys[pid] and self.keys[pid][0] == keys[0]]
        if full:
            return full, "name"
        loose = [row for pid, row in self.by_id.items() if set(self.keys[pid]) & set(keys)]
        return loose, "name_untagged"

    def by_number(self, start_number: str) -> list[dict]:
        wanted = start_number.casefold()
        return [row for row in self.by_id.values() if clean(row.get("start_number")).casefold() == wanted]


@dataclass
class Located:
    """Wem eine Angabe gehört: ``participant_id`` (echte Kennung oder ``neu:<Schlüssel>``), wie sie gefunden wurde
    (``id``, ``name``, ``name_untagged``, ``start_number``, ``new``) und der Name dazu."""
    participant_id: str | None
    match: str | None
    name: str
    problem: dict | None = None
    note: dict | None = None


@dataclass
class Resolution:
    rows: list[dict] = field(default_factory=list)  # je Eingabezeile, mit ``index``, ``match`` und ``name``
    matches: list[dict] = field(default_factory=list)
    official_totals: dict = field(default_factory=dict)
    official_team_totals: dict = field(default_factory=dict)
    official_table: list[dict] = field(default_factory=list)
    note: str | None = None
    fastest_lap: dict | None = None  # {participant_id, time} (#1927)
    driver_of_the_day: str | None = None
    new_people: dict[str, dict] = field(default_factory=dict)  # Schlüssel → Name, Startnummer, Team, Zeilen
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)

    def content(self) -> dict:
        """Das Blatt zum Speichern und Rechnen (Kennungen neuer Namen noch als ``neu:…``)."""
        rows = [{**{key: row[key] for key in ROW_FIELDS},
                 **{key: row[key] for key in RACE_FIELDS if row.get(key) is not None}}
                for row in self.rows if row["participant_id"]]
        return {"rows": rows, "matches": [dict(match) for match in self.matches],
                "official_totals": dict(self.official_totals),
                "official_team_totals": dict(self.official_team_totals),
                "official_table": [dict(row) for row in self.official_table], "note": self.note,
                "fastest_lap": dict(self.fastest_lap) if self.fastest_lap else None,
                "driver_of_the_day": self.driver_of_the_day}


def _locate(ref: dict, lookup: _Lookup, where: str) -> Located:
    pid = clean(ref.get("participant_id"))
    name = clean(ref.get("name"))[:120]
    start_number = clean(ref.get("start_number"))[:10]
    if pid:
        found = lookup.by_id.get(pid)
        if not found:
            return Located(None, None, name, _problem(
                "unknown_participant", f"{where}: Diesen Teilnehmer gibt es in der Saison nicht."))
        return Located(pid, "id", found.get("name") or name)
    if name:
        if not series_identity.is_usable_name(name):
            return Located(None, None, name, _problem(
                "unusable_name", f"{where}: Der Name „{name}“ braucht mindestens einen Buchstaben oder eine Ziffer."))
        hits, how = lookup.by_name(name)
        if len(hits) > 1 and start_number:
            hits = [row for row in hits if clean(row.get("start_number")).casefold() == start_number.casefold()]
        if len(hits) == 1:
            return Located(hits[0]["id"], how, hits[0].get("name") or name)
        if len(hits) > 1:
            return Located(None, None, name, _problem(
                "ambiguous_name", f"{where}: „{name}“ passt auf mehrere Teilnehmer - bitte aus der Liste wählen."))
        numbered = lookup.by_number(start_number) if start_number else []
        if len(numbered) == 1:
            other = numbered[0].get("name") or ""
            return Located(numbered[0]["id"], "start_number", other, note=_problem(
                "name_differs", f"{where}: „{name}“ über die Startnummer {start_number} als „{other}“ erkannt."))
        key = series_identity.normalize_name(name)
        return Located(NEW_PREFIX + key, "new", name)
    if start_number:
        numbered = lookup.by_number(start_number)
        if len(numbered) == 1:
            return Located(numbered[0]["id"], "start_number", numbered[0].get("name") or "")
        code = "ambiguous_start_number" if numbered else "unknown_start_number"
        text = "passt auf mehrere Teilnehmer" if numbered else "kennt die Saison nicht"
        return Located(None, None, "", _problem(code, f"{where}: Die Startnummer {start_number} {text}."))
    return Located(None, None, "", _problem("missing_participant", f"{where}: Name oder Teilnehmer fehlt."))


def _remember_new(resolution: Resolution, located: Located, ref: dict, *, row: int | None = None,
                  match: int | None = None, team: str | None = None) -> None:
    if located.match != "new":
        return
    key = located.participant_id[len(NEW_PREFIX):]
    person = resolution.new_people.setdefault(key, {
        "key": key, "participant_id": located.participant_id, "name": located.name,
        "start_number": clean(ref.get("start_number"))[:10] or None, "team": team or None, "rows": [],
        "matches": []})
    if row is not None:
        person["rows"].append(row)
    if match is not None and match not in person["matches"]:
        person["matches"].append(match)
    if team and not person["team"]:
        person["team"] = team


def _points_source(raw: dict, rules: dict) -> tuple[str, object]:
    """Herkunft der eingetragenen Punkte. Serie „laut Veranstalter“: jede Zeile zählt wie eingetragen („organizer“,
    „manual“ bleibt „manual“). Serie mit Schlüssel: nur „manual“ überschreibt den Schlüssel; „organizer“ bleibt der
    Wert des Veranstalters - gespeichert und verglichen (Warnung ``points_differ``), gezählt wird der Schlüssel."""
    points = raw.get("points")
    points = None if points is None else number(float(points))
    source = raw.get("points_source")
    if rules["points_mode"] == "organizer":
        return ("manual" if source == "manual" and points is not None else "organizer"), points
    if source in ("manual", "organizer") and points is not None:
        return source, points
    return "scheme", points


def resolve(entry: dict, participants: list[dict], rules: dict) -> Resolution:
    """Die Eingabe (``rows``, ``matches``, ``official_team_totals``, ``official_table``, ``note``) den Teilnehmern der
    Serie zuordnen. ``rules`` sind normalisiert (``scoring_rules.normalize_rules``)."""
    lookup = _Lookup(participants)
    out = Resolution(note=clean(entry.get("note"))[:1000] or None)
    seen: dict[str, list[int]] = {}
    for index, raw in enumerate(entry.get("rows") or []):
        located = _locate(raw, lookup, f"Zeile {index + 1}")
        if located.problem:
            out.errors.append({**located.problem, "rows": [index]})
        if located.note:
            out.warnings.append({**located.note, "rows": [index]})
        team = clean(raw.get("team"))[:120] or None
        source, points = _points_source(raw, rules)
        marks = {str(mark) for mark in raw.get("marks") or []}
        if raw.get("dnf"):
            marks.add("dnf")  # Ausfall als Feld (so liefert ihn die Texterkennung) ist die Marke „dnf“
        row = {"index": index, "participant_id": located.participant_id, "match": located.match,
               "name": located.name, "place": raw.get("place") or None, "team": team, "points": points,
               "points_source": source, "marks": sorted(marks),
               "penalty_points": number(float(raw.get("penalty_points") or 0)),
               "note": clean(raw.get("note"))[:300] or None,
               "start_number": clean(raw.get("start_number"))[:10] or None, "grid": raw.get("grid") or None,
               "time": lap_text(raw.get("time")), "gap": lap_text(raw.get("gap"))}
        out.rows.append(row)
        if located.participant_id:
            seen.setdefault(located.participant_id, []).append(index)
            _remember_new(out, located, raw, row=index, team=team)
            total = raw.get("official_total")
            if total is not None:
                out.official_totals[located.participant_id] = number(float(total))
    for pid, indices in seen.items():
        if len(indices) > 1:
            name = next(row["name"] for row in out.rows if row["participant_id"] == pid)
            out.errors.append(_problem("duplicate_participant",
                                       f"„{name}“ steht mehrfach im Blatt ({_rows_text(indices)}).", indices))
    _race_extras(out, entry, lookup, seen)

    for index, raw in enumerate(entry.get("matches") or []):
        lineup = _lineup_ids(out, raw.get("lineup"), lookup, index, f"Spiel {index + 1}, Aufstellung")
        maps = []
        for number_of_map, item in enumerate(raw.get("maps") or [], start=1):
            # Aufstellung je Map (#1931) - nur, wenn angegeben.
            map_lineup = _lineup_ids(out, item.get("lineup"), lookup, index, f"Spiel {index + 1}, Map {number_of_map}")
            maps.append({"name": clean(item.get("name"))[:80], "home_score": number(float(item.get("home_score") or 0)),
                         "away_score": number(float(item.get("away_score") or 0)),
                         **team_league_sheet.map_extras(item, map_lineup)})
        extras, problem = team_league_sheet.match_extras(raw)
        if problem:
            out.errors.append(_problem("match_time", f"Spiel {index + 1}: {problem}", match=index))
        out.matches.append({
            "home": clean(raw.get("home"))[:120], "away": clean(raw.get("away"))[:120],
            "home_score": number(float(raw.get("home_score") or 0)),
            "away_score": number(float(raw.get("away_score") or 0)),
            "maps": maps,
            "lineup": team_league_sheet.union(lineup, *(item.get("lineup") for item in maps)),
            **extras,
        })

    out.official_team_totals = {clean(team)[:120]: number(float(value))
                                for team, value in (entry.get("official_team_totals") or {}).items() if clean(team)}
    for raw in entry.get("official_table") or []:
        row = {"team": clean(raw.get("team"))[:120], "rank": raw.get("rank")}
        row.update({key: number(float(raw[key])) if raw.get(key) is not None else None for key in TABLE_NUMBERS})
        out.official_table.append(row)
    return out


def _lineup_ids(out: Resolution, refs, lookup: _Lookup, index: int, where: str) -> list[str]:
    """Die Kennungen einer Aufstellung (des Spiels oder einer Map), jede einmal; Probleme nennen das Spiel."""
    lineup: list[str] = []
    for ref in refs or []:
        located = _locate(ref, lookup, where)
        if located.problem:
            out.errors.append({**located.problem, "match": index})
            continue
        if located.note:
            out.warnings.append({**located.note, "match": index})
        _remember_new(out, located, ref, match=index)
        if located.participant_id not in lineup:
            lineup.append(located.participant_id)
    return lineup


def _named(ref) -> bool:
    return isinstance(ref, dict) and any(clean(ref.get(key)) for key in ("participant_id", "name", "start_number"))


def _in_list(out: Resolution, ref, lookup: _Lookup, seen: dict, where: str, code: str, field: str) -> str | None:
    """Wer bei schnellster Runde bzw. Fahrer des Tages gemeint ist - muss eine Zeile der Liste sein. Probleme tragen
    ``field`` (``fastest_lap``, ``driver_of_the_day``), damit die Oberfläche sie am Feld zeigt."""
    if not _named(ref):
        return None
    located = _locate(ref, lookup, where)
    if located.problem:
        out.errors.append({**located.problem, "field": field})
        return None
    if located.participant_id not in seen:
        label = located.name or clean(ref.get("start_number"))
        out.errors.append(_problem(code, f"{where}: „{label}“ steht nicht in der Ergebnisliste.", field=field))
        return None
    return located.participant_id


def _race_extras(out: Resolution, entry: dict, lookup: _Lookup, seen: dict) -> None:
    """Schnellste Runde und Fahrer des Tages (#1927) den Zeilen zuordnen."""
    fastest = entry.get("fastest_lap")
    if isinstance(fastest, dict):
        time = lap_text(fastest.get("time"))
        pid = _in_list(out, fastest, lookup, seen, "Schnellste Runde", "fastest_lap_not_in_list", "fastest_lap")
        if pid is None and not _named(fastest):
            marked = [row["participant_id"] for row in out.rows
                      if row["participant_id"] and "fastest_lap" in row["marks"]]
            pid = marked[0] if len(marked) == 1 else None
            if pid is None and time:
                # Eine Zeit ohne Fahrer wäre ein verwaister Wert - abgelehnt, mit Hinweis am Feld.
                out.errors.append(_problem(
                    "fastest_lap_without_driver", "Schnellste Runde: Zur Zeit fehlt der Fahrer - bitte den Fahrer "
                    "eintragen oder genau eine Zeile als „Schnellste Runde“ markieren.", field="fastest_lap"))
                return _driver_of_the_day(out, entry, lookup, seen)
        if pid:
            for row in out.rows:
                if row["participant_id"] == pid and "fastest_lap" not in row["marks"]:
                    row["marks"] = sorted([*row["marks"], "fastest_lap"])
        if pid:
            out.fastest_lap = {"participant_id": pid, "time": time}
    _driver_of_the_day(out, entry, lookup, seen)


def _driver_of_the_day(out: Resolution, entry: dict, lookup: _Lookup, seen: dict) -> None:
    day = entry.get("driver_of_the_day")
    if isinstance(day, str):
        day = {"name": day}
    out.driver_of_the_day = _in_list(out, day, lookup, seen, "Fahrer des Tages", "driver_of_the_day_not_in_list",
                                     "driver_of_the_day")


def replace_new_ids(content: dict, created: dict[str, str]) -> dict:
    """Die Kennungen ``neu:<Schlüssel>`` durch die der angelegten Teilnehmer ersetzen (``created``: Schlüssel →
    Kennung)."""
    def real(pid):
        return created.get(pid[len(NEW_PREFIX):], pid) if is_new(pid) else pid

    out = dict(content)
    out["rows"] = [{**row, "participant_id": real(row["participant_id"])} for row in content.get("rows") or []]
    out["matches"] = [{**match, "lineup": [real(pid) for pid in match.get("lineup") or []],
                       "maps": [{**item, "lineup": [real(pid) for pid in item["lineup"]]} if item.get("lineup")
                                else item for item in match.get("maps") or []]}
                      for match in content.get("matches") or []]
    out["official_totals"] = {real(pid): value for pid, value in (content.get("official_totals") or {}).items()}
    if content.get("fastest_lap") and content["fastest_lap"].get("participant_id"):
        fastest = content["fastest_lap"]
        out["fastest_lap"] = {**fastest, "participant_id": real(fastest["participant_id"])}
    if content.get("driver_of_the_day"):
        out["driver_of_the_day"] = real(content["driver_of_the_day"])
    return out


# ---------------------------------------------------------------- Plausibilität
def _places(resolution: Resolution) -> list[dict]:
    problems = []
    by_place: dict[int, list[int]] = {}
    for row in resolution.rows:
        place = row["place"]
        if place:
            by_place.setdefault(place, []).append(row["index"])
        elif not row["marks"] and row["participant_id"]:
            problems.append(_problem("place_missing", f"Zeile {row['index'] + 1}: Platz fehlt.", [row["index"]]))
        if place and "dns" in row["marks"]:
            problems.append(_problem("dns_with_place", f"Zeile {row['index'] + 1}: Nichtstart, aber Platz {place}.",
                                     [row["index"]]))
    for place, indices in sorted(by_place.items()):
        if len(indices) > 1:
            problems.append(_problem("place_twice", f"Platz {place} steht mehrfach ({_rows_text(indices)}).", indices))
    if by_place:
        missing = [place for place in range(1, max(by_place) + 1) if place not in by_place]
        if missing:
            shown = ", ".join(str(place) for place in missing[:10]) + (" …" if len(missing) > 10 else "")
            text = f"Platz {shown} fehlt" if len(missing) == 1 else f"Plätze {shown} fehlen"
            problems.append(_problem("place_gap", f"{text} in der Reihenfolge.", places=missing))
    return problems


def _points(resolution: Resolution, rules: dict) -> list[dict]:
    problems = []
    for row in resolution.rows:
        if not row["participant_id"]:
            continue
        marks = set(row["marks"])
        if rules["points_mode"] == "organizer":
            if row["points"] is None and "dns" not in marks:
                problems.append(_problem("points_missing", f"Zeile {row['index'] + 1}: Punkte laut Veranstalter "
                                         "fehlen - die Zeile zählt mit 0.", [row["index"]]))
            continue
        if row["points"] is None:
            continue
        scheme = result_points({**row, "points_source": "scheme"}, rules)["points"]
        if number(row["points"]) == scheme:
            continue
        if row["points_source"] == "manual":
            problems.append(_problem("points_manual", f"Zeile {row['index'] + 1}: {number(row['points'])} Punkte "
                                     f"von Hand statt {scheme} nach Schlüssel.", [row["index"]]))
        else:
            problems.append(_problem("points_differ", f"Zeile {row['index'] + 1}: {number(row['points'])} Punkte "
                                     f"passen nicht zum Schlüssel ({scheme}) - gezählt wird der Schlüssel.",
                                     [row["index"]]))
    return problems


def _matches(resolution: Resolution, own_teams) -> list[dict]:
    problems = []
    # Eigene Teams (#1926): eines davon muss spielen - erkannt auch an anderer Schreibweise oder einem Alias.
    own = Matcher(own_teams if isinstance(own_teams, (list, tuple)) else [own_teams])
    others = _sheet_teams(resolution)
    # Die übrigen Spiele des Spieltags (#1931) brauchen kein eigenes Team - eines der Spiele muss es aber haben.
    matches = resolution.matches
    if own and matches and not any(own.is_own(match["home"], others) or own.is_own(match["away"], others)
                                   for match in matches):
        single = len(own.names) == 1
        if len(matches) == 1:
            text = f"Das eigene Team „{own.names[0]}“ spielt" if single else "Keines der eigenen Teams spielt"
            problems.append(_problem("own_team_missing", f"Spiel 1: {text} darin nicht.", match=0))
        else:
            text = f"Das eigene Team „{own.names[0]}“ spielt" if single else "Keines der eigenen Teams spielt"
            problems.append(_problem("own_team_missing", f"{text} in keinem der Spiele."))
    for index, match in enumerate(matches):
        if match["maps"]:
            home = sum(1 for item in match["maps"] if item["home_score"] > item["away_score"])
            away = sum(1 for item in match["maps"] if item["away_score"] > item["home_score"])
            if (home, away) != (match["home_score"], match["away_score"]):
                problems.append(_problem(
                    "maps_differ", f"Spiel {index + 1}: Die Maps ergeben {home}:{away}, eingetragen ist "
                    f"{number(match['home_score'])}:{number(match['away_score'])}.", match=index))
    teams: dict[str, int] = {}
    for row in resolution.official_table:
        key = row["team"].casefold()
        teams[key] = teams.get(key, 0) + 1
    for row in resolution.official_table:
        if teams.get(row["team"].casefold(), 0) > 1:
            problems.append(_problem("table_team_twice", f"„{row['team']}“ steht mehrfach in der Tabelle."))
            teams[row["team"].casefold()] = 0
    ranks = [row["rank"] for row in resolution.official_table]
    if any(rank is not None for rank in ranks) and any(rank is None for rank in ranks):
        problems.append(_problem("table_rank_partial", "In der Tabelle fehlt bei manchen Teams der Platz - die "
                                 "Reihenfolge wird aus den Punkten gerechnet."))
    return problems


def _sheet_teams(resolution: Resolution) -> list[str]:
    names = [row["team"] for row in resolution.rows if row.get("team")]
    names += [match[side] for match in resolution.matches for side in ("home", "away") if match.get(side)]
    return names + [row["team"] for row in resolution.official_table if row.get("team")]


def _spellings(resolution: Resolution, own_teams) -> list[dict]:
    """Schreibweisen, die wie ein eigenes Team aussehen, aber nicht still zusammengelegt werden (#1926): ein wörtlich
    anderes Team mit derselben Schreibweise steht daneben, oder sie passt zu mehreren eigenen Teams."""
    own = Matcher(own_teams if isinstance(own_teams, (list, tuple)) else [own_teams])
    problems = []
    for conflict in own.spelling_conflicts(_sheet_teams(resolution)):
        name = conflict["name"]
        rows = [row["index"] for row in resolution.rows if clean(row.get("team")).casefold() == name.casefold()]
        alike = " und ".join(f"„{team}“" for team in conflict["teams"])
        problems.append(_problem("own_team_spelling", f"„{name}“ sieht aus wie {alike} - es zählt nicht als eigenes "
                                 "Team. Ist es dasselbe Team, in der Saison als Schreibweise eintragen.", rows))
    return problems


def check(resolution: Resolution, rules: dict, round_doc: dict, today: str, own_teams=None) -> None:
    """Fehler und Warnungen zum Blatt ergänzen (an ``resolution.errors`` und ``.warnings``). ``own_teams``: die eigenen
    Teams der Saison (Liste aus ``own_teams.own_teams``, ein einzelner Name geht auch)."""
    errors, warnings = resolution.errors, resolution.warnings
    if not resolution.rows and not resolution.matches and not resolution.official_table:
        errors.append(_problem("empty", "Das Blatt ist leer - mindestens eine Zeile, ein Spiel oder die Tabelle."))
    if round_doc.get("archived_at"):
        errors.append(_problem("round_archived", "Der Termin ist archiviert."))
    if round_doc.get("status") == "cancelled":
        errors.append(_problem("round_cancelled", "Der Termin ist abgesagt - erst die Absage zurücknehmen."))
    day = round_doc.get("club_day")
    if day and str(day) > today:
        warnings.append(_problem("round_in_future", "Der Termin liegt in der Zukunft."))
    if round_doc.get("counts") is False:
        warnings.append(_problem("round_not_counted", "Der Termin zählt nicht zur Wertung."))
    warnings.extend(_places(resolution))
    fastest = [row["index"] for row in resolution.rows if row["participant_id"] and "fastest_lap" in row["marks"]]
    if len(fastest) > 1:
        warnings.append(_problem("fastest_lap_twice", f"Die schnellste Runde ist mehrfach markiert "
                                 f"({_rows_text(fastest)}).", fastest))
    warnings.extend(_points(resolution, rules))
    warnings.extend(_matches(resolution, own_teams))
    warnings.extend(_spellings(resolution, own_teams))


def official_warnings(rows: list[dict], names: dict[str, str], *, scope: str) -> list[dict]:
    """Abweichungen zum offiziellen Gesamtstand im gerechneten Stand dieser Runde."""
    out = []
    for row in rows:
        deviation = row.get("deviation")
        if deviation in (None, 0):
            continue
        label = row.get("team") if scope != "drivers" else names.get(row.get("participant_id"), "")
        out.append(_problem("official_differs", f"„{label}“: offiziell {number(row['official_points'])}, "
                            f"gerechnet {number(row['computed_points'])} ({'+' if deviation > 0 else ''}"
                            f"{number(deviation)}).", scope=scope))
    return out


# ---------------------------------------------------------------- Finalgrenze
def final_line(rows: list[dict], previous: list[dict] | None, top_n: int | None) -> dict | None:
    """Wer nach dieser Runde unter den besten ``top_n`` steht (Platz bis ``top_n``, geteilte Plätze eingeschlossen),
    wer neu drin ist und wer herausgefallen ist - verglichen mit dem Stand der Runde davor."""
    if not top_n:
        return None
    inside = [row["participant_id"] for row in rows if row.get("rank") and row["rank"] <= top_n]
    before = [row["participant_id"] for row in previous or [] if row.get("rank") and row["rank"] <= top_n]
    return {"top_n": top_n, "participant_ids": inside,
            "entered": [pid for pid in inside if previous is not None and pid not in before],
            "left": [pid for pid in before if pid not in inside]}
