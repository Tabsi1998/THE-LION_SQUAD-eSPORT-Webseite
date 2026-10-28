"""Seasons and circuits: standings sources, scoring and public season pages."""

import logging

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from typing import Optional, List, Literal
from datetime import datetime

from database import get_db
from auth import require_admin
from services.slug_utils import apply_slug_history, find_by_slug_or_history, slug_source_for_update, unique_slug
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import standings_for_structure
from services.private_fields import private_projection
from services.league_scope import NOT_LEAGUE, league_tournament_ids
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
    # Nur die aktive (#2123, ER11): ohne aktive Jahreswertung zeigt die Startseite keine - nie einen Entwurf.
    s = await db.seasons.find_one({"status": "active"}, {"_id": 0},
                                    sort=[("start_date", -1), ("created_at", -1)])
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
    new_status = updates.get("status")
    if new_status == current.get("status"):
        updates.pop("status", None)
        new_status = None
    if new_status == "completed":
        # Abschließen (#2123, ER8) schreibt die Rangliste fest und vergibt Erfolge und XP - nur über den eigenen Knopf
        # mit Vorschau und Rückfrage, nicht nebenbei beim Speichern.
        raise HTTPException(409, "Abschließen geht über den Knopf „Abschließen“ – mit Vorschau und Rückfrage.")
    if new_status == "active":
        await _ensure_no_other_active(db, current["id"])
    slug_source = slug_source_for_update(raw, current, "name", fallback="season")
    if slug_source is not None:
        updates["slug"] = await unique_slug(db.seasons, slug_source, current_id=current["id"], fallback="season")
        apply_slug_history(current, updates)
    for k in ["start_date", "end_date"]:
        if k in updates:
            updates[k] = updates[k].isoformat() if updates[k] else None
    updates["updated_at"] = now_utc().isoformat()
    await db.seasons.update_one({"id": current["id"]}, {"$set": updates})
    if new_status:
        await _audit(db, me, "season.status.change", current["id"],
                     {"previous_status": current.get("status"), "status": new_status})
    return await db.seasons.find_one({"id": current["id"]}, {"_id": 0})


async def _audit(db, me: dict, action: str, season_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"), "target_id": season_id,
                                    "data": data, "created_at": now_utc().isoformat()})


async def _ensure_no_other_active(db, season_id: str) -> None:
    """Aktiv ist höchstens eine Jahreswertung (#2123, ER7) - sonst landeten Punkte in einer beliebigen."""
    other = await db.seasons.find_one({"status": "active", "id": {"$ne": season_id}}, {"_id": 0, "name": 1})
    if other:
        raise HTTPException(409, f"„{other.get('name') or 'Eine andere Jahreswertung'}“ ist schon aktiv. Es kann nur eine "
                                 "aktiv sein – schließe sie zuerst ab oder setze sie zurück auf Entwurf.")


async def _season_or_404(db, sid: str) -> dict:
    season = await db.seasons.find_one({"$or": [{"id": sid}, {"slug": sid}]}, {"_id": 0})
    if not season:
        raise HTTPException(404, "Saison nicht gefunden")
    return season


@season_router.get("/{sid}/completion-preview")
async def completion_preview(sid: str, me: dict = Depends(require_admin())):
    """Was „Abschließen“ bewirkt (#2123, ER8): Rangliste und je Platz die Erfolge - ohne etwas zu schreiben."""
    from services.achievement_admin import season_preview

    db = get_db()
    season = await _season_or_404(db, sid)
    return await season_preview(db, season["id"])


