"""Turnier-Team: Rollen der Turnierleitung zuweisen.
"""
from fastapi import HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin
from services.tournament_permissions import READ_STAFF_ROLES, require_tournament_staff_permission
from models import TournamentStaffAssignmentCreate, TournamentStaffAssignmentUpdate, now_utc, new_id
from routes.tournament_common import (
    _audit_tournament_action,
    _normalize_team_settings,
    _resolve_tid,
    _serialized_tournament_write,
)
from routes.tournament_router import router


# --- Tournament staff assignments ---
async def _enrich_staff_assignments(assignments: list[dict]) -> list[dict]:
    db = get_db()
    user_ids = list({a.get("user_id") for a in assignments if a.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "email": 1, "role": 1},
    ).to_list(500)}
    for assignment in assignments:
        u = users.get(assignment.get("user_id")) or {}
        assignment["user"] = {
            "id": u.get("id"),
            "username": u.get("username"),
            "display_name": u.get("display_name"),
            "avatar_url": u.get("avatar_url"),
            "email": u.get("email"),
            "role": u.get("role"),
        }
    return assignments


@router.get("/{tid}/staff")
async def list_tournament_staff(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    assignments = await db.tournament_staff_assignments.find(
        {"tournament_id": tid},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return await _enrich_staff_assignments(assignments)


@router.post("/{tid}/staff")
async def create_tournament_staff(tid: str, body: TournamentStaffAssignmentCreate,
                                  me: dict = Depends(require_admin()),
                                  _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    if not await db.users.find_one({"id": body.user_id}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    scope = body.scope or "tournament"
    scope_id = body.scope_id if scope != "tournament" else None
    existing = await db.tournament_staff_assignments.find_one({
        "tournament_id": tid,
        "user_id": body.user_id,
        "role": body.role,
        "scope": scope,
        "scope_id": scope_id,
    })
    if existing:
        existing.pop("_id", None)
        enriched = (await _enrich_staff_assignments([existing]))[0]
        return {**enriched, "idempotent_replay": True}
    doc = _normalize_team_settings(body.model_dump())
    doc["id"] = new_id()
    doc["tournament_id"] = tid
    doc["scope"] = scope
    doc["scope_id"] = scope_id
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.tournament_staff_assignments.insert_one(doc)
    await _audit_tournament_action(
        db,
        "tournament.staff.create",
        me.get("id"),
        tid,
        {"assignment_id": doc["id"], "user_id": doc["user_id"], "role": doc["role"], "scope": doc["scope"], "scope_id": doc.get("scope_id")},
    )
    doc.pop("_id", None)
    enriched = (await _enrich_staff_assignments([doc]))[0]
    return {**enriched, "idempotent_replay": False}


@router.patch("/{tid}/staff/{assignment_id}")
@router.put("/{tid}/staff/{assignment_id}")
async def update_tournament_staff(tid: str, assignment_id: str, body: TournamentStaffAssignmentUpdate,
                                  me: dict = Depends(require_admin()),
                                  _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    current = await db.tournament_staff_assignments.find_one({"id": assignment_id, "tournament_id": tid}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Zuweisung nicht gefunden")
    nullable = {"scope_id", "notes"}
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in nullable}
    if updates.get("scope") == "tournament":
        updates["scope_id"] = None
    proposed = {**current, **updates}
    duplicate = await db.tournament_staff_assignments.find_one({
        "id": {"$ne": assignment_id},
        "tournament_id": tid,
        "user_id": proposed.get("user_id"),
        "role": proposed.get("role"),
        "scope": proposed.get("scope") or "tournament",
        "scope_id": proposed.get("scope_id") if (proposed.get("scope") or "tournament") != "tournament" else None,
    })
    if duplicate:
        raise HTTPException(status_code=409, detail="Diese Zuweisung existiert bereits")
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_staff_assignments.update_one({"id": assignment_id}, {"$set": updates})
    await _audit_tournament_action(
        db,
        "tournament.staff.update",
        me.get("id"),
        tid,
        {"assignment_id": assignment_id, "updates": {k: v for k, v in updates.items() if k != "updated_at"}},
    )
    updated = await db.tournament_staff_assignments.find_one({"id": assignment_id}, {"_id": 0})
    return (await _enrich_staff_assignments([updated]))[0]


@router.delete("/{tid}/staff/{assignment_id}")
async def delete_tournament_staff(tid: str, assignment_id: str, me: dict = Depends(require_admin()),
                                  _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    current = await db.tournament_staff_assignments.find_one({"id": assignment_id, "tournament_id": tid}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Zuweisung nicht gefunden")
    await db.tournament_staff_assignments.delete_one({"id": assignment_id})
    await _audit_tournament_action(
        db,
        "tournament.staff.delete",
        me.get("id"),
        tid,
        {"assignment_id": assignment_id, "user_id": current.get("user_id"), "role": current.get("role")},
    )
    return {"ok": True}
