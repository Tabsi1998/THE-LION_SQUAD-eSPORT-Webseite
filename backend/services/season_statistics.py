"""Statistik einer Saison der Rennliga (#1950): je Fahrer und je Team Siege, Podien, Poles, schnellste Runden,
Fahrer des Tages, Ausfälle, Ø Startplatz, Ø Zielplatz und gutgemachte Plätze - gezählt aus den veröffentlichten
Ergebnisblättern.

- **Läufe:** gezählt werden Läufe, die zur Wertung zählen, nicht abgesagt und nicht archiviert sind; ein Qualifying
  zählt nur für die Pole. Siege und Podien gelten wie in der Fahrerwertung (``series_standings._stats``) in jedem
  gewerteten Lauf, der kein Qualifying ist (Rennen und Sprint).
- **Pole:** je Runde eine - der erste gültige Platz im Haupt-Qualifying (``race_weekend.pole_holder``), nur in einer
  Runde ohne Quali-Ergebnis die Pole-Marke im Rennen (Bestand #1927), nie aus einem Lauf mit umgekehrter Aufstellung
  (#1960). So zählt eine Pole nie doppelt, auch wenn das Rennen die Marke trägt.
- **Ohne Wertung** (#1960): ein Termin ohne Wertung zählt nicht - wie jeder Lauf mit ``counts: false``.
- **Ø Start, Ø Ziel, gutgemacht:** Start aus dem Startplatz, Ziel aus dem Platz (nur im Ziel); gutgemacht ist die
  Summe aus Startplatz minus Zielplatz über die Läufe, in denen beides steht.
- **Kennzahlen** (``metrics``): nur die, die in der Saison vorkommen - keine Spalte voller Nullen.
- **Team** je Lauf: das Team der Zeile, sonst das Standard-Team; Schreibweisen eigener Teams zählen als dieses Team.
- **Namen** nach den Regeln der Serienseite (``people``): ein ausgeblendeter Name kommt nicht mit.
"""
from __future__ import annotations

from services.own_teams import Matcher, own_teams
from services.race_weekend import SESSION_REVERSES, is_main_qualifying, pole_holder, round_plan, session_kind
from services.round_page import clean, place_of, status_of

COUNTS = ("wins", "podiums", "poles", "fastest_laps", "driver_of_the_day", "dnfs", "gained")
AVERAGES = ("avg_grid", "avg_finish")
METRICS = ("wins", "podiums", "poles", "fastest_laps", "driver_of_the_day", "dnfs", "avg_grid", "avg_finish", "gained")


def _blank() -> dict:
    return {**{key: 0 for key in COUNTS}, "races": 0, "_grid": [], "_finish": [], "_gained_races": 0}


