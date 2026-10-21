"""Einsätze je Person (#1931): „5 von 7 Spielen“ - für den Kader der Serienseite und das Mitgliederprofil.

- **Team-Liga:** Ein Einsatz ist ein eigenes Spiel mit Aufstellung, in der die Person steht (bei Aufstellung je Map
  steht sie schon in der des Spiels). „Von“ zählt die eigenen Spiele mit Aufstellung des Teams, in dessen Kader die
  Person steht (``default_team`` ist ein eigenes Team, #1926) oder für das sie gespielt hat. Ein Spiel ohne Aufstellung
  zählt nicht mit - da weiß niemand, wer gespielt hat. Wer im Kader steht und an einem Spieltag mit Aufstellung fehlt,
  war an dem Tag Ersatz (``bench_round_ids``).
- **Rennliga und Turnierserie:** Rennen bzw. Runden mit Teilnahme (``rounds_played`` im letzten gespeicherten Stand)
  von den gewerteten Runden mit veröffentlichtem Ergebnis.

Gerechnet wird nur aus Gespeichertem; das Profil bekommt die Zahl je Referenz, deren Saison verknüpft ist (an der
Referenz ``series_id`` oder an der Saison ``reference_id``) - nur für sichtbare Saisons.
"""
from __future__ import annotations

from services.own_teams import Matcher, own_teams
from services.series_standings import ordered_rounds
from services.visibility import user_can_see

UNITS = {"team_league": "matches", "racing": "races"}


def roster_team(person: dict, matcher: Matcher) -> str | None:
    """Das eigene Team, in dessen Kader eine Person steht - ``None`` ohne Team oder bei einem fremden Team."""
    if person.get("kind") == "team":
        return None
    return matcher.resolve(person.get("default_team"))


def team_league_appearances(own_days: list[tuple[str, dict]], participants: list[dict], teams) -> dict[str, dict]:
    """Je Teilnehmer ``{played, of, round_ids, bench_round_ids, in_roster, team}``. ``own_days``: je Termin das eigene
    Spiel (``_own`` nennt das eigene Team) in Kalender-Reihenfolge."""
    matcher = Matcher(teams)
    roster = {person["id"]: roster_team(person, matcher) for person in participants if person.get("id")}
    out: dict[str, dict] = {}

    def entry(pid: str) -> dict:
        return out.setdefault(pid, {"round_ids": [], "teams": set(), "in_roster": bool(roster.get(pid))})

    for pid, team in roster.items():
        if team:
            entry(pid)["teams"].add(team)
    days = [(round_id, match) for round_id, match in own_days if match.get("lineup")]
    for round_id, match in days:
        for pid in dict.fromkeys(match["lineup"]):
            item = entry(pid)
            if round_id not in item["round_ids"]:
                item["round_ids"].append(round_id)
            item["teams"].add(match.get("_own"))
    for pid, item in out.items():
        team_days = list(dict.fromkeys(round_id for round_id, match in days if match.get("_own") in item["teams"]))
        teams_of = item.pop("teams")
        item.update({
            "played": len(item["round_ids"]), "of": len(team_days),
            "bench_round_ids": [round_id for round_id in team_days if round_id not in item["round_ids"]]
            if item["in_roster"] else [],
            "team": roster.get(pid) or (sorted(team for team in teams_of if team) or [None])[0],
        })
    return out


async def _team_league(db, series: dict, pids: set[str]) -> dict | None:
    from services.team_league_page import own_match  # hier: team_league_page liest dieses Modul

    rounds = ordered_rounds(await db.reference_rounds.find(
        {"series_id": series["id"], "archived_at": None},
        {"_id": 0, "id": 1, "order": 1, "starts_at": 1}).to_list(None))
    sheets = {sheet["round_id"]: sheet async for sheet in db.reference_round_results.find(
        {"series_id": series["id"], "status": "published"}, {"_id": 0, "round_id": 1, "matches": 1})}
    teams = own_teams(series)
    own_days = []
    for item in rounds:
        match = own_match(sheets[item["id"]], teams) if item["id"] in sheets else None
        if match:
            own_days.append((item["id"], match))
    people = await db.reference_participants.find(
        {"series_id": series["id"]}, {"_id": 0, "id": 1, "kind": 1, "default_team": 1}).to_list(None)
    found = [value for pid, value in team_league_appearances(own_days, people, teams).items() if pid in pids]
    if not found:
        return None
    played = {round_id for item in found for round_id in item["round_ids"]}
    best = max(found, key=lambda item: (item["of"], item["played"]))
    return {"played": len(played), "of": best["of"], "unit": "matches", "team": best["team"]}


async def _rounds_played(db, series: dict, pids: set[str], unit: str) -> dict | None:
    latest = await db.reference_standings.find_one(
        {"series_id": series["id"], "scope": "drivers"}, {"_id": 0, "rows.participant_id": 1, "rows.rounds_played": 1},
        sort=[("round_seq", -1)])
    rows = [row for row in (latest or {}).get("rows") or [] if row.get("participant_id") in pids]
    if not rows:
        return None
    scored = {item["id"] async for item in db.reference_rounds.find(
        {"series_id": series["id"], "archived_at": None, "status": "scored", "counts": {"$ne": False}},
        {"_id": 0, "id": 1})}
    sheets = {sheet["round_id"] async for sheet in db.reference_round_results.find(
        {"series_id": series["id"], "status": "published", "round_id": {"$in": sorted(scored)}},
        {"_id": 0, "round_id": 1})}
    return {"played": max(int(row.get("rounds_played") or 0) for row in rows), "of": len(sheets), "unit": unit,
            "team": None}


async def profile_appearances(db, profile_id: str, series_list: list[dict]) -> dict[str, dict]:
    """Einsätze eines Vereinsprofils je sichtbarer Saison: ``{series_id: {played, of, unit, team}}``."""
    if not profile_id or not series_list:
        return {}
    ids = [series["id"] for series in series_list]
    pids_by: dict[str, set] = {}
    async for row in db.reference_participants.find(
            {"series_id": {"$in": ids}, "profile_id": profile_id, "link": "member"},
            {"_id": 0, "id": 1, "series_id": 1}):
        pids_by.setdefault(row["series_id"], set()).add(row["id"])
    lineages = {item["id"]: item async for item in db.reference_lineages.find(
        {"id": {"$in": list({series.get("lineage_id") for series in series_list})}},
        {"_id": 0, "id": 1, "kind": 1, "visibility": 1, "is_archived": 1})}
    out: dict[str, dict] = {}
    for series in series_list:
        lineage = lineages.get(series.get("lineage_id")) or {}
        pids = pids_by.get(series["id"])
        if (not pids or lineage.get("is_archived") or series.get("status") == "archived"
                or not await user_can_see(None, lineage.get("visibility"))
                or not await user_can_see(None, series.get("visibility"))):
            continue
        kind = lineage.get("kind")
        found = (await _team_league(db, series, pids) if kind == "team_league"
                 else await _rounds_played(db, series, pids, UNITS.get(kind, "rounds")))
        if found and (found["played"] or found["of"]):
            out[series["id"]] = found
    return out
