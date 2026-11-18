"""Personal tournament and fast-lap reference aggregation."""
from __future__ import annotations

from datetime import datetime, timezone

from database import get_db
from models import REGISTRATION_LIMIT, GROUP_LIMIT
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import placements_for_structure, standings_for_structure
from services.league_scope import is_league_staffel, league_label
from services.profile_visibility import (
    PUBLIC,
    SELF,
    ProfileScope,
    challenge_is_internal,
    sees_challenge,
    sees_tournament,
    tournament_is_internal,
)

RESULT_TOURNAMENT_STATUSES = {"completed", "results_published", "archived"}
REFERENCE_REGISTRATION_STATUSES = {"approved", "checked_in"}
REFERENCE_SEASON_STATUSES = {"active", "completed", "archived"}


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _date_key(row: dict) -> datetime:
    return (
        _parse_dt(row.get("start_date"))
        or _parse_dt(row.get("date"))
        or _parse_dt(row.get("scheduled_at"))
        or datetime.max.replace(tzinfo=timezone.utc)
    )


def _time_str(ms: int | None) -> str | None:
    if ms is None:
        return None
    minutes = ms // 60000
    seconds = (ms % 60000) // 1000
    millis = ms % 1000
    return f"{minutes}:{seconds:02d}.{millis:03d}"


def _safe_int(value) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def empty_profile_references() -> dict:
    return {
        "items": [],
        "stats": {
            "total": 0,
            "tournaments": 0,
            "fastlaps": 0,
            "wins": 0,
            "podiums": 0,
        },
    }


async def _team_ids_for_user(user_id: str) -> list[str]:
    db = get_db()
    memberships = await db.team_members.find(
        {"user_id": user_id},
        {"_id": 0, "team_id": 1},
    ).to_list(200)
    return [row["team_id"] for row in memberships if row.get("team_id")]


async def _visible_tournament(tournament: dict | None) -> bool:
    """Öffentlich sichtbar, also für Gäste (Teilen, Weg, Bilanz) - die Regel steht in ``profile_visibility``."""
    return await sees_tournament(PUBLIC, tournament)


async def _visible_challenge(challenge: dict | None) -> bool:
    return await sees_challenge(PUBLIC, challenge)


async def _ranked_fastlap_entries(challenge_id: str, track_id: str, user_id: str, scope: ProfileScope | bool) -> dict | None:
    """``scope``: wer schaut (#2516) - ``True``/``False`` wie früher ``public_only``."""
    if isinstance(scope, bool):
        scope = PUBLIC if scope else SELF
    db = get_db()
    from services.fastlap_standings import official_times

    times = await official_times(db, challenge_id, track_id)
    if not scope.everything:
        challenge = await db.f1_challenges.find_one(
            {"id": challenge_id},
            {"_id": 0, "id": 1, "status": 1, "visibility": 1},
        )
        if not await sees_challenge(scope, challenge):
            return None
    # Dieselbe Rangfolge wie die Tabelle (#1584): Gleichstand - die früher gefahrene Zeit vorn.
    from services.fastlap_standings import rank_laps

    ranked = rank_laps(times)
    for row in ranked:
        if row.get("user_id") == user_id:
            return {**row, "participant_count": len(ranked), "time_str": _time_str(row.get("effective_ms"))}
    return None


def _rank_from_rows(rows: list[dict], registration_id: str) -> int | None:
    for row in rows:
        if row.get("registration_id") == registration_id:
            return _safe_int(row.get("rank"))
    return None


def _identity_filter(user_id: str, team_ids: list[str]) -> list[dict]:
    identity_filter: list[dict] = [{"user_id": user_id}]
    if team_ids:
        identity_filter.append({"team_id": {"$in": team_ids}})
    return identity_filter


