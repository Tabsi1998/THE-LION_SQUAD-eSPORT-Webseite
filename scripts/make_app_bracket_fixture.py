"""Erzeugt docs/bracket-trees.json mit den echten Generatoren und Umbauten (#1563, App-Turnieransicht).

Keine handgeschriebenen Bäume: App (Jest) und Website (Vitest, nach #1581) lesen dieselben Bäume und prüfen mit
docs/bracket-cases.json, dass beide gleich rechnen (Linien, Weg, Lauf-Ausgänge, Freilos, entfällt, Rundennamen).

Quellen, alle über die echten Routen in der Flow-Testumgebung (In-Memory, kein Server, keine echten Konten):
- K.-o. 6 von 8 mit Freilos-Duellen, einer Wertung nach Disqualifikation (#1553) und einem laufenden Spiel
  (services/custom_bracket, Check-in-Ende #1551, Turnier-Ereignisse #1579),
- Doppel-K.-o. 4 mit Grand Final, das die Siegerrunde gewinnt - der Reset entfällt (`bracket_reset`, #1571),
- FFA-Läufe 16 (Start, nach Runde 1), 8 von 16 vor/nach dem Zusammenlegen, 40 mit langen Namen (#1571, #1575),
- Liga 6 (Spieltage), Gruppen 8 in 2 Gruppen (`[{group, standings}]`), Swiss 6 (zwei Runden) mit ihren Tabellen,
- gemischte Runden (#1548/#1580, „Gegner der nächsten Runde: zufällig mischen“): K.-o. 8 vor und nach der Auslosung,
  Doppel-K.-o. 8 nach Runde 1 (Winner und Loser Bracket getrennt gemischt), FFA 16 vor und nach der Auslosung, FFA 8 von 16
  gemischt und zusammengelegt (gestrichene Quellen sind keine Auslosung). Das Los
  ist echt zufällig - die gemeinsamen Fälle prüfen darum die Gruppen und die Herkunft aus `source_result`, nicht wer wo sitzt.

Die Rundennamen (`round_labels`) rechnet services/round_labels wie die Baum-Antwort nach #1581; in den Bäumen selbst
fehlt `round_label` absichtlich - so prüft die App ihren Rückfall für ältere Server gegen den Server.
Nach einer Änderung an Generator, Umbau oder Rundennamen neu erzeugen (Backend-Umgebung, z. B. Venv von local_check):

    python scripts/make_app_bracket_fixture.py
"""
import asyncio
import json
import pathlib
import sys
from datetime import timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "bracket-trees.json"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from services import scheduler  # noqa: E402
from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.custom_bracket import _auto_ffa_custom_schema  # noqa: E402
from services.round_labels import round_label, rounds_by_section, stage_kind  # noqa: E402

NAMES = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke",
         "KurvenKarl", "NitroNina", "BlitzBea", "RaketenRudi", "SternSeppi", "GipfelGabi", "PistenPaul", "ZickZackZoe"]
# Worst Case (break-ui): lange, diakritische und Emoji-Namen, eine E-Mail als Name, ein ganz kurzer.
LONG = {16: "Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter", 17: "Aleksandra Wiśniewska-Kowalczyk",
        18: "🦁 Löwenherz", 19: "Nguyễn Thị Thanh Hương", 20: "bartholomew.fitzgerald@northwind-industries.example", 21: "Jo"}

MATCH_FIELDS = ("id", "match_key", "stage_id", "section", "round", "round_name", "matchday_label", "order", "match_type",
                "status", "winner_id", "started_at", "called_at", "scheduled_at", "duration_minutes", "station_text",
                "group_id", "merged_into", "merged_into_key", "advancement", "forfeit_registration_id", "draw")
