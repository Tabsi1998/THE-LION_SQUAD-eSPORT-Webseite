"""Die eigene Turnieranmeldung ändern (#2113, L-A2): Ingame-Name, IDs und Discord bis zum Check-in. Bei Team-Anmeldungen
nur die Teamleitung, in Liga-Staffeln sind Name und IDs gesperrt. Erfundene Konten, keine echten Personen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

LEAGUE = {"league_id": "l1", "season_id": "s1", "division_id": "d1", "staffel": "A"}
FIELDS = [{"key": "riot", "label": "Riot-ID", "required": True, "help_text": "Name#TAG"},
          {"key": "steam", "label": "Steam", "required": False}]


@pytest_asyncio.fixture
async def flow(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "tournament-self-edit-secret-with-at-least-32-chars")
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _solo(flow, *, reg_status="approved", **tournament_fields):
    game_id = new_id()
    await flow.db.games.insert_one({"id": game_id, "slug": f"spiel-{game_id[:6]}", "name": "Spiel", "player_id_fields": FIELDS})
    tournament = await flow.create_tournament(game_id=game_id, **tournament_fields)
    player = await flow.add_user(name=f"spieler-{new_id()[:6]}")
    registration = {"id": new_id(), "tournament_id": tournament["id"], "user_id": player["id"], "team_id": None, "status": reg_status,
                    "ingame_name": "AlterName", "display_name": "Spielerin", "discord": "alt#1", "player_ids": {"riot": "Alt#EUW", "steam": "s1"}}
    await flow.db.tournament_registrations.insert_one(dict(registration))
    flow.act_as(player)
    return tournament, registration, player


async def _team(flow, **tournament_fields):
    tournament = await flow.create_tournament(team_mode="team", team_size=2, **tournament_fields)
    leader = await flow.add_user(name=f"kapitaen-{new_id()[:6]}")
    co_leader = await flow.add_user(name=f"co-{new_id()[:6]}")
    member = await flow.add_user(name=f"spieler-{new_id()[:6]}")
    team_id = new_id()
    await flow.db.teams.insert_one({"id": team_id, "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [co_leader["id"]],
                                    "member_ids": [leader["id"], co_leader["id"], member["id"]]})
    registration = {"id": new_id(), "tournament_id": tournament["id"], "user_id": member["id"], "team_id": team_id, "status": "approved",
                    "registration_type": "team", "ingame_name": "Rudel", "display_name": "[RDL] Rudel", "discord": "alt#1", "player_ids": {}}
    await flow.db.tournament_registrations.insert_one(dict(registration))
    return tournament, registration, leader, co_leader, member


async def _stored(flow, registration):
    return await flow.db.tournament_registrations.find_one({"id": registration["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_own_registration_changes_name_ids_and_discord(flow):
    tournament, registration, player = await _solo(flow)
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()
    assert view["can_edit"] is True and view["reason"] is None and view["ids_locked"] is False
    assert view["player_ids"]["riot"] == "Alt#EUW" and [field["key"] for field in view["fields"]] == ["riot", "steam"]

    response = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={
        "ingame_name": "  NeuerName ", "discord": "neu#2", "player_ids": {"riot": " Neu#EUW ", "steam": ""}})
    assert response.status_code == 200, response.text
    stored = await _stored(flow, registration)
    assert stored["ingame_name"] == "NeuerName" and stored["discord"] == "neu#2"
    assert stored["player_ids"] == {"riot": "Neu#EUW"}
    # Das Profil bleibt, wie es ist; der Status auch.
    assert stored["status"] == "approved"
    assert not (await flow.db.users.find_one({"id": player["id"]})).get("game_ids")
    audit = await flow.db.audit_logs.find_one({"action": "tournament.registration.self_update"}, {"_id": 0})
    assert audit["data"]["fields"] == ["discord", "ingame_name", "player_ids"]
    assert "Neu#EUW" not in str(audit)


@pytest.mark.asyncio
async def test_required_id_cannot_be_emptied_and_unknown_ids_are_refused(flow):
    tournament, registration, _player = await _solo(flow)
    missing = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"player_ids": {"riot": ""}})
    assert missing.status_code == 400 and "Riot-ID" in missing.json()["detail"]
    unknown = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"player_ids": {"xbox": "x"}})
    assert unknown.status_code == 400
    empty_name = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"ingame_name": "  "})
    assert empty_name.status_code == 400
    assert (await _stored(flow, registration))["player_ids"]["riot"] == "Alt#EUW"


@pytest.mark.asyncio
async def test_status_and_seed_stay_with_the_staff(flow):
    tournament, _registration, _player = await _solo(flow)
    for body in ({"status": "checked_in"}, {"seed": 1}, {"display_name": "Chef"}):
        assert (await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json=body)).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("fields, status, word", [
    ({"status": "live"}, "approved", "läuft"),
    ({"status": "check_in", "check_in_closed_at": "2026-10-01T10:00:00+00:00"}, "approved", "Check-in"),
    ({"status": "check_in"}, "checked_in", "eingecheckt"),
    ({"status": "registration_open"}, "rejected", "nicht mehr"),
    ({"status": "registration_open"}, "disqualified", "nicht mehr"),
])
async def test_after_check_in_only_the_staff_changes(flow, fields, status, word):
    tournament, registration, _player = await _solo(flow, reg_status=status, **fields)
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()
    assert view["can_edit"] is False and word in view["reason"]
    refused = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"discord": "neu#2"})
    assert refused.status_code == 409 and word in refused.json()["detail"]
    assert (await _stored(flow, registration))["discord"] == "alt#1"


@pytest.mark.asyncio
async def test_team_registration_only_the_leadership_changes(flow):
    tournament, registration, leader, co_leader, member = await _team(flow)
    # Das Mitglied hat die Anmeldung einst abgeschickt, leitet das Team aber nicht (mehr).
    flow.act_as(member)
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()
    assert view["can_edit"] is False and "Teamleitung" in view["reason"]
    assert "discord" not in view and "player_ids" not in view
    assert (await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"discord": "x"})).status_code == 403
    for person, value in ((leader, "kapitaen#1"), (co_leader, "co#1")):
        flow.act_as(person)
        response = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"discord": value})
        assert response.status_code == 200, response.text
        assert (await _stored(flow, registration))["discord"] == value


@pytest.mark.asyncio
async def test_strangers_have_nothing_to_change(flow):
    tournament, _registration, _player = await _solo(flow)
    flow.act_as(await flow.add_user(name=f"fremd-{new_id()[:6]}"))
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).status_code == 404
    assert (await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"discord": "x"})).status_code == 404


@pytest.mark.asyncio
async def test_league_staffel_locks_name_and_ids_but_not_discord(flow):
    league = {"league_id": "l1", "season_id": "s1", "division_id": "d1", "staffel": "A"}
    tournament, registration, leader, _co, _member = await _team(flow, league_context=league)
    flow.act_as(leader)
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()
    assert view["can_edit"] is True and view["ids_locked"] is True and "Liga-Kader" in view["ids_locked_reason"]
    for body in ({"ingame_name": "Anders"}, {"ingame_name": ""}):
        refused = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json=body)
        assert refused.status_code == 409 and "Liga-Leitung" in refused.json()["detail"]
    stored = await _stored(flow, registration)
    assert stored["ingame_name"] == "Rudel"
    # Unverändert mitgeschickt ist keine Änderung, Discord geht.
    fine = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"ingame_name": "Rudel", "player_ids": {}, "discord": "neu#2"})
    assert fine.status_code == 200, fine.text
    assert (await _stored(flow, registration))["discord"] == "neu#2"


@pytest.mark.asyncio
async def test_league_staffel_refuses_a_changed_id(flow):
    league = {"league_id": "l1", "season_id": "s1", "division_id": "d1", "staffel": "A"}
    tournament, registration, _player = await _solo(flow, league_context=league)
    refused = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"player_ids": {"riot": "Neu#EUW"}})
    assert refused.status_code == 409 and "Liga-Leitung" in refused.json()["detail"]
    assert (await _stored(flow, registration))["player_ids"]["riot"] == "Alt#EUW"


@pytest.mark.asyncio
async def test_rejected_registration_can_be_removed_and_registered_anew(flow):
    """Abgelehnt (#2113, L-C3): ohne Entfernen liefert eine neue Anmeldung die alte zurück; danach geht sie durch."""
    tournament, registration, _player = await _solo(flow, reg_status="rejected")
    body = {"accept_rules": True, "accept_privacy": True, "player_ids": {"riot": "Neu#EUW"}}
    replay = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=body)
    assert replay.status_code == 200 and replay.json()["status"] == "rejected" and replay.json()["idempotent_replay"] is True

    removed = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    assert removed.status_code == 200, removed.text
    fresh = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=body)
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["id"] != registration["id"] and fresh.json()["status"] == "approved"


