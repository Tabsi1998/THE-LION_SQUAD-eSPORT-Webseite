"""Beanstandung, Protest, Einspruch und MOSS-Datei in der Liga (docs/LIGA.md, „D.5/E.2-Vertrag“, #1619, #2297).

- ``GET|PUT /api/admin/leagues/seasons/{season_id}/protest-settings``: Fristen, Gründe zum Antippen und die Wirkung auf die Tabelle je
  Season (Zuständigkeit „Season konfigurieren“, lesen jede Zuständigkeit). Das Speichern gilt sofort für alle nicht gesperrten Staffeln.
- ``GET /api/admin/leagues/seasons/{season_id}/procedures``: der Eingang der Leitung mit „Proteste“.
- ``POST /api/matches/{match_id}/appeals``: Einspruch einlegen. Eingereicht werden Beanstandung und Protest weiter über
  ``POST /api/matches/{match_id}/dispute`` (derselbe Endpunkt wie bei Turnieren).
- ``/api/matches/{match_id}/procedures/{procedure_id}``: ergänzen (``PATCH``), ``/withdraw``, ``/statement``, ``/statement/extend``,
  ``/assign``, ``/decision``, ``/moss-requests`` und ``/moss-requests/{request_id}/excuse``.
- ``GET /api/matches/{match_id}/proofs/{proof_id}/file``: die MOSS-ZIP als Download - nur für wer sie sehen darf, sonst 404.

Nur Spiele einer Liga-Staffel; bei jedem anderen Spiel und für Unbeteiligte antworten die Endpunkte mit 404. Die Logik steht in
``services/league_procedures.py``.
"""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from models import REGISTRATION_LIMIT, new_id, now_utc
from routes.match_routes import _find_match_any, _serialized_match_write
from services import league_final_read
from services import league_procedures as procedures
from services import league_protest_settings as protest_settings
from services import match_proofs
from services.league_permissions import ANY, involved_match_ids, require_league, require_no_conflict
from services.tournament_permissions import has_match_result_permission

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api/matches", tags=["matches"])

require_season = require_league("season", via="season_id")
require_any_capability = require_league(ANY, via="season_id")
require_disputes = require_league("disputes", via="season_id")

FILE_HEADERS = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"}


class ProtestSettingsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protest_hours: Optional[int] = None
    statement_hours: Optional[int] = None
    protest_target_hours: Optional[int] = None
    protest_escalate_hours: Optional[int] = None
    appeal_hours: Optional[int] = None
    moss_upload_hours: Optional[int] = None
    evidence_keep_days: Optional[int] = None
    contested_result_mode: Optional[str] = Field(default=None, max_length=20)
    protest_reasons: Optional[list[dict]] = Field(default=None, max_length=protest_settings.REASONS_MAX)


class AmendBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    addition: Optional[str] = Field(default=None, max_length=procedures.REASON_MAX)
    claimed: Optional[dict] = None
    incident_id: Optional[str] = Field(default=None, max_length=120)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class StatementBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(max_length=procedures.STATEMENT_MAX)


class LeadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class ExtendBody(LeadBody):
    hours: int


class DecisionBody(LeadBody):
    decision: Literal["keep"]
    decision_note: str = Field(max_length=procedures.NOTE_MAX)


class MossRequestBody(LeadBody):
    user_id: str = Field(max_length=120)


class ExcuseBody(LeadBody):
    reason: str = Field(max_length=500)


class AppealBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    against_type: str = Field(max_length=40)
    ref_id: str = Field(max_length=120)
    reason: str = Field(max_length=procedures.REASON_MAX)


def _raise(problem: procedures.ProcedureProblem):
    raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


# ---------------------------------------------------------------- Einstellungen je Season

async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


def _settings_view(season: dict, **extra) -> dict:
    return {"settings": protest_settings.effective(None, season), "active": protest_settings.stored(season) is not None,
            "defaults": protest_settings.defaults(),
            "limits": {key: {"min": low, "max": high} for key, (low, high, _label) in protest_settings.NUMBERS.items()},
            "modes": list(protest_settings.MODES), "reasons_max": protest_settings.REASONS_MAX,
            "fixed_reasons": list(protest_settings.CATEGORIES), **extra}


