"""Leere Alben (#1224): ein veröffentlichtes Album ohne Fotos und Videos erscheint für Gäste und Mitglieder weder in der
Galerie noch auf der Event-Seite - die Event-Antwort sagt mit ``photos_coming``, dass Fotos folgen. Wer Inhalte pflegt
(Bereich „content“), sieht leere Alben weiter, mit dem Hinweis ``is_empty``. Sobald Medien da sind, erscheint das Album
von selbst. Alle Namen sind erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    event = {"id": new_id(), "slug": "sommer-lan", "name": "Sommer-LAN", "status": "scheduled", "visibility": "public",
             "start_date": (now_utc() - timedelta(days=3)).isoformat(), "end_date": (now_utc() - timedelta(days=2)).isoformat()}
    await flow.db.events.insert_one(dict(event))
    albums = [
        {"id": "a-voll", "slug": "sommer-lan-fotos", "title": "Sommer-LAN Fotos", "published": True, "visibility": "public", "event_id": event["id"], "order_index": 1},
        {"id": "a-leer", "slug": "sommer-lan-tag-2", "title": "Sommer-LAN Tag 2", "published": True, "visibility": "public", "event_id": event["id"], "order_index": 2},
        {"id": "a-mitglieder", "slug": "vereinsabend", "title": "Vereinsabend", "published": True, "visibility": "members", "order_index": 3},
    ]
    await flow.db.gallery_albums.insert_many([dict(album) for album in albums])
    await flow.db.gallery_photos.insert_many([
        {"id": "p1", "album_id": "a-voll", "url": "/uploads/eins.jpg", "media_type": "image", "order_index": 1},
        {"id": "p2", "album_id": "a-voll", "url": "https://video.example/clip", "media_type": "video", "order_index": 2},
        {"id": "p3", "album_id": "a-mitglieder", "url": "/uploads/drei.jpg", "media_type": "image", "order_index": 1},
    ])
    return event


async def people(flow):
    member = await flow.add_user(role="player", name="mitglied")
    member["is_club_member"] = True
    editor = await flow.add_user(role="player", name="redaktion")
    editor["areas"] = ["content"]
    return member, editor


async def gallery_ids(flow, compact=False):
    response = await flow.get("/api/gallery", params={"compact": "true"} if compact else None)
    assert response.status_code == 200, response.text
    return {album["id"]: album for album in response.json()}


@pytest.mark.asyncio
async def test_gallery_hides_empty_albums_from_guests_and_members(flow):
    await setup(flow)
    member, _editor = await people(flow)
    flow.act_as(None)
    assert set(await gallery_ids(flow)) == {"a-voll"}
    assert set(await gallery_ids(flow, compact=True)) == {"a-voll"}
    flow.act_as(member)
    assert set(await gallery_ids(flow)) == {"a-voll", "a-mitglieder"}


@pytest.mark.asyncio
async def test_content_area_still_sees_empty_albums_with_a_hint(flow):
    await setup(flow)
    _member, editor = await people(flow)
    flow.act_as(editor)
    albums = await gallery_ids(flow, compact=True)
    assert {"a-voll", "a-leer"} <= set(albums)
    assert albums["a-leer"]["is_empty"] is True
    assert albums["a-voll"]["is_empty"] is False


@pytest.mark.asyncio
async def test_event_answer_without_empty_album_but_with_photos_coming(flow):
    event = await setup(flow)
    member, editor = await people(flow)
    for viewer in (None, member):
        flow.act_as(viewer)
        response = await flow.get(f"/api/events/{event['slug']}")
        assert response.status_code == 200, response.text
        payload = response.json()
        assert [album["id"] for album in payload["albums"]] == ["a-voll"]
        assert payload["photos_coming"] is True
    flow.act_as(editor)
    payload = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert [album["id"] for album in payload["albums"]] == ["a-voll", "a-leer"]
    assert [album["is_empty"] for album in payload["albums"]] == [False, True]


@pytest.mark.asyncio
async def test_album_appears_by_itself_once_media_are_there(flow):
    event = await setup(flow)
    await flow.db.gallery_photos.insert_one({"id": "p9", "album_id": "a-leer", "url": "/uploads/neu.jpg", "media_type": "image", "order_index": 1})
    flow.act_as(None)
    assert set(await gallery_ids(flow)) == {"a-voll", "a-leer"}
    payload = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert [album["id"] for album in payload["albums"]] == ["a-voll", "a-leer"]
    assert payload["photos_coming"] is False
