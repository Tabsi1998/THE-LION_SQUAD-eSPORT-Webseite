"""Bild in der Mediathek drehen (#2122): Überall sofort gedreht, nicht erst nach 30 Tagen.

Die Datei behält ihren Namen, damit Links aus Newsletter und Discord gültig bleiben. Darum müssen die kleineren Fassungen
neu entstehen und jede Stelle, die das Bild zeigt, eine Version an die Adresse bekommen - sonst liefern ``srcset`` und der
Browser-Zwischenspeicher weiter das alte Bild. Die Maße tauschen mit.
"""
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import phase_fg_routes  # noqa: E402
from services import image_variants, league_look, media_audit, photo_cutout, series_logo, sponsor_images  # noqa: E402

UPLOADS = "/api/static/uploads/"
NAME = "hochkant.webp"
URL = UPLOADS + NAME


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def public(tmp_path, monkeypatch):
    folder = tmp_path / "public"
    folder.mkdir(parents=True)
    monkeypatch.setattr(phase_fg_routes, "PUBLIC_UPLOAD_DIR", folder)
    monkeypatch.setattr(phase_fg_routes, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(media_audit, "PUBLIC_UPLOAD_DIR", folder)
    monkeypatch.setattr(media_audit, "UPLOAD_DIR", tmp_path)
    # 1000 x 500: links rot, rechts blau - so sieht man, wohin gedreht wurde.
    image = Image.new("RGB", (1000, 500), (220, 0, 0))
    image.paste((0, 0, 220), (500, 0, 1000, 500))
    image.save(folder / NAME, format="WEBP", quality=95)
    return folder


async def admin(flow) -> dict:
    chef = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(chef)
    return chef


@pytest.mark.asyncio
async def test_rotating_rebuilds_the_smaller_copies_and_swaps_the_size(flow, public):
    await admin(flow)
    await flow.db.media_uploads.insert_one({"id": "up-1", "filename": NAME, "url": URL, "width": 1000, "height": 500, "media_scope": "admin"})
    stale = image_variants.variant_path(public / NAME, 400)
    stale.parent.mkdir(parents=True)
    Image.new("RGB", (400, 200), (0, 200, 0)).save(stale, format="WEBP")

    response = await flow.post(f"/api/admin/media/{NAME}/rotate", json={"degrees": 90})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["width"], body["height"]) == (500, 1000)
    with Image.open(public / NAME) as rotated:
        assert rotated.size == (500, 1000)
        # 90 Grad im Uhrzeigersinn: das Rote von links liegt jetzt oben.
        assert rotated.convert("RGB").getpixel((250, 100))[0] > 150
    # Die alte Vorschau ist weg, die neue hat die neuen Maße (hochkant, 400 breit).
    with Image.open(stale) as variant:
        assert variant.size == (400, 800)
    row = await flow.db.media_uploads.find_one({"filename": NAME})
    assert (row["width"], row["height"]) == (500, 1000)
    assert row["url"] == URL, "media_uploads kennt die Adresse ohne Version"
    assert row["version"] == body["version"]
    assert body["url"] == f"{URL}?v={body['version']}"


@pytest.mark.asyncio
async def test_every_place_gets_the_new_version_and_the_size_where_it_is_stored(flow, public):
    await admin(flow)
    await flow.db.news_posts.insert_one({"id": "n-1", "title": "Abend", "banner_url": URL, "content": f"Text ![Bild]({URL}) und ![alt]({URL}?v=1)"})
    await flow.db.tournaments.insert_one({"id": "t-1", "award_images": {"1": URL + "?v=1"}})
    await flow.db.teams.insert_one({"id": "team-1", "logo_url": UPLOADS + "variants/hochkant-400.webp"})
    await flow.db.gallery_photos.insert_one({"id": "g-1", "image_url": URL, "thumbnail_url": URL, "width": 1000, "height": 500})
    await flow.db.stickers.insert_one({"id": "s-1", "url": URL, "width": 1000, "height": 500})
    await flow.db.direct_messages.insert_one({"id": "m-1", "updated_at": "alt", "sticker": {"id": "s-1", "url": URL, "width": 1000, "height": 500}})
    await flow.db.news_posts.insert_one({"id": "n-2", "banner_url": UPLOADS + "anderes.webp"})

    body = (await flow.post(f"/api/admin/media/{NAME}/rotate", json={"degrees": -90})).json()

    versioned = f"{URL}?v={body['version']}"
    news = await flow.db.news_posts.find_one({"id": "n-1"})
    assert news["banner_url"] == versioned
    assert news["content"] == f"Text ![Bild]({versioned}) und ![alt]({versioned})"
    assert (await flow.db.tournaments.find_one({"id": "t-1"}))["award_images"]["1"] == versioned
    team = await flow.db.teams.find_one({"id": "team-1"})
    assert team["logo_url"] == f"{UPLOADS}variants/hochkant-400.webp?v={body['version']}"
    photo = await flow.db.gallery_photos.find_one({"id": "g-1"})
    assert photo["image_url"] == versioned and photo["thumbnail_url"] == versioned
    assert (photo["width"], photo["height"]) == (500, 1000)
    sticker = await flow.db.stickers.find_one({"id": "s-1"})
    assert sticker["url"] == versioned and (sticker["width"], sticker["height"]) == (500, 1000)
    message = await flow.db.direct_messages.find_one({"id": "m-1"})
    assert message["sticker"]["url"] == versioned and message["sticker"]["width"] == 500 and message["sticker"]["height"] == 1000
    assert message["updated_at"] == "alt", "eine Nachricht gilt dadurch nicht als bearbeitet"
    assert (await flow.db.news_posts.find_one({"id": "n-2"}))["banner_url"] == UPLOADS + "anderes.webp"
    # Der Wert steht auch in der Antwort und im Protokoll.
    assert body["references"] >= 6
    log = await flow.db.audit_logs.find_one({"action": "media.rotate", "target_id": NAME})
    assert log["data"]["degrees"] == -90


