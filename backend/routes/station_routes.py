"""Station routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin
from models import StationCreate, StationUpdate, now_utc, new_id
from services.tournament_permissions import is_global_tournament_admin, require_tournament_staff_permission

router = APIRouter(prefix="/api/stations", tags=["stations"])
STATION_ASSIGN_ROLES = {"organizer", "referee", "station_manager"}


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


@router.get("")
async def list_stations(event_id: str | None = None):
    db = get_db()
    q = {}
    if event_id:
        q["event_id"] = event_id
    stations = await db.stations.find(q, {"_id": 0}).to_list(500)
    return stations


@router.post("")
async def create_station(body: StationCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
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
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = now_utc().isoformat()
    await db.stations.update_one({"id": sid}, {"$set": updates})
    s = await db.stations.find_one({"id": sid}, {"_id": 0})
    return s


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
    await require_tournament_staff_permission(me, match["tournament_id"], STATION_ASSIGN_ROLES)
    if station.get("current_match_id") and station.get("current_match_id") != match_id:
        raise HTTPException(status_code=409, detail="Station ist bereits belegt. Bitte zuerst freigeben.")
    await db.stations.update_many(
        {"current_match_id": match_id, "id": {"$ne": sid}},
        {"$set": {"current_match_id": None, "current_match_type": None, "status": "free", "updated_at": now_utc().isoformat()}},
    )
    await db.stations.update_one({"id": sid}, {"$set": {
        "current_match_id": match_id,
        "current_match_type": collection_name,
        "status": "busy" if start_now else "reserved",
        "updated_at": now_utc().isoformat(),
    }})
    await db[collection_name].update_one({"id": match_id}, {"$set": {
        "station_id": sid, "status": _station_match_status(match, start_now), "updated_at": now_utc().isoformat()}})
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
            await require_tournament_staff_permission(me, match["tournament_id"], STATION_ASSIGN_ROLES)
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
