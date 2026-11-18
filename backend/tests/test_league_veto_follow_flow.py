"""Unberührte Veto-Vorlage folgt Pool, „Modus je Map“ und Best of (Fabian Nr. 108, Nr. 199 und Nr. 200, #2528, docs/LIGA.md D.3) - über
die echten Routen: Modusfolge und Best of mit unberührter und mit eigener Vorlage, die Staffel bekommt die Vorlage nur, wenn sie zu ihr
passt (ohne Ergebnis mit dem Übertragen, mit Ergebnis behält sie ihre bisherige), Liga N mit anderem Best of (Nr. 106), Pool entfernen,
abgeschlossene und gerade bearbeitete Staffeln, belegte Sperre, zwei Speicherungen kurz nacheinander und verschränkt, „Veto speichern“
gegen ein laufendes Nachziehen und ein laufendes Veto, das seinen Stand behält. Erfundene Namen."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_veto, league_veto_fit, league_veto_rules, map_pools  # noqa: E402
from services.mutation_lock import league_season_veto_resource, mutation_lock, tournament_write_resource  # noqa: E402
from test_league_veto_flow import (  # noqa: E402
    ADMIN, ANLAGE_B, BO5_POOL, CTL, HP, ORDER, SND, both_in, pick, pool_body, season_world, step, stored_veto, tournament_of, veto_block,
    veto_rules, veto_world,
)

# „Modus je Map“ umgestellt: Suchen zuerst - Suchen auf 1 und 4, Stellung auf 2 und 5, Kontrolle bleibt der Decider auf 3.
NEW_ORDER = [SND, HP, CTL, SND, HP]
NEW_ORDER_STEPS = [
    step("ban", SND, "A"), step("ban", SND, "B"), step("pick", SND, "A", 1), step("pick", SND, "B", 4),
    step("ban", HP, "B"), step("ban", HP, "A"), step("pick", HP, "B", 2), step("pick", HP, "A", 5),
    step("ban", CTL, "A"), step("ban", CTL, "B"), step("decider", CTL, None, 3),
]
# Best of 3 aus den Modi des Pools (Stellung, Suchen, Kontrolle): je Modus eine Position, also sperren bis zum Decider.
BO3_STEPS = [
    step("ban", HP, "A"), step("ban", HP, "B"), step("ban", HP, "A"), step("decider", HP, None, 1),
    step("ban", SND, "B"), step("ban", SND, "A"), step("ban", SND, "B"), step("decider", SND, None, 2),
    step("ban", CTL, "A"), step("ban", CTL, "B"), step("decider", CTL, None, 3),
]
FULL = {HP: ["Hafen", "Nebel", "Turm", "Glut"], SND: ["Nebel", "Turm", "Kai", "Werk"], CTL: ["Hafen", "Kai", "Ruine"]}
SMALLER = {HP: ["Hafen", "Nebel", "Turm"], SND: ["Nebel", "Turm", "Kai"], CTL: ["Hafen", "Kai", "Ruine"]}
STAFFEL = "Liga 1 · Staffel A"
UNTIL_SYNC_ONE = "In Liga 1 · Staffel A gilt die neue Veto-Vorlage erst nach „Vorgaben auf Staffeln übertragen“."
KEEPS_BO5 = f"{STAFFEL} spielt weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage."


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


async def template(flow, sid: str) -> dict:
    return ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))


async def follows(flow, sid: str) -> int:
    return await flow.db.audit_logs.count_documents({"action": "league.season.veto_rules", "target_id": sid, "data.via": "auto"})


async def staffel_steps(flow, world: dict) -> list:
    return (await flow.db.tournaments.find_one({"id": world["tid"]}, {"_id": 0, "veto_rules": 1}))["veto_rules"]["steps"]


async def expected(flow, sid: str) -> list:
    """Der Vorschlag zum letzten gespeicherten Stand - Modusfolge und Best of der Season, geltender Pool."""
    season = await flow.db.league_seasons.find_one({"id": sid}, {"_id": 0})
    pool = await map_pools.current(flow.db, "league_season", sid)
    return league_veto_rules.propose(order=season.get("game_mode_order"), pool=pool, best_of=int(season.get("best_of") or 1))


def veto_codes(rows: list) -> list:
    return [row["code"] for row in rows if row["code"].startswith("veto")]


async def sync(flow, sid: str) -> dict:
    """„Vorgaben auf Staffeln übertragen“ - das Ergebnis der einen Staffel."""
    return ok(await flow.post(f"{ADMIN}/seasons/{sid}/sync", json={}))["staffeln"][0]


async def with_result(flow, tournament_id: str) -> None:
    """Ein gespieltes Spiel in der Staffel - ab dann überträgt „Übertragen“ Best of und Modusfolge nicht mehr."""
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": tournament_id, "match_type": "duel", "status": "completed",
                                         "started_at": now_utc().isoformat(), "slots": []})


def veto_skip(result: dict) -> list:
    return [row["reason"] for row in result["skipped"] if row["group"] == "veto"]


# ---------------------------------------------------------------- Modusfolge und Best of

@pytest.mark.asyncio
async def test_an_untouched_template_follows_a_new_mode_order_and_reaches_the_staffel_with_the_transfer(flow):
    """Nr. 199: Wie beim Pool zieht die unberührte Vorlage nach, sobald „Modus je Map“ gespeichert wird - Season und Protokoll sofort.
    Nr. 200: Die Staffel spielt bis zum Übertragen noch die alte Modusfolge - sie behält ihre Vorlage, die Antwort sagt es; mit dem
    Übertragen kommen Modusfolge und Vorlage zusammen."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B and await follows(flow, sid) == 1
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    assert "game_mode_order" in saved["changed"]
    assert saved["veto_rules"]["steps"] == NEW_ORDER_STEPS, "die Antwort zeigt die nachgezogene Vorlage"
    assert saved["warnings"] == [UNTIL_SYNC_ONE]
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == NEW_ORDER_STEPS and after["problems"] == [] and after["auto"] is True
    assert after["game_mode_order"] == NEW_ORDER
    assert await staffel_steps(flow, w) == ANLAGE_B, "passt noch nicht zur Staffel - sie behält ihre"
    assert await follows(flow, sid) == 2
    log = await flow.db.audit_logs.find_one({"action": "league.season.veto_rules", "target_id": sid, "data.via": "auto"},
                                            {"_id": 0}, sort=[("created_at", -1)])
    assert log["data"]["from"]["steps"] == ANLAGE_B and log["data"]["to"]["steps"] == NEW_ORDER_STEPS
    assert log["data"]["staffeln"] == 0 and log["data"]["kept"] == 1
    assert not veto_codes(ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["problems"])
    result = await sync(flow, sid)
    assert "veto" in result["applied"] and "veto_rules" in result["changed"] and not veto_skip(result)
    assert await staffel_steps(flow, w) == NEW_ORDER_STEPS
    # Ein Speichern ohne neue Modusfolge oder neues Best of zieht nichts nach.
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"name": "Season mit neuem Namen"}))
    again = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    assert await follows(flow, sid) == 2 and again["warnings"] == []


