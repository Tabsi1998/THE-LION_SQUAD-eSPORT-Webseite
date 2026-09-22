"""Dolibarr-Anbindung (#316, #295, #297, #330): Verwaltung, Zuordnungen, Webhook.

Wer was sieht:
- **System** (Club-Admin, Superadmin): Verbindung und API-Schlüssel. Der
  Schlüssel kommt nie zurück, nur „gespeichert“.
- **Vereinsverwaltung**: Stand des Abgleichs, Zuordnungen Konto ↔ Mitglied,
  Vorschau der Umstellung. Das sind Mitgliederdaten - die Redaktion und die
  Turnierleitung sehen nichts davon.
- **Superadmin**: die Freigabe „Funktion → Bereich“, weil sie Rechte vergibt.
- Die betroffene Person: den eigenen Stand unter `/api/membership/me`.
"""
from __future__ import annotations

import hmac
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user, require_area, require_super
from database import get_db
from models import new_id, now_utc
from services.dolibarr_client import (
    ENVIRONMENTS, MODES, SETTINGS_ID, DolibarrClient, DolibarrError, capabilities_for, clean_base_url, load_settings,
)
from services.dolibarr_links import OPEN_STATUSES, LinkConflict, close_link, link_for_user, note_candidate, verify_link
from services.dolibarr_policy import DERIVABLE_AREAS, areas_from_functions, clean_policy_map, policy_active
from services.dolibarr_sync import apply_summary, migration_preview, queue_member, run_sync, sync_state
from services.membership_service import VALID_TYPES
from services.rate_limit import enforce_rate_limit
from services.secret_store import decrypt_secret, encrypt_secret, secret_is_configured

admin_router = APIRouter(prefix="/api/admin/dolibarr", tags=["dolibarr-admin"])
public_router = APIRouter(prefix="/api/integrations/dolibarr", tags=["dolibarr"])
member_router = APIRouter(prefix="/api/membership/dolibarr", tags=["membership"])


async def _audit(actor_id: str | None, action: str, target_id: str, data: dict | None = None):
    await get_db().audit_logs.insert_one({
        "id": new_id(), "action": action, "actor_id": actor_id, "target_id": target_id,
        "data": data or {}, "created_at": now_utc().isoformat(),
    })


def _error(exc: DolibarrError) -> HTTPException:
    return HTTPException(502, f"Dolibarr: {exc.text}")


# ---------------------------------------------------------------- Stand (Vereinsverwaltung und System)

@admin_router.get("/status")
async def dolibarr_status(me: dict = Depends(require_area("club", "system"))):
    db = get_db()
    settings = await load_settings(db)
    state = await sync_state(db)
    links = {}
    async for row in db.dolibarr_links.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        links[row["_id"]] = row["n"]
    unmapped = await db.memberships.count_documents({"source": "dolibarr", "dolibarr.type_unmapped": True})
    policy = settings.get("function_policy") or {}
    return {
        "mode": settings["mode"],
        "environment": settings["environment"],
        "instance": settings.get("instance") or "",
        "entity": settings.get("entity") or 1,
        "base_url": settings.get("base_url") or "",
        "api_key_configured": secret_is_configured(settings.get("api_key")),
        "write_api_key_configured": secret_is_configured(settings.get("write_api_key")),
        "write_enabled": bool(settings.get("write_enabled")),
        "webhook_configured": secret_is_configured(settings.get("webhook_token")),
        "auto_link_verified_email": bool(settings.get("auto_link_verified_email")),
        "type_map": settings.get("type_map") or {},
        "website_types": sorted(VALID_TYPES),
        "sync": state,
        "links": links,
        "open_links": sum(links.get(status, 0) for status in OPEN_STATUSES),
        "members_led_by_dolibarr": await db.memberships.count_documents({"source": "dolibarr"}),
        "unmapped_types": unmapped,
        "policy": {
            "active": policy_active(settings), "version": policy.get("version"), "map": policy.get("map") or {},
            "approved_at": policy.get("approved_at"), "derivable_areas": list(DERIVABLE_AREAS),
        },
    }


# ---------------------------------------------------------------- Verbindung (System)

class DolibarrSettingsUpdate(BaseModel):
    mode: str | None = None
    environment: str | None = None
    base_url: str | None = Field(None, max_length=300)
    api_key: str | None = Field(None, max_length=300)
    # Schreibzugriff (#316): eigener Schlüssel eines Dolibarr-Benutzers mit Rechten auf Kunden
    # und Rechnungen - getrennt vom Lese-Schlüssel, getrennt einschaltbar.
    write_api_key: str | None = Field(None, max_length=300)
    write_enabled: bool | None = None
    instance: str | None = Field(None, max_length=60)
    entity: int | None = Field(None, ge=1, le=9999)
    auto_link_verified_email: bool | None = None
    type_map: dict[str, str] | None = None


