"""Liga-Veto (#1618, docs/LIGA.md D.3) über die echten Routen: Vorlage je Season (gültig und ungültig), ganzer BO5-Durchlauf nach
Anlage B ohne Seitenwahl, Zeitablauf mit gültiger Zufallswahl, doppelte und gleichzeitige Züge, falsche Seite, fremdes Team, Pause und
Eingriff der Leitung mit Befangenheit, stabiles Los, Abschluss mit ``planned_games`` und Meldeformular, Seasons ohne Vorlage,
Datenschutz, Zeit-Job und Baustein. Erfundene Namen."""
import asyncio
import pathlib
import random
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import checked_in, ids, world as league_world  # noqa: E402
from league_rules_world import publish  # noqa: E402
from league_start_world import ok  # noqa: E402
from models import now_utc  # noqa: E402
from routes import dsgvo_routes  # noqa: E402
from services import (  # noqa: E402
    account_erasure, league_rule_blocks, league_rule_facts, league_rule_vars, league_rules, league_schedule_sweep, league_veto,
    league_veto_sweep, match_deadline_sweep, match_flow,
)
from services.checkin_rules import DEFAULTS as CHECKIN_DEFAULTS  # noqa: E402
from services.league_schedule import DEFAULTS as SCHEDULE_DEFAULTS  # noqa: E402
from services.match_public_view import public_match_view  # noqa: E402

CHECKIN = {**CHECKIN_DEFAULTS, "min_present": 2}
HP, SND, CTL = "stellung", "suchen", "kontrolle"
ORDER = [HP, SND, CTL, HP, SND]


def m(slug: str) -> dict:
    return {"map_id": f"map-{slug}", "slug": slug, "name": slug.title(), "image_url": f"/uploads/maps/{slug}.webp"}


BO5_POOL = [
    {"mode": HP, "label": "Stellung", "maps": [m("hafen"), m("nebel"), m("turm"), m("glut")]},
    {"mode": SND, "label": "Suchen", "maps": [m("nebel"), m("turm"), m("kai"), m("werk")]},
    {"mode": CTL, "label": "Kontrolle", "maps": [m("hafen"), m("kai"), m("ruine")]},
]


# Für „jede Map nur einmal je Serie“: Hafen steht in Stellung und Kontrolle, Suchen hat eigene Maps.
NEVER_POOL = [
    {"mode": HP, "label": "Stellung", "maps": [m("hafen"), m("nebel"), m("turm"), m("glut")]},
    {"mode": SND, "label": "Suchen", "maps": [m("kai"), m("werk"), m("dock"), m("see")]},
    {"mode": CTL, "label": "Kontrolle", "maps": [m("hafen"), m("ruine"), m("halle")]},
]


def step(kind, mode, team=None, position=None):
    return {"kind": kind, "mode": mode, "team": team, "position": position}


# Anlage B (BO5): HP ban A, ban B, pick A → 1, pick B → 4; S&D ban B, ban A, pick B → 2, pick A → 5; Modus 3 ban A, ban B, decider → 3.
ANLAGE_B = [
    step("ban", HP, "A"), step("ban", HP, "B"), step("pick", HP, "A", 1), step("pick", HP, "B", 4),
    step("ban", SND, "B"), step("ban", SND, "A"), step("pick", SND, "B", 2), step("pick", SND, "A", 5),
    step("ban", CTL, "A"), step("ban", CTL, "B"), step("decider", CTL, None, 3),
]


def veto_rules(steps=ANLAGE_B, **extra) -> dict:
    return {"enabled": True, "team_a": "home", "step_seconds": 60, "steps": steps, **extra}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await instance.db.mutation_locks.create_index("resource", unique=True)
    try:
        yield instance
    finally:
        await shutdown()


def at(minutes: float) -> str:
    return (now_utc() + timedelta(minutes=minutes)).replace(microsecond=0).isoformat()


async def veto_world(flow, *, rules: dict | None = None, pool=BO5_POOL, best_of: int = 5, order=ORDER, repeat: str = "other_mode",
                     letter: str = "A", **fields) -> dict:
    """Die Spielwelt (zwei Co-Teams, ein Spiel) mit Check-in, BO5-Pool und Veto-Vorlage; Termin jetzt (Fenster offen)."""
    world = await league_world(flow, letter=letter)
    tournament = world["tournament"]
    update = {"checkin_rules": dict(CHECKIN), "best_of": best_of, "game_mode_order": list(order), "map_repeat": repeat, **fields}
    if rules is not None:
        update["veto_rules"] = rules
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": update})
    await flow.db.map_pools.insert_one({"id": new_id(), "scope": "tournament", "scope_id": tournament["id"], "tournament_id": tournament["id"],
                                        "version": 2, "game_id": "probe-shooter", "modes": pool, "created_at": now_utc().isoformat()})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": at(0), "status": "scheduled"}})
    lead = await flow.add_user(name="Ligaleitung")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": lead["id"], "capabilities": ["matches", "results"],
                                           "created_at": now_utc().isoformat()})
    world["lead"] = lead
    world["pool_id"] = (await flow.db.map_pools.find_one({"scope_id": tournament["id"], "version": 2}, {"_id": 0, "id": 1}))["id"]
    return world


def mid(world) -> str:
    return world["match"]["id"]


async def tournament_of(flow, world) -> dict:
    return await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})


async def checkin(flow, world, user: str, *names: str):
    flow.act_as(world["users"][user])
    return await flow.post(f"/api/matches/{mid(world)}/checkin", json={"present": ids(world, *names)})


async def both_in(flow, world) -> None:
    assert (await checkin(flow, world, "Kapitaen", "Kapitaen", "Mila")).status_code == 200
    assert (await checkin(flow, world, "Falke1", "Falke1", "Falke2")).status_code == 200


async def page(flow, world, user) -> dict:
    flow.act_as(user if isinstance(user, dict) or user is None else world["users"][user])
    answer = await flow.get(f"/api/matches/{mid(world)}/page")
    assert answer.status_code == 200, answer.text
    return answer.json()


async def veto_block(flow, world, user) -> dict:
    return (await page(flow, world, user))["checkin"]["veto"]


async def pick(flow, world, user, map_id: str, version: int):
    flow.act_as(user if isinstance(user, dict) else world["users"][user])
    return await flow.post(f"/api/matches/{mid(world)}/veto/pick", json={"map_id": map_id, "version": version})


async def lead(flow, world, action: str, version: int, reason: str = "Technische Störung bei einem Team", user=None, **extra):
    flow.act_as(user or world["lead"])
    return await flow.post(f"/api/matches/{mid(world)}/veto/lead", json={"action": action, "reason": reason, "version": version, **extra})


async def stored_veto(flow, world) -> dict:
    return (await flow.reload(world["match"]))["flow"]["veto"]


def captain_of(world, registration_id: str) -> str:
    return "Kapitaen" if registration_id == world["reg_a"]["id"] else "Falke1"


async def play_anlage_b(flow, world, choices: dict[int, str]) -> dict:
    """Die Züge der Seiten nach Anlage B - ``choices``: Schrittindex → Map; der Decider kommt vom System."""
    veto = await stored_veto(flow, world)
    for index, map_id in sorted(choices.items()):
        step = veto["template"]["steps"][index]
        side = veto["team_a"] if step["team"] == "A" else veto["team_b"]
        answer = await pick(flow, world, captain_of(world, side), map_id, veto["version"])
        assert answer.status_code == 200, (index, answer.text)
        veto = await stored_veto(flow, world)
        assert veto["step"] == index + 1 or veto["status"] == "done", (index, veto["step"])
    return veto


# ---------------------------------------------------------------- Durchlauf nach Anlage B

