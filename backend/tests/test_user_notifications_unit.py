import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

pytest.importorskip("email_validator")

from datetime import datetime, timezone
from services.user_notifications import create_user_notification


class _Collection:
    def __init__(self, rows=None):
        self.rows = rows or []

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if _matches(row, query):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return None

    async def update_one(self, query, update):
        for row in self.rows:
            if _matches(row, query):
                row.update((update or {}).get("$set") or {})
                return None
        return None


class _Db:
    def __init__(self, user):
        self.users = _Collection([user])
        self.notifications = _Collection([])


def _value(row, dotted):
    value = row
    for part in dotted.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _matches(row, query):
    for key, expected in query.items():
        actual = _value(row, key)
        if isinstance(expected, dict):
            if "$gte" in expected and not (actual >= expected["$gte"]):
                return False
            continue
        if actual != expected:
            return False
    return True


@pytest.mark.anyio
async def test_create_user_notification_dedupes_by_meta_key(monkeypatch):
    db = _Db({"id": "u1", "notification_preferences": {"push": False, "in_app": True}})
    monkeypatch.setattr("services.user_notifications.get_db", lambda: db)

    first = await create_user_notification("u1", "Match", kind="match_reminder", meta={"dedupe_key": "same"})
    second = await create_user_notification("u1", "Match", kind="match_reminder", meta={"dedupe_key": "same"})

    assert first is not None
    assert second is None
    assert len(db.notifications.rows) == 1
    assert db.notifications.rows[0]["push_sent_count"] == 0


@pytest.mark.anyio
async def test_create_user_notification_uses_kind_cooldown(monkeypatch):
    db = _Db({"id": "u1", "notification_preferences": {"push": False, "in_app": True}})
    db.notifications.rows.append({
        "id": "n1",
        "user_id": "u1",
        "kind": "tournament_checkin",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "meta": {"category": "tournament_updates", "tournament_id": "t1"},
    })
    monkeypatch.setattr("services.user_notifications.get_db", lambda: db)

    created = await create_user_notification(
        "u1",
        "Check-in",
        kind="tournament_checkin",
        meta={"category": "tournament_updates", "tournament_id": "t1"},
    )

    assert created is None
    assert len(db.notifications.rows) == 1
