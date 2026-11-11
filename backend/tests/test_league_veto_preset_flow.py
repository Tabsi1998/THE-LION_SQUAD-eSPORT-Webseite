"""Veto-Schrittart „Vorgabe der Woche“ (#2326, Entscheidung Nr. 122; docs/LIGA.md D.3) über die echten Routen: Ablauf mit Vorgabe
(nicht sperrbar, nicht wählbar, an ihrer Position in ``planned_games``), fehlende Vorgabe (kein Start, Hinweis an die Leitung, nie eine
Wertung), Änderung nach dem Start, Spielwoche eines verschobenen Spiels, Verwaltung je Season (wählen, rotieren, fehlende Wochen,
Protokoll, Historie, Rechte) und Regelwerk. Erfundene Namen."""
import pathlib
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import duel  # noqa: E402
from league_rules_world import publish  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_rule_blocks, league_rules, league_veto, league_veto_sweep  # noqa: E402
from test_league_veto_flow import (  # noqa: E402
    ADMIN, ANLAGE_B, CTL, HP, SND, both_in, lead, mid, page, pick, play_anlage_b, season_world, step, stored_veto, veto_block,
    veto_rules, veto_world,
)

# Wie Anlage B, nur Map 3 (Kontrolle) gibt die Leitung je Spielwoche vor; davor sperrt Team A in Kontrolle eine Map.
WITH_PRESET = [*ANLAGE_B[:8], step("ban", CTL, "A"), step("preset", CTL, None, 3)]
# Die Züge der Seiten bis vor Kontrolle: HP Glut/Turm gesperrt, Hafen → 1, Nebel → 4; S&D Werk/Kai gesperrt, Turm → 2, Nebel → 5.
SIDE_MOVES = {0: "map-glut", 1: "map-turm", 2: "map-hafen", 3: "map-nebel", 4: "map-werk", 5: "map-kai", 6: "map-turm", 7: "map-nebel"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def preset(week: int, map_id: str, mode: str = CTL) -> dict:
    return {"week": week, "mode": mode, "map_id": map_id}


async def preset_world(flow, presets: list[dict] | None, *, rules=None, **fields) -> dict:
    """Die Veto-Welt (zwei Co-Teams, ein Spiel am Spieltag 1) mit einer Season, die die Vorgaben der Woche trägt."""
    world = await veto_world(flow, rules=veto_rules(WITH_PRESET) if rules is None else rules, **fields)
    season = {"id": world["season_id"], "league_id": "liga", "name": "Season 1", "created_at": now_utc().isoformat()}
    if presets is not None:
        season["veto_presets"] = presets
    await flow.db.league_seasons.insert_one(season)
    return world


async def set_presets(flow, world, presets: list[dict]) -> list[dict]:
    season = await flow.db.league_seasons.find_one({"id": world["season_id"]}, {"_id": 0})
    return await league_veto.store_presets(flow.db, season, presets, actor_id=world["lead"]["id"])


async def second_match(flow, world, *, matchday: int) -> dict:
    """Ein weiteres Spiel derselben Seiten in derselben Staffel - Termin jetzt, an einem anderen (oder demselben) Spieltag."""
    match = await duel(flow, world["tournament"], world["reg_a"], world["reg_h"], matchday=matchday)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"scheduled_at": now_utc().replace(microsecond=0).isoformat()}})
    return {**world, "match": match}


# ---------------------------------------------------------------- Ablauf mit Vorgabe

