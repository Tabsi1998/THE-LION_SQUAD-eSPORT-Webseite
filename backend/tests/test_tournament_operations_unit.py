"""Regression tests for Package 4 tournament start and station safety."""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

import routes.tournament_routes as tournament_routes
from routes.station_routes import (
    _assign_match_to_station,
    _match_has_minimum_participants,
)
from services.match_reminder import _uses_actual_start_notifications
from services.competition_structure_apply import activate_structure_plan
from models import RegistrationUpdate, TournamentCreate, TournamentStageCreate


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return list(self.rows)


def _legacy_match(**updates):
    return {
        "id": "m1",
        "status": "ready",
        "participant_a_id": "r1",
        "participant_b_id": "r2",
        **updates,
    }


def test_start_report_requires_configured_minimum_participants():
    report = tournament_routes._planning_report(
        [_legacy_match()],
        {"event_mode": "online", "min_participants": 4},
        participant_count=3,
        require_fixed_bracket=True,
    )

    assert report["ready_match_count"] == 1
    assert report["ok"] is False
    assert report["errors"][0]["type"] == "insufficient_participants"
    assert tournament_routes._live_start_blocker(report, force=False)["force_allowed"] is True
    assert tournament_routes._live_start_blocker(report, force=True) is None


def test_live_start_never_allows_only_preview_or_unfilled_matches():
    report = tournament_routes._planning_report(
        [
            _legacy_match(status="preview", is_preview=True),
            {"id": "future", "status": "pending", "participant_a_id": None, "participant_b_id": None},
        ],
        {"event_mode": "online", "min_participants": 2},
        participant_count=2,
        require_fixed_bracket=True,
    )

    blocker = tournament_routes._live_start_blocker(report, force=True)
    assert blocker["force_allowed"] is False
    assert any(error["type"] == "no_playable_matches" for error in report["errors"])
    assert report["checked_matches"] == 1


def test_planning_ignores_future_empty_matches_in_missing_station_noise():
    report = tournament_routes._planning_report(
        [{"id": "future", "status": "pending", "participant_a_id": None, "participant_b_id": None}],
        {"event_mode": "online"},
    )

    assert report["checked_matches"] == 0
    assert report["warning_count"] == 0


def test_station_start_requires_match_minimum_players():
    incomplete = {
        "id": "ffa-1",
        "tournament_id": "t1",
        "status": "ready",
        "settings": {"min_players": 3},
        "slots": [{"registration_id": "r1"}, {"registration_id": "r2"}, {"registration_id": None}],
    }
    assert _match_has_minimum_participants(incomplete) is False

    with pytest.raises(HTTPException, match="zu wenige Teilnehmer") as error:
        asyncio.run(_assign_match_to_station(
            None,
            {"id": "s1", "status": "free", "tournament_id": "t1"},
            incomplete,
            "matches_v2",
            start_now=True,
        ))
    assert error.value.status_code == 409


def test_local_staff_schedule_notifies_only_on_actual_station_start():
    assert _uses_actual_start_notifications({
        "event_mode": "local",
        "schedule_mode": "fixed_by_staff",
    }) is True
    assert _uses_actual_start_notifications({
        "event_mode": "online",
        "schedule_mode": "fixed_by_staff",
    }) is False
    assert _uses_actual_start_notifications({
        "location": "Vereinsheim",
        "stream_link": None,
    }) is True


def test_manual_live_start_does_not_change_status_before_hard_preflight(monkeypatch):
    tournaments = SimpleNamespace(
        find_one=AsyncMock(return_value={
            "id": "t1",
            "status": "check_in",
            "min_participants": 2,
            "event_mode": "online",
        }),
        update_one=AsyncMock(),
    )
    registrations = SimpleNamespace(count_documents=AsyncMock(return_value=2))
    db = SimpleNamespace(tournaments=tournaments, tournament_registrations=registrations)

    async def resolve(tournament_id):
        return tournament_id

    async def unlocked(db_arg, tournament_id):
        return {"id": tournament_id}

    async def permitted(user, tournament_id, roles, scope):
        return None

    async def finalize(db_arg, tournament, actor_id):
        return {"ok": True, "engine": "test"}

    async def collect(db_arg, tournament_id):
        return [], {"id": tournament_id, "min_participants": 2, "event_mode": "online"}

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "_resolve_tid", resolve)
    monkeypatch.setattr(tournament_routes, "_ensure_tournament_unlocked", unlocked)
    monkeypatch.setattr(tournament_routes, "require_tournament_staff_permission", permitted)
    monkeypatch.setattr(tournament_routes, "_finalize_bracket_for_checkin", finalize)
    monkeypatch.setattr(tournament_routes, "_collect_plan_matches", collect)

    with pytest.raises(HTTPException) as error:
        asyncio.run(tournament_routes.set_status(
            "t1",
            {"status": "live", "force": True},
            {"id": "admin", "role": "tournament_admin"},
        ))

    assert error.value.status_code == 409
    assert error.value.detail["force_allowed"] is False
    tournaments.update_one.assert_not_awaited()


