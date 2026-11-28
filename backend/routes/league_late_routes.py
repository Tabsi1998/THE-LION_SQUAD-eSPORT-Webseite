"""Nachmeldung nach dem Season-Start in der Verwaltung (docs/LIGA.md, B.4 „Nachmeldung nach dem Season-Start“, #2422).

- ``POST /api/admin/leagues/seasons/{sid}/application-extension`` ``{until, reason}``: Nachmeldung mit Grund verlängern bzw. die
  Verlängerung zurücknehmen (``until`` leer) - ``season``. Protokoll ``league.season.late_extension``.
- ``GET /api/admin/leagues/seasons/{sid}/late-entries``: die Nachmeldungen aller Staffeln - ``applications``.
- ``GET /api/admin/leagues/staffeln/{tid}/late-entries/{rid}``: Vorschau der Spiele - ``applications``.
- ``POST /api/admin/leagues/staffeln/{tid}/late-entries/{rid}`` ``{fingerprint, conflict_reason?}``: Spiele aus der Vorschau anlegen -
  ``applications``, nicht befangen (Nr. 187), unter Turnier- und Season-Sperre. Protokoll ``league.staffel.late_entry``.

Logik in ``services/league_late.py`` (Frist) und ``services/league_late_entry.py`` (Spiele).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from models import new_id, now_utc
from services import league_late, league_late_entry
from services import league_service as leagues
from services.change_events import publish_api_change
from services.league_permissions import require_league
from services.league_scope import ONLY_LEAGUE
from services.league_service import LeagueProblem
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])

BUSY = "An dieser Season wird gerade etwas geändert. Bitte gleich noch einmal versuchen."


class ExtensionBody(BaseModel):
    until: datetime | None = None
    reason: str = Field(default="", max_length=league_late.REASON_MAX)


class LateEntryBody(BaseModel):
    fingerprint: str = Field(default="", max_length=64)
    # Notausnahme des Superadmins beim eigenen Team (Nr. 187).
    conflict_reason: str | None = Field(default=None, max_length=500)


@admin_router.post("/seasons/{season_id}/application-extension")
async def admin_extend_late_registration(season_id: str, body: ExtensionBody,
                                         me: dict = Depends(require_league("season", via="season_id"))):
    db = get_db()
    try:
        async with mutation_lock(db, league_season_resource(season_id)):
            try:
                season = await leagues.get_season(db, season_id)
                # Abgesagt (#2607): Die Anmeldung bleibt zu.
                leagues.cancelled_problem(season)
            except LeagueProblem as problem:
                raise HTTPException(status_code=problem.status, detail=problem.message) from None
            before = season.get(league_late.EXTENSION)
            try:
                value, reason = league_late.clean_extension(season, body.until, body.reason, now_utc())
            except ValueError as problem:
                raise HTTPException(status_code=422, detail=str(problem.args[0])) from None
            now = now_utc().isoformat()
            change = {"$set": {league_late.EXTENSION: value, "updated_at": now}} if value else \
                {"$set": {"updated_at": now}, "$unset": {league_late.EXTENSION: ""}}
            await db.league_seasons.update_one({"id": season_id}, change)
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.season.late_extension", "actor_id": me.get("id"), "target_id": season_id,
        "data": {"season_id": season_id, "before": (before or {}).get("until"), "after": (value or {}).get("until"), "reason": reason},
        "created_at": now})
    season = await leagues.get_season(db, season_id)
    await publish_api_change("PATCH", f"/api/admin/leagues/seasons/{season_id}", 200)
    return {"season": season, "late_registration": league_late.view(season)}


@admin_router.get("/seasons/{season_id}/late-entries")
async def admin_season_late_entries(season_id: str, _me: dict = Depends(require_league("applications", via="season_id"))):
    db = get_db()
    if not await db.league_seasons.find_one({"id": season_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return {"items": await league_late_entry.season_items(db, season_id)}


@admin_router.get("/staffeln/{tournament_id}/late-entries/{registration_id}")
async def admin_late_entry_preview(tournament_id: str, registration_id: str,
                                   me: dict = Depends(require_league("applications", via="tournament_id"))):
    db = get_db()
    tournament = await db.tournaments.find_one({"id": tournament_id, **ONLY_LEAGUE}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Staffel nicht gefunden.")
    try:
        out = await league_late_entry.preview(db, tournament, registration_id)
    except league_late_entry.LateEntryProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    registration = await db.tournament_registrations.find_one({"id": registration_id}, {"_id": 0})
    # Befangenheit (Nr. 187): Die Vorschau sagt es vorab, damit die Verwaltung den Knopf bzw. das Feld für die Notausnahme zeigt.
    return {**out, **await league_late_entry.conflict_view(db, me, registration)}


@admin_router.post("/staffeln/{tournament_id}/late-entries/{registration_id}")
async def admin_late_entry_apply(tournament_id: str, registration_id: str, body: LateEntryBody,
                                 me: dict = Depends(require_league("applications", via="tournament_id"))):
    db = get_db()
    try:
        result = await league_late_entry.apply(db, tournament_id, registration_id, body.fingerprint, me, body.conflict_reason)
    except league_late_entry.LateEntryProblem as problem:
        raise HTTPException(status_code=problem.status, detail=problem.message) from None
    await publish_api_change("POST", f"/api/tournaments/{tournament_id}/matches-v2", 200)
    await publish_api_change("PUT", f"/api/tournaments/{tournament_id}/standings", 200)
    return result
