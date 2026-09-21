import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException, Response

from routes import auth_routes as routes
from login_diagnostics import error_category
import login_diagnostics


@pytest.mark.parametrize("endpoint", [routes.login, routes.mobile_login])
@pytest.mark.parametrize("mfa", [False, True])
def test_unverified_existing_account_cannot_skip_verification(monkeypatch, endpoint, mfa):
    db = SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value={
        "id": "existing", "email_verified": False, "password_hash": "hash",
        "role": "superadmin", "mfa_enabled": mfa,
    })))
    monkeypatch.setattr(routes, "get_db", lambda: db)
    monkeypatch.setattr(routes, "load_auth_settings", AsyncMock(return_value={"password_login_enabled": True}))
    monkeypatch.setattr(routes, "_check_brute_force", AsyncMock())
    monkeypatch.setattr(routes, "_client_identifier", lambda *_: "test")
    monkeypatch.setattr(routes, "verify_password", lambda *_: True)
    challenge = AsyncMock()
    monkeypatch.setattr(routes, "_create_mfa_login_challenge", challenge)
    body = SimpleNamespace(email="existing@example.test", password="test", remember=False)
    args = (body, Mock(), Response()) if endpoint is routes.login else (body, Mock())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(endpoint(*args))
    assert exc.value.status_code == 403
    assert exc.value.headers["X-Auth-Error"] == "email_verification_required"
    challenge.assert_not_awaited()


def test_resend_keeps_previous_links_and_uses_absolute_site_url(monkeypatch):
    tokens = SimpleNamespace(insert_one=AsyncMock(), update_many=AsyncMock())
    send = AsyncMock(return_value={"ok": True})
    monkeypatch.setattr(routes, "send_template", send)
    monkeypatch.setattr(routes, "_site_base_url", AsyncMock(return_value="https://club.example"))
    asyncio.run(routes._send_email_verification(
        SimpleNamespace(email_verification_tokens=tokens),
        {"id": "existing", "email": "existing@example.test"},
    ))
    tokens.update_many.assert_not_awaited()
    doc = tokens.insert_one.call_args.args[0]
    assert "token" not in doc and doc["token_hash"]
    assert send.call_args.kwargs["verification_url"].startswith("https://club.example/verify-email?token=")


@pytest.mark.parametrize("endpoint", [routes.login, routes.mobile_login])
def test_verified_admin_still_requires_mfa(monkeypatch, endpoint):
    user = {"id": "existing", "email_verified": True, "password_hash": "hash",
            "role": "superadmin", "mfa_enabled": True}
    db = SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value=user)))
    monkeypatch.setattr(routes, "get_db", lambda: db)
    monkeypatch.setattr(routes, "load_auth_settings", AsyncMock(return_value={"password_login_enabled": True}))
    monkeypatch.setattr(routes, "_check_brute_force", AsyncMock())
    monkeypatch.setattr(routes, "_clear_failed", AsyncMock())
    monkeypatch.setattr(routes, "_client_identifier", lambda *_: "test")
    monkeypatch.setattr(routes, "verify_password", lambda *_: True)
    challenge = AsyncMock(return_value={"mfa_required": True, "mfa_ticket": "test-ticket"})
    monkeypatch.setattr(routes, "_create_mfa_login_challenge", challenge)
    issue = AsyncMock()
    monkeypatch.setattr(routes, "_issue_session", issue)
    monkeypatch.setattr(routes, "_issue_mobile_session", issue)
    body = SimpleNamespace(email="existing@example.test", password="test", remember=False)
    args = (body, Mock(), Response()) if endpoint is routes.login else (body, Mock())
    result = asyncio.run(endpoint(*args))
    assert result["mfa_required"] is True
    assert challenge.await_args.args[-1] == ("web" if endpoint is routes.login else "mobile")
    if endpoint is routes.login:
        # „Angemeldet bleiben“ (#348) überlebt den Umweg über den Code.
        assert challenge.await_args.kwargs == {"remember": False}
    issue.assert_not_awaited()


@pytest.mark.parametrize("user,send_count", [
    (None, 0), ({"email_verified": True}, 0),
    ({"email_verified": False, "is_banned": True}, 0),
    ({"email_verified": False, "is_active": False}, 0),
    ({"email_verified": False, "is_active": True}, 1),
])
def test_resend_returns_same_truthful_response(monkeypatch, user, send_count):
    monkeypatch.setattr(routes, "get_db", lambda: SimpleNamespace(users=SimpleNamespace(find_one=AsyncMock(return_value=user))))
    monkeypatch.setattr(routes, "enforce_rate_limit", AsyncMock())
    send = AsyncMock()
    monkeypatch.setattr(routes, "_send_email_verification", send)
    response = asyncio.run(routes.resend_verification(SimpleNamespace(email="existing@example.test"), Mock()))
    assert response == {"ok": True, "message": "Falls eine Bestätigung aussteht, wurde der Versand angefordert. Bitte prüfe in einigen Minuten dein Postfach und den Spam-Ordner."}
    assert send.await_count == send_count


@pytest.mark.parametrize("raw,category", [
    ("535 Authentication failed password=private", "authentication"),
    ("Relay access denied for private@example.test", "relay_denied"),
    ("CERTIFICATE_VERIFY_FAILED", "tls_certificate"),
    ("Unexpected provider output token=private", "other_delivery_error"),
    (None, None),
])
def test_diagnostics_never_return_raw_delivery_errors(raw, category):
    assert error_category(raw) == category


def test_diagnostic_report_omits_identifiers_credentials_and_mail_content(monkeypatch):
    import json
    cursor = Mock()
    cursor.sort.return_value = cursor
    cursor.limit.return_value = cursor
    cursor.to_list = AsyncMock(return_value=[{
        "status": "failed", "template_key": "email_verification", "attempts": 2,
        "last_error": "535 Authentication failed: private-password",
        "html": "private-token", "to": "private@example.test",
    }])
    db = SimpleNamespace(
        users=SimpleNamespace(find_one=AsyncMock(return_value={"id": "private-id", "email_verified": False})),
        email_verification_tokens=SimpleNamespace(count_documents=AsyncMock(return_value=1)),
        mail_jobs=SimpleNamespace(find=Mock(return_value=cursor)),
    )
    monkeypatch.setattr(login_diagnostics, "get_db", lambda: db)
    monkeypatch.setattr(login_diagnostics, "get_mail_settings", AsyncMock(return_value={
        "provider": "smtp", "enabled": True, "smtp_pass": "private-password",
        "resend_api_key": "private-key", "smtp_user": "private-user",
    }))
    result = asyncio.run(login_diagnostics.report("private@example.test"))
    assert "private" not in json.dumps(result)
    assert result["read_only"] is True
    assert result["recent_auth_mail"][0]["error_category"] == "authentication"
