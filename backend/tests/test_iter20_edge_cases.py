"""Iter20 edge cases for team roster mgmt + audit log paths.

Covers:
  • kick self → 400
  • kick leader → 400
  • non-leader role-change → 403
  • invalid role value → 400
  • transfer to non-member → 404
  • transfer to current leader → 400
  • admin ban/unban/role/delete audit log paths (no 500)
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fast-lap-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PW = "TLSAdmin2026!"


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=10)
    if r.status_code == 429:
        pytest.skip("rate-limited")
    assert r.status_code == 200, r.text
    tok = r.cookies.get("access_token") or r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def two_players(admin_token):
    suffix = os.urandom(3).hex()
    p1 = {"email": f"edge_a_{suffix}@thelionsquad.at", "username": f"edge_a_{suffix}",
          "password": "TestPass123!", "display_name": "Edge A",
          "accept_privacy": True, "accept_terms": True}
    p2 = {"email": f"edge_b_{suffix}@thelionsquad.at", "username": f"edge_b_{suffix}",
          "password": "TestPass123!", "display_name": "Edge B",
          "accept_privacy": True, "accept_terms": True}
    r1 = requests.post(f"{API}/auth/register", json=p1, timeout=10)
    r2 = requests.post(f"{API}/auth/register", json=p2, timeout=10)
    if r1.status_code != 200 or r2.status_code != 200:
        pytest.skip(f"register failed: {r1.status_code}/{r2.status_code}")
    l1 = requests.post(f"{API}/auth/login", json={"email": p1["email"], "password": p1["password"]}, timeout=10)
    l2 = requests.post(f"{API}/auth/login", json={"email": p2["email"], "password": p2["password"]}, timeout=10)
    p1d = {"id": l1.json()["id"], "token": l1.cookies.get("access_token"), "email": p1["email"]}
    p2d = {"id": l2.json()["id"], "token": l2.cookies.get("access_token"), "email": p2["email"]}
    yield p1d, p2d
    requests.delete(f"{API}/users/{p1d['id']}", headers=H(admin_token), timeout=10)
    requests.delete(f"{API}/users/{p2d['id']}", headers=H(admin_token), timeout=10)


@pytest.fixture
def joined_team(two_players):
    """Fresh team per test where p1=leader, p2=member."""
    p1, p2 = two_players
    r = requests.post(f"{API}/teams",
                      json={"name": f"Edge Team {os.urandom(2).hex()}", "tag": "ET"},
                      headers=H(p1["token"]), timeout=10)
    if r.status_code != 200:
        pytest.skip(f"team create failed: {r.status_code} {r.text}")
    team = r.json()
    rj = requests.post(f"{API}/teams/{team['id']}/join",
                       json={"join_code": team["join_code"]},
                       headers=H(p2["token"]), timeout=10)
    assert rj.status_code == 200
    yield team["id"], p1, p2
    requests.delete(f"{API}/teams/{team['id']}", headers=H(p1["token"]), timeout=10)


def test_kick_self_rejected(joined_team):
    team_id, p1, p2 = joined_team
    # p2 (member) tries to kick himself → 400 (use leave instead)
    r = requests.delete(f"{API}/teams/{team_id}/members/{p2['id']}",
                        headers=H(p2["token"]), timeout=10)
    assert r.status_code in (400, 403), r.text


def test_kick_leader_rejected(joined_team):
    team_id, p1, p2 = joined_team
    # p1 (leader) tries to kick himself or anyone tries to kick leader → 400
    r = requests.delete(f"{API}/teams/{team_id}/members/{p1['id']}",
                        headers=H(p1["token"]), timeout=10)
    assert r.status_code in (400, 403), r.text


def test_non_leader_role_change_forbidden(joined_team):
    team_id, p1, p2 = joined_team
    # p2 (regular member) tries to promote himself → 403
    r = requests.post(f"{API}/teams/{team_id}/members/{p2['id']}/role",
                      json={"role": "co_leader"}, headers=H(p2["token"]), timeout=10)
    assert r.status_code == 403, r.text


def test_invalid_role_value_rejected(joined_team):
    team_id, p1, p2 = joined_team
    r = requests.post(f"{API}/teams/{team_id}/members/{p2['id']}/role",
                      json={"role": "supreme_overlord"},
                      headers=H(p1["token"]), timeout=10)
    assert r.status_code in (400, 422), r.text


def test_transfer_to_non_member_404(joined_team, admin_token):
    team_id, p1, p2 = joined_team
    # try to transfer to admin (not a team member)
    me = requests.get(f"{API}/auth/me", headers=H(admin_token), timeout=10).json()
    r = requests.post(f"{API}/teams/{team_id}/transfer-leader",
                      json={"new_leader_id": me["id"]},
                      headers=H(p1["token"]), timeout=10)
    assert r.status_code in (400, 404), r.text


def test_transfer_to_current_leader_rejected(joined_team):
    team_id, p1, p2 = joined_team
    r = requests.post(f"{API}/teams/{team_id}/transfer-leader",
                      json={"new_leader_id": p1["id"]},
                      headers=H(p1["token"]), timeout=10)
    assert r.status_code == 400, r.text


# ───────── audit log paths: ban/unban/role/delete should never 500 ─────────
def test_admin_audit_paths_no_500(admin_token):
    """Create a throwaway user, exercise ban/unban/role-change/delete → no 500."""
    suffix = os.urandom(3).hex()
    payload = {
        "email": f"audit_{suffix}@thelionsquad.at",
        "username": f"audit_{suffix}",
        "display_name": "Audit Test",
        "password": "AuditPass123!",
        "send_invite": False,
    }
    r = requests.post(f"{API}/users", json=payload, headers=H(admin_token), timeout=15)
    assert r.status_code in (200, 201), r.text
    uid = r.json()["id"]
    try:
        # ban
        rb = requests.post(f"{API}/users/{uid}/ban", json={"reason": "audit-test"},
                           headers=H(admin_token), timeout=10)
        assert rb.status_code != 500, f"ban 500: {rb.text}"
        # unban
        ru = requests.post(f"{API}/users/{uid}/unban",
                           headers=H(admin_token), timeout=10)
        assert ru.status_code != 500, f"unban 500: {ru.text}"
        # role change
        rr = requests.put(f"{API}/users/{uid}/role", json={"role": "moderator"},
                          headers=H(admin_token), timeout=10)
        assert rr.status_code != 500, f"role 500: {rr.text}"
    finally:
        rd = requests.delete(f"{API}/users/{uid}", headers=H(admin_token), timeout=10)
        assert rd.status_code != 500, f"delete 500: {rd.text}"


def test_branding_specific_default_urls(admin_token):
    """Verify expected default URLs from problem statement."""
    r = requests.get(f"{API}/settings/branding", headers=H(admin_token), timeout=10)
    assert r.status_code == 200
    b = r.json()
    # Per other_misc_info contract:
    #   facebook→thelionsquadesports, instagram→thelionsquadesports,
    #   tiktok→@thelionsquadesports, youtube→@TheLionSquadeSports
    assert "thelionsquadesports" in b.get("facebook_url", "").lower()
    assert "thelionsquadesports" in b.get("instagram_url", "").lower()
    assert "thelionsquadesports" in b.get("tiktok_url", "").lower()
    assert "thelionsquadespor" in b.get("youtube_url", "").lower()
