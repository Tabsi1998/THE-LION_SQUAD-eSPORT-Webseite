"""Phase 4 backend tests — Vereinsdokumente + Downloads + members news + membership history."""
import io
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fast-lap-mgmt.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@thelionsquad.at"
ADMIN_PASSWORD = "TLSAdmin2026!"


# ---------------- helpers ----------------
def _login(session, email, password):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code != 200:
        return None
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    if tok:
        session.headers.update({"Authorization": f"Bearer {tok}"})
    return data


def _new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def admin():
    s = _new_session()
    if not _login(s, ADMIN_EMAIL, ADMIN_PASSWORD):
        pytest.skip("Admin login failed")
    return s


@pytest.fixture(scope="module")
def admin_user_id(admin):
    r = admin.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def community_user():
    """Fresh community user (NOT a club member)."""
    s = _new_session()
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_cu_{suffix}@test.lionsquad.at"
    pw = "TestCU2026!"
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email,
        "password": pw,
        "username": f"TEST_cu_{suffix}",
        "display_name": "TEST CU",
        "accept_privacy": True,
        "accept_terms": True,
    })
    if r.status_code not in (200, 201):
        pytest.skip(f"Register failed: {r.status_code} {r.text}")
    if not _login(s, email, pw):
        pytest.skip("Community login failed")
    me = s.get(f"{BASE_URL}/api/auth/me")
    s.user_id = me.json()["id"] if me.status_code == 200 else None
    s.email = email
    return s


@pytest.fixture(scope="module")
def member_client(admin):
    """Fresh community user promoted to active club member by admin."""
    s = _new_session()
    suffix = uuid.uuid4().hex[:8]
    email = f"TEST_member_{suffix}@test.lionsquad.at"
    pw = "TestMember2026!"
    r = s.post(f"{BASE_URL}/api/auth/register", json={
        "email": email,
        "password": pw,
        "username": f"TEST_mem_{suffix}",
        "display_name": "TEST Member",
        "accept_privacy": True,
        "accept_terms": True,
    })
    if r.status_code not in (200, 201):
        pytest.skip(f"Register failed: {r.status_code} {r.text}")
    if not _login(s, email, pw):
        pytest.skip("Member login failed")
    me = s.get(f"{BASE_URL}/api/auth/me")
    uid = me.json()["id"]
    # Promote
    pr = admin.put(f"{BASE_URL}/api/membership/user/{uid}", json={
        "member_status": "active",
        "membership_type": "ordinary",
        "notes": "TEST promotion phase4",
    })
    assert pr.status_code == 200, pr.text
    s.user_id = uid
    s.email = email
    return s


@pytest.fixture(scope="module")
def anon():
    s = _new_session()
    return s


# ---------------- meta ----------------
class TestDocumentsMeta:
    def test_meta_categories_visibilities(self, anon):
        r = anon.get(f"{BASE_URL}/api/documents/meta")
        assert r.status_code == 200
        data = r.json()
        cats = [c["k"] for c in data["categories"]]
        vis = [v["k"] for v in data["visibilities"]]
        expected_cats = {
            "statutes", "minutes", "form", "regulations", "guideline",
            "download", "media_kit", "presentation", "template", "other",
        }
        assert set(cats) == expected_cats, f"Got: {cats}"
        assert len(cats) == 10
        assert set(vis) == {"public", "community", "members", "internal"}
        assert len(vis) == 4


# ---------------- uploads ----------------
def _upload(session, content_bytes, filename, mime):
    """Multipart upload — strips content-type from session for this request."""
    headers = {k: v for k, v in session.headers.items() if k.lower() != "content-type"}
    files = {"file": (filename, io.BytesIO(content_bytes), mime)}
    return requests.post(
        f"{BASE_URL}/api/uploads/document",
        headers=headers,
        files=files,
    )


