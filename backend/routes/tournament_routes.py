"""Tournament + bracket routes."""
import csv
import io
import re
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse, StreamingResponse
from typing import Optional
from datetime import datetime, timedelta, timezone
import math
from pydantic import BaseModel, Field
from database import get_db
from auth import get_current_user, require_admin, get_optional_user
from services.visibility import user_can_see
from services.public_phase import derive_public_phase
from services.station_labels import attach_station_info
from services.tournament_permissions import (
    CHECKIN_STAFF_ROLES,
    PARTICIPANT_STAFF_ROLES,
    READ_STAFF_ROLES,
    RESULT_STAFF_ROLES,
    STRUCTURE_STAFF_ROLES,
    assigned_tournament_ids,
    has_tournament_staff_permission,
    require_tournament_staff_permission,
)
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.slug_utils import apply_slug_history, find_by_slug_or_history, slug_source_for_update, unique_slug
from models import (
    TournamentCreate, TournamentUpdate, RegistrationCreate, RegistrationUpdate,
    RegistrationAdminCreate,
    TournamentStaffAssignmentCreate, TournamentStaffAssignmentUpdate,
    TournamentStageCreate, TournamentStageUpdate,
    now_utc, new_id,
)
from bracket_engine import generate_bracket, compute_round_robin_standings
from bracket_extensions import (
    generate_swiss_round, compute_swiss_standings, generate_groups, compute_group_standings,
)
from services.user_notifications import create_user_notification

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
REGISTRATION_CHECKIN_STATUSES = {"approved", "checked_in", "no_show"}
MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]{2,32})")
LEGACY_AUTO_PREVIEW_FORMATS = {"single_elim", "double_elim", "round_robin", "league"}
MAX_INITIAL_PREVIEW_MATCHES = 512
BRACKET_REFRESH_LOCKED_STATUSES = {"check_in", "live", "paused", "completed", "results_published", "archived", "cancelled"}
TOURNAMENT_MUTATION_LOCKED_DETAIL = "Turnier ist gesperrt und kann nur noch angesehen oder geloescht werden."
LOCKABLE_TOURNAMENT_STATUSES = {"completed", "results_published", "archived", "cancelled"}
MATCH_PLAN_FIELDS = ("scheduled_at", "duration_minutes", "station_id", "admin_note", "map", "best_of")
MATCH_PLAN_ACTIVE_STATUSES = {"preview", "pending", "ready", "scheduled", "in_progress", "waiting_result"}
MATCH_PLAN_DONE_STATUSES = {"completed", "forfeit", "cancelled", "archived", "bye"}


def _safe_regex(value: str | None, max_len: int = 80) -> str:
    return re.escape((value or "").strip()[:max_len])


class TournamentChatCreate(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class TournamentBracketStructurePayload(BaseModel):
    stage_type: Optional[str] = None
    match_type: Optional[str] = None
    name: Optional[str] = None
    settings: dict = Field(default_factory=dict)


def _next_power_of_two(n: int) -> int:
    return 1 if n <= 1 else 2 ** math.ceil(math.log2(n))


def _preview_seed_reg(seed: int, tid: str) -> dict:
    return {
        "id": f"preview-seed-{seed}",
        "tournament_id": tid,
        "user_id": None,
        "team_id": None,
        "status": "approved",
        "preview_status": "preview",
        "display_name": f"Seed {seed}",
        "ingame_name": f"Seed {seed}",
        "seed": seed,
        "is_preview": True,
    }


def _preview_registrations_for_tournament(t: dict) -> list[dict]:
    count = _next_power_of_two(max(2, int(t.get("max_participants") or 2)))
    return [_preview_seed_reg(seed, t["id"]) for seed in range(1, count + 1)]


def _mixed_preview_registrations_for_tournament(t: dict, registrations: list[dict]) -> list[dict]:
    """Fill the configured bracket size with real approved entries plus preview seeds."""
    count = _next_power_of_two(max(2, int(t.get("max_participants") or 2)))
    real_regs = [
        reg
        for reg in registrations
        if reg.get("status") in {"approved", "checked_in"} and not reg.get("is_preview")
    ][:count]
    mixed = [dict(reg) for reg in real_regs]
    for seed in range(len(mixed) + 1, count + 1):
        mixed.append(_preview_seed_reg(seed, t["id"]))
    return mixed


def _estimate_legacy_preview_matches(tournament: dict) -> int:
    fmt = tournament.get("format") or "single_elim"
    count = _next_power_of_two(max(2, int(tournament.get("max_participants") or 2)))
    if fmt == "single_elim":
        return max(1, count - 1) + (1 if tournament.get("bronze_match") and count >= 4 else 0)
    if fmt == "double_elim":
        rounds = int(math.log2(count))
        loser_rounds = max(1, 2 * (rounds - 1))
        loser_matches = 0
        current = max(1, count // 4)
        for round_index in range(loser_rounds):
            loser_matches += max(1, current)
            if round_index % 2 == 1:
                current = max(1, current // 2)
        return max(1, count - 1) + loser_matches + 2
    if fmt == "round_robin":
        return (count * (count - 1)) // 2
    if fmt == "league":
        return count * (count - 1)
    return 0


def _can_create_initial_legacy_preview(tournament: dict) -> bool:
    if (tournament.get("format") or "single_elim") in {"custom_bracket", "ffa_custom_bracket"}:
        return True
    if (tournament.get("format") or "single_elim") not in LEGACY_AUTO_PREVIEW_FORMATS:
        return False
    return 0 < _estimate_legacy_preview_matches(tournament) <= MAX_INITIAL_PREVIEW_MATCHES


def _legacy_plan_key(match: dict) -> tuple:
    return (
        "legacy",
        match.get("bracket") or "",
        int(match.get("round") or 0),
        int(match.get("match_index") if match.get("match_index") is not None else match.get("order") or match.get("position") or 0),
    )


def _v2_plan_key(match: dict) -> tuple:
    return (
        "v2",
        int(match.get("stage_number") or 0),
        match.get("section") or "",
        match.get("match_key") or "",
        int(match.get("round") or 0),
        int(match.get("order") or match.get("position") or 0),
    )


def _collect_match_plan(legacy_matches: list[dict] | None = None, v2_matches: list[dict] | None = None) -> dict[tuple, dict]:
    plan: dict[tuple, dict] = {}
    for match in legacy_matches or []:
        fields = {field: match.get(field) for field in MATCH_PLAN_FIELDS if match.get(field) is not None}
        if fields:
            plan[_legacy_plan_key(match)] = fields
    for match in v2_matches or []:
        fields = {field: match.get(field) for field in MATCH_PLAN_FIELDS if match.get(field) is not None}
        if fields:
            plan[_v2_plan_key(match)] = fields
    return plan


def _apply_match_plan(matches: list[dict], plan: dict[tuple, dict], key_fn) -> list[dict]:
    for match in matches:
        fields = plan.get(key_fn(match))
        if not fields:
            continue
        match.update(fields)
        if fields.get("scheduled_at") and match.get("status") in {"preview", "pending", "ready", "scheduled"}:
            match["status"] = "scheduled"
    return matches


def _parse_plan_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _plan_duration(match: dict, tournament: dict | None = None) -> int:
    tournament = tournament or {}
    raw = match.get("duration_minutes") or (match.get("settings") or {}).get("duration_minutes") or tournament.get("match_duration_minutes") or 30
    try:
        return max(1, int(raw))
    except Exception:
        return 30


def _plan_match_label(match: dict) -> str:
    return (
        match.get("match_key")
        or match.get("round_name")
        or (f"Spiel #{int(match.get('match_index') or 0) + 1}" if match.get("match_index") is not None else None)
        or match.get("id")
        or "Match"
    )


def _plan_match_sort(match: dict) -> tuple:
    scheduled = _parse_plan_dt(match.get("scheduled_at")) or datetime.max.replace(tzinfo=timezone.utc)
    return (
        scheduled,
        int(match.get("stage_number") or 0),
        str(match.get("section") or match.get("bracket") or ""),
        int(match.get("round") or 0),
        int(match.get("order") or match.get("position") or match.get("match_index") or 0),
        str(match.get("match_key") or match.get("id") or ""),
    )


def _plan_station_label(match: dict) -> str:
    return match.get("station_label") or match.get("station_name") or (match.get("station") or {}).get("name") or match.get("station_id") or ""


def _has_playable_participants(match: dict) -> bool:
    if match.get("slots"):
        return len([slot for slot in match.get("slots") or [] if slot.get("registration_id")]) >= 1
    return bool(match.get("participant_a_id") or match.get("participant_b_id"))


async def _collect_plan_matches(db, tid: str) -> tuple[list[dict], dict]:
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    legacy = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    v2 = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    for match in legacy:
        match["_collection"] = "matches"
    for match in v2:
        match["_collection"] = "matches_v2"
    matches = legacy + v2
    await attach_station_info(db, matches)
    return sorted(matches, key=_plan_match_sort), tournament


def _planning_report(matches: list[dict], tournament: dict | None = None) -> dict:
    tournament = tournament or {}
    warnings: list[dict] = []
    errors: list[dict] = []
    planned_by_station: dict[str, list[dict]] = {}
    active_matches = [
        match for match in matches
        if match.get("status") not in MATCH_PLAN_DONE_STATUSES
    ]
    for match in active_matches:
        label = _plan_match_label(match)
        if not match.get("scheduled_at"):
            warnings.append({"type": "missing_time", "severity": "warning", "match_id": match.get("id"), "label": label, "message": f"{label}: keine Startzeit geplant."})
        if not match.get("station_id"):
            warnings.append({"type": "missing_station", "severity": "warning", "match_id": match.get("id"), "label": label, "message": f"{label}: keine Station geplant."})
        scheduled = _parse_plan_dt(match.get("scheduled_at"))
        if scheduled and match.get("station_id"):
            planned_by_station.setdefault(match["station_id"], []).append({
                "match": match,
                "start": scheduled,
            })
    for station_id, rows in planned_by_station.items():
        enriched = []
        for row in rows:
            duration = _plan_duration(row["match"], tournament)
            enriched.append({**row, "end": row["start"] + timedelta(minutes=duration), "duration": duration})
        enriched.sort(key=lambda row: row["start"])
        for index, current in enumerate(enriched):
            for other in enriched[index + 1:]:
                if other["start"] >= current["end"]:
                    break
                station = _plan_station_label(current["match"]) or station_id
                msg = f"{station}: {_plan_match_label(current['match'])} überschneidet sich mit {_plan_match_label(other['match'])}."
                errors.append({
                    "type": "station_overlap",
                    "severity": "error",
                    "station_id": station_id,
                    "station": station,
                    "match_id": current["match"].get("id"),
                    "other_match_id": other["match"].get("id"),
                    "message": msg,
                })
    return {
        "ok": not errors,
        "error_count": len(errors),
        "warning_count": len(warnings),
        "checked_matches": len(active_matches),
        "errors": errors,
        "warnings": warnings,
    }


def _stage_defaults_for_tournament_format(tournament: dict, body: TournamentBracketStructurePayload | None = None) -> dict | None:
    fmt = (tournament.get("format") or "single_elim")
    settings = dict((body.settings if body else {}) or {})
    stage_type = (body.stage_type if body else None) or {
        "single_elim": "single_elimination",
        "double_elim": "double_elimination",
        "custom_bracket": "custom_bracket",
        "ffa_custom_bracket": "ffa_custom_bracket",
    }.get(fmt)
    if not stage_type:
        return None
    match_type = (body.match_type if body else None) or ("ffa" if stage_type.startswith("ffa_") else "duel")
    settings.setdefault("match_size", 4 if match_type == "ffa" else 2)
    settings.setdefault("min_players", 2)
    settings.setdefault("qualifiers_per_match", 2 if match_type == "ffa" else 1)
    settings.setdefault("duration_minutes", int(tournament.get("match_duration_minutes") or 30))
    settings.setdefault("score_type", "points")
    settings.setdefault("calculation", "points")
    return {
        "name": (body.name if body and body.name else "Turnierbaum"),
        "number": 1,
        "stage_type": stage_type,
        "match_type": match_type,
        "settings": settings,
        "status": "pending",
    }


def _iso(dt):
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return dt


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except ValueError:
        return None


def _is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


async def _is_tournament_staff(tid: str, user: dict | None, roles: set[str] | None = None) -> bool:
    return await has_tournament_staff_permission(user, tid, roles or READ_STAFF_ROLES)


def _is_tournament_locked(tournament: dict | None) -> bool:
    return bool(tournament and tournament.get("locked_at"))


async def _ensure_tournament_unlocked(db, tid: str) -> dict:
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if _is_tournament_locked(tournament):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
    return tournament


async def _user_tournament_participation_ids(db, user: dict | None) -> set[str]:
    if not user:
        return set()
    team_ids = [
        row["team_id"] for row in await db.team_members.find(
            {"user_id": user["id"]},
            {"_id": 0, "team_id": 1},
        ).to_list(200)
        if row.get("team_id")
    ]
    query = {
        "status": {"$nin": ["rejected", "no_show"]},
        "$or": [{"user_id": user["id"]}],
    }
    if team_ids:
        query["$or"].append({"team_id": {"$in": team_ids}})
    return set(await db.tournament_registrations.distinct("tournament_id", query))


async def _user_participates_in_tournament(db, tid: str, user: dict | None) -> bool:
    if not user:
        return False
    participant_ids = await _user_tournament_participation_ids(db, user)
    return tid in participant_ids


async def _can_use_tournament_chat(tournament: dict, user: dict | None) -> bool:
    if not user:
        return False
    if _is_staff(user) or await _is_tournament_staff(tournament["id"], user):
        return True
    if tournament.get("show_chat") is not True:
        return False
    db = get_db()
    own_registration = await db.tournament_registrations.find_one(
        {
            "tournament_id": tournament["id"],
            "user_id": user["id"],
            "status": {"$in": ["approved", "checked_in"]},
        },
        {"id": 1},
    )
    if own_registration:
        return True
    user_team_ids = [
        row["team_id"] for row in await db.team_members.find(
            {"user_id": user["id"]},
            {"_id": 0, "team_id": 1},
        ).to_list(100)
        if row.get("team_id")
    ]
    if not user_team_ids:
        return False
    team_registration = await db.tournament_registrations.find_one(
        {
            "tournament_id": tournament["id"],
            "team_id": {"$in": user_team_ids},
            "status": {"$in": ["approved", "checked_in"]},
        },
        {"id": 1},
    )
    return bool(team_registration)


def _user_label(user: dict | None) -> str:
    return (user or {}).get("display_name") or (user or {}).get("username") or "Benutzer"


async def _tournament_chat_user_ids(db, tid: str) -> set[str]:
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0, "user_id": 1, "team_id": 1},
    ).to_list(1000)
    user_ids = {row.get("user_id") for row in regs if row.get("user_id")}
    team_ids = {row.get("team_id") for row in regs if row.get("team_id")}
    if team_ids:
        teams = await db.teams.find({"id": {"$in": list(team_ids)}}, {"_id": 0, "member_ids": 1}).to_list(500)
        for team in teams:
            user_ids.update(team.get("member_ids") or [])
    staff_rows = await db.tournament_staff_assignments.find(
        {"tournament_id": tid, "is_active": {"$ne": False}},
        {"_id": 0, "user_id": 1},
    ).to_list(500)
    user_ids.update(row.get("user_id") for row in staff_rows if row.get("user_id"))
    return {user_id for user_id in user_ids if user_id}


async def _notify_tournament_mentions(db, tournament: dict, sender: dict, message: dict) -> None:
    handles = {m.lower() for m in MENTION_RE.findall(message.get("message") or "")}
    if not handles:
        return
    candidates = await db.users.find(
        {
            "is_active": True,
            "is_banned": {"$ne": True},
            "$or": [{"username": {"$regex": f"^{re.escape(handle)}$", "$options": "i"}} for handle in handles],
        },
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "role": 1},
    ).to_list(100)
    allowed_ids = await _tournament_chat_user_ids(db, tournament["id"])
    for member in candidates:
        if member.get("id") == sender.get("id"):
            continue
        if member.get("id") not in allowed_ids and member.get("role") not in STAFF_ROLES:
            continue
        await create_user_notification(
            member["id"],
            title=f"Erwähnung im Turnier-Chat: {tournament.get('title')}",
            body=f"{_user_label(sender)} hat dich erwähnt: {(message.get('message') or '')[:140]}",
            url=f"/tournaments/{tournament.get('slug') or tournament['id']}",
            kind="tournament_chat_mention",
            meta={"tournament_id": tournament["id"], "message_id": message["id"]},
        )


