"""Laufende Ligen an Profil und Teamseite (#1630) und die Daten des Liga-Abzeichens (#1638).

- **Abzeichen** (``badge``): Liga N, Beiname und ob das Co-Team die Season gewonnen hat - Web und App zeichnen daraus dasselbe Wappen
  (Liga 1 mit Krone, Gold nur für den Meister). Die Stufe kommt aus der Liga N (``league_divisions.level``), nie aus dem Text.
- **Platz, Zone, nächstes Spiel** einer laufenden Staffel (``live_places``): dieselbe Rechnung wie die öffentliche Tabelle
  (``tournament_view_routes._standing_rows``), aber für alle Staffeln auf einmal - Spiele, Phasen, Anmeldungen und Liga N je eine
  Abfrage, egal wie viele Staffeln es sind (kein N+1, tests/test_league_current_flow.py zählt nach). Einen Platz gibt es erst mit dem
  ersten gewerteten Spiel - vorher stünden alle gleich (wie das Rankingbanner).
- **Personenprofil** (``for_player``): die Co-Teams der Person (Kader ``team_squads.member_ids``, ohne Co-Team das Hauptteam) in
  laufenden Staffeln - nach der Regel des Profils (#2516, #2521, ``services/profile_visibility``): die Person selbst alles,
  Vereinsmitglieder bei eingeschaltetem Schalter dazu Internes (``internal: true``), alle anderen nur Öffentliches.
"""
from __future__ import annotations

from services import league_zones
from services.league_scope import is_league_staffel

ACTIVE_REGISTRATION_STATUSES = ("pending", "approved", "checked_in", "waitlist")
CLOSED_TOURNAMENT_STATUSES = ("completed", "results_published", "archived", "cancelled")
# Spiele, die nicht mehr anstehen.
FINISHED_MATCH_STATUSES = frozenset({"completed", "forfeit", "cancelled"})
LIMIT = 50
REGISTRATION_LIMIT = 4000
MATCH_LIMIT = 8000


def badge(division: dict | None, *, champion: bool = False) -> dict | None:
    """Was das Liga-Abzeichen braucht: ``{level, nickname, champion}`` - ``None`` ohne Liga N."""
    level = (division or {}).get("level")
    if not isinstance(level, int) or level < 1:
        return None
    nickname = " ".join(str((division or {}).get("nickname") or "").split()) or None
    return {"level": level, "nickname": nickname, "champion": bool(champion)}


def _slot_ids(match: dict) -> list[str]:
    slots = sorted(match.get("slots") or [], key=lambda slot: int((slot or {}).get("position") or 999))
    return [(slot or {}).get("registration_id") for slot in slots if (slot or {}).get("registration_id")]


def _next_match(matches: list[dict], registration_id: str, names: dict[str, str]) -> dict | None:
    """Das nächste offene Spiel der Anmeldung: nach Termin, ohne Termin nach Spieltag."""
    from services.matchday_schedule import matchday_number_of

    own = [match for match in matches
           if registration_id in _slot_ids(match) and match.get("status") not in FINISHED_MATCH_STATUSES and not match.get("is_preview")]
    if not own:
        return None
    match = min(own, key=lambda row: (str(row.get("scheduled_at") or "9999"), matchday_number_of(row) or 10**6, str(row.get("id"))))
    other = next((rid for rid in _slot_ids(match) if rid != registration_id), None)
    return {"match_id": match.get("id"), "scheduled_at": match.get("scheduled_at"), "matchday": matchday_number_of(match),
            "opponent": names.get(other) if other else None, "link": f"/matches/{match.get('id')}"}


