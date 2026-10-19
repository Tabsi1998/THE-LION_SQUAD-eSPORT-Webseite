"""Small Mongo-backed rate limits for public or abuse-prone endpoints."""
import hashlib
import hmac
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException, Request
from pymongo import ReturnDocument

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


def keyed_subject(value: str) -> str:
    """Eine Konto-Kennung für den Zählerschlüssel - nur als Schlüssel-Hash gespeichert (#1032).

    HMAC mit dem Server-Geheimnis: der Zähler nennt das Konto nicht, und ohne das Geheimnis lässt er sich keinem
    Konto zuordnen.
    """
    from auth import get_jwt_secret

    return hmac.new(get_jwt_secret().encode("utf-8"), str(value).encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def get_client_ip(request: Request) -> str:
    """Return Uvicorn's validated peer/client IP, never raw forwarding headers."""
    return (request.client.host if request.client else "unknown")[:120]


async def enforce_rate_limit(
    request: Request,
    bucket: str,
    limit: int,
    window_seconds: int,
    subject: str | None = None,
    message: str | None = None,
) -> str:
    """Raise 429 if the bucket+subject exceeds limit inside the time window.

    Returns the counter document id; ``release_rate_limit`` hands the counted request back (e.g. a successful try).
    ``message`` ersetzt den allgemeinen Hinweis; ``{wait}`` darin wird durch die Wartezeit ersetzt (#1802).
    """
    db = get_db()
    identity = subject or get_client_ip(request)
    key = f"{bucket}:{identity}"
    now = datetime.now(timezone.utc)
    window_number = int(now.timestamp()) // window_seconds
    window_start = datetime.fromtimestamp(window_number * window_seconds, tz=timezone.utc)
    expires_at = window_start + timedelta(seconds=window_seconds * 2)
    document_id = f"{key}:{window_number}"
    row = await db.rate_limits.find_one_and_update(
        {"_id": document_id},
        {
            "$inc": {"count": 1},
            "$setOnInsert": {
                "id": new_id(),
                "key": key,
                "bucket": bucket,
                "subject": identity,
                "window_started_at": window_start,
                "created_at": now,
                "expires_at": expires_at,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if int((row or {}).get("count") or 0) > limit:
        retry_after = max(1, int((window_start + timedelta(seconds=window_seconds) - now).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail=(message or "Zu viele Anfragen. Bitte warte noch {wait}.").replace("{wait}", _format_wait(retry_after)),
            headers={"Retry-After": str(retry_after)},
        )
    return document_id


async def release_rate_limit(document_id: str) -> None:
    """Give one counted request back - for limits that should only count failures."""
    await get_db().rate_limits.update_one({"_id": document_id, "count": {"$gt": 0}}, {"$inc": {"count": -1}})