def test_self_registration_exact_retry_returns_existing_record_without_insert():
    existing = {"id": "reg-1", "tournament_id": "t1", "user_id": "user-1", "status": "approved"}
    registrations = SimpleNamespace(
        find_one=AsyncMock(return_value=existing),
        insert_one=AsyncMock(),
    )
    db = SimpleNamespace(tournament_registrations=registrations)

    result = asyncio.run(tournament_routes._create_self_registration(
        db,
        "t1",
        {"id": "t1"},
        object(),
        {"id": "user-1"},
        None,
    ))

    assert result["id"] == "reg-1"
    assert result["idempotent_replay"] is True
    assert result["auto_bracket_update"] is None
    registrations.insert_one.assert_not_awaited()


def test_team_registration_retry_by_another_manager_reuses_team_record(monkeypatch):
    existing_team = {"id": "reg-team", "tournament_id": "t1", "team_id": "team-1", "status": "approved"}
    registrations = SimpleNamespace(
        find_one=AsyncMock(side_effect=[None, existing_team]),
        insert_one=AsyncMock(),
    )
    db = SimpleNamespace(tournament_registrations=registrations)

    async def valid_team(*_args):
        return {"id": "team-1", "name": "Lions", "tag": "TLS"}

    monkeypatch.setattr(tournament_routes, "_validate_registration_actor", valid_team)
    result = asyncio.run(tournament_routes._create_self_registration(
        db,
        "t1",
        {"id": "t1"},
        object(),
        {"id": "manager-2"},
        None,
    ))

    assert result["id"] == "reg-team"
    assert result["idempotent_replay"] is True
    registrations.insert_one.assert_not_awaited()


@asynccontextmanager
async def _uncontended_lock(*_args, **_kwargs):
    yield "test-owner"


def test_staff_checkin_replay_skips_badges_and_audit(monkeypatch):
    registration = {"id": "reg-1", "tournament_id": "t1", "user_id": "user-1", "status": "checked_in"}
    registrations = SimpleNamespace(
        find_one=AsyncMock(return_value=registration),
        update_one=AsyncMock(),
    )
    db = SimpleNamespace(tournament_registrations=registrations)

    async def identity(value):
        return value

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "_resolve_tid", identity)
    monkeypatch.setattr(tournament_routes, "_ensure_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(tournament_routes, "require_tournament_staff_permission", AsyncMock())
    monkeypatch.setattr(tournament_routes, "mutation_lock", _uncontended_lock)
    badges = AsyncMock()
    audit = AsyncMock()
    monkeypatch.setattr(tournament_routes, "_apply_checked_in_badges", badges)
    monkeypatch.setattr(tournament_routes, "_audit_tournament_action", audit)

    result = asyncio.run(tournament_routes.staff_set_registration_checkin(
        "t1",
        "reg-1",
        {"status": "checked_in"},
        {"id": "admin-1"},
    ))

    assert result["idempotent_replay"] is True
    registrations.update_one.assert_not_awaited()
    badges.assert_not_awaited()
    audit.assert_not_awaited()


def test_self_checkin_replay_skips_late_hooks_badges_and_audit(monkeypatch):
    db = SimpleNamespace()

    async def identity(value):
        return value

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "_resolve_tid", identity)
    monkeypatch.setattr(tournament_routes, "_ensure_tournament_unlocked", AsyncMock(return_value={"event_mode": "online"}))
    monkeypatch.setattr(tournament_routes, "mutation_lock", _uncontended_lock)
    monkeypatch.setattr(tournament_routes, "_find_self_registration", AsyncMock(return_value={
        "id": "reg-1", "user_id": "user-1", "status": "checked_in",
    }))
    late_hooks = AsyncMock()
    badges = AsyncMock()
    audit = AsyncMock()
    monkeypatch.setattr(tournament_routes, "_apply_late_checkin_hooks", late_hooks)
    monkeypatch.setattr(tournament_routes, "_apply_checked_in_badges", badges)
    monkeypatch.setattr(tournament_routes, "_audit_tournament_action", audit)

    result = asyncio.run(tournament_routes.checkin_self("t1", {"id": "user-1"}))

    assert result == {"ok": True, "idempotent_replay": True}
    late_hooks.assert_not_awaited()
    badges.assert_not_awaited()
    audit.assert_not_awaited()


