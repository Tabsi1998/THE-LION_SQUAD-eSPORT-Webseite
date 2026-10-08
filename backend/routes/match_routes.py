"""Match/Score/Dispute routes."""
import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends, Request
from database import get_db
from services import moderation_standing
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
from services.match_public_view import public_match_view, public_tournament_view
from services.match_planning import ensure_station_slot_available, ensure_tournament_accepts_results
from services.match_v2_results import MatchV2ResultError, normalize_v2_results
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from services.rate_limit import enforce_rate_limit
from services import word_filter
from services.station_labels import attach_station_info
from match_rules import match_allows_draw
from services.match_audience import acting_registration, player_user_ids
# Solange ein Spiel einen dieser Zustände hat, darf ein Aufruf (#1122) stehen bleiben.
from services.match_calls import CALL_OPEN_STATUSES, call_view
from services.match_disputes import CLOSED_DETAIL as DISPUTE_CLOSED_DETAIL, dispute_window
from services.match_notifications import notify_dispute_opened, notify_report_conflict, notify_result_reported, results_summary
from services.tournament_rules import match_policy, players_can_report, schedule_proposals_enabled
from services.user_notifications import create_user_notification
from services.v2_result_submission import submit_v2_result
from services.v2_match_flows import (
    REPORT_CLOSED_STATUSES,
    dispute_entry,
    is_duplicate_dispute,
    is_duplicate_report,
    public_report_results,
    report_consensus,
    report_entry,
    report_state,
    reports_conflict,
    results_for_forfeit,
    validate_forfeit_note,
)
from services.competition_usage import engine_for_match, record_write

router = APIRouter(prefix="/api/matches", tags=["matches"])
logger = logging.getLogger("tls.match")
# Turnierleitung über alle Turniere; Helfer nur über ihren Einsatz (has_tournament_staff_permission).
STAFF_ROLES = {"tournament_admin", "club_admin", "superadmin"}
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


async def _sees_internal(match: dict, user: dict | None) -> bool:
    """Notizen, Entscheidungs-Begründungen, Einsprüche und Meldungen im Detail sieht nur, wer das Turnier leitet."""
    if not user:
        return False
    return _is_staff(user) or await has_tournament_staff_permission(user, match.get("tournament_id"), READ_STAFF_ROLES)


# Die Regeln stehen an einer Stelle (services/tournament_rules, #1132): ohne Angabe melden online und hybrid die
# Spieler selbst, vor Ort trägt die Turnierleitung ein - Admin-Anzeige und Planungs-Warnung rechnen gleich.
_match_policy = match_policy
_players_can_report = players_can_report
_schedule_proposals_enabled = schedule_proposals_enabled


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
    # Matchchat und Spiel-Hinweise (#1136): alle Spieler - bei Teams jedes Mitglied samt Leitung.
    return await player_user_ids(db, await _registrations_for_match(match))


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
    policy = _match_policy(match, tournament, stage)
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
    from services.chat_attachments import chat_message_preview
    body = f"{_user_label(sender)}: {chat_message_preview(message, 140)}"
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
    """Die Anmeldung, für die diese Person im Spiel handelt (#1136): die eigene, sonst die ihres Teams als Teamleitung
    oder Co-Leitung. Damit melden, bestätigen, widersprechen und planen dieselben Leute, die auch einchecken."""
    if not user:
        return None
    return await acting_registration(get_db(), await _registrations_for_match(match), user.get("id"))


async def _can_act_for_match(match: dict, user: dict | None) -> bool:
    return bool(
        _is_staff(user)
        or await has_match_result_permission(user, match)
        or await _acting_registration_for_match(match, user)
    )


async def _can_submit_result_for_match(match: dict, user: dict | None) -> bool:
    return await has_match_result_permission(user, match)


async def _can_forfeit_match(match: dict, user: dict | None) -> bool:
    return bool(user and await has_match_result_permission(user, match))


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


