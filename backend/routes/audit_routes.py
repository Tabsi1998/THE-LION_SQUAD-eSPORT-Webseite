"""Audit log access for administrators."""

from fastapi import APIRouter, Depends
from typing import Optional

from database import get_db
from auth import require_club_admin
from services.query_filters import safe_regex

audit_router = APIRouter(prefix="/api/audit", tags=["audit"])


@audit_router.get("")
async def list_audit(action: Optional[str] = None, limit: int = 200, me: dict = Depends(require_club_admin())):
    db = get_db()
    q = {}
    if action:
        q["action"] = {"$regex": safe_regex(action)}
    safe_limit = max(1, min(int(limit or 200), 500))
    logs = await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(safe_limit)
    # Enrich actor
    ids = list({l.get("actor_id") for l in logs if l.get("actor_id")})
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": ids}},
                                                      {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0, "mfa_totp_last_counter": 0}).to_list(500)}
    for l in logs:
        if l.get("actor_id"):
            u = users.get(l["actor_id"], {})
            l["actor_username"] = u.get("username")
            l["actor_display_name"] = u.get("display_name")
    return logs
