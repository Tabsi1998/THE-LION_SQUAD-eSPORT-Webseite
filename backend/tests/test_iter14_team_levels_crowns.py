"""Iteration 14 — team level system, team achievements, crown transition notifications."""
import os
import re
import time
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
pytestmark = pytest.mark.live
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)

UA = "Mozilla/5.0 (X11; Linux x86_64) TLSIter14Agent/1.0"
DEMO_PASSWORD = "DemoLion2026!!"
TMP_TIER = "tmp_agent_crown"
EXPECTED_TEAM_ACH = [
    "team_founded", "team_roster_3", "team_roster_5",
    "team_points_500", "team_points_2500", "team_points_10000",
    "team_tournament_1", "team_tournament_3", "team_champion",
    "team_level_5", "team_level_10", "team_level_20",
]


def _creds():
    content = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    email = re.search(r"(?im)^-\s*Email:\s*(\S+)", content)
    pwd = re.search(r"(?im)^-\s*Password:\s*(\S+)", content)
    if not email or not pwd:
        pytest.skip("credentials file unreadable")
    return email.group(1), pwd.group(1)


ADMIN_EMAIL, ADMIN_PASSWORD = _creds()


def _session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL, "User-Agent": UA})
    return s


def _login(email, password):
    s = _session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=60)
    assert r.status_code == 200, f"login {email} failed {r.status_code}: {r.text[:300]}"
    return s


def _csrf(s):
    token = s.cookies.get("csrf_token")
    assert token, "csrf_token cookie missing"
    return {"X-CSRF-Token": token}


@pytest.fixture(scope="module")
def client():
    return _session()


@pytest.fixture(scope="module")
def admin():
    s = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    yield s
    try:
        s.post(f"{BASE_URL}/api/auth/logout", headers=_csrf(s), timeout=30)
    except Exception:
        pass


# ---- GET /api/teams/levels ----
class TestTeamLevels:
    def test_levels_all_teams(self, client):
        teams = client.get(f"{BASE_URL}/api/teams", timeout=60)
        assert teams.status_code == 200, teams.text[:300]
        team_list = teams.json() if isinstance(teams.json(), list) else teams.json().get("items", [])
        r = client.get(f"{BASE_URL}/api/teams/levels", timeout=60)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert "levels" in body and isinstance(body["levels"], dict)
        assert "_id" not in str(body)
        assert len(body["levels"]) == len(team_list), (
            f"levels for {len(body['levels'])} teams vs {len(team_list)} teams"
        )
        for tid, v in body["levels"].items():
            assert set(v.keys()) == {"level", "points", "progress"}
            assert isinstance(v["level"], int) and v["level"] >= 1
            assert isinstance(v["points"], int) and v["points"] >= 0
            assert 0 <= v["progress"] <= 100
            # curve: level = smallest L with points < L^2*100
            lvl = v["level"]
            assert (lvl - 1) ** 2 * 100 <= v["points"] < lvl ** 2 * 100

    def test_level_detail_matches_summary(self, client):
        levels = client.get(f"{BASE_URL}/api/teams/levels", timeout=60).json()["levels"]
        assert levels
        for tid, summary in levels.items():
            r = client.get(f"{BASE_URL}/api/teams/{tid}/level", timeout=60)
            assert r.status_code == 200, r.text[:300]
            d = r.json()
            for key in ("member_points", "tournament_points", "tournaments", "wins",
                        "achievements", "level", "points", "progress", "member_count",
                        "current_level_points", "next_level_points"):
                assert key in d, f"missing {key} in team level detail"
            assert d["level"] == summary["level"]
            assert d["points"] == summary["points"]
            assert d["points"] == d["member_points"] + d["tournament_points"]
            codes = [a["code"] for a in d["achievements"]]
            assert codes == EXPECTED_TEAM_ACH
            for a in d["achievements"]:
                assert set(("code", "name", "description", "icon", "earned")) <= set(a.keys())
                assert isinstance(a["earned"], bool)
            earned = {a["code"] for a in d["achievements"] if a["earned"]}
            assert "team_founded" in earned
            assert ("team_points_500" in earned) == (d["points"] >= 500)
            assert ("team_level_10" in earned) == (d["level"] >= 10)
            assert ("team_tournament_1" in earned) == (d["tournaments"] >= 1)
            assert ("team_champion" in earned) == (d["wins"] >= 1)

    def test_level_detail_unknown_team_404(self, client):
        r = client.get(f"{BASE_URL}/api/teams/does-not-exist-1234/level", timeout=60)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text[:200]}"
        assert "detail" in r.json()

    def test_levels_route_precedence(self, client):
        """'levels' must not be swallowed by /{team_id}."""
        r = client.get(f"{BASE_URL}/api/teams/levels", timeout=60)
        assert r.status_code == 200
        assert "levels" in r.json()


