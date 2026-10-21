"""Seite Team-Liga (#1747): was die Serienseite für eine Spur vom Typ ``team_league`` zusätzlich zeigt.

Gerechnet wird hier nichts Neues - die Tabelle ist der gespeicherte Stand (``reference_standings``, Wertung ``table``)
nach dem letzten gewerteten Spieltag, Ausgang und Punkte eines Spiels kommen aus dem Rechenkern (``match_points``).
Die Seite liest nur die veröffentlichten Ergebnisblätter und ordnet sie aus Sicht der eigenen Teams (``own_teams`` der
Serie, #1926 - früher nur ``team_name``; erkannt auch an anderer Schreibweise oder einem Alias):

- ``table``: Tabelle mit markierten eigenen Teams, Bewegung seit dem Spieltag davor und Form (nur für eigene Teams,
  je Team aus seinen Spielen - die übrigen Spiele der Liga kennt die Seite nicht, Entscheidung 3).
- ``rank_history``: bester Platz eines eigenen Teams nach jedem gewerteten Spieltag.
- ``matchdays``: je Termin das eigene Spiel - Gegner, Heim/Auswärts, Ergebnis, Maps, Ausgang und Punkte; dazu (#1931)
  Tag und Uhrzeit des Spiels, je gespielter Map wer sie gewählt hat (``picked``: ``own``, ``opponent``, ``decider``),
  die gesperrten Maps (``bans`` mit ``by``: ``own``/``opponent``), ``map_id`` für die spätere Map-Bibliothek (#1616)
  und die übrigen Spiele des Spieltags (``others``), wenn sie mitgespeichert sind.
- ``record`` (#1931): Bilanz je eigenem Team - Spiele, Siege, Unentschieden, Niederlagen, Punkte, Maps (Ergebnis der
  Spiele) und Runden (Summe der Map-Ergebnisse; ``rounds_matches`` sagt, aus wie vielen Spielen mit Maps).
- ``lineup``: Kader und Einsätze je Spieler (Name nur als Text, nur Vereinsmitglieder mit Profil-Link, ausgeblendete
  Namen fehlen). Gäste stehen getrennt und zählen nicht in die Vereinsstatistik: nur Vereinsmitglieder bekommen die
  Einsätze über alle sichtbaren Saisons der Spur. Seit #1931 steht der ganze Kader da (``default_team`` = eigenes Team),
  auch wer noch nicht gespielt hat - je Spieler „``appearances`` von ``of``“ und die Spieltage als Ersatz
  (``services/series_appearances.py``).
- ``path``: Liga-Weg - alle sichtbaren Saisons der Spur mit Stufe, bestem Platz eines eigenen Teams von N und Punkten.
"""
from __future__ import annotations

from services.own_teams import Matcher, own_team_names, own_teams
from services.scoring_rules import match_points, normalize_rules
from services.series_appearances import team_league_appearances
from services.team_league_sheet import is_played, own_match, own_matches  # noqa: F401 - own_match für Leser (#1747)
from services.visibility import user_can_see

TABLE_FIELDS = ("rank", "played", "won", "drawn", "lost", "score_for", "score_against", "score_diff", "points")
PATH_FIELDS = ("season", "tier", "title", "season_slug", "status", "season_result")  # Vermerk der Saison (#1898)
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


def _picked(item: dict):
    """Wer eine gespielte Map gewählt hat (#1931): ``own``, ``opponent``, ``decider`` - ohne Angabe ``None``."""
    if item.get("role") == "decider":
        return "decider"
    if item.get("role") == "picked" and item.get("by") in ("own", "opponent"):
        return item["by"]
    return None


def _others(sheet: dict, own: list[dict]) -> list[dict]:
    """Die übrigen Spiele des Spieltags (#1931) - ohne die eigenen, nur Teams und Ergebnis."""
    skip = {match.get("_index") for match in own}
    return [{"home": item.get("home"), "away": item.get("away"), "home_score": _number(item.get("home_score")),
             "away_score": _number(item.get("away_score"))}
            for index, item in enumerate(sheet.get("matches") or []) if index not in skip]


