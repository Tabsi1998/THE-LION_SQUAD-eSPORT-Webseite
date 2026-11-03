"""Sperrliste (docs/LIGA.md, C.4 #2218): Eine gespeicherte Version ist unveränderlich - auch für die Mediathek. Ein Bild darin lässt sich
weder drehen noch löschen, und Duplikat-Ersetzen schreibt die Version nicht um. Nur in der Bibliothek darf sich ein Bild ändern. Erfundene
Inhalte."""
import io
import os
import pathlib
import sys

import pytest
import pytest_asyncio
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import phase_fg_routes  # noqa: E402
from services import account_erasure, media_audit  # noqa: E402

UPLOADS = "/api/static/uploads/"
OLD = 3 * 24 * 3600


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
    (folder / "variants").mkdir(parents=True)
    for module in (phase_fg_routes, media_audit, account_erasure):
        monkeypatch.setattr(module, "PUBLIC_UPLOAD_DIR", folder)
        monkeypatch.setattr(module, "UPLOAD_DIR", tmp_path)
    return folder


def png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 4), (10, 20, 30)).save(out, format="PNG")
    return out.getvalue()


async def add_file(flow, folder, name: str, content: bytes) -> None:
    path = folder / name
    path.write_bytes(content)
    stamp = path.stat().st_mtime - OLD
    os.utime(path, (stamp, stamp))
    await flow.db.media_uploads.insert_one({"id": name, "filename": name, "url": UPLOADS + name, "media_type": "image",
                                            "media_scope": "admin", "owner_role": "admin"})


async def add_version(flow, name: str) -> dict:
    doc = {"id": "v1", "scope": "league_season", "scope_id": "s1", "game_id": "g1", "version": 3, "cleared": False,
           "entries": [{"kind": "attachments", "item_id": "w1", "name": "Blitz 9", "image_url": UPLOADS + name,
                        "attachments": [{"item_id": "a1", "name": "Griff", "image_url": UPLOADS + name}]}]}
    await flow.db.loadout_bans.insert_one(dict(doc))
    return doc


async def admin(flow) -> None:
    flow.act_as(await flow.add_user(role="superadmin", name="chef"))


async def entries(flow) -> list:
    return (await flow.db.loadout_bans.find_one({"id": "v1"}, {"_id": 0, "entries": 1}))["entries"]


@pytest.mark.asyncio
async def test_rotating_an_image_of_a_ban_list_version_is_refused(flow, public):
    await admin(flow)
    original = png()
    await add_file(flow, public, "blitz.png", original)
    version = await add_version(flow, "blitz.png")

    response = await flow.post("/api/admin/media/blitz.png/rotate", json={"degrees": 90})

    assert response.status_code == 409
    assert "Sperrliste, Version 3" in response.json()["detail"]
    assert (public / "blitz.png").read_bytes() == original
    assert await entries(flow) == version["entries"]


@pytest.mark.asyncio
@pytest.mark.parametrize("force", [False, True])
async def test_deleting_an_image_of_a_ban_list_version_is_refused(flow, public, force):
    await admin(flow)
    await add_file(flow, public, "blitz.webp", b"bild")
    await add_version(flow, "blitz.webp")

    response = await flow.delete(f"/api/admin/media/blitz.webp?force={'true' if force else 'false'}")

    assert response.status_code == 409
    assert "Sperrliste" in response.json()["detail"]
    assert (public / "blitz.webp").exists()


@pytest.mark.asyncio
async def test_replacing_duplicates_leaves_a_ban_list_version_unchanged(flow, public):
    await admin(flow)
    await add_file(flow, public, "bleibt.webp", b"gleich")
    await add_file(flow, public, "kopie.webp", b"gleich")
    version = await add_version(flow, "kopie.webp")
    await flow.db.game_equipment.insert_one({"id": "w1", "game_id": "g1", "name": "Blitz 9", "image_url": UPLOADS + "kopie.webp"})

    response = await flow.post("/api/admin/media/duplicates/replace", json={"keep": "bleibt.webp"})

    assert response.status_code == 200, response.text
    assert await entries(flow) == version["entries"]
    assert (public / "kopie.webp").exists()
    assert (await flow.db.game_equipment.find_one({"id": "w1"}))["image_url"].startswith(UPLOADS + "bleibt.webp"), "die Bibliothek darf sich ändern"


@pytest.mark.asyncio
async def test_an_image_only_in_the_library_may_still_be_rotated(flow, public):
    await admin(flow)
    await add_file(flow, public, "neu.png", png())
    await flow.db.game_equipment.insert_one({"id": "w1", "game_id": "g1", "name": "Blitz 9", "image_url": UPLOADS + "neu.png"})

    response = await flow.post("/api/admin/media/neu.png/rotate", json={"degrees": 90})

    assert response.status_code == 200, response.text
    assert "neu.png?v=" in (await flow.db.game_equipment.find_one({"id": "w1"}))["image_url"]