@pytest.mark.asyncio
async def test_a_full_bo5_run_after_anlage_b_lands_every_pick_in_its_slot(flow):
    world = await veto_world(flow, rules=veto_rules())
    assert (await page(flow, world, "Kapitaen"))["checkin"]["veto"]["status"] == "waiting", "vor dem Check-in wartet das Veto"
    await both_in(flow, world)
    stored = await flow.reload(world["match"])
    veto = stored["flow"]["veto"]
    assert veto["status"] == "running" and veto["step"] == 0 and veto["version"] == 1 and veto["team_a"] == world["reg_a"]["id"]
    assert veto["team_a_via"] == "home" and veto["map_pool_id"] == world["pool_id"] and veto["best_of"] == 5 and veto["draw"] is None
    assert veto["for_at"] == stored["scheduled_at"] and veto["deadline_at"] > now_utc().isoformat()
    assert "flow" not in public_match_view(stored), "das Veto bleibt intern"
    notes = await flow.db.notifications.find({"meta.reason": "veto_start"}, {"_id": 0}).to_list(10)
    assert {row["user_id"]: row["title"] for row in notes} == {world["users"]["Kapitaen"]["id"]: "Veto läuft – ihr seid am Zug",
                                                              world["users"]["Falke1"]["id"]: "Veto läuft"}
    assert (await flow.db.notifications.find_one({"meta.reason": "checkin_ready"}, {"_id": 0}))["body"].endswith("danach beginnt Map 1.")

    own = (await page(flow, world, "Kapitaen"))["checkin"]
    assert own["state"] == "veto" and own["can_start"] is False and "Veto" in own["start_hint"]
    block = own["veto"]
    assert block["status"] == "running" and block["own_turn"] is True and block["can_pick"] is True and block["pick_hint"] is None
    assert block["current"]["number"] == 1 and block["current"]["total"] == 11 and block["current"]["kind"] == "ban"
    assert block["current"]["mode_label"] == "Stellung" and block["current"]["name"] == "Loewen · Rudel A"
    assert 0 < block["current"]["remaining_seconds"] <= 60 and block["step_seconds"] == 60
    assert [row["map_id"] for row in block["options"] if row["allowed"]] == ["map-hafen", "map-nebel", "map-turm", "map-glut"]
    other = (await veto_block(flow, world, "Falke1"))
    assert other["own_turn"] is False and other["can_pick"] is False and other["pick_hint"] == "Jetzt ist Loewen · Rudel A am Zug."
    assert (await page(flow, world, "Fremd"))["checkin"] is None
    assert "Erst das Veto abschließen" in (await page(flow, world, "Kapitaen"))["report_hint"]

    # HP: A sperrt Glut, B sperrt Turm, A wählt Hafen → 1, B wählt Nebel → 4; S&D: B sperrt Werk, A sperrt Kai, B wählt Turm → 2,
    # A wählt Nebel → 5; Modus 3: A sperrt Ruine, B sperrt Kai, Decider Hafen → 3.
    veto = await play_anlage_b(flow, world, {0: "map-glut", 1: "map-turm", 2: "map-hafen", 3: "map-nebel", 4: "map-werk", 5: "map-kai",
                                             6: "map-turm", 7: "map-nebel", 8: "map-ruine", 9: "map-kai"})
    assert veto["status"] == "done" and veto["step"] == 11 and veto["finished_at"] and veto["deadline_at"] is None
    assert [row["via"] for row in veto["steps"]] == ["side"] * 10 + ["auto"] and veto["steps"][-1]["kind"] == "decider"
    assert [row["role"] for row in veto["steps"]][:3] == ["banned", "banned", "picked"]
    stored = await flow.reload(world["match"])
    planned = stored["planned_games"]
    assert [(row["position"], row["mode"], row["map_id"], row["role"]) for row in planned] == [
        (1, HP, "map-hafen", "picked"), (2, SND, "map-turm", "picked"), (3, CTL, "map-hafen", "decider"), (4, HP, "map-nebel", "picked"),
        (5, SND, "map-nebel", "picked")]
    assert planned[0]["map_name"] == "Hafen" and planned[0]["map_image_url"] == "/uploads/maps/hafen.webp" and planned[0]["mode_label"] == "Stellung"
    assert planned[0]["by_registration_id"] == world["reg_a"]["id"] and planned[2]["by_registration_id"] is None
    assert stored["map_pool_id"] == world["pool_id"]
    assert public_match_view(stored)["planned_games"] == planned, "die Spielreihenfolge ist öffentlich"
    assert await flow.db.audit_logs.count_documents({"action": "match.veto.step"}) == 11
    assert await flow.db.audit_logs.count_documents({"action": "match.veto.done"}) == 1
    assert await flow.db.notifications.count_documents({"meta.reason": "veto_done"}) == 2

    after = (await page(flow, world, "Kapitaen"))["checkin"]
    assert after["state"] == "ready" and after["can_start"] is True and after["report_hint" if False else "state"] == "ready"
    assert after["veto"]["status"] == "done" and after["veto"]["planned_games"] == planned and len(after["veto"]["history"]) == 11
    assert after["veto"]["history"][2] == {"index": 2, "kind": "pick", "mode_label": "Stellung", "name": "Loewen · Rudel A", "map_name": "Hafen",
                                           "position": 1, "via": "side", "at": veto["steps"][2]["at"]}
    assert [row["status"] for row in after["veto"]["remaining"][0]["maps"]] == ["picked", "picked", "banned", "banned"]
    league = (await page(flow, world, "Kapitaen"))["league"]
    assert [row["map_id"] for row in league["planned_games"]] == [row["map_id"] for row in planned]
    flow.act_as(world["users"]["Kapitaen"])
    started = await flow.post(f"/api/matches/{mid(world)}/checkin/start", json={})
    assert started.status_code == 200 and started.json()["idempotent_replay"] is False


# ---------------------------------------------------------------- Zeit, Zufall, Vervollständigbarkeit

@pytest.mark.asyncio
async def test_after_the_time_the_system_picks_a_valid_map_and_the_job_is_idempotent(flow):
    world = await veto_world(flow, rules=veto_rules(step_seconds=30))
    await both_in(flow, world)
    tournament = await tournament_of(flow, world)
    later = now_utc() + timedelta(seconds=31)
    untouched = await league_veto_sweep.sweep(flow.db, [tournament], now=now_utc() + timedelta(seconds=5))
    assert untouched == {"auto": 0}, "die Frist läuft noch"
    done = await league_veto_sweep.sweep(flow.db, [tournament], now=later)
    assert done == {"auto": 1}
    veto = await stored_veto(flow, world)
    assert veto["step"] == 1 and veto["steps"][0]["via"] == "auto" and veto["steps"][0]["by"] is None and veto["steps"][0]["kind"] == "ban"
    assert veto["steps"][0]["map_id"] in {"map-hafen", "map-nebel", "map-turm", "map-glut"}
    assert veto["deadline_at"] == (later + timedelta(seconds=30)).isoformat(), "die nächste Frist beginnt jetzt, nie an der alten gekettet"
    assert await league_veto_sweep.sweep(flow.db, [tournament], now=later) == {"auto": 0}, "ein zweiter Lauf findet nichts"
    full = await match_deadline_sweep.sweep(flow.db, now=later + timedelta(seconds=31))
    assert full["veto"] == {"auto": 1}, "der Fristen-Job nimmt denselben Lauf mit"
    # Auch das Lesen der Matchseite räumt eine abgelaufene Frist auf - niemand wartet auf den Job.
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"flow.veto.deadline_at": (now_utc() - timedelta(seconds=1)).isoformat()}})
    block = await veto_block(flow, world, "Kapitaen")
    assert block["current"]["number"] == 4 and len(block["history"]) == 3
    # Mit „jede Map nur einmal je Serie“ schränkt allein die Vervollständigbarkeit ein: Kontrolle hat Hafen, Ruine, Halle und braucht alle
    # drei (zwei Sperren, Decider) - wird Hafen in Stellung gespielt, geht Kontrolle nicht mehr auf. Also muss Hafen in Stellung gesperrt
    # werden, nie gewählt; die zweite Sperre ist damit erzwungen. Direkt am Dienst mit festem Zufall, viele Durchläufe.
    for seed in range(12):
        second = await veto_world(flow, rules=veto_rules(step_seconds=30), repeat="never", pool=NEVER_POOL, letter=f"N{seed}")
        await both_in(flow, second)
        # Je Ablauf wählt das System genau einen Schritt, der nächste bekommt seine volle Zeit - also Lauf für Lauf.
        settled, rng, staffel = await flow.reload(second["match"]), random.Random(seed), await tournament_of(flow, second)
        for tick in range(1, 13):
            settled = await league_veto.settle_due(flow.db, settled, staffel, now=now_utc() + timedelta(seconds=31 * tick), rng=rng)
        steps = settled["flow"]["veto"]["steps"]
        assert settled["flow"]["veto"]["status"] == "done" and len(steps) == 11, settled["flow"]["veto"].get("skipped_reason")
        played = {(row["mode"], row["map_id"]) for row in steps if row["kind"] != "ban"}
        assert (HP, "map-hafen") not in played, (seed, played)
        assert len({row["map_id"] for row in steps if row["kind"] != "ban"}) == 5, "jede Map nur einmal je Serie"
        assert steps[-1]["kind"] == "decider" and steps[-1]["map_id"] in {"map-hafen", "map-ruine", "map-halle"}


# ---------------------------------------------------------------- Doppelt, gleichzeitig, falsche Seite, fremdes Team

