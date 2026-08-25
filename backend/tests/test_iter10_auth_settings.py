"""Iteration 10 — centralized auth settings, enforcement and Google linking guards.

Live API tests against the external preview URL (cookies are Secure).
"""
import os
import re
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")

AUTH_KEYS = ["password_login_enabled", "registration_enabled", "google_login_enabled", "google_linking_enabled"]


def _creds():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing test_credentials.md")
    txt = p.read_text(encoding="utf-8")
    email = re.search(r"(?im)^\s*-\s*Email:\s*(\S+)", txt)
    pwd = re.search(r"(?im)^\s*-\s*Password:\s*(\S+)", txt)
    if not email or not pwd:
        pytest.skip("no creds parsed")
    return email.group(1), pwd.group(1)


@pytest.fixture(scope="module")
def admin():
    email, password = _creds()
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.fail(f"Admin login failed {r.status_code}: {r.text[:300]}")
    csrf = s.cookies.get("csrf_token")
    if not csrf:
        pytest.fail("csrf_token cookie not set by login")
    s.headers.update({"X-CSRF-Token": csrf})
    return s


@pytest.fixture(scope="module", autouse=True)
def restore_defaults(admin):
    yield
    admin.put(f"{BASE_URL}/api/settings/auth", json={k: True for k in AUTH_KEYS})


def _set(admin, **kwargs):
    r = admin.put(f"{BASE_URL}/api/settings/auth", json=kwargs)
    assert r.status_code == 200, f"PUT /settings/auth -> {r.status_code}: {r.text[:300]}"
    return r.json()


# --- GET/PUT /api/settings/auth ---
class TestAuthSettingsEndpoint:
    def test_get_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/settings/auth")
        assert r.status_code in (401, 403), r.text[:200]

    def test_get_returns_four_booleans(self, admin):
        r = admin.get(f"{BASE_URL}/api/settings/auth")
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert set(AUTH_KEYS).issubset(data.keys()), data
        for k in AUTH_KEYS:
            assert isinstance(data[k], bool), (k, data[k])
        assert "_id" not in data

    def test_put_persists_and_public_reflects(self, admin):
        out = _set(admin, google_linking_enabled=False)
        assert out["google_linking_enabled"] is False
        # GET verifies persistence
        got = admin.get(f"{BASE_URL}/api/settings/auth").json()
        assert got["google_linking_enabled"] is False
        # public endpoint reflects flag
        pub = requests.get(f"{BASE_URL}/api/settings/public")
        assert pub.status_code == 200
        pdata = pub.json()
        flags = pdata.get("public_settings", pdata)
        assert flags.get("google_linking_enabled") is False, pdata
        # restore
        out = _set(admin, google_linking_enabled=True)
        assert out["google_linking_enabled"] is True

    def test_put_requires_csrf(self, admin):
        s = requests.Session()
        s.cookies.update(admin.cookies)
        r = s.put(f"{BASE_URL}/api/settings/auth", json={"registration_enabled": True})
        assert r.status_code in (401, 403), f"CSRF not enforced: {r.status_code}"


# --- Enforcement: registration + google login flags ---
class TestEnforcement:
    def test_registration_disabled_blocks_register(self, admin):
        _set(admin, registration_enabled=False)
        payload = {
            "email": f"TEST_reg_{uuid.uuid4().hex[:8]}@example.com",
            "username": f"TESTreg{uuid.uuid4().hex[:6]}",
            "password": "TestLion2026!!",
            "display_name": "TEST Reg",
            "accept_privacy": True,
            "accept_terms": True,
        }
        r = requests.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:300]}"
        # restore and register successfully
        _set(admin, registration_enabled=True)
        r2 = requests.post(f"{BASE_URL}/api/auth/register", json=payload)
        assert r2.status_code in (200, 201), f"register after re-enable -> {r2.status_code}: {r2.text[:400]}"
        body = r2.json()
        assert body.get("email") == payload["email"].lower()
        # cleanup
        uid = body.get("id")
        if uid:
            admin.delete(f"{BASE_URL}/api/admin/users/{uid}")

    def test_google_login_disabled_blocks_session(self, admin):
        _set(admin, google_login_enabled=False)
        r = requests.post(f"{BASE_URL}/api/auth/google/session", json={"session_id": "dummy"})
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:300]}"
        _set(admin, google_login_enabled=True)
        r2 = requests.post(f"{BASE_URL}/api/auth/google/session", json={})
        assert r2.status_code == 400, f"expected 400 session_id fehlt, got {r2.status_code}: {r2.text[:200]}"


# --- Google link/unlink guards ---
class TestGoogleLinkGuards:
    def test_link_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/auth/google/link", json={"session_id": "x"})
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"

    def test_link_empty_body_returns_400(self, admin):
        r = admin.post(f"{BASE_URL}/api/auth/google/link", json={})
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        assert "session_id" in r.text

    def test_link_disabled_returns_403(self, admin):
        _set(admin, google_linking_enabled=False)
        r = admin.post(f"{BASE_URL}/api/auth/google/link", json={"session_id": "x"})
        _set(admin, google_linking_enabled=True)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text[:200]}"

    def test_unlink_local_account_ok(self, admin):
        r = admin.post(f"{BASE_URL}/api/auth/google/unlink", json={})
        assert r.status_code == 200, f"{r.status_code}: {r.text[:300]}"
        assert r.json().get("ok") is True

    def test_unlink_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/auth/google/unlink", json={})
        assert r.status_code == 401, f"expected 401, got {r.status_code}"


# --- password_login_enabled flag surfaced publicly ---
def test_public_settings_contains_all_flags():
    r = requests.get(f"{BASE_URL}/api/settings/public")
    assert r.status_code == 200
    data = r.json()
    flags = data.get("public_settings", data)
    for k in AUTH_KEYS:
        assert k in flags, f"{k} missing from /settings/public: {list(flags.keys())[:40]}"


def test_final_state_all_true(admin):
    time.sleep(0.2)
    _set(admin, **{k: True for k in AUTH_KEYS})
    got = admin.get(f"{BASE_URL}/api/settings/auth").json()
    assert all(got[k] is True for k in AUTH_KEYS), got
