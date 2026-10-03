"""Kleine Spuren für Erfolge aus Katalog D (#615), die es vorher nicht gab.

- **Papierkram:** das erste Öffnen eines Vereinsdokuments je Person (``document_opens``, eindeutig je Person und
  Dokument) - jedes Dokument zählt einmal, egal wie oft man es öffnet.
- **Sprinter:** der Moment, in dem das Profil vollständig wurde (``users.profile_completed_at``), einmal gesetzt und
  nie wieder überschrieben.

Beide stoßen danach die Auswertung der Erfolge dieser Person an.
"""
from __future__ import annotations

import logging

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc

logger = logging.getLogger("tls.member_activity")


async def note_document_open(db, user: dict | None, doc_id: str) -> bool:
    """Das erste Öffnen eines Dokuments merken - True, wenn es neu war. Ohne Anmeldung nichts."""
    if not user or not user.get("id") or not doc_id:
        return False
    key = {"user_id": user["id"], "doc_id": str(doc_id)}
    try:
        result = await db.document_opens.update_one(key, {"$setOnInsert": {**key, "id": new_id(), "first_at": now_utc().isoformat()}}, upsert=True)
    except DuplicateKeyError:
        # Zwei Aufrufe gleichzeitig: der eindeutige Index lässt nur den ersten durch.
        return False
    if not result.upserted_id:
        return False
    await _evaluate(user["id"], "document_open", "club")
    return True


async def note_profile_completion(db, user_id: str) -> bool:
    """Ist das Profil jetzt vollständig und war es das noch nie, den Zeitpunkt festhalten - True, wenn gerade gesetzt."""
    from badges import PROFILE_FIELDS, compute_profile_completeness

    projection = {"_id": 0, "id": 1, "profile_completed_at": 1, **{key: 1 for key, _weight in PROFILE_FIELDS}}
    user = await db.users.find_one({"id": user_id}, projection)
    if not user or user.get("profile_completed_at") or compute_profile_completeness(user) < 100:
        return False
    result = await db.users.update_one({"id": user_id, "profile_completed_at": {"$in": [None, ""]}}, {"$set": {"profile_completed_at": now_utc().isoformat()}})
    if not result.modified_count:
        return False
    await _evaluate(user_id, "profile_completed", "profile")
    return True


async def _evaluate(user_id: str, reason: str, source: str) -> None:
    try:
        from services.achievement_queue import request_evaluation
        await request_evaluation([user_id], reason, sources={source})
    except Exception:  # noqa: BLE001 - eine Spur darf nie das Öffnen oder Speichern verhindern
        logger.warning("[member_activity] evaluation request failed", exc_info=True)
