"""TLS Arena backend tests - covers auth, games, tournaments, F1, matches, admin, role enforcement."""
import time
import pytest
import requests
from conftest import BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_EMAIL, DEMO_PASSWORD


def _login_session(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        return None
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ============= AUTH =============
class TestAuth:
    def test_register_login_me_logout(self, api):
        suffix = str(int(time.time() * 1000))
        email = f"test_user_{suffix}@example.com"
        username = f"tuser_{suffix}"[:30]
        r = api.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "username": username, "password": "secret123",
            "display_name": "Test User", "accept_privacy": True,
        })
        assert r.status_code in (200, 201), r.text
        data = r.json()
        user = data.get("user") or data
        assert user.get("email", "").lower() == email
        token = data.get("access_token") or data.get("token")
        if token:
            api.headers.update({"Authorization": f"Bearer {token}"})
        # /me
        me = api.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200, me.text
        me_data = me.json()
        assert me_data.get("email", "").lower() == email
        assert me_data.get("role") == "player"
        # Logout
        out = api.post(f"{BASE_URL}/api/auth/logout")
        assert out.status_code in (200, 204)

    def test_admin_login_returns_superadmin(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        user = r.json().get("user") or r.json()
        assert user.get("role") == "superadmin"

    def test_demo_player_login(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
        assert r.status_code == 200, r.text
        user = r.json().get("user") or r.json()
        assert user.get("role") == "player"

    def test_login_wrong_password(self, api):
        r = api.post(f"{BASE_URL}/api/auth/login",
                     json={"email": DEMO_EMAIL, "password": "wrong_pw_xyz"})
        assert r.status_code in (400, 401, 403)


# ============= GAMES =============
class TestGames:
    def test_list_games_returns_six(self, api):
        r = api.get(f"{BASE_URL}/api/games")
        assert r.status_code == 200
        games = r.json()
        assert isinstance(games, list)
        assert len(games) >= 6, f"Expected >=6 games, got {len(games)}"

    def test_create_game_unauthenticated_401(self, api):
        r = api.post(f"{BASE_URL}/api/games", json={
            "name": "test_game_anon", "slug": f"test-game-anon-{int(time.time())}",
        })
        assert r.status_code == 401

    def test_create_game_player_403(self, player_client):
        r = player_client.post(f"{BASE_URL}/api/games", json={
            "name": "test_game_p", "slug": f"test-game-p-{int(time.time())}",
        })
        assert r.status_code == 403

    def test_create_game_superadmin_201(self, admin_client):
        slug = f"test-game-a-{int(time.time())}"
        r = admin_client.post(f"{BASE_URL}/api/games", json={
            "name": "test_game_admin", "slug": slug,
        })
        assert r.status_code in (200, 201), r.text
        gid = r.json().get("id")
        if gid:
            admin_client.delete(f"{BASE_URL}/api/games/{gid}")


# ============= TOURNAMENTS =============
class TestTournaments:
    def test_list_tournaments(self, api):
        r = api.get(f"{BASE_URL}/api/tournaments")
        assert r.status_code == 200
        tours = r.json()
        slugs = {t.get("slug") for t in tours}
        assert "mario-kart-winter-cup" in slugs
        assert "smash-showdown-q1" in slugs

    def test_get_mario_kart_with_participants(self, api):
        r = api.get(f"{BASE_URL}/api/tournaments/mario-kart-winter-cup")
        assert r.status_code == 200, r.text
        t = r.json()
        assert t.get("slug") == "mario-kart-winter-cup"
        assert t.get("participant_count") == 16
        assert t.get("game") is not None

    def test_generate_bracket_single_elim_16(self, admin_client, api):
        # Get tournament UUID (slug not supported by generate-bracket)
        t = api.get(f"{BASE_URL}/api/tournaments/mario-kart-winter-cup").json()
        tid = t["id"]
        r = admin_client.post(f"{BASE_URL}/api/tournaments/{tid}/generate-bracket")
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body.get("match_count", 0) >= 15, f"match_count={body}"

        # Get bracket
        b = admin_client.get(f"{BASE_URL}/api/tournaments/{tid}/bracket")
        assert b.status_code == 200
        bracket = b.json()
        matches = bracket.get("matches", [])
        # Single elim 16 = 15 matches + 1 bronze = 16
        assert len(matches) >= 15, f"got {len(matches)} matches"
        # Round 1 should have 8 matches
        r1 = [m for m in matches if m.get("round") == 1]
        assert len(r1) == 8, f"R1 expected 8, got {len(r1)}"
        # Each R1 match has both participants
        populated = sum(1 for m in r1 if m.get("participant_a_id") and m.get("participant_b_id"))
        assert populated == 8, f"R1 fully populated: {populated}/8"

    def test_register_and_checkin(self, api):
        # Create new test user
        suffix = str(int(time.time() * 1000))
        email = f"test_reg_{suffix}@example.com"
        username = f"treg_{suffix}"[:30]
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        rr = s.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "username": username, "password": "secret123",
            "accept_privacy": True,
        })
        assert rr.status_code in (200, 201), rr.text
        token = rr.json().get("access_token") or rr.json().get("token")
        if token:
            s.headers.update({"Authorization": f"Bearer {token}"})

        # Get tournament UUID (register endpoint uses tid only)
        t = s.get(f"{BASE_URL}/api/tournaments/smash-showdown-q1").json()
        tid = t["id"]
        r = s.post(f"{BASE_URL}/api/tournaments/{tid}/register", json={})
        assert r.status_code in (200, 201), r.text
        reg = r.json()
        assert reg.get("status") == "approved", f"status={reg.get('status')}"

        ci = s.post(f"{BASE_URL}/api/tournaments/{tid}/checkin")
        assert ci.status_code in (200, 201), ci.text


