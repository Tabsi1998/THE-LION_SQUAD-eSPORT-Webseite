"""App-Anmeldung mit Passwort (#919) durch die echte Anwendung: die Antwort bringt das Anlege-Ticket für einen Passkey mit,
das Ticket öffnet genau einmal die Passkey-Anlage dieses Kontos - ohne Passwort; ohne Passkeys für die App gibt es keins."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from auth import hash_password  # noqa: E402
from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    # Echte App-Sitzung: Tokens brauchen den Schlüssel, Passkeys eine Website-Adresse.
    monkeypatch.setenv("JWT_SECRET", "test-jwt-secret-for-the-app-login-only-0123456789")
    monkeypatch.setenv("FRONTEND_URL", "https://club.example")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def member(flow, email="paula@club-mail.at"):
    user = await flow.add_user(role="player", name="paula")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"email": email, "email_verified": True, "mfa_enabled": False, "password_hash": hash_password("geheim-42")}})
    flow.act_as(None)
    return user


@pytest.mark.asyncio
async def test_password_login_in_the_app_brings_a_one_time_passkey_ticket(flow, monkeypatch):
    user = await member(flow)
    response = await flow.post("/api/auth/mobile/login", json={"email": "paula@club-mail.at", "password": "geheim-42"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"] and isinstance(body["passkey_ticket"], str) and len(body["passkey_ticket"]) >= 32
    stored = await flow.db.passkey_challenges.find_one({"kind": "mobile-enroll", "user_id": user["id"]}, {"_id": 1})
    assert stored and stored["_id"] != body["passkey_ticket"], "nur der Hash liegt in der Datenbank"

    flow.act_as({**user, "email": "paula@club-mail.at", "email_verified": True})
    start = await flow.post("/api/auth/passkeys/mobile/register/options", json={"enroll_ticket": body["passkey_ticket"], "name": "Mein Handy"})
    assert start.status_code == 200, start.text
    assert start.json()["options"]["rp"]["id"] == "club.example"
    again = await flow.post("/api/auth/passkeys/mobile/register/options", json={"enroll_ticket": body["passkey_ticket"]})
    assert again.status_code == 401, "einmal"


@pytest.mark.asyncio
async def test_without_app_passkeys_the_login_has_no_ticket(flow, monkeypatch):
    monkeypatch.setenv("PASSKEY_APK_KEY_HASHES", "")
    await member(flow)
    body = (await flow.post("/api/auth/mobile/login", json={"email": "paula@club-mail.at", "password": "geheim-42"})).json()
    assert body["access_token"] and body["passkey_ticket"] is None