@pytest.mark.asyncio
async def test_double_and_parallel_moves_the_wrong_side_and_strangers(flow):
    world = await veto_world(flow, rules=veto_rules())
    await both_in(flow, world)
    wrong = await pick(flow, world, "Falke1", "map-hafen", 1)
    assert wrong.status_code == 409 and wrong.json()["detail"] == "Jetzt ist Loewen · Rudel A am Zug."
    stranger = await pick(flow, world, "Fremd", "map-hafen", 1)
    assert stranger.status_code == 403
    member = await pick(flow, world, "Tom", "map-hafen", 1)
    assert member.status_code == 403, "nur Captain oder Vertreter"
    flow.act_as(world["lead"])
    as_lead = await flow.post(f"/api/matches/{mid(world)}/veto/pick", json={"map_id": "map-hafen", "version": 1})
    assert as_lead.status_code == 403, "die Leitung zieht nicht - nach Ablauf wählt das System"
    foreign_map = await pick(flow, world, "Kapitaen", "map-kai", 1)
    assert foreign_map.status_code == 422 and "nicht freigegeben" in foreign_map.json()["detail"]
    stale = await pick(flow, world, "Kapitaen", "map-hafen", 0)
    assert stale.status_code == 409 and stale.json()["detail"] == league_veto.CHANGED_DETAIL

    first = await pick(flow, world, "Kapitaen", "map-glut", 1)
    assert first.status_code == 200 and first.json() == {"version": 2, "step": 1, "status": "running", "idempotent_replay": False}
    again = await pick(flow, world, "Kapitaen", "map-glut", 1)
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True, "Doppelklick oder zweites Gerät"
    other_map = await pick(flow, world, "Kapitaen", "map-turm", 1)
    assert other_map.status_code == 409 and other_map.json()["detail"] == league_veto.CHANGED_DETAIL
    banned_again = await pick(flow, world, "Falke1", "map-glut", 2)
    assert banned_again.status_code == 422 and "schon gesperrt oder gewählt" in banned_again.json()["detail"]
    assert (await stored_veto(flow, world))["step"] == 1

    # Gleichzeitig am Dienst, derselbe gelesene Stand: genau ein Zug kommt durch, der andere bekommt „bitte neu laden“.
    tournament = await tournament_of(flow, world)
    stale_match = await flow.reload(world["match"])

    async def attempt(coroutine):
        try:
            return await coroutine
        except match_flow.FlowProblem as problem:
            return problem

    both = await asyncio.gather(
        attempt(league_veto.pick(flow.db, stale_match, tournament, registration_id=world["reg_h"]["id"], map_id="map-turm", version=2,
                                 user=world["users"]["Falke1"])),
        attempt(league_veto.pick(flow.db, stale_match, tournament, registration_id=world["reg_h"]["id"], map_id="map-nebel", version=2,
                                 user=world["users"]["Falke1"])))
    assert sorted(type(answer).__name__ for answer in both) == ["FlowProblem", "dict"], both
    veto = await stored_veto(flow, world)
    assert veto["step"] == 2 and veto["version"] == 3 and veto["steps"][1]["map_id"] in {"map-turm", "map-nebel"}
    assert await flow.db.audit_logs.count_documents({"action": "match.veto.step"}) == 2, "nichts doppelt"
    # Ein Zug gegen den Ablauf: die Frist ist vorbei, das System hat schon gewählt - der späte Klick ist ein alter Stand.
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"flow.veto.deadline_at": (now_utc() - timedelta(seconds=1)).isoformat()}})
    late = await pick(flow, world, "Kapitaen", "map-hafen", 3)
    assert late.status_code == 409 and late.json()["detail"] == league_veto.CHANGED_DETAIL
    assert (await stored_veto(flow, world))["steps"][2]["via"] == "auto"


# ---------------------------------------------------------------- Leitung: Pause, Fortsetzen, zurück, neu, Befangenheit

@pytest.mark.asyncio
async def test_the_lead_pauses_resumes_undoes_and_restarts_with_reason_and_bias(flow):
    world = await veto_world(flow, rules=veto_rules())
    await both_in(flow, world)
    assert (await pick(flow, world, "Kapitaen", "map-glut", 1)).status_code == 200
    no_reason = await lead(flow, world, "pause", 2, reason="kurz")
    assert no_reason.status_code == 422 and "Grund" in no_reason.json()["detail"]
    unknown = await lead(flow, world, "stop", 2)
    assert unknown.status_code == 422
    paused = await lead(flow, world, "pause", 2)
    assert paused.status_code == 200 and paused.json()["status"] == "paused"
    veto = await stored_veto(flow, world)
    assert veto["status"] == "paused" and veto["deadline_at"] is None and 0 <= veto["paused"]["remaining_seconds"] <= 60
    assert veto["paused"]["reason"] == "Technische Störung bei einem Team" and veto["paused"]["by"] == world["lead"]["id"]
    blocked = await pick(flow, world, "Falke1", "map-turm", 3)
    assert blocked.status_code == 409 and "pausiert" in blocked.json()["detail"] and "Technische Störung" in blocked.json()["detail"]
    block = await veto_block(flow, world, "Falke1")
    assert block["status"] == "paused" and block["paused"]["reason"] == "Technische Störung bei einem Team" and block["can_pick"] is False
    assert (await page(flow, world, "Falke1"))["checkin"]["state"] == "veto"
    replay = await lead(flow, world, "pause", 2)
    assert replay.status_code == 200 and replay.json()["idempotent_replay"] is True
    tournament = await tournament_of(flow, world)
    assert await league_veto_sweep.sweep(flow.db, [tournament], now=now_utc() + timedelta(hours=1)) == {"auto": 0}, "pausiert läuft nichts ab"

    resumed = await lead(flow, world, "resume", 3, reason="Störung behoben")
    assert resumed.status_code == 200
    veto = await stored_veto(flow, world)
    assert veto["status"] == "running" and veto["deadline_at"] and veto["paused"] is None
    assert (await pick(flow, world, "Falke1", "map-turm", 4)).status_code == 200
    undone = await lead(flow, world, "undo", 5, reason="Falsche Map angetippt, beide Seiten einig")
    assert undone.status_code == 200
    veto = await stored_veto(flow, world)
    assert veto["step"] == 1 and [row["map_id"] for row in veto["steps"]] == ["map-glut"] and veto["status"] == "running"
    restarted = await lead(flow, world, "restart", 6, reason="Von vorn nach Absprache")
    assert restarted.status_code == 200
    veto = await stored_veto(flow, world)
    assert veto["step"] == 0 and veto["steps"] == [] and veto["team_a"] == world["reg_a"]["id"] and len(veto["lead_log"]) == 4
    log = await flow.db.audit_logs.find({"action": "match.veto.lead"}, {"_id": 0}).to_list(10)
    assert [row["data"]["action"] for row in log] == ["pause", "resume", "undo", "restart"] and all(row["actor_id"] == world["lead"]["id"] for row in log)

    # Befangen: der Captain mit „Spiele betreuen“ greift im eigenen Spiel nicht ein; der Superadmin nur mit Grund (Notausnahme).
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": world["users"]["Kapitaen"]["id"],
                                           "capabilities": ["matches"], "created_at": now_utc().isoformat()})
    biased = await lead(flow, world, "pause", 7, user=world["users"]["Kapitaen"])
    assert biased.status_code == 403 and "beteiligt" in biased.json()["detail"]
    no_right = await lead(flow, world, "pause", 7, user=world["users"]["Falke1"])
    assert no_right.status_code == 403
    await flow.db.team_squads.update_one({"id": world["squad_a"]["id"]}, {"$addToSet": {"member_ids": world["staff"]["id"]}})
    admin_biased = await lead(flow, world, "pause", 7, user=world["staff"])
    assert admin_biased.status_code == 403
    override = await lead(flow, world, "pause", 7, user=world["staff"], conflict_reason="Niemand sonst erreichbar")
    assert override.status_code == 200
    assert await flow.db.audit_logs.count_documents({"action": "league.conflict.override", "data.action": "veto_pause"}) == 1
    # Nach dem Undo bei „fertig“ fällt die Spielreihenfolge weg; nach dem Start ändert die Leitung nichts mehr.
    assert (await lead(flow, world, "resume", 8, reason="Weiter geht es")).status_code == 200
    veto = await play_anlage_b(flow, world, {0: "map-glut", 1: "map-turm", 2: "map-hafen", 3: "map-nebel", 4: "map-werk", 5: "map-kai",
                                             6: "map-turm", 7: "map-nebel", 8: "map-ruine", 9: "map-kai"})
    assert veto["status"] == "done" and (await flow.reload(world["match"]))["planned_games"]
    reopened = await lead(flow, world, "undo", veto["version"], reason="Decider nochmal prüfen")
    assert reopened.status_code == 200
    stored = await flow.reload(world["match"])
    assert stored["flow"]["veto"]["status"] == "running" and stored["flow"]["veto"]["step"] == 9 and "planned_games" not in stored
    veto = await play_anlage_b(flow, world, {9: "map-kai"})
    assert veto["status"] == "done"
    flow.act_as(world["users"]["Kapitaen"])
    assert (await flow.post(f"/api/matches/{mid(world)}/checkin/start", json={})).status_code == 200
    closed = await lead(flow, world, "undo", veto["version"], reason="Zu spät")
    assert closed.status_code == 409 and closed.json()["detail"] == league_veto.STARTED_DETAIL


