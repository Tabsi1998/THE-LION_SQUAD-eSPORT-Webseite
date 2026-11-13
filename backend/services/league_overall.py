"""Gesamtwertung über Seasons (F.5, #2215, docs/LIGA.md „F.5 Gesamtwertung über Seasons“; Entscheidungen Nr. 170 bis 173).

- **Quelle** sind allein die geltenden Endstände (``league_final_tables``, ``active``) der Staffeln aller Seasons eines Zeitraums - eine
  wieder geöffnete Staffel zählt erst nach dem neuen Abschluss wieder. Je Liga N eine eigene Wertung (Nr. 170).
- **Punkte** je Season-Platz nach der Einstellung der Liga (Nr. 171, ``league_overall_rules.staffel_points``), **Spielerwertung** mit der
  Einsatzregel aus F.4 (Nr. 172, ``league_rewards.players_for``), **beste X** und Streichergebnis (Nr. 173).
- **Abschluss** wie F.1: feste Fassung in ``league_overall_finals``, Wiederöffnen mit Grund und zweiter Person, Befangenheit. Danach
  **Belohnungen** wie F.4 (``league_rewards.store`` und ``notify``) im Bereich ``overall:<zeitraum>:<n>``.
"""
from __future__ import annotations

import copy
import logging
import time
from datetime import datetime

from pymongo.errors import DuplicateKeyError

from models import REGISTRATION_LIMIT, new_id, now_utc
from services import league_overall_rules as rules
from services.league_final_read import is_closed
from services.league_scope import ONLY_LEAGUE
from services.log_safe import log_safe

logger = logging.getLogger("tls.league_overall")

CLOSE_CAPABILITY = "season"
REASON_MIN, REASON_MAX = 5, 500
HISTORY_LIMIT = 50
IGNORED_STAFFEL_STATUSES = frozenset({"cancelled", "archived", "draft"})
PLAYED_STATUSES = ("completed",)
PRIVATE_NAME = "Spieler mit privatem Profil"

ALREADY_CLOSED = "Diese Gesamtwertung ist schon abgeschlossen."
NOT_CLOSED = "Diese Gesamtwertung ist nicht abgeschlossen."
SECOND_PERSON = "Wieder öffnen muss eine zweite Person: nicht die, die abgeschlossen hat."
SECOND_PERSON_SUPERADMIN = ("Du hast diese Gesamtwertung selbst abgeschlossen. Als Superadmin geht das Wiederöffnen nur als "
                            "Notausnahme, mit einem Grund von mindestens fünf Zeichen.")
BUSY = "Die Gesamtwertung wird gerade bearbeitet. Bitte gleich noch einmal."
CLOSED_DECISION = "Die Gesamtwertung ist abgeschlossen. Erst im Reiter „Abschluss“ wieder öffnen, dann entscheiden."

OverallProblem = rules.OverallProblem


def scope_id(period_id: str, level: int) -> str:
    """Der Bereich der Gesamtwertung für Belohnungen und Gewinne - keine Staffel (``tournament_awards.tournament_id``)."""
    return f"overall:{period_id}:{level}"


def coteam_key(side: dict) -> str | None:
    """Das Co-Team über Seasons hinweg (wie F.2): Co-Team, sonst Hauptteam, in einer Einzel-Liga die Person."""
    if side.get("squad_id"):
        return f"squad:{side['squad_id']}"
    if side.get("team_id"):
        return f"team:{side['team_id']}"
    if side.get("user_id"):
        return f"user:{side['user_id']}"
    return None


def reason_text(value, what: str = "einen Grund") -> str:
    text = " ".join(str(value or "").split())
    if len(text) < REASON_MIN:
        raise OverallProblem(f"Bitte {what} mit mindestens {REASON_MIN} Zeichen angeben.")
    return text[:REASON_MAX]


# ---------------------------------------------------------------- Endstände lesen (Zwischenspeicher je Fassung)

# Je Fassung eines Endstands: wer in welcher Zeile steht und welche Spieler dafür zählen. Eine Fassung ändert sich nie (eine Korrektur ist
# eine neue Fassung), die Spiele einer abgeschlossenen Staffel sind gesperrt - nur der Kader-Rückfall (Nr. 167) liest den Kader von heute.
_EXTRACT_TTL = 60.0
_EXTRACT_LIMIT = 500
_extracts: dict[str, tuple[float, dict]] = {}


def forget_extracts() -> None:
    _extracts.clear()


async def _extract(db, final: dict) -> dict:
    hit = _extracts.get(final["id"])
    if hit and hit[0] > time.monotonic():
        return hit[1]
    from services.league_rewards import players_for
    from services.match_audience import teams_by_id

    tid = final["tournament_id"]
    rows = [row for row in final.get("rows") or [] if row.get("registration_id")]
    ids = [row["registration_id"] for row in rows]
    registrations = {row["id"]: row for row in await db.tournament_registrations.find(
        {"tournament_id": tid, "id": {"$in": ids}}, {"_id": 0}).to_list(REGISTRATION_LIMIT)}
    teams = await teams_by_id(db, list(registrations.values()))
    matches = await db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}},
                                       {"_id": 0, "status": 1, "slots": 1, "games": 1, "lineups": 1}).to_list(2000)
    sides = final.get("sides") or {}
    entries = []
    for row in rows:
        registration = registrations.get(row["registration_id"])
        side = sides.get(row["registration_id"]) or {}
        identity = {"squad_id": side.get("squad_id") or (registration or {}).get("squad_id"),
                    "team_id": side.get("team_id") or (registration or {}).get("team_id"),
                    "user_id": (registration or {}).get("user_id") if not (side.get("team_id") or (registration or {}).get("team_id")) else None}
        key = coteam_key(identity)
        if not key:
            continue
        players, fallback = (players_for(registration, teams.get(registration.get("team_id") or "") or None, matches, "fielded")
                             if registration else ([], False))
        entries.append({"registration_id": row["registration_id"], "key": key, "name": row.get("display_name") or "Team",
                        **identity, "players": players, "fallback": bool(fallback)})
    extract = {"entries": entries}
    if len(_extracts) >= _EXTRACT_LIMIT:
        _extracts.clear()
    _extracts[final["id"]] = (time.monotonic() + _EXTRACT_TTL, extract)
    return extract


