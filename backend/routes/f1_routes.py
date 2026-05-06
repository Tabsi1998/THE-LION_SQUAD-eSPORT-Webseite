"""F1 Fast Lap Challenge routes."""
import io
import csv
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Response
from fastapi.responses import StreamingResponse
from database import get_db
from auth import get_current_user, require_admin, require_role, get_optional_user
from services.visibility import user_can_see
from models import (
    F1ChallengeCreate, F1ChallengeUpdate, F1TrackCreate, F1TrackUpdate,
    F1LapTimeCreate, F1LapTimeUpdate,
    now_utc, new_id,
)

def _validate_penalty_note(penalty_seconds: float, is_invalid: bool, admin_note: str | None):
    """P0 — Penalty Transparency: any penalty MUST have a reason ≥5 chars.

    Raises HTTP 422 when penalty_seconds>0 or is_invalid=True without an explanatory admin_note.
    """
    has_penalty = (penalty_seconds or 0) > 0 or bool(is_invalid)
    if has_penalty:
        note = (admin_note or "").strip()
        if len(note) < 5:
            raise HTTPException(
                status_code=422,
                detail="Bei Zeitstrafen oder ungültigen Runden muss eine Begründung "
                       "(mind. 5 Zeichen) angegeben werden — Spieler haben Anspruch auf Transparenz.",
            )


router = APIRouter(prefix="/api/f1", tags=["f1"])
STAFF_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}


def _iso(dt):
    if dt is None:
        return None
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return dt


