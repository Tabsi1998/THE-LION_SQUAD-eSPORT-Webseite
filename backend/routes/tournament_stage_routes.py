"""Phasen verwalten und ihre Spiele erzeugen.
"""
import copy
import hashlib
import json
import logging
from fastapi import HTTPException, Depends
from pydantic import BaseModel, Field
from database import get_db
from auth import get_current_user, get_optional_user
from services.tournament_permissions import (
    RESULT_STAFF_ROLES,
    STRUCTURE_STAFF_ROLES,
    require_tournament_staff_permission,
)
from services.advancement_draw import (
    MODE_KEY,
    SETTING_KEY as LEGACY_MODE_KEY,
    SHOW_MINUTES_KEY,
    normalize_mode,
    sync_advancement_fields,
)
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.draw_show import perform_show_draw, write_draw_sets
from services.competition_versions import persist_competition_versions
from services.draw_records import record_build_draws, record_draws
from services.heat_rebuild import evaluate_after_write
from services.match_v2_results import (
    MatchV2ResultError,
    build_league_redraw_application,
    build_redraw_application,
    build_v2_result_application,
    public_recalculation_error,
)
from models import TournamentStageCreate, TournamentStageUpdate, now_utc, new_id
from services.match_public_view import public_match_view, public_stage_view
from services.round_labels import attach_round_labels
from routes.tournament_common import (
    _apply_match_plan,
    _audit_tournament_action,
    _collect_match_plan,
    _ensure_tournament_unlocked,
    _get_visible_tournament,
    _is_staff,
    _is_tournament_staff,
    _resolve_tid,
    _serialized_tournament_write,
    _v2_plan_key,
)
from routes.tournament_router import router

logger = logging.getLogger("tls.tournament")