@pytest.mark.asyncio
async def test_the_veto_plays_the_preset_of_the_week_and_nobody_can_ban_or_pick_it(flow):
    world = await preset_world(flow, [preset(1, "map-kai"), preset(2, "map-ruine")])
    waiting = await veto_block(flow, world, "Kapitaen")
    assert waiting["status"] == "waiting" and waiting["blocked"] is None and waiting["week"] == 1, "vor dem Check-in schon sichtbar"
    assert [(row["mode_label"], row["position"], row["map_name"]) for row in waiting["presets"]] == [("Kontrolle", 3, "Kai")]
    await both_in(flow, world)
    veto = await stored_veto(flow, world)
    assert veto["status"] == "running" and veto["week"] == 1 and veto["presets"] == [{"mode": CTL, "map_id": "map-kai"}]
    assert (await flow.db.audit_logs.find_one({"action": "match.veto.start"}, {"_id": 0}))["data"]["presets"] == veto["presets"]
    block = await veto_block(flow, world, "Kapitaen")
    board = {row["mode"]: {item["map_id"]: (item["status"], item["position"]) for item in row["maps"]} for row in block["remaining"]}
    assert board[CTL] == {"map-hafen": ("open", None), "map-kai": ("preset", 3), "map-ruine": ("open", None)}, "von Anfang an als Vorgabe"
    assert board[SND]["map-kai"] == ("open", None), "in einem anderen Modus bleibt Kai wählbar (Wiederholung nur in anderem Modus)"
    assert block["presets"][0]["map_id"] == "map-kai" and block["week"] == 1 and block["blocked"] is None

    veto = await play_anlage_b(flow, world, SIDE_MOVES)
    assert veto["step"] == 8 and veto["status"] == "running"
    turn = await veto_block(flow, world, "Kapitaen")
    assert turn["current"]["kind"] == "ban" and turn["current"]["mode"] == CTL and turn["own_turn"] is True
    options = {row["map_id"]: (row["allowed"], row["hint"]) for row in turn["options"]}
    assert options == {"map-hafen": (True, None), "map-ruine": (True, None),
                       "map-kai": (False, "Kai ist die Vorgabe der Woche – weder sperrbar noch wählbar.")}
    refused = await pick(flow, world, "Kapitaen", "map-kai", veto["version"])
    assert refused.status_code == 422 and refused.json()["detail"] == "Kai ist die Vorgabe der Woche – weder sperrbar noch wählbar."
    done = await pick(flow, world, "Kapitaen", "map-ruine", veto["version"])
    assert done.status_code == 200 and done.json()["status"] == "done", "die Vorgabe setzt das System sofort - wie den Decider"
    veto = await stored_veto(flow, world)
    last = veto["steps"][-1]
    assert (last["kind"], last["map_id"], last["role"], last["via"], last["registration_id"], last["position"]) == (
        "preset", "map-kai", "preset", "auto", None, 3)
    planned = (await flow.reload(world["match"]))["planned_games"]
    assert [(row["position"], row["mode"], row["map_id"], row["role"]) for row in planned] == [
        (1, HP, "map-hafen", "picked"), (2, SND, "map-turm", "picked"), (3, CTL, "map-kai", "preset"), (4, HP, "map-nebel", "picked"),
        (5, SND, "map-nebel", "picked")]
    assert planned[2]["map_name"] == "Kai" and planned[2]["by_registration_id"] is None and planned[2]["mode_label"] == "Kontrolle"
    after = (await page(flow, world, "Kapitaen"))["checkin"]
    assert after["state"] == "ready" and after["veto"]["history"][-1]["kind"] == "preset" and after["veto"]["history"][-1]["map_name"] == "Kai"
    assert [row["status"] for row in after["veto"]["remaining"][2]["maps"]] == ["open", "preset", "banned"]


@pytest.mark.asyncio
async def test_with_never_the_preset_is_gone_from_every_mode_and_the_lead_cannot_undo_it(flow):
    from test_league_veto_flow import NEVER_POOL

    # Jede Map nur einmal je Serie: Hafen steht in Stellung und Kontrolle - als Vorgabe für Kontrolle ist sie in Stellung nicht wählbar.
    # Die Vorgabe steht hier als erster Schritt der Vorlage: Das System setzt sie gleich beim Start.
    first = [step("preset", CTL, None, 3), step("ban", HP, "A"), step("pick", HP, "A", 1), step("pick", HP, "B", 4), *ANLAGE_B[4:8]]
    world = await preset_world(flow, [preset(1, "map-hafen")], rules=veto_rules(first), pool=NEVER_POOL, repeat="never")
    await both_in(flow, world)
    veto = await stored_veto(flow, world)
    assert [(row["kind"], row["map_id"], row["via"]) for row in veto["steps"]] == [("preset", "map-hafen", "auto")] and veto["step"] == 1
    block = await veto_block(flow, world, "Kapitaen")
    board = {row["mode"]: {item["map_id"]: (item["status"], item["position"]) for item in row["maps"]} for row in block["remaining"]}
    assert board[CTL]["map-hafen"] == ("preset", 3) and board[HP]["map-hafen"] == ("elsewhere", 3)
    assert block["current"]["kind"] == "ban" and block["own_turn"] is True
    options = {row["map_id"]: (row["allowed"], row["hint"]) for row in block["options"]}
    assert options["map-hafen"] == (False, "Hafen ist die Vorgabe der Woche – weder sperrbar noch wählbar.") and options["map-glut"] == (True, None)
    # Schritte des Systems lassen sich nicht zurücknehmen - erst der Zug einer Seite; die Vorgabe bleibt dabei stehen.
    nothing = await lead(flow, world, "undo", veto["version"])
    assert nothing.status_code == 409 and "keinen Schritt" in nothing.json()["detail"]
    assert (await pick(flow, world, "Kapitaen", "map-glut", veto["version"])).status_code == 200
    undone = await lead(flow, world, "undo", (await stored_veto(flow, world))["version"])
    assert undone.status_code == 200
    after = await stored_veto(flow, world)
    assert [row["kind"] for row in after["steps"]] == ["preset"] and after["presets"] == [{"mode": CTL, "map_id": "map-hafen"}]


