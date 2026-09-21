"""User safety controls: blocking and a reviewable moderation queue."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Literal

from auth import get_current_user, require_role, require_area
from database import get_db
from models import new_id, now_utc
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/moderation", tags=["moderation"])

ReportCategory = Literal["harassment", "spam", "hate", "impersonation", "privacy", "cheating", "other"]
ReportStatus = Literal["open", "reviewing", "resolved", "dismissed"]


class UserReportCreate(BaseModel):
    target_user_id: str
    category: ReportCategory
    details: str = Field(min_length=5, max_length=2000)
    message_id: str | None = None


class UserReportPatch(BaseModel):
    status: ReportStatus
    resolution_note: str | None = Field(default=None, max_length=2000)


@router.get("/blocks")
async def list_blocks(me: dict = Depends(get_current_user)):
    db = get_db()
    rows = await db.user_blocks.find({"blocker_id": me["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    ids = [row.get("blocked_id") for row in rows if row.get("blocked_id")]
    users = {row["id"]: row for row in await db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(500)}
    return [{**row, "user": users.get(row.get("blocked_id"))} for row in rows]


@router.post("/blocks/{user_id}")
async def block_user(user_id: str, request: Request, me: dict = Depends(get_current_user)):
    if user_id == me["id"]:
        raise HTTPException(400, "Du kannst dich nicht selbst blockieren.")
    await enforce_rate_limit(request, "moderation:block:user", limit=30, window_seconds=3600, subject=me["id"])
    db = get_db()
    target = await db.users.find_one({"id": user_id, "is_active": True}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(404, "Benutzer nicht gefunden")
    now = now_utc().isoformat()
    await db.user_blocks.update_one(
        {"blocker_id": me["id"], "blocked_id": user_id},
        {"$set": {"updated_at": now}, "$setOnInsert": {"id": new_id(), "blocker_id": me["id"], "blocked_id": user_id, "created_at": now}},
        upsert=True,
    )
    pair_key = ":".join(sorted((me["id"], user_id)))
    await db.friendships.update_one(
        {"pair_key": pair_key, "status": {"$in": ["pending", "accepted"]}},
        {"$set": {"status": "removed", "acted_at": now, "updated_at": now}},
    )
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.thread_user_id": user_id, "read": {"$ne": True}},
        {"$set": {"read": True}},
    )
    return {"ok": True}


@router.delete("/blocks/{user_id}")
async def unblock_user(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await db.user_blocks.delete_one({"blocker_id": me["id"], "blocked_id": user_id})
    return {"ok": True}


@router.post("/reports")
async def report_user(body: UserReportCreate, request: Request, me: dict = Depends(get_current_user)):
    if body.target_user_id == me["id"]:
        raise HTTPException(400, "Du kannst dich nicht selbst melden.")
    await enforce_rate_limit(request, "moderation:report:user", limit=8, window_seconds=86400, subject=me["id"])
    db = get_db()
    if not await db.users.find_one({"id": body.target_user_id}, {"_id": 1}):
        raise HTTPException(404, "Benutzer nicht gefunden")
    if body.message_id and not await db.direct_messages.find_one({
        "id": body.message_id,
        "$or": [
            {"sender_id": me["id"], "recipient_id": body.target_user_id},
            {"sender_id": body.target_user_id, "recipient_id": me["id"]},
        ],
    }, {"_id": 1}):
        raise HTTPException(400, "Die gemeldete Nachricht gehört nicht zu diesem Gespräch.")
    now = now_utc().isoformat()
    doc = {
        "id": new_id(), "reporter_id": me["id"], "target_user_id": body.target_user_id,
        "category": body.category, "details": body.details.strip(), "message_id": body.message_id,
        "status": "open", "created_at": now, "updated_at": now,
    }
    await db.user_reports.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "report": doc}


@router.get("/reports")
async def list_reports(status: ReportStatus | None = None, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    query = {"status": status} if status else {}
    return await db.user_reports.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.patch("/reports/{report_id}")
async def review_report(report_id: str, body: UserReportPatch, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    now = now_utc().isoformat()
    result = await db.user_reports.update_one({"id": report_id}, {"$set": {
        "status": body.status, "resolution_note": (body.resolution_note or "").strip() or None,
        "reviewed_by": me["id"], "reviewed_at": now, "updated_at": now,
    }})
    if result.matched_count == 0:
        raise HTTPException(404, "Meldung nicht gefunden")
    return {"ok": True}
