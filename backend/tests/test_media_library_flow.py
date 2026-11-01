"""Mediathek seitenweise (#2122): Suche, Filter und Prüfung rechnet der Server über alle Dateien.

Vorher war bei 500 Dateien Schluss: Ältere waren in der Mediathek und in der Bildauswahl unsichtbar, nicht löschbar, nicht
wählbar und fehlten auch in der Prüfung „ungenutzt/Duplikate“.
"""
import os
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import phase_fg_routes  # noqa: E402
from services import account_erasure, media_audit  # noqa: E402

UPLOADS = "/api/static/uploads/"
COUNT = 520


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


def add_file(folder: pathlib.Path, name: str, content: bytes | None = None, age: int = 0) -> None:
    path = folder / name
    path.write_bytes(content if content is not None else name.encode())
    if age:
        stamp = path.stat().st_mtime - age
        os.utime(path, (stamp, stamp))


async def admin(flow) -> dict:
    chef = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(chef)
    return chef


@pytest.mark.asyncio
async def test_all_files_are_counted_and_reachable_page_by_page(flow, public):
    await admin(flow)
    for index in range(COUNT):
        add_file(public, f"foto{index:03}.webp", age=index)

    first = (await flow.get("/api/admin/media?paged=true&limit=100")).json()
    assert first["total"] == COUNT and first["limit"] == 100 and first["offset"] == 0
    assert first["total_size"] == sum(len(f"foto{index:03}.webp") for index in range(COUNT))
    assert first["items"][0]["filename"] == "foto000.webp", "neueste zuerst"

    last = (await flow.get("/api/admin/media?paged=true&limit=100&offset=500")).json()
    assert [item["filename"] for item in last["items"]] == [f"foto{index:03}.webp" for index in range(500, COUNT)]

    # Die Prüfung zählt alle, auch hinter der alten Grenze.
    audit = (await flow.get("/api/admin/media/audit")).json()
    assert audit["total"] == COUNT and audit["unused"] == COUNT


@pytest.mark.asyncio
async def test_search_and_filters_reach_files_behind_the_old_limit(flow, public):
    await admin(flow)
    for index in range(COUNT):
        add_file(public, f"foto{index:03}.webp", age=index)
    add_file(public, "uralt.webp", content=b"uralt", age=100000)
    add_file(public, "kopie-a.webp", content=b"gleich", age=100001)
    add_file(public, "kopie-b.webp", content=b"gleich", age=100002)
    await flow.db.media_uploads.insert_one({"id": "m-1", "filename": "uralt.webp", "url": UPLOADS + "uralt.webp", "media_scope": "gallery", "original_filename": "Siegerehrung 2019.JPG"})
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": UPLOADS + "foto000.webp"})

    by_name = (await flow.get("/api/admin/media?paged=true&q=URALT")).json()
    assert [item["filename"] for item in by_name["items"]] == ["uralt.webp"] and by_name["total"] == 1
    by_original = (await flow.get("/api/admin/media?paged=true&q=siegerehrung")).json()
    assert [item["filename"] for item in by_original["items"]] == ["uralt.webp"]
    scoped = (await flow.get("/api/admin/media?paged=true&scope=gallery")).json()
    assert [item["filename"] for item in scoped["items"]] == ["uralt.webp"]

    duplicates = (await flow.get("/api/admin/media?paged=true&scope=duplicate")).json()
    assert sorted(item["filename"] for item in duplicates["items"]) == ["kopie-a.webp", "kopie-b.webp"]
    assert duplicates["items"][0]["duplicate_filenames"] == ["kopie-a.webp", "kopie-b.webp"]

    unused = (await flow.get("/api/admin/media?paged=true&scope=unused&limit=10")).json()
    assert unused["total"] == COUNT + 2, "alle bis auf die eine verwendete"
    assert all(item["is_unused"] for item in unused["items"])

    untracked = (await flow.get("/api/admin/media?paged=true&scope=untracked&limit=1")).json()
    assert untracked["total"] == COUNT + 2


@pytest.mark.asyncio
async def test_usage_is_only_worked_out_for_the_shown_page(flow, public, monkeypatch):
    await admin(flow)
    for index in range(30):
        add_file(public, f"foto{index:03}.webp", age=index)
    asked: list[int] = []
    real = phase_fg_routes._collect_media_usage

    async def counting(names):
        asked.append(len(names))
        return await real(names)

    monkeypatch.setattr(phase_fg_routes, "_collect_media_usage", counting)
    page = (await flow.get("/api/admin/media?paged=true&limit=10&include_usage=true")).json()

    assert asked == [10]
    assert len(page["items"]) == 10 and page["items"][0]["is_unused"] is True


