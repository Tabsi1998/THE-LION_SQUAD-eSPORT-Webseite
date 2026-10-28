"""Anmeldungen, Teilnehmerverwaltung und Check-in.
"""
import asyncio
import contextlib
import logging

from fastapi import BackgroundTasks, HTTPException, Depends, Request
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError
from database import get_db
from services import squad_registration
from services.league_scope import is_league_staffel
from services.staffel_guard import SQUAD_UNREGISTER_REFUSED, STAFFEL_REGISTRATION_REFUSED
from services.permissions import is_confirmed_tournament_lead
from auth import get_current_user, get_optional_user, require_area
from services.access_links import AccessLinkUsedUp, claim_access_link_use, release_access_link_use, validate_access_link
from services.match_audience import responsible_registration
from services.registration_notifications import notify_registration_status
from services.tournament_events import REMOVAL_KINDS
from services.tournament_rules import self_checkin_allowed
from services.tournament_permissions import (
    CHECKIN_STAFF_ROLES,
    PARTICIPANT_STAFF_ROLES,
    has_tournament_staff_permission,
    require_tournament_staff_permission,
)
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.bracket_fill_in import (
    NO_PLACE_DETAIL,
    FillInRefused,
    free_bye_place,
    reopened_bye,
    replacement_targets,
    slot_ids,
    swapped,
)
from services.competition_versions import persist_competition_versions
from services.heat_rebuild import evaluate_after_write
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from models import RegistrationCreate, RegistrationUpdate, RegistrationAdminCreate, now_utc, new_id
from services import league_roster, onsite_access, tournament_event_gate, tournament_fees, tournament_guard
from services.query_filters import safe_regex
from services.private_fields import private_projection
from routes.tournament_common import (
    TOURNAMENT_BUSY_DETAIL,
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
    _missing_game_fields,
    _profile_player_ids,
    _public_registration,
    _resolve_tid,
    _serialized_tournament_write,
    _v2_plan_key,
    registration_wait_seconds,
)
from routes.tournament_router import router


REGISTRATION_CHECKIN_STATUSES = {"approved", "checked_in", "no_show"}
logger = logging.getLogger("tls.tournament_registration")


def _log_safe(value, limit: int = 120) -> str:
    """Werte aus Anfragen ins Protokoll nur ohne Zeilenumbrüche und gekürzt."""
    return str(value or "").replace("\r", " ").replace("\n", " ")[:limit]


@contextlib.asynccontextmanager
async def _season_squad_lock(db, tournament: dict | None):
    """Sperre je Season für Co-Team-Schlüssel (#1649) - immer nach der Turnier-Sperre, nie umgekehrt."""
    resource = squad_registration.season_lock_resource(tournament or {})
    if not resource:
        yield
        return
    async with mutation_lock(db, resource):
        yield


async def _sync_squad_key(db, registration: dict | None, new_status: str | None, tournament: dict | None) -> None:
    """Jeder Statuswechsel einer Co-Team-Anmeldung zieht ``league_squad_key`` nach (``squad_registration``) - vor dem
    Schreiben des Status aufrufen. Anmeldungen ohne Co-Team: nichts."""
    if not (registration or {}).get("squad_id"):
        return
    try:
        async with _season_squad_lock(db, tournament):
            await squad_registration.sync_season_key(db, registration, new_status, tournament)
    except squad_registration.SquadAssignError as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=refusal.detail)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=TOURNAMENT_BUSY_DETAIL)


async def _notify_registration(db, tid: str, registration: dict, status: str, *, previous: str | None = None,
                               reason: str | None = None, actor_id: str | None = None) -> None:
    """Anmeldung eingegangen, bestätigt, abgelehnt oder nachgerückt (#1133): Nachricht an die Verantwortlichen der
    Anmeldung. Eine Nachricht hält nie eine Anmeldung auf."""
    try:
        tournament = await db.tournaments.find_one(
            {"id": tid},
            {"_id": 0, "id": 1, "slug": 1, "title": 1, "event_mode": 1, "is_online": 1, "is_hybrid": 1, "check_in_from": 1},
        )
        if tournament:
            await notify_registration_status(db, tournament, registration, status, previous=previous, reason=reason, actor_id=actor_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Registration notification failed for tournament=%s type=%s", _log_safe(tid), type(exc).__name__)


# Im Check-in wächst die Vorschau noch mit (#1551) - fest wird der Baum erst mit dem Check-in-Ende; ein fester Baum
# bleibt beim Auffrischen ohnehin unberührt.
BRACKET_REFRESH_LOCKED_STATUSES = {"live", "paused", "completed", "results_published", "archived", "cancelled"}
# Solange der Baum nicht steht, rücken Wartende von selbst nach (#1551).
WAITLIST_MOVE_UP_STATUSES = {"scheduled", "registration_open", "registration_closed", "check_in"}
ACTIVE_REGISTRATION_STATUSES = ["pending", "approved", "checked_in"]
# Status, mit denen eine Anmeldung nicht (mehr) spielt - im festen Baum nur über Austritt oder Nicht erschienen.
LEAVES_BRACKET_STATUSES = {"rejected", "waitlist", "pending"}


async def _bracket_is_fixed(db, tid: str) -> bool:
    return bool(await db.matches_v2.count_documents({"tournament_id": tid, "is_preview": {"$ne": True}}))


async def _move_up_from_waitlist(db, tid: str, actor_id: str | None, *, exclude_id: str | None = None) -> list[str]:
    """Bis zum Check-in-Ende (#1551): wird ein Platz frei (Absage, „Nicht erschienen“, Abmeldung), rückt die älteste
    Anmeldung der Warteliste nach - mit Nachricht „nachgerückt“ und Startgeld wie bei einer Freigabe. Steht der Baum,
    entscheidet die Turnierleitung (Nachrücker auf einen freien Platz)."""
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament or tournament.get("status") not in WAITLIST_MOVE_UP_STATUSES or tournament.get("check_in_closed_at"):
        return []
    if await _bracket_is_fixed(db, tid):
        return []
    taken = await db.tournament_registrations.count_documents({"tournament_id": tid, "status": {"$in": ACTIVE_REGISTRATION_STATUSES}})
    free = int(tournament.get("max_participants") or 32) - taken
    if free <= 0:
        return []
    waiting = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": "waitlist", **({"id": {"$ne": exclude_id}} if exclude_id else {})}, {"_id": 0},
    ).sort("created_at", 1).to_list(free)
    moved: list[str] = []
    for reg in waiting:
        now_iso = now_utc().isoformat()
        try:
            # Co-Team einer Liga (#1649): rückt nicht nach, wenn es inzwischen in einer anderen Staffel spielt.
            await _sync_squad_key(db, reg, "approved", tournament)
        except HTTPException:
            continue
        result = await db.tournament_registrations.update_one(
            {"id": reg["id"], "status": "waitlist"}, {"$set": {"status": "approved", "updated_at": now_iso}})
        if not getattr(result, "modified_count", 0):
            continue
        reg = {**reg, "status": "approved", "updated_at": now_iso}
        payer = await db.users.find_one({"id": reg.get("user_id")}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1}) \
            if reg.get("user_id") else None
        if payer:
            await tournament_fees.freeze_price(db, reg, tournament, payer=payer)
        await _notify_registration(db, tid, reg, "approved", previous="waitlist", actor_id=actor_id)
        await _audit_tournament_action(db, "tournament.registration.waitlist_moved_up", actor_id, tid, {"registration_id": reg["id"]})
        moved.append(reg["id"])
    return moved


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


