"""F1 Fast Lap Challenge routes."""
import io
import csv
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, Response
from fastapi.responses import StreamingResponse
from database import get_db
from auth import get_current_user, require_admin, get_optional_user
from models import (
    F1ChallengeCreate, F1ChallengeUpdate, F1TrackCreate, F1TrackUpdate,
    F1LapTimeCreate, F1LapTimeUpdate,
    now_utc, new_id,
)

router = APIRouter(prefix="/api/f1", tags=["f1"])


async def _resolve_cid(slug_or_id: str) -> str:
    db = get_db()
    c = await db.f1_challenges.find_one(
        {"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"id": 1}
    )
    if not c:
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    return c["id"]


def _ms_to_time_str(ms: int) -> str:
    if ms is None:
        return "—"
    m = ms // 60000
    s = (ms % 60000) // 1000
    mil = ms % 1000
    return f"{m}:{s:02d}.{mil:03d}"


@router.get("/challenges")
async def list_challenges(status: str | None = None, limit: int = 100):
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    challenges = await db.f1_challenges.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for c in challenges:
        c["track_count"] = await db.f1_tracks.count_documents({"challenge_id": c["id"]})
        c["participant_count"] = len(await db.f1_lap_times.distinct("user_id", {"challenge_id": c["id"]}))
    return challenges


@router.get("/challenges/{slug_or_id}")
async def get_challenge(slug_or_id: str):
    db = get_db()
    c = await db.f1_challenges.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challenge nicht gefunden")
    tracks = await db.f1_tracks.find({"challenge_id": c["id"]}, {"_id": 0}).sort("order_index", 1).to_list(100)
    c["tracks"] = tracks
    c["participant_count"] = len(await db.f1_lap_times.distinct("user_id", {"challenge_id": c["id"]}))
    return c


@router.post("/challenges")
async def create_challenge(body: F1ChallengeCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.f1_challenges.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["status"] = "draft"
    for k in ["start_date", "end_date"]:
        if doc.get(k):
            doc[k] = doc[k].isoformat()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.f1_challenges.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/challenges/{cid}")
async def update_challenge(cid: str, body: F1ChallengeUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    for k in ["start_date", "end_date"]:
        if updates.get(k):
            updates[k] = updates[k].isoformat()
    updates["updated_at"] = now_utc().isoformat()
    await db.f1_challenges.update_one({"id": cid}, {"$set": updates})
    c = await db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    return c


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


@router.patch("/tracks/{tid}")
async def update_track(tid: str, body: F1TrackUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
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
async def leaderboard(cid: str, track_id: str | None = None):
    """Per-track leaderboard. If no track_id, use first track."""
    db = get_db()
    cid = await _resolve_cid(cid)
    c = await db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404)
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
async def championship_standings(cid: str):
    """Championship standings across all tracks using points_per_position."""
    db = get_db()
    cid = await _resolve_cid(cid)
    c = await db.f1_challenges.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404)
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
async def add_time(cid: str, body: F1LapTimeCreate, me: dict = Depends(require_admin())):
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
    return doc


@router.get("/challenges/{cid}/times")
async def list_times(cid: str, track_id: str | None = None, user_id: str | None = None):
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


@router.patch("/times/{time_id}")
async def update_time(time_id: str, body: F1LapTimeUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = now_utc().isoformat()
    await db.f1_lap_times.update_one({"id": time_id}, {"$set": updates})
    t = await db.f1_lap_times.find_one({"id": time_id}, {"_id": 0})
    if t:
        t["time_str"] = _ms_to_time_str(t["time_ms"])
    return t


@router.delete("/times/{time_id}")
async def delete_time(time_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.f1_lap_times.delete_one({"id": time_id})
    return {"ok": True}


@router.get("/challenges/{cid}/export.csv")
async def export_csv(cid: str, track_id: str | None = None):
    db = get_db()
    cid = await _resolve_cid(cid)
    c = await db.f1_challenges.find_one({"id": cid})
    if not c:
        raise HTTPException(status_code=404)
    output = io.StringIO()
    w = csv.writer(output, delimiter=";")
    w.writerow(["Rang", "Spieler", "Discord", "Strecke", "Zeit", "Zeit (ms)", "Versuche", "Strafzeiten", "Aktualisiert"])
    tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).sort("order_index", 1).to_list(100)
    if track_id:
        tracks = [t for t in tracks if t["id"] == track_id]
    for tr in tracks:
        lb = await leaderboard(cid, tr["id"])
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
