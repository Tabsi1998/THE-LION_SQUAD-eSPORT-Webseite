"""Match/Score/Dispute routes."""
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, get_optional_user
from services.visibility import user_can_see
from services.tournament_permissions import (
    READ_STAFF_ROLES,
    RESULT_STAFF_ROLES,
    has_tournament_staff_permission,
    require_tournament_staff_permission,
)
from models import (
    MatchChatCreate,
    MatchScheduleProposalCreate,
    MatchScheduleProposalDecision,
    MatchV2ResultSubmit,
    MatchUpdate,
    MatchScoreReport,
    MatchDispute,
    now_utc,
    new_id,
)
from bracket_engine import advance_match_winner
from match_rules import loser_for_winner, match_allows_draw, validate_winner_id
from services.match_v2_results import MatchV2ResultError, build_v2_result_application

router = APIRouter(prefix="/api/matches", tags=["matches"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
USER_PUBLIC_PROJECTION = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "display_name": 1,
    "avatar_url": 1,
}


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


async def _find_match_any(match_id: str) -> tuple[dict, str]:
    db = get_db()
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if match:
        return match, "matches_v2"
    match = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if match:
        return match, "matches"
    raise HTTPException(status_code=404, detail="Match nicht gefunden")


def _registration_ids_for_match(match: dict) -> list[str]:
    if match.get("slots"):
        return [
            slot.get("registration_id")
            for slot in match.get("slots") or []
            if slot.get("registration_id")
        ]
    return [
        reg_id
        for reg_id in [match.get("participant_a_id"), match.get("participant_b_id")]
        if reg_id
    ]


async def _registrations_for_match(match: dict) -> list[dict]:
    reg_ids = _registration_ids_for_match(match)
    if not reg_ids:
        return []
    return await get_db().tournament_registrations.find(
        {"id": {"$in": reg_ids}},
        {"_id": 0},
    ).to_list(64)


async def _public_user_map(user_ids: list[str]) -> dict[str, dict]:
    if not user_ids:
        return {}
    users = await get_db().users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1},
    ).to_list(500)
    return {u["id"]: u for u in users}


async def _user_registration_for_match(match: dict, user: dict | None) -> dict | None:
    if not user:
        return None
    reg_ids = _registration_ids_for_match(match)
    if not reg_ids:
        return None
    db = get_db()
    return await db.tournament_registrations.find_one(
        {"id": {"$in": reg_ids}, "user_id": user["id"]},
        {"_id": 0},
    )


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
    teams = await get_db().teams.find(
        {
            "id": {"$in": team_ids},
            "$or": [
                {"leader_id": user["id"]},
                {"co_leader_ids": user["id"]},
            ],
        },
        {"_id": 0, "id": 1},
    ).to_list(64)
    captain_team_ids = {team["id"] for team in teams}
    return next((reg for reg in regs if reg.get("team_id") in captain_team_ids), None)


async def _can_act_for_match(match: dict, user: dict | None) -> bool:
    return bool(
        _is_staff(user)
        or await has_tournament_staff_permission(user, match.get("tournament_id"), RESULT_STAFF_ROLES)
        or await has_tournament_staff_permission(user, match.get("tournament_id"), RESULT_STAFF_ROLES, "match", match.get("id"))
        or await has_tournament_staff_permission(user, match.get("tournament_id"), RESULT_STAFF_ROLES, "stage", match.get("stage_id"))
        or await _acting_registration_for_match(match, user)
    )


async def _can_read_match(match: dict, user: dict | None) -> bool:
    return (
        _is_staff(user)
        or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES)
        or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES, "match", match.get("id"))
        or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES, "stage", match.get("stage_id"))
        or bool(await _user_registration_for_match(match, user))
        or bool(await _acting_registration_for_match(match, user))
    )


async def _require_result_permission(user: dict, match: dict) -> None:
    allowed = (
        await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES)
        or await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "match", match["id"])
        or await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "stage", match.get("stage_id"))
        or (match.get("station_id") and await has_tournament_staff_permission(user, match["tournament_id"], RESULT_STAFF_ROLES, "station", match.get("station_id")))
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung fuer diese Aktion")


