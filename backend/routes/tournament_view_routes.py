"""Turnierbaum, Tabelle und Spielwochen lesen; Planungsprüfung und Spielplan-Export.
"""
import csv
import io
from fastapi import HTTPException, Depends
from fastapi.responses import StreamingResponse
from database import get_db
from models import now_utc
from auth import get_current_user, get_optional_user
from services.access_links import touch_access_link, validate_access_link
from services.tv_display import DISPLAY_GRANT, KEY_EXPIRED, KEY_INVALID, display_bracket_payload, key_expired, seat_summary
from services.public_phase import derive_public_phase
from services.station_labels import attach_station_info
from services.match_public_view import public_match_view, public_stage_view, public_tournament_view
from services.tournament_permissions import READ_STAFF_ROLES, require_tournament_staff_permission
from services.matchday_schedule import build_matchday_plan, current_matchday_number
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import standings_for_structure
from routes.tournament_common import (
    _collect_plan_matches,
    _get_visible_tournament,
    _is_staff,
    _is_tournament_staff,
    _plan_duration,
    _plan_match_label,
    _plan_station_label,
    _planning_report,
    _public_registration,
    _resolve_tid,
)
from routes.tournament_router import router


@router.get("/{tid}/planning-check")
async def planning_check(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    matches, tournament = await _collect_plan_matches(db, tid)
    participant_count = await db.tournament_registrations.count_documents({
        "tournament_id": tid,
        "status": {"$in": ["approved", "checked_in"]},
    })
    return _planning_report(matches, tournament, participant_count=participant_count)


@router.get("/{tid}/match-plan.csv")
async def export_match_plan_csv(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    matches, tournament = await _collect_plan_matches(db, tid)
    reg_ids = set()
    for match in matches:
        if match.get("slots"):
            reg_ids.update(slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id"))
        else:
            reg_ids.update([match.get("participant_a_id"), match.get("participant_b_id")])
    regs = await db.tournament_registrations.find({"id": {"$in": list(reg_ids)}}, {"_id": 0}).to_list(1000) if reg_ids else []
    reg_map = {reg["id"]: reg for reg in regs}

    def _participants(match: dict) -> str:
        if match.get("slots"):
            labels = []
            for slot in match.get("slots") or []:
                reg = reg_map.get(slot.get("registration_id"))
                labels.append(reg.get("display_name") or reg.get("ingame_name") if reg else (slot.get("source") or {}).get("raw") or f"Slot {slot.get('slot')}")
            return " vs ".join([label for label in labels if label])
        labels = []
        for reg_id in [match.get("participant_a_id"), match.get("participant_b_id")]:
            reg = reg_map.get(reg_id)
            labels.append(reg.get("display_name") or reg.get("ingame_name") if reg else (reg_id or "Offen"))
        return " vs ".join(labels)

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["Turnier", "Match", "Bereich", "Runde", "Start", "Dauer", "Station", "Status", "Teilnehmer"])
    for match in matches:
        writer.writerow([
            tournament.get("title") or tid,
            _plan_match_label(match),
            match.get("section") or match.get("bracket") or "",
            match.get("round_name") or match.get("round") or "",
            match.get("scheduled_at") or "",
            _plan_duration(match, tournament),
            _plan_station_label(match),
            match.get("status") or "",
            _participants(match),
        ])
    filename = f"matchplan_{tournament.get('slug') or tid}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


async def _build_bracket_payload(db, t: dict, user: dict | None, is_staff: bool) -> dict:
    t["public_phase"] = derive_public_phase(t, "tournament")
    read_model = await load_competition_read_model(db, t["id"])
    # Der klassische Speicher wird nicht mehr gelesen (#231); `matches` bleibt leer, damit Web und App
    # ihre Antwortform behalten.
    matches: list[dict] = []
    stages = read_model.stages
    matches_v2 = read_model.stage_matches
    await attach_station_info(db, matches_v2)
    if not is_staff:
        # Wer das Turnier nicht leitet, sieht im Baum dieselben Felder wie auf der Spielseite.
        viewer_id = (user or {}).get("id")
        matches_v2 = [public_match_view(match, viewer_id) for match in matches_v2]
        stages = [public_stage_view(stage) for stage in stages]
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    regs = [_public_registration(r, user, is_staff) for r in regs]
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0}).to_list(500)}
    for r in regs:
        if r.get("user_id"):
            u = users.get(r["user_id"]) or {}
            r["user"] = {"id": u.get("id"), "username": u.get("username"),
                         "display_name": u.get("display_name"), "avatar_url": u.get("avatar_url")}
    t["can_view_display"] = bool(is_staff)
    structure = read_model.structure_snapshot()
    observe_structure_read(structure, surface="bracket")
    return {
        # Die Abrechnung (`billing`) braucht der Baum nie; die Turnierseite zeigt sie nur dem Bereich Finanzen.
        "tournament": public_tournament_view(t),
        "matches": matches,
        "registrations": regs,
        "stages": stages,
        "matches_v2": matches_v2,
        "engine": "stage",
        "structure": structure,
    }


