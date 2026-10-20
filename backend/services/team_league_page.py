"""Seite Team-Liga (#1747): was die Serienseite für eine Spur vom Typ ``team_league`` zusätzlich zeigt.

Gerechnet wird hier nichts Neues - die Tabelle ist der gespeicherte Stand (``reference_standings``, Wertung ``table``)
nach dem letzten gewerteten Spieltag, Ausgang und Punkte eines Spiels kommen aus dem Rechenkern (``match_points``).
Die Seite liest nur die veröffentlichten Ergebnisblätter und ordnet sie aus Sicht des eigenen Teams (``team_name`` der
Serie):

- ``table``: Tabelle mit markiertem eigenen Team, Bewegung seit dem Spieltag davor und Form (nur fürs eigene Team -
  die übrigen Spiele der Liga kennt die Seite nicht, Entscheidung 3).
- ``rank_history``: Platz des eigenen Teams nach jedem gewerteten Spieltag.
- ``matchdays``: je Termin das eigene Spiel - Gegner, Heim/Auswärts, Ergebnis, Maps, Ausgang und Punkte.
- ``lineup``: Einsätze je Spieler (Name nur als Text, nur Vereinsmitglieder mit Profil-Link, ausgeblendete Namen
  fehlen). Gäste stehen getrennt und zählen nicht in die Vereinsstatistik: nur Vereinsmitglieder bekommen die Einsätze
  über alle sichtbaren Saisons der Spur.
- ``path``: Liga-Weg - alle sichtbaren Saisons der Spur mit Stufe, Platz von N und Punkten.
"""
from __future__ import annotations

from services.scoring_rules import match_points, normalize_rules
from services.visibility import user_can_see

TABLE_FIELDS = ("rank", "played", "won", "drawn", "lost", "score_for", "score_against", "score_diff", "points")
PATH_FIELDS = ("season", "tier", "title", "season_slug", "status")
OUTCOME_LETTERS = {"win": "W", "draw": "D", "loss": "L"}
FORM_LENGTH = 5


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return int(number) if number.is_integer() else number


def _rules(series: dict) -> dict:
    try:
        return normalize_rules(series.get("rules") or {})
    except ValueError:
        return normalize_rules({})


def own_match(sheet: dict, team_name: str | None) -> dict | None:
    """Das Spiel des eigenen Teams im Blatt. Ohne Teamnamen gilt das erste Spiel mit dem Heimteam als eigenes (so legt
    das Ergebnis-Blatt ein Spiel an)."""
    own = (team_name or "").strip()
    for match in sheet.get("matches") or []:
        home, away = str(match.get("home") or "").strip(), str(match.get("away") or "").strip()
        if not own or home == own:
            return match
        if away == own:
            return {**match, "_away": True}
    return None


def _match_view(match: dict, rules: dict) -> dict:
    away = bool(match.get("_away"))
    side, other = ("away_score", "home_score") if away else ("home_score", "away_score")
    score_for, score_against = _number(match.get(side)), _number(match.get(other))
    outcome, points = match_points(score_for, score_against, rules)
    maps = []
    for item in match.get("maps") or []:
        own, theirs = _number(item.get(side)), _number(item.get(other))
        maps.append({"name": item.get("name"), "score_for": own, "score_against": theirs,
                     "outcome": match_points(own, theirs, rules)[0]})
    return {
        "opponent": match.get("home") if away else match.get("away"), "home": not away,
        "score_for": score_for, "score_against": score_against, "outcome": outcome, "points": _number(points),
        "maps": maps, "lineup_size": len(match.get("lineup") or []),
    }


