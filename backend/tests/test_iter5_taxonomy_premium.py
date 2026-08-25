"""Iteration 5 — Achievement taxonomy re-categorisation + bracket display regression."""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"
TOURNAMENT_ID = "ed1ec3cb-08b8-4ea3-8cd1-3da539e3a90f"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_credentials():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing test_credentials.md")
    txt = p.read_text(encoding="utf-8")
    email = re.search(r"(?im)^\s*-\s*Email:\s*(\S+)", txt)
    password = re.search(r"(?im)^\s*-\s*Password:\s*(\S+)", txt)
    if not email or not password:
        pytest.skip("credentials not parseable")
    return {"email": email.group(1), "password": password.group(1)}


@pytest.fixture(scope="session")
def admin_client(admin_credentials):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json=admin_credentials, timeout=45)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:300]}")
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf
    return s


@pytest.fixture(scope="session")
def groups(client):
    r = client.get(f"{API}/achievements/groups", timeout=45)
    assert r.status_code == 200, r.text[:400]
    data = r.json()
    items = data if isinstance(data, list) else (data.get("groups") or data.get("items") or [])
    assert items, f"no groups returned: {str(data)[:300]}"
    return items


# ---------- TAXONOMY ----------
class TestTaxonomy:
    def test_streaming_groups_are_content(self, groups):
        by_code = {g["code"]: g for g in groups}
        for code in ("stream_growth", "streamer_path", "creator_spirit"):
            assert code in by_code, f"{code} missing from catalog"
            assert by_code[code]["category"] == "content", (
                f"{code} category={by_code[code]['category']} expected content"
            )

    def test_progression_groups(self, groups):
        by_code = {g["code"]: g for g in groups}
        expected = ["level_progression", "achievement_collector", "platform_identity",
                    "profile_completeness", "platform_diversity"]
        for code in expected:
            if code in by_code:
                assert by_code[code]["category"] == "progression", \
                    f"{code} category={by_code[code]['category']}"
        prog = [g["code"] for g in groups if g["category"] == "progression"]
        assert "level_progression" in prog and "achievement_collector" in prog

    def test_community_groups(self, groups):
        by_code = {g["code"]: g for g in groups}
        for code in ("social_network", "platform_chat", "mentor_path", "community_presence",
                     "discord_active", "community_helper"):
            if code in by_code:
                assert by_code[code]["category"] == "community", \
                    f"{code} category={by_code[code]['category']}"

    def test_club_only_membership_groups(self, groups):
        club = sorted(g["code"] for g in groups if g["category"] == "club")
        assert club == ["event_attendance", "membership_tenure"], f"club groups={club}"

    def test_team_category(self, groups):
        team = sorted(g["code"] for g in groups if g["category"] == "team")
        assert "team_founder" in team and "team_loyalty" in team, f"team={team}"

    def test_all_categories_known(self, groups):
        allowed = {"match", "tournament", "fastlap", "team", "community", "content",
                   "progression", "club", "special", "negative"}
        found = {g["category"] for g in groups}
        assert found <= allowed, f"unexpected categories: {found - allowed}"

    def test_no_emoji_in_group_metadata(self, groups):
        emoji = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF]")
        bad = [g["code"] for g in groups
               if emoji.search(g.get("name", "") + (g.get("description") or ""))]
        assert not bad, f"emoji found in {bad}"


# ---------- ANONYMOUS ACCESS ----------
class TestAnonymousAccess:
    def test_groups_public(self, client):
        r = client.get(f"{API}/achievements/groups", timeout=45)
        assert r.status_code == 200

    def test_me_requires_auth(self, client):
        r = client.get(f"{API}/achievements/me", timeout=45)
        assert r.status_code in (401, 403), r.status_code

    def test_leaderboard_public(self, client):
        r = client.get(f"{API}/achievements/leaderboard", timeout=45)
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, (list, dict))


# ---------- BRACKET DISPLAY (TV clip source data) ----------
class TestBracketDisplay:
    def test_bracket_display_returns_matches(self, admin_client):
        r = admin_client.get(f"{API}/tournaments/{TOURNAMENT_ID}/bracket/display", timeout=45)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        matches = (data.get("matches") or []) + (data.get("matches_v2") or [])
        assert len(matches) >= 8, f"only {len(matches)} matches"
        assert data.get("tournament", {}).get("id") == TOURNAMENT_ID

    def test_densest_round_has_six_or_more_matches(self, admin_client):
        r = admin_client.get(f"{API}/tournaments/{TOURNAMENT_ID}/bracket/display", timeout=45)
        data = r.json()
        all_matches = (data.get("matches") or []) + (data.get("matches_v2") or [])
        rounds = {}
        for m in all_matches:
            rounds.setdefault(int(m.get("round") or 1), []).append(m)
        assert rounds, "no rounds"
        densest = max(rounds.values(), key=len)
        assert len(densest) >= 6, f"densest round only {len(densest)} matches"

    def test_public_bracket_by_slug(self, client):
        r = client.get(f"{API}/tournaments/mario-kart-winter-cup/bracket", timeout=45)
        assert r.status_code == 200, r.text[:300]


# ---------- AUTH + PROFILE LEVEL ----------
class TestAuthAndLevel:
    def test_admin_achievements_me(self, admin_client):
        me = admin_client.get(f"{API}/achievements/me", timeout=60)
        assert me.status_code == 200, me.text[:300]
        assert '"_id"' not in me.text[:5000]

    def test_public_profile_ace_racer(self, client):
        r = client.get(f"{API}/users/public/ace_racer", timeout=45)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        body = r.json()
        assert "_id" not in body