# ---------------------------------------------------------------- Fehlende Vorgabe

@pytest.mark.asyncio
async def test_without_the_preset_the_veto_does_not_start_and_the_lead_is_told_once(flow):
    world = await preset_world(flow, [preset(2, "map-kai")])
    waiting = await veto_block(flow, world, "Kapitaen")
    text = ("Für Spielwoche 1 steht die Vorgabe der Woche noch nicht – Kontrolle: Die Vorgabe der Woche fehlt. Das Veto beginnt erst, wenn die "
            "Liga-Leitung sie eingetragen hat.")
    assert waiting["status"] == "waiting" and waiting["blocked"] == {"week": 1, "text": text} and waiting["presets"] == []
    assert await flow.db.notifications.count_documents({"meta.reason": "veto_preset_missing"}) == 0, "vor dem Check-in kein Hinweis"
    await both_in(flow, world)
    stored = await flow.reload(world["match"])
    assert "veto" not in stored["flow"] and stored["flow"]["veto_wait"]["week"] == 1, "das Veto hat nicht begonnen"
    own = (await page(flow, world, "Kapitaen"))["checkin"]
    assert own["state"] == "veto" and own["can_start"] is False and own["start_hint"] == text
    assert own["veto"]["status"] == "waiting" and own["veto"]["blocked"]["text"] == text and own["veto"]["pick_hint"] == text
    flow.act_as(world["users"]["Kapitaen"])
    start = await flow.post(f"/api/matches/{mid(world)}/checkin/start", json={})
    assert start.status_code == 409
    move = await pick(flow, world, "Kapitaen", "map-glut", 0)
    assert move.status_code == 409 and "beginnt erst" in move.json()["detail"]
    # Hinweis an die Liga-Leitung: einmal je Person, Season und Spielwoche - auch nach weiteren Aufrufen der Seite.
    for _ in range(2):
        await page(flow, world, "Falke1")
    notes = await flow.db.notifications.find({"meta.reason": "veto_preset_missing"}, {"_id": 0}).to_list(20)
    assert world["lead"]["id"] in {row["user_id"] for row in notes} and len(notes) == len({row["user_id"] for row in notes})
    assert all(row["meta"]["dedupe_key"] == f"veto-preset-missing:{world['season_id']}:1" for row in notes)
    assert "Spielwoche 1" in notes[0]["body"] and "Kontrolle: Die Vorgabe der Woche fehlt." in notes[0]["body"]
    assert world["users"]["Kapitaen"]["id"] not in {row["user_id"] for row in notes}, "nur die Leitung"
    assert await flow.db.audit_logs.count_documents({"action": "match.veto.waiting"}) == 1
    assert await flow.db.notifications.count_documents({"meta.reason": "veto_start"}) == 0
    # Nie eine automatische Wertung: kein Ergebnis, kein Vorschlag „nicht erschienen“, das Spiel bleibt angesetzt.
    stored = await flow.reload(world["match"])
    assert stored["status"] == "scheduled" and not stored.get("results") and not stored.get("no_show_proposal") and not stored.get("planned_games")
    assert not stored.get("started_at")

    # Die Leitung trägt die Vorgabe nach: Das wartende Veto beginnt sofort, beide Seiten bekommen „Veto läuft“.
    await set_presets(flow, world, [preset(1, "map-ruine"), preset(2, "map-kai")])
    assert await league_veto_sweep.start_waiting(flow.db, world["season_id"]) == 1
    veto = await stored_veto(flow, world)
    assert veto["status"] == "running" and veto["presets"] == [{"mode": CTL, "map_id": "map-ruine"}]
    assert "veto_wait" not in (await flow.reload(world["match"]))["flow"]
    assert await flow.db.notifications.count_documents({"meta.reason": "veto_start"}) == 2
    assert await league_veto_sweep.start_waiting(flow.db, world["season_id"]) == 0, "ein zweiter Lauf findet nichts"