async def live_places(db, tournaments: list[dict], registration_ids) -> dict[str, dict]:
    """Je Anmeldung aus ``registration_ids`` ``{rank, of, zone, zone_label, next_match}`` in ihrer laufenden Staffel.

    ``tournaments``: die ganzen Staffel-Dokumente (Tabellenregeln, Entscheide, Abzüge). Feste Zahl an Abfragen für alle Staffeln."""
    from routes.tournament_view_routes import _standing_rows
    from services.competition_read import CompetitionReadModel

    staffeln = {row["id"]: row for row in tournaments if row and row.get("id") and is_league_staffel(row)}
    wanted = set(registration_ids or ())
    if not staffeln or not wanted:
        return {}
    ids = sorted(staffeln)
    matches = await db.matches_v2.find({"tournament_id": {"$in": ids}}, {"_id": 0}).sort(
        [("stage_number", 1), ("round", 1), ("order", 1)]).to_list(MATCH_LIMIT)
    stages = await db.tournament_stages.find({"tournament_id": {"$in": ids}}, {"_id": 0}).sort("number", 1).to_list(len(ids) * 20 + 1)
    registrations = await db.tournament_registrations.find({"tournament_id": {"$in": ids}}, {"_id": 0}).to_list(REGISTRATION_LIMIT)
    season_ids = sorted({(row.get("league_context") or {}).get("season_id") for row in staffeln.values()} - {None})
    divisions = await db.league_divisions.find({"season_id": {"$in": season_ids}}, {"_id": 0, "id": 1, "level": 1, "zones": 1, "season_id": 1,
                                                                                    "status": 1}).to_list(len(season_ids) * 20 + 1)
    by_id = {row["id"]: row for row in divisions}
    levels: dict[str, list[int]] = {}
    for row in divisions:
        if row.get("status") != "archived" and isinstance(row.get("level"), int):
            levels.setdefault(row.get("season_id"), []).append(row["level"])
    names = {row["id"]: row.get("display_name") or row.get("team_name") or row.get("squad_name") or "Team" for row in registrations if row.get("id")}
    out: dict[str, dict] = {}
    for tid in ids:
        tournament = staffeln[tid]
        own = [row for row in registrations if row.get("tournament_id") == tid]
        if not wanted.intersection(row.get("id") for row in own):
            continue
        tournament_matches = [row for row in matches if row.get("tournament_id") == tid]
        context = tournament.get("league_context") or {}
        division = by_id.get(context.get("division_id"))
        zones = league_zones.effective(division, sorted(set(levels.get(context.get("season_id"), [])))) if division else None
        model = CompetitionReadModel(tournament_id=tid, stage_matches=tournament_matches,
                                     stages=[row for row in stages if row.get("tournament_id") == tid])
        rows = await _standing_rows(db, tournament, None, False, read_model=model, regs=own, own_ids=set(), live=True, users={}, zones=zones)
        counted = [row for row in rows if not row.get("exit")]
        for registration_id in wanted.intersection(row.get("id") for row in own):
            row = next((item for item in rows if item.get("registration_id") == registration_id), None) or {}
            played = int(row.get("played") or 0) > 0
            zone = row.get("zone") if played else None
            out[registration_id] = {
                "rank": int(row["rank"]) if played and row.get("rank") else None, "of": len(counted) or None,
                "zone": zone, "zone_label": league_zones.LABELS.get(zone or ""),
                "next_match": _next_match(tournament_matches, registration_id, names),
            }
    return out


