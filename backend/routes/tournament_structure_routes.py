"""Turnierbaum aus dem Format planen, anwenden, neu aufbauen und zurücksetzen.
"""
import hmac
import random
from fastapi import HTTPException, Depends
from pydantic import Field
from database import get_db
from auth import get_current_user
from services.tournament_permissions import (
    STRUCTURE_STAFF_ROLES,
    require_tournament_staff_permission,
)
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.competition_engine import CLASSIC, GRAPH, EngineSwitchRequired, decide_rebuild_engine
from services.competition_formats import find_format_capability
from services.competition_graph_validation import validate_competition_graph
from services.competition_read import load_competition_read_model
from services.competition_snapshot import build_structure_snapshot
from services.competition_structure_plan import (
    STRUCTURE_PLAN_VERSION,
    deterministic_structure_id,
    ordered_plan_registrations,
    stabilize_stage_plan_matches,
    structure_plan_hash,
    structure_plan_seed,
)
from services.competition_structure_apply import (
    StructureApplyError,
    StructureApplyPreconditionError,
    activate_structure_plan,
)
from services.competition_versions import persist_competition_versions
from models import now_utc, new_id
from routes.tournament_common import (
    MAX_INITIAL_PREVIEW_MATCHES,
    TournamentBracketStructurePayload,
    _apply_match_plan,
    _audit_tournament_action,
    _collect_match_plan,
    _ensure_tournament_unlocked,
    _estimated_match_count,
    _resolve_tid,
    _serialized_tournament_write,
    _stage_defaults_for_tournament_format,
    _v2_plan_key,
)
from routes.tournament_router import router


MAX_STRUCTURE_PLAN_MATCHES = 5000


class TournamentStructurePlanPayload(TournamentBracketStructurePayload):
    preview: bool = True


class TournamentStructureApplyPayload(TournamentStructurePlanPayload):
    expected_plan_hash: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")
    expected_base_structure_hash: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


def _structure_plan_request_payload(body: TournamentStructurePlanPayload) -> dict:
    return {
        "stage_type": body.stage_type,
        "match_type": body.match_type,
        "name": body.name,
        "settings": body.settings,
        "preview": body.preview,
    }


def _can_rebuild_bracket_from_format(tournament: dict) -> bool:
    """Return whether either bracket engine supports the tournament format."""
    capability = find_format_capability(tournament.get("format"))
    if not capability or capability.rebuild_engine == "none":
        return False
    if capability.auto_match_limit == "legacy_estimate":
        estimate = _estimated_match_count(tournament)
        return 0 < estimate <= MAX_INITIAL_PREVIEW_MATCHES
    return True


