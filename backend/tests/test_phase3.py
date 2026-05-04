"""Phase 3 tests: Featured season, Discord settings, sponsors seed."""
import pytest


# ---- Sponsors seed ----
class TestSponsors:
    def test_sponsors_seed_three(self, api, base_url):
        r = api.get(f"{base_url}/api/sponsors")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        names = {s.get("name") for s in data}
        # required seeded sponsors
        for required in ["Löwen Energy", "Pixel Arena Hardware", "Vienna eSports Hub"]:
            assert required in names, f"missing seeded sponsor {required}; got {names}"
        assert len(data) >= 3


# ---- Featured Season (public) ----
class TestFeaturedSeason:
    def test_featured_active_season(self, api, base_url):
        r = api.get(f"{base_url}/api/seasons/active/featured")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "season" in body and "standings" in body
        s = body["season"]
        assert s is not None, "expected a seeded active season"
        # Slug from agent context
        assert s.get("slug") == "season-2026" or "2026" in (s.get("name") or "")
        assert isinstance(body["standings"], list)
        assert len(body["standings"]) <= 5

    def test_featured_standings_shape(self, api, base_url):
        r = api.get(f"{base_url}/api/seasons/active/featured")
        body = r.json()
        for entry in body.get("standings", []):
            assert "rank" in entry
            assert "points" in entry
            assert "display_name" in entry


# ---- Discord settings (admin) ----
class TestDiscordSettings:
    def test_discord_get_requires_admin(self, api, base_url):
        r = api.get(f"{base_url}/api/settings/discord")
        assert r.status_code in (401, 403), f"expected auth required, got {r.status_code}"

    def test_discord_get_admin(self, admin_client, base_url):
        r = admin_client.get(f"{base_url}/api/settings/discord")
        assert r.status_code == 200, r.text
        data = r.json()
        # masked or empty
        assert "webhook_url" not in data or data.get("webhook_url_masked")
        assert "configured" in data

    def test_discord_put_persists_and_audits(self, admin_client, base_url):
        # Save without webhook to avoid actually triggering anything
        payload = {
            "username": "TLS Bot Test",
            "avatar_url": "https://example.com/avatar.png",
            "enabled": True,
            "webhook_url": "",
        }
        r = admin_client.put(f"{base_url}/api/settings/discord", json=payload)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify persistence via GET
        g = admin_client.get(f"{base_url}/api/settings/discord")
        assert g.status_code == 200
        d = g.json()
        assert d.get("username") == "TLS Bot Test"
        assert d.get("avatar_url") == "https://example.com/avatar.png"
        assert d.get("enabled") is True

        # Audit log entry
        a = admin_client.get(f"{base_url}/api/audit?action=settings.discord.update")
        assert a.status_code == 200
        actions = [x.get("action") for x in a.json()]
        assert any("settings.discord.update" in (x or "") for x in actions)

    def test_discord_rejects_invalid_webhook(self, admin_client, base_url):
        r = admin_client.put(
            f"{base_url}/api/settings/discord",
            json={"webhook_url": "https://example.com/not-discord", "enabled": True},
        )
        assert r.status_code == 400

    def test_discord_can_clear_webhook(self, admin_client, base_url):
        r = admin_client.put(f"{base_url}/api/settings/discord", json={"clear_webhook": True})
        assert r.status_code == 200
        g = admin_client.get(f"{base_url}/api/settings/discord")
        assert g.status_code == 200
        assert g.json().get("configured") is False

    def test_discord_test_disabled_when_no_webhook(self, admin_client, base_url):
        # Ensure webhook is empty (we did not save one above)
        r = admin_client.post(f"{base_url}/api/settings/discord/test")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is False
        assert body.get("reason") == "disabled"

    def test_discord_test_requires_admin(self, api, base_url):
        r = api.post(f"{base_url}/api/settings/discord/test")
        assert r.status_code in (401, 403)