async def for_player(db, user_id: str, viewer: dict | None, *, scope) -> list[dict]:
    """„Aktuelle Ligen“ im Personenprofil: je Co-Team in einer laufenden Staffel eine Zeile, beste Liga N zuerst."""
    from services.league_service import division_label
    from services.profile_visibility import PUBLIC, opens_season_page, public_season, sees_listed_tournament, sees_season

    squads = await db.team_squads.find({"member_ids": user_id, "status": {"$ne": "archived"}}, {"_id": 0, "id": 1, "team_id": 1, "name": 1}).to_list(LIMIT)
    teams = await db.teams.find({"member_ids": user_id}, {"_id": 0, "id": 1, "name": 1}).to_list(LIMIT)
    squad_ids = [row["id"] for row in squads if row.get("id")]
    team_ids = [row["id"] for row in teams if row.get("id")]
    ways = [{"squad_id": {"$in": squad_ids}}, {"user_id": user_id}]
    if team_ids:
        # Ohne Co-Team spielt das Hauptteam - dann zählt die Mitgliedschaft im Team.
        ways.append({"team_id": {"$in": team_ids}, "squad_id": {"$in": [None, ""]}})
    registrations = await db.tournament_registrations.find(
        {"$or": ways, "status": {"$in": list(ACTIVE_REGISTRATION_STATUSES)}}, {"_id": 0}).to_list(LIMIT * 4)
    tournament_ids = sorted({row.get("tournament_id") for row in registrations if row.get("tournament_id")})
    if not tournament_ids:
        return []
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": tournament_ids}, "league_context": {"$ne": None}, "status": {"$nin": list(CLOSED_TOURNAMENT_STATUSES)}},
        {"_id": 0}).to_list(len(tournament_ids) + 1)}
    registrations = [row for row in registrations if is_league_staffel(tournaments.get(row.get("tournament_id")))]
    if not registrations:
        return []
    contexts = [tournaments[row["tournament_id"]]["league_context"] for row in registrations]
    season_ids = sorted({context.get("season_id") for context in contexts if context.get("season_id")})
    seasons = {row["id"]: row for row in await db.league_seasons.find({"id": {"$in": season_ids}}, {"_id": 0}).to_list(len(season_ids) + 1)}
    league_ids = sorted({row.get("league_id") for row in seasons.values() if row.get("league_id")})
    leagues = {row["id"]: row for row in await db.leagues.find(
        {"id": {"$in": league_ids}}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "status": 1, "emblem_url": 1}).to_list(len(league_ids) + 1)}
    division_ids = sorted({context.get("division_id") for context in contexts if context.get("division_id")})
    divisions = {row["id"]: row for row in await db.league_divisions.find(
        {"id": {"$in": division_ids}}, {"_id": 0, "id": 1, "level": 1, "nickname": 1}).to_list(len(division_ids) + 1)}
    squad_names = {row["id"]: row.get("name") for row in squads}
    shown: list[tuple[dict, dict, dict, dict, dict, bool]] = []
    opens: dict = {}
    for registration in registrations:
        tournament = tournaments[registration["tournament_id"]]
        context = tournament["league_context"]
        season, league = seasons.get(context.get("season_id") or ""), None
        if season:
            league = leagues.get(season.get("league_id") or "")
        division = divisions.get(context.get("division_id") or "")
        if not season or not league or not division:
            continue
        if not await sees_season(scope, season) or not await sees_listed_tournament(scope, tournament):
            continue
        guest_sees = public_season(season)
        if guest_sees:
            guest_sees = await sees_listed_tournament(PUBLIC, tournament)
        shown.append((registration, tournament, season, league, division, not guest_sees))
    places = await live_places(db, [row[1] for row in shown], [row[0]["id"] for row in shown])
    out = []
    for registration, tournament, season, league, division, internal in shown:
        page_exists = league.get("status") == "active" and season.get("status") != "archived"
        # Den Link auf die Ligaseite gibt es nur, wenn der Betrachter sie öffnen darf - sonst führte er auf 404 bzw. 403 (wie die Historie).
        opens_page = page_exists and (public_season(season) if scope.mode == "public" else await opens_season_page(viewer, season, opens))
        anchor = tournament.get("slug") or tournament["id"]
        out.append({
            "registration_id": registration["id"],
            "squad_name": registration.get("squad_name") or squad_names.get(registration.get("squad_id")),
            "display_name": registration.get("display_name") or registration.get("team_name"),
            "team_id": registration.get("team_id"),
            "league": {"name": league.get("name"), "slug": league.get("slug")},
            "season": {"name": season.get("name"), "slug": season.get("slug")},
            "division_label": division_label(division), "staffel": (tournament.get("league_context") or {}).get("staffel"),
            "badge": badge(division),
            "emblem_url": season.get("emblem_url") or league.get("emblem_url") or None,
            "link": (f"/liga/{league['slug']}/{season['slug']}#staffel-{anchor}" if opens_page
                     else f"/tournaments/{anchor}"),
            "internal": internal,
            **(places.get(registration["id"]) or {"rank": None, "of": None, "zone": None, "zone_label": None, "next_match": None}),
        })
    return sort_rows(out)


def sort_rows(rows: list[dict]) -> list[dict]:
    """Beste Liga N zuerst, dann Liga, Season und Co-Team - die Teamseite sortiert ihre Co-Teams genauso (#1630)."""
    return sorted(rows, key=lambda row: (int((row.get("badge") or {}).get("level") or 99), str((row.get("league") or {}).get("name") or ""),
                                         str((row.get("season") or {}).get("name") or ""), str(row.get("squad_name") or row.get("display_name") or ""),
                                         str(row.get("staffel") or "")))