async def _visible_seasons(db, user, lineage_id: str) -> list[dict]:
    found = await db.reference_series.find(
        {"lineage_id": lineage_id, "status": {"$ne": "archived"}},
        {"_id": 0, "id": 1, "visibility": 1, "team_name": 1, **{key: 1 for key in PATH_FIELDS}}).to_list(None)
    allowed: dict = {}  # je Sichtbarkeitsstufe einmal prüfen, nicht je Saison
    for item in found:
        level = item.get("visibility")
        if level not in allowed:
            allowed[level] = await user_can_see(user, level)
    seen = [item for item in found if allowed[item.get("visibility")]]
    return sorted(seen, key=lambda item: (str(item.get("season") or ""), str(item.get("tier") or ""), item["id"]))


async def _published(db, series_ids: list[str]) -> dict[str, dict[str, dict]]:
    out: dict[str, dict[str, dict]] = {}
    async for sheet in db.reference_round_results.find(
            {"series_id": {"$in": series_ids}, "status": "published"},
            {"_id": 0, "series_id": 1, "round_id": 1, "matches": 1}):
        out.setdefault(sheet["series_id"], {})[sheet["round_id"]] = sheet
    return out


def _own_row(rows: list[dict], team_name: str | None) -> dict | None:
    own = (team_name or "").strip()
    return next((row for row in rows if own and row.get("team") == own), None)


def _table(latest: dict | None, team_name: str | None, form: list[str]) -> dict | None:
    if not latest:
        return None
    own = (team_name or "").strip()
    rows = []
    for row in latest.get("rows") or []:
        change, rank = row.get("rank_change"), row.get("rank")
        mine = bool(own) and row.get("team") == own
        rows.append({
            "key": row.get("team"), "team": row.get("team"), **{field: row.get(field) for field in TABLE_FIELDS},
            "previous_rank": None if change is None or rank is None else rank + change,
            "own": mine, "form": form[-FORM_LENGTH:] if mine else [],
        })
    return {"round_id": latest.get("round_id"), "round_seq": latest.get("round_seq"), "rows": rows}