async def _get_visible_tournament(tid: str, user: dict | None) -> dict:
    db = get_db()
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_staff = _is_staff(user)
    is_assigned = await _is_tournament_staff(tid, user)
    if t.get("status") == "draft" and not (is_staff or is_assigned):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_participant = await _user_participates_in_tournament(db, tid, user)
    if t.get("is_public") is False and not (is_staff or is_assigned or is_participant):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not (is_staff or is_assigned or is_participant) and not await user_can_see(user, t.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Turnier ist nicht sichtbar")
    return t


def _public_registration(reg: dict, user: dict | None, is_staff: bool) -> dict:
    if is_staff:
        return reg
    is_self = bool(user and reg.get("user_id") == user.get("id"))
    out = {
        "id": reg.get("id"),
        "tournament_id": reg.get("tournament_id"),
        "status": reg.get("status"),
        "display_name": reg.get("display_name") or reg.get("ingame_name"),
        "ingame_name": reg.get("ingame_name"),
        "team_id": reg.get("team_id"),
        "seed": reg.get("seed"),
        "created_at": reg.get("created_at"),
    }
    if is_self:
        out["user_id"] = reg.get("user_id")
    return out


def _is_team_tournament(tournament: dict) -> bool:
    return (tournament.get("team_mode") or "solo") != "solo"


def _normalize_team_settings(doc: dict) -> dict:
    mode = doc.get("team_mode") or "solo"
    if mode not in {"solo", "team"}:
        raise HTTPException(status_code=422, detail="Teilnahme muss 'solo' oder 'team' sein")
    if mode == "solo":
        doc["team_mode"] = "solo"
        doc["team_size"] = 1
        return doc
    team_size = int(doc.get("team_size") or 2)
    if team_size < 2 or team_size > 6:
        raise HTTPException(status_code=422, detail="Spieler pro Team muss zwischen 2 und 6 liegen")
    doc["team_mode"] = "team"
    doc["team_size"] = team_size
    return doc


def _can_register_team(team: dict, user: dict) -> bool:
    return (
        team.get("leader_id") == user["id"]
        or user["id"] in (team.get("co_leader_ids") or [])
        or user.get("role") in STAFF_ROLES
    )


async def _validate_registration_actor(db, tournament: dict, body: RegistrationCreate, user: dict) -> dict | None:
    if not _is_team_tournament(tournament):
        if body.team_id:
            raise HTTPException(status_code=400, detail="Dieses Turnier ist als Einzelspieler-Turnier eingestellt")
        return None
    if not body.team_id:
        raise HTTPException(status_code=400, detail="Für dieses Turnier muss ein Team ausgewählt werden")
    team = await db.teams.find_one({"id": body.team_id}, {"_id": 0})
    if not team:
        raise HTTPException(status_code=404, detail="Team nicht gefunden")
    if not _can_register_team(team, user):
        raise HTTPException(status_code=403, detail="Nur Team-Leader oder Co-Leader dürfen ein Team anmelden")
    if user["id"] not in (team.get("member_ids") or []):
        raise HTTPException(status_code=403, detail="Du bist kein Mitglied dieses Teams")
    existing_team = await db.tournament_registrations.find_one(
        {"tournament_id": tournament["id"], "team_id": team["id"]},
        {"id": 1},
    )
    if existing_team:
        raise HTTPException(status_code=409, detail="Dieses Team ist bereits angemeldet")
    return team


def _registration_error(t: dict) -> str | None:
    if t.get("registration_enabled") is False or t.get("is_invite_only"):
        return "Anmeldung für dieses Turnier ist deaktiviert"
    if t.get("status") != "registration_open":
        return "Anmeldung für dieses Turnier geschlossen"
    now = datetime.now(timezone.utc)
    open_from = _parse_dt(t.get("registration_open_from"))
    open_until = _parse_dt(t.get("registration_open_until"))
    if open_from and now < open_from:
        return "Anmeldung ist noch nicht geöffnet"
    if open_until and now > open_until:
        return "Anmeldung ist bereits beendet"
    return None


async def _is_active_club_member(db, user: dict) -> bool:
    if user.get("is_club_member"):
        return True
    membership = await db.memberships.find_one(
        {"user_id": user.get("id"), "member_status": {"$in": ["active", "honorary"]}},
        {"_id": 0, "id": 1},
    )
    return bool(membership)


def _required_game_fields(game: dict | None) -> list[dict]:
    fields = []
    for field in (game or {}).get("effective_player_id_fields") or (game or {}).get("player_id_fields") or []:
        if isinstance(field, dict) and field.get("required") is not False and field.get("key"):
            fields.append(field)
    return fields


async def _enrich_game_identity(db, game: dict | None) -> dict | None:
    if not game:
        return None
    parent = None
    if game.get("parent_game_id"):
        parent = await db.games.find_one({"id": game.get("parent_game_id")}, {"_id": 0})
    name = (game.get("name") or "").strip()
    parent_name = ((parent or {}).get("name") or "").strip()
    if game.get("kind") == "edition" and parent_name and name and not name.lower().startswith(f"{parent_name.lower()}:") and name.lower() != parent_name.lower():
        game["display_name"] = f"{parent_name}: {name}"
    else:
        game["display_name"] = name
    if parent:
        game["parent_game"] = {
            "id": parent.get("id"),
            "name": parent.get("name"),
            "display_name": parent.get("display_name") or parent.get("name"),
            "slug": parent.get("slug"),
            "short_name": parent.get("short_name"),
        }
    source = game
    source_id = game.get("identity_source_game_id")
    if not source_id and game.get("inherit_player_ids") is not False:
        source_id = game.get("parent_game_id")
    if source_id:
        source = await db.games.find_one({"id": source_id}, {"_id": 0}) or game
    seen = set()
    fields = []
    for field in (source.get("player_id_fields") or []) + (game.get("player_id_fields") or []):
        if not isinstance(field, dict) or not field.get("key") or field["key"] in seen:
            continue
        seen.add(field["key"])
        fields.append(field)
    game["identity_game_slug"] = source.get("slug") or game.get("slug")
    game["identity_game_name"] = source.get("name") or game.get("name")
    game["effective_player_id_fields"] = fields
    return game


async def _audit_tournament_action(db, action: str, actor_id: str | None,
                                   target_id: str, data: dict | None = None) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "target_id": target_id,
        "actor_id": actor_id,
        "data": data or {},
        "created_at": now_utc().isoformat(),
    })


