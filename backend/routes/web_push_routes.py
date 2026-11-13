"""Browser-Benachrichtigungen (Web-Push, #1163): Anmelden und Abmelden eines Browsers.

Je Konto und Browser eine Anmeldung: Adresse beim Push-Dienst (``endpoint``), die zwei Schlüssel des Browsers, ein kurzer
Name („Chrome unter Windows“) und wann. Die Anmeldung hängt an der Sitzung, in der sie entstand - wer sich abmeldet,
nimmt sie mit (``web_push.forget_session``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services import web_push
from services.rate_limit import enforce_rate_limit

router = APIRouter(prefix="/api/web-push", tags=["web-push"])
# Anmelden eines Browsers: höchstens so oft je Konto und Minute (Website frischt beim Laden einmal auf).
SUBSCRIBE_LIMIT = 10
SUBSCRIBE_WINDOW_SECONDS = 60


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=80, max_length=120)
    auth: str = Field(min_length=16, max_length=40)


class SubscriptionCreate(BaseModel):
    endpoint: str = Field(min_length=20, max_length=1024)
    keys: SubscriptionKeys
    # „Inhalt verbergen“ für diesen Browser: nur „Neue Benachrichtigung“. Ohne Angabe bleibt, was gespeichert ist.
    private: bool | None = None


class SubscriptionDelete(BaseModel):
    endpoint: str = Field(min_length=20, max_length=1024)


@router.get("/config")
async def web_push_config(user: dict = Depends(get_current_user)):
    """Ob Browser-Benachrichtigungen an sind, der öffentliche Schlüssel und wie viele Browser angemeldet sind."""
    config = web_push.public_config()
    count = 0
    if config["enabled"]:
        count = await get_db().web_push_subscriptions.count_documents({"user_id": user["id"]})
    return {**config, "subscriptions": count}


@router.post("/subscriptions")
async def subscribe_browser(body: SubscriptionCreate, request: Request, user: dict = Depends(get_current_user)):
    await enforce_rate_limit(request, "web-push:subscribe:user", limit=SUBSCRIBE_LIMIT,
                             window_seconds=SUBSCRIBE_WINDOW_SECONDS, subject=user["id"])
    if not web_push.vapid_config():
        raise HTTPException(status_code=409, detail="Browser-Benachrichtigungen sind auf diesem Server nicht eingerichtet.")
    endpoint = body.endpoint.strip()
    if not web_push.endpoint_allowed(endpoint):
        raise HTTPException(status_code=400, detail="Dieser Browser-Dienst wird nicht unterstützt.")
    if not web_push.valid_keys(body.keys.p256dh, body.keys.auth):
        raise HTTPException(status_code=400, detail="Die Anmeldung des Browsers ist unvollständig.")
    from routes.auth_routes import _current_session_family

    db = get_db()
    family = await _current_session_family(db, request)
    digest = web_push.endpoint_hash(endpoint)
    now = now_utc().isoformat()
    # Ein Browser gehört genau einem Konto: meldet er sich für dieses an, ist er bei jedem anderen weg.
    await db.web_push_subscriptions.delete_many({"endpoint_hash": digest, "user_id": {"$ne": user["id"]}})
    await db.web_push_subscriptions.update_one(
        {"endpoint_hash": digest},
        {
            "$set": {
                "user_id": user["id"],
                "endpoint": endpoint,
                "p256dh": body.keys.p256dh.strip(),
                "auth": body.keys.auth.strip(),
                "browser": web_push.browser_label(request.headers.get("user-agent")),
                "session_family": family,
                "updated_at": now,
                **({"private_content": body.private} if body.private is not None else {}),
            },
            "$setOnInsert": {"id": new_id(), "endpoint_hash": digest, "created_at": now},
        },
        upsert=True,
    )
    # Höchstens 20 Browser je Konto - die ältesten fallen heraus.
    rows = await db.web_push_subscriptions.find(
        {"user_id": user["id"]}, {"_id": 0, "id": 1},
    ).sort("updated_at", -1).to_list(200)
    stale = [row["id"] for row in rows[web_push.MAX_SUBSCRIPTIONS_PER_USER:] if row.get("id")]
    if stale:
        await db.web_push_subscriptions.delete_many({"id": {"$in": stale}})
    stored = await db.web_push_subscriptions.find_one({"endpoint_hash": digest}, {"_id": 0, "private_content": 1})
    return {"ok": True, "private": bool((stored or {}).get("private_content"))}


@router.delete("/subscriptions")
async def unsubscribe_browser(body: SubscriptionDelete, user: dict = Depends(get_current_user)):
    db = get_db()
    result = await db.web_push_subscriptions.delete_many(
        {"user_id": user["id"], "endpoint_hash": web_push.endpoint_hash(body.endpoint.strip())},
    )
    return {"ok": True, "removed": int(result.deleted_count or 0)}
