"""Passkey-Anmeldung aus der App (#217 Stufe 2): derselbe Passkey wie auf der Website, die Herkunft ist
der Signaturschlüssel der App, das Ticket ersetzt den Cookie, die Antwort ist eine App-Sitzung."""
import asyncio
import base64
from unittest.mock import AsyncMock

import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException, Response
from webauthn.helpers import bytes_to_base64url

from routes import passkey_routes as routes
from test_passkeys_unit import authentication_credential, enroll, make_setup, registration_credential

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
        # Zwei-Faktor eingeschaltet (#919): der Passkey ist der zweite Faktor - auch in der App kommt kein Code.
        db.users.rows[0]["mfa_enabled"] = True

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


def test_app_creates_a_passkey_after_the_password_login_and_signs_in_with_it(setup, monkeypatch):
    """#919: Direkt nach der Passwort-Anmeldung legt die App mit dem Ticket einen Passkey an - ohne das Passwort noch einmal
    zu verlangen. Das Ticket gilt bis zum fertigen Passkey (ein Abbruch am Gerät darf noch einmal), zehn Minuten, nur für
    dieses Konto; danach und ohne Ticket braucht es das Passwort."""
    async def scenario():
        db, user, request, _issue = setup
        monkeypatch.setattr(routes, "_issue_mobile_session", AsyncMock(return_value=("zugang", "erneuerung")))
        monkeypatch.setattr(routes, "_public_user", lambda row: {"id": row["id"]})
        ticket = await routes.issue_enroll_ticket(db, "user-1")
        assert len(ticket) >= 32 and db.passkey_challenges.rows[-1]["kind"] == "mobile-enroll" and "ticket" not in db.passkey_challenges.rows[-1]

        await routes.mobile_registration_options(routes.MobileRegistrationStart(enroll_ticket=ticket, name="Pixel 9"), request, user)
        # Am Gerät abgebrochen: derselbe Weg noch einmal - das Ticket gilt noch.
        start = await routes.mobile_registration_options(routes.MobileRegistrationStart(enroll_ticket=ticket, name="Pixel 9"), request, user)
        assert start["options"]["rp"]["id"] == "club.example" and start["options"]["authenticatorSelection"]["userVerification"] == "required"
        private_key = ec.generate_private_key(ec.SECP256R1())
        credential = registration_credential(start["options"], private_key, origin=APP_ORIGIN)
        done = await routes.mobile_registration_verify(routes.MobileCredentialResponse(credential=credential, ticket=start["ticket"]), request, user)
        assert done == {"ok": True} and db.passkeys.rows[0]["name"] == "Pixel 9" and db.passkeys.rows[0]["user_id"] == "user-1"

        with pytest.raises(HTTPException) as again:
            await routes.mobile_registration_options(routes.MobileRegistrationStart(enroll_ticket=ticket), request, user)
        assert again.value.status_code == 401, "nach dem fertigen Passkey ist das Ticket verbraucht"
        with pytest.raises(HTTPException) as wrong:
            await routes.mobile_registration_options(routes.MobileRegistrationStart(current_password="falsch"), request, user)
        assert wrong.value.status_code == 401
        assert (await routes.mobile_registration_options(routes.MobileRegistrationStart(current_password="correct-password"), request, user))["ticket"]

        # Der neue Passkey meldet in der App an - als zweiter Faktor wie jeder Passkey.
        login = await routes.mobile_login_options(request)
        session = await routes.mobile_login_verify(routes.MobileCredentialResponse(
            credential=authentication_credential(login["options"], private_key, origin=APP_ORIGIN), ticket=login["ticket"]), request)
        assert session["access_token"] == "zugang" and routes._issue_mobile_session.await_args.kwargs["mfa_verified"] is True
    asyncio.run(scenario())


@pytest.mark.parametrize("problem", ["other_account", "expired", "website_origin", "mfa_unconfirmed"])
def test_app_enrollment_boundaries(setup, monkeypatch, problem):
    async def scenario():
        db, user, request, _issue = setup
        ticket = await routes.issue_enroll_ticket(db, "user-2" if problem == "other_account" else "user-1")
        if problem == "expired":
            from datetime import timedelta

            db.passkey_challenges.rows[-1]["expires_at"] = routes.now_utc() - timedelta(minutes=1)
        if problem in ("other_account", "expired"):
            with pytest.raises(HTTPException) as error:
                await routes.mobile_registration_options(routes.MobileRegistrationStart(enroll_ticket=ticket), request, user)
            assert error.value.status_code == 401
            return
        if problem == "mfa_unconfirmed":
            # Konto mit Zwei-Faktor, Sitzung ohne bestätigten zweiten Faktor: auch das Ticket hilft nicht.
            db.users.rows[0]["mfa_enabled"] = True
            with pytest.raises(HTTPException) as error:
                await routes.mobile_registration_options(routes.MobileRegistrationStart(enroll_ticket=ticket), request, user)
            assert error.value.status_code == 403
            return
        start = await routes.mobile_registration_options(routes.MobileRegistrationStart(enroll_ticket=ticket), request, user)
        credential = registration_credential(start["options"], ec.generate_private_key(ec.SECP256R1()), origin="https://club.example")
        with pytest.raises(HTTPException) as error:
            await routes.mobile_registration_verify(routes.MobileCredentialResponse(credential=credential, ticket=start["ticket"]), request, user)
        assert error.value.status_code == 400 and db.passkeys.rows == [], "nur die App als Herkunft"
    asyncio.run(scenario())


