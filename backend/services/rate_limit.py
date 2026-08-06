"""Small Mongo-backed rate limits for public or abuse-prone endpoints."""
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException, Request

from database import get_db
from models import new_id


def _format_wait(seconds: int) -> str:
    seconds = max(1, int(seconds))
    minutes, rest = divmod(seconds, 60)
    if minutes <= 0:
        return f"{rest} Sekunden"
    if rest <= 0:
        return f"{minutes} Minuten"
    return f"{minutes} Minuten {rest} Sekunden"


def get_client_ip(request: Request) -> str:
    """Return Uvicorn's validated peer/client IP, never raw forwarding headers."""
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
        oldest = await db.rate_limits.find_one(
            {"key": key, "created_at": {"$gte": cutoff}},
            sort=[("created_at", 1)],
        )
        oldest_at = oldest.get("created_at") if oldest else now
        if isinstance(oldest_at, str):
            try:
                oldest_at = datetime.fromisoformat(oldest_at.replace("Z", "+00:00"))
            except ValueError:
                oldest_at = now
        if oldest_at.tzinfo is None:
            oldest_at = oldest_at.replace(tzinfo=timezone.utc)
        retry_after = max(1, int((oldest_at + timedelta(seconds=window_seconds) - now).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail=f"Zu viele Anfragen. Bitte warte noch {_format_wait(retry_after)}.",
            headers={"Retry-After": str(retry_after)},
        )
    await db.rate_limits.insert_one({
        "id": new_id(),
        "key": key,
        "bucket": bucket,
        "subject": identity,
        "created_at": now,
    })
