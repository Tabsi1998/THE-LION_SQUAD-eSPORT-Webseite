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
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from routes.tournament_common import _ensure_tournament_unlocked, _resolve_tid, _serialized_tournament_write
from routes.tournament_router import router
from services import checkin_rules
from services.league_permissions import READ, require_no_conflict
from services.match_forfeit import apply_forfeit
from services.league_scope import is_league_staffel
from services.match_deadlines import no_show_deadline, no_show_open
from services.match_lead import lead_view
from services.match_planning import ensure_tournament_accepts_results
from services.match_v2_results import MatchV2ResultError
from services.result_hold import ensure_no_hold
from services.v2_match_flows import no_show_keeps_heat_open
from services.permissions import area_refusal
from services.tournament_checkin_board import checkin_board
from services.tournament_rules import self_checkin_allowed, tournament_event_mode
from services.tournament_permissions import (
    CHECKIN_STAFF_ROLES,
    READ_STAFF_ROLES,
    RESULT_STAFF_ROLES,
    STRUCTURE_STAFF_ROLES,
    has_match_result_permission,
    has_tournament_staff_permission,
)
from services.visibility import hide_unseen_event_links


@router.get("/{tid}/lead")
async def tournament_lead(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    if not await has_tournament_staff_permission(me, tournament_id, READ_STAFF_ROLES | RESULT_STAFF_ROLES, capability=READ):
        raise HTTPException(status_code=403, detail="Diese Ansicht ist nur für die Turnierleitung dieses Turniers.")
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    view = await lead_view(db, tournament, me)
    # Das Event (#1801): Die Ansicht zeigt Stationen, die sich die Turniere eines Events teilen, und lädt bei dessen
    # Änderungen nach. Die Kennung nur, wenn die Person das Event sehen darf (#1473).
    view["tournament"]["event_id"] = tournament.get("event_id")
    # Reiter „Check-in“ (#1161): nur mit Check-in-Recht - dieselbe Prüfung wie der Check-in-Weg; in einer Staffel nie.
    view["tournament"]["can_check_in"] = not is_league_staffel(tournament) and await has_tournament_staff_permission(
        me, tournament_id, CHECKIN_STAFF_ROLES, capability="matches")
    # Checken die Spieler selbst ein (online, hybrid)? Dann öffnet die Seite im Check-in nicht von selbst den Reiter.
    view["tournament"]["self_checkin"] = self_checkin_allowed(tournament)
    # Reiter „Hinweis“ (#1166): nur, wer Hinweise schreiben darf; „Pause bis“ gleich mitsetzen nur mit dem Recht, den
    # Turnierstatus zu wechseln (dieselbe Prüfung wie PUT …/pause und POST …/status).
    from services.tournament_notices import can_write as can_write_notice

    view["tournament"]["can_notice"] = await can_write_notice(me, tournament_id)
    view["tournament"]["can_pause"] = await has_tournament_staff_permission(me, tournament_id, STRUCTURE_STAFF_ROLES,
                                                                            "tournament", capability="manage")
    view["tournament"]["paused_until"] = tournament.get("paused_until")
    # Spielzeit-Uhr (#1167): seit wann die Pause läuft - die Uhren stehen so lange.
    view["tournament"]["paused_at"] = tournament.get("paused_at")
    await hide_unseen_event_links(db, me, [view["tournament"]])
    return view


@router.get("/{tid}/lead/checkin")
async def tournament_lead_checkin(tid: str, response: Response, me: dict = Depends(get_current_user)):
    """Reiter „Check-in“ (#1161): wer da ist, je Anmeldung bzw. Team, mit dem Stand des Startgelds. Dieselben Rollen wie
    der Check-in-Weg (Organisation, Schiedsrichter, Ergebnisdienst, Stationsleitung); abgehakt wird dort."""
    # Namen der Angemeldeten: nie in einem gemeinsamen Zwischenspeicher.
    response.headers["Cache-Control"] = "private, no-store"
    db = get_db()
    tournament_id = await _resolve_tid(tid)
    if not await has_tournament_staff_permission(me, tournament_id, CHECKIN_STAFF_ROLES, capability="matches"):
        raise HTTPException(status_code=403, detail="Den Check-in macht die Turnierleitung dieses Turniers.")
    tournament = await db.tournaments.find_one(
        {"id": tournament_id},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "team_mode": 1, "team_size": 1, "event_mode": 1, "is_online": 1,
         "is_hybrid": 1, "status": 1, "league_context": 1, "check_in_from": 1, "check_in_until": 1, "check_in_closed_at": 1})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    head = {"id": tournament["id"], "slug": tournament.get("slug"), "title": tournament.get("title"),
            "event_mode": tournament_event_mode(tournament), "team_mode": tournament.get("team_mode") or "solo",
            "check_in_from": tournament.get("check_in_from"), "check_in_until": tournament.get("check_in_until"),
            "self_checkin": self_checkin_allowed(tournament)}
    # Liga-Staffel (S18): kein Check-in der Anmeldungen - die Liga hat ihren eigenen je Spiel.
    if is_league_staffel(tournament):
        return {"applies": False, "tournament": head, "rows": [], "counts": {}}
    show_amounts = await area_refusal(me, ("finance",), db) is None
    board = await checkin_board(db, tournament, show_amounts=show_amounts)
    return {**board, "tournament": head}


