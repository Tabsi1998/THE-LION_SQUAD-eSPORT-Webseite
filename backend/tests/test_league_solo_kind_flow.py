"""Solo-Liga anlegen, Paket P1 (#1629, S5 und S11; docs/LIGA.md „Solo-Liga“): Teilnehmerart ab dem Anlegen fest, geprüft gegen
``games.supports_solo``, Vorgaben einer Season aus 1 gegen 1 - daneben eine Team-Liga mit den Vorgaben von vorher (Gegenprobe).

Entschieden 27.11. (Fabian, Nr. 285). Nur erfundene Namen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import league_participants  # noqa: E402
from league_solo_world import ADMIN, SEASON, make_game, make_league  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


# ---------------------------------------------------------------- S5: Liga als Solo anlegen

@pytest.mark.asyncio
async def test_a_solo_league_is_created_with_its_kind_and_a_team_league_stays_the_default(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)

    solo = await make_league(flow, game, "solo", "Duell Liga")
    team = await make_league(flow, game, None, "Team Liga")

    assert solo["participant_kind"] == "solo"
    assert team["participant_kind"] == "team"
    stored = await flow.db.leagues.find_one({"id": solo["id"]}, {"_id": 0})
    assert stored["participant_kind"] == "solo"
    listed = (await flow.get(ADMIN)).json()
    kinds = {row["id"]: row["participant_kind"] for row in listed["leagues"]}
    assert kinds == {solo["id"]: "solo", team["id"]: "team"}
    # Die Verwaltung bietet die Wahl nur bei Spielen mit Einzelspielern an - dafür braucht sie das Feld am Spiel.
    assert listed["games"][0]["supports_solo"] is True
    assert listed["season_defaults_solo"]["team_size"] == 1


@pytest.mark.asyncio
async def test_a_solo_league_needs_a_game_that_allows_single_players(flow):
    flow.act_as(await flow.add_staff())
    teams_only = await make_game(flow, supports_solo=False)

    refused = await flow.post(ADMIN, json={"name": "Duell Liga", "game_id": teams_only["id"], "participant_kind": "solo"})
    team = await flow.post(ADMIN, json={"name": "Team Liga", "game_id": teams_only["id"]})

    assert refused.status_code == 422
    assert refused.json()["detail"] == league_participants.game_problem(teams_only, "solo")
    assert team.status_code == 200, team.text
    assert await flow.db.leagues.count_documents({}) == 1


@pytest.mark.asyncio
async def test_the_kind_stays_after_creation_with_a_clear_message(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    solo = await make_league(flow, game, "solo", "Duell Liga")
    team = await make_league(flow, game, None, "Team Liga")

    to_team = await flow.patch(f"{ADMIN}/{solo['id']}", json={"participant_kind": "team"})
    to_solo = await flow.patch(f"{ADMIN}/{team['id']}", json={"participant_kind": "solo"})
    same = await flow.patch(f"{ADMIN}/{solo['id']}", json={"participant_kind": "solo", "name": "Duell Liga Neu"})

    assert to_team.status_code == 409 and to_team.json()["detail"] == league_participants.KIND_LOCKED
    assert to_solo.status_code == 409 and to_solo.json()["detail"] == league_participants.KIND_LOCKED
    assert same.status_code == 200, same.text
    assert (await flow.db.leagues.find_one({"id": solo["id"]}))["participant_kind"] == "solo"
    assert (await flow.db.leagues.find_one({"id": team["id"]}))["participant_kind"] == "team"


@pytest.mark.asyncio
async def test_a_solo_league_cannot_switch_to_a_game_without_single_players(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    teams_only = await make_game(flow, name="Nur Teams", slug="nur-teams", supports_solo=False)
    solo = await make_league(flow, game, "solo", "Duell Liga")

    refused = await flow.patch(f"{ADMIN}/{solo['id']}", json={"game_id": teams_only["id"]})

    assert refused.status_code == 422
    assert refused.json()["detail"] == league_participants.game_problem(teams_only, "solo")


# ---------------------------------------------------------------- S11: Vorgaben aus 1 gegen 1

@pytest.mark.asyncio
async def test_a_solo_season_starts_one_against_one_and_a_team_season_as_before(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    solo = await make_league(flow, game, "solo", "Duell Liga")
    team = await make_league(flow, game, None, "Team Liga")

    solo_season = (await flow.post(f"{ADMIN}/{solo['id']}/seasons", json=SEASON)).json()
    team_season = (await flow.post(f"{ADMIN}/{team['id']}/seasons", json=SEASON)).json()

    assert (solo_season["team_size"], solo_season["min_squad_size"], solo_season["max_squad_size"]) == (1, 1, 1)
    assert solo_season["lineup_min_players"] == 1
    assert solo_season["checkin_rules"]["min_present"] == 1
    # Gegenprobe: die Team-Liga mit den Vorgaben von vorher (4 gegen 4, Mindestkader 3, Check-in 3).
    assert (team_season["team_size"], team_season["min_squad_size"], team_season["max_squad_size"]) == (4, 3, 50)
    assert team_season["lineup_min_players"] == 3
    assert team_season["checkin_rules"]["min_present"] == 3


@pytest.mark.asyncio
async def test_the_solo_defaults_stay_adjustable_but_the_team_size_stays_one(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    solo = await make_league(flow, game, "solo", "Duell Liga")

    bigger = await flow.post(f"{ADMIN}/{solo['id']}/seasons", json={**SEASON, "team_size": 2})
    season = (await flow.post(f"{ADMIN}/{solo['id']}/seasons", json={**SEASON, "max_staffel_size": 6, "min_age": 16})).json()
    changed = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"team_size": 3})
    squad = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"min_squad_size": 2})
    division = await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={"overrides": {"team_size": 2}})

    assert bigger.status_code == 422 and bigger.json()["detail"] == league_participants.TEAM_SIZE_SOLO
    assert season["max_staffel_size"] == 6 and season["min_age"] == 16 and season["team_size"] == 1
    assert changed.status_code == 422 and changed.json()["detail"] == league_participants.TEAM_SIZE_SOLO
    assert squad.status_code == 422 and squad.json()["detail"] == league_participants.SQUAD_SIZE_SOLO
    assert division.status_code == 422 and division.json()["detail"] == league_participants.TEAM_SIZE_SOLO


@pytest.mark.asyncio
async def test_a_solo_season_has_no_self_registration_yet(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    solo = await make_league(flow, game, "solo", "Duell Liga")
    window = {"application_opens_at": "2026-11-01T10:00:00Z", "application_closes_at": "2026-11-08T10:00:00Z"}

    refused = await flow.post(f"{ADMIN}/{solo['id']}/seasons", json={**SEASON, **window})
    season = (await flow.post(f"{ADMIN}/{solo['id']}/seasons", json=SEASON)).json()
    later = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json=window)

    assert refused.status_code == 422 and refused.json()["detail"] == league_participants.APPLICATIONS_FOLLOW
    assert later.status_code == 422 and later.json()["detail"] == league_participants.APPLICATIONS_FOLLOW


@pytest.mark.asyncio
async def test_the_readiness_of_a_solo_season_warns_that_the_match_flow_follows(flow):
    """Veröffentlichen bleibt erlaubt (Nr. 297) - „Was fehlt noch?“ warnt aber deutlich, bis der Spielbetrieb für Spieler steht."""
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    solo = await make_league(flow, game, "solo", "Duell Liga")
    team = await make_league(flow, game, None, "Team Liga")
    solo_season = (await flow.post(f"{ADMIN}/{solo['id']}/seasons", json=SEASON)).json()
    team_season = (await flow.post(f"{ADMIN}/{team['id']}/seasons", json=SEASON)).json()

    solo_check = (await flow.get(f"{ADMIN}/seasons/{solo_season['id']}/readiness")).json()
    team_check = (await flow.get(f"{ADMIN}/seasons/{team_season['id']}/readiness")).json()

    assert solo_check["warnings"][0] == {"code": "solo_operations_follow", "text": league_participants.READINESS_FOLLOWS}
    assert solo_check["warnings"][0]["text"].startswith("Solo-Liga: Spielbetrieb folgt – Spiele lassen sich noch nicht austragen.")
    # Keine Sperre: ein Hinweis, kein Problem - die Probleme sind dieselben wie in der Team-Liga.
    assert [row["code"] for row in solo_check["problems"]] == [row["code"] for row in team_check["problems"]]
    assert "solo_operations_follow" not in [row["code"] for row in team_check["warnings"]]


@pytest.mark.asyncio
async def test_a_solo_season_can_still_be_published(flow):
    flow.act_as(await flow.add_staff())
    game = await make_game(flow)
    solo = await make_league(flow, game, "solo", "Duell Liga")
    season = (await flow.post(f"{ADMIN}/{solo['id']}/seasons", json=SEASON)).json()
    # Was eine Team-Season genauso bräuchte (Pool, Regelwerk, Staffel), umgeht hier der Superadmin mit Grund - die Solo-Warnung hält nichts auf.
    published = await flow.patch(f"{ADMIN}/seasons/{season['id']}", json={"visibility": "members", "readiness_override_reason": "Probe ohne Pool"})

    assert published.status_code == 200, published.text
    assert published.json()["visibility"] == "members"
