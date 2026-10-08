"""„Zuletzt aktiv“ (#942): ein normaler Aufruf mit gültigem Zugangs-Token schreibt den Stand der Sitzung fort - höchstens
einmal je Stunde (die Abfrage trifft nur ältere Stände), und ein Fehler dabei bricht den Aufruf nie ab."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from auth import LAST_ACTIVE_TOUCH_MINUTES, create_access_token, get_current_user, touch_session_activity


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "touch-tests-secret-with-at-least-32-characters")


def fake_db(session: dict | None, user: dict | None):
    users = SimpleNamespace(find_one=AsyncMock(return_value=user))
    memberships = SimpleNamespace(find_one=AsyncMock(return_value=None))
    staff = SimpleNamespace(count_documents=AsyncMock(return_value=0))
    sessions = SimpleNamespace(find_one=AsyncMock(return_value=session), update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1)))
    return SimpleNamespace(users=users, memberships=memberships, tournament_staff_assignments=staff, auth_sessions=sessions, refresh_tokens=SimpleNamespace())


def test_a_normal_call_touches_the_session_only_when_the_stand_is_older_than_an_hour(secret, monkeypatch):
    token = create_access_token("user-1", "paula@club-mail.at", "player", "jti-1", "fam-1")
    db = fake_db({"revoked": False, "expires_at": datetime.now(timezone.utc) + timedelta(days=1)}, {"id": "user-1", "role": "player", "is_active": True})
    monkeypatch.setattr("auth.get_db", lambda: db)
    request = SimpleNamespace(cookies={}, headers={"Authorization": f"Bearer {token}"})

    user = asyncio.run(get_current_user(request))
    assert user["id"] == "user-1"
    db.auth_sessions.update_one.assert_awaited_once()
    query, update = db.auth_sessions.update_one.await_args.args
    assert query["family_id"] == "fam-1" and query["user_id"] == "user-1"
    cutoffs = query["$or"]
    assert cutoffs[1] == {"last_active": None}
    cutoff = cutoffs[0]["last_active"]["$lt"]
    assert timedelta(minutes=LAST_ACTIVE_TOUCH_MINUTES - 1) < update["$set"]["last_active"] - cutoff <= timedelta(minutes=LAST_ACTIVE_TOUCH_MINUTES)


def test_a_failing_touch_never_breaks_the_call(secret):
    db = SimpleNamespace(auth_sessions=SimpleNamespace(update_one=AsyncMock(side_effect=RuntimeError("Datenbank weg"))))
    asyncio.run(touch_session_activity(db, "user-1", "fam-1", datetime.now(timezone.utc)))
    db.auth_sessions.update_one.assert_awaited_once()
