"""Erzeugt frontend/e2e/fixtures/ffaGenerated.json mit dem echten FFA-Generator und dem echten Umbau (#1561).

Keine handgeschriebenen Bäume: der Web-Turnierbaum (Vitest, lokale Vorschau) bekommt seine FFA-Daten aus
services/custom_bracket (Auto-Schema ffa_custom_bracket, Laufgröße 4, Quote 2; #1571) und
services/heat_rebuild (Zusammenlegen, Abkürzen; #1575), gelesen über die echte Baum-Antwort
GET /api/tournaments/:id/bracket in der Flow-Testumgebung (In-Memory, kein Server, keine echten Konten).
Nach einer Änderung an Generator oder Umbau neu erzeugen (mit der Backend-Umgebung, z. B. dem Venv von local_check):

    python scripts/make_ffa_bracket_fixture.py

Mit ``--lines`` entstehen statt dessen die Fälle für die Linien-Prüfung des Baums (#1591) in
frontend/e2e/fixtures/bracketLines.json: Läufe mit 16 im Doppel-K.-o. mit Grand Final, gemischt (wie im Betrieb
geschrieben, vor und nach Runde 1), K.-o. mit 8 fest, Doppel-K.-o. mit 8 fest, 8 von 16 Fahrern zusammengelegt.
"""
import asyncio
import json
import pathlib
import sys
from datetime import timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "e2e" / "fixtures" / "ffaGenerated.json"
LINES_OUT = ROOT / "frontend" / "e2e" / "fixtures" / "bracketLines.json"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from services import scheduler  # noqa: E402
from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.custom_bracket import _auto_ffa_custom_schema, ffa_heat_plan  # noqa: E402

NAMES = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke",
         "KurvenKarl", "NitroNina", "BlitzBea", "RaketenRudi", "SternSeppi", "GipfelGabi", "PistenPaul", "ZickZackZoe"]


# Worst Case (break-ui): lange, diakritische und Emoji-Namen, eine E-Mail als Name.
LONG = {16: "Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter", 17: "Aleksandra Wiśniewska-Kowalczyk",
        18: "🦁 Löwenherz", 19: "Nguyễn Thị Thanh Hương", 20: "bartholomew.fitzgerald@northwind-industries.example", 21: "Jo"}


async def build(flow, count: int, mode: str, plan_size: int, *, shuffle: bool = False, duel: bool = False, double: bool = False,
                custom: str | None = None):
    """Ein Turnier wie im Betrieb. ``shuffle``: Gegner der nächsten Runde mischen (#1548); ``duel``: K.-o. mit Duellen
    (Auto-Schema ``single_elimination``) statt FFA-Läufen."""
    tournament, _users, regs = await flow.with_participants(
        count, format=("double_elim" if double else "single_elim") if duel else "ffa_custom_bracket", heat_rebuild_mode=mode, status="registration_open",
        title="Lions Smash-Cup" if duel else "Lions Kart-Cup", randomize_advancement_rounds=shuffle)
    for index, reg in enumerate(sorted(regs, key=lambda r: r.get("seed") or 0)):
        name = NAMES[index] if index < len(NAMES) else LONG.get(index, f"Fahrer {index + 1}")
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"display_name": name, "ingame_name": name}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "max_participants": plan_size, "slug": f"{'smash' if duel else 'kart'}-cup-{count}{'-gemischt' if shuffle else ''}",
        "randomize_advancement_rounds": shuffle}})
    if duel:
        # K.-o. mit Duellen: das Auto-Schema des Generators (kein eigenes Schema).
        schema = None
        stage = {"stage_type": "double_elimination" if double else "single_elimination", "match_type": "duel", "name": "Turnierbaum",
                 "settings": {"grand_final": "reset"} if double else {}}
    else:
        # Der Baum ist für die geplante Größe gebaut (so wie beim Öffnen des Check-ins mit allen Anmeldungen).
        schema = custom or _auto_ffa_custom_schema(plan_size, 4, 2)
        stage = {"stage_type": "ffa_custom_bracket", "match_type": "ffa", "name": "Läufe",
                 "settings": {"schema": schema, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2}}
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "status": "pending", **stage,
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    # Der Baum entsteht mit dem Ende des Check-ins aus den Eingecheckten (#1551): alle sind da, der Check-in endet.
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()
    return tournament, staff, schema


