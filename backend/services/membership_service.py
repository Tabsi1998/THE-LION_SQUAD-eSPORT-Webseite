"""Helpers for the club-membership system.

A membership is *separate* from the user document — admins can promote / demote a
registered community user to an official club member without touching the auth
account. The membership doc is keyed by user_id.
"""
from datetime import datetime, timezone
from database import get_db
from models import new_id, now_utc

VALID_STATUSES = {
    "none", "pending", "active", "inactive", "honorary", "former", "blocked",
}
ACTIVE_STATUSES = {"active", "honorary"}
VALID_TYPES = {
    "ordinary", "supporting", "honorary", "youth", "guest", "former",
}


def is_active_member(membership: dict | None) -> bool:
    if not membership:
        return False
    return membership.get("member_status") in ACTIVE_STATUSES


def derived_user_type(user: dict, membership: dict | None) -> str:
    """guest / community_user / club_member."""
    if not user:
        return "guest"
    if is_active_member(membership):
        return "club_member"
    return "community_user"


async def get_membership(user_id: str) -> dict | None:
    db = get_db()
    return await db.memberships.find_one({"user_id": user_id}, {"_id": 0})


async def generate_member_number() -> str:
    """Generate a sequential member number: TLS-YYYY-NNNN."""
    db = get_db()
    year = datetime.now(timezone.utc).year
    prefix = f"TLS-{year}-"
    # find max existing number for this year
    cursor = db.memberships.find(
        {"member_number": {"$regex": f"^{prefix}"}},
        {"member_number": 1, "_id": 0},
    )
    max_n = 0
    async for doc in cursor:
        try:
            n = int(doc["member_number"].split("-")[-1])
            if n > max_n:
                max_n = n
        except (ValueError, IndexError):
            continue
    return f"{prefix}{max_n + 1:04d}"


async def upsert_membership(
    user_id: str,
    actor_id: str,
    *,
    member_status: str | None = None,
    membership_type: str | None = None,
    member_number: str | None = None,
    member_since: str | None = None,
    internal_role: str | None = None,
    notes: str | None = None,
    show_member_number_publicly: bool | None = None,
) -> dict:
    """Create or update a membership record. Auto-generates member_number when
    promoting to active for the first time."""
    db = get_db()
    existing = await get_membership(user_id)
    history_entry = {
        "actor_id": actor_id,
        "at": now_utc().isoformat(),
        "from_status": existing.get("member_status") if existing else None,
        "to_status": member_status if member_status is not None else (existing.get("member_status") if existing else None),
        "notes": notes,
    }
    update = {"updated_at": now_utc().isoformat(), "updated_by": actor_id}

    if member_status is not None:
        if member_status not in VALID_STATUSES:
            raise ValueError(f"Invalid member_status: {member_status}")
        update["member_status"] = member_status
        # When promoting to active for the first time -> stamp member_since + ensure member_number
        if member_status in ACTIVE_STATUSES:
            if not (existing or {}).get("member_since") and member_since is None:
                update["member_since"] = now_utc().isoformat()
            if not (existing or {}).get("member_number") and member_number is None:
                update["member_number"] = await generate_member_number()

    if membership_type is not None:
        if membership_type not in VALID_TYPES:
            raise ValueError(f"Invalid membership_type: {membership_type}")
        update["membership_type"] = membership_type
    if member_number is not None:
        update["member_number"] = member_number
    if member_since is not None:
        update["member_since"] = member_since
    if internal_role is not None:
        update["internal_role"] = internal_role
    if notes is not None:
        update["notes"] = notes
    if show_member_number_publicly is not None:
        update["show_member_number_publicly"] = show_member_number_publicly

    if existing:
        await db.memberships.update_one(
            {"user_id": user_id},
            {"$set": update, "$push": {"history": history_entry}},
        )
    else:
        doc = {
            "id": new_id(),
            "user_id": user_id,
            "member_status": "none",
            "membership_type": None,
            "member_number": None,
            "member_since": None,
            "internal_role": None,
            "notes": None,
            "show_member_number_publicly": False,
            "history": [history_entry],
            "created_at": now_utc().isoformat(),
            "created_by": actor_id,
            **update,
        }
        await db.memberships.insert_one(doc)

    # Update derived flag on the user doc for fast filtering
    fresh = await get_membership(user_id)
    user_type = "club_member" if is_active_member(fresh) else "community_user"
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "user_type": user_type,
            "is_club_member": is_active_member(fresh),
            "updated_at": now_utc().isoformat(),
        }},
    )
    return fresh


async def get_user_with_membership(user_id: str) -> dict | None:
    db = get_db()
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        return None
    user["membership"] = await get_membership(user_id)
    user["user_type"] = derived_user_type(user, user["membership"])
    return user