def _check_in_over(tournament: dict) -> bool:
    """Ist der Check-in vorbei (#1551)? Mit gebautem Baum - oder im Check-in, wenn „Check-in endet“ schon vorbei ist,
    auch bevor der Job den Baum gebaut hat."""
    if tournament.get("check_in_closed_at"):
        return True
    until = _parse_dt(tournament.get("check_in_until"))
    if until and until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return tournament.get("status") == "check_in" and bool(until) and now_utc() > until


def _is_team_tournament(tournament: dict) -> bool:
    return (tournament.get("team_mode") or "solo") != "solo"


def _can_register_team(team: dict, user: dict) -> bool:
    return (
        team.get("leader_id") == user["id"]
        or user["id"] in (team.get("co_leader_ids") or [])
        or is_confirmed_tournament_lead(user)
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
        match_plan = _collect_match_plan(existing_matches)
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
        return stage_update

    return await _create_initial_stage_bracket_preview(db, tournament, actor_id)


async def _tournament_v2_matches(db, tid: str) -> list[dict]:
    return await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)


async def _replacement_targets_or_409(db, tid: str, old_reg_id: str) -> list[dict]:
    """Wo ein Nachrücker die Person ersetzt (#1551) - auch über ein Freilos hinweg, aber nie nach Beginn ihres ersten
    echten Spiels (Liga: höchstens ein Spieltag gespielt)."""
    try:
        return replacement_targets(await _tournament_v2_matches(db, tid), old_reg_id)
    except FillInRefused as exc:
        raise HTTPException(status_code=409, detail=exc.detail) from None


async def _replace_registration_in_open_matches(db, tid: str, old_reg_id: str, new_reg: dict,
                                                actor_id: str | None, targets: list[dict] | None = None) -> dict:
    new_reg_id = new_reg["id"]
    if targets is None:
        targets = await _replacement_targets_or_409(db, tid, old_reg_id)
    now = now_utc().isoformat()
    for match in targets:
        await db.matches_v2.update_one({"id": match["id"]}, {"$set": {**swapped(match, old_reg_id, new_reg), "updated_at": now}})
    v2_count = len(targets)

    await _audit_tournament_action(
        db,
        "tournament.registration.replace_slots",
        actor_id,
        tid,
        {"old_registration_id": old_reg_id, "new_registration_id": new_reg_id, "v2_matches": v2_count},
    )
    return {"v2_matches": v2_count}


async def _place_fill_in(db, tid: str, reg: dict, actor_id: str | None) -> dict | None:
    """Nachrücker nach dem Baubau (#1551): wer jetzt bestätigt oder eingecheckt wird, bekommt genau einen freien Platz -
    zuerst den einer Person „Nicht erschienen“, sonst einen leeren Platz neben einem Freilos. Ohne festen Baum (Vorschau)
    oder wenn die Person schon im Baum steht: nichts zu tun (``None``)."""
    if reg.get("status") not in {"approved", "checked_in"}:
        return None
    matches = await _tournament_v2_matches(db, tid)
    fixed = [match for match in matches if not match.get("is_preview")]
    if not fixed or any(reg["id"] in slot_ids(match) for match in fixed):
        return None
    in_tree = sorted({reg_id for match in fixed for reg_id in slot_ids(match)})
    absent = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": "no_show", "id": {"$in": in_tree}}, {"_id": 0, "id": 1, "seed": 1},
    ).to_list(len(in_tree) + 1)
    placement = None
    for row in sorted(absent, key=lambda item: (item.get("seed") is None, item.get("seed") or 0, item["id"])):
        try:
            targets = replacement_targets(matches, row["id"])
        except FillInRefused:
            continue
        if targets:
            await _replace_registration_in_open_matches(db, tid, row["id"], reg, actor_id, targets)
            placement = {"ok": True, "kind": "no_show", "match_id": targets[0]["id"], "replaced_registration_id": row["id"]}
            break
    if placement is None:
        place = free_bye_place(matches)
        if not place:
            return {"ok": False, "reason": "no_free_place", "detail": NO_PLACE_DETAIL}
        changes = reopened_bye(place, matches, reg, now_utc().isoformat())
        # Folgespiele zuerst, das Freilos-Spiel zuletzt - wie beim Ergebnis-Weg.
        for match_id, change in changes.items():
            if match_id != place["match"]["id"]:
                await db.matches_v2.update_one({"id": match_id}, {"$set": change})
        await db.matches_v2.update_one({"id": place["match"]["id"]}, {"$set": changes[place["match"]["id"]]})
        placement = {"ok": True, "kind": "bye", "match_id": place["match"]["id"],
                     "reset_match_ids": sorted(match_id for match_id in changes if match_id != place["match"]["id"])}
    await _audit_tournament_action(db, "tournament.registration.fill_in", actor_id, tid, {"registration_id": reg["id"], **placement})
    # Läufe zusammenlegen (#1550): die Belegung hat sich geändert - gleich prüfen (die Sperre hält der Aufrufer).
    await evaluate_after_write(db, tid, actor_id=actor_id, trigger="fill_in")
    return placement


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
        logger.warning("[achievements] Später Check-in in %s nicht ausgewertet", _log_safe(tid), exc_info=True)