async def _generate_legacy_bracket_docs(db, tournament: dict, actor_id: str | None,
                                        preview: bool = False, force: bool = False,
                                        set_live: bool = False) -> dict:
    tid = tournament["id"]
    existing_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan(existing_matches, [])
    can_replace_preview = bool(existing_matches) and all(m.get("is_preview") for m in existing_matches)
    if existing_matches and not force and not can_replace_preview:
        raise HTTPException(status_code=409, detail="Bracket hat bereits Matches. Mit force=true neu generieren.")

    if preview:
        registrations = _preview_registrations_for_tournament(tournament)
    else:
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
            {"_id": 0},
        ).to_list(5000)
        if len(registrations) < 2:
            raise HTTPException(status_code=400, detail="Mindestens 2 Teilnehmer benötigt")

    matches = generate_bracket(tournament, registrations, preview=preview)
    if not matches:
        raise HTTPException(status_code=400, detail="Für dieses Format ist kein automatischer Bracket-Generator aktiv.")
    _apply_match_plan(matches, match_plan, _legacy_plan_key)

    if existing_matches:
        await db.matches.delete_many({"tournament_id": tid})
    await db.matches.insert_many(matches)
    if set_live and not preview:
        await db.tournaments.update_one({"id": tid}, {"$set": {"status": "live", "updated_at": now_utc().isoformat()}})
    await _audit_tournament_action(
        db,
        "tournament.bracket.generate",
        actor_id,
        tid,
        {
            "match_count": len(matches),
            "format": tournament.get("format"),
            "participant_count": len(registrations),
            "preview": preview,
            "force": force,
        },
    )
    return {"ok": True, "match_count": len(matches), "preview": preview}


