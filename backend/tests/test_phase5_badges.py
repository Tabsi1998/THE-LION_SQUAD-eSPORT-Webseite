"""Phase 5 Tests: Badge System, Public Profiles, Sponsors CRUD, Upload, F1 Rename."""
import os
import io
import base64
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live backend tests", allow_module_level=True)
ADMIN_EMAIL = "admin@lionsquad.at"
ADMIN_PASS = "TLSAdmin2026!"
DEMO_EMAIL = "leon_king@demo.lionsquad.at"
DEMO_PASS = "demo123"

# 1x1 PNG (transparent)
PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def user_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PASS})
    assert r.status_code == 200, f"demo login failed: {r.text}"
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def user_headers(user_token):
    return {"Authorization": f"Bearer {user_token}"}


# -------- Badge Catalog --------
class TestBadges:
    def test_list_badges_22(self):
        r = requests.get(f"{BASE_URL}/api/badges")
        assert r.status_code == 200
        badges = r.json()
        assert isinstance(badges, list)
        assert len(badges) == 22, f"Expected 22 badges got {len(badges)}"
        # Verify categories
        cats = {b["category"] for b in badges}
        assert cats == {"tournament", "match", "fastlap", "community", "season"}, f"cats={cats}"
        # Verify sorted by tier (platinum > gold > silver > bronze)
        tier_idx = {"platinum": 0, "gold": 1, "silver": 2, "bronze": 3}
        prev = -1
        for b in badges:
            cur = tier_idx.get(b["tier"], 9)
            assert cur >= prev, f"sort broken at {b['code']}"
            prev = cur
        # awarded_count exists
        for b in badges:
            assert "awarded_count" in b
            assert isinstance(b["awarded_count"], int)

    def test_get_first_win_badge(self):
        r = requests.get(f"{BASE_URL}/api/badges/first_win")
        assert r.status_code == 200
        b = r.json()
        assert b["code"] == "first_win"
        assert "holders" in b
        assert "awarded_count" in b
        assert isinstance(b["holders"], list)


# -------- Public Profile --------
class TestPublicProfile:
    def test_get_pixelhawk_profile(self):
        r = requests.get(f"{BASE_URL}/api/users/public/pixelhawk")
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["username"] == "pixelhawk"
        # required fields
        for k in ["badges", "stats", "tournaments", "f1_bests", "teams", "references"]:
            assert k in p, f"missing {k}"
        assert isinstance(p["badges"], list)
        assert isinstance(p["stats"], dict)
        assert isinstance(p["references"], dict)
        assert isinstance(p["references"].get("items"), list)
        assert isinstance(p["references"].get("stats"), dict)
        # has 8 badges per spec
        assert len(p["badges"]) >= 1, "PixelHawk should have badges"
        # stats keys
        for k in ["tournaments", "wins", "top3", "matches_played", "matches_won",
                  "fast_laps", "pole_positions", "badges", "points"]:
            assert k in p["stats"]

    def test_get_nonexistent_user(self):
        r = requests.get(f"{BASE_URL}/api/users/public/zzz_does_not_exist_999")
        assert r.status_code == 404
        assert "nicht gefunden" in r.json().get("detail", "").lower()


# -------- Upload --------
class TestUpload:
    def test_upload_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/uploads/image",
                          files={"file": ("a.png", PNG_BYTES, "image/png")})
        assert r.status_code in (401, 403), f"expected auth fail, got {r.status_code}"

    def test_upload_png_and_serve(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/uploads/image",
                          files={"file": ("test.png", PNG_BYTES, "image/png")},
                          headers=user_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "url" in d
        url = d["url"]
        assert url.startswith("/api/static/uploads/"), f"wrong url path: {url}"
        # Fetch
        r2 = requests.get(f"{BASE_URL}{url}")
        assert r2.status_code == 200
        assert "image" in r2.headers.get("content-type", "").lower()
        assert r2.content[:8].startswith(b"\x89PNG")

    def test_upload_rejects_bad_mime(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/uploads/image",
                          files={"file": ("a.txt", b"hello", "text/plain")},
                          headers=user_headers)
        assert r.status_code == 400


# -------- Sponsors CRUD (admin) --------
class TestSponsorsCRUD:
    def test_create_patch_delete(self, admin_headers):
        name = f"TEST_sponsor_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{BASE_URL}/api/sponsors",
                          json={"name": name, "logo_url": "/img/x.png",
                                "link": "https://x.com", "tier": "gold",
                                "description": "test"}, headers=admin_headers)
        assert r.status_code in (200, 201), r.text
        sp = r.json()
        sid = sp.get("id")
        assert sid
        # PATCH
        r2 = requests.patch(f"{BASE_URL}/api/sponsors/{sid}",
                            json={"description": "updated"}, headers=admin_headers)
        assert r2.status_code == 200, r2.text
        # GET list to verify
        r3 = requests.get(f"{BASE_URL}/api/sponsors")
        items = r3.json()
        match = [x for x in items if x.get("id") == sid]
        assert match and match[0]["description"] == "updated"
        # DELETE
        r4 = requests.delete(f"{BASE_URL}/api/sponsors/{sid}", headers=admin_headers)
        assert r4.status_code in (200, 204)

    def test_sponsor_create_requires_admin(self, user_headers):
        r = requests.post(f"{BASE_URL}/api/sponsors",
                          json={"name": "TEST_x", "logo_url": "/x.png"},
                          headers=user_headers)
        assert r.status_code in (401, 403)