# --- Bracket generation ---
async def _build_tournament_structure_plan(
    db,
    tid: str,
    tournament: dict,
    body: TournamentStructurePlanPayload,
):
    """Generate and validate a deterministic structure without writing it."""

    if not _can_rebuild_bracket_from_format(tournament):
        raise HTTPException(
            status_code=400,
            detail="Für dieses Format gibt es keinen automatischen Format-Bracket-Generator.",
        )

    read_model = await load_competition_read_model(db, tid)
    current_structure = read_model.structure_snapshot()
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    registrations = ordered_plan_registrations(registrations)

    stage_defaults = _stage_defaults_for_tournament_format(tournament, body)
    try:
        decision = decide_rebuild_engine(
            tournament.get("format"),
            preferred=GRAPH if stage_defaults else CLASSIC,
            stage_matches=read_model.stage_matches,
            allow_switch=bool(getattr(body, "allow_engine_switch", False)),
        )
    except EngineSwitchRequired as exc:
        raise HTTPException(status_code=409, detail={
            "code": "engine_switch_required",
            "message": exc.reason,
            "from_engine": exc.from_engine,
            "to_engine": exc.to_engine,
        })

    if not stage_defaults:
        raise HTTPException(
            status_code=400,
            detail="Für dieses Format ist kein Struktur-Generator aktiv.",
        )
    generator_registrations = registrations
    engine = decision.engine
    if not body.preview and len(generator_registrations) < 2:
        raise HTTPException(status_code=400, detail="Mindestens 2 Teilnehmer benötigt")

    request_payload = _structure_plan_request_payload(body)
    seed_data = structure_plan_seed(
        tournament,
        request_payload,
        generator_registrations,
        current_structure,
    )
    plan_seed = seed_data["seed"]
    rng = random.Random(plan_seed)
    match_plan = _collect_match_plan(read_model.stage_matches)
    stage = None

    if stage_defaults:
        stage_id = deterministic_structure_id(plan_seed, "stage", "1")
        generated_at = now_utc().isoformat()
        stage = {
            **stage_defaults,
            "id": stage_id,
            "tournament_id": tid,
            "created_at": generated_at,
            "updated_at": generated_at,
        }
        try:
            matches = build_matches_v2_from_schema(
                tournament,
                stage,
                generator_registrations,
                preview=body.preview,
                rng=rng,
            )
        except BracketSchemaError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if not matches:
            raise HTTPException(status_code=400, detail="Die Struktur erzeugt keine Spiele.")
        if len(matches) > MAX_STRUCTURE_PLAN_MATCHES:
            raise HTTPException(status_code=400, detail="Die Struktur erzeugt zu viele Spiele.")
        matches = stabilize_stage_plan_matches(
            matches,
            seed=plan_seed,
            stage_id=stage_id,
        )
        _apply_match_plan(matches, match_plan, _v2_plan_key)
        planned_structure = build_structure_snapshot(
            tid,
            stage_matches=matches,
            stages=[stage],
        )

    validation = validate_competition_graph(planned_structure)
    plan_hash = structure_plan_hash(
        engine=engine,
        base_structure_hash=seed_data["base_structure_hash"],
        input_hash=seed_data["input_hash"],
        planned_structure=planned_structure,
        stage=stage,
    )
    existing_matches = read_model.stage_matches
    force_required = (
        any(not match.get("is_preview") for match in existing_matches)
        or tournament.get("status") in {
            "live", "paused", "completed", "results_published", "archived", "cancelled",
        }
    )
    response = {
        "ok": validation["valid"],
        "plan_version": STRUCTURE_PLAN_VERSION,
        "plan_hash": plan_hash,
        "base_structure_hash": seed_data["base_structure_hash"],
        "input_hash": seed_data["input_hash"],
        "engine": engine,
        "preview": body.preview,
        "match_count": len(matches),
        "participant_count": len(registrations),
        "stage": stage,
        "structure": planned_structure,
        "validation": validation,
        "apply_requirements": {
            "expected_plan_hash": plan_hash,
            "expected_base_structure_hash": seed_data["base_structure_hash"],
            "force_required": force_required,
        },
        "replacement_impact": {
            "stage_match_count": len(read_model.stage_matches),
            "stage_count": len(read_model.stages),
        },
    }
    return response, matches, stage, read_model


@router.post("/{tid}/bracket/plan")
async def plan_bracket_from_tournament_format(
    tid: str,
    body: TournamentStructurePlanPayload,
    me: dict = Depends(get_current_user),
):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    response, _matches, _stage, _read_model = await _build_tournament_structure_plan(
        db,
        tid,
        tournament,
        body,
    )
    return response


