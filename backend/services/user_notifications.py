"""Small helpers for in-app user notifications."""
from typing import Any

from database import get_db
from models import new_id, now_utc


async def create_user_notification(
    user_id: str | None,
    title: str,
    body: str = "",
    url: str = "",
    kind: str = "general",
    meta: dict[str, Any] | None = None,
) -> dict | None:
    if not user_id:
        return None
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "kind": kind,
        "title": title,
        "body": body,
        "url": url,
        "read": False,
        "meta": meta or {},
        "created_at": now_utc().isoformat(),
    }
    await get_db().notifications.insert_one(doc)
    doc.pop("_id", None)
    return doc
