def friend_pair_key(user_a: str, user_b: str) -> str:
    return ":".join(sorted([str(user_a), str(user_b)]))


async def are_friends(db, user_a: str, user_b: str) -> bool:
    if not user_a or not user_b or user_a == user_b:
        return False
    return bool(await db.friendships.find_one(
        {"pair_key": friend_pair_key(user_a, user_b), "status": "accepted"},
        {"_id": 0, "id": 1},
    ))


def relationship_for(friendship: dict | None, viewer_id: str, other_id: str) -> dict:
    if not friendship:
        return {"status": "none", "can_request": viewer_id != other_id}
    status = friendship.get("status") or "none"
    requester_id = friendship.get("requester_id")
    recipient_id = friendship.get("recipient_id")
    incoming = status == "pending" and recipient_id == viewer_id
    outgoing = status == "pending" and requester_id == viewer_id
    return {
        "id": friendship.get("id"),
        "status": status,
        "incoming": incoming,
        "outgoing": outgoing,
        "can_request": status in {"declined", "cancelled", "removed"} and viewer_id != other_id,
        "requester_id": requester_id,
        "recipient_id": recipient_id,
        "created_at": friendship.get("created_at"),
        "updated_at": friendship.get("updated_at"),
    }


async def relationship_status(db, viewer_id: str | None, other_id: str | None) -> dict:
    if not viewer_id or not other_id:
        return {"status": "anonymous", "can_request": False}
    if viewer_id == other_id:
        return {"status": "self", "can_request": False}
    friendship = await db.friendships.find_one(
        {"pair_key": friend_pair_key(viewer_id, other_id)},
        {"_id": 0},
    )
    return relationship_for(friendship, viewer_id, other_id)
