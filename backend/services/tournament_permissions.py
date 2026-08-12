"""Tournament-scoped staff permission helpers."""
from fastapi import HTTPException

from database import get_db

GLOBAL_TOURNAMENT_STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
GLOBAL_TOURNAMENT_ADMIN_ROLES = {"tournament_admin", "club_admin", "superadmin"}

RESULT_STAFF_ROLES = {"organizer", "referee", "scorekeeper"}
CHECKIN_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager"}
READ_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager", "stream_operator"}
STRUCTURE_STAFF_ROLES = {"organizer", "referee"}
PARTICIPANT_STAFF_ROLES = {"organizer", "referee", "scorekeeper"}


def is_global_tournament_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in GLOBAL_TOURNAMENT_STAFF_ROLES)


def is_global_tournament_admin(user: dict | None) -> bool:
    return bool(user and user.get("role") in GLOBAL_TOURNAMENT_ADMIN_ROLES)


async def assigned_tournament_ids(user: dict | None) -> list[str]:
    if not user:
        return []
    db = get_db()
    return await db.tournament_staff_assignments.distinct(
        "tournament_id",
        {"user_id": user["id"], "is_active": {"$ne": False}},
    )


async def has_tournament_staff_permission(
    user: dict | None,
    tournament_id: str,
    allowed_roles: set[str] | None = None,
    scope: str | None = None,
    scope_id: str | None = None,
) -> bool:
    if is_global_tournament_staff(user):
        return True
    if not user:
        return False
    query = {
        "tournament_id": tournament_id,
        "user_id": user["id"],
        "is_active": {"$ne": False},
    }
    if allowed_roles:
        query["role"] = {"$in": sorted(allowed_roles)}
    db = get_db()
    assignments = await db.tournament_staff_assignments.find(query, {"_id": 0}).to_list(200)
    if not assignments:
        return False
    if not scope:
        return True
    for assignment in assignments:
        assignment_scope = assignment.get("scope") or "tournament"
        assignment_scope_id = assignment.get("scope_id")
        if assignment_scope == "tournament":
            return True
        if assignment_scope == scope and (not assignment_scope_id or assignment_scope_id == scope_id):
            return True
    return False


async def has_match_result_permission(user: dict | None, match: dict) -> bool:
    """Return whether a user may enter the result for one concrete match.

    Keep the scope rules in one place so legacy and v2 routes, dashboards and
    operational match lists cannot drift apart.
    """
    if not user or not match.get("tournament_id"):
        return False
    tournament_id = match["tournament_id"]
    checks = [
        ("tournament", None),
        ("match", match.get("id")),
        ("stage", match.get("stage_id")),
        ("group", match.get("group_id")),
        ("station", match.get("station_id")),
    ]
    for scope, scope_id in checks:
        if scope != "tournament" and not scope_id:
            continue
        if await has_tournament_staff_permission(
            user,
            tournament_id,
            RESULT_STAFF_ROLES,
            scope,
            scope_id,
        ):
            return True
    return False


async def require_tournament_staff_permission(
    user: dict | None,
    tournament_id: str,
    allowed_roles: set[str] | None = None,
    scope: str | None = None,
    scope_id: str | None = None,
) -> None:
    if await has_tournament_staff_permission(user, tournament_id, allowed_roles, scope, scope_id):
        return
    raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Aktion")
