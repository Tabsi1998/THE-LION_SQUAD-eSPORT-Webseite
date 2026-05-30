"""v2 multi-slot match routes."""
from fastapi import APIRouter, Depends, HTTPException, Request
from datetime import timedelta

from auth import get_current_user, get_optional_user
from database import get_db
from models import (
    MatchChatCreate,
    MatchScheduleProposalCreate,
    MatchScheduleProposalDecision,
    MatchV2ResultSubmit,
    MatchV2Update,
    new_id,
    now_utc,
)
from services.match_v2_results import MatchV2ResultError, build_v2_result_application
from services.match_notifications import notify_match_result_confirmed
from services.match_planning import ensure_station_slot_available, ensure_tournament_accepts_results
from services.rate_limit import enforce_rate_limit
from services.station_runtime import release_station_for_match
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
EVENT_MODES = {"local", "online", "hybrid"}
RESULT_ENTRY_MODES = {"staff_only", "player_confirmed", "hybrid"}
SCHEDULE_MODES = {"fixed_by_staff", "player_proposal", "hybrid"}
TOURNAMENT_MUTATION_LOCKED_DETAIL = "Turnier ist gesperrt und kann nur noch angesehen oder geloescht werden."


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


async def _ensure_match_tournament_unlocked(db, match: dict) -> None:
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "locked_at": 1})
    if tournament and tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)


def _mode_value(value: object, allowed: set[str]) -> str | None:
    text = str(value or "").strip().lower()
    return text if text in allowed else None


def _first_mode(allowed: set[str], *values: object) -> str | None:
    for value in values:
        normalized = _mode_value(value, allowed)
        if normalized:
            return normalized
    return None


def _settings(source: dict | None) -> dict:
    settings = (source or {}).get("settings")
    return settings if isinstance(settings, dict) else {}


def _legacy_event_mode(tournament: dict | None) -> str | None:
    if (tournament or {}).get("is_hybrid") is True:
        return "hybrid"
    if (tournament or {}).get("is_online") is True:
        return "online"
    return None


def _match_policy(match: dict, tournament: dict | None = None, stage: dict | None = None) -> dict:
    match_settings = _settings(match)
    stage_settings = _settings(stage)
    event_mode = _first_mode(
        EVENT_MODES,
        match.get("event_mode"),
        match_settings.get("event_mode"),
        stage_settings.get("event_mode"),
        (stage or {}).get("event_mode"),
        (tournament or {}).get("event_mode"),
        _legacy_event_mode(tournament),
    ) or "online"
    result_entry_mode = _first_mode(
        RESULT_ENTRY_MODES,
        match.get("result_entry_mode"),
        match_settings.get("result_entry_mode"),
        stage_settings.get("result_entry_mode"),
        (stage or {}).get("result_entry_mode"),
        (tournament or {}).get("result_entry_mode"),
    ) or "staff_only"
    schedule_mode = _first_mode(
        SCHEDULE_MODES,
        match.get("schedule_mode"),
        match_settings.get("schedule_mode"),
        stage_settings.get("schedule_mode"),
        (stage or {}).get("schedule_mode"),
        (tournament or {}).get("schedule_mode"),
    ) or ("fixed_by_staff" if event_mode == "local" else "player_proposal")
    return {
        "event_mode": event_mode,
        "result_entry_mode": result_entry_mode,
        "schedule_mode": schedule_mode,
    }


def _schedule_proposals_enabled(policy: dict) -> bool:
    return policy.get("schedule_mode") in {"player_proposal", "hybrid"}


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


async def _registrations_for_match(match: dict) -> list[dict]:
    reg_ids = [
        slot.get("registration_id")
        for slot in match.get("slots") or []
        if slot.get("registration_id")
    ]
    if not reg_ids:
        return []
    db = get_db()
    return await db.tournament_registrations.find({"id": {"$in": reg_ids}}, {"_id": 0}).to_list(32)


async def _acting_registration_for_match(match: dict, user: dict | None) -> dict | None:
    if not user:
        return None
    direct = await _user_registration_for_match(match, user)
    if direct:
        return direct
    regs = await _registrations_for_match(match)
    team_ids = list({r.get("team_id") for r in regs if r.get("team_id")})
    if not team_ids:
        return None
    db = get_db()
    teams = await db.teams.find(
        {"id": {"$in": team_ids}, "$or": [
            {"leader_id": user["id"]},
            {"co_leader_ids": user["id"]},
        ]},
        {"_id": 0, "id": 1},
    ).to_list(32)
    captain_team_ids = {team["id"] for team in teams}
    return next((reg for reg in regs if reg.get("team_id") in captain_team_ids), None)


