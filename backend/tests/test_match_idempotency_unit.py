import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import pathlib
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from models import MatchDispute, MatchScheduleProposalCreate, MatchScoreReport, MatchUpdate, MatchV2Update
import routes.match_routes as match_routes
import routes.match_v2_routes as match_v2_routes


class _MutableMatchCollection:
    def __init__(self, document):
        self.document = deepcopy(document)
        self.update_count = 0

    async def find_one(self, _query, _projection=None):
        return deepcopy(self.document)

    async def update_one(self, _query, update):
        self.update_count += 1
        self.document.update(deepcopy(update.get("$set") or {}))


def test_dispute_exact_replay_skips_write_audit_and_badge(monkeypatch):
    match = {
        "id": "match-1",
        "tournament_id": "t1",
        "status": "disputed",
        "disputes": [{"user_id": "user-1", "reason": "Falsches Ergebnis"}],
    }
    matches = _MutableMatchCollection(match)
    db = SimpleNamespace(matches=matches)
    audit = AsyncMock()

    monkeypatch.setattr(match_routes, "get_db", lambda: db)
    monkeypatch.setattr(match_routes, "_ensure_match_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(match_routes, "_user_registration_for_match", AsyncMock(return_value={"id": "reg-1"}))
    monkeypatch.setattr(match_routes, "_audit_match_action", audit)

    result = asyncio.run(match_routes.dispute(
        "match-1",
        MatchDispute(reason="  Falsches Ergebnis  "),
        {"id": "user-1", "role": "player"},
    ))

    assert result["idempotent_replay"] is True
    assert matches.update_count == 0
    audit.assert_not_awaited()


def test_forfeit_exact_replay_skips_advancement_and_notifications(monkeypatch):
    match = {
        "id": "match-1",
        "tournament_id": "t1",
        "participant_a_id": "reg-a",
        "participant_b_id": "reg-b",
        "winner_id": "reg-a",
        "loser_id": "reg-b",
        "status": "forfeit",
        "admin_decision_note": "Nicht erschienen",
    }
    matches = _MutableMatchCollection(match)
    db = SimpleNamespace(matches=matches)
    advance = Mock(side_effect=AssertionError("replay must not advance again"))
    notify = AsyncMock()

    monkeypatch.setattr(match_routes, "get_db", lambda: db)
    monkeypatch.setattr(match_routes, "_ensure_match_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(match_routes, "ensure_tournament_accepts_results", AsyncMock())
    monkeypatch.setattr(match_routes, "_require_result_permission", AsyncMock())
    monkeypatch.setattr(match_routes, "advance_match_winner", advance)
    monkeypatch.setattr(match_routes, "notify_match_result_confirmed", notify)

    result = asyncio.run(match_routes.forfeit(
        "match-1",
        {"winner_id": "reg-a", "note": " Nicht erschienen "},
        {"id": "admin-1", "role": "tournament_admin"},
    ))

    assert result["idempotent_replay"] is True
    assert matches.update_count == 0
    advance.assert_not_called()
    notify.assert_not_awaited()


def test_non_result_update_on_completed_match_does_not_repeat_completion_hooks(monkeypatch):
    match = {
        "id": "match-1",
        "tournament_id": "t1",
        "participant_a_id": "reg-a",
        "participant_b_id": "reg-b",
        "winner_id": "reg-a",
        "loser_id": "reg-b",
        "score_a": 2,
        "score_b": 0,
        "status": "completed",
        "admin_note": None,
    }
    matches = _MutableMatchCollection(match)
    db = SimpleNamespace(matches=matches)
    advance = Mock(side_effect=AssertionError("non-result update must not advance again"))
    audit = AsyncMock()

    monkeypatch.setattr(match_routes, "get_db", lambda: db)
    monkeypatch.setattr(match_routes, "_ensure_match_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(match_routes, "has_match_result_permission", AsyncMock(return_value=True))
    monkeypatch.setattr(match_routes, "ensure_tournament_accepts_results", AsyncMock())
    monkeypatch.setattr(match_routes, "ensure_station_slot_available", AsyncMock())
    monkeypatch.setattr(match_routes, "advance_match_winner", advance)
    monkeypatch.setattr(match_routes, "_audit_match_action", audit)

    result = asyncio.run(match_routes.update_match(
        "match-1",
        MatchUpdate(admin_note="Nur eine Notiz"),
        {"id": "admin-1", "role": "tournament_admin"},
    ))

    assert result["admin_note"] == "Nur eine Notiz"
    assert result["idempotent_replay"] is False
    assert matches.update_count == 1
    advance.assert_not_called()
    audit.assert_not_awaited()


def test_score_report_exact_replay_skips_second_report_and_audit(monkeypatch):
    report = {
        "id": "report-1",
        "registration_id": "reg-a",
        "user_id": "user-1",
        "score_a": 2,
        "score_b": 1,
        "screenshot_url": "https://example.test/proof",
        "note": "final",
    }
    match = {
        "id": "match-1",
        "tournament_id": "t1",
        "participant_a_id": "reg-a",
        "participant_b_id": "reg-b",
        "status": "waiting_result",
        "reports": [report],
    }
    matches = _MutableMatchCollection(match)
    db = SimpleNamespace(
        matches=matches,
        tournaments=SimpleNamespace(find_one=AsyncMock(return_value={})),
        tournament_stages=SimpleNamespace(find_one=AsyncMock()),
        tournament_registrations=SimpleNamespace(find_one=AsyncMock(return_value={"id": "reg-a"})),
    )
    audit = AsyncMock()

    monkeypatch.setattr(match_routes, "get_db", lambda: db)
    monkeypatch.setattr(match_routes, "_ensure_match_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(match_routes, "ensure_tournament_accepts_results", AsyncMock())
    monkeypatch.setattr(match_routes, "_audit_match_action", audit)

    result = asyncio.run(match_routes.report_score(
        "match-1",
        MatchScoreReport(
            score_a=2,
            score_b=1,
            screenshot_url="https://example.test/proof",
            note="final",
        ),
        {"id": "user-1", "role": "player"},
    ))

    assert result["idempotent_replay"] is True
    assert matches.update_count == 0
    audit.assert_not_awaited()


def test_schedule_proposal_exact_replay_reuses_pending_record(monkeypatch):
    scheduled_at = datetime(2026, 8, 20, 18, 0, tzinfo=timezone.utc)
    existing = {
        "id": "proposal-1",
        "match_id": "match-1",
        "actor_user_id": "user-1",
        "scheduled_at": scheduled_at.isoformat(),
        "note": "passt",
        "status": "pending",
        "kind": "proposal",
    }
    proposals = SimpleNamespace(find_one=AsyncMock(return_value=existing), insert_one=AsyncMock())
    db = SimpleNamespace(
        match_schedule_proposals=proposals,
        tournaments=SimpleNamespace(find_one=AsyncMock(return_value={"event_mode": "online"})),
        tournament_stages=SimpleNamespace(find_one=AsyncMock()),
    )
    match = {"id": "match-1", "tournament_id": "t1", "status": "ready"}

    monkeypatch.setattr(match_routes, "get_db", lambda: db)
    monkeypatch.setattr(match_routes, "_find_match_any", AsyncMock(return_value=(match, "matches")))
    monkeypatch.setattr(match_routes, "_acting_registration_for_match", AsyncMock(return_value={"id": "reg-a"}))
    monkeypatch.setattr(match_routes, "_can_act_for_match", AsyncMock(return_value=True))

    result = asyncio.run(match_routes.create_schedule_proposal(
        "match-1",
        MatchScheduleProposalCreate(scheduled_at=scheduled_at, note=" passt "),
        {"id": "user-1", "role": "player"},
    ))

    assert result["id"] == "proposal-1"
    assert result["idempotent_replay"] is True
    proposals.insert_one.assert_not_awaited()


def test_v2_match_update_exact_replay_skips_write(monkeypatch):
    match = {
        "id": "match-v2",
        "tournament_id": "t1",
        "status": "ready",
        "admin_note": "bestehend",
    }
    matches = _MutableMatchCollection(match)
    db = SimpleNamespace(matches_v2=matches)

    monkeypatch.setattr(match_v2_routes, "get_db", lambda: db)
    monkeypatch.setattr(match_v2_routes, "_ensure_match_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(match_v2_routes, "require_tournament_staff_permission", AsyncMock())
    monkeypatch.setattr(match_v2_routes, "ensure_station_slot_available", AsyncMock())

    result = asyncio.run(match_v2_routes.update_match_v2(
        "match-v2",
        MatchV2Update(admin_note="bestehend"),
        {"id": "admin-1", "role": "tournament_admin"},
    ))

    assert result["idempotent_replay"] is True
    assert matches.update_count == 0
