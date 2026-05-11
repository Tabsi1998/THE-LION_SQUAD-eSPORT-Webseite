"""v2 multi-slot match routes."""
from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user, get_optional_user
from database import get_db
from models import MatchV2ResultSubmit, MatchV2Update, new_id, now_utc
from services.match_v2_results import MatchV2ResultError, build_v2_result_application
from services.tournament_permissions import (
    CHECKIN_STAFF_ROLES,
    READ_STAFF_ROLES,
    RESULT_STAFF_ROLES,
    has_tournament_staff_permission,
    require_tournament_staff_permission,
)
from services.visibility import user_can_see


router = APIRouter(prefix="/api/matches-v2", tags=["matches-v2"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


async def _user_registration_for_match(match: dict, user: dict | None) -> dict | None:
    if not user:
        return None
    reg_ids = [
        slot.get("registration_id")
        for slot in match.get("slots") or []
        if slot.get("registration_id")
    ]
    if not reg_ids:
        return None
    db = get_db()
    return await db.tournament_registrations.find_one(
        {"id": {"$in": reg_ids}, "user_id": user["id"]},
        {"_id": 0},
    )


async def _can_read_match(user: dict | None, match: dict) -> bool:
    return (
        _is_staff(user)
        or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES, "match", match.get("id"))
        or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES, "stage", match.get("stage_id"))
        or bool(await _user_registration_for_match(match, user))
    )


async def _assert_match_visible(match: dict, user: dict | None) -> None:
    if await _can_read_match(user, match):
        return
    db = get_db()
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if tournament.get("status") == "draft" or tournament.get("is_public") is False:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    if not await user_can_see(user, tournament.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Match ist nicht sichtbar")


async def _require_v2_result_permission(user: dict, match: dict) -> None:
    allowed = (
        await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "match", match["id"])
        or await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "stage", match.get("stage_id"))
        or await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "station", match.get("station_id"))
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung fuer diese Aktion")


@router.get("/{match_id}")
async def get_match_v2(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _assert_match_visible(match, user)
    return match


@router.patch("/{match_id}")
@router.put("/{match_id}")
async def update_match_v2(match_id: str, body: MatchV2Update,
                          me: dict = Depends(get_current_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await require_tournament_staff_permission(me, match["tournament_id"], CHECKIN_STAFF_ROLES, "match", match_id)
    nullable_fields = {"scheduled_at", "station_id", "admin_note", "map", "best_of", "duration_minutes"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "scheduled_at" in updates:
        updates["scheduled_at"] = updates["scheduled_at"].isoformat() if updates["scheduled_at"] else None
    if updates.get("scheduled_at") and match.get("status") in {"pending", "ready", "preview"} and "status" not in updates:
        updates["status"] = "scheduled"
    updates["updated_at"] = now_utc().isoformat()
    await db.matches_v2.update_one({"id": match_id}, {"$set": updates})
    updated = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    return updated


@router.post("/{match_id}/result")
async def submit_match_v2_result(match_id: str, body: MatchV2ResultSubmit,
                                 force: bool = False,
                                 me: dict = Depends(get_current_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _require_v2_result_permission(me, match)
    stage_matches = await db.matches_v2.find(
        {"stage_id": match["stage_id"]},
        {"_id": 0},
    ).to_list(3000)
    now_iso = now_utc().isoformat()
    try:
        application = build_v2_result_application(
            match,
            stage_matches,
            [entry.model_dump() for entry in body.results],
            actor_id=me["id"],
            now_iso=now_iso,
            proof_url=body.proof_url,
            note=body.note,
            force=force,
        )
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    await db.matches_v2.update_one({"id": match_id}, {"$set": application["match_set"]})
    for target_id, update in application["target_sets"].items():
        await db.matches_v2.update_one({"id": target_id}, {"$set": update})

    report = {
        "id": new_id(),
        "match_id": match_id,
        "tournament_id": match["tournament_id"],
        "stage_id": match["stage_id"],
        "reporter_user_id": me["id"],
        "source": "staff",
        "results": application["results"],
        "proof_url": body.proof_url,
        "note": body.note,
        "force": force,
        "created_at": now_iso,
    }
    await db.match_reports_v2.insert_one(report)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "match_v2.result.submit",
        "target_id": match["tournament_id"],
        "actor_id": me["id"],
        "data": {
            "match_id": match_id,
            "stage_id": match["stage_id"],
            "match_key": match.get("match_key"),
            "advanced_matches": list(application["target_sets"].keys()),
            "force": force,
        },
        "created_at": now_iso,
    })
    updated = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    return {
        "ok": True,
        "match": updated,
        "advanced_match_ids": list(application["target_sets"].keys()),
        "report_id": report["id"],
    }
