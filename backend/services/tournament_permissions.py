"""Tournament-scoped staff permission helpers."""
from fastapi import HTTPException

from database import get_db
from services.permissions import is_tournament_lead

# Turnierrechte für alle Turniere: wer den Bereich Turnierleitung hat - über die Rolle (Turnierleitung,
# Club-Admin, Superadmin) oder eine Freigabe (#1350). Moderatoren moderieren; in einem einzelnen Turnier
# bekommen sie genau die Rechte eines Helfer-Einsatzes (tournament_staff_assignments) - wie jede andere
# Person auch. Die Rollenlisten bleiben nur als Auskunft für ältere Aufrufer.
GLOBAL_TOURNAMENT_STAFF_ROLES = {"tournament_admin", "club_admin", "superadmin"}
GLOBAL_TOURNAMENT_ADMIN_ROLES = {"tournament_admin", "club_admin", "superadmin"}

# Ergebnisse eintragen: Organisation, Schiedsrichter, Ergebnisdienst - und die Station-Crew (Entscheidung des Betreibers
# zu #1139: alles steht im Protokoll, die Turnierleitung kann korrigieren).
RESULT_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager"}
CHECKIN_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager"}
READ_STAFF_ROLES = {"organizer", "referee", "scorekeeper", "station_manager", "stream_operator"}
STRUCTURE_STAFF_ROLES = {"organizer", "referee"}
PARTICIPANT_STAFF_ROLES = {"organizer", "referee", "scorekeeper"}


def is_global_tournament_staff(user: dict | None) -> bool:
    return is_tournament_lead(user)


def is_global_tournament_admin(user: dict | None) -> bool:
    return is_tournament_lead(user)


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


def _assignment_covers_match(assignment: dict, match: dict) -> bool:
    scope = assignment.get("scope") or "tournament"
    scope_id = assignment.get("scope_id")
    if scope == "tournament" or not scope_id:
        return True
    field = {"match": "id", "stage": "stage_id", "group": "group_id", "station": "station_id"}.get(scope)
    return bool(field and match.get(field) == scope_id)


async def result_staff_user_ids(db, match: dict) -> set[str]:
    """Wer für dieses Spiel Ergebnisse eintragen darf - und deshalb von Streitfällen erfährt (#1132, #1134): die
    Turnierleitung über alle Turniere und die Helfer mit Ergebnis-Recht, deren Einsatz das Spiel umfasst (ganzes
    Turnier, Phase, Gruppe, Station oder genau dieses Spiel). Dieselbe Regel wie ``has_match_result_permission`` -
    die Turnierleitung als Rolle oder als Freigabe (#1350)."""
    from services.permissions import tournament_lead_filter

    users = await db.users.find(
        {**tournament_lead_filter(), "is_active": {"$ne": False}, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(200)
    ids = {row["id"] for row in users if row.get("id")}
    if match.get("tournament_id"):
        assignments = await db.tournament_staff_assignments.find(
            {"tournament_id": match["tournament_id"], "is_active": {"$ne": False}, "role": {"$in": sorted(RESULT_STAFF_ROLES)}},
            {"_id": 0, "user_id": 1, "scope": 1, "scope_id": 1},
        ).to_list(500)
        ids.update(row["user_id"] for row in assignments if row.get("user_id") and _assignment_covers_match(row, match))
    return ids


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