async def _sources(db, period: dict, *, viewer: dict | None, hidden, internal: bool) -> dict:
    """Seasons, Staffeln und Endstände eines Zeitraums - für die Leitung alles, sonst nur, was die Person sieht."""
    from services.league_service import can_see_season, division_label

    season_ids = list(period.get("season_ids") or [])
    seasons = await db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}).to_list(len(season_ids) + 1)
    position = {season_id: index for index, season_id in enumerate(season_ids)}
    seasons.sort(key=lambda row: (row.get("number") if isinstance(row.get("number"), int) else 999, position.get(row["id"], 999)))
    if not internal:
        seasons = [row for row in seasons if row.get("status") != "archived" and await can_see_season(viewer, row)]
    ids = [row["id"] for row in seasons]
    finals = await db.league_final_tables.find({"season_id": {"$in": ids}, "active": True}, {"_id": 0}).to_list(500) if ids else []
    tournament_ids = sorted({row["tournament_id"] for row in finals})
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": tournament_ids}}, {"_id": 0, "creation_key": 0, "billing": 0}).to_list(len(tournament_ids) + 1)} if tournament_ids else {}
    if not internal and hidden:
        visible = {}
        for tid, tournament in tournaments.items():
            if not await hidden(db, tournament, viewer):
                visible[tid] = tournament
        tournaments = visible
    finals = [row for row in finals if row["tournament_id"] in tournaments and is_closed(tournaments[row["tournament_id"]])]
    division_ids = sorted({row.get("division_id") for row in finals if row.get("division_id")})
    divisions = {row["id"]: row for row in await db.league_divisions.find(
        {"id": {"$in": division_ids}}, {"_id": 0}).to_list(len(division_ids) + 1)} if division_ids else {}
    labels: dict[int, tuple[int, str]] = {}
    for final in finals:
        division = divisions.get(final.get("division_id") or "") or {}
        if isinstance(division.get("level"), int):
            at = ids.index(final["season_id"]) if final["season_id"] in ids else -1
            if at >= labels.get(division["level"], (-2, ""))[0]:
                labels[division["level"]] = (at, division_label(division))
    return {"seasons": seasons, "finals": finals, "tournaments": tournaments, "divisions": divisions,
            "labels": {level: label for level, (_at, label) in labels.items()}}


def season_head(season: dict, league: dict | None = None) -> dict:
    out = {"id": season["id"], "name": season.get("name"), "number": season.get("number"), "slug": season.get("slug")}
    if league and league.get("slug") and season.get("slug"):
        out["url"] = f"/liga/{league['slug']}/{season['slug']}"
    return out


# ---------------------------------------------------------------- Rechnung

async def compute(db, league: dict, period: dict, *, viewer: dict | None = None, hidden=None, internal: bool = False,
                  settings: dict | None = None) -> dict:
    """Die laufende Gesamtwertung eines Zeitraums, je Liga N Co-Teams und Spieler. ``internal``: für die Leitung mit allen Seasons und
    Staffeln, sonst nur, was die Person sieht."""
    settings = settings or rules.settings_of(league)
    source = await _sources(db, period, viewer=viewer, hidden=hidden, internal=internal)
    order = [row["id"] for row in source["seasons"]]
    position = {season_id: index for index, season_id in enumerate(order)}
    teams: dict[int, dict[str, dict]] = {}
    players: dict[int, dict[str, dict]] = {}
    sources: dict[int, list[dict]] = {}
    names_at: dict[tuple[int, str], int] = {}
    for final in sorted(source["finals"], key=lambda row: (position.get(row["season_id"], 999), str(row.get("staffel") or ""))):
        division = source["divisions"].get(final.get("division_id") or "") or {}
        level = division.get("level")
        if not isinstance(level, int):
            continue
        points = rules.staffel_points(final.get("rows") or [], settings)
        extract = await _extract(db, final)
        sources.setdefault(level, []).append({"tournament_id": final["tournament_id"], "final_table_id": final["id"],
                                              "version": final.get("version"), "season_id": final["season_id"]})
        season_id = final["season_id"]
        for entry in extract["entries"]:
            score = points.get(entry["registration_id"])
            if not score:
                continue
            item = {**score, "staffel": final.get("staffel"), "tournament_id": final["tournament_id"], "co_team": entry["key"],
                    "fallback": entry["fallback"]}
            row = teams.setdefault(level, {}).setdefault(entry["key"], {
                "key": entry["key"], "name": entry["name"], "team_id": entry.get("team_id"), "squad_id": entry.get("squad_id"),
                "user_id": entry.get("user_id"), "seasons": {}})
            current = row["seasons"].get(season_id)
            if current is None or int(item["points"]) > int(current["points"]):
                row["seasons"][season_id] = item
            at = position.get(season_id, -1)
            if at >= names_at.get((level, entry["key"]), -2):
                names_at[(level, entry["key"])] = at
                row["name"] = entry["name"]
                row["team_id"] = entry.get("team_id") or row.get("team_id")
            for person in entry["players"]:
                own = players.setdefault(level, {}).setdefault(person, {"key": person, "user_id": person, "seasons": {}})
                mine = own["seasons"].get(season_id)
                if mine is None or int(item["points"]) > int(mine["points"]):
                    own["seasons"][season_id] = {**item, "co_team_name": entry["name"]}
    decisions = [row for row in league.get("overall_decisions") or [] if row.get("period_id") == period["id"]]
    levels = {}
    for level in sorted(set(teams) | set(players)):
        mine = [row for row in decisions if row.get("level") == level]
        levels[level] = {"level": level, "label": source["labels"].get(level) or f"Liga {level}",
                         "teams": rules.rank(teams.get(level, {}), settings, order, mine),
                         "players": rules.rank(players.get(level, {}), settings, order),
                         "sources": sources.get(level, [])}
    return {"settings": settings, "seasons": source["seasons"], "order": order, "levels": levels, "source": source}


def _filtered(rows: list[dict], allowed: set[str], allowed_tournaments: set[str] | None) -> dict[str, dict]:
    """Aus einer Fassung nur die Season-Einträge, die die Person sieht - die Reihenfolge rechnet danach neu."""
    out: dict[str, dict] = {}
    for row in rows:
        seasons = {season_id: {key: value for key, value in entry.items() if key != "counted"}
                   for season_id, entry in (row.get("seasons") or {}).items()
                   if season_id in allowed and (allowed_tournaments is None or entry.get("tournament_id") in allowed_tournaments)}
        if seasons:
            out[row["key"]] = {**{key: value for key, value in row.items() if key not in ("place", "tie", "total", "lead_decision", "wins",
                                                                                         "best_place", "seasons")}, "seasons": seasons}
    return out