@pytest.mark.asyncio
async def test_with_the_preset_in_place_the_same_match_starts_at_once(flow):
    """Gegenprobe zur fehlenden Vorgabe: dieselbe Welt, nur mit Vorgabe für Spielwoche 1 - das Veto beginnt beim Check-in."""
    world = await preset_world(flow, [preset(1, "map-kai")])
    await both_in(flow, world)
    stored = await flow.reload(world["match"])
    assert stored["flow"]["veto"]["status"] == "running" and "veto_wait" not in stored["flow"]
    assert await flow.db.notifications.count_documents({"meta.reason": "veto_preset_missing"}) == 0
    assert await flow.db.audit_logs.count_documents({"action": "match.veto.waiting"}) == 0


@pytest.mark.asyncio
async def test_a_preset_that_left_the_pool_waits_and_a_match_without_week_runs_without_veto(flow):
    # Die vorgegebene Map steht nicht (mehr) im Pool des Modus: wie eine fehlende Vorgabe - kein Start, klarer Satz.
    world = await preset_world(flow, [preset(1, "map-glut")])
    await both_in(flow, world)
    block = await veto_block(flow, world, "Kapitaen")
    assert block["status"] == "waiting" and "Kontrolle: Die vorgegebene Map steht nicht im Pool des Modus." in block["blocked"]["text"]
    # Ein Spiel ohne Spieltag hat keine Spielwoche: Dort läuft kein Veto (wie bei einer Vorlage, die nicht passt), mit Grund.
    other = await preset_world(flow, [preset(1, "map-kai")], letter="B")
    await flow.db.matches_v2.update_one({"id": mid(other)}, {"$unset": {"round": "", "matchday_number": ""}})
    await both_in(flow, other)
    veto = await stored_veto(flow, other)
    assert veto["status"] == "skipped" and veto["skipped_reason"] == league_veto.NO_WEEK_DETAIL
    assert (await page(flow, other, "Kapitaen"))["checkin"]["state"] == "ready"


# ---------------------------------------------------------------- Änderung der Vorgabe, Spielwoche des Spieltags