async def _apply_checked_in_badges(user_id: str, tid: str) -> None:
    try:
        from badges import on_checked_in
        await on_checked_in(user_id, tid)
    except Exception:
        logger.warning("[achievements] Check-in in %s nicht ausgewertet", _log_safe(tid), exc_info=True)


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
    # Co-Team einer Liga (#1649): Kennung und Name des Co-Teams sind öffentlich wie das Team selbst.
    regs = [{**_public_registration(r, user, is_staff), **{key: r[key] for key in ("squad_id", "squad_name") if r.get(key)}}
            for r in regs]
    marks: dict = {}
    # enrich user + team
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    team_ids = list({r["team_id"] for r in regs if r.get("team_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, private_projection()).to_list(500)}
    teams = {t["id"]: t for t in await db.teams.find(
        {"id": {"$in": team_ids}}, {"_id": 0}).to_list(500)}
    # Turnier nur mit Event-Anmeldung (#875): die Turnierleitung sieht, wer (noch) beim Event angemeldet ist.
    if is_staff:
        marks = await tournament_event_gate.staff_marks(db, t_doc, regs, teams)
    for r in regs:
        if r.get("id") in marks:
            r["event_gate"] = marks[r["id"]]
        if r.get("user_id"):
            u = users.get(r["user_id"]) or {}
            r["user"] = {"id": u.get("id"), "username": u.get("username"),
                         "display_name": u.get("display_name"), "avatar_url": u.get("avatar_url")}
        if r.get("team_id"):
            t = teams.get(r["team_id"]) or {}
            r["team"] = {"id": t.get("id"), "name": t.get("name"), "tag": t.get("tag"),
                         "logo_url": t.get("logo_url"), "member_count": len(t.get("member_ids") or [])}
            if user and r.get("team_id") in user_team_ids:
                r["is_mine"] = True
    return regs


@router.get("/{tid}/assignable-users")
async def list_assignable_tournament_users(tid: str, q: str | None = None, limit: int = 200,
                                           me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    # Helfer und Turnierleitung wählen Konten nach Name und Bild; E-Mail-Adresse und Kontorolle sieht nur der Bereich
    # System (#1294) - mit bestätigter Zwei-Faktor-Anmeldung.
    from services.permissions import needs_mfa, user_has_area

    full_view = await user_has_area(me, "system") and not needs_mfa(me)
    query = {"is_banned": {"$ne": True}}
    if q:
        pattern = safe_regex(q)
        fields = ["username", "display_name"] + (["email"] if full_view else [])
        query["$or"] = [{field: {"$regex": pattern, "$options": "i"}} for field in fields]
    projection = {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1}
    if full_view:
        projection.update({"email": 1, "role": 1})
    users = await db.users.find(query, projection).sort("display_name", 1).to_list(max(1, min(int(limit or 200), 500)))
    return users


async def _create_self_registration(db, tid: str, tournament: dict, body: RegistrationCreate,
                                    me: dict, register_access: dict | None, *, via: str = "web") -> dict:
    existing = await db.tournament_registrations.find_one(
        {"tournament_id": tid, "user_id": me["id"]},
        {"_id": 0},
    )
    if existing:
        existing.pop("identity_key", None)
        # Fehlte nach einem Abbruch der Rechnungsauftrag, legt die Wiederholung ihn nach (#1184).
        repaired = await tournament_fees.repair_order(db, existing, tournament, actor=me)
        if repaired:
            existing.update({"price_snapshot": repaired, "billing_status": existing.get("billing_status") or "pending"})
        return {**existing, "auto_bracket_update": None, "idempotent_replay": True, "order_repaired": bool(repaired)}
    team = await _validate_registration_actor(db, tournament, body, me)
    if team:
        existing_team = await db.tournament_registrations.find_one(
            {"tournament_id": tid, "team_id": team["id"]},
            {"_id": 0},
        )
        if existing_team:
            existing_team.pop("identity_key", None)
            return {**existing_team, "auto_bracket_update": None, "idempotent_replay": True}
    # Turnier nur mit Event-Anmeldung (#875) - auch über einen Zugangslink; das Team mit genug Leuten beim Event.
    gate = await tournament_event_gate.check(db, tournament, user=None if team else me, team=team)
    if gate and not gate["ok"]:
        raise HTTPException(status_code=403, detail=gate["text"])
    # Startgeld (#319): kostet die Teilnahme etwas, muss die anmeldende Person die Kosten ausdrücklich übernehmen.
    fee_offer = tournament.get("billing") or {}
    if tournament_fees.charges(tournament, fee_offer) and not body.accept_costs:
        raise HTTPException(status_code=400, detail="Bitte bestätige, dass du das Startgeld übernimmst (Rechnung an dich).")
    game = await db.games.find_one({"id": tournament.get("game_id")}, {"_id": 0}) if tournament.get("game_id") else None
    game = await _enrich_game_identity(db, game)
    player_ids = {**_profile_player_ids(me, game), **(body.player_ids or {})}
    missing = _missing_game_fields(game, player_ids)
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
        "registered_via": via,
        "selected_positions": list(body.selected_positions or []),
        "costs_accepted_by": me["id"] if body.accept_costs else None,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    if count >= tournament.get("max_participants", 32):
        reg["status"] = "waitlist"
    # Zugangslink mit Limit (#1036): die Nutzung atomar belegen, bevor die Anmeldung geschrieben wird.
    try:
        claimed = await claim_access_link_use(db, register_access, me)
    except AccessLinkUsedUp as exc:
        raise HTTPException(status_code=409, detail=exc.detail)
    try:
        await db.tournament_registrations.insert_one(reg)
    except Exception as exc:
        if claimed:
            await release_access_link_use(db, register_access, me)
        if not isinstance(exc, DuplicateKeyError):
            raise
        existing = await db.tournament_registrations.find_one(
            {"identity_key": reg["identity_key"]},
            {"_id": 0},
        )
        if existing:
            existing.pop("identity_key", None)
            return {**existing, "auto_bracket_update": None, "idempotent_replay": True}
        raise
    if reg["status"] in {"approved", "checked_in"}:
        # Verbindlich dabei: Preis einfrieren, Auftrag anlegen (#319). Warteliste zahlt beim Nachrücken.
        snapshot = await tournament_fees.freeze_price(db, reg, tournament, payer=me)
        if snapshot:
            reg["price_snapshot"], reg["billing_status"] = snapshot, "pending"
    reg.pop("_id", None)
    reg.pop("identity_key", None)
    # Vorschau-Baum, Bestätigung und Erfolge folgen nach der Sperre (#1859, ``self_register``).
    reg["auto_bracket_update"] = None
    reg["idempotent_replay"] = False
    return reg


@router.post("/{tid}/register")
async def register_for_tournament(tid: str, body: RegistrationCreate,
                                   access: str | None = None,
                                   me: dict = Depends(get_current_user),
                                   request: Request = None,
                                   background: BackgroundTasks = None):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    view_access = await validate_access_link(db, access, "tournament", tid, me, "view")
    register_access = await validate_access_link(db, access, "tournament", tid, me, "register")
    has_access = bool(view_access or register_access)
    # Vor-Ort-Zugang (#1592): öffnet die Anmeldung auch ohne Sichtbarkeit; die Leitung sieht „vor Ort“.
    onsite = await onsite_access.has_pass(db, request, t)
    if not has_access and not onsite:
        t = await _get_visible_tournament(tid, me)
    elif t.get("status") == "draft" and not register_access:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    # Abzeichen erst nach der Antwort (#1859): am Einlass wartet niemand auf die Auswertung der Erfolge.
    return await self_register(db, t, body, me, register_access, via="onsite" if onsite else "web", followups=background)


async def self_register(db, t: dict, body: RegistrationCreate, me: dict, register_access: dict | None, *, via: str = "web",
                        followups: BackgroundTasks | None = None) -> dict:
    """Die Selbstanmeldung hinter der Route - das Website-Formular und der Discord-Knopf (#885) laufen hier durch
    dieselben Prüfungen (Sperre, Regeln und Datenschutz, Frist, Vereinsmitglieder, Event-Pflicht, Startgeld).

    ``followups``: die Abzeichen laufen dann nach der Antwort (Route); ohne gleich hier (Discord, Event). Die Bestätigung
    geht immer vor der Antwort hinaus (außerhalb der Sperre): ein Hintergrund-Auftrag überlebt keinen Neustart, und eine
    Wiederholung der Anmeldung schickt sie nicht nach."""
    tid = t["id"]
    if _is_tournament_locked(t):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
    if not body.accept_rules or not body.accept_privacy:
        raise HTTPException(status_code=400, detail="Regeln und Datenschutz müssen akzeptiert werden.")
    registration_error = _registration_error(t)
    if registration_error and not register_access:
        raise HTTPException(status_code=400, detail=registration_error)
    if t.get("block_club_member_registration") and await _is_active_club_member(db, me):
        raise HTTPException(status_code=403, detail="Dieses Turnier ist für externe Teilnehmer vorgesehen. Vereinsmitglieder können sich hier nicht selbst anmelden.")
    queue = _registration_queue(tid)
    try:
        # Gleichzeitige Anmeldungen (#1826, Vor-Ort-QR am Einlass) stellen sich an der Sperre an statt abzubrechen -
        # im selben Prozess der Reihe nach (#1859), ohne Lücken durch das Nachfragen an der Sperre. In der Sperre nur
        # Platz und Startgeld; der Vorschau-Baum folgt danach, einmal für alle bis dahin Angemeldeten.
        async with queue.turn(registration_wait_seconds()) as wait:
            async with mutation_lock(db, tournament_write_resource(tid), wait_seconds=wait):
                current = await db.tournaments.find_one({"id": tid}, {"_id": 0})
                if not current:
                    raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
                if _is_tournament_locked(current):
                    raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
                current_error = _registration_error(current)
                if current_error and not register_access:
                    raise HTTPException(status_code=400, detail=current_error)
                reg = await _create_self_registration(db, tid, current, body, me, register_access, via=via)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")
    if not reg.get("idempotent_replay"):
        if reg["status"] in {"approved", "checked_in"}:
            queue.requested += 1
            reg["auto_bracket_update"] = await _refresh_previews_after_self_registration(db, tid, queue.requested,
                                                                                         me.get("id"))
        await _confirm_self_registration(db, tid, reg, me)
        if followups is not None:
            followups.add_task(_award_registration_badges, me["id"], tid)
        else:
            await _award_registration_badges(me["id"], tid)
    return reg


class _RegistrationQueue:
    """Die Schlange der Selbstanmeldungen eines Turniers in diesem Prozess (#1859).

    Die Turnier-Sperre liegt in MongoDB, damit sie über Prozesse hinweg gilt; wer wartet, fragt sie im Takt neu an. Bei
    16 Anmeldungen im selben Moment entstanden so zwischen zwei Anmeldungen Lücken bis zum nächsten Nachfragen. Hier
    stellen sich die Anmeldungen eines Prozesses vorher der Reihe nach an (``asyncio.Lock`` ist fair): die nächste fragt
    die Sperre erst, wenn die vorige sie freigibt, und bekommt sie sofort.

    ``requested`` zählt die bestätigten Anmeldungen (erhöht erst nach dem Speichern), ``refreshed`` bis zu welcher Nummer
    der Vorschau-Baum sie schon enthält."""

    __slots__ = ("lock", "requested", "refreshed")

    def __init__(self):
        self.lock = asyncio.Lock()
        self.requested = 0
        self.refreshed = 0

    @contextlib.asynccontextmanager
    async def turn(self, wait_seconds: float):
        """In der Schlange warten, höchstens ``wait_seconds``; liefert die verbleibende Wartezeit für die Sperre."""
        loop = asyncio.get_running_loop()
        started = loop.time()
        try:
            async with asyncio.timeout(wait_seconds):
                await self.lock.acquire()
        except TimeoutError:
            raise MutationLockBusy("registration queue") from None
        try:
            yield max(0.5, wait_seconds - (loop.time() - started))
        finally:
            self.lock.release()


_REGISTRATION_QUEUES: dict[tuple[int, str], _RegistrationQueue] = {}


def _registration_queue(tid: str) -> _RegistrationQueue:
    key = (id(asyncio.get_running_loop()), tid)
    queue = _REGISTRATION_QUEUES.get(key)
    if queue is None:
        queue = _REGISTRATION_QUEUES[key] = _RegistrationQueue()
    return queue


# Scheitert der Neubau der Vorschau, gleich noch einmal - erst dann bleibt sie bis zur nächsten Änderung stehen.
PREVIEW_REFRESH_ATTEMPTS = 2


async def _refresh_previews_after_self_registration(db, tid: str, number: int, actor_id: str | None) -> dict | None:
    """Den Vorschau-Baum nach der Anmeldung Nummer ``number`` auffrischen - ohne die Platzvergabe aufzuhalten (#1859).
    Abmeldungen stellen sich genauso an (#1871).

    Früher baute jede Anmeldung den Baum in der Turnier-Sperre neu, die nächste wartete so lange. Jetzt stellt sich das
    Auffrischen hinten an die Schlange: Wer am Einlass gleichzeitig kam, ist bis dahin gespeichert, ein Neubau nimmt
    alle mit, die übrigen sehen „schon erledigt“. Ein Fehler oder eine besetzte Sperre beim Baum kostet niemanden seinen
    Platz (er ist schon gespeichert); der Baum wächst dann mit der nächsten Anmeldung oder beim Check-in-Ende.

    Mehrere Prozesse: jeder zählt nur seine eigenen Anmeldungen und baut im Zweifel einmal mehr - nie zu selten."""
    queue = _registration_queue(tid)
    if queue.refreshed >= number:
        return None
    try:
        async with queue.turn(registration_wait_seconds()) as wait:
            if queue.refreshed >= number:
                return None
            async with mutation_lock(db, tournament_write_resource(tid), wait_seconds=wait):
                covered = queue.requested
                for attempt in range(1, PREVIEW_REFRESH_ATTEMPTS + 1):
                    try:
                        tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
                        update = await _refresh_tournament_previews_after_registration(db, tournament, actor_id) if tournament else None
                    except Exception:  # noqa: BLE001
                        if attempt < PREVIEW_REFRESH_ATTEMPTS:
                            logger.warning("Vorschau nach Anmeldung zu %s gescheitert - neuer Versuch", _log_safe(tid))
                            continue
                        logger.exception("Vorschau nach Anmeldung zu %s nicht aufgefrischt", _log_safe(tid))
                        return None
                    queue.refreshed = max(queue.refreshed, covered)
                    return update
    except MutationLockBusy:
        logger.warning("Vorschau nach Anmeldung zu %s nicht aufgefrischt: Sperre besetzt", _log_safe(tid))
    return None


# Felder der Antwort, die nicht zur Anmeldung selbst gehören.
RESPONSE_ONLY_KEYS = {"auto_bracket_update", "idempotent_replay"}


async def _after_self_registration(db, tid: str, reg: dict, me: dict) -> None:
    """Nach der Sperre (#1826): Bestätigung und Erfolge brauchen sie nicht - so hält eine Anmeldung die Sperre nur
    für Platz und Startgeld, und die nächste in der Schlange kommt früher dran."""
    await _confirm_self_registration(db, tid, reg, me)
    await _award_registration_badges(me["id"], tid)


async def _confirm_self_registration(db, tid: str, reg: dict, me: dict) -> None:
    """Bestätigung (#1133): „Du bist dabei“ oder „Du stehst auf der Warteliste“ - im Postfach und, wenn erlaubt, per
    Mail; bei Teams auch an Teamleitung und Co-Leitung.

    Ohne Sperre kann sich der Stand inzwischen geändert haben - etwa von der Warteliste nachgerückt, mit eigener
    Nachricht „nachgerückt“. Die Bestätigung geht daher nur hinaus, solange die Anmeldung noch diesen Stand hat, und
    je Anmeldung nur einmal: Stand prüfen und als gemeldet markieren in einem Schritt."""
    claimed = await db.tournament_registrations.update_one(
        {"id": reg["id"], "status": reg["status"], "notified_status": {"$exists": False}},
        {"$set": {"notified_status": reg["status"]}},
    )
    if getattr(claimed, "modified_count", 0):
        registration = {key: value for key, value in reg.items() if key not in RESPONSE_ONLY_KEYS}
        await _notify_registration(db, tid, registration, reg["status"], actor_id=me.get("id"))


async def _award_registration_badges(user_id: str, tid: str) -> None:
    """Erfolge der Anmeldung - die Auswertung ist der größte Teil einer Anmeldung (#1859) und darf sie nicht aufhalten."""
    try:
        from badges import on_tournament_registered
        await on_tournament_registered(user_id, tid)
    except Exception:
        logger.warning("[achievements] Anmeldung zu %s nicht ausgewertet", _log_safe(tid), exc_info=True)


@router.post("/{tid}/registrations")
async def admin_create_registration(tid: str, body: RegistrationAdminCreate,
                                    me: dict = Depends(get_current_user),
                                    _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    if is_league_staffel(tournament):
        # Liga-Staffel (#2109): nur Co-Teams über „Co-Team zuteilen“ (mit Kader- und Season-Prüfung) - kein ganzes
        # Hauptteam und kein Ersatz an diesen Prüfungen vorbei. Diese Route kennt kein ``squad_id``.
        raise HTTPException(status_code=400, detail=STAFFEL_REGISTRATION_REFUSED)

    payload = body.model_dump()
    user = None
    if payload.get("user_id"):
        user = await db.users.find_one({"id": payload["user_id"]}, private_projection())
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
    replace_targets: list[dict] | None = None
    if old_reg_id:
        old = await db.tournament_registrations.find_one({"id": old_reg_id, "tournament_id": tid}, {"_id": 0})
        if not old:
            raise HTTPException(status_code=404, detail="Zu ersetzende Anmeldung nicht gefunden")
        # Vor dem Eintragen prüfen (#1551): ein Freilos hindert nicht mehr, ein begonnenes erstes Spiel schon.
        replace_targets = await _replacement_targets_or_409(db, tid, old_reg_id)

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
        await _sync_squad_key(db, old, "no_show", tournament)
        await db.tournament_registrations.update_one(
            {"id": old_reg_id},
            {"$set": {"status": "no_show", "updated_at": now_utc().isoformat()}},
        )
        replacement = await _replace_registration_in_open_matches(db, tid, old_reg_id, reg, me.get("id"), replace_targets)
    auto_bracket_update = None
    placement = None
    if reg["status"] in {"approved", "checked_in"}:
        # Vor dem Check-in-Ende frischt auch ein Ersatz die Vorschau auf; ein fester Baum bleibt dabei unberührt.
        auto_bracket_update = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
        if not old_reg_id:
            placement = await _place_fill_in(db, tid, reg, me.get("id"))

    # Turnier nur mit Event-Anmeldung (#875): die Turnierleitung darf übergehen - mit Hinweis und im Audit.
    gate = await tournament_event_gate.check(db, tournament, user=user if user and not team else None, team=team) if (user or team) else None
    overridden = bool(gate and not gate["ok"])
    await _audit_tournament_action(
        db,
        "tournament.registration.staff_add",
        me.get("id"),
        tid,
        {"registration_id": reg["id"], "user_id": reg.get("user_id"), "is_guest": reg["is_guest"], "replace_registration_id": old_reg_id,
         **({"event_gate_overridden": True} if overridden else {})},
    )
    reg.pop("_id", None)
    reg.pop("identity_key", None)
    if reg.get("user_id") or reg.get("team_id"):
        # Von der Turnierleitung eingetragen (#1133): die Person (bei Teams die Teamleitung) erfährt, dass sie dabei ist.
        await _notify_registration(db, tid, reg, reg["status"], actor_id=me.get("id"))
    return {
        "registration": reg,
        "replacement": replacement,
        "placement": placement,
        "auto_bracket_update": auto_bracket_update,
        "idempotent_replay": False,
        "event_gate_warning": (gate["text"] + " Trotzdem eingetragen.") if overridden else None,
    }


@router.put("/{tid}/registrations/{reg_id}")
@router.patch("/{tid}/registrations/{reg_id}")
async def update_registration(tid: str, reg_id: str, body: RegistrationUpdate,
                               me: dict = Depends(get_current_user),
                               _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament_doc = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if updates.get("status") in REMOVAL_KINDS:
        # Austritt und Disqualifikation (#1553) bauen den Baum um - das geht nur über den Umbauplan mit Bestätigung.
        raise HTTPException(
            status_code=409,
            detail="Austritt und Disqualifikation bitte über „Austritt eintragen“ bzw. „Disqualifizieren“ in der "
                   "Teilnehmerliste - dort wird der Umbau des Turnierbaums gezeigt und bestätigt.",
        )
    # Der Grund einer Absage geht nur in die Nachricht an die Person (#1133), nicht an die Anmeldung.
    status_reason = updates.pop("status_reason", None)
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if not reg:
        raise HTTPException(status_code=404, detail="Anmeldung nicht gefunden")
    if updates and all(reg.get(key) == value for key, value in updates.items()):
        return {**reg, "idempotent_replay": True}
    previous_status = reg.get("status")
    if (updates.get("status") in LEAVES_BRACKET_STATUSES and updates["status"] != previous_status
            and await tournament_guard.fixed_match_count(db, tid, reg_id)):
        # Abgelehnt, Warteliste oder Ausstehend nimmt die Anmeldung aus dem Spiel (#2120, TA13) - im festen Baum
        # blieben ihre Spiele mit einer Anmeldung stehen, die nicht mehr mitspielt.
        raise HTTPException(status_code=409, detail=tournament_guard.registration_removal_refused(tournament_doc))
    if updates.get("status") and updates["status"] != previous_status:
        # Co-Team einer Liga (#1649): der Season-Schlüssel folgt dem Status - vor dem Schreiben, damit ein Co-Team, das
        # inzwischen in einer anderen Staffel spielt, hier nicht wieder aktiv wird.
        await _sync_squad_key(db, reg, updates["status"], tournament_doc)
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_registrations.update_one({"id": reg_id, "tournament_id": tid}, {"$set": updates})
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if updates.get("status") and updates["status"] != previous_status:
        await _notify_registration(db, tid, reg, updates["status"], previous=previous_status, reason=status_reason, actor_id=me.get("id"))
    if updates.get("status") in {"rejected", "waitlist", "no_show"}:
        reg["waitlist_moved_up"] = await _move_up_from_waitlist(db, tid, me.get("id"), exclude_id=reg_id)
    if updates.get("status") in {"approved", "checked_in"} and updates["status"] != previous_status:
        reg["placement"] = await _place_fill_in(db, tid, reg, me.get("id"))
    if updates.get("status") in {"approved", "checked_in", "rejected", "waitlist", "no_show"}:
        tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if tournament:
            reg["auto_bracket_update"] = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
            # Startgeld (#319): Freigabe friert den Preis ein (Zahlungspflichtig ist, wer angemeldet hat);
            # Ablehnung oder Nichterscheinen vor dem Beleg schließt den Auftrag.
            if updates["status"] in tournament_fees.BILLABLE_STATUSES:
                payer = await db.users.find_one({"id": reg.get("user_id")}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "email": 1})
                if payer:
                    snapshot = await tournament_fees.freeze_price(db, reg, tournament, payer=payer)
                    if snapshot:
                        reg["price_snapshot"], reg["billing_status"] = snapshot, "pending"
            elif updates["status"] in tournament_fees.CLOSED_STATUSES:
                await tournament_fees.close_price(db, reg, f"Anmeldung: {updates['status']}")
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
    tournament_doc = await _ensure_tournament_unlocked(db, tid)
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
            await _sync_squad_key(db, reg, status, tournament_doc)

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
            moved_up = await _move_up_from_waitlist(db, tid, me.get("id"), exclude_id=reg_id) if status == "no_show" else []
            updated = await db.tournament_registrations.find_one({"id": reg_id}, {"_id": 0})
            # Nach dem Check-in-Ende: wer jetzt eingecheckt wird, rückt auf einen freien Platz nach (#1551).
            placement = await _place_fill_in(db, tid, updated, me.get("id")) if status == "checked_in" else None
            return {**updated, "waitlist_moved_up": moved_up, "placement": placement, "idempotent_replay": False}
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail="Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen.")


@router.delete("/{tid}/registrations/{reg_id}")
async def delete_registration(tid: str, reg_id: str, me: dict = Depends(get_current_user)):
    """Abmelden (#1871): wie die Anmeldung (#1859) hält die Sperre nur Abmeldung und Nachrücken; den Vorschau-Baum baut
    die Abmeldung danach, hinten in der Schlange der Anmeldungen - einmal für alle bis dahin."""
    db = get_db()
    tid = await _resolve_tid(tid)
    queue = _registration_queue(tid)
    try:
        async with queue.turn(registration_wait_seconds()) as wait:
            async with mutation_lock(db, tournament_write_resource(tid), wait_seconds=wait):
                tournament = await _delete_registration_locked(db, tid, reg_id, me)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=TOURNAMENT_BUSY_DETAIL)
    auto_bracket_update = None
    if tournament:
        queue.requested += 1
        auto_bracket_update = await _refresh_previews_after_self_registration(db, tid, queue.requested, me.get("id"))
    return {"ok": True, "auto_bracket_update": auto_bracket_update}


async def _delete_registration_locked(db, tid: str, reg_id: str, me: dict) -> dict | None:
    """Prüfen, abmelden, Warteliste nachrücken - alles in der Turnier-Sperre, damit die Plätze exakt bleiben."""
    await _ensure_tournament_unlocked(db, tid)
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid})
    if not reg:
        raise HTTPException(status_code=404)
    is_own_registration = reg.get("user_id") == me["id"]
    is_team_manager = False
    # Ein zugeteiltes Co-Team (#1649) nimmt nur die Turnierleitung wieder heraus - die Teamleitung meldet es nicht ab.
    if reg.get("team_id") and not reg.get("squad_id"):
        team = await db.teams.find_one({"id": reg["team_id"]}, {"_id": 0})
        is_team_manager = bool(team and _can_register_team(team, me))
    is_staff = await has_tournament_staff_permission(me, tid, PARTICIPANT_STAFF_ROLES)
    if not is_own_registration and not is_team_manager and not is_staff:
        # Co-Team (#2109): eine deutsche Begründung statt eines nackten 403.
        raise HTTPException(status_code=403, detail=SQUAD_UNREGISTER_REFUSED if reg.get("squad_id") else None)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if is_staff and await tournament_guard.fixed_match_count(db, tid, reg_id):
        # Nur ein fester Baum hält die Person (#1551) - die Vorschau während des Check-ins wächst noch mit. Seit #2120
        # (TA13) in jedem Status: vorher ging Entfernen im laufenden, pausierten oder beendeten Turnier, und die Spiele
        # behielten die Anmeldung, die es nicht mehr gab.
        raise HTTPException(status_code=409, detail=tournament_guard.registration_removal_refused(tournament or {}))
    if (is_own_registration or is_team_manager) and not is_staff:
        if reg.get("status") == "checked_in" or (tournament or {}).get("status") in {"live", "paused", "completed", "results_published", "archived"}:
            raise HTTPException(status_code=409, detail="Abmeldung ist nach Check-in oder Turnierstart nur über die Turnierleitung möglich.")
        v2_blocked = await db.matches_v2.count_documents({
            "tournament_id": tid,
            "slots.registration_id": reg_id,
            "status": {"$nin": ["preview", "pending", "ready", "scheduled", "cancelled"]},
        })
        if v2_blocked:
            raise HTTPException(status_code=409, detail="Abmeldung ist nicht mehr möglich, weil bereits Spiele aktiv oder gewertet sind.")
    await tournament_fees.close_price(db, reg, "Abmeldung")
    await db.tournament_registrations.delete_one({"id": reg_id})
    await _move_up_from_waitlist(db, tid, me.get("id"))
    await _audit_tournament_action(
        db,
        "tournament.registration.delete",
        me.get("id"),
        tid,
        {"registration_id": reg_id, "user_id": reg.get("user_id"), "self_unregister": (is_own_registration or is_team_manager) and not is_staff},
    )
    return tournament


async def _find_self_registration(db, tid: str, user_id: str) -> dict | None:
    # Einchecken dürfen die Verantwortlichen der Anmeldung (#1136) - dieselbe Regel wie Melden und Dispute.
    return await responsible_registration(db, tid, user_id)


@router.post("/{tid}/checkin")
async def checkin_self(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    # Eine Prüfung für alle Stellen (#1135): Knopf, Startseite, Erinnerungen, Mail und Discord fragen dieselbe Regel.
    if not self_checkin_allowed(tournament):
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
            # Nach dem Check-in-Ende steht der Baum (#1551) - wer jetzt kommt, rückt nur über die Turnierleitung nach.
            # Unter der Sperre frisch gelesen: das Ende (der Job hält dieselbe Sperre) kann nicht dazwischenkommen.
            if _check_in_over(await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}):
                raise HTTPException(status_code=409, detail="Der Check-in ist beendet – bitte bei der Turnierleitung melden.")
            stored = await db.tournament_registrations.update_one(
                {"id": reg["id"], "status": "approved"}, {"$set": {"status": "checked_in", "updated_at": now_utc().isoformat()}})
            if not getattr(stored, "modified_count", 0):
                return {"ok": True, "idempotent_replay": True}
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


# --- Liga: Co-Team zuteilen (docs/LIGA.md, Abschnitte 2, 4 und 5; #1649) ---
class SquadAssignBody(BaseModel):
    team_id: str = Field(min_length=1, max_length=64)
    squad_id: str = Field(min_length=1, max_length=64)


@router.get("/{tid}/squad-candidates")
async def list_squad_candidates(tid: str, me: dict = Depends(require_area("tournaments"))):
    """Für den Dialog „Co-Team zuteilen“: Hauptteams mit ihren Co-Teams und was gegen eine Zuteilung spricht."""
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not squad_registration.is_league_tournament(tournament):
        raise HTTPException(status_code=400, detail="Co-Teams teilt die Turnierleitung nur Team-Turnieren im Format Liga zu.")
    return await squad_registration.candidates(db, tournament)


SQUAD_SEASON_TAKEN = "Dieses Co-Team spielt in dieser Season schon in einer anderen Staffel."
SQUAD_TEAM_TAKEN = ("Dieses Team hat schon ein Co-Team in dieser Staffel – zwei Co-Teams desselben Teams spielen nie "
                    "in derselben Staffel.")


async def _insert_squad_registration(db, tournament: dict, body: "SquadAssignBody", me: dict) -> dict:
    try:
        reg = await squad_registration.build_registration(db, tournament, body.team_id, body.squad_id, me)
    except squad_registration.SquadAssignError as refusal:
        raise HTTPException(status_code=refusal.status_code, detail=refusal.detail)
    try:
        await db.tournament_registrations.insert_one(reg)
    except DuplicateKeyError:
        # Welcher Index gegriffen hat: steht schon eine Anmeldung mit diesem Season-Schlüssel, war es die Season.
        season_taken = reg.get("league_squad_key") and await db.tournament_registrations.find_one(
            {"league_squad_key": reg["league_squad_key"]}, {"_id": 0, "id": 1})
        raise HTTPException(status_code=409, detail=SQUAD_SEASON_TAKEN if season_taken else SQUAD_TEAM_TAKEN)
    return reg


@router.post("/{tid}/squad-registrations")
async def assign_squad(tid: str, body: SquadAssignBody, me: dict = Depends(require_area("tournaments")),
                       _mutation_tid: str = Depends(_serialized_tournament_write)):
    """Die Turnierleitung teilt ein Co-Team der Staffel zu - als freigegebene Team-Anmeldung mit ``squad_id``."""
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    # Staffeln derselben Season teilen dasselbe Co-Team nie gleichzeitig zu: Sperre je Season (die Turnier-Sperre
    # hält nur diese Staffel), dazu der eindeutige Index auf ``league_squad_key``.
    season_resource = squad_registration.season_lock_resource(tournament)
    try:
        async with (mutation_lock(db, season_resource) if season_resource else contextlib.nullcontext()):
            reg = await _insert_squad_registration(db, tournament, body, me)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=TOURNAMENT_BUSY_DETAIL)
    reg.pop("_id", None)
    reg.pop("identity_key", None)
    await _audit_tournament_action(db, "league.squad.assign", me.get("id"), tid, {
        "registration_id": reg["id"], "team_id": reg["team_id"], "squad_id": reg["squad_id"], "squad_name": reg.get("squad_name"),
    })
    auto_bracket_update = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
    # Wie beim Eintragen durch die Turnierleitung (#1133): die Verantwortlichen erfahren, dass ihr Co-Team dabei ist.
    await _notify_registration(db, tid, reg, reg["status"], actor_id=me.get("id"))
    # Liga-Kader (#2108): die Spiel-ID jedes Spielers für die Season festhalten; wem sie fehlt, bekommt einen Hinweis.
    squad = await db.team_squads.find_one({"id": reg["squad_id"]}, {"_id": 0, "id": 1, "member_ids": 1}) or {}
    ids = await league_roster.after_assign(db, tournament, reg, squad, me.get("id"))
    missing = [row["name"] for row in ids.values() if not row["ok"]]
    return {"registration": reg, "auto_bracket_update": auto_bracket_update, "ids_missing": sorted(missing)}