# ---------------------------------------------------------------- Los, neuer Termin, Vorlage passt nicht

@pytest.mark.asyncio
async def test_the_draw_is_made_once_and_a_new_time_restarts_the_veto(flow):
    world = await veto_world(flow, rules=veto_rules(team_a="draw"))
    await both_in(flow, world)
    first = await stored_veto(flow, world)
    assert first["team_a_via"] == "draw" and first["draw"]["at"] and {first["team_a"], first["team_b"]} == {world["reg_a"]["id"], world["reg_h"]["id"]}
    for _ in range(5):
        assert (await veto_block(flow, world, "Kapitaen"))["team_a"]["registration_id"] == first["team_a"], "nie neu gelost beim Reload"
    assert (await stored_veto(flow, world))["draw"] == first["draw"]
    start_log = await flow.db.audit_logs.find_one({"action": "match.veto.start"}, {"_id": 0})
    assert start_log["data"]["team_a_via"] == "draw" and start_log["data"]["team_a"] == first["team_a"]
    assert (await lead(flow, world, "restart", 1, reason="Noch einmal von vorn")).status_code == 200
    assert (await stored_veto(flow, world))["team_a"] == first["team_a"], "ein Neustart lost nicht neu"

    # Ein neuer Termin der Leitung (E.1): die Check-ins zählen nicht mehr, das Veto gehört zum alten Termin.
    flow.act_as(world["lead"])
    moved = await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(3), "schedule_reason": "Anderer Termin"})
    assert moved.status_code == 200, moved.text
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] == "open" and block["veto"]["status"] == "waiting"
    await both_in(flow, world)
    second = await stored_veto(flow, world)
    assert second["started_at"] > first["started_at"] and second["step"] == 0 and second["version"] == 1


@pytest.mark.asyncio
async def test_a_template_that_does_not_fit_this_match_skips_the_veto_and_says_why(flow):
    world = await veto_world(flow, rules=veto_rules(), best_of=3, order=[HP, SND, CTL])
    await both_in(flow, world)
    veto = await stored_veto(flow, world)
    assert veto["status"] == "skipped" and veto["skipped_reason"].startswith("Schritt 4: Position 4 gibt es bei Best of 3 nicht.")
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] == "ready" and block["can_start"] is True and block["veto"]["status"] == "skipped"
    assert block["veto"]["pick_hint"].startswith("In diesem Spiel läuft kein Veto:")
    refused = await pick(flow, world, "Kapitaen", "map-hafen", 1)
    assert refused.status_code == 409 and "läuft kein Veto" in refused.json()["detail"]
    assert (await lead(flow, world, "pause", 1)).status_code == 409
    assert "planned_games" not in await flow.reload(world["match"])


# ---------------------------------------------------------------- Termin-Revision (Codex zu D.3), gesperrte Staffel

WEEK = {"start_date": (now_utc() - timedelta(days=1)).isoformat(), "schedule_rules": dict(SCHEDULE_DEFAULTS), "matchday_days": 7}


def rev_of(match: dict) -> int:
    return int(((match.get("flow") or {}).get("schedule_rev")) or 0)


async def seat(flow, world) -> dict:
    """Beide Seiten direkt eingecheckt (zum geltenden Termin und seiner Revision), dann startet der Seitenaufruf das Veto."""
    await checked_in(flow, mid(world))
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] == "veto" and block["veto"]["status"] == "running", block["state"]
    return block


async def expect_reset(flow, world, label: str, before_rev: int) -> None:
    """Nach einem Terminweg: die Revision ist um eins höher, alte Check-ins und das alte Veto zählen nicht mehr."""
    stored = await flow.reload(world["match"])
    assert rev_of(stored) == before_rev + 1, (label, rev_of(stored), before_rev)
    assert match_flow.missing_sides(stored) == [stored["slots"][0]["registration_id"], stored["slots"][1]["registration_id"]], label
    assert league_veto.rules_mod.veto_of(stored) is None, label
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] != "veto" and block["veto"]["status"] == "waiting" and block["sides"][0]["checked_in"] is False, label


@pytest.mark.asyncio
async def test_time_a_then_b_then_a_resets_checkins_and_the_veto(flow):
    """Codex zu D.3: Termin A → B → wieder genau A - alte Check-ins und das alte Veto gelten nicht wieder, weil beide an der
    Termin-Revision hängen, nicht nur am Zeitpunkt."""
    world = await veto_world(flow, rules=veto_rules())
    first = await seat(flow, world)
    stored = await flow.reload(world["match"])
    time_a, start_a = stored["scheduled_at"], stored["flow"]["veto"]["started_at"]
    assert stored["flow"]["checkin"][world["reg_a"]["id"]]["rev"] == 0 and stored["flow"]["veto"]["rev"] == 0
    flow.act_as(world["lead"])
    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(60), "schedule_reason": "B"})).status_code == 200
    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": time_a, "schedule_reason": "wieder A"})).status_code == 200
    stored = await flow.reload(world["match"])
    assert stored["scheduled_at"] == time_a and rev_of(stored) == 2
    assert match_flow.missing_sides(stored) == [world["reg_a"]["id"], world["reg_h"]["id"]], "A → B → A: die alten Check-ins zählen nicht"
    assert league_veto.rules_mod.veto_of(stored) is None, "das alte Veto zählt nicht"
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] == "open" and block["veto"]["status"] == "waiting"
    second = await seat(flow, world)
    fresh = await flow.reload(world["match"])
    assert fresh["flow"]["veto"]["started_at"] > start_a and fresh["flow"]["veto"]["version"] == 1 and fresh["flow"]["veto"]["rev"] == 2
    assert fresh["flow"]["checkin"][world["reg_a"]["id"]]["rev"] == 2 and fresh["flow"]["ready_rev"] == 2
    assert first["veto"]["status"] == second["veto"]["status"] == "running"
    # Altbestand ohne Revision zählt wie Revision 0 - und ein neuer Weg zu A hebt ihn auf.
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$unset": {"flow.schedule_rev": "", "flow.veto.rev": "", "flow.ready_rev": "",
                                                                        f"flow.checkin.{world['reg_a']['id']}.rev": "", f"flow.checkin.{world['reg_h']['id']}.rev": ""}})
    stored = await flow.reload(world["match"])
    assert not match_flow.missing_sides(stored) and league_veto.rules_mod.veto_of(stored) is not None