@pytest.mark.asyncio
async def test_type_filter_and_svg_can_be_left_out_on_the_server(flow, public):
    await admin(flow)
    add_file(public, "bild.webp")
    add_file(public, "logo.svg")
    add_file(public, "film.mp4")
    add_file(public, "roh.nef")

    async def names(query: str) -> list[str]:
        return sorted(item["filename"] for item in (await flow.get(f"/api/admin/media?paged=true&{query}")).json()["items"])

    assert await names("type=images") == ["bild.webp", "logo.svg"]
    assert await names("type=images&exclude_svg=true") == ["bild.webp"]
    assert await names("type=videos") == ["film.mp4"]
    assert await names("type=files") == ["roh.nef"]


# ---------------------------------------------------------------- Sammelaktionen

OLD = 3 * 24 * 3600


async def track(flow, name: str, scope: str = "admin", **extra) -> None:
    await flow.db.media_uploads.insert_one({"id": name, "filename": name, "url": UPLOADS + name, "media_type": "image", "media_scope": scope, "owner_role": "admin", **extra})


@pytest.mark.asyncio
async def test_cleanup_offers_only_what_is_safe_to_remove(flow, public):
    await admin(flow)
    for name in ("alt-frei.webp", "alt-genutzt.webp", "alt-sticker.webp", "alt-fremdes-feld.webp"):
        add_file(public, name, age=OLD)
        await track(flow, name)
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": UPLOADS + "alt-genutzt.webp"})
    await flow.db.direct_messages.insert_one({"id": "m-1", "sticker": {"id": "s-1", "url": UPLOADS + "alt-sticker.webp"}})
    # Ein Feld, das noch niemand in die Liste der Verwendungsstellen eingetragen hat: Das Netz darunter findet es.
    await flow.db.neue_sammlung.insert_one({"id": "x-1", "tief": [{"bild": UPLOADS + "alt-fremdes-feld.webp?v=1"}]})
    # Frisch hochgeladen - das Formular dazu ist vielleicht noch offen.
    add_file(public, "frisch.webp")
    await track(flow, "frisch.webp")
    # Uploads von Mitgliedern, Dateien ohne Eintrag und Kamera-Originale bleiben.
    add_file(public, "mitglied.webp", age=OLD)
    await track(flow, "mitglied.webp", scope="user", owner_role="user")
    add_file(public, "ohne-eintrag.webp", age=OLD)
    add_file(public, "roh.nef", age=OLD)
    await flow.db.media_uploads.insert_one({"id": "roh", "filename": "roh.nef", "url": UPLOADS + "roh.nef", "media_type": "file", "media_scope": "admin", "owner_role": "admin"})
    # Ein Protokolleintrag ist keine Verwendung.
    await flow.db.audit_logs.insert_one({"id": "a-1", "action": "media.delete", "data": {"filename": "alt-frei.webp"}})

    preview = (await flow.get("/api/admin/media/unused")).json()

    assert preview["filenames"] == ["alt-frei.webp"] and preview["count"] == 1
    assert preview["total_size"] == len("alt-frei.webp")
    assert preview["min_age_hours"] == phase_fg_routes.MEDIA_CLEANUP_MIN_AGE_HOURS


@pytest.mark.asyncio
async def test_cleanup_checks_again_on_the_server_and_logs_the_action(flow, public):
    chef = await admin(flow)
    for name in ("frei-a.webp", "frei-b.webp"):
        add_file(public, name, age=OLD)
        await track(flow, name)
    (public / "variants" / "frei-a-400.webp").write_bytes(b"klein")
    preview = (await flow.get("/api/admin/media/unused")).json()
    assert sorted(preview["filenames"]) == ["frei-a.webp", "frei-b.webp"]

    # Zwischen Rückfrage und Klick wird eine Datei verwendet; eine fremde steht gar nicht zur Wahl.
    await flow.db.events.insert_one({"id": "e-1", "banner_url": UPLOADS + "frei-b.webp"})
    add_file(public, "behalten.webp")
    response = await flow.post("/api/admin/media/cleanup-unused", json={"filenames": [*preview["filenames"], "behalten.webp", "../boese.webp"]})

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "deleted": 1, "skipped": 3, "file_pending": 0}
    assert not (public / "frei-a.webp").exists() and not (public / "variants" / "frei-a-400.webp").exists()
    assert (public / "frei-b.webp").exists() and (public / "behalten.webp").exists()
    assert await flow.db.media_uploads.count_documents({"filename": "frei-a.webp"}) == 0
    log = await flow.db.audit_logs.find_one({"action": "media.cleanup_unused"})
    assert log["actor_id"] == chef["id"]
    assert log["data"]["deleted"] == ["frei-a.webp"]
    assert sorted(log["data"]["skipped"]) == ["../boese.webp", "behalten.webp", "frei-b.webp"]


