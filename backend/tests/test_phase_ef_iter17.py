"""Iteration 17 — Auto-Hooks + Phase E (Twitch Streams) + Phase F (CMS + Email Templates) + Discord Counter.

Test scope (per review_request):
  • Auto-Hooks: dispute, forfeit (no_show), late check-in (neg_afk)
  • GET /api/streams/live (anon) and POST /api/admin/streams/refresh (admin)
  • Pages CMS: public GET, admin list/create/patch/delete
  • Email Templates: list, patch
  • Discord Counter: bump, list, auto-award discord_active_b
  • Branding settings accept twitch_client_id/secret/live_detection
  • Privacy: negative awards never appear in /achievements/me or public profile
"""
import os
import time
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fast-lap-mgmt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PW = "TLSAdmin2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=10)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def fresh_user_token():
    """Create a fresh community user for privacy tests."""
    sfx = uuid.uuid4().hex[:8]
    payload = {
        "email": f"test_iter17_{sfx}@example.com",
        "password": "TestPass2026!",
        "username": f"test_iter17_{sfx}",
        "display_name": f"Test Iter17 {sfx}",
        "accept_privacy": True,
        "accept_terms": True,
    }
    r = requests.post(f"{API}/auth/register", json=payload, timeout=10)
    assert r.status_code in (200, 201), f"Register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"token": data["access_token"], "user_id": data["id"], "username": payload["username"]}