async def _assert_match_visible(match: dict, user: dict | None) -> None:
    if await _can_read_match(match, user):
        return
    db = get_db()
    t = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if t.get("status") == "draft" or t.get("is_public") is False:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    if not await user_can_see(user, t.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Match ist nicht sichtbar")


def _schedule_deadline(match: dict, tournament: dict | None = None) -> str:
    value = match.get("schedule_deadline_at") or (match.get("settings") or {}).get("schedule_deadline_at")
    if value:
        return value
    hours = int((tournament or {}).get("match_schedule_response_hours") or (match.get("settings") or {}).get("schedule_response_hours") or 72)
    return (now_utc() + timedelta(hours=hours)).isoformat()


async def _refresh_schedule_escalation(match: dict, collection: str) -> dict:
    status = match.get("schedule_status")
    deadline = match.get("schedule_deadline_at")
    if status not in {"proposed", "declined"} or not deadline:
        return match
    try:
        dt = datetime.fromisoformat(str(deadline).replace("Z", "+00:00"))
        if now_utc() > dt:
            await get_db()[collection].update_one(
                {"id": match["id"]},
                {"$set": {"schedule_status": "escalated", "updated_at": now_utc().isoformat()}},
            )
            match["schedule_status"] = "escalated"
    except Exception:
        pass
    return match


def _public_registration(reg: dict | None, user: dict | None) -> dict | None:
    if not reg:
        return None
    is_staff = _is_staff(user)
    is_self = bool(user and reg.get("user_id") == user.get("id"))
    if is_staff:
        return reg
    out = {
        "id": reg.get("id"),
        "tournament_id": reg.get("tournament_id"),
        "status": reg.get("status"),
        "display_name": reg.get("display_name") or reg.get("ingame_name"),
        "ingame_name": reg.get("ingame_name"),
        "team_id": reg.get("team_id"),
        "user": reg.get("user"),
    }
    if is_self:
        out["user_id"] = reg.get("user_id")
    return out


async def _match_participants(match: dict, user: dict | None) -> list[dict]:
    db = get_db()
    regs = await _registrations_for_match(match)
    reg_by_id = {r["id"]: r for r in regs}
    user_ids = list({r.get("user_id") for r in regs if r.get("user_id")})
    team_ids = list({r.get("team_id") for r in regs if r.get("team_id")})
    users = await _public_user_map(user_ids)
    teams = {
        team["id"]: team
        for team in await db.teams.find(
            {"id": {"$in": team_ids}},
            {"_id": 0, "id": 1, "name": 1, "tag": 1, "logo_url": 1, "leader_id": 1, "co_leader_ids": 1},
        ).to_list(64)
    }

    if match.get("slots"):
        source_slots = match.get("slots") or []
    else:
        source_slots = [
            {"slot": 1, "status": "filled" if match.get("participant_a_id") else "pending", "registration_id": match.get("participant_a_id")},
            {"slot": 2, "status": "filled" if match.get("participant_b_id") else "pending", "registration_id": match.get("participant_b_id")},
        ]

    participants = []
    for slot in source_slots:
        reg = reg_by_id.get(slot.get("registration_id")) or {}
        public_reg = _public_registration({**reg, "user": users.get(reg.get("user_id"))} if reg else None, user) or {}
        user_doc = users.get(reg.get("user_id") or "")
        team = teams.get(reg.get("team_id") or "")
        participants.append({
            "slot": slot.get("slot"),
            "status": slot.get("status"),
            "registration_id": reg.get("id") or slot.get("registration_id"),
            "display_name": public_reg.get("display_name")
                or reg.get("display_name")
                or reg.get("ingame_name")
                or (team or {}).get("name")
                or (user_doc or {}).get("display_name")
                or (user_doc or {}).get("username"),
            "team": team,
            "user": user_doc,
        })
    return participants


async def _match_page_payload(match: dict, collection: str, user: dict | None = None) -> dict:
    db = get_db()
    match = await _refresh_schedule_escalation(match, collection)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0})
    proposals = await db.match_schedule_proposals.find(
        {"match_id": match["id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    actors = await _public_user_map(list({p.get("actor_user_id") for p in proposals if p.get("actor_user_id")}))
    for proposal in proposals:
        proposal["actor"] = actors.get(proposal.get("actor_user_id"))
        proposal.pop("match_collection", None)
    acting_reg = await _acting_registration_for_match(match, user)
    round_number = match.get("matchday_number") or match.get("round")
    league_like = (tournament or {}).get("format") in {"league", "round_robin"} or (stage or {}).get("stage_type") in {"league", "round_robin_groups", "ffa_league"}
    matchday_label = match.get("matchday_label") or match.get("round_name")
    if not matchday_label:
        prefix = "Spieltag" if league_like else "Runde"
        matchday_label = f"{prefix} {round_number}" if round_number else "Match"
    return {
        "match": match,
        "tournament": tournament,
        "stage": stage,
        "participants": await _match_participants(match, user),
        "schedule_proposals": proposals,
        "can_act": bool(user and await _can_act_for_match(match, user)),
        "acting_registration_id": acting_reg.get("id") if acting_reg else None,
        "matchday": round_number,
        "matchday_label": matchday_label,
    }


@router.get("/upcoming")
async def my_upcoming(me: dict = Depends(get_current_user)):
    db = get_db()
    regs = await db.tournament_registrations.find(
        {"user_id": me["id"]}, {"_id": 0, "id": 1, "tournament_id": 1}
    ).to_list(200)
    reg_ids = [r["id"] for r in regs]
    matches = await db.matches.find({
        "$or": [{"participant_a_id": {"$in": reg_ids}},
                {"participant_b_id": {"$in": reg_ids}}],
        "status": {"$in": ["ready", "scheduled", "in_progress", "waiting_result"]},
    }, {"_id": 0}).to_list(200)
    return matches


@router.get("/{match_id}/page")
async def get_match_page(match_id: str, user: dict | None = Depends(get_optional_user)):
    match, collection = await _find_match_any(match_id)
    await _assert_match_visible(match, user)
    return await _match_page_payload(match, collection, user)


@router.get("/{match_id}/schedule-proposals")
async def list_schedule_proposals(match_id: str, user: dict | None = Depends(get_optional_user)):
    match, collection = await _find_match_any(match_id)
    await _assert_match_visible(match, user)
    payload = await _match_page_payload(match, collection, user)
    return payload["schedule_proposals"]


@router.post("/{match_id}/schedule-proposals")
async def create_schedule_proposal(match_id: str, body: MatchScheduleProposalCreate,
                                   me: dict = Depends(get_current_user)):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Nur Teilnehmer, Team-Captains oder Turnierleitung duerfen Termine vorschlagen")
    acting_reg = await _acting_registration_for_match(match, me)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    now_iso = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "match_id": match_id,
        "match_collection": collection,
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
    await db[collection].update_one({"id": match_id}, {"$set": {
        "schedule_status": "proposed",
        "schedule_deadline_at": _schedule_deadline(match, tournament),
        "updated_at": now_iso,
    }})
    doc.pop("_id", None)
    doc.pop("match_collection", None)
    return doc


@router.post("/{match_id}/schedule-proposals/{proposal_id}/decision")
async def decide_schedule_proposal(match_id: str, proposal_id: str, body: MatchScheduleProposalDecision,
                                   me: dict = Depends(get_current_user)):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    proposal = await db.match_schedule_proposals.find_one({"id": proposal_id, "match_id": match_id}, {"_id": 0})
    if not proposal:
        raise HTTPException(status_code=404, detail="Terminvorschlag nicht gefunden")
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung fuer diesen Termin")
    acting_reg = await _acting_registration_for_match(match, me)
    if (
        not _is_staff(me)
        and acting_reg
        and proposal.get("actor_registration_id") == acting_reg.get("id")
        and body.action in {"accept", "decline"}
    ):
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
        await db[collection].update_one({"id": match_id}, {"$set": {
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
        await db[collection].update_one({"id": match_id}, {"$set": {"schedule_status": "declined", "updated_at": now_iso}})
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
        "match_collection": collection,
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
    await db[collection].update_one({"id": match_id}, {"$set": {
        "schedule_status": "proposed",
        "schedule_deadline_at": _schedule_deadline(match),
        "updated_at": now_iso,
    }})
    counter.pop("_id", None)
    counter.pop("match_collection", None)
    return counter


@router.get("/{match_id}/chat")
async def list_match_chat(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    match, _collection = await _find_match_any(match_id)
    await _assert_match_visible(match, user)
    messages = await db.match_chat_messages.find(
        {"match_id": match_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    users = await _public_user_map(list({m.get("user_id") for m in messages if m.get("user_id")}))
    for message in messages:
        message["author"] = users.get(message.get("user_id"))
    return messages


@router.post("/{match_id}/chat")
async def post_match_chat(match_id: str, body: MatchChatCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    match, _collection = await _find_match_any(match_id)
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Nur Teilnehmer, Team-Captains oder Turnierleitung duerfen im Matchchat schreiben")
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
    doc.pop("_id", None)
    doc["author"] = {
        "id": me.get("id"),
        "username": me.get("username"),
        "display_name": me.get("display_name"),
        "avatar_url": me.get("avatar_url"),
        "role": me.get("role"),
    }
    return doc


@router.post("/{match_id}/result")
async def submit_match_result(match_id: str, body: MatchV2ResultSubmit,
                              force: bool = False,
                              me: dict = Depends(get_current_user)):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    if collection != "matches_v2":
        raise HTTPException(status_code=400, detail="Dieses Ergebnisformular ist fuer Mehrspieler-Heats vorgesehen")
    await _require_result_permission(me, match)
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
        "action": "match.result.submit",
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


@router.get("/{match_id}")
async def get_match(match_id: str, user: dict | None = Depends(get_optional_user)):
    db = get_db()
    m, collection = await _find_match_any(match_id)
    await _assert_match_visible(m, user)
    if collection == "matches_v2":
        return m
    # Enrich participants
    reg_ids = [x for x in [m.get("participant_a_id"), m.get("participant_b_id")] if x]
    regs = await db.tournament_registrations.find({"id": {"$in": reg_ids}}, {"_id": 0}).to_list(10)
    user_ids = [r["user_id"] for r in regs if r.get("user_id")]
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, USER_PUBLIC_PROJECTION).to_list(10)}
    regs_dict = {r["id"]: {**r, "user": users.get(r.get("user_id"))} for r in regs}
    m["participant_a"] = _public_registration(regs_dict.get(m.get("participant_a_id")), user)
    m["participant_b"] = _public_registration(regs_dict.get(m.get("participant_b_id")), user)
    return m


@router.put("/{match_id}")
@router.patch("/{match_id}")
async def update_match(match_id: str, body: MatchUpdate, me: dict = Depends(get_current_user)):
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    allowed = (
        await has_tournament_staff_permission(me, m["tournament_id"], RESULT_STAFF_ROLES, "tournament")
        or await has_tournament_staff_permission(me, m["tournament_id"], RESULT_STAFF_ROLES, "match", match_id)
        or (m.get("station_id") and await has_tournament_staff_permission(me, m["tournament_id"], RESULT_STAFF_ROLES, "station", m.get("station_id")))
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung fuer diese Aktion")
    nullable_fields = {"winner_id", "scheduled_at", "station_id", "admin_note", "map", "best_of", "duration_minutes"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "scheduled_at" in updates:
        updates["scheduled_at"] = updates["scheduled_at"].isoformat() if updates["scheduled_at"] else None
    if updates.get("scheduled_at") and m.get("status") in {"pending", "ready", "preview"} and "status" not in updates:
        updates["status"] = "scheduled"
    if "winner_id" in updates:
        validate_winner_id(m, updates.get("winner_id"))
        updates["loser_id"] = loser_for_winner(m, updates.get("winner_id"))
        if updates.get("winner_id"):
            updates["status"] = "completed"
    final_status = updates.get("status", m.get("status"))
    final_winner = updates.get("winner_id", m.get("winner_id"))
    if final_status == "completed" and not final_winner and not match_allows_draw(m):
        raise HTTPException(status_code=400, detail="Dieses Match braucht einen Gewinner")
    if final_status == "completed" and final_winner:
        validate_winner_id(m, final_winner)
        updates["loser_id"] = loser_for_winner(m, final_winner)
    if not final_winner and "winner_id" in updates:
        updates["loser_id"] = None
    updates["updated_at"] = now_utc().isoformat()
    await db.matches.update_one({"id": match_id}, {"$set": updates})
    m = await db.matches.find_one({"id": match_id})
    # If completed, advance bracket
    if m.get("status") == "completed" and m.get("winner_id"):
        all_matches = await db.matches.find({"tournament_id": m["tournament_id"]}).to_list(2000)
        updated_matches = advance_match_winner(m, all_matches)
        for um in updated_matches:
            await db.matches.update_one({"id": um["id"]}, {"$set": um})
        # Badge triggers
        try:
            from badges import on_match_completed
            regs = {r["id"]: r.get("user_id") for r in await db.tournament_registrations.find(
                {"tournament_id": m["tournament_id"]}, {"_id": 0}).to_list(500)}
            winner_uid = regs.get(m.get("winner_id"))
            loser_uid = regs.get(m.get("loser_id"))
            if winner_uid:
                await on_match_completed(winner_uid, loser_uid, m["tournament_id"], m["id"])
        except Exception:
            pass
        # Discord trigger: match completed
        try:
            from discord_service import send_discord
            regs = {r["id"]: r for r in await db.tournament_registrations.find(
                {"tournament_id": m["tournament_id"]}, {"_id": 0}).to_list(500)}
            t = await db.tournaments.find_one({"id": m["tournament_id"]}, {"_id": 0}) or {}
            a = regs.get(m.get("participant_a_id"), {})
            b = regs.get(m.get("participant_b_id"), {})
            w = regs.get(m.get("winner_id"), {})
            await send_discord(
                f"🎮 Match beendet · {t.get('title') or 'Turnier'}",
                f"**{a.get('display_name') or '?'}** vs **{b.get('display_name') or '?'}**\n"
                f"Gewinner: **{w.get('display_name') or '?'}** ({m.get('score_a',0)}:{m.get('score_b',0)})",
                color=0x29B6E8,
                url=f"/tournaments/{t.get('slug') or t.get('id')}/bracket",
                fields=[
                    {"name": "Runde", "value": m.get("round_name") or f"Runde {m.get('round','?')}", "inline": True},
                ],
                event_key="match.completed",
            )
        except Exception:
            pass
    m.pop("_id", None)
    return m


@router.post("/{match_id}/report")
async def report_score(match_id: str, body: MatchScoreReport, me: dict = Depends(get_current_user)):
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    # Verify user is participant
    reg_ids = [m.get("participant_a_id"), m.get("participant_b_id")]
    my_reg = await db.tournament_registrations.find_one(
        {"id": {"$in": reg_ids}, "user_id": me["id"]})
    if not my_reg:
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")
    report = {
        "id": new_id(),
        "user_id": me["id"],
        "registration_id": my_reg["id"],
        "score_a": body.score_a,
        "score_b": body.score_b,
        "screenshot_url": body.screenshot_url,
        "note": body.note,
        "at": now_utc().isoformat(),
    }
    await db.matches.update_one({"id": match_id}, {
        "$push": {"reports": report},
        "$set": {"status": "waiting_result", "updated_at": now_utc().isoformat()},
    })
    # Check consensus - if 2 reports match, auto-complete
    m = await db.matches.find_one({"id": match_id})
    reports = m.get("reports", [])
    if len(reports) >= 2:
        last2 = reports[-2:]
        if last2[0]["score_a"] == last2[1]["score_a"] and last2[0]["score_b"] == last2[1]["score_b"]:
            winner = None
            if body.score_a > body.score_b:
                winner = m.get("participant_a_id")
            elif body.score_b > body.score_a:
                winner = m.get("participant_b_id")
            if not winner and not match_allows_draw(m):
                await db.matches.update_one({"id": match_id}, {"$set": {
                    "score_a": body.score_a, "score_b": body.score_b,
                    "winner_id": None, "loser_id": None,
                    "status": "disputed",
                    "admin_note": m.get("admin_note") or "Unentschieden gemeldet; Gewinnerentscheidung erforderlich.",
                    "updated_at": now_utc().isoformat(),
                }})
            else:
                await db.matches.update_one({"id": match_id}, {"$set": {
                    "score_a": body.score_a, "score_b": body.score_b,
                    "winner_id": winner,
                    "loser_id": loser_for_winner(m, winner),
                    "status": "completed", "updated_at": now_utc().isoformat(),
                }})
                # Advance bracket
                m = await db.matches.find_one({"id": match_id})
                all_matches = await db.matches.find({"tournament_id": m["tournament_id"]}).to_list(2000)
                for um in advance_match_winner(m, all_matches):
                    await db.matches.update_one({"id": um["id"]}, {"$set": um})
        else:
            await db.matches.update_one({"id": match_id}, {"$set": {
                "status": "disputed",
                "admin_note": m.get("admin_note") or "Abweichende Ergebnisberichte; bitte durch Turnierleitung pruefen.",
                "updated_at": now_utc().isoformat(),
            }})
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    return m


@router.post("/{match_id}/dispute")
async def dispute(match_id: str, body: MatchDispute, me: dict = Depends(get_current_user)):
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    if not _is_staff(me) and not await _user_registration_for_match(m, me):
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")
    await db.matches.update_one({"id": match_id}, {
        "$push": {"disputes": {"user_id": me["id"], "reason": body.reason,
                                 "at": now_utc().isoformat()}},
        "$set": {"status": "disputed", "updated_at": now_utc().isoformat()},
    })
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    # Phase B v4.1: trigger negative achievement for the user who disputed
    try:
        from badges import on_dispute_opened
        await on_dispute_opened(me["id"], match_id=match_id)
    except Exception:
        pass
    return m


@router.post("/{match_id}/forfeit")
async def forfeit(match_id: str, body: dict, me: dict = Depends(get_current_user)):
    """Admin forfeit - winner_id is the surviving participant.

    P0 — Penalty Transparency: a justification note (≥5 chars) is mandatory and
    will be visible to the affected player in /api/penalties/me.
    """
    db = get_db()
    m = await db.matches.find_one({"id": match_id})
    if not m:
        raise HTTPException(status_code=404)
    await require_tournament_staff_permission(me, m["tournament_id"], RESULT_STAFF_ROLES)
    note = (body.get("note") or body.get("reason") or "").strip()
    if len(note) < 5:
        raise HTTPException(
            status_code=422,
            detail="Bei einem Forfeit ist eine Begründung (mind. 5 Zeichen) Pflicht.",
        )
    winner_id = body.get("winner_id")
    validate_winner_id(m, winner_id)
    loser_id = loser_for_winner(m, winner_id)
    await db.matches.update_one({"id": match_id}, {"$set": {
        "winner_id": winner_id, "loser_id": loser_id,
        "status": "forfeit",
        "admin_decision_note": note,
        "admin_decision_by": me["id"],
        "admin_decision_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }})
    m = await db.matches.find_one({"id": match_id})
    all_matches = await db.matches.find({"tournament_id": m["tournament_id"]}).to_list(2000)
    for um in advance_match_winner(m, all_matches):
        await db.matches.update_one({"id": um["id"]}, {"$set": um})
    m.pop("_id", None)
    # Phase B v4.1: forfeit ⇒ no_show for the loser
    try:
        from badges import trigger_negative_incident
        # Resolve loser registration → user_id
        if loser_id:
            reg = await db.tournament_registrations.find_one({"id": loser_id}, {"_id": 0, "user_id": 1})
            if reg and reg.get("user_id"):
                await trigger_negative_incident(reg["user_id"], "no_show",
                    {"match_id": match_id, "reason": "forfeit"}, awarded_by=me["id"])
    except Exception:
        pass
    return m
