"""Playoffs aus dem Endstand (#2404, docs/LIGA.md „F.6 Playoffs und Relegation“; Entscheidungen Nr. 203-232) - über die echten Routen.

Einstellungen, Vorschau der Setzung, Anlegen unter der Season-Sperre, der K.-o.-Baum aus dem Turnierkern mit Freilosen, Heimrecht des
besser Gesetzten, Rückzug während der Playoffs, „beide nicht erschienen“, Abschluss mit Meister aus den Playoffs, Wiederöffnen und die
Gegenproben: Ohne Einstellung bleibt alles wie vorher. Nur erfundene Namen.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_postseason_world import (  # noqa: E402
    STAFFELN, build, close, cockpit, create, division_of, matches_of, names_of, play_round, settle, sides, win,
)
from league_start_world import ADMIN, ok  # noqa: E402

PLAYOFFS_4 = {"playoffs": {"enabled": True, "per_staffel": 4}}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def playoff_tournament(flow, world: dict, level: int = 1) -> dict:
    return await flow.db.tournaments.find_one({"league_context.division_id": world["divisions"][level]["id"], "league_context.kind": "playoff"}, {"_id": 0})


async def seeded(flow, tid: str) -> dict[int, str]:
    """Setzplatz → Name in der Playoff-Staffel."""
    return {row["seed"]: row["display_name"] async for row in flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0})}


def pairs(matches: list[dict], names: dict[str, str], round_number: int = 1) -> list[tuple]:
    return [tuple(names[side] for side in sides(match)) for match in matches if match.get("round") == round_number and not match.get("section", "").upper().startswith("BR")]


# ---------------------------------------------------------------- Vorschau und Anlegen

@pytest.mark.asyncio
async def test_four_teams_from_the_final_table_get_their_bracket(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    view = await cockpit(flow, world)
    part = division_of(view, 1)["playoffs"]
    # Solange die reguläre Staffel offen ist, gibt es keine Setzliste - nur den Sperrgrund.
    assert part["state"] == "waiting" and [row["code"] for row in part["blockers"]] == ["regular_open"]
    assert part["seeds"] == [] and not part["can_create"]
    await close(flow, world)
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert part["state"] == "ready" and part["blockers"] == [] and part["can_create"]
    assert [row["rank"] for row in part["seeds"]] == [1, 2, 3, 4] and part["byes"] == 0
    assert [(pair["a"]["seed"], pair["b"]["seed"]) for pair in part["pairings"]] == [(1, 4), (2, 3)]
    assert [row["label"] for row in part["rounds"]] == ["Halbfinale", "Finale"]
    answer = ok(await create(flow, world, "playoffs"))
    assert not answer["replay"]
    tournament = await playoff_tournament(flow, world)
    assert tournament["id"] == answer["tournament"]["tournament_id"]
    assert tournament["format"] == "single_elim" and tournament["status"] == "live" and tournament["seeding_mode"] == "manual"
    assert tournament["league_context"]["staffel"] == "PO" and tournament["league_context"]["kind"] == "playoff"
    assert tournament["title"].endswith("Playoffs") and tournament["best_of"] == 3
    names = await names_of(flow, tournament["id"])
    matches = await matches_of(flow, tournament["id"])
    order = await seeded(flow, tournament["id"])
    assert pairs(matches, names) == [(order[1], order[4]), (order[2], order[3])]
    assert [match["round_name"] for match in matches] == ["Halbfinale", "Halbfinale", "Finale"]
    # Die Anmeldungen tragen Setzplatz und Herkunft, aber keinen Season-Schlüssel (H1): Das Co-Team spielt ja schon in seiner Staffel.
    regs = await flow.db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(None)
    assert all("league_squad_key" not in row and row["postseason"]["from_staffel"] == "A" for row in regs)
    assert sorted(row["postseason"]["rank"] for row in regs) == [1, 2, 3, 4]
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert part["state"] == "created" and not part["can_create"] and not part["stale"]
    assert part["staffel"]["matches"] == {"total": 2, "decided": 0}


@pytest.mark.asyncio
async def test_a_second_create_finds_the_existing_staffel(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    first = ok(await create(flow, world, "playoffs"))
    flow.act_as(world["lead"])
    again = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/postseason/playoffs",
                               json={"division_id": world["divisions"][1]["id"], "stamp": "egal", "confirm": True}))
    assert again["replay"] and again["tournament"]["tournament_id"] == first["tournament"]["tournament_id"]
    assert await flow.db.tournaments.count_documents({"league_context.kind": "playoff"}) == 1


@pytest.mark.asyncio
async def test_two_clicks_at_once_create_one_staffel(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    flow.act_as(world["lead"])
    body = {"division_id": world["divisions"][1]["id"], "stamp": part["stamp"], "confirm": True}
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason/playoffs"
    answers = await asyncio.gather(flow.post(url, json=body), flow.post(url, json=body))
    assert sorted(answer.status_code for answer in answers) in ([200, 200], [200, 409])
    assert await flow.db.tournaments.count_documents({"league_context.kind": "playoff"}) == 1
    tournament = await playoff_tournament(flow, world)
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == 4
    assert len(await matches_of(flow, tournament["id"])) == 3


@pytest.mark.asyncio
async def test_create_needs_confirmation_the_current_stamp_and_enabled_playoffs(flow):
    world = await build(flow, levels=2, postseason=PLAYOFFS_4, division_postseason={2: {"playoffs": {"enabled": False}}})
    await close(flow, world)
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason/playoffs"
    division = world["divisions"][1]["id"]
    flow.act_as(world["lead"])
    unconfirmed = await flow.post(url, json={"division_id": division, "stamp": "x"})
    assert unconfirmed.status_code == 422 and "bestätigen" in unconfirmed.json()["detail"]
    stale = await flow.post(url, json={"division_id": division, "stamp": "veraltet", "confirm": True})
    assert stale.status_code == 409 and "neu laden" in stale.json()["detail"]
    off = await flow.post(url, json={"division_id": world["divisions"][2]["id"], "stamp": "x", "confirm": True})
    assert off.status_code == 409 and "keine Playoffs" in off.json()["detail"]
    assert await flow.db.tournaments.count_documents({"league_context.kind": "playoff"}) == 0
    view = await cockpit(flow, world)
    assert division_of(view, 2)["playoffs"] is None and division_of(view, 1)["playoffs"]["state"] == "ready"


# ---------------------------------------------------------------- 6, 8 und 12 Teilnehmer, Freilose, Setzung über Kreuz

@pytest.mark.asyncio
async def test_six_teams_from_two_staffeln_cross_and_the_best_two_get_a_bye(flow):
    world = await build(flow, staffeln={1: [4, 4]}, postseason={"playoffs": {"enabled": True, "per_staffel": 3}})
    await close(flow, world)
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    # Beide Staffelsieger stehen gleich (gleiche Punkte und Maps je Spiel): Die Vorschau lost nicht, sie nennt die Gleichen (Nr. 225).
    assert len(part["seeds"]) == 6 and part["byes"] == 2
    assert len(part["open_lot"]) == 1 and len(part["open_lot"][0]) == 2
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    record = tournament["postseason"]
    # Das Los fiel beim Anlegen, einmal, und steht im Schnappschuss - nicht öffentlich.
    assert record["draw_count"] == 1 and len(record["draws"]) == 1 and len(record["draws"][0]["order"]) == 2
    # Angelegt heißt gelost: Das Cockpit nennt keine offene Gruppe mehr, die Setzliste zeigt das Los als Grund.
    created = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert created["open_lot"] == [] and created["seeds"][1]["tie"] == "lot"
    seeds = record["seeds"]
    assert [row["rank"] for row in seeds] == [1, 1, 2, 2, 3, 3]
    first, second = seeds[0]["from_staffel"], seeds[1]["from_staffel"]
    assert {first, second} == {"A", "B"}
    # Die Reihenfolge der Staffeln gilt für jede Platzgruppe (Nr. 221).
    assert [row["from_staffel"] for row in seeds] == [first, second] * 3
    assert seeds[1]["tie"] == "lot"
    matches = await matches_of(flow, tournament["id"])
    origin = {row["registration_id"]: row["from_staffel"] for row in seeds}
    opening = [match for match in matches if match["round"] == 1]
    played = [match for match in opening if len(sides(match)) == 2]
    byes = [match for match in opening if len(sides(match)) == 1]
    assert len(played) == 2 and len(byes) == 2
    # Freilos für die beiden Bestgesetzten - sie stehen schon im Halbfinale.
    by_seed = {row["seed"]: row["registration_id"] for row in seeds}
    assert {sides(match)[0] for match in byes} == {by_seed[1], by_seed[2]}
    assert all(match["status"] == "completed" and match["result_meta"]["source"] == "auto_bye" for match in byes)
    semis = [match for match in matches if match["round"] == 2]
    assert sorted(len(sides(match)) for match in semis) == [1, 1]
    # Über Kreuz: keine Paarung der ersten Runde aus derselben Staffel.
    assert all(origin[sides(match)[0]] != origin[sides(match)[1]] for match in played)
    assert [match["round_name"] for match in matches] == ["Viertelfinale"] * 4 + ["Halbfinale"] * 2 + ["Finale"]


@pytest.mark.asyncio
async def test_eight_teams_fill_the_bracket_without_a_bye(flow):
    world = await build(flow, staffeln={1: [4, 4]}, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "third_place": True}})
    await close(flow, world)
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert len(part["seeds"]) == 8 and part["byes"] == 0 and [row["label"] for row in part["rounds"]] == ["Viertelfinale", "Halbfinale", "Finale"]
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    matches = await matches_of(flow, tournament["id"])
    assert tournament["bronze_match"] is True
    assert sorted(match["round_name"] for match in matches) == sorted(["Viertelfinale"] * 4 + ["Halbfinale"] * 2 + ["Finale", "Spiel um Platz 3"])
    origin = {row["registration_id"]: row["from_staffel"] for row in tournament["postseason"]["seeds"]}
    assert all(len(sides(match)) == 2 and origin[sides(match)[0]] != origin[sides(match)[1]] for match in matches if match["round"] == 1)


@pytest.mark.asyncio
async def test_twelve_teams_from_three_staffeln_never_meet_their_own_staffel_first(flow):
    world = await build(flow, staffeln={1: [4, 4, 4]}, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await close(flow, world)
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert len(part["seeds"]) == 12 and part["byes"] == 4
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    record = tournament["postseason"]
    origin = {row["registration_id"]: row["from_staffel"] for row in record["seeds"]}
    matches = await matches_of(flow, tournament["id"])
    opening = [match for match in matches if match["round"] == 1 and len(sides(match)) == 2]
    assert len(opening) == 4 and all(origin[sides(match)[0]] != origin[sides(match)[1]] for match in opening)
    assert record["swaps"] >= 1
    # Die vier Bestgesetzten haben das Freilos.
    waiting = {sides(match)[0] for match in matches if match["round"] == 1 and len(sides(match)) == 1}
    assert waiting == {row["registration_id"] for row in record["seeds"][:4]}
    assert len([match for match in matches if match["round"] == 4]) == 1


@pytest.mark.asyncio
async def test_an_exited_team_never_qualifies_and_the_next_one_moves_up(flow):
    world = await build(flow, staffeln={1: [5]}, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    tid = world["tids"][1][0]
    regs = world["regs"][tid]
    await flow.db.tournament_registrations.update_one({"id": regs[1]["id"]}, {"$set": {"status": "withdrawn", "removal": {"at": "2030-01-01T00:00:00+00:00", "mode": "forfeit"}}})
    await close(flow, world)
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert [row["display_name"] for row in part["seeds"]] == [regs[index]["display_name"] for index in (0, 2, 3, 4)]
    final = await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0})
    assert final["postseason"] == {"per_staffel": 4}
    assert [bool(row.get("playoff")) for row in final["rows"]] == [True, True, True, True, False]


# ---------------------------------------------------------------- Ablauf: Heimrecht, Best of je Runde, Spielwochen

@pytest.mark.asyncio
async def test_the_better_seed_is_home_in_every_round_and_rounds_are_weeks(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3,
                                                       "best_of_rounds": [{"round": 2, "best_of": 5}]}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    from services.matchday_schedule import home_registration_id, plays_in_matchdays, tournament_matchday_window

    assert plays_in_matchdays(tournament)
    # Runde 1 beginnt am Tag nach der letzten regulären Spielwoche, Runde 2 eine Woche später.
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert tournament_matchday_window(tournament, 1).start.date().isoformat() <= part["rounds"][0]["start_day"]
    assert part["rounds"][1]["start_day"] > part["rounds"][0]["end_day"] and part["rounds"][1]["best_of"] == 5
    seeds = {row["id"]: row["seed"] async for row in flow.db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0})}
    # Die Außenseiter gewinnen: Setzplatz 4 und 3 stehen im Finale - Heim ist dort Setzplatz 3, obwohl er aus dem unteren Halbfinale kommt.
    await play_round(flow, world, tournament["id"], favourite=False)
    final = next(match for match in await matches_of(flow, tournament["id"]) if match["round"] == 2)
    assert sorted(seeds[side] for side in sides(final)) == [3, 4]
    assert seeds[sides(final)[0]] == 4 and seeds[home_registration_id(final)] == 3
    assert final["best_of"] == 5 and final["postseason"]["home"] == "better_seed"
    semis = [match for match in await matches_of(flow, tournament["id"]) if match["round"] == 1]
    assert all("best_of" not in match for match in semis)


@pytest.mark.asyncio
async def test_playoff_round_one_does_not_collide_with_matchday_one_lineups(flow):
    from services import league_games

    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    regular = world["tids"][1][0]
    match = next(row for row in await matches_of(flow, tournament["id"]) if row["round"] == 1)
    home = sides(match)[0]
    registration = await flow.db.tournament_registrations.find_one({"id": home}, {"_id": 0})
    squad = await flow.db.team_squads.find_one({"id": registration["squad_id"]}, {"_id": 0})
    person = squad["member_ids"][0]
    origin = registration["postseason"]["from_registration_id"]
    # Die Person stand an Spieltag 1 der regulären Staffel in der Aufstellung ihres Teams.
    first = next(row for row in await matches_of(flow, regular) if row["round"] == 1 and origin in sides(row))
    await flow.db.matches_v2.update_one({"id": first["id"]}, {"$set": {"lineup_user_ids": [person], "games": [{"lineups": {origin: [person]}}]}})
    setup = league_games.LeagueSetup.__new__(league_games.LeagueSetup)
    setup.tournament, setup.match = tournament, match
    # H2: Die Runde 1 der Playoffs ist nicht der Spieltag 1 - kein Doppel-Einsatz.
    await league_games.check_double_use(flow.db, setup, [{"lineups": {home: [person]}}], {home})


# ---------------------------------------------------------------- Abschluss und Meister

async def play_out(flow, world: dict, tid: str, **kwargs) -> None:
    for _round in range(6):
        if not await play_round(flow, world, tid, **kwargs):
            break
    await settle(flow, tid)


@pytest.mark.asyncio
async def test_the_playoff_final_decides_the_champion_when_the_season_says_so(flow):
    world = await build(flow, staffeln={1: [4, 4]}, postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"})
    await close(flow, world)
    # „Meister aus Playoffs“: Platz 1 der Staffel ist Staffelsieger, nicht Meister - kein Meister-Eintrag aus der Tabelle.
    finals = await flow.db.league_final_tables.find({"season_id": world["season"]["id"], "active": True}, {"_id": 0}).to_list(None)
    assert all(row["champion_place"] is False and row["champion"] is None for row in finals)
    assert all(row["postseason"] == {"per_staffel": 2, "champion_source": "playoffs"} for row in finals)
    assert await flow.db.tournament_awards.count_documents({"reward_key": None}) == 0
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert season["status"] != "completed"  # die Playoffs fehlen noch
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    await play_out(flow, world, tournament["id"])
    flow.act_as(world["lead"])
    closing = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/closing"))
    row = next(item for item in closing["staffeln"] if item["tournament_id"] == tournament["id"])
    assert row["kind"] == "playoff" and row["label"] == "Playoffs" and row["champion_place"] and row["can_close"] and row["blockers"] == []
    assert [item["rank"] for item in row["standings"]] == [1, 2, 3, 3]
    closed = ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    final = await flow.db.league_final_tables.find_one({"tournament_id": tournament["id"], "active": True}, {"_id": 0})
    order = await seeded(flow, tournament["id"])
    assert final["kind"] == "playoff" and final["champion"]["display_name"] == order[1] == closed["champion"]
    assert final["zones"] == {} and final["promotion"] == {} and final["final_match_id"]
    assert [(row["rank"], row["reached"]) for row in final["rows"]] == [(1, "Finale"), (2, "Finale"), (3, "Halbfinale"), (3, "Halbfinale")]
    awards = await flow.db.tournament_awards.find({"reward_key": None}, {"_id": 0}).to_list(None)
    # Genau ein Meister - der Sieger des Finales, ohne Staffel.
    assert len(awards) == 1 and awards[0]["tournament_id"] == tournament["id"] and awards[0]["league"]["staffel"] is None
    assert awards[0]["league"]["title"] == "Meister" and awards[0]["final_match_id"] == final["final_match_id"]
    assert closed["season_status"] == "completed"
    # Discord: Die Abschluss-Meldung der Season nennt den Meister aus den Playoffs - kein Tabellen-Endstand trägt ihn.
    from services import league_discord

    assert await league_discord.playoff_champions(flow.db, world["season"]["id"]) == [{"name": order[1], "staffel": None}]
    # Die öffentliche Rangliste der Playoff-Staffel liest den Endstand.
    table = ok(await flow.get(f"/api/tournaments/{tournament['id']}/standings"))
    assert [item["rank"] for item in table] == [1, 2, 3, 3]


@pytest.mark.asyncio
async def test_without_champion_from_playoffs_the_table_still_names_the_champion(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    final = await flow.db.league_final_tables.find_one({"tournament_id": world["tids"][1][0], "active": True}, {"_id": 0})
    assert final["champion_place"] is True and final["champion"]["display_name"] == world["regs"][world["tids"][1][0]][0]["display_name"]
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    await play_out(flow, world, tournament["id"], favourite=False)
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    playoff = await flow.db.league_final_tables.find_one({"tournament_id": tournament["id"], "active": True}, {"_id": 0})
    # Der Playoff-Sieger steht im Endstand, Meister bleibt der Erste der Tabelle - nie zwei Meister.
    assert playoff["champion_place"] is False and playoff["champion"] is None and playoff["winner"]["display_name"]
    from services import league_discord

    assert await league_discord.playoff_champions(flow.db, world["season"]["id"]) == []
    awards = await flow.db.tournament_awards.find({"reward_key": None, "suspended": {"$ne": True}}, {"_id": 0}).to_list(None)
    assert [row["tournament_id"] for row in awards] == [world["tids"][1][0]]


@pytest.mark.asyncio
async def test_third_place_is_shared_without_the_extra_game_and_played_with_it(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "third_place": True}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    await play_out(flow, world, tournament["id"])
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    final = await flow.db.league_final_tables.find_one({"tournament_id": tournament["id"], "active": True}, {"_id": 0})
    order = await seeded(flow, tournament["id"])
    assert [(row["rank"], row["display_name"]) for row in final["rows"]] == [(1, order[1]), (2, order[2]), (3, order[3]), (4, order[4])]


# ---------------------------------------------------------------- Rückzug und Nichtantritt

async def remove(flow, world: dict, tid: str, registration_id: str, kind: str = "withdrawn"):
    flow.act_as(world["lead"])
    url = f"/api/tournaments/{tid}/registrations/{registration_id}/removal"
    proposal = ok(await flow.post(url, json={"kind": kind, "reason": "Team hat sich zurückgezogen"}))
    return ok(await flow.post(url, json={"kind": kind, "reason": "Team hat sich zurückgezogen", "plan_id": proposal["plan"]["id"]}))


@pytest.mark.asyncio
async def test_a_team_that_withdraws_during_the_playoffs_gives_a_walkover(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    tid = tournament["id"]
    await play_round(flow, world, tid)  # Halbfinale gespielt: Setzplatz 1 und 2 stehen im Finale
    final = next(match for match in await matches_of(flow, tid) if match["round"] == 2)
    seeds = {row["id"]: row["seed"] async for row in flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0})}
    leaver = next(side for side in sides(final) if seeds[side] == 1)
    stayer = next(side for side in sides(final) if seeds[side] == 2)
    await remove(flow, world, tid, leaver)
    final = next(match for match in await matches_of(flow, tid) if match["round"] == 2)
    # Der Gegner kommt kampflos weiter (Nr. 217) - über den vorhandenen Weg des Ausscheidens im Baum.
    assert final["status"] == "completed" and final["results"][0]["registration_id"] == stayer
    # Gespielt ist gespielt: Die Setzliste lässt sich nicht mehr neu berechnen.
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert not part["can_reseed"] and "schon ein Spiel gespielt" in part["reseed_refusal"]
    await settle(flow, tid)
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    rows = (await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0}))["rows"]
    by_id = {row["registration_id"]: row for row in rows}
    assert by_id[stayer]["rank"] == 1 and by_id[leaver]["rank"] == 2 and by_id[leaver]["exit"] == {"kind": "withdrawn"}
    # Der reguläre Endstand bleibt, wie er war: Playoffs schreiben nie in ihn zurück.
    regular = await flow.db.league_final_tables.find_one({"tournament_id": world["tids"][1][0], "active": True}, {"_id": 0})
    assert regular["version"] == 1 and all(not row.get("exit") for row in regular["rows"])


@pytest.mark.asyncio
async def test_a_team_gone_before_the_first_game_is_replaced_by_the_next_of_its_staffel(flow):
    world = await build(flow, staffeln={1: [5]}, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    tid = tournament["id"]
    before = await seeded(flow, tid)
    gone = await flow.db.tournament_registrations.find_one({"tournament_id": tid, "seed": 2}, {"_id": 0})
    await remove(flow, world, tid, gone["id"])
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    # Ein kampfloses Weiterkommen ist kein gespieltes Spiel: Nachrücken geht noch - die Vorschau zeigt die neue Setzliste.
    assert part["stale"] and part["can_reseed"]
    regs = world["regs"][world["tids"][1][0]]
    assert [row["display_name"] for row in part["next_seeds"]] == [regs[index]["display_name"] for index in (0, 2, 3, 4)]
    flow.act_as(world["lead"])
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason/{tid}/reseed"
    missing_reason = await flow.post(url, json={"stamp": part["stamp"], "confirm": True})
    assert missing_reason.status_code == 422 and "Grund" in missing_reason.json()["detail"]
    ok(await flow.post(url, json={"stamp": part["stamp"], "confirm": True, "reason": "Team zurückgezogen, Nachrücker"}))
    after = await seeded(flow, tid)
    # Der Nächste derselben Staffel rückt nach; Setzplatz 1 bleibt, wo er war.
    assert after[1] == before[1] and after[2] == before[3] and after[3] == before[4] and after[4] == regs[4]["display_name"]
    matches = await matches_of(flow, tid)
    assert len(matches) == 3 and all(match["status"] != "completed" for match in matches)
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tid}) == 4
    log = await flow.db.audit_logs.find_one({"action": "league.postseason.reseed"}, {"_id": 0})
    assert log["data"]["reason"] == "Team zurückgezogen, Nachrücker" and log["data"]["redrawn"] == 0


@pytest.mark.asyncio
async def test_both_absent_get_one_new_date_and_are_both_out_the_second_time(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    tid = tournament["id"]
    first, second = [match for match in await matches_of(flow, tid) if match["round"] == 1]
    flow.act_as(world["lead"])
    url = f"{STAFFELN}/{tid}/matches/{first['id']}/double-no-show"
    answer = ok(await flow.post(url, json={"note": "Beide nicht erschienen"}))
    stored = await flow.reload(first)
    # Beim ersten Mal: einmal neu ansetzen - nichts gewertet, beide noch im Baum.
    assert answer["no_show_step"] == "retry" and stored["no_show_retry"]["by"] == world["lead"]["id"]
    assert stored["status"] != "forfeit" and len(sides(stored)) == 2 and not stored.get("double_forfeit")
    ok(await flow.post(url, json={"note": "Wieder nicht erschienen"}))
    stored = await flow.reload(first)
    assert stored["status"] == "cancelled" and stored["double_forfeit"] and len(stored["double_forfeit_sides"]) == 2 and sides(stored) == []
    # Der Sieger des anderen Halbfinales kommt im Finale kampflos weiter.
    seeds = {row["id"]: row["seed"] async for row in flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0})}
    winner = min(sides(second), key=lambda side: seeds[side])
    await win(flow, second, winner)
    final = next(match for match in await matches_of(flow, tid) if match["round"] == 2)
    assert final["status"] == "completed" and final["results"][0]["registration_id"] == winner
    await settle(flow, tid)
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    rows = (await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0}))["rows"]
    assert [row["rank"] for row in rows] == [1, 3, 3, 3]
    assert {row["registration_id"] for row in rows if row["reached"] == "Halbfinale"} == set(first and stored["double_forfeit_sides"]) | {
        side for side in sides(second) if side != winner}


@pytest.mark.asyncio
async def test_both_absent_in_the_final_leave_the_title_open(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    tid = tournament["id"]
    final = (await matches_of(flow, tid))[0]
    flow.act_as(world["lead"])
    url = f"{STAFFELN}/{tid}/matches/{final['id']}/double-no-show"
    ok(await flow.post(url, json={"note": "Beide nicht erschienen"}))
    ok(await flow.post(url, json={"note": "Wieder nicht erschienen"}))
    closed = ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    stored = await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0})
    # Der Titel bleibt unvergeben: kein Platz 1 und 2, kein Meister - und das sperrt den Abschluss nicht.
    assert closed["champion"] is None and stored["champion"] is None and [row["rank"] for row in stored["rows"]] == [0, 0]
    assert await flow.db.tournament_awards.count_documents({"reward_key": None}) == 0


# ---------------------------------------------------------------- Wiederöffnen

async def second_lead(flow) -> dict:
    return await flow.add_staff(name="Zweite Leitung")


@pytest.mark.asyncio
async def test_reopening_a_playoff_staffel_follows_the_existing_rules_and_never_makes_two_champions(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    tid = tournament["id"]
    await play_out(flow, world, tid)
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    first = (await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0}))["champion"]["registration_id"]
    # Wieder öffnet eine zweite Person, mit Grund (Nr. 155) - wie bei jeder Staffel.
    own = await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht"})
    assert own.status_code == 403
    other = await second_lead(flow)
    flow.act_as(other)
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht"}))
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert season["status"] == "active"
    assert await flow.db.tournament_awards.count_documents({"reward_key": None, "suspended": {"$ne": True}}) == 0
    final = (await matches_of(flow, tid))[0]
    loser = next(side for side in sides(final) if side != first)
    answer = await flow.post(f"/api/matches/{final['id']}/result?force=true", json={"reason": "Korrektur laut Protokoll", "results": [
        {"registration_id": loser, "rank": 1, "score": 2}, {"registration_id": first, "rank": 2, "score": 1}]})
    assert answer.status_code == 200, answer.text
    await settle(flow, tid)
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    awards = await flow.db.tournament_awards.find({"reward_key": None, "suspended": {"$ne": True}}, {"_id": 0}).to_list(None)
    assert [row["registration_id"] for row in awards] == [loser]
    versions = await flow.db.league_final_tables.find({"tournament_id": tid}, {"_id": 0, "version": 1, "active": 1}).sort("version", 1).to_list(None)
    assert versions == [{"version": 1, "active": False}, {"version": 2, "active": True}]


@pytest.mark.asyncio
async def test_reopening_a_regular_staffel_keeps_the_playoff_seeding_and_says_so(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    regular = world["tids"][1][0]
    before = await seeded(flow, tournament["id"])
    flow.act_as(await second_lead(flow))
    ok(await flow.post(f"{STAFFELN}/{regular}/reopen", json={"reason": "Ergebnis von Spieltag 2 war vertauscht"}))
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    # Der reguläre Endstand ist offen: keine neue Setzliste, die Playoffs laufen mit ihrer weiter.
    assert part["state"] == "created" and [row["code"] for row in part["blockers"]] == ["regular_open"] and not part["can_reseed"]
    assert await seeded(flow, tournament["id"]) == before
    # Korrektur: Platz 1 und 2 tauschen. Nach dem neuen Abschluss weicht die Setzliste ab - das Cockpit sagt es und bietet das Neuberechnen an.
    regs = world["regs"][regular]
    duel = next(match for match in await matches_of(flow, regular) if set(sides(match)) == {regs[0]["id"], regs[1]["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"results": [
        {"registration_id": regs[1]["id"], "rank": 1, "score": 2}, {"registration_id": regs[0]["id"], "rank": 2, "score": 0}]}})
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{regular}/close", json={"confirm": True}))
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert part["stale"] and part["can_reseed"] and "Setzliste" in part["stale_note"]
    assert part["next_seeds"][0]["display_name"] == regs[1]["display_name"]
    ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/postseason/{tournament['id']}/reseed",
                       json={"stamp": part["stamp"], "confirm": True, "reason": "Endstand korrigiert"}))
    after = await seeded(flow, tournament["id"])
    assert after[1] == regs[1]["display_name"] and after[2] == regs[0]["display_name"]
    assert not division_of(await cockpit(flow, world), 1)["playoffs"]["stale"]


@pytest.mark.asyncio
async def test_the_season_can_block_reopening_once_a_playoff_game_is_played(flow):
    world = await build(flow, postseason={**PLAYOFFS_4, "reopen_guard": "block"})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    regular = world["tids"][1][0]
    other = await second_lead(flow)
    await play_round(flow, world, tournament["id"])
    flow.act_as(other)
    refused = await flow.post(f"{STAFFELN}/{regular}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"})
    assert refused.status_code == 409 and "Playoffs" in refused.json()["detail"]
    assert await flow.db.league_final_tables.count_documents({"tournament_id": regular, "active": True}) == 1


# ---------------------------------------------------------------- Gegenproben: ohne Einstellung wie vorher

@pytest.mark.asyncio
async def test_a_season_without_the_setting_behaves_as_before(flow):
    world = await build(flow, levels=2)
    view = await cockpit(flow, world)
    assert not view["configured"] and view["missing"] == []
    assert all(row["playoffs"] is None and row["relegation"] is None for row in view["divisions"])
    table = ok(await flow.get(f"/api/tournaments/{world['tids'][1][0]}/standings"))
    assert all("playoff" not in row for row in table)
    await close(flow, world)
    finals = await flow.db.league_final_tables.find({"season_id": world["season"]["id"]}, {"_id": 0}).to_list(None)
    assert all("kind" not in row and "postseason" not in row and "outcome" not in row for row in finals)
    assert all("playoff" not in item for row in finals for item in row["rows"])
    top = next(row for row in finals if row["tournament_id"] == world["tids"][1][0])
    assert top["champion_place"] is True and top["champion"]
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert season["status"] == "completed" and "postseason" not in season and "postseason_end" not in season
    closing = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/closing"))
    assert closing["season"]["closed"] and "postseason_missing" not in closing
    assert all("kind" not in row and "label" not in row for row in closing["staffeln"])
    refused = await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/postseason/playoffs",
                              json={"division_id": world["divisions"][1]["id"], "stamp": "", "confirm": True})
    assert refused.status_code == 409 and await flow.db.tournaments.count_documents({"league_context.kind": {"$exists": True}}) == 0


@pytest.mark.asyncio
async def test_the_table_shows_the_playoff_places_live(flow):
    world = await build(flow, staffeln={1: [5]}, postseason={"playoffs": {"enabled": True, "per_staffel": 2}})
    table = ok(await flow.get(f"/api/tournaments/{world['tids'][1][0]}/standings"))
    assert [bool(row.get("playoff")) for row in table] == [True, True, False, False, False]


@pytest.mark.asyncio
async def test_a_tie_at_the_playoff_boundary_blocks_the_close(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 2}})
    tid = world["tids"][1][0]
    regs = world["regs"][tid]
    # Platz 2 und 3 stehen in allem gleich: Ihr direktes Spiel ist abgesagt, beide verlieren gegen den Ersten und schlagen den Letzten.
    duel = next(match for match in await matches_of(flow, tid) if set(sides(match)) == {regs[1]["id"], regs[2]["id"]})
    await flow.db.matches_v2.update_one({"id": duel["id"]}, {"$set": {"status": "cancelled"}, "$unset": {"results": ""}})
    flow.act_as(world["lead"])
    refused = await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True})
    assert refused.status_code == 409 and "Playoff-Grenze" in refused.json()["detail"]
    closing = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/closing"))
    row = closing["staffeln"][0]
    assert any(blocker["code"] == "playoff_tie" for blocker in row["blockers"])
    assert [tie["kind"] for tie in row["ties"]] == ["playoff"]


# ---------------------------------------------------------------- Flächen: Verwaltung, Ligaseite, Zuteilen

@pytest.mark.asyncio
async def test_season_views_list_the_playoff_staffel_apart_from_the_tables(flow):
    world = await build(flow, postseason=PLAYOFFS_4, season={"visibility": "public", "status": "active"})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    flow.act_as(world["lead"])
    admin = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}"))
    division = admin["divisions"][0]
    # Die Staffeln einer Liga sind die Tabellen - Playoffs und Relegation stehen daneben, mit Art und fertigem Wort.
    assert [row["staffel"] for row in division["staffeln"]] == ["A"]
    assert division["postseason"] == [{**division["postseason"][0], "tournament_id": tournament["id"], "kind": "playoff", "label": "Playoffs", "staffel": "PO"}]
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    league = world["league"]
    public = ok(await flow.get(f"/api/leagues/{league['slug']}/{season['slug']}"))
    shown = public["divisions"][0]
    assert [row["staffel"] for row in shown["staffeln"]] == ["A"]
    assert [(row["kind"], row["label"], row["closed"]) for row in shown["postseason"]] == [("playoff", "Playoffs", False)]
    # Der Baum kommt über die Turnier-Antwort der Playoff-Staffel - dieselbe wie bei jedem K.-o.-Turnier.
    bracket = ok(await flow.get(f"/api/tournaments/{tournament['id']}/bracket"))
    assert len(bracket["matches_v2"]) == 3
    # Die Spiele tragen die Art: Die Matchseite weiß so, dass „beide nicht erschienen“ hier anders wirkt.
    assert all(match["postseason"]["kind"] == "playoff" for match in await matches_of(flow, tournament["id"]))


@pytest.mark.asyncio
async def test_a_hidden_season_shows_no_playoffs_to_the_public(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    # Die Season ist nur für die Verwaltung sichtbar: Gäste sehen weder die Ligaseite noch die Playoff-Staffel als Turnier.
    flow.act_as(None)
    assert (await flow.get(f"/api/leagues/{world['league']['slug']}/{season['slug']}")).status_code == 404
    tournament = await playoff_tournament(flow, world)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).status_code in (403, 404)
    stranger = await flow.add_user(name="Gast mit Konto")
    flow.act_as(stranger)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/bracket")).status_code in (403, 404)


@pytest.mark.asyncio
async def test_nobody_is_assigned_to_a_playoff_staffel_by_hand(flow):
    world = await build(flow, staffeln={1: [5]}, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tournament = await playoff_tournament(flow, world)
    left_out = world["regs"][world["tids"][1][0]][4]
    flow.act_as(world["lead"])
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/squad-registrations", json={"team_id": left_out["team_id"], "squad_id": left_out["squad_id"]})
    assert refused.status_code == 409 and "aus dem Endstand" in refused.json()["detail"]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == 4