async def _create_initial_bracket_preview(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Create a non-destructive empty bracket preview right after tournament creation."""
    if not _can_create_initial_legacy_preview(tournament):
        return None
    try:
        return await _generate_legacy_bracket_docs(
            db,
            tournament,
            actor_id,
            preview=True,
            force=False,
            set_live=False,
        )
    except HTTPException:
        return None


async def _refresh_preview_bracket_after_registration(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Rebuild only an existing preview bracket so new registrations occupy draft slots."""
    if not _can_create_initial_legacy_preview(tournament):
        return None
    tid = tournament["id"]
    existing_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan(existing_matches, [])
    if existing_matches and not all(m.get("is_preview") for m in existing_matches):
        return None
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    if not existing_matches and not registrations:
        return None
    preview_regs = _mixed_preview_registrations_for_tournament(tournament, registrations)
    matches = generate_bracket(tournament, preview_regs, preview=True)
    if not matches:
        return None
    _apply_match_plan(matches, match_plan, _legacy_plan_key)
    if existing_matches:
        await db.matches.delete_many({"tournament_id": tid})
    await db.matches.insert_many(matches)
    await _audit_tournament_action(
        db,
        "tournament.bracket.preview_refresh",
        actor_id,
        tid,
        {
            "match_count": len(matches),
            "participant_count": len(registrations),
            "format": tournament.get("format"),
        },
    )
    return {"ok": True, "match_count": len(matches), "preview": True, "participant_count": len(registrations)}


async def _refresh_stage_previews_after_registration(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Rebuild only preview stage matches so registrations fill draft structure slots."""
    tid = tournament["id"]
    stages = await db.tournament_stages.find(
        {"tournament_id": tid},
        {"_id": 0},
    ).sort("number", 1).to_list(200)
    if not stages:
        return None

    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    changed_stages: list[dict] = []
    total_matches = 0

    for stage in stages:
        existing_matches = await db.matches_v2.find({"stage_id": stage["id"]}, {"_id": 0}).to_list(3000)
        match_plan = _collect_match_plan([], existing_matches)
        if existing_matches and not all(match.get("is_preview") for match in existing_matches):
            continue
        if not existing_matches and not registrations:
            continue
        try:
            matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=True)
        except BracketSchemaError:
            continue
        if not matches:
            continue
        _apply_match_plan(matches, match_plan, _v2_plan_key)

        if existing_matches:
            match_ids = await db.matches_v2.distinct("id", {"stage_id": stage["id"]})
            if match_ids:
                await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
            await db.matches_v2.delete_many({"stage_id": stage["id"]})
        await db.matches_v2.insert_many(matches)
        await db.tournament_stages.update_one(
            {"id": stage["id"]},
            {"$set": {"status": "pending", "updated_at": now_utc().isoformat()}},
        )
        changed_stages.append({
            "stage_id": stage["id"],
            "stage_number": stage.get("number"),
            "stage_type": stage.get("stage_type"),
            "match_count": len(matches),
        })
        total_matches += len(matches)

    if not changed_stages:
        return None

    await _audit_tournament_action(
        db,
        "tournament.stage.preview_refresh",
        actor_id,
        tid,
        {
            "stage_count": len(changed_stages),
            "match_count": total_matches,
            "participant_count": len(registrations),
        },
    )
    return {
        "ok": True,
        "engine": "stages",
        "match_count": total_matches,
        "preview": True,
        "participant_count": len(registrations),
        "stages": changed_stages,
    }


async def _refresh_tournament_previews_after_registration(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Refresh all draft bracket surfaces after participant changes."""
    if tournament.get("status") == "check_in":
        return await _rebuild_checkin_bracket_after_staff_change(db, tournament, actor_id)
    if tournament.get("status") in BRACKET_REFRESH_LOCKED_STATUSES:
        return None
    tid = tournament["id"]
    stage_count = await db.tournament_stages.count_documents({"tournament_id": tid})
    if stage_count:
        stage_update = await _refresh_stage_previews_after_registration(db, tournament, actor_id)
        if stage_update:
            legacy_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
            if legacy_matches and all(match.get("is_preview") for match in legacy_matches):
                await db.matches.delete_many({"tournament_id": tid})
        return stage_update

    legacy_update = await _refresh_preview_bracket_after_registration(db, tournament, actor_id)
    if legacy_update:
        return {**legacy_update, "engine": legacy_update.get("engine") or "legacy"}
    return None


async def _finalize_stage_previews_for_checkin(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Convert stage previews into fixed matches when check-in starts."""
    tid = tournament["id"]
    stages = await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).sort("number", 1).to_list(200)
    if not stages:
        return None
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    if len(registrations) < 2:
        return None

    changed_stages: list[dict] = []
    total_matches = 0
    for stage in stages:
        existing_matches = await db.matches_v2.find({"stage_id": stage["id"]}, {"_id": 0}).to_list(3000)
        match_plan = _collect_match_plan([], existing_matches)
        if existing_matches and not all(match.get("is_preview") for match in existing_matches):
            continue
        try:
            matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=False)
        except BracketSchemaError:
            continue
        if not matches:
            continue
        _apply_match_plan(matches, match_plan, _v2_plan_key)
        if existing_matches:
            match_ids = await db.matches_v2.distinct("id", {"stage_id": stage["id"]})
            if match_ids:
                await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
            await db.matches_v2.delete_many({"stage_id": stage["id"]})
        await db.matches_v2.insert_many(matches)
        await db.tournament_stages.update_one(
            {"id": stage["id"]},
            {"$set": {"status": "ready", "updated_at": now_utc().isoformat()}},
        )
        changed_stages.append({
            "stage_id": stage["id"],
            "stage_number": stage.get("number"),
            "stage_type": stage.get("stage_type"),
            "match_count": len(matches),
        })
        total_matches += len(matches)

    if not changed_stages:
        return None
    await _audit_tournament_action(
        db,
        "tournament.stage.finalize_checkin",
        actor_id,
        tid,
        {
            "stage_count": len(changed_stages),
            "match_count": total_matches,
            "participant_count": len(registrations),
        },
    )
    return {
        "ok": True,
        "engine": "stages",
        "match_count": total_matches,
        "participant_count": len(registrations),
        "stages": changed_stages,
        "preview": False,
    }


async def _finalize_bracket_for_checkin(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Run the final bracket mix once when tournament check-in opens."""
    tid = tournament["id"]
    stage_count = await db.tournament_stages.count_documents({"tournament_id": tid})
    if stage_count:
        finalized = await _finalize_stage_previews_for_checkin(db, tournament, actor_id)
        if finalized:
            legacy_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
            if legacy_matches and all(match.get("is_preview") for match in legacy_matches):
                await db.matches.delete_many({"tournament_id": tid})
        return finalized

    existing_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    v2_matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    can_replace_preview = bool(existing_matches) and all(match.get("is_preview") for match in existing_matches)
    if existing_matches and not can_replace_preview:
        return None
    if v2_matches and not all(_v2_match_can_be_rebuilt(match) for match in v2_matches):
        return None
    if v2_matches:
        match_ids = [match["id"] for match in v2_matches if match.get("id")]
        if match_ids:
            await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
        await db.matches_v2.delete_many({"tournament_id": tid})

    try:
        result = await _generate_legacy_bracket_docs(
            db,
            tournament,
            actor_id,
            preview=False,
            force=can_replace_preview,
            set_live=False,
        )
    except HTTPException:
        return None
    return {**result, "engine": "legacy", "participant_count": await db.tournament_registrations.count_documents({
        "tournament_id": tid,
        "status": {"$in": ["approved", "checked_in"]},
    })}


def _legacy_match_can_be_rebuilt(match: dict) -> bool:
    status = match.get("status") or "pending"
    if match.get("is_preview") or status in {"pending", "ready", "scheduled", "cancelled"}:
        return True
    if status == "completed":
        a_id = match.get("participant_a_id")
        b_id = match.get("participant_b_id")
        winner_id = match.get("winner_id")
        if bool(a_id) != bool(b_id) and winner_id in {a_id, b_id}:
            return True
    return False


def _v2_match_can_be_rebuilt(match: dict) -> bool:
    status = match.get("status") or "pending"
    if match.get("is_preview") or status in {"pending", "ready", "scheduled", "cancelled"}:
        return True
    if status == "completed" and (match.get("result_meta") or {}).get("source") == "auto_bye":
        return True
    return False


async def _rebuild_checkin_bracket_after_staff_change(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Rebuild the fixed check-in bracket after staff changes, until real play starts."""
    tid = tournament["id"]
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    if len(registrations) < 2:
        return None

    legacy_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    v2_matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan(legacy_matches, v2_matches)
    locked_legacy = [m.get("id") for m in legacy_matches if not _legacy_match_can_be_rebuilt(m)]
    locked_v2 = [m.get("id") for m in v2_matches if not _v2_match_can_be_rebuilt(m)]
    if locked_legacy or locked_v2:
        return {
            "ok": False,
            "reason": "matches_started",
            "preview": False,
            "participant_count": len(registrations),
            "locked_match_count": len(locked_legacy) + len(locked_v2),
        }

    stages = await db.tournament_stages.find(
        {"tournament_id": tid},
        {"_id": 0},
    ).sort("number", 1).to_list(200)
    if stages:
        if legacy_matches:
            await db.matches.delete_many({"tournament_id": tid})
        if v2_matches:
            match_ids = [match["id"] for match in v2_matches if match.get("id")]
            if match_ids:
                await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
            await db.matches_v2.delete_many({"tournament_id": tid})

        changed_stages: list[dict] = []
        total_matches = 0
        for stage in stages:
            try:
                matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=False)
            except BracketSchemaError as exc:
                return {
                    "ok": False,
                    "reason": "schema_error",
                    "detail": str(exc),
                    "preview": False,
                    "participant_count": len(registrations),
                }
            if not matches:
                continue
            _apply_match_plan(matches, match_plan, _v2_plan_key)
            await db.matches_v2.insert_many(matches)
            await db.tournament_stages.update_one(
                {"id": stage["id"]},
                {"$set": {"status": "ready", "updated_at": now_utc().isoformat()}},
            )
            changed_stages.append({
                "stage_id": stage["id"],
                "stage_number": stage.get("number"),
                "stage_type": stage.get("stage_type"),
                "match_count": len(matches),
            })
            total_matches += len(matches)

        if not changed_stages:
            return None
        await _audit_tournament_action(
            db,
            "tournament.stage.checkin_rebuild_after_registration",
            actor_id,
            tid,
            {
                "stage_count": len(changed_stages),
                "match_count": total_matches,
                "participant_count": len(registrations),
            },
        )
        return {
            "ok": True,
            "engine": "stages",
            "match_count": total_matches,
            "participant_count": len(registrations),
            "stages": changed_stages,
            "preview": False,
            "reason": "checkin_rebuild",
        }

    try:
        result = await _generate_legacy_bracket_docs(
            db,
            tournament,
            actor_id,
            preview=False,
            force=bool(legacy_matches),
            set_live=False,
        )
    except HTTPException as exc:
        return {
            "ok": False,
            "reason": "generator_error",
            "detail": exc.detail,
            "preview": False,
            "participant_count": len(registrations),
        }
    return {
        **result,
        "engine": "legacy",
        "participant_count": len(registrations),
        "reason": "checkin_rebuild",
    }


async def _replace_registration_in_open_matches(db, tid: str, old_reg_id: str, new_reg: dict,
                                                actor_id: str | None) -> dict:
    new_reg_id = new_reg["id"]
    legacy_matches = await db.matches.find({
        "tournament_id": tid,
        "$or": [{"participant_a_id": old_reg_id}, {"participant_b_id": old_reg_id}],
    }, {"_id": 0}).to_list(1000)
    v2_matches = await db.matches_v2.find({
        "tournament_id": tid,
        "slots.registration_id": old_reg_id,
    }, {"_id": 0}).to_list(1000)
    blocked = [
        m.get("id") for m in [*legacy_matches, *v2_matches]
        if m.get("status") in {"completed", "forfeit"}
    ]
    if blocked:
        raise HTTPException(
            status_code=409,
            detail="Teilnehmer kommt bereits in abgeschlossenen Matches vor. Erst Bracket korrigieren oder neu generieren.",
        )

    now = now_utc().isoformat()
    legacy_count = 0
    for match in legacy_matches:
        update = {"updated_at": now}
        if match.get("participant_a_id") == old_reg_id:
            update["participant_a_id"] = new_reg_id
        if match.get("participant_b_id") == old_reg_id:
            update["participant_b_id"] = new_reg_id
        if match.get("winner_id") == old_reg_id:
            update["winner_id"] = None
        if match.get("loser_id") == old_reg_id:
            update["loser_id"] = None
        next_a = update.get("participant_a_id", match.get("participant_a_id"))
        next_b = update.get("participant_b_id", match.get("participant_b_id"))
        if next_a and next_b and match.get("status") in {"pending", "preview"}:
            update["status"] = "ready"
        await db.matches.update_one({"id": match["id"]}, {"$set": update})
        legacy_count += 1

    v2_count = 0
    for match in v2_matches:
        slots = []
        changed = False
        for slot in match.get("slots") or []:
            slot = dict(slot)
            if slot.get("registration_id") == old_reg_id:
                slot["registration_id"] = new_reg_id
                slot["user_id"] = new_reg.get("user_id")
                slot["status"] = "filled"
                changed = True
            slots.append(slot)
        if not changed:
            continue
        filled = sum(1 for slot in slots if slot.get("status") == "filled" and slot.get("registration_id"))
        min_players = int((match.get("settings") or {}).get("min_players") or 2)
        status = "ready" if filled >= min_players and match.get("status") in {"pending", "preview"} else match.get("status")
        await db.matches_v2.update_one(
            {"id": match["id"]},
            {"$set": {"slots": slots, "status": status, "updated_at": now}},
        )
        v2_count += 1

    await _audit_tournament_action(
        db,
        "tournament.registration.replace_slots",
        actor_id,
        tid,
        {"old_registration_id": old_reg_id, "new_registration_id": new_reg_id, "legacy_matches": legacy_count, "v2_matches": v2_count},
    )
    return {"legacy_matches": legacy_count, "v2_matches": v2_count}


async def _apply_late_checkin_hooks(db, tid: str, user_id: str) -> None:
    try:
        t = await db.tournaments.find_one({"id": tid}, {"_id": 0, "start_date": 1, "check_in_until": 1})
        if t:
            now = now_utc()
            cutoff = t.get("check_in_until") or t.get("start_date")
            if cutoff:
                cutoff_dt = datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
                if cutoff_dt.tzinfo is None:
                    cutoff_dt = cutoff_dt.replace(tzinfo=timezone.utc)
                if now > cutoff_dt:
                    from badges import trigger_negative_incident
                    await trigger_negative_incident(user_id, "afk",
                        {"tournament_id": tid, "reason": "late_checkin",
                         "minutes_late": int((now - cutoff_dt).total_seconds() / 60)})
    except Exception:
        pass


async def _apply_checked_in_badges(user_id: str, tid: str) -> None:
    try:
        from badges import on_checked_in
        await on_checked_in(user_id, tid)
    except Exception:
        pass


async def _enrich_tournament(t: dict, user: dict | None = None) -> dict:
    db = get_db()
    t["public_phase"] = derive_public_phase(t, "tournament")
    if t.get("game_id"):
        g = await db.games.find_one({"id": t["game_id"]}, {"_id": 0})
        t["game"] = await _enrich_game_identity(db, g)
    if t.get("event_id"):
        e = await db.events.find_one({"id": t["event_id"]}, {"_id": 0, "tournaments": 0, "f1_challenges": 0})
        if e and e.get("status") != "draft" and await user_can_see(user, e.get("visibility") or "public"):
            t["event"] = e
    t["participant_count"] = await db.tournament_registrations.count_documents(
        {"tournament_id": t["id"], "status": {"$in": ["approved", "checked_in"]}})
    return t


async def _resolve_tid(slug_or_id: str) -> str:
    """Resolve slug to id if needed. Returns id or raises 404."""
    db = get_db()
    t, _ = await find_by_slug_or_history(db.tournaments, slug_or_id, {"id": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return t["id"]


@router.get("")
async def list_tournaments(status: str | None = None, game_id: str | None = None,
                           event_id: str | None = None, limit: int = 100,
                           include_drafts: bool = False,
                           user=Depends(get_optional_user)):
    db = get_db()
    is_admin = user and user.get("role") in STAFF_ROLES
    assigned_ids = await assigned_tournament_ids(user)
    can_include_drafts = bool(include_drafts and (is_admin or assigned_ids))
    q = {}
    if status:
        if status == "draft" and not can_include_drafts:
            return []
        q["status"] = status
    elif include_drafts and is_admin:
        pass
    elif include_drafts and assigned_ids:
        q["$or"] = [{"status": {"$ne": "draft"}}, {"id": {"$in": assigned_ids}}]
    else:
        q["status"] = {"$ne": "draft"}
    assigned_visible_ids = assigned_ids if include_drafts else []
    participant_visible_ids = await _user_tournament_participation_ids(db, user)
    if game_id:
        q["game_id"] = game_id
    if event_id:
        q["event_id"] = event_id
    safe_limit = max(1, min(int(limit or 100), 500))
    tournaments = await db.tournaments.find(q, {"_id": 0}).sort("created_at", -1).to_list(safe_limit)
    if not is_admin:
        visible = []
        for t in tournaments:
            if t.get("id") in assigned_visible_ids:
                visible.append(t)
            elif t.get("id") in participant_visible_ids:
                visible.append(t)
            elif t.get("status") == "draft":
                continue
            elif t.get("is_public") is not False and await user_can_see(user, t.get("visibility") or "public"):
                visible.append(t)
        tournaments = visible
    for t in tournaments:
        await _enrich_tournament(t, user)
    return tournaments


@router.get("/{slug_or_id}")
async def get_tournament(slug_or_id: str, include_draft: bool = False, user=Depends(get_optional_user)):
    db = get_db()
    t, was_old_slug = await find_by_slug_or_history(db.tournaments, slug_or_id, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_admin = user and user.get("role") in STAFF_ROLES
    is_assigned = await _is_tournament_staff(t["id"], user)
    is_participant = await _user_participates_in_tournament(db, t["id"], user)
    if t.get("status") == "draft" and not (is_admin or is_assigned):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not (is_admin or is_assigned or is_participant) and t.get("is_public") is False:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not (is_admin or is_assigned or is_participant) and not await user_can_see(user, t.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Turnier ist nicht sichtbar")
    if was_old_slug and t.get("slug"):
        return RedirectResponse(url=f"/api/tournaments/{t['slug']}", status_code=301)
    await _enrich_tournament(t, user)
    t["can_manage_results"] = bool(
        is_admin
        or await has_tournament_staff_permission(user, t["id"], RESULT_STAFF_ROLES)
    )
    if t.get("event_id"):
        related_f1_query = {"event_id": t["event_id"]}
        if not is_admin:
            related_f1_query["status"] = {"$ne": "draft"}
        t["related_f1_challenges"] = await db.f1_challenges.find(
            related_f1_query,
            {"_id": 0, "id": 1, "title": 1, "slug": 1, "start_date": 1, "status": 1, "visibility": 1, "registration_enabled": 1, "online_registration_enabled": 1, "registration_open_from": 1, "registration_open_until": 1},
        ).to_list(50)
        if not is_admin:
            visible_f1 = []
            for c in t["related_f1_challenges"]:
                if await user_can_see(user, c.get("visibility") or "public"):
                    c["public_phase"] = derive_public_phase(c, "f1")
                    visible_f1.append(c)
            t["related_f1_challenges"] = visible_f1
        else:
            for c in t["related_f1_challenges"]:
                c["public_phase"] = derive_public_phase(c, "f1")
    return t


@router.get("/{tid}/chat")
async def list_tournament_chat(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tid, me)
    if not await _can_use_tournament_chat(tournament, me):
        raise HTTPException(status_code=403, detail="Turnier-Chat ist nur für Teilnehmer und Turnierleitung sichtbar")
    messages = await db.tournament_chat_messages.find(
        {"tournament_id": tid, "deleted_at": {"$exists": False}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(100)
    messages.reverse()
    user_ids = list({m.get("user_id") for m in messages if m.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1},
    ).to_list(200)}
    for message in messages:
        author = users.get(message.get("user_id")) or {}
        message["author"] = {
            "id": author.get("id"),
            "username": author.get("username"),
            "display_name": author.get("display_name") or author.get("username") or "Benutzer",
            "avatar_url": author.get("avatar_url"),
            "role": author.get("role"),
        }
    return messages


@router.post("/{tid}/chat")
async def post_tournament_chat(tid: str, body: TournamentChatCreate, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tid, me)
    if _is_tournament_locked(tournament):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
    if not await _can_use_tournament_chat(tournament, me):
        raise HTTPException(status_code=403, detail="Turnier-Chat ist nur für Teilnehmer und Turnierleitung sichtbar")
    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nachricht darf nicht leer sein")
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "tournament_id": tid,
        "user_id": me["id"],
        "message": text,
        "created_at": now,
        "updated_at": now,
    }
    await db.tournament_chat_messages.insert_one(doc)
    await _notify_tournament_mentions(db, tournament, me, doc)
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(me["id"])
    except Exception:
        pass
    doc.pop("_id", None)
    doc["author"] = {
        "id": me.get("id"),
        "username": me.get("username"),
        "display_name": me.get("display_name") or me.get("username"),
        "avatar_url": me.get("avatar_url"),
        "role": me.get("role"),
    }
    return doc


@router.post("")
async def create_tournament(body: TournamentCreate, me: dict = Depends(require_admin())):
    db = get_db()
    # Validate game
    if not await db.games.find_one({"id": body.game_id}):
        raise HTTPException(status_code=400, detail="Spiel nicht gefunden")
    doc = body.model_dump()
    doc["slug"] = await unique_slug(db.tournaments, doc.get("slug") or doc.get("title"), fallback="turnier")
    doc["format_label"] = (doc.get("format_label") or "").strip() or None
    if doc.get("format") != "single_elim":
        doc["bronze_match"] = False
    # ISO-serialize datetimes
    for k in ["registration_open_from", "registration_open_until", "check_in_from",
              "check_in_until", "start_date", "end_date"]:
        doc[k] = _iso(doc.get(k))
    doc["id"] = new_id()
    # Allow scheduling directly (announced) — fall back to draft.
    if not doc.get("status"):
        doc["status"] = "draft"
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.tournaments.insert_one(doc)
    auto_preview = await _create_initial_bracket_preview(db, doc, me.get("id"))
    doc.pop("_id", None)
    doc["auto_generated_bracket"] = auto_preview
    return doc


@router.put("/{tid}")
@router.patch("/{tid}")
async def update_tournament(tid: str, body: TournamentUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    if body.game_id and not await db.games.find_one({"id": body.game_id}, {"id": 1}):
        raise HTTPException(status_code=400, detail="Spiel nicht gefunden")
    existing = await _ensure_tournament_unlocked(db, tid)
    raw_updates = body.model_dump(exclude_unset=True)
    if "format_label" in raw_updates:
        raw_updates["format_label"] = (raw_updates.get("format_label") or "").strip() or None
    effective_format = raw_updates.get("format", existing.get("format"))
    if effective_format != "single_elim":
        raw_updates["bronze_match"] = False
    nullable_fields = {
        "description", "platform", "event_id", "registration_open_from",
        "registration_open_until", "check_in_from", "check_in_until",
        "start_date", "end_date", "rules", "prize_pool", "prize_places",
        "stream_link", "twitch_channel", "discord_link", "location",
        "banner_url", "stream_platform", "stream_url", "stream_title", "format_label",
        "result_entry_mode", "schedule_mode",
    }
    updates = {k: v for k, v in raw_updates.items() if v is not None or k in nullable_fields}
    slug_source = slug_source_for_update(raw_updates, existing, "title", fallback="turnier")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.tournaments, slug_source, current_id=tid, fallback="turnier")
        apply_slug_history(existing, updates)
    if "team_mode" in updates or "team_size" in updates:
        normalized_team_settings = _normalize_team_settings({
            "team_mode": updates.get("team_mode", existing.get("team_mode") or "solo"),
            "team_size": updates.get("team_size", existing.get("team_size") or 1),
        })
        updates["team_mode"] = normalized_team_settings["team_mode"]
        updates["team_size"] = normalized_team_settings["team_size"]
    for k in ["registration_open_from", "registration_open_until", "check_in_from",
              "check_in_until", "start_date", "end_date"]:
        if k in updates:
            updates[k] = _iso(updates[k])
    updates["updated_at"] = now_utc().isoformat()
    await db.tournaments.update_one({"id": tid}, {"$set": updates})
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    return t


@router.post("/{tid}/lock")
async def lock_tournament(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    if tournament.get("status") not in LOCKABLE_TOURNAMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Nur beendete, veroeffentlichte, archivierte oder abgesagte Turniere koennen gesperrt werden.")
    now = now_utc().isoformat()
    await db.tournaments.update_one(
        {"id": tid},
        {"$set": {"locked_at": now, "locked_by": me.get("id"), "updated_at": now}},
    )
    await _audit_tournament_action(db, "tournament.lock", me.get("id"), tid, {"status": tournament.get("status")})
    return {"ok": True, "locked_at": now}


@router.post("/{tid}/unlock")
async def unlock_tournament(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    now = now_utc().isoformat()
    await db.tournaments.update_one(
        {"id": tid},
        {"$unset": {"locked_at": "", "locked_by": ""}, "$set": {"updated_at": now}},
    )
    await _audit_tournament_action(db, "tournament.unlock", me.get("id"), tid, {"previous_locked_at": tournament.get("locked_at")})
    return {"ok": True}


@router.delete("/{tid}")
async def delete_tournament(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    v2_match_ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
    await db.tournaments.delete_one({"id": tid})
    await db.tournament_registrations.delete_many({"tournament_id": tid})
    await db.tournament_staff_assignments.delete_many({"tournament_id": tid})
    await db.tournament_stages.delete_many({"tournament_id": tid})
    await db.matches_v2.delete_many({"tournament_id": tid})
    if v2_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
    await db.matches.delete_many({"tournament_id": tid})
    return {"ok": True}


# --- Registrations ---
@router.get("/{tid}/registrations")
async def list_registrations(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t_doc = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user) or await _is_tournament_staff(tid, user)
    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
    user_team_ids = set()
    if user:
        user_team_ids = {
            row.get("team_id")
            for row in await db.team_members.find({"user_id": user["id"]}, {"_id": 0, "team_id": 1}).to_list(100)
            if row.get("team_id")
        }
    if not is_staff and t_doc.get("show_participants") is False:
        regs = [
            r for r in regs
            if user and (r.get("user_id") == user.get("id") or r.get("team_id") in user_team_ids)
        ]
    regs = [_public_registration(r, user, is_staff) for r in regs]
    # enrich user + team
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    team_ids = list({r["team_id"] for r in regs if r.get("team_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    teams = {t["id"]: t for t in await db.teams.find(
        {"id": {"$in": team_ids}}, {"_id": 0}).to_list(500)}
    for r in regs:
        if r.get("user_id"):
            u = users.get(r["user_id"]) or {}
            r["user"] = {"id": u.get("id"), "username": u.get("username"),
                         "display_name": u.get("display_name"), "avatar_url": u.get("avatar_url")}
        if r.get("team_id"):
            t = teams.get(r["team_id"]) or {}
            r["team"] = {"id": t.get("id"), "name": t.get("name"), "tag": t.get("tag"),
                         "logo_url": t.get("logo_url")}
            if user and r.get("team_id") in user_team_ids:
                r["is_mine"] = True
    return regs


@router.get("/{tid}/assignable-users")
async def list_assignable_tournament_users(tid: str, q: str | None = None, limit: int = 200,
                                           me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    query = {"is_banned": {"$ne": True}}
    if q:
        pattern = _safe_regex(q)
        query["$or"] = [
            {"username": {"$regex": pattern, "$options": "i"}},
            {"display_name": {"$regex": pattern, "$options": "i"}},
            {"email": {"$regex": pattern, "$options": "i"}},
        ]
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "avatar_url": 1, "role": 1},
    ).sort("display_name", 1).to_list(max(1, min(int(limit or 200), 500)))
    return users


@router.post("/{tid}/register")
async def register_for_tournament(tid: str, body: RegistrationCreate,
                                   me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _get_visible_tournament(tid, me)
    if _is_tournament_locked(t):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
    if not body.accept_rules or not body.accept_privacy:
        raise HTTPException(status_code=400, detail="Regeln und Datenschutz müssen akzeptiert werden.")
    registration_error = _registration_error(t)
    if registration_error:
        raise HTTPException(status_code=400, detail=registration_error)
    if t.get("block_club_member_registration") and await _is_active_club_member(db, me):
        raise HTTPException(status_code=403, detail="Dieses Turnier ist für externe Teilnehmer vorgesehen. Vereinsmitglieder können sich hier nicht selbst anmelden.")
    existing = await db.tournament_registrations.find_one({"tournament_id": tid, "user_id": me["id"]})
    if existing:
        raise HTTPException(status_code=409, detail="Bereits angemeldet")
    team = await _validate_registration_actor(db, t, body, me)
    game = await db.games.find_one({"id": t.get("game_id")}, {"_id": 0}) if t.get("game_id") else None
    game = await _enrich_game_identity(db, game)
    submitted_ids = body.player_ids or {}
    profile_ids = me.get("game_ids") or {}
    source_slug = game.get("identity_game_slug") if game else None
    profile_source_ids = (profile_ids.get(source_slug) if source_slug else {}) or {}
    profile_game_ids = (profile_ids.get(game.get("slug")) if game else {}) or {}
    player_ids = {**profile_source_ids, **profile_game_ids, **submitted_ids}
    missing = [
        field.get("label") or field.get("key")
        for field in _required_game_fields(game)
        if not str(player_ids.get(field.get("key"), "")).strip()
    ]
    if missing:
        raise HTTPException(status_code=400, detail=f"Für dieses Turnier fehlen Pflicht-IDs: {', '.join(missing)}")
    # Count approved
    count = await db.tournament_registrations.count_documents(
        {"tournament_id": tid, "status": {"$in": ["pending", "approved", "checked_in"]}})
    status = "pending" if count >= t.get("max_participants", 32) else "approved"
    if status == "pending" and count >= t.get("max_participants", 32):
        status = "waitlist"
    reg = {
        "id": new_id(),
        "tournament_id": tid,
        "user_id": me["id"],
        "team_id": team.get("id") if team else None,
        "status": "approved",  # auto-approve by default; admin can flip to manual flow
        "ingame_name": body.ingame_name or (team.get("name") if team else None) or me.get("display_name") or me.get("username"),
        "discord": body.discord or me.get("discord_name"),
        "platform_id": body.platform_id,
        "player_ids": player_ids,
        "notes": body.notes,
        "accepted_rules": body.accept_rules,
        "accepted_privacy": body.accept_privacy,
        "seed": None,
        "display_name": (f"[{team.get('tag')}] {team.get('name')}" if team and team.get("tag") else (team.get("name") if team else None)) or me.get("display_name") or me.get("username"),
        "registration_type": "team" if team else "solo",
        "registered_by": me["id"],
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    if count >= t.get("max_participants", 32):
        reg["status"] = "waitlist"
    await db.tournament_registrations.insert_one(reg)
    auto_bracket_update = None
    if reg["status"] in {"approved", "checked_in"}:
        auto_bracket_update = await _refresh_tournament_previews_after_registration(db, t, me.get("id"))
    reg.pop("_id", None)
    reg["auto_bracket_update"] = auto_bracket_update
    # Badge trigger
    try:
        from badges import on_tournament_registered
        await on_tournament_registered(me["id"], tid)
    except Exception:
        pass
    return reg


@router.post("/{tid}/registrations")
async def admin_create_registration(tid: str, body: RegistrationAdminCreate,
                                    me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)

    payload = body.model_dump()
    user = None
    if payload.get("user_id"):
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
        existing = await db.tournament_registrations.find_one({"tournament_id": tid, "user_id": payload["user_id"]}, {"id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="Dieser Nutzer ist bereits angemeldet")
    team = None
    if payload.get("team_id"):
        team = await db.teams.find_one({"id": payload["team_id"]}, {"_id": 0})
        if not team:
            raise HTTPException(status_code=404, detail="Team nicht gefunden")
        existing_team = await db.tournament_registrations.find_one({"tournament_id": tid, "team_id": payload["team_id"]}, {"id": 1})
        if existing_team:
            raise HTTPException(status_code=409, detail="Dieses Team ist bereits angemeldet")
    if _is_team_tournament(tournament) and not team:
        raise HTTPException(status_code=400, detail="Dieses Turnier erwartet eine Team-Anmeldung")
    if not _is_team_tournament(tournament) and team:
        raise HTTPException(status_code=400, detail="Dieses Turnier ist als Einzelspieler-Turnier eingestellt")

    display_name = (
        (payload.get("display_name") or "").strip()
        or (payload.get("ingame_name") or "").strip()
        or (f"[{team.get('tag')}] {team.get('name')}" if team and team.get("tag") else (team or {}).get("name") or "")
        or ((user or {}).get("display_name") or (user or {}).get("username") or "").strip()
    )
    if not display_name:
        raise HTTPException(status_code=400, detail="Display-Name oder Account ist erforderlich")
    old_reg_id = payload.get("replace_registration_id")
    old = None
    if old_reg_id:
        old = await db.tournament_registrations.find_one({"id": old_reg_id, "tournament_id": tid}, {"_id": 0})
        if not old:
            raise HTTPException(status_code=404, detail="Zu ersetzende Anmeldung nicht gefunden")
        legacy_blocked = await db.matches.count_documents({
            "tournament_id": tid,
            "status": {"$in": ["completed", "forfeit"]},
            "$or": [{"participant_a_id": old_reg_id}, {"participant_b_id": old_reg_id}],
        })
        v2_blocked = await db.matches_v2.count_documents({
            "tournament_id": tid,
            "status": {"$in": ["completed", "forfeit"]},
            "slots.registration_id": old_reg_id,
        })
        if legacy_blocked or v2_blocked:
            raise HTTPException(
                status_code=409,
                detail="Teilnehmer kommt bereits in abgeschlossenen Matches vor. Erst Bracket korrigieren oder neu generieren.",
            )

    reg = {
        "id": new_id(),
        "tournament_id": tid,
        "user_id": (user or {}).get("id"),
        "team_id": payload.get("team_id"),
        "status": payload.get("status") or "approved",
        "ingame_name": (payload.get("ingame_name") or display_name).strip(),
        "discord": payload.get("discord") or (user or {}).get("discord_name"),
        "platform_id": payload.get("platform_id"),
        "player_ids": payload.get("player_ids") or {},
        "notes": payload.get("notes"),
        "accepted_rules": True,
        "accepted_privacy": True,
        "seed": payload.get("seed"),
        "display_name": display_name,
        "registration_type": "team" if team else "solo",
        "registered_by": me.get("id"),
        "source": "staff_add",
        "is_guest": not bool(user or team),
        "created_by": me.get("id"),
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.tournament_registrations.insert_one(reg)

    replacement = None
    if old_reg_id:
        await db.tournament_registrations.update_one(
            {"id": old_reg_id},
            {"$set": {"status": "no_show", "updated_at": now_utc().isoformat()}},
        )
        replacement = await _replace_registration_in_open_matches(db, tid, old_reg_id, reg, me.get("id"))
    auto_bracket_update = None
    if not old_reg_id and reg["status"] in {"approved", "checked_in"}:
        auto_bracket_update = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))

    await _audit_tournament_action(
        db,
        "tournament.registration.staff_add",
        me.get("id"),
        tid,
        {"registration_id": reg["id"], "user_id": reg.get("user_id"), "is_guest": reg["is_guest"], "replace_registration_id": old_reg_id},
    )
    reg.pop("_id", None)
    return {"registration": reg, "replacement": replacement, "auto_bracket_update": auto_bracket_update}


@router.put("/{tid}/registrations/{reg_id}")
@router.patch("/{tid}/registrations/{reg_id}")
async def update_registration(tid: str, reg_id: str, body: RegistrationUpdate,
                               me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_registrations.update_one({"id": reg_id, "tournament_id": tid}, {"$set": updates})
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
    if updates.get("status") in {"approved", "checked_in", "rejected", "waitlist", "no_show"}:
        tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if tournament:
            reg["auto_bracket_update"] = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
    return reg


@router.post("/{tid}/registrations/{reg_id}/checkin")
async def staff_set_registration_checkin(tid: str, reg_id: str, body: dict,
                                         me: dict = Depends(get_current_user)):
    """Operational check-in control for tournament staff.

    This is intentionally narrower than the generic registration update route:
    staff can mark a player as checked in, checked out/approved, or no-show
    without receiving full tournament-admin rights.
    """
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, CHECKIN_STAFF_ROLES)
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
    status = body.get("status")
    if status not in REGISTRATION_CHECKIN_STATUSES:
        raise HTTPException(status_code=400, detail="Ungültiger Check-in-Status")
    if reg.get("status") in ("rejected", "waitlist") and status == "checked_in":
        raise HTTPException(status_code=400, detail="Diese Anmeldung kann nicht eingecheckt werden")

    await db.tournament_registrations.update_one(
        {"id": reg_id},
        {"$set": {"status": status, "updated_at": now_utc().isoformat()}},
    )
    if status == "checked_in" and reg.get("user_id"):
        await _apply_late_checkin_hooks(db, tid, reg["user_id"])
        await _apply_checked_in_badges(reg["user_id"], tid)
    await _audit_tournament_action(
        db,
        "tournament.registration.checkin_status",
        me.get("id"),
        tid,
        {"registration_id": reg_id, "from_status": reg.get("status"), "to_status": status},
    )
    updated = await db.tournament_registrations.find_one({"id": reg_id}, {"_id": 0})
    return updated


@router.delete("/{tid}/registrations/{reg_id}")
async def delete_registration(tid: str, reg_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid})
    if not reg:
        raise HTTPException(status_code=404)
    is_own_registration = reg.get("user_id") == me["id"]
    is_team_manager = False
    if reg.get("team_id"):
        team = await db.teams.find_one({"id": reg["team_id"]}, {"_id": 0})
        is_team_manager = bool(team and _can_register_team(team, me))
    is_staff = await has_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    if not is_own_registration and not is_team_manager and not is_staff:
        raise HTTPException(status_code=403)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if (is_own_registration or is_team_manager) and not is_staff:
        if reg.get("status") == "checked_in" or (tournament or {}).get("status") in {"live", "paused", "completed", "results_published", "archived"}:
            raise HTTPException(status_code=409, detail="Abmeldung ist nach Check-in oder Turnierstart nur über die Turnierleitung möglich.")
        legacy_blocked = await db.matches.count_documents({
            "tournament_id": tid,
            "$or": [{"participant_a_id": reg_id}, {"participant_b_id": reg_id}],
            "status": {"$nin": ["preview", "pending", "ready", "scheduled", "cancelled"]},
        })
        v2_blocked = await db.matches_v2.count_documents({
            "tournament_id": tid,
            "slots.registration_id": reg_id,
            "status": {"$nin": ["preview", "pending", "ready", "scheduled", "cancelled"]},
        })
        if legacy_blocked or v2_blocked:
            raise HTTPException(status_code=409, detail="Abmeldung ist nicht mehr möglich, weil bereits Spiele aktiv oder gewertet sind.")
    await db.tournament_registrations.delete_one({"id": reg_id})
    auto_bracket_update = None
    if tournament:
        auto_bracket_update = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
    await _audit_tournament_action(
        db,
        "tournament.registration.delete",
        me.get("id"),
        tid,
        {"registration_id": reg_id, "user_id": reg.get("user_id"), "self_unregister": (is_own_registration or is_team_manager) and not is_staff},
    )
    return {"ok": True, "auto_bracket_update": auto_bracket_update}


# --- Tournament staff assignments ---
async def _enrich_staff_assignments(assignments: list[dict]) -> list[dict]:
    db = get_db()
    user_ids = list({a.get("user_id") for a in assignments if a.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "email": 1, "role": 1},
    ).to_list(500)}
    for assignment in assignments:
        u = users.get(assignment.get("user_id")) or {}
        assignment["user"] = {
            "id": u.get("id"),
            "username": u.get("username"),
            "display_name": u.get("display_name"),
            "avatar_url": u.get("avatar_url"),
            "email": u.get("email"),
            "role": u.get("role"),
        }
    return assignments


@router.get("/{tid}/staff")
async def list_tournament_staff(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    assignments = await db.tournament_staff_assignments.find(
        {"tournament_id": tid},
        {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    return await _enrich_staff_assignments(assignments)


@router.post("/{tid}/staff")
async def create_tournament_staff(tid: str, body: TournamentStaffAssignmentCreate,
                                  me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    if not await db.users.find_one({"id": body.user_id}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    scope = body.scope or "tournament"
    scope_id = body.scope_id if scope != "tournament" else None
    existing = await db.tournament_staff_assignments.find_one({
        "tournament_id": tid,
        "user_id": body.user_id,
        "role": body.role,
        "scope": scope,
        "scope_id": scope_id,
    })
    if existing:
        raise HTTPException(status_code=409, detail="Diese Zuweisung existiert bereits")
    doc = _normalize_team_settings(body.model_dump())
    doc["id"] = new_id()
    doc["tournament_id"] = tid
    doc["scope"] = scope
    doc["scope_id"] = scope_id
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.tournament_staff_assignments.insert_one(doc)
    await _audit_tournament_action(
        db,
        "tournament.staff.create",
        me.get("id"),
        tid,
        {"assignment_id": doc["id"], "user_id": doc["user_id"], "role": doc["role"], "scope": doc["scope"], "scope_id": doc.get("scope_id")},
    )
    doc.pop("_id", None)
    return (await _enrich_staff_assignments([doc]))[0]


@router.patch("/{tid}/staff/{assignment_id}")
@router.put("/{tid}/staff/{assignment_id}")
async def update_tournament_staff(tid: str, assignment_id: str, body: TournamentStaffAssignmentUpdate,
                                  me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    current = await db.tournament_staff_assignments.find_one({"id": assignment_id, "tournament_id": tid}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Zuweisung nicht gefunden")
    nullable = {"scope_id", "notes"}
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in nullable}
    if updates.get("scope") == "tournament":
        updates["scope_id"] = None
    proposed = {**current, **updates}
    duplicate = await db.tournament_staff_assignments.find_one({
        "id": {"$ne": assignment_id},
        "tournament_id": tid,
        "user_id": proposed.get("user_id"),
        "role": proposed.get("role"),
        "scope": proposed.get("scope") or "tournament",
        "scope_id": proposed.get("scope_id") if (proposed.get("scope") or "tournament") != "tournament" else None,
    })
    if duplicate:
        raise HTTPException(status_code=409, detail="Diese Zuweisung existiert bereits")
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_staff_assignments.update_one({"id": assignment_id}, {"$set": updates})
    await _audit_tournament_action(
        db,
        "tournament.staff.update",
        me.get("id"),
        tid,
        {"assignment_id": assignment_id, "updates": {k: v for k, v in updates.items() if k != "updated_at"}},
    )
    updated = await db.tournament_staff_assignments.find_one({"id": assignment_id}, {"_id": 0})
    return (await _enrich_staff_assignments([updated]))[0]


@router.delete("/{tid}/staff/{assignment_id}")
async def delete_tournament_staff(tid: str, assignment_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    current = await db.tournament_staff_assignments.find_one({"id": assignment_id, "tournament_id": tid}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Zuweisung nicht gefunden")
    await db.tournament_staff_assignments.delete_one({"id": assignment_id})
    await _audit_tournament_action(
        db,
        "tournament.staff.delete",
        me.get("id"),
        tid,
        {"assignment_id": assignment_id, "user_id": current.get("user_id"), "role": current.get("role")},
    )
    return {"ok": True}


# --- Tournament v2 stage groundwork ---
@router.get("/{tid}/stages")
async def list_tournament_stages(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _get_visible_tournament(tid, user)
    stages = await db.tournament_stages.find(
        {"tournament_id": tid},
        {"_id": 0},
    ).sort("number", 1).to_list(200)
    return stages


@router.post("/{tid}/stages")
async def create_tournament_stage(tid: str, body: TournamentStageCreate,
                                  me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    doc = body.model_dump()
    if doc.get("number") is None:
        last = await db.tournament_stages.find(
            {"tournament_id": tid},
            {"_id": 0, "number": 1},
        ).sort("number", -1).to_list(1)
        doc["number"] = int((last[0].get("number") if last else 0) or 0) + 1
    duplicate = await db.tournament_stages.find_one(
        {"tournament_id": tid, "number": doc["number"]},
        {"id": 1},
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Stage-Nummer existiert bereits")
    doc["id"] = new_id()
    doc["tournament_id"] = tid
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = doc["created_at"]
    doc["created_by"] = me["id"]
    await db.tournament_stages.insert_one(doc)
    await _audit_tournament_action(
        db,
        "tournament.stage.create",
        me.get("id"),
        tid,
        {"stage_id": doc["id"], "stage_type": doc["stage_type"], "match_type": doc["match_type"]},
    )
    doc.pop("_id", None)
    return doc


@router.patch("/{tid}/stages/{stage_id}")
@router.put("/{tid}/stages/{stage_id}")
async def update_tournament_stage(tid: str, stage_id: str, body: TournamentStageUpdate,
                                  me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    current = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Stage nicht gefunden")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "number" in updates:
        duplicate = await db.tournament_stages.find_one(
            {"id": {"$ne": stage_id}, "tournament_id": tid, "number": updates["number"]},
            {"id": 1},
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Stage-Nummer existiert bereits")
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_stages.update_one({"id": stage_id}, {"$set": updates})
    await _audit_tournament_action(
        db,
        "tournament.stage.update",
        me.get("id"),
        tid,
        {"stage_id": stage_id, "updates": {k: v for k, v in updates.items() if k != "updated_at"}},
    )
    updated = await db.tournament_stages.find_one({"id": stage_id}, {"_id": 0})
    return updated


@router.delete("/{tid}/stages/{stage_id}")
async def delete_tournament_stage(tid: str, stage_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    stage = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not stage:
        raise HTTPException(status_code=404, detail="Stage nicht gefunden")
    match_ids = await db.matches_v2.distinct("id", {"stage_id": stage_id})
    await db.tournament_stages.delete_one({"id": stage_id})
    await db.matches_v2.delete_many({"stage_id": stage_id})
    if match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
    await _audit_tournament_action(
        db,
        "tournament.stage.delete",
        me.get("id"),
        tid,
        {"stage_id": stage_id, "match_count": len(match_ids)},
    )
    return {"ok": True}


@router.get("/{tid}/matches-v2")
async def list_tournament_matches_v2(tid: str, stage_id: str | None = None,
                                     user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _get_visible_tournament(tid, user)
    q = {"tournament_id": tid}
    if stage_id:
        q["stage_id"] = stage_id
    matches = await db.matches_v2.find(q, {"_id": 0}).sort([("round", 1), ("match_key", 1)]).to_list(2000)
    return matches


@router.post("/{tid}/stages/{stage_id}/generate")
async def generate_tournament_stage_matches(tid: str, stage_id: str, force: bool = False,
                                            preview: bool = False,
                                            me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    stage = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not stage:
        raise HTTPException(status_code=404, detail="Stage nicht gefunden")
    existing_matches = await db.matches_v2.find({"stage_id": stage_id}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan([], existing_matches)
    existing = len(existing_matches)
    can_replace_preview = bool(existing_matches) and all(m.get("is_preview") for m in existing_matches)
    if existing and not force and not can_replace_preview:
        raise HTTPException(
            status_code=409,
            detail="Stage hat bereits Matches. Mit force=true neu generieren.",
        )
    registrations = []
    if not preview:
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
            {"_id": 0},
        ).to_list(5000)
    try:
        matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=preview)
    except BracketSchemaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not matches:
        raise HTTPException(status_code=400, detail="Schema erzeugt keine Matches")
    _apply_match_plan(matches, match_plan, _v2_plan_key)

    if existing:
        match_ids = await db.matches_v2.distinct("id", {"stage_id": stage_id})
        if match_ids:
            await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
        await db.matches_v2.delete_many({"stage_id": stage_id})
    await db.matches_v2.insert_many(matches)
    await db.tournament_stages.update_one(
        {"id": stage_id},
        {"$set": {"status": "pending" if preview else "ready", "updated_at": now_utc().isoformat()}},
    )
    await _audit_tournament_action(
        db,
        "tournament.stage.generate",
        me.get("id"),
        tid,
        {
            "stage_id": stage_id,
            "match_count": len(matches),
            "force": force,
            "preview": preview,
            "stage_type": stage.get("stage_type"),
            "match_type": stage.get("match_type"),
        },
    )
    return {"ok": True, "stage_id": stage_id, "match_count": len(matches), "preview": preview}


@router.post("/{tid}/checkin")
async def checkin_self(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    reg = await db.tournament_registrations.find_one({"tournament_id": tid, "user_id": me["id"]})
    if not reg:
        team_ids = [
            row.get("team_id")
            for row in await db.team_members.find({"user_id": me["id"]}, {"_id": 0, "team_id": 1}).to_list(100)
            if row.get("team_id")
        ]
        if team_ids:
            teams = await db.teams.find(
                {
                    "id": {"$in": team_ids},
                    "$or": [{"leader_id": me["id"]}, {"co_leader_ids": me["id"]}],
                },
                {"_id": 0, "id": 1},
            ).to_list(100)
            manageable_team_ids = [team["id"] for team in teams]
            if manageable_team_ids:
                reg = await db.tournament_registrations.find_one({
                    "tournament_id": tid,
                    "team_id": {"$in": manageable_team_ids},
                })
    if not reg:
        raise HTTPException(status_code=404, detail="Keine Anmeldung gefunden")
    if reg["status"] not in ("approved", "checked_in"):
        raise HTTPException(status_code=400, detail="Nicht check-in-fähig")
    await db.tournament_registrations.update_one(
        {"id": reg["id"]}, {"$set": {"status": "checked_in", "updated_at": now_utc().isoformat()}})
    # Phase B v4.1: late check-in detection (check-in after start_date) → neg_late_checkin
    await _apply_late_checkin_hooks(db, tid, me["id"])
    await _apply_checked_in_badges(me["id"], tid)
    await _audit_tournament_action(
        db,
        "tournament.registration.self_checkin",
        me.get("id"),
        tid,
        {"registration_id": reg["id"], "from_status": reg.get("status"), "to_status": "checked_in"},
    )
    return {"ok": True}


# --- Bracket generation ---
@router.post("/{tid}/generate-bracket")
async def generate(tid: str, preview: bool = False, force: bool = False,
                   me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    return await _generate_legacy_bracket_docs(db, t, me.get("id"), preview=preview, force=force, set_live=not preview)


@router.post("/{tid}/bracket/from-format")
async def rebuild_bracket_from_tournament_format(tid: str, body: TournamentBracketStructurePayload | None = None,
                                                 preview: bool = True, force: bool = False,
                                                 me: dict = Depends(get_current_user)):
    """Use the tournament structure as the single source of truth and rebuild the bracket preview."""
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    if not _can_create_initial_legacy_preview(tournament):
        raise HTTPException(status_code=400, detail="Für dieses Format gibt es keinen automatischen Format-Bracket-Generator.")
    if tournament.get("status") in ("live", "paused", "completed", "results_published", "archived") and not force:
        raise HTTPException(status_code=409, detail="Laufende oder beendete Turniere brauchen force=true.")

    legacy_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    v2_matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan(legacy_matches, v2_matches)
    existing_stage = await db.tournament_stages.find_one({"tournament_id": tid}, {"_id": 0}, sort=[("number", 1)])
    if body is None and existing_stage:
        body = TournamentBracketStructurePayload(
            name=existing_stage.get("name") or "Turnierbaum",
            stage_type=existing_stage.get("stage_type"),
            match_type=existing_stage.get("match_type"),
            settings=existing_stage.get("settings") or {},
        )
    has_real_legacy = any(not match.get("is_preview") for match in legacy_matches)
    has_real_v2 = any(not match.get("is_preview") for match in v2_matches)
    if (has_real_legacy or has_real_v2) and not force:
        raise HTTPException(status_code=409, detail="Es gibt bereits echte Spiele. Mit force=true neu aufbauen.")

    v2_match_ids = [match["id"] for match in v2_matches if match.get("id")]
    await db.matches.delete_many({"tournament_id": tid})
    await db.matches_v2.delete_many({"tournament_id": tid})
    if v2_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
    await db.tournament_stages.delete_many({"tournament_id": tid})

    stage_defaults = _stage_defaults_for_tournament_format(tournament, body)
    if stage_defaults:
        stage = {
            **stage_defaults,
            "id": new_id(),
            "tournament_id": tid,
            "created_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
            "created_by": me["id"],
        }
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
            {"_id": 0},
        ).to_list(5000)
        try:
            matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=preview)
        except BracketSchemaError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if not matches:
            raise HTTPException(status_code=400, detail="Die Struktur erzeugt keine Spiele.")
        _apply_match_plan(matches, match_plan, _v2_plan_key)
        await db.tournament_stages.insert_one(stage)
        await db.matches_v2.insert_many(matches)
        await _audit_tournament_action(
            db,
            "tournament.bracket.rebuild_from_structure",
            me.get("id"),
            tid,
            {
                "format": tournament.get("format"),
                "stage_type": stage.get("stage_type"),
                "match_type": stage.get("match_type"),
                "preview": preview,
                "force": force,
                "match_count": len(matches),
            },
        )
        return {
            "ok": True,
            "engine": "stages",
            "stage_id": stage["id"],
            "match_count": len(matches),
            "preview": preview,
            "participant_count": len(registrations),
        }

    result = await _generate_legacy_bracket_docs(
        db,
        tournament,
        me.get("id"),
        preview=preview,
        force=False,
        set_live=False,
    )
    await _audit_tournament_action(
        db,
        "tournament.bracket.rebuild_from_format",
        me.get("id"),
        tid,
        {"format": tournament.get("format"), "preview": preview, "force": force, "match_count": result.get("match_count")},
    )
    return {**result, "engine": "legacy"}


@router.post("/{tid}/reset-bracket")
async def reset_bracket(tid: str, force: bool = False, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    if t.get("status") in ("live", "completed", "results_published") and not force:
        raise HTTPException(
            status_code=409,
            detail="Bracket-Reset fuer laufende oder beendete Turniere braucht force=true",
        )
    match_count = await db.matches.count_documents({"tournament_id": tid})
    v2_match_ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
    await db.matches.delete_many({"tournament_id": tid})
    await db.matches_v2.delete_many({"tournament_id": tid})
    if v2_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": "draft", "updated_at": now_utc().isoformat()}})
    await _audit_tournament_action(
        db,
        "tournament.bracket.reset",
        me.get("id"),
        tid,
        {"previous_status": t.get("status"), "match_count": match_count, "v2_match_count": len(v2_match_ids), "force": force},
    )
    return {"ok": True}


@router.post("/{tid}/status")
async def set_status(tid: str, body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    status = body.get("status")
    allowed = {
        "draft", "scheduled", "registration_open", "registration_closed",
        "check_in", "live", "paused", "completed", "results_published",
        "archived", "cancelled",
    }
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Ungültiger Status")
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    prev = t.get("status")
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": status, "updated_at": now_utc().isoformat()}})
    auto_generated_bracket = None
    if prev != status and status == "check_in":
        fresh_t = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or t
        auto_generated_bracket = await _finalize_bracket_for_checkin(db, fresh_t, me.get("id"))
    if status == "live":
        try:
            stage_count = await db.tournament_stages.count_documents({"tournament_id": tid})
            v2_count = await db.matches_v2.count_documents({"tournament_id": tid})
            legacy_matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
            can_auto_replace = bool(legacy_matches) and all(m.get("is_preview") for m in legacy_matches)
            if stage_count == 0 and v2_count == 0 and (not legacy_matches or can_auto_replace):
                fresh_t = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or t
                auto_generated_bracket = await _generate_legacy_bracket_docs(
                    db,
                    fresh_t,
                    me.get("id"),
                    preview=False,
                    force=can_auto_replace,
                    set_live=False,
                )
        except HTTPException:
            auto_generated_bracket = None

    # ---------- Season Points + Badges on results_published ----------
    if prev != status and status == "results_published":
        try:
            from services.season_service import award_points
            from badges import on_tournament_completed
            # Build placements from matches.final_position
            regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
            reg_map = {r["id"]: r for r in regs}
            num_participants = len(regs)
            matches = await db.matches.find({"tournament_id": tid, "final_position": {"$ne": None}}, {"_id": 0}).to_list(200)
            placements = []
            seen = set()
            for m in matches:
                rid = m.get("winner_id")
                if rid and rid in reg_map and rid not in seen:
                    reg = reg_map[rid]
                    placements.append({
                        "user_id": reg.get("user_id"),
                        "team_id": reg.get("team_id"),
                        "rank": m["final_position"],
                    })
                    seen.add(rid)
            # Source type by season weight: <=1.5 mini, <=2.5 normal, else major
            weight = float(t.get("season_weight") or 2.0)
            source_type = "mini" if weight < 1.5 else ("major" if weight >= 2.5 else "tournament")
            for p in placements:
                if not (p.get("user_id") or p.get("team_id")):
                    continue
                await award_points(
                    user_id=p.get("user_id"),
                    team_id=p.get("team_id"),
                    source_type=source_type,
                    source_id=tid,
                    source_name=t.get("title"),
                    rank=p["rank"],
                    num_participants=num_participants,
                    weight=weight,
                )
            # Participation points for everyone else
            placed_user_ids = {p.get("user_id") for p in placements}
            for r in regs:
                uid = r.get("user_id")
                if uid and uid not in placed_user_ids:
                    await award_points(
                        user_id=uid, source_type=source_type, source_id=tid,
                        source_name=t.get("title"), rank=None,
                        num_participants=num_participants, weight=weight,
                    )
            await on_tournament_completed(tid, placements)
            # Phase 9: Auto-create prize pickups
            try:
                from services.prize_service import auto_create_for_tournament
                await auto_create_for_tournament(tid)
            except Exception as exc2:
                import logging
                logging.getLogger("tls.prizes").warning(f"auto-create prizes: {exc2}")
        except Exception as exc:
            import logging
            logging.getLogger("tls.tournament").warning(f"results_published hook: {exc}")

    # Discord trigger
    is_public_discord_status = (
        t.get("is_public") is not False
        and (t.get("visibility") or "public") == "public"
    )
    if is_public_discord_status and prev != status and status in ("registration_open", "live", "completed", "results_published"):
        try:
            from discord_service import send_public_discord
            colors = {"registration_open": 0x00FF88, "live": 0x29B6E8,
                      "completed": 0xFFD700, "results_published": 0xFFD700}
            labels = {"registration_open": "Anmeldung offen", "live": "Jetzt live",
                      "completed": "Beendet", "results_published": "Ergebnisse veröffentlicht"}
            game_id = t.get("game_id")
            game = await db.games.find_one({"id": game_id}, {"name": 1}) if game_id else None
            url = f"/tournaments/{t.get('slug') or tid}"
            fields = []
            if game and game.get("name"): fields.append({"name": "Spiel", "value": game["name"], "inline": True})
            if t.get("format"): fields.append({"name": "Format", "value": (t.get("format_label") or t["format"].replace("_", " ").title()), "inline": True})
            if t.get("max_participants"): fields.append({"name": "Teilnehmer", "value": f"max. {t['max_participants']}", "inline": True})
            await send_public_discord(
                t,
                f"🏆 {t.get('title') or 'Turnier'} · {labels[status]}",
                t.get("description") or "",
                color=colors[status], url=url, fields=fields,
                event_key=f"tournament.{status}",
            )
        except Exception:
            pass
    return {"ok": True, "auto_generated_bracket": auto_generated_bracket}


@router.get("/{tid}/planning-check")
async def planning_check(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    matches, tournament = await _collect_plan_matches(db, tid)
    return _planning_report(matches, tournament)


@router.get("/{tid}/match-plan.csv")
async def export_match_plan_csv(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    matches, tournament = await _collect_plan_matches(db, tid)
    reg_ids = set()
    for match in matches:
        if match.get("slots"):
            reg_ids.update(slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id"))
        else:
            reg_ids.update([match.get("participant_a_id"), match.get("participant_b_id")])
    regs = await db.tournament_registrations.find({"id": {"$in": list(reg_ids)}}, {"_id": 0}).to_list(1000) if reg_ids else []
    reg_map = {reg["id"]: reg for reg in regs}

    def _participants(match: dict) -> str:
        if match.get("slots"):
            labels = []
            for slot in match.get("slots") or []:
                reg = reg_map.get(slot.get("registration_id"))
                labels.append(reg.get("display_name") or reg.get("ingame_name") if reg else (slot.get("source") or {}).get("raw") or f"Slot {slot.get('slot')}")
            return " vs ".join([label for label in labels if label])
        labels = []
        for reg_id in [match.get("participant_a_id"), match.get("participant_b_id")]:
            reg = reg_map.get(reg_id)
            labels.append(reg.get("display_name") or reg.get("ingame_name") if reg else (reg_id or "Offen"))
        return " vs ".join(labels)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Turnier", "Match", "Bereich", "Runde", "Start", "Dauer", "Station", "Status", "Teilnehmer"])
    for match in matches:
        writer.writerow([
            tournament.get("title") or tid,
            _plan_match_label(match),
            match.get("section") or match.get("bracket") or "",
            match.get("round_name") or match.get("round") or "",
            match.get("scheduled_at") or "",
            _plan_duration(match, tournament),
            _plan_station_label(match),
            match.get("status") or "",
            _participants(match),
        ])
    filename = f"matchplan_{tournament.get('slug') or tid}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _build_bracket_payload(db, t: dict, user: dict | None, is_staff: bool) -> dict:
    t["public_phase"] = derive_public_phase(t, "tournament")
    matches = await db.matches.find({"tournament_id": t["id"]}, {"_id": 0}).sort("round", 1).to_list(1000)
    stages = await db.tournament_stages.find({"tournament_id": t["id"]}, {"_id": 0}).sort("number", 1).to_list(200)
    matches_v2 = await db.matches_v2.find({"tournament_id": t["id"]}, {"_id": 0}).sort([("stage_number", 1), ("round", 1), ("order", 1)]).to_list(3000)
    await attach_station_info(db, matches)
    await attach_station_info(db, matches_v2)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    regs = [_public_registration(r, user, is_staff) for r in regs]
    known_reg_ids = {r.get("id") for r in regs}
    preview_ids = sorted({
        pid
        for match in matches
        for pid in (match.get("participant_a_id"), match.get("participant_b_id"))
        if isinstance(pid, str) and pid.startswith("preview-seed-") and pid not in known_reg_ids
    }, key=lambda value: int(value.rsplit("-", 1)[-1]) if value.rsplit("-", 1)[-1].isdigit() else 999999)
    for pid in preview_ids:
        seed = int(pid.rsplit("-", 1)[-1]) if pid.rsplit("-", 1)[-1].isdigit() else len(regs) + 1
        regs.append(_preview_seed_reg(seed, t["id"]))
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    for r in regs:
        if r.get("user_id"):
            u = users.get(r["user_id"]) or {}
            r["user"] = {"id": u.get("id"), "username": u.get("username"),
                         "display_name": u.get("display_name"), "avatar_url": u.get("avatar_url")}
    t["can_view_display"] = bool(is_staff)
    return {
        "tournament": t,
        "matches": matches,
        "registrations": regs,
        "stages": stages,
        "matches_v2": matches_v2,
        "engine": "stage" if stages or matches_v2 else "legacy",
    }


@router.get("/{tid}/bracket")
async def get_bracket(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user) or await _is_tournament_staff(tid, user)
    return await _build_bracket_payload(db, t, user, is_staff)


@router.get("/{tid}/bracket/display")
async def get_bracket_display(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return await _build_bracket_payload(db, t, me, True)


def _v2_standings(matches_v2: list[dict], regs: list[dict]) -> list[dict]:
    rank_map = {
        r["id"]: {
            "registration_id": r["id"],
            "display_name": r.get("display_name") or r.get("ingame_name") or r.get("user", {}).get("display_name"),
            "played": 0,
            "won": 0,
            "top2": 0,
            "lost": 0,
            "points": 0,
            "rank_sum": 0,
            "furthest_round": 0,
            "best_rank": None,
        }
        for r in regs
    }
    for match in matches_v2:
        if match.get("status") not in {"completed", "forfeit"}:
            continue
        for result in match.get("results") or []:
            rid = result.get("registration_id")
            if rid not in rank_map:
                continue
            rank = int(result.get("rank") or 999)
            row = rank_map[rid]
            row["played"] += 1
            row["rank_sum"] += rank
            row["furthest_round"] = max(row["furthest_round"], int(match.get("round") or 0))
            row["best_rank"] = rank if row["best_rank"] is None else min(row["best_rank"], rank)
            if rank == 1:
                row["won"] += 1
            if rank <= 2:
                row["top2"] += 1
            else:
                row["lost"] += 1
            score = result.get("points")
            if score is None:
                score = result.get("score")
            if isinstance(score, (int, float)):
                row["points"] += score
    rows = list(rank_map.values())
    for row in rows:
        row["avg_rank"] = round(row["rank_sum"] / row["played"], 2) if row["played"] else None
    rows.sort(key=lambda row: (
        row["furthest_round"],
        row["won"],
        row["top2"],
        row["points"],
        -(row["avg_rank"] or 999),
    ), reverse=True)
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
    return rows


@router.get("/{tid}/standings")
async def standings(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user) or await _is_tournament_staff(tid, user)
    matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(1000)
    matches_v2 = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
    regs = [_public_registration(r, user, is_staff) for r in regs]
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    for r in regs:
        u = users.get(r.get("user_id") or "", {})
        r["display_name"] = r.get("display_name") or u.get("display_name") or u.get("username")
        r["user"] = {"id": u.get("id"), "username": u.get("username"), "display_name": u.get("display_name"), "avatar_url": u.get("avatar_url")}
    if matches_v2:
        return _v2_standings(matches_v2, regs)
    fmt = t.get("format")
    if fmt in ("round_robin", "league"):
        return compute_round_robin_standings(matches, regs)
    if fmt == "swiss":
        return compute_swiss_standings(regs, matches)
    if fmt == "groups":
        groups = await db.tournament_groups.find({"tournament_id": tid}, {"_id": 0}).to_list(50)
        reg_map = {r["id"]: r for r in regs}
        return compute_group_standings(groups, matches, reg_map)
    # Elimination fallback
    rank_map = {r["id"]: {"registration_id": r["id"], "display_name": r["display_name"],
                           "furthest_round": 0, "wins": 0, "losses": 0} for r in regs}
    for m in matches:
        a, b, w = m.get("participant_a_id"), m.get("participant_b_id"), m.get("winner_id")
        if a in rank_map and m.get("round"):
            rank_map[a]["furthest_round"] = max(rank_map[a]["furthest_round"], m["round"])
        if b in rank_map and m.get("round"):
            rank_map[b]["furthest_round"] = max(rank_map[b]["furthest_round"], m["round"])
        if m.get("status") == "completed" and w:
            loser = a if w == b else b
            if w in rank_map: rank_map[w]["wins"] += 1
            if loser in rank_map: rank_map[loser]["losses"] += 1
    arr = list(rank_map.values())
    arr.sort(key=lambda s: (s["furthest_round"], s["wins"]), reverse=True)
    for i, s in enumerate(arr):
        s["rank"] = i + 1
    return arr


# ---------- Swiss / Groups specific ----------
@router.post("/{tid}/swiss/next-round")
async def swiss_next_round(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid})
    if not t or t.get("format") != "swiss":
        raise HTTPException(status_code=400, detail="Nur für Swiss-Turniere")
    prev = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(2000)
    # Check open matches
    open_count = sum(1 for m in prev if m.get("status") not in ("completed", "forfeit", "cancelled"))
    if open_count > 0:
        raise HTTPException(status_code=400, detail=f"{open_count} Matches sind noch offen")
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(500)
    next_round_num = (max((m.get("round") or 0) for m in prev) + 1) if prev else 1
    matches = generate_swiss_round(tid, regs, prev, next_round_num, t.get("best_of", 1))
    if matches:
        await db.matches.insert_many(matches)
    if t.get("status") == "draft":
        await db.tournaments.update_one({"id": tid}, {"$set": {"status": "live"}})
    return {"ok": True, "round": next_round_num, "match_count": len(matches)}


@router.post("/{tid}/groups/generate")
async def groups_generate(tid: str, body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid})
    if not t or t.get("format") != "groups":
        raise HTTPException(status_code=400, detail="Nur für Group-Stage")
    group_count = int(body.get("group_count", 4))
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(500)
    # Reset
    await db.matches.delete_many({"tournament_id": tid})
    await db.tournament_groups.delete_many({"tournament_id": tid})
    res = generate_groups(tid, regs, group_count, t.get("best_of", 1))
    if res["groups"]:
        for g in res["groups"]:
            g["tournament_id"] = tid
            g["created_at"] = now_utc().isoformat()
        await db.tournament_groups.insert_many(res["groups"])
    if res["matches"]:
        await db.matches.insert_many(res["matches"])
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": "live"}})
    return {"ok": True, "group_count": len(res["groups"]), "match_count": len(res["matches"])}


@router.get("/{tid}/groups")
async def list_groups(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _get_visible_tournament(tid, user)
    return await db.tournament_groups.find({"tournament_id": tid}, {"_id": 0}).to_list(50)
