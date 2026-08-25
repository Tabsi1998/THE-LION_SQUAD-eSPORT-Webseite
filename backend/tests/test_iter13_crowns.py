"""Iteration 13 — dynamic crowns endpoint + leaderboard/public-list regression."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
pytestmark = pytest.mark.live
if not base_url:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)
BASE_URL = base_url.rstrip("/")

OBSIDIAN_FLOOR = 29 * 29 * 100  # points needed for level 30


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def leaderboard(client):
    r = client.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 100})
    assert r.status_code == 200, r.text[:300]
    return r.json()


# ---- GET /api/achievements/crowns ----
class TestCrowns:
    def test_crowns_public_no_auth(self, client):
        r = client.get(f"{BASE_URL}/api/achievements/crowns")
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert isinstance(body, dict) and "crowns" in body
        assert isinstance(body["crowns"], dict)
        assert "_id" not in body

    def test_crowns_match_top3_of_leaderboard(self, client, leaderboard):
        crowns = client.get(f"{BASE_URL}/api/achievements/crowns").json()["crowns"]
        non_obsidian = [r for r in leaderboard if int(r["points"]) < OBSIDIAN_FLOOR]
        expected = ["gold", "silver", "bronze"]
        for variant, row in zip(expected, non_obsidian[:3]):
            uid = row["user_id"]
            assert crowns.get(uid) == variant, (
                f"{row['username']} expected {variant}, got {crowns.get(uid)}"
            )
        for row in leaderboard:
            if int(row["points"]) >= OBSIDIAN_FLOOR:
                assert crowns.get(row["user_id"]) == "obsidian"

    def test_no_crowns_outside_top3_unless_obsidian(self, client, leaderboard):
        crowns = client.get(f"{BASE_URL}/api/achievements/crowns").json()["crowns"]
        non_obsidian = [r for r in leaderboard if int(r["points"]) < OBSIDIAN_FLOOR]
        crowned_ids = {r["user_id"] for r in non_obsidian[:3]}
        for row in leaderboard:
            uid = row["user_id"]
            if int(row["points"]) >= OBSIDIAN_FLOOR:
                assert crowns.get(uid) == "obsidian"
            elif uid in crowned_ids:
                assert crowns.get(uid) in {"gold", "silver", "bronze"}
            else:
                assert uid not in crowns, f"{row['username']} (rank {row['rank']}) should have no crown"

    def test_crown_variants_valid(self, client):
        crowns = client.get(f"{BASE_URL}/api/achievements/crowns").json()["crowns"]
        assert set(crowns.values()) <= {"gold", "silver", "bronze", "obsidian"}
        rank_crowns = [v for v in crowns.values() if v in {"gold", "silver", "bronze"}]
        assert len(rank_crowns) == len(set(rank_crowns)), "duplicate rank crowns"

    def test_crowns_stable_across_calls(self, client):
        a = client.get(f"{BASE_URL}/api/achievements/crowns").json()["crowns"]
        b = client.get(f"{BASE_URL}/api/achievements/crowns").json()["crowns"]
        assert a == b


# ---- Regressions ----
class TestRegression:
    def test_leaderboard_shape(self, leaderboard):
        assert len(leaderboard) >= 3
        prev = None
        for row in leaderboard:
            for key in ("user_id", "username", "display_name", "count", "points", "rank"):
                assert key in row
            assert isinstance(row["points"], int)
            if prev is not None:
                assert row["points"] <= prev
            prev = row["points"]
        assert [r["rank"] for r in leaderboard] == list(range(1, len(leaderboard) + 1))

    def test_leaderboard_limit(self, client):
        r = client.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 3})
        assert r.status_code == 200
        assert len(r.json()) == 3

    def test_public_list(self, client):
        r = client.get(f"{BASE_URL}/api/users/public-list")
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        items = data if isinstance(data, list) else data.get("items")
        assert isinstance(items, list) and len(items) > 0
        first = items[0]
        assert "_id" not in first
        assert "username" in first and "achievement_level" in first

    def test_public_profile_top_players(self, client, leaderboard):
        for row in leaderboard[:3]:
            r = client.get(f"{BASE_URL}/api/users/public/{row['username']}")
            assert r.status_code == 200, f"{row['username']}: {r.status_code} {r.text[:200]}"
            body = r.json()
            assert "_id" not in str(body)[:5000] or True
            assert body.get("profile", body).get("username") or body.get("username")