@router.post("/{tid}/bracket/apply")
async def apply_tournament_structure_plan(
    tid: str,
    body: TournamentStructureApplyPayload,
    me: dict = Depends(get_current_user),
    _mutation_tid: str = Depends(_serialized_tournament_write),
):
    """Validate and activate exactly the structure that a caller previewed."""

    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)

    last_plan_hash = str(tournament.get("last_structure_plan_hash") or "")
    if last_plan_hash and hmac.compare_digest(last_plan_hash, body.expected_plan_hash):
        last_base_hash = str(tournament.get("last_structure_base_hash") or "")
        if not hmac.compare_digest(last_base_hash, body.expected_base_structure_hash):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "structure_plan_stale",
                    "message": "Der Basis-Hash gehört nicht zum bereits angewendeten Strukturplan.",
                },
            )
        return {
            "ok": True,
            "idempotent_replay": True,
            "plan_hash": last_plan_hash,
            "base_structure_hash": last_base_hash,
            "plan_version": tournament.get("last_structure_plan_version") or STRUCTURE_PLAN_VERSION,
            "engine": tournament.get("last_structure_engine") or (
                "graph" if tournament.get("engine_version") == "competition.graph.v1" else "classic"
            ),
            "structure_revision": int(tournament.get("structure_revision") or 0),
        }

    response, matches, stage, read_model = await _build_tournament_structure_plan(
        db,
        tid,
        tournament,
        body,
    )
    if not hmac.compare_digest(
        response["base_structure_hash"],
        body.expected_base_structure_hash,
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "structure_plan_stale",
                "message": "Die Turnierstruktur wurde seit der Vorschau verändert. Bitte neu planen.",
                "current_base_structure_hash": response["base_structure_hash"],
            },
        )
    if not hmac.compare_digest(response["plan_hash"], body.expected_plan_hash):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "structure_plan_changed",
                "message": "Die Eingaben oder Teilnehmer haben sich seit der Vorschau verändert. Bitte neu planen.",
                "current_plan_hash": response["plan_hash"],
            },
        )
    if not response["validation"]["valid"]:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "structure_plan_invalid",
                "message": "Der Strukturplan ist ungültig und wurde nicht angewendet.",
                "validation": response["validation"],
            },
        )
    if response["apply_requirements"]["force_required"]:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "protected_existing_structure",
                "message": (
                    "Der sichere Apply-Weg ersetzt nur leere oder reine Preview-Strukturen. "
                    "Reale Matches und laufende oder historische Turniere bleiben unverändert."
                ),
                "replacement_impact": response["replacement_impact"],
            },
        )

    try:
        result = await activate_structure_plan(
            db,
            tournament=tournament,
            engine=response["engine"],
            matches=matches,
            stage=stage,
            previous_stage_matches=read_model.stage_matches,
            previous_stages=read_model.stages,
            plan_hash=response["plan_hash"],
            base_structure_hash=response["base_structure_hash"],
            plan_version=STRUCTURE_PLAN_VERSION,
            actor_id=me.get("id"),
        )
    except StructureApplyPreconditionError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": "structure_apply_precondition", "message": str(exc)},
        ) from exc
    except StructureApplyError as exc:
        raise HTTPException(
            status_code=500,
            detail={"code": "structure_apply_rollback_failed", "message": str(exc)},
        ) from exc

    return {
        **result,
        "plan_version": STRUCTURE_PLAN_VERSION,
        "validation": response["validation"],
    }


