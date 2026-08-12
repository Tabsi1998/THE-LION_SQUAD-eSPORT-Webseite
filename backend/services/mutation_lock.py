"""Short MongoDB-backed leases for cross-worker write serialization.

The API can run behind a reverse proxy with multiple workers, so an in-process
``asyncio.Lock`` cannot protect multi-document tournament mutations.  This
lease uses a unique MongoDB resource key, permits takeover after expiry, and
always releases only the token owned by the current operation.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import uuid4

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


class MutationLockBusy(RuntimeError):
    """Raised when another worker still owns the requested mutation lease."""


def tournament_write_resource(tournament_id: str) -> str:
    return f"tournament:{tournament_id}:write"


@asynccontextmanager
async def mutation_lock(
    db,
    resource: str,
    *,
    wait_seconds: float = 2.0,
    lease_seconds: float = 30.0,
    retry_seconds: float = 0.05,
):
    """Acquire a renewable-by-expiry MongoDB lease for one mutation resource.

    Waiting briefly lets an immediate retry observe the first request's final
    state and return an idempotent response.  The lease itself is deliberately
    finite so a crashed worker cannot leave a permanent write lock behind.
    """
    if not resource or not resource.strip():
        raise ValueError("resource must not be empty")
    if lease_seconds <= 0:
        raise ValueError("lease_seconds must be positive")

    owner = str(uuid4())
    deadline = monotonic() + max(0.0, wait_seconds)
    acquired = False
    renewal_task = None

    while not acquired:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=lease_seconds)
        try:
            document = await db.mutation_locks.find_one_and_update(
                {
                    "resource": resource,
                    "$or": [
                        {"expires_at": {"$lte": now}},
                        {"owner": owner},
                    ],
                },
                {
                    "$set": {
                        "resource": resource,
                        "owner": owner,
                        "acquired_at": now,
                        "expires_at": expires_at,
                    }
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            acquired = bool(document and document.get("owner") == owner)
        except DuplicateKeyError:
            acquired = False

        if acquired:
            break
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise MutationLockBusy(resource)
        await asyncio.sleep(min(max(0.001, retry_seconds), remaining))

    try:
        async def renew_lease():
            interval = max(0.01, lease_seconds / 3)
            while True:
                await asyncio.sleep(interval)
                renewed_at = datetime.now(timezone.utc)
                result = await db.mutation_locks.update_one(
                    {"resource": resource, "owner": owner},
                    {"$set": {"expires_at": renewed_at + timedelta(seconds=lease_seconds)}},
                )
                if getattr(result, "matched_count", 0) != 1:
                    return

        renewal_task = asyncio.create_task(renew_lease())
        yield owner
    finally:
        if renewal_task:
            renewal_task.cancel()
            await asyncio.gather(renewal_task, return_exceptions=True)
        await db.mutation_locks.delete_one({"resource": resource, "owner": owner})
