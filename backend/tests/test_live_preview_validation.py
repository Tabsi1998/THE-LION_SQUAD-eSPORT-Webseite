"""Live preview-environment validation tests (public browsing + admin auth flow).

Runs against the public ingress URL from /app/frontend/.env so it reflects what
the browser sees (CSRF / trusted host / cookie behaviour included).
"""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not _base:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = _base.rstrip("/")


def _creds():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing test_credentials.md")
    txt = p.read_text(encoding="utf-8")
    e = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?email(?:\*\*)?\s*:\s*`?([^`\s]+)", txt)
    pw = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?password(?:\*\*)?\s*:\s*`?([^`\s]+)", txt)
    if not e or not pw:
        pytest.skip("credentials unparsable")
    return {"email": e.group(1), "password": pw.group(1)}


@pytest.fixture(scope="module")
def creds():
    return _creds()


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/",
        "User-Agent": "Mozilla/5.0 (QA live validation)",
    })
    return s


@pytest.fixture(scope="module")
def admin_client(creds):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/login",
        "User-Agent": "Mozilla/5.0 (QA live validation)",
    })
    r = s.post(f"{BASE_URL}/api/auth/login", json={
        "email": creds["email"], "password": creds["password"]})
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:400]}")
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf
    return s


# --- public read endpoints -------------------------------------------------
class TestPublicEndpoints:
    @pytest.mark.parametrize("path,min_items", [
        ("/api/tournaments", 2),
        ("/api/events", 1),
        ("/api/news", 1),
        ("/api/f1/challenges", 1),
        ("/api/teams", 5),
        ("/api/games", 1),
        ("/api/stations", 1),
    ])
    def test_public_list(self, client, path, min_items):
        r = client.get(f"{BASE_URL}{path}")
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:300]}"
        data = r.json()
        items = data if isinstance(data, list) else (
            data.get("items") or data.get("results") or data.get("data") or [])
        assert isinstance(items, list), f"{path} unexpected shape: {str(data)[:200]}"
        assert len(items) >= min_items, f"{path} expected >={min_items} got {len(items)}"
        for it in items:
            if isinstance(it, dict):
                assert "_id" not in it, f"{path} leaks mongo _id"

    def test_home_state(self, client):
        r = client.get(f"{BASE_URL}/api/home/state")
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"

    def test_nav(self, client):
        r = client.get(f"{BASE_URL}/api/nav")
        assert r.status_code == 200
        assert r.json() is not None

    def test_settings_public(self, client):
        r = client.get(f"{BASE_URL}/api/settings/public")
        assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
        assert r.json().get("club_name")

    def test_tournament_detail(self, client):
        lst = client.get(f"{BASE_URL}/api/tournaments").json()
        items = lst if isinstance(lst, list) else lst.get("items", [])
        assert items, "no tournaments seeded"
        tid = items[0].get("id") or items[0].get("slug")
        r = client.get(f"{BASE_URL}/api/tournaments/{tid}")
        assert r.status_code == 200, f"detail {r.status_code}: {r.text[:300]}"
        d = r.json()
        assert d.get("id") == items[0].get("id")
        assert "_id" not in d

    def test_tournament_bracket_and_standings(self, client):
        items = client.get(f"{BASE_URL}/api/tournaments").json()
        items = items if isinstance(items, list) else items.get("items", [])
        tid = items[0]["id"]
        for sub in ("bracket", "standings", "participants"):
            r = client.get(f"{BASE_URL}/api/tournaments/{tid}/{sub}")
            assert r.status_code in (200, 404), f"{sub} -> {r.status_code}: {r.text[:200]}"

    def test_unknown_tournament_404(self, client):
        r = client.get(f"{BASE_URL}/api/tournaments/does-not-exist-xyz")
        assert r.status_code == 404