@pytest.mark.asyncio
async def test_an_untouched_template_follows_a_new_best_of(flow):
    """Nr. 199: Best of 5 → 3 (Modusfolge frei) - die Vorlage belegt danach genau die drei Positionen; die Staffel bekommt sie mit dem
    Übertragen (vorher spielt sie noch Best of 5)."""
    w = await season_world(flow, order=[])
    sid = w["season"]["id"]
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 3}))
    assert saved["warnings"] == [UNTIL_SYNC_ONE]
    after = await template(flow, sid)
    assert after["best_of"] == 3 and after["veto_rules"]["steps"] == BO3_STEPS and after["problems"] == [] and after["auto"] is True
    assert await staffel_steps(flow, w) == ANLAGE_B and await follows(flow, sid) == 2
    await sync(flow, sid)
    assert await staffel_steps(flow, w) == BO3_STEPS
    assert (await tournament_of_staffel(flow, w))["best_of"] == 3


@pytest.mark.asyncio
async def test_a_staffel_with_a_result_keeps_its_template_and_says_so(flow):
    """Nr. 200 (#2528, Muss M1): Nach dem ersten Ergebnis überträgt „Übertragen“ kein neues Best of mehr. Die Staffel behält ihre
    Vorlage - beim Speichern der Serie und beim Übertragen - und beide Antworten sagen es."""
    w = await season_world(flow, order=[])
    sid = w["season"]["id"]
    await with_result(flow, w["tid"])
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 3}))
    assert saved["warnings"] == [KEEPS_BO5]
    assert (await template(flow, sid))["veto_rules"]["steps"] == BO3_STEPS
    assert await staffel_steps(flow, w) == ANLAGE_B
    result = await sync(flow, sid)
    assert veto_skip(result) == [KEEPS_BO5] and "veto" not in result["applied"]
    assert [row["group"] for row in result["skipped"] if row["group"] == "before_result"] == ["before_result"]
    staffel = await tournament_of_staffel(flow, w)
    assert staffel["veto_rules"]["steps"] == ANLAGE_B and staffel["best_of"] == 5
    # Die Vorlage der Staffel passt weiter zu ihr - das Veto läuft dort.
    pool = await map_pools.current(flow.db, "tournament", w["tid"])
    assert league_veto_rules.fits_problem(staffel["veto_rules"], pool=pool, best_of=5, order=staffel.get("game_mode_order"),
                                          repeat="other_mode") is None