@season_router.post("/{sid}/complete")
async def complete_season(sid: str, me: dict = Depends(require_admin())):
    """Jahreswertung abschließen (#2123, ER8; Abschluss #613): die Rangliste wird festgeschrieben, XP und Saison-Erfolge
    (Saisonspitze, Saisonmeister, Volle Saison) folgen daraus - einmal, beim Wechsel auf „abgeschlossen“."""
    db = get_db()
    season = await _season_or_404(db, sid)
    if season.get("status") != "active":
        raise HTTPException(409, "Abschließen lässt sich nur eine aktive Jahreswertung.")
    stamp = now_utc().isoformat()
    result = await db.seasons.update_one({"id": season["id"], "status": "active"},
                                         {"$set": {"status": "completed", "completed_at": stamp, "updated_at": stamp}})
    if getattr(result, "modified_count", 1) == 0:
        raise HTTPException(409, "Die Jahreswertung wurde gerade schon abgeschlossen.")
    try:
        from badges import on_season_completed
        await on_season_completed(season["id"])
    except Exception:  # noqa: BLE001 - der Abschluss darf nicht an den Erfolgen scheitern
        logging.getLogger("seasons").warning("season completion hook failed for %s", season["id"], exc_info=True)
    await _audit(db, me, "season.complete", season["id"], {"previous_status": "active", "status": "completed"})
    return await db.seasons.find_one({"id": season["id"]}, {"_id": 0})


@season_router.delete("/{sid}")
async def delete_season(sid: str, me: dict = Depends(require_admin())):
    """Löschen nur als Entwurf ohne Punkte (#2123, ER9) - eine aktive oder abgeschlossene Jahreswertung bleibt,
    sonst verwaisten ihre Punkte. Archivieren statt löschen."""
    db = get_db()
    season = await _season_or_404(db, sid)
    if season.get("status") != "draft":
        raise HTTPException(409, "Nur ein Entwurf lässt sich löschen. Eine laufende oder abgeschlossene Jahreswertung "
                                 "bleibt – setze sie auf „Archiv“.")
    if await db.season_points.count_documents({"season_id": season["id"]}):
        raise HTTPException(409, "Diese Jahreswertung hat schon Punkte und lässt sich darum nicht löschen.")
    await db.seasons.delete_one({"id": season["id"]})
    await _audit(db, me, "season.delete", season["id"], {"name": season.get("name"), "slug": season.get("slug")})
    return {"ok": True}


class PointAdjustment(BaseModel):
    user_id: Optional[str] = None
    team_id: Optional[str] = None
    points: float
    reason: str


