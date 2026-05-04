"""Station routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import require_admin
from models import StationCreate, StationUpdate, now_utc, new_id

router = APIRouter(prefix="/api/stations", tags=["stations"])


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


@router.patch("/{sid}")
async def update_station(sid: str, body: StationUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    updates["updated_at"] = now_utc().isoformat()
    await db.stations.update_one({"id": sid}, {"$set": updates})
    s = await db.stations.find_one({"id": sid}, {"_id": 0})
    return s


@router.post("/{sid}/assign/{match_id}")
async def assign_match(sid: str, match_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.stations.update_one({"id": sid}, {"$set": {
        "current_match_id": match_id, "status": "busy", "updated_at": now_utc().isoformat()}})
    await db.matches.update_one({"id": match_id}, {"$set": {
        "station_id": sid, "status": "in_progress", "updated_at": now_utc().isoformat()}})
    return {"ok": True}


@router.post("/{sid}/clear")
async def clear_station(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    s = await db.stations.find_one({"id": sid})
    if s and s.get("current_match_id"):
        await db.matches.update_one({"id": s["current_match_id"]}, {"$set": {"station_id": None}})
    await db.stations.update_one({"id": sid}, {"$set": {
        "current_match_id": None, "status": "free", "updated_at": now_utc().isoformat()}})
    return {"ok": True}


@router.delete("/{sid}")
async def delete_station(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.stations.delete_one({"id": sid})
    return {"ok": True}
