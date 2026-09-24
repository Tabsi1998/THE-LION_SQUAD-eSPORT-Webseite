"""Vereinsprofil ↔ Website-Konto (#506): „Profil erstellen“ legt nur das Profil an - kein Konto, keine
Mitgliedschaft; der Vorstand verknüpft, löst und verknüpft ein anderes Konto; ein Konto hat nur ein Profil;
das Mitglied übernimmt das Vorstandsprofil über die Dolibarr-Zuordnung statt ein zweites anzulegen - außer
der Vorstand hat sein Konto ausdrücklich gelöst."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import dolibarr_client  # noqa: E402
from services.dolibarr_links import verify_link  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def account(flow, name, email=None):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"display_name": name.capitalize(), "email": email or f"{name}@lionsquad-test.at",
                                                                  "avatar_url": f"/uploads/{name}.png", "favorite_games": ["Rocket League"], "main_platforms": ["PC"]}})
    return user


@pytest.mark.asyncio
async def test_a_profile_is_neither_an_account_nor_a_membership_and_the_board_links_unlinks_and_relinks(flow):
    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    created = await flow.post("/api/membership/profiles/admin", json={"display_name": "Paula Beispiel"})
    assert created.status_code in (200, 201), created.text
    profile = created.json()
    assert profile["user_id"] is None and profile["linked_account"] is None
    assert await flow.db.memberships.count_documents({}) == 0, "ein Profil legt keine Mitgliedschaft an"

    paula = await account(flow, "paula")
    flow.act_as(admin)
    # Konto suchen wie der Kasten im Admin: Name, E-Mail oder Benutzername.
    for needle in ("paul", "paula@lionsquad-test.at", "Paula"):
        assert any(row["id"] == paula["id"] for row in (await flow.get(f"/api/users?q={needle}")).json()), needle
    linked = await flow.patch(f"/api/membership/profiles/admin/{profile['id']}", json={"user_id": paula["id"]})
    assert linked.status_code == 200, linked.text
    assert linked.json()["linked_account"]["username"] == "paula" and linked.json()["account_unlinked_at"] is None
    assert await flow.db.memberships.count_documents({}) == 0, "Verknüpfen legt keine Mitgliedschaft an"

    # Ein Konto hat genau ein Vereinsprofil.
    second = await flow.post("/api/membership/profiles/admin", json={"display_name": "Doppel", "user_id": paula["id"]})
    assert second.status_code == 409 and "Paula Beispiel" in second.json()["detail"]

    # Lösen merkt sich das Konto; ein anderes verknüpfen räumt den Merker weg.
    unlinked = (await flow.patch(f"/api/membership/profiles/admin/{profile['id']}", json={"user_id": None})).json()
    assert unlinked["user_id"] is None and unlinked["linked_account"] is None and unlinked["account_unlinked_at"]
    stored = await flow.db.club_member_profiles.find_one({"id": profile["id"]}, {"_id": 0})
    assert stored["account_unlinked_user_id"] == paula["id"]
    max_ = await account(flow, "max")
    flow.act_as(admin)
    relinked = (await flow.patch(f"/api/membership/profiles/admin/{profile['id']}", json={"user_id": max_["id"]})).json()
    assert relinked["linked_account"]["username"] == "max" and relinked["account_unlinked_at"] is None
    assert await flow.db.memberships.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_member_takes_over_the_board_profile_through_the_dolibarr_link_instead_of_a_second_one(flow):
    admin = await flow.add_user(role="club_admin")
    flow.act_as(admin)
    board = (await flow.post("/api/membership/profiles/admin", json={"display_name": "Paula Beispiel", "gamertag": "paula-b"})).json()
    await flow.db.club_member_profiles.update_one({"id": board["id"]}, {"$set": {"dolibarr_member_id": 12}})

    paula = await account(flow, "paula")
    await flow.db.memberships.insert_one({"id": "m-paula", "user_id": paula["id"], "member_status": "active", "membership_type": "ordinary"})
    settings = await dolibarr_client.load_settings(flow.db)
    await verify_link(flow.db, settings, user_id=paula["id"], member_id=12, member_ref="12", source="admin", actor_id="admin")

    flow.act_as(paula)
    own = await flow.put("/api/membership/me/directory", json={"listed": True, "bio": "Spielt Rocket League."})
    assert own.status_code == 200, own.text
    assert await flow.db.club_member_profiles.count_documents({}) == 1, "kein zweites Profil"
    stored = await flow.db.club_member_profiles.find_one({"id": board["id"]}, {"_id": 0})
    assert stored["user_id"] == paula["id"] and stored["bio"] == "Spielt Rocket League." and stored["gamertag"] == "paula-b"
    flow.act_as(admin)
    row = next(r for r in (await flow.get("/api/membership/profiles/admin/all")).json() if r["id"] == board["id"])
    assert row["linked_account"]["username"] == "paula"

    # Der Vorstand löst das Konto ausdrücklich: das Mitglied bekommt kein zweites Profil und keins zurück.
    assert (await flow.patch(f"/api/membership/profiles/admin/{board['id']}", json={"user_id": None})).status_code == 200
    flow.act_as(paula)
    refused = await flow.put("/api/membership/me/directory", json={"listed": True})
    assert refused.status_code == 409 and "Vorstand" in refused.json()["detail"]
    assert await flow.db.club_member_profiles.count_documents({}) == 1
