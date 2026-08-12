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


def test_authenticated_bootstrap_returns_the_user_without_refresh():
    response = Response()
    user = {"id": "user-1", "role": "player"}

    assert asyncio.run(me(SimpleNamespace(cookies={"refresh_token": "opaque"}), response, user)) == user
    assert "x-session-refresh" not in response.headers