def test_registration_update_replay_skips_write_and_bracket_refresh(monkeypatch):
    registration = {"id": "reg-1", "tournament_id": "t1", "status": "approved"}
    registrations = SimpleNamespace(
        find_one=AsyncMock(return_value=registration),
        update_one=AsyncMock(),
    )
    db = SimpleNamespace(tournament_registrations=registrations)

    async def identity(value):
        return value

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "_resolve_tid", identity)
    monkeypatch.setattr(tournament_routes, "_ensure_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(tournament_routes, "require_tournament_staff_permission", AsyncMock())
    refresh = AsyncMock()
    monkeypatch.setattr(tournament_routes, "_refresh_tournament_previews_after_registration", refresh)

    result = asyncio.run(tournament_routes.update_registration(
        "t1",
        "reg-1",
        RegistrationUpdate(status="approved"),
        {"id": "admin-1"},
    ))

    assert result["idempotent_replay"] is True
    registrations.update_one.assert_not_awaited()
    refresh.assert_not_awaited()


def test_lock_and_unlock_replays_skip_second_audit(monkeypatch):
    async def identity(value):
        return value

    audit = AsyncMock()
    updates = AsyncMock()
    monkeypatch.setattr(tournament_routes, "_resolve_tid", identity)
    monkeypatch.setattr(tournament_routes, "_audit_tournament_action", audit)

    locked_db = SimpleNamespace(tournaments=SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "t1", "status": "completed", "locked_at": "2026-08-12T12:00:00+00:00"}),
        update_one=updates,
    ))
    monkeypatch.setattr(tournament_routes, "get_db", lambda: locked_db)
    locked = asyncio.run(tournament_routes.lock_tournament("t1", {"id": "admin-1"}))
    assert locked["idempotent_replay"] is True

    unlocked_db = SimpleNamespace(tournaments=SimpleNamespace(
        find_one=AsyncMock(return_value={"id": "t1", "status": "completed"}),
        update_one=updates,
    ))
    monkeypatch.setattr(tournament_routes, "get_db", lambda: unlocked_db)
    unlocked = asyncio.run(tournament_routes.unlock_tournament("t1", {"id": "admin-1"}))
    assert unlocked["idempotent_replay"] is True

    updates.assert_not_awaited()
    audit.assert_not_awaited()


def test_tournament_creation_replay_reuses_existing_document(monkeypatch):
    tournaments = SimpleNamespace(
        find_one=AsyncMock(return_value={
            "id": "t1",
            "title": "Sommer-Cup",
            "game_id": "game-1",
            "creation_key": "internal",
        }),
        insert_one=AsyncMock(),
    )
    games = SimpleNamespace(find_one=AsyncMock())
    db = SimpleNamespace(tournaments=tournaments, games=games)
    preview = AsyncMock()

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "mutation_lock", _uncontended_lock)
    monkeypatch.setattr(tournament_routes, "_create_initial_bracket_preview", preview)

    result = asyncio.run(tournament_routes.create_tournament(
        TournamentCreate(title="Sommer-Cup", game_id="game-1"),
        {"id": "admin-1"},
    ))

    assert result["id"] == "t1"
    assert result["idempotent_replay"] is True
    assert result["engine_version"] == "competition.unversioned"
    assert result["ruleset_version"] == "competition.ruleset.unversioned"
    assert result["version_inferred"] is True
    assert "creation_key" not in result
    games.find_one.assert_not_awaited()
    tournaments.insert_one.assert_not_awaited()
    preview.assert_not_awaited()


def test_tournament_creation_persists_engine_and_ruleset_versions(monkeypatch):
    tournaments = SimpleNamespace(
        find_one=AsyncMock(return_value=None),
        insert_one=AsyncMock(),
    )
    games = SimpleNamespace(find_one=AsyncMock(return_value={"id": "game-1"}))
    db = SimpleNamespace(tournaments=tournaments, games=games)
    preview = AsyncMock(return_value={"ok": True, "engine": "legacy"})

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "mutation_lock", _uncontended_lock)
    monkeypatch.setattr(tournament_routes, "_create_initial_bracket_preview", preview)

    result = asyncio.run(tournament_routes.create_tournament(
        TournamentCreate(title="Sommer-Cup", game_id="game-1", format="single_elim"),
        {"id": "admin-1"},
    ))

    inserted = tournaments.insert_one.await_args.args[0]
    assert inserted["engine_version"] == "competition.classic.v1"
    assert inserted["ruleset_version"] == "competition.ruleset.v1"
    assert result["engine_version"] == "competition.classic.v1"
    assert result["ruleset_version"] == "competition.ruleset.v1"
    assert result["version_inferred"] is False
    preview.assert_awaited_once()