@pytest.mark.asyncio
async def test_every_way_to_a_new_time_raises_the_revision(flow):
    """Alle Terminwege aus D.2 erhöhen die Revision: Einigung, Verschiebung, Leitung, „Neu ansetzen“ (derselbe Termin!), 72-h-Regel,
    Standardtermin des Spieltag-Plans, Stationsplan."""
    from services.match_scheduler import apply_plan
    from services.matchday_schedule import persist_matchday_schedule

    world = await veto_world(flow, rules=veto_rules(), **WEEK)
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"scheduled_at": at(60)}})
    # Einigung
    await seat(flow, world)
    flow.act_as(world["users"]["Kapitaen"])
    offer = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(48 * 60)})
    assert offer.status_code == 200, offer.text
    flow.act_as(world["users"]["Falke1"])
    assert (await flow.post(f"/api/matches/{mid(world)}/schedule-proposals/{offer.json()['id']}/decision", json={"action": "accept"})).status_code == 200
    await expect_reset(flow, world, "Einigung", 0)
    # Verschiebung
    await seat(flow, world)
    flow.act_as(world["users"]["Kapitaen"])
    asked = await flow.post(f"/api/matches/{mid(world)}/reschedule", json={"scheduled_at": at(72 * 60), "reason": "Spieler im Nachtdienst"})
    assert asked.status_code == 200, asked.text
    flow.act_as(world["users"]["Falke1"])
    assert (await flow.post(f"/api/matches/{mid(world)}/reschedule/{asked.json()['id']}/decision", json={"action": "accept"})).status_code == 200
    await expect_reset(flow, world, "Verschiebung", 1)
    # Leitung
    await seat(flow, world)
    flow.act_as(world["lead"])
    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(96 * 60), "schedule_reason": "Nachholtermin"})).status_code == 200
    await expect_reset(flow, world, "Leitung", 2)
    # „Neu ansetzen“ (E.1): derselbe Termin - nur die Revision trennt alt von neu.
    await seat(flow, world)
    before_undo = (await flow.reload(world["match"]))["scheduled_at"]
    flow.act_as(world["lead"])
    url = f"/api/admin/leagues/staffeln/{world['tournament']['id']}/matches/{mid(world)}/double-no-show"
    assert (await flow.post(url, json={"note": "Beide Teams nicht in der Lobby"})).status_code == 200
    assert (await flow.client.request("DELETE", url, json={"reason": "Neuer Anlauf zum selben Termin"})).status_code == 200
    assert (await flow.reload(world["match"]))["scheduled_at"] == before_undo, "derselbe Termin bleibt stehen"
    await expect_reset(flow, world, "Neu ansetzen", 3)
    # 72-h-Regel
    other = await veto_world(flow, rules=veto_rules(), letter="B", **WEEK)
    await flow.db.matches_v2.update_one({"id": mid(other)}, {"$set": {"scheduled_at": None, "status": "ready"}})
    await seat(flow, other)
    flow.act_as(other["users"]["Kapitaen"])
    assert (await flow.post(f"/api/matches/{mid(other)}/schedule-proposals", json={"scheduled_at": at(100 * 60)})).status_code == 200
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, other)], now=now_utc() + timedelta(hours=73))
    assert counts["home_rule"] == 1
    await expect_reset(flow, other, "72-h-Regel", 0)
    # Spieltag-Plan (Standardtermin) und Stationsplan
    third = await veto_world(flow, rules=veto_rules(), letter="C", **WEEK)
    await flow.db.matches_v2.update_one({"id": mid(third)}, {"$set": {"scheduled_at": at(-60), "schedule_source": None}})
    await seat(flow, third)
    written = await persist_matchday_schedule(flow.db, await tournament_of(flow, third))
    assert written["written"] == 1 and (await flow.reload(third["match"]))["schedule_source"] == "default"
    await expect_reset(flow, third, "Spieltag-Plan", 0)
    await flow.db.matches_v2.update_one({"id": mid(third)}, {"$set": {"schedule_source": None}})
    await seat(flow, third)
    stored = await flow.reload(third["match"])
    station = {"id": new_id(), "name": "Tisch 1", "device_type": "pc", "tournament_id": third["tournament"]["id"], "status": "free",
               "current_match_id": None, "notes": None}
    await flow.db.stations.insert_one(dict(station))
    plan = {"assignments": [{"match_id": mid(third), "changed": True, "scheduled_at": at(3 * 60), "schedule_source": "planner",
                             "station_id": station["id"], "forecast": False,
                             "previous": {"scheduled_at": stored["scheduled_at"], "schedule_source": None, "status": stored["status"],
                                          "station_id": None}}]}
    assert (await apply_plan(flow.db, await tournament_of(flow, third), plan))["written"] == 1
    await expect_reset(flow, third, "Stationsplan", 1)


@pytest.mark.asyncio
async def test_releasing_the_schedule_raises_the_revision(flow):
    """Codex-Nachprüfung: „Terminplan freigeben“ nimmt den Termin weg - auch das ist ein Terminweg: alte Check-ins und das Veto
    zählen nicht mehr, nach dem nächsten Termin und erneutem Check-in beginnt es neu."""
    world = await veto_world(flow, rules=veto_rules(), **WEEK)
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"scheduled_at": at(60), "schedule_source": "manual"}})
    await seat(flow, world)
    flow.act_as(world["lead"])
    freed = await flow.post(f"/api/tournaments/{world['tournament']['id']}/schedule/release", json={"scope": "all"})
    assert freed.status_code == 200 and freed.json()["released"] == 1, freed.text
    stored = await flow.reload(world["match"])
    assert stored["scheduled_at"] is None and rev_of(stored) == 1, "Terminplan freigeben erhöht die Revision"
    assert match_flow.missing_sides(stored) == [world["reg_a"]["id"], world["reg_h"]["id"]] and league_veto.rules_mod.veto_of(stored) is None
    assert (await page(flow, world, "Kapitaen"))["checkin"]["state"] != "veto"


@pytest.mark.asyncio
async def test_a_lead_time_change_rolled_back_at_a_deleted_station_keeps_the_revision(flow, monkeypatch):
    """Codex-Nachprüfung: Termin und Station in einem PATCH, die Station wird zwischen Prüfung und Schreiben gelöscht - der Termin geht
    exakt zurück, also auch die Revision: alte Check-ins und das laufende Veto gelten weiter."""
    from routes import match_routes

    world = await veto_world(flow, rules=veto_rules(), **WEEK)
    await seat(flow, world)
    stored = await flow.reload(world["match"])
    station = {"id": new_id(), "name": "Tisch 1", "device_type": "pc", "tournament_id": world["tournament"]["id"], "status": "free",
               "current_match_id": None, "notes": None}
    await flow.db.stations.insert_one(dict(station))
    original = match_routes.ensure_station_open

    async def delete_in_between(db, station_id):
        await original(db, station_id)
        await flow.db.stations.update_one({"id": station_id}, {"$set": {"deleting": True}})

    monkeypatch.setattr(match_routes, "ensure_station_open", delete_in_between)
    flow.act_as(world["lead"])
    refused = await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(120), "station_id": station["id"], "schedule_reason": "Umzug"})
    assert refused.status_code == 409, refused.text
    assert await flow.reload(world["match"]) == stored, "exakt der Vorzustand, samt Termin-Revision"
    assert not match_flow.missing_sides(stored) and league_veto.rules_mod.veto_of(stored) is not None
    assert (await page(flow, world, "Kapitaen"))["checkin"]["state"] == "veto"


@pytest.mark.asyncio
async def test_a_locked_staffel_is_only_read(flow):
    """Codex zu D.3: Bei einer gesperrten Staffel schreibt der Seitenaufruf nichts - kein Start, keine Frist wird aufgelöst."""
    world = await veto_world(flow, rules=veto_rules(step_seconds=30))
    await checked_in(flow, mid(world))
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"locked_at": now_utc().isoformat()}})
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["veto"]["status"] == "waiting" and "veto" not in (await flow.reload(world["match"]))["flow"], "gesperrt: kein Start"
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$unset": {"locked_at": ""}})
    assert (await page(flow, world, "Kapitaen"))["checkin"]["veto"]["status"] == "running", "entsperrt: der nächste Aufruf startet"
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": {"locked_at": now_utc().isoformat()}})
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {"flow.veto.deadline_at": (now_utc() - timedelta(seconds=1)).isoformat()}})
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["veto"]["history"] == [] and block["veto"]["current"]["number"] == 1, "gesperrt: keine Zufallswahl beim Lesen"
    tournament = await tournament_of(flow, world)
    assert await league_veto_sweep.sweep(flow.db, [tournament]) == {"auto": 0}, "der Job schreibt bei Sperre nichts"
    settled = await league_veto.settle_due(flow.db, await flow.reload(world["match"]), tournament)
    assert (settled["flow"]["veto"].get("steps") or []) == []
    flow.act_as(world["users"]["Kapitaen"])
    assert (await flow.post(f"/api/matches/{mid(world)}/veto/pick", json={"map_id": "map-hafen", "version": 1})).status_code == 423
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$unset": {"locked_at": ""}})
    assert len((await page(flow, world, "Kapitaen"))["checkin"]["veto"]["history"]) == 1, "entsperrt: die Frist wird aufgelöst"


# Für „jede Map nur einmal je Serie“: Nebel steht in Stellung und Suchen, Suchen hat fünf Maps - eine davon darf anderswo laufen.
ELSEWHERE_POOL = [
    {"mode": HP, "label": "Stellung", "maps": [m("hafen"), m("nebel"), m("turm"), m("glut")]},
    {"mode": SND, "label": "Suchen", "maps": [m("nebel"), m("werk"), m("dock"), m("see"), m("kai")]},
    {"mode": CTL, "label": "Kontrolle", "maps": [m("hafen"), m("ruine"), m("halle")]},
]


