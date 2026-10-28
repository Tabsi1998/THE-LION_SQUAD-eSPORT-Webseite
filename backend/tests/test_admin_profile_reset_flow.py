"""Profil eines anderen Kontos ändern (#2118): die Vereinsverwaltung kann nur Anzeigename, Bio, Avatar und Banner
zurücksetzen (Moderation) - mit Grund und Protokoll. Einwilligungen, Datenschutz-Schalter, Rollen und alle anderen
Felder ändert nur die Person selbst. Superadmin-Konten fasst nur ein Superadmin an. Namen sind erfunden."""
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


async def granted(flow, name: str, *areas: str) -> dict:
    user = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {"areas": list(areas)}})
    user["areas"] = list(areas)
    return user


async def target(flow, name="spielerin", role="player"):
    user = await flow.add_user(role=role, name=name)
    await flow.db.users.update_one({"id": user["id"]}, {"$set": {
        "display_name": "Unpassender Name", "bio": "Unpassender Text", "avatar_url": "/api/static/uploads/a.png",
        "banner_url": "/api/static/uploads/b.png", "newsletter_consent": True, "privacy_public_profile": True, "x_handle": "spielerin_x",
    }})
    return user


@pytest.mark.asyncio
async def test_club_resets_display_name_bio_and_images_with_reason_and_log(flow):
    chair = await granted(flow, "vorsitz", "club")
    person = await target(flow)
    flow.act_as(chair)
    response = await flow.patch(f"/api/users/{person['id']}", json={
        "reset": ["display_name", "bio", "avatar_url", "banner_url"], "reason": "Beleidigender Anzeigename",
    })
    assert response.status_code == 200, response.text
    stored = await flow.db.users.find_one({"id": person["id"]}, {"_id": 0})
    assert stored.get("display_name") is None and stored.get("bio") is None
    assert stored.get("avatar_url") is None and stored.get("banner_url") is None
    # Alles andere bleibt, wie die Person es gesetzt hat.
    assert stored["newsletter_consent"] is True and stored["privacy_public_profile"] is True and stored["x_handle"] == "spielerin_x"
    audit = await flow.db.audit_logs.find_one({"action": "user.admin_profile_reset"}, {"_id": 0})
    assert audit["actor_id"] == chair["id"] and audit["target_id"] == person["id"]
    assert audit["data"]["fields"] == ["avatar_url", "banner_url", "bio", "display_name"]
    assert audit["data"]["reason"] == "Beleidigender Anzeigename"
    # Keine Kopie der alten Angaben im Protokoll - sie blieben sonst beim Löschen des Kontos stehen.
    assert "Unpassender" not in str(audit)


@pytest.mark.asyncio
async def test_consents_privacy_switches_and_other_fields_are_refused(flow):
    chair = await granted(flow, "vorsitz", "club")
    person = await target(flow)
    flow.act_as(chair)
    for body in ({"newsletter_consent": False, "reason": "Test der Sperre"},
                 {"privacy_public_profile": False, "reason": "Test der Sperre"},
                 {"reset": ["newsletter_consent"], "reason": "Test der Sperre"},
                 {"reset": ["bio"], "x_handle": "neu", "reason": "Test der Sperre"},
                 {"display_name": "Neuer Name", "reason": "Test der Sperre"}):
        response = await flow.patch(f"/api/users/{person['id']}", json=body)
        assert response.status_code == 422, (body, response.text)
    stored = await flow.db.users.find_one({"id": person["id"]}, {"_id": 0})
    assert stored["newsletter_consent"] is True and stored["display_name"] == "Unpassender Name"
    assert await flow.db.audit_logs.count_documents({"action": "user.admin_profile_reset"}) == 0


@pytest.mark.asyncio
async def test_a_reason_is_required(flow):
    chair = await granted(flow, "vorsitz", "club")
    person = await target(flow)
    flow.act_as(chair)
    assert (await flow.patch(f"/api/users/{person['id']}", json={"reset": ["bio"]})).status_code == 422
    assert (await flow.patch(f"/api/users/{person['id']}", json={"reset": ["bio"], "reason": "  x "})).status_code == 422
    assert (await flow.put(f"/api/users/{person['id']}", json={"reset": [], "reason": "Leere Liste"})).status_code == 422


@pytest.mark.asyncio
async def test_superadmin_accounts_only_by_a_superadmin(flow):
    root = await flow.add_user(role="superadmin", name="root")
    other_root = await target(flow, "zweiter-root", role="superadmin")
    chair = await granted(flow, "vorsitz", "club")
    body = {"reset": ["bio"], "reason": "Bio passt nicht"}
    flow.act_as(chair)
    refused = await flow.patch(f"/api/users/{other_root['id']}", json=body)
    assert refused.status_code == 403
    assert (await flow.db.users.find_one({"id": other_root["id"]}))["bio"] == "Unpassender Text"
    flow.act_as(root)
    assert (await flow.patch(f"/api/users/{other_root['id']}", json=body)).status_code == 200


@pytest.mark.asyncio
async def test_players_and_unknown_accounts(flow):
    player = await flow.add_user(role="player", name="spieler")
    person = await target(flow)
    flow.act_as(player)
    assert (await flow.patch(f"/api/users/{person['id']}", json={"reset": ["bio"], "reason": "Kein Recht dazu"})).status_code == 403
    chair = await granted(flow, "vorsitz", "club")
    flow.act_as(chair)
    assert (await flow.patch("/api/users/gibt-es-nicht", json={"reset": ["bio"], "reason": "Konto fehlt"})).status_code == 404
