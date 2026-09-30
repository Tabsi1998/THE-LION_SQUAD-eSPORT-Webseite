"""Shared pytest fixtures for TLS Arena backend tests."""
import os
from datetime import datetime

import pytest
import requests

LIVE_TEST_FILES = {
    "test_iter20_bug_hunt.py",
    "test_iter20_bugfixes.py",
    "test_iter20_edge_cases.py",
    "test_phase2_3.py",
    "test_phase3.py",
    "test_phase3_news_events_gallery.py",
    "test_phase4_documents.py",
    "test_phase4_features.py",
    "test_phase5_badges.py",
    "test_phase567.py",
    "test_phase_8_9_10.py",
    "test_phase_a_quickwins.py",
    "test_phase_b_v4_achievements.py",
    "test_phase_c_iter16.py",
    "test_phase_d_v3.py",
    "test_phase_ef_iter17.py",
    "test_phase_fg_iter18.py",
    "test_phase_membership.py",
    "test_phase_penalty_iter19.py",
    "test_tls_arena_api.py",
}

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
ADMIN_EMAIL = os.environ.get("TEST_ADMIN_EMAIL", "")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD", "")
DEMO_EMAIL = os.environ.get("TEST_DEMO_EMAIL", "")
DEMO_PASSWORD = os.environ.get("TEST_DEMO_PASSWORD", "")


def pytest_collection_modifyitems(config, items):
    live_enabled = bool(
        os.environ.get("REACT_APP_BACKEND_URL")
        and os.environ.get("TEST_ADMIN_EMAIL")
        and os.environ.get("TEST_ADMIN_PASSWORD")
    )
    skip_live = pytest.mark.skip(
        reason="isolated live test requires REACT_APP_BACKEND_URL, TEST_ADMIN_EMAIL, and TEST_ADMIN_PASSWORD"
    )
    for item in items:
        if item.path.name in LIVE_TEST_FILES:
            item.add_marker(pytest.mark.live)
            if not live_enabled:
                item.add_marker(skip_live)


# Ein ruhiger Tag ohne Saison: Dienstag, 15. September 2026, zu Mittag (Wien).
SEASON_TEST_NOW = "2026-09-15T12:00:00"


@pytest.fixture(autouse=True)
def season_clock(monkeypatch):
    """Die Saison-Uhr steht in jedem Test auf einem ruhigen Tag.

    „Was läuft gerade“ fragt ohne Zeitangabe die echte Uhr (``seasons.to_vienna``). Tests, die das über die Routen
    tun, hingen damit am Datum des Laufs: in der Halloween-Woche läuft Halloween von selbst, und wer prüft, dass es
    nicht läuft oder dass es „erzwungen“ ist, wird rot. Wer eine bestimmte Zeit braucht, gibt sie wie bisher mit oder
    stellt die Uhr im Test um (``monkeypatch.setattr(seasons, "to_vienna", ...)``).
    """
    try:
        from services import seasons
    except ImportError:  # Live-Tests gegen einen laufenden Server laden die Dienste nicht
        yield None
        return
    real = seasons.to_vienna
    fixed = real(datetime.fromisoformat(SEASON_TEST_NOW))
    monkeypatch.setattr(seasons, "to_vienna", lambda now=None: real(now if now is not None else fixed))
    yield fixed


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