async def _resolve_cid(slug_or_id: str) -> str:
    db = get_db()
    c = await db.f1_challenges.find_one(
        {"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"id": 1}
    )
    if not c:
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    return c["id"]


def _auth_user(user) -> dict | None:
    return user if isinstance(user, dict) else None


def _is_staff(user: dict | None) -> bool:
    user = _auth_user(user)
    return bool(user and user.get("role") in STAFF_ROLES)


async def _get_visible_challenge(slug_or_id: str, user: dict | None = None) -> dict:
    db = get_db()
    user = _auth_user(user)
    c = await db.f1_challenges.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    if c.get("status") == "draft" and not _is_staff(user):
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    if not await user_can_see(user, c.get("visibility") or "public"):
        raise HTTPException(status_code=403, detail="Challenge ist nicht sichtbar")
    return c


def _ms_to_time_str(ms: int) -> str:
    if ms is None:
        return "—"
    m = ms // 60000
    s = (ms % 60000) // 1000
    mil = ms % 1000
    return f"{m}:{s:02d}.{mil:03d}"


@router.get("/challenges")
async def list_challenges(status: str | None = None, limit: int = 100, user=Depends(get_optional_user)):
    db = get_db()
    is_staff = _is_staff(user)
    q = {}
    if status:
        q["status"] = status
    elif not is_staff:
        q["status"] = {"$ne": "draft"}
    challenges = await db.f1_challenges.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    visible = []
    for c in challenges:
        if not await user_can_see(user, c.get("visibility") or "public"):
            continue
        c["track_count"] = await db.f1_tracks.count_documents({"challenge_id": c["id"]})
        c["participant_count"] = len(await db.f1_lap_times.distinct("user_id", {"challenge_id": c["id"]}))
        visible.append(c)
    return visible


@router.get("/challenges/{slug_or_id}")
async def get_challenge(slug_or_id: str, user=Depends(get_optional_user)):
    db = get_db()
    c = await _get_visible_challenge(slug_or_id, user)
    tracks = await db.f1_tracks.find({"challenge_id": c["id"]}, {"_id": 0}).sort("order_index", 1).to_list(100)
    c["tracks"] = tracks
    c["participant_count"] = len(await db.f1_lap_times.distinct("user_id", {"challenge_id": c["id"]}))
    if c.get("event_id"):
        c["event"] = await db.events.find_one(
            {"id": c["event_id"]},
            {"_id": 0, "id": 1, "slug": 1, "name": 1, "start_date": 1, "status": 1, "location": 1},
        )
    return c


@router.post("/challenges")
async def create_challenge(body: F1ChallengeCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.f1_challenges.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["status"] = doc.get("status") or "draft"
    for k in ["registration_open_from", "registration_open_until", "start_date", "end_date"]:
        doc[k] = _iso(doc.get(k))
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.f1_challenges.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/challenges/{cid}")
@router.patch("/challenges/{cid}")
async def update_challenge(cid: str, body: F1ChallengeUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    existing = await db.f1_challenges.find_one({"id": cid}, {"_id": 0}) or {}
    raw = body.model_dump(exclude_unset=True)
    nullable_fields = {
        "description", "event_id", "vehicle", "weather", "assists_allowed", "controller_type",
        "platform", "banner_url", "twitch_channel", "stream_platform",
        "stream_url", "stream_title", "max_attempts", "prize_places",
        "registration_open_from", "registration_open_until", "start_date", "end_date",
    }
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    for k in ["registration_open_from", "registration_open_until", "start_date", "end_date"]:
        if k in updates:
            updates[k] = _iso(updates.get(k))
    updates["updated_at"] = now_utc().isoformat()
    await db.f1_challenges.update_one({"id": cid}, {"$set": updates})
    c = await db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    if existing.get("status") != c.get("status") and c.get("status") == "results_published":
        try:
            await _award_f1_season_points(c)
        except Exception:
            pass
    return c


async def _award_f1_season_points(challenge: dict):
    db = get_db()
    from services.season_service import award_points

    cid = challenge["id"]
    tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    weight = float(challenge.get("season_weight") or 1.0)
    source_type = "mini" if weight < 1.5 else ("major" if weight >= 2.5 else "tournament")
    for track in tracks:
        times = await db.f1_lap_times.find(
            {"challenge_id": cid, "track_id": track["id"], "is_invalid": {"$ne": True}},
            {"_id": 0},
        ).to_list(5000)
        best_per_user: dict[str, int] = {}
        for row in times:
            eff = row["time_ms"] + int((row.get("penalty_seconds") or 0) * 1000)
            uid = row.get("user_id")
            if uid and (uid not in best_per_user or eff < best_per_user[uid]):
                best_per_user[uid] = eff
        ranked = sorted(best_per_user.items(), key=lambda item: item[1])
        num_participants = max(len(ranked), 1)
        for pos, (uid, _) in enumerate(ranked):
            await award_points(
                user_id=uid,
                source_type=source_type,
                source_id=f"{cid}:{track['id']}",
                source_name=f"{challenge.get('title') or 'Fast Lap'} - {track.get('name') or 'Strecke'}",
                rank=pos + 1,
                num_participants=num_participants,
                weight=weight,
            )


@router.delete("/challenges/{cid}")
async def delete_challenge(cid: str, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    await db.f1_challenges.delete_one({"id": cid})
    await db.f1_tracks.delete_many({"challenge_id": cid})
    await db.f1_lap_times.delete_many({"challenge_id": cid})
    return {"ok": True}


# --- Tracks ---
@router.post("/challenges/{cid}/tracks")
async def add_track(cid: str, body: F1TrackCreate, me: dict = Depends(require_admin())):
    db = get_db()
    cid = await _resolve_cid(cid)
    c = await db.f1_challenges.find_one({"id": cid})
    if not c:
        raise HTTPException(status_code=404)
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["challenge_id"] = cid
    doc["created_at"] = now_utc().isoformat()
    await db.f1_tracks.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/tracks/{tid}")
@router.patch("/tracks/{tid}")
async def update_track(tid: str, body: F1TrackUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"image_url", "country"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    await db.f1_tracks.update_one({"id": tid}, {"$set": updates})
    tr = await db.f1_tracks.find_one({"id": tid}, {"_id": 0})
    return tr


@router.delete("/tracks/{tid}")
async def delete_track(tid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.f1_tracks.delete_one({"id": tid})
    await db.f1_lap_times.delete_many({"track_id": tid})
    return {"ok": True}


# --- Lap times ---
@router.get("/challenges/{cid}/leaderboard")
async def leaderboard(cid: str, track_id: str | None = None, user=Depends(get_optional_user)):
    """Per-track leaderboard. If no track_id, use first track."""
    db = get_db()
    c = await _get_visible_challenge(cid, user)
    cid = c["id"]
    if not track_id:
        first_track = await db.f1_tracks.find_one({"challenge_id": cid}, {"_id": 0},
                                                    sort=[("order_index", 1)])
        if not first_track:
            return {"challenge": c, "track": None, "entries": []}
        track_id = first_track["id"]
    track = await db.f1_tracks.find_one({"id": track_id}, {"_id": 0})
    # Get best time per user
    times = await db.f1_lap_times.find(
        {"challenge_id": cid, "track_id": track_id, "is_invalid": {"$ne": True}},
        {"_id": 0},
    ).to_list(5000)
    best_per_user = {}
    attempts_per_user = {}
    for t in times:
        uid = t["user_id"]
        attempts_per_user[uid] = attempts_per_user.get(uid, 0) + 1
        effective = t["time_ms"] + int(t.get("penalty_seconds", 0) * 1000)
        if uid not in best_per_user or effective < best_per_user[uid]["effective_ms"]:
            best_per_user[uid] = {**t, "effective_ms": effective}
    # Gather users
    user_ids = list(best_per_user.keys())
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    entries = []
    for uid, t in best_per_user.items():
        u = users.get(uid, {})
        entries.append({
            "user_id": uid,
            "username": u.get("username"),
            "display_name": u.get("display_name") or u.get("username"),
            "avatar_url": u.get("avatar_url"),
            "time_ms": t["effective_ms"],
            "time_str": _ms_to_time_str(t["effective_ms"]),
            "raw_time_ms": t["time_ms"],
            "penalty_seconds": t.get("penalty_seconds", 0),
            "penalty_note": t.get("admin_note") if (t.get("penalty_seconds", 0) > 0) else None,
            "attempts": attempts_per_user.get(uid, 0),
            "last_updated": t.get("created_at"),
        })
    # Sort by effective time; tie-break by newer submission (last_updated desc)
    entries.sort(key=lambda e: (e["time_ms"], -(datetime.fromisoformat(e["last_updated"].replace("Z","+00:00")).timestamp() if e.get("last_updated") else 0)))
    for i, e in enumerate(entries):
        e["rank"] = i + 1
        e["gap_ms"] = e["time_ms"] - entries[0]["time_ms"] if i > 0 else 0
        e["gap_str"] = f"+{e['gap_ms']/1000:.3f}s" if i > 0 else ""
    return {"challenge": c, "track": track, "entries": entries}


@router.get("/challenges/{cid}/championship")
async def championship_standings(cid: str, user=Depends(get_optional_user)):
    """Championship standings across all tracks using points_per_position."""
    db = get_db()
    c = await _get_visible_challenge(cid, user)
    cid = c["id"]
    tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    points_system = c.get("points_per_position", [25, 18, 15, 12, 10, 8, 6, 4, 2, 1])
    totals: dict = {}
    per_track_results = {}
    for track in tracks:
        times = await db.f1_lap_times.find(
            {"challenge_id": cid, "track_id": track["id"], "is_invalid": {"$ne": True}},
            {"_id": 0},
        ).to_list(5000)
        best_per_user = {}
        for t in times:
            effective = t["time_ms"] + int(t.get("penalty_seconds", 0) * 1000)
            uid = t["user_id"]
            if uid not in best_per_user or effective < best_per_user[uid]:
                best_per_user[uid] = effective
        sorted_users = sorted(best_per_user.items(), key=lambda x: x[1])
        track_results = []
        for pos, (uid, ms) in enumerate(sorted_users):
            pts = points_system[pos] if pos < len(points_system) else 0
            totals.setdefault(uid, {"user_id": uid, "points": 0, "wins": 0, "races": 0})
            totals[uid]["points"] += pts
            totals[uid]["races"] += 1
            if pos == 0:
                totals[uid]["wins"] += 1
            track_results.append({"user_id": uid, "rank": pos + 1, "time_ms": ms,
                                    "time_str": _ms_to_time_str(ms), "points": pts})
        per_track_results[track["id"]] = {"track": track, "results": track_results}
    # enrich users
    user_ids = list(totals.keys())
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    arr = []
    for uid, s in totals.items():
        u = users.get(uid, {})
        arr.append({**s, "username": u.get("username"),
                     "display_name": u.get("display_name") or u.get("username"),
                     "avatar_url": u.get("avatar_url")})
    arr.sort(key=lambda s: (s["points"], s["wins"]), reverse=True)
    for i, s in enumerate(arr):
        s["rank"] = i + 1
    return {"challenge": c, "standings": arr, "per_track": per_track_results, "tracks": tracks}


@router.post("/challenges/{cid}/times")
async def add_time(cid: str, body: F1LapTimeCreate, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    cid = await _resolve_cid(cid)
    # Verify
    c = await db.f1_challenges.find_one({"id": cid})
    if not c:
        raise HTTPException(status_code=404)
    if not await db.f1_tracks.find_one({"id": body.track_id, "challenge_id": cid}):
        raise HTTPException(status_code=400, detail="Strecke gehört nicht zur Challenge")
    if not await db.users.find_one({"id": body.user_id}):
        raise HTTPException(status_code=400, detail="Spieler nicht gefunden")
    _validate_penalty_note(body.penalty_seconds, body.is_invalid, body.admin_note)
    # Attempt count
    attempt_count = await db.f1_lap_times.count_documents({
        "challenge_id": cid, "track_id": body.track_id, "user_id": body.user_id})
    doc = {
        "id": new_id(),
        "challenge_id": cid,
        "track_id": body.track_id,
        "user_id": body.user_id,
        "time_ms": body.time_ms,
        "penalty_seconds": body.penalty_seconds,
        "is_invalid": body.is_invalid,
        "proof_url": body.proof_url,
        "admin_note": body.admin_note,
        "attempt_number": attempt_count + 1,
        "created_by": me["id"],
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.f1_lap_times.insert_one(doc)
    doc.pop("_id", None)
    doc["time_str"] = _ms_to_time_str(body.time_ms)
    # Discord trigger: if this submission is the new P1 on this track
    was_new_leader = False
    if not body.is_invalid:
        try:
            from discord_service import send_discord
            effective = body.time_ms + int((body.penalty_seconds or 0) * 1000)
            # Find current P1
            others = await db.f1_lap_times.find(
                {"challenge_id": cid, "track_id": body.track_id,
                 "is_invalid": {"$ne": True}, "id": {"$ne": doc["id"]}},
                {"_id": 0}).to_list(5000)
            # Compute per-user best (effective)
            best = {}
            for t in others:
                eff = t["time_ms"] + int(t.get("penalty_seconds", 0) * 1000)
                if t["user_id"] not in best or eff < best[t["user_id"]]:
                    best[t["user_id"]] = eff
            best_per_user_sorted = sorted(best.values()) if best else []
            prev_best = best_per_user_sorted[0] if best_per_user_sorted else None
            if prev_best is None or effective < prev_best:
                was_new_leader = True
                u = await db.users.find_one({"id": body.user_id}, {"display_name": 1, "username": 1}) or {}
                tr = await db.f1_tracks.find_one({"id": body.track_id}, {"name": 1}) or {}
                await send_discord(
                    f"🏁 Neue Bestzeit · {c.get('title') or 'Fast Lap'}",
                    f"**{u.get('display_name') or u.get('username') or 'Fahrer'}** führt jetzt auf **{tr.get('name') or '–'}**!",
                    color=0xFFD700,
                    url=f"/fastlap/{c.get('slug') or cid}",
                    fields=[
                        {"name": "Zeit", "value": _ms_to_time_str(effective), "inline": True},
                        *([{"name": "Vorher", "value": _ms_to_time_str(prev_best), "inline": True}] if prev_best else []),
                    ],
                    event_key="f1.new_leader",
                )
        except Exception:
            pass
    # Badge trigger
    try:
        from badges import on_lap_submitted
        await on_lap_submitted(body.user_id, cid, body.track_id, was_new_leader, body.is_invalid)
    except Exception:
        pass
    return doc


@router.get("/challenges/{cid}/times")
async def list_times(cid: str, track_id: str | None = None, user_id: str | None = None, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    q = {"challenge_id": cid}
    if track_id:
        q["track_id"] = track_id
    if user_id:
        q["user_id"] = user_id
    times = await db.f1_lap_times.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    user_ids = list({t["user_id"] for t in times})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    for t in times:
        u = users.get(t["user_id"], {})
        t["user"] = {"username": u.get("username"), "display_name": u.get("display_name"),
                      "avatar_url": u.get("avatar_url")}
        t["time_str"] = _ms_to_time_str(t["time_ms"])
    return times


@router.put("/times/{time_id}")
@router.patch("/times/{time_id}")
async def update_time(time_id: str, body: F1LapTimeUpdate, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    existing = await db.f1_lap_times.find_one({"id": time_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Lap-Time nicht gefunden")
    nullable_fields = {"proof_url", "admin_note"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    # P0 validation: compute resulting state and require note
    final_pen = updates.get("penalty_seconds", existing.get("penalty_seconds", 0))
    final_inv = updates.get("is_invalid", existing.get("is_invalid", False))
    final_note = updates.get("admin_note", existing.get("admin_note"))
    _validate_penalty_note(final_pen or 0, final_inv, final_note)
    updates["updated_at"] = now_utc().isoformat()
    await db.f1_lap_times.update_one({"id": time_id}, {"$set": updates})
    t = await db.f1_lap_times.find_one({"id": time_id}, {"_id": 0})
    if t:
        t["time_str"] = _ms_to_time_str(t["time_ms"])
    return t


@router.delete("/times/{time_id}")
async def delete_time(time_id: str, me: dict = Depends(require_role("moderator"))):
    db = get_db()
    await db.f1_lap_times.delete_one({"id": time_id})
    return {"ok": True}


@router.get("/challenges/{cid}/export.csv")
async def export_csv(cid: str, track_id: str | None = None, user=Depends(get_optional_user)):
    db = get_db()
    c = await _get_visible_challenge(cid, user)
    cid = c["id"]
    output = io.StringIO()
    w = csv.writer(output, delimiter=";")
    w.writerow(["Rang", "Spieler", "Discord", "Strecke", "Zeit", "Zeit (ms)", "Versuche", "Strafzeiten", "Aktualisiert"])
    tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    if track_id:
        tracks = [t for t in tracks if t["id"] == track_id]
    for tr in tracks:
        lb = await leaderboard(cid, tr["id"], user)
        for entry in lb["entries"]:
            w.writerow([
                entry["rank"], entry["display_name"], "",
                tr["name"], entry["time_str"], entry["time_ms"],
                entry["attempts"], entry["penalty_seconds"], entry["last_updated"],
            ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=f1_{c['slug']}.csv"},
    )