async def from_final(db, final: dict, *, viewer: dict | None, hidden, internal: bool) -> dict:
    """Eine abgeschlossene Wertung für die Person: die Fassung, ohne Seasons und Staffeln, die sie nicht sieht (Reihenfolge neu)."""
    settings = final.get("settings") or rules.settings_of({})
    seasons = list(final.get("seasons") or [])
    if internal:
        return {"teams": final.get("teams") or [], "players": final.get("players") or [], "seasons": seasons}
    from services.league_service import can_see_season

    live = {row["id"]: row for row in await db.league_seasons.find(
        {"id": {"$in": [row["id"] for row in seasons]}}, {"_id": 0}).to_list(len(seasons) + 1)}
    visible = [row for row in seasons if live.get(row["id"]) and live[row["id"]].get("status") != "archived"
               and await can_see_season(viewer, live[row["id"]])]
    allowed = {row["id"] for row in visible}
    tournament_ids = sorted({entry.get("tournament_id") for row in final.get("teams") or [] for entry in (row.get("seasons") or {}).values()
                             if entry.get("tournament_id")})
    allowed_tournaments = None
    if hidden:
        allowed_tournaments = set()
        for tournament in await db.tournaments.find({"id": {"$in": tournament_ids}}, {"_id": 0}).to_list(len(tournament_ids) + 1):
            if not await hidden(db, tournament, viewer):
                allowed_tournaments.add(tournament["id"])
    order = [row["id"] for row in visible]
    decisions = list(final.get("decisions") or [])
    return {"teams": rules.rank(_filtered(final.get("teams") or [], allowed, allowed_tournaments), settings, order, decisions),
            "players": rules.rank(_filtered(final.get("players") or [], allowed, allowed_tournaments), settings, order),
            "seasons": visible}


async def active_final(db, period_id: str, level: int) -> dict | None:
    return await db.league_overall_finals.find_one({"period_id": period_id, "level": level, "active": True}, {"_id": 0})


# ---------------------------------------------------------------- Ansicht der Zeilen

async def _people(db, ids: set[str]) -> dict[str, dict]:
    ids = sorted(value for value in ids if value)
    if not ids:
        return {}
    rows = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "privacy_public_profile": 1,
                                                      "is_active": 1, "is_banned": 1}).to_list(len(ids) + 1)
    return {row["id"]: row for row in rows}


def _season_cells(row: dict, order: list[str]) -> list[dict]:
    cells = []
    for season_id in order:
        entry = (row.get("seasons") or {}).get(season_id)
        if not entry:
            cells.append({"season_id": season_id, "played": False})
            continue
        cells.append({"season_id": season_id, "played": True, "points": entry.get("points"), "place": entry.get("place"),
                      "of": entry.get("of"), "counted": bool(entry.get("counted")), "champion": bool(entry.get("champion")),
                      "exit": entry.get("exit"), "staffel": entry.get("staffel"), "co_team_name": entry.get("co_team_name")})
    return cells


def team_rows(rows: list[dict], order: list[str], previous: dict[str, int] | None = None) -> list[dict]:
    """Co-Teams für Web und PDF: ohne interne Kennungen außer Team (Link) - ``previous`` markiert Aufsteiger in der Wertung."""
    out = []
    for row in rows:
        before = (previous or {}).get(row["key"])
        out.append({"key": row["key"], "name": row.get("name") or "Team", "team_id": row.get("team_id"), "place": row["place"],
                    "total": row["total"], "tie": bool(row.get("tie")), "wins": row.get("wins") or 0,
                    "lead_decision": ({key: row["lead_decision"].get(key) for key in ("reason", "method", "method_label")}
                                      if row.get("lead_decision") else None),
                    "climbed": bool(before and before > row["place"]),
                    "seasons": _season_cells(row, order)})
    return out


def player_rows(rows: list[dict], order: list[str], people: dict[str, dict], *, internal: bool) -> list[dict]:
    out = []
    for row in rows:
        person = people.get(row["key"]) or {}
        public = bool(person.get("privacy_public_profile")) and person.get("is_active") is not False and not person.get("is_banned")
        name = person.get("display_name") or person.get("username") or "Spieler"
        out.append({"key": row["key"] if internal or public else None,
                    "name": name if internal or public else PRIVATE_NAME,
                    "username": person.get("username") if public else None, "private": not public,
                    "place": row["place"], "total": row["total"], "tie": bool(row.get("tie")),
                    "seasons": _season_cells(row, order)})
    return out


# ---------------------------------------------------------------- Öffentliche Sicht (Ligaseite)

async def public_view(db, league: dict, season: dict, viewer: dict | None, *, hidden=None) -> dict | None:
    """Der Zeitraum dieser Season auf der Ligaseite: je Liga N Co-Teams und Spieler, wie die Person sie sehen darf. ``None`` ohne
    Zeitraum (Altdaten, keine Einstellung)."""
    from services.league_reward_rules import basis_of, public_item

    period = rules.period_of(league, season["id"])
    if not period:
        return None
    settings = rules.settings_of(league)
    live = await compute(db, league, period, viewer=viewer, hidden=hidden, internal=False, settings=settings)
    order = live["order"]
    finals = {row["level"]: row for row in await db.league_overall_finals.find(
        {"period_id": period["id"], "active": True}, {"_id": 0}).to_list(50)}
    seasons = [season_head(row, league) for row in live["seasons"]]
    levels = sorted(set(live["levels"]) | set(finals))
    out_levels = []
    for level in levels:
        final = finals.get(level)
        if final:
            view = await from_final(db, final, viewer=viewer, hidden=hidden, internal=False)
            view_order = [row["id"] for row in view["seasons"]]
            team_list, player_list, label = view["teams"], view["players"], (final.get("title") or {}).get("division") or f"Liga {level}"
            used = final.get("settings") or settings
        else:
            data = live["levels"][level]
            view_order, team_list, player_list, label = order, data["teams"], data["players"], data["label"]
            used = settings
        if not team_list and not player_list:
            continue
        people = await _people(db, {row["key"] for row in player_list})
        rewards = await reward_holders(db, period["id"], level) if final else []
        # Wer mit der jüngsten Season in der Wertung nach vorn kam, leuchtet auf der Ligaseite kurz auf.
        decisions = [row for row in (final or {}).get("decisions") or league.get("overall_decisions") or []
                     if row.get("period_id") == period["id"] and row.get("level") == level]
        previous = previous_places(team_list, view_order, used, decisions)
        out_levels.append({
            "level": level, "label": label, "closed": bool(final),
            "final": {"version": final.get("version"), "closed_at": final.get("closed_at")} if final else None,
            "season_ids": view_order,
            "teams": team_rows(team_list, view_order, previous), "players": player_rows(player_list, view_order, people, internal=False),
            "rewards": rewards if final else [public_item(item, basis_of({"reward_players": settings["reward_players"]}))
                                              for item in settings.get("rewards") or []],
        })
    return {"period": {"id": period["id"], "name": period.get("name")}, "seasons": seasons, "levels": out_levels,
            "settings": rules.public_settings(settings)}


