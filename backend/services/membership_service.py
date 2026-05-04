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
VALID_MEMBER_SINCE_PRECISIONS = {"year", "month", "day"}


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


def normalize_member_since(value: str, precision: str | None = None) -> tuple[str, str]:
    """Normalize admin-entered membership start to ISO date + display precision."""
    raw = (value or "").strip()
    if not raw:
        raise ValueError("member_since darf nicht leer sein.")

    inferred = "day"
    if len(raw) == 4 and raw.isdigit():
        inferred = "year"
    elif len(raw) == 7 and raw[4] == "-":
        inferred = "month"

    precision = precision or inferred
    if precision not in VALID_MEMBER_SINCE_PRECISIONS:
        raise ValueError(f"Invalid member_since_precision: {precision}")

    try:
        if precision == "year":
            year = int(raw[:4])
            dt = datetime(year, 1, 1, tzinfo=timezone.utc)
        elif precision == "month":
            year = int(raw[:4])
            month = int(raw[5:7])
            dt = datetime(year, month, 1, tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        raise ValueError("member_since muss als YYYY, YYYY-MM oder ISO-Datum angegeben werden.")

    now = datetime.now(timezone.utc)
    if dt.year < 1900 or dt > now:
        raise ValueError("member_since muss zwischen 1900 und heute liegen.")
    return dt.isoformat(), precision


async def upsert_membership(
    user_id: str,
    actor_id: str,
    *,
    member_status: str | None = None,
    membership_type: str | None = None,
    member_number: str | None = None,
    member_since: str | None = None,
    member_since_precision: str | None = None,
    internal_role: str | None = None,
    notes: str | None = None,
    show_member_number_publicly: bool | None = None,
) -> dict:
    """Create or update a membership record. Auto-generates member_number when
    promoting to active for the first time."""
    db = get_db()
    existing = await get_membership(user_id)
    update = {"updated_at": now_utc().isoformat(), "updated_by": actor_id}
    status_changed = (
        member_status is not None
        and existing
        and existing.get("member_status") != member_status
    ) or (member_status is not None and not existing)

    if member_status is not None:
        if member_status not in VALID_STATUSES:
            raise ValueError(f"Invalid member_status: {member_status}")
        update["member_status"] = member_status
        # When promoting to active for the first time -> stamp member_since + ensure member_number
        if member_status in ACTIVE_STATUSES:
            if not (existing or {}).get("member_since") and member_since is None:
                update["member_since"] = now_utc().isoformat()
                update["member_since_precision"] = "day"
            if not (existing or {}).get("member_number") and member_number is None:
                update["member_number"] = await generate_member_number()

    if membership_type is not None:
        if membership_type not in VALID_TYPES:
            raise ValueError(f"Invalid membership_type: {membership_type}")
        update["membership_type"] = membership_type
    if member_number is not None:
        update["member_number"] = member_number
    if member_since is not None:
        normalized_since, normalized_precision = normalize_member_since(member_since, member_since_precision)
        update["member_since"] = normalized_since
        update["member_since_precision"] = normalized_precision
    elif member_since_precision is not None:
        if member_since_precision not in VALID_MEMBER_SINCE_PRECISIONS:
            raise ValueError(f"Invalid member_since_precision: {member_since_precision}")
        update["member_since_precision"] = member_since_precision
    if internal_role is not None:
        update["internal_role"] = internal_role
    if notes is not None:
        update["notes"] = notes
    if show_member_number_publicly is not None:
        update["show_member_number_publicly"] = show_member_number_publicly

    if existing:
        ops: dict = {"$set": update}
        if status_changed:
            ops["$push"] = {"history": {
                "actor_id": actor_id,
                "at": now_utc().isoformat(),
                "from_status": existing.get("member_status"),
                "to_status": member_status,
                "notes": notes,
            }}
        await db.memberships.update_one({"user_id": user_id}, ops)
    else:
        history = []
        if member_status is not None:
            history.append({
                "actor_id": actor_id,
                "at": now_utc().isoformat(),
                "from_status": None,
                "to_status": member_status,
                "notes": notes,
            })
        doc = {
            "id": new_id(),
            "user_id": user_id,
            "member_status": "none",
            "membership_type": None,
            "member_number": None,
            "member_since": None,
            "member_since_precision": None,
            "internal_role": None,
            "notes": None,
            "show_member_number_publicly": False,
            "history": history,
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