async def _registrations_for_ranks(tournament_ids: list[str], user_id: str, team_ids: list[str]) -> dict[str, tuple[list[dict], list[dict]]]:
    """Die Anmeldungen, die ``_tournament_rank_for_user`` braucht - für alle Turniere einer Referenzliste in zwei Abfragen statt
    zwei je Turnier (#2516). Je Turnier: (eigene Anmeldungen, höchstens 20; gewertete Anmeldungen, höchstens ``REGISTRATION_LIMIT``)
    - dieselben Grenzen und dieselbe Reihenfolge wie die Einzelabfragen."""
    if not tournament_ids:
        return {}
    db = get_db()
    own: dict[str, list[dict]] = {tid: [] for tid in tournament_ids}
    for reg in await db.tournament_registrations.find(
            {"tournament_id": {"$in": tournament_ids}, "$or": _identity_filter(user_id, team_ids)}, {"_id": 0}).to_list(None):
        rows = own.setdefault(reg.get("tournament_id"), [])
        if len(rows) < 20:
            rows.append(reg)
    counted: dict[str, list[dict]] = {tid: [] for tid in tournament_ids}
    for reg in await db.tournament_registrations.find(
            {"tournament_id": {"$in": tournament_ids}, "status": {"$in": list(REFERENCE_REGISTRATION_STATUSES)}}, {"_id": 0}).to_list(None):
        rows = counted.setdefault(reg.get("tournament_id"), [])
        if len(rows) < REGISTRATION_LIMIT:
            rows.append(reg)
    return {tid: (own.get(tid) or [], counted.get(tid) or []) for tid in tournament_ids}


async def _tournament_rank_for_user(tournament_id: str, user_id: str, team_ids: list[str], *,
                                    prefetched: tuple[list[dict], list[dict]] | None = None) -> tuple[int | None, int | None]:
    """Platz und Feldgröße der Person in einem Turnier. ``prefetched``: die Anmeldungen aus ``_registrations_for_ranks``."""
    db = get_db()
    if prefetched is not None:
        my_regs, regs = prefetched
    else:
        reg_query = {"tournament_id": tournament_id, "$or": _identity_filter(user_id, team_ids)}
        my_regs = await db.tournament_registrations.find(reg_query, {"_id": 0}).to_list(20)
        regs = []
    if not my_regs:
        return None, None

    if prefetched is None:
        regs = await db.tournament_registrations.find(
            {"tournament_id": tournament_id, "status": {"$in": list(REFERENCE_REGISTRATION_STATUSES)}},
            {"_id": 0},
        ).to_list(REGISTRATION_LIMIT)
    participant_count = len(regs) or None
    reg_ids = [reg.get("id") for reg in my_regs if reg.get("id")]
    if not reg_ids:
        return None, participant_count

    for reg in my_regs:
        rank = _safe_int(reg.get("final_position")) or _safe_int(reg.get("rank")) or _safe_int(reg.get("placement"))
        if rank is not None:
            return rank, participant_count

    # Abgeschlossene Liga-Staffel (F.1, #1645): Der Platz kommt aus dem Endstand, nicht aus einer neuen Rechnung.
    final = await db.league_final_tables.find_one({"tournament_id": tournament_id, "active": True},
                                                  {"_id": 0, "rows.registration_id": 1, "rows.rank": 1})
    if final:
        for reg_id in reg_ids:
            rank = _rank_from_rows(final.get("rows") or [], reg_id)
            if rank is not None:
                return rank, participant_count
        return None, participant_count

    read_model = await load_competition_read_model(db, tournament_id)
    if not read_model.stage_matches:
        return None, participant_count

    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "format": 1, "scoring_rules": 1, "best_of": 1, "point_deductions": 1, "table_decisions": 1}) or {}
    groups = []
    if tournament.get("format") == "groups":
        groups = await db.tournament_groups.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(GROUP_LIMIT)
    structure = read_model.structure_snapshot()
    observe_structure_read(structure, surface="profile_references")
    placements = placements_for_structure(structure, regs, tournament=tournament)
    for rank, group in sorted(placements.items()):
        if any(placement.get("registration_id") in reg_ids for placement in group):
            return rank, participant_count

    rows = standings_for_structure(tournament, structure, regs, groups=groups)
    if tournament.get("format") == "groups":
        rows = [row for group in rows for row in group.get("standings") or []]

    for reg_id in reg_ids:
        rank = _rank_from_rows(rows, reg_id)
        if rank is not None:
            return rank, participant_count
    return None, participant_count