# ============= F1 =============
class TestF1:
    @pytest.fixture(scope="class")
    def f1_data(self):
        s = requests.Session()
        chs = s.get(f"{BASE_URL}/api/f1/challenges").json()
        ch = next((c for c in chs if c.get("slug") == "f1-winter-championship"), chs[0])
        return ch

    def test_list_challenges(self, f1_data):
        ch = f1_data
        assert ch.get("track_count") == 4, f"track_count={ch.get('track_count')}"
        assert ch.get("participant_count", 0) > 0

    def test_leaderboard_auto_picks_track_sorted(self, api, f1_data):
        cid = f1_data["id"]
        r = api.get(f"{BASE_URL}/api/f1/challenges/{cid}/leaderboard")
        assert r.status_code == 200, r.text
        data = r.json()
        entries = data.get("entries", [])
        assert len(entries) > 0, "no entries"
        times = [e["time_ms"] for e in entries]
        assert times == sorted(times), "should sort ASC"
        first = entries[0]
        assert first.get("rank") == 1
        assert first.get("gap_ms") == 0
        ts = first.get("time_str")
        # m:ss.SSS format
        assert ts and ":" in ts and "." in ts, f"time_str format: {ts}"

    def test_leaderboard_with_slug_404(self, api):
        """REPORTED ISSUE: leaderboard endpoint doesn't accept slug, only UUID."""
        r = api.get(f"{BASE_URL}/api/f1/challenges/f1-winter-championship/leaderboard")
        # If main agent fixes slug support, this should be 200
        # Currently expected 404 to flag the inconsistency
        assert r.status_code in (200, 404), f"unexpected status: {r.status_code}"

    def test_championship_standings(self, api, f1_data):
        cid = f1_data["id"]
        r = api.get(f"{BASE_URL}/api/f1/challenges/{cid}/championship")
        assert r.status_code == 200, r.text
        data = r.json()
        standings = data.get("standings", [])
        assert len(standings) > 0
        assert all("points" in s for s in standings)

    def test_export_csv(self, api, f1_data):
        cid = f1_data["id"]
        r = api.get(f"{BASE_URL}/api/f1/challenges/{cid}/export.csv")
        assert r.status_code == 200, r.text
        assert "csv" in r.headers.get("content-type", "").lower()
        text = r.text
        assert "Rang" in text, f"missing 'Rang' header: {text[:200]}"
        lines = [l for l in text.splitlines() if l.strip()]
        assert len(lines) >= 2

    def test_admin_add_lap_time_resorts(self, admin_client, api, f1_data):
        cid = f1_data["id"]
        ch = api.get(f"{BASE_URL}/api/f1/challenges/{cid}").json()
        track_id = ch["tracks"][0]["id"]
        lb = api.get(f"{BASE_URL}/api/f1/challenges/{cid}/leaderboard?track_id={track_id}").json()
        entries = lb.get("entries", [])
        assert entries
        # pick last-place user, give them fastest time
        target = entries[-1]
        user_id = target["user_id"]
        new_time = 30000  # 30s - fastest
        r = admin_client.post(f"{BASE_URL}/api/f1/challenges/{cid}/times", json={
            "user_id": user_id, "track_id": track_id, "time_ms": new_time,
            "penalty_seconds": 0.0, "is_invalid": False,
        })
        assert r.status_code in (200, 201), r.text

        lb2 = api.get(f"{BASE_URL}/api/f1/challenges/{cid}/leaderboard?track_id={track_id}").json()
        entries2 = lb2.get("entries", [])
        # User should now be rank 1
        rank1 = entries2[0]
        assert rank1["user_id"] == user_id, f"expected {user_id} as rank1, got {rank1.get('user_id')}"
        assert rank1["time_ms"] == new_time


