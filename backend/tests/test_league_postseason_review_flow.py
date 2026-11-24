"""Playoffs und Relegation: Befunde der unabhängigen Prüfung und Fabians Entscheidungen Nr. 245-249 (#2404, docs/LIGA.md „F.6“).

Nachrücken bleibt auch nach einem zweiten Neuberechnen bestehen, eine Liga mit weniger als zwei Playoff-Teams hält die Season nicht
offen, der erste doppelte Nichtantritt zählt und lässt sich zurücknehmen, die Relegation liegt hinter den Playoffs beider Ligen, Best of,
Platz 3 und Heimrecht stehen ab dem Season-Start fest. Über die echten Routen, nur erfundene Namen.
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

PLAYOFFS_4 = {"playoffs": {"enabled": True, "per_staffel": 4}}
ZONES = {1: {"relegate": 1, "playoff_relegate": 1}, 2: {"promote": 1, "playoff_promote": 1}}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def tournament_of(flow, world: dict, kind: str, level: int = 1) -> dict:
    return await flow.db.tournaments.find_one({"league_context.division_id": world["divisions"][level]["id"], "league_context.kind": kind}, {"_id": 0})


async def seeded(flow, tid: str) -> dict[int, str]:
    return {row["seed"]: row["display_name"] async for row in flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0})}


async def remove(flow, world: dict, tid: str, registration_id: str):
    flow.act_as(world["lead"])
    url = f"/api/tournaments/{tid}/registrations/{registration_id}/removal"
    proposal = ok(await flow.post(url, json={"kind": "withdrawn", "reason": "Team hat sich zurückgezogen"}))
    return ok(await flow.post(url, json={"kind": "withdrawn", "reason": "Team hat sich zurückgezogen", "plan_id": proposal["plan"]["id"]}))


async def reseed(flow, world: dict, tid: str, reason: str = "Team zurückgezogen, Nachrücker"):
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    flow.act_as(world["lead"])
    return await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/postseason/{tid}/reseed", json={"stamp": part["stamp"], "confirm": True, "reason": reason})


# ---------------------------------------------------------------- M2: Nachrücken bleibt

@pytest.mark.asyncio
async def test_a_second_reseed_keeps_the_withdrawn_team_out(flow):
    world = await build(flow, staffeln={1: [5]}, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tid = (await tournament_of(flow, world, "playoff"))["id"]
    gone = await flow.db.tournament_registrations.find_one({"tournament_id": tid, "seed": 2}, {"_id": 0})
    await remove(flow, world, tid, gone["id"])
    ok(await reseed(flow, world, tid))
    once = await seeded(flow, tid)
    assert gone["display_name"] not in once.values()
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    # Nach dem Neuberechnen ist nichts mehr offen: Die Setzliste passt zum Endstand **und** zu dem, wer ausgeschieden ist.
    assert part["stale"] is False and gone["display_name"] not in [row["display_name"] for row in part["seeds"]]
    stored = await flow.db.tournaments.find_one({"id": tid}, {"_id": 0})
    assert stored["postseason"]["gone"] == [gone["postseason"]["from_registration_id"]]
    # Ein zweites Neuberechnen setzt den Ausgeschiedenen nicht wieder ein.
    ok(await reseed(flow, world, tid, "Zur Kontrolle noch einmal"))
    twice = await seeded(flow, tid)
    assert twice == once and gone["display_name"] not in twice.values()
    assert division_of(await cockpit(flow, world), 1)["playoffs"]["stale"] is False
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tid}) == 4


# ---------------------------------------------------------------- M3: zu wenige Playoff-Teams

@pytest.mark.asyncio
async def test_a_division_with_one_playoff_team_does_not_keep_the_season_open(flow):
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 1}, "champion_source": "playoffs"})
    flow.act_as(world["lead"])
    # Beim Speichern steht der Hinweis: mit einem Platz und einer Staffel gibt es keine Playoffs.
    saved = ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/postseason",
                              json={"playoffs": {"enabled": True, "per_staffel": 1}, "champion_source": "playoffs"}))
    assert len(saved["warnings"]) == 2 and all("weniger als zwei" in text for text in saved["warnings"])
    view = await cockpit(flow, world)
    assert division_of(view, 1)["playoffs"]["too_few_hint"] and view["missing"] == []
    await close(flow, world)
    # Die Liga zählt für den Abschluss als „ohne Playoffs“: Die Season ist beendet, der Meister kommt aus der Tabelle.
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert season["status"] == "completed"
    final = await flow.db.league_final_tables.find_one({"tournament_id": world["tids"][1][0], "active": True}, {"_id": 0})
    assert final["champion_place"] is True and final["champion"]["display_name"] == world["regs"][world["tids"][1][0]][0]["display_name"]
    assert await flow.db.tournament_awards.count_documents({"reward_key": None}) == 1
    view = await cockpit(flow, world)
    part = division_of(view, 1)["playoffs"]
    assert view["missing"] == [] and [row["code"] for row in part["blockers"]] == ["too_few"] and not part["can_create"]
    closing = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/closing"))
    assert closing["season"]["closed"] and "postseason_missing" not in closing
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    assert preview["can_create"] and preview["problems"] == []


@pytest.mark.asyncio
async def test_two_staffeln_with_one_place_each_do_play(flow):
    # Gegenprobe: Zwei Staffeln mit je einem Platz ergeben ein Finale - dort bleibt der Meister bei den Playoffs.
    world = await build(flow, staffeln={1: [4, 4]}, postseason={"playoffs": {"enabled": True, "per_staffel": 1}, "champion_source": "playoffs"})
    assert not division_of(await cockpit(flow, world), 1)["playoffs"]["too_few_hint"]
    await close(flow, world)
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert season["status"] != "completed"
    finals = await flow.db.league_final_tables.find({"season_id": world["season"]["id"], "active": True}, {"_id": 0}).to_list(None)
    assert all(row["champion_place"] is False for row in finals)
    assert [row["kind"] for row in (await cockpit(flow, world))["missing"]] == ["playoff"]


# ---------------------------------------------------------------- Nr. 245: der erste doppelte Nichtantritt zählt

@pytest.mark.asyncio
async def test_the_first_double_no_show_counts_and_can_be_taken_back_with_a_reason(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tid = (await tournament_of(flow, world, "playoff"))["id"]
    match = (await matches_of(flow, tid))[0]
    flow.act_as(world["lead"])
    url = f"{STAFFELN}/{tid}/matches/{match['id']}/double-no-show"
    ok(await flow.post(url, json={"note": "Beide nicht erschienen"}))
    stored = await flow.reload(match)
    # Schon das erste Mal steht je Seite „nicht erschienen“ am Spiel - für den Strafenkatalog wie in der regulären Saison.
    assert sorted(stored["no_show_retry"]["registration_ids"]) == sorted(sides(match)) and stored["no_show_retry"]["counted"] is True
    log = await flow.db.audit_logs.find_one({"action": "league.postseason.no_show", "data.step": "retry"}, {"_id": 0})
    assert sorted(log["data"]["registration_ids"]) == sorted(sides(match))
    # Zurücknehmen geht mit Grund - danach ist das Spiel, als wäre nichts gewesen.
    bare = await flow.client.request("DELETE", url, json={"reason": ""})
    assert bare.status_code == 422
    taken = await flow.client.request("DELETE", url, json={"reason": "Server war ausgefallen"})
    assert taken.status_code == 200, taken.text
    stored = await flow.reload(match)
    assert "no_show_retry" not in stored and len(sides(stored)) == 2 and stored["status"] != "cancelled"
    undo = await flow.db.audit_logs.find_one({"action": "league.postseason.no_show", "data.step": "undo"}, {"_id": 0})
    assert undo["data"]["reason"] == "Server war ausgefallen"
    # Nach dem Zurücknehmen beginnt die Zählung neu: wieder das erste Mal, nicht gleich „beide raus“.
    again = ok(await flow.post(url, json={"note": "Beide nicht erschienen"}))
    assert again["no_show_step"] == "retry"
    ok(await flow.post(url, json={"note": "Wieder nicht erschienen"}))
    out = await flow.reload(match)
    assert out["status"] == "cancelled" and out["double_forfeit"]
    # Ausgeschieden ist endgültig: kein Zurücknehmen mehr.
    late = await flow.client.request("DELETE", url, json={"reason": "Doch noch einmal"})
    assert late.status_code == 409


# ---------------------------------------------------------------- Nr. 246: Relegation hinter den Playoffs beider Ligen

@pytest.mark.asyncio
async def test_relegation_lies_behind_the_playoffs_of_the_upper_division_too(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason={"playoffs": {"enabled": True, "per_staffel": 4}, "relegation": {"enabled": True}},
                        division_postseason={2: {"playoffs": {"enabled": False}}})
    view = await cockpit(flow, world)
    playoffs, relegation = division_of(view, 1)["playoffs"], division_of(view, 1)["relegation"]
    # Liga 2 hat keine Playoffs - trotzdem liegt die Relegation hinter den Playoffs von Liga 1: nie zwei Spiele in einer Woche.
    assert relegation["start_day"] > playoffs["end_day"] and relegation["after_playoffs_of"] == "Liga 1"
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    ok(await create(flow, world, "playoffs"))
    upper, rel = await tournament_of(flow, world, "playoff"), await tournament_of(flow, world, "relegation")
    assert rel["start_date"] > upper["end_date"]


@pytest.mark.asyncio
async def test_relegation_names_both_divisions_when_both_play_playoffs(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason={"playoffs": {"enabled": True, "per_staffel": 4}, "relegation": {"enabled": True}},
                        division_postseason={2: {"playoffs": {"enabled": True, "per_staffel": 2}}})
    view = await cockpit(flow, world)
    relegation = division_of(view, 1)["relegation"]
    assert relegation["after_playoffs_of"] == "Liga 1 und Liga 2"
    assert relegation["start_day"] > max(division_of(view, 1)["playoffs"]["end_day"], division_of(view, 2)["playoffs"]["end_day"])


# ---------------------------------------------------------------- Nr. 249: fest ab Season-Start

@pytest.mark.asyncio
async def test_best_of_third_place_and_home_are_fixed_once_the_season_has_started(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}})
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    flow.act_as(world["lead"])
    # Vor dem Start geht alles.
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5}}))
    assert (await cockpit(flow, world))["started"] is False
    started = (now_utc() - timedelta(days=3)).isoformat()
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"start_date": started, "status": "active"}})
    view = await cockpit(flow, world)
    assert view["started"] is True
    for body, word in (({"enabled": True, "per_staffel": 4, "best_of": 3}, "Best of"),
                       ({"enabled": True, "per_staffel": 4, "best_of": 5, "third_place": True}, "Spiel um Platz 3"),
                       ({"enabled": True, "per_staffel": 4, "best_of": 5, "home": "draw"}, "Heimrecht"),
                       ({"enabled": True, "per_staffel": 4, "best_of": 5, "best_of_rounds": [{"round": 2, "best_of": 7}]}, "Best of")):
        refused = await flow.put(url, json={"playoffs": body})
        assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"] and word in refused.json()["detail"], body
    # Auch die Abweichung einer Liga ändert sie nicht mehr.
    own = await flow.put(f"{ADMIN}/divisions/{world['divisions'][1]['id']}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 7}})
    assert own.status_code == 422 and "Season-Start" in own.json()["detail"]
    # Wiederöffnen hebt das nicht auf.
    await close(flow, world)
    flow.act_as(await flow.add_staff(name="Zweite Leitung"))
    ok(await flow.post(f"{STAFFELN}/{world['tids'][1][0]}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    flow.act_as(world["lead"])
    still = await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}})
    assert still.status_code == 422
    # Was nicht dazugehört, bleibt änderbar: der Start der Playoffs, die Relegation, die Plätze (nach dem Wiederöffnen).
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 2, "best_of": 5}, "reopen_guard": "block"}))
    stored = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    assert stored["postseason"]["playoffs"]["best_of"] == 5 and stored["postseason"]["playoffs"]["per_staffel"] == 2


# ---------------------------------------------------------------- K1: Wiederöffnen unter der Season-Sperre

@pytest.mark.asyncio
async def test_reopen_waits_for_the_season_lock(flow):
    from services.mutation_lock import league_season_resource, mutation_lock

    if not flow.real_mongo:
        pytest.skip("Exklusiv ist die Sperre nur auf echtem MongoDB (FLOW_MONGO_URL) - mongomock hält sie nicht.")
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    tid = world["tids"][1][0]
    flow.act_as(await flow.add_staff(name="Zweite Leitung"))
    async with mutation_lock(flow.db, league_season_resource(world["season"]["id"])):
        refused = await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"})
    assert refused.status_code == 409 and "erneut versuchen" in refused.json()["detail"]
    assert await flow.db.league_final_tables.count_documents({"tournament_id": tid, "active": True}) == 1
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))


# ---------------------------------------------------------------- K2: Halbfinale, beide nicht da, mit Spiel um Platz 3

@pytest.mark.asyncio
async def test_both_absent_in_the_semifinal_never_share_third_place(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "third_place": True}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tid = (await tournament_of(flow, world, "playoff"))["id"]
    first, second = [match for match in await matches_of(flow, tid) if match["round"] == 1]
    flow.act_as(world["lead"])
    url = f"{STAFFELN}/{tid}/matches/{first['id']}/double-no-show"
    ok(await flow.post(url, json={"note": "Beide nicht erschienen"}))
    ok(await flow.post(url, json={"note": "Wieder nicht erschienen"}))
    seeds = {row["id"]: row["seed"] async for row in flow.db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0})}
    winner = min(sides(second), key=lambda side: seeds[side])
    loser = next(side for side in sides(second) if side != winner)
    await win(flow, second, winner)
    await settle(flow, tid)
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    rows = {row["registration_id"]: row["rank"] for row in (await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0}))["rows"]}
    # Der Sieger des Spiels um Platz 3 (kampflos) ist Dritter, die beiden Ausgeschiedenen sind Vierte - nie Dritte.
    assert rows[winner] == 1 and rows[loser] == 3
    assert [rows[side] for side in sides(first)] == [4, 4]


# ---------------------------------------------------------------- K3: halb angelegt nach einem Absturz

@pytest.mark.asyncio
async def test_a_staffel_without_a_tree_is_rebuilt_not_replayed(flow):
    world = await build(flow, postseason=PLAYOFFS_4)
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tid = (await tournament_of(flow, world, "playoff"))["id"]
    # Prozess-Absturz mitten im Bau nachgestellt: Das Turnier steht, Phase und Spiele fehlen.
    await flow.db.matches_v2.delete_many({"tournament_id": tid})
    await flow.db.tournament_stages.delete_many({"tournament_id": tid})
    part = division_of(await cockpit(flow, world), 1)["playoffs"]
    assert part["staffel"] is None and part["state"] == "ready" and part["can_create"]
    answer = ok(await create(flow, world, "playoffs"))
    assert answer["replay"] is False
    rebuilt = await tournament_of(flow, world, "playoff")
    assert len(await matches_of(flow, rebuilt["id"])) == 3 and await flow.db.tournament_stages.count_documents({"tournament_id": rebuilt["id"]}) == 1
    assert await flow.db.tournaments.count_documents({"league_context.kind": "playoff"}) == 1
    assert await flow.db.tournament_registrations.count_documents({"registered_via": "league_postseason"}) == 4


# ---------------------------------------------------------------- K5, K7: Antworten für die Flächen

@pytest.mark.asyncio
async def test_the_league_page_reads_the_relegation_pairs_with_their_divisions(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}}, season={"visibility": "public", "status": "active"})
    flow.act_as(world["lead"])
    admin = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}"))
    # K7: Ohne angelegte Staffel trägt keine Liga das Feld - die Antwort sieht aus wie vorher.
    assert all("postseason" not in division for division in admin["divisions"])
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    public = ok(await flow.get(f"/api/leagues/{world['league']['slug']}/{season['slug']}"))
    entry = public["divisions"][0]["postseason"][0]
    upper, lower = world["regs"][world["tids"][1][0]][2], world["regs"][world["tids"][2][0]][1]
    assert entry["kind"] == "relegation" and len(entry["pairs"]) == 1
    pair = entry["pairs"][0]
    assert pair["upper"] == {"display_name": upper["display_name"], "division_label": "Liga 1", "score": None, "won": False}
    assert pair["lower"] == {"display_name": lower["display_name"], "division_label": "Liga 2", "score": None, "won": False}
    assert pair["decided"] is False and pair["match_id"]
    tournament = await tournament_of(flow, world, "relegation")
    await play_round(flow, world, tournament["id"], favourite=False)
    public = ok(await flow.get(f"/api/leagues/{world['league']['slug']}/{season['slug']}"))
    pair = public["divisions"][0]["postseason"][0]["pairs"][0]
    assert pair["decided"] is True and pair["lower"]["won"] is True and pair["lower"]["score"] == 2 and pair["upper"]["score"] == 0
    assert "postseason" not in public["divisions"][1]


# ---------------------------------------------------------------- K4: Veto-Warnung schon in der Vorschau

@pytest.mark.asyncio
async def test_the_preview_warns_when_no_veto_template_fits(flow):
    from services import league_postseason

    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5}})
    await close(flow, world)
    # Ohne Veto in der Season gibt es nichts zu warnen.
    assert division_of(await cockpit(flow, world), 1)["playoffs"]["veto_notes"] == []
    # Veto an, aber kein Map-Pool: Für kein Best of lässt sich eine Vorlage vorschlagen - das steht schon in der Vorschau.
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"veto_rules": {
        "enabled": True, "team_a": "home", "step_seconds": 60, "steps": [{"kind": "decider", "mode": "flagge", "team": None, "position": 1}]}}})
    notes = division_of(await cockpit(flow, world), 1)["playoffs"]["veto_notes"]
    assert notes and all(note.startswith("Veto für Best of 5") for note in notes)
    assert league_postseason.VETO_NOTE.split("{")[0] in notes[0]


# ---------------------------------------------------------------- K8: Sperren zählen in beide Richtungen

@pytest.mark.asyncio
async def test_a_ban_given_in_the_playoffs_counts_the_relegation_game_of_the_same_squad(flow):
    from services import league_sanction_bans as bans

    # Platz 3 von Liga 1 spielt Playoffs (vier Plätze) und Relegation.
    world = await build(flow, levels=2, zones=ZONES, postseason={"playoffs": {"enabled": True, "per_staffel": 4}, "relegation": {"enabled": True}},
                        division_postseason={2: {"playoffs": {"enabled": False}}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    ok(await create(flow, world, "relegation"))
    playoff, relegation = await tournament_of(flow, world, "playoff"), await tournament_of(flow, world, "relegation")
    squad = world["regs"][world["tids"][1][0]][2]["squad_id"]
    in_playoffs = await flow.db.tournament_registrations.find_one({"tournament_id": playoff["id"], "squad_id": squad}, {"_id": 0})
    row = {"id": "ban-po", "kind": sorted(bans.BAN_KINDS)[0], "matches": 2, "registration_id": in_playoffs["id"], "season_id": world["season"]["id"],
           "starts_at": (now_utc() - timedelta(days=30)).isoformat()}
    await play_round(flow, world, playoff["id"])  # Halbfinale: das Team verliert als Setzplatz 3
    await play_round(flow, world, relegation["id"])
    frame = await bans.frame_for(flow.db, [row])
    covered = bans.covered_matches(row, frame)
    relegation_game = (await matches_of(flow, relegation["id"]))[0]["id"]
    # Die Sperre aus den Playoffs zählt das Playoff-Spiel **und** das Relegationsspiel desselben Co-Teams.
    assert len(covered) == 2 and relegation_game in covered


# ---------------------------------------------------------------- TV: Kennzeichen und Relegation im Saisonfinale

@pytest.mark.asyncio
async def test_the_tv_season_finale_shows_who_moves_through_the_relegation(flow):
    from services import league_finale, tv_display

    assert "playoff" in tv_display.STANDING_FIELDS
    world = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}})
    await close(flow, world)
    season = await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    before = await league_finale.season_pages(flow.db, season, guests_only=False)
    upper, lower = world["regs"][world["tids"][1][0]][2], world["regs"][world["tids"][2][0]][1]
    names = lambda pages, move: {row["name"] for page in pages for row in page["rows"] if row["move"] == move}  # noqa: E731
    # Vor der Relegation stehen nur die festen Auf- und Absteiger da.
    assert upper["display_name"] not in names(before, league_finale.DOWN) and lower["display_name"] not in names(before, league_finale.UP)
    ok(await create(flow, world, "relegation"))
    tournament = await tournament_of(flow, world, "relegation")
    await play_round(flow, world, tournament["id"], favourite=False)  # das Team der unteren Liga gewinnt
    await settle(flow, tournament["id"])
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    after = await league_finale.season_pages(flow.db, season, guests_only=False)
    assert lower["display_name"] in names(after, league_finale.UP) and upper["display_name"] in names(after, league_finale.DOWN)
    # Der gespeicherte Endstand bleibt, wie er war - die Wirkung kommt beim Lesen dazu.
    final = await flow.db.league_final_tables.find_one({"tournament_id": world["tids"][1][0], "active": True}, {"_id": 0})
    assert [row["zone"] for row in final["rows"]] == [None, None, "playoff_relegation", "relegation"]
