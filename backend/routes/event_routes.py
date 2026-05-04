"""Event routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import require_admin, get_optional_user
from models import EventCreate, EventUpdate, now_utc, new_id

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
async def list_events(status: str | None = None):
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    events = await db.events.find(q, {"_id": 0}).sort("start_date", -1).to_list(200)
    return events


@router.get("/{slug_or_id}")
async def get_event(slug_or_id: str):
    db = get_db()
    event = await db.events.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event nicht gefunden")
    # Attach tournaments and f1 challenges
    event["tournaments"] = await db.tournaments.find({"event_id": event["id"]}, {"_id": 0}).to_list(200)
    event["f1_challenges"] = await db.f1_challenges.find({"event_id": event["id"]}, {"_id": 0}).to_list(200)
    return event


@router.post("")
async def create_event(body: EventCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.events.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["status"] = "upcoming"
    if doc.get("start_date"):
        doc["start_date"] = doc["start_date"].isoformat()
    if doc.get("end_date"):
        doc["end_date"] = doc["end_date"].isoformat()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.events.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/{event_id}")
async def update_event(event_id: str, body: EventUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if updates.get("start_date"):
        updates["start_date"] = updates["start_date"].isoformat()
    if updates.get("end_date"):
        updates["end_date"] = updates["end_date"].isoformat()
    updates["updated_at"] = now_utc().isoformat()
    await db.events.update_one({"id": event_id}, {"$set": updates})
    event = await db.events.find_one({"id": event_id}, {"_id": 0})
    return event


@router.delete("/{event_id}")
async def delete_event(event_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.events.delete_one({"id": event_id})
    return {"ok": True}
