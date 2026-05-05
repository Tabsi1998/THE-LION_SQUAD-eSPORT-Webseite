"""Iteration 20 — Bug fixes after user self-edits.

Verifies:
  • POST /api/users (admin invite) no longer 500s on audit_logs DuplicateKey
  • GET /api/settings/branding returns all 6 social URL defaults
  • Team roster mgmt: kick member, set role, transfer leadership
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fast-lap-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PW = "TLSAdmin2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=10)
    if r.status_code == 429:
        pytest.skip("rate-limited; clear login_attempts and retry")
    assert r.status_code == 200, r.text
    # token is in cookie
    tok = r.cookies.get("access_token") or r.json().get("access_token")
    assert tok, "no token"
    return tok


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_branding_get_returns_all_socials(admin_token):
    r = requests.get(f"{API}/settings/branding", headers=H(admin_token), timeout=10)
    assert r.status_code == 200, r.text
    b = r.json()
    for key in ("discord_invite_url", "twitch_channel", "facebook_url",
                "instagram_url", "tiktok_url", "youtube_url"):
        assert b.get(key), f"missing default for {key}"
    assert "thelionsquadesports" in b["facebook_url"]


def test_admin_user_invite_no_duplicate_key(admin_token):
    """The audit_logs.insert_one() in user_routes was missing 'id'.
    Verify a fresh invite returns 200 (or 400 for duplicate email — but never 500)."""
    payload = {
        "email": f"invite-test-{os.urandom(3).hex()}@thelionsquad.at",
        "username": f"invite_{os.urandom(2).hex()}",
        "display_name": "Invite Test",
        "send_invite": True,
    }
    r = requests.post(f"{API}/users", json=payload, headers=H(admin_token), timeout=15)
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body.get("email") == payload["email"]
    # cleanup: delete the test user
    if body.get("id"):
        requests.delete(f"{API}/users/{body['id']}", headers=H(admin_token), timeout=10)


@pytest.fixture(scope="module")
def player_pair(admin_token):
    """Register two demo players for team-management tests."""
    suffix = os.urandom(3).hex()
    p1 = {"email": f"team_a_{suffix}@thelionsquad.at", "username": f"team_a_{suffix}",
          "password": "TestPass123!", "display_name": "Team A",
          "accept_privacy": True, "accept_terms": True}
    p2 = {"email": f"team_b_{suffix}@thelionsquad.at", "username": f"team_b_{suffix}",
          "password": "TestPass123!", "display_name": "Team B",
          "accept_privacy": True, "accept_terms": True}
    p1_resp = requests.post(f"{API}/auth/register", json=p1, timeout=10)
    p2_resp = requests.post(f"{API}/auth/register", json=p2, timeout=10)
    if p1_resp.status_code != 200 or p2_resp.status_code != 200:
        pytest.skip(f"register failed: {p1_resp.status_code}/{p2_resp.status_code}")
    p1_login = requests.post(f"{API}/auth/login", json={"email": p1["email"], "password": p1["password"]}, timeout=10)
    p2_login = requests.post(f"{API}/auth/login", json={"email": p2["email"], "password": p2["password"]}, timeout=10)
    yield (
        {"id": p1_login.json()["id"], "token": p1_login.cookies.get("access_token")},
        {"id": p2_login.json()["id"], "token": p2_login.cookies.get("access_token")},
    )
    # cleanup
    requests.delete(f"{API}/users/{p1_login.json()['id']}", headers=H(admin_token), timeout=10)
    requests.delete(f"{API}/users/{p2_login.json()['id']}", headers=H(admin_token), timeout=10)


def test_team_kick_role_transfer_full_flow(player_pair, admin_token):
    p1, p2 = player_pair
    # leader p1 creates team
    r = requests.post(f"{API}/teams",
                      json={"name": f"Roster Test {os.urandom(2).hex()}", "tag": "RT"},
                      headers=H(p1["token"]), timeout=10)
    assert r.status_code == 200, r.text
    team = r.json()
    team_id = team["id"]
    join_code = team.get("join_code")
    assert join_code, "team must have join_code"

    # p2 joins
    r = requests.post(f"{API}/teams/{team_id}/join",
                      json={"join_code": join_code}, headers=H(p2["token"]), timeout=10)
    assert r.status_code == 200, r.text

    # p1 promotes p2 to co_leader
    r = requests.post(f"{API}/teams/{team_id}/members/{p2['id']}/role",
                      json={"role": "co_leader"}, headers=H(p1["token"]), timeout=10)
    assert r.status_code == 200, r.text

    # p1 transfers leadership to p2
    r = requests.post(f"{API}/teams/{team_id}/transfer-leader",
                      json={"new_leader_id": p2["id"]}, headers=H(p1["token"]), timeout=10)
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["leader_id"] == p2["id"]
    assert p1["id"] in after.get("co_leader_ids", [])

    # p2 (new leader) kicks p1
    r = requests.delete(f"{API}/teams/{team_id}/members/{p1['id']}",
                        headers=H(p2["token"]), timeout=10)
    assert r.status_code == 200, r.text

    # verify p1 is gone
    r = requests.get(f"{API}/teams/{team_id}", headers=H(p2["token"]), timeout=10)
    assert r.status_code == 200
    fresh = r.json()
    assert p1["id"] not in (fresh.get("member_ids") or [])

    # cleanup: delete team
    requests.delete(f"{API}/teams/{team_id}", headers=H(p2["token"]), timeout=10)


def test_team_kick_anon_blocked(player_pair):
    p1, _ = player_pair
    r = requests.delete(f"{API}/teams/x/members/y", timeout=10)
    assert r.status_code in (401, 403)


def test_team_kick_leader_rejected(player_pair, admin_token):
    p1, p2 = player_pair
    r = requests.post(f"{API}/teams",
                      json={"name": f"Kick Test {os.urandom(2).hex()}", "tag": "KT"},
                      headers=H(p1["token"]), timeout=10)
    if r.status_code != 200:
        pytest.skip("team create failed")
    team_id = r.json()["id"]
    # Cannot kick the leader (p1 = leader)
    r = requests.delete(f"{API}/teams/{team_id}/members/{p1['id']}",
                        headers=H(p1["token"]), timeout=10)
    assert r.status_code in (400, 403), r.text
    requests.delete(f"{API}/teams/{team_id}", headers=H(p1["token"]), timeout=10)
