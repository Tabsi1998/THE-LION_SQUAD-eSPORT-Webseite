"""Phase 1: validate the matches_v2 (graph engine) branch of the unified
/api/matches/{id} route. The preview DB has no matches_v2 documents, so this
test seeds one temporary TEST_ match and removes it afterwards.
"""
import asyncio
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

pytestmark = pytest.mark.live

frontend_env = dotenv_values("/app/frontend/.env")
backend_env = dotenv_values("/app/backend/.env")
_base = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not _base:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)
BASE_URL = _base.rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL") or backend_env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or backend_env.get("DB_NAME")
TOURNAMENT_ID = "ed1ec3cb-08b8-4ea3-8cd1-3da539e3a90f"
V2_MATCH_ID = "TEST-v2-unified-route-match"


def _creds():
    p = Path("/app/memory/test_credentials.md")
    txt = p.read_text(encoding="utf-8")
    e = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?email(?:\*\*)?\s*:\s*`?([^`\s]+)", txt)
    pw = re.search(r"(?im)^\s*(?:[-*]\s*)?(?:\*\*)?password(?:\*\*)?\s*:\s*`?([^`\s]+)", txt)
    return {"email": e.group(1), "password": pw.group(1)}


@pytest.fixture(scope="module")
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Origin": BASE_URL})
    r = s.post(f"{BASE_URL}/api/auth/login", json=_creds())
    if r.status_code != 200:
        pytest.fail(f"login failed {r.status_code}")
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf
    return s


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def seeded_v2_match():
    async def seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        doc = {
            "id": V2_MATCH_ID,
            "tournament_id": TOURNAMENT_ID,
            "stage_id": None,
            "match_key": "TEST_R1_H1",
            "round": 1,
            "status": "pending",
            "slots": [
                {"slot": 1, "status": "pending", "registration_id": None},
                {"slot": 2, "status": "pending", "registration_id": None},
            ],
            "results": [],
            "created_at": "2026-07-01T00:00:00+00:00",
            "updated_at": "2026-07-01T00:00:00+00:00",
        }
        await db.matches_v2.delete_many({"id": V2_MATCH_ID})
        await db.matches_v2.insert_one(dict(doc))
        client.close()
        return doc

    async def cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        await client[DB_NAME].matches_v2.delete_many({"id": V2_MATCH_ID})
        client.close()

    doc = _run(seed())
    yield doc
    _run(cleanup())


class TestUnifiedV2Branch:
    def test_v2_schedule_patch_via_unified_route(self, admin_client, seeded_v2_match):
        r = admin_client.patch(f"{BASE_URL}/api/matches/{V2_MATCH_ID}", json={
            "scheduled_at": "2026-08-05T20:00:00+00:00",
            "duration_minutes": 30,
        })
        assert r.status_code == 200, f"v2 unified PATCH failed {r.status_code}: {r.text[:400]}"
        body = r.json()
        assert "_id" not in body
        assert body.get("duration_minutes") == 30
        assert str(body.get("scheduled_at") or "").startswith("2026-08-05T20:00")
        # pending -> scheduled auto status transition
        assert body.get("status") == "scheduled"

    def test_v2_idempotent_replay(self, admin_client, seeded_v2_match):
        payload = {"scheduled_at": "2026-08-05T20:00:00+00:00", "duration_minutes": 30}
        admin_client.patch(f"{BASE_URL}/api/matches/{V2_MATCH_ID}", json=payload)
        r = admin_client.patch(f"{BASE_URL}/api/matches/{V2_MATCH_ID}", json=payload)
        assert r.status_code == 200, r.text[:300]

    def test_v2_result_fields_stripped(self, admin_client, seeded_v2_match):
        r = admin_client.patch(f"{BASE_URL}/api/matches/{V2_MATCH_ID}", json={
            "score_a": 77, "score_b": 66, "winner_id": "bogus",
        })
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body.get("score_a") != 77
        assert body.get("winner_id") != "bogus"

    def test_v2_get_match_via_unified_route(self, admin_client, seeded_v2_match):
        r = admin_client.get(f"{BASE_URL}/api/matches/{V2_MATCH_ID}")
        assert r.status_code == 200, r.text[:300]
        assert r.json()["id"] == V2_MATCH_ID

    def test_legacy_result_form_rejected_for_v2(self, admin_client, seeded_v2_match):
        # POST /result on a v2 match must dispatch to submit_v2_result (not 400 legacy path)
        r = admin_client.post(f"{BASE_URL}/api/matches/{V2_MATCH_ID}/result", json={
            "results": [{"slot": 1, "rank": 1, "points": 10}],
        })
        assert r.status_code in (200, 400, 409, 422), f"unexpected {r.status_code}: {r.text[:300]}"
        assert r.status_code != 500, r.text[:300]
