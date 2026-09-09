"""Match/Score/Dispute routes."""
import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends, Request
from database import get_db
from auth import get_current_user, get_optional_user
from services.visibility import user_can_see
from services.tournament_permissions import (
    CHECKIN_STAFF_ROLES,
    READ_STAFF_ROLES,
    RESULT_STAFF_ROLES,
    has_match_result_permission,
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
from services.competition_read import canonical_match_for_source, find_match_source
from services.match_overview import operational_match_overviews, own_match_overviews
from services.match_planning import ensure_station_slot_available, ensure_tournament_accepts_results
from services.match_v2_results import MatchV2ResultError
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from services.rate_limit import enforce_rate_limit
from services.station_labels import attach_station_info
from services.user_notifications import create_user_notification
from services.v2_result_submission import submit_v2_result
from services.v2_match_flows import (
    dispute_entry,
    is_duplicate_dispute,
    is_duplicate_report,
    report_consensus,
    report_entry,
    results_for_forfeit,
    validate_forfeit_note,
)
from services.competition_usage import engine_for_match, record_write

router = APIRouter(prefix="/api/matches", tags=["matches"])
logger = logging.getLogger("tls.match")
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
EVENT_MODES = {"local", "online", "hybrid"}
RESULT_ENTRY_MODES = {"staff_only", "player_confirmed", "hybrid"}
SCHEDULE_MODES = {"fixed_by_staff", "player_proposal", "hybrid"}
MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")
STAFF_MENTION_HANDLES = {"leitung", "turnierleitung", "orga", "organizer", "staff", "admin", "referee", "schiri", "scorekeeper"}
USER_PUBLIC_PROJECTION = {
    "_id": 0,
    "id": 1,
    "username": 1,
    "display_name": 1,
    "avatar_url": 1,
}
TOURNAMENT_MUTATION_LOCKED_DETAIL = "Turnier ist gesperrt und kann nur noch angesehen oder geloescht werden."


async def _ensure_match_tournament_unlocked(db, match: dict) -> None:
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "locked_at": 1})
    if tournament and tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


def _mode_value(value: object, allowed: set[str]) -> str | None:
    text = str(value or "").strip().lower()
    return text if text in allowed else None


def _first_mode(allowed: set[str], *values: object) -> str | None:
    for value in values:
        normalized = _mode_value(value, allowed)
        if normalized:
            return normalized
    return None


def _match_settings(match: dict | None) -> dict:
    settings = (match or {}).get("settings")
    return settings if isinstance(settings, dict) else {}


def _stage_settings(stage: dict | None) -> dict:
    settings = (stage or {}).get("settings")
    return settings if isinstance(settings, dict) else {}


def _legacy_event_mode(tournament: dict | None) -> str | None:
    if (tournament or {}).get("is_hybrid") is True:
        return "hybrid"
    if (tournament or {}).get("is_online") is True:
        return "online"
    return None


def _match_policy(match: dict, collection: str, tournament: dict | None = None, stage: dict | None = None) -> dict:
    match_settings = _match_settings(match)
    stage_settings = _stage_settings(stage)
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
    )
    if not result_entry_mode:
        result_entry_mode = "staff_only" if event_mode == "local" or collection == "matches_v2" else "player_confirmed"
    schedule_mode = _first_mode(
        SCHEDULE_MODES,
        match.get("schedule_mode"),
        match_settings.get("schedule_mode"),
        stage_settings.get("schedule_mode"),
        (stage or {}).get("schedule_mode"),
        (tournament or {}).get("schedule_mode"),
    )
    if not schedule_mode:
        schedule_mode = "fixed_by_staff" if event_mode == "local" else "player_proposal"
    return {
        "event_mode": event_mode,
        "result_entry_mode": result_entry_mode,
        "schedule_mode": schedule_mode,
    }


def _players_can_report(policy: dict) -> bool:
    return policy.get("result_entry_mode") in {"player_confirmed", "hybrid"}


