"""Profil und öffentliche Daten (#2126): was Fremde nicht sehen, was die Person selbst pflegt - und dass alte Konten erreichbar bleiben.

Namen und Werte sind erfunden.
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


async def player(flow, name, **fields):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"privacy_public_profile": True, "is_active": True, **fields}})
    user.update(fields)
    return user


async def club_admin(flow, name="vereinsleitung"):
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": ["club"]}})
    return {**user, "areas": ["club"]}


def no_role_anywhere(value, path="antwort"):
    """Sucht in der ganzen Antwort: `role` an einer Person darf nirgends mehr stehen."""
    if isinstance(value, dict):
        assert "role" not in value and "roles" not in value and "internal_role" not in value, path
        for key, item in value.items():
            no_role_anywhere(item, f"{path}.{key}")
    elif isinstance(value, list):
        for item in value:
            no_role_anywhere(item, path)


# ---------------------------------------------------------------- PR5, MG10: keine Rollen nach außen
@pytest.mark.asyncio
async def test_public_views_name_no_system_or_internal_role(flow):
    boss = await player(flow, "chefin")
    await flow.db.users.update_one({"id": boss["id"]}, {"$set": {"role": "superadmin"}})
    await flow.db.memberships.insert_one({"id": "m-1", "user_id": boss["id"], "member_status": "active", "membership_type": "ordinary", "internal_role": "Kassa-Prüfung"})
    await flow.db.teams.insert_one({"id": "t-1", "name": "Rudel", "tag": "RDL", "member_ids": [boss["id"]], "leader_id": boss["id"], "join_code": "geheim-123", "description": "Wir"})
    flow.act_as(None)
    profile = await flow.get("/api/users/public/chefin")
    assert profile.status_code == 200
    no_role_anywhere(profile.json())
    assert "geheim-123" not in profile.text and profile.json()["teams"] == [{"id": "t-1", "name": "Rudel", "tag": "RDL", "description": "Wir"}]
    no_role_anywhere((await flow.get("/api/users/public-list")).json())
    no_role_anywhere((await flow.get("/api/membership/public")).json())


@pytest.mark.asyncio
async def test_friends_and_direct_messages_name_no_system_role(flow):
    boss = await player(flow, "chefin")
    await flow.db.users.update_one({"id": boss["id"]}, {"$set": {"role": "superadmin"}})
    fan = await player(flow, "fan")
    flow.act_as(fan)
    asked = await flow.post(f"/api/friends/{boss['id']}/request")
    assert asked.status_code == 200, asked.text
    no_role_anywhere(asked.json())
    no_role_anywhere((await flow.get("/api/friends")).json())
    sent = await flow.post(f"/api/messages/direct/{boss['id']}", json={"message": "Servus"})
    assert sent.status_code == 200, sent.text
    no_role_anywhere(sent.json())
    no_role_anywhere((await flow.get("/api/messages/conversations")).json())


# ---------------------------------------------------------------- PR2, PR3: Felder und ihre Stufen
@pytest.mark.asyncio
async def test_preferred_role_shows_only_with_a_chosen_level(flow):
    hidden = await player(flow, "ohne-stufe", preferred_role="IGL")
    await player(flow, "mit-stufe", preferred_role="Support", profile_visibility={"preferred_role": "public"})
    await player(flow, "nur-community", preferred_role="Driver", profile_visibility={"preferred_role": "community"})
    flow.act_as(None)
    assert (await flow.get("/api/users/public/ohne-stufe")).json()["preferred_role"] is None
    assert (await flow.get("/api/users/public/mit-stufe")).json()["preferred_role"] == "Support"
    assert (await flow.get("/api/users/public/nur-community")).json()["preferred_role"] is None
    flow.act_as(hidden)
    assert (await flow.get("/api/users/public/ohne-stufe")).json()["preferred_role"] == "IGL"
    assert (await flow.get("/api/users/public/ohne-stufe", params={"view_as": "public"})).json()["preferred_role"] is None
    assert (await flow.get("/api/users/public/nur-community")).json()["preferred_role"] == "Driver"


@pytest.mark.asyncio
async def test_website_subscriptions_and_platforms_follow_their_level(flow):
    await player(flow, "verschlossen", website="https://example.org", gaming_subscriptions=["ea_play"], main_platform="PC", main_platforms=["PC"],
                 profile_visibility={"website": "private", "gaming_subscriptions": "members", "main_platforms": "private"})
    await player(flow, "offen", website="https://example.org", gaming_subscriptions=["ea_play"], main_platform="PC", main_platforms=["PC"])
    flow.act_as(None)
    closed = (await flow.get("/api/users/public/verschlossen")).json()
    assert closed["website"] is None and closed["gaming_subscriptions"] is None
    assert closed["main_platforms"] == [] and closed["main_platform"] is None
    shown = (await flow.get("/api/users/public/offen")).json()
    assert shown["website"] == "https://example.org" and shown["gaming_subscriptions"] == ["ea_play"] and shown["main_platform"] == "PC"


# ---------------------------------------------------------------- Zusatz: Dokumente
@pytest.mark.asyncio
async def test_members_never_see_where_a_document_is_stored(flow):
    await flow.db.documents.insert_one({"id": "d-1", "title": "Statuten", "category": "statutes", "visibility": "members",
                                        "storage_key": "ablage-1.pdf", "created_at": "2026-09-01T10:00:00+00:00"})
    member = await player(flow, "mitglied", is_club_member=True)
    flow.act_as(member)
    for url in ("/api/documents", "/api/documents?scope=club"):
        rows = (await flow.get(url)).json()
        assert [row["id"] for row in rows] == ["d-1"]
        assert "storage_key" not in rows[0] and rows[0]["view_url"] == "/api/documents/d-1/view"

    flow.act_as(await club_admin(flow))
    assert (await flow.get("/api/documents/admin")).json()[0]["storage_key"] == "ablage-1.pdf"
    changed = await flow.patch("/api/documents/d-1", json={"title": "Statuten 2026"})
    assert changed.status_code == 200 and changed.json()["storage_key"] == "ablage-1.pdf"
