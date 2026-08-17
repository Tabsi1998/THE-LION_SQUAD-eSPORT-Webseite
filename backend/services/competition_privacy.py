"""GDPR-safe competition exports and registration-reference anonymization."""

from __future__ import annotations

import asyncio
from copy import deepcopy

from services.competition_snapshot import adapt_legacy_matches, adapt_stage_matches


TERMINAL_MATCH_STATUSES = {"completed", "forfeit", "cancelled", "archived", "bye"}


def _privacy_match_projection(match: dict) -> dict:
    projected = deepcopy(match)
    for slot in projected.get("slots") or []:
        slot["user_id"] = None
    for result in projected.get("results") or []:
        result["note"] = None
    return projected


async def registration_match_snapshot(db, registration_ids: list[str], *, limit: int = 5000) -> list[dict]:
    """Export every canonical match that references one of the registrations."""

    ids = sorted({registration_id for registration_id in registration_ids if registration_id})
    if not ids:
        return []
    legacy_cursor = db.matches.find(
        {"$or": [
            {"participant_a_id": {"$in": ids}},
            {"participant_b_id": {"$in": ids}},
            {"winner_id": {"$in": ids}},
            {"loser_id": {"$in": ids}},
        ]},
        {"_id": 0},
    )
    stage_cursor = db.matches_v2.find(
        {"$or": [
            {"slots.registration_id": {"$in": ids}},
            {"results.registration_id": {"$in": ids}},
        ]},
        {"_id": 0},
    )
    legacy, stage = await asyncio.gather(
        legacy_cursor.to_list(limit),
        stage_cursor.to_list(limit),
    )
    return [
        _privacy_match_projection(match)
        for match in [*adapt_legacy_matches(legacy), *adapt_stage_matches(stage)]
    ]


def anonymized_legacy_match(match: dict, registration_ids: set[str], updated_at: str) -> dict | None:
    updates = {}
    for field in ("participant_a_id", "participant_b_id", "winner_id", "loser_id"):
        if match.get(field) in registration_ids:
            updates[field] = None
    if not updates:
        return None
    if match.get("status") not in TERMINAL_MATCH_STATUSES:
        updates["status"] = "waiting_result"
    updates["updated_at"] = updated_at
    return updates


def anonymized_stage_match(match: dict, registration_ids: set[str], updated_at: str) -> dict | None:
    slots = deepcopy(match.get("slots") or [])
    results = deepcopy(match.get("results") or [])
    changed = False
    for slot in slots:
        if slot.get("registration_id") in registration_ids:
            slot["registration_id"] = None
            slot["user_id"] = None
            slot["status"] = "anonymized"
            changed = True
    for result in results:
        if result.get("registration_id") in registration_ids:
            result["registration_id"] = None
            result["note"] = None
            changed = True
    if not changed:
        return None
    updates = {"slots": slots, "results": results, "updated_at": updated_at}
    if match.get("status") not in TERMINAL_MATCH_STATUSES:
        updates["status"] = "waiting_result"
    return updates


async def anonymize_registration_match_references(
    db,
    registration_ids: list[str],
    *,
    updated_at: str,
) -> dict:
    ids = {registration_id for registration_id in registration_ids if registration_id}
    if not ids:
        return {"legacy_matches": 0, "stage_matches": 0}
    query_ids = sorted(ids)
    legacy_cursor = db.matches.find({"$or": [
        {"participant_a_id": {"$in": query_ids}},
        {"participant_b_id": {"$in": query_ids}},
        {"winner_id": {"$in": query_ids}},
        {"loser_id": {"$in": query_ids}},
    ]})
    stage_cursor = db.matches_v2.find({"$or": [
        {"slots.registration_id": {"$in": query_ids}},
        {"results.registration_id": {"$in": query_ids}},
    ]})
    legacy, stage = await asyncio.gather(
        legacy_cursor.to_list(5000),
        stage_cursor.to_list(5000),
    )
    legacy_count = 0
    stage_count = 0
    for match in legacy:
        updates = anonymized_legacy_match(match, ids, updated_at)
        if updates:
            await db.matches.update_one({"id": match["id"]}, {"$set": updates})
            legacy_count += 1
    for match in stage:
        updates = anonymized_stage_match(match, ids, updated_at)
        if updates:
            await db.matches_v2.update_one({"id": match["id"]}, {"$set": updates})
            stage_count += 1
    return {"legacy_matches": legacy_count, "stage_matches": stage_count}
