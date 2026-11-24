"""Relegation aus dem Endstand und ihre Wirkung auf die Folge-Season (#2404, docs/LIGA.md „F.6 … Relegation und Folge-Season“;
Entscheidungen Nr. 212, 213, 222, 223, 226) - über die echten Routen.

Zwei Liga N mit Relegationsplätzen: der Dritte der oberen gegen den Zweiten der unteren. Paarungen, Heimrecht, Termin hinter den
Playoffs der unteren Liga, Abschluss mit ``outcome``, Auf- und Abstieg in der neuen Season samt „Übernahme neu berechnen“, Sperren
über alle Pflichtspiele. Nur erfundene Namen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_postseason_world import (  # noqa: E402
    STAFFELN, build, close, cockpit, create, division_of, matches_of, play_round, settle, sides, win,
)
from league_start_world import ADMIN, ok  # noqa: E402
from models import now_utc  # noqa: E402

# Liga 1: Platz 3 spielt Relegation, Platz 4 steigt ab. Liga 2: Platz 1 steigt auf, Platz 2 spielt Relegation.
ZONES = {1: {"relegate": 1, "playoff_relegate": 1}, 2: {"promote": 1, "playoff_promote": 1}}
RELEGATION = {"relegation": {"enabled": True}}
NEW_START = (now_utc() + timedelta(days=400)).date().isoformat() + "T00:00:00"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def relegation_tournament(flow, world: dict, level: int = 1) -> dict:
    return await flow.db.tournaments.find_one({"league_context.division_id": world["divisions"][level]["id"], "league_context.kind": "relegation"}, {"_id": 0})


def reg(world: dict, level: int, index: int, staffel: int = 0) -> dict:
    return world["regs"][world["tids"][level][staffel]][index]


async def play_relegation(flow, world: dict, *, lower_wins: bool) -> dict:
    tournament = await relegation_tournament(flow, world)
    flow.act_as(world["lead"])
    for match in await matches_of(flow, tournament["id"]):
        upper, lower = sides(match)
        await win(flow, match, lower if lower_wins else upper)
    await settle(flow, tournament["id"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    return tournament


async def successor_preview(flow, world: dict) -> dict:
    flow.act_as(world["lead"])
    return ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))


def levels_of(preview: dict) -> dict[int, set[str]]:
    return {row["level"]: {team["squad_id"] for team in row["teams"]} for row in preview["divisions"]}


# ---------------------------------------------------------------- Paarungen und Anlegen

@pytest.mark.asyncio
async def test_relegation_pairs_the_upper_places_against_the_lower_ones_with_home_right_for_the_upper_team(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    part = division_of(await cockpit(flow, world), 1)["relegation"]
    assert part["state"] == "waiting" and part["lower_label"] == "Liga 2" and part["pairs"] == []
    await close(flow, world, world["tids"][1][0])
    part = division_of(await cockpit(flow, world), 1)["relegation"]
    # Erst wenn die regulären Staffeln **beider** Ligen abgeschlossen sind.
    assert part["state"] == "waiting" and [row["code"] for row in part["blockers"]] == ["regular_open"]
    await close(flow, world, world["tids"][2][0])
    view = await cockpit(flow, world)
    part = division_of(view, 1)["relegation"]
    assert part["state"] == "ready" and part["can_create"]
    assert [(pair["upper"]["display_name"], pair["lower"]["display_name"]) for pair in part["pairs"]] == [
        (reg(world, 1, 2)["display_name"], reg(world, 2, 1)["display_name"])]
    # Die unterste Liga hat keine Relegation nach unten (Nr. 226) - die Vorlage der Season gilt dort einfach nicht.
    assert division_of(view, 2)["relegation"] is None
    ok(await create(flow, world, "relegation"))
    tournament = await relegation_tournament(flow, world)
    assert tournament["league_context"] == {"league_id": world["league"]["id"], "season_id": world["season"]["id"],
                                            "division_id": world["divisions"][1]["id"], "staffel": "REL", "kind": "relegation",
                                            "lower_division_id": world["divisions"][2]["id"]}
    assert tournament["title"].endswith("Relegation") and tournament["status"] == "live"
    matches = await matches_of(flow, tournament["id"])
    assert len(matches) == 1 and matches[0]["round_name"] == "Relegation"
    regs = {row["id"]: row async for row in flow.db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0})}
    home, away = sides(matches[0])
    assert regs[home]["postseason"]["side"] == "upper" and regs[home]["squad_id"] == reg(world, 1, 2)["squad_id"]
    assert regs[away]["postseason"]["side"] == "lower" and regs[away]["squad_id"] == reg(world, 2, 1)["squad_id"]
    assert all("league_squad_key" not in row for row in regs.values())


@pytest.mark.asyncio
async def test_relegation_follows_the_playoffs_of_the_lower_division(flow):
    lower_playoffs = {2: {"playoffs": {"enabled": True, "per_staffel": 4}}}
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION, division_postseason=lower_playoffs)
    view = await cockpit(flow, world)
    playoffs = division_of(view, 2)["playoffs"]
    part = division_of(view, 1)["relegation"]
    # Nr. 222: Die Relegation liegt hinter dem Ende der Playoffs der unteren Liga - die Vorschau zeigt das Datum und warum.
    assert part["after_playoffs_of"] == "Liga 2" and part["start_day"] > playoffs["end_day"]
    assert playoffs["rounds"][0]["start_day"] > view["season"]["regular_end_day"]
    await close(flow, world)
    ok(await create(flow, world, "playoffs", 2))
    ok(await create(flow, world, "relegation"))
    lower = await flow.db.tournaments.find_one({"league_context.kind": "playoff"}, {"_id": 0})
    upper = await relegation_tournament(flow, world)
    assert upper["start_date"] > lower["end_date"]
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    # Das Ende der Season schließt Playoffs und Relegation ein (V1): Sperren und Nachweise enden nicht vorher.
    assert season["postseason_end"] == upper["end_date"]
    from services.league_calendar import season_end_at

    assert season_end_at(season).isoformat() == upper["end_date"]


@pytest.mark.asyncio
async def test_without_playoffs_below_the_relegation_starts_after_the_regular_season(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    view = await cockpit(flow, world)
    part = division_of(view, 1)["relegation"]
    assert part["after_playoffs_of"] is None and part["start_day"] > view["season"]["regular_end_day"]


@pytest.mark.asyncio
async def test_relegation_settings_must_add_up_and_need_places_on_both_sides(flow):
    world = await build(flow, levels=2, zones={1: {"relegate": 1, "playoff_relegate": 2}, 2: {"promote": 1, "playoff_promote": 1}})
    flow.act_as(world["lead"])
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    refused = await flow.put(url, json=RELEGATION)
    assert refused.status_code == 422 and "geht nicht auf" in refused.json()["detail"]
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][1]['id']}", json={"zones": {"relegate": 1, "playoff_relegate": 0}}))
    missing = await flow.put(url, json=RELEGATION)
    assert missing.status_code == 422 and "kein Relegationsplatz" in missing.json()["detail"]
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][1]['id']}", json={"zones": {"relegate": 1, "playoff_relegate": 1}}))
    ok(await flow.put(url, json=RELEGATION))


# ---------------------------------------------------------------- Wirkung auf die Folge-Season

@pytest.mark.asyncio
async def test_the_new_season_waits_for_the_relegation(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    await close(flow, world)
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert season["status"] != "completed"
    preview = await successor_preview(flow, world)
    assert not preview["can_create"] and any("Relegation" in text and "nicht angelegt" in text for text in preview["problems"])
    closing = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/closing"))
    assert not closing["season"]["closed"] and closing["postseason_missing"][0]["kind"] == "relegation"
    ok(await create(flow, world, "relegation"))
    preview = await successor_preview(flow, world)
    assert not preview["can_create"] and "Die Relegation ist noch nicht abgeschlossen." in preview["problems"]
    refused = await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START, "confirm": True})
    assert refused.status_code == 409


@pytest.mark.asyncio
async def test_the_relegation_winner_from_below_moves_up_and_the_loser_down(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    tournament = await play_relegation(flow, world, lower_wins=True)
    final = await flow.db.league_final_tables.find_one({"tournament_id": tournament["id"], "active": True}, {"_id": 0})
    upper, lower = reg(world, 1, 2)["squad_id"], reg(world, 2, 1)["squad_id"]
    assert final["kind"] == "relegation" and final["outcome"] == {upper: "down", lower: "up"}
    assert [(row["side"], row["result"], row["outcome"]) for row in final["rows"]] == [("upper", "lost", "down"), ("lower", "won", "up")]
    assert final["champion"] is None and final["zones"] == {}
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert season["status"] == "completed"
    preview = await successor_preview(flow, world)
    assert preview["can_create"] and "Relegation" in preview["relegation_note"] and "steigt" in preview["relegation_note"]
    found = levels_of(preview)
    # Liga 1: Platz 1 und 2 bleiben, dazu der Aufsteiger (Platz 1 unten) und der Sieger der Relegation (Platz 2 unten).
    assert found[1] == {reg(world, 1, 0)["squad_id"], reg(world, 1, 1)["squad_id"], reg(world, 2, 0)["squad_id"], lower}
    # Liga 2: der Absteiger (Platz 4 oben), der Verlierer der Relegation (Platz 3 oben) und die übrigen von unten.
    assert found[2] == {reg(world, 1, 3)["squad_id"], upper, reg(world, 2, 2)["squad_id"], reg(world, 2, 3)["squad_id"]}
    teams = {team["squad_id"]: team for row in preview["divisions"] for team in row["teams"]}
    assert teams[lower]["via"] == "relegation" and teams[lower]["movement"] == "up"
    assert teams[upper]["via"] == "relegation" and teams[upper]["movement"] == "down"
    assert "via" not in teams[reg(world, 2, 0)["squad_id"]]
    created = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START, "confirm": True}))
    rows = {row["squad_id"]: row async for row in flow.db.league_applications.find({"season_id": created["season"]["id"]}, {"_id": 0})}
    assert rows[lower]["carry_over"]["division_level"] == 1 and rows[lower]["carry_over"]["via"] == "relegation"
    assert rows[upper]["carry_over"]["division_level"] == 2 and rows[upper]["carry_over"]["movement"] == "down"
    # Die Einstellung geht mit, ohne Termine - und das Ende der alten Season nicht.
    new_season = await flow.db.league_seasons.find_one({"id": created["season"]["id"]}, {"_id": 0})
    assert new_season["postseason"]["relegation"] == {"enabled": True, "best_of": None, "start_date": None}
    assert "postseason_end" not in new_season


@pytest.mark.asyncio
async def test_when_the_upper_team_wins_everybody_stays(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    tournament = await play_relegation(flow, world, lower_wins=False)
    final = await flow.db.league_final_tables.find_one({"tournament_id": tournament["id"], "active": True}, {"_id": 0})
    upper, lower = reg(world, 1, 2)["squad_id"], reg(world, 2, 1)["squad_id"]
    assert final["outcome"] == {upper: "stay", lower: "stay"}
    found = levels_of(await successor_preview(flow, world))
    assert upper in found[1] and lower in found[2]


@pytest.mark.asyncio
async def test_both_absent_twice_in_the_relegation_means_everybody_stays(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    tournament = await relegation_tournament(flow, world)
    match = (await matches_of(flow, tournament["id"]))[0]
    flow.act_as(world["lead"])
    url = f"{STAFFELN}/{tournament['id']}/matches/{match['id']}/double-no-show"
    ok(await flow.post(url, json={"note": "Beide nicht erschienen"}))
    ok(await flow.post(url, json={"note": "Wieder nicht erschienen"}))
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    final = await flow.db.league_final_tables.find_one({"tournament_id": tournament["id"], "active": True}, {"_id": 0})
    assert set(final["outcome"].values()) == {"stay"} and [row["result"] for row in final["rows"]] == ["none", "none"]


@pytest.mark.asyncio
async def test_a_corrected_relegation_is_followed_by_recompute(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    tournament = await play_relegation(flow, world, lower_wins=True)
    created = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": NEW_START, "confirm": True}))
    new_id_ = created["season"]["id"]
    upper, lower = reg(world, 1, 2)["squad_id"], reg(world, 2, 1)["squad_id"]
    # Eine zweite Person öffnet die Relegation wieder, das Ergebnis wird gedreht, neu abgeschlossen.
    flow.act_as(await flow.add_staff(name="Zweite Leitung"))
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    match = (await matches_of(flow, tournament["id"]))[0]
    home, away = sides(match)
    answer = await flow.post(f"/api/matches/{match['id']}/result?force=true", json={"reason": "Korrektur laut Protokoll", "results": [
        {"registration_id": home, "rank": 1, "score": 2}, {"registration_id": away, "rank": 2, "score": 1}]})
    assert answer.status_code == 200, answer.text
    await settle(flow, tournament["id"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    view = ok(await flow.get(f"{ADMIN}/seasons/{new_id_}/successor/recompute"))
    assert view["can_run"] and {row["squad_id"]: row["kind"] for row in view["changes"]} == {upper: "moved", lower: "moved"}
    ok(await flow.post(f"{ADMIN}/seasons/{new_id_}/successor/recompute", json={"confirm": True, "stamp": view["stamp"]}))
    rows = {row["squad_id"]: row async for row in flow.db.league_applications.find({"season_id": new_id_}, {"_id": 0})}
    assert rows[upper]["carry_over"]["division_level"] == 1 and rows[lower]["carry_over"]["division_level"] == 2
    assert rows[upper]["carry_over"]["movement"] == "stay"


@pytest.mark.asyncio
async def test_without_enabled_relegation_the_zones_stay_coloured_only(flow):
    world = await build(flow, levels=2, zones=ZONES)
    await close(flow, world)
    preview = await successor_preview(flow, world)
    assert preview["can_create"] and "vorbereitet" in preview["relegation_note"]
    found = levels_of(preview)
    # Wie vor #2404: Die Relegationsplätze bleiben in ihrer Liga.
    assert reg(world, 1, 2)["squad_id"] in found[1] and reg(world, 2, 1)["squad_id"] in found[2]
    assert all("via" not in team for row in preview["divisions"] for team in row["teams"])


# ---------------------------------------------------------------- Playoffs der unteren Liga ändern keine Liga

@pytest.mark.asyncio
async def test_playoffs_never_move_a_team_and_never_count_as_another_staffel(flow):
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await close(flow, world)
    # Solange die Playoffs fehlen, gibt es keine neue Season - die Verteilung der Teams steht trotzdem schon in der Vorschau.
    waiting = await successor_preview(flow, world)
    assert not waiting["can_create"] and any("Playoffs" in text for text in waiting["problems"])
    before = levels_of(waiting)
    for level in (1, 2):
        ok(await create(flow, world, "playoffs", level))
        tournament = await flow.db.tournaments.find_one(
            {"league_context.division_id": world["divisions"][level]["id"], "league_context.kind": "playoff"}, {"_id": 0})
        for _round in range(3):
            if not await play_round(flow, world, tournament["id"], favourite=False):
                break
        await settle(flow, tournament["id"])
        flow.act_as(world["lead"])
        ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    preview = await successor_preview(flow, world)
    # Wer auf- und absteigt, sagt die Tabelle - der Playoff-Sieger der unteren Liga steigt nicht deshalb auf (Nr. 170).
    assert preview["can_create"] and levels_of(preview) == before
    assert all(row["capacity"]["staffeln_before"] == 1 for row in preview["divisions"])
    # Historie, Gesamtwertung und Profil lesen nur Tabellen-Endstände (``kind`` fehlt) - die Playoff-Fassungen stehen daneben.
    query = {"season_id": world["season"]["id"], "active": True}
    assert await flow.db.league_final_tables.count_documents(query) == 4
    assert await flow.db.league_final_tables.count_documents({**query, "kind": None}) == 2
    from services import league_history, league_rank_banner

    team = reg(world, 1, 0)["team_id"]
    assert len(await league_history.for_team(flow.db, team, world["lead"])) == 1
    assert len(await league_rank_banner._staffeln(flow.db, world["season"]["id"])) == 2


# ---------------------------------------------------------------- Sperren über alle Pflichtspiele (Nr. 223)

@pytest.mark.asyncio
async def test_a_ban_for_two_games_counts_the_relegation_game(flow):
    from services import league_sanction_bans as bans

    world = await build(flow, levels=2, zones=ZONES, postseason=RELEGATION)
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    tournament = await relegation_tournament(flow, world)
    origin = reg(world, 1, 2)
    start = (now_utc() - timedelta(days=30)).isoformat()
    row = {"id": "ban-1", "kind": sorted(bans.BAN_KINDS)[0], "matches": 2, "registration_id": origin["id"], "season_id": world["season"]["id"],
           "starts_at": start}
    # Vor der Relegation: Kein Spiel der regulären Staffel liegt nach dem Beginn der Sperre.
    frame = await bans.frame_for(flow.db, [row])
    assert bans.covered_matches(row, frame) == []
    await play_round(flow, world, tournament["id"])
    played = (await matches_of(flow, tournament["id"]))[0]
    frame = await bans.frame_for(flow.db, [row])
    # Das Relegationsspiel zählt - obwohl das Co-Team dort eine eigene Anmeldung hat.
    assert bans.covered_matches(row, frame) == [played["id"]]
