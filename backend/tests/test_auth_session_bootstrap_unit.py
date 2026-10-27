import asyncio
from types import SimpleNamespace

from fastapi import Response

from routes.auth_routes import me


def test_guest_auth_bootstrap_returns_null_without_refresh_request():
    response = Response()
    result = asyncio.run(me(SimpleNamespace(cookies={}), response, None))

    assert result is None
    assert response.headers["cache-control"] == "no-store"
    assert "x-session-refresh" not in response.headers


def test_expired_access_session_signals_refresh_without_a_401():
    response = Response()
    result = asyncio.run(me(SimpleNamespace(cookies={"refresh_token": "opaque"}), response, None))

    assert result is None
    assert response.headers["x-session-refresh"] == "required"


def test_authenticated_bootstrap_returns_the_user_without_refresh(monkeypatch):
    response = Response()
    user = {"id": "user-1", "role": "player"}
    # Die Bereiche (#287) fragen den Vorstand in der Datenbank ab - hier ohne Datenbank.
    from services import permissions

    async def no_areas(_user, db=None):
        return set()

    monkeypatch.setattr(permissions, "areas_for", no_areas)
    # Captain einer externen Serie (#1749) - ebenfalls aus der Datenbank, hier: keiner.
    from services import reference_series_access

    async def no_captain(_db, _user):
        return False

    monkeypatch.setattr(reference_series_access, "has_captain_series", no_captain)
    monkeypatch.setattr("routes.auth_routes.get_db", lambda: None)
    # Tagesbonus (#617) - ebenfalls ohne Datenbank. Sonst wartete der Aufruf 30 s auf einen MongoDB-Server, den es
    # im Test nicht gibt, und der Fehler verschwand im Log (#2054).
    from services import xp

    daily = []

    async def note_daily_login(user_id):
        daily.append(user_id)

    monkeypatch.setattr(xp, "daily_login_once", note_daily_login)

    assert asyncio.run(me(SimpleNamespace(cookies={"refresh_token": "opaque"}), response, user)) == {
        **user, "areas": [], "has_series_captain": False}
    assert "x-session-refresh" not in response.headers
    assert daily == ["user-1"]
