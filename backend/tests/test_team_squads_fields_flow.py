"""Die Squad-Ansicht eines Teams nennt zu Mitgliedern nur, was sie zeigt (#1497).

``GET /api/teams/{id}/squads`` gibt zu jedem Squad-Mitglied nur Kennung, Benutzername, Anzeigename und Avatar zurück -
wie die anderen Team-Antworten (``_public_user``). Web (TeamsPanel) und App (TeamDetailScreen) lesen daraus nur diese
Felder. Das Konto im Test hat dazu private und unnötige Felder (E-Mail, Geburtsdatum, Einstellungen, Passwort-Hash);
keines davon steht in der Antwort. Erfundene Konten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

ALLOWED = {"id", "username", "display_name", "avatar_url"}


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "team-squads-fields-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _team_with_squad(flow) -> dict:
    leader = await flow.add_user(name=f"leitung-{new_id()[:6]}")
    member = await flow.add_user(name=f"mitglied-{new_id()[:6]}")
    await flow.db.users.update_one({"id": member["id"]}, {"$set": {
        "display_name": "Mila Mitglied",
        "avatar_url": "/uploads/mila.png",
        "email": "mila@example.test",
        "birthdate": "2001-04-01",
        "bio": "Spielt gern im Rudel.",
        "country": "AT",
        "settings": {"newsletter": True},
        "notification_settings": {"email": True},
        "password_hash": "$2b$12$erfundenerhashwert",
        "discord_id": "123456789",
    }})
    team_id = new_id()
    await flow.db.teams.insert_one({
        "id": team_id, "name": "Rudel", "tag": "RDL", "member_ids": [leader["id"], member["id"]],
        "leader_id": leader["id"], "co_leader_ids": [], "is_public": False,
        "created_at": "2026-10-01T10:00:00+00:00",
    })
    squad_id = new_id()
    await flow.db.team_squads.insert_one({
        "id": squad_id, "team_id": team_id, "name": "Erste", "description": "Lineup Herbst",
        "status": "active", "member_ids": [member["id"], leader["id"]],
        "created_at": "2026-10-01T10:00:00+00:00",
    })
    return {"leader": leader, "member": member, "team_id": team_id, "squad_id": squad_id}


@pytest.mark.asyncio
async def test_squad_members_only_carry_the_shown_fields(flow):
    world = await _team_with_squad(flow)
    flow.act_as(world["leader"])

    response = await flow.get(f"/api/teams/{world['team_id']}/squads")

    assert response.status_code == 200, response.text
    squads = response.json()
    assert [squad["id"] for squad in squads] == [world["squad_id"]]
    squad = squads[0]
    # Der Squad selbst bleibt unverändert, die Reihenfolge der Mitglieder auch.
    assert squad["name"] == "Erste"
    assert squad["description"] == "Lineup Herbst"
    assert squad["member_ids"] == [world["member"]["id"], world["leader"]["id"]]
    assert [m["id"] for m in squad["members"]] == [world["member"]["id"], world["leader"]["id"]]
    for member in squad["members"]:
        assert set(member) == ALLOWED, sorted(set(member) - ALLOWED)
    assert squad["members"][0] == {
        "id": world["member"]["id"],
        "username": world["member"]["username"],
        "display_name": "Mila Mitglied",
        "avatar_url": "/uploads/mila.png",
    }


@pytest.mark.asyncio
async def test_outsiders_still_do_not_see_squads(flow):
    world = await _team_with_squad(flow)
    outsider = await flow.add_user(name=f"fremd-{new_id()[:6]}")
    flow.act_as(outsider)

    response = await flow.get(f"/api/teams/{world['team_id']}/squads")

    assert response.status_code in (403, 404), response.text