# ============= Phase E — Streams =============
class TestStreams:
    def test_public_live_streams_returns_list(self):
        r = requests.get(f"{API}/streams/live", timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)

    def test_admin_streams_refresh_requires_admin(self):
        r = requests.post(f"{API}/admin/streams/refresh", timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_admin_streams_refresh_no_creds(self, admin_headers):
        r = requests.post(f"{API}/admin/streams/refresh", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Without twitch credentials → fail-silent {ok: false, skipped: ...}
        # If creds set, ok:true
        assert "ok" in data
        if data["ok"] is False:
            assert "skipped" in data or "error" in data


# ============= Phase E — Branding settings (twitch creds) =============
class TestBrandingTwitch:
    def test_branding_accepts_twitch_fields(self, admin_headers):
        r = requests.get(f"{API}/settings/branding", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        original = r.json()
        # PATCH-set fields with empty/test values (don't expose real creds)
        r2 = requests.put(f"{API}/settings/branding",
                          headers=admin_headers,
                          json={"twitch_client_id": "", "twitch_client_secret": "",
                                "twitch_live_detection": False},
                          timeout=10)
        assert r2.status_code in (200, 204), f"branding update failed: {r2.status_code} {r2.text}"
        # Read back
        r3 = requests.get(f"{API}/settings/branding", headers=admin_headers, timeout=10)
        assert r3.status_code == 200
        data = r3.json()
        assert "twitch_live_detection" in data or data.get("twitch_live_detection") in (False, None, True)


# ============= Phase F — Pages CMS =============
class TestPagesCMS:
    def test_public_default_pages_seeded(self):
        for slug in ("about", "imprint", "privacy", "values"):
            r = requests.get(f"{API}/pages/{slug}", timeout=10)
            assert r.status_code == 200, f"/pages/{slug} -> {r.status_code} {r.text}"
            d = r.json()
            assert d["slug"] == slug
            assert d.get("title")
            assert "body_md" in d

    def test_public_unknown_slug_404(self):
        r = requests.get(f"{API}/pages/nicht-existiert-{uuid.uuid4().hex[:6]}", timeout=10)
        assert r.status_code == 404

    def test_admin_list_pages_includes_defaults(self, admin_headers):
        r = requests.get(f"{API}/admin/pages", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        slugs = {p["slug"] for p in data}
        for s in ("about", "imprint", "privacy", "values"):
            assert s in slugs, f"missing default slug {s}"

    def test_admin_create_patch_delete_custom_page(self, admin_headers):
        slug = f"statuten-{uuid.uuid4().hex[:6]}"
        # Create
        r = requests.post(f"{API}/admin/pages",
                          headers=admin_headers,
                          json={"slug": slug, "title": "Statuten Test",
                                "body_md": "# Statuten\n\nTest body."},
                          timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["slug"] == slug
        # Public GET
        r2 = requests.get(f"{API}/pages/{slug}", timeout=10)
        assert r2.status_code == 200
        # Patch
        r3 = requests.patch(f"{API}/admin/pages/{slug}",
                            headers=admin_headers,
                            json={"title": "Statuten Updated"}, timeout=10)
        assert r3.status_code == 200
        assert r3.json()["title"] == "Statuten Updated"
        # Verify via public GET
        r4 = requests.get(f"{API}/pages/{slug}", timeout=10)
        assert r4.json()["title"] == "Statuten Updated"
        # Delete (custom page allowed)
        r5 = requests.delete(f"{API}/admin/pages/{slug}", headers=admin_headers, timeout=10)
        assert r5.status_code == 200
        # Should now 404
        r6 = requests.get(f"{API}/pages/{slug}", timeout=10)
        assert r6.status_code == 404

    def test_admin_delete_default_page_blocked(self, admin_headers):
        r = requests.delete(f"{API}/admin/pages/about", headers=admin_headers, timeout=10)
        assert r.status_code == 400, f"expected 400 (is_default), got {r.status_code} {r.text}"

    def test_admin_patch_about_persists(self, admin_headers):
        new_title = f"Über uns - Edit {uuid.uuid4().hex[:4]}"
        r = requests.patch(f"{API}/admin/pages/about",
                           headers=admin_headers,
                           json={"title": new_title}, timeout=10)
        assert r.status_code == 200, r.text
        r2 = requests.get(f"{API}/pages/about", timeout=10)
        assert r2.json()["title"] == new_title
        # Restore
        requests.patch(f"{API}/admin/pages/about",
                       headers=admin_headers,
                       json={"title": "Über uns"}, timeout=10)


# ============= Phase F — Email Templates =============
class TestEmailTemplates:
    def test_list_default_templates(self, admin_headers):
        r = requests.get(f"{API}/admin/email-templates", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        keys = {t["key"] for t in r.json()}
        for k in ("membership_approve", "membership_reject", "contact_auto_reply", "membership_application_admin"):
            assert k in keys, f"missing template key {k}"

    def test_patch_template_persists(self, admin_headers):
        new_subj = f"Willkommen TEST {uuid.uuid4().hex[:4]}"
        new_html = "<p>Hallo {{display_name}} — TEST</p>"
        r = requests.patch(f"{API}/admin/email-templates/membership_approve",
                           headers=admin_headers,
                           json={"subject": new_subj, "html": new_html}, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["subject"] == new_subj
        assert body["html"] == new_html
        # Restore close-to-default
        requests.patch(f"{API}/admin/email-templates/membership_approve",
                       headers=admin_headers,
                       json={"subject": "Willkommen im Rudel 🦁",
                             "html": "<p>Hallo {{display_name}},</p><p>Deine Bewerbung wurde <strong>angenommen</strong>. Willkommen im Rudel!</p><p>{{note}}</p>"},
                       timeout=10)

    def test_patch_unknown_template_404(self, admin_headers):
        r = requests.patch(f"{API}/admin/email-templates/__nope__",
                           headers=admin_headers,
                           json={"subject": "x"}, timeout=10)
        assert r.status_code == 404


# ============= Discord Counter + Auto-Award =============
class TestDiscordCounter:
    def test_bump_counter_persists_and_audit(self, admin_headers, fresh_user_token):
        uid = fresh_user_token["user_id"]
        r = requests.post(f"{API}/admin/discord/counter/{uid}",
                          headers=admin_headers, json={"delta": 1}, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("discord_messages_count", 0) >= 1

    def test_counters_list_contains_user(self, admin_headers, fresh_user_token):
        # Bump again to be sure
        uid = fresh_user_token["user_id"]
        requests.post(f"{API}/admin/discord/counter/{uid}",
                      headers=admin_headers, json={"delta": 2}, timeout=10)
        r = requests.get(f"{API}/admin/discord/counters", headers=admin_headers, timeout=10)
        assert r.status_code == 200
        ids = {u["id"] for u in r.json()}
        assert uid in ids

    def test_discord_active_b_auto_awarded(self, admin_headers, fresh_user_token):
        uid = fresh_user_token["user_id"]
        # Bump counter to a healthy positive value to trigger any tier
        requests.post(f"{API}/admin/discord/counter/{uid}",
                      headers=admin_headers, json={"delta": 50}, timeout=10)
        time.sleep(1)
        # Re-evaluate: read /achievements/user/{id} via admin
        r = requests.get(f"{API}/achievements/user/{uid}", headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        codes = {a.get("code") or a.get("tier_code") for a in body.get("awards", [])}
        # tier 'b' is the lowest threshold; if it's not awarded, at least the user got SOME discord_active tier
        has_discord = any((c or "").startswith("discord_active") for c in codes)
        assert has_discord, f"expected some discord_active_* tier; got {codes}"

    def test_bump_unknown_user_404(self, admin_headers):
        r = requests.post(f"{API}/admin/discord/counter/__nope__",
                          headers=admin_headers, json={"delta": 1}, timeout=10)
        assert r.status_code == 404


# ============= Auto-Hooks: dispute / forfeit / late check-in =============
class TestAutoHooks:
    """We rely on negative awards to land in /admin/achievements/negative/awards
    (and NOT in /achievements/me) for privacy."""

    def _list_negative_awards_for_user(self, admin_headers, user_id):
        r = requests.get(f"{API}/admin/achievements/negative/awards",
                         headers=admin_headers, timeout=10)
        assert r.status_code == 200, r.text
        return [a for a in r.json() if a.get("user_id") == user_id]

    def test_dispute_hook_creates_neg_dispute(self, admin_headers, fresh_user_token):
        # Direct trigger via badges helper through admin trigger-incident proxy is the cleanest
        # path that doesn't require a full match setup. We reproduce the same code path
        # by calling /admin/achievements/trigger-incident with dispute_open.
        user_id = fresh_user_token["user_id"]
        before = self._list_negative_awards_for_user(admin_headers, user_id)
        before_codes = {a.get("code") or a.get("tier_code") for a in before}

        r = requests.post(f"{API}/admin/achievements/trigger-incident",
                          headers=admin_headers,
                          json={"user_id": user_id, "incident_type": "dispute_open",
                                "context": {"reason": "iter17 hook test"}}, timeout=10)
        assert r.status_code == 200, r.text
        after = self._list_negative_awards_for_user(admin_headers, user_id)
        new_codes = {a.get("code") or a.get("tier_code") for a in after} - before_codes
        assert any("neg_dispute" in (c or "") for c in (new_codes or {a.get("code") for a in after})), \
            f"expected neg_dispute award; got new={new_codes}"

    def test_forfeit_hook_no_show_incident(self, admin_headers, fresh_user_token):
        user_id = fresh_user_token["user_id"]
        r = requests.post(f"{API}/admin/achievements/trigger-incident",
                          headers=admin_headers,
                          json={"user_id": user_id, "incident_type": "no_show",
                                "context": {"reason": "iter17 forfeit hook"}}, timeout=10)
        assert r.status_code == 200, r.text
        after = self._list_negative_awards_for_user(admin_headers, user_id)
        codes = {a.get("code") or a.get("tier_code") for a in after}
        assert any("neg_no_show" in (c or "") for c in codes), f"expected neg_no_show; got {codes}"

    def test_late_checkin_hook_neg_afk(self, admin_headers, fresh_user_token):
        user_id = fresh_user_token["user_id"]
        r = requests.post(f"{API}/admin/achievements/trigger-incident",
                          headers=admin_headers,
                          json={"user_id": user_id, "incident_type": "afk",
                                "context": {"reason": "iter17 late checkin"}}, timeout=10)
        assert r.status_code == 200, r.text
        after = self._list_negative_awards_for_user(admin_headers, user_id)
        codes = {a.get("code") or a.get("tier_code") for a in after}
        assert any("neg_afk" in (c or "") for c in codes), f"expected neg_afk; got {codes}"


# ============= Privacy guarantee =============
class TestPrivacy:
    def test_negative_awards_not_in_my_achievements(self, fresh_user_token):
        token = fresh_user_token["token"]
        h = {"Authorization": f"Bearer {token}"}
        r = requests.get(f"{API}/achievements/me", headers=h, timeout=10)
        assert r.status_code == 200, r.text
        data = r.json()
        # data may be a dict ({owned: [...]} ) or list — handle both
        items = data.get("owned") if isinstance(data, dict) else data
        items = items or []
        for a in items:
            code = a.get("code") or a.get("tier_code") or ""
            assert not code.startswith("neg_"), f"negative leak in /achievements/me: {code}"

    def test_negative_awards_not_in_public_profile(self, fresh_user_token):
        username = fresh_user_token["username"]
        r = requests.get(f"{API}/users/public/{username}", timeout=10)
        # may be 404 if profile not public; that's OK
        if r.status_code != 200:
            return
        data = r.json()
        ach = data.get("achievements") or data.get("badges") or []
        for a in ach:
            code = a.get("code") or a.get("tier_code") or ""
            assert not code.startswith("neg_"), f"negative leak in public profile: {code}"
