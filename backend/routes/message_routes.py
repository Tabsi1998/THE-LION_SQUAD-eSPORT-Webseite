"""Direct user-to-user messaging routes."""
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services.friend_service import are_friends
from services.notification_preferences import send_user_template
from services.rate_limit import enforce_rate_limit
from services.user_notifications import build_public_url, create_user_notification

router = APIRouter(prefix="/api/messages", tags=["messages"])

STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
DM_PRIVACY_LABELS = {
    "everyone": "Alle eingeloggten Benutzer",
    "friends": "Nur Freunde",
    "team_members": "Nur gemeinsame Teammitglieder",
    "club_members": "Nur Vereinsmitglieder",
    "admins_only": "Nur Admins",
    "none": "Keine Direktnachrichten",
}


class DirectMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=1500)


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


def _label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


def _public_user(user: dict | None) -> dict | None:
    if not user:
        return None
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "display_name": user.get("display_name"),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role"),
        "is_club_member": bool(user.get("is_club_member")),
        "dm_privacy": user.get("dm_privacy") or "everyone",
    }


def _public_message(message: dict, users: dict[str, dict] | None = None) -> dict:
    users = users or {}
    sender = users.get(message.get("sender_id"))
    recipient = users.get(message.get("recipient_id"))
    out = dict(message)
    out.pop("_id", None)
    out["sender"] = _public_user(sender) if sender else None
    out["recipient"] = _public_user(recipient) if recipient else None
    return out


async def _share_team(db, sender_id: str, recipient_id: str) -> bool:
    sender_team_ids = [
        row["team_id"] for row in await db.team_members.find(
            {"user_id": sender_id}, {"_id": 0, "team_id": 1}
        ).to_list(200)
        if row.get("team_id")
    ]
    if not sender_team_ids:
        team_docs = await db.teams.find(
            {"member_ids": sender_id}, {"_id": 0, "id": 1}
        ).to_list(200)
        sender_team_ids = [team["id"] for team in team_docs if team.get("id")]
    if not sender_team_ids:
        return False
    if await db.team_members.count_documents({
        "user_id": recipient_id,
        "team_id": {"$in": sender_team_ids},
    }):
        return True
    return bool(await db.teams.count_documents({
        "id": {"$in": sender_team_ids},
        "member_ids": recipient_id,
    }))


async def _message_permission(db, sender: dict, recipient: dict) -> tuple[bool, str]:
    if sender["id"] == recipient["id"]:
        return False, "Du kannst dir selbst keine Direktnachricht senden."
    if _is_staff(sender):
        return True, ""
    privacy = recipient.get("dm_privacy") or "everyone"
    if privacy == "everyone":
        return True, ""
    if privacy == "friends":
        if await are_friends(db, sender["id"], recipient["id"]):
            return True, ""
        return False, "Dieser Benutzer nimmt Direktnachrichten nur von Freunden an."
    if privacy == "team_members":
        if await _share_team(db, sender["id"], recipient["id"]):
            return True, ""
        return False, "Dieser Benutzer nimmt Direktnachrichten nur von gemeinsamen Teammitgliedern an."
    if privacy == "club_members":
        if sender.get("is_club_member"):
            return True, ""
        return False, "Dieser Benutzer nimmt Direktnachrichten nur von Vereinsmitgliedern an."
    if privacy == "admins_only":
        return False, "Dieser Benutzer nimmt Direktnachrichten nur von Admins an."
    if privacy == "none":
        return False, "Dieser Benutzer nimmt aktuell keine Direktnachrichten an."
    return False, "Direktnachrichten sind für diesen Benutzer nicht verfügbar."


