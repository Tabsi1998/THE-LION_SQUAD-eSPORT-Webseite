"""Das ganze Konto sieht nur die Person selbst und die Vereinsverwaltung.

Namen, Geburtsdatum, Wohnort, Spiele-Kennungen, Einstellungen und die Mitgliedschaft braucht nur die
Vereinsverwaltung, etwa beim Verknüpfen in der Mitgliederliste. Alle anderen - auch Moderation und Turnierleitung -
sehen das öffentliche Profil.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person_with_details(flow) -> dict:
    person = await flow.add_user(role="player", name="Zielkonto")
    await flow.db.users.update_one(
        {"id": person["id"]},
        {"$set": {"first_name": "Erika", "birth_date": "2001-02-03", "city": "Musterstadt", "steam_id": "steam-123"}},
    )
    return person


@pytest.mark.asyncio
async def test_other_accounts_and_staff_without_club_area_get_no_account(flow):
    person = await person_with_details(flow)

    for role in ("player", "moderator", "tournament_admin"):
        flow.act_as(await flow.add_user(role=role, name=f"Andere {role}"))
        refused = await flow.get(f"/api/users/{person['id']}")
        assert refused.status_code == 403, (role, refused.text)
        assert "Musterstadt" not in refused.text and "2001-02-03" not in refused.text
        unknown = await flow.get("/api/users/gibt-es-nicht")
        assert unknown.status_code == 403, "ohne Recht verrät die Antwort nicht, ob es ein Konto gibt"


@pytest.mark.asyncio
async def test_own_account_and_club_administration_see_everything(flow):
    person = await person_with_details(flow)

    flow.act_as(person)
    own = await flow.get(f"/api/users/{person['id']}")
    assert own.status_code == 200, own.text
    assert own.json()["city"] == "Musterstadt"

    granted = await flow.add_user(role="player", name="Kassierin")
    await flow.db.users.update_one({"id": granted["id"]}, {"$set": {"areas": ["club"]}})
    for viewer in (await flow.add_user(role="club_admin", name="Verwaltung"), {**granted, "areas": ["club"]}):
        flow.act_as(viewer)
        full = await flow.get(f"/api/users/{person['id']}")
        assert full.status_code == 200, full.text
        body = full.json()
        assert body["birth_date"] == "2001-02-03" and body["steam_id"] == "steam-123"
        assert body["email"] == person["email"]
        assert "password_hash" not in body
        assert (await flow.get("/api/users/gibt-es-nicht")).status_code == 404
