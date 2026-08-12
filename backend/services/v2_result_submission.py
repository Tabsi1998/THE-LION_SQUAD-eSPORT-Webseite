"""Single implementation for idempotent v2 match-result persistence."""
from __future__ import annotations

import hashlib
import json
import logging

from models import now_utc
from services.match_notifications import notify_match_result_confirmed
from services.match_v2_results import build_v2_result_application, is_v2_result_replay, normalize_v2_results
from services.station_runtime import release_station_for_match


logger = logging.getLogger("tls.match_results")


def _submission_identity(
    match: dict,
    raw_results: list[dict],
    proof_url: str | None,
    note: str | None,
    force: bool,
) -> tuple[str, list[dict]]:
    normalized = normalize_v2_results(match, raw_results)
    parent_report_id = (match.get("result_meta") or {}).get("report_id")
    payload = {
        "match_id": match["id"],
        "parent_report_id": parent_report_id,
        "results": normalized,
        "proof_url": (proof_url or "").strip() or None,
        "note": (note or "").strip() or None,
        "force": bool(force),
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return f"v2-result-{digest}", normalized


async def _upsert_result_audit(
    db,
    *,
    audit_action: str,
    match: dict,
    actor_id: str,
    report_id: str,
    advanced_match_ids: list[str],
    force: bool,
    created_at: str,
) -> None:
    await db.audit_logs.update_one(
        {"id": f"audit-{report_id}"},
        {"$setOnInsert": {
            "id": f"audit-{report_id}",
            "action": audit_action,
            "target_id": match["tournament_id"],
            "actor_id": actor_id,
            "data": {
                "match_id": match["id"],
                "stage_id": match["stage_id"],
                "match_key": match.get("match_key"),
                "advanced_matches": advanced_match_ids,
                "force": force,
                "report_id": report_id,
            },
            "created_at": created_at,
        }},
        upsert=True,
    )


async def _finish_result_side_effects(db, match: dict, force: bool) -> None:
    try:
        await notify_match_result_confirmed(db, match, "matches_v2", force=force)
    except Exception as exc:
        logger.warning(
            "Result notification failed for match=%s type=%s",
            match.get("id"),
            type(exc).__name__,
        )
    try:
        await release_station_for_match(db, match, "matches_v2")
    except Exception as exc:
        logger.warning(
            "Station release failed for match=%s type=%s",
            match.get("id"),
            type(exc).__name__,
        )


async def submit_v2_result(
    db,
    match: dict,
    raw_results: list[dict],
    *,
    actor_id: str,
    proof_url: str | None,
    note: str | None,
    force: bool,
    audit_action: str,
) -> dict:
    """Persist one v2 result while the caller owns the tournament write lease."""
    if is_v2_result_replay(match, raw_results, proof_url=proof_url, note=note):
        meta = match.get("result_meta") or {}
        report_id = meta.get("report_id")
        advanced_match_ids = meta.get("advanced_match_ids") or []
        if report_id:
            await _upsert_result_audit(
                db,
                audit_action=audit_action,
                match=match,
                actor_id=match.get("completed_by") or actor_id,
                report_id=report_id,
                advanced_match_ids=advanced_match_ids,
                force=bool(meta.get("force")),
                created_at=meta.get("confirmed_at") or match.get("completed_at") or now_utc().isoformat(),
            )
            await _finish_result_side_effects(db, match, bool(meta.get("force")))
        return {
            "ok": True,
            "match": match,
            "advanced_match_ids": advanced_match_ids,
            "report_id": report_id,
            "idempotent_replay": True,
        }

    stage_matches = await db.matches_v2.find(
        {"stage_id": match["stage_id"]},
        {"_id": 0},
    ).to_list(3000)
    now_iso = now_utc().isoformat()
    report_id, normalized_results = _submission_identity(match, raw_results, proof_url, note, force)
    application = build_v2_result_application(
        match,
        stage_matches,
        normalized_results,
        actor_id=actor_id,
        now_iso=now_iso,
        proof_url=proof_url,
        note=note,
        force=force,
    )
    advanced_match_ids = list(application["target_sets"].keys())
    application["match_set"]["result_meta"].update({
        "report_id": report_id,
        "advanced_match_ids": advanced_match_ids,
    })

    await db.match_reports_v2.update_one(
        {"id": report_id},
        {"$setOnInsert": {
            "id": report_id,
            "match_id": match["id"],
            "tournament_id": match["tournament_id"],
            "stage_id": match["stage_id"],
            "reporter_user_id": actor_id,
            "source": "staff",
            "results": application["results"],
            "proof_url": (proof_url or "").strip() or None,
            "note": (note or "").strip() or None,
            "force": force,
            "created_at": now_iso,
        }},
        upsert=True,
    )
    # Downstream writes are safe to repeat.  Commit the source match last so a
    # retry after interruption will resume rather than mistaking partial work
    # for a completed replay.
    for target_id, update in application["target_sets"].items():
        await db.matches_v2.update_one({"id": target_id}, {"$set": update})
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": application["match_set"]})

    await _upsert_result_audit(
        db,
        audit_action=audit_action,
        match=match,
        actor_id=actor_id,
        report_id=report_id,
        advanced_match_ids=advanced_match_ids,
        force=force,
        created_at=now_iso,
    )
    updated = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    await _finish_result_side_effects(db, updated, force)
    return {
        "ok": True,
        "match": updated,
        "advanced_match_ids": advanced_match_ids,
        "report_id": report_id,
        "idempotent_replay": False,
    }
