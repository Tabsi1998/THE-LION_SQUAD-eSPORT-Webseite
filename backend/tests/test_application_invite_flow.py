"""Bewerbungen (#1356): zum Mitgliedsantrag lädt nur die Vereinsverwaltung ein - ein Mitglied bekommt einen Hinweis statt
einer Einladung, eine zweite Einladung ist die bestehende."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow(tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def granted(flow, name: str, *areas: str) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


@pytest.mark.asyncio
async def test_only_the_club_area_invites_and_members_get_a_hint(flow):
    guest = await flow.add_user(name="gast")
    member = await flow.add_user(name="mitglied")
    await flow.db.memberships.insert_one({"user_id": member["id"], "member_status": "active"})

    for actor in (await flow.add_user(role="tournament_admin", name="turnierleitung"), await granted(flow, "redaktion", "content"),
                  await flow.add_user(role="moderator", name="moderation")):
        flow.act_as(actor)
        refused = await flow.post("/api/admin/membership-invitations", json={"user_id": guest["id"]})
        assert refused.status_code == 403, (actor["username"], refused.text)
    open_invitations = await flow.db.membership_invitations.count_documents({})
    assert open_invitations == 0

    flow.act_as(await granted(flow, "vorstand", "club"))
    created = await flow.post("/api/admin/membership-invitations", json={"user_id": guest["id"], "note": "Schön, dass du dabei bist"})
    assert created.status_code == 200, created.text
    assert created.json()["status"] == "open" and not created.json().get("existing")
    again = await flow.post("/api/admin/membership-invitations", json={"user_id": guest["id"]})
    assert again.json()["existing"] is True and again.json()["id"] == created.json()["id"]
    hint = await flow.post("/api/admin/membership-invitations", json={"user_id": member["id"]})
    assert hint.status_code == 409 and hint.json()["detail"] == "Dieses Konto ist schon aktives Mitglied."