async def _get_active_user(db, user_id: str) -> dict:
    user = await db.users.find_one(
        {"id": user_id, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "password_hash": 0},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
    user["is_club_member"] = bool(membership and membership.get("member_status") in ("active", "honorary"))
    return user


@router.get("/users")
async def search_message_users(q: str | None = None, me: dict = Depends(get_current_user)):
    db = get_db()
    needle = (q or "").strip()
    if len(needle) < 2:
        return []
    pattern = re.escape(needle)
    users = await db.users.find(
        {
            "id": {"$ne": me["id"]},
            "is_active": True,
            "is_banned": {"$ne": True},
            "$or": [
                {"username": {"$regex": pattern, "$options": "i"}},
                {"display_name": {"$regex": pattern, "$options": "i"}},
            ],
        },
        {"_id": 0, "password_hash": 0, "email": 0},
    ).sort("display_name", 1).to_list(25)
    for user in users:
        membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
        user["is_club_member"] = bool(membership and membership.get("member_status") in ("active", "honorary"))
        can_send, hint = await _message_permission(db, me, user)
        user["can_message"] = can_send
        user["message_hint"] = hint
        user["dm_privacy_label"] = DM_PRIVACY_LABELS.get(user.get("dm_privacy") or "everyone")
    return [_public_user(user) | {
        "can_message": user["can_message"],
        "message_hint": user["message_hint"],
        "dm_privacy_label": user["dm_privacy_label"],
    } for user in users]


@router.get("/conversations")
async def list_conversations(me: dict = Depends(get_current_user)):
    db = get_db()
    rows = await db.direct_messages.find(
        {"$or": [{"sender_id": me["id"]}, {"recipient_id": me["id"]}]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(600)
    threads: dict[str, dict] = {}
    for row in rows:
        other_id = row["recipient_id"] if row.get("sender_id") == me["id"] else row.get("sender_id")
        if not other_id:
            continue
        if other_id not in threads:
            threads[other_id] = {"user_id": other_id, "latest_message": row, "unread_count": 0}
        if row.get("recipient_id") == me["id"] and not row.get("read_at"):
            threads[other_id]["unread_count"] += 1
    user_ids = list(threads)
    users = {me["id"]: me}
    users.update({u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1, "dm_privacy": 1},
    ).to_list(500)})
    result = []
    for thread in threads.values():
        other = users.get(thread["user_id"])
        if not other:
            continue
        can_send, hint = await _message_permission(db, me, other)
        result.append({
            "user": _public_user(other),
            "latest_message": _public_message(thread["latest_message"], users),
            "unread_count": thread["unread_count"],
            "can_send": can_send,
            "message_hint": hint,
        })
    return result


@router.get("/direct/{user_id}")
async def get_direct_thread(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    other = await _get_active_user(db, user_id)
    can_send, hint = await _message_permission(db, me, other)
    rows = await db.direct_messages.find(
        {
            "$or": [
                {"sender_id": me["id"], "recipient_id": other["id"]},
                {"sender_id": other["id"], "recipient_id": me["id"]},
            ]
        },
        {"_id": 0},
    ).sort("created_at", 1).to_list(250)
    now = now_utc().isoformat()
    await db.direct_messages.update_many(
        {"sender_id": other["id"], "recipient_id": me["id"], "read_at": {"$exists": False}},
        {"$set": {"read_at": now}},
    )
    await db.notifications.update_many(
        {"user_id": me["id"], "kind": "direct_message", "meta.thread_user_id": other["id"], "read": {"$ne": True}},
        {"$set": {"read": True}},
    )
    users = {me["id"]: me, other["id"]: other}
    return {
        "user": _public_user(other),
        "can_send": can_send,
        "message_hint": hint,
        "messages": [_public_message(row, users) for row in rows],
    }


@router.post("/direct/{user_id}")
async def send_direct_message(user_id: str, body: DirectMessageCreate, request: Request, me: dict = Depends(get_current_user)):
    db = get_db()
    await enforce_rate_limit(request, "messages:direct:user", limit=60, window_seconds=3600, subject=me["id"])
    recipient = await _get_active_user(db, user_id)
    can_send, hint = await _message_permission(db, me, recipient)
    if not can_send:
        raise HTTPException(status_code=403, detail=hint or "Direktnachricht nicht erlaubt")
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nachricht darf nicht leer sein")
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "sender_id": me["id"],
        "recipient_id": recipient["id"],
        "message": text,
        "created_at": now,
        "updated_at": now,
    }
    await db.direct_messages.insert_one(doc)
    await create_user_notification(
        recipient["id"],
        title=f"Neue Nachricht von {_label(me)}",
        body=text[:160],
        url="/profile?tab=inbox",
        kind="direct_message",
        meta={"message_id": doc["id"], "thread_user_id": me["id"]},
    )
    await send_user_template(
        recipient,
        "direct_message",
        display_name=_label(recipient),
        sender_name=_label(me),
        preview=text[:300],
        url=await build_public_url("/profile?tab=inbox"),
        preferences_url=await build_public_url("/profile?tab=privacy"),
        dedupe_key=f"direct_message:{doc['id']}:{recipient['id']}",
        mail_meta={
            "kind": "direct_message",
            "message_id": doc["id"],
            "sender_id": me["id"],
            "recipient_id": recipient["id"],
        },
    )
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(me["id"])
    except Exception:
        pass
    doc.pop("_id", None)
    return _public_message(doc, {me["id"]: me, recipient["id"]: recipient})
