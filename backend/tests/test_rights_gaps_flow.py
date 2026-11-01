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


# ---------------------------------------------------------------- MG4, MG6: Vorstand
async def audit(flow, action: str) -> list[dict]:
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(50)


async def notices(flow, user: dict) -> list[dict]:
    return await flow.db.notifications.find({"user_id": user["id"], "kind": "rights_change"}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_posts_are_logged_and_the_person_is_told(flow):
    chair = await granted(flow, "vorstand", "club")
    erika = await member(flow, "erika")
    await flow.db.users.update_one({"id": erika["id"]}, {"$set": {"mfa_enabled": False}})
    flow.act_as(chair)
    created = await flow.post("/api/board", json={"title_male": "Beirat", "title_female": "Beirätin"})
    assert created.status_code == 200, created.text
    pid = created.json()["id"]
    assert (await audit(flow, "board.create"))[0]["data"]["position"] == created.json()["slug"]

    assert (await flow.patch(f"/api/board/{pid}", json={"user_id": erika["id"]})).status_code == 200
    told = await notices(flow, erika)
    assert len(told) == 1 and "Du bist jetzt Beirat/Beirätin." in told[0]["body"]
    assert "Vereinsverwaltung" in told[0]["body"] and "Zwei-Faktor" in told[0]["body"]
    assert told[0]["url"] == "/profile?tab=security"

    # Deaktivieren nimmt die Vereinsverwaltung - steht im Protokoll, die Person erfährt es.
    assert (await flow.patch(f"/api/board/{pid}", json={"is_active": False})).status_code == 200
    status = await audit(flow, "board.status")
    assert status[0]["data"]["active"] is False and status[0]["actor_id"] == chair["id"] and status[0]["data"]["holders"] == [erika["id"]]
    told = await notices(flow, erika)
    assert len(told) == 2 and "ist jetzt inaktiv" in told[1]["body"] and "Nicht mehr dabei: Vereinsverwaltung." in told[1]["body"]

    assert (await flow.patch(f"/api/board/{pid}", json={"is_active": True})).status_code == 200
    assert (await flow.patch(f"/api/board/{pid}", json={"title_male": "Rechnungsprüfer"})).status_code == 200
    assert "title_male" in (await audit(flow, "board.update"))[0]["data"]["fields"]
    assert len(await audit(flow, "board.assign")) == 1, "Bezeichnung ändern ist keine Besetzung"

    deleted = await flow.delete(f"/api/board/{pid}")
    assert deleted.status_code == 200
    gone = await audit(flow, "board.delete")
    assert gone[0]["data"]["holders"] == [erika["id"]]
    assert "gibt es nicht mehr" in (await notices(flow, erika))[-1]["body"]


@pytest.mark.asyncio
async def test_a_profile_holder_is_told_through_the_linked_account_and_a_replaced_one_too(flow):
    chair = await granted(flow, "vorstand", "club")
    erika, mara = await member(flow, "erika"), await member(flow, "mara")
    profile_id = new_id()
    await flow.db.club_member_profiles.insert_one({"id": profile_id, "display_name": "Erika Beispiel", "user_id": erika["id"], "is_active": True})
    pid = await position(flow, user_id=profile_id)
    flow.act_as(chair)
    assert (await flow.patch(f"/api/board/{pid}", json={"user_id": mara["id"]})).status_code == 200
    assert "Du bist nicht mehr Kassier:in." in (await notices(flow, erika))[0]["body"]
    assert "Du bist jetzt Kassier:in." in (await notices(flow, mara))[0]["body"]


@pytest.mark.asyncio
async def test_rights_from_dolibarr_only_tell_about_the_post(flow, monkeypatch):
    from services import permissions

    async def from_dolibarr(db, user_id):
        return set()

    monkeypatch.setattr(permissions, "areas_from_dolibarr", from_dolibarr)
    chair = await flow.add_user(role="club_admin", name="clubadmin")
    erika = await member(flow, "erika")
    pid = await position(flow)
    flow.act_as(chair)
    assert (await flow.patch(f"/api/board/{pid}", json={"user_id": erika["id"]})).status_code == 200
    body = (await notices(flow, erika))[0]["body"]
    assert "Du bist jetzt Kassier:in." in body and "Vereinsverwaltung" not in body


@pytest.mark.asyncio
async def test_a_grant_and_a_role_tell_the_person_and_a_switched_off_topic_does_not_stop_it(flow):
    root = await flow.add_user(role="superadmin", name="root")
    erika = await flow.add_user(role="player", name="erika")
    await flow.db.users.update_one({"id": erika["id"]}, {"$set": {"notification_preferences": {"membership_updates": False, "club_internal": False, "in_app": False}}})
    flow.act_as(root)
    assert (await flow.put(f"/api/users/{erika['id']}/areas", json={"areas": ["content"]})).status_code == 200
    assert "Neu dazu: Redaktion." in (await notices(flow, erika))[0]["body"]
    assert (await flow.post(f"/api/users/{erika['id']}/role", json={"role": "moderator"})).status_code == 200
    body = (await notices(flow, erika))[1]["body"]
    assert "Deine Rolle ist jetzt „Moderator“." in body and "Neu dazu: Moderation." in body and "Zwei-Faktor" not in body
    assert (await flow.put(f"/api/users/{erika['id']}/areas", json={"areas": []})).status_code == 200
    assert "Nicht mehr dabei: Redaktion." in (await notices(flow, erika))[2]["body"]


# ---------------------------------------------------------------- MG5: Profil löschen
@pytest.mark.asyncio
async def test_a_profile_with_a_post_or_a_reference_cannot_be_deleted_or_handed_on(flow):
    chair = await granted(flow, "vorstand", "club")
    erika, other = await member(flow, "erika"), await member(flow, "mara")
    profile_id, reference_profile, free_profile = new_id(), new_id(), new_id()
    await flow.db.club_member_profiles.insert_many([
        {"id": profile_id, "slug": "erika", "display_name": "Erika Beispiel", "user_id": erika["id"], "is_active": True},
        {"id": reference_profile, "slug": "ref", "display_name": "Mit Referenz", "is_active": True},
        {"id": free_profile, "slug": "frei", "display_name": "Ohne Verknüpfung", "is_active": True},
    ])
    pid = await position(flow, user_id=profile_id)
    await flow.db.references.insert_one({"id": new_id(), "title": "Pokal", "entries": [{"member_profile_ids": [reference_profile]}]})
    flow.act_as(chair)

    refused = await flow.delete(f"/api/membership/profiles/admin/{profile_id}")
    assert refused.status_code == 409 and "Vorstandsposten „Kassier“" in refused.json()["detail"]
    assert await flow.db.club_member_profiles.find_one({"id": profile_id})

    # Das Konto wechseln gäbe oder nähme still die Vereinsverwaltung.
    for user_id in (None, other["id"]):
        moved = await flow.patch(f"/api/membership/profiles/admin/{profile_id}", json={"user_id": user_id})
        assert moved.status_code == 409 and "Vorstandsposten" in moved.json()["detail"]
    assert (await flow.db.club_member_profiles.find_one({"id": profile_id}))["user_id"] == erika["id"]

    with_reference = await flow.delete(f"/api/membership/profiles/admin/{reference_profile}")
    assert with_reference.status_code == 409 and "eine Referenz" in with_reference.json()["detail"]

    assert (await flow.delete(f"/api/membership/profiles/admin/{free_profile}")).status_code == 200
    assert (await flow.delete(f"/api/membership/profiles/admin/{free_profile}")).status_code == 404

    # Posten neu besetzt: jetzt geht es.
    assert (await flow.patch(f"/api/board/{pid}", json={"user_id": ""})).status_code == 200
    assert (await flow.delete(f"/api/membership/profiles/admin/{profile_id}")).status_code == 200


@pytest.mark.asyncio
async def test_a_post_on_the_account_also_blocks_deleting_the_profile(flow):
    chair = await granted(flow, "vorstand", "club")
    erika = await member(flow, "erika")
    profile_id = new_id()
    await flow.db.club_member_profiles.insert_one({"id": profile_id, "slug": "erika", "display_name": "Erika", "user_id": erika["id"]})
    await position(flow, deputy_user_id=erika["id"], is_active=False)
    flow.act_as(chair)
    assert (await flow.delete(f"/api/membership/profiles/admin/{profile_id}")).status_code == 409


# ---------------------------------------------------------------- MG1: Rechte-Verlauf
@pytest.mark.asyncio
async def test_rights_history_shows_only_this_person_to_the_club_area(flow):
    root = await flow.add_user(role="superadmin", name="root")
    chair = await granted(flow, "vorstand", "club")
    erika, mara = await member(flow, "erika"), await member(flow, "mara")
    profile_id = new_id()
    await flow.db.club_member_profiles.insert_one({"id": profile_id, "slug": "erika", "display_name": "Erika", "user_id": erika["id"]})
    pid = await position(flow, user_id=profile_id)
    other_post = await position(flow, slug="obmann", title_male="Obmann", title_female="Obfrau")
    flow.act_as(root)
    await flow.post(f"/api/users/{erika['id']}/role", json={"role": "moderator"})
    await flow.put(f"/api/users/{erika['id']}/areas", json={"areas": ["content"]})
    await flow.put(f"/api/users/{mara['id']}/areas", json={"areas": ["content"]})
    flow.act_as(chair)
    await flow.patch(f"/api/board/{pid}", json={"is_active": False})
    await flow.patch(f"/api/board/{pid}", json={"user_id": mara["id"]})
    await flow.patch(f"/api/board/{other_post}", json={"deputy_user_id": mara["id"]})
    await flow.db.audit_logs.insert_one({"id": new_id(), "action": "user.ban", "target_id": erika["id"], "actor_id": root["id"], "data": {"reason": "steht nicht im Verlauf"}, "created_at": "2026-01-01T00:00:00+00:00"})

    response = await flow.get(f"/api/users/{erika['id']}/rights-history")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    by_action = {row["action"]: row for row in items}
    assert set(by_action) == {"user.role_change", "user.areas_change", "board.status", "board.assign"}
    assert by_action["user.role_change"]["from"] == erika["role"] and by_action["user.role_change"]["to"] == "moderator"
    assert by_action["user.role_change"]["actor"] in (root.get("display_name"), root["username"])
    assert by_action["user.areas_change"]["to"] == ["content"]
    assert by_action["board.assign"]["joined"] is False and by_action["board.assign"]["title"] == "Kassier:in"
    assert by_action["board.status"]["active"] is False
    assert "reason" not in str(items) and "actor_id" not in items[0]

    mara_items = (await flow.get(f"/api/users/{mara['id']}/rights-history")).json()["items"]
    assign = [row for row in mara_items if row["action"] == "board.assign"]
    assert {row["joined"] for row in assign} == {True} and {row["field"] for row in assign} == {"holder", "deputy"}

    assert (await flow.get("/api/users/gibt-es-nicht/rights-history")).status_code == 404
    flow.act_as(await flow.add_user(role="moderator", name="moderator"))
    assert (await flow.get(f"/api/users/{erika['id']}/rights-history")).status_code == 403


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