@pytest.mark.asyncio
async def test_a_changed_preset_only_reaches_vetoes_that_have_not_begun(flow):
    world = await preset_world(flow, [preset(1, "map-kai"), preset(2, "map-hafen")])
    later = await second_match(flow, world, matchday=1)
    moved = await second_match(flow, world, matchday=2)
    await both_in(flow, world)
    assert (await stored_veto(flow, world))["presets"] == [{"mode": CTL, "map_id": "map-kai"}]

    changes = await set_presets(flow, world, [preset(1, "map-ruine"), preset(2, "map-hafen")])
    assert changes == [{"week": 1, "mode": CTL, "from": "map-kai", "to": "map-ruine"}]
    log = await flow.db.audit_logs.find_one({"action": "league.season.veto_presets"}, {"_id": 0})
    assert log["target_id"] == world["season_id"] and log["actor_id"] == world["lead"]["id"] and log["data"]["changes"] == changes
    assert log["data"]["from"][0]["map_id"] == "map-kai" and log["data"]["to"][0]["map_id"] == "map-ruine"
    assert await league_veto_sweep.start_waiting(flow.db, world["season_id"]) == 0

    # Das begonnene Veto bleibt bei Kai - auch nach einem Neustart durch die Leitung und bis zum Abschluss.
    running = await stored_veto(flow, world)
    assert running["presets"] == [{"mode": CTL, "map_id": "map-kai"}]
    assert (await veto_block(flow, world, "Kapitaen"))["presets"][0]["map_name"] == "Kai"
    assert (await pick(flow, world, "Kapitaen", "map-glut", running["version"])).status_code == 200
    restarted = await lead(flow, world, "restart", (await stored_veto(flow, world))["version"])
    assert restarted.status_code == 200 and (await stored_veto(flow, world))["presets"] == [{"mode": CTL, "map_id": "map-kai"}]
    await play_anlage_b(flow, world, SIDE_MOVES)
    final = await pick(flow, world, "Kapitaen", "map-hafen", (await stored_veto(flow, world))["version"])
    assert final.status_code == 200 and final.json()["status"] == "done"
    planned = (await flow.reload(world["match"]))["planned_games"]
    assert planned[2]["map_id"] == "map-kai" and planned[2]["role"] == "preset"
    # Auch das fertige Veto bleibt: eine weitere Änderung berührt weder Verlauf noch Spielreihenfolge.
    await set_presets(flow, world, [preset(1, "map-hafen"), preset(2, "map-hafen")])
    kept = await flow.reload(world["match"])
    assert kept["planned_games"] == planned and kept["flow"]["veto"]["presets"] == [{"mode": CTL, "map_id": "map-kai"}]
    assert (await veto_block(flow, world, "Kapitaen"))["presets"][0]["map_name"] == "Kai"

    # Das zweite Spiel derselben Woche hat noch nicht begonnen: Es bekommt die geltende Vorgabe.
    await both_in(flow, later)
    assert (await stored_veto(flow, later))["presets"] == [{"mode": CTL, "map_id": "map-hafen"}]
    # Verschobenes Spiel: Termin in Woche 1, aber Spieltag 2 - es gilt die Vorgabe seines Spieltags.
    await both_in(flow, moved)
    late = await stored_veto(flow, moved)
    assert late["week"] == 2 and late["presets"] == [{"mode": CTL, "map_id": "map-hafen"}]


# ---------------------------------------------------------------- Verwaltung je Season

def week_rows(answer: dict) -> dict:
    return {row["week"]: row["problems"] for row in answer["problems"]}


