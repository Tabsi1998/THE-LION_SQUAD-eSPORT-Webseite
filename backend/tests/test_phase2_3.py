"""Phase 2/3 tests: Settings, Seasons, Widgets, DSGVO, PDF Exports, Audit,
Swiss/Groups generator, Stations assign/clear, F1 time PATCH (proof_url/is_invalid)."""
import time
import pytest
import requests
from conftest import BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_EMAIL, DEMO_PASSWORD


def _new_demo_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    suffix = str(int(time.time() * 1000))
    email = f"TEST_p23_{suffix}@example.com"
    username = f"test_p23_{suffix}"[:30]
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "username": username, "password": "secret123",
        "accept_privacy": True, "display_name": "Phase23 Tester",
    })
    assert r.status_code in (200, 201), r.text
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s, email


# ---------- Settings ----------
class TestSettings:
    def test_public_settings(self, api):
        r = api.get(f"{BASE_URL}/api/settings/public")
        assert r.status_code == 200, r.text
        d = r.json()
        # public-safe keys
        for k in ("club_name", "tagline", "primary_color"):
            assert k in d

    def test_email_settings_admin_only(self, api, admin_client):
        assert api.get(f"{BASE_URL}/api/settings/email").status_code in (401, 403)
        r = admin_client.get(f"{BASE_URL}/api/settings/email")
        assert r.status_code == 200, r.text

    def test_branding_update_creates_audit(self, admin_client):
        # capture before count of branding audit entries
        before = admin_client.get(f"{BASE_URL}/api/audit?action=settings.branding.update").json()
        before_n = len(before)
        new_tagline = f"Tagline_{int(time.time())}"
        r = admin_client.put(f"{BASE_URL}/api/settings/branding",
                             json={"tagline": new_tagline})
        assert r.status_code == 200, r.text
        # verify public surface updates
        pub = requests.get(f"{BASE_URL}/api/settings/public").json()
        assert pub.get("tagline") == new_tagline
        # audit grew
        after = admin_client.get(f"{BASE_URL}/api/audit?action=settings.branding.update").json()
        assert len(after) >= before_n + 1


# ---------- Seasons ----------
class TestSeasons:
    def test_create_list_delete_season(self, admin_client):
        suffix = int(time.time())
        slug = f"test-season-{suffix}"
        r = admin_client.post(f"{BASE_URL}/api/seasons", json={
            "name": f"TEST Season {suffix}", "slug": slug,
            "description": "auto test", "kind": "season",
        })
        assert r.status_code in (200, 201), r.text
        sid = r.json().get("id")
        assert sid
        # list
        lst = admin_client.get(f"{BASE_URL}/api/seasons").json()
        assert any(s.get("slug") == slug for s in lst)
        # get by slug
        detail = admin_client.get(f"{BASE_URL}/api/seasons/{slug}").json()
        assert detail.get("id") == sid
        # delete
        d = admin_client.delete(f"{BASE_URL}/api/seasons/{sid}")
        assert d.status_code in (200, 204)


# ---------- Widgets (no auth) ----------
class TestWidgets:
    def test_tournament_bracket_widget_no_sensitive_fields(self, api):
        slug = "mario-kart-winter-cup"
        r = api.get(f"{BASE_URL}/api/widgets/tournament/{slug}/bracket")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "matches" in data and "registrations" in data
        # sensitive fields excluded from registrations
        for reg in data["registrations"]:
            assert "notes" not in reg
            assert "discord" not in reg
        # and from matches
        for m in data["matches"]:
            assert "admin_note" not in m
            assert "reports" not in m

    def test_f1_leaderboard_widget(self, api):
        r = api.get(f"{BASE_URL}/api/widgets/f1/f1-winter-championship/leaderboard")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "entries" in data
        # proof_url & admin_note not exposed
        for e in data["entries"]:
            assert "proof_url" not in e
            assert "admin_note" not in e


# ---------- DSGVO ----------
class TestDSGVO:
    def test_export_my_data_shape(self):
        s, email = _new_demo_session()
        r = s.get(f"{BASE_URL}/api/dsgvo/export-my-data")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("user", "tournament_registrations", "f1_lap_times", "teams", "email_logs", "exported_at"):
            assert k in d, f"missing key {k}"
        assert d["user"].get("email", "").lower() == email.lower()

    def test_export_requires_auth(self, api):
        r = api.get(f"{BASE_URL}/api/dsgvo/export-my-data")
        assert r.status_code in (401, 403)


# ---------- Audit ----------
class TestAudit:
    def test_audit_admin_only(self, api, admin_client):
        assert api.get(f"{BASE_URL}/api/audit").status_code in (401, 403)
        r = admin_client.get(f"{BASE_URL}/api/audit")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- PDF Exports ----------
