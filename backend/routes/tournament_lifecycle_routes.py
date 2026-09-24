"""Turnierstatus wechseln sowie Turniere sperren und entsperren.
"""
from fastapi import HTTPException, Depends
from database import get_db
from auth import get_current_user, require_admin
from services.tournament_permissions import (
    STRUCTURE_STAFF_ROLES,
    is_global_tournament_admin,
    require_tournament_staff_permission,
)
from services.custom_bracket import BracketSchemaError, build_matches_v2_from_schema
from services.competition_read import load_competition_read_model, observe_structure_read
from services.competition_standings import placement_rows_for_structure
from services.competition_versions import persist_competition_versions
from models import now_utc
from routes.tournament_common import (
    _apply_match_plan,
    _audit_tournament_action,
    _collect_match_plan,
    _collect_plan_matches,
    _create_initial_stage_bracket_preview,
    _ensure_tournament_unlocked,
    _planning_report,
    _resolve_tid,
    _serialized_tournament_write,
    _v2_match_can_be_rebuilt,
    _v2_plan_key,
)
from routes.tournament_router import router


LOCKABLE_TOURNAMENT_STATUSES = {"completed", "results_published", "archived", "cancelled"}


def _live_start_blocker(report: dict, force: bool) -> dict | None:
    errors = report.get("errors") or []
    hard_block = any(error.get("type") == "no_playable_matches" for error in errors)
    if not errors or (force and not hard_block):
        return None
    return {
        "code": "tournament_not_ready",
        "message": (
            "Turnier kann ohne spielbares Match nicht gestartet werden."
            if hard_block
            else "Turnierplanung enthält Konflikte. Erneut mit force=true bestätigen oder Konflikte beheben."
        ),
        "force_allowed": not hard_block,
        "planning": report,
    }


