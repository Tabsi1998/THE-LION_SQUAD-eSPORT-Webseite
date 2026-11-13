"""Vereinsdokumente nach Sichtbarkeit (#932): anlegen über den Upload, wer welche Dokumente sieht (Gast, Mitglied,
Verwaltung), Filter nach Kategorie, die Verwaltungsliste mit angepinnten Dokumenten zuerst, Ändern - und dass eine Person
ohne Vereinsverwaltung nichts davon verwaltet.

Durch die echte Anwendung (flow_harness) statt gegen einen laufenden Server. Ersetzt aus test_phase4_documents.py:
TestDocumentsCRUDVisibility::test_create_basics, ::test_anonymous_cannot_see_members_doc, ::test_admin_sees_all_docs,
::test_active_member_does_not_see_internal_doc, ::test_filter_by_category, ::test_admin_listing, ::test_patch_update,
::test_patch_404; TestAuthorisation::test_create_cu_403, ::test_patch_cu_403, ::test_delete_cu_403,
::test_admin_listing_cu_403.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


KEY = f"{'c' * 32}.pdf"


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def doc_dir(tmp_path, monkeypatch):
    from routes import document_routes

    folder = tmp_path / "docs"
    folder.mkdir()
    monkeypatch.setattr(document_routes, "PRIVATE_DOC_DIR", folder)
    return folder


async def document(flow, title: str, *, visibility: str = "members", category: str = "other", pinned: bool = False,
                   order_index: int = 0) -> str:
    doc_id = new_id()
    await flow.db.documents.insert_one({
        "id": doc_id, "title": title, "visibility": visibility, "category": category, "pinned": pinned,
        "order_index": order_index, "file_url": "https://example.test/datei.pdf", "created_at": "2026-10-01T10:00:00+00:00",
    })
    return doc_id


async def active_member(flow) -> dict:
    member = await flow.add_user(name="mitglied")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active", "source": "website"})
    return member


async def titles(flow, **params) -> list[str]:
    res = await flow.get("/api/documents", params=params)
    assert res.status_code == 200, res.text
    return [doc["title"] for doc in res.json()]


@pytest.mark.asyncio
async def test_staff_creates_a_document_from_an_upload(flow, doc_dir):
    staff = await flow.add_staff(name="Vorstand")
    flow.act_as(staff)
    # Eine neue lokale Upload-Adresse nimmt die Route nicht - neue Dateien laufen über den Upload.
    refused = await flow.post("/api/documents", json={"title": "Statuten", "file_url": "/api/static/uploads/statuten.pdf"})
    assert refused.status_code == 400, refused.text

    (doc_dir / KEY).write_bytes(b"%PDF-1.4\n%%EOF\n")
    res = await flow.post("/api/documents", json={"title": "Statuten", "category": "statutes", "storage_key": KEY,
                                                  "file_url": "", "original_filename": "statuten.pdf"})
    assert res.status_code == 200, res.text
    created = res.json()
    assert created["download_count"] == 0
    assert created["created_at"]
    assert created["uploader_name"] == "Vorstand"
    assert created["file_url"] == f"/api/documents/{created['id']}/download"
    assert created["visibility"] == "members"
    assert await flow.db.documents.count_documents({}) == 1


@pytest.mark.asyncio
async def test_who_sees_which_documents(flow):
    await document(flow, "Statuten", category="statutes")
    await document(flow, "Vorstandsprotokoll", visibility="internal", category="minutes")

    flow.act_as(None)
    assert await titles(flow) == [], "Gäste sehen keine Vereinsdokumente"

    flow.act_as(await flow.add_user(name="community"))
    assert await titles(flow) == [], "ohne Mitgliedschaft keine Vereinsdokumente"

    flow.act_as(await active_member(flow))
    assert await titles(flow) == ["Statuten"], "das Mitglied sieht keine internen Dokumente"

    flow.act_as(await flow.add_staff())
    assert set(await titles(flow)) == {"Statuten", "Vorstandsprotokoll"}
    assert await titles(flow, category="statutes") == ["Statuten"]


@pytest.mark.asyncio
async def test_admin_listing_and_editing(flow):
    await document(flow, "Formular", category="form", order_index=0)
    pinned = await document(flow, "Beitragsordnung", category="regulations", pinned=True, order_index=5)
    statutes = await document(flow, "Statuten", category="statutes", order_index=1)
    flow.act_as(await flow.add_staff())

    listed = await flow.get("/api/documents/admin")
    assert listed.status_code == 200
    assert [doc["title"] for doc in listed.json()] == ["Beitragsordnung", "Formular", "Statuten"]
    assert listed.json()[0]["id"] == pinned

    changed = await flow.patch(f"/api/documents/{statutes}", json={"title": "Statuten 2030", "category": "regulations", "pinned": True})
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert body["title"] == "Statuten 2030" and body["category"] == "regulations" and body["pinned"] is True

    missing = await flow.patch("/api/documents/gibt-es-nicht", json={"title": "X"})
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_documents_are_managed_only_with_the_club_area(flow):
    doc_id = await document(flow, "Statuten")
    flow.act_as(await flow.add_user(name="community"))

    created = await flow.post("/api/documents", json={"title": "Nein", "file_url": "https://example.test/nein.pdf"})
    assert created.status_code == 403, created.text
    patched = await flow.patch(f"/api/documents/{doc_id}", json={"title": "Nein"})
    assert patched.status_code == 403
    deleted = await flow.delete(f"/api/documents/{doc_id}")
    assert deleted.status_code == 403
    admin_list = await flow.get("/api/documents/admin")
    assert admin_list.status_code == 403

    stored = await flow.db.documents.find({}, {"_id": 0, "title": 1}).to_list(10)
    assert stored == [{"title": "Statuten"}]