@admin_router.put("/settings")
async def update_dolibarr_settings(body: DolibarrSettingsUpdate, me: dict = Depends(require_area("system"))):
    db = get_db()
    current = await load_settings(db)
    updates: dict = {}
    data = body.model_dump(exclude_unset=True)
    if "environment" in data:
        if data["environment"] not in ENVIRONMENTS:
            raise HTTPException(400, "Umgebung ist „test“ oder „production“.")
        updates["environment"] = data["environment"]
    environment = updates.get("environment", current["environment"])
    if "base_url" in data:
        try:
            updates["base_url"] = clean_base_url(data["base_url"], environment=environment) if data["base_url"] else ""
        except DolibarrError as exc:
            raise HTTPException(400, exc.text)
    elif "environment" in updates and current.get("base_url"):
        try:
            clean_base_url(current["base_url"], environment=environment)
        except DolibarrError:
            raise HTTPException(400, "Die gespeicherte Adresse ist für diese Umgebung nicht zulässig (https nötig).")
    if data.get("api_key"):
        updates["api_key"] = encrypt_secret(data["api_key"].strip())
    if data.get("write_api_key"):
        updates["write_api_key"] = encrypt_secret(data["write_api_key"].strip())
    if "write_enabled" in data:
        if data["write_enabled"] and not (data.get("write_api_key") or current.get("write_api_key")):
            raise HTTPException(400, "Schreibzugriff braucht einen eigenen API-Schlüssel.")
        updates["write_enabled"] = bool(data["write_enabled"])
    if "instance" in data:
        updates["instance"] = (data["instance"] or "").strip()
    if "entity" in data and data["entity"]:
        updates["entity"] = data["entity"]
    if "auto_link_verified_email" in data:
        updates["auto_link_verified_email"] = bool(data["auto_link_verified_email"])
    if "type_map" in data:
        cleaned = {}
        for type_id, target in (data["type_map"] or {}).items():
            if target and target not in VALID_TYPES:
                raise HTTPException(400, f"Unbekannte Mitgliedsart der Website: {target}")
            if target and str(type_id).strip().isdigit():
                cleaned[str(type_id).strip()] = target
        updates["type_map"] = cleaned
    if "mode" in data:
        if data["mode"] not in MODES:
            raise HTTPException(400, "Modus ist „off“, „preview“ oder „live“.")
        if data["mode"] == "live" and current["mode"] != "live":
            # Kein stilles Umschalten: erst ein gelungener Lauf in der Vorschau.
            state = await sync_state(db)
            if current["mode"] != "preview" or not state.get("ok"):
                raise HTTPException(409, "Erst „Vorschau“ einschalten und einen Abgleich ohne Fehler durchlaufen lassen, dann „Live“.")
        updates["mode"] = data["mode"]
    instance_changed = any(key in updates and updates[key] != current.get(key) for key in ("instance", "entity"))
    if instance_changed and await db.dolibarr_links.count_documents({"status": "verified"}):
        if updates.get("mode", current["mode"]) == "live":
            raise HTTPException(409, "Instanz oder Entity lassen sich im Live-Betrieb nicht ändern – Zuordnungen gelten je Installation.")
    if not updates:
        return {"ok": True, "changed": []}
    updates["updated_at"] = now_utc().isoformat()
    updates["updated_by"] = me["id"]
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, **updates}}, upsert=True)
    if instance_changed or "base_url" in updates:
        # Der Merker gehört zur alten Installation.
        await db.settings.update_one({"id": "dolibarr_sync_state"}, {"$unset": {"cursor": "", "last_full_at": ""}})
    changed = sorted(key for key in updates if key not in ("updated_at", "updated_by"))
    await _audit(me["id"], "dolibarr.settings", SETTINGS_ID, {"changed": changed, "mode": updates.get("mode")})
    return {"ok": True, "changed": changed}


@admin_router.delete("/settings/api-key")
async def clear_dolibarr_key(me: dict = Depends(require_area("system"))):
    db = get_db()
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"api_key": "", "mode": "off", "updated_at": now_utc().isoformat()}})
    await _audit(me["id"], "dolibarr.key_removed", SETTINGS_ID)
    return {"ok": True}