@pytest.mark.asyncio
async def test_after_a_result_the_next_match_still_gets_a_running_veto(flow):
    """Muss M1 am Spiel: Die Staffel hat schon ein Ergebnis und spielt Best of 5, die Season wechselt auf Best of 3. Das nächste Spiel
    bekommt beim Check-in ein laufendes Veto nach der bisherigen Vorlage - nicht ``skipped``."""
    world = await veto_world(flow, rules={**veto_rules(), league_veto_rules.AUTO: True})
    season_id = world["season_id"]
    await flow.db.leagues.update_one({"id": "liga"}, {"$set": {"id": "liga", "game_id": "probe-shooter"}}, upsert=True)
    await flow.db.league_seasons.insert_one({"id": season_id, "league_id": "liga", "best_of": 5, "game_mode_order": list(ORDER),
                                             "veto_rules": {**veto_rules(), league_veto_rules.AUTO: True}})
    await flow.db.map_pools.insert_one({"id": new_id(), "scope": "league_season", "scope_id": season_id, "version": 1,
                                        "game_id": "probe-shooter", "modes": BO5_POOL, "created_at": now_utc().isoformat()})
    await with_result(flow, world["tournament"]["id"])
    await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"best_of": 3, "game_mode_order": [HP, SND, CTL]}})
    followed = await league_veto.follow_season(flow.db, season_id, actor_id=None)
    assert followed.rules["steps"] == league_veto_rules.propose(order=[HP, SND, CTL], pool={"modes": BO5_POOL}, best_of=3)
    assert len(followed.notes) == 1 and "spielt weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage." in followed.notes[0]
    assert (await tournament_of(flow, world))["veto_rules"]["steps"] == ANLAGE_B
    await both_in(flow, world)
    veto = await stored_veto(flow, world)
    assert veto["status"] == "running" and veto["template"]["steps"] == ANLAGE_B and veto["best_of"] == 5


