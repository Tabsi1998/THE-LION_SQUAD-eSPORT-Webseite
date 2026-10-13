"""Short MongoDB-backed leases for cross-worker write serialization.

The API can run behind a reverse proxy with multiple workers, so an in-process
``asyncio.Lock`` cannot protect multi-document tournament mutations.  This
lease uses a unique MongoDB resource key, permits takeover after expiry, and
always releases only the token owned by the current operation.

Mehrprozessvertrag (#1040):

* Besitz: genau ein Datensatz je ``resource`` (eindeutiger Index), Halter ist
  das zufällige ``owner``-Token der Aktion. Übernehmen darf ein anderer Prozess
  nur, wenn ``expires_at`` nach seiner Uhr abgelaufen ist.
* Halten: solange die Aktion läuft, wird die Sperre im Takt ``lease/3``
  erneuert. Der Halter rechnet selbst mit, wann seine Sperre spätestens abläuft
  (ab dem Absenden der letzten bestätigten Erneuerung, monotone Uhr). Bleibt
  die Bestätigung aus - Datenbankfehler, hängende Anfrage - oder gehört die
  Sperre bei der Erneuerung einem anderen, gilt sie als verloren.
* Verlust: die Aktion wird mit Sicherheitsabstand *vor* dem Ablauf abgebrochen
  (der Task des Halters wird abgebrochen, ``async with`` endet mit
  ``MutationLockLost``). Danach schreibt der alte Halter nichts mehr, und ein
  anderer Prozess kann erst nach dem Ablauf übernehmen. ``MutationLockLost``
  erbt von ``MutationLockBusy``: bestehende Aufrufer antworten wie bei einer
  besetzten Sperre ("bitte erneut versuchen").
* Freigeben: nur das eigene Token wird gelöscht, nie eine fremde Sperre.

Annahmen: die Uhren der Prozesse weichen um deutlich weniger als den
Sicherheitsabstand (ein Viertel der Laufzeit, bei 30 s also 7,5 s) voneinander
ab, und eine einzelne Schreibanfrage dauert kürzer als dieser Abstand.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from time import monotonic
from uuid import uuid4

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("tls.mutation_lock")

# Anteil der Laufzeit, um den der Halter vor dem rechnerischen Ablauf aufhört.
LOSS_SAFETY_FRACTION = 0.25


class MutationLockBusy(RuntimeError):
    """Raised when another worker still owns the requested mutation lease."""


class MutationLockLost(MutationLockBusy):
    """Die Sperre ging während der Aktion verloren; die Aktion wurde abgebrochen."""


def tournament_write_resource(tournament_id: str) -> str:
    return f"tournament:{tournament_id}:write"


class _MutationLease:
    def __init__(self, db, resource: str, wait_seconds: float, lease_seconds: float, retry_seconds: float):
        self._db = db
        self._resource = resource
        self._wait_seconds = wait_seconds
        self._lease_seconds = lease_seconds
        self._retry_seconds = retry_seconds
        self._owner = str(uuid4())
        self._acquired = False
        self._lost: str | None = None
        self._closing = False
        self._cancel_requested = False
        self._task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._deadline_handle: asyncio.TimerHandle | None = None
        self._renewal_task: asyncio.Task | None = None

    async def __aenter__(self) -> str:
        resource = self._resource
        if not resource or not resource.strip():
            raise ValueError("resource must not be empty")
        if self._lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")

        self._loop = asyncio.get_running_loop()
        self._task = asyncio.current_task()
        deadline = monotonic() + max(0.0, self._wait_seconds)
        while True:
            sent_at = self._loop.time()
            now = datetime.now(timezone.utc)
            try:
                document = await self._db.mutation_locks.find_one_and_update(
                    {
                        "resource": resource,
                        "$or": [
                            {"expires_at": {"$lte": now}},
                            {"owner": self._owner},
                        ],
                    },
                    {
                        "$set": {
                            "resource": resource,
                            "owner": self._owner,
                            "acquired_at": now,
                            "expires_at": now + timedelta(seconds=self._lease_seconds),
                        }
                    },
                    upsert=True,
                    return_document=ReturnDocument.AFTER,
                )
                self._acquired = bool(document and document.get("owner") == self._owner)
            except DuplicateKeyError:
                self._acquired = False
            if self._acquired:
                break
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise MutationLockBusy(resource)
            await asyncio.sleep(min(max(0.001, self._retry_seconds), remaining))

        self._confirmed(sent_at)
        self._renewal_task = asyncio.create_task(self._renew())
        return self._owner

    def _confirmed(self, sent_at: float) -> None:
        """Die Datenbank hat die Sperre ab ``sent_at`` bestätigt: Abbruchzeitpunkt neu setzen."""
        if self._lost or self._closing:
            return
        if self._deadline_handle:
            self._deadline_handle.cancel()
        stop_at = sent_at + self._lease_seconds * (1 - LOSS_SAFETY_FRACTION)
        self._deadline_handle = self._loop.call_at(stop_at, self._lose, "die Erneuerung blieb aus")

    def _lose(self, reason: str) -> None:
        if self._lost or self._closing:
            return
        self._lost = reason
        if self._deadline_handle:
            self._deadline_handle.cancel()
        logger.error("Sperre %s verloren (%s) - die Aktion wird abgebrochen", self._resource, reason)
        if self._task is not None and not self._task.done():
            self._cancel_requested = True
            self._task.cancel(msg=f"mutation lease lost: {self._resource}")

    async def _renew(self) -> None:
        interval = max(0.01, self._lease_seconds / 3)
        delay = interval
        while not self._lost:
            await asyncio.sleep(delay)
            sent_at = self._loop.time()
            renewed_at = datetime.now(timezone.utc)
            try:
                result = await self._db.mutation_locks.update_one(
                    {"resource": self._resource, "owner": self._owner},
                    {"$set": {"expires_at": renewed_at + timedelta(seconds=self._lease_seconds)}},
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                # Ein kurzer Aussetzer beendet die Erneuerung nicht: bald wieder versuchen, mit wachsendem Abstand,
                # höchstens im normalen Takt. Kommt bis kurz vor dem Ablauf keine Bestätigung, bricht der Zeitgeber ab.
                logger.warning("Sperre %s konnte nicht erneuert werden - neuer Versuch", self._resource, exc_info=True)
                delay = interval / 4 if delay >= interval else min(interval, delay * 2)
                continue
            if getattr(result, "matched_count", 0) != 1:
                self._lose("bei der Erneuerung gehörte sie einem anderen")
                return
            self._confirmed(sent_at)
            delay = interval

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        self._closing = True
        if self._deadline_handle:
            self._deadline_handle.cancel()
        aborted = False
        if self._cancel_requested:
            # Wie asyncio.timeout: nur den eigenen Abbruch umdeuten, einen fremden (Shutdown, Client weg) durchlassen.
            uncancel = getattr(self._task, "uncancel", None)
            still_cancelled = uncancel() if uncancel else 0
            aborted = still_cancelled == 0 and (exc_type is None or issubclass(exc_type, asyncio.CancelledError))
        elif self._lost and exc_type is None:
            aborted = True

        if self._renewal_task:
            self._renewal_task.cancel()
            await asyncio.gather(self._renewal_task, return_exceptions=True)
        released = await self._db.mutation_locks.delete_one({"resource": self._resource, "owner": self._owner})
        if self._acquired and not self._lost and getattr(released, "deleted_count", None) == 0:
            logger.error("Sperre %s verloren (beim Freigeben gehörte sie nicht mehr dieser Aktion)", self._resource)

        if aborted:
            raise MutationLockLost(self._resource) from exc
        return False


def mutation_lock(
    db,
    resource: str,
    *,
    wait_seconds: float = 2.0,
    lease_seconds: float = 30.0,
    retry_seconds: float = 0.05,
) -> _MutationLease:
    """Acquire a renewable MongoDB lease for one mutation resource.

    Waiting briefly lets an immediate retry observe the first request's final
    state and return an idempotent response.  The lease itself is deliberately
    finite so a crashed worker cannot leave a permanent write lock behind; a
    holder that can no longer confirm its lease is stopped before it expires
    (see the module docstring for the multi-process contract).
    """
    return _MutationLease(db, resource, wait_seconds, lease_seconds, retry_seconds)
