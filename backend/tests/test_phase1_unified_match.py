"""Phase 1 validation: unified /api/matches write path, notifications/me, public regression.

Runs against the public preview ingress URL (what the browser sees).
"""
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

pytestmark = pytest.mark.live

frontend_env = dotenv_values("/app/frontend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not _base:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)
BASE_URL = _base.rstrip("/")

TOURNAMENT_ID = "ed1ec3cb-08b8-4ea3-8cd1-3da539e3a90f"  # Mario Kart Winter Cup (single_elim)


def _creds():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing test_credentials.md")
    txt = p.read_text(encoding="utf-8")
    e = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?email(?:\*\*)?\s*:\s*`?([^`\s]+)", txt)
    pw = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?password(?:\*\*)?\s*:\s*`?([^`\s]+)", txt)
    if not e or not pw:
        pytest.skip("credentials unparsable")
    return {"email": e.group(1), "password": pw.group(1)}


@pytest.fixture(scope="module")
def admin_client():
    creds = _creds()
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/login",
        "User-Agent": "Mozilla/5.0 (QA phase1)",
    })
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:400]}")
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf
    return s


# --- auth / notifications --------------------------------------------------
class TestAuthAndNotifications:
    def test_login_and_me(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data.get("role") in {"superadmin", "club_admin"}

    def test_notifications_me_returns_200(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/notifications/me")
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert isinstance(body, (list, dict))
        if isinstance(body, list):
            for item in body:
                assert "_id" not in item

    def test_notifications_unread_count(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/notifications/me/unread-count")
        assert r.status_code == 200, r.text[:300]


# --- unified match write path ---------------------------------------------
class TestUnifiedMatchWritePath:
    @pytest.fixture(scope="class")
    def bracket(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/tournaments/{TOURNAMENT_ID}/bracket")
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        assert data.get("matches"), "no bracket matches present"
        return data

    def test_bracket_has_16_matches(self, bracket):
        assert len(bracket["matches"]) >= 15, len(bracket["matches"])
        assert all("_id" not in m for m in bracket["matches"])

    def test_unified_patch_result_advances_winner(self, admin_client, bracket):
        matches = bracket["matches"]
        r1 = [
            m for m in matches
            if (m.get("round") == 1 and m.get("participant_a_id") and m.get("participant_b_id"))
        ]
        if not r1:
            pytest.skip("no playable first-round match")
        m = r1[0]
        winner = m["participant_a_id"]
        r = admin_client.patch(f"{BASE_URL}/api/matches/{m['id']}", json={
            "score_a": 3, "score_b": 1, "winner_id": winner, "status": "completed",
        })
        assert r.status_code == 200, f"unified PATCH failed {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "_id" not in body
        assert body["winner_id"] == winner
        assert body["status"] == "completed"
        assert body["score_a"] == 3 and body["score_b"] == 1

        # GET verifies persistence
        g = admin_client.get(f"{BASE_URL}/api/matches/{m['id']}")
        assert g.status_code == 200
        assert g.json()["winner_id"] == winner

        # winner advanced into next round
        nb = admin_client.get(f"{BASE_URL}/api/tournaments/{TOURNAMENT_ID}/bracket").json()
        nxt = [x for x in nb["matches"] if x.get("round") == (m.get("round") or 1) + 1]
        assert nxt, "no next round matches to advance into"
        advanced = any(
            winner in {x.get("participant_a_id"), x.get("participant_b_id")} for x in nxt
        )
        assert advanced, "winner was not advanced to the next round"

    def test_unified_patch_schedule(self, admin_client, bracket):
        m = bracket["matches"][0]
        r = admin_client.patch(f"{BASE_URL}/api/matches/{m['id']}", json={
            "scheduled_at": "2026-08-01T18:30:00+00:00",
            "duration_minutes": 25,
        })
        assert r.status_code == 200, f"schedule PATCH failed {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert body.get("duration_minutes") == 25
        assert str(body.get("scheduled_at") or "").startswith("2026-08-01T18:30")
        g = admin_client.get(f"{BASE_URL}/api/matches/{m['id']}").json()
        assert g.get("duration_minutes") == 25

    def test_unified_patch_rejects_invalid_winner(self, admin_client, bracket):
        m = bracket["matches"][0]
        r = admin_client.patch(f"{BASE_URL}/api/matches/{m['id']}", json={
            "winner_id": "not-a-participant", "status": "completed",
        })
        assert r.status_code in (400, 409, 422), f"got {r.status_code}: {r.text[:300]}"

    def test_unified_patch_unknown_match_404(self, admin_client):
        r = admin_client.patch(f"{BASE_URL}/api/matches/does-not-exist", json={"score_a": 1})
        assert r.status_code == 404, f"got {r.status_code}: {r.text[:200]}"

    def test_unified_write_requires_auth(self, bracket):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
        r = s.patch(f"{BASE_URL}/api/matches/{bracket['matches'][0]['id']}", json={"score_a": 1})
        assert r.status_code in (401, 403), f"got {r.status_code}"


# --- v2 (graph engine) matches through the unified route -------------------
class TestUnifiedV2Path:
    def _find_v2(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/tournaments")
        assert r.status_code == 200
        for t in r.json():
            rv = admin_client.get(f"{BASE_URL}/api/tournaments/{t['id']}/matches-v2")
            if rv.status_code == 200 and rv.json():
                return t, rv.json()[0]
        return None, None

    def test_v2_schedule_through_unified_route(self, admin_client):
        t, m = self._find_v2(admin_client)
        if not m:
            pytest.skip("no matches_v2 documents in preview data")
        r = admin_client.patch(f"{BASE_URL}/api/matches/{m['id']}", json={
            "scheduled_at": "2026-08-02T19:00:00+00:00",
            "duration_minutes": 30,
        })
        assert r.status_code == 200, f"v2 unified PATCH failed {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "_id" not in body
        assert body.get("duration_minutes") == 30
        assert str(body.get("scheduled_at") or "").startswith("2026-08-02T19:00")

    def test_v2_result_fields_ignored_on_patch(self, admin_client):
        t, m = self._find_v2(admin_client)
        if not m:
            pytest.skip("no matches_v2 documents in preview data")
        r = admin_client.patch(f"{BASE_URL}/api/matches/{m['id']}", json={
            "score_a": 99, "score_b": 98,
        })
        assert r.status_code == 200, r.text[:300]
        assert r.json().get("score_a") != 99


# --- public regression -----------------------------------------------------
class TestPublicRegression:
    @pytest.mark.parametrize("path", [
        "/api/tournaments",
        "/api/news",
        "/api/events",
        f"/api/tournaments/{TOURNAMENT_ID}",
        f"/api/tournaments/{TOURNAMENT_ID}/bracket",
        f"/api/tournaments/{TOURNAMENT_ID}/standings",
    ])
    def test_public_get(self, path):
        r = requests.get(f"{BASE_URL}{path}", headers={"Origin": BASE_URL}, timeout=30)
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"
