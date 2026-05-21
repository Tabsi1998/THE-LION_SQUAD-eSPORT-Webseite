"""Special access links for invite-only or restricted content."""
import hashlib
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

from models import now_utc

TARGET_TYPES = {"event", "tournament", "fastlap"}
ACCESS_GRANTS = {"view", "register", "submit"}


def new_access_token() -> str:
    return secrets.token_urlsafe(32)


def hash_access_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()


def parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def public_access_link_payload(link: dict | None) -> dict | None:
    if not link:
        return None
    return {
        "id": link.get("id"),
        "target_type": link.get("target_type"),
        "target_id": link.get("target_id"),
        "grants": link.get("grants") or [],
        "expires_at": link.get("expires_at"),
        "max_uses": link.get("max_uses"),
        "use_count": int(link.get("use_count") or 0),
        "note": link.get("note"),
    }


def access_path(target_type: str, target: dict, token: str) -> str:
    slug = target.get("slug") or target.get("id") or target.get("target_id")
    path = {
        "event": f"/events/{slug}",
        "tournament": f"/tournaments/{slug}",
        "fastlap": f"/fastlap/{slug}",
    }.get(target_type)
    if not path:
        raise ValueError("Unsupported access link target type")
    return f"{path}?{urlencode({'access': token})}"


async def validate_access_link(
    db,
    token: str | None,
    target_type: str,
    target_id: str,
    user: dict | None = None,
    grant: str = "view",
) -> dict | None:
    raw = str(token or "").strip()
    if not raw or target_type not in TARGET_TYPES or grant not in ACCESS_GRANTS:
        return None
    link = await db.access_links.find_one(
        {
            "token_hash": hash_access_token(raw),
            "target_type": target_type,
            "target_id": target_id,
            "is_active": {"$ne": False},
        },
        {"_id": 0},
    )
    if not link:
        return None
    grants = set(link.get("grants") or [])
    if grant not in grants and "*" not in grants:
        return None
    expires_at = parse_dt(link.get("expires_at"))
    if expires_at and now_utc() > expires_at:
        return None
    max_uses = link.get("max_uses")
    if max_uses is not None and int(link.get("use_count") or 0) >= int(max_uses):
        return None
    user_id = link.get("user_id")
    if user_id and (not user or user.get("id") != user_id):
        return None
    email = (link.get("email") or "").strip().lower()
    if email and (not user or str(user.get("email") or "").strip().lower() != email):
        return None
    return link


async def record_access_link_use(db, link: dict | None, user: dict | None = None) -> None:
    if not link or not link.get("id"):
        return
    await db.access_links.update_one(
        {"id": link["id"]},
        {
            "$inc": {"use_count": 1},
            "$set": {
                "last_used_at": now_utc().isoformat(),
                "last_used_by": (user or {}).get("id"),
            },
        },
    )