@pytest.mark.asyncio
async def test_the_lead_sets_rotates_and_reads_the_presets_per_week(flow):
    w = await season_world(flow)
    sid = w["season"]["id"]
    url = f"{ADMIN}/seasons/{sid}/veto-presets"
    # Ohne Schritt „Vorgabe der Woche“ gibt es nichts zu wählen - und nichts fehlt.
    plain = ok(await flow.get(url))
    assert plain["active"] is False and plain["modes"] == [] and plain["problems"] == [] and plain["rotation"] == []
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(WITH_PRESET)))
    fresh = ok(await flow.get(url))
    assert fresh["active"] is True and fresh["presets"] == [] and fresh["history"] == []
    # Staffelgröße 8, eine Runde: sieben Spieltage - Spielwoche 1 beginnt am ersten Tag der Season.
    assert [row["week"] for row in fresh["weeks"]] == [1, 2, 3, 4, 5, 6, 7]
    first_day = datetime.fromisoformat(w["season"]["start_date"]).astimezone(ZoneInfo("Europe/Vienna")).date()
    assert fresh["weeks"][0] == {"week": 1, "start_day": first_day.isoformat(), "end_day": (first_day + timedelta(days=6)).isoformat()}
    assert fresh["weeks"][1]["start_day"] == (first_day + timedelta(days=7)).isoformat()
    ids = {name: row["id"] for name, row in w["maps"].items()}
    assert fresh["modes"] == [{"mode": CTL, "label": "Kontrolle", "position": 3, "maps": [
        {"map_id": ids["Hafen"], "name": "Hafen"}, {"map_id": ids["Kai"], "name": "Kai"}, {"map_id": ids["Ruine"], "name": "Ruine"}]}]
    assert week_rows(fresh) == {week: ["Kontrolle: Die Vorgabe der Woche fehlt."] for week in range(1, 8)}, "sichtbar, welche Wochen fehlen"
    assert [(row["week"], row["map_id"]) for row in fresh["rotation"]] == [
        (1, ids["Hafen"]), (2, ids["Kai"]), (3, ids["Ruine"]), (4, ids["Hafen"]), (5, ids["Kai"]), (6, ids["Ruine"]), (7, ids["Hafen"])]
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    warning = next(row for row in ready["warnings"] if row["code"] == "veto_preset_missing")
    assert warning["text"].startswith("Veto: Für Spielwoche 1, 2, 3, 4, 5, 6 und 7 steht die Vorgabe der Woche noch nicht")
    assert not [row for row in ready["problems"] if row["code"].startswith("veto")], "eine Warnung - Veröffentlichen bleibt möglich"

    # Einzeln wählen: zwei Wochen gespeichert, die übrigen bleiben als fehlend sichtbar.
    part = ok(await flow.put(url, json={"presets": [preset(1, ids["Kai"]), preset(2, ids["Hafen"]), preset(3, "")]}))
    assert part["changed"] == 2 and part["vetoes_started"] == 0 and sorted(week_rows(part)) == [3, 4, 5, 6, 7]
    assert part["presets"] == [preset(1, ids["Kai"]), preset(2, ids["Hafen"])]
    assert (await flow.db.league_seasons.find_one({"id": sid}, {"_id": 0, "veto_presets": 1}))["veto_presets"] == part["presets"]
    log = await flow.db.audit_logs.find({"action": "league.season.veto_presets", "target_id": sid}, {"_id": 0}).to_list(10)
    assert len(log) == 1 and log[0]["actor_id"] == w["lead"]["id"] and log[0]["data"]["from"] == []
    assert log[0]["data"]["changes"] == [{"week": 1, "mode": CTL, "from": None, "to": ids["Kai"]}, {"week": 2, "mode": CTL, "from": None, "to": ids["Hafen"]}]
    assert len(part["history"]) == 1 and part["history"][0]["changes"] == log[0]["data"]["changes"] and part["history"][0]["by_name"]
    same = ok(await flow.put(url, json={"presets": part["presets"]}))
    assert same["changed"] == 0 and await flow.db.audit_logs.count_documents({"action": "league.season.veto_presets"}) == 1

    # „Rotiert automatisch durch den Pool“ füllt alle Wochen, danach einzeln änderbar - nichts fehlt mehr.
    rotated = [*fresh["rotation"][:4], preset(5, ids["Ruine"]), *fresh["rotation"][5:]]
    full = ok(await flow.put(url, json={"presets": rotated}))
    # Sieben Zeilen ändern sich: Woche 1 und 2 tauschen die Map, Woche 3 bis 7 kommen dazu. Die jüngste Änderung steht oben.
    assert full["problems"] == [] and full["changed"] == 7 and len(full["history"]) == 2 and len(full["history"][0]["changes"]) == 7
    assert full["history"][0]["changes"][0] == {"week": 1, "mode": CTL, "from": ids["Kai"], "to": ids["Hafen"]}
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    assert not [row for row in ready["warnings"] if row["code"] == "veto_preset_missing"]

    # Was nicht geht - jeweils ein deutscher Satz, nichts wird gespeichert.
    table = {
        "Map nicht im Pool des Modus": ([preset(1, ids["Glut"])], "Spielwoche 1: Die Map steht nicht im Pool für Kontrolle."),
        "Woche gibt es nicht": ([preset(8, ids["Kai"])], "Spielwoche 8 gibt es in dieser Season nicht."),
        "Modus ohne Vorgabe": ([preset(1, ids["Hafen"], HP)], "Spielwoche 1: Für Stellung sieht die Veto-Vorlage keine Vorgabe der Woche vor."),
        "doppelt": ([preset(1, ids["Kai"]), preset(1, ids["Hafen"])], "Spielwoche 1: je Modus nur eine Vorgabe."),
        "Woche null": ([preset(0, ids["Kai"])], "Spielwoche: erlaubt sind 1 bis 60."),
    }
    for name, (rows, sentence) in table.items():
        refused = await flow.put(url, json={"presets": rows})
        assert refused.status_code == 422 and refused.json()["detail"] == sentence, (name, refused.text)
    assert ok(await flow.get(url))["presets"] == full["presets"]

    # Fällt eine vorgegebene Map aus dem Pool, nennt die Übersicht die Wochen - das Veto dort beginnt erst nach der Korrektur.
    ok(await flow.post(f"{ADMIN}/seasons/{sid}/map-pool/remove-map", json={"map_id": ids["Ruine"], "mode": CTL, "reason": "Ruine ist kaputt"}))
    broken = ok(await flow.get(url))
    assert week_rows(broken) == {week: ["Kontrolle: Die vorgegebene Map steht nicht im Pool des Modus."] for week in (3, 5, 6)}


