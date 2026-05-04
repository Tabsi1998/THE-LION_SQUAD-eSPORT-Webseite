"""Phase D Final-Schliff + Phase B v3 backend tests.

Covers:
- /api/badges (anon/admin) audience+secret filters, fun cat present
- /api/badges/progress/me + auto-award flow
- /api/contact (submit/topics/list/patch) + mail-queue jobs
- /api/board CRUD incl. defaults + assignable-users
"""
import os
import time
import requests
import pytest
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@lionsquad.at"
ADMIN_PW = "TLSAdmin2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------- Badges ----------
class TestBadges:
    def test_list_anon(self):
        r = requests.get(f"{BASE}/api/badges", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        cats = {b["category"] for b in data}
        assert "fun" in cats, f"Expected 'fun' category in anon catalog. Got: {cats}"
        # No secret/negative badges leaked anonymously
        for b in data:
            assert not b.get("secret"), f"Secret badge {b['code']} leaked anon"
            assert not b.get("negative"), f"Negative badge {b['code']} in anon catalog"
            assert b.get("audience") != "members_only", f"members_only {b['code']} leaked anon"

    def test_list_admin_includes_members_only(self, admin_h):
        r = requests.get(f"{BASE}/api/badges", headers=admin_h, timeout=15)
        assert r.status_code == 200
        data = r.json()
        # negatives/secrets still excluded from catalog (only earned shows)
        for b in data:
            assert not b.get("negative"), f"Negative {b['code']} in admin catalog (should only show if earned)"
        # admin is club member -> should see members_only badges
        members_only = [b for b in data if b.get("audience") == "members_only"]
        assert len(members_only) > 0, "Expected members_only badges visible to admin"

    def test_progress_me(self, admin_h):
        r = requests.get(f"{BASE}/api/badges/progress/me", headers=admin_h, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        for entry in data:
            for k in ("code", "current", "target", "percent"):
                assert k in entry, f"Missing field {k} in progress entry"
            assert 0 <= entry["percent"] <= 100


# ---------- Contact ----------
class TestContact:
    def test_topics(self):
        r = requests.get(f"{BASE}/api/contact/topics", timeout=10)
        assert r.status_code == 200
        topics = r.json()
        assert isinstance(topics, list) and len(topics) >= 5
        values = {t["value"] for t in topics}
        for v in ("general", "membership", "tournament", "fastlap"):
            assert v in values

    def test_submit_and_admin_inbox_flow(self, admin_h):
        payload = {
            "name": "TEST_Contact User",
            "email": "TEST_contact@example.com",
            "topic": "general",
            "subject": "TEST_subject_phaseD",
            "message": "Dies ist eine TEST_Nachricht für Phase D Tests.",
            "accept_privacy": True,
        }
        r = requests.post(f"{BASE}/api/contact/submit", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]

        # Admin lists messages
        r2 = requests.get(f"{BASE}/api/contact", headers=admin_h, timeout=10)
        assert r2.status_code == 200
        msgs = r2.json()
        found = next((m for m in msgs if m["id"] == cid), None)
        assert found is not None, "submitted contact not in admin inbox"
        assert found["status"] == "new"

        # Mail queue should have at least one job for this contact
        r3 = requests.get(f"{BASE}/api/settings/mail-queue", headers=admin_h, timeout=10)
        assert r3.status_code == 200, r3.text
        jobs = r3.json()
        assert isinstance(jobs, list)
        related = [j for j in jobs if (j.get("meta") or {}).get("contact_id") == cid]
        assert len(related) >= 1, f"Expected mail_jobs for contact {cid}, got {len(related)}"

        # Patch -> answered
        r4 = requests.patch(f"{BASE}/api/contact/{cid}", headers=admin_h, json={"status": "answered"}, timeout=10)
        assert r4.status_code == 200
        upd = r4.json()
        assert upd["status"] == "answered"
        assert upd.get("answered_at"), "answered_at not set"

        # Cleanup
        requests.delete(f"{BASE}/api/contact/{cid}", headers=admin_h, timeout=10)


# ---------- Board ----------
class TestBoard:
    def test_defaults_present(self):
        r = requests.get(f"{BASE}/api/board?active_only=true", timeout=10)
        assert r.status_code == 200, r.text
        positions = r.json()
        slugs = {p["slug"] for p in positions}
        for s in ("obmann", "schriftfuehrer", "kassier"):
            assert s in slugs, f"Missing default position {s}"
        for p in positions:
            assert "display_title" in p
            assert "user" in p  # may be None

    def test_assignable_users(self, admin_h):
        r = requests.get(f"{BASE}/api/board/assignable-users", headers=admin_h, timeout=10)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        emails_or_roles = [u for u in users if u.get("role") in ("superadmin", "admin", "moderator") or u.get("is_club_member")]
        assert len(emails_or_roles) >= 1

    def test_create_patch_delete_custom(self, admin_h):
        # Create custom
        body = {"title_male": "TEST_Sportwart", "description": "TEST", "order_index": 50, "is_active": True}
        r = requests.post(f"{BASE}/api/board", headers=admin_h, json=body, timeout=10)
        assert r.status_code == 200, r.text
        pos = r.json()
        pid = pos["id"]
        assert pos.get("is_default") is False

        # Patch (toggle inactive)
        r2 = requests.patch(f"{BASE}/api/board/{pid}", headers=admin_h, json={"is_active": False}, timeout=10)
        assert r2.status_code == 200
        assert r2.json()["is_active"] is False

        # Delete custom OK
        r3 = requests.delete(f"{BASE}/api/board/{pid}", headers=admin_h, timeout=10)
        assert r3.status_code == 200

    def test_delete_default_blocked(self, admin_h):
        r = requests.get(f"{BASE}/api/board", timeout=10)
        positions = r.json()
        default = next(p for p in positions if p.get("is_default"))
        r2 = requests.delete(f"{BASE}/api/board/{default['id']}", headers=admin_h, timeout=10)
        assert r2.status_code == 400, f"Expected 400, got {r2.status_code}: {r2.text}"
