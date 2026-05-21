"""Admin API for special access links."""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_admin
from database import get_db
from models import new_id, now_utc
from services.access_links import (
    ACCESS_GRANTS,
    TARGET_TYPES,
    access_path,
    hash_access_token,
    new_access_token,
    public_access_link_payload,
)
from services.user_notifications import build_public_url, create_user_notification

router = APIRouter(prefix="/api/access-links", tags=["access-links"])


class AccessLinkCreate(BaseModel):
    target_type: Literal["event", "tournament", "fastlap"]
    target_id: str = Field(min_length=1, max_length=120)
    grants: list[Literal["view", "register", "submit"]] = Field(default_factory=lambda: ["view"])
    expires_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1, le=10000)
    user_id: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=320)
    note: str | None = Field(default=None, max_length=500)
    notify_user: bool = False


def _collection_for_target(target_type: str):
    db = get_db()
    return {
        "event": db.events,
        "tournament": db.tournaments,
        "fastlap": db.f1_challenges,
    }.get(target_type)


async def _target_doc(target_type: str, target_id: str) -> dict:
    collection = _collection_for_target(target_type)
    if collection is None:
        raise HTTPException(status_code=400, detail="Ungueltiger Zieltyp")
    doc = await collection.find_one({"id": target_id}, {"_id": 0, "id": 1, "slug": 1, "name": 1, "title": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Ziel nicht gefunden")
    return doc


def _safe_link_payload(link: dict, target: dict | None = None) -> dict:
    payload = public_access_link_payload(link) or {}
    payload["created_at"] = link.get("created_at")
    payload["created_by"] = link.get("created_by")
    payload["is_active"] = link.get("is_active") is not False
    payload["user_id"] = link.get("user_id")
    payload["email"] = link.get("email")
    payload["last_used_at"] = link.get("last_used_at")
    payload["last_used_by"] = link.get("last_used_by")
    if target:
        payload["target"] = target
    return payload


@router.get("")
async def list_access_links(
    target_type: str | None = None,
    target_id: str | None = None,
    include_inactive: bool = False,
    me: dict = Depends(require_admin()),
):
    db = get_db()
    query: dict = {}
    if target_type:
        if target_type not in TARGET_TYPES:
            raise HTTPException(status_code=400, detail="Ungueltiger Zieltyp")
        query["target_type"] = target_type
    if target_id:
        query["target_id"] = target_id
    if not include_inactive:
        query["is_active"] = {"$ne": False}
    rows = await db.access_links.find(query, {"_id": 0, "token_hash": 0}).sort("created_at", -1).to_list(500)
    return [_safe_link_payload(row) for row in rows]


@router.post("")
async def create_access_link(body: AccessLinkCreate, me: dict = Depends(require_admin())):
    db = get_db()
    target = await _target_doc(body.target_type, body.target_id)
    bound_user = None
    if body.user_id:
        bound_user = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1})
        if not bound_user:
            raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    grants = list(dict.fromkeys(body.grants or ["view"]))
    if any(grant in grants for grant in ("register", "submit")) and "view" not in grants:
        grants.insert(0, "view")
    if any(grant not in ACCESS_GRANTS for grant in grants):
        raise HTTPException(status_code=400, detail="Ungueltige Freigabe")
    token = new_access_token()
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "target_type": body.target_type,
        "target_id": body.target_id,
        "grants": grants,
        "token_hash": hash_access_token(token),
        "expires_at": body.expires_at.isoformat() if body.expires_at else None,
        "max_uses": body.max_uses,
        "use_count": 0,
        "user_id": body.user_id or None,
        "email": ((body.email or (bound_user or {}).get("email") or "").strip().lower() or None),
        "note": (body.note or "").strip() or None,
        "is_active": True,
        "created_by": me.get("id"),
        "created_at": now,
        "updated_at": now,
    }
    await db.access_links.insert_one(doc)
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "access_link.create",
        "target_id": body.target_id,
        "actor_id": me.get("id"),
        "data": {
            "access_link_id": doc["id"],
            "target_type": body.target_type,
            "grants": grants,
            "expires_at": doc.get("expires_at"),
            "max_uses": doc.get("max_uses"),
            "user_id": doc.get("user_id"),
            "email": doc.get("email"),
        },
        "created_at": now,
    })
    doc.pop("_id", None)
    url = access_path(body.target_type, target, token)
    absolute_url = await build_public_url(url)
    if body.notify_user and bound_user:
        target_label = target.get("name") or target.get("title") or body.target_id
        await create_user_notification(
            bound_user["id"],
            "Speziallink freigeschaltet",
            f"Du hast Zugriff auf {target_label}.",
            url=absolute_url,
            kind="access_link_invite",
            meta={
                "access_link_id": doc["id"],
                "target_type": body.target_type,
                "target_id": body.target_id,
            },
        )
    return {**_safe_link_payload(doc, target), "token": token, "url": url, "absolute_url": absolute_url}


@router.delete("/{link_id}")
async def revoke_access_link(link_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    existing = await db.access_links.find_one({"id": link_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Speziallink nicht gefunden")
    now = now_utc().isoformat()
    await db.access_links.update_one(
        {"id": link_id},
        {"$set": {"is_active": False, "revoked_at": now, "revoked_by": me.get("id"), "updated_at": now}},
    )
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "access_link.revoke",
        "target_id": existing.get("target_id"),
        "actor_id": me.get("id"),
        "data": {"access_link_id": link_id, "target_type": existing.get("target_type")},
        "created_at": now,
    })
    return {"ok": True}
