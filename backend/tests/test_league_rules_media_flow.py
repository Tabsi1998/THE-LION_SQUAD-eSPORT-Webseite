"""Regelwerk der Liga (docs/LIGA.md, #1646): Die Mediathek ändert nichts an einer veröffentlichten Fassung - weder den Text noch die Datei
dahinter. Entwürfe dürfen sich ändern. Erfundene Inhalte."""
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
from services import account_erasure, image_migrate, media_audit  # noqa: E402
from services.mutation_lock import MutationLockBusy, league_season_resource, mutation_lock  # noqa: E402

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


def png(color=(10, 20, 30)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (8, 4), color).save(out, format="PNG")
    return out.getvalue()


async def add_file(flow, folder, name: str, content: bytes) -> None:
    path = folder / name
    path.write_bytes(content)
    stamp = path.stat().st_mtime - OLD
    os.utime(path, (stamp, stamp))
    await flow.db.media_uploads.insert_one({"id": name, "filename": name, "url": UPLOADS + name, "media_type": "image",
                                            "media_scope": "admin", "owner_role": "admin"})


async def add_rule(flow, rule_id: str, *, status: str, image: str, version: int | None = 1) -> dict:
    doc = {"id": rule_id, "scope": "league_season", "scope_id": f"s-{rule_id}", "status": status, "version": version, "title": "Regelwerk",
           "body_md": f"# Plan\n![Plan]({UPLOADS}{image})", "annexes": [{"key": "A", "title": "Karte", "body_md": f"![Karte]({UPLOADS}{image})"}]}
    await flow.db.league_rules.insert_one(dict(doc))
    return doc


async def admin(flow) -> dict:
    chef = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(chef)
    return chef


async def stored(flow, rule_id: str) -> dict:
    return await flow.db.league_rules.find_one({"id": rule_id}, {"_id": 0, "body_md": 1, "annexes": 1})


# ---------------------------------------------------------------- Duplikate

@pytest.mark.asyncio
async def test_replacing_duplicates_leaves_a_published_version_and_its_file(flow, public):
    await admin(flow)
    await add_file(flow, public, "bleibt.webp", b"gleich")
    await add_file(flow, public, "kopie.webp", b"gleich")
    published = await add_rule(flow, "fertig", status="published", image="kopie.webp")
    await add_rule(flow, "entwurf", status="draft", image="kopie.webp", version=None)
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": UPLOADS + "kopie.webp"})

    response = await flow.post("/api/admin/media/duplicates/replace", json={"keep": "bleibt.webp"})

    assert response.status_code == 200, response.text
    assert await stored(flow, "fertig") == {"body_md": published["body_md"], "annexes": published["annexes"]}
    assert (public / "kopie.webp").exists(), "die veröffentlichte Fassung zeigt die Datei weiter"
    assert response.json()["kept"] == ["kopie.webp"]
    draft = await stored(flow, "entwurf")
    assert "bleibt.webp" in draft["body_md"] and "bleibt.webp" in draft["annexes"][0]["body_md"], "ein Entwurf darf sich ändern"
    assert (await flow.db.news_posts.find_one({"id": "n-1"}))["banner_url"].startswith(UPLOADS + "bleibt.webp")


# ---------------------------------------------------------------- Drehen

@pytest.mark.asyncio
async def test_rotating_an_image_of_a_published_version_is_refused(flow, public):
    await admin(flow)
    original = png()
    await add_file(flow, public, "plan.png", original)
    published = await add_rule(flow, "fertig", status="published", image="plan.png")

    response = await flow.post("/api/admin/media/plan.png/rotate", json={"degrees": 90})

    assert response.status_code == 409
    assert "veröffentlichten Regelversion" in response.json()["detail"]
    assert (public / "plan.png").read_bytes() == original
    assert await stored(flow, "fertig") == {"body_md": published["body_md"], "annexes": published["annexes"]}


@pytest.mark.asyncio
async def test_rotating_an_image_of_a_draft_still_works(flow, public):
    await admin(flow)
    original = png()
    await add_file(flow, public, "plan.png", original)
    await add_rule(flow, "entwurf", status="draft", image="plan.png", version=None)

    response = await flow.post("/api/admin/media/plan.png/rotate", json={"degrees": 90})

    assert response.status_code == 200, response.text
    assert (public / "plan.png").read_bytes() != original
    assert "plan.png?v=" in (await stored(flow, "entwurf"))["body_md"]


