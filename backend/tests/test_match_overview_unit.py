"""Regression tests for Package 5 dashboard match overviews."""
import asyncio

from services.match_overview import (
    match_overview_sort_key,
    operational_match_overviews,
    own_match_overviews,
)


def _value_at(doc, path):
    value = doc
    for part in path.split("."):
        if isinstance(value, list):
            return [item.get(part) for item in value if isinstance(item, dict)]
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _matches(doc, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, child) for child in expected):
                return False
            continue
        value = _value_at(doc, key)
        if isinstance(expected, dict) and "$in" in expected:
            allowed = expected["$in"]
            if isinstance(value, list):
                if not any(item in allowed for item in value):
                    return False
            elif value not in allowed:
                return False
        elif isinstance(expected, dict) and "$ne" in expected:
            if value == expected["$ne"]:
                return False
        elif value != expected:
            return False
    return True


class FakeCursor:
    def __init__(self, docs):
        self.docs = list(docs)

    async def to_list(self, limit):
        return self.docs[:limit]


class FakeCollection:
    def __init__(self, docs=()):
        self.docs = list(docs)

    def find(self, query, projection=None):
        rows = [dict(doc) for doc in self.docs if _matches(doc, query)]
        if projection:
            included = {key for key, enabled in projection.items() if enabled and key != "_id"}
            if included:
                rows = [{key: row.get(key) for key in included if key in row} for row in rows]
        return FakeCursor(rows)


class FakeDb:
    def __init__(self, *, assignments=()):
        self.team_members = FakeCollection()
        self.tournament_registrations = FakeCollection([
            {"id": "r-own", "user_id": "u1", "status": "approved", "tournament_id": "t1", "display_name": "Lion"},
            {"id": "r-other", "user_id": "u2", "status": "approved", "tournament_id": "t1", "display_name": "Opponent"},
        ])
        self.matches = FakeCollection([
            {"id": "m-scheduled", "tournament_id": "t1", "status": "scheduled", "scheduled_at": "2026-08-06T12:00:00+00:00", "participant_a_id": "r-own", "participant_b_id": "r-other", "round": 1},
            {"id": "m-live", "tournament_id": "t1", "status": "in_progress", "scheduled_at": "2026-08-06T13:00:00+00:00", "participant_a_id": "r-own", "participant_b_id": "r-other", "round": 2},
            {"id": "m-done", "tournament_id": "t1", "status": "completed", "participant_a_id": "r-own", "participant_b_id": "r-other"},
            {"id": "m-unrelated", "tournament_id": "t1", "status": "in_progress", "participant_a_id": "r-other", "participant_b_id": "r-x"},
        ])
        self.matches_v2 = FakeCollection()
        self.tournaments = FakeCollection([{"id": "t1", "title": "Cup", "slug": "cup", "status": "live"}])
        self.teams = FakeCollection()
        self.stations = FakeCollection()
        self.tournament_staff_assignments = FakeCollection(assignments)


def test_live_match_sorts_before_later_scheduled_match():
    scheduled = {"id": "scheduled", "status": "scheduled", "scheduled_at": "2026-08-06T10:00:00+00:00"}
    live = {"id": "live", "status": "in_progress", "scheduled_at": "2026-08-06T12:00:00+00:00"}

    assert sorted([scheduled, live], key=match_overview_sort_key)[0]["id"] == "live"


def test_invalid_schedule_sorts_after_valid_schedule_in_same_status():
    invalid = {"id": "invalid", "status": "scheduled", "scheduled_at": "not-a-date"}
    valid = {"id": "valid", "status": "scheduled", "scheduled_at": "2026-08-06T12:00:00+00:00"}

    assert sorted([invalid, valid], key=match_overview_sort_key)[0]["id"] == "valid"


def test_own_overview_only_returns_open_user_matches_with_opponent():
    rows, registrations = asyncio.run(own_match_overviews(FakeDb(), {"id": "u1", "role": "user"}))

    assert [row["id"] for row in rows] == ["m-live", "m-scheduled"]
    assert rows[0]["needs_result"] is True
    assert rows[0]["is_own_match"] is True
    assert rows[0]["opponent_name"] == "Opponent"
    assert [row["id"] for row in registrations] == ["r-own"]


def test_operational_overview_honors_exact_match_assignment():
    db = FakeDb(assignments=[{
        "user_id": "staff1",
        "tournament_id": "t1",
        "role": "scorekeeper",
        "scope": "match",
        "scope_id": "m-live",
        "is_active": True,
    }])

    rows = asyncio.run(operational_match_overviews(db, {"id": "staff1", "role": "user"}))

    assert [row["id"] for row in rows] == ["m-live"]
    assert rows[0]["can_submit_result"] is True
    assert rows[0]["is_own_match"] is False


def test_own_overview_uses_same_contract_for_stage_matches():
    db = FakeDb()
    db.matches = FakeCollection()
    db.matches_v2 = FakeCollection([{
        "id": "m-stage",
        "tournament_id": "t1",
        "stage_id": "s1",
        "stage_number": 1,
        "match_key": "A",
        "round": 1,
        "status": "in_progress",
        "slots": [
            {"slot": 1, "source": {"type": "seed", "seed": 1}, "registration_id": "r-own", "status": "filled"},
            {"slot": 2, "source": {"type": "seed", "seed": 2}, "registration_id": "r-other", "status": "filled"},
        ],
        "results": [],
        "advancement": [],
    }])

    rows, _registrations = asyncio.run(own_match_overviews(db, {"id": "u1", "role": "user"}))

    assert [row["id"] for row in rows] == ["m-stage"]
    assert rows[0]["collection"] == "matches_v2"
    assert rows[0]["participant_names"] == ["Lion", "Opponent"]
    assert rows[0]["opponent_name"] == "Opponent"
    assert rows[0]["is_own_match"] is True