@admin_router.post("/test")
async def test_dolibarr_connection(me: dict = Depends(require_area("system"))):
    try:
        status = await (await DolibarrClient.from_db()).status()
    except DolibarrError as exc:
        return {"ok": False, "error": exc.kind, "text": exc.text, "status": exc.status}
    return {
        "ok": True, "module_version": status.get("module_version"), "api_version": status.get("api_version"),
        "server_time": status.get("server_time"), "capabilities": capabilities_for(status),
    }


@admin_router.post("/webhook-token")
async def new_webhook_token(me: dict = Depends(require_area("system"))):
    """Neues Token. Es wird genau einmal gezeigt - für die Ziel-URL im Dolibarr-Modul „Webhooks“."""
    token = secrets.token_urlsafe(32)
    await get_db().settings.update_one(
        {"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, "webhook_token": encrypt_secret(token)}}, upsert=True
    )
    await _audit(me["id"], "dolibarr.webhook_token", SETTINGS_ID)
    return {"ok": True, "path": f"/api/integrations/dolibarr/webhook/{token}"}


# ---------------------------------------------------------------- Abgleich und Vorschau (Vereinsverwaltung)

@admin_router.post("/sync")
async def sync_now(full: bool = False, me: dict = Depends(require_area("club", "system"))):
    result = await run_sync(get_db(), full=True if full else None)
    await _audit(me["id"], "dolibarr.sync", SETTINGS_ID, {"full": full, "ok": result.get("ok")})
    return result


@admin_router.get("/preview")
async def preview_migration(me: dict = Depends(require_area("club"))):
    settings = await load_settings()
    if settings["mode"] == "off":
        raise HTTPException(409, "Die Anbindung ist ausgeschaltet.")
    try:
        return await migration_preview(get_db())
    except DolibarrError as exc:
        raise _error(exc)


# ---------------------------------------------------------------- Zuordnungen (Vereinsverwaltung)

@admin_router.get("/links")
async def list_links(me: dict = Depends(require_area("club"))):
    db = get_db()
    links = await db.dolibarr_links.find({}, {"_id": 0, "history": 0}).sort("updated_at", -1).to_list(1000)
    users = {
        u["id"]: u async for u in db.users.find(
            {"id": {"$in": [link["user_id"] for link in links]}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}
        )
    }
    for link in links:
        user = users.get(link["user_id"]) or {}
        link["username"] = user.get("username")
        link["display_name"] = user.get("display_name")
    return links


class LinkConfirm(BaseModel):
    user_id: str
    member_id: int = Field(ge=1)


@admin_router.post("/links")
async def confirm_link(body: LinkConfirm, me: dict = Depends(require_area("club"))):
    """Geprüfte Zuordnung: Die Vereinsverwaltung bestätigt, dass dieses Konto dieses Mitglied ist."""
    db = get_db()
    settings = await load_settings(db)
    if settings["mode"] == "off":
        raise HTTPException(409, "Die Anbindung ist ausgeschaltet.")
    user = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(404, "Benutzer nicht gefunden.")
    try:
        summary = await DolibarrClient(settings).member_summary(body.member_id)
    except DolibarrError as exc:
        if exc.kind == "not_found":
            raise HTTPException(404, "Dieses Mitglied gibt es in Dolibarr nicht.")
        raise _error(exc)
    try:
        link = await verify_link(db, settings, user_id=body.user_id, member_id=body.member_id,
                                 member_ref=summary.get("ref"), source="admin", actor_id=me["id"])
    except LinkConflict as exc:
        raise HTTPException(409, str(exc))
    applied = None
    if settings["mode"] == "live":
        applied = await apply_summary(db, settings, link, summary)
    await _audit(me["id"], "dolibarr.link_verified", body.user_id, {"member_id": body.member_id, "applied": applied})
    link.pop("history", None)
    return link


@admin_router.delete("/links/{user_id}")
async def remove_link(user_id: str, me: dict = Depends(require_area("club"))):
    """Zuordnung lösen. Der zuletzt übernommene Stand bleibt stehen und wird wieder lokal gepflegt."""
    db = get_db()
    settings = await load_settings(db)
    link = await link_for_user(db, settings, user_id)
    if not link:
        raise HTTPException(404, "Keine Zuordnung.")
    await close_link(db, link, status="revoked", actor_id=me["id"], note="von der Vereinsverwaltung gelöst")
    from services.dolibarr_invoices import forget_cache
    await forget_cache(db, user_id)
    await db.memberships.update_one({"user_id": user_id, "source": "dolibarr"}, {"$set": {"source": "local", "dolibarr.functions": []}})
    await _audit(me["id"], "dolibarr.link_revoked", user_id, {"member_id": link.get("member_id")})
    return {"ok": True}


# ---------------------------------------------------------------- Funktion → Bereich (Superadmin)

class PolicyUpdate(BaseModel):
    map: dict[str, list[str]]
    confirm: bool = False


@admin_router.put("/function-policy")
async def update_function_policy(body: PolicyUpdate, me: dict = Depends(require_super())):
    """Ohne `confirm` nur die Vorschau: wer bekäme was. Mit `confirm` gilt die neue Fassung."""
    db = get_db()
    settings = await load_settings(db)
    cleaned = clean_policy_map(body.map)
    affected = []
    async for membership in db.memberships.find(
        {"source": "dolibarr", "member_status": {"$in": ["active", "honorary"]}, "dolibarr.functions.0": {"$exists": True}},
        {"_id": 0, "user_id": 1, "dolibarr.functions": 1},
    ):
        grants = areas_from_functions((membership.get("dolibarr") or {}).get("functions"), cleaned)
        if grants:
            affected.append({"user_id": membership["user_id"], "grants": grants})
    names = {
        u["id"]: u async for u in db.users.find({"id": {"$in": [row["user_id"] for row in affected]}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1})
    }
    for row in affected:
        row["username"] = (names.get(row["user_id"]) or {}).get("username")
        row["display_name"] = (names.get(row["user_id"]) or {}).get("display_name")
    if not body.confirm:
        return {"ok": True, "preview": True, "map": cleaned, "affected": affected}
    previous = settings.get("function_policy") or {}
    policy = {
        "version": int(previous.get("version") or 0) + 1, "map": cleaned,
        "approved_at": now_utc().isoformat() if cleaned else None, "approved_by": me["id"],
    }
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, "function_policy": policy}}, upsert=True)
    await _audit(me["id"], "dolibarr.function_policy", SETTINGS_ID, {
        "version": policy["version"], "map": cleaned, "previous": previous.get("map") or {}, "affected": [row["user_id"] for row in affected],
    })
    return {"ok": True, "preview": False, "policy": policy, "affected": affected}


