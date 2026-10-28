"""Erzeugt frontend/e2e/fixtures/tableScheduleGenerated.json mit den echten Generatoren und Routen (#1562).

Keine handgeschriebenen Tabellen oder Spielpläne: Liga, Gruppen, ein K.-o. vor Ort mit Planer und Stationen und ein
beendetes Turnier entstehen über die echten Routen in der Flow-Testumgebung (In-Memory, kein Server, keine echten
Konten). Gelesen wird, was Website und App lesen: GET /api/tournaments/:id, /bracket, /standings, /matchdays - als
Zuschauer und als angemeldeter Teilnehmer (eigene Zeile, „Nur meine Spiele“). Nach einer Änderung an Generator,
Tabelle oder Planer neu erzeugen (mit der Backend-Umgebung, z. B. dem Venv von local_check):

    python scripts/make_table_schedule_fixture.py
"""
import asyncio
import json
import pathlib
import sys
from datetime import timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "e2e" / "fixtures" / "tableScheduleGenerated.json"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402

NAMES = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke"]
# Worst Case (break-ui): lange, diakritische und Emoji-Namen, eine E-Mail als Name, ein ganz kurzer Name.
WORST = ["Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter", "Aleksandra Wiśniewska-Kowalczyk",
         "🦁 Löwenherz", "Nguyễn Thị Thanh Hương", "bartholomew.fitzgerald@northwind-industries.example", "Jo"]
LEAGUE_START = "2026-09-08T18:00:00+00:00"


async def name_all(flow, regs, names):
    for index, reg in enumerate(sorted(regs, key=lambda r: r.get("seed") or 0)):
        name = names[index] if index < len(names) else f"Spieler {index + 1}"
        reg["display_name"] = name
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"display_name": name, "ingame_name": name}})


async def generate(flow, staff, tournament):
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text


async def report(flow, staff, match, winner, loser, scores=(3, 1), draw=False):
    flow.act_as(staff)
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": winner, "rank": 1, "score": scores[0]},
        {"registration_id": loser, "rank": 1 if draw else 2, "score": scores[0] if draw else scores[1]},
    ]})
    assert response.status_code == 200, response.text


async def play_round(flow, staff, tournament, round_number, *, first_wins=True, draw_first=False):
    matches = sorted([m for m in await flow.matches(tournament) if int(m.get("round") or 0) == round_number],
                     key=lambda m: m.get("order") or 0)
    for index, match in enumerate(matches):
        first, second = [slot["registration_id"] for slot in match["slots"]]
        if not first or not second:
            continue
        winner, loser = (first, second) if first_wins else (second, first)
        await report(flow, staff, match, winner, loser, scores=(3, index % 3), draw=draw_first and index == 0)


async def read(flow, tournament, viewer, *parts):
    flow.act_as(viewer)
    out = {}
    detail = await flow.get(f"/api/tournaments/{tournament['id']}")
    assert detail.status_code == 200, detail.text
    out["tournament"] = detail.json()
    for part in parts:
        response = await flow.get(f"/api/tournaments/{tournament['id']}/{part}")
        assert response.status_code == 200, response.text
        out[part] = response.json()
        if part == "bracket":
            # Die Lese-Struktur (`structure`) wiederholt die Spiele - Website und Tests brauchen sie nicht.
            out[part].pop("structure", None)
    return out


async def league(flow):
    """Liga mit sechs Spielern, zwei Spieltage gespielt (einer mit Unentschieden) - als Spieler 3 gelesen."""
    staff = await flow.add_staff()
    tournament, users, regs = await flow.with_participants(6, format="league", start_date=LEAGUE_START, slug="liga-herbst",
                                                           title="Lions Liga Herbst")
    await name_all(flow, regs, [NAMES[0], WORST[0], NAMES[1], WORST[2], WORST[4], WORST[5]])
    await generate(flow, staff, tournament)
    await flow.start(tournament)
    await play_round(flow, staff, tournament, 1, first_wins=True)
    after_first = await read(flow, tournament, users[2], "standings")
    await play_round(flow, staff, tournament, 2, first_wins=False, draw_first=True)
    data = await read(flow, tournament, users[2], "standings", "bracket", "matchdays")
    data["standings_after_first"] = after_first["standings"]
    return data


