"""Altdaten ``user_socials`` (#2113, L-A12): ziehen in die Profilfelder um, mit ihrer Sichtbarkeit, ohne ein gepflegtes Feld
zu überschreiben; zweimal laufen ändert nichts mehr. Die alten Routen sind weg, das öffentliche Profil liest die Sammlung
nicht mehr. Erfundene Konten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import migrations, user_socials_migration  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "user-socials-migration-secret-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _social(flow, user_id, platform, value, *, visibility="public", url=None):
    await flow.db.user_socials.insert_one({"id": new_id(), "user_id": user_id, "platform": platform, "value": value, "url": url, "visibility": visibility})


@pytest.mark.asyncio
async def test_rows_move_into_the_profile_fields_with_their_visibility(flow):
    person = await flow.add_user(name=f"person-{new_id()[:6]}")
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"twitch_handle": "gepflegt", "kick_handle": "gleich",
                                                                   "profile_visibility": {"telegram": "public"}}})
    await _social(flow, person["id"], "youtube", "kanal", visibility="members")
    await _social(flow, person["id"], "telegram", "nur_ich", visibility="private")
    await _social(flow, person["id"], "website", "", url="https://beispiel.example/")
    await _social(flow, person["id"], "twitch", "alt")           # anderer Wert: das Profilfeld gewinnt, der Eintrag bleibt
    await _social(flow, person["id"], "kick", " GLEICH ")        # derselbe Wert: nur der Eintrag geht
    await _social(flow, person["id"], "myspace", "unbekannt")    # keine Plattform von heute: bleibt liegen
    await _social(flow, "gibt-es-nicht", "github", "waise")      # ohne Konto: weg

    result = await user_socials_migration.migrate(flow.db)
    assert result == "3 moved, 1 already in the profile, 2 kept, 1 empty or without account removed"

    stored = await flow.db.users.find_one({"id": person["id"]}, {"_id": 0})
    assert stored["youtube_handle"] == "kanal"
    assert stored["telegram_handle"] == "nur_ich"
    assert stored["website"] == "https://beispiel.example/"
    assert stored["twitch_handle"] == "gepflegt" and stored["kick_handle"] == "gleich"
    # Die Stufe des Eintrags gilt für seinen Wert - auch gegen eine freiere Stufe am bisher leeren Feld.
    assert stored["profile_visibility"]["youtube"] == "members"
    assert stored["profile_visibility"]["telegram"] == "private"
    left = sorted([row["platform"] async for row in flow.db.user_socials.find({})])
    assert left == ["myspace", "twitch"]

    # Mehrfach ausführbar: nichts ändert sich mehr.
    again = await user_socials_migration.migrate(flow.db)
    assert again == "0 moved, 0 already in the profile, 2 kept, 0 empty or without account removed"
    assert (await flow.db.users.find_one({"id": person["id"]}))["twitch_handle"] == "gepflegt"


@pytest.mark.asyncio
async def test_public_profile_keeps_a_private_value_hidden_after_the_move(flow):
    person = await flow.add_user(name=f"person-{new_id()[:6]}")
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"privacy_public_profile": True}})
    await _social(flow, person["id"], "telegram", "nur_ich", visibility="private")
    await _social(flow, person["id"], "youtube", "kanal")
    await user_socials_migration.migrate(flow.db)

    flow.act_as(None)
    response = await flow.get(f"/api/users/public/{person['username']}")
    assert response.status_code == 200, response.text
    profile = response.json()
    assert profile["youtube_handle"] == "kanal"
    assert not profile.get("telegram_handle")
    assert "socials" not in profile


@pytest.mark.asyncio
async def test_public_profile_no_longer_reads_old_rows_and_routes_are_gone(flow):
    person = await flow.add_user(name=f"person-{new_id()[:6]}")
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"privacy_public_profile": True}})
    await _social(flow, person["id"], "kick", "altdaten")
    flow.act_as(person)
    assert "altdaten" not in (await flow.get(f"/api/users/public/{person['username']}")).text
    assert (await flow.get("/api/users/me/socials")).status_code in {404, 405}
    assert (await flow.post("/api/users/me/socials", json={"platform": "kick", "value": "x"})).status_code in {404, 405}
    deleted = await flow.delete("/api/users/me/socials/abc")
    assert deleted.status_code in {404, 405}


def test_migration_is_registered_once_with_the_next_free_number():
    versions = [version for version, _name, _run in migrations.MIGRATIONS]
    assert len(versions) == len(set(versions)) and versions == sorted(versions)
    assert ("user_socials_to_profile_fields" in {name for _version, name, _run in migrations.MIGRATIONS})