# ---------------------------------------------------------------- Webhook (öffentlich, mit Token)

@public_router.post("/webhook/{token}", status_code=202)
async def dolibarr_webhook(token: str, request: Request):
    """Dolibarr signiert nichts; das Token in der Adresse ist der Ausweis. Das Ereignis trägt keinen
    Stand - es ist nur der Anlass, die Zusammenfassung in ein paar Sekunden neu zu lesen."""
    await enforce_rate_limit(request, "dolibarr:webhook", limit=120, window_seconds=60)
    db = get_db()
    settings = await load_settings(db)
    try:
        expected = decrypt_secret(settings.get("webhook_token"))
    except RuntimeError:
        expected = ""
    if not expected or not hmac.compare_digest(expected.encode(), token.encode()):
        raise HTTPException(404, "Not found")
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Kein JSON.")
    obj = payload.get("object") if isinstance(payload, dict) else None
    member_id = (obj or {}).get("member_id") if isinstance(obj, dict) else None
    if payload.get("triggercode") != "VEREINE_MEMBER_CHANGED" or not isinstance(member_id, int) or member_id < 1:
        raise HTTPException(400, "Unbekanntes Ereignis.")
    if settings["mode"] == "live":
        await queue_member(db, settings, member_id)
    return {"accepted": True}


# ---------------------------------------------------------------- Die betroffene Person

class LinkRequest(BaseModel):
    member_ref: str | None = Field(None, max_length=40)


@member_router.post("/link-request")
async def request_link(body: LinkRequest, request: Request, user: dict = Depends(get_current_user)):
    """„Ich bin Mitglied“: Die Vereinsverwaltung prüft und bestätigt. Eine Mitgliedsnummer beweist nichts."""
    await enforce_rate_limit(request, "dolibarr:link-request", limit=5, window_seconds=3600)
    db = get_db()
    settings = await load_settings(db)
    if settings["mode"] == "off":
        raise HTTPException(409, "Die Mitgliederverwaltung ist noch nicht angebunden.")
    existing = await link_for_user(db, settings, user["id"])
    if existing and existing.get("status") == "verified":
        return {"status": "verified"}
    ref = (body.member_ref or "").strip() or None
    link = await note_candidate(db, settings, user_id=user["id"], member_id=None, member_ref=ref,
                                source="user_request", status="requested", note="vom Mitglied angefragt")
    return {"status": link["status"]}
