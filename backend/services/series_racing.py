"""Seite Rennliga (#1746): was eine Spur der Art ``racing`` zur Serienseite (#1745) dazu bekommt.

Gerechnet wird nichts - alles kommt aus dem gespeicherten Stand der letzten gewerteten Runde
(``reference_standings``, ``services/series_standings.py``):

- **Saisons der Spur** für den Umschalter (F1 aktuell, F2, Vorsaison): sichtbar und nicht archiviert, neueste Saison
  zuerst, darin nach Stufe. Die Sichtbarkeit jeder Saison gilt wie für ihre Seite; geladen wird gesammelt über die
  Saisonliste der Team-Liga (``team_league_page.visible_seasons``: eine Abfrage, eine Prüfung je Sichtbarkeitsstufe).
- **Teamwertung** (``scope = teams``), wenn die Regeln sie einschalten: je Team Rang, Punkte, offizieller Wert mit
  Abweichung, je Rennen die gezählten Fahrer und über die Saison alle Fahrer des Teams nach Punkten. Dazu der Beitrag
  je Fahrer (``driver_points``): seine Punkte in den Rennen, in denen er fürs Team gezählt hat - so, wie der Rechenkern
  sie gezählt hat (``counting_drivers``, ``guests_count``), aus dem gespeicherten Stand und nicht im Web nachgebaut.
- **Fahrer:** je Fahrer das Team je Rennen (Team der Zeile, sonst das Standard-Team - wie die Teamwertung zählt), das
  aktuelle Team (das des letzten Rennens) und die Marke „Gast“. Mehr nicht: Namen kommen wie auf der Serienseite nur
  über die Tabelle, ohne Startnummer, Profil oder Verknüpfung.
- **Vereinsteams:** alle eigenen Teams der Saison (``own_teams``, #1926 - früher nur ``team_name``) und jedes Team,
  für das ein Vereinsmitglied zuletzt gefahren ist - in der Reihenfolge der Teamwertung, ohne sie nach Namen. Andere
  Schreibweisen eines eigenen Teams (auch als Standard-Team eines Fahrers) zählen als dieses Team.
- **Fahrer-Detail** (``club_drivers``): nur öffentlich sichtbare Vereinsmitglieder - Mitglied, Profil aktiv, Name nicht
  ausgeblendet; dieselbe Regel wie der Profil-Link der Tabelle und der Team-Liga. Die Seite zeigt ein Detail und
  Vereinsnamen außerhalb der Tabellen nur für diese Kennungen.
"""
from __future__ import annotations

from services.own_teams import Matcher, own_teams
from services.scoring_rules import normalize_rules
from services.team_league_page import PATH_FIELDS as SEASON_FIELDS, visible_seasons

TEAM_ROW_FIELDS = ("rank", "tiebreak", "points", "computed_points", "official_points", "deviation")


def _text(value) -> str:
    return str(value or "").strip()


async def lineage_seasons(db, user: dict | None, lineage: dict, current_id: str) -> list[dict]:
    """Sichtbare, nicht archivierte Saisons der Spur: neueste Saison zuerst, darin nach Stufe."""
    visible = await visible_seasons(db, user, lineage["id"])
    visible.sort(key=lambda item: (_text(item.get("tier")).casefold(), str(item.get("id"))))
    visible.sort(key=lambda item: _text(item.get("season")).casefold(), reverse=True)
    return [{**{field: item.get(field) for field in SEASON_FIELDS}, "current": item["id"] == current_id}
            for item in visible]


def driver_teams(rows: list[dict], participants: dict, matcher: Matcher | None = None) -> dict:
    """Je Fahrer der Fahrerwertung: Team je Rennen, aktuelles Team (das des letzten Rennens) und „Gast“. ``matcher``
    führt das Standard-Team auf den Namen eines eigenen Teams zurück (#1926) - wie beim Rechnen, mit allen
    Standard-Teams als Gegenüber. Das Team je Rennen steht schon so im gespeicherten Stand."""
    defaults = [_text(person.get("default_team")) for person in participants.values() if person.get("default_team")]
    out = {}
    for row in rows:
        pid = row.get("participant_id")
        person = participants.get(pid) or {}
        default = _text(person.get("default_team")) or None
        if matcher and default:
            default = matcher.canonical(default, defaults)
        round_teams = {item.get("round_id"): _text(item.get("team")) or default for item in row.get("results") or []}
        current = next((team for team in reversed(list(round_teams.values())) if team), default)
        out[pid] = {"team": current, "guest": person.get("link") == "guest", "round_teams": round_teams}
    return out