async def groups(flow, count, group_count, slug):
    """Gruppenphase über die echte Gruppen-Auslosung; Runde 1 gespielt, als Spieler 1 gelesen."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, regs = await flow.with_participants(count, format="groups", slug=slug, title="Lions Gruppen-Cup")
    names = [*NAMES, *WORST] if count <= 16 else [*WORST, *NAMES]
    await name_all(flow, regs, names)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": group_count})
    assert response.status_code == 200, response.text
    # Gruppen generieren startet das Turnier nicht mehr (#2120) - das macht „Turnier starten“.
    await flow.start(tournament)
    await play_round(flow, staff, tournament, 1)
    if count <= 16:
        await play_round(flow, staff, tournament, 2, first_wins=False)
    return await read(flow, tournament, users[0], "standings", "bracket")


async def on_site(flow):
    """K.-o. vor Ort mit acht Spielern: der echte Planer verteilt Zeit und Station, ein Spiel läuft, eins ist fertig."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    start = (now_utc() + timedelta(minutes=5)).replace(second=0, microsecond=0)
    tournament, users, regs = await flow.with_participants(
        8, format="single_elim", slug="smash-vor-ort", title="Lions Smash vor Ort", event_mode="local",
        schedule_mode="fixed_by_staff", result_entry_mode=None, start_date=start.isoformat())
    await name_all(flow, regs, [*NAMES[:4], WORST[0], WORST[2], WORST[3], WORST[5]])
    await generate(flow, staff, tournament)
    stations = []
    for name in ["PC 1", "PC 2", "Switch 3"]:
        doc = {"id": new_id(), "name": name, "device_type": "pc", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None, "notes": None}
        await flow.db.stations.insert_one(dict(doc))
        stations.append(doc)
    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    plan = planned.json()
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                              json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})
    assert applied.status_code == 200, applied.text
    await flow.start(tournament)
    first_round = sorted([m for m in await flow.matches(tournament) if m["round"] == 1], key=lambda m: m.get("scheduled_at") or "")
    done, running = first_round[0], first_round[1]
    a, b = [slot["registration_id"] for slot in done["slots"]]
    await report(flow, staff, done, a, b, scores=(2, 1))
    response = await flow.post(f"/api/stations/{running['station_id']}/assign/{running['id']}?start_now=true")
    assert response.status_code == 200, response.text
    viewer = users[[r["id"] for r in regs].index(running["slots"][0]["registration_id"])]
    return await read(flow, tournament, viewer, "bracket")


async def finished(flow):
    """K.-o. mit acht Spielern, ganz gespielt und beendet: das Podest; als Sieger gelesen."""
    staff = await flow.add_staff()
    tournament, users, regs = await flow.with_participants(8, format="single_elim", slug="smash-finale", title="Lions Smash Finale")
    await name_all(flow, regs, [NAMES[0], WORST[0], NAMES[2], WORST[2], *NAMES[4:]])
    await generate(flow, staff, tournament)
    await flow.start(tournament)
    for round_number in range(1, 5):
        for match in sorted([m for m in await flow.matches(tournament) if int(m.get("round") or 0) == round_number],
                            key=lambda m: m.get("order") or 0):
            match = await flow.reload(match)
            filled = [slot.get("registration_id") for slot in match.get("slots") or []]
            if len(filled) != 2 or not all(filled) or match.get("status") in {"completed", "forfeit"}:
                continue
            seeds = {r["id"]: r.get("seed") or 99 for r in regs}
            winner, loser = sorted(filled, key=lambda rid: seeds[rid])
            await report(flow, staff, match, winner, loser, scores=(2, 0))
    # Endstand bestätigt (Statusvertrag): erst „Ergebnisse veröffentlicht“ löst den Sieger-Moment aus.
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "results_published"}})
    champion_id = sorted(regs, key=lambda r: r.get("seed") or 99)[0]["id"]
    viewer = users[[r["id"] for r in regs].index(champion_id)]
    return await read(flow, tournament, viewer, "standings", "bracket")


async def main():
    out = {"_info": ("Erzeugt von scripts/make_table_schedule_fixture.py mit den echten Generatoren und Routen (#1562): Liga mit "
                     "6 (zwei Spieltage, Unentschieden, Pfeile), Gruppen mit 8 und mit 64 (8 Gruppen, Worst-Case-Namen), K.-o. vor "
                     "Ort mit Planer und Stationen (ein Spiel läuft, eins fertig), beendeter K.-o. mit 8 und veröffentlichten Ergebnissen (Podest). "
                     "Nicht von Hand ändern - neu erzeugen.")}
    for key, build in [("league", league), ("groups", lambda f: groups(f, 8, 2, "gruppen-cup")),
                       ("groups64", lambda f: groups(f, 64, 8, "gruppen-cup-64")), ("onsite", on_site), ("finished", finished)]:
        flow, shutdown = make_flow()
        try:
            out[key] = await build(flow)
        finally:
            await shutdown()
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"geschrieben: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    asyncio.run(main())
