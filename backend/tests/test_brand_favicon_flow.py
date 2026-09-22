"""Standard-Favicon für hell und dunkel (#229) über die Route: nur Club-Admin, Datei wie ein Upload,
Adresse im Branding und in der Medienliste, ohne eigenes Bild das eingebaute Maskottchen."""
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import brand_favicon, image_variants  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(brand_favicon, "PUBLIC_UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(brand_favicon, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(image_variants, "schedule_variants", lambda path: None)
    return tmp_path


def white_mascot(path):
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    image.paste((255, 255, 255, 255), (50, 50, 150, 150))
    image.save(path)


@pytest.mark.asyncio
async def test_generates_from_the_mascot_and_stores_it_as_the_default(flow, uploads):
    admin = await flow.add_user(role="club_admin", name="admin")
    white_mascot(uploads / "m.png")
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"mascot_url": "/api/static/uploads/m.png", "favicon_url": "/api/static/uploads/m.png", "primary_color": "#FF0000"}}, upsert=True)
    flow.act_as(admin)

    res = await flow.post("/api/settings/branding/favicon/universal")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "/api/static/uploads/m.png" and body["color"] == "#FF0000"
    name = body["favicon_url"].rsplit("/", 1)[-1]
    assert body["favicon_url"].startswith("/api/static/uploads/") and name.endswith(".png") and name != "m.png"
    with Image.open(uploads / name) as out:
        assert out.size == (512, 512) and out.getpixel((256, 24))[:3] == (255, 0, 0) and out.getpixel((0, 0))[3] == 0

    branding = await flow.db.settings.find_one({"id": "branding"}, {"_id": 0})
    assert branding["favicon_url"] == body["favicon_url"] and branding["mascot_url"] == "/api/static/uploads/m.png", "nur der Standard wechselt"
    row = await flow.db.media_uploads.find_one({"url": body["favicon_url"]}, {"_id": 0})
    assert row and row["media_type"] == "image" and row["media_scope"] == "branding" and row["original_filename"] == "favicon-universal.png"
    assert (await flow.get("/api/settings/public")).json()["favicon_url"] == body["favicon_url"]


@pytest.mark.asyncio
async def test_without_own_images_the_builtin_mascot_is_used(flow, uploads):
    admin = await flow.add_user(role="club_admin", name="admin")
    flow.act_as(admin)
    res = await flow.post("/api/settings/branding/favicon/universal")
    assert res.status_code == 200, res.text
    assert res.json()["source"] == brand_favicon.BUILTIN_MASCOT and res.json()["color"] == "#29B6E8"
    assert (uploads / res.json()["favicon_url"].rsplit("/", 1)[-1]).is_file()


@pytest.mark.asyncio
async def test_only_club_admins_and_a_missing_file_is_a_clear_error(flow, uploads):
    player = await flow.add_user(role="player", name="max")
    flow.act_as(player)
    assert (await flow.post("/api/settings/branding/favicon/universal")).status_code == 403

    admin = await flow.add_user(role="club_admin", name="admin")
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"favicon_dark_url": "/api/static/uploads/fehlt.png"}}, upsert=True)
    flow.act_as(admin)
    res = await flow.post("/api/settings/branding/favicon/universal")
    assert res.status_code == 400 and "Kein Bild" in res.json()["detail"]
