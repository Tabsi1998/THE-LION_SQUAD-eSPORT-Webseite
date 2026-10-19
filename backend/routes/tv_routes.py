"""TV & Beamer (#1110): Grundwerte für alle Bildschirme und die Anzeige-Schlüssel des Turnierbaum-TVs und - für Hallen-
und Aufruf-Tafel (#1822) - der Events.

Lesen der Grundwerte geht ohne Anmeldung (die TV-Seiten laufen ohne); speichern, Schlüssel anlegen und widerrufen
dürfen nur Admins mit dem Bereich Turniere. Jede Änderung unter /api/tv meldet der Änderungsstrom öffentlich als
„tv“ - so übernehmen die Bildschirme neue Grundwerte ohne Neuladen, und ein widerrufener Schlüssel wirkt sofort.
"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator

from auth import require_admin
from database import get_db
from models import new_id, now_utc
from services.access_links import hash_access_token, new_access_token
from services.tv_display import (
    DISPLAY_GRANT,
    SETTINGS_ID,
    display_event_path,
    display_path,
    key_expires_at,
    key_label,
    public_payload,
)

router = APIRouter(prefix="/api/tv", tags=["tv"])


class PlaylistEntry(BaseModel):
    """Eine Folie der Wiedergabeliste (#1121): welche und wie viele Sekunden (3 bis 120)."""
    model_config = ConfigDict(extra="forbid")

    slide: Literal["tree", "live", "calls", "sponsor", "stats"]
    seconds: Annotated[StrictInt, Field(ge=3, le=120)]


class TvSettingsUpdate(BaseModel):
    """Nur bekannte Werte in der erlaubten Form; ``null`` setzt einen Wert auf den Standard zurück."""
    model_config = ConfigDict(extra="forbid")

    text_size: Literal["normal", "large"] | None = None
    contrast: StrictBool | None = None
    safe_area: Literal[0, 3, 5] | None = None
    pixel_shift: StrictBool | None = None
    season_header: StrictBool | None = None
    reduce_motion: StrictBool | None = None
    result_sound: StrictBool | None = None
    # Meilenstein 60 (#1121-#1127) - Grenzen wie in services/tv_display.py.
    playlist: Annotated[list[PlaylistEntry], Field(min_length=1, max_length=5)] | None = None
    call_sound: StrictBool | None = None
    report_minutes: Annotated[StrictInt, Field(ge=1, le=30)] | None = None
    stats: StrictBool | None = None
    stats_every: Annotated[StrictInt, Field(ge=1, le=60)] | None = None
    sponsor_moment: StrictBool | None = None
    sponsor_every: Annotated[StrictInt, Field(ge=1, le=60)] | None = None
    sponsor_presented: StrictBool | None = None
    sponsor_ticker: StrictBool | None = None
    track_seconds: Annotated[StrictInt, Field(ge=20, le=120)] | None = None

    @field_validator("playlist")
    @classmethod
    def _each_slide_once(cls, value):
        if value is not None and len({entry.slide for entry in value}) != len(value):
            raise ValueError("Jede Folie darf in der Wiedergabeliste nur einmal vorkommen.")
        return value


class TvKeyCreate(BaseModel):
    """Ein Schlüssel gehört zu genau einem Turnier (Turnierbaum, Stationen) oder genau einem Event (Hallen- und
    Aufruf-Tafel, #1822) - beides oder keins ist ein Fehler."""
    model_config = ConfigDict(extra="forbid")

    tournament_id: str | None = Field(default=None, min_length=1, max_length=120)
    event_id: str | None = Field(default=None, min_length=1, max_length=120)
    label: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def _exactly_one_target(self):
        if (self.tournament_id is None) == (self.event_id is None):
            raise ValueError("Ein TV-Link gehört zu genau einem Turnier oder genau einem Event.")
        return self


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


def _key_payload(link: dict, targets: dict) -> dict:
    """Eine Zeile der Liste. ``targets``: Turniere und Events nach Kennung (die Kennungen sind eindeutig)."""
    is_event = link.get("target_type") == "event"
    target = targets.get(link.get("target_id")) or {}
    title = (target.get("name") if is_event else target.get("title")) or ("Event" if is_event else "Turnier")
    until = key_expires_at(target)
    return {
        "id": link.get("id"),
        "label": link.get("note") or "Bildschirm",
        # Wofür der Schlüssel gilt (#1822): ein Turnier (Turnierbaum, Stationen) oder ein Event (Hallen- und Aufruf-Tafel).
        "target_type": "event" if is_event else "tournament",
        "target_title": title,
        "tournament_id": None if is_event else link.get("target_id"),
        "tournament_title": None if is_event else title,
        "tournament_slug": None if is_event else target.get("slug"),
        "event_id": link.get("target_id") if is_event else None,
        "event_slug": target.get("slug") if is_event else None,
        "created_at": link.get("created_at"),
        "created_by": link.get("created_by"),
        "last_used_at": link.get("last_used_at"),
        "is_active": link.get("is_active") is not False,
        # Eine Woche nach dem Turnier bzw. Event endet der Schlüssel von selbst (aus dessen Daten gerechnet, nicht gespeichert).
        "expires_at": until.isoformat() if until else None,
        "expired": bool(until and now_utc() > until),
    }


TARGET_FIELDS = {"_id": 0, "id": 1, "title": 1, "name": 1, "slug": 1, "start_date": 1, "end_date": 1}


async def _targets_by_id(db, rows: list[dict]) -> dict:
    """Die Turniere und Events der Schlüssel - je Art eine Abfrage."""
    wanted = {"tournament": set(), "event": set()}
    for row in rows:
        if row.get("target_id") and row.get("target_type") in wanted:
            wanted[row["target_type"]].add(row["target_id"])
    found: dict = {}
    for kind, collection in (("tournament", db.tournaments), ("event", db.events)):
        ids = sorted(wanted[kind])
        if ids:
            found.update({doc["id"]: doc for doc in await collection.find({"id": {"$in": ids}}, TARGET_FIELDS).to_list(len(ids))})
    return found


@router.get("/keys")
async def list_tv_keys(tournament_id: str | None = None, event_id: str | None = None, me: dict = Depends(require_admin())):
    """Die aktiven Anzeige-Schlüssel - Name des Bildschirms, Turnier oder Event, zuletzt gesehen. Nie der Schlüssel selbst."""
    db = get_db()
    query: dict = {"grants": DISPLAY_GRANT, "target_type": {"$in": ["tournament", "event"]}, "is_active": {"$ne": False}}
    if tournament_id:
        query.update({"target_type": "tournament", "target_id": tournament_id})
    elif event_id:
        query.update({"target_type": "event", "target_id": event_id})
    rows = await db.access_links.find(query, {"_id": 0, "token_hash": 0}).sort("created_at", -1).to_list(200)
    targets = await _targets_by_id(db, rows)
    return [_key_payload(row, targets) for row in rows]


@router.post("/keys")
async def create_tv_key(body: TvKeyCreate, me: dict = Depends(require_admin())):
    """Ein neuer Schlüssel für einen Bildschirm. Den Schlüssel gibt es nur in dieser Antwort - gespeichert wird der Hash."""
    db = get_db()
    if body.event_id:
        target_type = "event"
        target = await db.events.find_one({"id": body.event_id}, TARGET_FIELDS)
        if not target:
            raise HTTPException(status_code=404, detail="Event nicht gefunden")
    else:
        target_type = "tournament"
        target = await db.tournaments.find_one({"id": body.tournament_id}, TARGET_FIELDS)
        if not target:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    token = new_access_token()
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "target_type": target_type,
        "target_id": target["id"],
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
    await _audit(db, "tv_key.create", target["id"], me.get("id"),
                 {"access_link_id": doc["id"], "label": doc["note"], "target_type": target_type})
    path = display_event_path(target["id"], token) if target_type == "event" else display_path(target["id"], token)
    return {**_key_payload(doc, {target["id"]: target}), "token": token, "path": path}


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