@pytest.mark.asyncio
async def test_a_custom_template_stays_and_only_says_what_no_longer_fits(flow):
    """Selbst angepasst (einmal „Veto speichern“): Modusfolge und Best of ändern nichts an der Vorlage, der Kasten und „Was fehlt noch?“
    nennen, was nicht mehr passt."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    custom = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(team_a="draw", step_seconds=90)))
    assert custom["auto"] is False and custom["warnings"] == []
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    kept = await template(flow, sid)
    assert kept["veto_rules"]["steps"] == ANLAGE_B and kept["veto_rules"]["team_a"] == "draw" and kept["auto"] is False
    assert "Schritt 3: Auf Position 1 wird laut „Modus je Map“ Suchen gespielt, nicht Stellung." in kept["problems"]
    named = veto_codes(ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["problems"])
    assert named and set(named) == {"veto_invalid"} and len(named) == len(kept["problems"])
    assert await staffel_steps(flow, w) == ANLAGE_B and await follows(flow, sid) == 1

    free = await season_world(flow, order=[])
    fid = free["season"]["id"]
    ok(await flow.put(f"{ADMIN}/seasons/{fid}/veto-rules", json=veto_rules()))
    ok(await flow.patch(f"{ADMIN}/seasons/{fid}", json={"best_of": 3}))
    kept = await template(flow, fid)
    assert kept["veto_rules"]["steps"] == ANLAGE_B and kept["auto"] is False
    assert "Schritt 4: Position 4 gibt es bei Best of 3 nicht." in kept["problems"] and await follows(flow, fid) == 1


@pytest.mark.asyncio
async def test_saving_by_hand_also_only_reaches_staffeln_it_fits(flow):
    """Nr. 200 gilt auch für „Veto speichern“: Eine Vorlage zur neuen Modusfolge geht erst mit dem Übertragen auf die Staffel."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(team_a="draw")))
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    saved = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(NEW_ORDER_STEPS)))
    assert saved["staffeln_updated"] == 0 and saved["warnings"] == [UNTIL_SYNC_ONE]
    assert (await tournament_of_staffel(flow, w))["veto_rules"]["team_a"] == "draw"
    await sync(flow, sid)
    assert (await tournament_of_staffel(flow, w))["veto_rules"] == veto_rules(NEW_ORDER_STEPS)
    # Aus geht immer, auch wenn die Staffel etwas anderes spielt.
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": ORDER}))
    off = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(NEW_ORDER_STEPS, enabled=False)))
    assert off["staffeln_updated"] == 1 and off["warnings"] == []


@pytest.mark.asyncio
async def test_a_switched_off_or_legacy_template_never_follows(flow):
    """Aus geschaltet (von Hand gespeichert) oder ältere Season ohne Feld: Modusfolge und Best of lassen die Vorlage, wie sie ist."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(enabled=False)))
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    assert (await template(flow, sid))["veto_rules"]["enabled"] is False and await follows(flow, sid) == 1
    await flow.db.league_seasons.update_one({"id": sid}, {"$unset": {"veto_rules": ""}})
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": ORDER}))
    assert (await template(flow, sid))["veto_rules"] is None and await follows(flow, sid) == 1


# ---------------------------------------------------------------- Liga N mit anderem Best of (Nr. 106)

@pytest.mark.asyncio
async def test_a_league_n_keeps_a_fitting_template_and_only_a_league_n_without_one_is_told(flow):
    """Nr. 200 ohne Ausnahme (Fabian 18.11.): Liga 1 spielt Best of 5 (eigenes Best of), die Season wechselt auf Best of 3 - Liga 1
    behält ihre passende Vorlage, dort läuft das Veto weiter, die Warnung sagt es; „dort läuft kein Veto“ kommt nicht. Nr. 106 bleibt:
    Eine Liga N, deren Best of schon immer abwich (Liga 2), hat keine passende Vorlage - nur dort sagt „Was fehlt noch?“ „kein Veto“."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.patch(f"{ADMIN}/divisions/{w['division']['id']}", json={"overrides": {"best_of": 5}}))
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 3}))
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == BO3_STEPS and after["problems"] == [] and after["auto"] is True
    assert saved["warnings"] == [KEEPS_BO5]
    assert await staffel_steps(flow, w) == ANLAGE_B
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    assert not veto_codes(ready["problems"]) and not [row for row in ready["warnings"] if row["code"] == "veto_division_mismatch"]
    # Liga 2 entsteht jetzt mit eigenem Best of 5 - ihre Staffel bekommt die Vorlage der Season (Best of 3), die passt dort nicht.
    second = ok(await flow.post(f"{ADMIN}/seasons/{sid}/divisions", json={"overrides": {"best_of": 5}}))
    ok(await flow.post(f"{ADMIN}/divisions/{second['id']}/staffeln", json={}))
    gap = ("Liga 2 spielt Best of 5, die Veto-Vorlage belegt 3 Positionen – dort läuft kein Veto, die Maps werden beim Ergebnis "
           "eingetragen.")
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    assert [row["text"] for row in ready["warnings"] if row["code"] == "veto_division_mismatch"] == [gap]
    # Zurück auf Best of 5: Liga 1 hatte die Vorlage schon, Liga 2 spielt selbst Best of 5 - sie passt dort sofort. Keine Warnung, keine
    # Lücke mehr.
    back = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 5}))
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B and back["warnings"] == []
    assert await staffel_steps(flow, w) == ANLAGE_B
    liga2 = await flow.db.tournaments.find_one({"league_context.division_id": second["id"]}, {"_id": 0, "veto_rules": 1})
    assert liga2["veto_rules"]["steps"] == ANLAGE_B
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    assert not [row for row in ready["warnings"] if row["code"] == "veto_division_mismatch"]


