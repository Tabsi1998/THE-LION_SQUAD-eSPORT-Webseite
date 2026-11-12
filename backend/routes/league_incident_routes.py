"""Vorfälle im Spiel einer Liga-Staffel (docs/LIGA.md, „D.5/E.2-Vertrag“ → „Vorfälle“, #1619; Regelwerk § 9, Anlage C).

- ``POST /api/matches/{match_id}/incidents``: Captain oder Vertreter einer Seite melden einen Vorfall mit Vorschlag; die Liga-Leitung
  mit „Ergebnisse“ oder „Proteste“ nimmt einen auf (dann ist die Map sofort in Klärung). Die Map-Pause wird nur dokumentiert.
- ``POST …/incidents/{incident_id}/answer``: die Gegenseite stimmt zu oder lehnt ab (dann entscheidet die Leitung).
- ``POST …/incidents/{incident_id}/withdraw``: die meldende Seite zieht zurück, solange niemand geantwortet hat.
- ``POST …/incidents/{incident_id}/decision``: die Entscheidung der Leitung, auf Wunsch gleich mit „Serie feststellen“.
- ``POST …/incidents/{incident_id}/settle``: „Serie feststellen“ - fehlende und überzählige Maps mit Begründung.
- ``POST …/incidents/{incident_id}/close``: die Leitung schließt einen offenen Vorfall ohne Entscheidung, mit Begründung - etwa bevor
  sie das Spiel kampflos wertet (solange ein Vorfall offen ist, sind „kampflos“ und „nicht erschienen“ gesperrt).

Nur Spiele einer Liga-Staffel, sonst 404. Entscheiden darf, wer in der Liga „Ergebnisse“ oder „Proteste“ hat und an dem Spiel nicht
beteiligt ist (Befangenheit wie B.1; der Superadmin nur als Notausnahme mit Grund). Hält nach einem Schritt nichts mehr das Ergebnis
auf und stimmen die Meldungen beider Seiten überein, wird es im selben Schritt gültig. Die Logik steht in
``services/league_incidents.py``; gelesen werden die Vorfälle über den Block ``league`` der Matchseite.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from routes.match_routes import (
    _acting_registration_for_match,
    _assert_match_visible,
    _confirm_agreed_result,
    _find_match_any,
    _serialized_match_write,
)
from services import league_games, league_incidents
from services.league_permissions import require_no_conflict
from services.match_planning import ensure_tournament_accepts_results
from services.rate_limit import enforce_rate_limit
from services.tournament_permissions import has_match_result_permission
from services.v2_match_flows import report_consensus

router = APIRouter(prefix="/api/matches", tags=["matches"])

REPORT_LIMIT = {"limit": 30, "window_seconds": 3600}
NOT_LEAGUE_DETAIL = "Vorfälle gibt es nur in Spielen einer Liga-Staffel."


class IncidentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: int = Field(ge=1, le=7)
    kind: str = Field(max_length=20)
    # Nur bei einer Pause: die Map-Pause nach Anlage C.3 - nur dokumentiert, mit ihrer Länge.
    between_maps: bool = False
    minutes: Optional[int] = None
    proposal: Optional[str] = Field(default=None, max_length=20)
    # Stand beim Vorfall je Seite, Runde und betroffene Personen - alles freiwillig.
    score: Optional[dict[str, int]] = None
    round: Optional[int] = None
    players: list[str] = Field(default_factory=list, max_length=league_incidents.MAX_PLAYERS)
    note: Optional[str] = Field(default=None, max_length=league_incidents.NOTE_MAX)
    # Nur die Liga-Leitung: Notausnahme des Superadmins bei Befangenheit (#2203).
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class AnswerBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    accept: bool
    note: Optional[str] = Field(default=None, max_length=league_incidents.NOTE_MAX)


class SettleBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    missing_positions: list[int] = Field(default_factory=list, max_length=7)
    surplus_positions: list[int] = Field(default_factory=list, max_length=7)
    reason: Optional[str] = Field(default=None, max_length=league_incidents.REASON_MAX)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class CloseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Optional[str] = Field(default=None, max_length=league_incidents.REASON_MAX)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class DecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: str = Field(max_length=20)
    registration_id: Optional[str] = Field(default=None, max_length=120)
    reason: Optional[str] = Field(default=None, max_length=league_incidents.REASON_MAX)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)
    # Die Serie gleich feststellen, wenn nichts mehr zu spielen ist (nie bei Neustart oder Wiederholung).
    settle: Optional[SettleBody] = None


def _raise(problem: league_incidents.IncidentProblem):
    raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


async def _context(match_id: str, user: dict):
    """Spiel, Staffel und Liga-Aufbau - 404 außerhalb einer Liga-Staffel, 423 in einer gesperrten."""
    db = get_db()
    match, collection = await _find_match_any(match_id)
    await _assert_match_visible(match, user)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "creation_key": 0, "billing": 0})
    setup = await league_games.setup(db, match, tournament) if collection == "matches_v2" else None
    if setup is None:
        raise HTTPException(status_code=404, detail=NOT_LEAGUE_DETAIL)
    if tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail="Turnier ist gesperrt und kann nur noch angesehen werden.")
    return db, match, tournament, setup


async def _closed_if_ended(db, match: dict, setup) -> dict:
    """Ist das Spiel inzwischen zu Ende (kampflos, abgesagt), sind offene Vorfälle geschlossen - der Schritt danach antwortet mit
    409. Geschrieben wird erst **nach** der Rechteprüfung der Route: Wer nichts darf, ändert auch so nichts."""
    match = await league_incidents.close_ended(db, match)
    setup.match = match
    return match


async def _as_lead(db, user: dict, match: dict, *, action: str, conflict_reason: str | None) -> None:
    """Die Liga-Leitung mit „Ergebnisse“ oder „Proteste“ - befangen nur als Notausnahme des Superadmins mit Grund (#2203)."""
    if not await has_match_result_permission(user, match, capability=("results", "disputes")):
        raise HTTPException(status_code=403, detail=league_incidents.LEAD_ONLY_DETAIL)
    await require_no_conflict(db, user, match, action=action, conflict_reason=conflict_reason)


async def _side(match: dict, user: dict) -> str:
    acting = await _acting_registration_for_match(match, user)
    if not acting:
        raise HTTPException(status_code=403, detail=league_incidents.NOT_A_SIDE_DETAIL)
    return acting["id"]


async def _after_change(db, match_id: str, tournament: dict, setup, user: dict) -> dict:
    """Nach jedem Schritt: Hält nichts mehr das Ergebnis auf und stimmen die Meldungen beider Seiten überein, gilt es jetzt - das
    Bestätigen hat nur geruht. Sonst bleibt alles, wie es ist (eine einzelne Meldung nimmt die Frist-Automatik). Nach einem Neustart
    oder einer Wiederholung zählen dabei nur Meldungen von danach: Eine Einigung auf „wiederholen“ macht nie ein Ergebnis gültig,
    das vorher gemeldet wurde."""
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    hold = league_incidents.result_block(match)
    agreed = None if hold else report_consensus(league_incidents.current_reports(match))
    if not agreed or str(match.get("status") or "") in league_incidents.FINAL_STATUSES or isinstance(match.get("pending_result"), dict):
        return {"result_confirmed": False, "hold": hold}
    try:
        await ensure_tournament_accepts_results(db, match["tournament_id"])
        async with league_games.season_lock(db, tournament):
            setup.match = match
            await _confirm_agreed_result(db, match, setup, agreed, actor_id=user["id"])
    except league_incidents.IncidentProblem as problem:
        return {"result_confirmed": False, "hold": {"code": "manual", "position": None, "text": problem.detail}}
    except HTTPException as refused:
        return {"result_confirmed": False, "hold": {"code": "manual", "position": None, "text": str(refused.detail)}}
    return {"result_confirmed": True, "hold": None}


def _answer(entry: dict, after: dict) -> dict:
    return {"incident_id": entry["id"], "state": entry["state"], **after}


@router.post("/{match_id}/incidents")
async def report_incident(match_id: str, body: IncidentBody, request: Request, me: dict = Depends(get_current_user),
                          _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, setup = await _context(match_id, me)
    acting = await _acting_registration_for_match(match, me)
    if acting:
        registration_id = acting["id"]
    else:
        if not await has_match_result_permission(me, match, capability=("results", "disputes")):
            raise HTTPException(status_code=403, detail=league_incidents.NOT_A_SIDE_DETAIL)
        await require_no_conflict(db, me, match, action="incident_report", conflict_reason=body.conflict_reason)
        registration_id = None
    await enforce_rate_limit(request, "matches:incident", subject=me["id"], **REPORT_LIMIT)
    match = await _closed_if_ended(db, match, setup)
    try:
        entry = await league_incidents.report(db, match, setup, await league_incidents.settings_for(db, tournament), user=me,
                                              registration_id=registration_id, body=body.model_dump(exclude={"conflict_reason"}))
    except league_incidents.IncidentProblem as problem:
        _raise(problem)
    # Was das Ergebnis jetzt aufhält - aus allen Vorfällen des Spiels, nicht nur aus dem eben gemeldeten.
    stored = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    return _answer(entry, {"result_confirmed": False, "hold": league_incidents.result_block(stored)})


@router.post("/{match_id}/incidents/{incident_id}/answer")
async def answer_incident(match_id: str, incident_id: str, body: AnswerBody, me: dict = Depends(get_current_user),
                          _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, setup = await _context(match_id, me)
    registration_id = await _side(match, me)
    match = await _closed_if_ended(db, match, setup)
    try:
        entry = await league_incidents.answer(db, match, setup, incident_id, user=me, registration_id=registration_id,
                                              accept=body.accept, note=body.note)
    except league_incidents.IncidentProblem as problem:
        _raise(problem)
    return _answer(entry, await _after_change(db, match_id, tournament, setup, me))


@router.post("/{match_id}/incidents/{incident_id}/withdraw")
async def withdraw_incident(match_id: str, incident_id: str, me: dict = Depends(get_current_user),
                            _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, setup = await _context(match_id, me)
    registration_id = await _side(match, me)
    match = await _closed_if_ended(db, match, setup)
    try:
        entry = await league_incidents.withdraw(db, match, setup, incident_id, user=me, registration_id=registration_id)
    except league_incidents.IncidentProblem as problem:
        _raise(problem)
    return _answer(entry, await _after_change(db, match_id, tournament, setup, me))


@router.post("/{match_id}/incidents/{incident_id}/decision")
async def decide_incident(match_id: str, incident_id: str, body: DecisionBody, me: dict = Depends(get_current_user),
                          _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, setup = await _context(match_id, me)
    await _as_lead(db, me, match, action="incident_decide", conflict_reason=body.conflict_reason)
    match = await _closed_if_ended(db, match, setup)
    try:
        entry = await league_incidents.decide(
            db, match, setup, incident_id, user=me, outcome=body.outcome, registration_id=body.registration_id, reason=body.reason,
            conflict_reason=body.conflict_reason,
            settle=body.settle.model_dump(exclude={"conflict_reason"}) if body.settle is not None else None)
    except league_incidents.IncidentProblem as problem:
        _raise(problem)
    return _answer(entry, await _after_change(db, match_id, tournament, setup, me))


@router.post("/{match_id}/incidents/{incident_id}/settle")
async def settle_incident(match_id: str, incident_id: str, body: SettleBody, me: dict = Depends(get_current_user),
                          _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, setup = await _context(match_id, me)
    await _as_lead(db, me, match, action="incident_settle", conflict_reason=body.conflict_reason)
    match = await _closed_if_ended(db, match, setup)
    try:
        entry = await league_incidents.settle(db, match, setup, incident_id, user=me, body=body.model_dump(exclude={"conflict_reason"}))
    except league_incidents.IncidentProblem as problem:
        _raise(problem)
    return _answer(entry, await _after_change(db, match_id, tournament, setup, me))


@router.post("/{match_id}/incidents/{incident_id}/close")
async def close_incident(match_id: str, incident_id: str, body: CloseBody, me: dict = Depends(get_current_user),
                         _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, setup = await _context(match_id, me)
    await _as_lead(db, me, match, action="incident_close", conflict_reason=body.conflict_reason)
    match = await _closed_if_ended(db, match, setup)
    try:
        entry = await league_incidents.close(db, match, setup, incident_id, user=me, reason=body.reason)
    except league_incidents.IncidentProblem as problem:
        _raise(problem)
    return _answer(entry, await _after_change(db, match_id, tournament, setup, me))
