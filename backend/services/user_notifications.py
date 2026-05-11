"""Small helpers for in-app user notifications."""
import os
from typing import Any

from database import get_db
from models import new_id, now_utc


async def build_public_url(path: str = "") -> str:
    """Build an absolute frontend URL for notification mails."""
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    base = (os.environ.get("FRONTEND_URL") or branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    base = base or "https://lionsquad.at"
    raw = str(path or "").strip()
    if raw.startswith(("http://", "https://")):
        return raw
    return f"{base}/{raw.lstrip('/')}" if raw else base


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
