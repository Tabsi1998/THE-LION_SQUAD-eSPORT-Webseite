"""Phase 8 + 9 + 10 backend tests using requests against the running server.

Run with: pytest backend/tests/test_phase_8_9_10.py -v
"""
import time

# Note: admin_client fixture comes from conftest.py


def test_smtp_settings_roundtrip(admin_client, base_url):
    r = admin_client.get(f"{base_url}/api/settings/smtp")
    assert r.status_code == 200
    body = r.json()
    assert "provider" in body

    payload = {
        "provider": "smtp", "smtp_host": "mail.example.com", "smtp_port": 587,
        "smtp_user": "u", "smtp_pass": "secretpass", "smtp_security": "starttls",
        "sender_name": "TLS Test", "sender_email": "test@thelionsquad.at",
        "enabled": True,
    }
    r = admin_client.put(f"{base_url}/api/settings/smtp", json=payload)
    assert r.status_code == 200

    r = admin_client.get(f"{base_url}/api/settings/smtp")
    body = r.json()
    assert body["smtp_host"] == "mail.example.com"
    assert "smtp_pass" not in body
    assert "smtp_pass_masked" in body


def test_mail_queue_endpoints(admin_client, base_url):
    # ensure queue endpoint works
    r = admin_client.get(f"{base_url}/api/settings/mail-queue?limit=5")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_setup_status(admin_client, base_url):
    r = admin_client.get(f"{base_url}/api/setup/status")
    assert r.status_code == 200
    s = r.json()
    for k in ("completed", "has_admin", "has_branding", "has_email"):
        assert k in s


def test_setup_complete_idempotent(admin_client, base_url):
    payload = {"club_name": "THE LION SQUAD", "tagline": "eSports"}
    r = admin_client.post(f"{base_url}/api/setup/complete", json=payload)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_sitemap(api, base_url):
    r = api.get(f"{base_url}/api/sitemap.xml")
    assert r.status_code == 200
    assert "urlset" in r.text
    assert "<loc>" in r.text


def test_prizes_crud(admin_client, base_url):
    # Get admin user id from auth/me
    r = admin_client.get(f"{base_url}/api/auth/me")
    assert r.status_code == 200
    uid = r.json()["id"]

    # cleanup test prize
    r = admin_client.get(f"{base_url}/api/prizes")
    for p in r.json():
        if p.get("prize_label") == "TEST_PRIZE_X":
            admin_client.delete(f"{base_url}/api/prizes/{p['id']}")

    payload = {
        "tournament_id": "fake-tournament-1",
        "user_id": uid,
        "place": 1,
        "prize_label": "TEST_PRIZE_X",
        "prize_value": "100€",
    }
    r = admin_client.post(f"{base_url}/api/prizes", json=payload)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]

    r = admin_client.get(f"{base_url}/api/prizes")
    assert r.status_code == 200
    assert any(p["id"] == pid for p in r.json())

    # status filter
    r = admin_client.get(f"{base_url}/api/prizes?status=pending")
    assert any(p["id"] == pid for p in r.json())

    # ready
    r = admin_client.patch(f"{base_url}/api/prizes/{pid}", json={"status": "ready"})
    assert r.status_code == 200
    assert r.json()["status"] == "ready"

    # me
    r = admin_client.get(f"{base_url}/api/prizes/me")
    assert any(p["id"] == pid for p in r.json())

    r = admin_client.get(f"{base_url}/api/prizes/me/open-count")
    assert r.json()["count"] >= 1

    # picked_up
    r = admin_client.patch(f"{base_url}/api/prizes/{pid}", json={"status": "picked_up", "notes": "ok"})
    assert r.status_code == 200
    assert r.json()["status"] == "picked_up"

    # delete
    r = admin_client.delete(f"{base_url}/api/prizes/{pid}")
    assert r.status_code == 200


def test_prizes_unauthorized(api, base_url):
    """Without auth, admin prizes endpoints reject."""
    r = api.get(f"{base_url}/api/prizes")
    assert r.status_code in (401, 403)
    r = api.get(f"{base_url}/api/prizes/me")
    assert r.status_code in (401, 403)