def _schedule_proposals_enabled(policy: dict) -> bool:
    return policy.get("schedule_mode") in {"player_proposal", "hybrid"}


async def _audit_match_action(db, action: str, match: dict, actor_id: str | None, data: dict | None = None) -> None:
    # Jede auditierte Match-Aenderung ist zugleich ein Schreibvorgang einer der
    # beiden Engines. Die Messung hängt deshalb hier und nicht an jedem
    # einzelnen Aufrufer.
    await record_write(
        engine_for_match(match),
        action,
        tournament_id=match.get("tournament_id"),
    )
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "target_id": match.get("tournament_id") or match.get("id"),
        "actor_id": actor_id,
        "data": {
            "match_id": match.get("id"),
            "stage_id": match.get("stage_id"),
            "match_key": match.get("match_key"),
            **(data or {}),
        },
        "created_at": now_utc().isoformat(),
    })


async def _find_match_any(match_id: str) -> tuple[dict, str]:
    source = await find_match_source(get_db(), match_id)
    if source:
        return source.match, source.collection
    raise HTTPException(status_code=404, detail="Match nicht gefunden")


async def _serialized_match_write(match_id: str):
    match, _collection = await _find_match_any(match_id)
    try:
        async with mutation_lock(get_db(), tournament_write_resource(match["tournament_id"])):
            yield
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")


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


def _user_label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


def _match_label(match: dict) -> str:
    return match.get("match_key") or match.get("round_name") or match.get("id") or "Match"


async def _match_participant_user_ids(db, match: dict) -> set[str]:
    regs = await _registrations_for_match(match)
    user_ids = {reg.get("user_id") for reg in regs if reg.get("user_id")}
    team_ids = {reg.get("team_id") for reg in regs if reg.get("team_id")}
    if team_ids:
        teams = await db.teams.find(
            {"id": {"$in": list(team_ids)}},
            {"_id": 0, "member_ids": 1, "leader_id": 1, "co_leader_ids": 1},
        ).to_list(100)
        for team in teams:
            if team.get("leader_id"):
                user_ids.add(team.get("leader_id"))
            user_ids.update(team.get("co_leader_ids") or [])
            user_ids.update(team.get("member_ids") or [])
    return {user_id for user_id in user_ids if user_id}


def _staff_assignment_matches_match(assignment: dict, match: dict) -> bool:
    scope = assignment.get("scope") or "tournament"
    scope_id = assignment.get("scope_id")
    if scope == "tournament" or not scope_id:
        return True
    if scope == "match":
        return scope_id == match.get("id")
    if scope == "stage":
        return scope_id == match.get("stage_id")
    if scope == "station":
        return scope_id == match.get("station_id")
    return False


async def _match_staff_user_ids(db, match: dict) -> set[str]:
    tournament_id = match.get("tournament_id")
    user_ids: set[str] = set()
    global_staff = await db.users.find(
        {"role": {"$in": sorted(STAFF_ROLES)}, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1},
    ).to_list(200)
    user_ids.update(row.get("id") for row in global_staff if row.get("id"))
    if tournament_id:
        assignments = await db.tournament_staff_assignments.find(
            {
                "tournament_id": tournament_id,
                "is_active": {"$ne": False},
                "role": {"$in": sorted(READ_STAFF_ROLES | RESULT_STAFF_ROLES)},
            },
            {"_id": 0, "user_id": 1, "scope": 1, "scope_id": 1},
        ).to_list(500)
        user_ids.update(
            row.get("user_id")
            for row in assignments
            if row.get("user_id") and _staff_assignment_matches_match(row, match)
        )
    return {user_id for user_id in user_ids if user_id}


async def _match_chat_user_ids(db, match: dict) -> set[str]:
    return (await _match_participant_user_ids(db, match)) | (await _match_staff_user_ids(db, match))


def _match_requires_staff_chat_notice(policy: dict) -> bool:
    return (
        policy.get("event_mode") == "local"
        or policy.get("result_entry_mode") == "staff_only"
        or policy.get("schedule_mode") == "fixed_by_staff"
    )


