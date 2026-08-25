"""Iteration 12: active sessions/devices API, access-token decoupling,
logout-all / single revoke, growth-stats, video upload recheck."""
import concurrent.futures
import logging
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

logger = logging.getLogger(__name__)

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
pytestmark = pytest.mark.live
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)

UA_A = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TLSTestDeviceA/1.0"
UA_B = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) TLSTestDeviceB/1.0"
UA_C = "TLSTestDeviceC/1.0"


def _creds():
    content = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    email = re.search(r"(?im)^-\s*Email:\s*(\S+)", content)
    pwd = re.search(r"(?im)^-\s*Password:\s*(\S+)", content)
    if not email or not pwd:
        pytest.skip("credentials file unreadable")
    return email.group(1), pwd.group(1)


ADMIN_EMAIL, ADMIN_PASSWORD = _creds()
DEMO_EMAIL = "ace_racer@demo.lionsquad.at"
DEMO_PASSWORD = "DemoLion2026!!"


def new_session(user_agent):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "User-Agent": user_agent,
    })
    return s


def login(user_agent, email=ADMIN_EMAIL, password=ADMIN_PASSWORD):
    s = new_session(user_agent)
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=60)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text[:300]}"
    return s


def csrf_headers(s):
    token = s.cookies.get("csrf_token")
    assert token, "csrf_token cookie missing"
    return {"X-CSRF-Token": token}


def me(s):
    r = s.get(f"{BASE_URL}/api/auth/me", timeout=30)
    return r


@pytest.fixture
def admin_a():
    """Fresh admin session per test — other tests run logout-all which would
    otherwise revoke a shared module-scoped session."""
    s = login(UA_A)
    yield s
    try:
        s.post(f"{BASE_URL}/api/auth/logout", headers=csrf_headers(s), timeout=30)
    except Exception:
        logger.debug("Best-effort fixture logout failed", exc_info=True)


