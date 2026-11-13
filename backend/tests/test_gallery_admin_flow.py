"""Galerie in der Verwaltung (#932): Alben anlegen und ändern, Fotos beschriften und entfernen, externe Videos,
Abschnitte mit Reihenfolge - und was Gäste von der Galerie sehen.

Durch die echte Anwendung (flow_harness) statt gegen einen laufenden Server. Ersetzt aus
test_phase3_news_events_gallery.py: TestGallery::test_create_album, TestGallery::test_public_album_list_with_photo_count,
TestGallery::test_member_album_anon_403, TestGallery::test_patch_album_title, TestGallery::test_patch_photo_caption,
TestGallery::test_delete_photo, TestGallery::test_admin_gallery_includes_unpublished,
TestGallery::test_album_accepts_external_video_media, TestGallery::test_album_sections_order_and_media_assignment,
TestGallery::test_cu_cannot_create_album.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def album(flow, slug: str, *, visibility: str = "public", published: bool = True) -> str:
    album_id = new_id()
    await flow.db.gallery_albums.insert_one({
        "id": album_id, "slug": slug, "title": f"Album {slug}", "visibility": visibility, "published": published,
        "order_index": 0, "created_at": "2026-10-01T10:00:00+00:00",
    })
    return album_id


async def photo(flow, album_id: str, *, caption: str | None = None, order_index: int = 0) -> str:
    photo_id = new_id()
    await flow.db.gallery_photos.insert_one({
        "id": photo_id, "album_id": album_id, "image_url": f"https://example.test/{photo_id}.jpg", "caption": caption,
        "order_index": order_index, "uploaded_at": "2026-10-01T10:00:00+00:00",
    })
    return photo_id


async def detail(flow, slug: str) -> dict:
    res = await flow.get(f"/api/gallery/{slug}")
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.asyncio
async def test_staff_creates_an_album_for_an_event(flow):
    event_id = new_id()
    await flow.db.events.insert_one({"id": event_id, "slug": "lan", "name": "LAN", "status": "scheduled", "visibility": "public"})
    flow.act_as(await flow.add_staff())
    res = await flow.post("/api/gallery", json={"title": "LAN Fotos", "visibility": "public", "event_id": event_id,
                                                "taken_at": "2030-06-02T22:00:00Z", "published": True})
    assert res.status_code == 200, res.text
    created = res.json()
    assert created["visibility"] == "public" and created["event_id"] == event_id and created["id"]
    stored = await flow.db.gallery_albums.find_one({"id": created["id"]})
    assert stored["slug"] == created["slug"]


@pytest.mark.asyncio
async def test_guests_see_published_public_albums_with_media_only(flow):
    public = await album(flow, "oeffentlich")
    await photo(flow, public)
    await photo(flow, public)
    members = await album(flow, "mitglieder", visibility="members")
    await photo(flow, members)
    hidden = await album(flow, "unveroeffentlicht", published=False)
    await photo(flow, hidden)
    await album(flow, "leer")

    flow.act_as(None)
    res = await flow.get("/api/gallery")
    assert res.status_code == 200
    by_slug = {row["slug"]: row for row in res.json()}
    assert set(by_slug) == {"oeffentlich"}, "Mitglieder-, unveröffentlichte und leere Alben fehlen für Gäste"
    assert by_slug["oeffentlich"]["photo_count"] == 2
    members_detail = await flow.get("/api/gallery/mitglieder")
    assert members_detail.status_code == 403


@pytest.mark.asyncio
async def test_staff_edits_album_and_photos(flow):
    album_id = await album(flow, "sommerfest")
    first = await photo(flow, album_id, caption="Foto 1", order_index=0)
    second = await photo(flow, album_id, order_index=1)
    await album(flow, "entwurf", published=False)
    flow.act_as(await flow.add_staff())

    renamed = await flow.patch(f"/api/gallery/{album_id}", json={"title": "Sommerfest 2030"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "Sommerfest 2030"

    captioned = await flow.patch(f"/api/gallery/photos/{first}", json={"caption": "Neu beschriftet"})
    assert captioned.status_code == 200, captioned.text
    assert captioned.json()["caption"] == "Neu beschriftet"

    removed = await flow.delete(f"/api/gallery/photos/{second}")
    assert removed.status_code == 200
    slug = renamed.json()["slug"]
    left = [row["id"] for row in (await detail(flow, slug))["photos"]]
    assert left == [first]

    admin_list = await flow.get("/api/admin/gallery")
    assert admin_list.status_code == 200
    assert "entwurf" in [row["slug"] for row in admin_list.json()]


@pytest.mark.asyncio
async def test_album_accepts_an_external_video(flow):
    album_id = await album(flow, "videos")
    flow.act_as(await flow.add_staff())
    res = await flow.post(f"/api/gallery/{album_id}/photos", json={
        "media_type": "video", "source_type": "external", "external_url": "https://example.test/clip.mp4",
        "video_url": "https://example.test/clip.mp4", "caption": "Clip",
    })
    assert res.status_code == 200, res.text
    assert res.json()["media_type"] == "video"
    assert (await detail(flow, "videos"))["photos"][0]["media_type"] == "video"
    admin_list = await flow.get("/api/admin/gallery")
    row = next(item for item in admin_list.json() if item["id"] == album_id)
    assert row["video_count"] == 1 and row["media_count"] == 1 and row["photo_count"] == 0

    # Externe Medien brauchen eine http(s)-Adresse.
    refused = await flow.post(f"/api/gallery/{album_id}/photos", json={
        "media_type": "video", "source_type": "external", "external_url": "ftp://example.test/clip.mp4",
    })
    assert refused.status_code == 400, refused.text
    assert await flow.db.gallery_photos.count_documents({"album_id": album_id}) == 1


@pytest.mark.asyncio
async def test_sections_sort_by_order_and_carry_their_media(flow):
    album_id = await album(flow, "abschnitte")
    flow.act_as(await flow.add_staff())
    day_one = await flow.post(f"/api/gallery/{album_id}/sections", json={"title": "Tag 1", "order_index": 20})
    setup = await flow.post(f"/api/gallery/{album_id}/sections", json={"title": "Aufbau", "order_index": 10})
    assert day_one.status_code == 200, day_one.text
    assert setup.status_code == 200, setup.text
    # Das Foto für „Tag 1“ kommt zuerst - die Abschnittsreihenfolge gewinnt.
    on_day_one = await flow.post(f"/api/gallery/{album_id}/photos", json={
        "image_url": "https://example.test/tag1.jpg", "caption": "Tag 1", "section_id": day_one.json()["id"]})
    on_setup = await flow.post(f"/api/gallery/{album_id}/photos", json={
        "image_url": "https://example.test/aufbau.jpg", "caption": "Aufbau", "section_id": setup.json()["id"]})
    assert on_day_one.status_code == 200, on_day_one.text
    assert on_setup.status_code == 200, on_setup.text

    body = await detail(flow, "abschnitte")
    assert [section["title"] for section in body["sections"]] == ["Aufbau", "Tag 1"]
    assert [item["section_title"] for item in body["photos"]] == ["Aufbau", "Tag 1"]

    moved = await flow.patch(f"/api/gallery/photos/{on_day_one.json()['id']}", json={"section_id": None})
    assert moved.status_code == 200, moved.text
    after = await detail(flow, "abschnitte")
    moved_row = next(item for item in after["photos"] if item["id"] == on_day_one.json()["id"])
    assert moved_row["section_id"] is None and "section_title" not in moved_row


@pytest.mark.asyncio
async def test_a_normal_person_cannot_create_an_album(flow):
    flow.act_as(await flow.add_user(name="community"))
    refused = await flow.post("/api/gallery", json={"title": "Nein"})
    assert refused.status_code == 403, refused.text
    assert await flow.db.gallery_albums.count_documents({}) == 0
