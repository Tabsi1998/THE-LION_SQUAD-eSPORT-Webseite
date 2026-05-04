"""Tournament + bracket routes."""
from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
from database import get_db
from auth import get_current_user, require_admin, get_optional_user
from models import (
    TournamentCreate, TournamentUpdate, RegistrationCreate, RegistrationUpdate,
    now_utc, new_id,
)
from bracket_engine import generate_bracket, compute_round_robin_standings
from bracket_extensions import (
    generate_swiss_round, compute_swiss_standings, generate_groups, compute_group_standings,
)

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


def _iso(dt):
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return dt


async def _enrich_tournament(t: dict) -> dict:
    db = get_db()
    if t.get("game_id"):
        g = await db.games.find_one({"id": t["game_id"]}, {"_id": 0})
        t["game"] = g
    if t.get("event_id"):
        e = await db.events.find_one({"id": t["event_id"]}, {"_id": 0, "tournaments": 0, "f1_challenges": 0})
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
                           event_id: str | None = None, limit: int = 100):
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    if game_id:
        q["game_id"] = game_id
    if event_id:
        q["event_id"] = event_id
    tournaments = await db.tournaments.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for t in tournaments:
        await _enrich_tournament(t)
    return tournaments


@router.get("/{slug_or_id}")
async def get_tournament(slug_or_id: str, user=Depends(get_optional_user)):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    await _enrich_tournament(t)
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
    doc["status"] = "draft"
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.tournaments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{tid}")
async def update_tournament(tid: str, body: TournamentUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    tid = await _resolve_tid(tid)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
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
async def list_registrations(tid: str):
    db = get_db()
    tid = await _resolve_tid(tid)
    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
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
    t = await db.tournaments.find_one({"id": tid})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if t.get("status") not in ("registration_open", "check_in", "draft"):
        raise HTTPException(status_code=400, detail="Anmeldung für dieses Turnier geschlossen")
    existing = await db.tournament_registrations.find_one({"tournament_id": tid, "user_id": me["id"]})
    if existing:
        raise HTTPException(status_code=409, detail="Bereits angemeldet")
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
    return reg


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
    allowed = {"draft", "registration_open", "check_in", "live", "paused", "completed", "archived"}
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Ungültiger Status")
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": status, "updated_at": now_utc().isoformat()}})
    return {"ok": True}


@router.get("/{tid}/bracket")
async def get_bracket(tid: str):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    matches = await db.matches.find({"tournament_id": t["id"]}, {"_id": 0}).sort("round", 1).to_list(1000)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
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
async def standings(tid: str):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(1000)
    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
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
async def list_groups(tid: str):
    db = get_db()
    tid = await _resolve_tid(tid)
    return await db.tournament_groups.find({"tournament_id": tid}, {"_id": 0}).to_list(50)
