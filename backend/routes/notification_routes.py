"""In-app notifications for the current web user (dashboard + bell)."""
from fastapi import APIRouter, Depends
from database import get_db
from auth import get_current_user
from models import now_utc

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/me")
async def my_notifications(me: dict = Depends(get_current_user)):
    db = get_db()
    return await db.notifications.find(
        {"user_id": me["id"], "in_app_visible": {"$ne": False}}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)


@router.get("/me/unread-count")
async def my_unread_count(me: dict = Depends(get_current_user)):
    db = get_db()
    count = await db.notifications.count_documents(
        {"user_id": me["id"], "read": {"$ne": True}, "in_app_visible": {"$ne": False}}
    )
    return {"count": count}


@router.post("/{nid}/read")
async def mark_read(nid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_one(
        {"id": nid, "user_id": me["id"], "in_app_visible": {"$ne": False}},
        {"$set": {"read": True, "read_at": now_utc().isoformat()}},
    )
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(me: dict = Depends(get_current_user)):
    db = get_db()
    await db.notifications.update_many(
        {"user_id": me["id"], "read": {"$ne": True}, "in_app_visible": {"$ne": False}},
        {"$set": {"read": True, "read_at": now_utc().isoformat()}},
    )
    return {"ok": True}


@router.delete("/read")
async def delete_read(me: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.notifications.delete_many(
        {"user_id": me["id"], "read": True, "in_app_visible": {"$ne": False}}
    )
    return {"ok": True, "deleted": result.deleted_count}


@router.delete("/{nid}")
async def delete_notification(nid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.notifications.delete_one(
        {"id": nid, "user_id": me["id"], "in_app_visible": {"$ne": False}}
    )
    return {"ok": True, "deleted": result.deleted_count}