async def bracket(flow, tournament):
    flow.act_as(None)
    response = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    assert response.status_code == 200, response.text
    return response.json()


async def results(flow, tournament, staff, keys):
    flow.act_as(staff)
    by_key = {m["match_key"]: m for m in await flow.matches(tournament)}
    for key in keys:
        match = by_key[key]
        ranking = [s["registration_id"] for s in match["slots"] if s.get("registration_id")]
        response = await flow.post(f"/api/matches/{match['id']}/result", json={
            "results": [{"registration_id": reg, "rank": index + 1, "score": 15 - 3 * index} for index, reg in enumerate(ranking)]})
        assert response.status_code == 200, response.text


INFO = ("Erzeugt von scripts/make_ffa_bracket_fixture.py mit dem echten Generator (#1571) und dem echten Umbau "
        "(#1575). Zustände: 16 Fahrer (Start, nach Runde 1), 10 von 16 (ausgeglichen), 8 von 16 vor und nach dem "
        "Zusammenlegen, 40 Fahrer mit langen Namen; Gegner mischen (#1548) je vor und nach der Auslosung für K.-o. mit 8 "
        "(se8_draw_*), mit 6 und Freilosen (se6_draw_*), Doppel-K.-o. mit 8 (de8_draw_*), Läufe mit 16 (ffa16_draw_*) und 8 "
        "von 16 gemischt nach dem Zusammenlegen (ffa8_shuffle_merged). Nicht von Hand ändern - neu erzeugen.")


async def main():
    data = {"plan16": ffa_heat_plan(16, 4, 2), "plan10": ffa_heat_plan(10, 4, 2)}
    flow, shutdown = make_flow()
    try:
        t16, staff16, schema16 = await build(flow, 16, "auto", 16)
        data["schema16"] = schema16
        data["ffa16"] = await bracket(flow, t16)
        await flow.start(t16)
        flow.act_as(staff16)
        await results(flow, t16, staff16, ["A", "B", "C", "D"])
        data["ffa16_round1"] = await bracket(flow, t16)
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        t10, _staff, _schema = await build(flow, 10, "suggest", 16)
        data["ffa10_balanced"] = await bracket(flow, t10)
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        t8, staff8, _schema = await build(flow, 8, "suggest", 16)
        data["ffa8_before_merge"] = await bracket(flow, t8)
        flow.act_as(staff8)
        plan = (await flow.db.tournaments.find_one({"id": t8["id"]}, {"_id": 0}))["heat_rebuild_plan"]
        response = await flow.post(f"/api/tournaments/{t8['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
        assert response.status_code == 200, response.text
        data["ffa8_after_merge"] = await bracket(flow, t8)
    finally:
        await shutdown()
    # Gegner mischen (#1548): je ein Stand vor der Auslosung (drei von vier Spielen der Runde entschieden) und danach.
    # Doppel-K.-o.: die Loser-Runde 1 wird erst gelost, wenn alle Winner-Spiele der Runde 1 entschieden sind.
    for name, duel, double, size in (("se8", True, False, 8), ("de8", True, True, 8), ("ffa16", False, False, 16)):
        flow, shutdown = make_flow()
        try:
            tournament, staff, _schema = await build(flow, size, "auto", size, shuffle=True, duel=duel, double=double)
            await flow.start(tournament)
            await results(flow, tournament, staff, ["A", "B", "C"])
            data[f"{name}_draw_before"] = await bracket(flow, tournament)
            await results(flow, tournament, staff, ["D"])
            data[f"{name}_draw_after"] = await bracket(flow, tournament)
        finally:
            await shutdown()
    # Gemischt mit Freilosen: 6 Spieler im 8er-Baum - zwei Viertelfinals sind Freilose, gelost wird trotzdem die Runde.
    flow, shutdown = make_flow()
    try:
        tournament, staff, _schema = await build(flow, 6, "auto", 6, shuffle=True, duel=True)
        await flow.start(tournament)
        open_keys = [m["match_key"] for m in await flow.matches(tournament)
                     if m.get("round") == 1 and m.get("status") == "ready"]
        await results(flow, tournament, staff, open_keys[:-1])
        data["se6_draw_before"] = await bracket(flow, tournament)
        await results(flow, tournament, staff, open_keys[-1:])
        data["se6_draw_after"] = await bracket(flow, tournament)
    finally:
        await shutdown()
    # Gemischt und zusammengelegt: 8 von 16 Fahrern, der Umbau legt Läufe zusammen und kürzt ab.
    flow, shutdown = make_flow()
    try:
        tournament, staff, _schema = await build(flow, 8, "suggest", 16, shuffle=True)
        flow.act_as(staff)
        plan = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})).get("heat_rebuild_plan")
        if plan:
            response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
            assert response.status_code == 200, response.text
        data["ffa8_shuffle_merged"] = await bracket(flow, tournament)
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        t40, _staff, _schema = await build(flow, 40, "auto", 40)
        data["ffa40"] = await bracket(flow, t40)
    finally:
        await shutdown()
    states = ("ffa16", "ffa16_round1", "ffa10_balanced", "ffa8_before_merge", "ffa8_after_merge", "ffa40",
              "se8_draw_before", "se8_draw_after", "de8_draw_before", "de8_draw_after", "ffa16_draw_before", "ffa16_draw_after",
              "se6_draw_before", "se6_draw_after", "ffa8_shuffle_merged")
    out = {"_info": INFO, "plan16": data["plan16"], "plan10": data["plan10"], "schema16": data["schema16"]}
    for key in states:
        out[key] = {name: value for name, value in data[key].items() if name not in {"structure", "matches"}}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")
    for key in states:
        rows = [(m["match_key"], m["round"], m.get("status"), len(m["slots"]), m.get("round_label"), m.get("merged_into_key"))
                for m in sorted(data[key]["matches_v2"], key=lambda m: (m["round"], m.get("order") or 0))]
        print(key, rows)