# ---------------------------------------------------------------- Löschen

@pytest.mark.asyncio
@pytest.mark.parametrize("force", [False, True])
async def test_deleting_an_image_of_a_published_version_is_refused_also_with_confirmation(flow, public, force):
    await admin(flow)
    await add_file(flow, public, "plan.webp", b"bild")
    await add_rule(flow, "fertig", status="published", image="plan.webp")

    response = await flow.delete(f"/api/admin/media/plan.webp?force={'true' if force else 'false'}")

    assert response.status_code == 409
    assert "veröffentlichten Regelversion" in response.json()["detail"]
    assert (public / "plan.webp").exists()


@pytest.mark.asyncio
async def test_deleting_an_image_of_a_draft_asks_and_then_goes(flow, public):
    await admin(flow)
    await add_file(flow, public, "plan.webp", b"bild")
    await add_rule(flow, "entwurf", status="draft", image="plan.webp", version=None)

    first = await flow.delete("/api/admin/media/plan.webp")
    assert first.status_code == 409 and "bestätigen" in first.json()["detail"]
    second = await flow.delete("/api/admin/media/plan.webp?force=true")
    assert second.status_code == 200, second.text
    assert not (public / "plan.webp").exists()


@pytest.mark.asyncio
async def test_cleanup_keeps_an_image_of_a_published_version(flow, public):
    await admin(flow)
    await add_file(flow, public, "plan.webp", b"bild")
    await add_rule(flow, "fertig", status="published", image="plan.webp")

    response = await flow.post("/api/admin/media/cleanup-unused", json={"filenames": ["plan.webp"]})

    assert (public / "plan.webp").exists(), response.text


# ---------------------------------------------------------------- Gleichzeitig veröffentlicht

def publish_while_reading(flow, monkeypatch, rule_id: str) -> None:
    """Die Mediathek liest den Entwurf, und noch bevor sie schreibt, ist er veröffentlicht."""
    real = media_audit.iter_usages

    async def reading(db, names):
        async for hit in real(db, names):
            yield hit
        await flow.db.league_rules.update_one({"id": rule_id}, {"$set": {"status": "published", "version": 1}})

    monkeypatch.setattr(media_audit, "iter_usages", reading)


@pytest.mark.asyncio
async def test_repointing_leaves_a_draft_alone_that_was_published_meanwhile(flow, public, monkeypatch):
    before = await add_rule(flow, "gerade", status="draft", image="kopie.webp", version=None)
    publish_while_reading(flow, monkeypatch, "gerade")
    await media_audit.repoint_usages(flow.db, "kopie.webp", UPLOADS + "bleibt.webp", {"updated_at": "jetzt"})
    assert await stored(flow, "gerade") == {"body_md": before["body_md"], "annexes": before["annexes"]}


@pytest.mark.asyncio
async def test_a_new_version_stamp_leaves_a_draft_alone_that_was_published_meanwhile(flow, public, monkeypatch):
    before = await add_rule(flow, "gerade", status="draft", image="plan.png", version=None)
    publish_while_reading(flow, monkeypatch, "gerade")
    await media_audit.stamp_version(flow.db, "plan.png", 7, (4, 8), {"updated_at": "jetzt"})
    assert await stored(flow, "gerade") == {"body_md": before["body_md"], "annexes": before["annexes"]}


@pytest.mark.asyncio
async def test_other_places_are_still_rewritten_without_a_status(flow, public):
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": UPLOADS + "kopie.webp", "status": "published"})
    await media_audit.repoint_usages(flow.db, "kopie.webp", UPLOADS + "bleibt.webp", {"updated_at": "jetzt"})
    assert (await flow.db.news_posts.find_one({"id": "n-1"}))["banner_url"] == UPLOADS + "bleibt.webp"


