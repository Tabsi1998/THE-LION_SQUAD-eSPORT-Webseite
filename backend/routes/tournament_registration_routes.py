"""Anmeldungen, Teilnehmerverwaltung und Check-in.
"""
from fastapi import HTTPException, Depends
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
from database import get_db
from auth import get_current_user, get_optional_user
from services.access_links import record_access_link_use, validate_access_link
from services.tournament_permissions import (
    CHECKIN_STAFF_ROLES,
    PARTICIPANT_STAFF_ROLES,
    has_tournament_staff_permission,
    require_tournament_staff_permission,
)
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.competition_versions import persist_competition_versions
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from models import RegistrationCreate, RegistrationUpdate, RegistrationAdminCreate, now_utc, new_id
from services.query_filters import safe_regex
from routes.tournament_common import (
    STAFF_ROLES,
    TOURNAMENT_MUTATION_LOCKED_DETAIL,
    _apply_match_plan,
    _audit_tournament_action,
    _collect_match_plan,
    _create_initial_stage_bracket_preview,
    _enrich_game_identity,
    _ensure_tournament_unlocked,
    _get_visible_tournament,
    _is_staff,
    _is_tournament_locked,
    _is_tournament_staff,
    _public_registration,
    _resolve_tid,
    _serialized_tournament_write,
    _v2_plan_key,
)
from routes.tournament_router import router


REGISTRATION_CHECKIN_STATUSES = {"approved", "checked_in", "no_show"}


BRACKET_REFRESH_LOCKED_STATUSES = {"check_in", "live", "paused", "completed", "results_published", "archived", "cancelled"}


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


def _is_team_tournament(tournament: dict) -> bool:
    return (tournament.get("team_mode") or "solo") != "solo"


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

    await persist_competition_versions(db, tournament, "graph")
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

    return await _create_initial_stage_bracket_preview(db, tournament, actor_id)


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


# --- Registrations ---
@router.get("/{tid}/registrations")
async def list_registrations(tid: str, access: str | None = None, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    access_link = await validate_access_link(db, access, "tournament", tid, user, "view")
    if access_link:
        t_doc = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if not t_doc:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    else:
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
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0}).to_list(500)}
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
        pattern = safe_regex(q)
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


async def _create_self_registration(db, tid: str, tournament: dict, body: RegistrationCreate,
                                    me: dict, register_access: dict | None) -> dict:
    existing = await db.tournament_registrations.find_one(
        {"tournament_id": tid, "user_id": me["id"]},
        {"_id": 0},
    )
    if existing:
        existing.pop("identity_key", None)
        return {**existing, "auto_bracket_update": None, "idempotent_replay": True}
    team = await _validate_registration_actor(db, tournament, body, me)
    if team:
        existing_team = await db.tournament_registrations.find_one(
            {"tournament_id": tid, "team_id": team["id"]},
            {"_id": 0},
        )
        if existing_team:
            existing_team.pop("identity_key", None)
            return {**existing_team, "auto_bracket_update": None, "idempotent_replay": True}
    game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0}) if tournament.get("game_id") else None
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
    reg = {
        "id": new_id(),
        "identity_key": f"{tid}:team:{team['id']}" if team else f"{tid}:user:{me['id']}",
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
    if count >= tournament.get("max_participants", 32):
        reg["status"] = "waitlist"
    try:
        await db.tournament_registrations.insert_one(reg)
    except DuplicateKeyError:
        existing = await db.tournament_registrations.find_one(
            {"identity_key": reg["identity_key"]},
            {"_id": 0},
        )
        if existing:
            existing.pop("identity_key", None)
            return {**existing, "auto_bracket_update": None, "idempotent_replay": True}
        raise
    auto_bracket_update = None
    if reg["status"] in {"approved", "checked_in"}:
        auto_bracket_update = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
    reg.pop("_id", None)
    reg.pop("identity_key", None)
    reg["auto_bracket_update"] = auto_bracket_update
    reg["idempotent_replay"] = False
    # Badge trigger
    try:
        from badges import on_tournament_registered
        await on_tournament_registered(me["id"], tid)
    except Exception:
        pass
    if register_access:
        await record_access_link_use(db, register_access, me)
    return reg


@router.post("/{tid}/register")
async def register_for_tournament(tid: str, body: RegistrationCreate,
                                   access: str | None = None,
                                   me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    view_access = await validate_access_link(db, access, "tournament", tid, me, "view")
    register_access = await validate_access_link(db, access, "tournament", tid, me, "register")
    has_access = bool(view_access or register_access)
    if not has_access:
        t = await _get_visible_tournament(tid, me)
    elif t.get("status") == "draft" and not register_access:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if _is_tournament_locked(t):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
    if not body.accept_rules or not body.accept_privacy:
        raise HTTPException(status_code=400, detail="Regeln und Datenschutz müssen akzeptiert werden.")
    registration_error = _registration_error(t)
    if registration_error and not register_access:
        raise HTTPException(status_code=400, detail=registration_error)
    if t.get("block_club_member_registration") and await _is_active_club_member(db, me):
        raise HTTPException(status_code=403, detail="Dieses Turnier ist für externe Teilnehmer vorgesehen. Vereinsmitglieder können sich hier nicht selbst anmelden.")
    try:
        async with mutation_lock(db, tournament_write_resource(tid)):
            current = await db.tournaments.find_one({"id": tid}, {"_id": 0})
            if not current:
                raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
            if _is_tournament_locked(current):
                raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
            current_error = _registration_error(current)
            if current_error and not register_access:
                raise HTTPException(status_code=400, detail=current_error)
            return await _create_self_registration(db, tid, current, body, me, register_access)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")


@router.post("/{tid}/registrations")
async def admin_create_registration(tid: str, body: RegistrationAdminCreate,
                                    me: dict = Depends(get_current_user),
                                    _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)

    payload = body.model_dump()
    user = None
    if payload.get("user_id"):
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0})
        if not user:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
        existing = await db.tournament_registrations.find_one(
            {"tournament_id": tid, "user_id": payload["user_id"]},
            {"_id": 0, "identity_key": 0},
        )
        if existing:
            return {
                "registration": existing,
                "replacement": None,
                "auto_bracket_update": None,
                "idempotent_replay": True,
            }
    team = None
    if payload.get("team_id"):
        team = await db.teams.find_one({"id": payload["team_id"]}, {"_id": 0})
        if not team:
            raise HTTPException(status_code=404, detail="Team nicht gefunden")
        existing_team = await db.tournament_registrations.find_one(
            {"tournament_id": tid, "team_id": payload["team_id"]},
            {"_id": 0, "identity_key": 0},
        )
        if existing_team:
            return {
                "registration": existing_team,
                "replacement": None,
                "auto_bracket_update": None,
                "idempotent_replay": True,
            }
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
    if reg.get("team_id"):
        reg["identity_key"] = f"{tid}:team:{reg['team_id']}"
    elif reg.get("user_id"):
        reg["identity_key"] = f"{tid}:user:{reg['user_id']}"
    try:
        await db.tournament_registrations.insert_one(reg)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Dieser Nutzer oder dieses Team ist bereits angemeldet")

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
    reg.pop("identity_key", None)
    return {
        "registration": reg,
        "replacement": replacement,
        "auto_bracket_update": auto_bracket_update,
        "idempotent_replay": False,
    }


