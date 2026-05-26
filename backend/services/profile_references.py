"""Personal tournament and fast-lap reference aggregation."""
from __future__ import annotations

from datetime import datetime, timezone

from database import get_db
from services.visibility import user_can_see

RESULT_TOURNAMENT_STATUSES = {"completed", "results_published", "archived"}


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


def empty_profile_references() -> dict:
    return {
        "items": [],
        "stats": {
            "total": 0,
            "tournaments": 0,
            "fastlaps": 0,
            "wins": 0,
            "podiums": 0,
            "season_points": 0,
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
    if not tournament:
        return False
    if tournament.get("status") == "draft" or tournament.get("is_public") is False:
        return False
    return await user_can_see(None, tournament.get("visibility") or "public")


async def _visible_challenge(challenge: dict | None) -> bool:
    if not challenge:
        return False
    if challenge.get("status") == "draft":
        return False
    return await user_can_see(None, challenge.get("visibility") or "public")


async def _ranked_fastlap_entries(challenge_id: str, track_id: str, user_id: str, public_only: bool) -> dict | None:
    db = get_db()
    times = await db.f1_lap_times.find(
        {
            "challenge_id": challenge_id,
            "track_id": track_id,
            "is_invalid": {"$ne": True},
            "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
        },
        {"_id": 0},
    ).to_list(5000)
    if public_only:
        challenge = await db.f1_challenges.find_one(
            {"id": challenge_id},
            {"_id": 0, "id": 1, "status": 1, "visibility": 1},
        )
        if not await _visible_challenge(challenge):
            return None
    best_by_user: dict[str, dict] = {}
    for row in times:
        uid = row.get("user_id")
        if not uid:
            continue
        effective_ms = int(row.get("time_ms") or 0) + int(float(row.get("penalty_seconds") or 0) * 1000)
        current = best_by_user.get(uid)
        if not current or effective_ms < current["effective_ms"]:
            best_by_user[uid] = {**row, "effective_ms": effective_ms}
    ranked = sorted(best_by_user.values(), key=lambda item: item["effective_ms"])
    for index, row in enumerate(ranked, start=1):
        if row.get("user_id") == user_id:
            return {**row, "rank": index, "participant_count": len(ranked), "time_str": _time_str(row.get("effective_ms"))}
    return None


async def personal_profile_references(user: dict, public_only: bool = False) -> dict:
    """Build the personal reference timeline used by mobile and public profiles."""
    if not user or not user.get("id"):
        return empty_profile_references()

    db = get_db()
    user_id = user["id"]
    team_ids = await _team_ids_for_user(user_id)
    season_entries = await db.season_points.find(
        {"user_id": user_id, "source_type": {"$in": ["tournament", "fastlap", "challenge"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(250)

    items: list[dict] = []
    seen_keys: set[str] = set()
    tournament_ids: set[str] = set()
    challenge_ids: set[str] = set()
    track_ids: set[str] = set()
    for entry in season_entries:
        source_id = str(entry.get("source_id") or "")
        source_type = entry.get("source_type")
        if source_type == "tournament" and source_id:
            tournament_ids.add(source_id)
        if source_type in {"fastlap", "challenge"} and source_id:
            parts = source_id.split(":")
            if parts[0]:
                challenge_ids.add(parts[0])
            if len(parts) > 1 and parts[1]:
                track_ids.add(parts[1])

    tournament_rows = await db.tournaments.find(
        {"id": {"$in": list(tournament_ids)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "status": 1, "banner_url": 1, "game_name": 1, "game_id": 1, "visibility": 1, "is_public": 1},
    ).to_list(250)
    if public_only:
        tournament_map = {}
        for row in tournament_rows:
            if await _visible_tournament(row):
                tournament_map[row["id"]] = row
    else:
        tournament_map = {row["id"]: row for row in tournament_rows}

    challenge_rows = await db.f1_challenges.find(
        {"id": {"$in": list(challenge_ids)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "end_date": 1, "status": 1, "banner_url": 1, "visibility": 1},
    ).to_list(250)
    if public_only:
        challenge_map = {}
        for row in challenge_rows:
            if await _visible_challenge(row):
                challenge_map[row["id"]] = row
    else:
        challenge_map = {row["id"]: row for row in challenge_rows}

    track_map = {
        row["id"]: row
        for row in await db.f1_tracks.find(
            {"id": {"$in": list(track_ids)}},
            {"_id": 0, "id": 1, "name": 1, "challenge_id": 1},
        ).to_list(250)
    }

    for entry in season_entries:
        source_type = entry.get("source_type")
        source_id = str(entry.get("source_id") or "")
        parts = source_id.split(":")
        key = f"season:{source_type}:{source_id}"
        if key in seen_keys:
            continue
        if source_type == "tournament":
            tournament = tournament_map.get(source_id)
            if public_only and not tournament:
                continue
            tournament = tournament or {}
            seen_keys.add(key)
            items.append({
                "id": key,
                "kind": "tournament",
                "title": tournament.get("title") or entry.get("source_name") or "Turnier",
                "subtitle": tournament.get("game_name") or "Turnier",
                "rank": entry.get("rank"),
                "points": entry.get("total_points"),
                "status": tournament.get("status"),
                "date": tournament.get("start_date") or entry.get("created_at"),
                "target_id": tournament.get("slug") or tournament.get("id") or source_id,
                "banner_url": tournament.get("banner_url"),
                "participant_count": entry.get("num_participants"),
            })
        elif source_type in {"fastlap", "challenge"}:
            challenge = challenge_map.get(parts[0])
            if public_only and not challenge:
                continue
            challenge = challenge or {}
            track = track_map.get(parts[1] if len(parts) > 1 else "") or {}
            seen_keys.add(key)
            items.append({
                "id": key,
                "kind": "fastlap",
                "title": challenge.get("title") or entry.get("source_name") or "Fast Lap",
                "subtitle": track.get("name") or entry.get("source_name") or "Strecke",
                "rank": entry.get("rank"),
                "points": entry.get("total_points"),
                "status": challenge.get("status"),
                "date": challenge.get("start_date") or entry.get("created_at"),
                "target_id": challenge.get("slug") or challenge.get("id") or parts[0],
                "banner_url": challenge.get("banner_url"),
                "participant_count": entry.get("num_participants"),
            })

    reg_query = {"user_id": user_id}
    if team_ids:
        reg_query = {"$or": [{"user_id": user_id}, {"team_id": {"$in": team_ids}}]}
    regs = await db.tournament_registrations.find(
        {**reg_query, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(250)
    reg_tournament_ids = list({reg.get("tournament_id") for reg in regs if reg.get("tournament_id")})
    extra_rows = await db.tournaments.find(
        {"id": {"$in": reg_tournament_ids}, "status": {"$in": list(RESULT_TOURNAMENT_STATUSES)}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "start_date": 1, "status": 1, "banner_url": 1, "game_name": 1, "visibility": 1, "is_public": 1},
    ).to_list(250)
    if public_only:
        extra_tournaments = {}
        for row in extra_rows:
            if await _visible_tournament(row):
                extra_tournaments[row["id"]] = row
    else:
        extra_tournaments = {row["id"]: row for row in extra_rows}
    for reg in regs:
        tournament = extra_tournaments.get(reg.get("tournament_id"))
        if not tournament:
            continue
        key = f"tournament:{tournament['id']}"
        if any(item.get("kind") == "tournament" and item.get("target_id") in {tournament.get("slug"), tournament.get("id")} for item in items):
            continue
        seen_keys.add(key)
        items.append({
            "id": key,
            "kind": "tournament",
            "title": tournament.get("title") or "Turnier",
            "subtitle": tournament.get("game_name") or reg.get("display_name") or "Teilnahme",
            "rank": None,
            "points": None,
            "status": tournament.get("status"),
            "date": tournament.get("start_date") or reg.get("created_at"),
            "target_id": tournament.get("slug") or tournament.get("id"),
            "banner_url": tournament.get("banner_url"),
            "participant_count": None,
        })

    lap_query = {"user_id": user_id, "is_invalid": {"$ne": True}}
    if public_only:
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
    if public_only:
        extra_challenges = {}
        for row in extra_challenge_rows:
            if await _visible_challenge(row):
                extra_challenges[row["id"]] = row
    else:
        extra_challenges = {row["id"]: row for row in extra_challenge_rows}
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
        if public_only and not challenge:
            continue
        challenge = challenge or {}
        ranked = await _ranked_fastlap_entries(challenge_id, track_id, user_id, public_only)
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
        })

    items.sort(key=lambda row: _date_key(row), reverse=True)
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
            "season_points": round(sum(float(item.get("points") or 0) for item in items), 1),
        },
    }
