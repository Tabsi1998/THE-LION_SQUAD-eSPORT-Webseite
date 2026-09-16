"""Bilder und Videos in Chats - durch die echte Anwendung geschickt.

Öffentliche Uploads (Galerie, Banner) sind ohne Anmeldung abrufbar. Chat-Anhänge
dürfen das nicht sein: Ein Bild aus einer Direktnachricht gehört den zwei
Beteiligten, eines aus dem Team-Chat dem Team. Diese Tests prüfen genau diese
Grenze, und dass man sie nicht umgehen kann, indem man fremde Anhänge
weiterreicht.
"""
import io
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio
from fastapi import HTTPException
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import chat_attachments  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setattr(chat_attachments, "PRIVATE_CHAT_DIR", tmp_path / "chat")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def png(width=64, height=48) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 40, 40)).save(buffer, format="PNG")
    return buffer.getvalue()


async def upload(flow, content=None, filename="bild.png", mime="image/png", **extra_files):
    files = {"file": (filename, content if content is not None else png(), mime), **extra_files}
    return await flow.post("/api/chat-attachments", files=files)


async def uploaded_id(flow, **kwargs) -> str:
    response = await upload(flow, **kwargs)
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def people(flow):
    return (
        await flow.add_user(name="alice"),
        await flow.add_user(name="bob"),
        await flow.add_user(name="carol"),
    )


# ---------------------------------------------------------------- Direktnachricht

@pytest.mark.asyncio
async def test_a_direct_message_image_reaches_only_the_two_people(flow):
    alice, bob, carol = await people(flow)
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow)

    sent = await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [attachment_id]})
    assert sent.status_code == 200, sent.text
    url = sent.json()["attachments"][0]["url"]

    flow.act_as(bob)
    seen = await flow.get(url)
    assert seen.status_code == 200
    assert seen.headers["content-type"] == "image/png"

    flow.act_as(carol)
    assert (await flow.get(url)).status_code == 404
    flow.act_as(None)
    assert (await flow.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_an_unsent_attachment_is_visible_to_its_uploader_only(flow):
    alice, bob, _carol = await people(flow)
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow)

    assert (await flow.get(f"/api/chat-attachments/{attachment_id}")).status_code == 200
    flow.act_as(bob)
    assert (await flow.get(f"/api/chat-attachments/{attachment_id}")).status_code == 404


@pytest.mark.asyncio
async def test_nobody_can_send_someone_elses_upload_or_send_one_twice(flow):
    alice, bob, carol = await people(flow)
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow)

    # Bob kennt die Kennung, darf sie aber nicht in seinen eigenen Chat holen.
    flow.act_as(bob)
    stolen = await flow.post(f"/api/messages/direct/{carol['id']}", json={"attachment_ids": [attachment_id]})
    assert stolen.status_code == 400

    flow.act_as(alice)
    first = await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [attachment_id]})
    assert first.status_code == 200, first.text
    # Weiterreichen in einen anderen Chat, den Carol sehen könnte, geht auch für Alice nicht.
    again = await flow.post(f"/api/messages/direct/{carol['id']}", json={"attachment_ids": [attachment_id]})
    assert again.status_code == 400


@pytest.mark.asyncio
async def test_a_message_needs_text_or_an_attachment(flow):
    alice, bob, _carol = await people(flow)
    flow.act_as(alice)

    empty = await flow.post(f"/api/messages/direct/{bob['id']}", json={"message": "   "})
    assert empty.status_code == 400
    text_only = await flow.post(f"/api/messages/direct/{bob['id']}", json={"message": "Hallo"})
    assert text_only.status_code == 200
    assert text_only.json()["attachments"] == []


@pytest.mark.asyncio
async def test_at_most_four_attachments_per_message(flow):
    alice, bob, _carol = await people(flow)
    flow.act_as(alice)
    ids = [await uploaded_id(flow) for _ in range(5)]

    response = await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": ids})

    assert response.status_code in (400, 422)


@pytest.mark.asyncio
async def test_only_images_and_videos_are_accepted(flow):
    alice, _bob, _carol = await people(flow)
    flow.act_as(alice)

    response = await upload(flow, content=b"%PDF-1.7 ...", filename="vertrag.pdf", mime="application/pdf")

    assert response.status_code == 400


# ---------------------------------------------------------------- Team und Turnier

@pytest.mark.asyncio
async def test_team_chat_attachment_is_for_members_only(flow):
    alice, bob, carol = await people(flow)
    team = {
        "id": new_id(), "name": "Lions Rot", "tag": "LSR",
        "captain_id": alice["id"], "owner_id": alice["id"],
        "member_ids": [alice["id"], bob["id"]], "is_public": True,
    }
    await flow.db.teams.insert_one(dict(team))
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow)

    sent = await flow.post(f"/api/teams/{team['id']}/chat", json={"message": "Aufstellung", "attachment_ids": [attachment_id]})
    assert sent.status_code == 200, sent.text
    url = sent.json()["attachments"][0]["url"]

    flow.act_as(bob)
    assert (await flow.get(url)).status_code == 200
    flow.act_as(carol)
    assert (await flow.get(url)).status_code == 404


@pytest.mark.asyncio
async def test_tournament_chat_attachment_is_for_participants_only(flow):
    alice, bob, carol = await people(flow)
    tournament = await flow.create_tournament(show_chat=True)
    await flow.register(tournament, alice)
    await flow.register(tournament, bob)
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow)

    sent = await flow.post(f"/api/tournaments/{tournament['id']}/chat", json={"attachment_ids": [attachment_id]})
    assert sent.status_code == 200, sent.text
    url = sent.json()["attachments"][0]["url"]

    flow.act_as(bob)
    assert (await flow.get(url)).status_code == 200
    flow.act_as(carol)
    assert (await flow.get(url)).status_code == 404