def previous_places(rows: list[dict], order: list[str], settings: dict, decisions: list[dict]) -> dict[str, int]:
    """Die Plätze ohne die jüngste Season - wer seitdem nach vorn kam, ist ein Aufsteiger in der Wertung."""
    if len(order) < 2:
        return {}
    earlier = order[:-1]
    return {row["key"]: row["place"] for row in rules.rank(_filtered(rows, set(earlier), None), settings, earlier, decisions)}


async def reward_holders(db, period_id: str, level: int) -> list[dict]:
    """Belohnungen einer abgeschlossenen Wertung mit Inhabern (wie ``league_rewards.staffel_view``)."""
    from services.league_reward_rules import _order, public_item

    docs = await db.tournament_awards.find({"tournament_id": scope_id(period_id, level), "reward_key": {"$type": "string"},
                                            "suspended": {"$ne": True}}, {"_id": 0}).to_list(2000)
    by_item: dict[str, dict] = {}
    for doc in docs:
        reward = doc.get("reward") or {}
        row = by_item.setdefault(reward.get("id"), {**public_item(reward), "holders": []})
        row["holders"].append({"key": doc.get("registration_id"), "display_name": (doc.get("league") or {}).get("display_name"),
                               "rank": doc.get("rank")})
    out = list(by_item.values())
    for row in out:
        row["holders"].sort(key=lambda holder: (holder.get("rank") or 999, str(holder.get("display_name") or "")))
    out.sort(key=lambda row: _order(row.get("places")))
    return out


async def season_block(league: dict | None, season: dict) -> dict | None:
    """Für die Season-Seite: ob es eine Gesamtwertung gibt - dann zeigt die Navigation den Punkt."""
    period = rules.period_of(league, season.get("id"))
    return {"period_id": period["id"], "name": period.get("name")} if period else None


# ---------------------------------------------------------------- Profil und Teamseite

async def _standing_rows(db, league: dict, period: dict, viewer: dict | None, hidden) -> dict[int, dict]:
    """Je Liga N die Zeilen, wie die Person sie sieht - abgeschlossen aus der Fassung, sonst gerechnet."""
    out: dict[int, dict] = {}
    live = await compute(db, league, period, viewer=viewer, hidden=hidden, internal=False)
    finals = {row["level"]: row for row in await db.league_overall_finals.find(
        {"period_id": period["id"], "active": True}, {"_id": 0}).to_list(50)}
    for level in sorted(set(live["levels"]) | set(finals)):
        if level in finals:
            view = await from_final(db, finals[level], viewer=viewer, hidden=hidden, internal=False)
            out[level] = {"teams": view["teams"], "players": view["players"], "closed": True,
                          "label": (finals[level].get("title") or {}).get("division") or f"Liga {level}"}
        else:
            data = live["levels"][level]
            out[level] = {"teams": data["teams"], "players": data["players"], "closed": False, "label": data["label"]}
    return out


async def _periods_with(db, query: dict) -> list[tuple[dict, dict]]:
    """Zeiträume, in deren Seasons ein Endstand das Team bzw. die Person trägt (Vorauswahl über die Teilindizes aus F.2)."""
    finals = await db.league_final_tables.find({"active": True, **query}, {"_id": 0, "season_id": 1, "league_id": 1}).to_list(500)
    league_ids = sorted({row.get("league_id") for row in finals if row.get("league_id")})
    if not league_ids:
        return []
    season_ids = {row.get("season_id") for row in finals}
    out = []
    for league in await db.leagues.find({"id": {"$in": league_ids}, "status": {"$ne": "archived"}}, {"_id": 0}).to_list(len(league_ids) + 1):
        for period in rules.settings_of(league)["periods"]:
            if season_ids & set(period.get("season_ids") or []):
                out.append((league, period))
    return out


def _entry(league: dict, period: dict, level: int, data: dict, row: dict, rows: list[dict], url: str | None) -> dict:
    return {"league_name": league.get("name"), "period_name": period.get("name"), "division_label": data["label"], "level": level,
            "place": row["place"], "of": len(rows), "points": row["total"], "closed": data["closed"], "url": url}


async def _url(db, league: dict, period: dict) -> str | None:
    ids = list(period.get("season_ids") or [])
    if not league.get("slug") or not ids:
        return None
    seasons = await db.league_seasons.find({"id": {"$in": ids}, "status": {"$ne": "archived"}}, {"_id": 0, "slug": 1, "number": 1}).to_list(len(ids) + 1)
    seasons.sort(key=lambda row: row.get("number") or 0)
    return f"/liga/{league['slug']}/{seasons[-1]['slug']}/gesamtwertung" if seasons and seasons[-1].get("slug") else None


async def for_team(db, team_id: str, viewer: dict | None, *, hidden=None) -> list[dict]:
    """Platz in der Gesamtwertung je Co-Team des Teams (Teamseite)."""
    out = []
    for league, period in await _periods_with(db, {"team_ids": team_id}):
        url = await _url(db, league, period)
        for level, data in (await _standing_rows(db, league, period, viewer, hidden)).items():
            for row in data["teams"]:
                if row.get("team_id") == team_id:
                    out.append({**_entry(league, period, level, data, row, data["teams"], url), "name": row.get("name")})
    return out


async def for_player(db, user_id: str, viewer: dict | None, *, hidden=None) -> list[dict]:
    """Platz in der Spielerwertung (Profil)."""
    out = []
    for league, period in await _periods_with(db, {"player_ids": user_id}):
        url = await _url(db, league, period)
        for level, data in (await _standing_rows(db, league, period, viewer, hidden)).items():
            for row in data["players"]:
                if row["key"] == user_id:
                    out.append(_entry(league, period, level, data, row, data["players"], url))
    return out


# ---------------------------------------------------------------- Befangenheit und Sperrgründe

async def _own_keys(db, user: dict | None, rows: list[dict]) -> set[str]:
    """Zu welchen Co-Teams der Wertung gehört die Person (Captain, Vertreter, Kader, Teamleitung - ``belongs_to_side``)?"""
    from services import league_permissions

    sides = [{"team_id": row.get("team_id"), "squad_id": row.get("squad_id"), "user_id": row.get("user_id"), "key": row["key"]} for row in rows]
    teams = await league_permissions.teams_by_id(db, sides)
    return {side["key"] for side in sides if league_permissions.belongs_to_side(user, side, teams.get(side.get("team_id") or ""))}