async def _rewrite_matchday_schedule(db, tournament_id: str | None) -> None:
    """Nach einer Entscheidung über einen Vorschlag gilt für die Partie vielleicht wieder Heimrecht oder
    Standardzeit - nachtragen, damit Erinnerungen und Anzeigen den geltenden Termin lesen (#235)."""
    if not tournament_id:
        return
    from services.matchday_schedule import persist_matchday_schedule

    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if tournament:
        await persist_matchday_schedule(db, tournament)


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


def _log_safe(value, limit: int = 120) -> str:
    """Werte aus Anfragen ins Protokoll nur ohne Zeilenumbrüche und gekürzt."""
    return str(value or "").replace("\r", " ").replace("\n", " ")[:limit]


def _accepts_reports(match: dict) -> bool:
    """Nimmt das Spiel noch Meldungen an? Nicht, wenn es entschieden, abgesagt oder in Klärung ist - und nicht,
    solange keine zwei Seiten feststehen."""
    if str(match.get("status") or "") in REPORT_CLOSED_STATUSES:
        return False
    return len(_registration_ids_for_match(match)) >= 2


async def _report_view(db, match: dict, acting_reg: dict) -> dict:
    state = report_state(match.get("reports") or [], acting_reg.get("id"))
    registrations = await _registrations_for_match(match)
    regs_by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
    own, proposal = state["own"], state["proposal"]
    return {
        "status": state["status"],
        "own_summary": results_summary(own.get("results"), regs_by_id) if own else None,
        "own_at": own.get("at") if own else None,
        "proposal": public_report_results(proposal.get("results")) if proposal else None,
        "proposal_summary": results_summary(proposal.get("results"), regs_by_id) if proposal else None,
    }


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
    policy = _match_policy(match, tournament, stage)
    can_submit_result = await _can_submit_result_for_match(match, user)
    can_player_report = bool(acting_reg and _players_can_report(policy) and _accepts_reports(match))
    can_propose_schedule = bool(user and await _can_act_for_match(match, user) and _schedule_proposals_enabled(policy))
    round_number = match.get("matchday_number") or match.get("round")
    league_like = (tournament or {}).get("format") in {"league", "round_robin"} or (stage or {}).get("stage_type") in {"league", "round_robin_groups", "ffa_league"}
    matchday_label = match.get("matchday_label") or match.get("round_name")
    if not matchday_label:
        prefix = "Spieltag" if league_like else "Runde"
        matchday_label = f"{prefix} {round_number}" if round_number else "Match"
    canonical_match = await canonical_match_for_source(db, match, collection)
    # Ergebnis melden (#1132): wo die Meldungen für die eigene Seite stehen - aus dem vollen Datensatz, bevor die
    # öffentliche Sicht die Meldungen der Gegenseite auf Zeit und Seite kürzt. Zum Bestätigen sieht die eigene Seite
    # Plätze und Spielstand der Gegenseite, nie ihre Notiz oder ihren Beweis-Link.
    report_view = None
    if acting_reg and _players_can_report(policy):
        report_view = await _report_view(db, match, acting_reg)
    # Dispute (#1134): jeder Teilnehmer in jedem Modus - vor dem Ergebnis immer, danach bis 30 Minuten nach dem
    # Ergebnis oder bis das nächste Spiel des Siegers beginnt. Website und App zeigen genau das.
    window = await dispute_window(db, match) if acting_reg else {"open": False, "until": None}
    # Aufruf (#1137): aufgerufen um, antreten bis, Station - für den Countdown auf der Matchseite (wie am TV).
    call = await call_view(db, match)
    if not await _sees_internal(match, user):
        viewer_id = (user or {}).get("id")
        match = public_match_view(match, viewer_id)
        canonical_match = public_match_view(canonical_match, viewer_id)
    return {
        "match": match,
        "canonical_match": canonical_match,
        "tournament": public_tournament_view(tournament),
        "stage": stage,
        "participants": await _match_participants(match, user),
        "schedule_proposals": proposals,
        "can_act": bool(user and await _can_act_for_match(match, user)),
        "can_report_score": can_player_report,
        "can_player_report_result": can_player_report,
        "report_state": report_view,
        "allows_draw": match_allows_draw(match),
        "can_submit_result": can_submit_result,
        "can_staff_submit_result": can_submit_result,
        "can_propose_schedule": can_propose_schedule,
        "can_manage_schedule": can_propose_schedule,
        "can_dispute": bool(acting_reg and window["open"]),
        "dispute_until": window["until"],
        "in_dispute": str(match.get("status") or "") == "disputed",
        "call": call,
        "can_forfeit": await _can_forfeit_match(match, user),
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
    policy = _match_policy(match, tournament, stage)
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
    policy = _match_policy(match, tournament, stage)
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
            # Der geltende Termin steht in der Partie, mit Quelle (#235).
            "schedule_source": "accepted",
            "schedule_written_at": now_iso,
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
        await _rewrite_matchday_schedule(db, match.get("tournament_id"))
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
    messages = [word_filter.public_moderation(m) for m in messages if word_filter.visible_to(m, (user or {}).get("id"))]
    users = await _public_user_map(list({m.get("user_id") for m in messages if m.get("user_id")}))
    for message in messages:
        message["author"] = users.get(message.get("user_id"))
    return messages


@router.post("/{match_id}/chat")
async def post_match_chat(match_id: str, body: MatchChatCreate, request: Request, me: dict = Depends(get_current_user)):
    db = get_db()
    await moderation_standing.require_chat_allowed(db, me)
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
    text = body.message.strip()
    if not text and not body.attachment_ids and not body.sticker_id:
        raise HTTPException(status_code=400, detail="Nachricht darf nicht leer sein")
    from services.chat_attachments import claim_attachments
    from services.stickers import sticker_for_message
    message_id = new_id()
    sticker = await sticker_for_message(db, body.sticker_id, text, body.attachment_ids, me["id"])
    attachments = await claim_attachments(db, me["id"], body.attachment_ids, {
        "type": "match", "match_id": match_id, "message_id": message_id,
    })
    now_iso = now_utc().isoformat()
    doc = {
        "id": message_id,
        "match_id": match_id,
        "tournament_id": match.get("tournament_id"),
        "stage_id": match.get("stage_id"),
        "user_id": me["id"],
        "message": text,
        "attachments": attachments,
        "sticker": sticker,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    verdict = await word_filter.screen_message(db, doc, kind="match", context={"match_id": match_id, "tournament_id": match.get("tournament_id")})
    await db.match_chat_messages.insert_one(doc)
    if verdict != "hold":
        try:
            from services import xp
            await xp.grant(me["id"], "community_chat", doc["id"])
        except Exception:  # noqa: BLE001
            pass
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
    match, _collection = await _find_match_any(match_id)
    await _ensure_match_tournament_unlocked(db, match)
    await ensure_tournament_accepts_results(db, match["tournament_id"])
    await _require_result_permission(me, match)
    try:
        async with mutation_lock(db, tournament_write_resource(match["tournament_id"])):
            match, _collection = await _find_match_any(match_id)
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
    if await _sees_internal(m, user):
        return m
    return public_match_view(m, (user or {}).get("id"))


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
            # Von der Turnierleitung gesetzt: gilt, bis sie es ändert - der Spieltag-Lauf fasst es nicht an (#235).
            # Leer gesetzt heißt: die Regel gilt wieder.
            updates["schedule_source"] = "manual" if updates["scheduled_at"] else None
        if updates.get("scheduled_at") and v2_match.get("status") in {"pending", "ready", "preview"} and "status" not in updates:
            updates["status"] = "scheduled"
        await ensure_station_slot_available(db, v2_match, updates, "matches_v2")
        if updates and all(v2_match.get(key) == value for key, value in updates.items()):
            return {**v2_match, "idempotent_replay": True}
        updates["updated_at"] = now_utc().isoformat()
        change: dict = {"$set": updates}
        # Ein Aufruf (#1122) endet, wenn das Spiel losgeht, entschieden wird oder an eine andere Station wandert.
        status_moved = "status" in updates and updates["status"] not in CALL_OPEN_STATUSES
        station_moved = "station_id" in updates and updates["station_id"] != v2_match.get("station_id")
        if v2_match.get("called_at") and (status_moved or station_moved):
            change["$unset"] = {"called_at": ""}
        await db.matches_v2.update_one({"id": match_id}, change)
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
    my_registration = await _acting_registration_for_match(match, me)
    if not my_registration:
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")
    status = str(match.get("status") or "")
    if status == "disputed":
        raise HTTPException(status_code=409, detail="Dieses Spiel ist in Klärung – die Turnierleitung entscheidet.")
    if status in REPORT_CLOSED_STATUSES:
        raise HTTPException(status_code=409, detail="Dieses Spiel ist schon entschieden.")

    # Jede Meldung wird geprüft wie ein Ergebnis der Turnierleitung: alle Teilnehmer genau einmal, Plätze passend
    # zum Spielstand. So vergleicht der Server zwei Meldungen inhaltlich - nicht nur ihre Schreibweise.
    try:
        results = public_report_results(normalize_v2_results(match, [entry.model_dump(exclude_none=True) for entry in body.results]))
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if is_duplicate_report(match, me["id"], results):
        match.pop("_id", None)
        match["idempotent_replay"] = True
        return match

    entry = report_entry(me["id"], my_registration["id"], results, proof_url=body.screenshot_url, note=body.note)
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
        conflict = reports_conflict(stored.get("reports") or [])
        # Wer gemeldet hat, sieht auf der Seite, wie es weitergeht; die anderen bekommen eine Nachricht (#1132).
        try:
            if conflict:
                await notify_report_conflict(db, stored, my_registration["id"], me.get("id"))
            else:
                await notify_result_reported(db, stored, entry, me.get("id"))
        except Exception as exc:  # noqa: BLE001 - eine Nachricht hält keine Meldung auf
            logger.warning("Report notification failed for match=%s type=%s", _log_safe(match.get("id")), type(exc).__name__)
        stored["idempotent_replay"] = False
        stored["awaiting_confirmation"] = True
        stored["report_status"] = "conflict" if conflict else "waiting"
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
    policy = _match_policy(m, tournament, stage)
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
    acting_reg = await _acting_registration_for_match(m, me)
    if not _is_staff(me) and not acting_reg:
        raise HTTPException(status_code=403, detail="Nicht Teilnehmer dieses Matches")
    reason = body.reason.strip()
    if is_duplicate_dispute(m, me["id"], reason):
        m.pop("_id", None)
        m["idempotent_replay"] = True
        return m
    if not reason:
        raise HTTPException(status_code=422, detail="Bitte einen Grund angeben.")
    # Wer bis wann (#1134): vor dem Ergebnis immer, danach 30 Minuten - und nur, bis das nächste Spiel des Siegers
    # beginnt. Die Turnierleitung korrigiert ohnehin direkt.
    if acting_reg and not (await dispute_window(db, m))["open"]:
        raise HTTPException(status_code=409, detail=DISPUTE_CLOSED_DETAIL)
    entry = {**dispute_entry(me["id"], reason), **({"registration_id": acting_reg["id"]} if acting_reg else {})}
    await getattr(db, collection).update_one({"id": match_id}, {
        "$push": {"disputes": entry},
        "$set": {"status": "disputed", "updated_at": now_utc().isoformat()},
    })
    await _audit_match_action(db, "match.dispute.open", m, me.get("id"), {
        "reason_length": len((body.reason or "").strip()),
    })
    m = await getattr(db, collection).find_one({"id": match_id}, {"_id": 0})
    # Die Turnierleitung erfährt sofort davon, die anderen Spieler des Spiels auch (#1134) - niemand sonst.
    try:
        await notify_dispute_opened(db, m, entry, me.get("id"), (acting_reg or {}).get("id"))
    except Exception as exc:  # noqa: BLE001 - eine Nachricht hält keinen Dispute auf
        logger.warning("Dispute notification failed for match=%s type=%s", _log_safe(match_id), type(exc).__name__)
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
