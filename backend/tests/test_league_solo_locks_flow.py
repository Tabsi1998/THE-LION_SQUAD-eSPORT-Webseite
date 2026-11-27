"""Sperren der Solo-Staffel nach der unabhängigen Prüfung (#1629, P1, Korrekturrunde): Was es für Spieler erst mit P2 bis P4 gibt, darf
auch über die Turnierwege nicht durchrutschen - Selbst-Abmeldung, fester Spielplan im Entwurf, Selbst-Check-in. Dazu Kontosuche ohne
gesperrte Konten, Selbst-Zuteilung nur als Notausnahme, Startrechte, Protokoll und Texte. Gegenproben aus
``scratchpad/r1629/test_r1629_gegenproben.py`` übernommen. Team-Staffeln bleiben, wie sie sind. Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import league_desk, league_participants, staffel_guard  # noqa: E402
from league_solo_world import ADMIN, assign_person, make_game, make_league, make_staffel, solo_world  # noqa: E402
from squad_world import make_squad, make_team  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def team_world(flow, world: dict) -> dict:
    """Eine Team-Liga daneben mit einem zugeteilten Co-Team - für die Gegenproben."""
    league = await make_league(flow, world["game"], None, "Team Liga")
    _season, _division, tournament = await make_staffel(flow, league)
    leader = await flow.add_user(name="Teamleitung")
    members = [await flow.add_user(name=f"Rudel {index}") for index in range(3)]
    lions = await make_team(flow, "Loewen", leader=leader, members=members)
    squad = await make_squad(flow, lions, "Rudel A", [leader, *members])
    flow.act_as(world["admin"])
    reg = (await flow.post(f"/api/tournaments/{tournament['id']}/squad-registrations",
                           json={"team_id": lions["id"], "squad_id": squad["id"]})).json()["registration"]
    return {"tournament": tournament, "leader": leader, "registration": reg}


# ---------------------------------------------------------------- Muss 1: Selbst-Abmeldung

@pytest.mark.asyncio
async def test_a_person_cannot_take_herself_out_of_a_solo_staffel(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    reg = (await assign_person(flow, world["tournament"], player)).json()["registration"]

    flow.act_as(player)
    gone = await flow.delete(f"/api/tournaments/{world['tournament']['id']}/registrations/{reg['id']}")

    assert gone.status_code == 403
    assert gone.json()["detail"] == staffel_guard.PERSON_UNREGISTER_REFUSED
    assert await flow.db.tournament_registrations.count_documents({"id": reg["id"]}) == 1


@pytest.mark.asyncio
async def test_gegenprobe_the_team_lead_still_cannot_unregister_an_assigned_squad(flow):
    world = await solo_world(flow)
    team = await team_world(flow, world)

    flow.act_as(team["leader"])
    gone = await flow.delete(f"/api/tournaments/{team['tournament']['id']}/registrations/{team['registration']['id']}")

    assert gone.status_code == 403
    assert gone.json()["detail"] == staffel_guard.SQUAD_UNREGISTER_REFUSED


# ---------------------------------------------------------------- Muss 2: fester Spielplan im Entwurf

@pytest.mark.asyncio
async def test_no_fixed_schedule_in_a_solo_staffel_only_the_preview(flow):
    world = await solo_world(flow)
    tid = world["tournament"]["id"]
    regs = [(await assign_person(flow, world["tournament"], await flow.add_user(name=f"Duellant {index}"))).json()["registration"]
            for index in range(4)]
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tid}, {"_id": 0, "id": 1})

    built = await flow.post(f"/api/tournaments/{tid}/stages/{stage['id']}/generate", params={"force": "true"})
    rebuilt = await flow.post(f"/api/tournaments/{tid}/bracket/from-format", params={"preview": "false", "force": "true"}, json={})
    preview = await flow.post(f"/api/tournaments/{tid}/stages/{stage['id']}/generate", params={"preview": "true", "force": "true"})

    assert built.status_code == 400 and built.json()["detail"] == league_participants.OPERATIONS_FOLLOW
    assert rebuilt.status_code == 400 and rebuilt.json()["detail"] == league_participants.OPERATIONS_FOLLOW
    assert preview.status_code == 200, preview.text
    assert await flow.db.matches_v2.count_documents({"tournament_id": tid, "is_preview": {"$ne": True}}) == 0
    # Die Staffel hängt nicht: Entfernen geht weiter.
    removed = await flow.delete(f"/api/tournaments/{tid}/squad-registrations/{regs[0]['id']}")
    assert removed.status_code == 200, removed.text


@pytest.mark.asyncio
async def test_no_structure_apply_in_a_solo_staffel(flow):
    world = await solo_world(flow)
    tid = world["tournament"]["id"]
    applied = await flow.post(f"/api/tournaments/{tid}/bracket/apply",
                              json={"expected_plan_hash": "a" * 64, "expected_base_structure_hash": "b" * 64})

    assert applied.status_code == 400 and applied.json()["detail"] == league_participants.OPERATIONS_FOLLOW


@pytest.mark.asyncio
async def test_gegenprobe_a_team_staffel_still_builds_its_fixed_schedule(flow):
    world = await solo_world(flow)
    team = await team_world(flow, world)
    tid = team["tournament"]["id"]
    stage = await flow.db.tournament_stages.find_one({"tournament_id": tid}, {"_id": 0, "id": 1})
    if not stage:
        pytest.skip("Die Team-Staffel hat mit einem Co-Team noch keine Phase - der Vergleich steht in test_league_* zum Spielplan.")

    built = await flow.post(f"/api/tournaments/{tid}/stages/{stage['id']}/generate", params={"force": "true"})

    assert built.json().get("detail") != league_participants.OPERATIONS_FOLLOW


# ---------------------------------------------------------------- Muss 3: Selbst-Check-in

@pytest.mark.asyncio
async def test_a_person_cannot_check_in_herself_in_a_solo_staffel(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    reg = (await assign_person(flow, world["tournament"], player)).json()["registration"]

    flow.act_as(player)
    checked = await flow.post(f"/api/tournaments/{world['tournament']['id']}/checkin")

    assert checked.status_code == 409 and checked.json()["detail"] == league_participants.OPERATIONS_FOLLOW
    assert (await flow.db.tournament_registrations.find_one({"id": reg["id"]}))["status"] == "approved"


@pytest.mark.asyncio
async def test_no_staff_check_in_in_a_solo_staffel_either(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    reg = (await assign_person(flow, world["tournament"], player)).json()["registration"]

    checked = await flow.post(f"/api/tournaments/{world['tournament']['id']}/registrations/{reg['id']}/checkin", json={"status": "checked_in"})

    assert checked.status_code == 409 and checked.json()["detail"] == league_participants.OPERATIONS_FOLLOW
    assert (await flow.db.tournament_registrations.find_one({"id": reg["id"]}))["status"] == "approved"


@pytest.mark.asyncio
async def test_gegenprobe_team_staffel_check_in_is_untouched(flow):
    world = await solo_world(flow)
    team = await team_world(flow, world)

    flow.act_as(team["leader"])
    checked = await flow.post(f"/api/tournaments/{team['tournament']['id']}/checkin")

    assert checked.json().get("detail") != league_participants.OPERATIONS_FOLLOW


# ---------------------------------------------------------------- Kann

@pytest.mark.asyncio
async def test_the_account_search_hides_banned_and_deactivated_accounts(flow):
    world = await solo_world(flow)
    await flow.add_user(name="Duellant Frei")
    banned = await flow.add_user(name="Duellant Gesperrt")
    gone = await flow.add_user(name="Duellant Inaktiv")
    await flow.db.users.update_one({"id": banned["id"]}, {"$set": {"is_banned": True}})
    await flow.db.users.update_one({"id": gone["id"]}, {"$set": {"is_active": False}})

    found = (await flow.get(f"/api/tournaments/{world['tournament']['id']}/squad-candidates", params={"q": "Duellant"})).json()
    direct = await assign_person(flow, world["tournament"], banned)

    assert [row["display_name"] for row in found["people"]] == ["Duellant Frei"]
    assert direct.status_code == 400 and "gesperrt" in direct.json()["detail"]


@pytest.mark.asyncio
async def test_the_lead_assigns_herself_only_as_an_emergency_with_a_reason(flow):
    world = await solo_world(flow)
    tid = world["tournament"]["id"]

    plain = await assign_person(flow, world["tournament"], world["admin"])
    short = await flow.post(f"/api/tournaments/{tid}/squad-registrations", json={"user_id": world["admin"]["id"], "conflict_reason": "ja"})
    reasoned = await flow.post(f"/api/tournaments/{tid}/squad-registrations",
                               json={"user_id": world["admin"]["id"], "conflict_reason": "Probe-Spiel, sonst fehlt eine Person"})

    assert plain.status_code == 403 and plain.json()["detail"] == squad_self_detail()
    assert short.status_code == 403
    assert reasoned.status_code == 200, reasoned.text
    logged = await flow.db.audit_logs.find_one({"action": "league.conflict.override"}, {"_id": 0})
    assert logged["data"]["action"] == "league.player.assign" and logged["data"]["reason"].startswith("Probe-Spiel")


def squad_self_detail() -> str:
    from services import squad_registration

    return squad_registration.SELF_ASSIGN_SUPERADMIN


@pytest.mark.asyncio
async def test_start_rights_follow_in_a_solo_season(flow):
    world = await solo_world(flow)

    saved = await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/start-rights", json={"active": True})

    assert saved.status_code == 409 and saved.json()["detail"] == league_participants.SUCCESSOR_FOLLOWS


@pytest.mark.asyncio
async def test_the_log_names_players_and_the_texts_speak_of_persons(flow):
    world = await solo_world(flow)
    player = await flow.add_user(name="Duellant Eins")
    reg = (await assign_person(flow, world["tournament"], player)).json()["registration"]
    await flow.delete(f"/api/tournaments/{world['tournament']['id']}/squad-registrations/{reg['id']}")

    log = (await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/desk/log")).json()
    # Eintragen an „Spieler zuteilen“ vorbei (Turnierweg der Leitung): der Satz spricht von Spielern.
    joined = await flow.post(f"/api/tournaments/{world['tournament']['id']}/registrations", json={"user_id": player["id"]})

    assert sorted(row["label"] for row in log["items"] if row["action"].startswith("league.player.")) == ["Spieler · entfernt", "Spieler · übernommen"]
    assert joined.status_code == 400 and joined.json()["detail"] == staffel_guard.PERSON_REGISTRATION_REFUSED
    assert league_desk.log_label("tournament.participant.withdrawn", {}, solo=True) == "Spieler · ausgetreten"
    assert league_desk.log_label("tournament.participant.withdrawn", {}) == "Co-Team · ausgetreten"


@pytest.mark.asyncio
async def test_switching_off_and_creating_a_solo_league_at_once_never_both_pass(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)

    off, league = await asyncio.gather(
        flow.patch(f"/api/games/{game['id']}", json={"supports_solo": False}),
        flow.post(ADMIN, json={"name": "Duell Liga", "game_id": game["id"], "participant_kind": "solo"}),
    )

    stored = await flow.db.games.find_one({"id": game["id"]})
    solo = await flow.db.leagues.count_documents({"game_id": game["id"], "participant_kind": "solo"})
    assert not (off.status_code == 200 and league.status_code == 200), (off.text, league.text)
    assert not (stored.get("supports_solo") is False and solo), "Spiel ohne Einzelspieler mit Solo-Liga"
