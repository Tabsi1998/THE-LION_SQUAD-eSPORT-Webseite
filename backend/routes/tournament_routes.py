"""Tournament + bracket routes."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from datetime import datetime, timezone
from database import get_db
from auth import get_current_user, require_admin, get_optional_user
from services.visibility import user_can_see
from services.public_phase import derive_public_phase
from models import (
    TournamentCreate, TournamentUpdate, RegistrationCreate, RegistrationUpdate,
    now_utc, new_id,
)
from bracket_engine import generate_bracket, compute_round_robin_standings
from bracket_extensions import (
    generate_swiss_round, compute_swiss_standings, generate_groups, compute_group_standings,
)

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}


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


async def _get_visible_tournament(tid: str, user: dict | None) -> dict:
    db = get_db()
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_staff = _is_staff(user)
    if t.get("status") == "draft" and not is_staff:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if t.get("is_public") is False and not is_staff:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not await user_can_see(user, t.get("visibility") or "public"):
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


def _registration_error(t: dict) -> str | None:
    if t.get("registration_enabled") is False or t.get("is_invite_only"):
        return "Anmeldung fuer dieses Turnier ist deaktiviert"
    if t.get("status") != "registration_open":
        return "Anmeldung fuer dieses Turnier geschlossen"
    now = datetime.now(timezone.utc)
    open_from = _parse_dt(t.get("registration_open_from"))
    open_until = _parse_dt(t.get("registration_open_until"))
    if open_from and now < open_from:
        return "Anmeldung ist noch nicht geoeffnet"
    if open_until and now > open_until:
        return "Anmeldung ist bereits beendet"
    return None


def _required_game_fields(game: dict | None) -> list[dict]:
    fields = []
    for field in (game or {}).get("player_id_fields") or []:
        if isinstance(field, dict) and field.get("required") is not False and field.get("key"):
            fields.append(field)
    return fields


async def _enrich_tournament(t: dict, user: dict | None = None) -> dict:
    db = get_db()
    is_staff = _is_staff(user)
    t["public_phase"] = derive_public_phase(t, "tournament")
    if t.get("game_id"):
        g = await db.games.find_one({"id": t["game_id"]}, {"_id": 0})
        t["game"] = g
    if t.get("event_id"):
        e = await db.events.find_one({"id": t["event_id"]}, {"_id": 0, "tournaments": 0, "f1_challenges": 0})
        if e and (is_staff or e.get("status") != "draft") and await user_can_see(user, e.get("visibility") or "public"):
            t["event"] = e
    t["participant_count"] = await db.tournament_registrations.count_documents(
        {"tournament_id": t["id"], "status": {"$in": ["approved", "checked_in"]}})
    return t


async def _resolve_tid(slug_or_id: str) -> str:
    """Resolve slug to id if needed. Returns id or raises 404."""
    db = get_db()
    t = await db.tournaments.find_one(
        {"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"id": 1}
    )
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return t["id"]


@router.get("")
async def list_tournaments(status: str | None = None, game_id: str | None = None,
                           event_id: str | None = None, limit: int = 100,
                           user=Depends(get_optional_user)):
    db = get_db()
    is_admin = user and user.get("role") in STAFF_ROLES
    q = {}
    if status:
        q["status"] = status
    elif not is_admin:
        q["status"] = {"$ne": "draft"}
    if game_id:
        q["game_id"] = game_id
    if event_id:
        q["event_id"] = event_id
    tournaments = await db.tournaments.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    if not is_admin:
        visible = []
        for t in tournaments:
            if t.get("is_public") is not False and await user_can_see(user, t.get("visibility") or "public"):
                visible.append(t)
        tournaments = visible
    for t in tournaments:
        await _enrich_tournament(t, user)
    return tournaments


@router.get("/{slug_or_id}")
async def get_tournament(slug_or_id: str, user=Depends(get_optional_user)):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    is_admin = user and user.get("role") in STAFF_ROLES
    if t.get("status") == "draft" and not is_admin:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not is_admin and t.get("is_public") is False:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not await user_can_see(user, t.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Turnier ist nicht sichtbar")
    await _enrich_tournament(t, user)
    if t.get("event_id"):
        t["related_f1_challenges"] = await db.f1_challenges.find(
            {"event_id": t["event_id"], "status": {"$ne": "draft"}},
            {"_id": 0, "id": 1, "title": 1, "slug": 1, "start_date": 1, "status": 1, "visibility": 1},
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


@router.post("")
async def create_tournament(body: TournamentCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.tournaments.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    # Validate game
    if not await db.games.find_one({"id": body.game_id}):
        raise HTTPException(status_code=400, detail="Spiel nicht gefunden")
    doc = body.model_dump()
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
    doc.pop("_id", None)
    return doc


@router.put("/{tid}")
@router.patch("/{tid}")
async def update_tournament(tid: str, body: TournamentUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    raw_updates = body.model_dump(exclude_unset=True)
    nullable_fields = {
        "description", "platform", "event_id", "registration_open_from",
        "registration_open_until", "check_in_from", "check_in_until",
        "start_date", "end_date", "rules", "prize_pool", "prize_places",
        "stream_link", "twitch_channel", "discord_link", "location",
        "banner_url", "stream_platform", "stream_url", "stream_title",
    }
    updates = {k: v for k, v in raw_updates.items() if v is not None or k in nullable_fields}
    for k in ["registration_open_from", "registration_open_until", "check_in_from",
              "check_in_until", "start_date", "end_date"]:
        if k in updates:
            updates[k] = _iso(updates[k])
    updates["updated_at"] = now_utc().isoformat()
    await db.tournaments.update_one({"id": tid}, {"$set": updates})
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    return t


@router.delete("/{tid}")
async def delete_tournament(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    await db.tournaments.delete_one({"id": tid})
    await db.tournament_registrations.delete_many({"tournament_id": tid})
    await db.matches.delete_many({"tournament_id": tid})
    return {"ok": True}


# --- Registrations ---
@router.get("/{tid}/registrations")
async def list_registrations(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t_doc = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user)
    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
    if not is_staff and t_doc.get("show_participants") is False:
        regs = [r for r in regs if user and r.get("user_id") == user.get("id")]
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
    return regs


@router.post("/{tid}/register")
async def register_for_tournament(tid: str, body: RegistrationCreate,
                                   me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _get_visible_tournament(tid, me)
    registration_error = _registration_error(t)
    if registration_error:
        raise HTTPException(status_code=400, detail=registration_error)
    existing = await db.tournament_registrations.find_one({"tournament_id": tid, "user_id": me["id"]})
    if existing:
        raise HTTPException(status_code=409, detail="Bereits angemeldet")
    game = await db.games.find_one({"id": t.get("game_id")}, {"_id": 0}) if t.get("game_id") else None
    submitted_ids = body.player_ids or {}
    profile_game_ids = ((me.get("game_ids") or {}).get(game.get("slug")) if game else {}) or {}
    player_ids = {**profile_game_ids, **submitted_ids}
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
        "team_id": body.team_id,
        "status": "approved",  # auto-approve by default; admin can flip to manual flow
        "ingame_name": body.ingame_name or me.get("display_name") or me.get("username"),
        "discord": body.discord or me.get("discord_name"),
        "platform_id": body.platform_id,
        "player_ids": player_ids,
        "notes": body.notes,
        "accepted_rules": body.accept_rules,
        "accepted_privacy": body.accept_privacy,
        "seed": None,
        "display_name": me.get("display_name") or me.get("username"),
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    if count >= t.get("max_participants", 32):
        reg["status"] = "waitlist"
    await db.tournament_registrations.insert_one(reg)
    reg.pop("_id", None)
    # Badge trigger
    try:
        from badges import on_tournament_registered
        await on_tournament_registered(me["id"], tid)
    except Exception:
        pass
    return reg


@router.put("/{tid}/registrations/{reg_id}")
@router.patch("/{tid}/registrations/{reg_id}")
async def update_registration(tid: str, reg_id: str, body: RegistrationUpdate,
                               me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_registrations.update_one({"id": reg_id}, {"$set": updates})
    reg = await db.tournament_registrations.find_one({"id": reg_id}, {"_id": 0})
    return reg


@router.delete("/{tid}/registrations/{reg_id}")
async def delete_registration(tid: str, reg_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    reg = await db.tournament_registrations.find_one({"id": reg_id})
    if not reg:
        raise HTTPException(status_code=404)
    if reg["user_id"] != me["id"] and me["role"] not in ("moderator", "tournament_admin", "club_admin", "superadmin"):
        raise HTTPException(status_code=403)
    await db.tournament_registrations.delete_one({"id": reg_id})
    return {"ok": True}


@router.post("/{tid}/checkin")
async def checkin_self(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    reg = await db.tournament_registrations.find_one({"tournament_id": tid, "user_id": me["id"]})
    if not reg:
        raise HTTPException(status_code=404, detail="Keine Anmeldung gefunden")
    if reg["status"] not in ("approved", "checked_in"):
        raise HTTPException(status_code=400, detail="Nicht check-in-fähig")
    await db.tournament_registrations.update_one(
        {"id": reg["id"]}, {"$set": {"status": "checked_in", "updated_at": now_utc().isoformat()}})
    # Phase B v4.1: late check-in detection (check-in after start_date) → neg_late_checkin
    try:
        t = await db.tournaments.find_one({"id": tid}, {"_id": 0, "start_date": 1, "check_in_until": 1})
        if t:
            now = now_utc()
            cutoff = t.get("check_in_until") or t.get("start_date")
            if cutoff:
                from datetime import datetime, timezone
                cutoff_dt = datetime.fromisoformat(cutoff.replace("Z", "+00:00"))
                if cutoff_dt.tzinfo is None:
                    cutoff_dt = cutoff_dt.replace(tzinfo=timezone.utc)
                if now > cutoff_dt:
                    from badges import trigger_negative_incident
                    await trigger_negative_incident(me["id"], "afk",
                        {"tournament_id": tid, "reason": "late_checkin",
                         "minutes_late": int((now - cutoff_dt).total_seconds() / 60)})
    except Exception:
        pass
    try:
        from badges import on_checked_in
        await on_checked_in(me["id"], tid)
    except Exception:
        pass
    return {"ok": True}


# --- Bracket generation ---
@router.post("/{tid}/generate-bracket")
async def generate(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    regs = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(500)
    if len(regs) < 2:
        raise HTTPException(status_code=400, detail="Mindestens 2 Teilnehmer benötigt")
    # Clear existing matches
    await db.matches.delete_many({"tournament_id": tid})
    matches = generate_bracket(t, regs)
    if matches:
        await db.matches.insert_many(matches)
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": "live", "updated_at": now_utc().isoformat()}})
    return {"ok": True, "match_count": len(matches)}


@router.post("/{tid}/reset-bracket")
async def reset_bracket(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    await db.matches.delete_many({"tournament_id": tid})
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": "draft", "updated_at": now_utc().isoformat()}})
    return {"ok": True}


@router.post("/{tid}/status")
async def set_status(tid: str, body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
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
    if prev != status and status in ("registration_open", "live", "completed", "results_published"):
        try:
            from discord_service import send_discord
            colors = {"registration_open": 0x00FF88, "live": 0x29B6E8,
                      "completed": 0xFFD700, "results_published": 0xFFD700}
            labels = {"registration_open": "Anmeldung offen", "live": "Jetzt live",
                      "completed": "Beendet", "results_published": "Ergebnisse veröffentlicht"}
            game_id = t.get("game_id")
            game = await db.games.find_one({"id": game_id}, {"name": 1}) if game_id else None
            url = f"/tournaments/{t.get('slug') or tid}"
            fields = []
            if game and game.get("name"): fields.append({"name": "Spiel", "value": game["name"], "inline": True})
            if t.get("format"): fields.append({"name": "Format", "value": t["format"].replace("_", " ").title(), "inline": True})
            if t.get("max_participants"): fields.append({"name": "Teilnehmer", "value": f"max. {t['max_participants']}", "inline": True})
            await send_discord(
                f"🏆 {t.get('title') or 'Turnier'} · {labels[status]}",
                t.get("description") or "",
                color=colors[status], url=url, fields=fields,
                event_key=f"tournament.{status}",
            )
        except Exception:
            pass
    return {"ok": True}


@router.get("/{tid}/bracket")
async def get_bracket(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user)
    t["public_phase"] = derive_public_phase(t, "tournament")
    matches = await db.matches.find({"tournament_id": t["id"]}, {"_id": 0}).sort("round", 1).to_list(1000)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    regs = [_public_registration(r, user, is_staff) for r in regs]
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    for r in regs:
        if r.get("user_id"):
            u = users.get(r["user_id"]) or {}
            r["user"] = {"id": u.get("id"), "username": u.get("username"),
                         "display_name": u.get("display_name"), "avatar_url": u.get("avatar_url")}
    return {"tournament": t, "matches": matches, "registrations": regs}


@router.get("/{tid}/standings")
async def standings(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user)
    matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(1000)
    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
    regs = [_public_registration(r, user, is_staff) for r in regs]
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    for r in regs:
        u = users.get(r.get("user_id") or "", {})
        r["display_name"] = r.get("display_name") or u.get("display_name") or u.get("username")
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