SLOT_FIELDS = ("slot", "registration_id", "status", "source", "source_result")
# Nur was die Anzeige braucht - interne Schlüssel (z. B. der Sperr-Schlüssel des Lauf-Umbaus) bleiben draußen.
SOURCE_FIELDS = ("type", "flow", "match_key", "rank", "seed", "raw", "draw", "was")
SOURCE_RESULT_FIELDS = ("from_match_id", "from_match_key", "rank", "flow", "skipped", "reason", "removed_registration_id", "draw_id")
RESULT_FIELDS = ("registration_id", "rank", "score", "points", "forfeit", "qualified", "outcome")
SETTING_FIELDS = ("match_size", "qualifiers_per_match", "bracket_reset", "min_players", "draw_group")
META_FIELDS = ("source", "reason", "needed", "annulled")
REG_FIELDS = ("id", "display_name", "status", "seed")
STAGE_FIELDS = ("id", "stage_type", "match_type", "name")
BASE_TIME = "2026-10-31T13:00:00+00:00"


def _pick(row: dict, fields) -> dict:
    return {key: row[key] for key in fields if row.get(key) not in (None, "", [], {})}


def slim_match(match: dict) -> dict:
    out = _pick(match, MATCH_FIELDS)
    out["slots"] = []
    for slot in match.get("slots") or []:
        row = _pick(slot, SLOT_FIELDS)
        if isinstance(row.get("source"), dict):
            row["source"] = _pick(row["source"], SOURCE_FIELDS)
        if isinstance(row.get("source_result"), dict):
            row["source_result"] = _pick(row["source_result"], SOURCE_RESULT_FIELDS)
        out["slots"].append({key: value for key, value in row.items() if value not in (None, "", [], {})})
    if match.get("results"):
        out["results"] = [_pick(row, RESULT_FIELDS) for row in match["results"]]
    settings = _pick(match.get("settings") or {}, SETTING_FIELDS)
    if settings:
        out["settings"] = settings
    meta = _pick(match.get("result_meta") or {}, META_FIELDS)
    if meta:
        out["result_meta"] = meta
    if out.get("advancement"):
        out["advancement"] = [_pick(row, ("to_match_id", "to_slot", "flow", "rank")) for row in out["advancement"]]
    return out


def labels_for(payload: dict, tournament_format: str) -> dict:
    """Die Rundennamen wie die Baum-Antwort nach #1581 (attach_round_labels) - je Spiel-Kennung."""
    matches = payload.get("matches_v2") or []
    stage_types = {stage.get("id"): stage.get("stage_type") for stage in payload.get("stages") or []}
    rounds = rounds_by_section(matches)
    out = {}
    for match in matches:
        kind = stage_kind(stage_types.get(match.get("stage_id")) or match.get("stage_type"), tournament_format, match.get("match_type"))
        out[match["id"]] = round_label(match, rounds=rounds, kind=kind)
    return out


async def name_participants(flow, regs: list[dict], offset: int = 0) -> None:
    for index, reg in enumerate(sorted(regs, key=lambda r: r.get("seed") or 0)):
        position = index + offset
        name = NAMES[position] if position < len(NAMES) else LONG.get(position, f"Fahrer {position + 1}")
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"display_name": name, "ingame_name": name}})


async def close_check_in(flow, tournament: dict) -> None:
    """Der Baum entsteht mit dem Ende des Check-ins aus den Eingecheckten (#1551): alle sind da, der Check-in endet."""
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()


async def staged(flow, count: int, fmt: str, stage_type: str, *, match_type: str = "duel", settings: dict | None = None,
                 plan_size: int | None = None, **fields):
    tournament, _users, regs = await flow.with_participants(count, format=fmt, status="registration_open", title="Lions Cup", **fields)
    await name_participants(flow, regs)
    if plan_size:
        await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": plan_size}})
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Phase 1", "stage_type": stage_type,
        "match_type": match_type, "status": "pending", "settings": settings or {},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    await close_check_in(flow, tournament)
    return tournament, staff, regs


async def bracket(flow, tournament: dict) -> dict:
    flow.act_as(None)
    response = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    assert response.status_code == 200, response.text
    return response.json()


async def standings(flow, tournament: dict):
    flow.act_as(None)
    response = await flow.get(f"/api/tournaments/{tournament['id']}/standings")
    assert response.status_code == 200, response.text
    return response.json()


