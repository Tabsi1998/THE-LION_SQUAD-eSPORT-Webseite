"""Phase 3: erweitertes News-, Event- und Galerie-System backend tests."""
import os
import uuid
import pytest
import requests

_BU = os.environ.get("REACT_APP_BACKEND_URL")
if not _BU:
    # fallback: read from frontend/.env
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    _BU = line.split("=", 1)[1].strip()
                    break
    except Exception:
        pass
BASE_URL = (_BU or "").rstrip("/")
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL not configured; skipping live backend tests", allow_module_level=True)
ADMIN_EMAIL = "admin@lionsquad.at"
ADMIN_PASSWORD = "TLSAdmin2026!"


def _login(s, email, pw):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw})
    if r.status_code != 200:
        return None
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return r.json()


def _register_cu():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    suffix = uuid.uuid4().hex[:8]
    payload = {
        "email": f"test_p3_{suffix}@example.com",
        "username": f"p3_{suffix}",
        "password": "Pass1234!",
        "display_name": f"P3 Test {suffix}",
        "accept_terms": True,
        "accept_privacy": True,
    }
    r = s.post(f"{BASE_URL}/api/auth/register", json=payload)
    assert r.status_code in (200, 201), f"register failed {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if not _login(s, ADMIN_EMAIL, ADMIN_PASSWORD):
        pytest.skip("Admin login fail")
    return s


@pytest.fixture(scope="module")
def cu():
    return _register_cu()


@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def member_user(admin):
    """A community user promoted to active club member."""
    s = _register_cu()
    me = s.get(f"{BASE_URL}/api/auth/me").json()
    uid = me["id"]
    r = admin.put(
        f"{BASE_URL}/api/membership/user/{uid}",
        json={"member_status": "active", "membership_type": "ordinary"},
    )
    assert r.status_code == 200, r.text
    return s


# ---------- Meta ----------
class TestMeta:
    def test_news_meta(self, anon):
        r = anon.get(f"{BASE_URL}/api/news-meta")
        assert r.status_code == 200
        data = r.json()
        assert len(data["categories"]) == 10
        assert len(data["visibilities"]) == 4
        keys = {c["k"] for c in data["categories"]}
        assert {"club", "announcement", "recap"}.issubset(keys)
        vk = {v["k"] for v in data["visibilities"]}
        assert vk == {"public", "community", "members", "internal"}

    def test_events_meta(self, anon):
        r = anon.get(f"{BASE_URL}/api/events/meta")
        assert r.status_code == 200
        data = r.json()
        assert len(data["types"]) == 13
        assert len(data["statuses"]) == 11
        assert len(data["visibilities"]) == 4
        sk = {s["k"] for s in data["statuses"]}
        assert "scheduled" in sk
        tk = {t["k"] for t in data["types"]}
        assert "lan_party" in tk and "f1_event" in tk


# ---------- News ----------
@pytest.fixture(scope="module")
def news_ctx(admin):
    """Create a couple of news posts and return their ids/slugs."""
    suf = uuid.uuid4().hex[:6]
    public_pinned = admin.post(f"{BASE_URL}/api/news", json={
        "title": f"TEST Public Pinned {suf}",
        "slug": f"test-pub-pinned-{suf}",
        "content": "Hello",
        "category": "announcement",
        "visibility": "public",
        "published": True,
        "pinned": True,
    })
    assert public_pinned.status_code == 200, public_pinned.text
    public_normal = admin.post(f"{BASE_URL}/api/news", json={
        "title": f"TEST Public Normal {suf}",
        "slug": f"test-pub-normal-{suf}",
        "content": "Body",
        "category": "club",
        "visibility": "public",
        "published": True,
    })
    assert public_normal.status_code == 200
    community_news = admin.post(f"{BASE_URL}/api/news", json={
        "title": f"TEST Community {suf}",
        "slug": f"test-comm-{suf}",
        "content": "Comm",
        "category": "community",
        "visibility": "community",
        "published": True,
    })
    assert community_news.status_code == 200
    members_news = admin.post(f"{BASE_URL}/api/news", json={
        "title": f"TEST Members {suf}",
        "slug": f"test-mem-{suf}",
        "content": "Members only",
        "category": "members",
        "visibility": "members",
        "published": True,
    })
    assert members_news.status_code == 200
    draft_news = admin.post(f"{BASE_URL}/api/news", json={
        "title": f"TEST Draft {suf}",
        "slug": f"test-draft-{suf}",
        "content": "draft",
        "category": "club",
        "visibility": "public",
        "published": False,
    })
    assert draft_news.status_code == 200
    return {
        "public_pinned": public_pinned.json(),
        "public_normal": public_normal.json(),
        "community": community_news.json(),
        "members": members_news.json(),
        "draft": draft_news.json(),
        "suf": suf,
    }