@pytest.mark.asyncio
async def test_a_league_n_with_its_own_best_of_and_a_result_keeps_its_veto(flow):
    """Fabians Fall zu Nr. 200: Liga 1 hat ein eigenes Best of 5 und schon ein Ergebnis, die Season wechselt auf Best of 3. Liga 1 behält
    ihre Vorlage, das nächste Spiel bekommt beim Check-in ein laufendes Veto; „Was fehlt noch?“ sagt kein „dort läuft kein Veto“."""
    world = await veto_world(flow, rules={**veto_rules(), league_veto_rules.AUTO: True})
    season_id = world["season_id"]
    await flow.db.leagues.update_one({"id": "liga"}, {"$set": {"id": "liga", "game_id": "probe-shooter"}}, upsert=True)
    division = {"id": "liga-1", "season_id": season_id, "league_id": "liga", "level": 1, "status": "active", "overrides": {"best_of": 5}}
    await flow.db.league_divisions.update_one({"id": "liga-1"}, {"$set": division}, upsert=True)
    await flow.db.league_seasons.insert_one({"id": season_id, "league_id": "liga", "best_of": 5, "game_mode_order": list(ORDER),
                                             "veto_rules": {**veto_rules(), league_veto_rules.AUTO: True}})
    await flow.db.map_pools.insert_one({"id": new_id(), "scope": "league_season", "scope_id": season_id, "version": 1,
                                        "game_id": "probe-shooter", "modes": BO5_POOL, "created_at": now_utc().isoformat()})
    await with_result(flow, world["tournament"]["id"])
    await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"best_of": 3, "game_mode_order": [HP, SND, CTL]}})
    followed = await league_veto.follow_season(flow.db, season_id, actor_id=None)
    assert followed.notes == ["Liga 1 · Staffel A spielt weiter Best of 5 – dort bleibt die bisherige Veto-Vorlage."]
    assert (await tournament_of(flow, world))["veto_rules"]["steps"] == ANLAGE_B
    season = await flow.db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    assert await league_veto_fit.division_veto_gaps(flow.db, season, [division]) == []
    await both_in(flow, world)
    veto = await stored_veto(flow, world)
    assert veto["status"] == "running" and veto["template"]["steps"] == ANLAGE_B and veto["best_of"] == 5


