"""Station routes."""
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin
from models import StationCreate, StationUpdate, now_utc, new_id
from match_rules import participant_source_ids
from services.tournament_permissions import (
    has_tournament_staff_permission,
    is_global_tournament_admin,
    require_tournament_staff_permission,
)
from services.user_notifications import create_user_notification

router = APIRouter(prefix="/api/stations", tags=["stations"])
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
        int(match.get("round") or 0),
        int(match.get("order") or match.get("position") or 0),
        match.get("match_key") or match.get("id") or "",
    )


async def _station_label(station: dict) -> str:
    parts = [station.get("name") or station.get("id") or "Station"]
    if station.get("device_type"):
        parts.append(station["device_type"])
    if station.get("notes"):
        parts.append(station["notes"])
    return " · ".join(parts)


async def _registration_label(db, registration_id: str | None) -> str:
    if not registration_id:
        return "Offen"
    reg = await db.tournament_registrations.find_one({"id": registration_id}, {"_id": 0})
    if not reg:
        return registration_id
    return reg.get("display_name") or reg.get("ingame_name") or registration_id


async def _match_label(db, match: dict) -> str:
    if match.get("slots"):
        names = []
        for slot in match.get("slots") or []:
            if slot.get("registration_id"):
                names.append(await _registration_label(db, slot.get("registration_id")))
        return f"{match.get('match_key') or 'Durchgang'} · {' / '.join(names[:4]) or 'Offen'}"
    a = await _registration_label(db, match.get("participant_a_id"))
    b = await _registration_label(db, match.get("participant_b_id"))
    return f"{a} gegen {b}"


async def _notify_station_assignment(db, match: dict, station: dict) -> None:
    reg_ids = participant_source_ids(match)
    if not reg_ids:
        return
    regs = await db.tournament_registrations.find({"id": {"$in": reg_ids}}, {"_id": 0}).to_list(50)
    station_name = await _station_label(station)
    match_name = await _match_label(db, match)
    collection_name = "matches_v2" if match.get("slots") else "matches"
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "slug": 1}) or {}
    url = f"/matches/{match.get('id')}" if collection_name == "matches" else f"/tournaments/{tournament.get('slug') or match.get('tournament_id')}/bracket"
    for reg in regs:
        if not reg.get("user_id"):
            continue
        await create_user_notification(
            reg["user_id"],
            "Station zugewiesen",
            f"{match_name} ist auf {station_name} eingeteilt.",
            url=url,
            kind="match_station",
            meta={"match_id": match.get("id"), "station_id": station.get("id"), "tournament_id": match.get("tournament_id")},
        )


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
    if updates.get("tournament_id") and not await db.tournaments.find_one({"id": updates["tournament_id"]}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
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
    await db.stations.update_one({"id": station["id"]}, {"$set": {
        "current_match_id": match["id"],
        "current_match_type": collection_name,
        "status": "busy" if start_now else "reserved",
        "updated_at": now_utc().isoformat(),
    }})
    await db[collection_name].update_one({"id": match["id"]}, {"$set": {
        "station_id": station["id"],
        "status": _station_match_status(match, start_now),
        "updated_at": now_utc().isoformat(),
    }})
    await _notify_station_assignment(db, match, station)


@router.post("/bulk")
async def bulk_create_stations(body: dict, me: dict = Depends(require_admin())):
    db = get_db()
    tournament_id = body.get("tournament_id")
    if tournament_id and not await db.tournaments.find_one({"id": tournament_id}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
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
                               me: dict = Depends(get_current_user)):
    db = get_db()
    if not await db.tournaments.find_one({"id": tournament_id}, {"id": 1}):
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    await require_tournament_staff_permission(me, tournament_id, STATION_ASSIGN_ROLES, "tournament")
    stations = await db.stations.find({
        "tournament_id": tournament_id,
        "status": {"$in": ["free", "reserved"]},
        "$or": [{"current_match_id": None}, {"current_match_id": {"$exists": False}}],
    }, {"_id": 0}).sort("name", 1).to_list(200)
    matches = await db.matches.find({
        "tournament_id": tournament_id,
        "station_id": {"$in": [None, ""]},
        "status": {"$in": ["ready", "scheduled"]},
    }, {"_id": 0}).to_list(1000)
    matches_v2 = await db.matches_v2.find({
        "tournament_id": tournament_id,
        "station_id": {"$in": [None, ""]},
        "status": {"$in": ["ready", "scheduled"]},
    }, {"_id": 0}).to_list(3000)
    candidates = [("matches", m) for m in matches] + [("matches_v2", m) for m in matches_v2]
    candidates.sort(key=lambda item: _match_sort_key(item[1]))
    assigned = []
    for station, (collection_name, match) in zip(stations, candidates):
        await _assign_match_to_station(db, station, match, collection_name, start_now=start_now)
        assigned.append({"station_id": station["id"], "match_id": match["id"], "match_type": collection_name})
    return {"assigned": len(assigned), "items": assigned}


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
    await db.stations.delete_one({"id": sid})
    return {"ok": True}