# --- Sessions listing ---
class TestSessionsList:
    def test_me_after_login(self, admin_a):
        r = me(admin_a)
        assert r.status_code == 200
        body = r.json()
        assert body and body.get("email") == ADMIN_EMAIL

    def test_sessions_list_has_current(self, admin_a):
        r = admin_a.get(f"{BASE_URL}/api/auth/sessions", timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        current = [x for x in rows if x["current"]]
        assert len(current) == 1, f"expected exactly 1 current session, got {len(current)}"
        row = current[0]
        for key in ("id", "created_at", "last_active", "user_agent", "ip", "client"):
            assert key in row
        assert "_id" not in row
        assert UA_A in row["user_agent"]

    def test_second_login_appears_as_extra_session(self, admin_a):
        s_b = login(UA_B)
        try:
            rows = admin_a.get(f"{BASE_URL}/api/auth/sessions", timeout=30).json()
            uas = [x["user_agent"] for x in rows]
            assert any(UA_B in u for u in uas), f"device B session missing: {uas}"
            assert any(UA_A in u and x["current"] for u, x in zip(uas, rows))
            # from device B, the current flag points to B
            rows_b = s_b.get(f"{BASE_URL}/api/auth/sessions", timeout=30).json()
            cur_b = [x for x in rows_b if x["current"]]
            assert len(cur_b) == 1 and UA_B in cur_b[0]["user_agent"]
        finally:
            s_b.post(f"{BASE_URL}/api/auth/logout", headers=csrf_headers(s_b), timeout=30)

    def test_sessions_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/auth/sessions", timeout=30)
        assert r.status_code == 401


# --- Refresh regression + access token decoupling ---
class TestRefreshRegression:
    def test_two_parallel_refresh_same_ua(self):
        s = login(UA_A)
        cookies = requests.utils.dict_from_cookiejar(s.cookies)
        headers = {**s.headers, **csrf_headers(s)}

        def call():
            return requests.post(f"{BASE_URL}/api/auth/refresh", cookies=cookies, headers=headers, timeout=30)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
            results = [f.result() for f in [ex.submit(call), ex.submit(call)]]
        assert all(r.status_code == 200 for r in results), [r.status_code for r in results]
        body = me(s).json()
        assert body and body.get("email") == ADMIN_EMAIL

    def test_five_parallel_refresh_same_ua(self):
        s = login(UA_A)
        cookies = requests.utils.dict_from_cookiejar(s.cookies)
        headers = {**s.headers, **csrf_headers(s)}

        def call():
            return requests.post(f"{BASE_URL}/api/auth/refresh", cookies=cookies, headers=headers, timeout=30)

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
            results = [f.result() for f in [ex.submit(call) for _ in range(5)]]
        codes = [r.status_code for r in results]
        assert all(c == 200 for c in codes), codes
        body = me(s).json()
        assert body and body.get("email") == ADMIN_EMAIL

    def test_replay_with_different_ua_is_theft(self):
        """Same refresh token replayed from another UA within grace -> 401 + family revoked."""
        s = login(UA_A)
        cookies = requests.utils.dict_from_cookiejar(s.cookies)
        headers = {**s.headers, **csrf_headers(s)}
        r1 = requests.post(f"{BASE_URL}/api/auth/refresh", cookies=cookies, headers=headers, timeout=30)
        assert r1.status_code == 200
        thief_headers = {**headers, "User-Agent": UA_B}
        r2 = requests.post(f"{BASE_URL}/api/auth/refresh", cookies=cookies, headers=thief_headers, timeout=30)
        assert r2.status_code == 401, f"theft replay should fail, got {r2.status_code}"
        # family revoked -> rotated token also dead
        rotated = {**cookies, **requests.utils.dict_from_cookiejar(r1.cookies)}
        rotated_headers = {**headers, "X-CSRF-Token": rotated.get("csrf_token", "")}
        r3 = requests.post(f"{BASE_URL}/api/auth/refresh", cookies=rotated, headers=rotated_headers, timeout=30)
        assert r3.status_code == 401, f"family should be revoked, got {r3.status_code}"

    def test_old_access_token_survives_rotation(self):
        s = login(UA_A)
        old_access = s.cookies.get("access_token")
        assert old_access
        cookies = requests.utils.dict_from_cookiejar(s.cookies)
        headers = {**s.headers, **csrf_headers(s)}
        r = requests.post(f"{BASE_URL}/api/auth/refresh", cookies=cookies, headers=headers, timeout=30)
        assert r.status_code == 200
        # use the PRE-rotation access token explicitly
        r2 = requests.get(
            f"{BASE_URL}/api/auth/me",
            cookies={"access_token": old_access},
            headers={"Origin": BASE_URL, "User-Agent": UA_A},
            timeout=30,
        )
        assert r2.status_code == 200
        assert r2.json() and r2.json().get("email") == ADMIN_EMAIL


# --- logout / logout-all / single revoke ---
class TestSessionRevocation:
    def test_logout_kills_access_token_immediately(self):
        s = login(UA_C)
        access = s.cookies.get("access_token")
        r = s.post(f"{BASE_URL}/api/auth/logout", headers=csrf_headers(s), timeout=30)
        assert r.status_code == 200
        r2 = requests.get(
            f"{BASE_URL}/api/auth/me",
            cookies={"access_token": access},
            headers={"Origin": BASE_URL, "User-Agent": UA_C},
            timeout=30,
        )
        assert r2.status_code == 200 and r2.json() is None, r2.text[:200]

    def test_logout_all_keeps_current_kills_others(self):
        s_a = login(UA_A)
        s_b = login(UA_B)
        assert s_b.get(f"{BASE_URL}/api/auth/me", timeout=30).json()
        r = s_a.post(f"{BASE_URL}/api/auth/sessions/logout-all", headers=csrf_headers(s_a), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["ok"] is True
        assert data["revoked_sessions"] >= 1, data
        # current survives
        cur = me(s_a)
        assert cur.status_code == 200 and cur.json() and cur.json()["email"] == ADMIN_EMAIL
        # other device dead (null body or 401)
        other = me(s_b)
        assert other.status_code == 401 or other.json() is None, other.text[:200]
        # only one session left
        rows = s_a.get(f"{BASE_URL}/api/auth/sessions", timeout=30).json()
        assert len(rows) == 1 and rows[0]["current"] is True, rows

    def test_single_session_revoke(self):
        s_a = login(UA_A)
        s_b = login(UA_B)
        rows = s_a.get(f"{BASE_URL}/api/auth/sessions", timeout=30).json()
        others = [x for x in rows if not x["current"]]
        assert others, rows
        target = others[0]["id"]
        r = s_a.delete(f"{BASE_URL}/api/auth/sessions/{target}", headers=csrf_headers(s_a), timeout=30)
        assert r.status_code == 200
        assert r.json()["current"] is False
        other = me(s_b)
        assert other.status_code == 401 or other.json() is None
        assert me(s_a).json()["email"] == ADMIN_EMAIL
        # revoked session is gone from list
        rows2 = s_a.get(f"{BASE_URL}/api/auth/sessions", timeout=30).json()
        assert target not in [x["id"] for x in rows2]

    def test_revoke_unknown_session_404(self, admin_a):
        r = admin_a.delete(f"{BASE_URL}/api/auth/sessions/does-not-exist", headers=csrf_headers(admin_a), timeout=30)
        assert r.status_code == 404

    def test_revoke_other_users_session_404(self, admin_a):
        s_player = login(UA_C, DEMO_EMAIL, DEMO_PASSWORD)
        try:
            rows = s_player.get(f"{BASE_URL}/api/auth/sessions", timeout=30).json()
            assert rows, "player has no session"
            foreign_id = rows[0]["id"]
            r = admin_a.delete(f"{BASE_URL}/api/auth/sessions/{foreign_id}", headers=csrf_headers(admin_a), timeout=30)
            assert r.status_code == 404, f"cross-user revoke leaked: {r.status_code}"
            assert s_player.get(f"{BASE_URL}/api/auth/me", timeout=30).json()
        finally:
            s_player.post(f"{BASE_URL}/api/auth/logout", headers=csrf_headers(s_player), timeout=30)


# --- Growth stats ---
class TestGrowthStats:
    def test_growth_stats_admin(self, admin_a):
        r = admin_a.get(f"{BASE_URL}/api/admin/growth-stats?days=30", timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data["window_days"] == 30
        days = data["days"]
        assert len(days) == 30, len(days)
        prev_total = None
        for row in days:
            assert re.match(r"^\d{4}-\d{2}-\d{2}$", row["date"])
            assert isinstance(row["logins"], int) and row["logins"] >= 0
            assert isinstance(row["new_users"], int) and row["new_users"] >= 0
            assert isinstance(row["total_users"], int)
            if prev_total is not None:
                assert row["total_users"] >= prev_total, "total_users must be non-decreasing"
            prev_total = row["total_users"]
        assert sum(d["logins"] for d in days) >= 1, "today's logins should be counted"

    def test_growth_stats_clamped(self, admin_a):
        r = admin_a.get(f"{BASE_URL}/api/admin/growth-stats?days=3", timeout=60)
        assert r.status_code == 200
        assert r.json()["window_days"] == 7
        r2 = admin_a.get(f"{BASE_URL}/api/admin/growth-stats?days=500", timeout=60)
        assert r2.json()["window_days"] == 90

    def test_growth_stats_requires_admin(self):
        r = requests.get(f"{BASE_URL}/api/admin/growth-stats?days=30", timeout=30)
        assert r.status_code in (401, 403)
        s_player = login(UA_C, DEMO_EMAIL, DEMO_PASSWORD)
        try:
            r2 = s_player.get(f"{BASE_URL}/api/admin/growth-stats?days=30", timeout=30)
            assert r2.status_code == 403, r2.status_code
        finally:
            s_player.post(f"{BASE_URL}/api/auth/logout", headers=csrf_headers(s_player), timeout=30)


# --- Video upload recheck ---
class TestVideoUpload:
    def test_video_upload_and_fetch(self, admin_a):
        payload = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 4096
        headers = {k: v for k, v in admin_a.headers.items() if k != "Content-Type"}
        headers.update(csrf_headers(admin_a))
        r = requests.post(
            f"{BASE_URL}/api/uploads/video",
            cookies=requests.utils.dict_from_cookiejar(admin_a.cookies),
            headers=headers,
            files={"file": ("TEST_iter12.mp4", payload, "video/mp4")},
            timeout=120,
        )
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        url = r.json().get("url")
        assert url, r.json()
        fetch = requests.get(f"{BASE_URL}{url}", timeout=60)
        assert fetch.status_code == 200
        assert int(fetch.headers.get("content-length", "1")) > 0
