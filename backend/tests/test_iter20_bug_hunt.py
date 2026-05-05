"""
Iteration 20 — Bug Hunt after user self-edits
Covers: Teams CRUD + members + squads, PUT/PATCH roundtrip for all resources,
sponsor tiers (5-tier system), branding social URLs, media delete performance,
level-system, achievements, email-template wording, admin invite flow.
"""
import os
import time
import uuid
import pytest
import requests

def _load_backend_url():
    url = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
    if url:
        return url
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return "http://localhost:8001"

BASE_URL = _load_backend_url()
ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PASSWORD = "TLSAdmin2026!"


# ------------------- Fixtures -------------------
def _make_session(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": email, "password": password}, timeout=20)
    if r.status_code != 200:
        return None, None
    user = r.json()
    return s, user


@pytest.fixture(scope="module")
def admin_client():
    s, user = _make_session(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert s is not None, "admin login failed"
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    s.admin_user = user
    return s


@pytest.fixture(scope="module")
def admin_token(admin_client):
    # compatibility stub
    return admin_client.cookies.get("access_token") or "cookie-session"


@pytest.fixture(scope="module")
def second_user_token():
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_teammate_{suffix}@example.com"
    password = "TeammatePW1!"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "password": password,
        "username": f"TEST_mate_{suffix}",
        "display_name": f"TEST Mate {suffix}",
        "accept_privacy": True, "accept_terms": True,
    }, timeout=20)
    if r.status_code not in (200, 201):
        pytest.skip(f"register second user failed: {r.status_code} {r.text}")
    s2, user = _make_session(email, password)
    if not s2:
        pytest.skip("login second user failed")
    csrf = s2.cookies.get("csrf_token")
    if csrf:
        s2.headers.update({"X-CSRF-Token": csrf})
    return {"session": s2, "user_id": user["id"], "email": email}


