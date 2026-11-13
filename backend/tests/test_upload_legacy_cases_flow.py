"""Hochladen von Bildern und Vereinsdokumenten (#932): ohne Anmeldung kein Upload, ein PNG landet unter
/api/static/uploads/ und ist dort abrufbar, falsche Dateitypen werden abgewiesen, und Dokumente lädt nur die
Vereinsverwaltung hoch.

Durch die echte Anwendung (flow_harness) statt gegen einen laufenden Server. Ersetzt aus test_phase5_badges.py:
TestUpload::test_upload_requires_auth, TestUpload::test_upload_png_and_serve, TestUpload::test_upload_rejects_bad_mime;
aus test_phase4_documents.py: TestUploads::test_upload_pdf_admin, TestUploads::test_upload_disallowed_exe,
TestUploads::test_upload_disallowed_sh, TestUploads::test_upload_community_user_403.
"""
import io
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import upload_routes  # noqa: E402


PDF = b"%PDF-1.4\n" + b"X" * 1000 + b"\n%%EOF\n"


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_routes, "PUBLIC_UPLOAD_DIR", tmp_path / "public")
    monkeypatch.setattr(upload_routes, "PRIVATE_DOC_DIR", tmp_path / "docs")
    instance, shutdown = make_flow()
    # Erst nach make_flow: das Harness importiert die App mit der Test-Umgebung.
    import server
    monkeypatch.setattr(server, "public_upload_dir", tmp_path / "public")
    try:
        yield instance
    finally:
        await shutdown()


def png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (32, 24), (200, 40, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


async def club_person(flow) -> dict:
    user = await flow.add_user(role="player", name="vorstand")
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    return {**user, "areas": ["club"]}


# ---------------------------------------------------------------- Bilder
@pytest.mark.asyncio
async def test_image_upload_needs_a_login_and_serves_the_png(flow, tmp_path):
    flow.act_as(None)
    guest = await flow.post("/api/uploads/image", files={"file": ("a.png", png(), "image/png")})
    assert guest.status_code == 401
    assert not (tmp_path / "public").exists() or not any((tmp_path / "public").iterdir())

    flow.act_as(await flow.add_user(name="erika"))
    res = await flow.post("/api/uploads/image", files={"file": ("bild.png", png(), "image/png")})
    assert res.status_code == 200, res.text
    url = res.json()["url"]
    assert url.startswith("/api/static/uploads/") and url.endswith(".png")
    stored = tmp_path / "public" / url.rsplit("/", 1)[1]
    assert stored.read_bytes().startswith(b"\x89PNG")

    served = await flow.get(url)
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("image/")
    assert served.content.startswith(b"\x89PNG")


@pytest.mark.asyncio
async def test_image_upload_refuses_text(flow):
    flow.act_as(await flow.add_user(name="erika"))
    res = await flow.post("/api/uploads/image", files={"file": ("a.txt", b"hallo", "text/plain")})
    assert res.status_code == 400, res.text
    assert await flow.db.media_uploads.count_documents({}) == 0


# ---------------------------------------------------------------- Dokumente
@pytest.mark.asyncio
async def test_document_upload_takes_a_pdf_and_refuses_programs(flow, tmp_path):
    flow.act_as(await club_person(flow))
    res = await flow.post("/api/uploads/document", files={"file": ("statuten.pdf", PDF, "application/pdf")})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["original_filename"] == "statuten.pdf"
    assert body["mime"] == "application/pdf" and body["size"] == len(PDF)
    assert (tmp_path / "docs" / body["storage_key"]).read_bytes() == PDF

    exe = await flow.post("/api/uploads/document", files={"file": ("tool.exe", b"MZ\x90\x00", "application/x-msdownload")})
    assert exe.status_code == 400
    assert "nicht erlaubt" in exe.json()["detail"]
    script = await flow.post("/api/uploads/document", files={"file": ("run.sh", b"#!/bin/sh\necho hi\n", "application/x-sh")})
    assert script.status_code == 400
    assert sorted(path.name for path in (tmp_path / "docs").iterdir()) == [body["storage_key"]]


@pytest.mark.asyncio
async def test_document_upload_needs_the_club_area(flow, tmp_path):
    flow.act_as(await flow.add_user(name="community"))
    res = await flow.post("/api/uploads/document", files={"file": ("statuten.pdf", PDF, "application/pdf")})
    assert res.status_code == 403, res.text
    assert not (tmp_path / "docs").exists()
