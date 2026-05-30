"""Personal tournament and fast-lap reference aggregation."""
from __future__ import annotations

from datetime import datetime, timezone

from database import get_db
from services.visibility import user_can_see

RESULT_TOURNAMENT_STATUSES = {"completed", "results_published", "archived"}
REFERENCE_REGISTRATION_STATUSES = {"approved", "checked_in"}


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


def _v2_standings(matches_v2: list[dict], regs: list[dict]) -> list[dict]:
    rank_map = {
        r["id"]: {
            "registration_id": r["id"],
            "display_name": r.get("display_name") or r.get("ingame_name") or r.get("user", {}).get("display_name"),
            "played": 0,
            "won": 0,
            "top2": 0,
            "lost": 0,
            "points": 0,
            "rank_sum": 0,
            "furthest_round": 0,
            "best_rank": None,
        }
        for r in regs
        if r.get("id")
    }
    for match in matches_v2:
        if match.get("status") not in {"completed", "forfeit"}:
            continue
        for result in match.get("results") or []:
            rid = result.get("registration_id")
            if rid not in rank_map:
                continue
            rank = _safe_int(result.get("rank")) or 999
            row = rank_map[rid]
            row["played"] += 1
            row["rank_sum"] += rank
            row["furthest_round"] = max(row["furthest_round"], _safe_int(match.get("round")) or 0)
            row["best_rank"] = rank if row["best_rank"] is None else min(row["best_rank"], rank)
            if rank == 1:
                row["won"] += 1
            if rank <= 2:
                row["top2"] += 1
            else:
                row["lost"] += 1
            score = result.get("points")
            if score is None:
                score = result.get("score")
            if isinstance(score, (int, float)):
                row["points"] += score
    rows = list(rank_map.values())
    for row in rows:
        row["avg_rank"] = round(row["rank_sum"] / row["played"], 2) if row["played"] else None
    rows.sort(
        key=lambda row: (
            row["furthest_round"],
            row["won"],
            row["top2"],
            row["points"],
            -(row["avg_rank"] or 999),
        ),
        reverse=True,
    )
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def _legacy_elimination_standings(matches: list[dict], regs: list[dict]) -> list[dict]:
    rank_map = {
        r["id"]: {
            "registration_id": r["id"],
            "display_name": r.get("display_name") or r.get("ingame_name") or "Teilnehmer",
            "furthest_round": 0,
            "wins": 0,
            "losses": 0,
        }
        for r in regs
        if r.get("id")
    }
    for match in matches:
        a = match.get("participant_a_id")
        b = match.get("participant_b_id")
        winner = match.get("winner_id")
        round_number = _safe_int(match.get("round")) or 0
        if a in rank_map:
            rank_map[a]["furthest_round"] = max(rank_map[a]["furthest_round"], round_number)
        if b in rank_map:
            rank_map[b]["furthest_round"] = max(rank_map[b]["furthest_round"], round_number)
        if match.get("status") in {"completed", "forfeit"} and winner:
            loser = a if winner == b else b
            if winner in rank_map:
                rank_map[winner]["wins"] += 1
            if loser in rank_map:
                rank_map[loser]["losses"] += 1
    rows = list(rank_map.values())
    rows.sort(key=lambda row: (row["furthest_round"], row["wins"], -row["losses"]), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def _round_robin_standings(matches: list[dict], regs: list[dict]) -> list[dict]:
    stats = {
        r["id"]: {
            "registration_id": r["id"],
            "display_name": r.get("display_name") or r.get("ingame_name") or "Teilnehmer",
            "played": 0,
            "won": 0,
            "lost": 0,
            "drawn": 0,
            "score_for": 0,
            "score_against": 0,
            "points": 0,
        }
        for r in regs
        if r.get("id")
    }
    for match in matches:
        if match.get("status") != "completed":
            continue
        a = match.get("participant_a_id")
        b = match.get("participant_b_id")
        score_a = _safe_int(match.get("score_a")) or 0
        score_b = _safe_int(match.get("score_b")) or 0
        if a in stats:
            stats[a]["played"] += 1
            stats[a]["score_for"] += score_a
            stats[a]["score_against"] += score_b
        if b in stats:
            stats[b]["played"] += 1
            stats[b]["score_for"] += score_b
            stats[b]["score_against"] += score_a
        winner = match.get("winner_id")
        if winner == a and a in stats:
            stats[a]["won"] += 1
            stats[a]["points"] += 3
            if b in stats:
                stats[b]["lost"] += 1
        elif winner == b and b in stats:
            stats[b]["won"] += 1
            stats[b]["points"] += 3
            if a in stats:
                stats[a]["lost"] += 1
        else:
            if a in stats:
                stats[a]["drawn"] += 1
                stats[a]["points"] += 1
            if b in stats:
                stats[b]["drawn"] += 1
                stats[b]["points"] += 1
    rows = list(stats.values())
    rows.sort(key=lambda row: (row["points"], row["won"], row["score_for"] - row["score_against"]), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def _swiss_standings(regs: list[dict], matches: list[dict]) -> list[dict]:
    stats = {
        r["id"]: {
            "registration_id": r["id"],
            "display_name": r.get("display_name") or r.get("ingame_name") or "Teilnehmer",
            "points": 0,
            "played": 0,
            "won": 0,
            "drawn": 0,
            "lost": 0,
            "opponents": [],
        }
        for r in regs
        if r.get("id")
    }
    for match in matches:
        if match.get("status") != "completed":
            continue
        a = match.get("participant_a_id")
        b = match.get("participant_b_id")
        winner = match.get("winner_id")
        if a not in stats or b not in stats:
            continue
        stats[a]["played"] += 1
        stats[b]["played"] += 1
        stats[a]["opponents"].append(b)
        stats[b]["opponents"].append(a)
        if winner == a:
            stats[a]["won"] += 1
            stats[a]["points"] += 1
            stats[b]["lost"] += 1
        elif winner == b:
            stats[b]["won"] += 1
            stats[b]["points"] += 1
            stats[a]["lost"] += 1
        else:
            stats[a]["drawn"] += 1
            stats[b]["drawn"] += 1
            stats[a]["points"] += 0.5
            stats[b]["points"] += 0.5
    for row in stats.values():
        row["buchholz"] = sum(stats[opponent]["points"] for opponent in row["opponents"] if opponent in stats)
        row.pop("opponents", None)
    rows = list(stats.values())
    rows.sort(key=lambda row: (row["points"], row["buchholz"], row["won"]), reverse=True)
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def _group_standings(groups: list[dict], matches: list[dict], reg_map: dict) -> list[dict]:
    rows = []
    for group in groups:
        group_key = group.get("group_key")
        bracket_key = f"group_{group_key}"
        group_rows = _round_robin_standings(
            [match for match in matches if match.get("bracket") == bracket_key],
            [reg_map[pid] for pid in group.get("participant_ids", []) if pid in reg_map],
        )
        rows.extend(group_rows)
    return rows


def _rank_from_rows(rows: list[dict], registration_id: str) -> int | None:
    for row in rows:
        if row.get("registration_id") == registration_id:
            return _safe_int(row.get("rank"))
    return None


async def _tournament_rank_for_user(tournament_id: str, user_id: str, team_ids: list[str]) -> tuple[int | None, int | None]:
    db = get_db()
    identity_filter = [{"user_id": user_id}]
    if team_ids:
        identity_filter.append({"team_id": {"$in": team_ids}})
    reg_query = {"tournament_id": tournament_id, "$or": identity_filter}
    my_regs = await db.tournament_registrations.find(reg_query, {"_id": 0}).to_list(20)
    if not my_regs:
        return None, None

    regs = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": {"$in": list(REFERENCE_REGISTRATION_STATUSES)}},
        {"_id": 0},
    ).to_list(1000)
    participant_count = len(regs) or None
    reg_ids = [reg.get("id") for reg in my_regs if reg.get("id")]
    if not reg_ids:
        return None, participant_count

    for reg in my_regs:
        rank = _safe_int(reg.get("final_position")) or _safe_int(reg.get("rank")) or _safe_int(reg.get("placement"))
        if rank is not None:
            return rank, participant_count

    placements = await db.matches.find(
        {"tournament_id": tournament_id, "winner_id": {"$in": reg_ids}, "final_position": {"$ne": None}},
        {"_id": 0, "winner_id": 1, "final_position": 1},
    ).to_list(20)
    for placement in placements:
        rank = _safe_int(placement.get("final_position"))
        if rank is not None:
            return rank, participant_count

    matches_v2 = await db.matches_v2.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(3000)
    if matches_v2:
        rows = _v2_standings(matches_v2, regs)
        for reg_id in reg_ids:
            rank = _rank_from_rows(rows, reg_id)
            if rank is not None:
                return rank, participant_count
        return None, participant_count

    matches = await db.matches.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(3000)
    if not matches:
        return None, participant_count

    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "format": 1}) or {}
    fmt = tournament.get("format")
    if fmt in {"round_robin", "league"}:
        rows = _round_robin_standings(matches, regs)
    elif fmt == "swiss":
        rows = _swiss_standings(regs, matches)
    elif fmt == "groups":
        groups = await db.tournament_groups.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(100)
        reg_map = {reg["id"]: reg for reg in regs if reg.get("id")}
        rows = _group_standings(groups, matches, reg_map)
    else:
        rows = _legacy_elimination_standings(matches, regs)

    for reg_id in reg_ids:
        rank = _rank_from_rows(rows, reg_id)
        if rank is not None:
            return rank, participant_count
    return None, participant_count


async def personal_profile_references(user: dict, public_only: bool = False) -> dict:
    """Build the personal reference timeline used by mobile and public profiles."""
    if not user or not user.get("id"):
        return empty_profile_references()

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
        rank, participant_count = await _tournament_rank_for_user(tournament["id"], user_id, team_ids)
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
        },
    }
