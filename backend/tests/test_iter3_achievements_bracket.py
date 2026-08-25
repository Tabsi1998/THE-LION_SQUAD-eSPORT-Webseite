"""Iteration 3 — Achievements Showcase (leaderboard) + Live Bracket (public + TV display).

Covers:
  - GET /api/achievements/leaderboard  (public grind leaderboard)
  - GET /api/achievements/groups       (public catalog)
  - GET /api/achievements/me           (auth)
  - POST /api/achievements/evaluate    (auth, re-evaluate)
  - GET /api/tournaments/{id}/bracket          (public live bracket)
  - GET /api/tournaments/{id}/bracket/display  (TV board, moderator+)
  - public profile of leaderboard #1 (/api/users/public/{username} style route used by /u/{username})
"""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")

MK_TOURNAMENT_ID = "ed1ec3cb-08b8-4ea3-8cd1-3da539e3a90f"
ADMIN = {"email": "admin@lionsquad.at", "password": "LionSquad2026!Admin"}
PLAYER = {"email": "ace_racer@demo.lionsquad.at", "password": "DemoLion2026!!"}


def _login(creds):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf
    return s


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_client():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def player_client():
    return _login(PLAYER)


# ---------------- Achievements leaderboard ----------------
class TestAchievementsLeaderboard:
    def test_leaderboard_public_and_sorted(self, anon):
        try:
            r = anon.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 24}, timeout=45)
        except requests.exceptions.RequestException:
            r = anon.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 24}, timeout=45)
        assert r.status_code == 200, r.text[:300]
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 3, f"expected >=3 rows, got {len(rows)}"
        # ranks sequential from 1
        assert [row["rank"] for row in rows] == list(range(1, len(rows) + 1))
        # sorted desc by points
        pts = [row["points"] for row in rows]
        assert pts == sorted(pts, reverse=True)
        for row in rows:
            for key in ("user_id", "username", "display_name", "count", "points", "rank"):
                assert key in row, f"missing {key} in {row}"
            assert isinstance(row["points"], int)
            assert "_id" not in row

    def test_top1_is_ace_racer(self, anon):
        rows = anon.get(f"{BASE_URL}/api/achievements/leaderboard", timeout=30).json()
        assert rows[0]["username"] == "ace_racer", f"top1 = {rows[0]}"
        assert rows[0]["points"] > rows[1]["points"]

    def test_leaderboard_limit_respected(self, anon):
        rows = anon.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 3}, timeout=30).json()
        assert len(rows) == 3

    def test_leaderboard_limit_capped_and_sanitised(self, anon):
        r = anon.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 5000}, timeout=30)
        assert r.status_code == 200
        assert len(r.json()) <= 100
        r0 = anon.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 0}, timeout=30)
        assert r0.status_code == 200
        assert len(r0.json()) >= 1

    def test_leaderboard_entries_have_public_profiles(self, anon):
        rows = anon.get(f"{BASE_URL}/api/achievements/leaderboard", timeout=30).json()
        for row in rows[:5]:
            pr = anon.get(f"{BASE_URL}/api/users/{row['username']}/public", timeout=30)
            if pr.status_code == 404:
                pr = anon.get(f"{BASE_URL}/api/users/public/{row['username']}", timeout=30)
            assert pr.status_code == 200, (
                f"public profile for leaderboard entry {row['username']} not reachable: {pr.status_code}"
            )


class TestAchievementsCatalog:
    def test_groups_public(self, anon):
        r = anon.get(f"{BASE_URL}/api/achievements/groups", timeout=30)
        assert r.status_code == 200
        groups = r.json()
        assert isinstance(groups, list) and len(groups) > 3
        cats, tier_count, points = set(), 0, 0
        for g in groups:
            assert "code" in g and "name" in g and "tiers" in g
            assert "_id" not in g
            if g.get("is_negative"):
                continue
            cats.add(g["category"])
            for t in g["tiers"]:
                tier_count += 1
                points += int(t.get("points") or 0)
        assert tier_count > 10 and points > 0 and len(cats) >= 3

    def test_me_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/achievements/me", timeout=30)
        assert r.status_code in (401, 403)

    def test_me_returns_earned_for_demo_player(self, player_client):
        r = player_client.get(f"{BASE_URL}/api/achievements/me", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert "groups" in data and "awards" in data
        earned = [t for g in data["groups"] for t in (g.get("tiers") or []) if t.get("earned")]
        assert len(earned) > 0, "demo player ace_racer should have earned achievements"

    def test_evaluate_converges_to_zero(self, player_client):
        """Repeated evaluate must converge (no infinite re-award loop)."""
        last = None
        for _ in range(5):
            r = player_client.post(f"{BASE_URL}/api/achievements/evaluate", timeout=90)
            assert r.status_code == 200, r.text[:300]
            last = r.json()
            assert "newly_awarded" in last
            if last["newly_awarded"] == 0:
                break
        assert last["newly_awarded"] == 0, "evaluate keeps awarding new achievements every call"

    def test_evaluate_requires_auth(self, anon):
        r = anon.post(f"{BASE_URL}/api/achievements/evaluate", timeout=30)
        assert r.status_code in (401, 403)


# ---------------- Live bracket ----------------
class TestPublicBracket:
    def test_public_bracket_by_id_and_slug(self, anon):
        for ident in (MK_TOURNAMENT_ID, "mario-kart-winter-cup"):
            r = anon.get(f"{BASE_URL}/api/tournaments/{ident}/bracket", timeout=30)
            assert r.status_code == 200, f"{ident}: {r.status_code} {r.text[:200]}"
            data = r.json()
            matches = data.get("matches") or []
            assert len(matches) == 16, f"{ident}: expected 16 matches, got {len(matches)}"
            rounds = {m.get("round") for m in matches}
            assert len(rounds) >= 4, f"rounds={rounds}"
            assert any(m.get("status") == "completed" and m.get("winner_id") for m in matches), \
                "expected at least one completed match with a winner"

    def test_public_bracket_unknown_id_404(self, anon):
        r = anon.get(f"{BASE_URL}/api/tournaments/does-not-exist-xyz/bracket", timeout=30)
        assert r.status_code == 404

    def test_bracket_display_requires_auth(self, anon):
        r = anon.get(f"{BASE_URL}/api/tournaments/{MK_TOURNAMENT_ID}/bracket/display", timeout=30)
        assert r.status_code in (401, 403)

    def test_bracket_display_forbidden_for_plain_player(self, player_client):
        r = player_client.get(f"{BASE_URL}/api/tournaments/{MK_TOURNAMENT_ID}/bracket/display", timeout=30)
        assert r.status_code in (401, 403), f"plain player should not read TV board, got {r.status_code}"

    def test_bracket_display_for_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/tournaments/{MK_TOURNAMENT_ID}/bracket/display", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        matches = data.get("matches") or []
        assert len(matches) == 16
        for m in matches[:5]:
            assert "_id" not in m
            assert "round" in m and "status" in m


# ---------------- Regression: public pages data ----------------
class TestRegressionEndpoints:
    @pytest.mark.parametrize("path", [
        "/api/tournaments",
        "/api/news",
        "/api/events",
        f"/api/tournaments/{MK_TOURNAMENT_ID}",
        f"/api/tournaments/{MK_TOURNAMENT_ID}/standings",
    ])
    def test_public_get_ok(self, anon, path):
        r = anon.get(f"{BASE_URL}{path}", timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