def _number(value):
    return int(value) if isinstance(value, float) and value.is_integer() else value


def driver_results(rows: list[dict]) -> dict:
    """Punkte je Fahrer und Rennen aus dem gespeicherten Fahrerstand (``result_points`` des Rechenkerns)."""
    out = {}
    for row in rows:
        results = row.get("results") or []
        out[row.get("participant_id")] = {item.get("round_id"): item.get("points") or 0 for item in results}
    return out


def team_rows(rows: list[dict], results: dict | None = None) -> list[dict]:
    """Die gespeicherte Teamwertung, wie die Seite sie zeigt. ``results`` (aus ``driver_results``) ergibt je Fahrer
    seinen Beitrag: die Punkte der Rennen, in denen er laut gespeichertem Stand fürs Team gezählt hat."""
    results = results or {}
    out = []
    for row in rows:
        change, rank = row.get("rank_change"), row.get("rank")
        contribution: dict[str, float] = {}
        for item in row.get("round_points") or []:
            for pid in item.get("driver_ids") or []:
                points = (results.get(pid) or {}).get(item.get("round_id"), 0)
                contribution[pid] = contribution.get(pid, 0) + points
        out.append({
            "key": row.get("team"), "team": row.get("team"),
            **{field: row.get(field) for field in TEAM_ROW_FIELDS},
            "previous_rank": None if change is None or rank is None else rank + change,
            "drivers": list(row.get("driver_ids") or []),
            "driver_points": {pid: _number(points) for pid, points in contribution.items()},
            "results": [{"round_id": item.get("round_id"), "points": item.get("points"),
                         "drivers": list(item.get("driver_ids") or [])} for item in row.get("round_points") or []],
        })
    return out


def public_club_drivers(rows: list[dict], people: dict) -> list[str]:
    """Wer ein Fahrer-Detail bekommt: öffentlich sichtbare Vereinsmitglieder (Mitglied, Profil aktiv, Name nicht
    ausgeblendet - ``people`` setzt ``profile_slug`` nur dann), in der Reihenfolge der Fahrerwertung."""
    out = []
    for row in rows:
        person = people.get(row.get("participant_id")) or {}
        if person.get("club_member") and person.get("profile_slug") and not person.get("name_hidden"):
            out.append(row.get("participant_id"))
    return out


def club_teams(drivers: dict, people: dict, team_order: list[str], own: list[str] | None) -> list[str]:
    """Die eigenen Teams der Saison und jedes Team, für das ein Vereinsmitglied zuletzt gefahren ist."""
    teams = {team for team in own or [] if team}
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
    driver_rows = (latest or {}).get("rows") or []
    matcher = Matcher(own_teams(series))
    drivers = driver_teams(driver_rows, participants, matcher)
    stored = await db.reference_standings.find_one(
        {"series_id": sid, "scope": "teams"}, {"_id": 0, "round_id": 1, "round_seq": 1, "rows": 1, "computed_at": 1},
        sort=[("round_seq", -1)]) if scoring["enabled"] else None
    teams = None if not stored else {
        "round_id": stored.get("round_id"), "round_seq": stored.get("round_seq"),
        "computed_at": stored.get("computed_at"),
        "rows": team_rows(stored.get("rows") or [], driver_results(driver_rows)),
    }
    order = [row["team"] for row in (teams or {}).get("rows") or []]
    return {
        "seasons": await lineage_seasons(db, user, lineage, sid),
        "team_scoring": scoring,
        "teams": teams,
        "drivers": drivers,
        "club_teams": club_teams(drivers, people, order, matcher.names),
        "club_drivers": public_club_drivers(driver_rows, people),
    }
