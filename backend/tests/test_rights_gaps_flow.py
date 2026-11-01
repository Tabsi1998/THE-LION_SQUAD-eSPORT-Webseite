"""Rechte ohne Lücken (#2125): der letzte Superadmin bleibt, jede Rechteänderung steht mit Vorher im Protokoll, Vorstandsposten
ändern sich nie still, und ein Mitgliederprofil mit Posten oder Referenz lässt sich nicht löschen."""
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


async def member(flow, name: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active", "source": "website"})
    return user


async def position(flow, slug: str = "kassier", **extra) -> str:
    pid = new_id()
    await flow.db.board_positions.insert_one({"id": pid, "slug": slug, "title_male": "Kassier", "title_female": "Kassierin", "is_active": True,
                                              "is_default": False, "allow_deputy": True, "user_id": None, "deputy_user_id": None, "order_index": 2, **extra})
    return pid


# ---------------------------------------------------------------- MG2, MG3: Rollen
@pytest.mark.asyncio
async def test_the_last_superadmin_cannot_step_down_but_with_a_second_one_it_works(flow):
    root = await flow.add_user(role="superadmin", name="root")
    flow.act_as(root)
    refused = await flow.post(f"/api/users/{root['id']}/role", json={"role": "player"})
    assert refused.status_code == 409 and "letzte Superadmin" in refused.json()["detail"]
    assert (await flow.db.users.find_one({"id": root["id"]}))["role"] == "superadmin"
    assert await flow.db.audit_logs.count_documents({"action": "user.role_change"}) == 0

    second = await flow.add_user(role="superadmin", name="zweite")
    flow.act_as(root)
    demoted = await flow.post(f"/api/users/{second['id']}/role", json={"role": "club_admin"})
    assert demoted.status_code == 200
    # Danach wieder allein: wieder kein Herabstufen.
    assert (await flow.post(f"/api/users/{root['id']}/role", json={"role": "player"})).status_code == 409


@pytest.mark.asyncio
async def test_a_banned_second_superadmin_does_not_count(flow):
    root = await flow.add_user(role="superadmin", name="root")
    banned = await flow.add_user(role="superadmin", name="gesperrt")
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"is_banned": True}})
    flow.act_as(root)
    assert (await flow.post(f"/api/users/{root['id']}/role", json={"role": "player"})).status_code == 409


@pytest.mark.asyncio
async def test_role_change_needs_an_account_and_notes_the_old_role(flow):
    root = await flow.add_user(role="superadmin", name="root")
    person = await flow.add_user(role="moderator", name="erika")
    flow.act_as(root)
    missing = await flow.post("/api/users/gibt-es-nicht/role", json={"role": "moderator"})
    assert missing.status_code == 404
    assert await flow.db.audit_logs.count_documents({"action": "user.role_change"}) == 0

    changed = await flow.post(f"/api/users/{person['id']}/role", json={"role": "tournament_admin"})
    assert changed.status_code == 200 and changed.json()["role"] == "tournament_admin"
    audit = await flow.db.audit_logs.find_one({"action": "user.role_change", "target_id": person["id"]}, {"_id": 0})
    assert audit["data"] == {"role": "tournament_admin", "from": "moderator"} and audit["actor_id"] == root["id"]

    # Keine Änderung, kein Eintrag.
    same = await flow.post(f"/api/users/{person['id']}/role", json={"role": "tournament_admin"})
    assert same.status_code == 200
    assert await flow.db.audit_logs.count_documents({"action": "user.role_change"}) == 1


@pytest.mark.asyncio
async def test_only_the_superadmin_changes_roles(flow):
    person = await flow.add_user(role="moderator", name="erika")
    flow.act_as(await flow.add_user(role="club_admin", name="clubadmin"))
    assert (await flow.post(f"/api/users/{person['id']}/role", json={"role": "superadmin"})).status_code == 403


@pytest.mark.asyncio
async def test_the_last_superadmin_cannot_delete_the_own_account(flow):
    root = await flow.add_user(role="superadmin", name="root")
    flow.act_as(root)
    check = (await flow.get("/api/dsgvo/anonymize-me/check")).json()
    assert check["can_erase"] is False and check["blockers"][0]["role"] == "superadmin"
    refused = await flow.post("/api/dsgvo/anonymize-me")
    assert refused.status_code == 409 and "letzte Superadmin" in refused.json()["detail"]
    assert (await flow.db.users.find_one({"id": root["id"]}))["role"] == "superadmin"

    await flow.add_user(role="superadmin", name="zweite")
    flow.act_as(root)
    assert (await flow.get("/api/dsgvo/anonymize-me/check")).json()["can_erase"] is True
