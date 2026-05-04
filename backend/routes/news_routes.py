"""News & Sponsors routes."""
from fastapi import APIRouter, HTTPException, Depends
from database import get_db
from auth import require_admin
from models import NewsCreate, SponsorCreate, now_utc, new_id

router = APIRouter(prefix="/api", tags=["news"])


@router.get("/news")
async def list_news(published_only: bool = True):
    db = get_db()
    q = {"published": True} if published_only else {}
    posts = await db.news_posts.find(q, {"_id": 0}).sort("created_at", -1).to_list(50)
    return posts


@router.get("/news/{slug_or_id}")
async def get_news(slug_or_id: str):
    db = get_db()
    p = await db.news_posts.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404)
    return p


@router.post("/news")
async def create_news(body: NewsCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.news_posts.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["author_id"] = me["id"]
    await db.news_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/news/{nid}")
async def delete_news(nid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.news_posts.delete_one({"id": nid})
    return {"ok": True}


@router.get("/sponsors")
async def list_sponsors():
    db = get_db()
    sp = await db.sponsors.find({}, {"_id": 0}).to_list(100)
    return sp


@router.post("/sponsors")
async def create_sponsor(body: SponsorCreate, me: dict = Depends(require_admin())):
    db = get_db()
    doc = body.model_dump()
    doc["id"] = new_id()
    doc["created_at"] = now_utc().isoformat()
    await db.sponsors.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/sponsors/{sid}")
async def delete_sponsor(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.sponsors.delete_one({"id": sid})
    return {"ok": True}
