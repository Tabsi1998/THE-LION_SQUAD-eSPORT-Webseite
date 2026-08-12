"""Focused regressions for repository security-hardening packages."""
import asyncio
import logging
from pathlib import Path
import runpy
import sys
import types

import pytest
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware


def test_scheduler_failure_log_excludes_exception_payload(caplog):
    from services.scheduler import _log_task_failure

    caplog.set_level(logging.ERROR, logger="tls.scheduler")
    _log_task_failure("birthday_greetings", RuntimeError("private-user@example.test token=secret"))

    message = caplog.text
    assert "birthday_greetings" in message
    assert "RuntimeError" in message
    assert "private-user@example.test" not in message
    assert "token=secret" not in message


def test_setup_requires_preconfigured_non_placeholder_jwt(monkeypatch):
    from setup_cli import require_jwt_secret

    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="sicher gesetzt"):
        require_jwt_secret()

    monkeypatch.setenv("JWT_SECRET", "change-me-change-me-change-me-change-me")
    with pytest.raises(RuntimeError, match="sicher gesetzt"):
        require_jwt_secret()

    value = "package-two-realistic-secret-value-1234567890"
    monkeypatch.setenv("JWT_SECRET", value)
    assert require_jwt_secret() == value


def test_entrypoint_uses_owner_only_upload_permissions(monkeypatch):
    fake_pwd = types.SimpleNamespace(struct_passwd=object)
    monkeypatch.setitem(sys.modules, "pwd", fake_pwd)
    entrypoint = runpy.run_path(str(Path(__file__).resolve().parents[1] / "docker-entrypoint.py"))

    assert entrypoint["DIRECTORY_MODE"] == 0o700
    assert entrypoint["FILE_MODE"] == 0o600


def test_entrypoint_limits_forwarded_headers_to_configured_proxy_networks(monkeypatch):
    fake_pwd = types.SimpleNamespace(struct_passwd=object)
    monkeypatch.setitem(sys.modules, "pwd", fake_pwd)
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    monkeypatch.setenv("TRUSTED_PROXY_CIDRS", "127.0.0.1/32,172.20.0.0/24")
    entrypoint = runpy.run_path(str(Path(__file__).resolve().parents[1] / "docker-entrypoint.py"))

    args = entrypoint["build_uvicorn_args"]()
    assert "--proxy-headers" in args
    assert args[args.index("--forwarded-allow-ips") + 1] == "127.0.0.1/32,172.20.0.0/24"


def test_rate_limit_identity_ignores_unvalidated_forwarding_headers():
    from services.rate_limit import get_client_ip

    request = types.SimpleNamespace(
        headers={"x-forwarded-for": "198.51.100.99", "x-real-ip": "198.51.100.98"},
        client=types.SimpleNamespace(host="203.0.113.7"),
    )

    assert get_client_ip(request) == "203.0.113.7"


def _proxy_scope(client: str, forwarded_for: str, forwarded_proto: str = "https") -> dict:
    captured: dict = {}

    async def app(scope, receive, send):
        captured.update(scope)

    async def receive():
        return {"type": "http.disconnect"}

    async def send(message):
        return None

    middleware = ProxyHeadersMiddleware(
        app,
        trusted_hosts="127.0.0.1/32,10.0.0.0/8",
    )
    scope = {
        "type": "http",
        "client": (client, 12345),
        "scheme": "http",
        "headers": [
            (b"x-forwarded-for", forwarded_for.encode("ascii")),
            (b"x-forwarded-proto", forwarded_proto.encode("ascii")),
        ],
    }
    asyncio.run(middleware(scope, receive, send))
    return captured


def test_proxy_chain_uses_rightmost_untrusted_client_and_ignores_spoofed_prefix():
    scope = _proxy_scope("127.0.0.1", "192.0.2.250, 198.51.100.23, 10.20.0.4")

    assert scope["client"][0] == "198.51.100.23"
    assert scope["scheme"] == "https"


def test_untrusted_direct_peer_cannot_override_client_or_scheme():
    scope = _proxy_scope("203.0.113.7", "198.51.100.23")

    assert scope["client"][0] == "203.0.113.7"
    assert scope["scheme"] == "http"


def test_internal_nginx_preserves_tls_and_sanitizes_forwarded_host():
    nginx = (Path(__file__).resolve().parents[2] / "frontend" / "nginx.conf").read_text(encoding="utf-8")

    assert "map $http_x_forwarded_proto $tls_forwarded_proto" in nginx
    assert "proxy_set_header X-Forwarded-Proto $scheme;" not in nginx
    assert nginx.count("proxy_set_header X-Forwarded-Host $host;") == 7


def test_internal_nginx_uses_one_nonce_based_csp_without_external_fonts():
    root = Path(__file__).resolve().parents[2]
    nginx = (root / "frontend" / "nginx.conf").read_text(encoding="utf-8")
    css = (root / "frontend" / "src" / "index.css").read_text(encoding="utf-8")

    assert "map $request_id $tls_content_security_policy" in nginx
    assert "script-src 'self' 'nonce-$request_id'" in nginx
    assert "script-src 'self' 'unsafe-inline'" not in nginx
    assert nginx.count("add_header Content-Security-Policy $tls_content_security_policy always;") == 7
    assert 'meta name="csp-nonce" content="$request_id"' in nginx
    assert "fonts.googleapis.com" not in css
