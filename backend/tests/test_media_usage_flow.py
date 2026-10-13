"""Mediathek und Bild-Migration kennen dieselben Verwendungsstellen wie die Kontolöschung (#1471).

Eine Datei, die nur in einem verschachtelten Feld steht (Gewinnerbild im Turnier, Werkzeug eines Partners, Chronik auf
„Über uns“) oder über eine Adresse mit Zusatz oder eine kleinere Fassung verwendet wird, gilt in der Mediathek als
benutzt und lässt sich dort nicht ohne Warnung löschen. Die Bild-Migration schreibt auch verschachtelte Verweise um.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import phase_fg_routes  # noqa: E402
from services import account_erasure, image_migrate, media_audit  # noqa: E402

UPLOADS = "/api/static/uploads/"
NAME = "genutzt.webp"
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
    (folder / "variants").mkdir(parents=True)
    monkeypatch.setattr(phase_fg_routes, "PUBLIC_UPLOAD_DIR", folder)
    monkeypatch.setattr(phase_fg_routes, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(account_erasure, "PUBLIC_UPLOAD_DIR", folder)
    monkeypatch.setattr(account_erasure, "UPLOAD_DIR", tmp_path)
    (folder / NAME).write_bytes(b"bild")
    (folder / "frei.webp").write_bytes(b"frei")
    return folder


PLACES = {
    "Gewinnerbild im Turnier": ("tournaments", {"id": "t-1", "name": "Cup", "award_images": {"1": URL}}),
    "Bild beim Partner-Werkzeug": ("partners", {"id": "p-1", "name": "Partner", "logo_url": None,
                                                "tools": [{"name": "Tool", "image_url": URL}]}),
    "Bild in der Chronik": ("settings", {"id": "about_page", "timeline": [{"year": "2020", "title": "Start", "image_url": URL}]}),
    "Vereinsfoto auf „Über uns“": ("settings", {"id": "about_page", "club_photo": {"url": URL}}),
    "Bild in den Turnierregeln": ("tournaments", {"id": "t-2", "rules": f"Aufbau:\n\n![Plan]({URL})"}),
    "Sponsorbild aus der Mitgliederverwaltung": ("sponsors", {"id": "sp-1", "dolibarr_images": {"logo": {"dark": {"url": URL}}}}),
    "Banner eines Sponsors": ("sponsors", {"id": "sp-2", "logo_url": None, "banner_url": URL}),
    "Adresse mit Zusatz": ("news_posts", {"id": "n-1", "banner_url": URL + "?v=3#oben"}),
    "Absolute Adresse": ("events", {"id": "e-1", "banner_url": "https://lionsquad.example" + URL}),
    "Kleinere Fassung": ("teams", {"id": "team-9", "logo_url": UPLOADS + "variants/genutzt-400.webp"}),
}


async def admin(flow) -> dict:
    chef = await flow.add_user(role="superadmin", name="chef")
    flow.act_as(chef)
    return chef


async def media_items(flow) -> dict[str, dict]:
    response = await flow.get("/api/admin/media?include_usage=true&include_user_uploads=true")
    assert response.status_code == 200, response.text
    return {item["filename"]: item for item in response.json()}


@pytest.mark.asyncio
@pytest.mark.parametrize("place", sorted(PLACES))
async def test_a_file_used_anywhere_counts_as_used_in_the_media_library(flow, public, place):
    await admin(flow)
    collection, document = PLACES[place]
    await getattr(flow.db, collection).insert_one(dict(document))

    items = await media_items(flow)

    assert items[NAME]["is_unused"] is False, place
    assert items[NAME]["usage_count"] == 1, place
    reference = items[NAME]["references"][0]
    assert reference["collection"] == collection
    # Lesbar benannt: kein roher Feldpfad.
    assert reference["place"] and "_url" not in reference["place"] and "." not in reference["place"], reference
    assert items["frei.webp"]["is_unused"] is True


@pytest.mark.asyncio
async def test_a_used_file_is_not_deleted_without_confirmation(flow, public):
    await admin(flow)
    await flow.db.tournaments.insert_one({"id": "t-1", "award_images": {"1": URL + "?v=2", "2": UPLOADS + "anderes.webp"}})
    await flow.db.partners.insert_one({"id": "p-1", "tools": [{"name": "Tool", "image_url": URL}, {"name": "Zweites", "image_url": None}]})
    await flow.db.teams.insert_one({"id": "team-1", "logo_url": UPLOADS + "variants/genutzt-400.webp"})
    await flow.db.news_posts.insert_one({"id": "n-1", "content": f"![Bild]({URL})"})

    refused = await flow.delete(f"/api/admin/media/{NAME}")

    assert refused.status_code == 409
    assert "verwendet" in refused.json()["detail"]
    assert (public / NAME).exists()

    deleted = await flow.delete(f"/api/admin/media/{NAME}?force=true")

    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert not (public / NAME).exists()
    assert body["cleared_references"] == 3 and body["text_references"] == 1 and body["file_pending"] is False
    tournament = await flow.db.tournaments.find_one({"id": "t-1"})
    assert tournament["award_images"] == {"1": None, "2": UPLOADS + "anderes.webp"}
    partner = await flow.db.partners.find_one({"id": "p-1"})
    assert partner["tools"] == [{"name": "Tool", "image_url": None}, {"name": "Zweites", "image_url": None}]
    assert (await flow.db.teams.find_one({"id": "team-1"}))["logo_url"] is None


@pytest.mark.asyncio
async def test_an_unused_file_is_deleted_right_away(flow, public):
    await admin(flow)
    (public / "variants" / "frei-400.webp").write_bytes(b"klein")

    response = await flow.delete("/api/admin/media/frei.webp")

    assert response.status_code == 200, response.text
    assert not (public / "frei.webp").exists()
    assert not (public / "variants" / "frei-400.webp").exists()


def test_every_usage_place_has_a_readable_name():
    for collection, fields, _text in media_audit.usage_places():
        for field in fields:
            label = media_audit.place_label(collection, field)
            assert label and field not in label and collection not in label, (collection, field, label)


@pytest.mark.asyncio
async def test_migration_rewrites_nested_references(flow, monkeypatch):
    external = "https://cdn.example/bild.png"
    local = UPLOADS + "lokal.png"
    downloads: list[str] = []

    async def fake_download(url, client):
        downloads.append(url)
        return local

    monkeypatch.setattr(image_migrate, "_download_to_local", fake_download)
    await flow.db.tournaments.insert_one({"id": "t-1", "award_images": {"1": external}, "rules": f"![x]({external})"})
    await flow.db.partners.insert_one({"id": "p-1", "logo_url": None, "tools": [{"name": "Tool", "image_url": external}]})
    await flow.db.settings.insert_one({"id": "about_page", "timeline": [{"year": "2020", "image_url": external}],
                                       "club_photo": {"url": external, "caption": "Team"}})
    await flow.db.sponsors.insert_one({"id": "sp-1", "banner_url": external})
    await flow.db.gallery_photos.insert_one({"id": "g-1", "video_url": "https://cdn.example/film.mp4"})

    summary = await image_migrate.migrate_all()

    tournament = await flow.db.tournaments.find_one({"id": "t-1"})
    assert tournament["award_images"] == {"1": local} and tournament["rules"] == f"![x]({local})"
    assert (await flow.db.partners.find_one({"id": "p-1"}))["tools"] == [{"name": "Tool", "image_url": local}]
    about = await flow.db.settings.find_one({"id": "about_page"})
    assert about["timeline"] == [{"year": "2020", "image_url": local}]
    assert about["club_photo"] == {"url": local, "caption": "Team"}
    assert (await flow.db.sponsors.find_one({"id": "sp-1"}))["banner_url"] == local
    # Videos lädt die Migration nicht herunter - sie nimmt nur Bilder.
    assert (await flow.db.gallery_photos.find_one({"id": "g-1"}))["video_url"] == "https://cdn.example/film.mp4"
    assert downloads == [external]
    assert summary["tournaments"]["updated"] == 1 and summary["partners"]["updated"] == 1


@pytest.mark.asyncio
async def test_every_deletion_is_logged_with_actor_and_counts(flow, public):
    chef = await admin(flow)
    await flow.db.partners.insert_one({"id": "p-1", "tools": [{"name": "Tool", "image_url": URL}]})
    await flow.db.news_posts.insert_one({"id": "n-1", "content": f"![Bild]({URL})"})

    unused = await flow.delete("/api/admin/media/frei.webp")
    used = await flow.delete(f"/api/admin/media/{NAME}?force=true")
    assert unused.status_code == 200 and used.status_code == 200

    logs = {row["target_id"]: row async for row in flow.db.audit_logs.find({"action": "media.delete"})}
    assert logs["frei.webp"]["actor_id"] == chef["id"]
    assert logs["frei.webp"]["data"] == {"filename": "frei.webp", "force": False, "cleared_references": 0,
                                         "text_references": 0, "file_pending": False}
    assert logs[NAME]["actor_id"] == chef["id"]
    assert logs[NAME]["data"] == {"filename": NAME, "force": True, "cleared_references": 1,
                                  "text_references": 1, "file_pending": False}


@pytest.mark.asyncio
async def test_references_are_cleared_first_and_a_locked_file_is_cleaned_later(flow, public, monkeypatch):
    await admin(flow)
    await flow.db.media_uploads.insert_one({"id": "up-1", "filename": NAME, "url": URL, "media_scope": "admin"})
    await flow.db.partners.insert_one({"id": "p-1", "tools": [{"name": "Tool", "image_url": URL}]})
    real_unlink = account_erasure._unlink

    def locked(path):
        if path.name == NAME:
            raise PermissionError("Datei ist in Verwendung")
        real_unlink(path)

    monkeypatch.setattr(account_erasure, "_unlink", locked)
    response = await flow.delete(f"/api/admin/media/{NAME}?force=true")

    # Die Verweise sind leer, auch wenn die Datei selbst noch nicht weg ist; sie ist zum Nachholen vermerkt.
    assert response.status_code == 200, response.text
    assert response.json()["file_pending"] is True
    assert (await flow.db.partners.find_one({"id": "p-1"}))["tools"] == [{"name": "Tool", "image_url": None}]
    assert (public / NAME).exists()
    pending = await flow.db[account_erasure.PENDING].find_one({"filename": NAME})
    assert pending["attempts"] == 1 and pending["owned"] is True
    assert await flow.db.media_uploads.count_documents({"filename": NAME}) == 1

    monkeypatch.setattr(account_erasure, "_unlink", real_unlink)
    removed = await account_erasure.retry_file_cleanups(flow.db)
    assert removed == 1
    assert not (public / NAME).exists()
    assert await flow.db.media_uploads.count_documents({"filename": NAME}) == 0
    assert await flow.db[account_erasure.PENDING].count_documents({}) == 0
