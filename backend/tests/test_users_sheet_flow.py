"""Alle Benutzer (#1357): Rolle und Freigaben ändert nur der Superadmin, gesperrt wird mit Grund - und die Person erfährt
den Grund per Mail. Die Liste nennt den Stand einer Einladung zum Mitgliedsantrag und Bereiche aus einem Vorstandsposten.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


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
async def test_only_the_superadmin_changes_roles_and_grants(flow):
    target = await flow.add_user(role="player", name="erika")
    chair = await flow.add_user(name="vorsitz")
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True,
                                              "user_id": chair["id"], "deputy_user_id": None})
    actors = [
        await flow.add_user(role="club_admin", name="clubadmin"),
        chair,
        await granted(flow, "freigabe-verein", "club"),
        await flow.add_user(role="tournament_admin", name="turnierleitung"),
        await flow.add_user(role="moderator", name="moderation"),
    ]
    for actor in actors:
        flow.act_as(actor)
        role = await flow.post(f"/api/users/{target['id']}/role", json={"role": "club_admin"})
        assert role.status_code == 403, (actor["username"], role.text)
        areas = await flow.put(f"/api/users/{target['id']}/areas", json={"areas": ["club"]})
        assert areas.status_code == 403, (actor["username"], areas.text)
    stored = await flow.db.users.find_one({"id": target["id"]})
    assert stored["role"] == "player" and not stored.get("areas")

    root = await flow.add_user(role="superadmin", name="root")
    flow.act_as(root)
    granted_areas = await flow.put(f"/api/users/{target['id']}/areas", json={"areas": ["club", "finance"]})
    assert granted_areas.status_code == 200, granted_areas.text
    new_role = await flow.post(f"/api/users/{target['id']}/role", json={"role": "moderator"})
    assert new_role.status_code == 200, new_role.text
    stored = await flow.db.users.find_one({"id": target["id"]})
    assert stored["role"] == "moderator" and stored["areas"] == ["club", "finance"]
    actions = [row["action"] async for row in flow.db.audit_logs.find({"target_id": target["id"]})]
    assert actions == ["user.areas_change", "user.role_change"]


@pytest.mark.asyncio
async def test_a_ban_tells_the_person_the_reason(flow):
    player = await flow.add_user(name="spieler")
    flow.act_as(await granted(flow, "vorstand", "club"))
    banned = await flow.post(f"/api/users/{player['id']}/ban", json={"reason": "Wiederholt beleidigt <trotz Hinweis>"})
    assert banned.status_code == 200, banned.text
    assert banned.json()["notified"] is True
    mail = await flow.db.mail_jobs.find_one({"template_key": "account_banned"}, {"_id": 0})
    assert mail["to"] == player["email"]
    assert "Wiederholt beleidigt &lt;trotz Hinweis&gt;" in mail["html"]
    assert "gesperrt" in mail["subject"]
    audit = await flow.db.audit_logs.find_one({"action": "user.ban", "target_id": player["id"]}, {"_id": 0})
    assert audit["data"]["reason"] == "Wiederholt beleidigt <trotz Hinweis>"


@pytest.mark.asyncio
async def test_the_list_names_the_invitation_and_rights_from_a_board_post(flow):
    invited = await flow.add_user(name="eingeladen")
    await flow.db.membership_invitations.insert_one({"id": new_id(), "user_id": invited["id"], "status": "open",
                                                     "created_at": "2026-10-01T10:00:00+00:00", "expires_at": "2099-01-01T00:00:00+00:00"})
    chair = await flow.add_user(name="vorsitz")
    await flow.db.board_positions.insert_one({"id": new_id(), "slug": "obmann", "title_male": "Obmann", "is_active": True,
                                              "user_id": chair["id"], "deputy_user_id": None})
    flow.act_as(await granted(flow, "vorstand", "club"))
    listed = await flow.get("/api/users")
    rows = {row["username"]: row for row in listed.json()}
    assert rows["eingeladen"]["membership_invitation"] == {"status": "open", "created_at": "2026-10-01T10:00:00+00:00", "applied_at": None}
    assert rows["vorsitz"]["areas_from_board"] is True and rows["vorsitz"]["ban_protected"] is True
    assert rows["eingeladen"]["areas_from_board"] is False