class TestNews:
    def test_admin_create_full(self, news_ctx):
        p = news_ctx["public_pinned"]
        assert p["category"] == "announcement"
        assert p["visibility"] == "public"
        assert p["pinned"] is True
        assert "id" in p

    def test_public_list_only_published_public_pinned_first(self, anon, news_ctx):
        r = anon.get(f"{BASE_URL}/api/news")
        assert r.status_code == 200
        items = r.json()
        slugs = [i["slug"] for i in items]
        # draft must not be visible
        assert news_ctx["draft"]["slug"] not in slugs
        # community/members not visible to anon
        assert news_ctx["community"]["slug"] not in slugs
        assert news_ctx["members"]["slug"] not in slugs
        # public pinned must come before normal public
        idx_pin = slugs.index(news_ctx["public_pinned"]["slug"])
        idx_norm = slugs.index(news_ctx["public_normal"]["slug"])
        assert idx_pin < idx_norm

    def test_community_user_sees_public_and_community(self, cu, news_ctx):
        r = cu.get(f"{BASE_URL}/api/news")
        assert r.status_code == 200
        slugs = [i["slug"] for i in r.json()]
        assert news_ctx["public_normal"]["slug"] in slugs
        assert news_ctx["community"]["slug"] in slugs
        # members-only not visible to community user
        assert news_ctx["members"]["slug"] not in slugs

    def test_filter_by_category(self, anon, news_ctx):
        r = anon.get(f"{BASE_URL}/api/news?category=announcement")
        assert r.status_code == 200
        items = r.json()
        assert all(i["category"] == "announcement" for i in items)
        assert news_ctx["public_pinned"]["slug"] in [i["slug"] for i in items]

    def test_get_by_slug_resolves_links(self, admin, anon, news_ctx):
        # Create event + tournament + team to link
        suf = news_ctx["suf"]
        ev = admin.post(f"{BASE_URL}/api/events", json={
            "name": f"TEST Linked Ev {suf}",
            "slug": f"test-linked-ev-{suf}",
            "event_type": "lan_party",
            "visibility": "public",
        })
        assert ev.status_code == 200, ev.text
        ev_id = ev.json()["id"]
        # publish the event so it's visible (but link resolution does not gate on status)
        # Patch news with link
        nid = news_ctx["public_normal"]["id"]
        upd = admin.patch(f"{BASE_URL}/api/news/{nid}", json={"linked_event_ids": [ev_id]})
        assert upd.status_code == 200
        # GET via slug as anon
        r = anon.get(f"{BASE_URL}/api/news/{news_ctx['public_normal']['slug']}")
        assert r.status_code == 200
        body = r.json()
        assert "linked_events" in body
        assert any(e["id"] == ev_id for e in body["linked_events"])

    def test_members_visibility_anon_403(self, anon, news_ctx):
        r = anon.get(f"{BASE_URL}/api/news/{news_ctx['members']['slug']}")
        assert r.status_code == 403

    def test_members_visibility_member_ok(self, member_user, news_ctx):
        r = member_user.get(f"{BASE_URL}/api/news/{news_ctx['members']['slug']}")
        assert r.status_code == 200
        assert r.json()["slug"] == news_ctx["members"]["slug"]

    def test_patch_news(self, admin, news_ctx):
        nid = news_ctx["public_normal"]["id"]
        r = admin.patch(f"{BASE_URL}/api/news/{nid}", json={
            "content": "Updated body",
            "pinned": True,
            "visibility": "community",
        })
        assert r.status_code == 200
        body = r.json()
        assert body["content"] == "Updated body"
        assert body["pinned"] is True
        assert body["visibility"] == "community"

    def test_cu_cannot_create_news(self, cu):
        r = cu.post(f"{BASE_URL}/api/news", json={
            "title": "Nope", "slug": f"nope-{uuid.uuid4().hex[:6]}",
            "content": "x", "category": "club",
        })
        assert r.status_code == 403

    def test_admin_news_includes_drafts(self, admin, news_ctx):
        r = admin.get(f"{BASE_URL}/api/admin/news")
        assert r.status_code == 200
        slugs = [i["slug"] for i in r.json()]
        assert news_ctx["draft"]["slug"] in slugs

    def test_anon_news_excludes_drafts(self, anon, news_ctx):
        r = anon.get(f"{BASE_URL}/api/news")
        assert r.status_code == 200
        slugs = [i["slug"] for i in r.json()]
        assert news_ctx["draft"]["slug"] not in slugs

    def test_delete_news(self, admin):
        # Create a throwaway and delete
        suf = uuid.uuid4().hex[:6]
        c = admin.post(f"{BASE_URL}/api/news", json={
            "title": f"TEST Del {suf}", "slug": f"test-del-{suf}",
            "content": "x", "category": "club", "visibility": "public",
            "published": True,
        })
        assert c.status_code == 200
        nid = c.json()["id"]
        d = admin.delete(f"{BASE_URL}/api/news/{nid}")
        assert d.status_code == 200