@pytest.mark.asyncio
async def test_with_never_a_map_played_in_another_mode_is_shown_as_such(flow):
    world = await veto_world(flow, rules=veto_rules(), repeat="never", pool=ELSEWHERE_POOL)
    await both_in(flow, world)
    # Hafen muss in Stellung gesperrt werden (sonst fehlt Kontrolle eine Map) - die Prüfung lässt der Gastseite nur diese Sperre.
    assert (await pick(flow, world, "Kapitaen", "map-glut", 1)).status_code == 200
    block = await veto_block(flow, world, "Falke1")
    assert [row["map_id"] for row in block["options"] if row["allowed"]] == ["map-hafen"]
    assert (await pick(flow, world, "Falke1", "map-hafen", 2)).status_code == 200
    assert (await pick(flow, world, "Kapitaen", "map-nebel", 3)).status_code == 200
    assert (await pick(flow, world, "Falke1", "map-turm", 4)).status_code == 200
    block = await veto_block(flow, world, "Falke1")
    assert block["current"]["mode"] == SND and block["own_turn"] is True
    snd = next(row for row in block["remaining"] if row["mode"] == SND)
    nebel = next(row for row in snd["maps"] if row["map_id"] == "map-nebel")
    assert nebel["status"] == "elsewhere" and nebel["position"] == 1
    option = next(row for row in block["options"] if row["map_id"] == "map-nebel")
    assert option["allowed"] is False and "anderen Modus" in option["hint"]
    refused = await pick(flow, world, "Falke1", "map-nebel", 5)
    assert refused.status_code == 422 and "anderen Modus" in refused.json()["detail"]


# ---------------------------------------------------------------- Ergebnis nach dem Veto

@pytest.mark.asyncio
async def test_the_result_follows_the_planned_games_for_captains_but_not_for_the_lead(flow):
    from league_match_world import OLD_RULES, two_nil

    world = await veto_world(flow, rules=veto_rules(), scores_required=False, **OLD_RULES)
    await both_in(flow, world)
    await play_anlage_b(flow, world, {0: "map-glut", 1: "map-turm", 2: "map-hafen", 3: "map-nebel", 4: "map-werk", 5: "map-kai",
                                      6: "map-turm", 7: "map-nebel", 8: "map-ruine", 9: "map-kai"})
    flow.act_as(world["users"]["Kapitaen"])
    lineup = ids(world, "Kapitaen", "Mila")
    wrong = {**two_nil(world, lineup=lineup), "results": [
        {"registration_id": world["reg_a"]["id"], "rank": 1, "score": 3}, {"registration_id": world["reg_h"]["id"], "rank": 2, "score": 0}]}
    wrong["games"] = [{"position": 1, "mode": HP, "map_id": "map-nebel", "winner_registration_id": world["reg_a"]["id"], "lineup": lineup},
                      {"position": 2, "mode": SND, "map_id": "map-turm", "winner_registration_id": world["reg_a"]["id"], "lineup": lineup},
                      {"position": 3, "mode": CTL, "map_id": "map-hafen", "winner_registration_id": world["reg_a"]["id"], "lineup": lineup}]
    refused = await flow.post(f"/api/matches/{mid(world)}/report", json=wrong)
    assert refused.status_code == 422 and refused.json()["detail"] == "Map 1: laut Veto wird hier Hafen (Stellung) gespielt."
    right = {**wrong, "games": [{**wrong["games"][0], "map_id": "map-hafen"}, *wrong["games"][1:]]}
    reported = await flow.post(f"/api/matches/{mid(world)}/report", json=right)
    assert reported.status_code == 200, reported.text
    stored = await flow.reload(world["match"])
    assert stored["started_at"] and [row["map_id"] for row in stored["reports"][-1]["games"]] == ["map-hafen", "map-turm", "map-hafen"]
    # Die Leitung trägt frei ein (etwa nach einem Map-Fehler) - auch gegen die Reihenfolge.
    flow.act_as(world["lead"])
    free = await flow.post(f"/api/matches/{mid(world)}/result", json={
        "results": right["results"], "reason": "Map 1 lief wegen Fehler auf Nebel",
        "games": [{**game, "lineups": {}, "lineup": None} for game in wrong["games"]]})
    assert free.status_code == 200, free.text
    assert [row["map_id"] for row in (await flow.reload(world["match"]))["games"]] == ["map-nebel", "map-turm", "map-hafen"]


# ---------------------------------------------------------------- Ohne Vorlage, andere Formate, Datenschutz, Baustein

@pytest.mark.asyncio
async def test_without_a_template_nothing_changes_and_privacy_holds(flow):
    world = await veto_world(flow, rules=None)
    await both_in(flow, world)
    block = (await page(flow, world, "Kapitaen"))["checkin"]
    assert block["state"] == "ready" and block["veto"] is None and block["can_start"] is True and block["start_hint"] is None
    stored = await flow.reload(world["match"])
    assert "veto" not in (stored.get("flow") or {}) and "planned_games" not in stored
    assert (await pick(flow, world, "Kapitaen", "map-hafen", 0)).status_code == 409
    assert (await lead(flow, world, "pause", 0)).status_code == 409
    off = await veto_world(flow, rules=veto_rules(enabled=False), letter="B")
    await both_in(flow, off)
    assert (await page(flow, off, "Kapitaen"))["checkin"]["veto"] is None
    assert match_flow.veto_pending(await flow.reload(off["match"]), await tournament_of(flow, off)) is False
    # Ein Turnier ohne Liga kennt kein Veto, auch mit Feld.
    plain = await flow.create_tournament(team_mode="team", team_size=2, format="league", status="live", best_of=3, veto_rules=veto_rules(),
                                         checkin_rules=dict(CHECKIN))
    assert match_flow.veto_pending({"id": "x", "slots": []}, plain) is False

    # Datenschutz: der Captain sieht seine Züge, die Leitung ihren Eingriff; die Löschung nimmt die Kennungen heraus.
    live = await veto_world(flow, rules=veto_rules(), letter="C")
    await both_in(flow, live)
    assert (await pick(flow, live, "Kapitaen", "map-glut", 1)).status_code == 200
    assert (await lead(flow, live, "pause", 2)).status_code == 200
    captain = (await dsgvo_routes._user_data_export(flow.db, live["users"]["Kapitaen"]["id"]))["league_checkin"]
    own = next(row for row in captain if row["match_id"] == mid(live))
    assert {"role": "veto_step", "kind": "ban", "side": live["reg_a"]["id"], "at": own["steps"][-1]["at"]} in own["steps"]
    leader = (await dsgvo_routes._user_data_export(flow.db, live["lead"]["id"]))["league_checkin"]
    assert [row for row in leader[0]["steps"] if row["role"] == "veto_lead"] == [{"role": "veto_lead", "action": "pause", "at": leader[0]["steps"][-1]["at"]}]
    assert "Technische Störung" not in str(leader), "der Grund bleibt im Protokoll, nicht in der Auskunft"
    await account_erasure.erase_related(flow.db, live["users"]["Kapitaen"], now_utc().isoformat())
    await account_erasure.erase_related(flow.db, live["lead"], now_utc().isoformat())
    veto = await stored_veto(flow, live)
    assert veto["steps"][0]["by"] is None and veto["steps"][0]["map_id"] == "map-glut" and veto["paused"]["by"] is None
    assert veto["lead_log"][0]["by"] is None and veto["lead_log"][0]["reason"]