@router.get("/{tid}/bracket")
async def get_bracket(tid: str, access: str | None = None, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    access_link = await validate_access_link(db, access, "tournament", tid, user, "view")
    if access_link:
        t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    else:
        t = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user) or await _is_tournament_staff(tid, user)
    return await _build_bracket_payload(db, t, user, is_staff)


@router.get("/{tid}/bracket/display")
async def get_bracket_display(tid: str, key: str | None = None, me: dict | None = Depends(get_optional_user)):
    """Der Turnierbaum-TV: mit Anzeige-Schlüssel (#1110) ohne Anmeldung, sonst für die Turnierleitung.

    Ein Schlüssel öffnet nur die TV-Daten genau dieses Turniers. Steht einer im Link, zählt nur er - auch für
    Angemeldete; so sieht der Admin am TV dasselbe wie die Halle, auch nach dem Widerrufen.
    """
    db = get_db()
    tid = await _resolve_tid(tid)
    if key:
        link = await validate_access_link(db, key, "tournament", tid, None, DISPLAY_GRANT)
        if not link:
            raise HTTPException(status_code=403, detail=KEY_INVALID)
        t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
        if key_expired(t, now_utc()):
            raise HTTPException(status_code=403, detail=KEY_EXPIRED)
        await touch_access_link(db, link)
        return display_bracket_payload(await _build_bracket_payload(db, t, None, False))
    if not me:
        raise HTTPException(status_code=401, detail="Nicht angemeldet")
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES)
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    payload = await _build_bracket_payload(db, t, me, True)
    # Wie mit Schlüssel: die belegten Plätze für den Anmelde-Bildschirm (#1123).
    payload["seats"] = seat_summary(t, payload.get("registrations"))
    return payload


@router.get("/{tid}/matchdays")
async def matchdays(tid: str, access: str | None = None, user=Depends(get_optional_user)):
    """Die Spieltage als Wochen, mit dem Termin, der je Partie gilt.

    Wer eine Liga spielt, denkt in Spielwochen: Spieltag 3 ist eine Woche, nicht
    ein Zeitpunkt. Diese Antwort liefert das Fenster je Spieltag und dazu, welcher
    Termin je Partie gilt und warum - vereinbart, per Heimrecht oder als
    eingestellte Standardzeit. Formate mit Runden statt Wochen bekommen
    "applies": false und behalten ihre bisherige Gruppierung.
    """
    db = get_db()
    tid = await _resolve_tid(tid)
    access_link = await validate_access_link(db, access, "tournament", tid, user, "view")
    if access_link:
        t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    else:
        t = await _get_visible_tournament(tid, user)

    matches = await db.matches_v2.find(
        {"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(3000)
    proposals = await db.match_schedule_proposals.find(
        {"tournament_id": tid}, {"_id": 0, "match_collection": 0}).to_list(3000)
    plan = build_matchday_plan(t, matches, proposals)
    plan["current"] = current_matchday_number(plan)
    return plan


@router.get("/{tid}/standings")
async def standings(tid: str, access: str | None = None, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    access_link = await validate_access_link(db, access, "tournament", tid, user, "view")
    if access_link:
        t = await db.tournaments.find_one({"id": tid}, {"_id": 0})
        if not t:
            raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    else:
        t = await _get_visible_tournament(tid, user)
    is_staff = _is_staff(user) or await _is_tournament_staff(tid, user)
    read_model = await load_competition_read_model(db, tid)
    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
    regs = [_public_registration(r, user, is_staff) for r in regs]
    user_ids = list({r["user_id"] for r in regs if r.get("user_id")})
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0, "mfa_secret": 0, "mfa_pending_secret": 0, "mfa_recovery_code_hashes": 0}).to_list(500)}
    for r in regs:
        u = users.get(r.get("user_id") or "", {})
        r["display_name"] = r.get("display_name") or u.get("display_name") or u.get("username")
        r["user"] = {"id": u.get("id"), "username": u.get("username"), "display_name": u.get("display_name"), "avatar_url": u.get("avatar_url")}
    groups = []
    if t.get("format") == "groups":
        groups = await db.tournament_groups.find({"tournament_id": tid}, {"_id": 0}).to_list(50)
    structure = read_model.structure_snapshot()
    observe_structure_read(structure, surface="standings")
    return standings_for_structure(
        t,
        structure,
        regs,
        groups=groups,
    )