STALE_PROPOSAL_DETAIL = ("Der Vorschlag gilt nicht mehr: Das Spiel hat begonnen, eine Seite hat gemeldet, "
                         "die Paarung oder der Termin hat sich geändert. Bitte das Ergebnis-Fenster nutzen.")


class NoShowDecision(BaseModel):
    """„Nicht erschienen?“ entscheiden: ``confirm`` mit der Seite, die fehlt, oder ``extend`` um ein paar Minuten."""
    model_config = ConfigDict(extra="forbid")

    action: Literal["confirm", "extend"]
    registration_id: str | None = Field(default=None, max_length=120)
    minutes: int = Field(default=5, ge=1, le=60)
    # Notausnahme des Superadmins bei Befangenheit (#2203).
    conflict_reason: str | None = Field(default=None, max_length=500)


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
    match = await db.matches_v2.find_one({"id": match_id, "tournament_id": tournament_id}, {"_id": 0})
    if not match:
        raise HTTPException(status_code=404, detail="Spiel nicht gefunden")
    if not await has_match_result_permission(me, match):
        raise HTTPException(status_code=403, detail="Keine Turnierberechtigung für diese Aktion")
    await require_no_conflict(db, me, match, action="no_show", conflict_reason=body.conflict_reason)
    await _ensure_tournament_unlocked(db, tournament_id)
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0}) or {}
    # Liga-Staffel (#2201): ohne Check-in entsteht kein Vorschlag mehr - die Leitung wertet trotzdem, solange nichts gemeldet ist.
    # Mit Check-in (D.2, #1652) nur über den Vorschlag des Jobs, also erst nach dem Fenster - vorher kann niemand „fehlen“.
    league_staffel = is_league_staffel(tournament)
    with_checkin = checkin_rules.rules_of(tournament) is not None
    if not isinstance(match.get("no_show_proposal"), dict) and not (league_staffel and body.action == "confirm" and not with_checkin):
        detail = "Für dieses Spiel liegt kein Vorschlag „nicht erschienen“ vor."
        if with_checkin:
            detail += " Er kommt erst, wenn das Check-in-Fenster zu ist und eine Seite fehlt."
        raise HTTPException(status_code=409, detail=detail)
    proposal = match.get("no_show_proposal") if isinstance(match.get("no_show_proposal"), dict) else {}
    # Schon bestätigt: im Duell der ganze Vorschlag, im Lauf diese eine Person (#1823: je Person). Mit Stand - im Lauf
    # bleibt er offen, im Duell ist er „forfeit“; danach richtet sich die Rückmeldung.
    already = proposal.get("decision") == "confirmed" or body.registration_id in (match.get("no_show_registration_ids") or [])
    if league_staffel and body.registration_id and match.get("forfeit_registration_id") == body.registration_id:
        already = True
    if already and body.action == "confirm":
        return {"ok": True, "idempotent_replay": True, "match_id": match_id, "status": match.get("status")}
    now = now_utc()
    stage_id = match.get("stage_id")
    stage = await db.tournament_stages.find_one({"id": stage_id}, {"_id": 0}) if stage_id else None
    if with_checkin:
        # Liga-Check-in (D.2, #1652): der Vorschlag gehört zum Fenster des aktuellen Termins - für „verlängern“ wie für „kampflos“.
        # Nach einem neuen Termin oder einer Verlängerung gilt er nicht mehr, auch wenn der Job ihn noch nicht weggeräumt hat.
        info = no_show_deadline(match, tournament, stage)
        if not (info and info["due_at"] <= now and proposal.get("rule") == "check_in"
                and _parse(proposal.get("due_at")) == info["due_at"]):
            raise HTTPException(status_code=409, detail=STALE_PROPOSAL_DETAIL)
    if body.action == "extend":
        start = max(now, _parse(proposal.get("due_at")) or now)
        until = (start + timedelta(minutes=body.minutes)).isoformat()
        await db.matches_v2.update_one({"id": match_id}, {
            "$set": {"no_show_extended_until": until, "updated_at": now.isoformat()},
            "$unset": {"no_show_proposal": ""},
        })
        await _audit(db, "match.no_show.extended", match, me["id"], {"proposal_id": proposal.get("id"), "until": until})
        return {"ok": True, "extended_until": until, "idempotent_replay": False}

    # Vorfälle (D.5, #1619, Nr. 146): Solange ein Vorfall offen ist, wird nicht „nicht erschienen“ gewertet - erst entscheiden.
    from services.league_incident_rules import forfeit_refusal

    blocked = forfeit_refusal(match)
    if blocked:
        raise HTTPException(status_code=409, detail=blocked)
    filled = [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]
    if body.registration_id not in filled:
        raise HTTPException(status_code=422, detail="Bitte die Seite wählen, die nicht erschienen ist.")
    await ensure_tournament_accepts_results(db, tournament_id)
    # Gilt der Vorschlag noch? Dieselbe Paarung, nicht begonnen, keine Meldung, Frist um - sonst keine Wertung.
    same_pairing = sorted(proposal.get("registration_ids") or filled) == sorted(filled)
    if league_staffel:
        # Mit Check-in oben geprüft; ohne Check-in läuft keine Frist - es zählt nur, dass das Spiel noch offen ist.
        still_valid = with_checkin or no_show_open(match)
    else:
        info = no_show_deadline(match, tournament, stage)
        still_valid = bool(info and info["due_at"] <= now)
    if not same_pairing or not still_valid:
        raise HTTPException(status_code=409, detail=STALE_PROPOSAL_DETAIL)
    if proposal.get("rule") == "check_in" and body.registration_id not in (proposal.get("missing_registration_ids") or []):
        # Kampflos verliert nur, wer nicht eingecheckt hat - nie die Seite, die da war.
        raise HTTPException(status_code=422, detail="Diese Seite hat eingecheckt. Kampflos verlieren kann nur die Seite ohne Check-in.")
    minutes = int(proposal.get("minutes") or 0)
    if proposal.get("rule") == "check_in":
        # Liga-Check-in (D.2, #1652): die Seite hat bis zum Ende des Fensters nicht eingecheckt - die Leitung entscheidet.
        until = _parse(proposal.get("due_at"))
        clock = until.astimezone(ZoneInfo("Europe/Vienna")).strftime("%H:%M") if until else ""
        note = f"Nicht erschienen – Check-in bis {clock} nicht erfolgt" if clock else "Nicht erschienen – Check-in nicht erfolgt"
    elif minutes:
        note = f"Nicht erschienen – Frist von {minutes} Minuten abgelaufen"
    else:
        note = "Nicht erschienen – von der Turnierleitung festgestellt"
    per_person = no_show_keeps_heat_open(match)
    try:
        ensure_no_hold(match)
        # Liga-Verfahren offen (#1619, E.2): Die Wertung entscheidet es mit - als Begründung bekommen die Seiten einen Satz,
        # nicht den Kurztext der Automatik.
        from services import league_procedures
        decision_note = await league_procedures.no_show_decision_note(db, match, body.registration_id, note)
        decided = await apply_forfeit(db, match, body.registration_id, note=note, actor_id=me["id"], force=False,
                                      decision_note=decision_note)
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None
    if per_person and proposal:
        # Im Lauf (#1823): der Vorschlag bleibt für die anderen offen - bestätigt ist nur diese Person.
        await db.matches_v2.update_one({"id": match_id}, {"$addToSet": {"no_show_proposal.confirmed_ids": body.registration_id}})
    elif proposal:
        await db.matches_v2.update_one({"id": match_id}, {"$set": {
            "no_show_proposal.decision": "confirmed", "no_show_proposal.decided_by": me["id"],
            "no_show_proposal.decided_at": now.isoformat(),
        }})
    await _audit(db, "match.no_show.confirmed", match, me["id"],
                 {"proposal_id": proposal.get("id"), "registration_id": body.registration_id})
    return {"ok": True, "match_id": match_id, "status": decided.get("status"), "idempotent_replay": False}