@pytest.mark.asyncio
async def test_the_rule_block_freezes_the_template_as_data_and_renders_german(flow):
    league = {"id": "liga", "game_id": "probe-shooter"}
    await flow.db.games.insert_one({"id": "probe-shooter", "name": "Probe", "match_modes": [
        {"mode": HP, "label": "Stellung"}, {"mode": SND, "label": "Suchen"}, {"mode": CTL, "label": "Kontrolle"}]})
    off = await league_rule_blocks.resolve(flow.db, ["veto"], league, {"id": "s", "veto_rules": veto_rules(enabled=False)})
    assert off["veto"]["data"] == {"enabled": False} and league_rule_blocks.value("veto", off["veto"]) == league_rule_facts.NO_VETO
    assert league_rule_blocks.value("veto", {}) == "" and league_rule_blocks.value("veto", {"data": {}}) == league_rule_facts.NO_VETO
    on = await league_rule_blocks.resolve(flow.db, ["veto"], league, {"id": "s", "veto_rules": veto_rules(step_seconds=45)})
    assert on["veto"]["label"] == "Veto" and on["veto"]["source"]["veto_rules"]["step_seconds"] == 45
    assert on["veto"]["data"]["steps"][0] == {"kind": "ban", "mode": HP, "mode_label": "Stellung", "team": "A", "position": None}
    text = league_rule_blocks.plain_value("veto", on["veto"])
    assert "Team A ist das Heimteam laut Spielplan" in text and "Je Schritt 45 Sekunden" in text
    assert "1. Team A sperrt eine Map (Stellung)" in text and "3. Team A wählt Map 1 (Stellung)" in text
    assert "11. Die übrige Map wird Map 3 (Kontrolle)" in text
    assert "" not in text, "Klartext ohne Schutzzeichen"
    assert "" in league_rule_blocks.value("veto", on["veto"]), "beim Darstellen sind die Namen geschützt"
    assert any(row["key"] == "veto" for row in league_rule_blocks.catalog())
    # Variablen (#2269): nur mit Veto einen Wert, sonst „(nicht festgelegt)“.
    with_veto = await league_rule_vars.context(flow.db, league, {"id": "s", "veto_rules": veto_rules(step_seconds=45, team_a="draw")})
    assert league_rule_vars.resolve(["veto.step_seconds", "veto.team_a"], with_veto) == {
        "veto.step_seconds": {"label": "Zeit je Veto-Schritt", "value": "45 Sekunden"}, "veto.team_a": {"label": "Team A im Veto", "value": "per Los je Spiel"}}
    without = await league_rule_vars.context(flow.db, league, {"id": "s", "veto_rules": veto_rules(enabled=False)})
    assert league_rule_vars.resolve(["veto.step_seconds"], without)["veto.step_seconds"]["value"] is None
    assert {row["name"] for row in league_rule_vars.catalog(without)} >= {"veto.step_seconds", "veto.team_a"}


@pytest.mark.asyncio
async def test_a_changed_template_asks_for_a_new_rule_release(flow):
    """#2286: Steht der Baustein (oder eine Variable) im Regelwerk, löst eine geänderte Vorlage „Regelwerk muss freigegeben werden“ aus."""
    w = await season_world(flow)
    sid = w["season"]["id"]
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules()))
    version = await publish(flow, w, body="# Veto\n\n[[baustein:veto]]\n\nJe Schritt {{veto.step_seconds}}, Team A ist {{veto.team_a}}.\n",
                            reason="Veto aufgenommen")
    assert set(version["blocks_used"]) >= {"veto"} and "veto.step_seconds" in version["vars_used"]
    # Die Regelseite folgt der Sichtbarkeit der Season - die Vorschau „Nur Liga-Leitung“ reicht der Leitung.
    ok(await flow.patch(f"{ADMIN}/seasons/{sid}", json={"visibility": "admins"}))
    league_doc = await flow.db.leagues.find_one({"id": w["league"]["id"]}, {"_id": 0})
    season_doc = await flow.db.league_seasons.find_one({"id": sid}, {"_id": 0})
    assert await league_rules.data_changes(flow.db, league_doc, season_doc, version) is None, "nichts geändert"
    page = ok(await flow.get(f"/api/league-rules/seasons/{w['league']['slug']}/{season_doc['slug']}"))
    body = league_rule_blocks.plain("\n".join(row["body_md"] for row in page["sections"]))
    assert "Team A sperrt eine Map" in body and "60 Sekunden" in body and "das Heimteam laut Spielplan" in body
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(step_seconds=90, team_a="draw")))
    season_doc = await flow.db.league_seasons.find_one({"id": sid}, {"_id": 0})
    changes = await league_rules.data_changes(flow.db, league_doc, season_doc, version)
    kinds = {(row["kind"], row["block"]) for row in changes["rows"]}
    assert kinds == {("block", "veto"), ("variable", "veto.step_seconds"), ("variable", "veto.team_a")}
    pending = await league_rules.pending_release(flow.db, league_doc, season_doc)
    assert pending and pending["kind"] == "changed" and pending["count"] == 3
    # Ein Lesen des alten Vertrags zeigt weiter die eingefrorenen 60 Sekunden - nie still geändert.
    page = ok(await flow.get(f"/api/league-rules/seasons/{w['league']['slug']}/{season_doc['slug']}"))
    body = league_rule_blocks.plain("\n".join(row["body_md"] for row in page["sections"]))
    assert "60 Sekunden" in body and "90 Sekunden" not in body


# ---------------------------------------------------------------- Vorlage je Season (Verwaltung)

ADMIN = "/api/admin/leagues"
GAME = {"name": "Veto-Shooter", "slug": "veto-shooter", "match_modes": [
    {"mode": HP, "label": "Stellung"}, {"mode": SND, "label": "Suchen"}, {"mode": CTL, "label": "Kontrolle"}]}
MAPS = (("Hafen", [HP, CTL]), ("Nebel", [HP, SND]), ("Turm", [HP, SND]), ("Glut", [HP]), ("Kai", [SND, CTL]), ("Werk", [SND]),
        ("Ruine", [CTL]))


async def season_world(flow, *, best_of: int = 5, order=ORDER, pool: dict | None = None, repeat: str = "other_mode") -> dict:
    lead_user = await flow.add_staff()
    flow.act_as(lead_user)
    game = ok(await flow.post("/api/games", json=GAME))
    maps = {name: ok(await flow.post(f"/api/games/{game['id']}/maps", json={"name": name, "modes": modes})) for name, modes in MAPS}
    league = ok(await flow.post(ADMIN, json={"name": "Veto-Liga", "game_id": game["id"]}))
    start = (now_utc() + timedelta(days=8)).date().isoformat()
    season = ok(await flow.post(f"{ADMIN}/{league['id']}/seasons", json={
        "start_date": f"{start}T00:00:00", "weeks_total": 12, "best_of": best_of, "team_size": 4, "game_mode_order": order, "map_repeat": repeat}))
    wanted = pool if pool is not None else {HP: ["Hafen", "Nebel", "Turm", "Glut"], SND: ["Nebel", "Turm", "Kai", "Werk"], CTL: ["Hafen", "Kai", "Ruine"]}
    if wanted:
        ok(await flow.put(f"{ADMIN}/seasons/{season['id']}/map-pool", json={"modes": [
            {"mode": mode, "map_ids": [maps[name]["id"] for name in names]} for mode, names in wanted.items()]}))
    division = ok(await flow.post(f"{ADMIN}/seasons/{season['id']}/divisions", json={}))
    tid = ok(await flow.post(f"{ADMIN}/divisions/{division['id']}/staffeln", json={}))["tournament_id"]
    world = {"lead": lead_user, "game": game, "maps": maps, "league": league, "season": season, "division": division, "tid": tid}
    await publish(flow, world)
    flow.act_as(lead_user)
    return world


def pool_body(w: dict, names: dict) -> dict:
    return {"modes": [{"mode": mode, "map_ids": [w["maps"][name]["id"] for name in rows]} for mode, rows in names.items()]}


@pytest.mark.asyncio
async def test_an_untouched_template_follows_the_pool_until_the_lead_saves_it(flow):
    """Fabian Nr. 108: Solange die Vorlage nie von Hand gespeichert wurde, zieht sie beim Speichern des Pools nach - die Leitung muss
    nichts drücken, Veröffentlichen geht. Nach dem ersten Speichern bleibt sie, wie sie ist, und „Was fehlt noch?“ nennt den Rest."""
    w = await season_world(flow, pool={})
    sid = w["season"]["id"]
    fresh = ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))
    # Beim Anlegen (Nr. 105) gibt es noch keinen Pool: nur Wahlen und Decider aus Modusfolge und Best of, Merker „unberührt“.
    assert fresh["auto"] is True and fresh["veto_rules"]["enabled"] is True and fresh["veto_rules"]["steps"] == [
        step("pick", HP, "A", 1), step("pick", HP, "B", 4), step("pick", SND, "B", 2), step("pick", SND, "A", 5), step("decider", CTL, None, 3)]
    full = {HP: ["Hafen", "Nebel", "Turm", "Glut"], SND: ["Nebel", "Turm", "Kai", "Werk"], CTL: ["Hafen", "Kai", "Ruine"]}
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, full)))
    after = ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))
    assert after["veto_rules"]["steps"] == ANLAGE_B and after["problems"] == [] and after["auto"] is True
    assert (await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0, "veto_rules": 1}))["veto_rules"]["steps"] == ANLAGE_B
    assert await flow.db.audit_logs.count_documents({"action": "league.season.veto_rules", "target_id": sid, "data.via": "auto"}) == 1
    assert not [row for row in ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["problems"] if row["code"].startswith("veto")]
    assert (await flow.patch(f"{ADMIN}/seasons/{sid}", json={"visibility": "public"})).status_code == 200, "Veröffentlichen ohne Extra-Klick"
    # „Map aus dem Pool nehmen“ ändert den Pool genauso - die unberührte Vorlage zieht wieder nach.
    taken = await flow.post(f"{ADMIN}/seasons/{sid}/map-pool/remove-map", json={"map_id": w["maps"]["Glut"]["id"], "mode": HP, "reason": "Glut ist kaputt"})
    assert taken.status_code == 200, taken.text
    moved = ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))
    assert moved["problems"] == [] and moved["veto_rules"]["steps"] != ANLAGE_B and moved["auto"] is True
    assert await flow.db.audit_logs.count_documents({"action": "league.season.veto_rules", "target_id": sid, "data.via": "auto"}) == 2
    # Von Hand gespeichert: der Merker fällt weg, ab jetzt bleibt die Vorlage - auch wenn der Pool sich ändert.
    custom = [step("ban", HP, "A"), step("pick", HP, "A", 4), step("pick", HP, "B", 1), *ANLAGE_B[4:]]
    saved = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json={"enabled": True, "team_a": "home", "step_seconds": 60, "steps": custom}))
    assert saved["auto"] is False and saved["problems"] == []
    smaller = {**full, HP: ["Hafen", "Nebel", "Turm"], SND: ["Nebel", "Turm", "Kai"]}
    ok(await flow.put(f"{ADMIN}/seasons/{sid}/map-pool", json=pool_body(w, smaller)))
    kept = ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))
    assert kept["veto_rules"]["steps"] == custom and kept["auto"] is False
    assert kept["problems"] == ["Suchen: 2 Sperren und 2 Wahlen brauchen 4 Maps – der Pool hat 3."]
    assert [row["code"] for row in ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["problems"] if row["code"].startswith("veto")] == ["veto_invalid"]
    assert await flow.db.audit_logs.count_documents({"action": "league.season.veto_rules", "target_id": sid, "data.via": "auto"}) == 2


