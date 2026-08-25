"""Iteration 6: Google OAuth session endpoint guards + seeded gallery content."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

TOURNAMENT_ID = "ed1ec3cb-08b8-4ea3-8cd1-3da539e3a90f"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Google auth endpoint guards ---
class TestGoogleSession:
    def test_missing_session_id(self, client):
        r = client.post(f"{API}/auth/google/session", json={})
        assert r.status_code == 400, r.text
        assert "session_id" in r.json().get("detail", "")

    def test_bogus_session_id(self, client):
        r = client.post(f"{API}/auth/google/session", json={"session_id": "bogus-not-real"})
        assert r.status_code == 401, r.text
        assert "Google" in r.json().get("detail", "")

    def test_no_cookies_issued_on_failure(self, client):
        s = requests.Session()
        s.post(f"{API}/auth/google/session", json={"session_id": "bogus2"})
        assert "access_token" not in s.cookies


# --- Gallery public API ---
class TestGallery:
    def test_gallery_list(self, client):
        r = client.get(f"{API}/gallery?compact=true&limit=80")
        assert r.status_code == 200
        albums = r.json()
        assert isinstance(albums, list) and len(albums) >= 2
        slugs = {a["slug"] for a in albums}
        assert "winter-cup-2026-highlights" in slugs
        assert "lan-night-vol-7" in slugs
        for a in albums:
            assert "_id" not in a
            assert a.get("cover_url"), f"album {a['slug']} has no cover_url"

    @pytest.mark.parametrize("slug", ["winter-cup-2026-highlights", "lan-night-vol-7"])
    def test_album_detail(self, client, slug):
        r = client.get(f"{API}/gallery/{slug}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "_id" not in data
        assert data["slug"] == slug
        photos = data.get("photos") or []
        assert len(photos) >= 4, f"{slug} has {len(photos)} photos"
        for p in photos:
            assert p.get("image_url"), p
            # iteration 7: seed intentionally ships NO width/height; the frontend measures
            # naturalWidth/Height at runtime (see GalleryAlbumPage.itemRatio).
            assert not p.get("width") and not p.get("height"), f"stale fabricated dimensions: {p.get('id')}"

    def test_album_images_reachable(self, client):
        r = client.get(f"{API}/gallery/winter-cup-2026-highlights")
        urls = [p["image_url"] for p in r.json()["photos"]]
        for url in urls:
            if url.startswith("http"):
                head = requests.get(url, stream=True, timeout=20)
                assert head.status_code == 200, f"{url} -> {head.status_code}"

    def test_unknown_album_404(self, client):
        r = client.get(f"{API}/gallery/does-not-exist-xyz")
        assert r.status_code == 404


# --- Regression: achievement catalog tier rename ---
class TestAchievementCatalog:
    def test_sturmreihe_tier(self, client):
        r = client.get(f"{API}/achievements/groups")
        assert r.status_code == 200, r.text
        groups = r.json()
        tiers = [t for g in groups for t in (g.get("tiers") or [])]
        target = [t for t in tiers if t.get("code") == "win_streak_p"]
        assert target, f"win_streak_p tier missing (found {len(tiers)} tiers)"
        assert target[0].get("name") == "Sturmreihe", target[0]
        # Ensure the old name is gone from win_streak group
        ws = [t.get("name") for t in tiers if t.get("group_code") == "win_streak"]
        assert "Legendär" not in ws, ws

    def test_taxonomy_sections(self, client):
        r = client.get(f"{API}/achievements/groups")
        groups = r.json()
        by_code = {g.get("code"): g for g in groups}
        assert "stream_growth" in by_code or any("Stream" in (g.get("name") or "") for g in groups), \
            [g.get("code") for g in groups]
        for g in groups:
            assert "_id" not in g


# --- Regression: bracket data for TV page ---
class TestBracket:
    def test_bracket_loads(self, client):
        r = client.get(f"{API}/tournaments/{TOURNAMENT_ID}/bracket")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data, "empty bracket"