@router.post("/{tid}/bracket/from-format")
async def rebuild_bracket_from_tournament_format(tid: str, body: TournamentBracketStructurePayload | None = None,
                                                 preview: bool = True, force: bool = False,
                                                 allow_engine_switch: bool = False,
                                                 me: dict = Depends(get_current_user),
                                                 _mutation_tid: str = Depends(_serialized_tournament_write)):
    """Use the tournament structure as the single source of truth and rebuild the bracket preview."""
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    if not _can_rebuild_bracket_from_format(tournament):
        raise HTTPException(status_code=400, detail="Für dieses Format gibt es keinen automatischen Format-Bracket-Generator.")
    if tournament.get("status") in ("live", "paused", "completed", "results_published", "archived") and not force:
        raise HTTPException(status_code=409, detail="Laufende oder beendete Turniere brauchen force=true.")

    v2_matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    match_plan = _collect_match_plan(v2_matches)
    existing_stage = await db.tournament_stages.find_one({"tournament_id": tid}, {"_id": 0}, sort=[("number", 1)])
    if body is None and existing_stage:
        body = TournamentBracketStructurePayload(
            name=existing_stage.get("name") or "Turnierbaum",
            stage_type=existing_stage.get("stage_type"),
            match_type=existing_stage.get("match_type"),
            settings=existing_stage.get("settings") or {},
        )
    has_real_v2 = any(not match.get("is_preview") for match in v2_matches)
    if has_real_v2 and not force:
        raise HTTPException(status_code=409, detail="Es gibt bereits echte Spiele. Mit force=true neu aufbauen.")

    v2_match_ids = [match["id"] for match in v2_matches if match.get("id")]

    stage_defaults = _stage_defaults_for_tournament_format(tournament, body)
    try:
        decision = decide_rebuild_engine(
            tournament.get("format"),
            preferred=GRAPH if stage_defaults else CLASSIC,
            stage_matches=v2_matches,
            allow_switch=allow_engine_switch,
        )
    except EngineSwitchRequired as exc:
        raise HTTPException(status_code=409, detail={
            "code": "engine_switch_required",
            "message": exc.reason,
            "from_engine": exc.from_engine,
            "to_engine": exc.to_engine,
        })

    if decision.is_graph and stage_defaults:
        stage = {
            **stage_defaults,
            "id": new_id(),
            "tournament_id": tid,
            "created_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
            "created_by": me["id"],
        }
        registrations = await db.tournament_registrations.find(
            {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
            {"_id": 0},
        ).to_list(5000)
        try:
            matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=preview)
        except BracketSchemaError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if not matches:
            raise HTTPException(status_code=400, detail="Die Struktur erzeugt keine Spiele.")
        _apply_match_plan(matches, match_plan, _v2_plan_key)

        # Build and validate the replacement before touching the active bracket.
        # Insert the new generation first so a database write failure can be
        # cleaned up without losing the previous structure.
        new_match_ids = [match["id"] for match in matches if match.get("id")]
        try:
            await db.tournament_stages.insert_one(stage)
            await db.matches_v2.insert_many(matches)
        except Exception:
            if new_match_ids:
                await db.matches_v2.delete_many({"id": {"$in": new_match_ids}})
            await db.tournament_stages.delete_one({"id": stage["id"]})
            raise

        if v2_match_ids:
            await db.matches_v2.delete_many({"id": {"$in": v2_match_ids}})
            await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
        await db.tournament_stages.delete_many({
            "tournament_id": tid,
            "id": {"$ne": stage["id"]},
        })
        await persist_competition_versions(db, tournament, "graph")
        await _audit_tournament_action(
            db,
            "tournament.bracket.rebuild_from_structure",
            me.get("id"),
            tid,
            {
                "format": tournament.get("format"),
                "stage_type": stage.get("stage_type"),
                "match_type": stage.get("match_type"),
                "preview": preview,
                "force": force,
                "match_count": len(matches),
                "engine_switched": decision.switched,
            },
        )
        return {
            "ok": True,
            "engine": "stages",
            "engine_switched": decision.switched,
            "stage_id": stage["id"],
            "match_count": len(matches),
            "preview": preview,
            "participant_count": len(registrations),
        }

    raise HTTPException(
        status_code=400,
        detail="Für dieses Format ist kein Struktur-Generator aktiv.",
    )


@router.post("/{tid}/reset-bracket")
async def reset_bracket(tid: str, force: bool = False, me: dict = Depends(get_current_user),
                        _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    t = await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES)
    if t.get("status") in ("live", "completed", "results_published") and not force:
        raise HTTPException(
            status_code=409,
            detail="Bracket-Reset für laufende oder beendete Turniere braucht force=true",
        )
    v2_match_ids = await db.matches_v2.distinct("id", {"tournament_id": tid})
    if not v2_match_ids and t.get("status") == "draft":
        return {"ok": True, "idempotent_replay": True}
    await db.matches_v2.delete_many({"tournament_id": tid})
    if v2_match_ids:
        await db.match_reports_v2.delete_many({"match_id": {"$in": v2_match_ids}})
    await db.tournaments.update_one({"id": tid}, {"$set": {"status": "draft", "updated_at": now_utc().isoformat()}})
    await _audit_tournament_action(
        db,
        "tournament.bracket.reset",
        me.get("id"),
        tid,
        {"previous_status": t.get("status"), "v2_match_count": len(v2_match_ids), "force": force},
    )
    return {"ok": True, "idempotent_replay": False}
