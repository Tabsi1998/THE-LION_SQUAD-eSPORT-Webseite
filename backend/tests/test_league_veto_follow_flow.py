"""Unberührte Veto-Vorlage folgt Pool, „Modus je Map“ und Best of (Fabian Nr. 108 und Nr. 199, #2528, docs/LIGA.md D.3) - über die
echten Routen: Modusfolge und Best of mit unberührter und mit eigener Vorlage, Liga N mit anderem Best of (Nr. 106), zwei Speicherungen
kurz nacheinander und verschränkt, „Veto speichern“ gegen ein gleichzeitiges Nachziehen und ein laufendes Veto, das seinen Stand behält.
Erfundene Namen."""
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
from services import league_veto, league_veto_rules, map_pools  # noqa: E402
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


# ---------------------------------------------------------------- Modusfolge und Best of

@pytest.mark.asyncio
async def test_an_untouched_template_follows_a_new_mode_order(flow):
    """Nr. 199: Wie beim Pool zieht die unberührte Vorlage nach, sobald „Modus je Map“ gespeichert wird - Season, Staffeln, Protokoll."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B and await follows(flow, sid) == 1
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    assert "game_mode_order" in saved["changed"]
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == NEW_ORDER_STEPS and after["problems"] == [] and after["auto"] is True
    assert after["game_mode_order"] == NEW_ORDER
    assert await staffel_steps(flow, w) == NEW_ORDER_STEPS, "sofort auf die Staffeln wie beim Pool"
    assert await follows(flow, sid) == 2
    log = await flow.db.audit_logs.find_one({"action": "league.season.veto_rules", "target_id": sid, "data.via": "auto"},
                                            {"_id": 0}, sort=[("created_at", -1)])
    assert log["data"]["from"]["steps"] == ANLAGE_B and log["data"]["to"]["steps"] == NEW_ORDER_STEPS
    assert not veto_codes(ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["problems"])
    # Ein Speichern ohne neue Modusfolge oder neues Best of zieht nichts nach.
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"name": "Season mit neuem Namen"}))
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    assert await follows(flow, sid) == 2


@pytest.mark.asyncio
async def test_an_untouched_template_follows_a_new_best_of(flow):
    """Nr. 199: Best of 5 → 3 (Modusfolge frei) - die Vorlage belegt danach genau die drei Positionen."""
    w = await season_world(flow, order=[])
    sid = w["season"]["id"]
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 3}))
    after = await template(flow, sid)
    assert after["best_of"] == 3 and after["veto_rules"]["steps"] == BO3_STEPS and after["problems"] == [] and after["auto"] is True
    assert await staffel_steps(flow, w) == BO3_STEPS and await follows(flow, sid) == 2


@pytest.mark.asyncio
async def test_a_custom_template_stays_and_only_says_what_no_longer_fits(flow):
    """Selbst angepasst (einmal „Veto speichern“): Modusfolge und Best of ändern nichts an der Vorlage, der Kasten und „Was fehlt noch?“
    nennen, was nicht mehr passt."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    custom = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(team_a="draw", step_seconds=90)))
    assert custom["auto"] is False
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
async def test_a_league_n_with_another_best_of_gets_no_veto_and_is_told(flow):
    """Liga 1 spielt Best of 5, die Season wechselt auf Best of 3: Die Vorlage folgt der Season (drei Positionen), in Liga 1 läuft kein
    Veto. Das Speichern meldet es als Warnung, „Was fehlt noch?“ ebenso - kein Problem, das das Veröffentlichen aufhält."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.patch(f"{ADMIN}/divisions/{w['division']['id']}", json={"overrides": {"best_of": 5}}))
    saved = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 3}))
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == BO3_STEPS and after["problems"] == [] and after["auto"] is True
    sentence = ("Liga 1 spielt Best of 5, die Veto-Vorlage belegt 3 Positionen – dort läuft kein Veto, die Maps werden beim Ergebnis "
                "eingetragen.")
    assert sentence in saved["warnings"]
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    assert not veto_codes(ready["problems"])
    assert [row["text"] for row in ready["warnings"] if row["code"] == "veto_division_mismatch"] == [sentence]
    # Am Spiel der Liga 1 (Best of 5) passt die Vorlage nicht - dort läuft kein Veto, die Maps kommen beim Ergebnis.
    pool = await map_pools.current(flow.db, "league_season", sid)
    assert league_veto_rules.fits_problem(after["veto_rules"], pool=pool, best_of=5, order=ORDER, repeat="other_mode")
    # Zurück auf Best of 5: Vorlage wieder für fünf Maps, keine Warnung mehr.
    back = ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"best_of": 5}))
    assert (await template(flow, sid))["veto_rules"]["steps"] == ANLAGE_B and not [text for text in back["warnings"] if "Veto" in text]
    assert not [row for row in ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["warnings"] if row["code"] == "veto_division_mismatch"]


# ---------------------------------------------------------------- Kurz nacheinander und gleichzeitig

@pytest.mark.asyncio
async def test_pool_and_mode_order_saved_one_after_the_other_end_with_the_last_state(flow):
    """Pool und Modusfolge kurz nacheinander, in beiden Reihenfolgen und gleichzeitig: Am Ende passt die Vorlage zum letzten Stand."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, SMALLER)))
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == await expected(flow, sid) and after["problems"] == []

    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": ORDER}))
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, FULL)))
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == ANLAGE_B and after["problems"] == []

    pooled, ordered = await asyncio.gather(flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, SMALLER)),
                                           flow.patch(f"{ADMIN}/seasons/{sid}", json={"game_mode_order": NEW_ORDER}))
    assert pooled.status_code == 200 and ordered.status_code == 200, (pooled.text, ordered.text)
    after = await template(flow, sid)
    assert after["veto_rules"]["steps"] == await expected(flow, sid) and after["problems"] == []
    assert await staffel_steps(flow, w) == after["veto_rules"]["steps"]


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
    go.set()
    first, second = await asyncio.gather(ordered, by_hand)
    assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
    after = await template(flow, sid)
    assert after["veto_rules"] == own and after["auto"] is False
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

    await flow.db.league_seasons.update_one({"id": season_id}, {"$set": {"game_mode_order": NEW_ORDER}})
    followed = await league_veto.follow_season(flow.db, season_id, actor_id=None)
    assert followed and followed["steps"] == NEW_ORDER_STEPS
    assert (await tournament_of(flow, world))["veto_rules"]["steps"] == NEW_ORDER_STEPS, "die Staffel hat die neue Vorlage"
    assert await stored_veto(flow, world) == before, "das laufende Veto bleibt unberührt"
    # Weiter nach der alten Folge: Schritt 2 ist „Team B sperrt Stellung“.
    block = await veto_block(flow, world, "Falke1")
    assert block["current"]["number"] == 2 and block["current"]["kind"] == "ban" and block["current"]["mode_label"] == "Stellung"
    second = await pick(flow, world, "Falke1", "map-turm", 2)
    assert second.status_code == 200, second.text
    assert (await stored_veto(flow, world))["template"]["steps"] == ANLAGE_B