class TestUploads:
    def test_upload_txt_admin(self, admin):
        r = _upload(admin, b"Hello TLS Phase 4\n", "TEST_phase4.txt", "text/plain")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["url"].startswith("/api/static/uploads/")
        assert d["original_filename"] == "TEST_phase4.txt"
        assert d["size"] == len(b"Hello TLS Phase 4\n")
        assert d["mime"] == "text/plain"

    def test_upload_pdf_admin(self, admin):
        # Minimal fake PDF bytes (1KB)
        body = b"%PDF-1.4\n" + b"X" * 1000 + b"\n%%EOF\n"
        r = _upload(admin, body, "TEST_phase4.pdf", "application/pdf")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["original_filename"] == "TEST_phase4.pdf"
        assert d["mime"] == "application/pdf"
        assert d["size"] == len(body)

    def test_upload_disallowed_exe(self, admin):
        r = _upload(admin, b"MZ\x90\x00", "TEST_evil.exe", "application/x-msdownload")
        assert r.status_code == 400
        # German error message
        body = r.json()
        assert "nicht erlaubt" in (body.get("detail") or "").lower()

    def test_upload_disallowed_sh(self, admin):
        r = _upload(admin, b"#!/bin/sh\necho hi\n", "TEST_evil.sh", "application/x-sh")
        assert r.status_code == 400

    def test_upload_community_user_403(self, community_user):
        r = _upload(community_user, b"hi", "TEST_cu.txt", "text/plain")
        # require_admin -> 403 (sometimes 401 if no auth, here we have auth)
        assert r.status_code == 403, r.text


# ---------------- documents CRUD + visibility ----------------
@pytest.fixture(scope="module")
def admin_uploaded_url(admin):
    r = _upload(admin, b"phase4 statutes content\n", "TEST_statutes.txt", "text/plain")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def members_doc(admin, admin_uploaded_url):
    """Create a members-only document."""
    payload = {
        "title": f"TEST Phase4 Statutes {uuid.uuid4().hex[:6]}",
        "description": "Phase4 test members-only doc",
        "category": "statutes",
        "visibility": "members",
        "file_url": admin_uploaded_url["url"],
        "original_filename": admin_uploaded_url["original_filename"],
        "file_size": admin_uploaded_url["size"],
        "mime": admin_uploaded_url["mime"],
        "tags": ["TEST", "phase4"],
    }
    r = admin.post(f"{BASE_URL}/api/documents", json=payload)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["download_count"] == 0
    assert doc["category"] == "statutes"
    assert doc["visibility"] == "members"
    yield doc
    # cleanup
    admin.delete(f"{BASE_URL}/api/documents/{doc['id']}")


@pytest.fixture(scope="module")
def public_doc(admin, admin_uploaded_url):
    payload = {
        "title": f"TEST Phase4 Public Download {uuid.uuid4().hex[:6]}",
        "category": "download",
        "visibility": "public",
        "file_url": admin_uploaded_url["url"],
    }
    r = admin.post(f"{BASE_URL}/api/documents", json=payload)
    assert r.status_code == 200, r.text
    yield r.json()
    admin.delete(f"{BASE_URL}/api/documents/{r.json()['id']}")


@pytest.fixture(scope="module")
def internal_doc(admin, admin_uploaded_url):
    payload = {
        "title": f"TEST Phase4 Internal {uuid.uuid4().hex[:6]}",
        "category": "minutes",
        "visibility": "internal",
        "file_url": admin_uploaded_url["url"],
    }
    r = admin.post(f"{BASE_URL}/api/documents", json=payload)
    assert r.status_code == 200, r.text
    yield r.json()
    admin.delete(f"{BASE_URL}/api/documents/{r.json()['id']}")