@router.delete("/{tid}/squad-registrations/{reg_id}")
async def remove_squad(tid: str, reg_id: str, me: dict = Depends(require_area("tournaments")),
                       _mutation_tid: str = Depends(_serialized_tournament_write)):
    """Zuteilung zurücknehmen - nur solange das Co-Team in keinem festen Spiel steht."""
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    reg = await db.tournament_registrations.find_one({"id": reg_id, "tournament_id": tid}, {"_id": 0})
    if not reg or not reg.get("squad_id"):
        raise HTTPException(status_code=404, detail="Zuteilung nicht gefunden")
    if await tournament_guard.fixed_match_count(db, tid, reg_id):
        raise HTTPException(status_code=409, detail="Der Spielplan steht schon – das Co-Team bitte über „Austritt "
                                                    "eintragen“ in der Teilnehmerliste herausnehmen.")
    await db.tournament_registrations.delete_one({"id": reg_id, "tournament_id": tid})
    await _audit_tournament_action(db, "league.squad.remove", me.get("id"), tid, {
        "registration_id": reg_id, "team_id": reg.get("team_id"), "squad_id": reg.get("squad_id"), "squad_name": reg.get("squad_name"),
    })
    auto_bracket_update = await _refresh_tournament_previews_after_registration(db, tournament, me.get("id"))
    return {"ok": True, "auto_bracket_update": auto_bracket_update}