async def personal_profile_references(user: dict, public_only: bool = False, *, scope: ProfileScope | None = None) -> dict:
    """Build the personal reference timeline used by mobile and public profiles.

    ``scope`` (#2516, ``services/profile_visibility``): wer schaut - die Person selbst sieht alles, Vereinsmitglieder
    dazu Internes, alle anderen nur Öffentliches. Ohne ``scope`` entscheidet ``public_only`` wie bisher. Jeder Eintrag
    trägt ``internal``: ein Gast sähe ihn nicht."""
    if not user or not user.get("id"):
        return empty_profile_references()
    if scope is None:
        scope = PUBLIC if public_only else SELF

    db = get_db()
    user_id = user["id"]
    team_ids = await _team_ids_for_user(user_id)

    items: list[dict] = []
    seen_keys: set[str] = set()

    reg_query = {"user_id": user_id}
    if team_ids:
        reg_query = {"$or": [{"user_id": user_id}, {"team_id": {"$in": team_ids}}]}
    regs = await db.tournament_registrations.find(
        {**reg_query, "status": {"$in": list(REFERENCE_REGISTRATION_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(250)
    reg_tournament_ids = list({reg.get("tournament_id") for reg in regs if reg.get("tournament_id")})
    extra_rows = await db.tournaments.find(
        {"id": {"$in": reg_tournament_ids}, "status": {"$in": list(RESULT_TOURNAMENT_STATUSES)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "status": 1, "banner_url": 1, "game_name": 1, "visibility": 1, "is_public": 1,
         "league_context": 1},
    ).to_list(250)
    extra_tournaments = {}
    for row in extra_rows:
        if await sees_tournament(scope, row):
            extra_tournaments[row["id"]] = row
    rank_registrations = await _registrations_for_ranks(list(extra_tournaments), user_id, team_ids)
    for reg in regs:
        tournament = extra_tournaments.get(reg.get("tournament_id"))
        if not tournament:
            continue
        key = f"tournament:{tournament['id']}"
        if any(item.get("kind") == "tournament" and item.get("target_id") in {tournament.get("slug"), tournament.get("id")} for item in items):
            continue
        seen_keys.add(key)
        rank, participant_count = await _tournament_rank_for_user(tournament["id"], user_id, team_ids,
                                                                  prefetched=rank_registrations.get(tournament["id"]))
        items.append({
            "id": key,
            "kind": "tournament",
            "title": tournament.get("title") or "Turnier",
            "subtitle": tournament.get("game_name") or reg.get("display_name") or "Teilnahme",
            "rank": rank,
            "points": None,
            "status": tournament.get("status"),
            "date": tournament.get("start_date") or reg.get("created_at"),
            "target_id": tournament.get("slug") or tournament.get("id"),
            "banner_url": tournament.get("banner_url"),
            "participant_count": participant_count,
            "internal": await tournament_is_internal(tournament),
            # Liga (docs/LIGA.md): eine Staffel steht gekennzeichnet in der Liste („Liga · Staffel A“).
            **({"league_label": league_label(tournament)} if is_league_staffel(tournament) else {}),
        })

    lap_query = {"user_id": user_id, "is_invalid": {"$ne": True}}
    if not scope.everything:
        lap_query["$or"] = [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}]
    my_laps = await db.f1_lap_times.find(
        lap_query,
        {"_id": 0, "challenge_id": 1, "track_id": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(250)
    lap_pairs = []
    seen_pairs = set()
    for lap in my_laps:
        pair = (lap.get("challenge_id"), lap.get("track_id"))
        if not pair[0] or not pair[1] or pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        lap_pairs.append(pair)
    extra_challenge_ids = list({pair[0] for pair in lap_pairs})
    extra_track_ids = list({pair[1] for pair in lap_pairs})
    extra_challenge_rows = await db.f1_challenges.find(
        {"id": {"$in": extra_challenge_ids}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "status": 1, "banner_url": 1, "visibility": 1},
    ).to_list(250)
    extra_challenges = {}
    for row in extra_challenge_rows:
        if await sees_challenge(scope, row):
            extra_challenges[row["id"]] = row
    extra_tracks = {
        row["id"]: row
        for row in await db.f1_tracks.find(
            {"id": {"$in": extra_track_ids}},
            {"_id": 0, "id": 1, "name": 1, "challenge_id": 1},
        ).to_list(250)
    }
    for challenge_id, track_id in lap_pairs[:30]:
        if any(item.get("kind") == "fastlap" and str(item.get("id", "")).endswith(f"{challenge_id}:{track_id}") for item in items):
            continue
        challenge = extra_challenges.get(challenge_id)
        if not scope.everything and not challenge:
            continue
        internal = await challenge_is_internal(challenge)
        challenge = challenge or {}
        ranked = await _ranked_fastlap_entries(challenge_id, track_id, user_id, scope)
        if not ranked:
            continue
        track = extra_tracks.get(track_id) or {}
        items.append({
            "id": f"fastlap:{challenge_id}:{track_id}",
            "kind": "fastlap",
            "title": challenge.get("title") or "Fast Lap",
            "subtitle": track.get("name") or "Strecke",
            "rank": ranked.get("rank"),
            "points": None,
            "status": challenge.get("status"),
            "date": challenge.get("start_date") or ranked.get("created_at"),
            "target_id": challenge.get("slug") or challenge.get("id") or challenge_id,
            "banner_url": challenge.get("banner_url"),
            "participant_count": ranked.get("participant_count"),
            "time_ms": ranked.get("effective_ms"),
            "time_str": ranked.get("time_str"),
            "internal": internal,
        })

    season_rows = await db.seasons.find(
        {"status": {"$in": list(REFERENCE_SEASON_STATUSES)}},
        {"_id": 0, "id": 1, "slug": 1, "name": 1, "kind": 1, "status": 1, "start_date": 1, "end_date": 1, "banner_url": 1},
    ).sort("end_date", -1).to_list(20)
    if season_rows:
        from services.season_service import aggregate_leaderboard
        for season in season_rows:
            standings = await aggregate_leaderboard(season_id=season.get("id"), limit=3)
            for index, row in enumerate(standings, start=1):
                if row.get("id") != user_id or index > 3:
                    continue
                items.append({
                    "id": f"season:{season['id']}",
                    "kind": "season",
                    "title": season.get("name") or "Jahreswertung",
                    "subtitle": "Jahreswertung" if season.get("kind") != "circuit" else "Turnierserie",  # #2123, ER13
                    "rank": index,
                    "points": row.get("total_points"),
                    "status": season.get("status"),
                    "date": season.get("end_date") or season.get("start_date"),
                    "target_id": season.get("slug") or season.get("id"),
                    "banner_url": season.get("banner_url"),
                    "participant_count": len(standings),
                    # Die Jahreswertung bleibt, wie sie ist (year_review) - sie ist nie intern.
                    "internal": False,
                })
                break

    items.sort(key=_date_key, reverse=True)
    wins = len([item for item in items if int(item.get("rank") or 0) == 1])
    podiums = len([item for item in items if 1 <= int(item.get("rank") or 999) <= 3])
    return {
        "items": items[:80],
        "stats": {
            "total": len(items),
            "tournaments": len([item for item in items if item.get("kind") == "tournament"]),
            "fastlaps": len([item for item in items if item.get("kind") == "fastlap"]),
            "wins": wins,
            "podiums": podiums,
        },
    }