class TestDocumentsCRUDVisibility:
    def test_create_basics(self, members_doc):
        d = members_doc
        assert d["title"].startswith("TEST Phase4 Statutes")
        assert d["download_count"] == 0
        assert d["created_at"]
        assert d.get("uploader_name")

    def test_anonymous_cannot_see_members_doc(self, anon, members_doc):
        r = anon.get(f"{BASE_URL}/api/documents")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert members_doc["id"] not in ids

    def test_community_user_cannot_see_members_doc(self, community_user, members_doc):
        r = community_user.get(f"{BASE_URL}/api/documents")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert members_doc["id"] not in ids

    def test_admin_sees_all_docs(self, admin, members_doc, internal_doc):
        r = admin.get(f"{BASE_URL}/api/documents")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert members_doc["id"] in ids
        assert internal_doc["id"] in ids

    def test_active_member_sees_members_doc(self, member_client, members_doc):
        r = member_client.get(f"{BASE_URL}/api/documents")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert members_doc["id"] in ids

    def test_active_member_does_not_see_internal_doc(self, member_client, internal_doc):
        r = member_client.get(f"{BASE_URL}/api/documents")
        ids = [x["id"] for x in r.json()]
        assert internal_doc["id"] not in ids, "Internal-only doc must NOT be visible to non-admin members"

    def test_filter_by_category(self, admin, members_doc):
        r = admin.get(f"{BASE_URL}/api/documents", params={"category": "statutes"})
        assert r.status_code == 200
        items = r.json()
        assert all(x["category"] == "statutes" for x in items)
        assert members_doc["id"] in [x["id"] for x in items]

    def test_admin_listing(self, admin, members_doc, internal_doc):
        r = admin.get(f"{BASE_URL}/api/documents/admin")
        assert r.status_code == 200
        items = r.json()
        ids = [x["id"] for x in items]
        assert members_doc["id"] in ids
        assert internal_doc["id"] in ids
        # Sorted pinned desc, order_index asc
        # (just verify pinned docs come first if any)
        last_pinned = True
        for x in items:
            if not x.get("pinned", False):
                last_pinned = False
            else:
                assert last_pinned, "pinned docs must precede non-pinned"

    def test_patch_update(self, admin, members_doc):
        r = admin.patch(f"{BASE_URL}/api/documents/{members_doc['id']}", json={
            "title": "TEST Phase4 Updated Title",
            "category": "regulations",
            "pinned": True,
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"] == "TEST Phase4 Updated Title"
        assert d["category"] == "regulations"
        assert d["pinned"] is True

    def test_patch_404(self, admin):
        r = admin.patch(f"{BASE_URL}/api/documents/does-not-exist-xyz", json={"title": "X"})
        assert r.status_code == 404

    def test_delete_404(self, admin):
        r = admin.delete(f"{BASE_URL}/api/documents/does-not-exist-xyz")
        assert r.status_code == 404

    def test_delete_doc(self, admin, admin_uploaded_url):
        # create disposable
        r = admin.post(f"{BASE_URL}/api/documents", json={
            "title": "TEST Phase4 Delete Me",
            "category": "other",
            "visibility": "public",
            "file_url": admin_uploaded_url["url"],
        })
        assert r.status_code == 200
        did = r.json()["id"]
        d = admin.delete(f"{BASE_URL}/api/documents/{did}")
        assert d.status_code == 200
        # confirm gone in admin listing
        items = admin.get(f"{BASE_URL}/api/documents/admin").json()
        assert did not in [x["id"] for x in items]


# ---------------- track-download ----------------
class TestTrackDownload:
    def test_member_track_download(self, admin, member_client, admin_uploaded_url):
        # create dedicated members-only doc
        r = admin.post(f"{BASE_URL}/api/documents", json={
            "title": "TEST Phase4 Track DL",
            "category": "download",
            "visibility": "members",
            "file_url": admin_uploaded_url["url"],
        })
        assert r.status_code == 200
        did = r.json()["id"]
        try:
            tr = member_client.post(f"{BASE_URL}/api/documents/{did}/track-download")
            assert tr.status_code == 200, tr.text
            body = tr.json()
            assert body["ok"] is True
            assert body["url"] == admin_uploaded_url["url"]

            # second track increments
            member_client.post(f"{BASE_URL}/api/documents/{did}/track-download")
            # Verify in DB via admin listing
            items = admin.get(f"{BASE_URL}/api/documents/admin").json()
            d = next(x for x in items if x["id"] == did)
            assert d["download_count"] >= 2
        finally:
            admin.delete(f"{BASE_URL}/api/documents/{did}")

    def test_anonymous_track_members_only_403(self, admin, anon, admin_uploaded_url):
        r = admin.post(f"{BASE_URL}/api/documents", json={
            "title": "TEST Phase4 Anon Track",
            "category": "download",
            "visibility": "members",
            "file_url": admin_uploaded_url["url"],
        })
        did = r.json()["id"]
        try:
            tr = anon.post(f"{BASE_URL}/api/documents/{did}/track-download")
            assert tr.status_code == 403
        finally:
            admin.delete(f"{BASE_URL}/api/documents/{did}")

    def test_track_404(self, admin):
        r = admin.post(f"{BASE_URL}/api/documents/missing-id-zzz/track-download")
        assert r.status_code == 404


# ---------------- authorisation ----------------
class TestAuthorisation:
    def test_create_cu_403(self, community_user, admin_uploaded_url):
        r = community_user.post(f"{BASE_URL}/api/documents", json={
            "title": "TEST CU Cannot",
            "category": "other",
            "visibility": "public",
            "file_url": admin_uploaded_url["url"],
        })
        assert r.status_code == 403

    def test_patch_cu_403(self, community_user, members_doc):
        r = community_user.patch(f"{BASE_URL}/api/documents/{members_doc['id']}", json={"title": "X"})
        assert r.status_code == 403

    def test_delete_cu_403(self, community_user, members_doc):
        r = community_user.delete(f"{BASE_URL}/api/documents/{members_doc['id']}")
        assert r.status_code == 403

    def test_admin_listing_cu_403(self, community_user):
        r = community_user.get(f"{BASE_URL}/api/documents/admin")
        assert r.status_code == 403


# ---------------- members-only news visibility ----------------
@pytest.fixture(scope="module")
def members_news(admin):
    """Create a members-only news post."""
    slug = f"test-phase4-members-{uuid.uuid4().hex[:8]}"
    payload = {
        "title": "TEST Phase4 Members-Only News",
        "slug": slug,
        "summary": "Nur fuer Mitglieder",
        "content": "Geheime Mitglieder-News",
        "visibility": "members",
        "published": True,
    }
    r = admin.post(f"{BASE_URL}/api/news", json=payload)
    assert r.status_code == 200, r.text
    yield r.json()
    admin.delete(f"{BASE_URL}/api/news/{r.json()['id']}")


class TestMembersNewsVisibility:
    def test_anon_does_not_see_members_news(self, anon, members_news):
        r = anon.get(f"{BASE_URL}/api/news")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert members_news["id"] not in ids

    def test_active_member_sees_members_news(self, member_client, members_news):
        r = member_client.get(f"{BASE_URL}/api/news")
        assert r.status_code == 200
        ids = [x["id"] for x in r.json()]
        assert members_news["id"] in ids


# ---------------- membership /me history ----------------
class TestMembershipMeHistory:
    def test_member_me_has_history(self, member_client):
        r = member_client.get(f"{BASE_URL}/api/membership/me")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["is_active_member"] is True
        m = body["membership"]
        assert m is not None
        history = m.get("history")
        assert isinstance(history, list)
        assert len(history) >= 1
        h0 = history[0]
        for k in ("actor_id", "at", "from_status", "to_status"):
            assert k in h0, f"missing key {k} in history entry"
        assert h0["to_status"] == "active"


# ---------------- Member Area aggregate consistency ----------------
class TestMemberAreaAggregate:
    def test_member_can_load_all_member_data(self, member_client):
        # benefits
        rb = member_client.get(f"{BASE_URL}/api/membership/benefits")
        assert rb.status_code == 200, rb.text
        assert isinstance(rb.json(), list)

        # documents
        rd = member_client.get(f"{BASE_URL}/api/documents")
        assert rd.status_code == 200
        assert isinstance(rd.json(), list)

        # news
        rn = member_client.get(f"{BASE_URL}/api/news")
        assert rn.status_code == 200
        assert isinstance(rn.json(), list)
