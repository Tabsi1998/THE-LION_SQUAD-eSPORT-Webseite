"""Anmeldung (#348) durch die echte Anwendung: angemeldet bleiben, Zwei-Faktor für alle
freiwillig und beim Login gefragt, Pflicht nur im Adminbereich."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from auth import REMEMBER_DAYS, SESSION_ONLY_HOURS, _decode, hash_password, token_remembers  # noqa: E402
from flow_harness import make_flow  # noqa: E402

PASSWORD = "Ein-langes-Testpasswort-42"


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Hier wird wirklich angemeldet - dafür braucht es den Schlüssel auch nach dem Import.
    monkeypatch.setenv("JWT_SECRET", "login-tests-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def account(flow, name, **fields):
    user = await flow.add_user(role=fields.pop("role", "player"), name=name)
    update = {"email": f"{name}@lionsquad-test.at", "email_verified": True, "password_hash": hash_password(PASSWORD),
              "mfa_enabled": False, **fields}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": update})
    user.update(update)
    return user


def cookie_lines(response, name):
    return [line for line in response.headers.get_list("set-cookie") if line.startswith(f"{name}=")]


async def login(flow, user, **body):
    flow.client.cookies.clear()
    return await flow.post("/api/auth/login", json={"email": user["email"], "password": PASSWORD, **body})


# ---------------------------------------------------------------- Angemeldet bleiben

@pytest.mark.asyncio
async def test_remember_me_keeps_the_session_for_90_days_and_renews_it(flow):
    user = await account(flow, "paula")
    response = await login(flow, user, remember=True)
    assert response.status_code == 200, response.text
    refresh_cookie = cookie_lines(response, "refresh_token")[0]
    assert f"Max-Age={REMEMBER_DAYS * 24 * 3600}" in refresh_cookie
    payload = _decode(flow.client.cookies.get("refresh_token"))
    assert token_remembers(payload) is True
    expires = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
    assert timedelta(days=REMEMBER_DAYS - 1) < expires - datetime.now(timezone.utc) <= timedelta(days=REMEMBER_DAYS)

    renewed = await flow.post("/api/auth/refresh", headers={"X-CSRF-Token": flow.client.cookies.get("csrf_token")})
    assert renewed.status_code == 200, renewed.text
    assert f"Max-Age={REMEMBER_DAYS * 24 * 3600}" in cookie_lines(renewed, "refresh_token")[0], "die Frist beginnt mit jeder Nutzung neu"
    assert token_remembers(_decode(flow.client.cookies.get("refresh_token"))) is True


@pytest.mark.asyncio
async def test_without_the_tick_the_session_ends_with_the_browser(flow):
    user = await account(flow, "gast")
    response = await login(flow, user, remember=False)
    assert response.status_code == 200, response.text
    for name in ("access_token", "refresh_token", "csrf_token"):
        line = cookie_lines(response, name)[0]
        assert "Max-Age" not in line and "expires" not in line.lower(), f"{name} darf den Browser-Neustart nicht überleben"
    payload = _decode(flow.client.cookies.get("refresh_token"))
    assert token_remembers(payload) is False
    expires = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
    assert expires - datetime.now(timezone.utc) <= timedelta(hours=SESSION_ONLY_HOURS)

    renewed = await flow.post("/api/auth/refresh", headers={"X-CSRF-Token": flow.client.cookies.get("csrf_token")})
    assert renewed.status_code == 200
    assert "Max-Age" not in cookie_lines(renewed, "refresh_token")[0], "auch nach dem Erneuern bleibt es eine Sitzung bis zum Schließen"
    assert token_remembers(_decode(flow.client.cookies.get("refresh_token"))) is False


def test_sessions_from_before_the_change_count_as_remembered():
    assert token_remembers({"sub": "u", "type": "refresh"}) is True
    assert token_remembers(None) is True
    assert token_remembers({"rem": False}) is False


@pytest.mark.asyncio
async def test_default_is_to_stay_signed_in_and_the_device_list_says_until_when(flow):
    user = await account(flow, "app")
    response = await login(flow, user)
    assert "Max-Age" in cookie_lines(response, "refresh_token")[0], "ältere Clients und die App schicken den Haken nicht mit"
    flow.act_as(user)
    sessions = (await flow.get("/api/auth/sessions")).json()
    assert sessions and sessions[0]["expires_at"]
    until = datetime.fromisoformat(sessions[0]["expires_at"])
    assert until - datetime.now(timezone.utc) > timedelta(days=REMEMBER_DAYS - 1)


# ---------------------------------------------------------------- Zwei-Faktor

@pytest.mark.asyncio
async def test_anyone_may_set_up_two_factor_and_is_then_asked_at_login(flow):
    spieler = await account(flow, "spieler")
    flow.act_as(spieler)
    flow.client.cookies.clear()
    started = await flow.post("/api/auth/mfa/setup", json={"current_password": PASSWORD})
    assert started.status_code == 200, started.text
    assert started.json()["secret"]

    await flow.db.users.update_one({"id": spieler["id"]}, {"$set": {"mfa_enabled": True}})
    flow.act_as(None)
    challenged = await login(flow, spieler, remember=False)
    assert challenged.status_code == 200 and challenged.json()["mfa_required"] is True
    assert cookie_lines(challenged, "refresh_token") == [], "vor dem Code gibt es keine Sitzung"
    stored = await flow.db.mfa_login_challenges.find_one({"user_id": spieler["id"]})
    assert stored["remember"] is False, "der Haken überlebt den Umweg über den Code"


@pytest.mark.asyncio
async def test_without_two_factor_a_player_is_never_blocked_but_an_admin_area_stays_closed(flow):
    spieler = await account(flow, "ohne2fa")
    assert (await login(flow, spieler)).status_code == 200

    redaktion = await account(flow, "redaktion", areas=["content"], mfa_enabled=False)
    redaktion.update({"mfa_enabled": False, "auth_mfa_verified": False})
    flow.act_as(redaktion)
    flow.client.cookies.clear()
    assert (await flow.get("/api/admin/news")).status_code == 403
    status = (await flow.get("/api/auth/mfa/status")).json()
    assert status["required_for_admin"] is True and status["enabled"] is False, "auch ein freigegebener Bereich verlangt Zwei-Faktor"

    flow.act_as(spieler | {"mfa_enabled": False})
    assert (await flow.get("/api/auth/mfa/status")).json()["required_for_admin"] is False