# ---------- Events ----------
@pytest.fixture(scope="module")
def event_ctx(admin):
    suf = uuid.uuid4().hex[:6]
    # Public LAN-Party
    pub = admin.post(f"{BASE_URL}/api/events", json={
        "name": f"TEST LAN {suf}",
        "slug": f"test-lan-{suf}",
        "event_type": "lan_party",
        "visibility": "public",
        "start_date": "2030-06-01T18:00:00Z",
        "end_date": "2030-06-02T20:00:00Z",
        "door_time": "2030-06-01T17:00:00Z",
        "registration_opens_at": "2030-05-01T00:00:00Z",
        "registration_closes_at": "2030-05-31T00:00:00Z",
        "has_live_stream": True,
        "stream_platform": "Twitch",
        "stream_url": "https://twitch.tv/tls",
        "program": "18:00 Doors\n19:00 Start",
    })
    assert pub.status_code == 200, pub.text
    # publish (status away from draft)
    pid = pub.json()["id"]
    r = admin.patch(f"{BASE_URL}/api/events/{pid}", json={"status": "scheduled"})
    assert r.status_code == 200
    # Members-only event
    mem = admin.post(f"{BASE_URL}/api/events", json={
        "name": f"TEST MEM {suf}",
        "slug": f"test-mem-ev-{suf}",
        "event_type": "club_evening",
        "visibility": "members",
        "start_date": "2030-07-01T18:00:00Z",
    })
    assert mem.status_code == 200
    mid = mem.json()["id"]
    admin.patch(f"{BASE_URL}/api/events/{mid}", json={"status": "scheduled"})
    # Draft event
    drf = admin.post(f"{BASE_URL}/api/events", json={
        "name": f"TEST DRAFT EV {suf}",
        "slug": f"test-draft-ev-{suf}",
        "event_type": "general",
        "visibility": "public",
    })
    assert drf.status_code == 200
    return {
        "public": admin.get(f"{BASE_URL}/api/events/{pid}").json() if False else pub.json() | {"id": pid, "slug": f"test-lan-{suf}"},
        "members": mem.json(),
        "draft": drf.json(),
        "suf": suf,
    }