def test_app_removes_a_passkey_only_with_the_password(setup):
    async def scenario():
        db, user, request, _issue = setup
        await enroll(setup, ec.generate_private_key(ec.SECP256R1()))
        identifier = db.passkeys.rows[0]["_id"]
        with pytest.raises(HTTPException) as wrong:
            await routes.mobile_remove_passkey(identifier, routes.PasswordProof(current_password="falsch"), request, user)
        assert wrong.value.status_code == 401 and len(db.passkeys.rows) == 1
        assert await routes.mobile_remove_passkey(identifier, routes.PasswordProof(current_password="correct-password"), request, user) == {"ok": True}
        assert db.passkeys.rows == []
    asyncio.run(scenario())


def test_no_enroll_ticket_without_app_passkeys(setup, monkeypatch):
    db, _user, _request, _issue = setup
    monkeypatch.setenv("PASSKEY_APK_KEY_HASHES", "")
    assert asyncio.run(routes.issue_enroll_ticket(db, "user-1")) is None


@pytest.mark.parametrize("spelling", ["standard_padded", "urlsafe_padded", "standard"])
def test_app_passkey_accepts_other_spellings_of_the_signing_key_hash(setup, monkeypatch, spelling):
    """#938: Google schreibt den Schlüssel-Hash der App base64url ohne Füllzeichen; andere Anbieter (etwa Samsung Pass)
    womöglich mit Füllzeichen oder im Standard-Base64, dazu die Kennung anders. Dieselben Bytes zählen - beim Anlegen und
    beim Anmelden."""
    async def scenario():
        _db, user, request, _issue = setup
        monkeypatch.setattr(routes, "_issue_mobile_session", AsyncMock(return_value=("zugang", "erneuerung")))
        monkeypatch.setattr(routes, "_public_user", lambda row: {"id": row["id"]})
        raw = bytes.fromhex(PLAY_HASH.replace(":", ""))
        text = {"standard_padded": base64.b64encode(raw).decode(), "urlsafe_padded": base64.urlsafe_b64encode(raw).decode(),
                "standard": base64.b64encode(raw).decode().rstrip("=")}[spelling]
        origin = "android:apk-key-hash:" + text
        assert origin != PLAY_ORIGIN
        start = await routes.mobile_registration_options(routes.MobileRegistrationStart(current_password="correct-password", name="Galaxy"), request, user)
        private_key = ec.generate_private_key(ec.SECP256R1())
        credential = registration_credential(start["options"], private_key, origin=origin)
        identifier = credential["rawId"]
        credential["rawId"] = base64.b64encode(base64.urlsafe_b64decode(identifier + "=" * (-len(identifier) % 4))).decode()
        done = await routes.mobile_registration_verify(routes.MobileCredentialResponse(credential=credential, ticket=start["ticket"]), request, user)
        assert done == {"ok": True}
        login = await routes.mobile_login_options(request)
        session = await routes.mobile_login_verify(routes.MobileCredentialResponse(
            credential=authentication_credential(login["options"], private_key, origin=origin), ticket=login["ticket"]), request)
        assert session["access_token"] == "zugang"
    asyncio.run(scenario())


def test_app_passkey_from_a_foreign_key_is_rejected_with_the_reason(setup, monkeypatch):
    """#938: Ein fremder Signaturschlüssel bleibt draußen - der Grund steht im Log und kurz in der Meldung."""
    warnings = []
    monkeypatch.setattr(routes.logger, "warning", lambda message, *args: warnings.append(message % args))

    async def scenario():
        db, user, request, _issue = setup
        start = await routes.mobile_registration_options(routes.MobileRegistrationStart(current_password="correct-password"), request, user)
        foreign = "android:apk-key-hash:" + bytes_to_base64url(b"" * 32)
        credential = registration_credential(start["options"], ec.generate_private_key(ec.SECP256R1()), origin=foreign)
        with pytest.raises(HTTPException) as error:
            await routes.mobile_registration_verify(routes.MobileCredentialResponse(credential=credential, ticket=start["ticket"]), request, user)
        assert error.value.status_code == 400 and "(Herkunft der App passt nicht)" in error.value.detail
        assert db.passkeys.rows == []
    asyncio.run(scenario())
    assert any("App-Passkey abgelehnt" in line and "client data origin" in line for line in warnings)
