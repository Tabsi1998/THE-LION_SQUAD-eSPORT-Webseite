"""Seasons and circuits: standings sources, scoring and public season pages."""

import logging

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional, List, Literal
from datetime import datetime

from database import get_db
from auth import require_admin, get_current_user
from services.slug_utils import apply_slug_history, find_by_slug_or_history, slug_source_for_update, unique_slug
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import standings_for_structure
from models import now_utc, new_id

season_router = APIRouter(prefix="/api/seasons", tags=["seasons"])


class SeasonCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    kind: Literal["season", "circuit"] = "season"
    tournament_ids: List[str] = []
    f1_challenge_ids: List[str] = []
    points_per_position: List[int] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    drop_worst: int = 0  # Streichresultate
    bonus_points: dict = {}
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    banner_url: Optional[str] = None


class SeasonUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    kind: Optional[Literal["season", "circuit"]] = None
    status: Optional[Literal["draft", "active", "completed", "archived"]] = None
    tournament_ids: Optional[List[str]] = None
    f1_challenge_ids: Optional[List[str]] = None
    points_per_position: Optional[List[int]] = None
    drop_worst: Optional[int] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    banner_url: Optional[str] = None


@season_router.get("")
async def list_seasons():
    db = get_db()
    return await db.seasons.find({}, {"_id": 0}).sort("start_date", -1).to_list(200)


@season_router.get("/active/featured")
async def featured_season():
    """Returns the most relevant active season + top 5 standings for public widgets."""
    db = get_db()
    s = await db.seasons.find_one({"status": "active"}, {"_id": 0},
                                    sort=[("start_date", -1)])
    if not s:
        s = await db.seasons.find_one({}, {"_id": 0}, sort=[("start_date", -1)])
    if not s:
        return {"season": None, "standings": []}
    # Reuse standings logic (season_standings defined below in this module)
    lb = await season_standings(s.get("slug") or s["id"])
    return {"season": lb["season"], "standings": (lb.get("standings") or [])[:5]}