async def locked_rule(flow, public, name: str, content: bytes) -> str:
    """Ein Entwurf einer Season zeigt die Datei; die Antwort ist die Sperre seiner Season."""
    await add_file(flow, public, name, content)
    doc = await add_rule(flow, "entwurf", status="draft", image=name, version=None)
    return league_season_resource(doc["scope_id"])


@pytest.mark.asyncio
async def test_rotating_waits_for_the_lock_of_a_draft_that_shows_the_image(flow, public):
    if not flow.real_mongo:
        pytest.skip("Sperren sind nur auf echtem MongoDB exklusiv")
    await admin(flow)
    original = png()
    resource = await locked_rule(flow, public, "plan.png", original)
    async with mutation_lock(flow.db, resource):
        busy = await flow.post("/api/admin/media/plan.png/rotate", json={"degrees": 90})
    assert busy.status_code == 409 and "Regelwerk" in busy.json()["detail"]
    assert (public / "plan.png").read_bytes() == original
    done = await flow.post("/api/admin/media/plan.png/rotate", json={"degrees": 90})
    assert done.status_code == 200, done.text


@pytest.mark.asyncio
async def test_deleting_waits_for_the_lock_of_a_draft_that_shows_the_image(flow, public):
    if not flow.real_mongo:
        pytest.skip("Sperren sind nur auf echtem MongoDB exklusiv")
    await admin(flow)
    resource = await locked_rule(flow, public, "plan.webp", b"bild")
    async with mutation_lock(flow.db, resource):
        busy = await flow.delete("/api/admin/media/plan.webp?force=true")
    assert busy.status_code == 409 and "Regelwerk" in busy.json()["detail"]
    assert (public / "plan.webp").exists()


@pytest.mark.asyncio
async def test_rotating_holds_the_lock_while_it_checks_and_changes_the_file(flow, public, monkeypatch):
    if not flow.real_mongo:
        pytest.skip("Sperren sind nur auf echtem MongoDB exklusiv")
    await admin(flow)
    resource = await locked_rule(flow, public, "plan.png", png())
    held = []
    real = media_audit.frozen_usages

    async def checking(db, filename):
        try:
            async with mutation_lock(db, resource, wait_seconds=0.1):
                held.append(False)
        except MutationLockBusy:
            held.append(True)
        return await real(db, filename)

    monkeypatch.setattr(media_audit, "frozen_usages", checking)
    done = await flow.post("/api/admin/media/plan.png/rotate", json={"degrees": 90})
    assert done.status_code == 200, done.text
    assert held == [True], "während der Prüfung kann niemand veröffentlichen"


# ---------------------------------------------------------------- Bild-Migration

@pytest.mark.asyncio
async def test_image_migration_leaves_a_draft_alone_that_was_published_while_it_downloaded(flow, monkeypatch):
    external = "![Alt](https://bilder.example.test/alt.png)"
    await flow.db.league_rules.insert_one({"id": "gerade", "scope": "league_season", "scope_id": "s", "status": "draft", "body_md": external, "annexes": []})

    async def downloading(_url, _client):
        await flow.db.league_rules.update_one({"id": "gerade"}, {"$set": {"status": "published", "version": 1}})
        return UPLOADS + "lokal.webp"

    monkeypatch.setattr(image_migrate, "_download_to_local", downloading)
    await image_migrate.migrate_all()
    assert (await flow.db.league_rules.find_one({"id": "gerade"}))["body_md"] == external



@pytest.mark.asyncio
async def test_image_migration_leaves_published_versions_alone(flow, monkeypatch):
    async def fake_download(_url, _client):
        return UPLOADS + "lokal.webp"

    monkeypatch.setattr(image_migrate, "_download_to_local", fake_download)
    external = "![Alt](https://bilder.example.test/alt.png)"
    await flow.db.league_rules.insert_one({"id": "fertig", "status": "published", "body_md": external, "annexes": []})
    await flow.db.league_rules.insert_one({"id": "entwurf", "status": "draft", "body_md": external, "annexes": []})

    await image_migrate.migrate_all()

    assert (await flow.db.league_rules.find_one({"id": "fertig"}))["body_md"] == external
    assert "lokal.webp" in (await flow.db.league_rules.find_one({"id": "entwurf"}))["body_md"]