# ============= ADMIN =============
class TestAdmin:
    def test_dashboard(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/admin/dashboard")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("player_count", 0) >= 21, f"player_count={d.get('player_count')}"
        assert d.get("team_count") == 5, f"team_count={d.get('team_count')}"
        assert d.get("total_tournaments") == 2, f"total_tournaments={d.get('total_tournaments')}"

    def test_dashboard_player_403(self, player_client):
        r = player_client.get(f"{BASE_URL}/api/admin/dashboard")
        assert r.status_code in (401, 403)


# ============= USERS =============
class TestUsers:
    def test_patch_me_display_name(self, player_client):
        new_name = f"Display_{int(time.time())}"
        r = player_client.patch(f"{BASE_URL}/api/users/me",
                                json={"display_name": new_name})
        assert r.status_code == 200, r.text
        assert r.json().get("display_name") == new_name

    def test_patch_other_user_forbidden(self, player_client, admin_client):
        # find another user via admin user list
        r = admin_client.get(f"{BASE_URL}/api/users")
        if r.status_code != 200:
            pytest.skip("cannot list users")
        users = r.json()
        me = player_client.get(f"{BASE_URL}/api/auth/me").json()
        other = next((u for u in users if u.get("id") != me.get("id")), None)
        assert other
        r = player_client.patch(f"{BASE_URL}/api/users/{other['id']}",
                                json={"display_name": "HACKED"})
        assert r.status_code == 403, f"expected 403, got {r.status_code}"


# ============= BRUTE FORCE =============
class TestBruteForce:
    def test_brute_force_lockout_eventual(self):
        """Brute force triggers eventually. Note: k8s ingress varies source IP across pods,
        making per-IP threshold harder to hit. Sending more attempts to compensate."""
        suffix = str(int(time.time() * 1000))
        email = f"test_brute_{suffix}@example.com"
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        statuses = []
        for i in range(20):
            r = s.post(f"{BASE_URL}/api/auth/login",
                       json={"email": email, "password": "wrong_pw"})
            statuses.append(r.status_code)
            if r.status_code == 429:
                break
        assert 429 in statuses, (
            f"Brute force NEVER triggered after 20 attempts. statuses={statuses}. "
            f"Likely bug: brute force keyed by request.client.host but ingress proxy "
            f"rotates source IPs across pods. Should use X-Forwarded-For or just email."
        )