@pytest.mark.asyncio
async def test_three_staffeln_are_named_in_one_sentence(flow):
    """Zusammengefasst (Fabian 18.11.): drei Staffeln ohne Ergebnis - ein Satz „in 3 Staffeln“; mit Ergebnis ein Satz mit drei Namen."""
    w = await season_world(flow, order=[])
    sid = w["season"]["id"]
    for _ in range(2):
        ok(await flow.post(f"{ADMIN}/divisions/{w['division']['id']}/staffeln", json={}))
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 3}))
    assert saved["warnings"] == ["In 3 Staffeln gilt die neue Veto-Vorlage erst nach „Vorgaben auf Staffeln übertragen“."]
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 5}))
    for row in await flow.db.tournaments.find({"league_context.season_id": sid}, {"_id": 0, "id": 1}).to_list(None):
        await with_result(flow, row["id"])
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 3}))
    assert saved["warnings"] == ["Liga 1 · Staffel A, Liga 1 · Staffel B und Liga 1 · Staffel C spielen weiter Best of 5 – dort bleibt die "
                                 "bisherige Veto-Vorlage."]


@pytest.mark.asyncio
async def test_a_new_pool_after_the_first_result_still_reaches_the_staffel_with_the_transfer(flow):
    """K1: Nach dem ersten Ergebnis geht der Pool beim Übertragen trotzdem mit - eine Vorlage, die mit dem Pool der Season und dem Best
    of der Staffel aufgeht, heißt „bis zum Übertragen“, nicht „bleibt“, und kommt mit dem Übertragen."""
    w = await season_world(flow, pool=SMALLER)
    sid = w["season"]["id"]
    before = await staffel_steps(flow, w)
    await with_result(flow, w["tid"])
    saved = ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, FULL)))
    assert UNTIL_SYNC_ONE in saved["warnings"] and not [text for text in saved["warnings"] if "bleibt" in text]
    fresh = (await template(flow, sid))["veto_rules"]["steps"]
    assert fresh == ANLAGE_B != before and await staffel_steps(flow, w) == before
    result = await sync(flow, sid)
    assert "veto" in result["applied"] and not veto_skip(result)
    assert await staffel_steps(flow, w) == fresh


# ---------------------------------------------------------------- Pool entfernen, abgeschlossen, Sperren

@pytest.mark.asyncio
async def test_clearing_the_pool_also_lets_the_template_follow(flow):
    """K3: „Map-Pool entfernen“ zieht ebenfalls nach - ohne Pool wie beim Anlegen (nur Wahlen und Decider). Die Staffel hat ihre
    Pool-Kopie bis zum Übertragen und behält so lange ihre Vorlage; danach ist ihr Pool weg und die neue Vorlage kommt mit."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    cleared = ok(await flow.delete(f"{ADMIN}/seasons/{sid}/map-pool"))
    assert cleared["warnings"] == [UNTIL_SYNC_ONE]
    after = await template(flow, sid)
    assert after["auto"] is True and after["veto_rules"]["steps"] == league_veto_rules.propose(order=ORDER, pool=None, best_of=5)
    assert await staffel_steps(flow, w) == ANLAGE_B
    await sync(flow, sid)
    assert await staffel_steps(flow, w) == after["veto_rules"]["steps"]


@pytest.mark.asyncio
async def test_a_closed_staffel_keeps_its_template(flow):
    """K4: Eine abgeschlossene Staffel (Endstand steht) bekommt keine neue Vorlage - wie beim Übertragen."""
    w = await season_world(flow, pool={})
    sid = w["season"]["id"]
    before = await staffel_steps(flow, w)
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$set": {"final_table": {"rows": []}}})
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, FULL)))
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B
    assert await staffel_steps(flow, w) == before


@pytest.mark.asyncio
async def test_a_staffel_being_edited_is_told_and_gets_it_with_the_transfer(flow, monkeypatch):
    """K4: Hält gerade jemand die Turnier-Sperre der Staffel (etwa „Übertragen“), wartet das Nachziehen kurz und sagt es dann - die
    Staffel bekommt die Vorlage mit dem nächsten Übertragen."""
    w = await season_world(flow, pool={})
    sid = w["season"]["id"]
    monkeypatch.setattr(league_veto, "STAFFEL_WAIT_SECONDS", 0.2)
    async with mutation_lock(flow.db, tournament_write_resource(w["tid"]), wait_seconds=1, lease_seconds=30, retry_seconds=0.05):
        saved = ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, FULL)))
    assert f"{STAFFEL} wird gerade bearbeitet – dort gilt die neue Veto-Vorlage erst nach dem nächsten Übertragen." in saved["warnings"]
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B
    assert await staffel_steps(flow, w) != ANLAGE_B
    await sync(flow, sid)
    assert await staffel_steps(flow, w) == ANLAGE_B


@pytest.mark.asyncio
async def test_a_busy_template_lock_is_reported_instead_of_silently_skipped(flow, monkeypatch):
    """K1: Ist die Sperre der Vorlage belegt, sagen Serie und Pool es als Warnung - die Vorlage bleibt, wie sie ist."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    monkeypatch.setattr(league_veto, "TEMPLATE_WAIT_SECONDS", 0.2)
    async with mutation_lock(flow.db, league_season_veto_resource(sid), wait_seconds=1, lease_seconds=30, retry_seconds=0.05):
        ordered = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
        pooled = ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, SMALLER)))
        by_hand = await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(NEW_ORDER_STEPS))
    assert league_veto.FOLLOW_BUSY_NOTE in ordered["warnings"] and league_veto.FOLLOW_BUSY_NOTE in pooled["warnings"]
    assert by_hand.status_code == 409 and by_hand.json()["detail"] == league_veto.TEMPLATE_BUSY_DETAIL
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B
    # Danach noch einmal speichern: Die Vorlage zieht nach.
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": ORDER}))
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    assert (await template(flow, sid))["veto_rules"]["steps"] == await expected(flow, sid)