@pytest.mark.asyncio
async def test_replacing_a_duplicate_points_every_place_at_the_kept_file(flow, public):
    chef = await admin(flow)
    for name in ("bleibt.webp", "kopie.webp", "mitglied.webp"):
        add_file(public, name, content=b"gleicher inhalt", age=OLD)
    add_file(public, "anders-gleich-gross.webp", content=b"anderer  inhalt", age=OLD)
    await track(flow, "bleibt.webp", version=7)
    await track(flow, "kopie.webp")
    await track(flow, "mitglied.webp", scope="user", owner_role="user")
    await flow.db.news_posts.insert_one({"id": "n-1", "banner_url": UPLOADS + "kopie.webp", "content": f"![x]({UPLOADS}kopie.webp) und ![y]({UPLOADS}anderes.webp)"})
    await flow.db.direct_messages.insert_one({"id": "m-1", "updated_at": "alt", "sticker": {"id": "s-1", "url": UPLOADS + "kopie.webp"}})
    await flow.db.teams.insert_one({"id": "t-1", "logo_url": UPLOADS + "variants/kopie-400.webp"})

    response = await flow.post("/api/admin/media/duplicates/replace", json={"keep": "bleibt.webp"})

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "removed": 1, "references": 4, "file_pending": 0}
    kept = UPLOADS + "bleibt.webp?v=7"
    news = await flow.db.news_posts.find_one({"id": "n-1"})
    assert news["banner_url"] == kept and news["content"] == f"![x]({kept}) und ![y]({UPLOADS}anderes.webp)"
    message = await flow.db.direct_messages.find_one({"id": "m-1"})
    assert message["sticker"]["url"] == kept and message["updated_at"] == "alt"
    assert (await flow.db.teams.find_one({"id": "t-1"}))["logo_url"] == kept
    assert not (public / "kopie.webp").exists()
    assert (public / "bleibt.webp").exists() and (public / "mitglied.webp").exists() and (public / "anders-gleich-gross.webp").exists()
    log = await flow.db.audit_logs.find_one({"action": "media.replace_duplicates"})
    assert log["actor_id"] == chef["id"] and log["data"]["removed"] == ["kopie.webp"]

    # Kopie schon weg, oder nur noch Mitglieder-Kopien: nichts zu tun.
    response = await flow.post("/api/admin/media/duplicates/replace", json={"keep": "bleibt.webp"})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_collective_actions_need_the_editorial_area(flow, public):
    moderator = await flow.add_user(role="moderator", name="moni")
    flow.act_as(moderator)
    assert (await flow.get("/api/admin/media/unused")).status_code == 403
    response = await flow.post("/api/admin/media/cleanup-unused", json={"filenames": []})
    assert response.status_code == 403
    response = await flow.post("/api/admin/media/duplicates/replace", json={"keep": "a.webp"})
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_the_upload_limits_come_from_the_server_for_everyone(flow):
    from routes import upload_routes

    response = await flow.get("/api/uploads/limits")

    assert response.status_code == 200
    body = response.json()
    assert body["image_mb"] == upload_routes.MAX_IMAGE_UPLOAD_MB
    assert body["video_mb"] == upload_routes.MAX_VIDEO_UPLOAD_MB
    assert body["document_mb"] == upload_routes.MAX_DOCUMENT_UPLOAD_MB
    assert body["svg_mb"] >= 1


@pytest.mark.asyncio
async def test_page_size_stays_within_bounds(flow, public):
    await admin(flow)
    for index in range(3):
        add_file(public, f"foto{index}.webp")

    huge = (await flow.get("/api/admin/media?paged=true&limit=100000&offset=-5")).json()
    assert huge["limit"] == phase_fg_routes.MEDIA_PAGE_MAX and huge["offset"] == 0


@pytest.mark.asyncio
async def test_a_member_only_sees_and_searches_their_own_files(flow, public):
    paula = await flow.add_user(role="user", name="paula")
    otto = await flow.add_user(role="user", name="otto")
    add_file(public, "paula-a.webp")
    add_file(public, "paula-b.webp")
    add_file(public, "otto.webp")
    for name, owner in (("paula-a.webp", paula), ("paula-b.webp", paula), ("otto.webp", otto)):
        await flow.db.media_uploads.insert_one({"id": name, "filename": name, "url": UPLOADS + name, "owner_id": owner["id"], "owner_role": "user", "media_scope": "user"})
    flow.act_as(paula)

    page = (await flow.get("/api/media?paged=true&limit=1&type=images")).json()
    assert page["total"] == 2 and len(page["items"]) == 1
    assert (await flow.get("/api/media?paged=true&q=otto")).json()["total"] == 0
    # Ohne „paged“ bleibt es eine Liste - eine noch offene ältere Seite läuft weiter.
    assert sorted(item["filename"] for item in (await flow.get("/api/media")).json()) == ["paula-a.webp", "paula-b.webp"]
