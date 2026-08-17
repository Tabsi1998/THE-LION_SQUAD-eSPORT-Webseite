"""Compact, permission-aware match lists for web and mobile dashboards."""
from __future__ import annotations

from datetime import datetime, timezone

from services.competition_snapshot import adapt_legacy_matches, adapt_stage_matches
from services.station_labels import attach_station_info
from services.tournament_permissions import RESULT_STAFF_ROLES, is_global_tournament_staff


OPEN_MATCH_STATUSES = {"ready", "scheduled", "in_progress", "waiting_result"}
ACTIVE_REGISTRATION_STATUSES = {"registered", "approved", "checked_in"}
ACTIVE_OPERATION_TOURNAMENT_STATUSES = {"check_in", "live", "paused"}
MATCH_STATUS_PRIORITY = {
    "in_progress": 0,
    "waiting_result": 1,
    "ready": 2,
    "scheduled": 3,
}


def match_registration_ids(match: dict) -> list[str]:
    ids: list[str] = []
    for key in ("participant_a_id", "participant_b_id"):
        if match.get(key):
            ids.append(match[key])
    ids.extend(
        slot["registration_id"]
        for slot in match.get("slots") or []
        if slot.get("registration_id")
    )
    return list(dict.fromkeys(ids))


def match_overview_sort_key(match: dict) -> tuple:
    status_priority = MATCH_STATUS_PRIORITY.get(str(match.get("status") or ""), 9)
    scheduled = match.get("scheduled_at")
    parsed = datetime.max.replace(tzinfo=timezone.utc)
    if scheduled:
        try:
            parsed = datetime.fromisoformat(str(scheduled).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            parsed = parsed.astimezone(timezone.utc)
        except (TypeError, ValueError):
            parsed = datetime.max.replace(tzinfo=timezone.utc)
    return (
        status_priority,
        parsed,
        int(match.get("round") or match.get("matchday_number") or 9999),
        str(match.get("match_key") or match.get("id") or ""),
    )


async def _team_ids_for_user(db, user_id: str) -> list[str]:
    memberships = await db.team_members.find(
        {"user_id": user_id},
        {"_id": 0, "team_id": 1},
    ).to_list(200)
    return [row["team_id"] for row in memberships if row.get("team_id")]


async def _active_registrations_for_user(db, user: dict) -> list[dict]:
    team_ids = await _team_ids_for_user(db, user["id"])
    identity_query: dict = {"user_id": user["id"]}
    if team_ids:
        identity_query = {"$or": [{"user_id": user["id"]}, {"team_id": {"$in": team_ids}}]}
    return await db.tournament_registrations.find(
        {**identity_query, "status": {"$in": sorted(ACTIVE_REGISTRATION_STATUSES)}},
        {"_id": 0, "id": 1, "tournament_id": 1},
    ).to_list(250)


async def _matches_for_query(db, query: dict, per_collection_limit: int = 240) -> list[dict]:
    legacy = await db.matches.find(query, {"_id": 0}).to_list(per_collection_limit)
    v2 = await db.matches_v2.find(query, {"_id": 0}).to_list(per_collection_limit)
    return [*adapt_legacy_matches(legacy), *adapt_stage_matches(v2)]


def _registration_label(registration: dict | None, team_map: dict[str, dict]) -> str:
    if not registration:
        return ""
    direct = registration.get("display_name") or registration.get("ingame_name")
    if direct:
        return str(direct)
    team = team_map.get(registration.get("team_id") or "") or {}
    if team.get("tag") and team.get("name"):
        return f"[{team['tag']}] {team['name']}"
    return str(team.get("name") or team.get("tag") or "")


async def compact_match_overviews(
    db,
    matches: list[dict],
    own_registration_ids: set[str] | None = None,
    result_match_ids: set[str] | None = None,
) -> list[dict]:
    own_registration_ids = own_registration_ids or set()
    result_match_ids = result_match_ids or set()
    await attach_station_info(db, matches)
    tournament_ids = list({match.get("tournament_id") for match in matches if match.get("tournament_id")})
    registration_ids = list({rid for match in matches for rid in match_registration_ids(match)})
    tournaments = await db.tournaments.find(
        {"id": {"$in": tournament_ids}},
        {"_id": 0, "id": 1, "title": 1, "slug": 1},
    ).to_list(max(100, len(tournament_ids))) if tournament_ids else []
    registrations = await db.tournament_registrations.find(
        {"id": {"$in": registration_ids}},
        {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_id": 1},
    ).to_list(max(200, len(registration_ids))) if registration_ids else []
    team_ids = list({row.get("team_id") for row in registrations if row.get("team_id")})
    teams = await db.teams.find(
        {"id": {"$in": team_ids}},
        {"_id": 0, "id": 1, "name": 1, "tag": 1},
    ).to_list(max(100, len(team_ids))) if team_ids else []

    tournament_map = {row["id"]: row for row in tournaments}
    registration_map = {row["id"]: row for row in registrations}
    team_map = {row["id"]: row for row in teams}
    summaries = []
    for match in matches:
        participant_ids = match_registration_ids(match)
        participant_names = [
            label
            for label in (_registration_label(registration_map.get(rid), team_map) for rid in participant_ids)
            if label
        ]
        opponent_names = [
            label
            for rid in participant_ids
            if rid not in own_registration_ids
            for label in [_registration_label(registration_map.get(rid), team_map)]
            if label
        ]
        tournament = tournament_map.get(match.get("tournament_id") or "") or {}
        summaries.append({
            "id": match.get("id"),
            "collection": match.get("collection") or "matches",
            "status": match.get("status"),
            "scheduled_at": match.get("scheduled_at"),
            "tournament_id": match.get("tournament_id"),
            "tournament_title": tournament.get("title"),
            "tournament_slug": tournament.get("slug"),
            "round": match.get("round") or match.get("matchday_number"),
            "round_name": match.get("round_name") or match.get("matchday_label"),
            "match_key": match.get("match_key"),
            "station_id": match.get("station_id"),
            "station_label": match.get("station_label") or match.get("station_name") or (match.get("station") or {}).get("name"),
            "participant_names": participant_names,
            "opponent_name": ", ".join(opponent_names),
            "participant_count": len(participant_ids),
            "is_own_match": bool(own_registration_ids.intersection(participant_ids)),
            "can_submit_result": match.get("id") in result_match_ids,
            "needs_result": match.get("status") in {"in_progress", "waiting_result"},
        })
    return summaries


async def own_match_overviews(db, user: dict, limit: int = 12) -> tuple[list[dict], list[dict]]:
    registrations = await _active_registrations_for_user(db, user)
    registration_ids = {row["id"] for row in registrations if row.get("id")}
    if not registration_ids:
        return [], registrations
    query = {
        "$or": [
            {"participant_a_id": {"$in": sorted(registration_ids)}},
            {"participant_b_id": {"$in": sorted(registration_ids)}},
            {"slots.registration_id": {"$in": sorted(registration_ids)}},
        ],
        "status": {"$in": sorted(OPEN_MATCH_STATUSES)},
    }
    matches = sorted(await _matches_for_query(db, query), key=match_overview_sort_key)[:limit]
    return await compact_match_overviews(db, matches, registration_ids), registrations


def _assignment_matches(assignment: dict, match: dict) -> bool:
    scope = assignment.get("scope") or "tournament"
    scope_id = assignment.get("scope_id")
    if scope == "tournament":
        return True
    if not scope_id:
        return True
    field_by_scope = {
        "match": "id",
        "stage": "stage_id",
        "station": "station_id",
        "group": "group_id",
    }
    field = field_by_scope.get(scope)
    return bool(field and match.get(field) == scope_id)


async def operational_match_overviews(
    db,
    user: dict,
    exclude_match_ids: set[str] | None = None,
    limit: int = 12,
) -> list[dict]:
    exclude_match_ids = exclude_match_ids or set()
    global_staff = is_global_tournament_staff(user)
    assignments: list[dict] = []
    if not global_staff:
        assignments = await db.tournament_staff_assignments.find(
            {
                "user_id": user["id"],
                "role": {"$in": sorted(RESULT_STAFF_ROLES)},
                "is_active": {"$ne": False},
            },
            {"_id": 0, "tournament_id": 1, "scope": 1, "scope_id": 1},
        ).to_list(250)
        if not assignments:
            return []

    assigned_ids = list({row.get("tournament_id") for row in assignments if row.get("tournament_id")})
    tournament_query: dict = {"status": {"$in": sorted(ACTIVE_OPERATION_TOURNAMENT_STATUSES)}}
    if not global_staff:
        tournament_query["id"] = {"$in": assigned_ids}
    active_tournaments = await db.tournaments.find(
        tournament_query,
        {"_id": 0, "id": 1},
    ).to_list(500)
    tournament_ids = [row["id"] for row in active_tournaments if row.get("id")]
    if not tournament_ids:
        return []

    query = {
        "tournament_id": {"$in": tournament_ids},
        "status": {"$in": sorted(OPEN_MATCH_STATUSES)},
    }
    candidates = [
        match for match in await _matches_for_query(db, query)
        if match.get("id") not in exclude_match_ids
        and (global_staff or any(
            row.get("tournament_id") == match.get("tournament_id") and _assignment_matches(row, match)
            for row in assignments
        ))
    ]
    matches = sorted(candidates, key=match_overview_sort_key)[:limit]
    result_ids = {match.get("id") for match in matches if match.get("id")}
    return await compact_match_overviews(db, matches, result_match_ids=result_ids)