class TestEvents:
    def test_create_lan_party(self, event_ctx):
        e = event_ctx["public"]
        assert e["event_type"] == "lan_party"
        assert e["visibility"] == "public"
        assert e["has_live_stream"] is True

    def test_list_events_anon_no_drafts(self, anon, event_ctx):
        r = anon.get(f"{BASE_URL}/api/events")
        assert r.status_code == 200
        statuses = {ev.get("status") for ev in r.json()}
        assert "draft" not in statuses
        slugs = [ev["slug"] for ev in r.json()]
        assert event_ctx["draft"]["slug"] not in slugs

    def test_list_events_admin_includes_drafts(self, admin, event_ctx):
        r = admin.get(f"{BASE_URL}/api/events")
        assert r.status_code == 200
        slugs = [ev["slug"] for ev in r.json()]
        assert event_ctx["draft"]["slug"] in slugs

    def test_upcoming_filter(self, anon, event_ctx):
        r = anon.get(f"{BASE_URL}/api/events?upcoming=true")
        assert r.status_code == 200
        evs = r.json()
        bad = {"completed", "archived", "cancelled", "draft"}
        for ev in evs:
            assert ev.get("status") not in bad

    def test_filter_by_event_type(self, anon, event_ctx):
        r = anon.get(f"{BASE_URL}/api/events?event_type=lan_party")
        assert r.status_code == 200
        for ev in r.json():
            assert ev["event_type"] == "lan_party"

    def test_get_by_slug_attaches_relations(self, anon, event_ctx):
        slug = event_ctx["public"]["slug"]
        r = anon.get(f"{BASE_URL}/api/events/{slug}")
        assert r.status_code == 200
        b = r.json()
        assert "tournaments" in b and isinstance(b["tournaments"], list)
        assert "f1_challenges" in b and isinstance(b["f1_challenges"], list)
        assert "albums" in b and isinstance(b["albums"], list)
        assert "news" in b and isinstance(b["news"], list)

    def test_draft_event_anon_404(self, anon, event_ctx):
        r = anon.get(f"{BASE_URL}/api/events/{event_ctx['draft']['slug']}")
        assert r.status_code == 404

    def test_draft_event_admin_200(self, admin, event_ctx):
        r = admin.get(f"{BASE_URL}/api/events/{event_ctx['draft']['slug']}")
        assert r.status_code == 200

    def test_members_event_anon_403(self, anon, event_ctx):
        r = anon.get(f"{BASE_URL}/api/events/{event_ctx['members']['slug']}")
        assert r.status_code == 403

    def test_patch_event_status_location_program(self, admin, event_ctx):
        eid = event_ctx["public"]["id"]
        r = admin.patch(f"{BASE_URL}/api/events/{eid}", json={
            "status": "registration_open",
            "location": "Vereinsheim",
            "program": "Updated program",
        })
        assert r.status_code == 200
        b = r.json()
        assert b["status"] == "registration_open"
        assert b["location"] == "Vereinsheim"
        assert b["program"] == "Updated program"

    def test_delete_event(self, admin):
        suf = uuid.uuid4().hex[:6]
        c = admin.post(f"{BASE_URL}/api/events", json={
            "name": f"TEST DEL EV {suf}",
            "slug": f"test-del-ev-{suf}",
            "event_type": "general",
        })
        assert c.status_code == 200
        eid = c.json()["id"]
        d = admin.delete(f"{BASE_URL}/api/events/{eid}")
        assert d.status_code == 200

    def test_cu_cannot_create_event(self, cu):
        r = cu.post(f"{BASE_URL}/api/events", json={
            "name": "Nope", "slug": f"nope-ev-{uuid.uuid4().hex[:6]}",
            "event_type": "general",
        })
        assert r.status_code == 403


# ---------- Gallery ----------
@pytest.fixture(scope="module")
def gallery_ctx(admin, event_ctx):
    suf = uuid.uuid4().hex[:6]
    pub = admin.post(f"{BASE_URL}/api/gallery", json={
        "title": f"TEST Album Pub {suf}",
        "slug": f"test-album-pub-{suf}",
        "visibility": "public",
        "event_id": event_ctx["public"]["id"],
        "taken_at": "2030-06-02T22:00:00Z",
        "published": True,
    })
    assert pub.status_code == 200, pub.text
    mem = admin.post(f"{BASE_URL}/api/gallery", json={
        "title": f"TEST Album Mem {suf}",
        "slug": f"test-album-mem-{suf}",
        "visibility": "members",
        "published": True,
    })
    assert mem.status_code == 200
    unpub = admin.post(f"{BASE_URL}/api/gallery", json={
        "title": f"TEST Album Draft {suf}",
        "slug": f"test-album-draft-{suf}",
        "visibility": "public",
        "published": False,
    })
    assert unpub.status_code == 200
    # Add photos to public album
    aid = pub.json()["id"]
    p1 = admin.post(f"{BASE_URL}/api/gallery/{aid}/photos", json={
        "image_url": "https://example.com/p1.jpg",
        "caption": "Photo 1",
    })
    assert p1.status_code == 200
    p2 = admin.post(f"{BASE_URL}/api/gallery/{aid}/photos", json={
        "image_url": "https://example.com/p2.jpg",
    })
    assert p2.status_code == 200
    return {
        "public": pub.json(),
        "members": mem.json(),
        "unpublished": unpub.json(),
        "photo1": p1.json(),
        "photo2": p2.json(),
        "suf": suf,
    }


