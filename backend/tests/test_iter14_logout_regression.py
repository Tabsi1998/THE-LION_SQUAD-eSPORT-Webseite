"""Iteration 14 — logout must invalidate the session cookies (regression)."""
import os

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
pytestmark = pytest.mark.live
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)

DEMO_EMAIL = "leon_king@demo.lionsquad.at"
DEMO_PASSWORD = "DemoLion2026!!"


@pytest.fixture
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL,
                      "User-Agent": "TLSIter14Logout/1.0"})
    return s


def test_logout_invalidates_me(session):
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    assert session.get(f"{BASE_URL}/api/auth/me", timeout=30).status_code == 200

    csrf = session.cookies.get("csrf_token")
    lr = session.post(f"{BASE_URL}/api/auth/logout", headers={"X-CSRF-Token": csrf or ""}, timeout=30)
    assert lr.status_code == 200, lr.text[:300]

    # /api/auth/me intentionally answers 200 + null for guests
    me = session.get(f"{BASE_URL}/api/auth/me", timeout=30)
    assert me.status_code == 200
    assert me.json() is None, f"session still active after logout: {me.text[:200]}"

    # protected endpoint must reject
    protected = session.get(f"{BASE_URL}/api/notifications/me", timeout=30)
    assert protected.status_code == 401, f"protected route still {protected.status_code} after logout"