def _match_view(match: dict, rules: dict) -> dict:
    away = bool(match.get("_away"))
    side, other = ("away_score", "home_score") if away else ("home_score", "away_score")
    score_for, score_against = _number(match.get(side)), _number(match.get(other))
    outcome, points = match_points(score_for, score_against, rules)
    maps, bans = [], []
    for item in match.get("maps") or []:
        if not is_played(item):
            bans.append({"name": item.get("name"), "by": item.get("by"), "map_id": item.get("map_id")})
            continue
        own, theirs = _number(item.get(side)), _number(item.get(other))
        entry = {"name": item.get("name"), "score_for": own, "score_against": theirs,
                 "outcome": match_points(own, theirs, rules)[0]}
        # #1931: wer gewählt hat und die Kennung aus der späteren Map-Bibliothek (#1616) - nur, wenn angegeben.
        if _picked(item):
            entry["picked"] = _picked(item)
        if item.get("map_id"):
            entry["map_id"] = item["map_id"]
        maps.append(entry)
    return {
        "opponent": match.get("home") if away else match.get("away"), "home": not away,
        "score_for": score_for, "score_against": score_against, "outcome": outcome, "points": _number(points),
        "maps": maps, "lineup_size": len(match.get("lineup") or []),
        "team": match.get("_own"),  # welches eigene Team gespielt hat (#1926)
        # #1931: Tag und Uhrzeit des Spiels (sonst gilt der Termin), gesperrte Maps mit wer (own/opponent).
        "club_day": match.get("club_day"), "time": match.get("time"), "bans": bans,
    }


def _record(views: list[dict], teams: list[str]) -> list[dict]:
    """Bilanz je eigenem Team (#1931) aus den eigenen Spielen: S/U/N, Punkte, Maps und Runden."""
    out = []
    for team in teams:
        mine = [view for view in views if view["team"] == team]
        if not mine:
            continue
        with_maps = [view for view in mine if view["maps"]]
        out.append({
            "team": team, "played": len(mine),
            **{key: sum(1 for view in mine if view["outcome"] == outcome)
               for key, outcome in (("won", "win"), ("drawn", "draw"), ("lost", "loss"))},
            "points": _number(sum(view["points"] for view in mine)),
            "maps_for": _number(sum(view["score_for"] for view in mine)),
            "maps_against": _number(sum(view["score_against"] for view in mine)),
            "rounds_for": _number(sum(item["score_for"] for view in with_maps for item in view["maps"])),
            "rounds_against": _number(sum(item["score_against"] for view in with_maps for item in view["maps"])),
            "rounds_matches": len(with_maps),
        })
    return out


async def visible_seasons(db, user, lineage_id: str) -> list[dict]:
    """Sichtbare, nicht archivierte Saisons einer Spur - eine Abfrage, eine Prüfung je Sichtbarkeitsstufe.
    Auch für den Umschalter der Rennliga (#1746)."""
    found = await db.reference_series.find(
        {"lineage_id": lineage_id, "status": {"$ne": "archived"}},
        {"_id": 0, "id": 1, "visibility": 1, "team_name": 1, "own_teams": 1,
         **{key: 1 for key in PATH_FIELDS}}).to_list(None)
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


def _own_row(rows: list[dict], teams) -> dict | None:
    """Die Zeile des bestplatzierten eigenen Teams."""
    own = Matcher(teams)
    others = [row.get("team") for row in rows]
    mine = [row for row in rows if own.is_own(row.get("team"), others)]
    return min(mine, key=lambda row: (row.get("rank") is None, row.get("rank") or 0), default=None)


def _table(latest: dict | None, teams, form: dict[str, list[str]]) -> dict | None:
    if not latest:
        return None
    own = Matcher(teams)
    others = [row.get("team") for row in latest.get("rows") or []]
    rows = []
    for row in latest.get("rows") or []:
        change, rank = row.get("rank_change"), row.get("rank")
        mine = own.is_own(row.get("team"), others)
        rows.append({
            "key": row.get("team"), "team": row.get("team"), **{field: row.get(field) for field in TABLE_FIELDS},
            "previous_rank": None if change is None or rank is None else rank + change,
            "own": mine,
            "form": (form.get(own.canonical(row.get("team"), others)) or [])[-FORM_LENGTH:] if mine else [],
        })
    return {"round_id": latest.get("round_id"), "round_seq": latest.get("round_seq"), "rows": rows}


