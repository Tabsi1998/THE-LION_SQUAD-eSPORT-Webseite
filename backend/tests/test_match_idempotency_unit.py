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


class _MutableMatchCollection:
    def __init__(self, document):
        self.document = deepcopy(document)
        self.update_count = 0

    async def find_one(self, _query, _projection=None):
        return deepcopy(self.document)

    async def update_one(self, _query, update):
        self.update_count += 1
        self.document.update(deepcopy(update.get("$set") or {}))


class _EmptyCollection:
    """Der andere Speicher, in dem dieses Match nicht liegt."""

    async def find_one(self, _query, _projection=None):
        return None


def test_dispute_exact_replay_skips_write_audit_and_badge(monkeypatch):
    match = {
        "id": "match-1",
        "tournament_id": "t1",
        "status": "disputed",
        "disputes": [{"user_id": "user-1", "reason": "Falsches Ergebnis"}],
    }
    matches = _MutableMatchCollection(match)
    db = SimpleNamespace(matches_v2=matches, matches=_EmptyCollection())
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

    monkeypatch.setattr(match_routes, "get_db", lambda: db)
    monkeypatch.setattr(match_routes, "_ensure_match_tournament_unlocked", AsyncMock())
    monkeypatch.setattr(match_routes, "require_tournament_staff_permission", AsyncMock())
    monkeypatch.setattr(match_routes, "ensure_station_slot_available", AsyncMock())

    result = asyncio.run(match_routes.update_match(
        "match-v2",
        MatchV2Update(admin_note="bestehend"),
        {"id": "admin-1", "role": "tournament_admin"},
    ))

    assert result["idempotent_replay"] is True
    assert matches.update_count == 0
