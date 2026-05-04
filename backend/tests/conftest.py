"""Shared pytest fixtures for TLS Arena backend tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fast-lap-mgmt.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PASSWORD = "TLSAdmin2026!"
DEMO_EMAIL = "leon_king@demo.thelionsquad.at"
DEMO_PASSWORD = "demo123"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, email, password):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        return None
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        session.headers.update({"Authorization": f"Bearer {token}"})
    return data


@pytest.fixture
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if not _login(s, ADMIN_EMAIL, ADMIN_PASSWORD):
        pytest.skip("Admin login failed")
    return s


@pytest.fixture
def player_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if not _login(s, DEMO_EMAIL, DEMO_PASSWORD):
        pytest.skip("Demo player login failed")
    return s