async def _can_act_for_match(match: dict, user: dict | None) -> bool:
    return bool(
        _is_staff(user)
        or await has_tournament_staff_permission(user, match.get("tournament_id"), RESULT_STAFF_ROLES, "match", match.get("id"))
        or await _acting_registration_for_match(match, user)
    )


async def _can_read_match(user: dict | None, match: dict) -> bool:
    return (
        _is_staff(user)
        or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES, "match", match.get("id"))
        or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES, "stage", match.get("stage_id"))
        or bool(await _user_registration_for_match(match, user))
        or bool(await _acting_registration_for_match(match, user))
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


async def _can_submit_result_for_match(match: dict, user: dict | None) -> bool:
    return bool(
        user
        and (
            await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "match", match["id"])
            or await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "stage", match.get("stage_id"))
            or await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "station", match.get("station_id"))
        )
    )


def _schedule_deadline(match: dict, tournament: dict | None = None):
    value = match.get("schedule_deadline_at") or (match.get("settings") or {}).get("schedule_deadline_at")
    if value:
        return value
    hours = int((tournament or {}).get("match_schedule_response_hours") or (match.get("settings") or {}).get("schedule_response_hours") or 72)
    return (now_utc() + timedelta(hours=hours)).isoformat()


async def _refresh_schedule_escalation(match: dict) -> dict:
    status = match.get("schedule_status")
    deadline = match.get("schedule_deadline_at")
    if status in {"proposed", "declined"} and deadline:
        try:
            from datetime import datetime
            dt = datetime.fromisoformat(str(deadline).replace("Z", "+00:00"))
            if now_utc() > dt:
                await get_db().matches_v2.update_one({"id": match["id"]}, {"$set": {
                    "schedule_status": "escalated",
                    "updated_at": now_utc().isoformat(),
                }})
                match["schedule_status"] = "escalated"
        except Exception:
            pass
    return match


async def _public_user_map(user_ids: list[str]) -> dict[str, dict]:
    if not user_ids:
        return {}
    users = await get_db().users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1},
    ).to_list(500)
    return {u["id"]: u for u in users}


