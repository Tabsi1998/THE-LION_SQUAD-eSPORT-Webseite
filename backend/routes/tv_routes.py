"""TV & Beamer (#1110): Grundwerte für alle Bildschirme und die Anzeige-Schlüssel des Turnierbaum-TVs.

Lesen der Grundwerte geht ohne Anmeldung (die TV-Seiten laufen ohne); speichern, Schlüssel anlegen und widerrufen
dürfen nur Admins mit dem Bereich Turniere. Jede Änderung unter /api/tv meldet der Änderungsstrom öffentlich als
„tv“ - so übernehmen die Bildschirme neue Grundwerte ohne Neuladen, und ein widerrufener Schlüssel wirkt sofort.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from auth import require_admin
from database import get_db
from models import new_id, now_utc
from services.access_links import hash_access_token, new_access_token
from services.tv_display import DISPLAY_GRANT, SETTINGS_ID, display_path, key_label, public_payload

router = APIRouter(prefix="/api/tv", tags=["tv"])


class TvSettingsUpdate(BaseModel):
    """Nur bekannte Werte in der erlaubten Form; ``null`` setzt einen Wert auf den Standard zurück."""
    model_config = ConfigDict(extra="forbid")

    text_size: Literal["normal", "large"] | None = None
    contrast: StrictBool | None = None
    safe_area: Literal[0, 3, 5] | None = None
    pixel_shift: StrictBool | None = None
    season_header: StrictBool | None = None
    reduce_motion: StrictBool | None = None


class TvKeyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tournament_id: str = Field(min_length=1, max_length=120)
    label: str = Field(default="", max_length=200)


async def _stored(db) -> dict:
    return await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}


async def _audit(db, action: str, target_id: str, actor_id: str | None, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "target_id": target_id,
        "actor_id": actor_id,
        "data": data,
        "created_at": now_utc().isoformat(),
    })


@router.get("/settings")
async def get_tv_settings():
    """Die Grundwerte für alle Bildschirme - ohne Anmeldung, nichts Geheimes darin."""
    return public_payload(await _stored(get_db()))


@router.put("/settings")
async def update_tv_settings(body: TvSettingsUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    data = body.model_dump(exclude_unset=True)
    to_set = {key: value for key, value in data.items() if value is not None}
    to_unset = {key: "" for key, value in data.items() if value is None}
    if to_set or to_unset:
        update: dict = {"$set": {**to_set, "updated_at": now_utc().isoformat(), "updated_by": me.get("id")},
                        "$setOnInsert": {"id": SETTINGS_ID}}
        if to_unset:
            update["$unset"] = to_unset
        await db.settings.update_one({"id": SETTINGS_ID}, update, upsert=True)
        await _audit(db, "settings.tv.update", SETTINGS_ID, me.get("id"), {"changed_fields": sorted(data)})
    return public_payload(await _stored(db))


@router.delete("/settings")
async def reset_tv_settings(me: dict = Depends(require_admin())):
    """Alles auf den Standard - die gespeicherten Werte fallen weg."""
    db = get_db()
    await db.settings.delete_one({"id": SETTINGS_ID})
    await _audit(db, "settings.tv.reset", SETTINGS_ID, me.get("id"), {})
    return public_payload({})


def _key_payload(link: dict, tournaments: dict) -> dict:
    tournament = tournaments.get(link.get("target_id")) or {}
    return {
        "id": link.get("id"),
        "label": link.get("note") or "Bildschirm",
        "tournament_id": link.get("target_id"),
        "tournament_title": tournament.get("title") or "Turnier",
        "tournament_slug": tournament.get("slug"),
        "created_at": link.get("created_at"),
        "created_by": link.get("created_by"),
        "last_used_at": link.get("last_used_at"),
        "is_active": link.get("is_active") is not False,
    }


async def _tournaments_by_id(db, ids: list[str]) -> dict:
    rows = await db.tournaments.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1}).to_list(len(ids) or 1)
    return {row["id"]: row for row in rows}


@router.get("/keys")
async def list_tv_keys(tournament_id: str | None = None, me: dict = Depends(require_admin())):
    """Die aktiven Anzeige-Schlüssel - Name des Bildschirms, Turnier, zuletzt gesehen. Nie der Schlüssel selbst."""
    db = get_db()
    query: dict = {"grants": DISPLAY_GRANT, "target_type": "tournament", "is_active": {"$ne": False}}
    if tournament_id:
        query["target_id"] = tournament_id
    rows = await db.access_links.find(query, {"_id": 0, "token_hash": 0}).sort("created_at", -1).to_list(200)
    tournaments = await _tournaments_by_id(db, sorted({row.get("target_id") for row in rows if row.get("target_id")}))
    return [_key_payload(row, tournaments) for row in rows]


@router.post("/keys")
async def create_tv_key(body: TvKeyCreate, me: dict = Depends(require_admin())):
    """Ein neuer Schlüssel für einen Bildschirm. Den Schlüssel gibt es nur in dieser Antwort - gespeichert wird der Hash."""
    db = get_db()
    tournament = await db.tournaments.find_one({"id": body.tournament_id}, {"_id": 0, "id": 1, "title": 1, "slug": 1})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    token = new_access_token()
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "target_type": "tournament",
        "target_id": tournament["id"],
        "grants": [DISPLAY_GRANT],
        "token_hash": hash_access_token(token),
        "expires_at": None,
        "max_uses": None,
        "use_count": 0,
        "user_id": None,
        "email": None,
        "note": key_label(body.label),
        "is_active": True,
        "created_by": me.get("id"),
        "created_at": now,
        "updated_at": now,
    }
    await db.access_links.insert_one(dict(doc))
    await _audit(db, "tv_key.create", tournament["id"], me.get("id"), {"access_link_id": doc["id"], "label": doc["note"]})
    return {**_key_payload(doc, {tournament["id"]: tournament}), "token": token, "path": display_path(tournament["id"], token)}


@router.delete("/keys/{key_id}")
async def revoke_tv_key(key_id: str, me: dict = Depends(require_admin())):
    """Widerrufen: der Bildschirm mit diesem Link zeigt ab sofort nichts mehr."""
    db = get_db()
    existing = await db.access_links.find_one({"id": key_id, "grants": DISPLAY_GRANT}, {"_id": 0, "id": 1, "target_id": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="TV-Link nicht gefunden")
    now = now_utc().isoformat()
    await db.access_links.update_one(
        {"id": key_id},
        {"$set": {"is_active": False, "revoked_at": now, "revoked_by": me.get("id"), "updated_at": now}},
    )
    await _audit(db, "tv_key.revoke", existing.get("target_id"), me.get("id"), {"access_link_id": key_id})
    return {"ok": True}
