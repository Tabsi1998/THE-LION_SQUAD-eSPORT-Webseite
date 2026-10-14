"""Spielplan planen und übernehmen (#1552).

„Planen“ zeigt, was der Planer schreiben würde - Zeit und Station je Spiel, dazu Warnungen - und schreibt nichts.
„Übernehmen“ braucht den Fingerabdruck der gesehenen Vorschau, rechnet den Plan unter dem Turnier-Lock noch einmal
und schreibt alles auf einmal; hat sich der Plan seither geändert, kommt 409 statt eines anderen Plans als gezeigt.
"""
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user
from database import get_db
from services.match_deadlines import auto_confirm_due, no_show_deadline, opened_at
from services.match_scheduler import apply_plan, plan_for_tournament
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
    await require_tournament_staff_permission(me, tid, STATION_ASSIGN_ROLES, "tournament")
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    return tournament


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
    await require_tournament_staff_permission(me, tid, READ_STAFF_ROLES, "tournament")
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
