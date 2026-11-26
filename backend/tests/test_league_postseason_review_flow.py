"""Playoffs und Relegation: Befunde der unabhängigen Prüfung und Fabians Entscheidungen Nr. 245-249 (#2404, docs/LIGA.md „F.6“).

Nachrücken bleibt auch nach einem zweiten Neuberechnen bestehen, eine Liga mit weniger als zwei Playoff-Teams hält die Season nicht
offen, der erste doppelte Nichtantritt zählt und lässt sich zurücknehmen, die Relegation liegt hinter den Playoffs beider Ligen, Best of,
Platz 3 und Heimrecht stehen ab dem Season-Start fest. Dazu die Nachprüfung mit Nr. 250 und 251: die Sperre ab dem Start ohne Umweg,
beidseitig Abwesende einen Platz hinter den Verlierern ihrer Runde, ohne Playoffs ist Meister das beste verbliebene Team.
Über die echten Routen, nur erfundene Namen.
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
async def test_relegation_does_not_wait_for_playoffs_that_are_never_played(flow):
    # Ein Platz je Staffel bei einer Staffel: Diese Liga spielt keine Playoffs - die Relegation liegt dann nicht hinter einer Woche,
    # die es nie gibt.
    plain = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}})
    wanted = division_of(await cockpit(flow, plain), 1)["relegation"]["start_day"]
    await flow.db.league_seasons.update_one({"id": plain["season"]["id"]}, {"$set": {"postseason.playoffs": {"enabled": True, "per_staffel": 1}}})
    relegation = division_of(await cockpit(flow, plain), 1)["relegation"]
    assert relegation["start_day"] == wanted and relegation["after_playoffs_of"] is None
    # Gegenprobe: Mit vier Plätzen wird gespielt, die Relegation rückt dahinter.
    await flow.db.league_seasons.update_one({"id": plain["season"]["id"]}, {"$set": {"postseason.playoffs.per_staffel": 4}})
    relegation = division_of(await cockpit(flow, plain), 1)["relegation"]
    assert relegation["start_day"] > wanted and relegation["after_playoffs_of"] == "Liga 1 und Liga 2"


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


# ================================================================ Nachprüfung (Runde 3): Nr. 249 ohne Umweg, Nr. 250, Nr. 251

async def start_season(flow, world: dict) -> None:
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {
        "start_date": (now_utc() - timedelta(days=3)).isoformat(), "status": "active"}})


async def stored_playoffs(flow, world: dict) -> dict:
    return (await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0}))["postseason"]["playoffs"]


OTHER = {"per_staffel": 4, "best_of": 7, "third_place": True, "home": "draw"}


@pytest.mark.asyncio
async def test_switching_playoffs_off_and_on_does_not_open_the_start_lock(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}})
    await start_season(flow, world)
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    flow.act_as(world["lead"])
    # Ausschalten und dabei andere Werte mitschicken: Die Werte stehen auch im Zustand „aus“ fest.
    refused = await flow.put(url, json={"playoffs": {"enabled": False, **OTHER}})
    assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"]
    # Ausschalten allein geht - und wieder einschalten nur mit den Werten vom Start.
    ok(await flow.put(url, json={"playoffs": {"enabled": False, "per_staffel": 4, "best_of": 3}}))
    refused = await flow.put(url, json={"playoffs": {"enabled": True, **OTHER}})
    assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"]
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}}))
    stored = await stored_playoffs(flow, world)
    assert (stored["enabled"], stored["best_of"], stored["third_place"], stored["home"], stored["best_of_rounds"]) == (True, 3, False, "better_seed", [])


@pytest.mark.asyncio
async def test_playoffs_switched_on_after_the_start_get_the_defaults(flow):
    world = await build(flow)
    await start_season(flow, world)
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    flow.act_as(world["lead"])
    for body in ({"enabled": True, **OTHER}, {"enabled": True, "per_staffel": 4, "third_place": True},
                 {"enabled": True, "per_staffel": 4, "home": "draw"}, {"enabled": True, "per_staffel": 4, "best_of_rounds": [{"round": 2, "best_of": 5}]}):
        refused = await flow.put(url, json={"playoffs": body})
        assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"], body
    assert "postseason" not in await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})
    # Einschalten selbst geht - mit den Vorgaben: Best of der Season, kein Spiel um Platz 3, Heimrecht für den besser Gesetzten.
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4}}))
    part = division_of(await cockpit(flow, world), 1)["settings"]["playoffs"]
    assert (part["enabled"], part["best_of"], part["third_place"], part["home"]) == (True, 3, False, "better_seed")


@pytest.mark.asyncio
async def test_a_division_cannot_set_new_playoff_values_after_the_start(flow):
    world = await build(flow)
    await start_season(flow, world)
    url = f"{ADMIN}/divisions/{world['divisions'][1]['id']}/postseason"
    flow.act_as(world["lead"])
    refused = await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 7, "third_place": True}})
    assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"]
    assert "postseason" not in await flow.db.league_divisions.find_one({"id": world["divisions"][1]["id"]}, {"_id": 0})
    # Mit den Vorgaben darf die Liga eigene Playoffs einschalten.
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}}))


# ---------------------------------------------------------------- Nr. 250: beidseitig abwesend - ein Platz hinter den Verlierern der Runde

async def absent_twice(flow, world: dict, tid: str, match: dict) -> None:
    flow.act_as(world["lead"])
    url = f"{STAFFELN}/{tid}/matches/{match['id']}/double-no-show"
    ok(await flow.post(url, json={"note": "Beide nicht erschienen"}))
    ok(await flow.post(url, json={"note": "Wieder nicht erschienen"}))


async def final_rows(flow, world: dict, tid: str) -> list[dict]:
    await settle(flow, tid)
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tid}/close", json={"confirm": True}))
    return (await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0}))["rows"]


@pytest.mark.asyncio
async def test_both_absent_in_the_quarterfinal_stand_one_place_behind_its_losers(flow):
    world = await build(flow, staffeln={1: [8]}, postseason={"playoffs": {"enabled": True, "per_staffel": 8}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tid = (await tournament_of(flow, world, "playoff"))["id"]
    quarter = [match for match in await matches_of(flow, tid) if match["round"] == 1]
    await absent_twice(flow, world, tid, quarter[0])
    for _ in range(3):
        await play_round(flow, world, tid)
    rows = await final_rows(flow, world, tid)
    rank = {row["registration_id"]: row["rank"] for row in rows}
    # Die drei Verlierer der gespielten Viertelfinale teilen Platz 5 - die beiden Abwesenden stehen einen Platz dahinter.
    assert sorted(rank.values()) == [1, 2, 3, 5, 5, 5, 6, 6]
    assert [rank[side] for side in sides(quarter[0])] == [6, 6]
    # Sie bleiben Teilnehmer (für Belohnungen): kein Ausscheiden an der Zeile.
    assert not any(row.get("exit") for row in rows)


@pytest.mark.asyncio
async def test_both_absent_in_the_semifinal_are_fourth_without_a_third_place_game(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await close(flow, world)
    ok(await create(flow, world, "playoffs"))
    tid = (await tournament_of(flow, world, "playoff"))["id"]
    first, second = [match for match in await matches_of(flow, tid) if match["round"] == 1]
    await absent_twice(flow, world, tid, first)
    await play_round(flow, world, tid)
    rows = await final_rows(flow, world, tid)
    rank = {row["registration_id"]: row["rank"] for row in rows}
    assert sorted(rank.values()) == [1, 3, 4, 4] and [rank[side] for side in sides(first)] == [4, 4]
    assert not any(row.get("exit") for row in rows)


# ---------------------------------------------------------------- Nr. 251: keine Playoffs - Meister ist das beste verbliebene Team

async def reload_season(flow, world: dict) -> dict:
    return await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_without_playoffs_after_exits_the_best_remaining_team_is_champion(flow):
    # Eine Staffel, zwei Playoff-Plätze, Meister aus den Playoffs - drei der vier Teams ziehen sich zurück.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"})
    tid = world["tids"][1][0]
    teams = world["regs"][tid]
    for index in (0, 1, 3):
        await remove(flow, world, tid, teams[index]["id"])
    await close(flow, world)
    # Die Season wartet nicht auf Playoffs, die es nicht geben kann - Meister ist, wer übrig ist.
    assert (await reload_season(flow, world))["status"] == "completed"
    final = await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0})
    assert final["champion"]["registration_id"] == teams[2]["id"] and final["champion_fallback"] is True
    awards = await flow.db.tournament_awards.find({"reward_key": None}, {"_id": 0}).to_list(10)
    assert [(row["registration_id"], row["league"]["title"], row["suspended"]) for row in awards] == [(teams[2]["id"], "Meister", False)]
    # Wiederöffnen: Der Eintrag ruht, die Season läuft wieder - und ein neuer Abschluss setzt ihn wieder, nie doppelt.
    flow.act_as(await flow.add_staff(name="Zweite Leitung"))
    ok(await flow.post(f"{STAFFELN}/{tid}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    assert (await reload_season(flow, world))["status"] == "active"
    assert await flow.db.tournament_awards.count_documents({"reward_key": None, "suspended": False}) == 0
    await close(flow, world)
    assert (await reload_season(flow, world))["status"] == "completed"
    awards = await flow.db.tournament_awards.find({"reward_key": None, "suspended": False}, {"_id": 0}).to_list(10)
    assert [row["registration_id"] for row in awards] == [teams[2]["id"]]


@pytest.mark.asyncio
async def test_without_playoffs_and_without_a_team_left_the_title_stays_open(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"})
    tid = world["tids"][1][0]
    for team in world["regs"][tid]:
        await remove(flow, world, tid, team["id"])
    await close(flow, world)
    assert (await reload_season(flow, world))["status"] == "completed"
    final = await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0})
    assert not final.get("champion") and not final.get("champion_fallback")
    assert await flow.db.tournament_awards.count_documents({"reward_key": None}) == 0


@pytest.mark.asyncio
async def test_played_playoffs_keep_their_champion_and_no_table_champion_appears(flow):
    # Gegenprobe: Mit genug Teams entscheiden die Playoffs - beim Abschluss der Staffel entsteht kein Meister aus der Tabelle.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"})
    tid = world["tids"][1][0]
    await remove(flow, world, tid, world["regs"][tid][3]["id"])
    await close(flow, world)
    assert (await reload_season(flow, world))["status"] == "active"
    final = await flow.db.league_final_tables.find_one({"tournament_id": tid, "active": True}, {"_id": 0})
    assert not final.get("champion") and not final.get("champion_fallback")
    assert await flow.db.tournament_awards.count_documents({"reward_key": None}) == 0


# ---------------------------------------------------------------- KN1: Machbarkeit steht ab dem ersten Abschluss fest

@pytest.mark.asyncio
async def test_no_further_staffel_once_one_of_the_division_is_closed(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 1}, "champion_source": "playoffs"})
    await close(flow, world)
    url = f"{ADMIN}/divisions/{world['divisions'][1]['id']}/staffeln"
    flow.act_as(world["lead"])
    refused = await flow.post(url, json={})
    assert refused.status_code == 422 and "abgeschlossen" in refused.json()["detail"]
    assert len(await flow.db.tournaments.find({"league_context.division_id": world["divisions"][1]["id"]}, {"_id": 0}).to_list(10)) == 1
    # Sind alle Staffeln der Liga wieder offen, geht es wieder.
    flow.act_as(await flow.add_staff(name="Zweite Leitung"))
    ok(await flow.post(f"{STAFFELN}/{world['tids'][1][0]}/reopen", json={"reason": "Ergebnis vertauscht eingetragen"}))
    flow.act_as(world["lead"])
    ok(await flow.post(url, json={}))


@pytest.mark.asyncio
async def test_a_league_without_playoffs_and_relegation_still_takes_a_further_staffel(flow):
    # Gegenprobe: Ohne Playoffs und Relegation ändert die Sperre nichts - dort bleibt alles wie vorher.
    world = await build(flow)
    await close(flow, world)
    flow.act_as(world["lead"])
    ok(await flow.post(f"{ADMIN}/divisions/{world['divisions'][1]['id']}/staffeln", json={}))


@pytest.mark.asyncio
async def test_the_lower_division_of_a_relegation_takes_no_further_staffel_either(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}})
    await close(flow, world, world["tids"][2][0])
    flow.act_as(world["lead"])
    refused = await flow.post(f"{ADMIN}/divisions/{world['divisions'][2]['id']}/staffeln", json={})
    assert refused.status_code == 422 and "abgeschlossen" in refused.json()["detail"]
    # Die Relegation bindet beide Ligen des Paares: Auch die obere nimmt keine weitere Staffel, sobald die untere abgeschlossen hat.
    partner = await flow.post(f"{ADMIN}/divisions/{world['divisions'][1]['id']}/staffeln", json={})
    assert partner.status_code == 422 and "abgeschlossen" in partner.json()["detail"]


@pytest.mark.asyncio
async def test_a_staffel_appearing_after_the_first_close_never_brings_a_second_champion(flow):
    from services import league_postseason

    # Ein Platz bei einer Staffel: keine Playoffs, der Meister kommt aus der Tabelle. Das steht mit dem ersten Abschluss fest.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 1}, "champion_source": "playoffs"})
    await close(flow, world)
    first = await flow.db.league_final_tables.find_one({"tournament_id": world["tids"][1][0], "active": True}, {"_id": 0})
    assert first["champion_place"] is True and first["postseason"] == {"per_staffel": 1, "staffeln": 1}
    # Taucht danach doch eine zweite Staffel auf (an der Sperre vorbei), bleibt es dabei: keine Playoffs, kein zweiter Weg zum Meister.
    twin = await flow.db.tournaments.find_one({"id": world["tids"][1][0]}, {"_id": 0})
    twin.update({"id": "staffel-b", "slug": "staffel-b", "status": "live", "final_table": None,
                 "league_context": {**twin["league_context"], "staffel": "B"}})
    twin.pop("status_before_final", None)
    await flow.db.tournaments.insert_one(twin)
    season, division = await reload_season(flow, world), world["divisions"][1]
    assert await league_postseason.playoffs_feasible(flow.db, season, division) is False
    assert await league_postseason.champion_from_playoffs(flow.db, season, division) is False
    assert (await cockpit(flow, world))["missing"] == []


@pytest.mark.asyncio
async def test_feasible_playoffs_stay_feasible_when_a_staffel_drops_out_later(flow):
    from services import league_postseason

    world = await build(flow, staffeln={1: [4, 4]}, postseason={"playoffs": {"enabled": True, "per_staffel": 1}, "champion_source": "playoffs"})
    await close(flow, world, world["tids"][1][0])
    season, division = await reload_season(flow, world), world["divisions"][1]
    await flow.db.tournaments.update_one({"id": world["tids"][1][1]}, {"$set": {"status": "cancelled"}})
    # Der Endstand der ersten Staffel hält fest, dass der Meister aus den Playoffs kommt - die Tabelle macht keinen.
    assert await league_postseason.champion_from_playoffs(flow.db, season, division) is True
    assert await league_postseason.playoffs_feasible(flow.db, season, division) is True


# ---------------------------------------------------------------- KN2: versteckte Relegation bleibt am TV und im Discord unsichtbar

@pytest.mark.asyncio
async def test_a_hidden_relegation_does_not_show_at_the_tv_or_in_discord(flow):
    from services import league_finale

    world = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}})
    await close(flow, world)
    ok(await create(flow, world, "relegation"))
    tournament = await tournament_of(flow, world, "relegation")
    await play_round(flow, world, tournament["id"], favourite=False)
    await settle(flow, tournament["id"])
    flow.act_as(world["lead"])
    ok(await flow.post(f"{STAFFELN}/{tournament['id']}/close", json={"confirm": True}))
    await flow.db.tournaments.update_many({"league_context.season_id": world["season"]["id"]}, {"$set": {"is_public": True, "visibility": "public"}})
    season = await reload_season(flow, world)
    lower = world["regs"][world["tids"][2][0]][1]

    async def moving_up(guests_only: bool) -> list[dict]:
        pages = await league_finale.season_pages(flow.db, season, guests_only=guests_only)
        return [row for page in pages for row in page["rows"] if row["move"] == league_finale.UP and row["name"] == lower["display_name"]]

    # Sichtbar: Der Sieger der Relegation steht als Aufsteiger da - mit dem Vermerk, dass er über die Relegation kommt.
    shown = await moving_up(True)
    assert len(shown) == 1 and shown[0]["via"] == "relegation"
    # Versteckt: Gäste (TV, Discord) sehen das Ergebnis nicht - die Leitung schon.
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"is_public": False}})
    assert await moving_up(True) == []
    assert len(await moving_up(False)) == 1


# ================================================================ Runde 4: Nr. 252 (Best of bleibt), Nr. 253 (einmal gestartet bleibt gestartet)

SEASON_URL = ADMIN + "/seasons/{id}"


@pytest.mark.asyncio
async def test_playoffs_keep_their_best_of_when_the_season_changes_its_own_after_the_start(flow):
    # Bei den Playoffs steht „wie in der Season“ - das Best of der Season ist 3.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    assert (await stored_playoffs(flow, world))["best_of"] is None
    await start_season(flow, world)
    flow.act_as(world["lead"])
    answer = ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    # Die reguläre Season hat ihr neues Best of - die Playoffs behalten das vom Start, und die Leitung erfährt es.
    assert answer["best_of"] == 5
    assert any("behalten Best of 3" in text and "Liga 1" in text for text in answer["warnings"])
    season = await reload_season(flow, world)
    # Festgehalten wird der Wert vom Start (Nr. 255) - die Einstellung selbst bleibt „wie in der Season“.
    assert season["best_of"] == 5 and season["postseason_best_of_kept"] == 3 and season["postseason"]["playoffs"]["best_of"] is None
    assert division_of(await cockpit(flow, world), 1)["settings"]["playoffs"]["best_of"] == 3
    # Ein zweites Ändern schreibt nichts mehr fest und meldet nichts.
    again = ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 1}))
    assert not any("behalten" in text for text in again["warnings"])
    assert (await reload_season(flow, world))["postseason_best_of_kept"] == 3
    assert division_of(await cockpit(flow, world), 1)["settings"]["playoffs"]["best_of"] == 3


@pytest.mark.asyncio
async def test_before_the_start_the_playoffs_follow_the_seasons_best_of(flow):
    # Gegenprobe: Vor dem Start folgen die Playoffs der Season - nichts wird festgeschrieben.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    flow.act_as(world["lead"])
    answer = ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    assert not any("behalten" in text for text in answer["warnings"])
    assert (await stored_playoffs(flow, world))["best_of"] is None
    assert division_of(await cockpit(flow, world), 1)["settings"]["playoffs"]["best_of"] == 5


@pytest.mark.asyncio
async def test_a_season_without_playoffs_changes_its_best_of_as_before(flow):
    world = await build(flow)
    await start_season(flow, world)
    flow.act_as(world["lead"])
    answer = ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    assert answer["best_of"] == 5 and not any("behalten" in text for text in answer["warnings"])
    assert "postseason" not in await reload_season(flow, world)


@pytest.mark.asyncio
async def test_playoffs_keep_their_best_of_when_a_division_gets_its_own_after_the_start(flow):
    # Zwei Ligen folgen der Vorlage der Season („wie in der Season“). Liga 2 bekommt nach dem Start ein eigenes Best of.
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await start_season(flow, world)
    flow.act_as(world["lead"])
    answer = ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][2]['id']}", json={"overrides": {"best_of": 5}}))
    assert any("behalten Best of 3" in text and "Liga 2" in text for text in answer["warnings"])
    view = await cockpit(flow, world)
    assert division_of(view, 2)["settings"]["playoffs"]["best_of"] == 3 and division_of(view, 1)["settings"]["playoffs"]["best_of"] == 3
    # Liga 2 merkt sich nur ihr Best of vom Start (Nr. 255) und folgt weiter der Vorlage - Season und Liga 1 bleiben, wie sie sind.
    assert (await stored_playoffs(flow, world))["best_of"] is None and "postseason_best_of_kept" not in await reload_season(flow, world)
    two = await flow.db.league_divisions.find_one({"id": world["divisions"][2]["id"]}, {"_id": 0})
    assert two["postseason_best_of_kept"] == 3 and "postseason" not in two
    one = await flow.db.league_divisions.find_one({"id": world["divisions"][1]["id"]}, {"_id": 0})
    assert "postseason" not in one and "postseason_best_of_kept" not in one


@pytest.mark.asyncio
async def test_a_division_with_its_own_best_of_keeps_it_when_the_season_changes(flow):
    # Liga 2 spielt regulär Best of 1 - ihre Playoffs erben das. Ändert die Season ihr Best of, bleibt jede Liga bei ihrem Wert.
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][2]['id']}", json={"overrides": {"best_of": 1}}))
    await start_season(flow, world)
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    view = await cockpit(flow, world)
    assert division_of(view, 1)["settings"]["playoffs"]["best_of"] == 3 and division_of(view, 2)["settings"]["playoffs"]["best_of"] == 1


# ---------------------------------------------------------------- Nr. 253: einmal gestartet bleibt gestartet

def later(days: int = 30) -> str:
    return f"{(now_utc() + timedelta(days=days)).date().isoformat()}T00:00:00"


@pytest.mark.asyncio
async def test_once_started_the_season_stays_started_when_its_start_date_moves(flow):
    from services import league_applications, league_calendar, league_late, league_successor

    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}})
    await start_season(flow, world)
    began = league_calendar.aware((await reload_season(flow, world))["start_date"])
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    flow.act_as(world["lead"])
    # Das Datum lässt sich weiter verschieben - der Start von damals ist gemerkt.
    moved = ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"start_date": later()}))
    assert "started_at" not in moved["changed"]
    season = await reload_season(flow, world)
    assert league_calendar.aware(season["start_date"]) > now_utc() and league_calendar.aware(season["started_at"]) == began
    # Die Sperren bleiben: Nr. 249 und alles andere, was am Start hängt.
    assert (await cockpit(flow, world))["started"] is True
    refused = await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5}})
    assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"]
    assert league_successor.started(season) is True
    assert league_late.late_deadline(season) == began + timedelta(days=league_late.late_days(season))
    assert league_applications.carry_deadline({"carry_over": {"from_season_id": "alt"}}, season) == began
    # Ein zweites Verschieben ändert den gemerkten Start nicht (idempotent) - auch nicht zurück in den Entwurf.
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"start_date": later(60)}))
    assert league_calendar.aware((await reload_season(flow, world))["started_at"]) == began


@pytest.mark.asyncio
async def test_a_season_that_has_not_started_yet_can_still_move_its_start(flow):
    # Gegenprobe: Vor dem Start wird nichts gemerkt - nach dem Verschieben ist die Season weiter „nicht gestartet“.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}})
    flow.act_as(world["lead"])
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"start_date": later()}))
    season = await reload_season(flow, world)
    assert "started_at" not in season and (await cockpit(flow, world))["started"] is False
    ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5}}))


@pytest.mark.asyncio
async def test_saving_playoff_settings_after_the_start_remembers_the_start(flow):
    from services import league_calendar

    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}})
    await start_season(flow, world)
    began = league_calendar.aware((await reload_season(flow, world))["start_date"])
    flow.act_as(world["lead"])
    ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 2, "best_of": 3}}))
    assert league_calendar.aware((await reload_season(flow, world))["started_at"]) == began


# ---------------------------------------------------------------- Die Verwaltung erfährt, dass die Staffeln feststehen

@pytest.mark.asyncio
async def test_the_admin_view_says_when_a_division_takes_no_further_staffel(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    flow.act_as(world["lead"])
    before = ok(await flow.get(SEASON_URL.format(id=world["season"]["id"])))
    assert "staffeln_locked" not in before["divisions"][0]
    await close(flow, world)
    flow.act_as(world["lead"])
    after = ok(await flow.get(SEASON_URL.format(id=world["season"]["id"])))
    assert after["divisions"][0]["staffeln_locked"] is True


# ================================================================ Runde 5: Nr. 254 (Start erst, wenn die Season läuft), Nr. 255 (Best of
# bleibt auch im Zustand „aus“, Relegation wie Playoffs, die Liga N merkt nur den Rückfallwert), Kann-Punkte der Schlussprüfung

KEPT = "postseason_best_of_kept"


@pytest.mark.asyncio
async def test_playoffs_that_are_switched_off_keep_the_best_of_from_the_start_too(flow):
    # Der Umweg: Playoffs aus, Best of der Season auf 5, Playoffs wieder ein - sie spielen trotzdem das Best of vom Start.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await start_season(flow, world)
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    flow.act_as(world["lead"])
    ok(await flow.put(url, json={"playoffs": {"enabled": False, "per_staffel": 4}}))
    answer = ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    # Ausgeschaltet gibt es nichts zu melden - festgehalten wird trotzdem.
    assert not any("behalten" in text for text in answer["warnings"])
    assert (await reload_season(flow, world))[KEPT] == 3
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4}}))
    part = division_of(await cockpit(flow, world), 1)["settings"]["playoffs"]
    assert (part["enabled"], part["best_of"]) == (True, 3)
    # Ausdrücklich das neue Best of der Season zu wählen, geht ebenso wenig.
    refused = await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5}})
    assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_saving_right_after_the_season_changed_its_best_of_keeps_the_start_value(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await start_season(flow, world)
    flow.act_as(world["lead"])
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    # „Wie in der Season“ heißt nach dem Start: wie zum Start - das Speichern ändert nichts und geht durch.
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": None}}))
    refused = await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5}})
    assert refused.status_code == 422
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 2, "best_of": 3}}))
    part = division_of(await cockpit(flow, world), 1)["settings"]["playoffs"]
    assert (part["best_of"], part["per_staffel"]) == (3, 2)


@pytest.mark.asyncio
async def test_the_best_of_of_the_relegation_is_fixed_from_the_start_and_kept_like_the_playoffs(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}})
    await start_season(flow, world)
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    flow.act_as(world["lead"])
    # Ab dem Start fest: ein anderes Best of der Relegation geht nicht mehr.
    refused = await flow.put(url, json={"relegation": {"enabled": True, "best_of": 5}})
    assert refused.status_code == 422 and "Relegation" in refused.json()["detail"]
    # Ändert die Season ihr Best of, bleibt die Relegation beim Wert vom Start - mit Hinweis.
    answer = ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    assert any("Die Relegation von Liga 1 behält Best of 3" in text for text in answer["warnings"])
    view = await cockpit(flow, world)
    assert division_of(view, 1)["settings"]["relegation"]["best_of"] == 3
    assert (await reload_season(flow, world))["best_of"] == 5


@pytest.mark.asyncio
async def test_a_division_only_remembers_its_best_of_and_keeps_following_the_template(flow):
    # Liga 2 spielt regulär Best of 1. Nach dem Start ändert die Season ihr Best of - und später die Plätze je Staffel.
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][2]['id']}", json={"overrides": {"best_of": 1}}))
    await start_season(flow, world)
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 2}}))
    view = await cockpit(flow, world)
    one, two = division_of(view, 1)["settings"], division_of(view, 2)["settings"]
    # Beide folgen der Vorlage (Plätze je Staffel) - jede mit ihrem Best of vom Start.
    assert (one["playoffs"]["per_staffel"], one["playoffs"]["best_of"]) == (2, 3)
    assert (two["playoffs"]["per_staffel"], two["playoffs"]["best_of"]) == (2, 1)
    assert two["own"] == {"playoffs": False, "relegation": False}
    stored = await flow.db.league_divisions.find_one({"id": world["divisions"][2]["id"]}, {"_id": 0})
    assert "postseason" not in stored


@pytest.mark.asyncio
async def test_a_division_that_loses_its_own_best_of_after_the_start_keeps_it_for_the_playoffs(flow):
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    flow.act_as(world["lead"])
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][2]['id']}", json={"overrides": {"best_of": 1}}))
    await start_season(flow, world)
    answer = ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][2]['id']}", json={"overrides": {}}))
    assert any("behalten Best of 1" in text and "Liga 2" in text for text in answer["warnings"])
    view = await cockpit(flow, world)
    assert division_of(view, 2)["settings"]["playoffs"]["best_of"] == 1 and division_of(view, 1)["settings"]["playoffs"]["best_of"] == 3
    stored = await flow.db.league_divisions.find_one({"id": world["divisions"][2]["id"]}, {"_id": 0})
    assert stored[KEPT] == 1 and "postseason" not in stored and KEPT not in await reload_season(flow, world)


@pytest.mark.asyncio
async def test_the_next_season_starts_again_with_the_best_of_of_the_season(flow):
    # Vorlage vorhanden, Playoffs aus - so ist die Season mit dem Abschluss der Staffeln beendet.
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": False, "per_staffel": 4}})
    await start_season(flow, world)
    flow.act_as(world["lead"])
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    ok(await flow.patch(f"{ADMIN}/divisions/{world['divisions'][2]['id']}", json={"overrides": {"best_of": 1}}))
    assert (await reload_season(flow, world))[KEPT] == 3
    assert (await flow.db.league_divisions.find_one({"id": world["divisions"][2]["id"]}, {"_id": 0}))[KEPT] == 3
    await close(flow, world)
    flow.act_as(world["lead"])
    start = (now_utc() + timedelta(days=400)).date().isoformat() + "T00:00:00"
    created = ok(await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": start, "confirm": True}))
    # Was die alte Season festgehalten hat, gilt nur ihr: Die neue beginnt mit „wie in der Season“ - und ohne gemerkten Start.
    new_season = await flow.db.league_seasons.find_one({"id": created["season"]["id"]}, {"_id": 0})
    assert KEPT not in new_season and "started_at" not in new_season and new_season["postseason"]["playoffs"]["best_of"] is None
    rows = await flow.db.league_divisions.find({"season_id": new_season["id"]}, {"_id": 0}).to_list(10)
    assert len(rows) == 2 and not any(KEPT in row for row in rows)


# ---------------------------------------------------------------- Nr. 254: Der Start wird erst gemerkt, wenn die Season wirklich läuft

@pytest.mark.asyncio
async def test_a_mistyped_start_date_alone_remembers_nothing(flow):
    from league_start_world import build as plain, start as go_live

    # Eine Season, in der noch nichts läuft: die Staffel ist Entwurf, kein Spiel gewertet.
    world = await plain(flow, 4)
    season_id = world["season"]["id"]
    await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"start_date": later(), "status": "active"}})
    flow.act_as(world["lead"])
    url = SEASON_URL.format(id=season_id)
    ok(await flow.patch(url, json={"start_date": later(-1)}))
    ok(await flow.patch(url, json={"start_date": later()}))
    season = await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    assert "started_at" not in season
    view = ok(await flow.get(f"{ADMIN}/seasons/{season_id}/postseason"))
    assert view["started"] is False
    # Von außen lässt sich der Start nicht setzen.
    ok(await flow.patch(url, json={"started_at": later(-10), "name": "Probe Season"}))
    assert "started_at" not in await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    # Läuft die Season wirklich - Start erreicht und eine Staffel live -, merkt das nächste Schreiben den Start.
    ok(await flow.patch(url, json={"start_date": later(-1)}))
    ok(await go_live(flow, world))
    flow.act_as(world["lead"])
    ok(await flow.patch(url, json={"start_date": later()}))
    season = await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    assert season.get("started_at") and (ok(await flow.get(f"{ADMIN}/seasons/{season_id}/postseason")))["started"] is True


# ---------------------------------------------------------------- K5: Relegation sperrt beide Partner-Ligen

@pytest.mark.asyncio
async def test_a_relegation_fixes_the_staffeln_of_both_divisions_once_one_is_closed(flow):
    world = await build(flow, levels=2, zones=ZONES, postseason={"relegation": {"enabled": True}})
    await close(flow, world, world["tids"][1][0])
    flow.act_as(world["lead"])
    # Liga 1 hat abgeschlossen - auch Liga 2 nimmt keine weitere Staffel mehr (die Paarungen rechnen mit ihren Staffeln).
    for level in (1, 2):
        refused = await flow.post(f"{ADMIN}/divisions/{world['divisions'][level]['id']}/staffeln", json={})
        assert refused.status_code == 422 and "abgeschlossen" in refused.json()["detail"], level
    view = ok(await flow.get(SEASON_URL.format(id=world["season"]["id"])))
    assert [row.get("staffeln_locked") for row in view["divisions"]] == [True, True]


# ---------------------------------------------------------------- K6: Die Nachricht zum Abschluss kennt den Meister ohne Playoffs

@pytest.mark.asyncio
async def test_the_captains_hear_who_is_champion_without_playoffs(flow):
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 2}, "champion_source": "playoffs"},
                        season={"visibility": "public"})
    tid = world["tids"][1][0]
    teams = world["regs"][tid]
    for index in (0, 1, 3):
        await remove(flow, world, tid, teams[index]["id"])
    await close(flow, world)
    # Nur der Meister ist noch dabei: Er erfährt es mit seinem Saisonende-Moment - eine Nachricht, nicht zwei (#1639, Fabian 26.11., A).
    assert await flow.db.notifications.count_documents({"meta.reason": "league_final", "title": "Staffel abgeschlossen"}) == 0
    notes = await flow.db.notifications.find({"meta.reason": "league_moment"}, {"_id": 0}).to_list(50)
    assert notes and all(note["title"] == f"Meister: {teams[2]['display_name']}" for note in notes)


# ================================================================ Runde 6: Nr. 256 - gesperrt und gemerkt wird erst, wenn die Season
# wirklich läuft; ein korrigiertes Startdatum zieht den gemerkten Start nach

async def not_running_yet(flow) -> dict:
    """Eine Season, in der noch nichts läuft (Staffel im Entwurf, kein Spiel gewertet) - mit Playoffs „wie in der Season“ und einem
    Startdatum von gestern: Das Datum sagt „begonnen“, mehr nicht."""
    from league_start_world import build as plain

    world = await plain(flow, 4)
    flow.act_as(world["lead"])
    ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 2}}))
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"start_date": later(-1), "status": "active"}})
    return world


async def season_doc(flow, world: dict) -> dict:
    return await flow.db.league_seasons.find_one({"id": world["season"]["id"]}, {"_id": 0})


async def overview(flow, world: dict) -> dict:
    flow.act_as(world["lead"])
    return ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/postseason"))


@pytest.mark.asyncio
async def test_a_start_date_alone_keeps_no_best_of(flow):
    # Datum erreicht, nichts läuft: Das Best of der Season ändert sich, dann wird das Datum korrigiert - nichts bleibt hängen.
    world = await not_running_yet(flow)
    url = SEASON_URL.format(id=world["season"]["id"])
    answer = ok(await flow.patch(url, json={"best_of": 5}))
    assert not any("behalten" in text for text in answer["warnings"])
    ok(await flow.patch(url, json={"start_date": later(14)}))
    season, view = await season_doc(flow, world), await overview(flow, world)
    assert view["started"] is False and "started_at" not in season
    assert KEPT not in season and "best_of_kept" not in view
    # Die Playoffs folgen der Season.
    assert view["divisions"][0]["settings"]["playoffs"]["best_of"] == 5
    assert await flow.db.audit_logs.count_documents({"action": "league.postseason.settings", "data.scope": "best_of_kept"}) == 0


@pytest.mark.asyncio
async def test_the_start_lock_waits_until_the_season_really_runs(flow):
    from league_start_world import start as go_live

    world = await not_running_yet(flow)
    url = f"{ADMIN}/seasons/{world['season']['id']}/postseason"
    # Das Datum allein sperrt nichts: Die Vorschau sagt „nicht gestartet“, Best of, Platz 3 und Heimrecht lassen sich ändern.
    assert (await overview(flow, world))["started"] is False
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 2, "best_of": 5, "third_place": True, "home": "draw"}}))
    assert "started_at" not in await season_doc(flow, world)
    # Läuft die Season wirklich (eine Staffel ist live), stehen die Werte fest - und der Start ist gemerkt, sobald gespeichert wird.
    ok(await go_live(flow, world))
    assert (await overview(flow, world))["started"] is True
    refused = await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 2, "best_of": 3, "third_place": True, "home": "draw"}})
    assert refused.status_code == 422 and "Season-Start" in refused.json()["detail"]
    ok(await flow.put(url, json={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 5, "third_place": True, "home": "draw"}}))
    assert (await season_doc(flow, world)).get("started_at")


@pytest.mark.asyncio
async def test_the_best_of_and_the_start_are_remembered_together(flow):
    from league_start_world import start as go_live
    from services import league_calendar

    world = await not_running_yet(flow)
    ok(await go_live(flow, world))
    flow.act_as(world["lead"])
    began = league_calendar.aware((await season_doc(flow, world))["start_date"])
    # Das Best of ändert sich und im selben Zug rückt das Startdatum in die Zukunft: Rückfallwert und Start entstehen zusammen.
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5, "start_date": later(14)}))
    season = await season_doc(flow, world)
    assert season[KEPT] == 3 and league_calendar.aware(season["started_at"]) == began
    view = await overview(flow, world)
    assert view["started"] is True and view["best_of_kept"] == 3 and view["divisions"][0]["settings"]["playoffs"]["best_of"] == 3
    # Auch die Liga N erfährt den Wert, für ihr eigenes Fenster.
    assert view["divisions"][0]["best_of_kept"] == 3


@pytest.mark.asyncio
async def test_playoffs_first_set_up_after_the_start_take_the_best_of_of_today(flow):
    # Zum Start gab es keine Playoff-Einstellungen: Wer sie später anlegt, bekommt das Best of der Season von heute.
    world = await build(flow)
    await start_season(flow, world)
    flow.act_as(world["lead"])
    ok(await flow.patch(SEASON_URL.format(id=world["season"]["id"]), json={"best_of": 5}))
    season = await reload_season(flow, world)
    assert KEPT not in season and "postseason" not in season
    ok(await flow.put(f"{ADMIN}/seasons/{world['season']['id']}/postseason", json={"playoffs": {"enabled": True, "per_staffel": 4}}))
    part = division_of(await cockpit(flow, world), 1)["settings"]["playoffs"]
    assert (part["enabled"], part["best_of"]) == (True, 5)


@pytest.mark.asyncio
async def test_a_corrected_start_date_that_is_reached_moves_the_remembered_start(flow):
    from services import league_calendar, league_late

    # Die Staffeln laufen, das Startdatum war vertippt (30 Tage zurück) und wird auf vorgestern korrigiert.
    world = await build(flow, postseason={"playoffs": {"enabled": True, "per_staffel": 4, "best_of": 3}})
    await flow.db.league_seasons.update_one({"id": world["season"]["id"]}, {"$set": {"start_date": later(), "status": "active"}})
    flow.act_as(world["lead"])
    url = SEASON_URL.format(id=world["season"]["id"])
    ok(await flow.patch(url, json={"start_date": later(-30)}))
    ok(await flow.patch(url, json={"start_date": later(-2)}))
    season = await reload_season(flow, world)
    corrected = league_calendar.aware(season["start_date"])
    # Der gemerkte Start zieht nach - Fristen zählen ab dem korrigierten Datum.
    assert league_calendar.aware(season["started_at"]) == corrected
    assert league_late.late_deadline(season) == corrected + timedelta(days=league_late.late_days(season))
    # Auch ein schon gemerkter Start folgt einer Korrektur auf ein erreichtes Datum.
    ok(await flow.patch(url, json={"start_date": later(-5)}))
    season = await reload_season(flow, world)
    assert league_calendar.aware(season["started_at"]) == league_calendar.aware(season["start_date"])
    moved = league_calendar.aware(season["started_at"])
    # In die Zukunft verschoben bleibt er, wie er war (Nr. 253).
    ok(await flow.patch(url, json={"start_date": later()}))
    season = await reload_season(flow, world)
    assert league_calendar.aware(season["started_at"]) == moved and league_calendar.aware(season["start_date"]) > now_utc()
    assert (await cockpit(flow, world))["started"] is True


# ---------------------------------------------------------------- K-a: Eine abgelehnte Änderung der Liga N merkt nichts

@pytest.mark.asyncio
async def test_a_refused_change_of_a_division_remembers_nothing(flow):
    world = await build(flow, levels=2, postseason={"playoffs": {"enabled": True, "per_staffel": 4}})
    await start_season(flow, world)
    flow.act_as(world["lead"])
    division_id = world["divisions"][2]["id"]
    # Eigenes Best of und zugleich ein Mindestkader unter der Teamgröße: Die Prüfung lehnt ab - und nichts ist geschrieben.
    refused = await flow.patch(f"{ADMIN}/divisions/{division_id}", json={"overrides": {"best_of": 5, "min_squad_size": 1}})
    assert refused.status_code == 422 and "Mindestkader" in refused.json()["detail"]
    stored = await flow.db.league_divisions.find_one({"id": division_id}, {"_id": 0})
    assert KEPT not in stored and not (stored.get("overrides") or {}).get("best_of")
    assert await flow.db.audit_logs.count_documents({"action": "league.postseason.settings", "data.scope": "best_of_kept"}) == 0
    # Die gültige Änderung merkt den Wert vom Start - genau einmal protokolliert.
    ok(await flow.patch(f"{ADMIN}/divisions/{division_id}", json={"overrides": {"best_of": 5}}))
    assert (await flow.db.league_divisions.find_one({"id": division_id}, {"_id": 0}))[KEPT] == 3
    assert await flow.db.audit_logs.count_documents({"action": "league.postseason.settings", "data.scope": "best_of_kept"}) == 1
    assert division_of(await cockpit(flow, world), 2)["best_of_kept"] == 3