@pytest.mark.asyncio
async def test_punctuation_around_a_bare_address_stays_in_the_text(flow, public):
    await admin(flow)
    await flow.db.news_posts.insert_one({"id": "n-1", "content": f"Am Satzende {URL}. Fett **{URL}** und mit Komma {URL}, fertig."})

    body = (await flow.post(f"/api/admin/media/{NAME}/rotate", json={"degrees": 90})).json()

    versioned = f"{URL}?v={body['version']}"
    news = await flow.db.news_posts.find_one({"id": "n-1"})
    assert news["content"] == f"Am Satzende {versioned}. Fett **{versioned}** und mit Komma {versioned}, fertig."


@pytest.mark.asyncio
async def test_a_rotated_file_is_offered_with_its_version_and_still_counts_as_used(flow, public):
    await admin(flow)
    await flow.db.media_uploads.insert_one({"id": "up-1", "filename": NAME, "url": URL, "media_scope": "admin"})
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": URL})

    body = (await flow.post(f"/api/admin/media/{NAME}/rotate", json={"degrees": 90})).json()

    items = (await flow.get("/api/admin/media?include_usage=true")).json()
    item = next(row for row in items if row["filename"] == NAME)
    assert item["url"] == f"{URL}?v={body['version']}"
    assert item["usage_count"] == 1
    response = await flow.delete(f"/api/admin/media/{NAME}")
    assert response.status_code == 409
    # Die Bildprüfung sieht in der Version keine kaputte Adresse.
    audit = await media_audit.audit_image_references()
    assert audit["summary"]["invalid_local"] == 0 and audit["summary"]["local_ok"] >= 1


@pytest.mark.asyncio
async def test_an_animated_image_is_not_turned_into_a_still(flow, public):
    await admin(flow)
    frames = [Image.new("RGB", (40, 20), color) for color in ((255, 0, 0), (0, 255, 0))]
    frames[0].save(public / "tanz.webp", format="WEBP", save_all=True, append_images=frames[1:], duration=100, loop=0)
    before = (public / "tanz.webp").read_bytes()

    response = await flow.post("/api/admin/media/tanz.webp/rotate", json={"degrees": 90})

    assert response.status_code == 400
    assert "Animierte" in response.json()["detail"]
    assert (public / "tanz.webp").read_bytes() == before


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [URL, URL + "?v=1", URL + "#oben"])
async def test_sorting_old_uploads_finds_a_versioned_address(flow, monkeypatch, value):
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": value})
    monkeypatch.setattr(media_audit, "get_db", lambda: flow.db)

    scope, source = await media_audit._infer_scope_from_references(NAME)

    assert scope == "admin" and source["id"] == "n-1"


@pytest.mark.asyncio
async def test_sorting_old_uploads_does_not_match_a_longer_name(flow, monkeypatch):
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": URL + ".backup"})
    monkeypatch.setattr(media_audit, "get_db", lambda: flow.db)

    scope, _source = await media_audit._infer_scope_from_references(NAME)

    assert scope is None


@pytest.mark.asyncio
async def test_an_image_from_the_member_system_cannot_be_rotated(flow, public):
    await admin(flow)
    name = f"{sponsor_images.PREFIX}1-logo-dark-abc.webp"
    Image.new("RGB", (40, 20), (255, 0, 0)).save(public / name, format="WEBP")
    before = (public / name).read_bytes()

    response = await flow.post(f"/api/admin/media/{name}/rotate", json={"degrees": 90})

    assert response.status_code == 409
    assert "Mitgliederverwaltung" in response.json()["detail"]
    assert (public / name).read_bytes() == before


def test_the_sync_recognises_its_file_behind_a_version(tmp_path, monkeypatch):
    monkeypatch.setattr(sponsor_images, "UPLOAD_DIR", tmp_path)
    name = f"{sponsor_images.PREFIX}1-logo-dark-abc.png"
    (tmp_path / name).write_bytes(b"bild")
    entry = {"url": f"{UPLOADS}{name}?v=123"}

    assert sponsor_images._name_of(entry) == name
    assert sponsor_images._stored(entry) is True


@pytest.mark.asyncio
async def test_a_versioned_address_passes_the_checks_of_the_image_fields(flow):
    versioned = URL + "?v=1789000000"
    await flow.db.media_uploads.insert_one({"id": "up-1", "filename": NAME, "url": URL, "media_type": "image"})

    await series_logo.check(flow.db, versioned)
    await league_look.check_uploaded(flow.db, {league_look.EMBLEM: versioned})
    assert series_logo.LOGO_URL.fullmatch(versioned)
    assert league_look.IMAGE_URL.fullmatch(versioned)
    assert not league_look.IMAGE_URL.fullmatch(URL + "?x=1"), "andere Zusätze bleiben verboten"
    flags = await photo_cutout.flags_for(flow.db, [versioned])
    assert set(flags) == {versioned}


@pytest.mark.asyncio
async def test_a_sticker_can_use_a_rotated_image(flow):
    await admin(flow)
    await flow.db.media_uploads.insert_one({"id": "up-1", "filename": NAME, "url": URL, "width": 500, "height": 1000})
    pack = (await flow.post("/api/stickers/admin/packs", json={"name": "Eigenes"})).json()

    created = await flow.post(f"/api/stickers/admin/packs/{pack['id']}/stickers", json={"name": "Löwe", "url": URL + "?v=1789000000"})

    assert created.status_code == 200, created.text
    assert created.json()["width"] == 500