async def by_key(flow, tournament: dict) -> dict:
    return {match["match_key"]: match for match in await flow.matches(tournament)}


def filled(match: dict) -> list[str]:
    return [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]


async def play(flow, staff: dict, match: dict, ranking: list[str] | None = None, *, score: bool = True) -> None:
    flow.act_as(staff)
    ranking = ranking or filled(match)
    rows = [{"registration_id": reg, "rank": index + 1, **({"score": 15 - 3 * index} if score else {})} for index, reg in enumerate(ranking)]
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": rows})
    assert response.status_code == 200, response.text


async def go_live(flow, match: dict, station: str) -> None:
    """Ein Spiel läuft an einer Station (so wie die Turnierleitung es startet) - feste Uhrzeit für die Testfälle."""
    station_id = new_id()
    await flow.db.stations.insert_one({"id": station_id, "name": station, "status": "busy", "current_match_id": match["id"],
                                       "current_match_type": "matches_v2", "tournament_id": match["tournament_id"]})
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "status": "in_progress", "station_id": station_id, "started_at": BASE_TIME, "called_at": BASE_TIME}})


def state(payload: dict, tournament_format: str, *, table=None, note: str = "") -> dict:
    matches = sorted(payload.get("matches_v2") or [], key=lambda m: (str(m.get("section") or ""), m.get("round") or 0, m.get("order") or 0))
    labels = labels_for(payload, tournament_format)
    out = {
        "note": note,
        "format": tournament_format,
        "stages": [_pick(stage, STAGE_FIELDS) for stage in payload.get("stages") or []],
        "registrations": [_pick(reg, REG_FIELDS) for reg in payload.get("registrations") or []],
        "matches_v2": [slim_match(match) for match in matches],
        "round_labels": {match.get("match_key") or match["id"]: labels[match["id"]] for match in matches},
    }
    if table is not None:
        out["standings"] = table
    return out


def slim_table(rows):
    keep = ("registration_id", "display_name", "rank", "played", "won", "lost", "drawn", "points", "score_for", "score_against", "buchholz")
    if rows and isinstance(rows[0], dict) and "standings" in rows[0]:
        return [{"group": _pick(row["group"], ("id", "name", "group_key", "section")), "standings": [_pick(r, keep) for r in row["standings"]]}
                for row in rows]
    return [_pick(row, keep) for row in rows]


async def knockout(flow, out: dict) -> None:
    tournament, staff, regs = await staged(flow, 6, "single_elim", "single_elimination", plan_size=8)
    await flow.start(tournament)
    keys = await by_key(flow, tournament)
    played = [m for m in keys.values() if m.get("round") == 1 and len(filled(m)) == 2]
    await play(flow, staff, played[0])
    # Disqualifikation über den Umbauplan (#1579): der Gegner kommt kampflos weiter, die Person ist „disqualifiziert“.
    victim = filled(played[1])[0]
    url = f"/api/tournaments/{tournament['id']}/registrations/{victim}/removal"
    flow.act_as(staff)
    plan = (await flow.post(url, json={"kind": "disqualified"})).json()["plan"]
    response = await flow.post(url, json={"kind": "disqualified", "plan_id": plan["id"], "reason": "Unsportlich"})
    assert response.status_code == 200, response.text
    keys = await by_key(flow, tournament)
    ready = [m for m in keys.values() if m.get("status") == "ready" and len(filled(m)) == 2]
    if ready:
        await go_live(flow, ready[0], "PC 3")
    out["se6_live"] = state(await bracket(flow, tournament), "single_elim", note="K.-o. 6 von 8: Freilos-Duelle, B gespielt, Disqualifikation in D, ein Spiel läuft an PC 3")
    # Nicht erschienen im zweiten Halbfinale: Wertung über den Forfeit-Weg (Status `forfeit`, kampflos).
    keys = await by_key(flow, tournament)
    semi = next(m for m in keys.values() if m.get("status") == "ready" and len(filled(m)) == 2)
    flow.act_as(staff)
    response = await flow.post(f"/api/matches/{semi['id']}/forfeit", json={"winner_id": filled(semi)[0], "note": "Gegner nicht erschienen"})
    assert response.status_code == 200, response.text
    for _ in range(4):
        keys = await by_key(flow, tournament)
        open_matches = [m for m in keys.values() if m.get("status") in {"ready", "in_progress"} and len(filled(m)) == 2]
        for match in open_matches:
            await play(flow, staff, match)
    out["se6_done"] = state(await bracket(flow, tournament), "single_elim", table=slim_table(await standings(flow, tournament)),
                            note="K.-o. 6 von 8 fertig gespielt: Finale entschieden, Pokal vergeben")