# Läufe im Doppel-K.-o. mit Grand Final, so wie die Turnierleitung es im Betrieb schreibt (#1591): die Loser-Runden
# tragen die Rundennummer ihrer Zeit („# Runde 2“ …), die Verlierer aus Runde 2 und die Weiterkommer aus der ersten
# Loser-Runde laufen gemischt zusammen.
FFA16_DE = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
# Runde 2
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
# Finale
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
# Runde 2
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
# Runde 3
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
# Runde 4
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
# Runde 5
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[GF]
# Grand Final
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""

LINES_INFO = ("Erzeugt von scripts/make_ffa_bracket_fixture.py --lines mit dem echten Generator (#1591): Läufe mit 16 im "
              "Doppel-K.-o. mit Grand Final, gemischt, vor und nach Runde 1 (ffa16de_start, ffa16de_round1); K.-o. mit 8 "
              "fest (se8_fixed); Doppel-K.-o. mit 8 fest (de8_fixed); 8 von 16 Fahrern zusammengelegt (ffa8_merged). "
              "Nicht von Hand ändern - neu erzeugen.")


async def main_lines():
    data = {}
    flow, shutdown = make_flow()
    try:
        tournament, staff, _schema = await build(flow, 16, "auto", 16, shuffle=True, custom=FFA16_DE)
        data["ffa16de_start"] = await bracket(flow, tournament)
        await flow.start(tournament)
        await results(flow, tournament, staff, ["A", "B", "C", "D"])
        data["ffa16de_round1"] = await bracket(flow, tournament)
    finally:
        await shutdown()
    for name, double in (("se8_fixed", False), ("de8_fixed", True)):
        flow, shutdown = make_flow()
        try:
            tournament, _staff, _schema = await build(flow, 8, "auto", 8, duel=True, double=double)
            data[name] = await bracket(flow, tournament)
        finally:
            await shutdown()
    flow, shutdown = make_flow()
    try:
        tournament, staff, _schema = await build(flow, 8, "suggest", 16)
        flow.act_as(staff)
        plan = (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["heat_rebuild_plan"]
        response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
        assert response.status_code == 200, response.text
        data["ffa8_merged"] = await bracket(flow, tournament)
    finally:
        await shutdown()
    out = {"_info": LINES_INFO}
    for key, value in data.items():
        out[key] = {name: item for name, item in value.items() if name not in {"structure", "matches"}}
        rows = [(m["match_key"], m.get("section"), m["round"], m.get("round_label"), m.get("status"))
                for m in sorted(value["matches_v2"], key=lambda m: (m["round"], m.get("order") or 0))]
        print(key, rows)
    LINES_OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    asyncio.run(main_lines() if "--lines" in sys.argv else main())
