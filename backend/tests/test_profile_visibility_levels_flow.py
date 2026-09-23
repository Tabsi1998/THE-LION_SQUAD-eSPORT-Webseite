"""Sichtbarkeit der Profilfelder je Betrachter (#257 Nachtrag): die Stufen Community, Verein, Nur Admins
und Privat galten bisher wie „nicht öffentlich“ - ein Feld auf „Community“ sah nicht einmal ein
eingeloggtes Mitglied. Der Betreiber merkte es an seinem Steam-Konto: im Konto verifiziert, im
öffentlichen Profil weder das Feld noch das Häkchen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


@pytest.mark.asyncio
async def test_field_levels_follow_the_viewer(flow):
    paula = await person(
        flow, "paula", privacy_public_profile=True,
        steam_id="76561198000000001", twitch_handle="paula", psn_id="paula_psn", epic_id="paula_epic", xbox_id="paula_xbox",
        platform_verified={"steam": True, "twitch": True},
        profile_visibility={"steam": "community", "twitch": "public", "psn": "members", "epic": "admins", "xbox": "private"},
    )
    url = f"/api/users/public/{paula['username']}"

    # Ohne Anmeldung: nur Öffentliches - und das Häkchen nur, wo das Feld sichtbar ist.
    flow.act_as(None)
    anon = (await flow.get(url)).json()
    assert anon["twitch_handle"] == "paula" and anon["steam_id"] is None and anon["psn_id"] is None and anon["epic_id"] is None and anon["xbox_id"] is None
    assert anon["verified_platforms"] == ["twitch"]

    # Eingeloggt (Community): Steam samt Häkchen, Vereins- und Admin-Felder nicht.
    otto = await person(flow, "otto")
    flow.act_as(otto)
    seen = (await flow.get(url)).json()
    assert seen["steam_id"] == "76561198000000001" and seen["verified_platforms"] == ["twitch", "steam"]
    assert seen["psn_id"] is None and seen["epic_id"] is None and seen["xbox_id"] is None

    # Vereinsmitglied: auch „Verein“, nicht „Nur Admins“.
    maria = await person(flow, "maria")
    await flow.db.memberships.insert_one({"id": "m-maria", "user_id": maria["id"], "member_status": "active", "membership_type": "ordinary"})
    flow.act_as(maria)
    member_view = (await flow.get(url)).json()
    assert member_view["steam_id"] and member_view["psn_id"] == "paula_psn" and member_view["epic_id"] is None and member_view["xbox_id"] is None

    # Admin-Team: alles außer „Privat“.
    admin = await person(flow, "chef", role="club_admin")
    flow.act_as(admin)
    admin_view = (await flow.get(url)).json()
    assert admin_view["psn_id"] == "paula_psn" and admin_view["epic_id"] == "paula_epic" and admin_view["xbox_id"] is None

    # Die Person selbst sieht alles, auch „Privat“.
    flow.act_as(paula)
    own = (await flow.get(url)).json()
    assert own["xbox_id"] == "paula_xbox" and own["verified_platforms"] == ["twitch", "steam"]

    # Ein nicht öffentliches Profil bleibt für andere weg - Stufen hin oder her.
    await flow.db.users.update_one({"id": paula["id"]}, {"$set": {"privacy_public_profile": False}})
    flow.act_as(otto)
    assert (await flow.get(url)).status_code == 404