async def double_elimination(flow, out: dict) -> None:
    tournament, staff, regs = await staged(flow, 4, "double_elim", "double_elimination")
    await flow.start(tournament)
    seed_one = sorted(regs, key=lambda r: r.get("seed") or 0)[0]["id"]
    for _ in range(8):
        keys = await by_key(flow, tournament)
        open_matches = [m for m in keys.values() if m.get("status") in {"ready", "in_progress"} and len(filled(m)) == 2]
        if not open_matches:
            break
        for match in open_matches:
            ranking = filled(match)
            if seed_one in ranking:  # Setzplatz 1 gewinnt alles - im Grand Final aus der Siegerrunde: Reset entfällt.
                ranking = [seed_one] + [reg for reg in ranking if reg != seed_one]
            await play(flow, staff, match, ranking)
    out["de4_reset_cancelled"] = state(await bracket(flow, tournament), "double_elim",
                                       note="Doppel-K.-o. 4: Setzplatz 1 gewinnt das Grand Final aus der Siegerrunde - GFR entfällt (bracket_reset)")


async def heats(flow, out: dict) -> None:
    settings = {"schema": None, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2}
    for count, plan, mode, name in ((16, 16, "auto", "ffa16"), (8, 16, "suggest", "ffa8"), (40, 40, "auto", "ffa40")):
        flow_instance, shutdown = make_flow()
        try:
            tournament, _users, regs = await flow_instance.with_participants(
                count, format="ffa_custom_bracket", heat_rebuild_mode=mode, status="registration_open", title="Lions Kart-Cup")
            await name_participants(flow_instance, regs)
            await flow_instance.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": plan}})
            await flow_instance.db.tournament_stages.insert_one({
                "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe", "stage_type": "ffa_custom_bracket",
                "match_type": "ffa", "status": "pending", "settings": {**settings, "schema": _auto_ffa_custom_schema(plan, 4, 2)},
                "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
            })
            staff = await flow_instance.add_staff()
            flow_instance.act_as(staff)
            await close_check_in(flow_instance, tournament)
            if name == "ffa16":
                out["ffa16"] = state(await bracket(flow_instance, tournament), "ffa_custom_bracket", note="FFA 16: 4 Läufe → 2 Läufe → Finale, ausgelost")
                await flow_instance.start(tournament)
                keys = await by_key(flow_instance, tournament)
                for key in ("A", "B", "C", "D"):
                    await play(flow_instance, staff, keys[key])
                keys = await by_key(flow_instance, tournament)
                await go_live(flow_instance, keys["E"], "Switch 2")
                out["ffa16_round1"] = state(await bracket(flow_instance, tournament), "ffa_custom_bracket",
                                            note="FFA 16 nach Runde 1: je 2 weiter, Lauf E läuft an Switch 2")
            elif name == "ffa8":
                out["ffa8_before_merge"] = state(await bracket(flow_instance, tournament), "ffa_custom_bracket", note="FFA 8 von 16: Läufe unterbesetzt, Vorschlag offen")
                flow_instance.act_as(staff)
                plan_doc = (await flow_instance.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["heat_rebuild_plan"]
                response = await flow_instance.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan_doc["id"]})
                assert response.status_code == 200, response.text
                out["ffa8_after_merge"] = state(await bracket(flow_instance, tournament), "ffa_custom_bracket",
                                                note="FFA 8 von 16 nach dem Zusammenlegen: merged_into_key, Freilos-Plätze source_unfulfillable")
            else:
                out["ffa40"] = state(await bracket(flow_instance, tournament), "ffa_custom_bracket", note="FFA 40 mit langen, Emoji- und E-Mail-Namen")
        finally:
            await shutdown()


