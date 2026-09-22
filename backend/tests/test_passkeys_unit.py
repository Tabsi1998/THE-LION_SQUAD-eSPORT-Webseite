import asyncio
import hashlib
import json
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, Response
from pymongo.errors import DuplicateKeyError
from webauthn.helpers import bytes_to_base64url

from models import now_utc
from routes import passkey_routes as routes


class Documents:
    def __init__(self, rows=()):
        self.rows = list(deepcopy(rows))

    def matches(self, row, query):
        return all(row.get(key) > value["$gt"] if isinstance(value, dict) and "$gt" in value else row.get(key) == value for key, value in query.items())

    async def insert_one(self, row):
        if any(existing.get("_id") == row.get("_id") for existing in self.rows):
            raise DuplicateKeyError("duplicate")
        self.rows.append(deepcopy(row))

    async def find_one(self, query, *_args):
        return next((deepcopy(row) for row in self.rows if self.matches(row, query)), None)

    async def find_one_and_delete(self, query):
        for index, row in enumerate(self.rows):
            if self.matches(row, query):
                return self.rows.pop(index)
        return None

    async def update_one(self, query, update):
        for row in self.rows:
            if self.matches(row, query):
                row.update(deepcopy(update["$set"]))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query):
        return SimpleNamespace(deleted_count=int(await self.find_one_and_delete(query) is not None))

    def find(self, query, *_args):
        rows = [deepcopy(row) for row in self.rows if self.matches(row, query)]
        return SimpleNamespace(to_list=AsyncMock(return_value=rows))


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://club.example")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("PASSKEY_ENABLED", "true")
    user = {"id": "user-1", "email": "test@example.test", "email_verified": True,
            "password_hash": "stored", "role": "player", "is_active": True}
    db = SimpleNamespace(users=Documents([user]), passkeys=Documents(), passkey_challenges=Documents())
    monkeypatch.setattr(routes, "get_db", lambda: db)
    monkeypatch.setattr(routes, "enforce_rate_limit", AsyncMock())
    monkeypatch.setattr(routes, "verify_password", lambda password, _stored: password == "correct-password")
    monkeypatch.setattr(routes, "_current_session_family", AsyncMock(return_value="session-1"))
    monkeypatch.setattr(routes, "_security_audit", AsyncMock())
    monkeypatch.setattr(routes, "_attach_membership", AsyncMock())
    issue = AsyncMock()
    monkeypatch.setattr(routes, "_issue_session", issue)
    request = SimpleNamespace(headers={"origin": "https://club.example"}, cookies={})
    return db, user, request, issue


def bind_cookie(request, response, kind):
    cookie = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
    request.cookies[f"tls_passkey_{kind}"] = cookie


def registration_credential(options, private_key, origin="https://club.example", flags=0x45):
    public = private_key.public_key().public_numbers()
    cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: public.x.to_bytes(32), -3: public.y.to_bytes(32)})
    identifier = b"test-passkey-credential"
    auth_data = hashlib.sha256(b"club.example").digest() + bytes([flags]) + bytes(4) + bytes(16) + len(identifier).to_bytes(2) + identifier + cose
    client_data = json.dumps({"type": "webauthn.create", "challenge": options["challenge"], "origin": origin, "crossOrigin": False}).encode()
    return {"id": bytes_to_base64url(identifier), "rawId": bytes_to_base64url(identifier), "type": "public-key", "response": {
        "clientDataJSON": bytes_to_base64url(client_data),
        "attestationObject": bytes_to_base64url(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})),
    }}


def authentication_credential(options, private_key, origin="https://club.example", flags=5, count=1):
    auth_data = hashlib.sha256(b"club.example").digest() + bytes([flags]) + count.to_bytes(4)
    client_data = json.dumps({"type": "webauthn.get", "challenge": options["challenge"], "origin": origin, "crossOrigin": False}).encode()
    signature = private_key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
    return {"id": bytes_to_base64url(b"test-passkey-credential"), "rawId": bytes_to_base64url(b"test-passkey-credential"), "type": "public-key", "response": {
        "clientDataJSON": bytes_to_base64url(client_data), "authenticatorData": bytes_to_base64url(auth_data),
        "signature": bytes_to_base64url(signature), "userHandle": bytes_to_base64url(b"user-1"),
    }}


async def enroll(setup, private_key):
    _db, user, request, _issue = setup
    response = Response()
    options = await routes.registration_options(routes.RegistrationStart(current_password="correct-password"), request, response, user)
    bind_cookie(request, response, "register")
    credential = registration_credential(options, private_key)
    assert await routes.registration_verify(routes.CredentialResponse(credential=credential), request, Response(), user) == {"ok": True}


def test_real_cryptographic_enrollment_login_and_replay_rejection(setup):
    async def scenario():
        db, _user, request, issue = setup
        private_key = ec.generate_private_key(ec.SECP256R1())
        await enroll(setup, private_key)
        assert len(db.passkeys.rows) == 1
        response = Response()
        options = await routes.login_options(request, response)
        assert options["userVerification"] == "required"
        assert not options.get("allowCredentials")
        bind_cookie(request, response, "login")
        body = routes.CredentialResponse(credential=authentication_credential(options, private_key))
        await routes.login_verify(body, request, Response())
        assert db.passkeys.rows[0]["sign_count"] == 1
        issue.assert_awaited_once()
        with pytest.raises(HTTPException) as error:
            await routes.login_verify(body, request, Response())
        assert error.value.status_code == 401
        assert issue.await_count == 1
    asyncio.run(scenario())