async def _lineup(db, series: dict, seasons: list[dict], sheets: dict, own_days: list[tuple[str, dict]]) -> dict:
    sid = series["id"]
    participants = {item["id"]: item for item in await db.reference_participants.find(
        {"series_id": sid},
        {"_id": 0, "id": 1, "name": 1, "name_hidden": 1, "is_club_member": 1, "link": 1, "profile_id": 1, "kind": 1,
         "default_team": 1},
    ).to_list(None)}

    def member(item: dict) -> bool:
        return bool(item.get("is_club_member")) and item.get("link") == "member"

    # Kader und Einsätze (#1931): wer gespielt hat oder im Kader eines eigenen Teams steht.
    counted = team_league_appearances(own_days, list(participants.values()), own_teams(series))
    played = {pid: item for pid, item in counted.items() if pid in participants}

    # Einsätze über alle sichtbaren Saisons - nur Vereinsmitglieder (über ihr Vereinsprofil).
    season_ids = [item["id"] for item in seasons]
    profile_of = {item["id"]: item["profile_id"] async for item in db.reference_participants.find(
        {"series_id": {"$in": season_ids}, "link": "member", "is_club_member": True, "profile_id": {"$ne": None}},
        {"_id": 0, "id": 1, "profile_id": 1})}
    career: dict[str, int] = {}
    for season in seasons:
        for sheet in sheets.get(season["id"], {}).values():
            for match in own_matches(sheet, own_teams(season)):
                for pid in dict.fromkeys(match.get("lineup") or []):
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
    for pid, count in played.items():
        item = participants[pid]
        is_member = member(item)
        hidden = bool(item.get("name_hidden"))
        players.append({
            "key": pid, "name": None if hidden else item.get("name"), "name_hidden": hidden,
            "club_member": is_member, "guest": not is_member,
            # Link nur zu öffentlich sichtbaren Profilen: aktiv (wie die Profilseite) und Name nicht ausgeblendet.
            "profile_slug": slugs.get(item.get("profile_id")) if is_member and not hidden else None,
            "round_ids": count["round_ids"], "appearances": count["played"],
            "all_seasons": career.get(item.get("profile_id")) if is_member and item.get("profile_id") else None,
            # #1931: „appearances von of“, Ersatz-Spieltage, im Kader und für welches eigene Team.
            "of": count["of"], "bench_round_ids": count["bench_round_ids"], "in_roster": count["in_roster"],
            "team": count["team"],
        })
    players.sort(key=lambda player: (not player["club_member"], -player["appearances"], player["name_hidden"],
                                     str(player["name"] or "").casefold(), player["key"]))
    return {"round_ids": list(dict.fromkeys(round_id for round_id, match in own_days if match.get("lineup"))),
            "players": players}


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
        own = _own_row(rows, own_teams(season)) or {}
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
    sid, teams = series["id"], own_teams(series)
    rules = _rules(series)
    seasons = await visible_seasons(db, user, lineage["id"])
    if not any(item["id"] == sid for item in seasons):
        seasons.append(series)
    sheets = await _published(db, [item["id"] for item in seasons])
    own_sheets = sheets.get(sid, {})

    matchdays, own_days, form, views = [], [], {}, []
    for item in rounds:
        sheet = own_sheets.get(item["id"])
        # Alle eigenen Spiele des Spieltags - bei mehreren eigenen Teams je Team eines (#1926, Prüfung #1931).
        own = own_matches(sheet, teams) if sheet else []
        day_views = [_match_view(match, rules) for match in own]
        matchdays.append({"round": item, "match": day_views[0] if day_views else None, "matches": day_views,
                          "others": _others(sheet, own) if sheet else []})
        for match, view in zip(own, day_views):
            own_days.append((item["id"], match))
            views.append(view)
            form.setdefault(match.get("_own"), []).append(OUTCOME_LETTERS[view["outcome"]])

    by_season = await _table_snapshots(db, [item["id"] for item in seasons])
    snapshots = by_season.get(sid) or []
    history = []
    for snapshot in snapshots:
        own = _own_row(snapshot.get("rows") or [], teams)
        if own:
            history.append({"round_id": snapshot.get("round_id"), "round_seq": snapshot.get("round_seq"),
                            "rank": own.get("rank"), "teams": len(snapshot.get("rows") or [])})
    return {
        "team_name": series.get("team_name"),
        "own_teams": own_team_names(series),
        "rules": {"match_points": {key: _number(value) for key, value in rules["match_points"].items()},
                  "table_tiebreakers": rules["table_tiebreakers"]},
        "table": _table(snapshots[-1] if snapshots else None, teams, form),
        "rank_history": history,
        "matchdays": matchdays,
        "record": _record(views, [*own_team_names(series), *sorted({view["team"] for view in views
                                                                    if view["team"] not in own_team_names(series)})]),
        "lineup": await _lineup(db, series, seasons, sheets, own_days),
        "path": _path(series, seasons, by_season),
    }