async def tables(out: dict) -> None:
    flow, shutdown = make_flow()
    try:
        tournament, staff, regs = await staged(flow, 6, "round_robin", "round_robin_groups", settings={"group_count": 1})
        await flow.start(tournament)
        matches = sorted(await flow.matches(tournament), key=lambda m: (m.get("round") or 0, m.get("order") or 0))
        for match in matches[:5]:
            await play(flow, staff, match)
        out["league6"] = state(await bracket(flow, tournament), "round_robin", table=slim_table(await standings(flow, tournament)),
                               note="Liga 6: Spieltag 1 und 2 teils gespielt")
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        flow.act_as(staff)
        tournament, _users, regs = await flow.with_participants(8, format="groups", title="Lions Gruppen-Cup")
        await name_participants(flow, regs)
        flow.act_as(staff)
        response = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": 2})
        assert response.status_code == 200, response.text
        # Gruppen generieren startet das Turnier nicht mehr (#2120) - das macht „Turnier starten“.
        await flow.start(tournament)
        matches = sorted(await flow.matches(tournament), key=lambda m: (m.get("round") or 0, m.get("order") or 0))
        for match in matches[:4]:
            await play(flow, staff, match)
        out["groups8"] = state(await bracket(flow, tournament), "groups", table=slim_table(await standings(flow, tournament)),
                               note="Gruppen 8 in 2 Gruppen: Tabelle je Gruppe")
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        flow.act_as(staff)
        tournament, _users, regs = await flow.with_participants(6, format="swiss", title="Lions Swiss")
        await name_participants(flow, regs)
        await flow.start(tournament)
        for _ in range(2):
            flow.act_as(staff)
            response = await flow.post(f"/api/tournaments/{tournament['id']}/swiss/next-round")
            assert response.status_code == 200, response.text
            for match in [m for m in await flow.matches(tournament) if m.get("status") not in {"completed", "forfeit"} and len(filled(m)) == 2]:
                await play(flow, staff, match, score=False)
        out["swiss6"] = state(await bracket(flow, tournament), "swiss", table=slim_table(await standings(flow, tournament)),
                              note="Swiss 6: zwei Runden gespielt, Tabelle mit Buchholz")
    finally:
        await shutdown()


async def open_matches(flow, tournament: dict, keys=None) -> list[dict]:
    rows = sorted(await flow.matches(tournament), key=lambda m: (m.get("round") or 0, m.get("order") or 0))
    return [m for m in rows if m.get("status") in {"ready", "in_progress"} and len(filled(m)) >= 2 and (keys is None or m["match_key"] in keys)]


