"""Small Mongo-backed rate limits for public or abuse-prone endpoints."""
import os
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException, Request

from database import get_db
from models import new_id


def _truthy_env(name: str, default: str = "false") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


def get_client_ip(request: Request) -> str:
    """Return the best client IP known to the app.

    The production compose setup binds backend ports to localhost and routes API
    traffic through nginx, so trusting proxy headers is appropriate there. If the
    backend is ever exposed directly, set TRUST_PROXY_HEADERS=false.
    """
    if _truthy_env("TRUST_PROXY_HEADERS", "true"):
        xff = request.headers.get("x-forwarded-for", "")
        first = xff.split(",", 1)[0].strip() if xff else ""
        if first:
            return first[:120]
        real_ip = request.headers.get("x-real-ip", "").strip()
        if real_ip:
            return real_ip[:120]
    return (request.client.host if request.client else "unknown")[:120]


async def enforce_rate_limit(
    request: Request,
    bucket: str,
    limit: int,
    window_seconds: int,
    subject: str | None = None,
):
    """Raise 429 if the bucket+subject exceeds limit inside the time window."""
    db = get_db()
    identity = subject or get_client_ip(request)
    key = f"{bucket}:{identity}"
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=window_seconds)
    count = await db.rate_limits.count_documents({
        "key": key,
        "created_at": {"$gte": cutoff},
    })
    if count >= limit:
        raise HTTPException(
            status_code=429,
            detail="Zu viele Anfragen. Bitte versuche es später erneut.",
        )
    await db.rate_limits.insert_one({
        "id": new_id(),
        "key": key,
        "bucket": bucket,
        "subject": identity,
        "created_at": now,
    })
