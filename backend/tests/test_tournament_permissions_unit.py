import asyncio
import sys
import types
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

database_stub = types.ModuleType("database")
database_stub.get_db = lambda: None
sys.modules.setdefault("database", database_stub)

import services.tournament_permissions as perms


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, _limit):
        return list(self.docs)


class FakeStaffAssignments:
    def __init__(self, docs):
        self.docs = docs
        self.find_query = None

    async def distinct(self, field, query):
        values = []
        for doc in self.docs:
            if _matches(doc, query) and doc.get(field) not in values:
                values.append(doc.get(field))
        return values

    def find(self, query, _projection=None):
        self.find_query = query
        return FakeCursor([doc for doc in self.docs if _matches(doc, query)])


class FakeDb:
    def __init__(self, docs):
        self.tournament_staff_assignments = FakeStaffAssignments(docs)


def _matches(doc, query):
    for key, expected in query.items():
        value = doc.get(key)
        if isinstance(expected, dict) and "$ne" in expected:
            if value == expected["$ne"]:
                return False
        elif isinstance(expected, dict) and "$in" in expected:
            if value not in expected["$in"]:
                return False
        elif value != expected:
            return False
    return True


def test_global_tournament_staff_does_not_need_assignment(monkeypatch):
    monkeypatch.setattr(perms, "get_db", lambda: pytest.fail("global roles must not query assignments"))

    assert asyncio.run(perms.has_tournament_staff_permission(
        {"id": "u1", "role": "moderator"},
        "t1",
        perms.RESULT_STAFF_ROLES,
    ))


def test_assigned_tournament_ids_only_returns_active_assignments(monkeypatch):
    db = FakeDb([
        {"tournament_id": "t1", "user_id": "u1", "role": "scorekeeper", "is_active": True},
        {"tournament_id": "t2", "user_id": "u1", "role": "referee", "is_active": False},
        {"tournament_id": "t3", "user_id": "u2", "role": "referee", "is_active": True},
    ])
    monkeypatch.setattr(perms, "get_db", lambda: db)

    assert asyncio.run(perms.assigned_tournament_ids({"id": "u1", "role": "user"})) == ["t1"]


def test_role_and_scope_permissions(monkeypatch):
    db = FakeDb([
        {"tournament_id": "t1", "user_id": "u1", "role": "scorekeeper", "scope": "station", "scope_id": "s1", "is_active": True},
        {"tournament_id": "t1", "user_id": "u1", "role": "stream_operator", "scope": "tournament", "is_active": True},
        {"tournament_id": "t1", "user_id": "u2", "role": "referee", "scope": "tournament", "is_active": True},
    ])
    monkeypatch.setattr(perms, "get_db", lambda: db)
    user = {"id": "u1", "role": "user"}

    assert asyncio.run(perms.has_tournament_staff_permission(user, "t1", perms.RESULT_STAFF_ROLES, "station", "s1"))
    assert not asyncio.run(perms.has_tournament_staff_permission(user, "t1", perms.RESULT_STAFF_ROLES, "station", "s2"))
    assert asyncio.run(perms.has_tournament_staff_permission(user, "t1", perms.READ_STAFF_ROLES, "match", "m1"))


def test_require_tournament_staff_permission_raises_403(monkeypatch):
    db = FakeDb([])
    monkeypatch.setattr(perms, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(perms.require_tournament_staff_permission(
            {"id": "u1", "role": "user"},
            "t1",
            perms.CHECKIN_STAFF_ROLES,
        ))
    assert exc.value.status_code == 403