async def _conflict_override(db, user: dict, rows: list[dict], conflict_reason) -> str | None:
    from services import league_permissions

    conflict = ({"kind": league_permissions.CONFLICT_INVOLVED, "override": league_permissions.is_superadmin(user)}
                if await _own_keys(db, user, rows) else None)
    return league_permissions.override_reason(conflict, conflict_reason, detail=league_permissions.SIDE_CONFLICT_DETAIL,
                                              superadmin_detail=league_permissions.SIDE_CONFLICT_SUPERADMIN_DETAIL)


def _blocker(code: str, label: str, text: str, items: list[dict]) -> dict:
    return {"code": code, "label": label, "text": text, "count": len(items), "items": items[:50]}


async def open_staffeln(db, period: dict, level: int) -> list[dict]:
    """Staffeln dieser Liga N in den Seasons des Zeitraums, die noch nicht abgeschlossen sind (Entwurf, abgesagt, archiviert zählen nicht)."""
    ids = list(period.get("season_ids") or [])
    if not ids:
        return []
    divisions = {row["id"]: row for row in await db.league_divisions.find({"season_id": {"$in": ids}, "level": level},
                                                                         {"_id": 0}).to_list(200)}
    if not divisions:
        return []
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(ids) + 1)}
    tournaments = await db.tournaments.find({"league_context.division_id": {"$in": sorted(divisions)}, **ONLY_LEAGUE},
                                            {"_id": 0, "id": 1, "title": 1, "status": 1, "final_table": 1, "league_context": 1}).to_list(500)
    out = []
    for row in tournaments:
        if is_closed(row) or row.get("status") in IGNORED_STAFFEL_STATUSES:
            continue
        season_id = (row.get("league_context") or {}).get("season_id")
        out.append({"text": f"{(seasons.get(season_id) or {}).get('name') or 'Season'} · Staffel {(row.get('league_context') or {}).get('staffel')}",
                    "url": f"/admin/leagues/seasons/{season_id}#abschluss"})
    return out


async def blockers(db, period: dict, level: int, rows: list[dict]) -> list[dict]:
    out = []
    staffeln = await open_staffeln(db, period, level)
    if staffeln:
        out.append(_blocker("open_seasons", "Season nicht abgeschlossen",
                            "Erst wenn jede Staffel dieser Liga N in allen Seasons des Zeitraums abgeschlossen ist, steht die Gesamtwertung fest.",
                            staffeln))
    if not rows:
        out.append(_blocker("no_rows", "Niemand in der Wertung", "Noch kein Endstand einer Season dieser Liga N - es gibt nichts abzuschließen.", []))
    leader = [tie for tie in rules.ties(rows) if tie["place"] == 1]
    if leader:
        out.append(_blocker("leader_tie", "Gleichstand auf Platz 1",
                            "Wer die Gesamtwertung gewinnt, steht nicht fest: Vor dem Abschluss braucht es einen begründeten Entscheid "
                            "(Entscheidungsspiel, Los oder Leitung).", [{"text": " – ".join(tie["names"])} for tie in leader]))
    return out


# ---------------------------------------------------------------- Abschließen und wieder öffnen

def _period(league: dict, period_id: str) -> dict:
    period = next((row for row in rules.settings_of(league)["periods"] if row["id"] == period_id), None)
    if not period:
        raise OverallProblem("Diesen Zeitraum gibt es nicht.", 404)
    return period


async def _follow_up(what: str, period_id: str, step):
    try:
        return await step()
    except Exception:  # noqa: BLE001 - die Fassung steht schon
        logger.exception("[league_overall] %s für Zeitraum %s fehlgeschlagen", what, log_safe(period_id))
        return None


async def close(db, league: dict, period_id: str, level: int, actor: dict, *, conflict_reason: str | None = None,
                now: datetime | None = None) -> dict:
    """Schließt die Gesamtwertung einer Liga N ab. Der Aufrufer hält die Sperre der Liga und hat das Recht geprüft. Den Abschluss
    gewinnt, wer die aktive Fassung zuerst schreibt (Teilindex ``league_overall_active``) - jeder zweite bekommt 409."""
    period = _period(league, period_id)
    if await active_final(db, period_id, level):
        raise OverallProblem(ALREADY_CLOSED, 409)
    now = now or now_utc()
    settings = rules.settings_of(league)
    live = await compute(db, league, period, internal=True, settings=settings)
    data = live["levels"].get(level) or {"teams": [], "players": [], "sources": [], "label": f"Liga {level}"}
    override = await _conflict_override(db, actor, data["teams"], conflict_reason)
    found = await blockers(db, period, level, data["teams"])
    if found:
        raise OverallProblem("Abschließen geht noch nicht: " + ", ".join(row["label"] for row in found) + ".", 409, blockers=found)
    last = await db.league_overall_finals.find({"period_id": period_id, "level": level}, {"_id": 0, "version": 1}).sort("version", -1).to_list(1)
    decisions = [row for row in league.get("overall_decisions") or [] if row.get("period_id") == period_id and row.get("level") == level]
    applied = {(row.get("lead_decision") or {}).get("id") for row in data["teams"] if row.get("lead_decision")}
    final = {
        "id": new_id(), "league_id": league["id"], "period_id": period_id, "level": level,
        "version": int((last[0] if last else {}).get("version") or 0) + 1, "active": True,
        "closed_at": now.isoformat(), "closed_by": actor.get("id"),
        "title": {"league": league.get("name"), "period": period.get("name"), "division": data["label"]},
        "settings": {key: copy.deepcopy(settings[key]) for key in ("points_mode", "points_table", "champion_bonus", "counting", "best_count",
                                                                   "tiebreakers", "reward_players")},
        "seasons": [season_head(row) for row in live["seasons"]],
        "teams": data["teams"], "players": data["players"], "participants": len(data["teams"]),
        "decisions": [row for row in decisions if row.get("id") in applied], "sources": data["sources"],
        "reopened_at": None, "reopened_by": None, "reopen_reason": None, "created_at": now.isoformat(),
    }
    try:
        await db.league_overall_finals.insert_one(dict(final))
    except DuplicateKeyError:
        raise OverallProblem(ALREADY_CLOSED, 409) from None

    async def record_override() -> None:
        if override:
            from services import league_permissions

            await league_permissions.record_override(db, actor, action="overall_close", target_id=league["id"], reason=override,
                                                     overall_final_id=final["id"])

    async def audit() -> None:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.overall.close", "actor_id": actor.get("id"), "target_id": league["id"],
            "data": {"overall_final_id": final["id"], "period_id": period_id, "level": level, "version": final["version"],
                     "teams": final["participants"]},
            "created_at": final["closed_at"]})

    await _follow_up("Protokoll der Notausnahme", period_id, record_override)
    rewards = await _follow_up("Belohnungen", period_id, lambda: grant(db, league, period, final))
    await _follow_up("Protokoll", period_id, audit)
    return {"final": final, "rewards": rewards}


