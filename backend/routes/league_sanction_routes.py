"""Strafen im Wettbewerb in der Verwaltung (E.3, docs/LIGA.md „E.3 Strafen“).

- ``GET  /api/admin/leagues/seasons/{season_id}/sanctions``: Strafen der Season, Arten, Katalog und die Auswahl der Co-Teams.
- ``GET  /api/admin/leagues/seasons/{season_id}/sanctions/proofs?match_id=``: die Nachweise eines Spiels zur Auswahl - nur, was
  die Person am Spiel sehen darf.
- ``POST /api/admin/leagues/seasons/{season_id}/sanctions``: verhängen.
- ``POST …/sanctions/{sanction_id}/confirm``: vorläufige Sperre bestätigen (mit Zeitraum).
- ``POST …/sanctions/{sanction_id}/revoke``: widerrufen, mit Grund - nimmt jede Wirkung zurück.
- ``POST …/sanctions/{sanction_id}/appeal/decision``: über den Einspruch entscheiden - nie die Person der Ausgangsentscheidung.

Alles mit der Zuständigkeit „Strafen“ der Liga. Über die eigene Seite entscheidet eine zweite Person (Befangenheit, B.1). Den
Einspruch legen Betroffene über ``POST /api/penalties/sanctions/{id}/appeal`` ein (``routes/penalty_routes.py``). Logik in
``services/league_sanctions.py``.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from database import get_db
from services import league_permissions
from services import league_sanctions as sanctions
from services.league_permissions import require_league
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])

require_sanctions = require_league("sanctions", via="season_id")
BUSY = "Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen."


class SanctionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(max_length=40)
    target_type: Literal["player", "squad"]
    user_id: Optional[str] = Field(default=None, max_length=80)
    registration_id: Optional[str] = Field(default=None, max_length=80)
    match_id: Optional[str] = Field(default=None, max_length=80)
    rule_ref: str = Field(max_length=sanctions.RULE_REF_MAX + 50)
    catalog_key: Optional[str] = Field(default=None, max_length=60)
    reason: str = Field(max_length=sanctions.REASON_MAX + 50)
    proof_ids: list[str] = Field(default_factory=list, max_length=sanctions.PROOFS_MAX)
    points: Optional[int] = None
    starts_at: Optional[str] = Field(default=None, max_length=40)
    ends_at: Optional[str] = Field(default=None, max_length=40)
    matches: Optional[int] = None
    state: Literal["provisional", "final"] = "final"
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class ConfirmBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ends_at: Optional[str] = Field(default=None, max_length=40)
    matches: Optional[int] = None
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class RevokeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(max_length=sanctions.REASON_MAX + 50)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class AppealDecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["upheld", "granted"]
    note: str = Field(max_length=sanctions.REASON_MAX + 50)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


def _refuse(problem: sanctions.SanctionProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


async def _sanction(db, season: dict, sanction_id: str) -> dict:
    """Die Strafe dieser Season - oder eine liga-weite Sperre derselben Liga (sie steht in jeder Season der Liga in der Liste)."""
    doc = await db.competition_sanctions.find_one({"id": sanction_id, "league_id": season.get("league_id")}, {"_id": 0})
    if not doc or (doc.get("season_id") != season["id"] and not sanctions.KINDS[doc["kind"]].get("league_wide")):
        raise HTTPException(status_code=404, detail=sanctions.NOT_FOUND)
    return doc


async def _no_conflict(db, me: dict, doc: dict, match: dict | None, conflict_reason: str | None) -> str | None:
    """Befangenheit (B.1): die betroffene Seite und, wenn die Strafe ein Spiel nennt, das Spiel. Liefert den Grund der Notausnahme."""
    override = await league_permissions.require_no_side_conflict(db, me, sanctions.side_of(doc), conflict_reason=conflict_reason)
    if match:
        conflict = await league_permissions.conflict_of_interest(db, me, match)
        override = league_permissions.override_reason(conflict, conflict_reason) or override
    return override


async def _match_of(db, doc: dict) -> dict | None:
    return await db.matches_v2.find_one({"id": doc["match_id"]}, {"_id": 0}) if doc.get("match_id") else None


async def _record_override(db, me: dict, doc: dict, reason: str | None, action: str) -> None:
    if reason:
        await league_permissions.record_override(db, me, action=action, target_id=doc.get("tournament_id") or doc.get("season_id"),
                                                 reason=reason, sanction_id=doc["id"])


@asynccontextmanager
async def _staffel_write(db, doc: dict, *, changes: bool = True):
    """Strafen, die in die Staffel schreiben (Punktabzug, Disqualifikation), laufen unter ihrer Schreibsperre; eine gesperrte
    Staffel lehnt ab (423). ``changes=False``: Dieser Schritt ändert an der Staffel nichts („Strafe bleibt“) - keine Sperre."""
    from routes.tournament_common import _ensure_tournament_unlocked

    if not changes or not sanctions.KINDS[doc["kind"]].get("staffel") or not doc.get("tournament_id"):
        yield None
        return
    try:
        async with mutation_lock(db, tournament_write_resource(doc["tournament_id"])):
            yield await _ensure_tournament_unlocked(db, doc["tournament_id"])
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None


async def _one(db, doc: dict, me: dict) -> dict:
    return (await sanctions.admin_rows(db, [doc], me))[0]


@admin_router.get("/seasons/{season_id}/sanctions")
async def list_sanctions(season_id: str, me: dict = Depends(require_sanctions)):
    db = get_db()
    return await sanctions.overview(db, await _season(db, season_id), me)


@admin_router.get("/seasons/{season_id}/sanctions/proofs")
async def list_match_proofs(season_id: str, match_id: str = Query(max_length=80), me: dict = Depends(require_sanctions)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        match = await sanctions.check_match(db, season, match_id, None, required=True)
    except sanctions.SanctionProblem as problem:
        raise _refuse(problem) from None
    return {"items": await sanctions.visible_proofs(db, match, me)}


@admin_router.post("/seasons/{season_id}/sanctions")
async def create_sanction(season_id: str, body: SanctionBody, me: dict = Depends(require_sanctions)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        doc, registration, _tournament, match = await sanctions.build(db, season, body.model_dump(), me)
        override = await _no_conflict(db, me, doc, match, body.conflict_reason)
        doc["conflict_reason"] = override
        await sanctions.require_visible_proofs(db, doc, match, me)
        async with _staffel_write(db, doc) as locked:
            if locked is not None:
                # Unter der Sperre neu lesen: Anmeldung und Staffel können sich seit der Prüfung geändert haben.
                registration = await db.tournament_registrations.find_one({"id": doc["registration_id"]}, {"_id": 0})
                if doc["kind"] == "disqualification" and (registration or {}).get("status") not in sanctions.ACTIVE_REGISTRATION:
                    raise sanctions.SanctionProblem("Dieses Co-Team ist nicht mehr im Wettbewerb.", 409)
            doc = await sanctions.create(db, doc, registration, locked or _tournament, me)
    except sanctions.SanctionProblem as problem:
        raise _refuse(problem) from None
    await _record_override(db, me, doc, override, "sanction")
    await sanctions.notify(db, doc, "issued", actor_id=me.get("id"))
    return await _one(db, doc, me)


@admin_router.post("/seasons/{season_id}/sanctions/{sanction_id}/confirm")
async def confirm_sanction(season_id: str, sanction_id: str, body: ConfirmBody, me: dict = Depends(require_sanctions)):
    db = get_db()
    doc = await _sanction(db, await _season(db, season_id), sanction_id)
    override = await _no_conflict(db, me, doc, await _match_of(db, doc), body.conflict_reason)
    try:
        doc = await sanctions.confirm(db, doc, body.model_dump(), me)
    except sanctions.SanctionProblem as problem:
        raise _refuse(problem) from None
    await _record_override(db, me, doc, override, "sanction_confirm")
    await sanctions.notify(db, doc, "confirmed", actor_id=me.get("id"))
    return await _one(db, doc, me)


@admin_router.post("/seasons/{season_id}/sanctions/{sanction_id}/revoke")
async def revoke_sanction(season_id: str, sanction_id: str, body: RevokeBody, me: dict = Depends(require_sanctions)):
    db = get_db()
    doc = await _sanction(db, await _season(db, season_id), sanction_id)
    override = await _no_conflict(db, me, doc, await _match_of(db, doc), body.conflict_reason)
    try:
        async with _staffel_write(db, doc):
            doc = await sanctions.revoke(db, doc, body.reason, me.get("id"))
    except sanctions.SanctionProblem as problem:
        raise _refuse(problem) from None
    await _record_override(db, me, doc, override, "sanction_revoke")
    await sanctions.notify(db, doc, "revoked", actor_id=me.get("id"))
    return await _one(db, doc, me)


@admin_router.post("/seasons/{season_id}/sanctions/{sanction_id}/appeal/decision")
async def decide_sanction_appeal(season_id: str, sanction_id: str, body: AppealDecisionBody, me: dict = Depends(require_sanctions)):
    db = get_db()
    doc = await _sanction(db, await _season(db, season_id), sanction_id)
    # Nr. 41: nie die Person der Ausgangsentscheidung - auch nicht der Superadmin.
    if sanctions.own_decision(doc, me):
        raise HTTPException(status_code=403, detail=league_permissions.OWN_DECISION_DETAIL)
    override = await _no_conflict(db, me, doc, await _match_of(db, doc), body.conflict_reason)
    try:
        async with _staffel_write(db, doc, changes=body.decision == "granted"):
            doc = await sanctions.decide_appeal(db, doc, me, body.decision, body.note)
    except sanctions.SanctionProblem as problem:
        raise _refuse(problem) from None
    await _record_override(db, me, doc, override, "sanction_appeal")
    await sanctions.notify(db, doc, "appeal_decided", actor_id=me.get("id"))
    return await _one(db, doc, me)
