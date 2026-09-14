"""Sticker: Katalog für alle Angemeldeten, Pflege im Adminbereich.

Das Startpaket ist fest mitgeliefert. Admins können es abschalten, aber nicht
ändern. Eigene Pakete legen sie selbst an; die Bilder kommen über den Upload.
Gelöschte Sticker lassen ihr Bild in der Mediathek, denn ältere Nachrichten
zeigen es weiterhin.
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from auth import get_current_user, require_admin
from database import get_db
from models import new_id, now_utc
from services.stickers import (
    CUSTOM_STICKER_URL,
    MAX_CUSTOM_PACKS,
    MAX_STICKERS_PER_PACK,
    builtin_pack_ids,
    builtin_source,
    list_sticker_packs,
    public_custom_sticker,
    sticker_file_path,
)

router = APIRouter(prefix="/api/stickers", tags=["stickers"])

FILE_MEDIA_TYPES = {".png": "image/png", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8"}
MAX_KEYWORDS = 12


class StickerPackCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    active: bool = True
    sort_order: int = Field(default=0, ge=-1000, le=1000)


class StickerPackUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    active: bool | None = None
    sort_order: int | None = Field(default=None, ge=-1000, le=1000)


class StickerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    url: str = Field(min_length=1, max_length=300)
    keywords: list[str] = Field(default_factory=list, max_length=MAX_KEYWORDS)
    sort_order: int = Field(default=0, ge=-1000, le=1000)


class StickerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    keywords: list[str] | None = Field(default=None, max_length=MAX_KEYWORDS)
    sort_order: int | None = Field(default=None, ge=-1000, le=1000)


def _clean_keywords(values: list[str]) -> list[str]:
    words = (str(value).strip().lower()[:30] for value in values or [])
    return list(dict.fromkeys(word for word in words if word))[:MAX_KEYWORDS]


def _clean_name(value: str) -> str:
    name = value.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Bitte einen Namen angeben.")
    return name


async def _custom_pack(db, pack_id: str) -> dict:
    pack = await db.sticker_packs.find_one({"id": pack_id}, {"_id": 0})
    if not pack:
        raise HTTPException(status_code=404, detail="Stickerpaket nicht gefunden")
    return pack


@router.get("")
async def list_stickers(_me: dict = Depends(get_current_user)):
    return {"packs": await list_sticker_packs(get_db()), "source": builtin_source()}


@router.get("/files/{pack}/{filename}")
async def sticker_file(pack: str, filename: str):
    """Bilder des Startpakets. Öffentlich wie jedes Emoji; die Dateinamen bleiben gleich."""
    path = sticker_file_path(pack, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Sticker nicht gefunden")
    return FileResponse(
        path,
        media_type=FILE_MEDIA_TYPES[path.suffix],
        headers={"Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/admin")
async def admin_list_stickers(_me: dict = Depends(require_admin())):
    return {"packs": await list_sticker_packs(get_db(), include_inactive=True), "source": builtin_source()}


@router.post("/admin/packs")
async def create_sticker_pack(body: StickerPackCreate, _me: dict = Depends(require_admin())):
    db = get_db()
    if await db.sticker_packs.count_documents({}) >= MAX_CUSTOM_PACKS:
        raise HTTPException(status_code=400, detail=f"Höchstens {MAX_CUSTOM_PACKS} eigene Stickerpakete.")
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "name": _clean_name(body.name),
        "active": body.active,
        "sort_order": body.sort_order,
        "created_at": now,
        "updated_at": now,
    }
    await db.sticker_packs.insert_one(dict(doc))
    return {**doc, "builtin": False, "stickers": []}


@router.patch("/admin/packs/{pack_id}")
async def update_sticker_pack(pack_id: str, body: StickerPackUpdate, _me: dict = Depends(require_admin())):
    db = get_db()
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    now = now_utc().isoformat()
    if pack_id in builtin_pack_ids():
        # Name und Bilder des Startpakets kommen aus dem Katalog; einstellbar ist nur, ob es angeboten wird.
        if set(changes) - {"active"}:
            raise HTTPException(status_code=400, detail="Beim Startpaket lässt sich nur einstellen, ob es angeboten wird.")
        if "active" in changes:
            await db.sticker_builtin_packs.update_one(
                {"id": pack_id},
                {"$set": {"id": pack_id, "active": changes["active"], "updated_at": now}},
                upsert=True,
            )
        return {"ok": True}
    await _custom_pack(db, pack_id)
    if "name" in changes:
        changes["name"] = _clean_name(changes["name"])
    if changes:
        await db.sticker_packs.update_one({"id": pack_id}, {"$set": {**changes, "updated_at": now}})
    return {"ok": True}


@router.delete("/admin/packs/{pack_id}")
async def delete_sticker_pack(pack_id: str, _me: dict = Depends(require_admin())):
    if pack_id in builtin_pack_ids():
        raise HTTPException(status_code=400, detail="Das Startpaket lässt sich abschalten, aber nicht löschen.")
    db = get_db()
    await _custom_pack(db, pack_id)
    await db.stickers.delete_many({"pack_id": pack_id})
    await db.sticker_packs.delete_one({"id": pack_id})
    return {"ok": True}


@router.post("/admin/packs/{pack_id}/stickers")
async def create_sticker(pack_id: str, body: StickerCreate, _me: dict = Depends(require_admin())):
    if pack_id in builtin_pack_ids():
        raise HTTPException(status_code=400, detail="Das Startpaket ist fest. Eigene Sticker gehören in ein eigenes Paket.")
    db = get_db()
    await _custom_pack(db, pack_id)
    url = body.url.strip()
    if not CUSTOM_STICKER_URL.fullmatch(url):
        raise HTTPException(status_code=400, detail="Sticker-Bilder bitte hier hochladen oder aus der Mediathek wählen.")
    if await db.stickers.count_documents({"pack_id": pack_id}) >= MAX_STICKERS_PER_PACK:
        raise HTTPException(status_code=400, detail=f"Höchstens {MAX_STICKERS_PER_PACK} Sticker pro Paket.")
    upload = await db.media_uploads.find_one({"url": url}, {"_id": 0, "width": 1, "height": 1}) or {}
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "pack_id": pack_id,
        "name": _clean_name(body.name),
        "keywords": _clean_keywords(body.keywords),
        "url": url,
        "width": upload.get("width"),
        "height": upload.get("height"),
        "sort_order": body.sort_order,
        "created_at": now,
        "updated_at": now,
    }
    await db.stickers.insert_one(dict(doc))
    return public_custom_sticker(doc)


@router.patch("/admin/stickers/{sticker_id}")
async def update_sticker(sticker_id: str, body: StickerUpdate, _me: dict = Depends(require_admin())):
    db = get_db()
    if not await db.stickers.find_one({"id": sticker_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Sticker nicht gefunden")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in changes:
        changes["name"] = _clean_name(changes["name"])
    if "keywords" in changes:
        changes["keywords"] = _clean_keywords(changes["keywords"])
    if changes:
        await db.stickers.update_one({"id": sticker_id}, {"$set": {**changes, "updated_at": now_utc().isoformat()}})
    return {"ok": True}


@router.delete("/admin/stickers/{sticker_id}")
async def delete_sticker(sticker_id: str, _me: dict = Depends(require_admin())):
    result = await get_db().stickers.delete_one({"id": sticker_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Sticker nicht gefunden")
    return {"ok": True}
