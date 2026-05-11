"""Friendship routes for account-to-account connections."""
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services.friend_service import friend_pair_key, relationship_status
from services.user_notifications import create_user_notification

router = APIRouter(prefix="/api/friends", tags=["friends"])


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
    }


async def _active_user_or_404(db, user_id: str) -> dict:
    user = await db.users.find_one(
        {"id": user_id, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1},
    )
    if not user:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    return user


async def _hydrate(rows: list[dict], me_id: str) -> list[dict]:
    db = get_db()
    user_ids = list({row.get("requester_id") for row in rows} | {row.get("recipient_id") for row in rows})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1},
    ).to_list(500)}
    out = []
    for row in rows:
        other_id = row.get("recipient_id") if row.get("requester_id") == me_id else row.get("requester_id")
        item = dict(row)
        item.pop("_id", None)
        item["user"] = _public_user(users.get(other_id))
        item["incoming"] = row.get("status") == "pending" and row.get("recipient_id") == me_id
        item["outgoing"] = row.get("status") == "pending" and row.get("requester_id") == me_id
        out.append(item)
    return out


@router.get("")
async def list_friends(me: dict = Depends(get_current_user)):
    db = get_db()
    rows = await db.friendships.find(
        {"$or": [{"requester_id": me["id"]}, {"recipient_id": me["id"]}]},
        {"_id": 0},
    ).sort("updated_at", -1).to_list(500)
    hydrated = await _hydrate(rows, me["id"])
    return {
        "friends": [row for row in hydrated if row.get("status") == "accepted"],
        "incoming": [row for row in hydrated if row.get("status") == "pending" and row.get("incoming")],
        "outgoing": [row for row in hydrated if row.get("status") == "pending" and row.get("outgoing")],
        "history": hydrated,
    }


@router.get("/status/{user_id}")
async def get_friend_status(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await _active_user_or_404(db, user_id)
    return await relationship_status(db, me["id"], user_id)


@router.post("/{user_id}/request")
async def request_friend(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    recipient = await _active_user_or_404(db, user_id)
    if recipient["id"] == me["id"]:
        raise HTTPException(status_code=400, detail="Du kannst dich nicht selbst als Freund hinzufügen")
    pair_key = friend_pair_key(me["id"], recipient["id"])
    existing = await db.friendships.find_one({"pair_key": pair_key}, {"_id": 0})
    if existing and existing.get("status") == "accepted":
        return await relationship_status(db, me["id"], recipient["id"])
    if existing and existing.get("status") == "pending":
        return await relationship_status(db, me["id"], recipient["id"])

    now = now_utc().isoformat()
    doc = {
        "id": existing.get("id") if existing else new_id(),
        "pair_key": pair_key,
        "requester_id": me["id"],
        "recipient_id": recipient["id"],
        "status": "pending",
        "created_at": existing.get("created_at") if existing else now,
        "updated_at": now,
    }
    await db.friendships.update_one({"pair_key": pair_key}, {"$set": doc}, upsert=True)
    await create_user_notification(
        recipient["id"],
        title=f"Freundschaftsanfrage von {_label(me)}",
        body=f"{_label(me)} möchte dich als Freund hinzufügen.",
        url="/profile?tab=friends",
        kind="friend_request",
        meta={"friendship_id": doc["id"], "requester_id": me["id"]},
    )
    return await relationship_status(db, me["id"], recipient["id"])


@router.post("/{friendship_id}/accept")
async def accept_friend(friendship_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    row = await db.friendships.find_one({"id": friendship_id, "recipient_id": me["id"], "status": "pending"}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Freundschaftsanfrage nicht gefunden")
    now = now_utc().isoformat()
    await db.friendships.update_one(
        {"id": friendship_id},
        {"$set": {"status": "accepted", "acted_at": now, "updated_at": now}},
    )
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.friendship_id": friendship_id},
        {"$set": {"read": True}},
    )
    await create_user_notification(
        row["requester_id"],
        title=f"{_label(me)} hat deine Anfrage angenommen",
        body="Ihr seid jetzt Freunde.",
        url="/profile?tab=friends",
        kind="friend_accept",
        meta={"friendship_id": friendship_id, "user_id": me["id"]},
    )
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(me["id"])
        await evaluate_user_progress(row["requester_id"])
    except Exception:
        pass
    return {"ok": True}


@router.post("/{friendship_id}/decline")
async def decline_friend(friendship_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    row = await db.friendships.find_one({"id": friendship_id, "recipient_id": me["id"], "status": "pending"}, {"_id": 0})
    if not row:
        raise HTTPException(status_code=404, detail="Freundschaftsanfrage nicht gefunden")
    now = now_utc().isoformat()
    await db.friendships.update_one(
        {"id": friendship_id},
        {"$set": {"status": "declined", "acted_at": now, "updated_at": now}},
    )
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.friendship_id": friendship_id},
        {"$set": {"read": True}},
    )
    return {"ok": True}


@router.delete("/{user_id}")
async def remove_or_cancel_friend(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await _active_user_or_404(db, user_id)
    pair_key = friend_pair_key(me["id"], user_id)
    row = await db.friendships.find_one({"pair_key": pair_key}, {"_id": 0})
    if not row:
        return {"ok": True}
    if row.get("status") == "pending" and row.get("requester_id") != me["id"] and row.get("recipient_id") != me["id"]:
        raise HTTPException(status_code=403, detail="Keine Berechtigung")
    now = now_utc().isoformat()
    status = "cancelled" if row.get("status") == "pending" else "removed"
    await db.friendships.update_one(
        {"pair_key": pair_key},
        {"$set": {"status": status, "acted_at": now, "updated_at": now}},
    )
    return {"ok": True}
