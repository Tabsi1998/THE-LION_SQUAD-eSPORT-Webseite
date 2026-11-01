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