@router.put("/{tid}/registrations/{reg_id}")
@router.patch("/{tid}/registrations/{reg_id}")
async def update_registration(tid: str, reg_id: str, body: RegistrationUpdate,
                               me: dict = Depends(get_current_user),
                               _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
    if updates and all(reg.get(key) == value for key, value in updates.items()):
        return {**reg, "idempotent_replay": True}
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_registrations.update_one({"id": reg_id, "tournament_id": tid}, {"$set": updates})
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if updates.get("status") in {"approved", "checked_in", "rejected", "waitlist", "no_show"}:
        tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if tournament:
            reg["auto_bracket_update"] = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
    return {**reg, "idempotent_replay": False}


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
    status = body.get("status")
    if status not in REGISTRATION_CHECKIN_STATUSES:
        raise HTTPException(status_code=400, detail="Ungültiger Check-in-Status")
    try:
        async with mutation_lock(db, tournament_write_resource(tid)):
            reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
            if not reg:
                raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
            if reg.get("status") == status:
                return {**reg, "idempotent_replay": True}
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
            return {**updated, "idempotent_replay": False}
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")


@router.delete("/{tid}/registrations/{reg_id}")
async def delete_registration(tid: str, reg_id: str, me: dict = Depends(get_current_user),
                              _mutation_tid: str = Depends(_serialized_tournament_write)):
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
    if is_staff and (tournament or {}).get("status") == "check_in":
        legacy_slots = await db.matches.count_documents({
            "tournament_id": tid,
            "$or": [{"participant_a_id": reg_id}, {"participant_b_id": reg_id}],
        })
        v2_slots = await db.matches_v2.count_documents({
            "tournament_id": tid,
            "slots.registration_id": reg_id,
        })
        if legacy_slots or v2_slots:
            raise HTTPException(
                status_code=409,
                detail="Nach Check-in-Start bleibt der Turnierbaum fix. Teilnehmer als 'Nicht erschienen' markieren und per Ersatzspieler ersetzen.",
            )
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


async def _find_self_registration(db, tid: str, user_id: str) -> dict | None:
    reg = await db.tournament_registrations.find_one({"tournament_id": tid, "user_id": user_id})
    if not reg:
        team_ids = [
            row.get("team_id")
            for row in await db.team_members.find({"user_id": user_id}, {"_id": 0, "team_id": 1}).to_list(100)
            if row.get("team_id")
        ]
        if team_ids:
            teams = await db.teams.find(
                {
                    "id": {"$in": team_ids},
                    "$or": [{"leader_id": user_id}, {"co_leader_ids": user_id}],
                },
                {"_id": 0, "id": 1},
            ).to_list(100)
            manageable_team_ids = [team["id"] for team in teams]
            if manageable_team_ids:
                reg = await db.tournament_registrations.find_one({
                    "tournament_id": tid,
                    "team_id": {"$in": manageable_team_ids},
                })
    return reg


@router.post("/{tid}/checkin")
async def checkin_self(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    if (tournament.get("event_mode") or "online") == "local":
        raise HTTPException(status_code=403, detail="Bei Vor-Ort-Turnieren macht die Turnierleitung den Check-in.")
    try:
        async with mutation_lock(db, tournament_write_resource(tid)):
            reg = await _find_self_registration(db, tid, me["id"])
            if not reg:
                raise HTTPException(status_code=404, detail="Keine Anmeldung gefunden")
            if reg["status"] == "checked_in":
                return {"ok": True, "idempotent_replay": True}
            if reg["status"] != "approved":
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
            return {"ok": True, "idempotent_replay": False}
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")