def second_person_override(final: dict, actor: dict, emergency_reason) -> str | None:
    from services.league_permissions import is_superadmin

    if final.get("closed_by") != actor.get("id"):
        return None
    if not is_superadmin(actor):
        raise OverallProblem(SECOND_PERSON, 403)
    reason = " ".join(str(emergency_reason or "").split())
    if len(reason) < REASON_MIN:
        raise OverallProblem(SECOND_PERSON_SUPERADMIN, 403)
    return reason[:REASON_MAX]


async def reopen(db, league: dict, period_id: str, level: int, actor: dict, reason, *, conflict_reason: str | None = None,
                 emergency_reason: str | None = None, now: datetime | None = None) -> dict:
    """Öffnet die abgeschlossene Gesamtwertung wieder: Die Fassung bleibt im Verlauf, die Belohnungen ruhen, gerechnet wird wieder."""
    from services import league_permissions

    _period(league, period_id)
    final = await active_final(db, period_id, level)
    if not final:
        raise OverallProblem(NOT_CLOSED, 409)
    text = reason_text(reason, "einen Grund für das Wiederöffnen")
    emergency = second_person_override(final, actor, emergency_reason)
    override = await _conflict_override(db, actor, final.get("teams") or [], conflict_reason)
    now = now or now_utc()
    claimed = await db.league_overall_finals.update_one(
        {"id": final["id"], "active": True},
        {"$set": {"active": False, "reopened_at": now.isoformat(), "reopened_by": actor.get("id"), "reopen_reason": text}})
    if not claimed.modified_count:
        raise OverallProblem(NOT_CLOSED, 409)

    async def record_overrides() -> None:
        for kind, why in (("overall_reopen_own", emergency), ("overall_reopen", override)):
            if why:
                await league_permissions.record_override(db, actor, action=kind, target_id=league["id"], reason=why, overall_final_id=final["id"])

    async def suspend() -> None:
        await db.tournament_awards.update_many({"tournament_id": scope_id(period_id, level)},
                                               {"$set": {"suspended": True, "updated_at": now.isoformat()}})

    async def audit() -> None:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.overall.reopen", "actor_id": actor.get("id"), "target_id": league["id"],
            "data": {"overall_final_id": final["id"], "period_id": period_id, "level": level, "version": final["version"], "reason": text},
            "created_at": now.isoformat()})

    await _follow_up("Protokoll der Notausnahme", period_id, record_overrides)
    await _follow_up("Ruhen der Belohnungen", period_id, suspend)
    await _follow_up("Protokoll", period_id, audit)
    return {"final": {**final, "active": False, "reopened_at": now.isoformat(), "reopen_reason": text}}


# ---------------------------------------------------------------- Entscheid der Leitung bei Gleichstand

async def decide(db, league: dict, period_id: str, level: int, actor: dict, keys: list[str], reason, method: str | None,
                 *, conflict_reason: str | None = None) -> dict:
    """Ordnet Co-Teams, die gerade gleich stehen (Nr. 173, wie E.1/F.1). Gilt nur, solange genau diese Gruppe gleich steht."""
    period = _period(league, period_id)
    if await active_final(db, period_id, level):
        raise OverallProblem(CLOSED_DECISION, 409)
    if method not in rules.METHODS:
        raise OverallProblem("Bitte angeben, wie entschieden wurde: Entscheidungsspiel, Los oder Entscheid der Leitung.")
    text = reason_text(reason, "einen Grund für den Entscheid")
    keys = [str(key) for key in keys or []]
    if len(keys) < 2 or len(set(keys)) != len(keys):
        raise OverallProblem("Ein Entscheid ordnet mindestens zwei verschiedene Co-Teams.")
    others = [row for row in league.get("overall_decisions") or []
              if not (row.get("period_id") == period_id and row.get("level") == level and set(row.get("keys") or []) == set(keys))]
    live = await compute(db, {**league, "overall_decisions": others}, period, internal=True)
    data = live["levels"].get(level) or {"teams": []}
    if not any(set(tie["keys"]) == set(keys) for tie in rules.ties(data["teams"])):
        raise OverallProblem("Diese Co-Teams stehen gerade nicht gleich - ein Entscheid gilt nur für einen echten Gleichstand.")
    rows = [row for row in data["teams"] if row["key"] in set(keys)]
    override = await _conflict_override(db, actor, rows, conflict_reason)
    decision = {"id": new_id(), "period_id": period_id, "level": level, "keys": keys, "reason": text, "method": method,
                "decided_at": now_utc().isoformat()}
    await db.leagues.update_one({"id": league["id"]}, {"$set": {"overall_decisions": [*others, decision], "updated_at": decision["decided_at"]}})
    if override:
        from services import league_permissions

        await league_permissions.record_override(db, actor, action="overall_decision", target_id=league["id"], reason=override,
                                                 period_id=period_id, level=level)
    await db.audit_logs.insert_one({"id": new_id(), "action": "league.overall.decision", "actor_id": actor.get("id"), "target_id": league["id"],
                                    "data": {"period_id": period_id, "level": level, "keys": keys, "method": method, "reason": text},
                                    "created_at": decision["decided_at"]})
    return decision


async def undecide(db, league: dict, period_id: str, level: int, decision_id: str, actor: dict) -> None:
    _period(league, period_id)
    if await active_final(db, period_id, level):
        raise OverallProblem(CLOSED_DECISION, 409)
    rows = league.get("overall_decisions") or []
    if not any(row.get("id") == decision_id for row in rows):
        raise OverallProblem("Diesen Entscheid gibt es nicht.", 404)
    await db.leagues.update_one({"id": league["id"]}, {"$set": {"overall_decisions": [row for row in rows if row.get("id") != decision_id]}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "league.overall.decision.remove", "actor_id": actor.get("id"),
                                    "target_id": league["id"], "data": {"period_id": period_id, "level": level, "decision_id": decision_id},
                                    "created_at": now_utc().isoformat()})


# ---------------------------------------------------------------- Belohnungen (wie F.4)