@season_router.get("/{sid}/adjustments")
async def list_adjustments(sid: str, me: dict = Depends(require_admin())):
    """Korrekturen der Jahreswertung (#2123, ER10): Bonus oder Abzug von Hand, immer mit Grund."""
    db = get_db()
    season = await _season_or_404(db, sid)
    rows = await db.season_points.find({"season_id": season["id"], "source_type": "custom"}, {"_id": 0}).sort(
        "created_at", -1).to_list(500)
    user_ids = [row["user_id"] for row in rows if row.get("user_id")]
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": user_ids}},
                                                     {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(500)}
    team_ids = [row["team_id"] for row in rows if row.get("team_id")]
    teams = {t["id"]: t for t in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    for row in rows:
        person = users.get(row.get("user_id")) or {}
        row["recipient_label"] = (person.get("display_name") or person.get("username")
                                  or (teams.get(row.get("team_id")) or {}).get("name") or "Unbekannt")
    return rows


@season_router.post("/{sid}/adjustments")
async def add_adjustment(sid: str, body: PointAdjustment, me: dict = Depends(require_admin())):
    """Punkte von Hand korrigieren (#2123, ER10): ein eigener Eintrag „Korrektur“ mit Grund, der Formel-Einträge der
    Turniere bleiben unberührt - ein erneutes Veröffentlichen überschreibt die Korrektur also nicht."""
    db = get_db()
    season = await _season_or_404(db, sid)
    if season.get("status") not in ("draft", "active"):
        raise HTTPException(409, "Eine abgeschlossene Jahreswertung lässt sich nicht mehr korrigieren.")
    reason = " ".join((body.reason or "").split())
    if len(reason) < 3:
        raise HTTPException(400, "Bitte einen Grund angeben.")
    if bool(body.user_id) == bool(body.team_id):
        raise HTTPException(400, "Bitte genau eine Person oder ein Team wählen.")
    points = round(float(body.points), 1)
    if points == 0 or abs(points) > 1000 or points != points:
        raise HTTPException(400, "Die Korrektur muss zwischen -1000 und 1000 Punkten liegen und darf nicht 0 sein.")
    if body.user_id and not await db.users.find_one({"id": body.user_id}, {"_id": 1}):
        raise HTTPException(404, "Person nicht gefunden")
    if body.team_id and not await db.teams.find_one({"id": body.team_id}, {"_id": 1}):
        raise HTTPException(404, "Team nicht gefunden")
    stamp = now_utc().isoformat()
    row_id = new_id()
    doc = {
        "id": row_id, "season_id": season["id"], "user_id": body.user_id, "team_id": body.team_id,
        "source_type": "custom", "source_id": f"adjustment:{row_id}", "source_name": "Korrektur", "rank": None,
        "num_participants": 1, "base_points": 0, "weight": 1.0, "participant_factor": 1.0,
        "bonus_points": points, "bonus_reason": reason, "farming_multiplier": 1.0, "farming_capped": False,
        "farming_exempt": True, "raw_points": points, "total_points": points, "created_at": stamp,
        "created_by": me.get("id"),
    }
    await db.season_points.insert_one(doc)
    doc.pop("_id", None)
    await _audit(db, me, "season.points.adjust", season["id"],
                 {"user_id": body.user_id, "team_id": body.team_id, "points": points, "reason": reason, "entry_id": row_id})
    from services.discord_embed_queue import request_refresh
    request_refresh("ranking")
    return doc


@season_router.delete("/{sid}/adjustments/{entry_id}")
async def delete_adjustment(sid: str, entry_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    season = await _season_or_404(db, sid)
    if season.get("status") not in ("draft", "active"):
        raise HTTPException(409, "Eine abgeschlossene Jahreswertung lässt sich nicht mehr korrigieren.")
    row = await db.season_points.find_one({"id": entry_id, "season_id": season["id"], "source_type": "custom"}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Korrektur nicht gefunden")
    await db.season_points.delete_one({"id": entry_id})
    await _audit(db, me, "season.points.adjust_delete", season["id"],
                 {"user_id": row.get("user_id"), "team_id": row.get("team_id"), "points": row.get("total_points"),
                  "reason": row.get("bonus_reason"), "entry_id": entry_id})
    from services.discord_embed_queue import request_refresh
    request_refresh("ranking")
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
    # Liga-Staffeln zählen nie für die Jahreswertung (docs/LIGA.md, Abschnitt 7) - auch nicht ausdrücklich gelistet.
    # Wer Turniere ausdrücklich gewählt hat, bekommt nie den Automatik-Rückfall - auch nicht, wenn nach dem Herausnehmen
    # der Staffeln keines übrig bleibt (sonst zählten auf einmal alle Turniere).
    explicit_t = list(s.get("tournament_ids") or [])
    had_explicit_t = bool(explicit_t)
    league = await league_tournament_ids(db, explicit_t)
    explicit_t = [tid for tid in explicit_t if tid not in league]
    explicit_f = list(s.get("f1_challenge_ids") or [])
    if had_explicit_t and explicit_f:
        return explicit_t, explicit_f

    # Build date filter (lenient: matches scheduled_at OR created_at fallback)
    start = s.get("start_date")
    end = s.get("end_date")
    relevant_status = {"live", "completed", "results_published", "check_in", "scheduled"}

    auto_t: list[str] = []
    if not had_explicit_t:
        async for t in db.tournaments.find(dict(NOT_LEAGUE), {"id": 1, "status": 1, "start_date": 1, "created_at": 1,
                                                               "_id": 0}):
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

    return (explicit_t if had_explicit_t else auto_t), (explicit_f or auto_f)


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
            # Dieselbe Rangfolge wie die Tabelle (#1584): Gleichstand - die früher gefahrene Zeit vorn.
            from services.fastlap_standings import official_times, track_ranking
            sorted_u = track_ranking(await official_times(db, cid, tr["id"]))
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
        {"id": {"$in": user_ids}}, private_projection()).to_list(500)}
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