# ---- GET /api/achievements/crowns regression ----
class TestCrownsRegression:
    def test_crowns_shape(self, client):
        r = client.get(f"{BASE_URL}/api/achievements/crowns", timeout=60)
        assert r.status_code == 200, r.text[:300]
        crowns = r.json()["crowns"]
        assert set(crowns.values()) <= {"gold", "silver", "bronze", "obsidian"}
        ranks = [v for v in crowns.values() if v != "obsidian"]
        assert sorted(ranks) == sorted(set(ranks)), "duplicate rank crowns"

    def test_leaderboard_ok(self, client):
        r = client.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 10}, timeout=60)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 5
        assert rows[0]["points"] >= rows[-1]["points"]


# ---- Crown transition: award/revoke temp tier and verify notifications ----
class TestCrownTransition:
    def test_transition_creates_exactly_one_pair_each_way(self, client, admin):
        # cleanup any leftovers first
        admin.delete(f"{BASE_URL}/api/admin/achievements/tiers/{TMP_TIER}", headers=_csrf(admin), timeout=30)

        board = client.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 10}, timeout=60).json()
        crowns_before = client.get(f"{BASE_URL}/api/achievements/crowns", timeout=60).json()["crowns"]
        old_bronze = [uid for uid, v in crowns_before.items() if v == "bronze"]
        assert old_bronze, "no bronze holder to displace"
        old_bronze = old_bronze[0]
        target = next(r for r in board if r["user_id"] not in crowns_before)
        target_id = target["user_id"]
        bronze_points = next(r["points"] for r in board if r["user_id"] == old_bronze)
        tmp_points = max(bronze_points - target["points"] + 5000, 1000)

        created_tier = False
        awarded = False
        try:
            r = admin.post(
                f"{BASE_URL}/api/admin/achievements/tiers",
                headers=_csrf(admin), timeout=60,
                json={"code": TMP_TIER, "group_code": "match_master", "level": 5,
                      "name": "TEST_Agent Crown", "description": "TEST temp tier",
                      "points": tmp_points, "manual_only": True},
            )
            assert r.status_code in (200, 201), f"tier create {r.status_code}: {r.text[:300]}"
            created_tier = True

            r = admin.post(f"{BASE_URL}/api/admin/achievements/award", headers=_csrf(admin), timeout=60,
                           json={"user_id": target_id, "tier_code": TMP_TIER, "note": "TEST_agent"})
            assert r.status_code == 200, f"award {r.status_code}: {r.text[:300]}"
            awarded = True

            time.sleep(6)
            client.get(f"{BASE_URL}/api/achievements/crowns", timeout=60)
            crowns_after = client.get(f"{BASE_URL}/api/achievements/crowns", timeout=60).json()["crowns"]
            assert crowns_after.get(target_id) in {"gold", "silver", "bronze"}, (
                f"target has no crown after award: {crowns_after.get(target_id)}"
            )
            assert crowns_after.get(old_bronze) is None, "old bronze holder still crowned"

            gained = _crown_notifs(target["username"], "crown_gained")
            lost = _crown_notifs(_username_for(client, board, old_bronze), "crown_lost")
            assert len(gained) >= 1, "winner got no crown_gained notification"
            assert len(lost) >= 1, "displaced holder got no crown_lost notification"
            v_gained = _versions(gained)
            v_lost = _versions(lost)
            assert v_gained, f"dedupe_key missing/invalid in {gained[0]}"
            assert len(v_gained) == len(set(v_gained)), f"duplicate crown_gained per version: {v_gained}"
            assert len(v_lost) == len(set(v_lost)), f"duplicate crown_lost per version: {v_lost}"
            latest_gained_v = max(v_gained)
            latest_lost_v = max(v_lost)
            assert latest_gained_v == latest_lost_v, (
                f"gained/lost not from same crown version: {latest_gained_v} vs {latest_lost_v}"
            )
            assert sum(1 for v in v_gained if v == latest_gained_v) == 1, "duplicate notification for same version"
        finally:
            if awarded:
                admin.delete(f"{BASE_URL}/api/admin/achievements/award", headers=_csrf(admin), timeout=60,
                             json={"user_id": target_id, "tier_code": TMP_TIER})
            if created_tier:
                admin.delete(f"{BASE_URL}/api/admin/achievements/tiers/{TMP_TIER}",
                             headers=_csrf(admin), timeout=60)

        # back-transition
        time.sleep(6)
        client.get(f"{BASE_URL}/api/achievements/crowns", timeout=60)
        crowns_final = client.get(f"{BASE_URL}/api/achievements/crowns", timeout=60).json()["crowns"]
        assert crowns_final.get(old_bronze) == "bronze", (
            f"old bronze not restored: {crowns_final.get(old_bronze)}"
        )
        assert target_id not in crowns_final, "temp winner still crowned after revoke"

        lost_after = _crown_notifs(target["username"], "crown_lost")
        regained = _crown_notifs(_username_for(client, board, old_bronze), "crown_gained")
        assert lost_after, "temp winner got no crown_lost after revoke"
        assert regained, "restored holder got no crown_gained"
        for notifs in (lost_after, regained):
            vs = _versions(notifs)
            assert len(vs) == len(set(vs)), f"duplicate notifications per version: {vs}"

    def test_temp_tier_cleaned_up(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/achievements/tiers", timeout=60)
        assert r.status_code == 200
        data = r.json()
        tiers = data if isinstance(data, list) else data.get("items", data.get("tiers", []))
        codes = {t.get("code") for t in tiers}
        assert TMP_TIER not in codes, "temporary test tier still present"


# ---- Concurrent achievement evaluation must not 500 (DuplicateKeyError race) ----
class TestConcurrentEvaluate:
    def test_parallel_evaluate_and_profile_completeness(self):
        import concurrent.futures

        s = _login("leon_king@demo.lionsquad.at", DEMO_PASSWORD)
        headers = _csrf(s)

        def call(i):
            if i % 2:
                return s.post(f"{BASE_URL}/api/achievements/evaluate", headers=headers, timeout=60).status_code
            return s.get(f"{BASE_URL}/api/users/me/profile-completeness", timeout=60).status_code

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            codes = list(ex.map(call, range(12)))
        try:
            s.post(f"{BASE_URL}/api/auth/logout", headers=headers, timeout=30)
        except Exception:
            pass
        assert all(c == 200 for c in codes), f"non-200 responses under concurrency: {codes}"


def _username_for(client, board, user_id):
    for row in board:
        if row["user_id"] == user_id:
            return row["username"]
    r = client.get(f"{BASE_URL}/api/achievements/leaderboard", params={"limit": 100}, timeout=60).json()
    for row in r:
        if row["user_id"] == user_id:
            return row["username"]
    pytest.fail(f"username for {user_id} not found on leaderboard")


def _crown_notifs(username, kind):
    s = _login(f"{username}@demo.lionsquad.at", DEMO_PASSWORD)
    try:
        r = s.get(f"{BASE_URL}/api/notifications/me", params={"limit": 100}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", [])
        return [n for n in items if n.get("kind") == kind]
    finally:
        try:
            s.post(f"{BASE_URL}/api/auth/logout", headers=_csrf(s), timeout=30)
        except Exception:
            pass


def _versions(notifs):
    out = []
    for n in notifs:
        key = (n.get("meta") or {}).get("dedupe_key") or ""
        m = re.match(r"^crown-v(\d+)-", key)
        if m:
            out.append(int(m.group(1)))
    return out
