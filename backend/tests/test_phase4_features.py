"""Phase 4 - Feature Batch tests: prize_places, twitch fields, real events seed,
PDF exports (F1 leaderboard + championship), public settings (discord/twitch), Discord triggers."""
import time
import pytest
import requests
from conftest import BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD


# ============= Real-event seed =============
class TestSeededEvents:
    def test_tournaments_contain_real_events(self, api):
        r = api.get(f"{BASE_URL}/api/tournaments")
        assert r.status_code == 200, r.text
        slugs = {t.get("slug") for t in r.json()}
        for s in ["mario-kart-gamers-heaven-juni",
                  "smash-gamers-heaven-juni",
                  "mario-kart-masters-september"]:
            assert s in slugs, f"missing slug {s}; got={slugs}"

    def test_f1_challenges_contain_real_events(self, api):
        r = api.get(f"{BASE_URL}/api/f1/challenges")
        assert r.status_code == 200, r.text
        slugs = {c.get("slug") for c in r.json()}
        for s in ["f1-fast-lap-gamers-heaven-samstag",
                  "f1-fast-lap-gamers-heaven-sonntag"]:
            assert s in slugs, f"missing F1 slug {s}; got={slugs}"


# ============= Public Settings =============
class TestPublicSettings:
    def test_public_settings_has_discord_twitch_defaults(self, api):
        r = api.get(f"{BASE_URL}/api/settings/public")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "discord_invite_url" in data
        assert "twitch_channel" in data
        # Must have at least default values
        assert data["discord_invite_url"], "discord_invite_url should not be empty"
        assert data["twitch_channel"], "twitch_channel should not be empty"


# ============= Tournament create with prize_places + twitch =============
class TestTournamentCreateNewFields:
    def test_create_tournament_with_prize_and_twitch(self, admin_client, api):
        # Ensure we have a game
        games = api.get(f"{BASE_URL}/api/games").json()
        assert games
        gid = games[0]["id"]
        slug = f"test-prize-twitch-{int(time.time())}"
        payload = {
            "title": "TEST Prize+Twitch",
            "slug": slug,
            "game_id": gid,
            "format": "single_elim",
            "team_mode": "solo",
            "max_participants": 8,
            "prize_places": [
                {"place": 1, "label": "1. Platz", "value": "100€ + Pokal"},
                {"place": 2, "label": "2. Platz", "value": "50€"},
                {"place": 3, "label": "3. Platz", "value": "25€"},
            ],
            "twitch_channel": "the_lion_squad_esports",
            "twitch_enabled": True,
        }
        r = admin_client.post(f"{BASE_URL}/api/tournaments", json=payload)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        tid = body["id"]
        # Verify persistence
        g = api.get(f"{BASE_URL}/api/tournaments/{slug}")
        assert g.status_code == 200
        d = g.json()
        assert isinstance(d.get("prize_places"), list) and len(d["prize_places"]) == 3
        assert d["prize_places"][0]["place"] == 1
        assert d["prize_places"][0]["value"] == "100€ + Pokal"
        assert d.get("twitch_channel") == "the_lion_squad_esports"
        assert d.get("twitch_enabled") is True
        # cleanup
        admin_client.delete(f"{BASE_URL}/api/tournaments/{tid}")


# ============= F1 challenge create with prize_places + twitch =============
class TestF1CreateNewFields:
    def test_create_f1_with_prize_and_twitch(self, admin_client, api):
        slug = f"test-f1-prize-{int(time.time())}"
        payload = {
            "title": "TEST F1 Prize+Twitch",
            "slug": slug,
            "is_championship": False,
            "prize_places": [
                {"place": 1, "label": "Pole", "value": "Pokal"},
                {"place": 2, "label": "P2", "value": "Medaille"},
            ],
            "twitch_channel": "the_lion_squad_esports",
            "twitch_enabled": True,
        }
        r = admin_client.post(f"{BASE_URL}/api/f1/challenges", json=payload)
        assert r.status_code in (200, 201), r.text
        cid = r.json()["id"]
        g = api.get(f"{BASE_URL}/api/f1/challenges/{cid}")
        assert g.status_code == 200
        d = g.json()
        assert isinstance(d.get("prize_places"), list) and len(d["prize_places"]) == 2
        assert d["prize_places"][0]["value"] == "Pokal"
        assert d.get("twitch_channel") == "the_lion_squad_esports"
        assert d.get("twitch_enabled") is True
        admin_client.delete(f"{BASE_URL}/api/f1/challenges/{cid}")


# ============= PDF exports =============
class TestPDFExports:
    def test_f1_leaderboard_pdf(self, api):
        chs = api.get(f"{BASE_URL}/api/f1/challenges").json()
        assert chs
        # Find one with a track
        for ch in chs:
            cid = ch["id"]
            full = api.get(f"{BASE_URL}/api/f1/challenges/{cid}").json()
            tracks = full.get("tracks") or []
            if tracks:
                track_id = tracks[0]["id"]
                r = api.get(
                    f"{BASE_URL}/api/exports/f1/{cid}/leaderboard.pdf",
                    params={"track_id": track_id},
                )
                assert r.status_code == 200, f"status {r.status_code}: {r.text[:200]}"
                ct = r.headers.get("content-type", "")
                assert "pdf" in ct.lower(), f"content-type={ct}"
                assert r.content[:4] == b"%PDF", "not a PDF body"
                return
        pytest.skip("No F1 challenge with tracks available")

    def test_f1_championship_pdf_for_any_challenge(self, api):
        """Championship PDF should not crash even for non-championship challenges."""
        chs = api.get(f"{BASE_URL}/api/f1/challenges").json()
        assert chs
        # pick any (not necessarily championship)
        cid = chs[0]["id"]
        r = api.get(f"{BASE_URL}/api/exports/f1/{cid}/championship.pdf")
        assert r.status_code == 200, f"status {r.status_code}: {r.text[:200]}"
        assert "pdf" in r.headers.get("content-type", "").lower()
        assert r.content[:4] == b"%PDF"


# ============= Discord trigger on set-status (no real webhook) =============
class TestDiscordTriggers:
    def test_set_status_does_not_crash_when_webhook_not_configured(self, admin_client, api):
        # Use any seeded tournament
        tours = api.get(f"{BASE_URL}/api/tournaments").json()
        if not tours:
            pytest.skip("no tournaments seeded")
        tid = tours[0]["id"]
        prev_status = tours[0].get("status", "draft")
        # toggle to registration_open then back
        r1 = admin_client.post(f"{BASE_URL}/api/tournaments/{tid}/status",
                               json={"status": "registration_open"})
        assert r1.status_code in (200, 201), r1.text
        # restore
        admin_client.post(f"{BASE_URL}/api/tournaments/{tid}/status",
                          json={"status": prev_status})