def _average(values: list[int]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _finish(entry: dict) -> dict:
    out = {key: entry[key] for key in COUNTS}
    out["races"] = entry["races"]
    out["avg_grid"] = _average(entry["_grid"])
    out["avg_finish"] = _average(entry["_finish"])
    if not entry["_gained_races"]:
        out["gained"] = None
    return out


def present_metrics(rows: list[dict]) -> list[str]:
    """Kennzahlen, die bei mindestens einer Zeile etwas zeigen (keine Nullen, kein leerer Durchschnitt)."""
    return [key for key in METRICS if any(row.get(key) not in (None, 0) for row in rows)]


def tally(rounds: list[dict], sheets: dict, participants: dict, series: dict,
          results: dict | None = None) -> tuple[dict, dict, set]:
    """Zählt je Fahrer und je Team. ``rounds``: annotierter Kalender (ohne archivierte), ``sheets``: veröffentlichte
    Blätter je Termin, ``results``: je (Fahrer, Termin) das Ergebnis aus dem letzten Fahrerstand. Liefert (Fahrer,
    Teams, eigene Teams)."""
    matcher = Matcher(own_teams(series))
    defaults = [clean(item.get("default_team")) for item in participants.values() if item.get("default_team")]
    drivers: dict[str, dict] = {}
    teams: dict[str, dict] = {}
    own: set = set()
    poles: dict = {}
    # #1960: Poles nur aus dem Qualifying - die Pole-Marke eines Rennens zählt nur in einer Runde ohne Ergebnis eines
    # Haupt-Qualifyings und nie in einem Lauf mit umgekehrter Aufstellung.
    plan = round_plan(rounds, series.get("weekend"))
    with_quali = {item.get("weekend") or item["id"] for item in rounds
                  if (item.get("session_kind") or session_kind(item.get("session"))) == "qualifying"
                  and is_main_qualifying(item.get("session")) and item.get("state") != "cancelled"
                  and item["id"] in sheets}

    def team_of(row: dict, others: list[str]) -> str | None:
        team = clean(row.get("team"))
        if team:
            return matcher.canonical(team, others)
        default = clean((participants.get(row.get("participant_id")) or {}).get("default_team"))
        return matcher.canonical(default, defaults) if default else None

    def bump(pid: str, team: str | None, key: str, amount=1) -> None:
        drivers.setdefault(pid, _blank())[key] += amount
        if team:
            teams.setdefault(team, _blank())[key] += amount

    for item in rounds:
        sheet = sheets.get(item["id"])
        kind = item.get("session_kind") or session_kind(item.get("session"))
        # Ein Qualifying zählt meist nicht zur Wertung - für die Pole gilt es trotzdem.
        if not sheet or item.get("state") == "cancelled" or (item.get("counts") is False and kind != "qualifying"):
            continue
        rows = [row for row in sheet.get("rows") or [] if row.get("participant_id")]
        others = [clean(row.get("team")) for row in rows if clean(row.get("team"))]
        weekend = item.get("weekend") or item["id"]
        if kind == "qualifying":
            if is_main_qualifying(item.get("session")):
                holder = pole_holder(rows)
                if holder:
                    row = next(row for row in rows if row["participant_id"] == holder)
                    poles[weekend] = (holder, team_of(row, others), True)
            continue
        fastest = (sheet.get("fastest_lap") or {}).get("participant_id")
        grid_source = ((plan.get(item["id"]) or {}).get("config") or {}).get("grid")
        race_pole = weekend not in with_quali and grid_source not in SESSION_REVERSES
        for row in rows:
            pid = row["participant_id"]
            team = team_of(row, others)
            if team and matcher.is_own(team, others):
                own.add(team)
            # Startplatz und Pole wie gerechnet (aus dem Qualifying bzw. der umgekehrten Wertung), wo das Blatt sie
            # leer lässt - so wie die Ergebnistabelle der Runde.
            stored = (results or {}).get((pid, item["id"])) or {}
            marks = {str(mark) for mark in (stored["marks"] if "marks" in stored else row.get("marks")) or []}
            status = status_of(marks)
            entry = drivers.setdefault(pid, _blank())
            team_entry = teams.setdefault(team, _blank()) if team else None
            if status == "dns":
                continue
            for target in (entry, team_entry):
                if target is not None:
                    target["races"] += 1
            place = place_of(row)
            grid = next((value for value in (row.get("grid"), stored.get("grid")) if isinstance(value, int)), None)
            if status == "finished" and place:
                if place == 1:
                    bump(pid, team, "wins")
                if place <= 3:
                    bump(pid, team, "podiums")
                for target in (entry, team_entry):
                    if target is not None:
                        target["_finish"].append(place)
                if grid:
                    bump(pid, team, "gained", grid - place)
                    for target in (entry, team_entry):
                        if target is not None:
                            target["_gained_races"] += 1
            if grid:
                for target in (entry, team_entry):
                    if target is not None:
                        target["_grid"].append(grid)
            if status == "dnf":
                bump(pid, team, "dnfs")
            if fastest == pid or "fastest_lap" in marks:
                bump(pid, team, "fastest_laps")
            if sheet.get("driver_of_the_day") == pid:
                bump(pid, team, "driver_of_the_day")
            # Ohne Qualifying zählt die Pole-Marke im Rennen (je Runde einmal).
            if race_pole and "pole" in marks and weekend not in poles:
                poles[weekend] = (pid, team, False)
    for pid, team, _ in poles.values():
        bump(pid, team, "poles")
    return drivers, teams, own


def statistics_view(drivers: dict, teams: dict, own: set, people: dict) -> dict:
    """Fahrer und Teams mit ihren Kennzahlen, nur wer etwas gefahren ist oder eine Pole hat."""
    driver_rows = []
    for pid, entry in drivers.items():
        if not entry["races"] and not entry["poles"]:
            continue
        person = people.get(pid) or {"name": None, "name_hidden": True, "club_member": False, "profile_slug": None}
        driver_rows.append({
            "key": pid, "name": None if person.get("name_hidden") else person.get("name"),
            "name_hidden": bool(person.get("name_hidden")), "club_member": bool(person.get("club_member")),
            "profile_slug": person.get("profile_slug"), **_finish(entry),
        })
    team_rows = [{"key": team, "team": team, "own": team in own, **_finish(entry)}
                 for team, entry in teams.items() if entry["races"] or entry["poles"]]
    driver_rows.sort(key=lambda row: (str(row["name"] or "~").casefold(), str(row["key"])))
    team_rows.sort(key=lambda row: str(row["team"]).casefold())
    return {"drivers": driver_rows, "teams": team_rows,
            "metrics": {"drivers": present_metrics(driver_rows), "teams": present_metrics(team_rows)}}


async def load_statistics(db, series: dict, rounds: list[dict], people: dict) -> dict:
    sid = series["id"]
    ids = [item["id"] for item in rounds if item.get("state") != "cancelled"]
    sheets = {item["round_id"]: item async for item in db.reference_round_results.find(
        {"series_id": sid, "round_id": {"$in": ids}, "status": "published"},
        {"_id": 0, "round_id": 1, "rows": 1, "fastest_lap": 1, "driver_of_the_day": 1})} if ids else {}
    participants = {item["id"]: item async for item in db.reference_participants.find(
        {"series_id": sid}, {"_id": 0, "id": 1, "default_team": 1})}
    latest = await db.reference_standings.find_one(
        {"series_id": sid, "scope": "drivers"}, {"_id": 0, "rows.participant_id": 1, "rows.results": 1},
        sort=[("round_seq", -1)]) or {}
    results = {(row.get("participant_id"), result.get("round_id")): result
               for row in latest.get("rows") or [] for result in row.get("results") or []}
    drivers, teams, own = tally(rounds, sheets, participants, series, results)
    return statistics_view(drivers, teams, own, people)