@admin_router.get("/seasons/{season_id}/protest-settings")
async def get_protest_settings(season_id: str, _me: dict = Depends(require_any_capability)):
    db = get_db()
    season = await _season(db, season_id)
    return _settings_view(season, staffeln=await db.tournaments.count_documents({"league_context.season_id": season_id}))


@admin_router.put("/seasons/{season_id}/protest-settings")
async def put_protest_settings(season_id: str, body: ProtestSettingsBody, me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    try:
        settings = protest_settings.normalize({**protest_settings.effective(None, season), **body.model_dump(exclude_none=True)})
    except protest_settings.SettingsProblem as problem:
        raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None
    before = protest_settings.stored(season)
    now = now_utc().isoformat()
    if before != settings:
        await db.league_seasons.update_one({"id": season_id}, {"$set": {**settings, "updated_at": now}})
    # Sofort auf die Staffeln - gesperrte bleiben, wie sie sind (dort nimmt sie das Übertragen nach dem Entsperren mit). Laufende
    # Verfahren behalten ihre gespeicherten Fristen. Abgeschlossene Staffeln (F.1, #1645) behalten ihre Fristen ebenso: eine längere
    # Einspruchsfrist öffnet dort nichts wieder.
    updated = 0
    staffeln = await db.tournaments.find({"league_context.season_id": season_id, "locked_at": None}, {"_id": 0}).to_list(500)
    for staffel in staffeln:
        if league_final_read.is_closed(staffel):
            continue
        if protest_settings.stored(staffel) != settings:
            await db.tournaments.update_one({"id": staffel["id"]}, {"$set": {**settings, "updated_at": now}})
            updated += 1
    if before != settings:
        changed = sorted(key for key in settings if (before or {}).get(key) != settings[key])
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.season.protest_settings", "target_id": season_id, "actor_id": me.get("id"),
            "data": {"changed": changed, "staffeln": updated}, "created_at": now})
    return _settings_view({**season, **settings}, staffeln_updated=updated)


@admin_router.get("/seasons/{season_id}/procedures")
async def list_procedures(season_id: str, me: dict = Depends(require_disputes)):
    """Der Eingang der Leitung: alle Verfahren der Season, offene zuerst. Wer an einem Spiel beteiligt ist, sieht dort nur, dass
    etwas läuft - Einzelheiten bekommt er als Seite auf der Matchseite."""
    db = get_db()
    season = await _season(db, season_id)
    staffeln = await db.tournaments.find({"league_context.season_id": season_id}, {"_id": 0, "creation_key": 0, "billing": 0}).to_list(500)
    items: list[dict] = []
    now = now_utc()
    for staffel in staffeln:
        matches = await db.matches_v2.find(
            {"tournament_id": staffel["id"], "disputes.kind": {"$in": list(procedures.KINDS)}}, {"_id": 0}).to_list(3000)
        if not matches:
            continue
        involved = await involved_match_ids(db, me, staffel, matches)
        registrations = await db.tournament_registrations.find({"tournament_id": staffel["id"]}, {"_id": 0}).to_list(REGISTRATION_LIMIT)
        sides = {row["id"]: row.get("display_name") or row.get("team_name") or "Team" for row in registrations if row.get("id")}
        league = procedures.League(staffel, season, protest_settings.effective(staffel, season))
        for match in matches:
            conflict = match["id"] in involved
            names = {} if conflict else await procedures._names(db, match)
            viewer = procedures.Viewer(user_id=me.get("id"), lead=not conflict, can_decide=not conflict)
            for row in procedures.rows(match):
                base = {"match_id": match["id"], "staffel": staffel.get("title") or "", "tournament_id": staffel["id"],
                        "sides": [sides.get(side) or "Team" for side in procedures.side_ids(match)], "conflict": conflict}
                if conflict:
                    items.append({**base, "id": row["id"], "kind": row["kind"], "kind_label": procedures.KIND_LABELS[row["kind"]],
                                  "state": procedures.state_of(row), "at": row.get("at")})
                else:
                    shown = procedures.view(row, match, viewer, league, names, now) or {}
                    items.append({**base, **shown, "side_name": sides.get(row.get("registration_id")) or "Liga-Leitung"})
    order = {procedures.OPEN: 0, procedures.DECIDED: 1, procedures.WITHDRAWN: 2}
    items.sort(key=lambda item: str(item.get("at") or ""), reverse=True)
    items.sort(key=lambda item: order.get(item.get("state"), 3))
    return {"items": items, "open": sum(1 for item in items if item.get("state") == procedures.OPEN)}