# --- Tournament v2 stage groundwork ---
@router.get("/{tid}/stages")
async def list_tournament_stages(tid: str, user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _get_visible_tournament(tid, user)
    stages = await db.tournament_stages.find(
        {"tournament_id": tid},
        {"_id": 0},
    ).sort("number", 1).to_list(200)
    if _is_staff(user) or await _is_tournament_staff(tid, user):
        return [{key: value for key, value in stage.items() if key != "creation_key"} for stage in stages]
    return [public_stage_view(stage) for stage in stages]


def _sync_stage_settings(settings) -> None:
    """Weiterkommen je Phase (#1590): Modus und alter Schalter im Gleichschritt; leer heißt „vom Turnier erben“.
    Die Minuten der Show-Auslosung bleiben eine Zahl ab 1 oder fallen weg."""
    if not isinstance(settings, dict):
        return
    if MODE_KEY in settings or LEGACY_MODE_KEY in settings:
        if normalize_mode(settings.get(MODE_KEY)) is None and settings.get(MODE_KEY) not in (None, ""):
            raise HTTPException(status_code=422, detail="Unbekannter Modus für das Weiterkommen.")
        sync_advancement_fields(settings, stage=True)
    if SHOW_MINUTES_KEY in settings:
        try:
            minutes = int(settings.get(SHOW_MINUTES_KEY) or 0)
        except (TypeError, ValueError):
            minutes = 0
        if minutes < 1 or minutes > 240:
            settings[SHOW_MINUTES_KEY] = None
        else:
            settings[SHOW_MINUTES_KEY] = minutes


@router.post("/{tid}/stages")
async def create_tournament_stage(tid: str, body: TournamentStageCreate,
                                  me: dict = Depends(get_current_user),
                                  _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    doc = body.model_dump()
    _sync_stage_settings(doc.get("settings"))
    creation_digest = hashlib.sha256(
        json.dumps(body.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    creation_key = f"{tid}:{me['id']}:{creation_digest}"
    existing_creation = await db.tournament_stages.find_one({"creation_key": creation_key}, {"_id": 0})
    if existing_creation:
        existing_creation.pop("creation_key", None)
        return {**existing_creation, "idempotent_replay": True}
    if doc.get("number") is None:
        last = await db.tournament_stages.find(
            {"tournament_id": tid},
            {"_id": 0, "number": 1},
        ).sort("number", -1).to_list(1)
        doc["number"] = int((last[0].get("number") if last else 0) or 0) + 1
    duplicate = await db.tournament_stages.find_one(
        {"tournament_id": tid, "number": doc["number"]},
        {"id": 1},
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Stage-Nummer existiert bereits")
    doc["id"] = new_id()
    doc["creation_key"] = creation_key
    doc["tournament_id"] = tid
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = doc["created_at"]
    doc["created_by"] = me["id"]
    await db.tournament_stages.insert_one(doc)
    await _audit_tournament_action(
        db,
        "tournament.stage.create",
        me.get("id"),
        tid,
        {"stage_id": doc["id"], "stage_type": doc["stage_type"], "match_type": doc["match_type"]},
    )
    doc.pop("_id", None)
    doc.pop("creation_key", None)
    return {**doc, "idempotent_replay": False}


@router.patch("/{tid}/stages/{stage_id}")
@router.put("/{tid}/stages/{stage_id}")
async def update_tournament_stage(tid: str, stage_id: str, body: TournamentStageUpdate,
                                  me: dict = Depends(get_current_user),
                                  _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    current = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not current:
        raise HTTPException(status_code=404, detail="Stage nicht gefunden")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    _sync_stage_settings(updates.get("settings"))
    if "number" in updates:
        duplicate = await db.tournament_stages.find_one(
            {"id": {"$ne": stage_id}, "tournament_id": tid, "number": updates["number"]},
            {"id": 1},
        )
        if duplicate:
            raise HTTPException(status_code=409, detail="Stage-Nummer existiert bereits")
    updates["updated_at"] = now_utc().isoformat()
    await db.tournament_stages.update_one({"id": stage_id}, {"$set": updates})
    await _audit_tournament_action(
        db,
        "tournament.stage.update",
        me.get("id"),
        tid,
        {"stage_id": stage_id, "updates": {k: v for k, v in updates.items() if k != "updated_at"}},
    )
    updated = await db.tournament_stages.find_one({"id": stage_id}, {"_id": 0})
    updated.pop("creation_key", None)
    return updated


@router.delete("/{tid}/stages/{stage_id}")
async def delete_tournament_stage(tid: str, stage_id: str, me: dict = Depends(get_current_user),
                                  _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    stage = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not stage:
        raise HTTPException(status_code=404, detail="Stage nicht gefunden")
    match_ids = await db.matches_v2.distinct("id", {"stage_id": stage_id})
    await db.tournament_stages.delete_one({"id": stage_id})
    await db.matches_v2.delete_many({"stage_id": stage_id})
    if match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
    await _audit_tournament_action(
        db,
        "tournament.stage.delete",
        me.get("id"),
        tid,
        {"stage_id": stage_id, "match_count": len(match_ids)},
    )
    return {"ok": True}


@router.get("/{tid}/matches-v2")
async def list_tournament_matches_v2(tid: str, stage_id: str | None = None,
                                     user=Depends(get_optional_user)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _get_visible_tournament(tid, user)
    q = {"tournament_id": tid}
    if stage_id:
        q["stage_id"] = stage_id
    matches = await db.matches_v2.find(q, {"_id": 0}).sort([("round", 1), ("match_key", 1)]).to_list(2000)
    # Runden wie im Baum (#1860): „Winner Runde 2“, „Loser Runde 1“ - etwa für den Kasten „Auslosung“ der Verwaltung.
    stages = await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0, "id": 1, "stage_type": 1}).to_list(200)
    attach_round_labels(matches, stages, tournament)
    if _is_staff(user) or await _is_tournament_staff(tid, user):
        return matches
    # Ohne Turnier-Recht dieselbe Sicht wie auf der Spielseite und im Turnierbaum.
    viewer_id = (user or {}).get("id")
    return [public_match_view(match, viewer_id) for match in matches]


@router.post("/{tid}/matches-v2/recalculate-advancement")
async def recalculate_tournament_matches_v2_advancement(tid: str, stage_id: str | None = None,
                                                        me: dict = Depends(get_current_user),
                                                        _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, RESULT_STAFF_ROLES)
    q = {"tournament_id": tid}
    if stage_id:
        q["stage_id"] = stage_id
    stage_matches = await db.matches_v2.find(q, {"_id": 0}).sort([
        ("stage_number", 1),
        ("round", 1),
        ("order", 1),
        ("match_key", 1),
    ]).to_list(3000)
    by_id = {match["id"]: match for match in stage_matches if match.get("id")}
    completed = [
        match for match in stage_matches
        if match.get("status") in {"completed", "forfeit"} and match.get("results")
    ]
    now_iso = now_utc().isoformat()
    updated_match_ids: set[str] = set()
    errors = []

    for original in completed:
        match = by_id.get(original["id"], original)
        try:
            application = build_v2_result_application(
                match,
                list(by_id.values()),
                match.get("results") or [],
                actor_id=me["id"],
                now_iso=now_iso,
                proof_url=(match.get("result_meta") or {}).get("proof_url"),
                note=(match.get("result_meta") or {}).get("note"),
                force=True,
            )
        except MatchV2ResultError as exc:
            logger.warning(
                "[tournament] advancement recalculation rejected match=%s type=%s",
                match.get("id"),
                type(exc).__name__,
            )
            errors.append(public_recalculation_error(match))
            continue

        for target_id, update in application["target_sets"].items():
            await db.matches_v2.update_one({"id": target_id}, {"$set": update})
            if target_id in by_id:
                by_id[target_id].update(update)
            updated_match_ids.add(target_id)
        await record_draws(db, application.get("draws"), actor_id=me.get("id"), tournament_id=tid)

    await _audit_tournament_action(
        db,
        "tournament.matches_v2.recalculate_advancement",
        me.get("id"),
        tid,
        {
            "stage_id": stage_id,
            "source_match_count": len(completed),
            "updated_match_count": len(updated_match_ids),
            "error_count": len(errors),
        },
    )
    await evaluate_after_write(db, tid, actor_id=me.get("id"), trigger="recalculate")
    return {
        "ok": not errors,
        "source_match_count": len(completed),
        "updated_match_count": len(updated_match_ids),
        "updated_match_ids": sorted(updated_match_ids),
        "errors": errors,
    }


@router.post("/{tid}/stages/{stage_id}/generate")
async def generate_tournament_stage_matches(tid: str, stage_id: str, force: bool = False,
                                            preview: bool = False,
                                            me: dict = Depends(get_current_user),
                                            _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    stage = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not stage:
        raise HTTPException(status_code=404, detail="Stage nicht gefunden")
    existing_matches = await db.matches_v2.find({"stage_id": stage_id}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan(existing_matches)
    existing = len(existing_matches)
    can_replace_preview = bool(existing_matches) and all(m.get("is_preview") for m in existing_matches)
    if existing and not force and not can_replace_preview:
        raise HTTPException(
            status_code=409,
            detail="Stage hat bereits Matches. Mit force=true neu generieren.",
        )
    registrations = []
    if not preview:
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
            {"_id": 0},
        ).to_list(5000)
    try:
        matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=preview)
    except BracketSchemaError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not matches:
        raise HTTPException(status_code=400, detail="Schema erzeugt keine Matches")
    _apply_match_plan(matches, match_plan, _v2_plan_key)

    if existing:
        match_ids = await db.matches_v2.distinct("id", {"stage_id": stage_id})
        if match_ids:
            await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
        await db.matches_v2.delete_many({"stage_id": stage_id})
    await db.matches_v2.insert_many(matches)
    await db.tournament_stages.update_one(
        {"id": stage_id},
        {"$set": {"status": "pending" if preview else "ready", "updated_at": now_utc().isoformat()}},
    )
    await persist_competition_versions(db, tournament, "graph")
    if not preview:
        await record_build_draws(db, matches, actor_id=me.get("id"))
    await _audit_tournament_action(
        db,
        "tournament.stage.generate",
        me.get("id"),
        tid,
        {
            "stage_id": stage_id,
            "match_count": len(matches),
            "force": force,
            "preview": preview,
            "stage_type": stage.get("stage_type"),
            "match_type": stage.get("match_type"),
        },
    )
    if not preview:
        # Unterbesetzte Läufe (#1550): nach jedem Bau prüfen.
        await evaluate_after_write(db, tid, actor_id=me.get("id"), trigger="generate")
    return {"ok": True, "stage_id": stage_id, "match_count": len(matches), "preview": preview}


class StageRedrawPayload(BaseModel):
    # Die Auslosungs-Gruppe (``settings.draw_group`` der Folgespiele, z. B. „WB:2“); leer bei der Liga.
    group: str | None = Field(default=None, max_length=80)


async def _write_redraw(db, originals: dict[str, dict], target_sets: dict[str, dict]) -> None:
    """Alles oder nichts (Compare-and-Set) - dieselbe Schreibregel wie „Jetzt auslosen“ (services/draw_show)."""
    try:
        await write_draw_sets(db, originals, target_sets)
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/{tid}/stages/{stage_id}/draw")
async def draw_tournament_stage(tid: str, stage_id: str, body: StageRedrawPayload | None = None,
                                me: dict = Depends(get_current_user),
                                _mutation_tid: str = Depends(_serialized_tournament_write)):
    """„Jetzt auslosen“ (Show-Auslosung, #1590): die Turnierleitung mit Aufbau-Recht legt das Los einer bereiten Runde.
    Vorher 409, zweimal 409, unbekannte Gruppe 404. Unter der Turnier-Schreibsperre, alles oder nichts; Protokoll
    ``tournament.draw.done`` mit Person, dazu das Live-Ereignis ``draw_done``."""
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    tournament = await _ensure_tournament_unlocked(db, tid)
    stage = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not stage:
        raise HTTPException(status_code=404, detail="Phase nicht gefunden")
    group = ((body.group if body else None) or "").strip()
    if not group:
        raise HTTPException(status_code=422, detail="Bitte angeben, welche Runde ausgelost werden soll.")
    try:
        return await perform_show_draw(db, tournament, stage_id, group, actor_id=me.get("id"), trigger="show")
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/{tid}/stages/{stage_id}/redraw")
async def redraw_tournament_stage(tid: str, stage_id: str, body: StageRedrawPayload | None = None,
                                  me: dict = Depends(get_current_user),
                                  _mutation_tid: str = Depends(_serialized_tournament_write)):
    """„Neu auslosen“ (#1548): die Turnierleitung lost eine Folgerunde neu aus - oder bei der Liga die Spieltage -,
    solange keines der betroffenen Spiele begonnen hat (sonst 409). Unter der Turnier-Schreibsperre; Protokoll mit
    Person, Zeitpunkt und Ergebnis, dazu das Live-Ereignis ``draw_done``."""
    db = get_db()
    tid = await _resolve_tid(tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    tournament = await _ensure_tournament_unlocked(db, tid)
    stage = await db.tournament_stages.find_one({"id": stage_id, "tournament_id": tid}, {"_id": 0})
    if not stage:
        raise HTTPException(status_code=404, detail="Phase nicht gefunden")
    stage_matches = await db.matches_v2.find({"stage_id": stage_id, "is_preview": {"$ne": True}}, {"_id": 0}).to_list(3000)
    # Wie gelesen - die Auslosung ändert die Spiele im Speicher, geschrieben wird nur gegen diesen Stand.
    originals = {match["id"]: copy.deepcopy(match) for match in stage_matches}
    group = ((body.group if body else None) or "").strip()
    now_iso = now_utc().isoformat()
    try:
        if group:
            # Wer ausgetreten oder disqualifiziert ist, kommt auch beim neuen Los nicht zurück (#1839).
            from services.v2_result_submission import eliminated_registration_ids
            application = build_redraw_application(stage_matches, group, now_iso=now_iso,
                                                   eliminated=await eliminated_registration_ids(db, tid))
        elif stage.get("stage_type") == "league":
            application = build_league_redraw_application(stage_matches, now_iso=now_iso)
        else:
            raise MatchV2ResultError("Bitte angeben, welche Runde neu ausgelost werden soll.", 422)
    except MatchV2ResultError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    await _write_redraw(db, originals, application["target_sets"])
    await record_draws(db, application["draws"], actor_id=me.get("id"), tournament_id=tid)
    # Erst auslosen, dann umbauen (#1550): die neue Belegung kann Läufe zusammenlegen oder ausgleichen.
    await evaluate_after_write(db, tid, actor_id=me.get("id"), trigger="redraw")
    if not group:
        # Die Spieltage haben sich verschoben: Termine der Liga neu rechnen (von Hand gesetzte bleiben).
        from services.matchday_schedule import persist_matchday_schedule
        await persist_matchday_schedule(db, tournament)
    draw = application["draw"]
    return {
        "ok": True,
        "draw": {key: draw.get(key) for key in ("id", "group", "kind", "trigger", "drawn_at", "assignments")},
        "updated_match_ids": sorted(application["target_sets"]),
    }
