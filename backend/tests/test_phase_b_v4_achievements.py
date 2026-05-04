"""Phase B v4 — Achievement system end-to-end tests.
Covers public + admin endpoints, group/tier CRUD, manual award/revoke,
negative-privacy, and user-search.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PASS = "TLSAdmin2026!"


@pytest.fixture(scope="session")
def admin_login():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def admin_token(admin_login):
    return admin_login["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_id(admin_login):
    return admin_login["id"]


# ---------------- Public endpoints ----------------
class TestPublicCatalog:
    def test_groups_anonymous_excludes_negative(self):
        r = requests.get(f"{BASE_URL}/api/achievements/groups", timeout=15)
        assert r.status_code == 200
        groups = r.json()
        assert isinstance(groups, list)
        assert len(groups) >= 30, f"expected >=30 public groups, got {len(groups)}"
        # NO negative group must appear
        for g in groups:
            assert g.get("is_negative") is not True, f"negative group leaked: {g['code']}"
        # tiers are nested
        any_tiers = any(len(g.get("tiers", [])) > 0 for g in groups)
        assert any_tiers, "no tiers nested in any group"

    def test_groups_anonymous_count_matches_spec(self):
        r = requests.get(f"{BASE_URL}/api/achievements/groups", timeout=15)
        assert r.status_code == 200
        public_count = len(r.json())
        # spec says "34 Groups" public (39 total - 5 negative)
        assert public_count == 34, f"expected 34 public groups, got {public_count}"

    def test_user_achievements_anonymous_admin_profile(self, admin_id):
        r = requests.get(f"{BASE_URL}/api/achievements/user/{admin_id}", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "groups" in data and "awards" in data
        # No negative groups exposed
        for g in data["groups"]:
            assert g.get("is_negative") is not True
        # Award count: spec says 3 (Ehrenlöwe + Multi-Plattform + Im Rudel Bronze)
        award_codes = [a["code"] for a in data["awards"]]
        assert len(data["awards"]) >= 3, f"expected >=3 awards for admin, got {len(data['awards'])}: {award_codes}"
        # No negative awards leak
        for a in data["awards"]:
            assert a.get("group_category") != "negative"

    def test_user_404_unknown(self):
        r = requests.get(f"{BASE_URL}/api/achievements/user/unknown-id-xxx", timeout=15)
        assert r.status_code == 404


class TestMyAchievements:
    def test_me_returns_groups_and_awards(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/achievements/me", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "groups" in data and "awards" in data
        # admin should have at least Ehrenlöwe + multi_platform + im_rudel_b
        award_codes = {a["code"] for a in data["awards"]}
        # Spec: Ehrenlöwe + Multi-Plattform + Im Rudel Bronze
        assert len(award_codes) >= 3, f"expected >=3 awards for admin/me, got {len(award_codes)}: {award_codes}"

    def test_evaluate_endpoint_self(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/achievements/evaluate", headers=admin_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "newly_awarded" in data
        assert isinstance(data["newly_awarded"], int)


# ---------------- Admin endpoints ----------------
class TestAdminGroups:
    def test_admin_groups_includes_negative(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/achievements/groups", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        groups = r.json()
        assert len(groups) == 39, f"expected 39 admin groups, got {len(groups)}"
        neg = [g for g in groups if g.get("is_negative")]
        assert len(neg) == 5, f"expected 5 negative groups, got {len(neg)}"
        special = [g for g in groups if g.get("is_special")]
        assert len(special) >= 5

    def test_admin_groups_unauthorized(self):
        r = requests.get(f"{BASE_URL}/api/admin/achievements/groups", timeout=15)
        assert r.status_code in (401, 403)

    def test_create_patch_delete_custom_group(self, admin_headers):
        code = "TEST_custom_grp"
        # cleanup if remnant
        requests.delete(f"{BASE_URL}/api/admin/achievements/groups/{code}", headers=admin_headers, timeout=15)
        # CREATE
        r = requests.post(f"{BASE_URL}/api/admin/achievements/groups", headers=admin_headers, json={
            "code": code, "name": "TEST Custom Group", "category": "special",
            "icon": "star", "accent_color": "#123456", "description": "test",
            "public": True, "is_special": True, "is_negative": False, "sort_order": 999,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["is_admin_created"] is True
        # PATCH
        r = requests.patch(f"{BASE_URL}/api/admin/achievements/groups/{code}", headers=admin_headers,
                           json={"name": "TEST Renamed"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST Renamed"
        # DELETE
        r = requests.delete(f"{BASE_URL}/api/admin/achievements/groups/{code}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # verify gone
        r = requests.get(f"{BASE_URL}/api/admin/achievements/groups", headers=admin_headers, timeout=15)
        assert code not in [g["code"] for g in r.json()]

    def test_delete_system_group_blocked(self, admin_headers):
        # match_master is seeded → must NOT be deletable
        r = requests.delete(f"{BASE_URL}/api/admin/achievements/groups/match_master",
                            headers=admin_headers, timeout=15)
        assert r.status_code == 400, f"system group must be protected, got {r.status_code}"


class TestAdminTiers:
    def test_list_tiers_for_match_master(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/achievements/tiers?group_code=match_master",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        tiers = r.json()
        assert len(tiers) == 4, f"expected 4 match_master tiers, got {len(tiers)}"

    def test_create_patch_delete_tier(self, admin_headers):
        code = "TEST_tier_xyz"
        # cleanup remnant
        requests.delete(f"{BASE_URL}/api/admin/achievements/tiers/{code}", headers=admin_headers, timeout=15)
        # CREATE
        r = requests.post(f"{BASE_URL}/api/admin/achievements/tiers", headers=admin_headers, json={
            "code": code, "group_code": "match_master", "level": 1,
            "name": "TEST Tier", "description": "x", "progress_target": 5, "points": 5,
        }, timeout=15)
        assert r.status_code == 200, r.text
        # PATCH progress target
        r = requests.patch(f"{BASE_URL}/api/admin/achievements/tiers/{code}", headers=admin_headers,
                           json={"progress_target": 7}, timeout=15)
        assert r.status_code == 200
        assert r.json()["progress_target"] == 7
        # DELETE
        r = requests.delete(f"{BASE_URL}/api/admin/achievements/tiers/{code}", headers=admin_headers, timeout=15)
        assert r.status_code == 200


# ---------------- Manual award / revoke ----------------
class TestAdminAwardManual:
    def test_award_revoke_flow(self, admin_headers, admin_id):
        # award: gamers_heaven_p (Special-tier in Plattformen group)
        # revoke if pre-existed
        requests.delete(f"{BASE_URL}/api/admin/achievements/award", headers=admin_headers,
                        json={"user_id": admin_id, "tier_code": "gamers_heaven_p"}, timeout=15)
        r = requests.post(f"{BASE_URL}/api/admin/achievements/award", headers=admin_headers,
                          json={"user_id": admin_id, "tier_code": "gamers_heaven_p", "note": "TEST"},
                          timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        # verify in /me
        r2 = requests.get(f"{BASE_URL}/api/achievements/me", headers=admin_headers, timeout=15)
        codes = {a["code"] for a in r2.json()["awards"]}
        assert "gamers_heaven_p" in codes
        # revoke
        r3 = requests.delete(f"{BASE_URL}/api/admin/achievements/award", headers=admin_headers,
                             json={"user_id": admin_id, "tier_code": "gamers_heaven_p"}, timeout=15)
        assert r3.status_code == 200
        # verify gone
        r4 = requests.get(f"{BASE_URL}/api/achievements/me", headers=admin_headers, timeout=15)
        codes = {a["code"] for a in r4.json()["awards"]}
        assert "gamers_heaven_p" not in codes

    def test_award_unknown_user(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/admin/achievements/award", headers=admin_headers,
                          json={"user_id": "nope-id", "tier_code": "gamers_heaven_p"}, timeout=15)
        assert r.status_code == 404

    def test_award_unknown_tier(self, admin_headers, admin_id):
        r = requests.post(f"{BASE_URL}/api/admin/achievements/award", headers=admin_headers,
                          json={"user_id": admin_id, "tier_code": "unknown_xxx"}, timeout=15)
        assert r.status_code == 404


# ---------------- Negative awards privacy ----------------
class TestNegativePrivacy:
    NEG_TIER = None  # discovered below

    @pytest.fixture(scope="class")
    def negative_tier_code(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/achievements/groups", headers=admin_headers, timeout=15)
        neg_groups = [g["code"] for g in r.json() if g.get("is_negative")]
        assert neg_groups, "no negative groups seeded"
        # Find a tier inside first negative group
        for gc in neg_groups:
            r2 = requests.get(f"{BASE_URL}/api/admin/achievements/tiers?group_code={gc}",
                              headers=admin_headers, timeout=15)
            tiers = r2.json()
            if tiers:
                return tiers[0]["code"]
        pytest.skip("no tiers under negative groups")

    def test_negative_award_hidden_from_public_profile(self, admin_headers, admin_id, negative_tier_code):
        # Award negative tier to admin
        r = requests.post(f"{BASE_URL}/api/admin/achievements/award", headers=admin_headers,
                          json={"user_id": admin_id, "tier_code": negative_tier_code, "note": "TEST_neg"},
                          timeout=15)
        assert r.status_code == 200, r.text
        try:
            # 1) anonymous /user/{id} must NOT see it
            r1 = requests.get(f"{BASE_URL}/api/achievements/user/{admin_id}", timeout=15)
            assert r1.status_code == 200
            assert negative_tier_code not in [a["code"] for a in r1.json()["awards"]]
            # group must also be hidden
            assert all(g.get("is_negative") is not True for g in r1.json()["groups"])

            # 2) admin viewing /user/{id} should also NOT see negative in awards (privacy spec)
            r2 = requests.get(f"{BASE_URL}/api/achievements/user/{admin_id}",
                              headers=admin_headers, timeout=15)
            assert r2.status_code == 200
            adm_codes = [a["code"] for a in r2.json()["awards"]]
            # Spec note: even admin self-view via this endpoint should NOT show negative
            # It is OK however that admin /achievements/me includes them — this is the admin's own dashboard.
            assert negative_tier_code not in adm_codes, \
                f"negative leaked in /user/{{id}} for admin viewer: {adm_codes}"

            # 3) negative inbox must list it
            r3 = requests.get(f"{BASE_URL}/api/admin/achievements/negative/awards",
                              headers=admin_headers, timeout=15)
            assert r3.status_code == 200
            assert negative_tier_code in [a["tier_code"] for a in r3.json()]
        finally:
            requests.delete(f"{BASE_URL}/api/admin/achievements/award", headers=admin_headers,
                            json={"user_id": admin_id, "tier_code": negative_tier_code}, timeout=15)


# ---------------- User search ----------------
class TestUserSearch:
    def test_search_admin(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/admin/achievements/users/search?q=admin",
                         headers=admin_headers, timeout=15)
        assert r.status_code == 200
        users = r.json()
        assert any(u.get("email") == ADMIN_EMAIL or u.get("username") for u in users)


# ---------------- Old route gone ----------------
class TestOldBadgesRouteGone:
    def test_old_badges_endpoint_404(self):
        # Backend no longer ships /api/badges
        r = requests.get(f"{BASE_URL}/api/badges", timeout=15)
        assert r.status_code in (404, 405), f"old route still alive: {r.status_code}"
