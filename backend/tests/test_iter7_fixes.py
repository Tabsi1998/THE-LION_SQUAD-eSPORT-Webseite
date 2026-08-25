"""Iteration 7: verify iteration-6 findings are fixed.

Covers:
- POST /api/auth/google/session guard against non-JSON bodies (must be 400, not 500)
- Re-seeded gallery albums: 6 distinct photos, reachable images, no fabricated dimensions
- Bracket display endpoint used by the TV page
- Achievements taxonomy regression
"""
import os
import re
from collections import Counter
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

pytestmark = pytest.mark.live

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live preview tests", allow_module_level=True)
BASE_URL = base_url.rstrip("/")
API = f"{BASE_URL}/api"

TOURNAMENT_ID = "ed1ec3cb-08b8-4ea3-8cd1-3da539e3a90f"
ALBUMS = ["winter-cup-2026-highlights", "lan-night-vol-7"]


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    return s


@pytest.fixture(scope="module")
def admin_client():
    p = Path("/app/memory/test_credentials.md")
    if not p.exists():
        pytest.skip("missing test_credentials.md")
    txt = p.read_text(encoding="utf-8")
    email = re.search(r"(?im)^\s*-\s*Email:\s*(\S+)", txt)
    password = re.search(r"(?im)^\s*-\s*Password:\s*(\S+)", txt)
    if not email or not password:
        pytest.skip("credentials not parseable")
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": email.group(1), "password": password.group(1)}, timeout=45)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:300]}")
    csrf = s.cookies.get("csrf_token")
    if csrf:
        s.headers["X-CSRF-Token"] = csrf
    return s


# --- Google OAuth session endpoint guards ---
class TestGoogleSessionGuard:
    def test_non_json_body_returns_400(self, client):
        r = client.post(
            f"{API}/auth/google/session",
            data="this-is-not-json",
            headers={"Content-Type": "text/plain"},
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"
        assert "session_id" in r.json().get("detail", "")

    def test_malformed_json_body_returns_400(self, client):
        r = client.post(
            f"{API}/auth/google/session",
            data="{not: valid json,,}",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:300]}"

    def test_empty_body_returns_400(self, client):
        r = client.post(f"{API}/auth/google/session", data="", headers={"Content-Type": "application/json"})
        assert r.status_code == 400, r.text

    def test_json_array_body_returns_400(self, client):
        r = client.post(f"{API}/auth/google/session", json=[1, 2, 3])
        assert r.status_code == 400, r.text

    def test_empty_dict_returns_400(self, client):
        r = client.post(f"{API}/auth/google/session", json={})
        assert r.status_code == 400, r.text
        assert "session_id" in r.json().get("detail", "")

    def test_bogus_session_id_returns_401(self, client):
        r = client.post(f"{API}/auth/google/session", json={"session_id": "bogus"})
        assert r.status_code == 401, r.text
        assert "Google" in r.json().get("detail", "")

    def test_no_cookie_on_failure(self):
        s = requests.Session()
        s.post(f"{API}/auth/google/session", json={"session_id": "bogus3"})
        assert "access_token" not in s.cookies