async def _mentioned_match_user_ids(db, match: dict, message: str) -> set[str]:
    handles = {handle.lower() for handle in MENTION_RE.findall(message or "")}
    user_handles = sorted(handles - STAFF_MENTION_HANDLES)
    if not user_handles:
        return set()
    candidates = await db.users.find(
        {
            "is_active": True,
            "is_banned": {"$ne": True},
            "$or": [{"username": {"$regex": f"^{re.escape(handle)}$", "$options": "i"}} for handle in user_handles],
        },
        {"_id": 0, "id": 1, "role": 1},
    ).to_list(100)
    allowed_ids = await _match_chat_user_ids(db, match)
    return {
        candidate["id"]
        for candidate in candidates
        if candidate.get("id") in allowed_ids or candidate.get("role") in STAFF_ROLES
    }


async def _notify_match_chat_message(
    db,
    match: dict,
    collection: str,
    sender: dict,
    message: dict,
) -> None:
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0}) or {}
    stage = await db.tournament_stages.find_one(
        {"id": match.get("stage_id")}, {"_id": 0, "creation_key": 0}
    ) if match.get("stage_id") else None
    policy = _match_policy(match, collection, tournament, stage)
    handles = {handle.lower() for handle in MENTION_RE.findall(message.get("message") or "")}
    staff_requested = bool(handles & STAFF_MENTION_HANDLES)
    participant_ids = await _match_participant_user_ids(db, match)
    staff_ids = await _match_staff_user_ids(db, match) if staff_requested or _match_requires_staff_chat_notice(policy) else set()
    mentioned_ids = await _mentioned_match_user_ids(db, match, message.get("message") or "")
    if staff_requested:
        mentioned_ids.update(staff_ids)

    sender_id = sender.get("id")
    match_title = _match_label(match)
    tournament_title = tournament.get("title") or "Turnier"
    url = f"/matches/{match.get('id')}"
    body = f"{_user_label(sender)}: {(message.get('message') or '')[:140]}"
    meta = {
        "match_id": match.get("id"),
        "tournament_id": match.get("tournament_id"),
        "stage_id": match.get("stage_id"),
        "message_id": message.get("id"),
    }

    for recipient_id in {uid for uid in mentioned_ids if uid and uid != sender_id}:
        await create_user_notification(
            recipient_id,
            title=f"Markierung im Matchchat: {match_title}",
            body=body,
            url=url,
            kind="match_chat_mention",
            meta=meta,
        )

    message_recipient_ids = (participant_ids | staff_ids) - mentioned_ids - {sender_id}
    for recipient_id in {uid for uid in message_recipient_ids if uid}:
        await create_user_notification(
            recipient_id,
            title=f"Neue Matchnachricht: {tournament_title}",
            body=body,
            url=url,
            kind="match_chat_message",
            meta=meta,
        )


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
        or await has_match_result_permission(user, match)
        or await _acting_registration_for_match(match, user)
    )


async def _can_submit_result_for_match(match: dict, user: dict | None) -> bool:
    return await has_match_result_permission(user, match)


