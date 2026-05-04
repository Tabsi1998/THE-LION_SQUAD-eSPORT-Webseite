"""Iteration 18 — Phase F.2 + Phase G (Media Browser, Nav Editor, Sitemap, Robots, SEO meta)."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lionsquad.at"
ADMIN_PW = "TLSAdmin2026!"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_admin_media_list(admin_token):
    r = requests.get(f"{API}/admin/media", headers={"Authorization": f"Bearer {admin_token}"}, timeout=10)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


def test_admin_media_traversal_protection(admin_token):
    r = requests.delete(
        f"{API}/admin/media/..%2Fevil",
        headers={"Authorization": f"Bearer {admin_token}"}, timeout=10,
    )
    assert r.status_code in (400, 404)


def test_admin_media_anonymous_blocked():
    r = requests.get(f"{API}/admin/media", timeout=10)
    assert r.status_code in (401, 403)


def test_admin_nav_get_and_put(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{API}/admin/nav", headers=h, timeout=10)
    assert r.status_code == 200
    nav = r.json()
    assert "items" in nav and len(nav["items"]) >= 5

    items = nav["items"]
    original_visible = items[0].get("visible", True)
    items[0]["visible"] = False

    r = requests.put(f"{API}/admin/nav", json={"items": items}, headers=h, timeout=10)
    assert r.status_code == 200, r.text

    # public nav should hide it
    r = requests.get(f"{API}/nav", timeout=10)
    assert r.status_code == 200
    pub_items = r.json()["items"]
    assert all(it["key"] != items[0]["key"] for it in pub_items)

    # restore
    items[0]["visible"] = original_visible
    r = requests.put(f"{API}/admin/nav", json={"items": items}, headers=h, timeout=10)
    assert r.status_code == 200


def test_admin_nav_anonymous_blocked():
    r = requests.put(f"{API}/admin/nav", json={"items": []}, timeout=10)
    assert r.status_code in (401, 403)


def test_public_nav_anon():
    r = requests.get(f"{API}/nav", timeout=10)
    assert r.status_code == 200
    assert "items" in r.json()


def test_sitemap_xml():
    r = requests.get(f"{API}/sitemap.xml", timeout=10)
    assert r.status_code == 200
    assert "<urlset" in r.text and "</urlset>" in r.text


def test_robots_txt():
    r = requests.get(f"{API}/robots.txt", timeout=10)
    assert r.status_code == 200
    assert "User-agent" in r.text


def test_seo_meta_for_about_page():
    r = requests.get(f"{API}/seo/page/about", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "title" in data
    assert "json_ld" in data
    assert data["json_ld"]["@type"] == "WebPage"


def test_seo_meta_404_unknown_slug():
    r = requests.get(f"{API}/seo/page/does-not-exist-xyz", timeout=10)
    assert r.status_code == 404
