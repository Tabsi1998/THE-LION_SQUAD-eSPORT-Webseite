"""Passwortvertrag (#1033) über die echten Routen gegen die Datenbank im Speicher.

Registrierung, Anmeldung, Passwort ändern und Zurücksetzen folgen derselben Regel. Erfundene Konten und Testpasswörter."""
import pathlib
import sys
import unicodedata

import bcrypt
import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

from auth import hash_password, verify_password  # noqa: E402

COMPOSED = "Löwenrudel-Grüße"
DECOMPOSED = unicodedata.normalize("NFD", COMPOSED)
TOO_LONG = "ä" * 40


@pytest_asyncio.fixture
async def flow(monkeypatch):
    import routes.auth_routes as auth_routes

    async def no_mail(*args, **kwargs):
        return {"ok": True}

    monkeypatch.setattr(auth_routes, "send_template", no_mail)
    monkeypatch.setenv("JWT_SECRET", "password-tests-secret-with-at-least-32-characters")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def stored_account(flow, password_hash: str) -> dict:
    name = f"loewe-{new_id()[:6]}"
    user = {
        "id": new_id(), "username": name, "display_name": name, "email": f"{name}@example.com",
        "role": "player", "roles": ["player"], "is_active": True, "is_banned": False,
        "email_verified": True, "mfa_enabled": False, "password_hash": password_hash,
        "password_login_available": True, "privacy_policy_version": "2026-08-26",
    }
    await flow.db.users.insert_one(dict(user))
    flow.act_as(None)
    return user


async def login(flow, email: str, password: str):
    return await flow.post("/api/auth/login", json={"email": email, "password": password})


def registration(password: str) -> dict:
    name = f"loewe{new_id()[:6]}"
    return {
        "username": name, "email": f"{name}@example.com", "password": password,
        "accept_privacy": True, "accept_terms": True,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/auth/register", "/api/auth/mobile/register"])
async def test_registration_outside_the_contract_is_a_clear_validation_error(flow, path):
    response = await flow.post(path, json=registration(TOO_LONG))
    assert response.status_code == 422
    assert "72" in response.text


@pytest.mark.asyncio
async def test_registration_stores_the_normalized_form(flow):
    body = registration(DECOMPOSED)
    response = await flow.post("/api/auth/register", json=body)
    assert response.status_code == 200
    stored = await flow.db.users.find_one({"email": body["email"]})
    assert bcrypt.checkpw(COMPOSED.encode("utf-8"), stored["password_hash"].encode("utf-8"))

    await flow.db.users.update_one({"id": stored["id"]}, {"$set": {"email_verified": True}})
    assert (await login(flow, body["email"], COMPOSED)).status_code == 200
    assert (await login(flow, body["email"], DECOMPOSED)).status_code == 200


@pytest.mark.asyncio
async def test_existing_long_password_account_still_signs_in(flow):
    raw = "ä" * 80
    legacy = bcrypt.hashpw(raw.encode("utf-8")[:72], bcrypt.gensalt(4)).decode("utf-8")
    user = await stored_account(flow, legacy)

    assert (await login(flow, user["email"], raw)).status_code == 200
    assert (await login(flow, user["email"], "ö" * 80)).status_code == 401


@pytest.mark.asyncio
async def test_change_password_follows_the_same_contract(flow):
    user = await stored_account(flow, hash_password("altes-testpasswort"))
    flow.act_as(user)

    rejected = await flow.post("/api/auth/change-password", json={
        "current_password": "altes-testpasswort", "new_password": TOO_LONG,
    })
    assert rejected.status_code == 422

    accepted = await flow.post("/api/auth/change-password", json={
        "current_password": "altes-testpasswort", "new_password": DECOMPOSED,
    })
    assert accepted.status_code == 200
    stored = await flow.db.users.find_one({"id": user["id"]})
    assert verify_password(COMPOSED, stored["password_hash"])


@pytest.mark.asyncio
async def test_reset_password_follows_the_same_contract(flow):
    response = await flow.post("/api/auth/reset-password", json={"token": "egal", "new_password": TOO_LONG})
    assert response.status_code == 422
