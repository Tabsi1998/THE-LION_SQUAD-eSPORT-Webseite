"""Upload-Inventar (#537): Dateien auf der Platte gegen alle Verweise in der Datenbank - verwendet,
nur registriert, Vorschaubild, verwaist; Altlast direkt unter uploads/; Verweise auf fehlende Dateien.
Nur lesend."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import uploads_inventory  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def touch(path: pathlib.Path, size: int = 10) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def test_filenames_are_read_from_every_upload_address_shape():
    assert uploads_inventory.upload_filename("/api/static/uploads/a.webp") == "a.webp"
    assert uploads_inventory.upload_filename("https://lionsquad.at/api/static/uploads/b.png?v=2") == "b.png"
    assert uploads_inventory.upload_filename("/uploads/c.jpg") == "c.jpg"
    assert uploads_inventory.upload_filename("/api/static/uploads/variants/a-400.webp") == "a-400.webp"
    assert uploads_inventory.upload_filename("https://example.org/logo.png") is None
    assert uploads_inventory.upload_filename("") is None


@pytest.mark.asyncio
async def test_inventory_tells_used_registered_variant_and_orphan_files_apart(flow, tmp_path):
    root = tmp_path / "uploads"
    touch(root / "public" / "avatar.webp", 300)
    touch(root / "public" / "variants" / "avatar-400.webp", 40)
    touch(root / "public" / "news-bild.webp", 500)
    touch(root / "public" / "nur-registriert.png", 120)
    touch(root / "public" / "niemand.webp", 900)
    touch(root / "public" / "variants" / "geist-800.webp", 30)
    touch(root / "alt-avatar.jpg", 200)
    touch(root / "documents" / "statuten.pdf", 1000)
    touch(root / "chat" / "anhang.webp", 70)
    touch(root / "app-releases" / "lionsapp-1.0.0.apk", 5000)

    db = flow.db
    await db.users.insert_one({"id": "u1", "username": "paula", "avatar_url": "/api/static/uploads/avatar.webp", "banner_url": "https://cdn.example.org/extern.png"})
    await db.news_posts.insert_one({"id": "n1", "slug": "hallo", "content": "Text ![Bild](/api/static/uploads/news-bild.webp) mehr", "cover_url": "/api/static/uploads/fehlt.webp"})
    await db.media_uploads.insert_one({"id": "m1", "filename": "nur-registriert.png", "url": "/api/static/uploads/nur-registriert.png"})
    await db.media_uploads.insert_one({"id": "m2", "filename": "avatar.webp", "url": "/api/static/uploads/avatar.webp"})
    await db.club_member_profiles.insert_one({"id": "p1", "photo_url": "/uploads/alt-avatar.jpg"})
    await db.documents.insert_one({"id": "d1", "stored_name": "statuten.pdf", "title": "Statuten"})
    await db.chat_attachments.insert_one({"id": "c1", "filename": "anhang.webp", "meta": {"nested": ["anhang.webp"]}})

    report = await uploads_inventory.inventory(db, root, sample=10)
    state = {row["path"]: row["state"] for row in report["files"]}
    assert state["public/avatar.webp"] == "referenced" and state["public/news-bild.webp"] == "referenced"
    assert state["public/variants/avatar-400.webp"] == "variant" and state["public/variants/geist-800.webp"] == "stray_variant"
    assert state["public/nur-registriert.png"] == "registered"
    assert state["public/niemand.webp"] == "orphan"
    assert state["alt-avatar.jpg"] == "referenced", "Altlast, aber verwendet"
    assert state["documents/statuten.pdf"] == "referenced" and state["chat/anhang.webp"] == "referenced"
    assert state["app-releases/lionsapp-1.0.0.apk"] == "orphan"
    areas = {row["path"]: row["area"] for row in report["files"]}
    assert areas["alt-avatar.jpg"] == "legacy" and areas["public/variants/avatar-400.webp"] == "variants" and areas["documents/statuten.pdf"] == "documents"
    by_name = {row["path"]: row for row in report["files"]}
    assert by_name["public/avatar.webp"]["referenced_by"] == ["users"] and by_name["public/avatar.webp"]["registered"] is True
    assert by_name["chat/anhang.webp"]["referenced_by"] == ["chat_attachments"]
    assert report["by_state"]["orphan"]["count"] == 2 and report["by_state"]["stray_variant"]["count"] == 1
    assert report["orphan_count"] == 3 and report["orphan_bytes"] == 900 + 5000 + 30
    assert report["orphans"][0]["path"] == "app-releases/lionsapp-1.0.0.apk", "größte zuerst"
    assert report["missing"] == [{"name": "fehlt.webp", "referenced_by": ["news_posts"]}]
    assert report["by_origin"]["users"] == {"count": 1, "bytes": 300} and report["by_origin"]["news_posts"]["count"] == 1
    assert report["partial_collections"] == []

    text = uploads_inventory.render_markdown(report)
    assert "## Verwaist: 3 Dateien" in text and "`public/niemand.webp`" in text
    assert "Altlast: direkt unter uploads/" in text and "Profile (Avatar, Banner)" in text
    assert "`fehlt.webp` | news_posts" in text and "Nur gelesen, nichts geändert" in text