async def _league_squad(flow, *, with_captain=True, **fields):
    tournament = await flow.create_tournament(team_mode="team", team_size=2, league_context=LEAGUE, **fields)
    leader = await flow.add_user(name=f"kapitaen-{new_id()[:6]}")
    captain = await flow.add_user(name=f"captain-{new_id()[:6]}")
    team_id, squad_id = new_id(), new_id()
    await flow.db.teams.insert_one({"id": team_id, "name": "Rudel", "tag": "RDL", "leader_id": leader["id"], "co_leader_ids": [],
                                    "member_ids": [leader["id"], captain["id"]]})
    squad = {"id": squad_id, "team_id": team_id, "name": "Erste", "status": "active", "member_ids": [captain["id"]]}
    if with_captain:
        squad["captain_id"] = captain["id"]
    await flow.db.team_squads.insert_one(squad)
    registration = {"id": new_id(), "tournament_id": tournament["id"], "user_id": None, "team_id": team_id, "squad_id": squad_id, "status": "approved",
                    "registration_type": "team", "ingame_name": "Rudel", "display_name": "[RDL] Rudel", "discord": "alt", "player_ids": {}}
    await flow.db.tournament_registrations.insert_one(dict(registration))
    return tournament, registration, leader, captain


@pytest.mark.asyncio
async def test_league_squad_captain_changes_the_contact_the_lead_stands_back(flow):
    """Liga-Co-Team ohne ``user_id``: Captain und Vertreter handeln, die Leitung des Hauptteams tritt zurück."""
    tournament, registration, leader, captain = await _league_squad(flow)
    flow.act_as(captain)
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()
    assert view["can_edit"] is True and view["ids_locked"] is True
    changed = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"discord": "neu"})
    assert changed.status_code == 200, changed.text
    assert (await _stored(flow, registration))["discord"] == "neu"
    flow.act_as(leader)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).status_code == 404


