"""Abmelden beendet die Sitzung sofort (#2395, übernommen aus der Live-Datei test_iter14_logout_regression.py).

Vertrag, über die echten Routen und die echte Anmelde-Prüfung (ohne die Abkürzung des Flow-Harness):
- Nach dem Anmelden mit Passwort kennt ``/api/auth/me`` die Person, eine geschützte Route antwortet.
- Nach ``/api/auth/logout`` antwortet ``/api/auth/me`` mit ``null`` - auch wenn der Browser das alte Zugangs-Cookie
  noch mitschickt -, und eine geschützte Route lehnt mit 401 ab.
Erfundenes Konto und Testpasswort."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import load_application, make_flow, new_id  # noqa: E402

import auth  # noqa: E402

PASSWORD = "Loewen-Testpasswort-7"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "logout-tests-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    # Die echte Anmelde-Prüfung statt der Abkürzung: Cookie und Sitzung entscheiden, nicht flow.user.
    _database, server, get_current_user, get_optional_user = load_application()
    server.app.dependency_overrides.pop(get_current_user, None)
    server.app.dependency_overrides.pop(get_optional_user, None)
    try:
        yield instance
    finally:
        await shutdown()


async def account(flow) -> dict:
    name = f"loewe-{new_id()[:6]}"
    user = {
        "id": new_id(), "username": name, "display_name": name, "email": f"{name}@example.com",
        "role": "player", "roles": ["player"], "is_active": True, "is_banned": False,
        "email_verified": True, "mfa_enabled": False, **auth.password_fields(PASSWORD),
        "password_login_available": True, "privacy_policy_version": "2026-08-26",
    }
    await flow.db.users.insert_one(dict(user))
    return user


def keep_cookies(flow, response) -> dict:
    """Die Cookies der Antwort wie ein Browser behalten (ohne „Secure“, der Testserver spricht http)."""
    jar = {name: value for name, value in response.cookies.items()}
    for name, value in jar.items():
        flow.client.cookies.set(name, value)
    return jar


@pytest.mark.asyncio
async def test_logout_ends_the_session_at_once(flow):
    user = await account(flow)
    signed_in = await flow.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD})
    assert signed_in.status_code == 200, signed_in.text[:300]
    jar = keep_cookies(flow, signed_in)
    assert {"access_token", "refresh_token", "csrf_token"} <= set(jar)

    me = await flow.get("/api/auth/me")
    assert me.status_code == 200 and (me.json() or {}).get("id") == user["id"]
    before = await flow.get("/api/auth/sessions")
    assert before.status_code == 200

    out = await flow.post("/api/auth/logout", headers={"X-CSRF-Token": jar["csrf_token"]})
    assert out.status_code == 200, out.text[:300]

    # Ein Browser, der das alte Zugangs-Cookie trotzdem noch schickt, ist nicht mehr angemeldet.
    flow.client.cookies.set("access_token", jar["access_token"])
    after_me = await flow.get("/api/auth/me")
    assert after_me.status_code == 200
    assert after_me.json() is None, after_me.text[:200]
    after = await flow.get("/api/auth/sessions")
    assert after.status_code == 401
