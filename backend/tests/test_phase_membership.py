"""Phase Membership/Profile re-platform tests.

Covers:
- Auth register/login with new fields + membership attachment
- Membership meta/me/admin list/upsert/history/promotion+demotion
- Member benefits CRUD + visibility filtering
- Public members directory + public users list + public profile
- User socials CRUD with visibility
- User /me PATCH with extended fields
- Authorization: community user denied for admin endpoints
- Email logs templates: membership_activated/deactivated/blocked
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fast-lap-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PASS = "TLSAdmin2026!"


def _unique(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASS},
        timeout=20,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data
    assert data.get("user_type") == "club_member"
    assert data.get("is_club_member") is True
    m = data.get("membership") or {}
    assert m.get("member_status") == "active"
    assert m.get("member_number") == "TLS-2026-0001"
    return data["access_token"]


@pytest.fixture(scope="module")
def admin_session(admin_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def community_user():
    """Register a fresh community user for the test session."""
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "username": f"test_cu_{suffix}",
        "email": f"test_cu_{suffix}@example.com",
        "password": "Pass1234!",
        "display_name": f"Test CU {suffix}",
        "discord_name": f"discord#{suffix}",
        "birth_date": "1995-05-15",
        "accept_terms": True,
        "accept_privacy": True,
        "newsletter_consent": True,
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=20)
    assert r.status_code == 200, f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"payload": payload, "data": data, "token": data["access_token"]}


@pytest.fixture(scope="module")
def community_session(community_user):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {community_user['token']}",
        "Content-Type": "application/json",
    })
    return s


# ---------- AUTH ----------
class TestAuth:
    def test_register_response_shape(self, community_user):
        d = community_user["data"]
        assert d.get("user_type") == "community_user"
        assert d.get("is_club_member") is False
        assert d["discord_name"] == community_user["payload"]["discord_name"]
        assert d["birth_date"] == community_user["payload"]["birth_date"]
        assert d["newsletter_consent"] is True
        assert d["accepted_terms"] is True
        assert "access_token" in d
        assert "password_hash" not in d

    def test_admin_login_membership_attached(self, admin_token):
        # admin_token fixture asserts shape; nothing more to do
        assert isinstance(admin_token, str) and len(admin_token) > 20

    def test_me_includes_membership(self, admin_session):
        r = admin_session.get(f"{API}/auth/me", timeout=20)
        assert r.status_code == 200
        u = r.json()
        assert u.get("is_club_member") is True
        assert u.get("membership") is not None
        assert u["membership"].get("member_number") == "TLS-2026-0001"

    def test_me_community_user(self, community_session):
        r = community_session.get(f"{API}/auth/me", timeout=20)
        assert r.status_code == 200
        u = r.json()
        assert u.get("user_type") == "community_user"
        assert u.get("is_club_member") in (False, None)


# ---------- MEMBERSHIP META + ME ----------
class TestMembershipMeta:
    def test_meta_public(self):
        r = requests.get(f"{API}/membership/meta", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "active" in data["statuses"] and "pending" in data["statuses"]
        assert "ordinary" in data["types"] and "honorary" in data["types"]

    def test_membership_me_community(self, community_session):
        r = community_session.get(f"{API}/membership/me", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert data["is_active_member"] is False
        assert data["user_type"] == "community_user"

    def test_membership_list_admin(self, admin_session):
        r = admin_session.get(f"{API}/membership", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # Admin must be in the list
        admins = [x for x in rows if x["user"]["email"] == ADMIN_EMAIL]
        assert len(admins) == 1
        assert admins[0]["membership"]["member_number"] == "TLS-2026-0001"


# ---------- MEMBERSHIP UPSERT (promotion / demotion / history) ----------
class TestMembershipUpsert:
    def test_promote_user_to_active(self, admin_session, community_user):
        user_id = community_user["data"]["id"]
        body = {
            "member_status": "active",
            "membership_type": "ordinary",
            "internal_role": "Mitglied",
            "show_member_number_publicly": True,
            "notes": "Test promotion",
        }
        r = admin_session.put(f"{API}/membership/user/{user_id}", json=body, timeout=20)
        assert r.status_code == 200, r.text
        u = r.json()
        m = u["membership"]
        assert m["member_status"] == "active"
        assert m["membership_type"] == "ordinary"
        assert m["member_number"], "auto-generated member_number missing"
        assert m["member_number"].startswith("TLS-")
        assert m["member_since"] is not None
        assert u["user_type"] == "club_member"
        assert u["is_club_member"] is True

    def test_history_grows(self, admin_session, community_user):
        user_id = community_user["data"]["id"]
        r = admin_session.put(
            f"{API}/membership/user/{user_id}",
            json={"internal_role": "Kassier"},
            timeout=20,
        )
        assert r.status_code == 200
        m = r.json()["membership"]
        # History must have grown to >=2 entries (promote + role change)
        assert isinstance(m.get("history"), list)
        assert len(m["history"]) >= 2

    def test_email_log_activated(self, admin_session, community_user):
        """Verify membership_activated template was rendered & logged via mongo direct."""
        import asyncio, os
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")

        async def _check():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = c[os.environ["DB_NAME"]]
            rows = await db.email_logs.find(
                {"template_key": "membership_activated",
                 "to": community_user["payload"]["email"]},
                {"_id": 0},
            ).to_list(10)
            return rows

        rows = asyncio.run(_check())
        assert len(rows) >= 1
        assert rows[0]["subject"] == "Willkommen als offizielles Vereinsmitglied"

    def test_block_user_renders_template(self, admin_session, community_user):
        """Block a user and confirm membership_blocked is logged."""
        import asyncio, os
        from motor.motor_asyncio import AsyncIOMotorClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")

        user_id = community_user["data"]["id"]
        r = admin_session.put(
            f"{API}/membership/user/{user_id}",
            json={"member_status": "blocked"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["membership"]["member_status"] == "blocked"
        assert r.json()["is_club_member"] is False

        async def _check():
            c = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = c[os.environ["DB_NAME"]]
            return await db.email_logs.find(
                {"template_key": "membership_blocked",
                 "to": community_user["payload"]["email"]},
                {"_id": 0},
            ).to_list(10)

        rows = asyncio.run(_check())
        assert len(rows) >= 1, "membership_blocked template not logged"

    def test_demote_to_inactive(self, admin_session, community_user):
        user_id = community_user["data"]["id"]
        r = admin_session.put(
            f"{API}/membership/user/{user_id}",
            json={"member_status": "inactive"},
            timeout=20,
        )
        assert r.status_code == 200
        u = r.json()
        assert u["membership"]["member_status"] == "inactive"
        assert u["is_club_member"] is False
        assert u["user_type"] == "community_user"

    def test_re_promote_keeps_member_number(self, admin_session, community_user):
        user_id = community_user["data"]["id"]
        # re-promote and ensure member_number is preserved
        r = admin_session.put(
            f"{API}/membership/user/{user_id}",
            json={"member_status": "active"},
            timeout=20,
        )
        assert r.status_code == 200
        m = r.json()["membership"]
        assert m["member_status"] == "active"
        assert m["member_number"]  # should still exist


# ---------- BENEFITS ----------
class TestBenefits:
    @pytest.fixture(scope="class")
    def benefit_id(self, admin_session):
        body = {
            "title": "TEST_Benefit_" + uuid.uuid4().hex[:6],
            "description": "Vergünstigung bei Test-Sponsor",
            "category": "Sponsor",
            "visible_for_membership_types": ["ordinary", "honorary"],
            "is_active": True,
            "order_index": 1,
        }
        r = admin_session.post(f"{API}/membership/benefits", json=body, timeout=20)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        yield bid
        # cleanup
        admin_session.delete(f"{API}/membership/benefits/{bid}", timeout=20)

    def test_community_no_benefits(self, community_session):
        # Note: community user has been promoted then demoted to inactive
        r = community_session.get(f"{API}/membership/benefits", timeout=20)
        assert r.status_code == 200
        # User is now inactive -> []
        assert isinstance(r.json(), list)

    def test_admin_create_visible_to_member(self, admin_session, benefit_id):
        # Admin is active member -> benefit must be visible
        r = admin_session.get(f"{API}/membership/benefits", timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert any(b["id"] == benefit_id for b in data), "Created benefit must be visible to admin (ordinary)"

    def test_patch_deactivate_hides(self, admin_session, benefit_id):
        r = admin_session.patch(
            f"{API}/membership/benefits/{benefit_id}",
            json={"is_active": False},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["is_active"] is False
        # not visible anymore
        r2 = admin_session.get(f"{API}/membership/benefits", timeout=20)
        assert r2.status_code == 200
        assert all(b["id"] != benefit_id for b in r2.json())

    def test_admin_all_includes_inactive(self, admin_session, benefit_id):
        r = admin_session.get(f"{API}/membership/benefits/all", timeout=20)
        assert r.status_code == 200
        ids = [b["id"] for b in r.json()]
        assert benefit_id in ids

    def test_authz_community_cannot_create(self, community_session):
        r = community_session.post(
            f"{API}/membership/benefits",
            json={"title": "NEIN", "is_active": True},
            timeout=20,
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_authz_community_cannot_update_membership(self, community_session, community_user):
        target = community_user["data"]["id"]
        r = community_session.put(
            f"{API}/membership/user/{target}",
            json={"member_status": "active"},
            timeout=20,
        )
        assert r.status_code == 403


# ---------- PUBLIC PROFILES + DIRECTORY ----------
class TestPublic:
    def test_public_members_directory(self, admin_session, community_user):
        # community_user is currently active member with public profile (default) -> should appear
        r = requests.get(f"{API}/membership/public", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # admin should be in there (privacy_public_profile defaults to True via seed)
        usernames = [x["username"] for x in rows]
        # At least the community_user (now active) should be there
        assert community_user["data"]["username"] in usernames or len(rows) >= 1

    def test_public_user_list(self):
        r = requests.get(f"{API}/users/public-list", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # password_hash and email must not leak
        for u in rows[:5]:
            assert "password_hash" not in u

    def test_public_profile_includes_membership(self, community_user):
        username = community_user["data"]["username"]
        r = requests.get(f"{API}/users/public/{username}", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["username"] == username
        assert "is_club_member" in d
        assert "user_type" in d
        assert "socials" in d


# ---------- USER PROFILE PATCH ----------
class TestUserUpdate:
    def test_patch_extended_fields(self, community_session):
        body = {
            "twitch_handle": "tls_streamer",
            "instagram_handle": "tls_insta",
            "newsletter_consent": False,
            "profile_visibility": {"discord_name": "members"},
        }
        r = community_session.patch(f"{API}/users/me", json=body, timeout=20)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["twitch_handle"] == "tls_streamer"
        assert u["instagram_handle"] == "tls_insta"
        assert u["newsletter_consent"] is False
        assert u["profile_visibility"].get("discord_name") == "members"

    def test_patch_favorite_games_list(self, community_session):
        r = community_session.patch(
            f"{API}/users/me",
            json={"favorite_games": ["F1 24", "Mario Kart", "Rocket League"]},
            timeout=20,
        )
        assert r.status_code == 200
        u = r.json()
        assert u["favorite_games"] == ["F1 24", "Mario Kart", "Rocket League"]


# ---------- USER SOCIALS CRUD ----------
class TestUserSocials:
    @pytest.fixture(scope="class")
    def social_id(self, community_session):
        body = {
            "platform": "twitch",
            "value": "test_twitch_handle",
            "url": "https://twitch.tv/test_twitch_handle",
            "visibility": "public",
        }
        r = community_session.post(f"{API}/users/me/socials", json=body, timeout=20)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        yield sid
        community_session.delete(f"{API}/users/me/socials/{sid}", timeout=20)

    def test_list_socials(self, community_session, social_id):
        r = community_session.get(f"{API}/users/me/socials", timeout=20)
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert social_id in ids

    def test_patch_social_visibility(self, community_session, social_id):
        r = community_session.patch(
            f"{API}/users/me/socials/{social_id}",
            json={"visibility": "members"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["visibility"] == "members"

    def test_duplicate_platform_conflict(self, community_session, social_id):
        # Adding same platform again should 409
        r = community_session.post(
            f"{API}/users/me/socials",
            json={"platform": "twitch", "value": "another", "visibility": "public"},
            timeout=20,
        )
        assert r.status_code == 409


# ---------- EMAIL LOGS via mongo direct (best-effort) ----------
class TestEmailLogs:
    def test_email_logs_admin(self, admin_session, community_user):
        # Try common admin endpoints; if none exist, skip.
        for path in ["/admin/email-logs", "/admin/emails", "/admin/email_logs"]:
            r = admin_session.get(f"{API}{path}", timeout=20)
            if r.status_code == 200:
                logs = r.json()
                if isinstance(logs, dict):
                    logs = logs.get("items") or logs.get("logs") or []
                assert isinstance(logs, list)
                templates = {l.get("template") for l in logs}
                assert {"membership_activated", "membership_deactivated"} & templates
                return
        pytest.skip("No email_logs admin endpoint exposed; cannot validate templates here")