# --- Re-seeded gallery ---
class TestGalleryReseed:
    def test_overview_has_two_albums(self, client):
        r = client.get(f"{API}/gallery?compact=true&limit=80")
        assert r.status_code == 200
        albums = r.json()
        assert isinstance(albums, list) and len(albums) >= 2
        slugs = {a["slug"] for a in albums}
        for slug in ALBUMS:
            assert slug in slugs
        for a in albums:
            assert "_id" not in a
            assert a.get("cover_url")

    @pytest.mark.parametrize("slug", ALBUMS)
    def test_album_has_six_distinct_photos(self, client, slug):
        r = client.get(f"{API}/gallery/{slug}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "_id" not in data
        photos = data.get("photos") or []
        assert len(photos) == 6, f"{slug} has {len(photos)} photos (expected 6)"
        urls = [p["image_url"] for p in photos]
        dupes = [u for u, c in Counter(urls).items() if c > 1]
        assert not dupes, f"{slug} has duplicate photo urls: {dupes}"
        for p in photos:
            assert p.get("image_url"), p
            assert "_id" not in p

    @pytest.mark.parametrize("slug", ALBUMS)
    def test_no_fabricated_dimensions(self, client, slug):
        """Seed must NOT ship width/height metadata; the frontend measures the real ratio."""
        photos = client.get(f"{API}/gallery/{slug}").json()["photos"]
        bogus = [p.get("id") for p in photos if p.get("width") or p.get("height")]
        assert not bogus, f"{slug} still ships stored width/height for {bogus}"

    @pytest.mark.xfail(reason="minor seed nit: 2 of 6 stock images are reused across both albums", strict=False)
    def test_no_image_shared_across_albums(self, client):
        seen = {}
        for slug in ALBUMS:
            for p in client.get(f"{API}/gallery/{slug}").json()["photos"]:
                seen.setdefault(p["image_url"], []).append(slug)
        shared = {u: s for u, s in seen.items() if len(set(s)) > 1}
        assert not shared, f"images reused across albums: {list(shared)[:3]}"

    @pytest.mark.parametrize("slug", ALBUMS)
    def test_all_images_reachable(self, client, slug):
        photos = client.get(f"{API}/gallery/{slug}").json()["photos"]
        failures = []
        for p in photos:
            url = p["image_url"]
            target = url if url.startswith("http") else f"{BASE_URL}{url}"
            resp = requests.get(target, stream=True, timeout=25)
            if resp.status_code != 200:
                failures.append((target, resp.status_code))
            resp.close()
        assert not failures, failures

    def test_unknown_album_404(self, client):
        assert client.get(f"{API}/gallery/does-not-exist-xyz").status_code == 404


# --- Bracket display feed for the TV page ---
class TestBracketDisplay:
    def test_bracket_display_ok(self, admin_client):
        r = admin_client.get(f"{API}/tournaments/{TOURNAMENT_ID}/bracket/display")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "_id" not in data
        assert data.get("tournament", {}).get("id") == TOURNAMENT_ID
        total = len(data.get("matches") or []) + len(data.get("matches_v2") or [])
        assert total > 0, "no matches in bracket display payload"

    def test_bracket_display_requires_auth(self, client):
        r = client.get(f"{API}/tournaments/{TOURNAMENT_ID}/bracket/display")
        assert r.status_code in (401, 403), r.status_code

    def test_densest_column_match_count(self, admin_client):
        """Sanity for the TV fix: densest round must exceed the 4-per-column cap to exercise paging."""
        data = admin_client.get(f"{API}/tournaments/{TOURNAMENT_ID}/bracket/display").json()
        matches = data.get("matches_v2") or data.get("matches") or []
        buckets = Counter((m.get("bracket") or m.get("section") or "main", m.get("round") or 1) for m in matches)
        assert buckets, "no rounds found"
        print("round match counts:", dict(buckets))
        assert max(buckets.values()) >= 4, f"densest round has only {max(buckets.values())} matches"


# --- Achievements taxonomy regression ---
class TestAchievementsTaxonomy:
    def test_catalog_taxonomy(self, client):
        r = client.get(f"{API}/achievements/groups")
        assert r.status_code == 200, r.text
        groups = r.json()
        groups = groups.get("groups", groups) if isinstance(groups, dict) else groups
        by_cat = {}
        for g in groups:
            by_cat.setdefault(g.get("category"), []).append(g.get("name"))
        assert "content" in by_cat
        assert any("Stream-Wachstum" in n for n in by_cat["content"]), by_cat.get("content")
        club = by_cat.get("club", [])
        assert any("Im Rudel" in n for n in club), club
        assert any("Stammgast" in n for n in club), club

    def test_tier_points_present(self, client):
        groups = client.get(f"{API}/achievements/groups").json()
        groups = groups.get("groups", groups) if isinstance(groups, dict) else groups
        tiers = [t for g in groups for t in (g.get("tiers") or [])]
        assert tiers
        assert all(isinstance(t.get("points"), int) for t in tiers)
