"""Erzeugt frontend/e2e/fixtures/ffaGenerated.json mit dem echten FFA-Generator und dem echten Umbau (#1561).

Keine handgeschriebenen Bäume: der Web-Turnierbaum (Vitest, lokale Vorschau) bekommt seine FFA-Daten aus
services/custom_bracket (Auto-Schema ffa_custom_bracket, Laufgröße 4, Quote 2; #1571) und
services/heat_rebuild (Zusammenlegen, Abkürzen; #1575), gelesen über die echte Baum-Antwort
GET /api/tournaments/:id/bracket in der Flow-Testumgebung (In-Memory, kein Server, keine echten Konten).
Nach einer Änderung an Generator oder Umbau neu erzeugen (mit der Backend-Umgebung, z. B. dem Venv von local_check):

    python scripts/make_ffa_bracket_fixture.py
"""
import asyncio
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "e2e" / "fixtures" / "ffaGenerated.json"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.custom_bracket import _auto_ffa_custom_schema, ffa_heat_plan  # noqa: E402

NAMES = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke",
         "KurvenKarl", "NitroNina", "BlitzBea", "RaketenRudi", "SternSeppi", "GipfelGabi", "PistenPaul", "ZickZackZoe"]


# Worst Case (break-ui): lange, diakritische und Emoji-Namen, eine E-Mail als Name.
LONG = {16: "Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter", 17: "Aleksandra Wiśniewska-Kowalczyk",
        18: "🦁 Löwenherz", 19: "Nguyễn Thị Thanh Hương", 20: "bartholomew.fitzgerald@northwind-industries.example", 21: "Jo"}


async def build(flow, count: int, mode: str, plan_size: int):
    tournament, _users, regs = await flow.with_participants(
        count, format="ffa_custom_bracket", heat_rebuild_mode=mode, status="registration_open", title="Lions Kart-Cup")
    for index, reg in enumerate(sorted(regs, key=lambda r: r.get("seed") or 0)):
        name = NAMES[index] if index < len(NAMES) else LONG.get(index, f"Fahrer {index + 1}")
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"display_name": name, "ingame_name": name}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": plan_size, "slug": f"kart-cup-{count}"}})
    # Der Baum ist für die geplante Größe gebaut (so wie beim Öffnen des Check-ins mit allen Anmeldungen).
    schema = _auto_ffa_custom_schema(plan_size, 4, 2)
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": schema, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
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
        "Zusammenlegen, 40 Fahrer mit langen Namen. Nicht von Hand ändern - neu erzeugen.")


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
    flow, shutdown = make_flow()
    try:
        t40, _staff, _schema = await build(flow, 40, "auto", 40)
        data["ffa40"] = await bracket(flow, t40)
    finally:
        await shutdown()
    states = ("ffa16", "ffa16_round1", "ffa10_balanced", "ffa8_before_merge", "ffa8_after_merge", "ffa40")
    out = {"_info": INFO, "plan16": data["plan16"], "plan10": data["plan10"], "schema16": data["schema16"]}
    for key in states:
        out[key] = {name: value for name, value in data[key].items() if name not in {"structure", "matches"}}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")
    for key in states:
        rows = [(m["match_key"], m["round"], m.get("status"), len(m["slots"]), m.get("round_label"), m.get("merged_into_key"))
                for m in sorted(data[key]["matches_v2"], key=lambda m: (m["round"], m.get("order") or 0))]
        print(key, rows)


if __name__ == "__main__":
    asyncio.run(main())