# --- auth flow -------------------------------------------------------------
class TestAuthFlow:
    def test_login_sets_cookies(self, creds):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": creds["email"], "password": creds["password"]})
        assert r.status_code == 200, f"{r.status_code}: {r.text[:400]}"
        assert s.cookies.get("access_token"), "access_token cookie not set"
        assert s.cookies.get("csrf_token"), "csrf_token cookie not set"
        me = s.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200, f"/me {me.status_code}: {me.text[:300]}"
        body = me.json()
        user = body.get("user", body)
        assert user.get("email") == creds["email"]
        assert "_id" not in user
        # logout
        s.headers["X-CSRF-Token"] = s.cookies.get("csrf_token")
        out = s.post(f"{BASE_URL}/api/auth/logout")
        assert out.status_code in (200, 204), f"logout {out.status_code}: {out.text[:200]}"
        assert not s.cookies.get("access_token"), "access_token cookie not cleared"
        after = s.get(f"{BASE_URL}/api/auth/me")
        assert after.status_code == 200 and after.json() is None, \
            f"session still valid after logout: {after.status_code} {after.text[:200]}"

    def test_login_wrong_password(self, creds):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
        r = s.post(f"{BASE_URL}/api/auth/login",
                   json={"email": creds["email"], "password": "definitely-wrong-1"})
        assert r.status_code in (400, 401, 429), f"{r.status_code}: {r.text[:200]}"

    def test_me_unauthenticated(self, client):
        s = requests.Session()
        r = s.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json() is None

    def test_csrf_rejects_missing_header(self, creds):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
        s.post(f"{BASE_URL}/api/auth/login",
               json={"email": creds["email"], "password": creds["password"]})
        # authenticated POST without X-CSRF-Token must be rejected
        r = s.post(f"{BASE_URL}/api/news", json={"title": "TEST_x", "content": "x"})
        assert r.status_code == 403, f"expected CSRF 403, got {r.status_code}"

    def test_cross_site_origin_rejected_at_origin_server(self, creds):
        """Ingress rewrites Origin, so verify the CSRF origin check on the app port."""
        r = requests.post("http://localhost:8001/api/auth/login",
                          json={"email": creds["email"], "password": creds["password"]},
                          headers={"Origin": "https://evil.example.com"})
        assert r.status_code == 403, f"untrusted origin accepted: {r.status_code}"


# --- admin endpoints -------------------------------------------------------
class TestAdminEndpoints:
    @pytest.mark.parametrize("path", [
        "/api/admin/dashboard",
        "/api/users",
        "/api/tournaments",
        "/api/news",
        "/api/events",
        "/api/audit",
        "/api/admin/penalties",
        "/api/membership/applications",
        "/api/documents",
        "/api/admin/media",
    ])
    def test_admin_get(self, admin_client, path):
        r = admin_client.get(f"{BASE_URL}{path}")
        assert r.status_code in (200, 404), f"{path} -> {r.status_code}: {r.text[:300]}"

    def test_admin_requires_auth(self, client):
        r = client.get(f"{BASE_URL}/api/admin/dashboard")
        assert r.status_code in (401, 403), f"admin dashboard open to public: {r.status_code}"

    def test_news_create_update_delete(self, admin_client):
        payload = {"title": "TEST_QA Beitrag", "content": "TEST_QA Inhalt",
                   "excerpt": "TEST_QA", "category": "announcement", "is_published": False}
        r = admin_client.post(f"{BASE_URL}/api/news", json=payload)
        if r.status_code in (404, 405):
            pytest.skip(f"news create not available: {r.status_code}")
        assert r.status_code in (200, 201), f"create {r.status_code}: {r.text[:400]}"
        created = r.json()
        nid = created.get("id")
        assert nid, f"no id in {str(created)[:200]}"
        try:
            g = admin_client.get(f"{BASE_URL}/api/news/{nid}")
            assert g.status_code == 200, f"get {g.status_code}"
            assert g.json().get("title") == payload["title"]
            u = admin_client.put(f"{BASE_URL}/api/news/{nid}",
                                 json={**payload, "title": "TEST_QA Beitrag 2"})
            assert u.status_code in (200, 204), f"update {u.status_code}: {u.text[:300]}"
            g2 = admin_client.get(f"{BASE_URL}/api/news/{nid}")
            assert g2.json().get("title") == "TEST_QA Beitrag 2"
        finally:
            d = admin_client.delete(f"{BASE_URL}/api/news/{nid}")
            assert d.status_code in (200, 204, 404), f"delete {d.status_code}"
        g3 = admin_client.get(f"{BASE_URL}/api/news/{nid}")
        assert g3.status_code == 404
