"""Iteration 11 — session robustness: concurrent refresh must not revoke the family.

Covers the user bug: "Ich logge mich ein, dann haut es mich sofort wieder raus."
Two parallel POST /api/auth/refresh with the same refresh cookie must both
succeed (idempotent replacement) and the session must stay valid.
"""
import os
from concurrent.futures import ThreadPoolExecutor

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
pytestmark = pytest.mark.live
if not base_url:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)
BASE_URL = base_url.rstrip("/")

PLAYER = {"email": "ace_racer@demo.lionsquad.at", "password": "DemoLion2026!!"}


def _login(creds=None):
    creds = creds or PLAYER
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text[:300]}"
    cookies = requests.utils.dict_from_cookiejar(r.cookies)
    assert "access_token" in cookies and "refresh_token" in cookies, cookies.keys()
    assert "csrf_token" in cookies, "csrf_token cookie missing"
    return r.json(), cookies


def _me(cookies):
    return requests.get(f"{BASE_URL}/api/auth/me", cookies=cookies, timeout=30)


def _refresh(cookies):
    headers = {"X-CSRF-Token": cookies.get("csrf_token", "")}
    return requests.post(f"{BASE_URL}/api/auth/refresh", cookies=cookies,
                         headers=headers, timeout=30)


def _merge(cookies, response):
    new = dict(cookies)
    new.update(requests.utils.dict_from_cookiejar(response.cookies))
    return new


# --- Login / session basics -------------------------------------------------
class TestLoginPersists:
    def test_login_then_me_returns_user(self):
        user, cookies = _login()
        assert user["email"] == PLAYER["email"]
        r = _me(cookies)
        assert r.status_code == 200
        body = r.json()
        assert body is not None, "/auth/me returned null right after login"
        assert body["email"] == PLAYER["email"]

    def test_sequential_refresh_keeps_session(self):
        _, cookies = _login()
        for i in range(4):
            r = _refresh(cookies)
            assert r.status_code == 200, f"refresh #{i+1} -> {r.status_code} {r.text[:200]}"
            cookies = _merge(cookies, r)
            me = _me(cookies)
            assert me.status_code == 200
            assert me.json() is not None, f"/auth/me null after refresh #{i+1}"
            assert me.json()["email"] == PLAYER["email"]

    def test_admin_login_and_me(self):
        user, cookies = _login({"email": "admin@lionsquad.at", "password": "LionSquad2026!Admin"})
        assert user["role"] in ("superadmin", "admin")
        me = _me(cookies)
        assert me.status_code == 200 and me.json() is not None


# --- Primary regression: parallel refresh -----------------------------------
class TestConcurrentRefresh:
    def test_two_parallel_refreshes_both_succeed_and_session_survives(self):
        _, cookies = _login()
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(_refresh, cookies) for _ in range(2)]
            results = [f.result() for f in futures]
        codes = sorted(r.status_code for r in results)
        assert codes == [200, 200], f"expected both 200, got {codes}: " + \
            " | ".join(r.text[:150] for r in results)

        # both responses must carry the SAME rotated refresh token (idempotent)
        tokens = [requests.utils.dict_from_cookiejar(r.cookies).get("refresh_token") for r in results]
        assert tokens[0] and tokens[1]
        assert tokens[0] == tokens[1], "concurrent refreshes returned different refresh tokens"

        rotated = _merge(cookies, results[0])
        me = _me(rotated)
        assert me.status_code == 200
        assert me.json() is not None, "session revoked after concurrent refresh (bug reproduced)"
        assert me.json()["email"] == PLAYER["email"]

        # family still alive: the rotated token can be refreshed again
        again = _refresh(rotated)
        assert again.status_code == 200, f"family revoked: {again.status_code} {again.text[:200]}"
        final = _merge(rotated, again)
        assert _me(final).json() is not None

    def test_five_parallel_refreshes_all_succeed(self):
        _, cookies = _login()
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = [f.result() for f in [pool.submit(_refresh, cookies) for _ in range(5)]]
        codes = [r.status_code for r in results]
        assert all(c == 200 for c in codes), f"parallel refresh codes: {codes}"
        ok = next(r for r in results if r.status_code == 200)
        rotated = _merge(cookies, ok)
        assert _me(rotated).json() is not None

    def test_old_token_replay_after_grace_is_rejected_and_family_revoked(self):
        """Genuine reuse (replay outside grace) must still be treated as theft."""
        import time
        _, cookies = _login()
        r1 = _refresh(cookies)
        assert r1.status_code == 200
        rotated = _merge(cookies, r1)
        time.sleep(11)  # exceed REFRESH_REPLAY_GRACE_SECONDS
        replay = _refresh(cookies)  # old token again
        assert replay.status_code == 401, f"stale replay accepted: {replay.status_code}"
        # theft detection -> family revoked -> rotated session dead
        me = _me(rotated)
        assert me.status_code == 200
        assert me.json() is None, "family should be revoked after genuine replay"


# --- Security / CSRF --------------------------------------------------------
class TestRefreshSecurity:
    def test_garbage_refresh_token_rejected(self):
        _, cookies = _login()
        bad = dict(cookies)
        bad["refresh_token"] = "not.a.jwt.at.all"
        r = _refresh(bad)
        assert r.status_code == 401, f"garbage token -> {r.status_code}"

    def test_forged_refresh_token_rejected(self):
        import jwt as pyjwt
        from datetime import datetime, timezone, timedelta
        _, cookies = _login()
        forged = pyjwt.encode(
            {"sub": "someone", "jti": "forged-jti", "fid": "forged-jti",
             "exp": datetime.now(timezone.utc) + timedelta(days=1), "type": "refresh"},
            "wrong-secret", algorithm="HS256",
        )
        bad = dict(cookies)
        bad["refresh_token"] = forged
        assert _refresh(bad).status_code == 401

    def test_no_refresh_cookie_returns_401(self):
        r = requests.post(f"{BASE_URL}/api/auth/refresh", timeout=30)
        assert r.status_code == 401

    def test_refresh_requires_csrf_header(self):
        _, cookies = _login()
        r = requests.post(f"{BASE_URL}/api/auth/refresh", cookies=cookies, timeout=30)
        assert r.status_code in (401, 403), f"CSRF not enforced: {r.status_code}"

    def test_me_without_cookies_is_guest(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json() is None

    def test_logout_revokes_session(self):
        _, cookies = _login()
        out = requests.post(f"{BASE_URL}/api/auth/logout", cookies=cookies,
                            headers={"X-CSRF-Token": cookies.get("csrf_token", "")}, timeout=30)
        assert out.status_code == 200
        assert _refresh(cookies).status_code == 401


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
