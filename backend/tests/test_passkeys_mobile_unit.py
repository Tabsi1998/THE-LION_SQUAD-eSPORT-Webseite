"""Passkey-Anmeldung aus der App (#217 Stufe 2): derselbe Passkey wie auf der Website, die Herkunft ist
der Signaturschlüssel der App, das Ticket ersetzt den Cookie, die Antwort ist eine App-Sitzung."""
import asyncio
from unittest.mock import AsyncMock

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, Response
from webauthn.helpers import bytes_to_base64url

from routes import passkey_routes as routes
from test_passkeys_unit import authentication_credential, enroll, make_setup

UPLOAD_HASH, PLAY_HASH = routes.DEFAULT_APK_KEY_HASHES.split(",")
# Die APK vom Vereinsserver (Upload-Schlüssel) und die Play-Version (Googles App-Signaturschlüssel, #219).
APP_ORIGIN = "android:apk-key-hash:" + bytes_to_base64url(bytes.fromhex(UPLOAD_HASH.replace(":", "")))
PLAY_ORIGIN = "android:apk-key-hash:" + bytes_to_base64url(bytes.fromhex(PLAY_HASH.replace(":", "")))


@pytest.fixture
def setup(monkeypatch):
    return make_setup(monkeypatch)


def test_app_origins_come_from_the_signing_key_hashes(monkeypatch):
    assert routes.mobile_origins() == [APP_ORIGIN, PLAY_ORIGIN], "Server-APK und Play-Version sind beide erlaubt"
    assert APP_ORIGIN.startswith("android:apk-key-hash:b2mi") and "=" not in APP_ORIGIN, "base64url ohne Füllzeichen"
    assert PLAY_ORIGIN.startswith("android:apk-key-hash:HRB6") and PLAY_ORIGIN != APP_ORIGIN
    monkeypatch.setenv("PASSKEY_APK_KEY_HASHES", "6F:69:A2:89:E8:A4:C7:3E:21:53:35:5A:9F:24:90:64:D1:2B:2F:98:E7:8A:30:72:E9:84:D1:18:0E:1D:CB:98, " + "ab" * 32 + ",kaputt")
    assert routes.mobile_origins() == [APP_ORIGIN, "android:apk-key-hash:" + bytes_to_base64url(bytes.fromhex("ab" * 32))]
    monkeypatch.setenv("PASSKEY_APK_KEY_HASHES", "")
    assert routes.mobile_origins() == []


def test_status_tells_the_app_whether_passkeys_work(setup, monkeypatch):
    assert asyncio.run(routes.status()) == {"enabled": True, "app": True}
    monkeypatch.setenv("PASSKEY_APK_KEY_HASHES", "")
    assert asyncio.run(routes.status()) == {"enabled": True, "app": False}


def test_app_login_with_the_website_passkey_and_replay_rejection(setup, monkeypatch):
    async def scenario():
        db, _user, request, issue = setup
        mobile_issue = AsyncMock(return_value=("zugang", "erneuerung"))
        monkeypatch.setattr(routes, "_issue_mobile_session", mobile_issue)
        monkeypatch.setattr(routes, "_public_user", lambda user: {"id": user["id"], "email": user["email"]})
        private_key = ec.generate_private_key(ec.SECP256R1())
        await enroll(setup, private_key)   # auf der Website angelegt

        start = await routes.mobile_login_options(request)
        assert len(start["ticket"]) >= 32 and start["options"]["rpId"] == "club.example" and start["options"]["userVerification"] == "required"
        assert db.passkey_challenges.rows[0]["kind"] == "mobile-login" and "ticket" not in db.passkey_challenges.rows[0]
        credential = authentication_credential(start["options"], private_key, origin=APP_ORIGIN)
        body = routes.MobileCredentialResponse(credential=credential, ticket=start["ticket"], remember=False)
        session = await routes.mobile_login_verify(body, request)
        assert session == {"user": {"id": "user-1", "email": "test@example.test"}, "access_token": "zugang", "refresh_token": "erneuerung", "token_type": "bearer"}
        mobile_issue.assert_awaited_once()
        assert mobile_issue.await_args.kwargs["mfa_verified"] is True, "Gerätesperre vorgezeigt - zweiter Faktor wie im Web"
        assert db.passkeys.rows[0]["sign_count"] == 1
        issue.assert_not_awaited()

        with pytest.raises(HTTPException) as replay:
            await routes.mobile_login_verify(body, request)
        assert replay.value.status_code == 401, "das Ticket gilt genau einmal"
    asyncio.run(scenario())


@pytest.mark.parametrize("problem", ["website_origin", "wrong_ticket", "expired", "missing_uv", "wrong_signature", "app_origin_on_website"])
def test_app_login_security_boundaries(setup, monkeypatch, problem):
    async def scenario():
        db, _user, request, issue = setup
        mobile_issue = AsyncMock(return_value=("zugang", "erneuerung"))
        monkeypatch.setattr(routes, "_issue_mobile_session", mobile_issue)
        private_key = ec.generate_private_key(ec.SECP256R1())
        await enroll(setup, private_key)

        if problem == "app_origin_on_website":
            # Eine App-Unterschrift taugt nicht für den Website-Weg - und umgekehrt.
            response = Response()
            options = await routes.login_options(request, response)
            request.cookies["tls_passkey_login"] = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
            with pytest.raises(HTTPException) as error:
                await routes.login_verify(routes.CredentialResponse(credential=authentication_credential(options, private_key, origin=APP_ORIGIN)), request, Response())
            assert error.value.status_code == 401
            return

        start = await routes.mobile_login_options(request)
        signing_key = ec.generate_private_key(ec.SECP256R1()) if problem == "wrong_signature" else private_key
        credential = authentication_credential(start["options"], signing_key,
                                               origin="https://club.example" if problem == "website_origin" else APP_ORIGIN,
                                               flags=1 if problem == "missing_uv" else 5)
        ticket = "x" * 40 if problem == "wrong_ticket" else start["ticket"]
        if problem == "expired":
            from datetime import timedelta
            db.passkey_challenges.rows[0]["expires_at"] = db.passkey_challenges.rows[0]["expires_at"] - timedelta(minutes=10)
        with pytest.raises(HTTPException) as error:
            await routes.mobile_login_verify(routes.MobileCredentialResponse(credential=credential, ticket=ticket), request)
        assert error.value.status_code == 401
        mobile_issue.assert_not_awaited()
        issue.assert_not_awaited()
    asyncio.run(scenario())


def test_without_configuration_the_app_gets_a_clear_503(setup, monkeypatch):
    monkeypatch.setenv("PASSKEY_APK_KEY_HASHES", "")
    _db, _user, request, _issue = setup
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.mobile_login_options(request))
    assert error.value.status_code == 503