@pytest.mark.asyncio
async def test_the_season_template_is_checked_proposed_saved_and_transferred(flow):
    w = await season_world(flow)
    sid = w["season"]["id"]
    before = ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))
    # Neue Seasons (Fabian Nr. 105/108): Veto an; die Vorlage vom Anlegen ist mit dem Pool nachgezogen (unberührt) und passt.
    assert before["veto_rules"] == {"enabled": True, "team_a": "home", "step_seconds": 60, "steps": ANLAGE_B} and before["auto"] is True
    assert before["active"] is True and before["best_of"] == 5 and before["game_mode_order"] == ORDER and before["has_checkin"] is True
    assert before["problems"] == []
    assert {row["mode"]: row["maps"] for row in before["modes"]} == {HP: 4, SND: 4, CTL: 3}
    assert (await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0, "veto_rules": 1}))["veto_rules"]["steps"] == ANLAGE_B
    assert not [row for row in ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["problems"] if row["code"].startswith("veto")]
    # Bestehende Seasons ohne Feld bleiben aus - keine Migration.
    await flow.db.league_seasons.update_one({"id": sid}, {"$unset": {"veto_rules": ""}})
    legacy = ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))
    assert legacy["veto_rules"] is None and legacy["active"] is False
    assert not [row for row in ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))["problems"] if row["code"].startswith("veto")]

    proposal = ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules/proposal"))
    assert proposal["steps"] == ANLAGE_B and proposal["problems"] == []

    table = {
        "zu kleiner Pool": ([*ANLAGE_B[:8], step("ban", CTL, "A"), step("ban", CTL, "B"), step("ban", CTL, "A"), step("decider", CTL, None, 3)],
                            "Kontrolle: 3 Sperren und 0 Wahlen und ein Decider brauchen 4 Maps – der Pool hat 3."),
        "doppelte Position": ([*ANLAGE_B[:3], step("pick", HP, "B", 1), *ANLAGE_B[4:]], "Position 1 ist mehrfach belegt (Schritt 3 und 4)."),
        "falscher Modus": ([*ANLAGE_B[:2], step("pick", HP, "A", 2), step("pick", HP, "B", 4), *ANLAGE_B[4:]],
                           "Schritt 3: Auf Position 2 wird laut „Modus je Map“ Suchen gespielt, nicht Stellung."),
        "Decider nicht eindeutig": ([*ANLAGE_B[:8], step("ban", CTL, "A"), step("decider", CTL, None, 3)],
                                    "Kontrolle: Der Decider braucht genau eine übrige Map – nach 1 Sperre und 0 Wahlen bleiben 2."),
    }
    for name, (steps, sentence) in table.items():
        refused = await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(steps))
        assert refused.status_code == 422 and sentence in refused.json()["detail"], (name, refused.text)
        assert refused.json()["detail"].startswith("Die Vorlage passt noch nicht:")
    bad_form = await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules([{"kind": "side", "mode": HP, "team": "A"}]))
    assert bad_form.status_code == 422 and "Sperren, Wählen, Decider oder Vorgabe der Woche" in bad_form.json()["detail"]
    # Aus: ein Entwurf bleibt speicherbar, auch wenn er noch nicht aufgeht.
    draft = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(ANLAGE_B[:3], enabled=False)))
    assert draft["active"] is False and draft["problems"] == []

    saved = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=veto_rules(team_a="draw", step_seconds=90)))
    assert saved["active"] is True and saved["staffeln_updated"] == 1 and saved["veto_rules"]["step_seconds"] == 90
    staffel = await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0, "veto_rules": 1})
    assert staffel["veto_rules"] == saved["veto_rules"]
    log = await flow.db.audit_logs.find({"action": "league.season.veto_rules"}, {"_id": 0}).to_list(10)
    assert log[-1]["data"]["to"]["team_a"] == "draw" and log[-1]["data"]["staffeln"] == 1
    again = ok(await flow.put(f"{ADMIN}/seasons/{sid}/veto-rules", json=saved["veto_rules"]))
    # Drei Einträge: das Nachziehen mit dem Pool (via auto), der Entwurf, „draw/90“ - die Wiederholung schreibt nichts.
    assert again["staffeln_updated"] == 0 and await flow.db.audit_logs.count_documents({"action": "league.season.veto_rules"}) == 3
    assert saved["auto"] is False and (await flow.db.audit_logs.find_one({"action": "league.season.veto_rules", "data.via": "auto"}))["data"]["to"]["steps"] == ANLAGE_B

    # Prüfung vor der Veröffentlichung: der Pool schrumpft, die Vorlage geht nicht mehr auf; ohne Check-in fehlt die Vorbedingung.
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    assert not [row for row in ready["problems"] if row["code"].startswith("veto")]
    ok(await flow.post(f"{ADMIN}/seasons/{sid}/map-pool/remove-map", json={"map_id": w["maps"]["Ruine"]["id"], "reason": "Map kaputt im Spiel"}))
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    veto_problems = [row for row in ready["problems"] if row["code"] == "veto_invalid"]
    assert veto_problems and veto_problems[0]["text"] == "Veto: Kontrolle: 2 Sperren und 0 Wahlen und ein Decider brauchen 3 Maps – der Pool hat 2."
    assert ok(await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules"))["problems"] == [veto_problems[0]["text"][len("Veto: "):]]
    await flow.db.league_seasons.update_one({"id": sid}, {"$unset": {"checkin_rules": ""}})
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    assert "veto_without_checkin" in {row["code"] for row in ready["problems"]}
    # Liga N mit anderem Best of: Warnung, kein Problem.
    ok(await flow.patch(f"{ADMIN}/divisions/{w['division']['id']}", json={"overrides": {"best_of": 3}}))
    ready = ok(await flow.get(f"{ADMIN}/seasons/{sid}/readiness"))
    warning = next(row for row in ready["warnings"] if row["code"] == "veto_division_mismatch")
    assert warning["text"].startswith("Liga 1 spielt Best of 3, die Veto-Vorlage belegt 5 Positionen")
    # Übertragen in der eigenen Gruppe „veto“.
    await flow.db.tournaments.update_one({"id": w["tid"]}, {"$unset": {"veto_rules": ""}})
    synced = ok(await flow.post(f"{ADMIN}/seasons/{sid}/sync", json={}))
    assert "veto" in str(synced) and (await flow.db.tournaments.find_one({"id": w["tid"]}, {"_id": 0, "veto_rules": 1}))["veto_rules"]["enabled"] is True
    rights = await flow.get(f"{ADMIN}/seasons/{sid}/veto-rules/proposal")
    assert rights.status_code == 200
    no_pool = await season_world(flow, pool={})
    missing = await flow.get(f"{ADMIN}/seasons/{no_pool['season']['id']}/veto-rules/proposal")
    assert missing.status_code == 409 and "Map-Pool" in missing.json()["detail"]
