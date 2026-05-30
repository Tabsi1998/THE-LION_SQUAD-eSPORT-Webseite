"""Station routes."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin
from models import StationCreate, StationUpdate, now_utc, new_id
from services.tournament_permissions import (
    has_tournament_staff_permission,
    is_global_tournament_admin,
    require_tournament_staff_permission,
)
from services.station_runtime import notify_match_started

router = APIRouter(prefix="/api/stations", tags=["stations"])
TOURNAMENT_MUTATION_LOCKED_DETAIL = "Turnier ist gesperrt und kann nur noch angesehen oder geloescht werden."


async def _ensure_tournament_unlocked(db, tournament_id: str) -> None:
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "locked_at": 1})
    if tournament and tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail=TOURNAMENT_MUTATION_LOCKED_DETAIL)
STATION_ASSIGN_ROLES = {"organizer", "referee", "station_manager"}


async def _require_station_permission(user: dict, tournament_id: str, station_id: str | None = None) -> None:
    allowed = (
        await has_tournament_staff_permission(user, tournament_id, STATION_ASSIGN_ROLES, "tournament")
        or (station_id and await has_tournament_staff_permission(user, tournament_id, STATION_ASSIGN_ROLES, "station", station_id))
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung fuer diese Station")


async def _find_match_for_station(db, match_id: str) -> tuple[str, dict | None]:
    match = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if match:
        return "matches", match
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    if match:
        return "matches_v2", match
    return "", None


def _station_match_status(match: dict, start_now: bool) -> str:
    if start_now:
        return "in_progress"
    if match.get("scheduled_at"):
        return "scheduled"
    if match.get("status") in {"pending", "preview"}:
        return "ready"
    return match.get("status") or "ready"


def _match_sort_key(match: dict) -> tuple:
    scheduled = match.get("scheduled_at") or "9999-12-31T23:59:59+00:00"
    try:
        scheduled_dt = datetime.fromisoformat(str(scheduled).replace("Z", "+00:00"))
    except Exception:
        scheduled_dt = datetime.max.replace(tzinfo=timezone.utc)
    return (
        scheduled_dt,
        int(match.get("stage_number") or 0),
        match.get("section") or match.get("bracket") or "",
        int(match.get("round") or 0),
        int(match.get("order") or match.get("position") or 0),
        int(match.get("match_index") or 0),
        match.get("match_key") or match.get("id") or "",
    )


def _match_has_participants(match: dict) -> bool:
    if match.get("slots"):
        return any(slot.get("registration_id") for slot in match.get("slots") or [])
    return bool(match.get("participant_a_id") or match.get("participant_b_id"))


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _duration_for_match(match: dict, tournament: dict) -> int:
    duration = match.get("duration_minutes") or (match.get("settings") or {}).get("duration_minutes") or tournament.get("match_duration_minutes") or 30
    try:
        return max(1, int(duration))
    except Exception:
        return 30


@router.get("")
async def list_stations(tournament_id: str | None = None, event_id: str | None = None):
    db = get_db()
    q = {}
    if tournament_id:
        q["tournament_id"] = tournament_id
    if event_id:
        q["event_id"] = event_id
    stations = await db.stations.find(q, {"_id": 0}).to_list(500)
    return stations


@router.post("")
async def create_station(body: StationCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    if doc.get("tournament_id") and not await db.tournaments.find_one({"id": doc["tournament_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if doc.get("tournament_id"):
        await _ensure_tournament_unlocked(db, doc["tournament_id"])
    doc["id"] = new_id()
    doc["status"] = "free"
    doc["current_match_id"] = None
    doc["queue_match_ids"] = []
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    await db.stations.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.put("/{sid}")
@router.patch("/{sid}")
async def update_station(sid: str, body: StationUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    nullable = {"tournament_id", "event_id", "game_id", "notes", "current_match_id", "current_match_type"}
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in nullable}
    current = await db.stations.find_one({"id": sid}, {"_id": 0})
    if current and current.get("tournament_id"):
        await _ensure_tournament_unlocked(db, current["tournament_id"])
    if updates.get("tournament_id") and not await db.tournaments.find_one({"id": updates["tournament_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if updates.get("tournament_id"):
        await _ensure_tournament_unlocked(db, updates["tournament_id"])
    updates["updated_at"] = now_utc().isoformat()
    await db.stations.update_one({"id": sid}, {"$set": updates})
    s = await db.stations.find_one({"id": sid}, {"_id": 0})
    return s


async def _assign_match_to_station(db, station: dict, match: dict, collection_name: str, start_now: bool = False) -> None:
    station_tid = station.get("tournament_id")
    if station_tid and station_tid != match.get("tournament_id"):
        raise HTTPException(status_code=400, detail="Station gehoert zu einem anderen Turnier")
    if station.get("status") == "broken":
        raise HTTPException(status_code=409, detail="Station ist als defekt markiert")
    if station.get("current_match_id") and station.get("current_match_id") != match.get("id"):
        raise HTTPException(status_code=409, detail="Station ist bereits belegt. Bitte zuerst freigeben.")
    await db.stations.update_many(
        {"current_match_id": match["id"], "id": {"$ne": station["id"]}},
        {"$set": {"current_match_id": None, "current_match_type": None, "status": "free", "updated_at": now_utc().isoformat()}},
    )
    now_iso = now_utc().isoformat()
    match_updates = {
        "station_id": station["id"],
        "status": _station_match_status(match, start_now),
        "updated_at": now_iso,
    }
    if start_now:
        match_updates["started_at"] = now_iso
        match_updates["scheduled_at"] = match.get("scheduled_at") or now_iso
    await db.stations.update_one({"id": station["id"]}, {"$set": {
        "current_match_id": match["id"],
        "current_match_type": collection_name,
        "status": "busy" if start_now else "reserved",
        "updated_at": now_iso,
    }})
    await db[collection_name].update_one({"id": match["id"]}, {"$set": match_updates})
    if start_now:
        await db.tournaments.update_one(
            {"id": match["tournament_id"], "status": {"$in": ["scheduled", "registration_open", "registration_closed", "check_in"]}},
            {"$set": {"status": "live", "updated_at": now_iso}},
        )
        started_match = {**match, **match_updates}
        await notify_match_started(db, started_match, station, collection_name)


@router.post("/bulk")
async def bulk_create_stations(body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    tournament_id = body.get("tournament_id")
    if tournament_id and not await db.tournaments.find_one({"id": tournament_id}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if tournament_id:
        await _ensure_tournament_unlocked(db, tournament_id)
    count = int(body.get("count") or 0)
    if count < 1 or count > 64:
        raise HTTPException(status_code=400, detail="Anzahl muss zwischen 1 und 64 liegen")
    prefix = (body.get("prefix") or "Station").strip() or "Station"
    device_type = (body.get("device_type") or "switch").strip()
    notes = (body.get("notes") or "").strip() or None
    now = now_utc().isoformat()
    docs = []
    for index in range(1, count + 1):
        docs.append({
            "id": new_id(),
            "name": f"{prefix} {index}",
            "device_type": device_type,
            "tournament_id": tournament_id,
            "event_id": body.get("event_id"),
            "game_id": body.get("game_id"),
            "notes": notes,
            "status": "free",
            "current_match_id": None,
            "current_match_type": None,
            "queue_match_ids": [],
            "created_at": now,
            "updated_at": now,
        })
    await db.stations.insert_many(docs)
    for doc in docs:
        doc.pop("_id", None)
    return {"created": len(docs), "stations": docs}


@router.post("/auto-assign")
async def auto_assign_stations(tournament_id: str, start_now: bool = False,
                               plan: bool = True,
                               me: dict = Depends(get_current_user)):
    db = get_db()
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    await _ensure_tournament_unlocked(db, tournament_id)
    await require_tournament_staff_permission(me, tournament_id, STATION_ASSIGN_ROLES, "tournament")
    station_query = {"tournament_id": tournament_id, "status": {"$ne": "broken"}}
    if start_now or not plan:
        station_query = {
            **station_query,
            "status": {"$in": ["free", "reserved"]},
            "$or": [{"current_match_id": None}, {"current_match_id": {"$exists": False}}],
        }
    stations = await db.stations.find(station_query, {"_id": 0}).sort("name", 1).to_list(200)
    if not stations:
        return {"assigned": 0, "items": [], "planned": bool(plan and not start_now)}
    status_filter = ["ready", "scheduled"] if start_now else ["preview", "pending", "ready", "scheduled"]
    station_filter = {"$in": [None, ""]} if not start_now else {"$in": [None, "", *[station["id"] for station in stations]]}
    matches = await db.matches.find({
        "tournament_id": tournament_id,
        "station_id": station_filter,
        "status": {"$in": status_filter},
    }, {"_id": 0}).to_list(1000)
    matches_v2 = await db.matches_v2.find({
        "tournament_id": tournament_id,
        "station_id": station_filter,
        "status": {"$in": status_filter},
    }, {"_id": 0}).to_list(3000)
    candidates = [("matches", m) for m in matches] + [("matches_v2", m) for m in matches_v2]
    candidates = [item for item in candidates if _match_has_participants(item[1])]
    candidates.sort(key=lambda item: _match_sort_key(item[1]))

    if plan and not start_now:
        start_at = _parse_dt(tournament.get("start_date")) or now_utc()
        station_available_at = {station["id"]: start_at for station in stations}
        assigned = []
        for collection_name, match in candidates:
            station = min(stations, key=lambda item: (station_available_at[item["id"]], item.get("name") or item["id"]))
            scheduled_at = station_available_at[station["id"]]
            duration_minutes = _duration_for_match(match, tournament)
            await db[collection_name].update_one({"id": match["id"]}, {"$set": {
                "station_id": station["id"],
                "scheduled_at": scheduled_at.isoformat(),
                "duration_minutes": duration_minutes,
                "status": "scheduled" if match.get("status") in {"pending", "ready", "scheduled"} else match.get("status"),
                "updated_at": now_utc().isoformat(),
            }})
            station_available_at[station["id"]] = scheduled_at + timedelta(minutes=duration_minutes)
            assigned.append({
                "station_id": station["id"],
                "match_id": match["id"],
                "match_type": collection_name,
                "scheduled_at": scheduled_at.isoformat(),
                "duration_minutes": duration_minutes,
            })
        return {"assigned": len(assigned), "items": assigned, "planned": True}

    assigned = []
    used_match_ids: set[str] = set()
    for station in stations:
        preferred_index = next(
            (
                index for index, (_collection_name, match) in enumerate(candidates)
                if match.get("id") not in used_match_ids and match.get("station_id") == station["id"]
            ),
            None,
        )
        fallback_index = next(
            (
                index for index, (_collection_name, match) in enumerate(candidates)
                if match.get("id") not in used_match_ids and not match.get("station_id")
            ),
            None,
        )
        candidate_index = preferred_index if preferred_index is not None else fallback_index
        if candidate_index is None:
            continue
        collection_name, match = candidates[candidate_index]
        await _assign_match_to_station(db, station, match, collection_name, start_now=start_now)
        used_match_ids.add(match["id"])
        assigned.append({"station_id": station["id"], "match_id": match["id"], "match_type": collection_name})
    return {"assigned": len(assigned), "items": assigned, "planned": False}


@router.post("/{sid}/assign/{match_id}")
async def assign_match(sid: str, match_id: str, start_now: bool = False,
                       me: dict = Depends(get_current_user)):
    db = get_db()
    station = await db.stations.find_one({"id": sid}, {"_id": 0})
    if not station:
        raise HTTPException(status_code=404, detail="Station nicht gefunden")
    collection_name, match = await _find_match_for_station(db, match_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match nicht gefunden")
    await _ensure_tournament_unlocked(db, match["tournament_id"])
    await _require_station_permission(me, match["tournament_id"], sid)
    await _assign_match_to_station(db, station, match, collection_name, start_now=start_now)
    return {"ok": True}


@router.post("/{sid}/clear")
async def clear_station(sid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.stations.find_one({"id": sid})
    if not s:
        raise HTTPException(status_code=404, detail="Station nicht gefunden")
    if s and s.get("current_match_id"):
        collection_name, match = await _find_match_for_station(db, s["current_match_id"])
        if match:
            await _ensure_tournament_unlocked(db, match["tournament_id"])
            await _require_station_permission(me, match["tournament_id"], sid)
        elif not is_global_tournament_admin(me):
            raise HTTPException(status_code=403, detail="Keine Turnierberechtigung fuer diese Station")
        if collection_name:
            await db[collection_name].update_one({"id": s["current_match_id"]}, {"$set": {"station_id": None, "updated_at": now_utc().isoformat()}})
    elif not is_global_tournament_admin(me):
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung fuer diese Station")
    await db.stations.update_one({"id": sid}, {"$set": {
        "current_match_id": None, "current_match_type": None, "status": "free", "updated_at": now_utc().isoformat()}})
    return {"ok": True}


@router.delete("/{sid}")
async def delete_station(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    station = await db.stations.find_one({"id": sid}, {"_id": 0})
    if station and station.get("tournament_id"):
        await _ensure_tournament_unlocked(db, station["tournament_id"])
    await db.stations.delete_one({"id": sid})
    return {"ok": True}
