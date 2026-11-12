"""Tabelle der Liga-Staffel in der Verwaltung (E.1, #1625, docs/LIGA.md, „E.1 Tabelle“).

- ``GET  /api/admin/leagues/staffeln/{tid}/table``: Tabelle, geteilte Plätze, Entscheide - jede Zuständigkeit der Liga.
- ``PUT  /api/admin/leagues/staffeln/{tid}/table-decision``: Reihenfolge bei echtem Gleichstand - ``results``, mit Grund,
  nie über das eigene Team (Befangenheit wie bei der Anmeldung).
- ``DELETE …/table-decision/{decision_id}``: Entscheid zurücknehmen - ``results``, mit Grund.
- ``POST`` / ``DELETE …/matches/{mid}/double-no-show``: beide nicht erschienen werten bzw. neu ansetzen - ``results``,
  Befangenheit wie beim Ergebnis.

Logik in ``services/league_table.py``; jede Änderung steht im Protokoll.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from models import new_id, now_utc
from services import checkin_rules, league_permissions, league_procedures
from services import league_table
from services.change_events import publish_api_change
from services.league_scope import ONLY_LEAGUE
from services.league_permissions import ANY, require_league
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

admin_router = APIRouter(prefix="/api/admin/leagues/staffeln", tags=["leagues-admin"])

BUSY = "Eine Turnieraktion wird bereits verarbeitet. Bitte erneut versuchen."


class TableDecisionBody(BaseModel):
    registration_ids: list[str] = Field(max_length=32)
    reason: str = Field(max_length=500)
    conflict_reason: str | None = Field(default=None, max_length=500)


class TableReasonBody(BaseModel):
    reason: str = Field(max_length=500)
    conflict_reason: str | None = Field(default=None, max_length=500)


class DoubleNoShowBody(BaseModel):
    note: str = Field(max_length=500)
    conflict_reason: str | None = Field(default=None, max_length=500)


def _refuse(problem: league_table.TableProblem) -> HTTPException:
    return HTTPException(status_code=problem.status, detail=problem.message)


async def _audit(db, action: str, me: dict, target_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me.get("id"), "target_id": target_id,
                                    "data": data, "created_at": now_utc().isoformat()})


async def _staffel(db, tournament_id: str) -> dict:
    """Die Staffel zum Schreiben - eine gesperrte lehnt ab wie jedes Turnier (423)."""
    from routes.tournament_common import _ensure_tournament_unlocked

    if not await db.tournaments.find_one({"id": tournament_id, **ONLY_LEAGUE}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Staffel nicht gefunden.")
    return await _ensure_tournament_unlocked(db, tournament_id)


@admin_router.get("/{tournament_id}/table")
async def admin_staffel_table(tournament_id: str, me: dict = Depends(require_league(ANY, via="tournament_id"))):
    db = get_db()
    tournament = await db.tournaments.find_one({"id": tournament_id, **ONLY_LEAGUE}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Staffel nicht gefunden.")
    return await league_table.overview(db, tournament, me)


@admin_router.put("/{tournament_id}/table-decision")
async def admin_set_table_decision(tournament_id: str, body: TableDecisionBody,
                                   me: dict = Depends(require_league("results", via="tournament_id"))):
    db = get_db()
    try:
        reason = league_table.reason_text(body.reason)
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            tournament = await _staffel(db, tournament_id)
            registrations = await db.tournament_registrations.find(
                {"tournament_id": tournament_id, "id": {"$in": list(body.registration_ids)}}, {"_id": 0}).to_list(64)
            if len(registrations) != len(set(body.registration_ids)):
                raise league_table.TableProblem("Diese Teams gehören nicht zur Staffel.", 422)
            overrides = [await league_permissions.require_no_side_conflict(db, me, registration,
                                                                           conflict_reason=body.conflict_reason)
                         for registration in registrations]
            decision = await league_table.set_decision(db, tournament, body.registration_ids, reason, me["id"])
    except league_table.TableProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    override_reason = next((item for item in overrides if item), None)
    if override_reason:
        await league_permissions.record_override(db, me, action="table_decision", target_id=tournament_id,
                                                 reason=override_reason, decision_id=decision["id"])
    await _audit(db, "league.table.decision", me, tournament_id, {
        "decision_id": decision["id"], "registration_ids": decision["registration_ids"], "reason": reason})
    await publish_api_change("PUT", f"/api/tournaments/{tournament_id}/standings", 200)
    return decision


@admin_router.delete("/{tournament_id}/table-decision/{decision_id}")
async def admin_remove_table_decision(tournament_id: str, decision_id: str, body: TableReasonBody,
                                      me: dict = Depends(require_league("results", via="tournament_id"))):
    db = get_db()
    try:
        reason = league_table.reason_text(body.reason)
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            tournament = await _staffel(db, tournament_id)
            found = next((row for row in tournament.get("table_decisions") or []
                          if isinstance(row, dict) and row.get("id") == decision_id), None)
            # Befangenheit wie beim Festlegen (Codex zu E.1): über das eigene Team nimmt auch niemand einen Entscheid zurück.
            registrations = await db.tournament_registrations.find(
                {"tournament_id": tournament_id, "id": {"$in": list((found or {}).get("registration_ids") or [])}},
                {"_id": 0}).to_list(64)
            overrides = [await league_permissions.require_no_side_conflict(db, me, registration,
                                                                           conflict_reason=body.conflict_reason)
                         for registration in registrations]
            removed = await league_table.remove_decision(db, tournament, decision_id)
    except league_table.TableProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    override_reason = next((item for item in overrides if item), None)
    if override_reason:
        await league_permissions.record_override(db, me, action="table_decision_remove", target_id=tournament_id,
                                                 reason=override_reason, decision_id=decision_id)
    await _audit(db, "league.table.decision.remove", me, tournament_id, {
        "decision_id": decision_id, "registration_ids": removed.get("registration_ids"), "reason": reason})
    await publish_api_change("DELETE", f"/api/tournaments/{tournament_id}/standings", 200)
    return {"ok": True}


async def _match(db, tournament_id: str, match_id: str) -> dict:
    match = await db.matches_v2.find_one({"id": match_id, "tournament_id": tournament_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden.")
    return match


@admin_router.post("/{tournament_id}/matches/{match_id}/double-no-show")
async def admin_double_no_show(tournament_id: str, match_id: str, body: DoubleNoShowBody,
                               me: dict = Depends(require_league("results", via="tournament_id"))):
    """Beide nicht erschienen (Nr. 27): beide verlieren, keine Punkte, keine Maps - je Seite der Eintrag „nicht erschienen“."""
    from services.match_planning import ensure_tournament_accepts_results
    from services.walkover_incidents import record_walkover_incident

    db = get_db()
    match = await _match(db, tournament_id, match_id)
    await league_permissions.require_no_conflict(db, me, match, action="double_no_show",
                                                 conflict_reason=body.conflict_reason, record=False)
    try:
        note = league_table.note_text(body.note)
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            tournament = await _staffel(db, tournament_id)
            await ensure_tournament_accepts_results(db, tournament_id)
            match = await _match(db, tournament_id, match_id)
            # Vorfälle (D.5, #1619, Nr. 146): Solange ein Vorfall offen ist, wird nicht „nicht erschienen“ gewertet.
            from services.league_incident_rules import forfeit_refusal

            blocked = forfeit_refusal(match)
            if blocked:
                raise league_table.TableProblem(blocked, 409)
            sides = league_table.check_double_no_show(tournament, match)
            await league_permissions.require_no_conflict(db, me, match, action="double_no_show",
                                                         conflict_reason=body.conflict_reason)
            now_iso = now_utc().isoformat()
            fields = league_table.double_no_show_fields(match, note, me["id"], now_iso)
            await db.matches_v2.update_one({"id": match_id}, {"$set": fields})
    except league_table.TableProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    for side in sides:
        await record_walkover_incident(db, match, side, me["id"])
    await league_table.after_change(db, tournament, match, scored=True)
    await _audit(db, "match.forfeit.double", me, tournament_id, {"match_id": match_id, "registration_ids": sides,
                                                                 "note_length": len(note)})
    await publish_api_change("POST", f"/api/matches/{match_id}/result", 200)
    # Verfahren in der Antwort nur, soweit diese Person sie sehen darf (#1619, Nr. 133/137).
    return await league_procedures.guard(db, await _match(db, tournament_id, match_id), me)


@admin_router.delete("/{tournament_id}/matches/{match_id}/double-no-show")
async def admin_undo_double_no_show(tournament_id: str, match_id: str, body: TableReasonBody,
                                    me: dict = Depends(require_league("results", via="tournament_id"))):
    """Neu ansetzen: das Spiel ohne Ergebnis zurück in den offenen Stand; den Termin setzt die Leitung danach."""
    from services.walkover_incidents import revoke_walkover_incident

    db = get_db()
    match = await _match(db, tournament_id, match_id)
    await league_permissions.require_no_conflict(db, me, match, action="double_no_show_undo",
                                                 conflict_reason=body.conflict_reason, record=False)
    try:
        reason = league_table.reason_text(body.reason)
        async with mutation_lock(db, tournament_write_resource(tournament_id)):
            tournament = await _staffel(db, tournament_id)
            match = await _match(db, tournament_id, match_id)
            if not (match.get("double_forfeit") and match.get("status") == "forfeit"):
                raise league_table.TableProblem("Das Spiel ist nicht als „beide nicht erschienen“ gewertet.", 409)
            # Notausnahme des Superadmins mit Grund - jetzt mit Protokoll (Codex zu E.1).
            await league_permissions.require_no_conflict(db, me, match, action="double_no_show_undo",
                                                         conflict_reason=body.conflict_reason)
            sides = [row.get("registration_id") for row in match.get("results") or [] if row.get("registration_id")]
            # „Neu ansetzen“ behält den Termin - alte Check-ins und ein altes Veto zählen trotzdem nicht mehr: die Termin-Revision
            # steigt (Codex zu D.3, #1618), eine Verlängerung fällt (D.2).
            await db.matches_v2.update_one({"id": match_id}, checkin_rules.new_time_change(tournament, {
                "$set": league_table.undo_fields(match, now_utc().isoformat()),
                "$unset": {"double_forfeit": "", "double_forfeit_before": "", "admin_decision_note": "",
                           "admin_decision_by": "", "admin_decision_at": ""}}))
    except league_table.TableProblem as problem:
        raise _refuse(problem) from None
    except MutationLockBusy:
        raise HTTPException(status_code=409, detail=BUSY) from None
    for side in sides:
        await revoke_walkover_incident(db, match_id, side)
    await league_table.after_change(db, tournament, match, scored=False)
    await _audit(db, "match.forfeit.double.undo", me, tournament_id, {"match_id": match_id, "reason": reason})
    await publish_api_change("DELETE", f"/api/matches/{match_id}/result", 200)
    # Verfahren in der Antwort nur, soweit diese Person sie sehen darf (#1619, Nr. 133/137).
    return await league_procedures.guard(db, await _match(db, tournament_id, match_id), me)