async def _lineup(db, series: dict, seasons: list[dict], sheets: dict, own_days: list[tuple[str, dict]]) -> dict:
    sid = series["id"]
    participants = {item["id"]: item for item in await db.reference_participants.find(
        {"series_id": sid},
        {"_id": 0, "id": 1, "name": 1, "name_hidden": 1, "is_club_member": 1, "link": 1, "profile_id": 1},
    ).to_list(None)}

    def member(item: dict) -> bool:
        return bool(item.get("is_club_member")) and item.get("link") == "member"

    played: dict[str, list[str]] = {}
    for round_id, match in own_days:
        for pid in dict.fromkeys(match.get("lineup") or []):
            if pid in participants:
                played.setdefault(pid, []).append(round_id)

    # Einsätze über alle sichtbaren Saisons - nur Vereinsmitglieder (über ihr Vereinsprofil).
    season_ids = [item["id"] for item in seasons]
    profile_of = {item["id"]: item["profile_id"] async for item in db.reference_participants.find(
        {"series_id": {"$in": season_ids}, "link": "member", "is_club_member": True, "profile_id": {"$ne": None}},
        {"_id": 0, "id": 1, "profile_id": 1})}
    career: dict[str, int] = {}
    for season in seasons:
        for sheet in sheets.get(season["id"], {}).values():
            match = own_match(sheet, season.get("team_name"))
            for pid in dict.fromkeys((match or {}).get("lineup") or []):
                if pid in profile_of:
                    career[profile_of[pid]] = career.get(profile_of[pid], 0) + 1

    profiles = [item["profile_id"] for pid, item in participants.items()
                if pid in played and member(item) and item.get("profile_id")]
    slugs = {}
    if profiles:
        async for profile in db.club_member_profiles.find(
                {"id": {"$in": profiles}, "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "slug": 1}):
            slugs[profile["id"]] = profile.get("slug")

    players = []
    for pid, round_ids in played.items():
        item = participants[pid]
        is_member = member(item)
        hidden = bool(item.get("name_hidden"))
        players.append({
            "key": pid, "name": None if hidden else item.get("name"), "name_hidden": hidden,
            "club_member": is_member, "guest": not is_member,
            # Link nur zu öffentlich sichtbaren Profilen: aktiv (wie die Profilseite) und Name nicht ausgeblendet.
            "profile_slug": slugs.get(item.get("profile_id")) if is_member and not hidden else None,
            "round_ids": round_ids, "appearances": len(round_ids),
            "all_seasons": career.get(item.get("profile_id")) if is_member and item.get("profile_id") else None,
        })
    players.sort(key=lambda player: (not player["club_member"], -player["appearances"], player["name_hidden"],
                                     str(player["name"] or "").casefold(), player["key"]))
    return {"round_ids": [round_id for round_id, match in own_days if match.get("lineup")], "players": players}


async def _table_snapshots(db, series_ids: list[str]) -> dict[str, list[dict]]:
    """Alle gespeicherten Tabellenstände der Saisons in einer Abfrage, je Saison nach Spieltag geordnet."""
    out: dict[str, list[dict]] = {sid: [] for sid in series_ids}
    async for snapshot in db.reference_standings.find(
            {"series_id": {"$in": series_ids}, "scope": "table"},
            {"_id": 0, "series_id": 1, "round_id": 1, "round_seq": 1, "rows": 1}):
        out.setdefault(snapshot["series_id"], []).append(snapshot)
    for items in out.values():
        items.sort(key=lambda item: item.get("round_seq") or 0)
    return out


def _path(series: dict, seasons: list[dict], snapshots: dict[str, list[dict]]) -> list[dict]:
    path = []
    for season in seasons:
        latest = (snapshots.get(season["id"]) or [None])[-1]
        rows = (latest or {}).get("rows") or []
        own = _own_row(rows, season.get("team_name")) or {}
        path.append({
            **{key: season.get(key) for key in PATH_FIELDS}, "current": season["id"] == series["id"],
            "rank": own.get("rank"), "teams": len(rows) or None, "points": own.get("points"),
            **{field: own.get(field) for field in ("played", "won", "drawn", "lost")},
        })
    return path


async def team_league_view(db, user, lineage: dict, series: dict, rounds: list[dict]) -> dict | None:
    """Der Teil der Serienseite für eine Team-Liga; ``None`` bei jeder anderen Art. ``rounds``: der öffentliche
    Kalender der Saison (ohne archivierte Termine) in Reihenfolge."""
    if lineage.get("kind") != "team_league":
        return None
    sid, team_name = series["id"], series.get("team_name")
    rules = _rules(series)
    seasons = await _visible_seasons(db, user, lineage["id"])
    if not any(item["id"] == sid for item in seasons):
        seasons.append(series)
    sheets = await _published(db, [item["id"] for item in seasons])
    own_sheets = sheets.get(sid, {})

    matchdays, own_days, form = [], [], []
    for item in rounds:
        sheet = own_sheets.get(item["id"])
        match = own_match(sheet, team_name) if sheet else None
        view = _match_view(match, rules) if match else None
        matchdays.append({"round": item, "match": view})
        if match:
            own_days.append((item["id"], match))
            form.append(OUTCOME_LETTERS[view["outcome"]])

    by_season = await _table_snapshots(db, [item["id"] for item in seasons])
    snapshots = by_season.get(sid) or []
    history = []
    for snapshot in snapshots:
        own = _own_row(snapshot.get("rows") or [], team_name)
        if own:
            history.append({"round_id": snapshot.get("round_id"), "round_seq": snapshot.get("round_seq"),
                            "rank": own.get("rank"), "teams": len(snapshot.get("rows") or [])})
    return {
        "team_name": team_name,
        "rules": {"match_points": {key: _number(value) for key, value in rules["match_points"].items()},
                  "table_tiebreakers": rules["table_tiebreakers"]},
        "table": _table(snapshots[-1] if snapshots else None, team_name, form),
        "rank_history": history,
        "matchdays": matchdays,
        "lineup": await _lineup(db, series, seasons, sheets, own_days),
        "path": _path(series, seasons, by_season),
    }