@pytest.mark.asyncio
async def test_league_squad_without_captain_the_lead_changes_the_contact(flow):
    tournament, registration, leader, captain = await _league_squad(flow, with_captain=False)
    flow.act_as(leader)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()["can_edit"] is True
    changed = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"discord": "neu"})
    assert changed.status_code == 200, changed.text
    assert (await _stored(flow, registration))["discord"] == "neu"
    flow.act_as(captain)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["registration_closed", "check_in"])
async def test_fixed_matches_end_self_edit_like_unregistering(flow, status):
    """Feste Spiele vor dem Check-in-Ende (Gruppen generiert, Schweizer Runde): gleiche Grenze wie beim Abmelden."""
    tournament, registration, _player = await _solo(flow, status=status)
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tournament["id"], "status": "scheduled",
                                         "slots": [{"registration_id": registration["id"]}]})
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()
    assert view["can_edit"] is False and "festen Spielen" in view["reason"]
    refused = await flow.patch(f"/api/tournaments/{tournament['id']}/my-registration", json={"ingame_name": "Neu", "player_ids": {"riot": "Z#9"}})
    assert refused.status_code == 409 and "festen Spielen" in refused.json()["detail"]
    stored = await _stored(flow, registration)
    assert stored["ingame_name"] == "AlterName" and stored["player_ids"]["riot"] == "Alt#EUW"
    unregister = await flow.delete(f"/api/tournaments/{tournament['id']}/registrations/{registration['id']}")
    assert unregister.status_code == 409


@pytest.mark.asyncio
async def test_preview_matches_do_not_end_self_edit(flow):
    tournament, registration, _player = await _solo(flow)
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tournament["id"], "status": "preview", "is_preview": True,
                                         "slots": [{"registration_id": registration["id"]}]})
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/my-registration")).json()["can_edit"] is True