# ---------------------------------------------------------------- Videos und Bildgrößen

@pytest.mark.asyncio
async def test_a_video_is_stored_with_the_still_image_the_browser_made(flow):
    alice, bob, _carol = await people(flow)
    flow.act_as(alice)
    webm = b"\x1a\x45\xdf\xa3" + b"\x00" * 2048

    response = await upload(flow, content=webm, filename="tor.webm", mime="video/webm",
                            poster=("standbild.png", png(320, 180), "image/png"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["kind"] == "video"
    assert body["mime"] == "video/webm"
    assert body["poster_url"]

    await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [body["id"]]})
    flow.act_as(bob)
    assert (await flow.get(body["url"])).status_code == 200
    poster = await flow.get(body["poster_url"])
    assert poster.status_code == 200
    assert poster.headers["content-type"].startswith("image/")


@pytest.mark.asyncio
async def test_a_large_chat_image_is_offered_in_a_small_version(flow):
    alice, bob, _carol = await people(flow)
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow, content=png(1200, 800))
    await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [attachment_id]})

    flow.act_as(bob)
    small = await flow.get(f"/api/chat-attachments/{attachment_id}?w=400")

    assert small.status_code == 200
    assert small.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(small.content)) as image:
        assert image.width == 400


@pytest.mark.asyncio
async def test_the_sizes_the_app_asks_for_are_served_too(flow):
    """Die App fragt Kacheln mit w=800 und die Vollansicht mit w=1600 ab (#238)."""
    alice, bob, _carol = await people(flow)
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow, content=png(1200, 800))
    await flow.post(f"/api/messages/direct/{bob['id']}", json={"attachment_ids": [attachment_id]})

    flow.act_as(bob)
    medium = await flow.get(f"/api/chat-attachments/{attachment_id}?w=800")
    assert medium.status_code == 200, medium.text
    assert medium.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(medium.content)) as image:
        assert image.width == 800

    # 1600 ist breiter als das Bild: es kommt das Original, kein Fehler.
    large = await flow.get(f"/api/chat-attachments/{attachment_id}?w=1600")
    assert large.status_code == 200, large.text
    with Image.open(io.BytesIO(large.content)) as image:
        assert image.width == 1200

    # Eine Breite außerhalb der Liste ist kein Fehler, sondern das Original.
    odd = await flow.get(f"/api/chat-attachments/{attachment_id}?w=999")
    assert odd.status_code == 200, odd.text


# ---------------------------------------------------------------- Aufräumen und Löschen

@pytest.mark.asyncio
async def test_attachments_never_sent_disappear_after_a_day(flow):
    alice, _bob, _carol = await people(flow)
    flow.act_as(alice)
    fresh = await uploaded_id(flow)
    stale = await uploaded_id(flow)
    stale_doc = await flow.db.chat_attachments.find_one({"id": stale})
    old = (chat_attachments.now_utc() - timedelta(hours=25)).isoformat()
    await flow.db.chat_attachments.update_one({"id": stale}, {"$set": {"created_at": old}})

    removed = await chat_attachments.purge_stale_attachments()

    assert removed == 1
    assert not (chat_attachments.PRIVATE_CHAT_DIR / stale_doc["storage_key"]).exists()
    assert (await flow.get(f"/api/chat-attachments/{stale}")).status_code == 404
    assert (await flow.get(f"/api/chat-attachments/{fresh}")).status_code == 200


@pytest.mark.asyncio
async def test_deleting_an_account_removes_its_chat_attachments(flow):
    alice, bob, _carol = await people(flow)
    flow.act_as(alice)
    attachment_id = await uploaded_id(flow)
    sent = await flow.post(f"/api/messages/direct/{bob['id']}", json={"message": "Foto", "attachment_ids": [attachment_id]})
    doc = await flow.db.chat_attachments.find_one({"id": attachment_id})

    await chat_attachments.delete_user_attachments(flow.db, alice["id"])

    assert not (chat_attachments.PRIVATE_CHAT_DIR / doc["storage_key"]).exists()
    message = await flow.db.direct_messages.find_one({"id": sent.json()["id"]})
    assert message["attachments"] == []
    flow.act_as(bob)
    assert (await flow.get(f"/api/chat-attachments/{attachment_id}")).status_code == 404


# ---------------------------------------------------------------- Gemeinsame Bildprüfung

def test_the_shared_image_check_keeps_small_pictures_and_their_format():
    from routes.upload_routes import _encode_image_bytes

    encoded = _encode_image_bytes(png(64, 48), "image/png", ".png", "bild.png")

    assert encoded["content_type"] == "image/png"
    assert (encoded["width"], encoded["height"]) == (64, 48)
    assert encoded["original_size"] > 0


def test_the_shared_image_check_shrinks_oversized_pictures():
    from routes.upload_routes import MAX_IMAGE_DIMENSION, _encode_image_bytes

    encoded = _encode_image_bytes(png(MAX_IMAGE_DIMENSION + 200, 20), "image/png", ".png", "breit.png")

    assert encoded["width"] == MAX_IMAGE_DIMENSION
    assert encoded["content_type"] == "image/webp"


def test_the_shared_image_check_refuses_what_is_not_a_picture():
    from routes.upload_routes import _encode_image_bytes

    with pytest.raises(HTTPException) as refused:
        _encode_image_bytes(b"kein bild", "image/png", ".png", "falsch.png")

    assert refused.value.status_code == 400