async def mixed(out: dict) -> None:
    """Gemischte Runden (#1548): nur, wenn der Server sie kennt (services/advancement_draw, ab #1580)."""
    import importlib.util
    if importlib.util.find_spec("services.advancement_draw") is None:
        print("gemischt: übersprungen - der Server kennt die Auslosung (#1580) noch nicht")
        return
    flow, shutdown = make_flow()
    try:
        tournament, staff, _regs = await staged(flow, 8, "single_elim", "single_elimination", randomize_advancement_rounds=True)
        await flow.start(tournament)
        for match in await open_matches(flow, tournament, {"A", "B"}):
            await play(flow, staff, match)
        out["se8_mixed_open"] = state(await bracket(flow, tournament), "single_elim", note="K.-o. 8 gemischt: A und B gespielt - die Halbfinals warten auf die Auslosung")
        for match in await open_matches(flow, tournament, {"C", "D"}):
            await play(flow, staff, match)
        out["se8_mixed_drawn"] = state(await bracket(flow, tournament), "single_elim", note="K.-o. 8 gemischt: Runde 1 fertig, die Halbfinals sind ausgelost")
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        tournament, staff, _regs = await staged(flow, 8, "double_elim", "double_elimination", randomize_advancement_rounds=True)
        await flow.start(tournament)
        for match in await open_matches(flow, tournament):
            if match.get("round") == 1:
                await play(flow, staff, match)
        out["de8_mixed_r1"] = state(await bracket(flow, tournament), "double_elim", note="Doppel-K.-o. 8 gemischt: Runde 1 fertig, Winner und Loser Bracket je für sich ausgelost")
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        tournament, _users, regs = await flow.with_participants(16, format="ffa_custom_bracket", heat_rebuild_mode="auto", status="registration_open",
                                                                 title="Lions Kart-Cup", randomize_advancement_rounds=True)
        await name_participants(flow, regs)
        await flow.db.tournament_stages.insert_one({
            "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
            "status": "pending", "settings": {"schema": _auto_ffa_custom_schema(16, 4, 2), "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        })
        staff = await flow.add_staff()
        flow.act_as(staff)
        await close_check_in(flow, tournament)
        await flow.start(tournament)
        for match in await open_matches(flow, tournament, {"A", "B"}):
            await play(flow, staff, match)
        out["ffa16_mixed_open"] = state(await bracket(flow, tournament), "ffa_custom_bracket", note="FFA 16 gemischt: A und B gefahren - E und F warten auf die Auslosung")
        for match in await open_matches(flow, tournament, {"C", "D"}):
            await play(flow, staff, match)
        out["ffa16_mixed_drawn"] = state(await bracket(flow, tournament), "ffa_custom_bracket", note="FFA 16 gemischt: Runde 1 fertig, E und F ausgelost")
    finally:
        await shutdown()
    # 8 von 16 gemischt und zusammengelegt: der Umbau streicht Quellen (Freilos-Plätze mit `source_result.skipped`) - das
    # ist keine Auslosung, die Folgerunde wartet weiter aufs Los (#1575 mit #1548).
    flow, shutdown = make_flow()
    try:
        tournament, _users, regs = await flow.with_participants(8, format="ffa_custom_bracket", heat_rebuild_mode="suggest", status="registration_open",
                                                                 title="Lions Kart-Cup", randomize_advancement_rounds=True)
        await name_participants(flow, regs)
        await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": 16}})
        await flow.db.tournament_stages.insert_one({
            "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
            "status": "pending", "settings": {"schema": _auto_ffa_custom_schema(16, 4, 2), "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
            "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
        })
        staff = await flow.add_staff()
        flow.act_as(staff)
        await close_check_in(flow, tournament)
        plan_doc = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})).get("heat_rebuild_plan")
        if plan_doc:
            response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan_doc["id"]})
            assert response.status_code == 200, response.text
        out["ffa8_mixed_merged"] = state(await bracket(flow, tournament), "ffa_custom_bracket",
                                         note="FFA 8 von 16 gemischt und zusammengelegt: gestrichene Quellen sind Freilos-Plätze, noch nicht gelost")
    finally:
        await shutdown()


INFO = ("Erzeugt von scripts/make_app_bracket_fixture.py mit den echten Generatoren und Umbauten (#1551, #1553, #1571, "
        "#1575) über die echten Routen. Gemeinsam für App (mobile/src/lib/bracketGraph.test.ts) und Website; die "
        "Erwartungen stehen in docs/bracket-cases.json. Nicht von Hand ändern - neu erzeugen.")


async def main():
    out: dict = {}
    flow, shutdown = make_flow()
    try:
        await knockout(flow, out)
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        await double_elimination(flow, out)
    finally:
        await shutdown()
    await heats(None, out)
    await tables(out)
    await mixed(out)
    ordered = {"_info": INFO, **{key: out[key] for key in sorted(out)}}
    OUT.write_text(json.dumps(ordered, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")
    for key in sorted(out):
        rows = [(m.get("match_key"), m.get("section"), m.get("round"), m.get("status"), len(m["slots"]), out[key]["round_labels"].get(m.get("match_key")),
                 m.get("merged_into_key"), (m.get("result_meta") or {}).get("source")) for m in out[key]["matches_v2"]]
        print(key, len(rows), rows[:40])


if __name__ == "__main__":
    asyncio.run(main())