@pytest.mark.asyncio
async def test_only_the_season_capability_may_change_the_presets(flow):
    w = await season_world(flow)
    sid = w["season"]["id"]
    url = f"{ADMIN}/seasons/{sid}/veto-presets"
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(WITH_PRESET)))
    kai = w["maps"]["Kai"]["id"]
    reader = await flow.add_user(name="Spielbetreuung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": reader["id"], "capabilities": ["matches"],
                                           "created_at": now_utc().isoformat()})
    flow.act_as(reader)
    assert (await flow.get(url)).status_code == 200, "lesen darf jede Zuständigkeit der Liga"
    denied = await flow.put(url, json={"presets": [preset(1, kai)]})
    assert denied.status_code == 403
    stranger = await flow.add_user(name="Fremd")
    flow.act_as(stranger)
    assert (await flow.get(url)).status_code == 403 and (await flow.put(url, json={"presets": [preset(1, kai)]})).status_code == 403
    assert await flow.db.audit_logs.count_documents({"action": "league.season.veto_presets"}) == 0, "nichts gespeichert"
    # Gegenprobe: mit „Season konfigurieren“ geht es.
    manager = await flow.add_user(name="Seasonleitung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": w["league"]["id"], "user_id": manager["id"], "capabilities": ["season"],
                                           "created_at": now_utc().isoformat()})
    flow.act_as(manager)
    saved = await flow.put(url, json={"presets": [preset(1, kai)]})
    assert saved.status_code == 200 and saved.json()["changed"] == 1
    assert (await flow.db.audit_logs.find_one({"action": "league.season.veto_presets"}, {"_id": 0}))["actor_id"] == manager["id"]


# ---------------------------------------------------------------- Regelwerk

@pytest.mark.asyncio
async def test_the_rule_block_describes_the_preset_and_the_variable_lists_the_weeks(flow):
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(WITH_PRESET)))
    ids = {name: row["id"] for name, row in w["maps"].items()}
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-presets", json={"presets": [preset(1, ids["Kai"]), preset(2, ids["Hafen"])]}))
    version = await publish(flow, w, body="# Veto\n\n[[baustein:veto]]\n\nVorgaben: {{veto.presets}}.\n", reason="Vorgabe der Woche aufgenommen")
    assert "veto" in version["blocks_used"] and "veto.presets" in version["vars_used"]
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"visibility": "admins"}))
    league_doc = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season_doc = await flow.db.league_seasons.find_one({"id": sid}, {"_id": 0})
    rules_page = ok(await flow.get(f"/api/league-rules/seasons/{w['league']['slug']}/{season_doc['slug']}"))
    body = league_rule_blocks.plain("\n".join(row["body_md"] for row in rules_page["sections"]))
    assert "Die Liga-Leitung gibt Map 3 je Spielwoche vor" in body
    assert "Vorgabe der Woche: Wo die Schrittfolge es nennt, legt die Liga-Leitung die Map je Spielwoche fest." in body
    # Der Wert der Variable steht als Klartext im Satz - Klammern sind dort für Markdown maskiert.
    assert r"Vorgaben: Spielwoche 1: Kai \(Kontrolle\); Spielwoche 2: Hafen \(Kontrolle\)." in body
    assert await league_rules.data_changes(flow.db, league_doc, season_doc, version) is None, "nichts geändert"
    # Eine neue Vorgabe ändert nur die Variable - der Baustein (die Regel selbst) bleibt.
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-presets", json={"presets": [preset(1, ids["Ruine"]), preset(2, ids["Hafen"])]}))
    season_doc = await flow.db.league_seasons.find_one({"id": sid}, {"_id": 0})
    changes = await league_rules.data_changes(flow.db, league_doc, season_doc, version)
    assert {(row["kind"], row["block"]) for row in changes["rows"]} == {("variable", "veto.presets")}
    # Gegenprobe: ohne den Schritt gibt es weder den Satz noch einen Wert der Variable.
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(ANLAGE_B)))
    season_doc = await flow.db.league_seasons.find_one({"id": sid}, {"_id": 0})
    from services import league_rule_facts, league_rule_vars

    assert "Vorgabe der Woche" not in league_rule_facts.render_veto(league_rule_facts.veto_data(season_doc, w["game"]))
    ctx = await league_rule_vars.context(flow.db, league_doc, season_doc)
    assert league_rule_vars.value_of("veto.presets", ctx) is None
