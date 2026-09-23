"""Plattform-Konten verknüpfen (#260): Start, Rückruf, Trennen.

Der Rückruf kommt vom Browser ohne unsere Anmeldung - wer verknüpft, sagt der signierte
``state``. Fehler landen als ``?link_error=`` im Profil, damit die Seite sie erklären kann.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from auth import get_current_user, require_club_admin
from database import get_db
from models import new_id, now_utc
from services import platform_links
from services.platform_links import PLATFORMS, LinkError

router = APIRouter(prefix="/api", tags=["platform-links"])
logger = logging.getLogger("tls.platform_links")


async def _branding(db) -> dict:
    return await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}


def _platform(platform: str) -> str:
    if platform not in PLATFORMS:
        raise HTTPException(404, "Diese Plattform gibt es nicht.")
    return platform


async def _audit(db, user_id: str, action: str, platform: str, extra: dict | None = None) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": user_id, "target_id": user_id,
                                    "data": {"platform": platform, **(extra or {})}, "created_at": now_utc().isoformat()})


@router.get("/me/platform-links")
async def my_platform_links(me: dict = Depends(get_current_user)):
    db = get_db()
    branding = await _branding(db)
    return {
        "links": await platform_links.links_for(db, me["id"]),
        "available": platform_links.providers_configured(branding),
        "platforms": {key: {"label": spec["label"], "field": spec["field"], "delivers": spec["delivers"]} for key, spec in PLATFORMS.items()},
    }


@router.post("/me/platform-links/{platform}/start")
async def start_platform_link(platform: str, me: dict = Depends(get_current_user)):
    """Die Anmeldeadresse der Plattform - der Browser geht dorthin, die Plattform ruft zurück."""
    platform = _platform(platform)
    db = get_db()
    branding = await _branding(db)
    if not platform_links.public_base_url():
        raise HTTPException(503, "Die öffentliche Adresse der Website ist nicht gesetzt (PUBLIC_BACKEND_URL oder FRONTEND_URL).")
    try:
        url = platform_links.authorize_url(platform, branding, platform_links.make_state(me["id"], platform))
    except LinkError as exc:
        if exc.code == "not_configured":
            raise HTTPException(409, f"{PLATFORMS[platform]['label']} ist auf der Website noch nicht eingerichtet (Einstellungen → Twitch/Discord).")
        raise HTTPException(400, str(exc))
    return {"url": url}


@router.get("/platform-links/{platform}/callback")
async def platform_link_callback(platform: str, request: Request):
    """Rückruf der Plattform. Immer eine Weiterleitung ins Profil - nie eine nackte Fehlerseite."""
    if platform not in PLATFORMS:
        return RedirectResponse(platform_links.callback_target(error="unknown"), status_code=302)
    query = dict(request.query_params)
    db = get_db()
    try:
        user_id = platform_links.read_state(query.get("state"), platform)
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "is_active": 1})
        if not user or user.get("is_active") is False:
            raise LinkError("invalid", "Konto nicht gefunden")
        identity = await platform_links.fetch_identity(platform, await _branding(db), query)
        link = await platform_links.link_account(db, user_id, platform, identity)
    except LinkError as exc:
        # Im Log steht, woran es lag (Einrichtung, Plattform, Sitzung) - und die Person liest den Grund im Profil.
        logger.warning("[platform-links] %s: Rückruf fehlgeschlagen - %s (%s)", platform, exc.code, exc)
        detail = str(exc) if exc.code in ("platform_error", "exchange_failed") else None
        return RedirectResponse(platform_links.callback_target(error=exc.code, detail=detail), status_code=302)
    await _audit(db, user_id, "platform_link.linked", platform, {"handle": link.get("handle")})
    return RedirectResponse(platform_links.callback_target(linked=platform), status_code=302)


@router.post("/settings/platform-links/{platform}/check")
async def check_platform_link(platform: str, me: dict = Depends(require_club_admin())):
    """Für den Admin: passen Client ID, Secret und Rückrufadresse? Discord verrät seine Redirects über den Bot-Token."""
    platform = _platform(platform)
    db = get_db()
    if not platform_links.public_base_url():
        raise HTTPException(503, "Die öffentliche Adresse der Website ist nicht gesetzt (PUBLIC_BACKEND_URL oder FRONTEND_URL).")
    branding = await _branding(db)
    bot_token = None
    if platform == "discord":
        discord = await db.settings.find_one({"id": "discord"}, {"_id": 0, "bot_token": 1}) or {}
        if discord.get("bot_token"):
            from services.secret_store import decrypt_secret
            bot_token = decrypt_secret(discord["bot_token"])
    result = await platform_links.check_provider(platform, branding, bot_token=bot_token)
    await _audit(db, me["id"], "platform_link.checked", platform, {"ok": result["ok"], "states": [c["state"] for c in result["checks"]]})
    return result


@router.delete("/me/platform-links/{platform}")
async def unlink_platform(platform: str, me: dict = Depends(get_current_user)):
    platform = _platform(platform)
    db = get_db()
    removed = await platform_links.unlink(db, me["id"], platform)
    if removed:
        await _audit(db, me["id"], "platform_link.unlinked", platform)
    return {"ok": True, "removed": removed}
