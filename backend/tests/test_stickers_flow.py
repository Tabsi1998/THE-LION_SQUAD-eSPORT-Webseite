"""Sticker im Chat - durch die echte Anwendung geschickt.

Geprüft wird, was man im Chat nicht sieht: Gesendet werden nur Sticker aus
Paketen, die gerade angeboten werden. Eine Nachricht behält ihren Sticker, auch
wenn das Paket später verschwindet. Und eigene Sticker kommen nur aus dem
eigenen Upload, nie von fremden Adressen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import stickers  # noqa: E402

LION = "fluent-lion"
ESPORTS_PACK = "fluent-esports"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def sticker_ids(packs: list[dict]) -> list[str]:
    return [sticker["id"] for pack in packs for sticker in pack["stickers"]]


# ---------------------------------------------------------------- Startpaket

def test_every_sticker_of_the_starter_pack_has_its_picture_and_the_licence_ships_along():
    catalog = stickers.builtin_catalog()
    ids = sticker_ids(catalog["packs"])
    assert len(ids) == len(set(ids))
    assert len(ids) >= 60
    prefix = "/api/stickers/files/"
    for pack in catalog["packs"]:
        for sticker in pack["stickers"]:
            assert sticker["url"].startswith(prefix), sticker
            folder, filename = sticker["url"][len(prefix):].split("/")
            path = stickers.sticker_file_path(folder, filename)
            assert path is not None, sticker["url"]
            assert path.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    # MIT verlangt, dass der Lizenztext mit den Bildern weitergegeben wird.
    licence = stickers.STICKER_ROOT / "fluent" / "LICENSE.txt"
    assert "MIT License" in licence.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_sticker_pictures_are_cached_and_nothing_outside_their_folder_is_served(flow):
    picture = await flow.get("/api/stickers/files/fluent/lion.png")
    assert picture.status_code == 200
    assert picture.headers["content-type"] == "image/png"
    assert "max-age" in picture.headers["cache-control"]

    for path in (
        "/api/stickers/files/fluent/..%2F..%2Fserver.py",
        "/api/stickers/files/fluent/lion.py",
        "/api/stickers/files/..%2Fservices/stickers.py",
    ):
        assert (await flow.get(path)).status_code == 404, path


@pytest.mark.asyncio
async def test_the_catalog_is_only_for_signed_in_people(flow):
    flow.act_as(None)
    assert (await flow.get("/api/stickers")).status_code == 401


# ---------------------------------------------------------------- Senden

@pytest.mark.asyncio
async def test_a_direct_message_sticker_is_stored_with_the_message(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    flow.act_as(alice)

    catalog = await flow.get("/api/stickers")
    assert catalog.status_code == 200
    assert LION in sticker_ids(catalog.json()["packs"])

    sent = await flow.post(f"/api/messages/direct/{bob['id']}", json={"sticker_id": LION})

    assert sent.status_code == 200, sent.text
    message = sent.json()
    assert message["message"] == ""
    assert message["sticker"] == {
        "id": LION, "pack_id": ESPORTS_PACK, "name": "Löwe",
        "url": "/api/stickers/files/fluent/lion.png", "width": message["sticker"]["width"], "height": message["sticker"]["height"],
    }
    notification = await flow.db.notifications.find_one({"user_id": bob["id"], "kind": "direct_message"})
    assert notification["body"] == "[Sticker]"


@pytest.mark.asyncio
async def test_a_sticker_goes_alone_and_only_if_it_exists(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    flow.act_as(alice)
    url = f"/api/messages/direct/{bob['id']}"

    with_text = await flow.post(url, json={"message": "gg", "sticker_id": LION})
    with_attachment = await flow.post(url, json={"attachment_ids": ["att-1"], "sticker_id": LION})
    unknown = await flow.post(url, json={"sticker_id": "fluent-gibt-es-nicht"})

    assert with_text.status_code == 400
    assert "allein" in with_text.json()["detail"]
    assert with_attachment.status_code == 400
    assert unknown.status_code == 400
    assert await flow.db.direct_messages.count_documents({}) == 0


@pytest.mark.asyncio
async def test_team_and_tournament_chat_take_stickers_too(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    team = {
        "id": new_id(), "name": "Lions Rot", "tag": "LSR",
        "captain_id": alice["id"], "owner_id": alice["id"],
        "member_ids": [alice["id"], bob["id"]], "is_public": True,
    }
    await flow.db.teams.insert_one(dict(team))
    tournament = await flow.create_tournament(show_chat=True)
    await flow.register(tournament, alice)
    flow.act_as(alice)

    team_message = await flow.post(f"/api/teams/{team['id']}/chat", json={"sticker_id": "fluent-trophy"})
    tournament_message = await flow.post(f"/api/tournaments/{tournament['id']}/chat", json={"sticker_id": "fluent-fire"})

    assert team_message.status_code == 200, team_message.text
    assert team_message.json()["sticker"]["name"] == "Pokal"
    assert tournament_message.status_code == 200, tournament_message.text
    assert tournament_message.json()["sticker"]["name"] == "Feuer"
    flow.act_as(bob)
    history = await flow.get(f"/api/teams/{team['id']}/chat")
    assert history.json()[-1]["sticker"]["id"] == "fluent-trophy"


# ---------------------------------------------------------------- Adminbereich

@pytest.mark.asyncio
async def test_admins_add_an_own_pack_that_members_see_first(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")

    flow.act_as(alice)
    assert (await flow.post("/api/stickers/admin/packs", json={"name": "Löwen"})).status_code == 403

    flow.act_as(admin)
    pack = await flow.post("/api/stickers/admin/packs", json={"name": "Lion Squad"})
    assert pack.status_code == 200, pack.text
    pack_id = pack.json()["id"]

    # Ein leeres Paket bietet der Chat nicht an.
    flow.act_as(alice)
    assert pack_id not in [item["id"] for item in (await flow.get("/api/stickers")).json()["packs"]]

    flow.act_as(admin)
    foreign = await flow.post(f"/api/stickers/admin/packs/{pack_id}/stickers", json={"name": "Löwe", "url": "https://example.com/loewe.png"})
    assert foreign.status_code == 400
    await flow.db.media_uploads.insert_one({"id": new_id(), "url": "/api/static/uploads/abc123.webp", "width": 512, "height": 480})
    created = await flow.post(
        f"/api/stickers/admin/packs/{pack_id}/stickers",
        json={"name": "Brüllender Löwe", "url": "/api/static/uploads/abc123.webp", "keywords": ["Brüll", " löwe ", "brüll"]},
    )
    assert created.status_code == 200, created.text
    sticker = created.json()
    assert sticker["keywords"] == ["brüll", "löwe"]
    assert (sticker["width"], sticker["height"]) == (512, 480)

    flow.act_as(alice)
    packs = (await flow.get("/api/stickers")).json()["packs"]
    assert packs[0]["id"] == pack_id
    assert packs[0]["builtin"] is False
    sent = await flow.post(f"/api/messages/direct/{bob['id']}", json={"sticker_id": sticker["id"]})
    assert sent.status_code == 200, sent.text
    assert sent.json()["sticker"]["url"] == "/api/static/uploads/abc123.webp"


@pytest.mark.asyncio
async def test_a_pack_switched_off_is_no_longer_offered_but_old_messages_keep_their_sticker(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    flow.act_as(alice)
    assert (await flow.post(f"/api/messages/direct/{bob['id']}", json={"sticker_id": LION})).status_code == 200

    flow.act_as(admin)
    renamed = await flow.patch(f"/api/stickers/admin/packs/{ESPORTS_PACK}", json={"name": "Umbenannt"})
    assert renamed.status_code == 400
    assert (await flow.client.delete(f"/api/stickers/admin/packs/{ESPORTS_PACK}")).status_code == 400
    switched_off = await flow.patch(f"/api/stickers/admin/packs/{ESPORTS_PACK}", json={"active": False})
    assert switched_off.status_code == 200
    admin_view = (await flow.get("/api/stickers/admin")).json()["packs"]
    assert next(pack for pack in admin_view if pack["id"] == ESPORTS_PACK)["active"] is False

    flow.act_as(alice)
    assert ESPORTS_PACK not in [pack["id"] for pack in (await flow.get("/api/stickers")).json()["packs"]]
    again = await flow.post(f"/api/messages/direct/{bob['id']}", json={"sticker_id": LION})
    assert again.status_code == 400

    flow.act_as(bob)
    thread = await flow.get(f"/api/messages/direct/{alice['id']}")
    assert thread.status_code == 200, thread.text
    assert thread.json()["messages"][0]["sticker"]["id"] == LION


@pytest.mark.asyncio
async def test_deleting_an_own_pack_removes_its_stickers(flow):
    admin = await flow.add_user(role="club_admin", name="vorstand")
    flow.act_as(admin)
    pack_id = (await flow.post("/api/stickers/admin/packs", json={"name": "Saison 2026"})).json()["id"]
    created = await flow.post(
        f"/api/stickers/admin/packs/{pack_id}/stickers",
        json={"name": "Meister", "url": "/api/static/uploads/meister.png"},
    )
    assert created.status_code == 200, created.text

    deleted = await flow.client.delete(f"/api/stickers/admin/packs/{pack_id}")

    assert deleted.status_code == 200
    assert await flow.db.stickers.count_documents({"pack_id": pack_id}) == 0
    assert (await flow.client.delete(f"/api/stickers/admin/stickers/{created.json()['id']}")).status_code == 404