# ---------------------------------------------------------------- Am Spiel

async def _context(match_id: str, user: dict):
    """Spiel, Liga und die Sicht der Person - 404 für andere Turniere und für alle, die mit dem Spiel nichts zu tun haben."""
    db = get_db()
    match, collection = await _find_match_any(match_id)
    league = await procedures.context(db, match) if collection == "matches_v2" else None
    if league is None:
        raise HTTPException(status_code=404, detail=procedures.NOT_FOUND_DETAIL)
    viewer = await procedures.viewer_for(db, match, user)
    if not (viewer.sides or viewer.acting or viewer.lead) and not await has_match_result_permission(user, match, capability="disputes"):
        raise HTTPException(status_code=404, detail=procedures.NOT_FOUND_DETAIL)
    if league.tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail="Turnier ist gesperrt und kann nur noch angesehen werden.")
    # Abgeschlossene Staffel (F.1, #1645): kein neuer Einspruch und kein Schritt in einem Verfahren mehr - erst wieder öffnen.
    if league_final_read.is_closed(league.tournament):
        raise HTTPException(status_code=409, detail=league_final_read.CLOSED_LOCK)
    return db, match, league, viewer


async def _as_lead(db, user: dict, match: dict, row: dict, *, action: str, conflict_reason: str | None) -> None:
    """Die Leitung mit „Proteste“ - befangen nur als Notausnahme des Superadmins mit Grund (#2203), bei einem Einspruch nie die
    Person der Ausgangsentscheidung."""
    if not await has_match_result_permission(user, match, capability="disputes"):
        raise HTTPException(status_code=403, detail="Das entscheidet die Liga-Leitung mit dem Recht „Proteste“.")
    await require_no_conflict(db, user, match, action=action, conflict_reason=conflict_reason, decided_by=procedures.decided_by(row))


async def _block(db, match: dict, league, user: dict) -> dict:
    return await procedures.page_block(db, match, league, user)


def _side_for(viewer, registration_id: str | None) -> str | None:
    return registration_id if registration_id and registration_id in viewer.acting else None


@router.post("/{match_id}/appeals")
async def open_appeal(match_id: str, body: AppealBody, me: dict = Depends(get_current_user),
                      _mutation: None = Depends(_serialized_match_write)):
    db, match, league, viewer = await _context(match_id, me)
    if not viewer.acting:
        raise HTTPException(status_code=403, detail="Einspruch legt eine der beiden Seiten dieses Spiels ein.")
    try:
        done = await procedures.submit_appeal(db, match, league, user=me, registration_id=sorted(viewer.acting)[0],
                                              against_type=body.against_type, ref_id=body.ref_id, reason=body.reason)
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return {**await _block(db, done["match"], league, me), "procedure_id": done["entry"]["id"]}


@router.patch("/{match_id}/procedures/{procedure_id}")
async def amend_procedure(match_id: str, procedure_id: str, body: AmendBody, me: dict = Depends(get_current_user),
                          _mutation: None = Depends(_serialized_match_write)):
    db, match, league, viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        side = _side_for(viewer, row.get("registration_id"))
        if not side:
            await _as_lead(db, me, match, row, action="procedure_amend", conflict_reason=body.conflict_reason)
        updated = await procedures.amend(db, match, league, procedure_id, user=me, as_side=side, as_lead=not side,
                                         changes=body.model_dump(exclude_unset=True, exclude={"conflict_reason"}))
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return await _block(db, updated, league, me)


@router.post("/{match_id}/procedures/{procedure_id}/withdraw")
async def withdraw_procedure(match_id: str, procedure_id: str, me: dict = Depends(get_current_user),
                             _mutation: None = Depends(_serialized_match_write)):
    db, match, league, viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        updated = await procedures.withdraw(db, match, league, procedure_id, user=me, as_side=_side_for(viewer, row.get("registration_id")))
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return await _block(db, updated, league, me)