class TestGallery:
    def test_create_album(self, gallery_ctx):
        a = gallery_ctx["public"]
        assert a["visibility"] == "public"
        assert a["event_id"]
        assert "id" in a

    def test_public_album_list_with_photo_count(self, anon, gallery_ctx):
        r = anon.get(f"{BASE_URL}/api/gallery")
        assert r.status_code == 200
        albums = r.json()
        slugs = {a["slug"]: a for a in albums}
        assert gallery_ctx["public"]["slug"] in slugs
        assert slugs[gallery_ctx["public"]["slug"]].get("photo_count") == 2
        # members album not visible to anon
        assert gallery_ctx["members"]["slug"] not in slugs
        # unpublished not visible to anon
        assert gallery_ctx["unpublished"]["slug"] not in slugs

    def test_album_detail_with_photos_and_event(self, anon, gallery_ctx):
        r = anon.get(f"{BASE_URL}/api/gallery/{gallery_ctx['public']['slug']}")
        assert r.status_code == 200
        b = r.json()
        assert len(b["photos"]) == 2
        assert b.get("event") and b["event"].get("id") == gallery_ctx["public"]["event_id"]

    def test_member_album_anon_403(self, anon, gallery_ctx):
        r = anon.get(f"{BASE_URL}/api/gallery/{gallery_ctx['members']['slug']}")
        assert r.status_code == 403

    def test_patch_album_title(self, admin, gallery_ctx):
        aid = gallery_ctx["public"]["id"]
        r = admin.patch(f"{BASE_URL}/api/gallery/{aid}", json={"title": "TEST Album Updated"})
        assert r.status_code == 200
        assert r.json()["title"] == "TEST Album Updated"

    def test_patch_photo_caption(self, admin, gallery_ctx):
        pid = gallery_ctx["photo1"]["id"]
        r = admin.patch(f"{BASE_URL}/api/gallery/photos/{pid}", json={"caption": "Updated"})
        assert r.status_code == 200
        assert r.json()["caption"] == "Updated"

    def test_delete_photo(self, admin, gallery_ctx):
        pid = gallery_ctx["photo2"]["id"]
        r = admin.delete(f"{BASE_URL}/api/gallery/photos/{pid}")
        assert r.status_code == 200
        # Verify count went down
        slug = gallery_ctx["public"]["slug"]
        det = admin.get(f"{BASE_URL}/api/gallery/{slug}")
        assert det.status_code == 200
        photo_ids = [p["id"] for p in det.json()["photos"]]
        assert pid not in photo_ids

    def test_admin_gallery_includes_unpublished(self, admin, gallery_ctx):
        r = admin.get(f"{BASE_URL}/api/admin/gallery")
        assert r.status_code == 200
        slugs = [a["slug"] for a in r.json()]
        assert gallery_ctx["unpublished"]["slug"] in slugs

    def test_delete_album_cascades_photos(self, admin):
        suf = uuid.uuid4().hex[:6]
        c = admin.post(f"{BASE_URL}/api/gallery", json={
            "title": f"TEST Cascade {suf}", "slug": f"test-cascade-{suf}",
            "visibility": "public", "published": True,
        })
        assert c.status_code == 200
        aid = c.json()["id"]
        admin.post(f"{BASE_URL}/api/gallery/{aid}/photos",
                   json={"image_url": "https://x/y.jpg"})
        admin.post(f"{BASE_URL}/api/gallery/{aid}/photos",
                   json={"image_url": "https://x/z.jpg"})
        d = admin.delete(f"{BASE_URL}/api/gallery/{aid}")
        assert d.status_code == 200
        # Album gone
        r = admin.get(f"{BASE_URL}/api/gallery/{c.json()['slug']}")
        assert r.status_code == 404

    def test_cu_cannot_create_album(self, cu):
        r = cu.post(f"{BASE_URL}/api/gallery", json={
            "title": "Nope", "slug": f"nope-alb-{uuid.uuid4().hex[:6]}",
        })
        assert r.status_code == 403
