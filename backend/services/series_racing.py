"""Seite Rennliga (#1746): was eine Spur der Art ``racing`` zur Serienseite (#1745) dazu bekommt.

Gerechnet wird nichts - alles kommt aus dem gespeicherten Stand der letzten gewerteten Runde
(``reference_standings``, ``services/series_standings.py``):

- **Saisons der Spur** für den Umschalter (F1 aktuell, F2, Vorsaison): sichtbar und nicht archiviert, neueste Saison
  zuerst, darin nach Stufe. Die Sichtbarkeit jeder Saison gilt wie für ihre Seite; geladen wird gesammelt - eine
  Abfrage für alle Saisons, eine Prüfung je Sichtbarkeitsstufe statt je Saison.
- **Teamwertung** (``scope = teams``), wenn die Regeln sie einschalten: je Team Rang, Punkte, offizieller Wert mit
  Abweichung, je Rennen die gezählten Fahrer und über die Saison alle Fahrer des Teams nach Punkten.
- **Fahrer:** je Fahrer das Team je Rennen (Team der Zeile, sonst das Standard-Team - wie die Teamwertung zählt), das
  aktuelle Team (das des letzten Rennens) und die Marke „Gast“. Mehr nicht: Namen kommen wie auf der Serienseite nur
  über die Tabelle, ohne Startnummer, Profil oder Verknüpfung.
- **Vereinsteams:** das eigene Team der Saison (``team_name``) und jedes Team, für das ein Vereinsmitglied zuletzt
  gefahren ist - in der Reihenfolge der Teamwertung, ohne sie nach Namen.
"""
from __future__ import annotations

from services.scoring_rules import normalize_rules
from services.visibility import user_can_see

SEASON_FIELDS = ("season", "tier", "title", "season_slug", "status")
TEAM_ROW_FIELDS = ("rank", "tiebreak", "points", "computed_points", "official_points", "deviation")


def _text(value) -> str:
    return str(value or "").strip()


async def lineage_seasons(db, user: dict | None, lineage: dict, current_id: str) -> list[dict]:
    """Sichtbare, nicht archivierte Saisons der Spur: neueste Saison zuerst, darin nach Stufe."""
    found = await db.reference_series.find(
        {"lineage_id": lineage["id"], "status": {"$ne": "archived"}},
        {"_id": 0, "id": 1, "visibility": 1, **{field: 1 for field in SEASON_FIELDS}}).to_list(None)
    allowed = {level: await user_can_see(user, level) for level in {item.get("visibility") for item in found}}
    visible = [item for item in found if allowed[item.get("visibility")]]
    visible.sort(key=lambda item: (_text(item.get("tier")).casefold(), str(item.get("id"))))
    visible.sort(key=lambda item: _text(item.get("season")).casefold(), reverse=True)
    return [{**{field: item.get(field) for field in SEASON_FIELDS}, "current": item["id"] == current_id}
            for item in visible]


def driver_teams(rows: list[dict], participants: dict) -> dict:
    """Je Fahrer der Fahrerwertung: Team je Rennen, aktuelles Team (das des letzten Rennens) und „Gast“."""
    out = {}
    for row in rows:
        pid = row.get("participant_id")
        person = participants.get(pid) or {}
        default = _text(person.get("default_team")) or None
        round_teams = {item.get("round_id"): _text(item.get("team")) or default for item in row.get("results") or []}
        current = next((team for team in reversed(list(round_teams.values())) if team), default)
        out[pid] = {"team": current, "guest": person.get("link") == "guest", "round_teams": round_teams}
    return out


def team_rows(rows: list[dict]) -> list[dict]:
    """Die gespeicherte Teamwertung, wie die Seite sie zeigt."""
    out = []
    for row in rows:
        change, rank = row.get("rank_change"), row.get("rank")
        out.append({
            "key": row.get("team"), "team": row.get("team"),
            **{field: row.get(field) for field in TEAM_ROW_FIELDS},
            "previous_rank": None if change is None or rank is None else rank + change,
            "drivers": list(row.get("driver_ids") or []),
            "results": [{"round_id": item.get("round_id"), "points": item.get("points"),
                         "drivers": list(item.get("driver_ids") or [])} for item in row.get("round_points") or []],
        })
    return out


def club_teams(drivers: dict, people: dict, team_order: list[str], own_team: str | None) -> list[str]:
    """Das eigene Team der Saison und jedes Team, für das ein Vereinsmitglied zuletzt gefahren ist."""
    teams = {own_team} if own_team else set()
    teams |= {item["team"] for pid, item in drivers.items()
              if item.get("team") and (people.get(pid) or {}).get("club_member")}
    position = {team: index for index, team in enumerate(team_order)}
    return sorted(teams, key=lambda team: (position.get(team, len(position)), team.casefold(), team))


async def racing_block(db, user: dict | None, lineage: dict, series: dict, people: dict,
                       latest: dict | None) -> dict | None:
    """Der Rennliga-Teil der Serienseite - bei anderen Arten ``None``. ``people``: öffentliche Personen der Saison (wie
    die Tabelle sie zeigt), ``latest``: der gespeicherte Fahrerstand der letzten gewerteten Runde (oder ``None``)."""
    if lineage.get("kind") != "racing":
        return None
    sid = series["id"]
    try:
        scoring = normalize_rules(series.get("rules") or {})["team_scoring"]
    except ValueError:
        scoring = normalize_rules({})["team_scoring"]
    participants = {item["id"]: item async for item in db.reference_participants.find(
        {"series_id": sid}, {"_id": 0, "id": 1, "default_team": 1, "link": 1})}
    drivers = driver_teams((latest or {}).get("rows") or [], participants)
    stored = await db.reference_standings.find_one(
        {"series_id": sid, "scope": "teams"}, {"_id": 0, "round_id": 1, "round_seq": 1, "rows": 1, "computed_at": 1},
        sort=[("round_seq", -1)]) if scoring["enabled"] else None
    teams = None if not stored else {
        "round_id": stored.get("round_id"), "round_seq": stored.get("round_seq"),
        "computed_at": stored.get("computed_at"), "rows": team_rows(stored.get("rows") or []),
    }
    order = [row["team"] for row in (teams or {}).get("rows") or []]
    return {
        "seasons": await lineage_seasons(db, user, lineage, sid),
        "team_scoring": scoring,
        "teams": teams,
        "drivers": drivers,
        "club_teams": club_teams(drivers, people, order, _text(series.get("team_name")) or None),
    }
