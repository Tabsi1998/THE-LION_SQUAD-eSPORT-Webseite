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


# ---------------------------------------------------------------- Markierung am Konto

def legacy_hash(raw: str) -> str:
    """So wurde früher gehasht: die rohen UTF-8-Bytes, ab Byte 72 abgeschnitten."""
    return bcrypt.hashpw(raw.encode("utf-8")[:72], bcrypt.gensalt(4)).decode("utf-8")


async def stored_doc(flow, user_id: str) -> dict:
    return await flow.db.users.find_one({"id": user_id})


@pytest.mark.asyncio
async def test_new_accounts_reject_input_with_a_wrong_rest_beyond_72_bytes(flow):
    body = registration("a" * 72)
    assert (await flow.post("/api/auth/register", json=body)).status_code == 200
    stored = await flow.db.users.find_one({"email": body["email"]})
    assert stored["password_contract"] == 2
    await flow.db.users.update_one({"id": stored["id"]}, {"$set": {"email_verified": True}})

    assert (await login(flow, body["email"], "a" * 72 + "rest")).status_code == 401
    assert (await login(flow, body["email"], "a" * 72)).status_code == 200


@pytest.mark.asyncio
async def test_old_accounts_with_long_passwords_are_not_rehashed(flow):
    raw = "ä" * 80
    legacy = legacy_hash(raw)
    user = await stored_account(flow, legacy)

    assert (await login(flow, user["email"], raw)).status_code == 200
    stored = await stored_doc(flow, user["id"])
    assert stored["password_hash"] == legacy
    assert "password_contract" not in stored


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/auth/login", "/api/auth/mobile/login"])
async def test_sign_in_on_the_old_path_marks_and_rehashes_the_account(flow, path):
    legacy = legacy_hash(DECOMPOSED)
    user = await stored_account(flow, legacy)

    response = await flow.post(path, json={"email": user["email"], "password": DECOMPOSED})
    assert response.status_code == 200
    stored = await stored_doc(flow, user["id"])
    assert stored["password_contract"] == 2
    assert stored["password_hash"] != legacy
    assert bcrypt.checkpw(COMPOSED.encode("utf-8"), stored["password_hash"].encode("utf-8"))
    assert "password_contract" not in response.text

    assert (await login(flow, user["email"], COMPOSED)).status_code == 200


@pytest.mark.asyncio
async def test_failed_sign_in_changes_nothing(flow):
    legacy = legacy_hash("altes-testpasswort")
    user = await stored_account(flow, legacy)

    assert (await login(flow, user["email"], "falsches-testpasswort")).status_code == 401
    stored = await stored_doc(flow, user["id"])
    assert stored["password_hash"] == legacy
    assert "password_contract" not in stored


@pytest.mark.asyncio
async def test_change_password_marks_the_account(flow):
    user = await stored_account(flow, legacy_hash("altes-testpasswort"))
    flow.act_as(user)
    response = await flow.post("/api/auth/change-password", json={
        "current_password": "altes-testpasswort", "new_password": "neues-testpasswort",
    })
    assert response.status_code == 200
    assert (await stored_doc(flow, user["id"]))["password_contract"] == 2


@pytest.mark.asyncio
async def test_reset_marks_the_account(flow, monkeypatch):
    import routes.auth_routes as auth_routes

    links = []

    async def capture(template, to, **kwargs):
        links.append(kwargs.get("reset_url", ""))
        return {"ok": True}

    monkeypatch.setattr(auth_routes, "send_template", capture)
    user = await stored_account(flow, legacy_hash("altes-testpasswort"))
    assert (await flow.post("/api/auth/forgot-password", json={"email": user["email"]})).status_code == 200
    token = links[-1].split("token=", 1)[1].split("&", 1)[0]

    response = await flow.post("/api/auth/reset-password", json={"token": token, "new_password": "neues-testpasswort"})
    assert response.status_code == 200
    assert (await stored_doc(flow, user["id"]))["password_contract"] == 2


@pytest.mark.asyncio
async def test_setup_wizard_marks_the_admin_account(flow):
    admin = await flow.add_user(role="superadmin")
    flow.act_as(admin)
    response = await flow.post("/api/setup/complete", json={"new_admin_password": "neues-testpasswort"})
    assert response.status_code == 200
    stored = await stored_doc(flow, admin["id"])
    assert stored["password_contract"] == 2
    assert bcrypt.checkpw(b"neues-testpasswort", stored["password_hash"].encode("utf-8"))


@pytest.mark.asyncio
async def test_bootstrap_admin_is_marked(flow):
    from seed import seed_admin

    assert await seed_admin("start-admin@example.com", "start-testpasswort")
    stored = await flow.db.users.find_one({"email": "start-admin@example.com"})
    assert stored["password_contract"] == 2


def test_erasure_removes_the_marker():
    from routes import dsgvo_routes

    source = pathlib.Path(dsgvo_routes.__file__).read_text(encoding="utf-8")
    assert '"password_contract": ""' in source
