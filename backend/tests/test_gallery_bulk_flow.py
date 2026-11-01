"""Galerie-Sammelaktionen (#2122): mehrere Einträge eines Albums auf einmal - nur dieses Albums, mit Protokoll.

Aus dem Album nehmen löscht die Einträge, die Dateien bleiben in den Medien. Das gilt auch für das ganze Album: Der alte
Text „alle zugeordneten Medien werden entfernt“ stimmte nicht.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import GALLERY_ALBUM_MAX_PHOTOS  # noqa: E402
from routes import news_routes, phase_fg_routes  # noqa: E402

URL = "/api/static/uploads/foto.webp"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def editor(flow) -> dict:
    user = await flow.add_user(role="superadmin", name="redaktion")
    flow.act_as(user)
    return user


async def album_with_photos(flow) -> None:
    await flow.db.gallery_albums.insert_one({"id": "a-1", "title": "Herbst", "slug": "herbst", "sections": [{"id": "s-1", "title": "Siegerehrung", "slug": "siegerehrung", "order_index": 0}]})
    await flow.db.gallery_albums.insert_one({"id": "a-2", "title": "Fremd", "slug": "fremd"})
    for photo_id, album_id in (("p-1", "a-1"), ("p-2", "a-1"), ("p-3", "a-1"), ("fremd", "a-2")):
        await flow.db.gallery_photos.insert_one({"id": photo_id, "album_id": album_id, "image_url": URL, "section_id": None})


@pytest.mark.asyncio
async def test_bulk_remove_only_touches_this_album_and_is_logged(flow):
    user = await editor(flow)
    await album_with_photos(flow)

    response = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": ["p-1", "p-2", "fremd", "gibt-es-nicht"], "action": "delete"})

    assert response.status_code == 200, response.text
    assert response.json()["count"] == 2
    assert sorted([row["id"] async for row in flow.db.gallery_photos.find({})]) == ["fremd", "p-3"]
    log = await flow.db.audit_logs.find_one({"action": "gallery.photos_bulk"})
    assert log["actor_id"] == user["id"] and log["target_id"] == "a-1"
    assert log["data"] == {"action": "delete", "count": 2}


@pytest.mark.asyncio
async def test_bulk_move_checks_the_section(flow):
    await editor(flow)
    await album_with_photos(flow)

    moved = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": ["p-1", "fremd"], "action": "move", "section_id": "s-1"})
    assert moved.status_code == 200 and moved.json()["count"] == 1
    assert (await flow.db.gallery_photos.find_one({"id": "p-1"}))["section_id"] == "s-1"
    assert (await flow.db.gallery_photos.find_one({"id": "fremd"}))["section_id"] is None

    back = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": ["p-1"], "action": "move", "section_id": None})
    assert back.status_code == 200
    assert (await flow.db.gallery_photos.find_one({"id": "p-1"}))["section_id"] is None

    unknown = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": ["p-1"], "action": "move", "section_id": "gibt-es-nicht"})
    assert unknown.status_code in (400, 404, 422)


@pytest.mark.asyncio
async def test_select_all_works_for_the_largest_album_the_admin_page_loads(flow):
    await editor(flow)
    await album_with_photos(flow)
    ids = [f"p-{index}" for index in range(GALLERY_ALBUM_MAX_PHOTOS)]

    response = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": ids, "action": "delete"})
    too_many = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": [*ids, "eins-zu-viel"], "action": "delete"})

    assert response.status_code == 200, response.text
    assert too_many.status_code == 422
    # Die Seite lädt je Album genau so viele: Die beiden Zahlen gehören zusammen.
    source = pathlib.Path(news_routes.__file__).read_text(encoding="utf-8")
    assert f"to_list({GALLERY_ALBUM_MAX_PHOTOS})" in source


@pytest.mark.asyncio
async def test_bulk_needs_an_album_a_selection_and_the_editorial_area(flow):
    await editor(flow)
    await album_with_photos(flow)
    response = await flow.post("/api/gallery/weg/photos/bulk", json={"ids": ["p-1"], "action": "delete"})
    assert response.status_code == 404
    response = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": [], "action": "delete"})
    assert response.status_code == 422

    flow.act_as(await flow.add_user(role="moderator", name="moni"))
    response = await flow.post("/api/gallery/a-1/photos/bulk", json={"ids": ["p-1"], "action": "delete"})
    assert response.status_code == 403
    assert await flow.db.gallery_photos.count_documents({"album_id": "a-1"}) == 3


@pytest.mark.asyncio
async def test_deleting_an_album_keeps_the_files_as_the_dialog_says(flow, tmp_path, monkeypatch):
    user = await editor(flow)
    folder = tmp_path / "public"
    folder.mkdir()
    monkeypatch.setattr(phase_fg_routes, "PUBLIC_UPLOAD_DIR", folder)
    monkeypatch.setattr(phase_fg_routes, "UPLOAD_DIR", tmp_path)
    (folder / "foto.webp").write_bytes(b"bild")
    await album_with_photos(flow)

    response = await flow.delete("/api/gallery/a-1")
    assert response.status_code == 200

    assert await flow.db.gallery_photos.count_documents({"album_id": "a-1"}) == 0
    assert (folder / "foto.webp").exists()
    log = await flow.db.audit_logs.find_one({"action": "gallery.album_delete"})
    assert log["actor_id"] == user["id"] and log["data"] == {"entries": 3}
    # Nach dem Album gilt die Datei wieder als ungenutzt - außer das fremde Album zeigt sie noch.
    items = (await flow.get("/api/admin/media?include_usage=true")).json()
    assert next(row for row in items if row["filename"] == "foto.webp")["usage_count"] == 1