@season_router.get("/{slug_or_id}")
async def get_season(slug_or_id: str):
    db = get_db()
    s, was_old_slug = await find_by_slug_or_history(db.seasons, slug_or_id, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Saison nicht gefunden")
    if was_old_slug and s.get("slug"):
        return RedirectResponse(url=f"/api/seasons/{s['slug']}", status_code=301)
    tids, fids = await _resolve_season_sources(s)
    s["tournaments"] = await db.tournaments.find({"id": {"$in": tids}}, {"_id": 0}).to_list(200)
    s["f1_challenges"] = await db.f1_challenges.find({"id": {"$in": fids}},
                                                       {"_id": 0}).to_list(200)
    return s


@season_router.post("")
async def create_season(body: SeasonCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    doc["slug"] = await unique_slug(db.seasons, doc.get("slug") or doc.get("name"), fallback="season")
    for k in ["start_date", "end_date"]:
        if doc.get(k):
            doc[k] = doc[k].isoformat()
    doc["id"] = new_id()
    doc["status"] = "draft"
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.seasons.insert_one(doc)
    doc.pop("_id", None)
    return doc


@season_router.put("/{sid}")
@season_router.patch("/{sid}")
async def update_season(sid: str, body: SeasonUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    current = await db.seasons.find_one({"$or": [{"id": sid}, {"slug": sid}]}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Saison nicht gefunden")
    nullable_fields = {"description", "banner_url", "start_date", "end_date"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    slug_source = slug_source_for_update(raw, current, "name", fallback="season")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.seasons, slug_source, current_id=current["id"], fallback="season")
        apply_slug_history(current, updates)
    for k in ["start_date", "end_date"]:
        if k in updates:
            updates[k] = updates[k].isoformat() if updates[k] else None
    updates["updated_at"] = now_utc().isoformat()
    await db.seasons.update_one({"id": current["id"]}, {"$set": updates})
    # Abschluss (#613): die Rangliste wird festgeschrieben, XP und Saison-Erfolge (Saisonspitze, Saisonmeister,
    # Volle Saison) folgen daraus - einmal, beim Wechsel auf „abgeschlossen“.
    if updates.get("status") == "completed" and current.get("status") != "completed":
        try:
            from badges import on_season_completed
            await on_season_completed(current["id"])
        except Exception:  # noqa: BLE001 - der Abschluss darf nicht an den Erfolgen scheitern
            logging.getLogger("seasons").warning("season completion hook failed for %s", current["id"], exc_info=True)
    return await db.seasons.find_one({"id": current["id"]}, {"_id": 0})


@season_router.delete("/{sid}")
async def delete_season(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.seasons.delete_one({"$or": [{"id": sid}, {"slug": sid}]})
    return {"ok": True}


# ---------- Phase 7: Jahreswertung v2 (Vereinsplattform spec) ----------
@season_router.get("/v2/leaderboard")
async def leaderboard_v2(
    season_id: str | None = None,
    only_members: bool = False,
    only_community: bool = False,
    rookie_only: bool = False,
    teams: bool = False,
    source_type: str | None = None,
    limit: int = 100,
):
    """Aggregated standings using the Phase 7 points formula
    (base × weight × participant_factor + bonus, with farming protection)."""
    from services.season_service import aggregate_leaderboard
    rows = await aggregate_leaderboard(
        season_id=season_id,
        only_members=only_members,
        only_community=only_community,
        rookie_only=rookie_only,
        teams=teams,
        source_type=source_type,
        limit=limit,
    )
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {"standings": rows}


@season_router.get("/v2/me")
async def my_season_points(me: dict = Depends(get_current_user)):
    db = get_db()
    season = await db.seasons.find_one({"status": "active"}, {"_id": 0})
    if not season:
        return {"season": None, "total": 0, "entries": []}
    entries = await db.season_points.find(
        {"season_id": season["id"], "user_id": me["id"]}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    total = round(sum(e.get("total_points", 0) for e in entries), 1)
    from services.season_service import _achievement_summaries, _summarise_point_entries
    achievements = (await _achievement_summaries(db, [me["id"]])).get(me["id"], {})
    return {
        "season": season,
        "total": total,
        "season_points": total,
        "entries": entries,
        "source_breakdown": _summarise_point_entries(entries, max(int(season.get("drop_worst") or 0), 0)).get("source_breakdown", []),
        "achievement_count": achievements.get("achievement_count", 0),
        "achievement_points": achievements.get("achievement_points", 0),
        "profile_points": achievements.get("achievement_points", 0),
    }


@season_router.post("/v2/award")
async def award_points_admin(body: dict, me: dict = Depends(require_admin())):
    """Admin: manually award season points to a user/team."""
    from services.season_service import award_points
    res = await award_points(
        user_id=body.get("user_id"),
        team_id=body.get("team_id"),
        source_type=body.get("source_type", "custom"),
        source_id=body.get("source_id"),
        source_name=body.get("source_name", "Manuelle Vergabe"),
        rank=body.get("rank"),
        num_participants=int(body.get("num_participants", 1)),
        weight=float(body["weight"]) if body.get("weight") is not None else None,
        bonus=int(body.get("bonus", 0)),
        bonus_reason=body.get("bonus_reason"),
        farming_exempt=bool(body.get("farming_exempt", False)),
    )
    if res is None:
        raise HTTPException(400, "Keine aktive Saison.")
    return res


@season_router.delete("/v2/entry/{entry_id}")
async def delete_season_entry(entry_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.season_points.delete_one({"id": entry_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Eintrag nicht gefunden.")
    return {"ok": True}


async def _resolve_season_sources(s: dict) -> tuple[list[str], list[str]]:
    """Resolve which tournaments + f1 challenges feed into this season.

    Strategy:
      - If `tournament_ids`/`f1_challenge_ids` are explicitly listed → use those.
      - Otherwise auto-include every tournament/f1 challenge whose status is in
        a relevant set AND whose start/created date falls inside the season
        date range (start_date / end_date). Falls back to all if season has no
        date range yet.
    """
    db = get_db()
    explicit_t = list(s.get("tournament_ids") or [])
    explicit_f = list(s.get("f1_challenge_ids") or [])
    if explicit_t and explicit_f:
        return explicit_t, explicit_f

    # Build date filter (lenient: matches scheduled_at OR created_at fallback)
    start = s.get("start_date")
    end = s.get("end_date")
    relevant_status = {"live", "completed", "results_published", "check_in", "scheduled"}

    auto_t: list[str] = []
    if not explicit_t:
        async for t in db.tournaments.find({}, {"id": 1, "status": 1, "start_date": 1, "created_at": 1, "_id": 0}):
            if t.get("status") not in relevant_status:
                continue
            ts = t.get("start_date") or t.get("created_at")
            if start and end and ts and not (start <= ts <= end):
                continue
            auto_t.append(t["id"])
    auto_f: list[str] = []
    if not explicit_f:
        async for f in db.f1_challenges.find({}, {"id": 1, "status": 1, "start_date": 1, "created_at": 1, "_id": 0}):
            if f.get("status") not in relevant_status:
                continue
            ts = f.get("start_date") or f.get("created_at")
            if start and end and ts and not (start <= ts <= end):
                continue
            auto_f.append(f["id"])

    return (explicit_t or auto_t), (explicit_f or auto_f)


@season_router.get("/{slug_or_id}/standings")
async def season_standings(slug_or_id: str):
    """Aggregate standings over all season point sources."""
    db = get_db()
    s, was_old_slug = await find_by_slug_or_history(db.seasons, slug_or_id, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Saison nicht gefunden")
    if was_old_slug and s.get("slug"):
        return RedirectResponse(url=f"/api/seasons/{s['slug']}/standings", status_code=301)
    if await db.season_points.count_documents({"season_id": s["id"]}):
        from services.season_service import aggregate_leaderboard
        rows = await aggregate_leaderboard(season_id=s["id"], limit=500)
        standings = []
        for index, row in enumerate(rows):
            standings.append({
                **row,
                "user_id": row.get("id"),
                "display_name": row.get("display_name") or row.get("username") or "—",
                "points": row.get("total_points", 0),
                "events_count": row.get("events", 0),
                "wins": row.get("wins", 0),
                "rank": index + 1,
            })
        return {"season": s, "standings": standings}
    points_system = s.get("points_per_position", [25, 18, 15, 12, 10, 8, 6, 4, 2, 1])
    per_user_points: dict = {}  # user_id -> {points, events_points_list, wins}

    def add_points(user_id, pts, won=False):
        per_user_points.setdefault(user_id, {"user_id": user_id, "points": 0, "events": [], "wins": 0})
        per_user_points[user_id]["events"].append(pts)
        if won:
            per_user_points[user_id]["wins"] += 1

    tournament_ids, f1_ids = await _resolve_season_sources(s)

    # Tournaments: use the same canonical placement/standings projections.
    for tid in tournament_ids:
        regs = await db.tournament_registrations.find(
            {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
            {"_id": 0},
        ).to_list(500)
        reg_user_map = {r["id"]: r.get("user_id") for r in regs}
        read_model = await load_competition_read_model(db, tid)
        snapshot = read_model.structure_snapshot()
        observe_structure_read(snapshot, surface="season_fallback")
        tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0, "format": 1}) or {}
        groups = []
        if tournament.get("format") == "groups":
            groups = await db.tournament_groups.find(
                {"tournament_id": tid}, {"_id": 0}
            ).sort("order_index", 1).to_list(100)
        standings = standings_for_structure(tournament, snapshot, regs, groups=groups)
        rows = [
            group_row
            for item in standings
            for group_row in (item.get("standings") or [])
        ] if tournament.get("format") == "groups" else standings
        for row in rows:
            if "played" in row and not row.get("played"):
                continue
            uid = reg_user_map.get(row.get("registration_id"))
            if not uid:
                continue
            pos = int(row.get("rank") or 999) - 1
            pts = points_system[pos] if 0 <= pos < len(points_system) else 0
            add_points(uid, pts, pos == 0)

    # F1 Challenges: aggregate per-track then championship-style
    for cid in f1_ids:
        tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).to_list(100)
        for tr in tracks:
            times = await db.f1_lap_times.find(
                {
                    "challenge_id": cid,
                    "track_id": tr["id"],
                    "is_invalid": {"$ne": True},
                    "$or": [{"score_scope": {"$exists": False}}, {"score_scope": {"$ne": "club_reference"}}],
                },
                {"_id": 0},
            ).to_list(5000)
            best_per_user: dict = {}
            for t in times:
                eff = t["time_ms"] + int(t.get("penalty_seconds", 0) * 1000)
                if t["user_id"] not in best_per_user or eff < best_per_user[t["user_id"]]:
                    best_per_user[t["user_id"]] = eff
            sorted_u = sorted(best_per_user.items(), key=lambda x: x[1])
            for pos, (uid, _) in enumerate(sorted_u):
                pts = points_system[pos] if pos < len(points_system) else 0
                add_points(uid, pts, pos == 0)

    # Apply drop_worst
    drop_worst = s.get("drop_worst", 0)
    for uid, st in per_user_points.items():
        evts = sorted(st["events"], reverse=True)
        if drop_worst and len(evts) > drop_worst:
            evts = evts[: len(evts) - drop_worst]
        st["points"] = sum(evts)
        st["events_count"] = len(st["events"])

    # Enrich users
    user_ids = list(per_user_points.keys())
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0}).to_list(500)}
    arr = []
    for uid, st in per_user_points.items():
        u = users.get(uid, {})
        arr.append({**st,
                     "display_name": u.get("display_name") or u.get("username") or "—",
                     "username": u.get("username"),
                     "avatar_url": u.get("avatar_url")})
    arr.sort(key=lambda s: (s["points"], s["wins"]), reverse=True)
    for i, s_ in enumerate(arr):
        s_["rank"] = i + 1
        s_.pop("events", None)
    return {"season": s, "standings": arr}