async def _match_page_payload(match: dict, user: dict | None = None) -> dict:
    db = get_db()
    match = await _refresh_schedule_escalation(match)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0})
    regs = await _registrations_for_match(match)
    reg_by_id = {r["id"]: r for r in regs}
    user_ids = list({r.get("user_id") for r in regs if r.get("user_id")})
    team_ids = list({r.get("team_id") for r in regs if r.get("team_id")})
    users = await _public_user_map(user_ids)
    teams = {t["id"]: t for t in await db.teams.find(
        {"id": {"$in": team_ids}},
        {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "leader_id": 1, "co_leader_ids": 1},
    ).to_list(50)}
    participants = []
    for slot in match.get("slots") or []:
        reg = reg_by_id.get(slot.get("registration_id")) or {}
        user_doc = users.get(reg.get("user_id") or "")
        team = teams.get(reg.get("team_id") or "")
        participants.append({
            "slot": slot.get("slot"),
            "status": slot.get("status"),
            "registration_id": reg.get("id") or slot.get("registration_id"),
            "display_name": reg.get("display_name") or reg.get("ingame_name") or (team or {}).get("name") or (user_doc or {}).get("display_name") or (user_doc or {}).get("username"),
            "team": team,
            "user": user_doc,
        })
    proposals = await db.match_schedule_proposals.find({"match_id": match["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    actor_ids = list({p.get("actor_user_id") for p in proposals if p.get("actor_user_id")})
    actors = await _public_user_map(actor_ids)
    for proposal in proposals:
        proposal["actor"] = actors.get(proposal.get("actor_user_id"))
    can_act = bool(user and await _can_act_for_match(match, user))
    policy = _match_policy(match, tournament, stage)
    can_submit_result = await _can_submit_result_for_match(match, user)
    can_propose_schedule = bool(can_act and _schedule_proposals_enabled(policy))
    acting_reg = await _acting_registration_for_match(match, user)
    return {
        "match": match,
        "tournament": tournament,
        "stage": stage,
        "participants": participants,
        "schedule_proposals": proposals,
        "can_act": can_act,
        "can_report_score": False,
        "can_player_report_result": False,
        "can_submit_result": can_submit_result,
        "can_staff_submit_result": can_submit_result,
        "can_propose_schedule": can_propose_schedule,
        "can_manage_schedule": can_propose_schedule,
        "can_dispute": False,
        "can_forfeit": False,
        "event_mode": policy["event_mode"],
        "result_entry_mode": policy["result_entry_mode"],
        "schedule_mode": policy["schedule_mode"],
        "collection": "matches_v2",
        "acting_registration_id": acting_reg.get("id") if acting_reg else None,
        "matchday": match.get("matchday_number") or match.get("round"),
        "matchday_label": match.get("matchday_label") or (f"Spieltag {match.get('round')}" if match.get("round") else "Match"),
    }


@router.get("/{match_id}")
async def get_match_v2(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _assert_match_visible(match, user)
    return match


@router.get("/{match_id}/page")
async def get_match_v2_page(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _assert_match_visible(match, user)
    return await _match_page_payload(match, user)


@router.get("/{match_id}/schedule-proposals")
async def list_schedule_proposals(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _assert_match_visible(match, user)
    payload = await _match_page_payload(match, user)
    return payload["schedule_proposals"]


@router.post("/{match_id}/schedule-proposals")
async def create_schedule_proposal(match_id: str, body: MatchScheduleProposalCreate,
                                   me: dict = Depends(get_current_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _ensure_match_tournament_unlocked(db, match)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0}) if match.get("stage_id") else None
    policy = _match_policy(match, tournament, stage)
    if not _schedule_proposals_enabled(policy):
        raise HTTPException(status_code=403, detail="Terminabstimmung ist fuer dieses Match nicht aktiviert")
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Nur Teilnehmer, Team-Captains oder Turnierleitung duerfen Termine vorschlagen")
    acting_reg = await _acting_registration_for_match(match, me)
    now_iso = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "match_id": match_id,
        "tournament_id": match.get("tournament_id"),
        "stage_id": match.get("stage_id"),
        "actor_user_id": me["id"],
        "actor_registration_id": acting_reg.get("id") if acting_reg else None,
        "scheduled_at": body.scheduled_at.isoformat(),
        "note": (body.note or "").strip() or None,
        "status": "pending",
        "kind": "proposal",
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.match_schedule_proposals.insert_one(doc)
    await db.matches_v2.update_one({"id": match_id}, {"$set": {
        "schedule_status": "proposed",
        "schedule_deadline_at": _schedule_deadline(match, tournament),
        "updated_at": now_iso,
    }})
    doc.pop("_id", None)
    return doc


@router.post("/{match_id}/schedule-proposals/{proposal_id}/decision")
async def decide_schedule_proposal(match_id: str, proposal_id: str, body: MatchScheduleProposalDecision,
                                   me: dict = Depends(get_current_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    proposal = await db.match_schedule_proposals.find_one({"id": proposal_id, "match_id": match_id}, {"_id": 0})
    if not match or not proposal:
        raise HTTPException(status_code=404, detail="Terminvorschlag nicht gefunden")
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0}) if match.get("stage_id") else None
    policy = _match_policy(match, tournament, stage)
    if not _schedule_proposals_enabled(policy):
        raise HTTPException(status_code=403, detail="Terminabstimmung ist fuer dieses Match nicht aktiviert")
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung fuer diesen Termin")
    acting_reg = await _acting_registration_for_match(match, me)
    if acting_reg and proposal.get("actor_registration_id") == acting_reg.get("id") and body.action in {"accept", "decline"}:
        raise HTTPException(status_code=400, detail="Der eigene Vorschlag muss von der Gegenseite bestaetigt werden")
    now_iso = now_utc().isoformat()
    if body.action == "accept":
        scheduled_at = proposal.get("scheduled_at")
        await db.match_schedule_proposals.update_one({"id": proposal_id}, {"$set": {
            "status": "accepted",
            "decision_user_id": me["id"],
            "decision_note": (body.note or "").strip() or None,
            "updated_at": now_iso,
        }})
        await db.matches_v2.update_one({"id": match_id}, {"$set": {
            "scheduled_at": scheduled_at,
            "schedule_status": "accepted",
            "status": "scheduled" if match.get("status") in {"pending", "ready", "preview"} else match.get("status"),
            "updated_at": now_iso,
        }})
        return {"ok": True, "status": "accepted", "scheduled_at": scheduled_at}
    if body.action == "decline":
        await db.match_schedule_proposals.update_one({"id": proposal_id}, {"$set": {
            "status": "declined",
            "decision_user_id": me["id"],
            "decision_note": (body.note or "").strip() or None,
            "updated_at": now_iso,
        }})
        await db.matches_v2.update_one({"id": match_id}, {"$set": {"schedule_status": "declined", "updated_at": now_iso}})
        return {"ok": True, "status": "declined"}
    if not body.scheduled_at:
        raise HTTPException(status_code=400, detail="Gegenvorschlag braucht Datum und Uhrzeit")
    await db.match_schedule_proposals.update_one({"id": proposal_id}, {"$set": {
        "status": "countered",
        "decision_user_id": me["id"],
        "decision_note": (body.note or "").strip() or None,
        "updated_at": now_iso,
    }})
    counter = {
        "id": new_id(),
        "match_id": match_id,
        "tournament_id": match.get("tournament_id"),
        "stage_id": match.get("stage_id"),
        "actor_user_id": me["id"],
        "actor_registration_id": acting_reg.get("id") if acting_reg else None,
        "scheduled_at": body.scheduled_at.isoformat(),
        "note": (body.note or "").strip() or None,
        "status": "pending",
        "kind": "counter",
        "parent_proposal_id": proposal_id,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.match_schedule_proposals.insert_one(counter)
    await db.matches_v2.update_one({"id": match_id}, {"$set": {"schedule_status": "proposed", "updated_at": now_iso}})
    counter.pop("_id", None)
    return counter


@router.get("/{match_id}/chat")
async def list_match_chat(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _assert_match_visible(match, user)
    messages = await db.match_chat_messages.find({"match_id": match_id}, {"_id": 0}).sort("created_at", 1).to_list(500)
    users = await _public_user_map(list({m.get("user_id") for m in messages if m.get("user_id")}))
    for message in messages:
        message["author"] = users.get(message.get("user_id"))
    return messages


@router.post("/{match_id}/chat")
async def post_match_chat(match_id: str, body: MatchChatCreate, request: Request, me: dict = Depends(get_current_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _ensure_match_tournament_unlocked(db, match)
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Nur Teilnehmer, Team-Captains oder Turnierleitung duerfen im Matchchat schreiben")
    await enforce_rate_limit(
        request,
        "matches:chat:user-match",
        limit=30,
        window_seconds=300,
        subject=f"{me['id']}:{match_id}",
    )
    now_iso = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "match_id": match_id,
        "tournament_id": match.get("tournament_id"),
        "stage_id": match.get("stage_id"),
        "user_id": me["id"],
        "message": body.message.strip(),
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.match_chat_messages.insert_one(doc)
    try:
        from routes.match_routes import _notify_match_chat_message
        await _notify_match_chat_message(db, match, "matches_v2", me, doc)
    except Exception:
        pass
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(me["id"])
    except Exception:
        pass
    doc.pop("_id", None)
    doc["author"] = {"id": me.get("id"), "username": me.get("username"), "display_name": me.get("display_name"), "avatar_url": me.get("avatar_url"), "role": me.get("role")}
    return doc


@router.patch("/{match_id}")
@router.put("/{match_id}")
async def update_match_v2(match_id: str, body: MatchV2Update,
                          me: dict = Depends(get_current_user)):
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _ensure_match_tournament_unlocked(db, match)
    await require_tournament_staff_permission(me, match["tournament_id"], CHECKIN_STAFF_ROLES, "match", match_id)
    nullable_fields = {"scheduled_at", "station_id", "admin_note", "map", "best_of", "duration_minutes"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "scheduled_at" in updates:
        updates["scheduled_at"] = updates["scheduled_at"].isoformat() if updates["scheduled_at"] else None
    if updates.get("scheduled_at") and match.get("status") in {"pending", "ready", "preview"} and "status" not in updates:
        updates["status"] = "scheduled"
    await ensure_station_slot_available(db, match, updates, "matches_v2")
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
    await _ensure_match_tournament_unlocked(db, match)
    await ensure_tournament_accepts_results(db, match["tournament_id"])
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
    try:
        await notify_match_result_confirmed(db, updated, "matches_v2", force=force)
    except Exception:
        pass
    try:
        await release_station_for_match(db, updated, "matches_v2")
    except Exception:
        pass
    return {
        "ok": True,
        "match": updated,
        "advanced_match_ids": list(application["target_sets"].keys()),
        "report_id": report["id"],
    }
