"""Regelwerk der Liga (docs/LIGA.md, #1646): Zustimmung je Version, Aufgabe auf der Startseite, nichts blockiert, D-7 (keine
vorgetäuschte Zustimmung beim Zuteilen), das Spiel merkt sich die Version, Auskunft und Kontolöschung. Erfundene Inhalte."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import GAME_ID, duel, ids, two_nil, world  # noqa: E402
from league_rules_world import (  # noqa: E402
    ADMIN, PUBLIC, in_days, league_scope, make_world, publish, season_page, season_scope, today,
)
from league_start_world import ok  # noqa: E402

CONSENTS = f"{PUBLIC}/consents"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def task(flow, user: dict) -> dict | None:
    flow.act_as(user)
    rows = ok(await flow.get("/api/mobile/dashboard"))["me"]["actions"]
    return next((row for row in rows if row["type"] == "rules_consent"), None)


async def agree(flow, w: dict, user: dict, version: dict, squad: dict | None = None):
    flow.act_as(user)
    return await flow.post(CONSENTS, json={"version_id": version["id"], "season_id": w["season"]["id"],
                                           "squad_id": (squad or w["squads"][0])["id"]})


# ---------------------------------------------------------------- Zustimmung

@pytest.mark.asyncio
async def test_a_captain_agrees_and_the_row_points_to_exactly_this_version(flow):
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    answer = await agree(flow, w, w["captain"], version)
    assert answer.status_code == 200, answer.text
    row = await flow.db.league_rule_consents.find_one({}, {"_id": 0})
    assert row["rule_version_id"] == version["id"] and row["version"] == 1
    assert row["user_id"] == w["captain"]["id"] and row["season_id"] == w["season"]["id"]
    assert row["squad_id"] == w["squads"][0]["id"] and row["team_id"] == w["squads"][0]["team_id"]
    assert row["league_id"] == w["league"]["id"] and row["created_at"]
    actions = await flow.db.audit_logs.find({"action": "league.rules.consent"}, {"_id": 0}).to_list(None)
    assert len(actions) == 1


@pytest.mark.asyncio
async def test_agreeing_twice_leaves_one_row(flow):
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    ok(await agree(flow, w, w["captain"], version))
    again = ok(await agree(flow, w, w["captain"], version))
    assert again["replay"] is True
    assert await flow.db.league_rule_consents.count_documents({}) == 1


@pytest.mark.asyncio
async def test_who_may_agree(flow):
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    flow.act_as(None)
    body = {"version_id": version["id"], "season_id": w["season"]["id"], "squad_id": w["squads"][0]["id"]}
    assert (await flow.post(CONSENTS, json=body)).status_code == 401
    assert (await agree(flow, w, w["member"], version)).status_code == 403, "Kader ohne Rolle"
    assert (await agree(flow, w, w["other_captain"], version)).status_code == 403, "Captain des Gegners"
    assert (await agree(flow, w, w["lead"], version)).status_code == 403, "auch nicht die Turnierleitung für ein Co-Team"
    assert await flow.db.league_rule_consents.count_documents({}) == 0
    assert (await agree(flow, w, w["vice"], version)).status_code == 200, "der Vertreter darf"


@pytest.mark.asyncio
async def test_the_main_team_lead_only_agrees_when_the_squad_has_no_captain(flow):
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    team = await flow.db.teams.find_one({"id": w["squads"][0]["team_id"]}, {"_id": 0})
    leader = await flow.db.users.find_one({"id": team["leader_id"]}, {"_id": 0})
    assert (await agree(flow, w, leader, version)).status_code == 403
    await flow.db.team_squads.update_one({"id": w["squads"][0]["id"]}, {"$set": {"captain_id": None, "vice_captain_id": None}})
    assert (await agree(flow, w, leader, version)).status_code == 200


@pytest.mark.asyncio
async def test_only_the_current_version_can_be_agreed_to(flow):
    w = await make_world(flow)
    old = await publish(flow, w, body="# A\nAlt", requires_consent=True)
    current = await publish(flow, w, body="# A\nNeu", requires_consent=True)
    upcoming = await publish(flow, w, body="# A\nKünftig", valid_from=in_days(5), requires_consent=True)
    assert (await agree(flow, w, w["captain"], old)).status_code == 409
    assert (await agree(flow, w, w["captain"], upcoming)).status_code == 409
    assert (await agree(flow, w, w["captain"], current)).status_code == 200


@pytest.mark.asyncio
async def test_agreeing_needs_a_visible_season_and_a_squad_in_it(flow):
    w = await make_world(flow, teams=2, visibility="public")
    version = await publish(flow, w, requires_consent=True)
    flow.act_as(w["captain"])
    assert (await flow.post(CONSENTS, json={"version_id": version["id"], "season_id": w["season"]["id"],
                                            "squad_id": "unbekannt"})).status_code == 404
    assert (await flow.post(CONSENTS, json={"version_id": "unbekannt", "season_id": w["season"]["id"],
                                            "squad_id": w["squads"][0]["id"]})).status_code == 404
    await flow.db.league_seasons.update_one({"id": w["season"]["id"]}, {"$set": {"visibility": "off"}})
    assert (await agree(flow, w, w["captain"], version)).status_code == 404


# ---------------------------------------------------------------- Neue Zustimmung und Aufgabe

@pytest.mark.asyncio
async def test_a_version_without_consent_asks_nobody(flow):
    w = await make_world(flow)
    await publish(flow, w, requires_consent=False)
    assert await task(flow, w["captain"]) is None
    flow.act_as(w["captain"])
    assert ok(await flow.get(season_page(w)))["consent"] is None


@pytest.mark.asyncio
async def test_the_task_goes_to_the_responsible_people_until_they_agree(flow):
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    action = await task(flow, w["captain"])
    assert action["label"] and "Version 1" in action["detail"] and w["squads"][0]["name"] in action["detail"]
    assert action["target_type"] == "league_rules" and action["rules_url"].endswith("/regeln")
    assert "target_id" not in action, "Apps ohne neuen Build zeigen die Zeile ohne Pfeil"
    assert await task(flow, w["vice"])
    assert await task(flow, w["member"]) is None, "Kader ohne Rolle"
    assert await task(flow, w["lead"]) is None, "Unbeteiligte"
    other = await task(flow, w["other_captain"])
    assert other and w["squads"][1]["name"] in other["detail"]
    ok(await agree(flow, w, w["vice"], version))
    assert await task(flow, w["captain"]) is None, "das Co-Team hat zugestimmt"
    assert await task(flow, w["other_captain"]), "das andere noch nicht"


@pytest.mark.asyncio
async def test_a_new_version_with_consent_asks_again_one_without_does_not(flow):
    w = await make_world(flow)
    first = await publish(flow, w, body="# A\nEins", requires_consent=True)
    ok(await agree(flow, w, w["captain"], first))
    await publish(flow, w, body="# A\nZwei", requires_consent=False)
    assert await task(flow, w["captain"]) is None, "Version 2 verlangt nichts Neues"
    third = await publish(flow, w, body="# A\nDrei", requires_consent=True)
    action = await task(flow, w["captain"])
    assert action and "Version 3" in action["detail"]
    ok(await agree(flow, w, w["captain"], third))
    assert await task(flow, w["captain"]) is None


@pytest.mark.asyncio
async def test_a_consent_to_a_newer_version_also_covers_an_older_demand(flow):
    w = await make_world(flow)
    await publish(flow, w, body="# A\nEins", requires_consent=True)
    second = await publish(flow, w, body="# A\nZwei", requires_consent=False)
    assert await task(flow, w["captain"])
    ok(await agree(flow, w, w["captain"], second))
    assert await task(flow, w["captain"]) is None


@pytest.mark.asyncio
async def test_a_future_version_asks_nothing_before_its_day(flow):
    w = await make_world(flow)
    await publish(flow, w, valid_from=in_days(5), requires_consent=True)
    assert await task(flow, w["captain"]) is None


@pytest.mark.asyncio
async def test_a_league_version_asks_the_squads_of_the_season(flow):
    w = await make_world(flow)
    version = await publish(flow, w, scope=league_scope(w), requires_consent=True)
    assert await task(flow, w["captain"])
    ok(await agree(flow, w, w["captain"], version))
    assert await task(flow, w["captain"]) is None


@pytest.mark.asyncio
async def test_the_page_shows_the_captain_what_is_open(flow):
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    flow.act_as(w["captain"])
    consent = ok(await flow.get(season_page(w)))["consent"]
    assert consent["version_id"] == version["id"]
    assert [row["squad_id"] for row in consent["squads"]] == [w["squads"][0]["id"]]
    assert consent["squads"][0]["agreed"] is False
    rules = ok(await flow.get(f"/api/leagues/{w['league']['slug']}/{w['season']['slug']}"))["rules"]
    assert rules["consent_open"] is True
    ok(await agree(flow, w, w["captain"], version))
    consent = ok(await flow.get(season_page(w)))["consent"]
    assert consent["squads"][0]["agreed"] is True and consent["squads"][0]["agreed_at"]
    flow.act_as(None)
    assert ok(await flow.get(season_page(w)))["consent"] is None
    flow.act_as(w["member"])
    assert ok(await flow.get(season_page(w)))["consent"] is None


@pytest.mark.asyncio
async def test_the_leadership_sees_the_state_per_squad(flow):
    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    ok(await agree(flow, w, w["captain"], version))
    flow.act_as(w["lead"])
    state = ok(await flow.get(season_scope(w)))["consents"]
    rows = {row["squad_id"]: row for row in state["rows"]}
    assert state["version_id"] == version["id"]
    assert rows[w["squads"][0]["id"]]["agreed"] is True and rows[w["squads"][0]["id"]]["agreed_by"]
    assert rows[w["squads"][1]["id"]]["agreed"] is False
    assert f"{ADMIN}/league/" not in str(state)


# ---------------------------------------------------------------- Nichts blockiert

async def match_world(flow, *, requires_consent: bool = True) -> dict:
    """Die Spielwelt aus ``league_match_world`` mit Liga und Season, dazu eine gültige Fassung."""
    await flow.db.games.insert_one({"id": GAME_ID, "slug": "probe-shooter", "name": "Probe Shooter"})
    w = await world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Testliga", "slug": "testliga", "game_id": GAME_ID, "status": "active"})
    await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": "liga", "name": "Season 1", "slug": "season-1",
                                             "number": 1, "status": "active", "visibility": "public"})
    w.update(lead=w["staff"], league={"id": "liga", "slug": "testliga"},
             season={"id": w["season_id"], "slug": "season-1", "name": "Season 1"})
    w["rule"] = await publish(flow, w, body="# Fairplay\nFair spielen.", annexes=[], requires_consent=requires_consent)
    return w


@pytest.mark.asyncio
async def test_a_missing_consent_stops_no_game(flow):
    w = await match_world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    report = await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila")))
    assert report.status_code == 200, report.text
    assert await flow.db.league_rule_consents.count_documents({}) == 0
    assert await task(flow, w["users"]["Kapitaen"]), "der Hinweis bleibt"


# ---------------------------------------------------------------- Das Spiel merkt sich die Version

async def confirm_result(flow, w: dict) -> None:
    flow.act_as(w["users"]["Kapitaen"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Kapitaen", "Mila"))))
    flow.act_as(w["users"]["Falke1"])
    ok(await flow.post(f"/api/matches/{w['match']['id']}/report", json=two_nil(w, lineup=ids(w, "Falke1", "Falke2"), side="reg_h")))


@pytest.mark.asyncio
async def test_the_match_remembers_the_version_at_its_result(flow):
    w = await match_world(flow)
    await confirm_result(flow, w)
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert match["status"] == "completed" and match["rule_version_id"] == w["rule"]["id"]


@pytest.mark.asyncio
async def test_a_correction_keeps_the_version_of_the_first_result(flow):
    w = await match_world(flow)
    await confirm_result(flow, w)
    await publish(flow, w, body="# Fairplay\nNeu gefasst.", annexes=[])
    from services.v2_result_submission import submit_v2_result

    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    await submit_v2_result(flow.db, match, [{"registration_id": w["reg_a"]["id"], "rank": 1, "score": 2},
                                            {"registration_id": w["reg_h"]["id"], "rank": 2, "score": 1}],
                           actor_id=w["staff"]["id"], proof_url=None, note=None, force=True, audit_action="match.result.force",
                           reason="Korrektur im Test")
    after = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert after["rule_version_id"] == w["rule"]["id"]


@pytest.mark.asyncio
async def test_undoing_the_result_forgets_the_version(flow):
    w = await match_world(flow)
    await confirm_result(flow, w)
    flow.act_as(w["staff"])
    undone = await flow.post(f"/api/matches/{w['match']['id']}/result/undo", json={})
    assert undone.status_code == 200, undone.text
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert "rule_version_id" not in match


@pytest.mark.asyncio
async def test_a_season_without_rules_stores_no_version(flow):
    await flow.db.games.insert_one({"id": GAME_ID, "slug": "probe-shooter", "name": "Probe Shooter"})
    w = await world(flow)
    await flow.db.leagues.insert_one({"id": "liga", "name": "Testliga", "slug": "testliga", "game_id": GAME_ID, "status": "active"})
    await flow.db.league_seasons.insert_one({"id": w["season_id"], "league_id": "liga", "name": "S", "slug": "s", "number": 1,
                                             "status": "active", "visibility": "public"})
    await confirm_result(flow, w)
    match = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert match["status"] == "completed" and "rule_version_id" not in match


@pytest.mark.asyncio
async def test_other_tournament_formats_never_get_the_field(flow):
    tournament, _users, regs = await flow.with_participants(2)
    await flow.start(tournament)
    match = await duel(flow, tournament, regs[0], regs[1])
    from services.v2_result_submission import submit_v2_result

    actor = await flow.add_staff()
    rows = [{"registration_id": regs[0]["id"], "rank": 1, "score": 2}, {"registration_id": regs[1]["id"], "rank": 2, "score": 0}]
    await submit_v2_result(flow.db, match, rows, actor_id=actor["id"], proof_url=None, note=None, force=False,
                           audit_action="match.result.submit")
    stored = await flow.db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    assert stored["status"] == "completed" and "rule_version_id" not in stored


# ---------------------------------------------------------------- D-7: keine vorgetäuschte Zustimmung

@pytest.mark.asyncio
async def test_assigning_a_squad_no_longer_pretends_a_consent(flow):
    w = await make_world(flow)
    assert {reg["accepted_rules"] for reg in w["regs"]} == {False}
    assert all(reg["registered_via"] == "league_assign" for reg in w["regs"])
    assert await flow.db.league_rule_consents.count_documents({}) == 0


@pytest.mark.asyncio
async def test_other_ways_to_register_keep_their_answer(flow):
    tournament = await flow.create_tournament(requires_rules_acceptance=True)
    player = await flow.add_user(name="Einzelspieler")
    flow.act_as(player)
    answer = await flow.post(f"/api/tournaments/{tournament['id']}/register", json={"accept_rules": True, "accept_privacy": True})
    assert answer.status_code == 200, answer.text
    row = await flow.db.tournament_registrations.find_one({"tournament_id": tournament["id"], "user_id": player["id"]}, {"_id": 0})
    assert row["accepted_rules"] is True


# ---------------------------------------------------------------- Auskunft und Kontolöschung

@pytest.mark.asyncio
async def test_consents_are_in_the_export_and_go_with_the_account(flow):
    from routes.dsgvo_routes import _user_data_export
    from services.account_erasure import erase_related

    w = await make_world(flow)
    version = await publish(flow, w, requires_consent=True)
    ok(await agree(flow, w, w["captain"], version))
    exported = await _user_data_export(flow.db, w["captain"]["id"])
    assert [row["rule_version_id"] for row in exported["league_rule_consents"]] == [version["id"]]
    await erase_related(flow.db, {"id": w["captain"]["id"]}, today())
    assert await flow.db.league_rule_consents.count_documents({"user_id": w["captain"]["id"]}) == 0
    assert await flow.db.league_rules.count_documents({"id": version["id"]}) == 1, "die Fassung selbst bleibt"
