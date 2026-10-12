"""Konto löschen und hochgeladene Dateien (#1039): Es gehen die Dateien, die dem Konto gehören - und nur die.

Was das Konto hochgeladen hat und der Verein inzwischen verwendet, bleibt, wo auch immer es steht. Was einem anderen
Konto oder dem Verein gehört, bleibt, auch wenn es im gelöschten Profil eingetragen war. Und eine eigene Datei bleibt
nicht deshalb liegen, weil sie in einem fremden Profil eingetragen ist.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import account_erasure  # noqa: E402

UPLOADS = "/api/static/uploads/"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def public(tmp_path, monkeypatch):
    folder, quarantine = tmp_path / "public", tmp_path / "quarantine"
    (folder / "variants").mkdir(parents=True)
    quarantine.mkdir()
    monkeypatch.setattr(account_erasure, "PUBLIC_UPLOAD_DIR", folder)
    monkeypatch.setattr(account_erasure, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(account_erasure, "QUARANTINE_DIR", quarantine)
    return folder


async def upload(flow, public: pathlib.Path, name: str, owner: dict | None, scope: str = "user") -> str:
    """Eine Datei, wie der Upload sie anlegt; ohne ``owner`` eine ältere Datei ohne Verwaltungszeile."""
    (public / name).write_bytes(b"bild")
    if owner:
        await flow.db.media_uploads.insert_one({"id": f"up-{name}", "filename": name, "url": UPLOADS + name,
                                                "owner_id": owner["id"], "owner_role": owner.get("role"), "media_scope": scope})
    return UPLOADS + name


async def delete_account(flow, user: dict) -> None:
    flow.act_as(user)
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200


@pytest.mark.asyncio
async def test_only_files_of_the_account_go_even_if_others_are_in_the_profile(flow, public):
    paula = await flow.add_user(role="player", name="paula")
    max_ = await flow.add_user(role="player", name="max")
    chef = await flow.add_user(role="superadmin", name="chef")
    vereinsbild = await upload(flow, public, "verein.webp", chef, scope="admin")
    maxbild = await upload(flow, public, "max.webp", max_)
    eigenes = await upload(flow, public, "eigen.webp", paula)
    aelter = await upload(flow, public, "aelter.webp", None)
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"avatar_url": vereinsbild, "banner_url": maxbild}})
    await flow.db.club_member_profiles.insert_one({"id": "selbst", "user_id": paula["id"], "source": "member", "display_name": "Paula",
                                                   "photo_url": eigenes, "cover_url": aelter, "is_active": True})

    await delete_account(flow, paula)

    # Die Dateien von Verein und Max bleiben samt Verwaltungszeile.
    assert (public / "verein.webp").exists() and (public / "max.webp").exists()
    assert await flow.db.media_uploads.count_documents({"filename": {"$in": ["verein.webp", "max.webp"]}}) == 2
    # Die eigene Datei geht, ebenso eine ältere ohne Verwaltungszeile, die nur im eigenen Profil stand.
    assert not (public / "eigen.webp").exists() and not (public / "aelter.webp").exists()
    assert await flow.db.media_uploads.count_documents({"filename": "eigen.webp"}) == 0


PLACES = {
    "Gewinnerbild im Turnier": ("tournaments", lambda url: {"id": "t-1", "award_images": {"3": url}}),
    "Bild in den Turnierregeln": ("tournaments", lambda url: {"id": "t-2", "rules": f"Aufbau:\n\n![Plan]({url})"}),
    "Bild im Preistext": ("tournaments", lambda url: {"id": "t-3", "prize_pool": f'<img src="{url}">'}),
    "Bild beim Partner-Werkzeug": ("partners", lambda url: {"id": "p-1", "logo_url": None, "tools": [{"name": "Tool", "image_url": url}]}),
    "Vereinsfoto auf „Über uns“": ("settings", lambda url: {"id": "about_page", "club_photo": {"url": url}}),
    "Bild in der Chronik": ("settings", lambda url: {"id": "about_page", "timeline": [{"year": "2020", "title": "Start", "image_url": url}]}),
    "Bild im Adventkalender": ("advent_doors", lambda url: {"id": "door-1", "media_url": url}),
    "Sticker": ("stickers", lambda url: {"id": "s-1", "pack_id": "p", "url": url}),
    "Original in der Galerie": ("gallery_photos", lambda url: {"id": "g-1", "image_url": None, "original_url": url}),
    "Symbol eines Spielservers": ("game_servers", lambda url: {"id": "gs-1", "server_icon_url": url}),
}


@pytest.mark.asyncio
@pytest.mark.parametrize("place", sorted(PLACES))
async def test_own_uploads_the_club_uses_stay(flow, public, place):
    paula = await flow.add_user(role="player", name="paula")
    url = await upload(flow, public, "genutzt.webp", paula)
    collection, document = PLACES[place]
    await getattr(flow.db, collection).insert_one(document(url))

    await delete_account(flow, paula)

    assert (public / "genutzt.webp").exists(), place


@pytest.mark.asyncio
async def test_an_own_file_in_another_profile_goes_with_its_owner(flow, public):
    paula = await flow.add_user(role="player", name="paula")
    max_ = await flow.add_user(role="player", name="max")
    url = await upload(flow, public, "paula.webp", paula)
    team_logo = await upload(flow, public, "logo.webp", paula)
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"avatar_url": url}})
    await flow.db.users.update_one({"id": max_["id"]}, {"$set": {"avatar_url": url, "banner_url": url}})
    await flow.db.club_member_profiles.insert_one({"id": "max", "user_id": max_["id"], "source": "member", "display_name": "Max", "photo_url": url})
    await flow.db.club_member_profiles.insert_one({"id": "redaktion", "user_id": None, "source": "editorial", "display_name": "Team", "photo_url": team_logo})
    await flow.db.teams.insert_one({"id": "team-1", "name": "Löwen", "logo_url": team_logo, "member_ids": [paula["id"], max_["id"]]})

    await delete_account(flow, paula)

    assert not (public / "paula.webp").exists()
    max_now = await flow.db.users.find_one({"id": max_["id"]})
    assert max_now["avatar_url"] is None and max_now["banner_url"] is None
    assert (await flow.db.club_member_profiles.find_one({"id": "max"}))["photo_url"] is None
    # Was Team und Verein verwenden, gehört ihnen.
    assert (public / "logo.webp").exists()
    assert (await flow.db.club_member_profiles.find_one({"id": "redaktion"}))["photo_url"] == team_logo