# ---------------------------------------------------------------- Kurz nacheinander und verschränkt

@pytest.mark.asyncio
async def test_pool_and_mode_order_saved_one_after_the_other_end_with_the_last_state(flow):
    """Pool und Modusfolge kurz nacheinander, in beiden Reihenfolgen: Am Ende passt die Vorlage zum letzten Stand - an der Season sofort,
    an der Staffel mit dem Übertragen."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, SMALLER)))
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == await expected(flow, sid) and after["problems"] == []
    await sync(flow, sid)
    assert await staffel_steps(flow, w) == after["veto_rules"]["steps"]

    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": ORDER}))
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, FULL)))
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == ANLAGE_B and after["problems"] == []
    await sync(flow, sid)
    assert await staffel_steps(flow, w) == ANLAGE_B


async def _held_store(monkeypatch):
    """Das erste Schreiben der Vorlage hält an, bis ``go`` gesetzt ist - so liegt ein zweites Speichern sicher dazwischen."""
    entered, go = asyncio.Event(), asyncio.Event()
    real = league_veto.store_template

    async def held(*args, **kwargs):
        if not entered.is_set():
            entered.set()
            await go.wait()
        return await real(*args, **kwargs)

    monkeypatch.setattr(league_veto, "store_template", held)
    return entered, go


@pytest.mark.asyncio
async def test_a_pool_saved_while_the_template_follows_the_mode_order_still_wins(flow, monkeypatch):
    """Verschränkt: Das Nachziehen zur neuen Modusfolge hat den alten Pool gelesen und schreibt gerade, da kommt der neue Pool. Die
    Sperre der Vorlage lässt das zweite Nachziehen warten - es liest danach beides frisch, die Vorlage passt zum letzten Stand."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    entered, go = await _held_store(monkeypatch)
    ordered = asyncio.create_task(flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    await asyncio.wait_for(entered.wait(), 10)
    pooled = asyncio.create_task(flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, SMALLER)))
    await asyncio.sleep(0.5)
    assert not pooled.done(), "das zweite Nachziehen wartet auf die Sperre der Vorlage"
    go.set()
    first, second = await asyncio.gather(ordered, pooled)
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == await expected(flow, sid) and after["problems"] == []
    assert after["veto_rules"]["steps"] != NEW_ORDER_STEPS, "nicht der Stand mit dem alten Pool"


