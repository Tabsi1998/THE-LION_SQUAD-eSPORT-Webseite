"""Spielplan planen und übernehmen (#1552).

„Planen“ zeigt, was der Planer schreiben würde - Zeit und Station je Spiel, dazu Warnungen - und schreibt nichts.
„Übernehmen“ braucht den Fingerabdruck der gesehenen Vorschau, rechnet den Plan unter dem Turnier-Lock noch einmal
und schreibt alles auf einmal; hat sich der Plan seither geändert, kommt 409 statt eines anderen Plans als gezeigt.
"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from models import new_id, now_utc
from services import checkin_rules
from services.match_deadlines import auto_confirm_due, no_show_deadline, opened_at
from services.match_scheduler import DONE_STATUSES, RUNNING_STATUSES, apply_plan, plan_for_tournament, station_query
from services.league_permissions import BULK_CONFLICT_DETAIL, READ, involved_match_ids
from services.tournament_permissions import READ_STAFF_ROLES, STATION_ASSIGN_ROLES, require_tournament_staff_permission
from routes.tournament_common import _ensure_tournament_unlocked, _resolve_tid, _serialized_tournament_write
from routes.tournament_router import router


# So lange gilt eine Vorschau. Übernehmen rechnet mit dem Anker der Vorschau (``planned_at``), nicht mit „jetzt“ -
# sonst rückt bei einem begonnenen Turnier jede Sekunde den Plan und der Fingerabdruck passt nie.
PREVIEW_VALID_FOR = timedelta(minutes=10)
CLOCK_SKEW = timedelta(minutes=1)


class SchedulePlanApply(BaseModel):
    # Pflicht: Übernehmen gibt es nur zu einer gesehenen Vorschau - mit ihrem Fingerabdruck und ihrem Anker.
    fingerprint: str = Field(min_length=1)
    planned_at: datetime


async def _planning_tournament(db, tid: str, me: dict) -> dict:
    await require_tournament_staff_permission(me, tid, STATION_ASSIGN_ROLES, "tournament", capability="matches")
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return tournament


async def _refuse_own_matches(db, tournament: dict, me: dict, matches: list[dict]) -> None:
    """Termine auf einmal (#2203): Ist ein eigenes Spiel dabei, macht das eine zweite Person. Hier gibt es kein Feld für den Grund der
    Notausnahme - der Superadmin setzt den einzelnen Termin mit Grund (``PATCH /matches``)."""
    if await involved_match_ids(db, me, tournament, matches):
        raise HTTPException(status_code=403, detail=BULK_CONFLICT_DETAIL)


@router.post("/{tid}/schedule/plan")
async def preview_schedule_plan(tid: str, me: dict = Depends(get_current_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _planning_tournament(db, tid, me)
    return await plan_for_tournament(db, tournament)


@router.post("/{tid}/schedule/apply")
async def apply_schedule_plan(tid: str, body: SchedulePlanApply, me: dict = Depends(get_current_user),
                              _mutation: str = Depends(_serialized_tournament_write)):
    # Unter dem Turnier-Lock: Plan rechnen, Fingerabdruck prüfen, schreiben - keine zweite Planung dazwischen.
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _planning_tournament(db, tid, me)
    await _ensure_tournament_unlocked(db, tid)
    anchor = body.planned_at if body.planned_at.tzinfo else body.planned_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if anchor < now - PREVIEW_VALID_FOR or anchor > now + CLOCK_SKEW:
        raise HTTPException(status_code=409, detail="Die Vorschau ist älter als zehn Minuten - bitte noch einmal Planen.")
    plan = await plan_for_tournament(db, tournament, now=anchor)
    if body.fingerprint != plan["fingerprint"]:
        raise HTTPException(status_code=409, detail="Der Plan hat sich inzwischen geändert - bitte noch einmal Planen.")
    # Der Plan setzt Termine (``assignments``) und löst sie (``releases``) - beides ändert das Spiel.
    planned = {row.get("match_id") or row.get("id") for row in [*(plan.get("assignments") or []), *(plan.get("releases") or [])]}
    await _refuse_own_matches(db, tournament, me, await db.matches_v2.find({"id": {"$in": sorted(id_ for id_ in planned if id_)}}, {"_id": 0}).to_list(3000))
    result = await apply_plan(db, tournament, plan)
    return {**result, "assignments": plan["assignments"], "fingerprint": plan["fingerprint"]}


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _all_sides_known(match: dict) -> bool:
    slots = [slot for slot in match.get("slots") or [] if (slot.get("source") or {}).get("type") != "bye" and slot.get("status") != "bye"]
    return len(slots) >= 2 and all(slot.get("registration_id") for slot in slots)


@router.get("/{tid}/schedule/deadlines")
async def schedule_deadlines(tid: str, me: dict = Depends(get_current_user)):
    """Fristen je Spiel für die Matchplan-Seite online und in der Liga (#1557): wann ein Spiel offen ist, wann
    „nicht erschienen“ greift und wann eine einzelne Meldung von selbst gilt. Gerechnet wie die Fristen-Prüfung
    (``services/match_deadlines``) - die Website zeigt nur an."""
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES, "tournament", capability=READ)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0, "creation_key": 0, "billing": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    stages = {stage["id"]: stage for stage in await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).to_list(200)}
    matches = await db.matches_v2.find({"tournament_id": tid, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(3000)
    rows = []
    for match in matches:
        stage = stages.get(match.get("stage_id") or "")
        no_show = no_show_deadline(match, tournament, stage)
        rows.append({
            "match_id": match.get("id"),
            "opened_at": _iso(opened_at(match, tournament)) if _all_sides_known(match) else None,
            "no_show_due_at": _iso(no_show["due_at"]) if no_show else None,
            "no_show_minutes": no_show["minutes"] if no_show else None,
            "result_due_at": _iso(auto_confirm_due(match, tournament, stage)),
        })
    return {"matches": rows}


class ScheduleRelease(BaseModel):
    # „all“: alle von Hand gesetzten Termine; „missing_stations“: nur Spiele an einer Station, die es nicht mehr gibt.
    scope: Literal["all", "missing_stations"] = "all"


@router.post("/{tid}/schedule/release")
async def release_schedule(tid: str, body: ScheduleRelease, me: dict = Depends(get_current_user),
                           _mutation: str = Depends(_serialized_tournament_write)):
    """Feste Termine auf einmal lösen (Praxis 14.10.): die alte Matchplanung hatte jedes Spiel von Hand gesetzt, auf einer
    inzwischen gelöschten Station. Danach plant „Automatisch planen“ alles neu. Nur Spiele, die noch nicht begonnen
    haben; Zeit, Station und Herkunft fallen weg, die eigene Dauer bleibt. Mit Protokolleintrag."""
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _planning_tournament(db, tid, me)
    await _ensure_tournament_unlocked(db, tid)
    # Auch Vorschau-Spiele (Baum bis Check-in-Ende): sie haben nie begonnen, und das Check-in-Ende trägt ihre Termine und
    # Stationen in den fixen Baum mit (_collect_match_plan) - Fabian live 14.10.
    matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    # Dieselben Stationen wie der Planer (station_query): was er als unbekannt meldet, wird hier auch gelöst.
    known = {station["id"] for station in await db.stations.find(station_query(tournament), {"_id": 0, "id": 1}).to_list(500)
             if station.get("id")}
    chosen = []
    for match in matches:
        status = str(match.get("status") or "")
        if status in DONE_STATUSES or status in RUNNING_STATUSES or match.get("started_at"):
            continue
        if body.scope == "all":
            if match.get("schedule_source") != "manual":
                continue
        elif not match.get("station_id") or match["station_id"] in known:
            continue
        chosen.append(match)
    await _refuse_own_matches(db, tournament, me, chosen)
    stamp = now_utc().isoformat()
    # Liga (D.2/D.3, #1652/#1618; Codex-Nachprüfung): ohne Termin gilt das alte Fenster nicht mehr, die Termin-Revision steigt -
    # alte Check-ins und ein laufendes Veto zählen nicht mehr. Für andere Turniere ändert new_time_change nichts.
    change = checkin_rules.new_time_change(tournament, {
        "$set": {"scheduled_at": None, "station_id": None, "schedule_source": None, "schedule_forecast": False, "updated_at": stamp},
        "$unset": {"called_at": ""}})
    released = []
    for match in chosen:
        # Compare-and-Set: nur wenn das Spiel noch so dasteht wie gelesen und nicht begonnen hat.
        result = await db.matches_v2.update_one(
            {"id": match["id"], "scheduled_at": match.get("scheduled_at"), "station_id": match.get("station_id"),
             "schedule_source": match.get("schedule_source"), "started_at": None}, change)
        if result.matched_count:
            released.append(match)
    if released:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "tournament.schedule.released", "target_id": tid, "actor_id": me.get("id"),
            "data": {"scope": body.scope, "released": len(released), "match_ids": [row["id"] for row in released],
                     "match_keys": [row.get("match_key") for row in released]},
            "created_at": stamp,
        })
    return {"released": len(released), "match_ids": [row["id"] for row in released], "scope": body.scope}
