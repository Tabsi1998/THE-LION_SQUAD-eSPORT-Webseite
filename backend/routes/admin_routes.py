"""Admin-only routes: dashboard KPIs, audit logs, notifications."""
from fastapi import APIRouter, Depends
from database import get_db
from auth import require_admin, get_current_user

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard")
async def dashboard(me: dict = Depends(require_admin())):
    db = get_db()
    return {
        "player_count": await db.users.count_documents({"is_active": True}),
        "team_count": await db.teams.count_documents({}),
        "active_tournaments": await db.tournaments.count_documents({"status": {"$in": ["live", "check_in"]}}),
        "registration_open": await db.tournaments.count_documents({"status": "registration_open"}),
        "today_matches": await db.matches.count_documents({"status": {"$in": ["ready", "in_progress"]}}),
        "open_disputes": await db.matches.count_documents({"status": "disputed"}),
        "active_f1": await db.f1_challenges.count_documents({"status": "live"}),
        "total_tournaments": await db.tournaments.count_documents({}),
        "total_f1_challenges": await db.f1_challenges.count_documents({}),
        "total_events": await db.events.count_documents({}),
        "recent_audit_logs": await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(20),
    }


@router.get("/audit-logs")
async def audit_logs(limit: int = 100, me: dict = Depends(require_admin())):
    db = get_db()
    logs = await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return logs


@router.get("/notifications")
async def my_notifications(me: dict = Depends(get_current_user)):
    db = get_db()
    notes = await db.notifications.find({"user_id": me["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return notes


@router.post("/notifications/{nid}/read")
async def mark_read(nid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_one({"id": nid, "user_id": me["id"]}, {"$set": {"read": True}})
    return {"ok": True}