async def grant(db, league: dict, period: dict, final: dict) -> dict:
    """Teilt die Belohnungen der Liga nach der Fassung zu - mit ``league_rewards.store`` und ``notify`` (dieselbe Vergabe-, Ruhe- und
    Nachrichtenlogik wie je Staffel). Gleiches bleibt derselbe Eintrag, nie doppelt."""
    from services import league_rewards
    from services.league_reward_rules import basis_of, fits
    from services.match_audience import responsible_ids, roster_ids, teams_by_id

    settings = rules.settings_of(league)
    items = list(settings.get("rewards") or [])
    basis = basis_of({"reward_players": settings.get("reward_players")})
    scope = {"id": scope_id(period["id"], final["level"]), "title": f"{league.get('name') or 'Liga'} · Gesamtwertung {period.get('name') or ''}".strip(),
             "slug": None}
    before = await db.tournament_awards.find({"tournament_id": scope["id"], "reward_key": {"$type": "string"}}, {"_id": 0}).to_list(5000)
    if not items and not before:
        return {"granted": 0}
    rows = final.get("teams") or []
    sides = [{"team_id": row.get("team_id"), "squad_id": row.get("squad_id"), "user_id": row.get("user_id")} for row in rows]
    teams = await teams_by_id(db, sides)
    earned: dict[str, set[str]] = {}
    for player in final.get("players") or []:
        for entry in (player.get("seasons") or {}).values():
            earned.setdefault(entry.get("co_team"), set()).add(player["key"])
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0, "id": 1, "name": 1, "logo_url": 1, "cover_url": 1}) \
        if league.get("game_id") else None
    frame = {"league": league, "season": {"id": period["id"], "name": f"Gesamtwertung {period.get('name') or ''}".strip(),
                                          "slug": None}, "division_label": (final.get("title") or {}).get("division")}
    season_ids = [row["id"] for row in final.get("seasons") or []]
    after, wanted_prizes = [], []
    for row in rows:
        side = {"team_id": row.get("team_id"), "squad_id": row.get("squad_id"), "user_id": row.get("user_id")}
        team = teams.get(row.get("team_id") or "") or None
        solo = not row.get("team_id")
        # Wer in jeder Season ausschied, bekommt nichts - auch nicht „alle Teilnehmer“ (wie F.4).
        exited = all(entry.get("exit") for entry in (row.get("seasons") or {}).values())
        fitting = [item for item in items if fits(item.get("places"), row["place"], exited=exited)]
        if not fitting:
            continue
        players = sorted(roster_ids(side, team)) if basis == "roster" else sorted(earned.get(row["key"]) or [])
        responsible = sorted(responsible_ids(side, team)) if not solo else []
        for item in fitting:
            recipients = item.get("recipients") or []
            to_team = "team" in recipients and not solo
            player_ids = players if "players" in recipients and not solo else []
            person = row.get("user_id") if solo else None
            if not (to_team or player_ids or person):
                continue
            after.append({
                "registration_id": row["key"], "reward_key": f"{item['id']}:{row['key']}", "user_id": person,
                "team_id": row.get("team_id") if to_team else None, "roster_fallback": False,
                "rank": row["place"], "kind": "reward", "participants": len(rows), "finalist": False, "final_match_id": None,
                "matches": {"played": 0, "won": 0},
                "tournament": {"id": scope["id"], "slug": None, "start_date": final.get("closed_at"), "visibility": "public", "is_public": True,
                               "title": scope["title"], "status": "completed"},
                "game": game, "season": {"id": period["id"], "name": frame["season"]["name"]},
                "team": ({"id": team["id"], "name": team.get("name"), "tag": team.get("tag"), "logo_url": team.get("logo_url")} if team else None),
                "league": {"title": item.get("name"), "league_id": league["id"], "season_id": None, "division_label": frame["division_label"],
                           "staffel": None, "display_name": row.get("name"), "final_table_id": final["id"], "version": final["version"]},
                "overall": {"league_id": league["id"], "period_id": period["id"], "level": final["level"], "final_id": final["id"],
                            "version": final["version"], "season_ids": season_ids},
                "reward": league_rewards._snapshot(item, frame, row["place"], basis),
                "player_ids": player_ids, "audience_ids": sorted(set(player_ids) | (set(responsible) if to_team else set()) | ({person} if person else set())),
                "suspended": False,
            })
            if item.get("prize"):
                wanted_prizes.append({"reward_key": f"{item['id']}:{row['key']}", "place": row["place"], "team_id": row.get("team_id"),
                                      "user_id": person, "label": item.get("name"), "value": item.get("prize"),
                                      "place_label": league_rewards._art(frame, item, row["place"])["place"]})
    result = await league_rewards.store(db, scope, before, after, wanted_prizes)
    leads: dict[str, set[str]] = {}
    for side in sides:
        if side.get("team_id") in {*result["team_gains"], *result["team_losses"]}:
            leads.setdefault(side["team_id"], set()).update(responsible_ids(side, teams.get(side["team_id"]) or None))
    result.update({"team_leads": {key: sorted(value) for key, value in leads.items()},
                   "team_names": {key: (teams.get(key) or {}).get("name") or "Euer Team" for key in leads}})
    if any(result.get(key) for key in ("gains", "losses", "team_gains", "team_losses")):
        url = await _url(db, league, period)
        result["sent"] = await league_rewards.notify(db, scope, final, frame, result, url=url)
    return result


# ---------------------------------------------------------------- Verwaltung

async def _names(db, user_ids: set[str]) -> dict[str, str]:
    ids = sorted(value for value in user_ids if value)
    if not ids:
        return {}
    rows = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(ids) + 1)
    return {row["id"]: row.get("display_name") or row.get("username") or "Liga-Leitung" for row in rows}


def _history_row(final: dict, names: dict[str, str]) -> dict:
    return {"id": final["id"], "version": final.get("version"), "active": bool(final.get("active")), "closed_at": final.get("closed_at"),
            "closed_by_name": names.get(final.get("closed_by") or "") or "Liga-Leitung", "reopened_at": final.get("reopened_at"),
            "reopened_by_name": (names.get(final.get("reopened_by") or "") or "Liga-Leitung") if final.get("reopened_at") else None,
            "reopen_reason": final.get("reopen_reason"), "teams": final.get("participants"),
            "leader": next((row.get("name") for row in final.get("teams") or [] if row.get("place") == 1), None)}