@pytest.mark.asyncio
async def test_saving_by_hand_while_the_template_follows_keeps_the_own_template(flow, monkeypatch):
    """„Veto speichern“ während eines Nachziehens: Es wartet auf dieselbe Sperre - die eigene Vorlage bleibt, ohne Merker „unberührt“."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    entered, go = await _held_store(monkeypatch)
    ordered = asyncio.create_task(flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    await asyncio.wait_for(entered.wait(), 10)
    own = veto_rules(NEW_ORDER_STEPS, team_a="draw", step_seconds=90)
    by_hand = asyncio.create_task(flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=own))
    await asyncio.sleep(0.5)
    assert not by_hand.done(), "„Veto speichern“ wartet auf die Sperre der Vorlage"
    go.set()
    first, second = await asyncio.gather(ordered, by_hand)
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    after = await template(flow, sid)
    assert after["veto_rules"] == own and after["auto"] is False
    await sync(flow, sid)
    assert (await tournament_of_staffel(flow, w))["veto_rules"] == own


async def tournament_of_staffel(flow, world: dict) -> dict:
    return await flow.db.tournaments.find_one({"id": world["tid"]}, {"_id": 0})


# ---------------------------------------------------------------- Laufendes Veto

@pytest.mark.asyncio
async def test_a_running_veto_keeps_its_steps_when_the_template_follows(flow):
    """Nur die Vorlage der Season (und der Staffeln) ändert sich - ein Veto, das am Spiel schon läuft, behält seinen Schnappschuss und
    geht nach der alten Folge weiter."""
    world = await veto_world(flow, rules={**veto_rules(), league_veto_rules.AUTO: True})
    season_id = world["season_id"]
    await flow.db.leagues.update_one({"id": "liga"}, {"$set": {"id": "liga", "game_id": "probe-shooter"}}, upsert=True)
    await flow.db.league_seasons.insert_one({"id": season_id, "league_id": "liga", "best_of": 5, "game_mode_order": list(ORDER),
                                             "veto_rules": {**veto_rules(), league_veto_rules.AUTO: True}})
    await flow.db.map_pools.insert_one({"id": new_id(), "scope": "league_season", "scope_id": season_id, "version": 1,
                                        "game_id": "probe-shooter", "modes": BO5_POOL, "created_at": now_utc().isoformat()})
    await both_in(flow, world)
    first = await pick(flow, world, "Kapitaen", "map-glut", 1)
    assert first.status_code == 200, first.text
    before = await stored_veto(flow, world)
    assert before["status"] == "running" and before["step"] == 1 and before["template"]["steps"] == ANLAGE_B

    # Neue Modusfolge an Season und (wie nach dem Übertragen, noch ohne Ergebnis) an der Staffel.
    await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"game_mode_order": NEW_ORDER}})
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"game_mode_order": NEW_ORDER}})
    followed = await league_veto.follow_season(flow.db, season_id, actor_id=None)
    assert followed.rules and followed.rules["steps"] == NEW_ORDER_STEPS and followed.notes == []
    assert (await tournament_of(flow, world))["veto_rules"]["steps"] == NEW_ORDER_STEPS, "die Staffel hat die neue Vorlage"
    assert await stored_veto(flow, world) == before, "das laufende Veto bleibt unberührt"
    # Weiter nach der alten Folge: Schritt 2 ist „Team B sperrt Stellung“.
    block = await veto_block(flow, world, "Falke1")
    assert block["current"]["number"] == 2 and block["current"]["kind"] == "ban" and block["current"]["mode_label"] == "Stellung"
    second = await pick(flow, world, "Falke1", "map-turm", 2)
    assert second.status_code == 200, second.text
    assert (await stored_veto(flow, world))["template"]["steps"] == ANLAGE_B