class TestPDFExports:
    def _assert_pdf(self, r):
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct.lower(), f"ct={ct}"
        # PDF magic header
        assert r.content[:4] == b"%PDF", f"not pdf bytes: {r.content[:12]!r}"

    def test_participants_pdf(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/exports/tournaments/mario-kart-winter-cup/participants.pdf")
        self._assert_pdf(r)

    def test_checkin_pdf(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/exports/tournaments/mario-kart-winter-cup/checkin.pdf")
        self._assert_pdf(r)

    def test_matches_pdf(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/exports/tournaments/mario-kart-winter-cup/matches.pdf")
        self._assert_pdf(r)

    def test_station_signs_pdf(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/exports/tournaments/mario-kart-winter-cup/stations.pdf")
        self._assert_pdf(r)

    def test_station_signs_pdf_landscape(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/exports/tournaments/mario-kart-winter-cup/stations.pdf?orientation=landscape")
        self._assert_pdf(r)

    def test_standings_pdf(self, admin_client):
        # public endpoint (no admin required)
        r = admin_client.get(f"{BASE_URL}/api/exports/tournaments/mario-kart-winter-cup/standings.pdf")
        self._assert_pdf(r)

    def test_f1_leaderboard_pdf(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/exports/f1/f1-winter-championship/leaderboard.pdf")
        self._assert_pdf(r)


# ---------- Stations ----------
class TestStations:
    def test_list_stations_admin(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/stations")
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_create_update_delete_station(self, admin_client):
        name = f"TEST-Station-{int(time.time())}"
        r = admin_client.post(f"{BASE_URL}/api/stations", json={
            "name": name, "device_type": "pc",
        })
        assert r.status_code in (200, 201), r.text
        sid = r.json().get("id")
        assert sid
        # patch status
        p = admin_client.patch(f"{BASE_URL}/api/stations/{sid}", json={"status": "busy"})
        assert p.status_code == 200
        assert p.json().get("status") == "busy"
        # delete
        d = admin_client.delete(f"{BASE_URL}/api/stations/{sid}")
        assert d.status_code in (200, 204)


# ---------- F1 Time PATCH (is_invalid/proof_url) ----------
class TestF1TimePatch:
    def test_patch_time_sets_invalid_and_proof(self, admin_client, api):
        ch = api.get(f"{BASE_URL}/api/f1/challenges/f1-winter-championship").json()
        cid = ch["id"]
        times = admin_client.get(f"{BASE_URL}/api/f1/challenges/{cid}/times").json()
        if not times:
            pytest.skip("No F1 lap times exist to patch")
        tid = times[0].get("id")
        original_invalid = times[0].get("is_invalid", False)
        # Patch
        r = admin_client.patch(f"{BASE_URL}/api/f1/times/{tid}", json={
            "is_invalid": True,
            "proof_url": "https://example.com/proof.mp4",
            "admin_note": "TEST flagged",
        })
        assert r.status_code == 200, r.text
        # Verify via GET - leaderboard excludes invalid, so re-read times
        times2 = admin_client.get(f"{BASE_URL}/api/f1/challenges/{cid}/times").json()
        flagged = next((t for t in times2 if t.get("id") == tid), None)
        assert flagged is not None
        assert flagged.get("is_invalid") is True
        assert flagged.get("proof_url") == "https://example.com/proof.mp4"
        # revert
        admin_client.patch(f"{BASE_URL}/api/f1/times/{tid}", json={
            "is_invalid": original_invalid, "proof_url": None, "admin_note": None,
        })


# ---------- Swiss / Groups ----------
class TestSwissGroups:
    def _get_tid(self, api, slug):
        return api.get(f"{BASE_URL}/api/tournaments/{slug}").json()["id"]

    def test_swiss_next_round_rejects_non_swiss(self, admin_client, api):
        """mario-kart-winter-cup is single_elim - swiss/next-round should reject or 400."""
        tid = self._get_tid(api, "mario-kart-winter-cup")
        r = admin_client.post(f"{BASE_URL}/api/tournaments/{tid}/swiss/next-round")
        # Expect 400 or 409 because format != swiss
        assert r.status_code in (400, 403, 404, 409, 422), f"unexpected {r.status_code}: {r.text[:200]}"

    def test_groups_generate_rejects_non_groups(self, admin_client, api):
        tid = self._get_tid(api, "mario-kart-winter-cup")
        r = admin_client.post(f"{BASE_URL}/api/tournaments/{tid}/groups/generate")
        assert r.status_code in (400, 403, 404, 409, 422), f"unexpected {r.status_code}: {r.text[:200]}"