async def settings_view(db, league: dict, *, can_edit: bool) -> dict:
    """Der Reiter „Einstellungen“ und „Zeiträume“: was gilt, die Seasons der Liga zur Auswahl und je Zeitraum, was abgeschlossen ist."""
    from services.league_reward_rules import KINDS, PLAYER_BASIS, basis_of, public_item

    settings = rules.settings_of(league)
    seasons = await db.league_seasons.find({"league_id": league["id"]}, {"_id": 0, "id": 1, "name": 1, "number": 1, "status": 1,
                                                                         "visibility": 1}).sort("number", 1).to_list(500)
    closed: dict[str, list[int]] = {}
    async for row in db.league_overall_finals.find({"league_id": league["id"], "active": True}, {"_id": 0, "period_id": 1, "level": 1}):
        closed.setdefault(row["period_id"], []).append(row["level"])
    basis = basis_of({"reward_players": settings["reward_players"]})
    return {
        "league": {"id": league["id"], "name": league.get("name"), "slug": league.get("slug"), "accent_color": league.get("accent_color"),
                   "emblem_url": league.get("emblem_url")},
        "can_edit": can_edit, "enabled": rules.enabled(league),
        "settings": {key: settings[key] for key in ("points_mode", "points_table", "champion_bonus", "counting", "best_count", "tiebreakers",
                                                    "reward_players")},
        "rewards": [public_item(item, basis) for item in settings.get("rewards") or []],
        "periods": [{**row, "closed_levels": sorted(closed.get(row["id"], []))} for row in settings["periods"]],
        "seasons": seasons,
        "options": {"points_modes": rules.POINTS_MODES, "counting": rules.COUNTING, "tiebreakers": rules.TIEBREAKERS,
                    "player_basis": PLAYER_BASIS, "kinds": KINDS, "methods": rules.METHODS},
    }


async def save(db, league: dict, body: dict, actor: dict) -> dict:
    """Speichert Einstellungen, Zeiträume und Belohnungen (Zuständigkeit „Season konfigurieren“, prüft die Route)."""
    from services import league_look, league_rewards

    current = rules.settings_of(league)
    update = rules.clean_points(body, current)
    if "periods" in body:
        seasons = await db.league_seasons.find({"league_id": league["id"]}, {"_id": 0, "id": 1, "name": 1}).to_list(500)
        locked = {row["period_id"] async for row in db.league_overall_finals.find({"league_id": league["id"], "active": True},
                                                                                  {"_id": 0, "period_id": 1})}
        update["periods"] = rules.clean_periods(body.get("periods"), current["periods"], {row["id"] for row in seasons},
                                                {row["id"]: row.get("name") for row in seasons}, locked)
    else:
        update["periods"] = current["periods"]
    if "rewards" in body:
        known = {str(row.get("id")) for row in current.get("rewards") or [] if row.get("id")}
        try:
            update["rewards"] = league_rewards.clean_items(body.get("rewards"), known)
            await league_look.check_uploaded(db, {league_look.PRIZES: [{"image_url": row["image_url"]} for row in update["rewards"]
                                                                      if row.get("image_url")]})
        except league_rewards.RewardProblem as problem:
            raise OverallProblem(problem.message, problem.status) from None
        except league_look.LookProblem as problem:
            raise OverallProblem(problem.message) from None
    else:
        update["rewards"] = current.get("rewards") or []
    now = now_utc().isoformat()
    await db.leagues.update_one({"id": league["id"]}, {"$set": {"overall": update, "updated_at": now}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.overall.save", "actor_id": actor.get("id"), "target_id": league["id"],
        "data": {"points_mode": update["points_mode"], "counting": update["counting"], "best_count": update["best_count"],
                 "periods": len(update["periods"]), "rewards": len(update["rewards"])},
        "created_at": now})
    return await db.leagues.find_one({"id": league["id"]}, {"_id": 0})


async def cockpit(db, league: dict, period_id: str, user: dict) -> dict:
    """Der Reiter „Abschluss“: je Liga N Vorschau bzw. Fassung, Sperrgründe, Gleichstände, Verlauf, Stand der Belohnungen."""
    from services import league_permissions

    period = _period(league, period_id)
    capabilities = await league_permissions.capabilities_of(db, user, league["id"])
    can_act = CLOSE_CAPABILITY in capabilities
    superadmin = league_permissions.is_superadmin(user)
    live = await compute(db, league, period, internal=True)
    finals = await db.league_overall_finals.find({"period_id": period_id}, {"_id": 0}).sort("version", -1).to_list(HISTORY_LIMIT * 10)
    by_level: dict[int, list[dict]] = {}
    for row in finals:
        by_level.setdefault(row["level"], []).append(row)
    names = await _names(db, {value for row in finals for value in (row.get("closed_by"), row.get("reopened_by"))})
    levels = sorted(set(live["levels"]) | set(by_level))
    decisions = [row for row in league.get("overall_decisions") or [] if row.get("period_id") == period_id]
    out = []
    for level in levels:
        history = by_level.get(level, [])
        active = next((row for row in history if row.get("active")), None)
        data = live["levels"].get(level) or {"teams": [], "players": [], "label": f"Liga {level}", "sources": []}
        team_list = active["teams"] if active else data["teams"]
        player_list = active["players"] if active else data["players"]
        order = [row["id"] for row in (active.get("seasons") if active else live["seasons"])]
        own = await _own_keys(db, user, team_list)
        people = await _people(db, {row["key"] for row in player_list})
        found = [] if active else await blockers(db, period, level, data["teams"])
        closed_by_me = bool(active and active.get("closed_by") == user.get("id"))
        rewards = await db.tournament_awards.count_documents({"tournament_id": scope_id(period_id, level), "reward_key": {"$type": "string"},
                                                              "suspended": {"$ne": True}})
        out.append({
            "level": level, "label": (active.get("title") or {}).get("division") if active else data["label"],
            "closed": bool(active), "final": ({"id": active["id"], "version": active.get("version"), "closed_at": active.get("closed_at"),
                                               "closed_by_name": names.get(active.get("closed_by") or "") or "Liga-Leitung"} if active else None),
            "season_ids": order, "blockers": found,
            "teams": team_rows(team_list, order), "players": player_rows(player_list, order, people, internal=True),
            "ties": [] if active else [{**tie, "own_team": bool(own & set(tie["keys"]))} for tie in rules.ties(data["teams"])],
            "decisions": [{"id": row["id"], "names": [next((team.get("name") for team in team_list if team["key"] == key), "Team")
                                                      for key in row.get("keys") or []],
                           "reason": row.get("reason"), "method": row.get("method"), "method_label": rules.METHODS.get(row.get("method") or "")}
                          for row in decisions if row.get("level") == level],
            "own_team": bool(own), "closed_by_me": closed_by_me, "rewards": rewards,
            "can_close": can_act and not active and not found and (not own or superadmin),
            "can_reopen": bool(active) and can_act and (not closed_by_me or superadmin) and (not own or superadmin),
            "can_decide": can_act and not active,
            "history": [_history_row(row, names) for row in history[:HISTORY_LIMIT]],
        })
    return {"period": {"id": period["id"], "name": period.get("name")}, "seasons": [season_head(row, league) for row in live["seasons"]],
            "can_act": can_act, "superadmin": superadmin, "methods": rules.METHODS,
            "settings": rules.public_settings(live["settings"]), "levels": out}