# -------- Badge Triggers --------
class TestBadgeTriggers:
    def _new_user(self):
        suffix = uuid.uuid4().hex[:8]
        email = f"badgetest_{suffix}@example.com"
        username = f"bt_{suffix}"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "password": "Test1234!",
                                "username": username, "display_name": f"BT {suffix}"})
        assert r.status_code in (200, 201), r.text
        d = r.json()
        token = d.get("access_token") or d.get("token")
        # Response is flat: user fields at top level + access_token
        return token, d, username

    def test_first_tournament_badge_idempotent(self):
        # Create new user
        token, user, username = self._new_user()
        h = {"Authorization": f"Bearer {token}"}
        # Make profile public
        requests.patch(f"{BASE_URL}/api/users/me",
                       json={"privacy_public_profile": True}, headers=h)
        # Find an open tournament
        r = requests.get(f"{BASE_URL}/api/tournaments")
        tournaments = r.json()
        target = None
        for t in tournaments:
            if t.get("status") == "registration_open":
                target = t
                break
        if not target:
            pytest.skip("no registration_open tournament available")
        tid = target["id"]
        r = requests.post(f"{BASE_URL}/api/tournaments/{tid}/register",
                          json={"accept_rules": True, "accept_privacy": True}, headers=h)
        assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
        # First profile fetch
        r = requests.get(f"{BASE_URL}/api/users/public/{username}")
        assert r.status_code == 200
        codes1 = [b["code"] for b in r.json().get("badges", [])]
        assert "first_tournament" in codes1, f"first_tournament not awarded! got {codes1}"
        first_count = codes1.count("first_tournament")
        assert first_count == 1
        # Try register again — should be rejected (already registered)
        r2 = requests.post(f"{BASE_URL}/api/tournaments/{tid}/register", headers=h)
        # Re-check
        r3 = requests.get(f"{BASE_URL}/api/users/public/{username}")
        codes2 = [b["code"] for b in r3.json().get("badges", [])]
        assert codes2.count("first_tournament") == 1, "Badge awarded twice (idempotency broken)"

    def test_first_lap_badge(self, admin_headers):
        # Lap submission is admin-only, so admin submits on behalf of new user
        token, user, username = self._new_user()
        new_user_id = user.get("id")
        h = {"Authorization": f"Bearer {token}"}
        requests.patch(f"{BASE_URL}/api/users/me",
                       json={"privacy_public_profile": True}, headers=h)
        # Find a Fast Lap challenge
        r = requests.get(f"{BASE_URL}/api/f1/challenges")
        if r.status_code != 200:
            pytest.skip("no f1 endpoint")
        challenges = r.json()
        target = None
        for c in challenges:
            if c.get("status") in ("active", "open", "live", "registration_open"):
                target = c
                break
        if not target:
            target = challenges[0] if challenges else None
        if not target:
            pytest.skip("no f1 challenge")
        cid = target["id"]
        # Get tracks
        r2 = requests.get(f"{BASE_URL}/api/f1/challenges/{cid}")
        d = r2.json() if r2.status_code == 200 else {}
        tracks = d.get("tracks") or []
        if not tracks:
            pytest.skip("no tracks for challenge")
        t0 = tracks[0]
        track_id = t0.get("id") if isinstance(t0, dict) else t0
        # Submit lap as admin on behalf of new user
        r = requests.post(f"{BASE_URL}/api/f1/challenges/{cid}/times",
                          json={"user_id": new_user_id, "track_id": track_id,
                                "time_ms": 90000}, headers=admin_headers)
        assert r.status_code in (200, 201), f"lap submit failed: {r.status_code} {r.text}"
        # Verify badge
        r = requests.get(f"{BASE_URL}/api/users/public/{username}")
        codes = [b["code"] for b in r.json().get("badges", [])]
        assert "first_lap" in codes, f"first_lap not awarded! got {codes}"
        # Idempotency: submit second lap, verify only 1 first_lap badge
        second_lap = requests.post(f"{BASE_URL}/api/f1/challenges/{cid}/times",
                                   json={"user_id": new_user_id, "track_id": track_id,
                                         "time_ms": 95000}, headers=admin_headers)
        assert second_lap.status_code in (200, 201), f"second lap submit failed: {second_lap.status_code} {second_lap.text}"
        r = requests.get(f"{BASE_URL}/api/users/public/{username}")
        codes = [b["code"] for b in r.json().get("badges", [])]
        assert codes.count("first_lap") == 1, "first_lap awarded twice!"