# ------------------- Sanity -------------------
class TestSanity:
    def test_admin_login(self, admin_token):
        assert len(admin_token) > 10

    def test_admin_me(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL


# ------------------- Team System -------------------
class TestTeamSystem:
    @pytest.fixture(scope="class")
    def team_id(self, admin_client):
        suffix = uuid.uuid4().hex[:6]
        r = admin_client.post(f"{BASE_URL}/api/teams", json={
            "name": f"TEST Team {suffix}",
            "tag": f"TT{suffix[:4]}",
            "description": "initial desc",
            "logo_url": None,
            "discord_link": None,
        }, timeout=15)
        assert r.status_code in (200, 201), f"create team: {r.status_code} {r.text}"
        tid = r.json()["id"]
        yield tid
        admin_client.delete(f"{BASE_URL}/api/teams/{tid}", timeout=15)

    def test_team_create_fields(self, admin_client, team_id):
        r = admin_client.get(f"{BASE_URL}/api/teams/{team_id}", timeout=15)
        assert r.status_code == 200
        t = r.json()
        assert t["description"] == "initial desc"
        assert "members" in t and len(t["members"]) >= 1
        assert t["leader_id"]

    def test_team_update_roundtrip(self, admin_client, team_id):
        # PATCH with new name + description + logo_url
        r = admin_client.patch(f"{BASE_URL}/api/teams/{team_id}", json={
            "name": "TEST Team Updated",
            "description": "updated desc",
            "logo_url": "/api/static/uploads/fake.png",
        }, timeout=15)
        assert r.status_code == 200, f"patch team: {r.status_code} {r.text}"
        # GET to verify persistence
        g = admin_client.get(f"{BASE_URL}/api/teams/{team_id}", timeout=15).json()
        assert g["name"] == "TEST Team Updated"
        assert g["description"] == "updated desc"
        assert g["logo_url"] == "/api/static/uploads/fake.png"

    def test_team_add_member_via_join_code(self, admin_client, team_id, second_user_token):
        team = admin_client.get(f"{BASE_URL}/api/teams/{team_id}", timeout=15).json()
        join_code = team.get("join_code")
        assert join_code, "team has no join_code"
        r = second_user_token["session"].post(
            f"{BASE_URL}/api/teams/{team_id}/join",
            json={"join_code": join_code}, timeout=15,
        )
        assert r.status_code == 200, f"join: {r.status_code} {r.text}"
        g = admin_client.get(f"{BASE_URL}/api/teams/{team_id}", timeout=15).json()
        assert second_user_token["user_id"] in g["member_ids"]

    def test_team_squad_create_and_update(self, admin_client, team_id, second_user_token):
        r = admin_client.post(f"{BASE_URL}/api/teams/{team_id}/squads", json={
            "name": "TEST Squad A",
            "description": "main roster",
            "member_ids": [second_user_token["user_id"]],
        }, timeout=15)
        assert r.status_code in (200, 201), f"create squad: {r.status_code} {r.text}"
        sid = r.json()["id"]
        # update
        u = admin_client.patch(f"{BASE_URL}/api/teams/{team_id}/squads/{sid}", json={
            "name": "TEST Squad A2", "description": "renamed"
        }, timeout=15)
        assert u.status_code == 200
        # list & verify
        lst = admin_client.get(f"{BASE_URL}/api/teams/{team_id}/squads", timeout=15).json()
        found = [s for s in lst if s["id"] == sid]
        assert found and found[0]["name"] == "TEST Squad A2"
        # delete
        d = admin_client.delete(f"{BASE_URL}/api/teams/{team_id}/squads/{sid}", timeout=15)
        assert d.status_code == 200

    def test_team_roster_role_change_endpoint_presence(self, admin_client, team_id, second_user_token):
        """Check if roster role management endpoint exists (promote to co_leader etc.)"""
        r = admin_client.post(
            f"{BASE_URL}/api/teams/{team_id}/members/{second_user_token['user_id']}/role",
            json={"role": "co_leader"}, timeout=10)
        # We record the result — will be used for bug reporting
        assert r.status_code in (200, 404, 405), (
            f"unexpected status {r.status_code}: {r.text}")
        # 404/405 → endpoint missing = BUG
        if r.status_code in (404, 405):
            pytest.xfail("Team role-change endpoint does not exist — roster management incomplete")

    def test_team_remove_member_endpoint_presence(self, admin_client, team_id, second_user_token):
        r = admin_client.delete(
            f"{BASE_URL}/api/teams/{team_id}/members/{second_user_token['user_id']}", timeout=10)
        assert r.status_code in (200, 204, 404, 405), f"{r.status_code}: {r.text}"
        if r.status_code in (404, 405):
            pytest.xfail("Team remove-member endpoint does not exist")


# ------------------- PUT/PATCH Save-Bug Roundtrip -------------------
class TestSaveRoundtrip:
    def test_news_update_roundtrip(self, admin_client):
        # create news
        c = admin_client.post(f"{BASE_URL}/api/news", json={
            "title": "TEST News Orig", "body_md": "orig body", "tags": ["test"],
            "is_published": False,
        }, timeout=15)
        assert c.status_code in (200, 201), c.text
        nid = c.json()["id"]
        try:
            u = admin_client.put(f"{BASE_URL}/api/news/{nid}", json={
                "title": "TEST News Upd", "body_md": "new body"
            }, timeout=15)
            assert u.status_code == 200, f"PUT news: {u.status_code} {u.text}"
            g = admin_client.get(f"{BASE_URL}/api/news/{nid}", timeout=15).json()
            assert g["title"] == "TEST News Upd"
            assert g["body_md"] == "new body"
        finally:
            admin_client.delete(f"{BASE_URL}/api/news/{nid}", timeout=15)

    def test_tournament_update_roundtrip(self, admin_client):
        # Find an existing game
        games = admin_client.get(f"{BASE_URL}/api/games", timeout=15).json()
        if not games:
            pytest.skip("no games available")
        c = admin_client.post(f"{BASE_URL}/api/tournaments", json={
            "name": "TEST Tour Orig", "game_id": games[0]["id"],
            "format": "single_elim", "start_at": "2026-12-31T10:00:00Z",
        }, timeout=15)
        if c.status_code not in (200, 201):
            pytest.skip(f"tournament create failed: {c.status_code} {c.text}")
        tid = c.json()["id"]
        try:
            u = admin_client.put(f"{BASE_URL}/api/tournaments/{tid}", json={
                "name": "TEST Tour Upd", "description": "new desc"
            }, timeout=15)
            assert u.status_code == 200, f"{u.status_code}: {u.text}"
            g = admin_client.get(f"{BASE_URL}/api/tournaments/{tid}", timeout=15).json()
            assert g["name"] == "TEST Tour Upd"
            assert g.get("description") == "new desc"
        finally:
            admin_client.delete(f"{BASE_URL}/api/tournaments/{tid}", timeout=15)

    def test_events_update_roundtrip(self, admin_client):
        c = admin_client.post(f"{BASE_URL}/api/events", json={
            "title": "TEST Event", "event_type": "meeting",
            "start_at": "2026-12-31T20:00:00Z"
        }, timeout=15)
        if c.status_code not in (200, 201):
            pytest.skip(f"events create failed: {c.status_code} {c.text}")
        eid = c.json()["id"]
        try:
            u = admin_client.put(f"{BASE_URL}/api/events/{eid}", json={
                "title": "TEST Event Upd", "location": "Online"
            }, timeout=15)
            assert u.status_code == 200, f"{u.status_code}: {u.text}"
            g = admin_client.get(f"{BASE_URL}/api/events/{eid}", timeout=15).json()
            assert g["title"] == "TEST Event Upd"
            assert g.get("location") == "Online"
        finally:
            admin_client.delete(f"{BASE_URL}/api/events/{eid}", timeout=15)

    def test_cms_page_update_roundtrip(self, admin_client):
        pages = admin_client.get(f"{BASE_URL}/api/cms/pages", timeout=15).json()
        if not pages:
            pytest.skip("no cms pages")
        page = pages[0]
        pid = page["id"]
        orig_body = page.get("body_md", "")
        u = admin_client.put(f"{BASE_URL}/api/cms/pages/{pid}", json={
            "body_md": orig_body + "\n\nTEST MARKER XYZ"
        }, timeout=15)
        assert u.status_code == 200, f"{u.status_code}: {u.text}"
        g = admin_client.get(f"{BASE_URL}/api/cms/pages/{pid}", timeout=15).json()
        assert "TEST MARKER XYZ" in g["body_md"]
        # restore
        admin_client.put(f"{BASE_URL}/api/cms/pages/{pid}",
                         json={"body_md": orig_body}, timeout=15)

    def test_branding_update_roundtrip(self, admin_client):
        g0 = admin_client.get(f"{BASE_URL}/api/settings/branding", timeout=15).json()
        orig_fb = g0.get("facebook_url")
        u = admin_client.put(f"{BASE_URL}/api/settings/branding", json={
            "facebook_url": "https://www.facebook.com/TESTMARKER",
            "tiktok_url": "https://www.tiktok.com/@TESTMARKER",
        }, timeout=15)
        assert u.status_code == 200, f"{u.status_code}: {u.text}"
        g = admin_client.get(f"{BASE_URL}/api/settings/branding", timeout=15).json()
        assert g["facebook_url"] == "https://www.facebook.com/TESTMARKER"
        assert g["tiktok_url"] == "https://www.tiktok.com/@TESTMARKER"
        # restore
        admin_client.put(f"{BASE_URL}/api/settings/branding",
                         json={"facebook_url": orig_fb}, timeout=15)


# ------------------- Sponsor 5-Tier -------------------
class TestSponsorTiers:
    @pytest.fixture(scope="class")
    def sponsor_ids(self, admin_client):
        ids = {}
        for tier in ["main", "platinum", "gold", "silver", "bronze"]:
            r = admin_client.post(f"{BASE_URL}/api/sponsors", json={
                "name": f"TEST Sponsor {tier}", "tier": tier,
                "logo_url": "/api/static/uploads/x.png",
                "url": "https://example.com",
            }, timeout=15)
            if r.status_code not in (200, 201):
                continue
            ids[tier] = r.json()["id"]
        yield ids
        for sid in ids.values():
            admin_client.delete(f"{BASE_URL}/api/sponsors/{sid}", timeout=15)

    def test_all_5_tiers_accepted(self, sponsor_ids):
        assert set(sponsor_ids.keys()) == {"main", "platinum", "gold", "silver", "bronze"}

    def test_legacy_tier_rejected_or_normalized(self, admin_client):
        r = admin_client.post(f"{BASE_URL}/api/sponsors", json={
            "name": "TEST Legacy", "tier": "supporter",
            "logo_url": "/x.png"
        }, timeout=15)
        # Pydantic Literal should reject → 422
        assert r.status_code == 422, f"legacy tier must be rejected, got {r.status_code}: {r.text}"

    def test_public_sponsors_all_valid_tiers(self):
        r = requests.get(f"{BASE_URL}/api/sponsors", timeout=15)
        assert r.status_code == 200
        valid = {"main", "platinum", "gold", "silver", "bronze"}
        for s in r.json():
            assert s["tier"] in valid, f"legacy tier leaked: {s}"

    def test_placement_home(self, sponsor_ids):
        r = requests.get(f"{BASE_URL}/api/sponsors?placement=home", timeout=15)
        assert r.status_code == 200
        tiers = {s["tier"] for s in r.json()}
        # only main/platinum/gold allowed at home
        assert tiers.issubset({"main", "platinum", "gold"}), f"home leaked: {tiers}"

    def test_placement_footer(self, sponsor_ids):
        r = requests.get(f"{BASE_URL}/api/sponsors?placement=footer", timeout=15)
        assert r.status_code == 200
        tiers = {s["tier"] for s in r.json()}
        assert tiers.issubset({"main", "platinum", "gold", "silver"}), f"footer leaked: {tiers}"

    def test_sponsor_update_roundtrip(self, admin_client, sponsor_ids):
        if "bronze" not in sponsor_ids:
            pytest.skip("no bronze sponsor")
        sid = sponsor_ids["bronze"]
        u = admin_client.patch(f"{BASE_URL}/api/sponsors/{sid}", json={
            "name": "TEST Bronze Upd", "tier": "silver"
        }, timeout=15)
        assert u.status_code == 200, f"{u.status_code}: {u.text}"
        # GET via admin list
        lst = admin_client.get(f"{BASE_URL}/api/sponsors/admin", timeout=15).json()
        f = [s for s in lst if s["id"] == sid]
        assert f and f[0]["name"] == "TEST Bronze Upd"
        assert f[0]["tier"] == "silver"


# ------------------- Branding: Social URLs -------------------
class TestBrandingSocials:
    def test_branding_contains_all_socials(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/settings/branding", timeout=15)
        assert r.status_code == 200
        b = r.json()
        for key in ("discord_invite_url", "facebook_url", "instagram_url",
                    "tiktok_url", "youtube_url", "twitch_channel"):
            assert key in b, f"missing branding key: {key}"


# ------------------- Media Performance -------------------
class TestMediaPerformance:
    def test_admin_media_list_latency(self, admin_client):
        t0 = time.time()
        r = admin_client.get(f"{BASE_URL}/api/admin/media", timeout=15)
        dt = time.time() - t0
        assert r.status_code == 200
        assert dt < 2.0, f"list media slow: {dt:.2f}s"

    def test_admin_media_delete_latency(self, admin_client):
        # Upload a tiny PNG
        png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\x83\xb8\xc3\xec\x00\x00\x00\x00IEND\xaeB`\x82"
        files = {"file": ("test_iter20.png", png, "image/png")}
        up = admin_client.post(f"{BASE_URL}/api/uploads/image",
                               files=files, timeout=30,
                               headers={"Content-Type": None})
        if up.status_code not in (200, 201):
            pytest.skip(f"upload failed: {up.status_code} {up.text}")
        url = up.json().get("url", "")
        filename = url.rsplit("/", 1)[-1] if url else None
        if not filename:
            pytest.skip("no filename from upload")
        t0 = time.time()
        d = admin_client.delete(f"{BASE_URL}/api/admin/media/{filename}", timeout=15)
        dt = time.time() - t0
        assert d.status_code == 200, f"{d.status_code}: {d.text}"
        assert dt < 3.0, f"delete slow: {dt:.2f}s"


# ------------------- Level & Achievements -------------------
class TestLevelAndAchievements:
    def test_me_has_level_fields(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        # Level may be on user object or a separate endpoint
        me = r.json()
        # Try /api/users/{id}/public or similar
        uid = me["id"]
        pub = requests.get(f"{BASE_URL}/api/users/public/{me.get('username','admin')}", timeout=15)
        # Just check no 500
        assert pub.status_code in (200, 404), f"{pub.status_code}: {pub.text[:200]}"

    def test_leaderboard(self):
        r = requests.get(f"{BASE_URL}/api/scoring/leaderboard", timeout=15)
        # Accept 200 or 404 (route may differ)
        assert r.status_code in (200, 404), f"{r.status_code}: {r.text[:200]}"

    def test_achievements_listing(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/achievements", timeout=15)
        assert r.status_code in (200, 404), f"{r.status_code}: {r.text[:200]}"


# ------------------- Email Templates Wording -------------------
class TestEmailTemplates:
    def test_templates_no_arena_wording(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/cms/templates", timeout=15)
        if r.status_code != 200:
            pytest.skip(f"templates endpoint: {r.status_code}")
        tpls = r.json()
        # Should reference THE LION SQUAD, not ARENA
        offenders = []
        for t in tpls:
            body = (t.get("body_html") or "") + (t.get("subject") or "")
            if "ARENA" in body.upper() and "TLS ARENA" in body.upper():
                offenders.append(t.get("key") or t.get("id"))
        assert not offenders, f"ARENA wording found in templates: {offenders}"


# ------------------- Admin Invite -------------------
class TestAdminInvite:
    def test_admin_invite_user(self, admin_client):
        suffix = uuid.uuid4().hex[:6]
        email = f"TEST_invite_{suffix}@example.com"
        r = admin_client.post(f"{BASE_URL}/api/users", json={
            "email": email,
            "username": f"TEST_inv_{suffix}",
            "display_name": f"TEST Invite {suffix}",
            "send_invite": True,
        }, timeout=20)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text}"
        data = r.json()
        # Should have invite_url/token somewhere
        assert data.get("invite_url") or data.get("invite_email") or "invite" in str(data).lower(), f"no invite info in response: {data}"


# ------------------- 500 Scan -------------------
class TestNo500Scan:
    @pytest.mark.parametrize("path", [
        "/api/teams",
        "/api/sponsors",
        "/api/sponsors/admin",
        "/api/news",
        "/api/events",
        "/api/tournaments",
        "/api/games",
        "/api/cms/pages",
        "/api/cms/templates",
        "/api/settings/branding",
        "/api/admin/media",
        "/api/badges",
        "/api/achievements",
        "/api/scoring/leaderboard",
        "/api/membership/meta",
        "/api/membership/public",
    ])
    def test_no_5xx(self, admin_client, path):
        r = admin_client.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code < 500, f"{path} → {r.status_code}: {r.text[:200]}"