@pytest.mark.parametrize("problem", ["wrong_origin", "missing_uv", "wrong_signature", "wrong_challenge", "wrong_handle", "expired", "missing_cookie", "banned", "unverified"])
def test_passkey_login_security_boundaries(setup, problem):
    async def scenario():
        db, _user, request, issue = setup
        private_key = ec.generate_private_key(ec.SECP256R1())
        await enroll(setup, private_key)
        response = Response()
        options = await routes.login_options(request, response)
        bind_cookie(request, response, "login")
        signing_key = ec.generate_private_key(ec.SECP256R1()) if problem == "wrong_signature" else private_key
        if problem == "wrong_challenge":
            options["challenge"] = bytes_to_base64url(b"wrong-challenge")
        credential = authentication_credential(options, signing_key, origin="https://attacker.example" if problem == "wrong_origin" else "https://club.example", flags=1 if problem == "missing_uv" else 5)
        if problem == "wrong_handle":
            credential["response"]["userHandle"] = bytes_to_base64url(b"someone-else")
        if problem == "expired":
            db.passkey_challenges.rows[-1]["expires_at"] = now_utc() - timedelta(seconds=1)
        if problem == "missing_cookie":
            request.cookies.clear()
        if problem == "banned":
            db.users.rows[0]["is_banned"] = True
        if problem == "unverified":
            db.users.rows[0]["email_verified"] = False
        with pytest.raises(HTTPException):
            await routes.login_verify(routes.CredentialResponse(credential=credential), request, Response())
        issue.assert_not_awaited()
    asyncio.run(scenario())


def test_passkey_with_device_lock_counts_as_second_factor(setup):
    """Entscheidung des Betreibers (#358, Variante B): Nach dem Passkey kein Code mehr - die
    Gerätesperre ist der zweite Faktor. Die Sitzung ist bestätigt, auch für Adminbereiche.
    Ohne Gerätesperre (missing_uv oben) gibt es weiterhin gar keine Anmeldung."""
    async def scenario():
        db, _user, request, issue = setup
        private_key = ec.generate_private_key(ec.SECP256R1())
        await enroll(setup, private_key)
        # Erst nach dem Einrichten Admin mit Zwei-Faktor - das Einrichten selbst verlangt die bestätigte Sitzung.
        db.users.rows[0].update(role="superadmin", mfa_enabled=True)
        response = Response()
        options = await routes.login_options(request, response)
        bind_cookie(request, response, "login")
        credential = authentication_credential(options, private_key)
        result = await routes.login_verify(routes.CredentialResponse(credential=credential), request, Response())
        assert "mfa_required" not in result and result["id"] == "user-1"
        issue.assert_awaited_once()
        assert issue.await_args.kwargs["mfa_verified"] is True
    asyncio.run(scenario())


@pytest.mark.parametrize("problem", ["wrong_password", "unverified", "admin_without_mfa", "wrong_request_origin"])
def test_enrollment_requires_owner_reauthentication(setup, problem):
    async def scenario():
        db, user, request, _issue = setup
        if problem == "unverified":
            db.users.rows[0]["email_verified"] = False
        if problem == "admin_without_mfa":
            db.users.rows[0].update(role="superadmin", mfa_enabled=True)
        if problem == "wrong_request_origin":
            request.headers["origin"] = "https://attacker.example"
        with pytest.raises(HTTPException):
            await routes.registration_options(routes.RegistrationStart(current_password="wrong" if problem == "wrong_password" else "correct-password"), request, Response(), user)
        assert not db.passkey_challenges.rows
    asyncio.run(scenario())


@pytest.mark.parametrize("origin,enabled", [("https://club.example", True), ("http://club.example", False), ("https://name:secret@club.example", False), ("https://club.example/subpath", False), ("https://127.0.0.1", False), ("", False)])
def test_passkey_origin_is_explicit_and_safe(monkeypatch, origin, enabled):
    monkeypatch.setenv("FRONTEND_URL", origin)
    monkeypatch.setenv("PASSKEY_ENABLED", "true")
    assert bool(routes.passkey_configuration()) is enabled


def test_removal_cannot_delete_another_accounts_key(setup):
    async def scenario():
        db, user, request, _issue = setup
        await db.passkeys.insert_one({"_id": "foreign-key", "user_id": "other-user"})
        with pytest.raises(HTTPException) as error:
            await routes.remove_passkey("foreign-key", routes.PasswordProof(current_password="correct-password"), request, user)
        assert error.value.status_code == 404
        assert len(db.passkeys.rows) == 1
    asyncio.run(scenario())


def test_registration_response_cannot_be_used_twice(setup):
    async def scenario():
        db, user, request, _issue = setup
        private_key = ec.generate_private_key(ec.SECP256R1())
        response = Response()
        options = await routes.registration_options(routes.RegistrationStart(current_password="correct-password"), request, response, user)
        bind_cookie(request, response, "register")
        body = routes.CredentialResponse(credential=registration_credential(options, private_key))
        await routes.registration_verify(body, request, Response(), user)
        with pytest.raises(HTTPException) as error:
            await routes.registration_verify(body, request, Response(), user)
        assert error.value.status_code == 401
        assert len(db.passkeys.rows) == 1
    asyncio.run(scenario())
