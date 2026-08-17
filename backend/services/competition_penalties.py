"""Canonical read projection for tournament forfeit penalties."""

from __future__ import annotations

import asyncio


async def load_forfeit_penalties(
    db,
    registration_ids: list[str] | set[str] | None = None,
    *,
    limit: int = 5000,
) -> list[dict]:
    """Load player-visible Legacy and Stage/FFA forfeit decisions."""

    filter_supplied = registration_ids is not None
    wanted_ids = {
        registration_id
        for registration_id in registration_ids or []
        if registration_id
    }
    if filter_supplied and not wanted_ids:
        return []
    legacy_query: dict = {
        "status": "forfeit",
        "admin_decision_note": {"$exists": True, "$ne": None},
    }
    if filter_supplied:
        legacy_query["loser_id"] = {"$in": sorted(wanted_ids)}
    stage_query: dict = {"results.forfeit": True}
    if filter_supplied:
        stage_query["results.registration_id"] = {"$in": sorted(wanted_ids)}

    legacy_cursor = db.matches.find(legacy_query, {"_id": 0})
    stage_cursor = db.matches_v2.find(stage_query, {"_id": 0})
    legacy_matches, stage_matches = await asyncio.gather(
        legacy_cursor.to_list(limit),
        stage_cursor.to_list(limit),
    )

    penalties = [
        {
            "registration_id": match.get("loser_id"),
            "tournament_id": match.get("tournament_id"),
            "match_id": match.get("id"),
            "match_label": match.get("match_number") or str(match.get("id") or "")[:6],
            "reason": match.get("admin_decision_note") or "(keine Begründung)",
            "issued_by": match.get("admin_decision_by"),
            "issued_at": match.get("admin_decision_at") or match.get("updated_at"),
            "source": {"engine": "legacy", "collection": "matches"},
        }
        for match in legacy_matches
        if match.get("loser_id") and (not filter_supplied or match.get("loser_id") in wanted_ids)
    ]
    for match in stage_matches:
        result_meta = match.get("result_meta") or {}
        for result in match.get("results") or []:
            registration_id = result.get("registration_id")
            if not result.get("forfeit") or not registration_id:
                continue
            if filter_supplied and registration_id not in wanted_ids:
                continue
            penalties.append({
                "registration_id": registration_id,
                "tournament_id": match.get("tournament_id"),
                "match_id": match.get("id"),
                "match_label": match.get("match_key") or match.get("order") or str(match.get("id") or "")[:6],
                "reason": result.get("note") or result_meta.get("note") or "(keine Begründung)",
                "issued_by": match.get("completed_by") or result_meta.get("confirmed_by"),
                "issued_at": match.get("completed_at") or result_meta.get("confirmed_at") or match.get("updated_at"),
                "source": {"engine": "stage", "collection": "matches_v2"},
            })
    penalties.sort(key=lambda item: item.get("issued_at") or "", reverse=True)
    return penalties