async def _finalize_stage_previews_for_checkin(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Convert stage previews into fixed matches when check-in starts."""
    tid = tournament["id"]
    stages = await db.tournament_stages.find({"tournament_id": tid}, {"_id": 0}).sort("number", 1).to_list(200)
    if not stages:
        return None
    registrations = await db.tournament_registrations.find(
        {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
        {"_id": 0},
    ).to_list(5000)
    if len(registrations) < 2:
        return None

    changed_stages: list[dict] = []
    total_matches = 0
    for stage in stages:
        existing_matches = await db.matches_v2.find({"stage_id": stage["id"]}, {"_id": 0}).to_list(3000)
        match_plan = _collect_match_plan(existing_matches)
        if existing_matches and not all(match.get("is_preview") for match in existing_matches):
            continue
        try:
            matches = build_matches_v2_from_schema(tournament, stage, registrations, preview=False)
        except BracketSchemaError:
            continue
        if not matches:
            continue
        _apply_match_plan(matches, match_plan, _v2_plan_key)
        if existing_matches:
            match_ids = await db.matches_v2.distinct("id", {"stage_id": stage["id"]})
            if match_ids:
                await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
            await db.matches_v2.delete_many({"stage_id": stage["id"]})
        await db.matches_v2.insert_many(matches)
        await db.tournament_stages.update_one(
            {"id": stage["id"]},
            {"$set": {"status": "ready", "updated_at": now_utc().isoformat()}},
        )
        changed_stages.append({
            "stage_id": stage["id"],
            "stage_number": stage.get("number"),
            "stage_type": stage.get("stage_type"),
            "match_count": len(matches),
        })
        total_matches += len(matches)

    if not changed_stages:
        return None
    await persist_competition_versions(db, tournament, "graph")
    await _audit_tournament_action(
        db,
        "tournament.stage.finalize_checkin",
        actor_id,
        tid,
        {
            "stage_count": len(changed_stages),
            "match_count": total_matches,
            "participant_count": len(registrations),
        },
    )
    return {
        "ok": True,
        "engine": "stages",
        "match_count": total_matches,
        "participant_count": len(registrations),
        "stages": changed_stages,
        "preview": False,
    }


async def _finalize_bracket_for_checkin(db, tournament: dict, actor_id: str | None) -> dict | None:
    """Run the final bracket mix once when tournament check-in opens."""
    tid = tournament["id"]
    stage_count = await db.tournament_stages.count_documents({"tournament_id": tid})
    if not stage_count:
        stage_preview = await _create_initial_stage_bracket_preview(db, tournament, actor_id)
        if stage_preview:
            stage_count = await db.tournament_stages.count_documents({"tournament_id": tid})
    if stage_count:
        finalized = await _finalize_stage_previews_for_checkin(db, tournament, actor_id)
        return finalized

    v2_matches = await db.matches_v2.find({"tournament_id": tid}, {"_id": 0}).to_list(3000)
    if v2_matches and not all(_v2_match_can_be_rebuilt(match) for match in v2_matches):
        return None
    if v2_matches:
        match_ids = [match["id"] for match in v2_matches if match.get("id")]
        if match_ids:
            await db.match_reports_v2.delete_many({"match_id": {"$in": match_ids}})
        await db.matches_v2.delete_many({"tournament_id": tid})

    return None


@router.post("/{tid}/lock")
async def lock_tournament(tid: str, me: dict = Depends(require_admin()),
                          _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if tournament.get("locked_at"):
        return {"ok": True, "locked_at": tournament["locked_at"], "idempotent_replay": True}
    if tournament.get("status") not in LOCKABLE_TOURNAMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Nur beendete, veröffentlichte, archivierte oder abgesagte Turniere können gesperrt werden.")
    now = now_utc().isoformat()
    await db.tournaments.update_one(
        {"id": tid},
        {"$set": {"locked_at": now, "locked_by": me.get("id"), "updated_at": now}},
    )
    await _audit_tournament_action(db, "tournament.lock", me.get("id"), tid, {"status": tournament.get("status")})
    return {"ok": True, "locked_at": now, "idempotent_replay": False}


@router.post("/{tid}/unlock")
async def unlock_tournament(tid: str, me: dict = Depends(require_admin()),
                            _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    tournament = await db.tournaments.find_one({"id": tid}, {"_id": 0})
    if not tournament:
        raise HTTPException(status_code=404, detail="Turnier nicht gefunden")
    if not tournament.get("locked_at"):
        return {"ok": True, "idempotent_replay": True}
    now = now_utc().isoformat()
    await db.tournaments.update_one(
        {"id": tid},
        {"$unset": {"locked_at": "", "locked_by": ""}, "$set": {"updated_at": now}},
    )
    await _audit_tournament_action(db, "tournament.unlock", me.get("id"), tid, {"previous_locked_at": tournament.get("locked_at")})
    return {"ok": True, "idempotent_replay": False}


@router.post("/{tid}/status")
async def set_status(tid: str, body: dict, me: dict = Depends(get_current_user),
                     _mutation_tid: str = Depends(_serialized_tournament_write)):
    db = get_db()
    tid = await _resolve_tid(tid)
    await _ensure_tournament_unlocked(db, tid)
    await require_tournament_staff_permission(me, tid, STRUCTURE_STAFF_ROLES, "tournament")
    status = body.get("status")
    force = body.get("force") is True
    allowed = {
        "draft", "scheduled", "registration_open", "registration_closed",
        "check_in", "live", "paused", "completed", "results_published",
        "archived", "cancelled",
    }
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Ungültiger Status")
    if not is_global_tournament_admin(me) and status not in {"check_in", "live", "paused", "completed"}:
        raise HTTPException(status_code=403, detail="Turnierleitung darf nur operative Status setzen")
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    prev = t.get("status")
    auto_generated_bracket = None
    planning = None
    if prev != status and status == "check_in":
        auto_generated_bracket = await _finalize_bracket_for_checkin(db, {**t, "status": status}, me.get("id"))
    if prev != status and status == "live":
        try:
            fresh_t = {**t, "status": status}
            if prev != status:
                auto_generated_bracket = await _finalize_bracket_for_checkin(db, fresh_t, me.get("id"))
        except HTTPException as exc:
            auto_generated_bracket = {"ok": False, "reason": "generator_error", "detail": exc.detail}

        matches, fresh_t = await _collect_plan_matches(db, tid)
        participant_count = await db.tournament_registrations.count_documents({
            "tournament_id": tid,
            "status": {"$in": ["approved", "checked_in"]},
        })
        planning = _planning_report(
            matches,
            fresh_t,
            participant_count=participant_count,
            require_fixed_bracket=True,
        )
        blocker = _live_start_blocker(planning, force)
        if blocker:
            raise HTTPException(status_code=409, detail=blocker)

    if prev != status:
        changed_at = now_utc().isoformat()
        await db.tournaments.update_one(
            {"id": tid},
            {"$set": {"status": status, "updated_at": changed_at}},
        )
        await _audit_tournament_action(
            db,
            "tournament.status.change",
            me.get("id"),
            tid,
            {
                "previous_status": prev,
                "status": status,
                "forced": force,
                "planning_errors": (planning or {}).get("error_count", 0),
                "planning_warnings": (planning or {}).get("warning_count", 0),
            },
        )

    # ---------- Season Points + Badges on results_published ----------
    if prev != status and status == "results_published":
        try:
            from services.season_service import award_points
            from badges import on_tournament_completed
            # Build placements once through the canonical Legacy/Stage projection.
            regs = await db.tournament_registrations.find(
                {"tournament_id": tid, "status": {"$in": ["approved", "checked_in"]}},
                {"_id": 0},
            ).to_list(500)
            num_participants = len(regs)
            read_model = await load_competition_read_model(db, tid)
            snapshot = read_model.structure_snapshot()
            observe_structure_read(snapshot, surface="season_points")
            placements = placement_rows_for_structure(snapshot, regs)
            placed_reg_ids = {
                placement["registration_id"]
                for placement in placements
                if placement.get("registration_id")
            }
            # Source type by season weight: <=1.5 mini, <=2.5 normal, else major
            weight = float(t.get("season_weight") or 2.0)
            source_type = "mini" if weight < 1.5 else ("major" if weight >= 2.5 else "tournament")
            for p in placements:
                if not (p.get("user_id") or p.get("team_id")):
                    continue
                await award_points(
                    user_id=p.get("user_id"),
                    team_id=p.get("team_id"),
                    source_type=source_type,
                    source_id=tid,
                    source_name=t.get("title"),
                    rank=p["rank"],
                    num_participants=num_participants,
                    weight=weight,
                )
            # Participation points for everyone else
            for r in regs:
                if r.get("id") not in placed_reg_ids and (r.get("user_id") or r.get("team_id")):
                    await award_points(
                        user_id=r.get("user_id"), team_id=r.get("team_id"), source_type=source_type, source_id=tid,
                        source_name=t.get("title"), rank=None,
                        num_participants=num_participants, weight=weight,
                    )
            await on_tournament_completed(tid, placements)
            # Auszeichnungen (#230): je Anmeldung Platz und Bilanz festhalten - bei erneutem Veröffentlichen neu.
            try:
                from services.awards import record_tournament_awards
                await record_tournament_awards(db, tid)
            except Exception as exc2:
                import logging
                logging.getLogger("tls.awards").warning(f"record awards: {exc2}")
            # Phase 9: Auto-create prize pickups
            try:
                from services.prize_service import auto_create_for_tournament
                await auto_create_for_tournament(tid)
            except Exception as exc2:
                import logging
                logging.getLogger("tls.prizes").warning(f"auto-create prizes: {exc2}")
        except Exception as exc:
            import logging
            logging.getLogger("tls.tournament").warning(f"results_published hook: {exc}")

    # Turnierabschluss: alle Angemeldeten neu auswerten (#301) - nicht erst beim Profilbesuch.
    if prev != status and status in ("completed", "results_published"):
        try:
            from services.achievement_queue import request_evaluation
            from services.match_notifications import _participant_user_ids
            regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0, "user_id": 1, "team_id": 1}).to_list(2000)
            await request_evaluation(await _participant_user_ids(db, regs), f"tournament_{status}")
        except Exception:
            pass

    # Discord trigger
    is_public_discord_status = (
        t.get("is_public") is not False
        and (t.get("visibility") or "public") == "public"
    )
    if is_public_discord_status and prev != status and status in ("registration_open", "live", "completed", "results_published"):
        try:
            from discord_service import send_public_discord
            colors = {"registration_open": 0x00FF88, "live": 0x29B6E8,
                      "completed": 0xFFD700, "results_published": 0xFFD700}
            labels = {"registration_open": "Anmeldung offen", "live": "Jetzt live",
                      "completed": "Beendet", "results_published": "Ergebnisse veröffentlicht"}
            game_id = t.get("game_id")
            game = await db.games.find_one({"id": game_id}, {"name": 1}) if game_id else None
            url = f"/tournaments/{t.get('slug') or tid}"
            fields = []
            if game and game.get("name"): fields.append({"name": "Spiel", "value": game["name"], "inline": True})
            if t.get("format"): fields.append({"name": "Format", "value": (t.get("format_label") or t["format"].replace("_", " ").title()), "inline": True})
            if t.get("max_participants"): fields.append({"name": "Teilnehmer", "value": f"max. {t['max_participants']}", "inline": True})
            await send_public_discord(
                t,
                f"🏆 {t.get('title') or 'Turnier'} · {labels[status]}",
                t.get("description") or "",
                color=colors[status], url=url, fields=fields,
                event_key=f"tournament.{status}", image_url=t.get("banner_url"),
            )
        except Exception:
            pass
    return {
        "ok": True,
        "auto_generated_bracket": auto_generated_bracket,
        "planning": planning,
        "idempotent_replay": prev == status,
    }
