"""Saisonfinale am TV (#1641) und Liga im Discord (#1642) - je Season in der Verwaltung.

- ``GET  /api/admin/leagues/seasons/{season_id}/tv-finale``: der Schritt „Auf- und Absteiger“ am TV - welche Liga N gerade dran ist,
  welche es gibt und warum der TV gegebenenfalls nichts zeigt. Jede Zuständigkeit der Liga.
- ``POST /api/admin/leagues/seasons/{season_id}/tv-finale``: ``{"action": "next"}`` (Weiter: nächste Liga N) oder ``"end"`` (Ende:
  zurück zum gewohnten Bild) - Zuständigkeit „Spiele betreuen“. Gilt für alle TVs der abgeschlossenen Staffeln der Season. Mit
  ``from_step`` (der Stand im Fenster der Leitung) gibt „Weiter“ 409, wenn ein anderes Fenster schon geschaltet hat.
- ``GET|PUT /api/admin/leagues/seasons/{season_id}/discord``: Spieltag-Zusammenfassung und Saisonende-Meldung an/aus, Kanal, Wartezeit
  und Tabellenausschnitt - lesen jede Zuständigkeit, ändern „Season konfigurieren“. Zur Wahl stehen nur die freigegebenen Kanäle
  (öffentliche „Kanäle je Zweck“ unter Verbindungen → Discord, Nr. 234); ein anderer Kanal gibt 422. Dazu die Hinweise zu Meldungen,
  deren Zustellung unklar ist oder die aufgegeben wurden.

Logik in ``services/league_finale.py`` und ``services/league_discord.py``.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from database import get_db
from models import new_id, now_utc
from services import league_discord, league_finale
from services.league_permissions import ANY, require_league

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])

require_any = require_league(ANY, via="season_id")
require_matches = require_league("matches", via="season_id")
require_season = require_league("season", via="season_id")


class FinaleBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["next", "end"]
    from_step: Optional[int] = None


class DigestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    matchday: Optional[bool] = None
    season_end: Optional[bool] = None
    channel_id: Optional[str] = None
    wait_hours: Optional[int] = None
    late: Optional[bool] = None
    table_rows: Optional[int] = None


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


@admin_router.get("/seasons/{season_id}/tv-finale")
async def get_tv_finale(season_id: str, _me: dict = Depends(require_any)):
    db = get_db()
    return await league_finale.control_state(db, await _season(db, season_id))


@admin_router.post("/seasons/{season_id}/tv-finale")
async def post_tv_finale(season_id: str, body: FinaleBody, me: dict = Depends(require_matches)):
    db = get_db()
    try:
        return await league_finale.control(db, await _season(db, season_id), body.action, me, body.from_step)
    except league_finale.FinaleConflict as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


async def _channels(allowed: dict[str, str]) -> dict:
    """Die freigegebenen Kanäle mit Zweck - Name und Schreibrecht aus der Kanalliste des Bots (offline: die zuletzt gesehene)."""
    from services.discord_runtime import bot

    try:
        listing = await bot.list_channels()
    except Exception:  # noqa: BLE001 - ohne Liste stehen die Kanäle mit ihrem Zweck da
        listing = {"ok": False, "channels": []}
    seen = {str(row.get("id")): row for row in listing.get("channels") or [] if str(row.get("id") or "").isdigit()}
    channels = [{"id": channel, "purpose": purpose, "name": (seen.get(channel) or {}).get("name") or "",
                 "category": (seen.get(channel) or {}).get("category") or "",
                 "can_send": (seen.get(channel) or {}).get("can_send", True) is not False}
                for channel, purpose in allowed.items()]
    return {"channels": channels, "channels_ok": bool(listing.get("ok")), "channels_text": listing.get("text") if not listing.get("ok") else None}


async def _digest_answer(db, season: dict, **extra) -> dict:
    stored = season.get(league_discord.FIELD)
    settings = league_discord.settings_of(season)
    settings.pop("matchday_since", None)
    from services.profile_visibility import public_season

    allowed = await league_discord.approved(db)
    return {"settings": settings, "active": isinstance(stored, dict), "defaults": dict(league_discord.DEFAULTS),
            "public": public_season(season), "channel_approved": not settings["channel_id"] or settings["channel_id"] in allowed,
            "problems": await league_discord.problems(db, season["id"]), **await _channels(allowed), **extra}


@admin_router.get("/seasons/{season_id}/discord")
async def get_discord_digest(season_id: str, _me: dict = Depends(require_any)):
    db = get_db()
    return await _digest_answer(db, await _season(db, season_id))


@admin_router.put("/seasons/{season_id}/discord")
async def put_discord_digest(season_id: str, body: DigestBody, me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    now = now_utc()
    before = season.get(league_discord.FIELD) if isinstance(season.get(league_discord.FIELD), dict) else None
    try:
        settings = league_discord.normalize(body.model_dump(exclude_unset=True), before, now, await league_discord.approved(db))
    except league_discord.DigestProblem as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None
    if settings != before:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {league_discord.FIELD: settings, "updated_at": now.isoformat()}})
        await db.audit_logs.insert_one({"id": new_id(), "action": "league.season.discord_digest", "target_id": season_id,
                                        "actor_id": me.get("id"), "data": {"from": before, "to": settings}, "created_at": now.isoformat()})
    season[league_discord.FIELD] = settings
    return await _digest_answer(db, season)
