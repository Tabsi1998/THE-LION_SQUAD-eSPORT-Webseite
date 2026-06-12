import pathlib
import sys

import anyio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from routes.tournament_routes import (
    _can_create_initial_stage_preview,
    _create_initial_bracket_preview,
    _finalize_bracket_for_checkin,
    _can_create_initial_legacy_preview,
    _estimate_legacy_preview_matches,
    _mixed_preview_registrations_for_tournament,
)
from bracket_engine import generate_bracket


class FakeCursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, _limit):
        return list(self.rows)

    def sort(self, *_args, **_kwargs):
        return self


class FakeCollection:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    async def count_documents(self, query):
        return len([row for row in self.rows if self._matches(row, query)])

    def find(self, query, _projection=None):
        return FakeCursor([row for row in self.rows if self._matches(row, query)])

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def insert_many(self, docs):
        self.rows.extend(dict(doc) for doc in docs)

    async def delete_many(self, query):
        self.rows = [row for row in self.rows if not self._matches(row, query)]

    async def update_one(self, query, update):
        for row in self.rows:
            if self._matches(row, query):
                row.update((update or {}).get("$set") or {})
                for key in ((update or {}).get("$unset") or {}):
                    row.pop(key, None)
                return

    async def distinct(self, key, query):
        return list({row.get(key) for row in self.rows if self._matches(row, query) and row.get(key) is not None})

    def _matches(self, row, query):
        for key, expected in (query or {}).items():
            actual = row.get(key)
            if isinstance(expected, dict) and "$in" in expected:
                if actual not in expected["$in"]:
                    return False
            elif actual != expected:
                return False
        return True


class FakeDb:
    def __init__(self, registrations=None):
        self.tournament_stages = FakeCollection()
        self.matches_v2 = FakeCollection()
        self.matches = FakeCollection()
        self.match_reports_v2 = FakeCollection()
        self.tournament_registrations = FakeCollection(registrations)
        self.audit_logs = FakeCollection()


def test_initial_preview_uses_selected_tournament_format():
    assert _estimate_legacy_preview_matches({"format": "single_elim", "max_participants": 16}) == 15
    assert _estimate_legacy_preview_matches({"format": "double_elim", "max_participants": 8}) == 15
    assert _estimate_legacy_preview_matches({"format": "round_robin", "max_participants": 8}) == 28


def test_initial_preview_skips_unsupported_or_too_large_formats():
    assert _can_create_initial_legacy_preview({"format": "single_elim", "max_participants": 64}) is True
    assert _can_create_initial_legacy_preview({"format": "ffa", "max_participants": 16}) is False
    assert _can_create_initial_legacy_preview({"format": "league", "max_participants": 32}) is False
    assert _can_create_initial_legacy_preview({"format": "custom_bracket", "max_participants": 8}) is False
    assert _can_create_initial_stage_preview({"format": "ffa", "max_participants": 8}) is True
    assert _can_create_initial_stage_preview({"format": "battle_royale", "max_participants": 8}) is True
    assert _can_create_initial_stage_preview({"format": "custom_bracket", "max_participants": 8}) is True
    assert _can_create_initial_stage_preview({"format": "ffa_custom_bracket", "max_participants": 8}) is True


def test_mixed_preview_fills_free_slots_with_preview_seeds():
    tournament = {"id": "t1", "format": "single_elim", "max_participants": 4}
    registrations = [
        {"id": "r1", "status": "approved", "display_name": "One"},
        {"id": "r-wait", "status": "waitlist", "display_name": "Wait"},
        {"id": "r2", "status": "checked_in", "display_name": "Two"},
    ]

    mixed = _mixed_preview_registrations_for_tournament(tournament, registrations)

    assert [reg["id"] for reg in mixed] == ["r1", "r2", "preview-seed-3", "preview-seed-4"]
    assert all(reg["status"] in {"approved", "checked_in"} for reg in mixed)
    assert [reg.get("is_preview", False) for reg in mixed] == [False, False, True, True]


