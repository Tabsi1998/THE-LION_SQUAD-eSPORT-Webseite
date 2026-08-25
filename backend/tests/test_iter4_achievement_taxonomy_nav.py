"""Iteration 4 — Achievement taxonomy rework (team/community categories) + nav Achievements link.

Covers:
  - GET /api/achievements/groups : new 'team' and 'community' categories, correct membership
  - CATEGORY_OVERRIDES unit-level consistency (achievement_catalog)
  - GET /api/nav : eSports dropdown contains an achievements child -> /achievements
  - Regression: /api/achievements/me (auth) still returns remapped categories
"""
import os
import sys

import pytest
import requests
from dotenv import dotenv_values

pytestmark = pytest.mark.live

sys.path.insert(0, "/app/backend")

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)
BASE_URL = base_url.rstrip("/")

PLAYER = {"email": "ace_racer@demo.lionsquad.at", "password": "DemoLion2026!!"}


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def player_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=PLAYER, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed: {r.status_code} {r.text[:300]}")
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf
    return s


@pytest.fixture(scope="module")
def groups(anon):
    r = anon.get(f"{BASE_URL}/api/achievements/groups", timeout=60)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert isinstance(data, list) and data
    return data


# ---------------- Taxonomy ----------------
class TestAchievementTaxonomy:
    def test_team_and_community_categories_exist(self, groups):
        cats = {g["category"] for g in groups}
        assert "team" in cats, f"missing 'team' category, got {sorted(cats)}"
        assert "community" in cats, f"missing 'community' category, got {sorted(cats)}"

    def test_team_group_membership(self, groups):
        by_code = {g["code"]: g for g in groups}
        for code in ("team_founder", "team_loyalty"):
            assert code in by_code, f"{code} missing from public catalog"
            assert by_code[code]["category"] == "team", (
                f"{code} category = {by_code[code]['category']}, expected 'team'"
            )
        names = {g["name"] for g in groups if g["category"] == "team"}
        assert "Team-Gründer" in names
        assert "Clan-Loyalität" in names

    def test_community_group_membership(self, groups):
        by_code = {g["code"]: g for g in groups}
        for code in ("discord_active", "community_helper"):
            assert code in by_code, f"{code} missing from public catalog"
            assert by_code[code]["category"] == "community", (
                f"{code} category = {by_code[code]['category']}, expected 'community'"
            )
        names = {g["name"] for g in groups if g["category"] == "community"}
        assert "Discord-Aktiv" in names
        assert "Community-Helfer" in names

    def test_no_team_or_community_group_left_under_club(self, groups):
        club_codes = {g["code"] for g in groups if g["category"] == "club"}
        leaked = club_codes & {"team_founder", "team_loyalty", "discord_active", "community_helper"}
        assert not leaked, f"still under 'club' (Verein): {leaked}"

    def test_club_category_still_has_membership_groups(self, groups):
        club_codes = {g["code"] for g in groups if g["category"] == "club"}
        assert "membership_tenure" in club_codes
        assert "event_attendance" in club_codes

    def test_no_mongo_id_and_tiers_present(self, groups):
        for g in groups:
            assert "_id" not in g
            assert isinstance(g.get("tiers"), list)
            for t in g["tiers"]:
                assert "_id" not in t
                assert t.get("level") in (1, 2, 3, 4, 5)

    def test_no_emoji_in_group_or_tier_names(self, groups):
        banned = "🥉🥈🥇💎★⭐🏆🔥"
        for g in groups:
            blob = f"{g.get('name','')}{g.get('description','')}"
            for t in g.get("tiers") or []:
                blob += f"{t.get('name','')}{t.get('level_name','') or ''}"
            hits = [ch for ch in banned if ch in blob]
            assert not hits, f"emoji {hits} found in group {g['code']}"

    def test_catalog_overrides_module_consistent(self):
        from achievement_catalog import (
            ACHIEVEMENT_GROUPS,
            CATEGORY_OVERRIDES,
            apply_category_overrides,
        )
        codes = {g["code"] for g in ACHIEVEMENT_GROUPS}
        unknown = set(CATEGORY_OVERRIDES) - codes
        assert not unknown, f"CATEGORY_OVERRIDES references unknown group codes: {unknown}"
        for g in ACHIEVEMENT_GROUPS:
            mapped = apply_category_overrides(g)
            expected = CATEGORY_OVERRIDES.get(g["code"], g["category"])
            assert mapped["category"] == expected
            # non-destructive
            assert g["category"] == ACHIEVEMENT_GROUPS[
                [x["code"] for x in ACHIEVEMENT_GROUPS].index(g["code"])
            ]["category"]

    def test_me_endpoint_uses_new_categories(self, player_client):
        r = player_client.get(f"{BASE_URL}/api/achievements/me", timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        by_code = {g["code"]: g for g in data.get("groups") or []}
        if "team_loyalty" in by_code:
            assert by_code["team_loyalty"]["category"] == "team"
        if "discord_active" in by_code:
            assert by_code["discord_active"]["category"] == "community"

    def test_me_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/achievements/me", timeout=30)
        assert r.status_code in (401, 403)


# ---------------- Nav ----------------
class TestNavAchievementsLink:
    @pytest.fixture(scope="class")
    def nav(self, anon):
        r = anon.get(f"{BASE_URL}/api/nav", timeout=30)
        assert r.status_code == 200, r.text[:300]
        return r.json()

    def test_esports_has_achievements_child(self, nav):
        esports = next((i for i in nav["items"] if i.get("key") == "esports"), None)
        assert esports, "eSports nav item missing"
        children = esports.get("children") or []
        match = [c for c in children if c.get("to") == "/achievements"]
        assert match, f"no /achievements child in eSports: {[c.get('to') for c in children]}"
        child = match[0]
        assert child.get("visible") is True
        assert "achievement" in (child.get("label") or "").lower()

    def test_nav_items_have_no_mongo_id(self, nav):
        for item in nav["items"]:
            assert "_id" not in item
            for child in item.get("children") or []:
                assert "_id" not in child


# ---------------- Regression ----------------
class TestRegression:
    @pytest.mark.parametrize("path", [
        "/api/achievements/leaderboard",
        "/api/tournaments",
        "/api/news",
        "/api/events",
        "/api/tournaments/ed1ec3cb-08b8-4ea3-8cd1-3da539e3a90f/bracket",
    ])
    def test_public_get_ok(self, anon, path):
        r = anon.get(f"{BASE_URL}{path}", timeout=60)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"

    def test_leaderboard_top1_ace_racer(self, anon):
        rows = anon.get(f"{BASE_URL}/api/achievements/leaderboard", timeout=60).json()
        assert rows[0]["username"] == "ace_racer"
        assert rows[0]["rank"] == 1