async def _can_forfeit_match(match: dict, user: dict | None, collection: str) -> bool:
    return bool(
        user
        and collection == "matches"
        and await has_match_result_permission(user, match)
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
    allowed = await has_match_result_permission(user, match)
    if not allowed:
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Aktion")


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
    await attach_station_info(db, [match])
    tournament = await db.tournaments.find_one(
        {"id": match.get("tournament_id")}, {"_id": 0, "creation_key": 0}
    )
    stage = await db.tournament_stages.find_one(
        {"id": match.get("stage_id")}, {"_id": 0, "creation_key": 0}
    )
    proposals = await db.match_schedule_proposals.find(
        {"match_id": match["id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    actors = await _public_user_map(list({p.get("actor_user_id") for p in proposals if p.get("actor_user_id")}))
    for proposal in proposals:
        proposal["actor"] = actors.get(proposal.get("actor_user_id"))
        proposal.pop("match_collection", None)
    acting_reg = await _acting_registration_for_match(match, user)
    direct_reg = await _user_registration_for_match(match, user)
    policy = _match_policy(match, collection, tournament, stage)
    can_submit_result = await _can_submit_result_for_match(match, user)
    can_player_report = bool(collection == "matches" and direct_reg and _players_can_report(policy))
    can_propose_schedule = bool(user and await _can_act_for_match(match, user) and _schedule_proposals_enabled(policy))
    round_number = match.get("matchday_number") or match.get("round")
    league_like = (tournament or {}).get("format") in {"league", "round_robin"} or (stage or {}).get("stage_type") in {"league", "round_robin_groups", "ffa_league"}
    matchday_label = match.get("matchday_label") or match.get("round_name")
    if not matchday_label:
        prefix = "Spieltag" if league_like else "Runde"
        matchday_label = f"{prefix} {round_number}" if round_number else "Match"
    canonical_match = await canonical_match_for_source(db, match, collection)
    return {
        "match": match,
        "canonical_match": canonical_match,
        "tournament": tournament,
        "stage": stage,
        "participants": await _match_participants(match, user),
        "schedule_proposals": proposals,
        "can_act": bool(user and await _can_act_for_match(match, user)),
        "can_report_score": can_player_report,
        "can_player_report_result": can_player_report,
        "can_submit_result": can_submit_result,
        "can_staff_submit_result": can_submit_result,
        "can_propose_schedule": can_propose_schedule,
        "can_manage_schedule": can_propose_schedule,
        "can_dispute": bool(collection == "matches" and user and (_is_staff(user) or (direct_reg and _players_can_report(policy)))),
        "can_forfeit": await _can_forfeit_match(match, user, collection),
        "event_mode": policy["event_mode"],
        "result_entry_mode": policy["result_entry_mode"],
        "schedule_mode": policy["schedule_mode"],
        "collection": collection,
        "acting_registration_id": acting_reg.get("id") if acting_reg else None,
        "matchday": round_number,
        "matchday_label": matchday_label,
    }


@router.get("/upcoming")
async def my_upcoming(me: dict = Depends(get_current_user)):
    matches, _registrations = await own_match_overviews(get_db(), me)
    return matches


@router.get("/operations")
async def operational_matches(me: dict = Depends(get_current_user)):
    return await operational_match_overviews(get_db(), me)


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
                                   me: dict = Depends(get_current_user),
                                   _mutation: None = Depends(_serialized_match_write)):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    acting_reg = await _acting_registration_for_match(match, me)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0}) if match.get("stage_id") else None
    policy = _match_policy(match, collection, tournament, stage)
    if not _schedule_proposals_enabled(policy):
        raise HTTPException(status_code=403, detail="Terminvorschläge sind für dieses Match nicht aktiviert")
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Nur Teilnehmer, Team-Captains oder Turnierleitung duerfen Termine vorschlagen")
    now_iso = now_utc().isoformat()
    normalized_note = (body.note or "").strip() or None
    existing = await db.match_schedule_proposals.find_one({
        "match_id": match_id,
        "actor_user_id": me["id"],
        "scheduled_at": body.scheduled_at.isoformat(),
        "note": normalized_note,
        "status": "pending",
        "kind": "proposal",
    }, {"_id": 0, "match_collection": 0})
    if existing:
        return {**existing, "idempotent_replay": True}
    doc = {
        "id": new_id(),
        "match_id": match_id,
        "match_collection": collection,
        "tournament_id": match.get("tournament_id"),
        "stage_id": match.get("stage_id"),
        "actor_user_id": me["id"],
        "actor_registration_id": acting_reg.get("id") if acting_reg else None,
        "scheduled_at": body.scheduled_at.isoformat(),
        "note": normalized_note,
        "status": "pending",
        "kind": "proposal",
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.match_schedule_proposals.insert_one(doc)
    await getattr(db, collection).update_one({"id": match_id}, {"$set": {
        "schedule_status": "proposed",
        "schedule_deadline_at": _schedule_deadline(match, tournament),
        "updated_at": now_iso,
    }})
    doc.pop("_id", None)
    doc.pop("match_collection", None)
    doc["idempotent_replay"] = False
    return doc


@router.post("/{match_id}/schedule-proposals/{proposal_id}/decision")
async def decide_schedule_proposal(match_id: str, proposal_id: str, body: MatchScheduleProposalDecision,
                                   me: dict = Depends(get_current_user),
                                   _mutation: None = Depends(_serialized_match_write)):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    proposal = await db.match_schedule_proposals.find_one({"id": proposal_id, "match_id": match_id}, {"_id": 0})
    if not proposal:
        raise HTTPException(status_code=404, detail="Terminvorschlag nicht gefunden")
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0}) if match.get("stage_id") else None
    policy = _match_policy(match, collection, tournament, stage)
    if not _schedule_proposals_enabled(policy):
        raise HTTPException(status_code=403, detail="Terminabstimmung ist für dieses Match nicht aktiviert")
    if not await _can_act_for_match(match, me):
        raise HTTPException(status_code=403, detail="Keine Berechtigung für diesen Termin")
    acting_reg = await _acting_registration_for_match(match, me)
    if (
        not _is_staff(me)
        and acting_reg
        and proposal.get("actor_registration_id") == acting_reg.get("id")
        and body.action in {"accept", "decline"}
    ):
        raise HTTPException(status_code=400, detail="Der eigene Vorschlag muss von der Gegenseite bestaetigt werden")
    now_iso = now_utc().isoformat()
    normalized_note = (body.note or "").strip() or None
    completed_action = {"accept": "accepted", "decline": "declined", "counter": "countered"}[body.action]
    if (
        proposal.get("status") == completed_action
        and proposal.get("decision_user_id") == me["id"]
        and proposal.get("decision_note") == normalized_note
    ):
        if completed_action == "countered" and body.scheduled_at:
            existing_counter = await db.match_schedule_proposals.find_one({
                "parent_proposal_id": proposal_id,
                "actor_user_id": me["id"],
                "scheduled_at": body.scheduled_at.isoformat(),
                "note": normalized_note,
            }, {"_id": 0, "match_collection": 0})
            if existing_counter:
                return {**existing_counter, "idempotent_replay": True}
        response = {"ok": True, "status": completed_action, "idempotent_replay": True}
        if completed_action == "accepted":
            response["scheduled_at"] = proposal.get("scheduled_at")
        return response
    if proposal.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Über diesen Terminvorschlag wurde bereits entschieden")
    if body.action == "accept":
        scheduled_at = proposal.get("scheduled_at")
        await db.match_schedule_proposals.update_one({"id": proposal_id}, {"$set": {
            "status": "accepted",
            "decision_user_id": me["id"],
            "decision_note": normalized_note,
            "updated_at": now_iso,
        }})
        await getattr(db, collection).update_one({"id": match_id}, {"$set": {
            "scheduled_at": scheduled_at,
            "schedule_status": "accepted",
            "status": "scheduled" if match.get("status") in {"pending", "ready", "preview"} else match.get("status"),
            "updated_at": now_iso,
        }})
        return {"ok": True, "status": "accepted", "scheduled_at": scheduled_at, "idempotent_replay": False}
    if body.action == "decline":
        await db.match_schedule_proposals.update_one({"id": proposal_id}, {"$set": {
            "status": "declined",
            "decision_user_id": me["id"],
            "decision_note": normalized_note,
            "updated_at": now_iso,
        }})
        await getattr(db, collection).update_one({"id": match_id}, {"$set": {"schedule_status": "declined", "updated_at": now_iso}})
        return {"ok": True, "status": "declined", "idempotent_replay": False}
    if not body.scheduled_at:
        raise HTTPException(status_code=400, detail="Gegenvorschlag braucht Datum und Uhrzeit")
    await db.match_schedule_proposals.update_one({"id": proposal_id}, {"$set": {
        "status": "countered",
        "decision_user_id": me["id"],
        "decision_note": normalized_note,
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
        "note": normalized_note,
        "status": "pending",
        "kind": "counter",
        "parent_proposal_id": proposal_id,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.match_schedule_proposals.insert_one(counter)
    await getattr(db, collection).update_one({"id": match_id}, {"$set": {
        "schedule_status": "proposed",
        "schedule_deadline_at": _schedule_deadline(match),
        "updated_at": now_iso,
    }})
    counter.pop("_id", None)
    counter.pop("match_collection", None)
    counter["idempotent_replay"] = False
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
async def post_match_chat(match_id: str, body: MatchChatCreate, request: Request, me: dict = Depends(get_current_user)):
    db = get_db()
    match, collection = await _find_match_any(match_id)
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
        await _notify_match_chat_message(db, match, collection, me, doc)
    except Exception:
        pass
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(me["id"])
    except Exception:
        pass
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
        raise HTTPException(status_code=400, detail="Dieses Ergebnisformular ist für Mehrspieler-Heats vorgesehen")
    await _ensure_match_tournament_unlocked(db, match)
    await ensure_tournament_accepts_results(db, match["tournament_id"])
    await _require_result_permission(me, match)
    try:
        async with mutation_lock(db, tournament_write_resource(match["tournament_id"])):
            match, collection = await _find_match_any(match_id)
            if collection != "matches_v2":
                raise HTTPException(status_code=400, detail="Dieses Ergebnisformular ist für Mehrspieler-Heats vorgesehen")
            await _ensure_match_tournament_unlocked(db, match)
            await ensure_tournament_accepts_results(db, match["tournament_id"])
            await _require_result_permission(me, match)
            return await submit_v2_result(
                db,
                match,
                [entry.model_dump() for entry in body.results],
                actor_id=me["id"],
                proof_url=body.proof_url,
                note=body.note,
                force=force,
                audit_action="match.result.submit",
            )
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/{match_id}")
async def get_match(match_id: str, user: dict | None = Depends(get_optional_user)):
    m, _collection = await _find_match_any(match_id)
    await _assert_match_visible(m, user)
    return m


@router.put("/{match_id}")
@router.patch("/{match_id}")
async def update_match(match_id: str, body: MatchUpdate, me: dict = Depends(get_current_user),
                       _mutation: None = Depends(_serialized_match_write)):
    db = get_db()
    # Canonical, engine-aware update: multi-slot (v2) matches are updated in place
    # for operational fields; scores/winners for v2 are set via POST /{id}/result.
    v2_collection = getattr(db, "matches_v2", None)
    v2_match = await v2_collection.find_one({"id": match_id}, {"_id": 0}) if v2_collection is not None else None
    if v2_match:
        await _ensure_match_tournament_unlocked(db, v2_match)
        await require_tournament_staff_permission(
            me, v2_match["tournament_id"], CHECKIN_STAFF_ROLES, "match", match_id
        )
        nullable_fields = {"scheduled_at", "station_id", "admin_note", "map", "best_of", "duration_minutes"}
        raw = body.model_dump(exclude_unset=True)
        for result_field in ("score_a", "score_b", "winner_id"):
            raw.pop(result_field, None)
        updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
        if "scheduled_at" in updates:
            updates["scheduled_at"] = updates["scheduled_at"].isoformat() if updates["scheduled_at"] else None
        if updates.get("scheduled_at") and v2_match.get("status") in {"pending", "ready", "preview"} and "status" not in updates:
            updates["status"] = "scheduled"
        await ensure_station_slot_available(db, v2_match, updates, "matches_v2")
        if updates and all(v2_match.get(key) == value for key, value in updates.items()):
            return {**v2_match, "idempotent_replay": True}
        updates["updated_at"] = now_utc().isoformat()
        await db.matches_v2.update_one({"id": match_id}, {"$set": updates})
        updated = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
        return {**updated, "idempotent_replay": False}
    raise HTTPException(status_code=404, detail="Match nicht gefunden")


async def _report_v2(db, match: dict, body: MatchScoreReport, me: dict) -> dict:
    """Take one participant's view of a graph match result.

    Nothing is decided by a single report. Only when two different participants
    submit the same ranking does the result get written - the same rule the
    classic flow follows, so a player cannot rank themselves into the next
    round on their own.
    """
    if not body.results:
        raise HTTPException(
            status_code=422,
            detail="Für dieses Match wird eine Platzierungsliste gemeldet, keine zwei Punktstände.",
        )
    my_registration = await _user_registration_for_match(match, me)
    if not my_registration:
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")

    results = [entry.model_dump(exclude_none=True) for entry in body.results]
    if is_duplicate_report(match, me["id"], results):
        match.pop("_id", None)
        match["idempotent_replay"] = True
        return match

    entry = report_entry(me["id"], my_registration["id"], results)
    await getattr(db, "matches_v2").update_one(
        {"id": match["id"]},
        {"$push": {"reports": entry}, "$set": {"updated_at": now_utc().isoformat()}},
    )
    await _audit_match_action(db, "match.result.report", match, me.get("id"), {
        "result_count": len(results),
    })

    stored = await getattr(db, "matches_v2").find_one({"id": match["id"]}, {"_id": 0}) or match
    agreed = report_consensus(stored.get("reports") or [])
    if not agreed:
        stored["idempotent_replay"] = False
        stored["awaiting_confirmation"] = True
        return stored

    try:
        outcome = await submit_v2_result(
            db,
            stored,
            agreed,
            actor_id=me["id"],
            proof_url=body.screenshot_url,
            note=body.note,
            force=False,
            audit_action="match.result.auto_resolution",
        )
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    confirmed = outcome.get("match") or stored
    confirmed["idempotent_replay"] = bool(outcome.get("idempotent_replay"))
    confirmed["awaiting_confirmation"] = False
    return confirmed


@router.post("/{match_id}/report")
async def report_score(match_id: str, body: MatchScoreReport, me: dict = Depends(get_current_user),
                       _mutation: None = Depends(_serialized_match_write)):
    db = get_db()
    m, collection = await _find_match_any(match_id)
    await _ensure_match_tournament_unlocked(db, m)
    await ensure_tournament_accepts_results(db, m["tournament_id"])
    tournament = await db.tournaments.find_one({"id": m.get("tournament_id")}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": m.get("stage_id")}, {"_id": 0}) if m.get("stage_id") else None
    policy = _match_policy(m, collection, tournament, stage)
    if not _players_can_report(policy):
        raise HTTPException(status_code=403, detail="Ergebnisse werden für dieses Match durch die Turnierleitung eingetragen")
    return await _report_v2(db, m, body, me)


@router.post("/{match_id}/dispute")
async def dispute(match_id: str, body: MatchDispute, me: dict = Depends(get_current_user),
                  _mutation: None = Depends(_serialized_match_write)):
    db = get_db()
    # Engine-unabhaengig: ein Einspruch muss in beiden Speichern moeglich sein,
    # sonst kann ein Turnier im Graph-System nicht vollstaendig gespielt werden.
    m, collection = await _find_match_any(match_id)
    await _ensure_match_tournament_unlocked(db, m)
    if not _is_staff(me) and not await _user_registration_for_match(m, me):
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")
    reason = body.reason.strip()
    if is_duplicate_dispute(m, me["id"], reason):
        m.pop("_id", None)
        m["idempotent_replay"] = True
        return m
    await getattr(db, collection).update_one({"id": match_id}, {
        "$push": {"disputes": dispute_entry(me["id"], reason)},
        "$set": {"status": "disputed", "updated_at": now_utc().isoformat()},
    })
    await _audit_match_action(db, "match.dispute.open", m, me.get("id"), {
        "reason_length": len((body.reason or "").strip()),
    })
    m = await getattr(db, collection).find_one({"id": match_id}, {"_id": 0})
    # Phase B v4.1: trigger negative achievement for the user who disputed
    try:
        from badges import on_dispute_opened
        await on_dispute_opened(me["id"], match_id=match_id)
    except Exception:
        pass
    m["idempotent_replay"] = False
    return m


async def _forfeit_v2(db, match: dict, body: dict, me: dict, force: bool) -> dict:
    """Record a walkover on a graph match.

    Which participant gave up can be stated directly, or derived when only the
    survivor is named and the match has exactly two sides - that keeps the call
    identical to the classic one for the common duel case.
    """
    try:
        note = validate_forfeit_note(body.get("note") or body.get("reason"))
        forfeiting = (body.get("forfeit_registration_id") or "").strip()
        if not forfeiting:
            survivor = (body.get("winner_id") or "").strip()
            others = [item for item in _registration_ids_for_match(match) if item != survivor]
            if not survivor or len(others) != 1:
                raise MatchV2ResultError(
                    "Bitte forfeit_registration_id angeben - bei mehr als zwei Teilnehmern "
                    "lässt sich der Aufgebende nicht aus dem Sieger ableiten."
                )
            forfeiting = others[0]
        results = results_for_forfeit(match, forfeiting)
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    outcome = await submit_v2_result(
        db,
        match,
        results,
        actor_id=me["id"],
        proof_url=None,
        note=note,
        force=force,
        audit_action="match.forfeit",
    )
    updated = outcome.get("match") or match
    await getattr(db, "matches_v2").update_one({"id": match["id"]}, {"$set": {
        "status": "forfeit",
        "forfeit_registration_id": forfeiting,
        "admin_decision_note": note,
        "admin_decision_by": me["id"],
        "admin_decision_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }})
    result = await getattr(db, "matches_v2").find_one({"id": match["id"]}, {"_id": 0}) or updated
    result["idempotent_replay"] = bool(outcome.get("idempotent_replay"))
    await _record_walkover_incident(db, match, forfeiting, me)
    return result


async def _record_walkover_incident(db, match: dict, forfeiting_registration_id: str, me: dict) -> None:
    """Note the walkover against the participant who gave up.

    Came from the classic path and would have quietly disappeared with it. A
    walkover is a sanction, so it belongs in the record the affected member can
    see under their penalties.
    """
    try:
        from badges import trigger_negative_incident

        registration = await db.tournament_registrations.find_one(
            {"id": forfeiting_registration_id}, {"_id": 0, "user_id": 1})
        if registration and registration.get("user_id"):
            await trigger_negative_incident(
                registration["user_id"], "no_show",
                {"match_id": match["id"], "reason": "forfeit"}, awarded_by=me["id"])
    except Exception as exc:
        logger.warning("Walkover incident failed for match=%s type=%s",
                       match.get("id"), type(exc).__name__)


@router.post("/{match_id}/forfeit")
async def forfeit(match_id: str, body: dict, me: dict = Depends(get_current_user),
                  force: bool = False,
                  _mutation: None = Depends(_serialized_match_write)):
    """Admin forfeit - winner_id is the surviving participant.

    P0 — Penalty Transparency: a justification note (≥5 chars) is mandatory and
    will be visible to the affected player in /api/penalties/me.

    Graph matches take the same route: there the walkover is expressed as an
    ordinary ranking with the forfeiting participant last, so advancement,
    standings and exports need no special case for it.
    """
    db = get_db()
    m, collection = await _find_match_any(match_id)
    await _ensure_match_tournament_unlocked(db, m)
    await ensure_tournament_accepts_results(db, m["tournament_id"])
    await _require_result_permission(me, m)
    return await _forfeit_v2(db, m, body, me, force)