def test_mixed_preview_can_generate_bracket_with_real_and_free_slots():
    tournament = {"id": "t1", "format": "single_elim", "max_participants": 4, "seeding_mode": "manual"}
    registrations = [
        {"id": "r1", "status": "approved", "display_name": "One", "seed": 1},
        {"id": "r2", "status": "approved", "display_name": "Two", "seed": 2},
    ]

    mixed = _mixed_preview_registrations_for_tournament(tournament, registrations)
    matches = generate_bracket(tournament, mixed, preview=True)
    participant_ids = {
        pid
        for match in matches
        for pid in (match.get("participant_a_id"), match.get("participant_b_id"))
        if pid
    }

    assert len(matches) == 3
    assert {"r1", "r2", "preview-seed-3", "preview-seed-4"} <= participant_ids
    assert all(match["is_preview"] for match in matches)


def test_initial_preview_creates_stage_for_custom_bracket():
    async def run():
        tournament = {"id": "t1", "format": "custom_bracket", "max_participants": 4, "seeding_mode": "random"}
        db = FakeDb()

        result = await _create_initial_bracket_preview(db, tournament, "admin-1")

        assert result["engine"] == "stages"
        assert result["match_count"] == 3
        assert len(db.tournament_stages.rows) == 1
        assert len(db.matches_v2.rows) == 3
        assert all(match["is_preview"] for match in db.matches_v2.rows)

    anyio.run(run)


def test_initial_preview_creates_stage_for_ffa_custom_bracket_with_registered_players():
    async def run():
        tournament = {"id": "t1", "format": "ffa_custom_bracket", "max_participants": 8, "seeding_mode": "manual"}
        db = FakeDb([
            {"id": "r1", "user_id": "u1", "tournament_id": "t1", "status": "approved", "seed": 1},
            {"id": "r2", "user_id": "u2", "tournament_id": "t1", "status": "checked_in", "seed": 2},
            {"id": "r-wait", "user_id": "u-wait", "tournament_id": "t1", "status": "waitlist", "seed": 3},
        ])

        result = await _create_initial_bracket_preview(db, tournament, "admin-1")
        registration_ids = {
            slot.get("registration_id")
            for match in db.matches_v2.rows
            for slot in match.get("slots", [])
            if slot.get("registration_id")
        }

        assert result["engine"] == "stages"
        assert result["participant_count"] == 2
        assert {"r1", "r2"} <= registration_ids
        assert "r-wait" not in registration_ids

    anyio.run(run)


def test_initial_preview_creates_stage_for_simple_ffa_tournament():
    async def run():
        tournament = {"id": "t1", "format": "ffa", "max_participants": 6, "seeding_mode": "manual"}
        db = FakeDb([
            {"id": "r1", "user_id": "u1", "tournament_id": "t1", "status": "approved", "seed": 1},
            {"id": "r2", "user_id": "u2", "tournament_id": "t1", "status": "approved", "seed": 2},
        ])

        result = await _create_initial_bracket_preview(db, tournament, "admin-1")

        assert result["engine"] == "stages"
        assert result["match_count"] == 1
        assert db.tournament_stages.rows[0]["stage_type"] == "simple"
        assert db.tournament_stages.rows[0]["match_type"] == "ffa"
        assert len(db.matches_v2.rows[0]["slots"]) == 6

    anyio.run(run)


def test_finalize_creates_stage_for_existing_custom_tournament_without_preview():
    async def run():
        tournament = {"id": "t1", "format": "custom_bracket", "max_participants": 4, "seeding_mode": "manual"}
        db = FakeDb([
            {"id": "r1", "user_id": "u1", "tournament_id": "t1", "status": "approved", "seed": 1},
            {"id": "r2", "user_id": "u2", "tournament_id": "t1", "status": "approved", "seed": 2},
            {"id": "r3", "user_id": "u3", "tournament_id": "t1", "status": "approved", "seed": 3},
            {"id": "r4", "user_id": "u4", "tournament_id": "t1", "status": "approved", "seed": 4},
        ])

        result = await _finalize_bracket_for_checkin(db, tournament, "admin-1")

        assert result["engine"] == "stages"
        assert result["preview"] is False
        assert result["participant_count"] == 4
        assert len(db.tournament_stages.rows) == 1
        assert len(db.matches_v2.rows) == 3
        assert all(not match["is_preview"] for match in db.matches_v2.rows)

    anyio.run(run)