@router.post("/{match_id}/procedures/{procedure_id}/statement")
async def give_statement(match_id: str, procedure_id: str, body: StatementBody, me: dict = Depends(get_current_user),
                         _mutation: None = Depends(_serialized_match_write)):
    db, match, league, viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        side = _side_for(viewer, (row.get("statement") or {}).get("registration_id"))
        updated = await procedures.give_statement(db, match, league, procedure_id, user=me, as_side=side, text=body.text)
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return await _block(db, updated, league, me)


@router.post("/{match_id}/procedures/{procedure_id}/statement/extend")
async def extend_statement(match_id: str, procedure_id: str, body: ExtendBody, me: dict = Depends(get_current_user),
                           _mutation: None = Depends(_serialized_match_write)):
    db, match, league, _viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        await _as_lead(db, me, match, row, action="procedure_statement_extend", conflict_reason=body.conflict_reason)
        updated = await procedures.extend_statement(db, match, league, procedure_id, user=me, hours=body.hours)
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return await _block(db, updated, league, me)


@router.post("/{match_id}/procedures/{procedure_id}/assign")
async def assign_procedure(match_id: str, procedure_id: str, body: LeadBody | None = None, me: dict = Depends(get_current_user),
                           _mutation: None = Depends(_serialized_match_write)):
    db, match, league, _viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        await _as_lead(db, me, match, row, action="procedure_assign", conflict_reason=(body or LeadBody()).conflict_reason)
        updated = await procedures.assign(db, match, league, procedure_id, user=me)
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return await _block(db, updated, league, me)


@router.post("/{match_id}/procedures/{procedure_id}/decision")
async def decide_procedure(match_id: str, procedure_id: str, body: DecisionBody, me: dict = Depends(get_current_user),
                           _mutation: None = Depends(_serialized_match_write)):
    """„Ergebnis bleibt“ bzw. „Einspruch abgewiesen“ mit Pflichtbegründung. „Ergebnis ändern“ läuft über das Ergebnis-Fenster:
    Die Korrektur mit Grund entscheidet das Verfahren mit."""
    db, match, league, _viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        await _as_lead(db, me, match, row, action="procedure_decision", conflict_reason=body.conflict_reason)
        updated = await procedures.decide_keep(db, match, league, procedure_id, user=me, note=body.decision_note)
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return {**await _block(db, updated, league, me), "status": updated.get("status")}


@router.post("/{match_id}/procedures/{procedure_id}/moss-requests")
async def request_moss(match_id: str, procedure_id: str, body: MossRequestBody, me: dict = Depends(get_current_user),
                       _mutation: None = Depends(_serialized_match_write)):
    db, match, league, _viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        await _as_lead(db, me, match, row, action="procedure_moss_request", conflict_reason=body.conflict_reason)
        updated = await procedures.request_moss(db, match, league, procedure_id, user=me, player_id=body.user_id)
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return await _block(db, updated, league, me)


@router.post("/{match_id}/procedures/{procedure_id}/moss-requests/{request_id}/excuse")
async def excuse_moss(match_id: str, procedure_id: str, request_id: str, body: ExcuseBody, me: dict = Depends(get_current_user),
                      _mutation: None = Depends(_serialized_match_write)):
    db, match, league, _viewer = await _context(match_id, me)
    try:
        row = procedures.find(match, procedure_id)
        await _as_lead(db, me, match, row, action="procedure_moss_excuse", conflict_reason=body.conflict_reason)
        updated = await procedures.excuse_moss(db, match, league, procedure_id, request_id, user=me, reason=body.reason)
    except procedures.ProcedureProblem as problem:
        _raise(problem)
    return await _block(db, updated, league, me)


@router.get("/{match_id}/proofs/{proof_id}/file")
async def download_proof_file(match_id: str, proof_id: str, me: dict = Depends(get_current_user)):
    """Die MOSS-ZIP als Download (nie eingebettet, nie entpackt) - nur für wer sie sehen darf, alle anderen bekommen 404."""
    db = get_db()
    doc = await db.match_proof_photos.find_one({"id": proof_id, "match_id": match_id}, {"_id": 0})
    if not doc or not match_proofs.is_file(doc) or not await match_proofs.can_see(db, doc, me):
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    path = match_proofs.proof_path(doc.get("storage_key"))
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    return FileResponse(path, media_type="application/zip", filename=f"moss-{proof_id[:8]}.zip", headers=FILE_HEADERS)