def test_tournament_stage_creation_replay_reuses_existing_document(monkeypatch):
    stages = SimpleNamespace(
        find_one=AsyncMock(return_value={
            "id": "stage-1",
            "tournament_id": "t1",
            "name": "Finale",
            "number": 1,
            "creation_key": "internal",
        }),
        insert_one=AsyncMock(),
    )
    db = SimpleNamespace(tournament_stages=stages)

    async def identity(value):
        return value

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "_resolve_tid", identity)
    monkeypatch.setattr(tournament_routes, "_ensure_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(tournament_routes, "require_tournament_staff_permission", AsyncMock())
    audit = AsyncMock()
    monkeypatch.setattr(tournament_routes, "_audit_tournament_action", audit)

    result = asyncio.run(tournament_routes.create_tournament_stage(
        "t1",
        TournamentStageCreate(name="Finale", number=1),
        {"id": "admin-1"},
    ))

    assert result["id"] == "stage-1"
    assert result["idempotent_replay"] is True
    assert "creation_key" not in result
    stages.insert_one.assert_not_awaited()
    audit.assert_not_awaited()


def _bracket_rebuild_db(*, tournament, legacy_matches=None, v2_matches=None,
                        existing_stage=None, registrations=None):
    matches = SimpleNamespace(
        find=Mock(return_value=_Cursor(legacy_matches or [])),
        delete_many=AsyncMock(),
        insert_many=AsyncMock(),
        replace_one=AsyncMock(),
    )
    matches_v2 = SimpleNamespace(
        find=Mock(return_value=_Cursor(v2_matches or [])),
        delete_many=AsyncMock(),
        insert_many=AsyncMock(),
        replace_one=AsyncMock(),
    )
    stages = SimpleNamespace(
        find_one=AsyncMock(return_value=existing_stage),
        find=Mock(return_value=_Cursor([existing_stage] if existing_stage else [])),
        insert_one=AsyncMock(),
        delete_one=AsyncMock(),
        delete_many=AsyncMock(),
        replace_one=AsyncMock(),
    )
    tournament_registrations = SimpleNamespace(
        find=Mock(return_value=_Cursor(registrations or [])),
    )
    return SimpleNamespace(
        tournaments=SimpleNamespace(
            find_one=AsyncMock(return_value=tournament),
            update_one=AsyncMock(),
        ),
        matches=matches,
        matches_v2=matches_v2,
        tournament_stages=stages,
        tournament_registrations=tournament_registrations,
        match_reports_v2=SimpleNamespace(
            find=Mock(return_value=_Cursor([])),
            delete_many=AsyncMock(),
            replace_one=AsyncMock(),
        ),
        audit_logs=SimpleNamespace(insert_one=AsyncMock()),
    )


def _patch_bracket_rebuild_dependencies(monkeypatch, db):
    async def identity(value):
        return value

    async def unlocked(db_arg, tournament_id):
        return await db_arg.tournaments.find_one({"id": tournament_id}, {"_id": 0})

    monkeypatch.setattr(tournament_routes, "get_db", lambda: db)
    monkeypatch.setattr(tournament_routes, "_resolve_tid", identity)
    monkeypatch.setattr(tournament_routes, "_ensure_tournament_unlocked", unlocked)
    monkeypatch.setattr(tournament_routes, "require_tournament_staff_permission", AsyncMock())
    monkeypatch.setattr(tournament_routes, "_audit_tournament_action", AsyncMock())


@pytest.mark.parametrize(("tournament_format", "stage_type", "match_type", "match_count"), [
    ("custom_bracket", "custom_bracket", "duel", 63),
    ("ffa_custom_bracket", "ffa_custom_bracket", "ffa", 17),
])
def test_rebuild_from_format_supports_64_player_custom_brackets(
    monkeypatch,
    tournament_format,
    stage_type,
    match_type,
    match_count,
):
    tournament = {
        "id": "t1",
        "format": tournament_format,
        "max_participants": 64,
        "match_duration_minutes": 30,
        "seeding_mode": "manual",
        "status": "draft",
    }
    db = _bracket_rebuild_db(tournament=tournament)
    _patch_bracket_rebuild_dependencies(monkeypatch, db)

    result = asyncio.run(tournament_routes.rebuild_bracket_from_tournament_format(
        "t1",
        tournament_routes.TournamentBracketStructurePayload(
            name="Turnierbaum",
            stage_type=stage_type,
            match_type=match_type,
        ),
        preview=True,
        me={"id": "admin-1"},
    ))

    assert result["engine"] == "stages"
    assert result["match_count"] == match_count
    inserted_matches = db.matches_v2.insert_many.await_args.args[0]
    assert len(inserted_matches) == match_count
    assert all(match["is_preview"] for match in inserted_matches)
    db.tournament_stages.insert_one.assert_awaited_once()


def test_invalid_custom_schema_preserves_existing_bracket(monkeypatch):
    tournament = {
        "id": "t1",
        "format": "ffa_custom_bracket",
        "max_participants": 64,
        "match_duration_minutes": 30,
        "seeding_mode": "manual",
        "status": "draft",
    }
    old_match = {
        "id": "old-match",
        "tournament_id": "t1",
        "stage_id": "old-stage",
        "is_preview": True,
        "status": "preview",
    }
    old_stage = {
        "id": "old-stage",
        "tournament_id": "t1",
        "number": 1,
        "name": "Alter Baum",
        "stage_type": "ffa_custom_bracket",
        "match_type": "ffa",
        "settings": {},
    }
    db = _bracket_rebuild_db(
        tournament=tournament,
        v2_matches=[old_match],
        existing_stage=old_stage,
    )
    _patch_bracket_rebuild_dependencies(monkeypatch, db)

    with pytest.raises(HTTPException) as error:
        asyncio.run(tournament_routes.rebuild_bracket_from_tournament_format(
            "t1",
            tournament_routes.TournamentBracketStructurePayload(
                name="Neuer Baum",
                stage_type="ffa_custom_bracket",
                match_type="ffa",
                settings={"schema": "[MAIN]\nA=[ungueltig]"},
            ),
            preview=True,
            me={"id": "admin-1"},
        ))

    assert error.value.status_code == 400
    assert "Ungültiger Slot-Ausdruck" in error.value.detail
    db.matches.delete_many.assert_not_awaited()
    db.matches_v2.delete_many.assert_not_awaited()
    db.tournament_stages.delete_many.assert_not_awaited()
    db.tournament_stages.insert_one.assert_not_awaited()
    db.matches_v2.insert_many.assert_not_awaited()


def test_custom_bracket_write_failure_cleans_new_generation_only(monkeypatch):
    tournament = {
        "id": "t1",
        "format": "custom_bracket",
        "max_participants": 8,
        "match_duration_minutes": 30,
        "seeding_mode": "manual",
        "status": "draft",
    }
    old_match = {
        "id": "old-match",
        "tournament_id": "t1",
        "stage_id": "old-stage",
        "is_preview": True,
        "status": "preview",
    }
    db = _bracket_rebuild_db(
        tournament=tournament,
        v2_matches=[old_match],
        existing_stage={
            "id": "old-stage",
            "tournament_id": "t1",
            "number": 1,
            "stage_type": "custom_bracket",
            "match_type": "duel",
            "settings": {},
        },
    )
    db.matches_v2.insert_many.side_effect = RuntimeError("database write failed")
    _patch_bracket_rebuild_dependencies(monkeypatch, db)

    with pytest.raises(RuntimeError, match="database write failed"):
        asyncio.run(tournament_routes.rebuild_bracket_from_tournament_format(
            "t1",
            tournament_routes.TournamentBracketStructurePayload(
                stage_type="custom_bracket",
                match_type="duel",
            ),
            preview=True,
            me={"id": "admin-1"},
        ))

    db.tournament_stages.insert_one.assert_awaited_once()
    cleanup_query = db.matches_v2.delete_many.await_args.args[0]
    assert cleanup_query.get("id", {}).get("$in")
    db.tournament_stages.delete_one.assert_awaited_once()
    db.matches.delete_many.assert_not_awaited()
    db.tournament_stages.delete_many.assert_not_awaited()
    db.match_reports_v2.delete_many.assert_not_awaited()


@pytest.mark.parametrize(("tournament_format", "stage_type", "engine"), [
    ("round_robin", None, "classic"),
    ("custom_bracket", "custom_bracket", "graph"),
])
def test_structure_plan_is_deterministic_valid_and_read_only(
    monkeypatch,
    tournament_format,
    stage_type,
    engine,
):
    tournament = {
        "id": "t1",
        "format": tournament_format,
        "max_participants": 4,
        "match_duration_minutes": 30,
        "seeding_mode": "random",
        "status": "draft",
    }
    registrations = [
        {"id": "r4", "user_id": "u4", "status": "approved", "seed": 4},
        {"id": "r2", "user_id": "u2", "status": "approved", "seed": 2},
        {"id": "r1", "user_id": "u1", "status": "approved", "seed": 1},
        {"id": "r3", "user_id": "u3", "status": "approved", "seed": 3},
    ]
    db = _bracket_rebuild_db(tournament=tournament, registrations=registrations)
    _patch_bracket_rebuild_dependencies(monkeypatch, db)
    payload = tournament_routes.TournamentStructurePlanPayload(
        stage_type=stage_type,
        match_type="duel" if stage_type else None,
        preview=False,
    )

    first = asyncio.run(tournament_routes.plan_bracket_from_tournament_format(
        "t1", payload, {"id": "admin-1"},
    ))
    second = asyncio.run(tournament_routes.plan_bracket_from_tournament_format(
        "t1", payload, {"id": "admin-1"},
    ))

    assert first["ok"] is True
    assert first["engine"] == engine
    assert first["validation"]["valid"] is True
    assert first["plan_hash"] == second["plan_hash"]
    assert first["base_structure_hash"] == second["base_structure_hash"]
    assert [match["id"] for match in first["structure"]["matches"]] == [
        match["id"] for match in second["structure"]["matches"]
    ]
    assert first["apply_requirements"]["force_required"] is False
    db.matches.insert_many.assert_not_awaited()
    db.matches.delete_many.assert_not_awaited()
    db.matches_v2.insert_many.assert_not_awaited()
    db.matches_v2.delete_many.assert_not_awaited()
    db.tournament_stages.insert_one.assert_not_awaited()
    db.tournament_stages.delete_many.assert_not_awaited()
    db.tournaments.update_one.assert_not_awaited()


def test_structure_plan_reports_replacement_impact_and_force_requirement(monkeypatch):
    tournament = {
        "id": "t1",
        "format": "single_elim",
        "max_participants": 4,
        "seeding_mode": "manual",
        "status": "live",
    }
    old_match = {
        "id": "old-match",
        "tournament_id": "t1",
        "round": 1,
        "match_index": 0,
        "participant_a_id": "r1",
        "participant_b_id": "r2",
        "status": "completed",
    }
    db = _bracket_rebuild_db(
        tournament=tournament,
        legacy_matches=[old_match],
        registrations=[
            {"id": "r1", "status": "approved", "seed": 1},
            {"id": "r2", "status": "approved", "seed": 2},
        ],
    )
    _patch_bracket_rebuild_dependencies(monkeypatch, db)

    result = asyncio.run(tournament_routes.plan_bracket_from_tournament_format(
        "t1",
        tournament_routes.TournamentStructurePlanPayload(preview=False),
        {"id": "admin-1"},
    ))

    assert result["apply_requirements"]["force_required"] is True
    assert result["replacement_impact"] == {
        "legacy_match_count": 1,
        "stage_match_count": 0,
        "stage_count": 0,
    }


def _apply_payload_from_plan(plan, **updates):
    values = {
        "preview": False,
        "expected_plan_hash": plan["plan_hash"],
        "expected_base_structure_hash": plan["base_structure_hash"],
        **updates,
    }
    return tournament_routes.TournamentStructureApplyPayload(**values)


def test_structure_apply_rejects_stale_base_before_any_write(monkeypatch):
    tournament = {
        "id": "t1",
        "format": "round_robin",
        "max_participants": 4,
        "seeding_mode": "manual",
        "status": "draft",
    }
    registrations = [
        {"id": f"r{seed}", "status": "approved", "seed": seed}
        for seed in range(1, 5)
    ]
    db = _bracket_rebuild_db(tournament=tournament, registrations=registrations)
    _patch_bracket_rebuild_dependencies(monkeypatch, db)
    plan_request = tournament_routes.TournamentStructurePlanPayload(preview=False)
    plan = asyncio.run(tournament_routes.plan_bracket_from_tournament_format(
        "t1", plan_request, {"id": "admin-1"},
    ))

    db.matches.find.return_value = _Cursor([{
        "id": "changed-after-preview",
        "tournament_id": "t1",
        "round": 1,
        "match_index": 0,
        "is_preview": True,
        "status": "preview",
    }])
    with pytest.raises(HTTPException) as error:
        asyncio.run(tournament_routes.apply_tournament_structure_plan(
            "t1",
            _apply_payload_from_plan(plan),
            {"id": "admin-1"},
        ))

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "structure_plan_stale"
    db.matches.insert_many.assert_not_awaited()
    db.matches.delete_many.assert_not_awaited()
    db.matches_v2.insert_many.assert_not_awaited()
    db.matches_v2.delete_many.assert_not_awaited()
    db.tournament_stages.insert_one.assert_not_awaited()
    db.tournament_stages.delete_many.assert_not_awaited()
    db.tournaments.update_one.assert_not_awaited()
    db.audit_logs.insert_one.assert_not_awaited()


def test_structure_apply_activates_exact_valid_plan(monkeypatch):
    tournament = {
        "id": "t1",
        "format": "round_robin",
        "max_participants": 4,
        "seeding_mode": "manual",
        "status": "draft",
        "structure_revision": 2,
    }
    registrations = [
        {"id": f"r{seed}", "status": "approved", "seed": seed}
        for seed in range(1, 5)
    ]
    db = _bracket_rebuild_db(tournament=tournament, registrations=registrations)
    _patch_bracket_rebuild_dependencies(monkeypatch, db)
    plan = asyncio.run(tournament_routes.plan_bracket_from_tournament_format(
        "t1",
        tournament_routes.TournamentStructurePlanPayload(preview=False),
        {"id": "admin-1"},
    ))

    result = asyncio.run(tournament_routes.apply_tournament_structure_plan(
        "t1",
        _apply_payload_from_plan(plan),
        {"id": "admin-1"},
    ))

    assert result["ok"] is True
    assert result["idempotent_replay"] is False
    assert result["plan_hash"] == plan["plan_hash"]
    assert result["structure_revision"] == 3
    assert result["validation"]["valid"] is True
    inserted_matches = db.matches.insert_many.await_args.args[0]
    assert len(inserted_matches) == plan["match_count"]
    assert all(match["structure_plan_hash"] == plan["plan_hash"] for match in inserted_matches)
    tournament_update = db.tournaments.update_one.await_args.args[1]["$set"]
    assert tournament_update["last_structure_plan_hash"] == plan["plan_hash"]
    assert tournament_update["last_structure_base_hash"] == plan["base_structure_hash"]
    assert tournament_update["engine_version"] == "competition.classic.v1"
    db.audit_logs.insert_one.assert_awaited_once()


def test_structure_apply_activates_graph_plan_with_stage(monkeypatch):
    tournament = {
        "id": "t1",
        "format": "custom_bracket",
        "max_participants": 4,
        "seeding_mode": "manual",
        "status": "draft",
    }
    registrations = [
        {"id": f"r{seed}", "status": "approved", "seed": seed}
        for seed in range(1, 5)
    ]
    db = _bracket_rebuild_db(tournament=tournament, registrations=registrations)
    _patch_bracket_rebuild_dependencies(monkeypatch, db)
    request_values = {
        "stage_type": "custom_bracket",
        "match_type": "duel",
        "preview": False,
    }
    plan = asyncio.run(tournament_routes.plan_bracket_from_tournament_format(
        "t1",
        tournament_routes.TournamentStructurePlanPayload(**request_values),
        {"id": "admin-1"},
    ))

    result = asyncio.run(tournament_routes.apply_tournament_structure_plan(
        "t1",
        _apply_payload_from_plan(plan, **request_values),
        {"id": "admin-1"},
    ))

    assert result["engine"] == "graph"
    assert result["stage_id"] == plan["stage"]["id"]
    db.tournament_stages.insert_one.assert_awaited_once()
    db.matches_v2.insert_many.assert_awaited_once()
    assert db.tournaments.update_one.await_args.args[1]["$set"]["engine_version"] == "competition.graph.v1"


def test_structure_apply_rejects_invalid_validated_graph_before_write(monkeypatch):
    plan_hash = "c" * 64
    base_hash = "d" * 64
    tournament = {
        "id": "t1",
        "format": "round_robin",
        "max_participants": 4,
        "status": "draft",
    }
    db = _bracket_rebuild_db(tournament=tournament)
    _patch_bracket_rebuild_dependencies(monkeypatch, db)
    build_plan = AsyncMock(return_value=(
        {
            "plan_hash": plan_hash,
            "base_structure_hash": base_hash,
            "engine": "classic",
            "validation": {
                "valid": False,
                "issues": [{"code": "missing_match_target"}],
            },
            "apply_requirements": {"force_required": False},
            "replacement_impact": {
                "legacy_match_count": 0,
                "stage_match_count": 0,
                "stage_count": 0,
            },
        },
        [{"id": "invalid", "tournament_id": "t1"}],
        None,
        SimpleNamespace(legacy_matches=[], stage_matches=[], stages=[]),
    ))
    monkeypatch.setattr(tournament_routes, "_build_tournament_structure_plan", build_plan)

    with pytest.raises(HTTPException) as error:
        asyncio.run(tournament_routes.apply_tournament_structure_plan(
            "t1",
            tournament_routes.TournamentStructureApplyPayload(
                preview=False,
                expected_plan_hash=plan_hash,
                expected_base_structure_hash=base_hash,
            ),
            {"id": "admin-1"},
        ))

    assert error.value.status_code == 422
    assert error.value.detail["code"] == "structure_plan_invalid"
    db.matches.insert_many.assert_not_awaited()
    db.matches.delete_many.assert_not_awaited()
    db.tournaments.update_one.assert_not_awaited()
    db.audit_logs.insert_one.assert_not_awaited()


def test_structure_apply_rejects_real_existing_matches_before_write(monkeypatch):
    tournament = {
        "id": "t1",
        "format": "single_elim",
        "max_participants": 4,
        "seeding_mode": "manual",
        "status": "draft",
    }
    existing = {
        "id": "real-match",
        "tournament_id": "t1",
        "round": 1,
        "match_index": 0,
        "participant_a_id": "r1",
        "participant_b_id": "r2",
        "status": "pending",
        "is_preview": False,
    }
    registrations = [
        {"id": f"r{seed}", "status": "approved", "seed": seed}
        for seed in range(1, 5)
    ]
    db = _bracket_rebuild_db(
        tournament=tournament,
        legacy_matches=[existing],
        registrations=registrations,
    )
    _patch_bracket_rebuild_dependencies(monkeypatch, db)
    plan = asyncio.run(tournament_routes.plan_bracket_from_tournament_format(
        "t1",
        tournament_routes.TournamentStructurePlanPayload(preview=False),
        {"id": "admin-1"},
    ))

    with pytest.raises(HTTPException) as error:
        asyncio.run(tournament_routes.apply_tournament_structure_plan(
            "t1",
            _apply_payload_from_plan(plan),
            {"id": "admin-1"},
        ))

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "protected_existing_structure"
    db.matches.insert_many.assert_not_awaited()
    db.matches.delete_many.assert_not_awaited()
    db.tournaments.update_one.assert_not_awaited()
    db.audit_logs.insert_one.assert_not_awaited()


def test_structure_apply_exact_retry_is_idempotent_without_replanning(monkeypatch):
    plan_hash = "a" * 64
    base_hash = "b" * 64
    tournament = {
        "id": "t1",
        "format": "round_robin",
        "max_participants": 4,
        "status": "draft",
        "engine_version": "competition.classic.v1",
        "structure_revision": 7,
        "last_structure_plan_hash": plan_hash,
        "last_structure_base_hash": base_hash,
    }
    db = _bracket_rebuild_db(tournament=tournament)
    _patch_bracket_rebuild_dependencies(monkeypatch, db)

    result = asyncio.run(tournament_routes.apply_tournament_structure_plan(
        "t1",
        tournament_routes.TournamentStructureApplyPayload(
            preview=False,
            expected_plan_hash=plan_hash,
            expected_base_structure_hash=base_hash,
        ),
        {"id": "admin-1"},
    ))

    assert result == {
        "ok": True,
        "idempotent_replay": True,
        "plan_hash": plan_hash,
        "base_structure_hash": base_hash,
        "plan_version": "competition.structure-plan.v1",
        "engine": "classic",
        "structure_revision": 7,
    }
    db.tournament_registrations.find.assert_not_called()
    db.matches.insert_many.assert_not_awaited()
    db.matches.delete_many.assert_not_awaited()
    db.tournaments.update_one.assert_not_awaited()
    db.audit_logs.insert_one.assert_not_awaited()


def test_structure_apply_restores_previous_preview_after_late_failure():
    tournament = {
        "id": "t1",
        "format": "round_robin",
        "status": "draft",
        "engine_version": "competition.classic.v1",
        "ruleset_version": "competition.ruleset.v1",
        "structure_revision": 2,
        "last_structure_plan_hash": "1" * 64,
        "last_structure_base_hash": "2" * 64,
    }
    previous_match = {
        "id": "old-preview",
        "tournament_id": "t1",
        "is_preview": True,
        "status": "preview",
    }
    db = _bracket_rebuild_db(tournament=tournament, legacy_matches=[previous_match])
    db.audit_logs.insert_one.side_effect = RuntimeError("audit unavailable")

    with pytest.raises(RuntimeError, match="audit unavailable"):
        asyncio.run(activate_structure_plan(
            db,
            tournament=tournament,
            engine="classic",
            matches=[{
                "id": "new-match",
                "tournament_id": "t1",
                "is_preview": False,
                "status": "pending",
            }],
            stage=None,
            previous_legacy_matches=[previous_match],
            previous_stage_matches=[],
            previous_stages=[],
            plan_hash="a" * 64,
            base_structure_hash="b" * 64,
            plan_version="competition.structure-plan.v1",
            actor_id="admin-1",
        ))

    db.matches.replace_one.assert_awaited_once_with(
        {"id": "old-preview"},
        previous_match,
        upsert=True,
    )
    assert db.matches.delete_many.await_count == 2
    assert db.tournaments.update_one.await_count == 2
    rollback_update = db.tournaments.update_one.await_args_list[-1].args[1]
    assert rollback_update["$set"]["structure_revision"] == 2
    assert rollback_update["$set"]["last_structure_plan_hash"] == "1" * 64
