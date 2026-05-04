"""P0 — Penalty Transparency tests (iteration_19).

Verifies:
  • Fast Lap: cannot create a penalized lap without admin_note (422)
  • Fast Lap: cannot create an invalid lap without admin_note (422)
  • Fast Lap: with admin_note → 200 + leaderboard exposes penalty_note
  • Match forfeit: requires note (422 without)
  • /api/penalties/me requires auth, returns own penalties only
  • /api/admin/penalties returns aggregated list, supports kind filter
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
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def existing_challenge(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{API}/f1/challenges", headers=h, timeout=10)
    assert r.status_code == 200
    chals = r.json()
    if not chals:
        pytest.skip("No fast lap challenge seeded — cannot run penalty tests.")
    cid = chals[0]["id"]
    # find or create a track
    r = requests.get(f"{API}/f1/challenges/{cid}/tracks", timeout=10)
    tracks = r.json() if r.status_code == 200 else []
    if tracks:
        return cid, tracks[0]["id"], admin_token
    # else create one
    r = requests.post(f"{API}/f1/challenges/{cid}/tracks",
                      json={"name": "Penalty Test Track", "order_index": 99},
                      headers=h, timeout=10)
    return cid, r.json()["id"], admin_token


def test_lap_with_penalty_no_note_rejected(existing_challenge):
    cid, tid, tok = existing_challenge
    h = {"Authorization": f"Bearer {tok}"}
    # find admin user_id
    me = requests.get(f"{API}/auth/me", headers=h, timeout=10).json()
    r = requests.post(f"{API}/f1/challenges/{cid}/times", headers=h, timeout=10, json={
        "user_id": me["id"], "track_id": tid, "time_ms": 90000,
        "penalty_seconds": 5.0, "is_invalid": False,
    })
    assert r.status_code == 422
    assert "Begründung" in r.text or "begründung" in r.text.lower()


def test_lap_invalid_no_note_rejected(existing_challenge):
    cid, tid, tok = existing_challenge
    h = {"Authorization": f"Bearer {tok}"}
    me = requests.get(f"{API}/auth/me", headers=h, timeout=10).json()
    r = requests.post(f"{API}/f1/challenges/{cid}/times", headers=h, timeout=10, json={
        "user_id": me["id"], "track_id": tid, "time_ms": 91000,
        "penalty_seconds": 0, "is_invalid": True,
    })
    assert r.status_code == 422


def test_lap_with_penalty_and_note_allowed(existing_challenge):
    cid, tid, tok = existing_challenge
    h = {"Authorization": f"Bearer {tok}"}
    me = requests.get(f"{API}/auth/me", headers=h, timeout=10).json()
    note = "Cut Curb T7 Lap 3 (replay 0:42)"
    r = requests.post(f"{API}/f1/challenges/{cid}/times", headers=h, timeout=10, json={
        "user_id": me["id"], "track_id": tid, "time_ms": 92000,
        "penalty_seconds": 5.0, "is_invalid": False,
        "admin_note": note,
    })
    assert r.status_code == 200, r.text
    assert r.json()["admin_note"] == note

    # leaderboard exposes penalty_note
    r = requests.get(f"{API}/f1/challenges/{cid}/leaderboard?track_id={tid}", timeout=10)
    assert r.status_code == 200
    found = False
    for e in r.json()["entries"]:
        if e.get("user_id") == me["id"] and e.get("penalty_note"):
            found = True
            assert note in e["penalty_note"]
    assert found, "Leaderboard did not expose penalty_note for the penalized entry."


def test_lap_clean_no_note_required(existing_challenge):
    cid, tid, tok = existing_challenge
    h = {"Authorization": f"Bearer {tok}"}
    me = requests.get(f"{API}/auth/me", headers=h, timeout=10).json()
    r = requests.post(f"{API}/f1/challenges/{cid}/times", headers=h, timeout=10, json={
        "user_id": me["id"], "track_id": tid, "time_ms": 89000,
        "penalty_seconds": 0, "is_invalid": False,
    })
    assert r.status_code == 200, r.text


def test_my_penalties_requires_auth():
    r = requests.get(f"{API}/penalties/me", timeout=10)
    assert r.status_code in (401, 403)


def test_my_penalties_returns_own(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{API}/penalties/me", headers=h, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and "count" in body
    # at least one should exist from previous test
    assert any(i.get("kind") in ("lap_penalty", "lap_invalid") for i in body["items"])


def test_admin_penalties_aggregated(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{API}/admin/penalties", headers=h, timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["items"], list)
    if body["items"]:
        assert "user_username" in body["items"][0]


def test_admin_penalties_kind_filter(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{API}/admin/penalties?kind=lap_penalty", headers=h, timeout=10)
    assert r.status_code == 200
    for it in r.json()["items"]:
        assert it["kind"] == "lap_penalty"


def test_admin_penalties_anonymous_blocked():
    r = requests.get(f"{API}/admin/penalties", timeout=10)
    assert r.status_code in (401, 403)


def test_match_forfeit_requires_note(admin_token):
    """We don't have a guaranteed match in fixtures, so we test a non-existent match
    returns 404 (not 422). Then we hit an existing match if available with empty note → 422."""
    h = {"Authorization": f"Bearer {admin_token}"}
    # 404 path
    r = requests.post(f"{API}/matches/does-not-exist/forfeit",
                      headers=h, timeout=10, json={"winner_id": "x", "note": "valid note here"})
    assert r.status_code == 404
    # 422 path on real match (if exists)
    rs = requests.get(f"{API}/matches?limit=1", headers=h, timeout=10)
    if rs.status_code == 200 and rs.json():
        mid = rs.json()[0]["id"]
        r = requests.post(f"{API}/matches/{mid}/forfeit",
                          headers=h, timeout=10, json={"winner_id": "x"})
        assert r.status_code == 422
