"""Konto löschen mit Rollen in Teams (#2113, L-C5): Kapitän, Co-Kapitän sowie Captain und Vertreter eines Co-Teams
löschen ihr Konto erst, wenn sie die Rolle abgegeben haben - die Meldung nennt je Rolle den Weg. Ohne Rolle geht das
Löschen wie bisher; die Löschung durch den Verein bleibt unberührt. Erfundene Konten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "erasure-team-roles-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _world(flow) -> dict:
    leader = await flow.add_user(name=f"kapitaen-{new_id()[:6]}")
    co_leader = await flow.add_user(name=f"co-{new_id()[:6]}")
    captain = await flow.add_user(name=f"captain-{new_id()[:6]}")
    player = await flow.add_user(name=f"spieler-{new_id()[:6]}")
    team_id = new_id()
    await flow.db.teams.insert_one({
        "id": team_id, "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [co_leader["id"]],
        "member_ids": [leader["id"], co_leader["id"], captain["id"], player["id"]], "is_public": True,
    })
    squad_id = new_id()
    await flow.db.team_squads.insert_one({
        "id": squad_id, "team_id": team_id, "name": "Erste", "status": "active",
        "member_ids": [captain["id"], player["id"]], "captain_id": captain["id"],
    })
    return {"leader": leader, "co_leader": co_leader, "captain": captain, "player": player,
            "team_id": team_id, "squad_id": squad_id}


async def _still_there(flow, user: dict) -> bool:
    stored = await flow.db.users.find_one({"id": user["id"]}, {"_id": 0, "username": 1})
    return stored["username"] == user["username"]


@pytest.mark.asyncio
@pytest.mark.parametrize("who, label, way", [
    ("leader", "Kapitän", "Zum Kapitän machen"),
    ("co_leader", "Co-Kapitän", "Team verlassen"),
    ("captain", "Captain", "Rolle abgeben"),
])
async def test_role_in_a_team_blocks_own_erasure_with_the_way_out(flow, who, label, way):
    world = await _world(flow)
    flow.act_as(world[who])

    check = await flow.get("/api/dsgvo/anonymize-me/check")
    assert check.status_code == 200, check.text
    body = check.json()
    assert body["can_erase"] is False
    assert [row["role_label"] for row in body["blockers"]] == [label]
    assert body["blockers"][0]["team"] == "[RDL] Rudel"
    assert way in body["blockers"][0]["way"]

    refused = await flow.post("/api/dsgvo/anonymize-me")
    assert refused.status_code == 409
    assert label in refused.json()["detail"] and way in refused.json()["detail"]
    assert await _still_there(flow, world[who])


@pytest.mark.asyncio
async def test_without_a_role_erasure_works_as_before(flow):
    world = await _world(flow)
    flow.act_as(world["player"])
    check = (await flow.get("/api/dsgvo/anonymize-me/check")).json()
    assert check == {"can_erase": True, "blockers": [], "message": None, "closing": None}
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200
    assert not await _still_there(flow, world["player"])


@pytest.mark.asyncio
async def test_after_handing_over_the_lead_erasure_goes_through(flow):
    world = await _world(flow)
    flow.act_as(world["leader"])
    handed = await flow.post(f"/api/teams/{world['team_id']}/transfer-leader", json={"new_leader_id": world["player"]["id"]})
    assert handed.status_code == 200, handed.text
    # Nach der Übergabe ist der alte Kapitän Co-Kapitän - auch das hält auf, bis er das Team verlässt.
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 409
    assert (await flow.post(f"/api/teams/{world['team_id']}/leave")).status_code == 200
    assert (await flow.post("/api/dsgvo/anonymize-me")).status_code == 200


@pytest.mark.asyncio
async def test_archived_co_team_does_not_block(flow):
    world = await _world(flow)
    await flow.db.team_squads.update_one({"id": world["squad_id"]}, {"$set": {"status": "archived"}})
    flow.act_as(world["captain"])
    assert (await flow.get("/api/dsgvo/anonymize-me/check")).json()["can_erase"] is True


@pytest.mark.asyncio
async def test_erasure_by_the_club_is_not_blocked(flow):
    from routes import dsgvo_routes

    world = await _world(flow)
    await dsgvo_routes._anonymize_user_data(flow.db, world["leader"]["id"], "vorstand-test", "user.admin_anonymize")
    assert not await _still_there(flow, world["leader"])


@pytest.mark.asyncio
async def test_dead_end_always_names_the_way_to_the_club(flow):
    """Kapitän als einziges Mitglied, Team in laufender Liga: Auflösen und Löschen gehen nicht - der Schlusssatz schon."""
    await flow.db.settings.update_one({"id": "branding"}, {"$set": {"id": "branding", "privacy_contact_email": "datenschutz@verein.example"}}, upsert=True)
    leader = await flow.add_user(name=f"allein-{new_id()[:6]}")
    team_id = new_id()
    await flow.db.teams.insert_one({"id": team_id, "name": "Einzeln", "tag": "ONE", "leader_id": leader["id"], "co_leader_ids": [], "member_ids": [leader["id"]]})
    tournament = await flow.create_tournament(team_mode="team", team_size=2, status="live",
                                              league_context={"league_id": "l1", "season_id": "s1", "division_id": "d1", "staffel": "A"})
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": None, "team_id": team_id,
                                                       "squad_id": "x", "status": "approved", "display_name": "Einzeln"})
    flow.act_as(leader)
    dissolve = await flow.delete(f"/api/teams/{team_id}?confirm=Einzeln")
    assert dissolve.status_code == 409
    erase = await flow.post("/api/dsgvo/anonymize-me")
    assert erase.status_code == 409 and "schreib an datenschutz@verein.example" in erase.json()["detail"]
    check = (await flow.get("/api/dsgvo/anonymize-me/check")).json()
    assert "der Verein löscht dein Konto" in check["closing"] and check["closing"] in check["message"]


@pytest.mark.asyncio
async def test_without_an_address_the_contact_form_is_named(flow):
    world = await _world(flow)
    flow.act_as(world["leader"])
    check = (await flow.get("/api/dsgvo/anonymize-me/check")).json()
    assert check["closing"].startswith("Kommst du so nicht weiter, ")
