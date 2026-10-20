"""Turnierleitung am Handy (#1156): die Ansicht „Turnierleitung“ eines Turniers unter /tournaments/<slug>/leitung.

Nur für die Turnierleitung dieses Turniers - global (Turnierleitung als Rolle oder Freigabe) oder mit einem
Helfer-Einsatz in genau diesem Turnier. Spieler, Moderatoren ohne Einsatz und Gäste bekommen 403 bzw. 401. Eintragen
darf je Spiel nur, wer Ergebnis-Recht hat (``can_enter``) - das prüft der Ergebnis-Weg noch einmal.

„Nicht erschienen?“ (#1551): ist die Frist eines Spiels um, liegt ein Vorschlag am Spiel. Die Turnierleitung bestätigt
ihn - die gewählte Seite verliert dieses eine Spiel kampflos, über den Forfeit-Weg - oder verlängert die Frist. Im
Lauf mit mehr als zwei Spielern (#1823) wird nur die gewählte Person markiert; der Lauf bleibt offen
(``services.match_forfeit``) und der Vorschlag gilt weiter für alle, die noch nicht markiert sind - je Person.
"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from routes.tournament_common import _ensure_tournament_unlocked, _resolve_tid, _serialized_tournament_write
from routes.tournament_router import router
from services.match_forfeit import apply_forfeit
from services.match_deadlines import no_show_deadline
from services.match_lead import lead_view
from services.match_planning import ensure_tournament_accepts_results
from services.match_v2_results import MatchV2ResultError
from services.result_hold import ensure_no_hold
from services.v2_match_flows import no_show_keeps_heat_open
from services.tournament_permissions import (
    READ_STAFF_ROLES,
    RESULT_STAFF_ROLES,
    has_match_result_permission,
    has_tournament_staff_permission,
)


@router.get("/{tid}/lead")
async def tournament_lead(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    if not await has_tournament_staff_permission(me, tournament_id, READ_STAFF_ROLES | RESULT_STAFF_ROLES):
        raise HTTPException(status_code=403, detail="Diese Ansicht ist nur für die Turnierleitung dieses Turniers.")
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return await lead_view(db, tournament, me)


STALE_PROPOSAL_DETAIL = ("Der Vorschlag gilt nicht mehr: Das Spiel hat begonnen, eine Seite hat gemeldet "
                         "oder die Paarung hat sich geändert. Bitte das Ergebnis-Fenster nutzen.")


class NoShowDecision(BaseModel):
    """„Nicht erschienen?“ entscheiden: ``confirm`` mit der Seite, die fehlt, oder ``extend`` um ein paar Minuten."""
    model_config = ConfigDict(extra="forbid")

    action: Literal["confirm", "extend"]
    registration_id: str | None = Field(default=None, max_length=120)
    minutes: int = Field(default=5, ge=1, le=60)


def _parse(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed and parsed.tzinfo is None else parsed


async def _audit(db, action: str, match: dict, actor_id: str, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id"), "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "match_key": match.get("match_key"), **data},
        "created_at": now_utc().isoformat(),
    })


@router.post("/{tid}/lead/no-show/{match_id}")
async def decide_no_show(tid: str, match_id: str, body: NoShowDecision, me: dict = Depends(get_current_user),
                         _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tournament_id)
    match = await db.matches_v2.find_one({"id": match_id, "tournament_id": tournament_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    if not await has_match_result_permission(me, match):
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Aktion")
    proposal = match.get("no_show_proposal")
    if not isinstance(proposal, dict):
        raise HTTPException(status_code=409, detail="Für dieses Spiel liegt kein Vorschlag „nicht erschienen“ vor.")
    # Schon bestätigt: im Duell der ganze Vorschlag, im Lauf diese eine Person (#1823: je Person). Mit Stand - im Lauf
    # bleibt er offen, im Duell ist er „forfeit“; danach richtet sich die Rückmeldung.
    already = proposal.get("decision") == "confirmed" or body.registration_id in (match.get("no_show_registration_ids") or [])
    if already and body.action == "confirm":
        return {"ok": True, "idempotent_replay": True, "match_id": match_id, "status": match.get("status")}
    now = now_utc()
    if body.action == "extend":
        start = max(now, _parse(proposal.get("due_at")) or now)
        until = (start + timedelta(minutes=body.minutes)).isoformat()
        await db.matches_v2.update_one({"id": match_id}, {
            "$set": {"no_show_extended_until": until, "updated_at": now.isoformat()},
            "$unset": {"no_show_proposal": ""},
        })
        await _audit(db, "match.no_show.extended", match, me["id"], {"proposal_id": proposal.get("id"), "until": until})
        return {"ok": True, "extended_until": until, "idempotent_replay": False}

    filled = [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]
    if body.registration_id not in filled:
        raise HTTPException(status_code=422, detail="Bitte die Seite wählen, die nicht erschienen ist.")
    await ensure_tournament_accepts_results(db, tournament_id)
    # Gilt der Vorschlag noch? Dieselbe Paarung, nicht begonnen, keine Meldung, Frist um - sonst keine Wertung.
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0}) or {}
    stage_id = match.get("stage_id")
    stage = await db.tournament_stages.find_one({"id": stage_id}, {"_id": 0}) if stage_id else None
    info = no_show_deadline(match, tournament, stage)
    same_pairing = sorted(proposal.get("registration_ids") or filled) == sorted(filled)
    if not same_pairing or not info or info["due_at"] > now:
        raise HTTPException(status_code=409, detail=STALE_PROPOSAL_DETAIL)
    minutes = int(proposal.get("minutes") or 0)
    note = f"Nicht erschienen – Frist von {minutes} Minuten abgelaufen"
    per_person = no_show_keeps_heat_open(match)
    try:
        ensure_no_hold(match)
        decided = await apply_forfeit(db, match, body.registration_id, note=note, actor_id=me["id"], force=False)
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None
    if per_person:
        # Im Lauf (#1823): der Vorschlag bleibt für die anderen offen - bestätigt ist nur diese Person.
        await db.matches_v2.update_one({"id": match_id}, {"$addToSet": {"no_show_proposal.confirmed_ids": body.registration_id}})
    else:
        await db.matches_v2.update_one({"id": match_id}, {"$set": {
            "no_show_proposal.decision": "confirmed", "no_show_proposal.decided_by": me["id"],
            "no_show_proposal.decided_at": now.isoformat(),
        }})
    await _audit(db, "match.no_show.confirmed", match, me["id"],
                 {"proposal_id": proposal.get("id"), "registration_id": body.registration_id})
    return {"ok": True, "match_id": match_id, "status": decided.get("status"), "idempotent_replay": False}
