"""Erzeugt frontend/e2e/fixtures/matchplanGenerated.json aus echten Planer-Antworten (#1557).

Keine handgeschriebenen Pläne: die Matchplan-Seite (Vitest, Playwright-Bilder) bekommt Spiele, Stationen, Vorschau,
Warnungen, Fristen und 409-Antworten aus den echten Routen in der Flow-Testumgebung (In-Memory, kein Server, keine
echten Konten). Der Turnierbaum vor Ort ist der Mario-Kart-Cup aus dem Prototyp (Winner und Loser Bracket, Finale,
je 4 Fahrer) - gebaut vom echten Generator aus dem Schema.

Zustände:
  local.preview   Baum gebaut, zwei Stationen, Vorschau vor dem ersten Übernehmen
  local.applied   nach „Übernehmen“: gespeicherter Plan, Vorschau ohne Änderung
  draft           Baum noch Vorschau (vor dem Check-in-Ende): der Planer meldet „none“, die Spiele stehen trotzdem da
  local.conflict  eine Zeit von Hand zu früh gesetzt (Warnung „zu früh“), dazu die 409 beim Belegen einer Station und
                  die 409 einer veralteten Vorschau
  live            Turnier läuft seit 70 Minuten: zwei Läufe fertig, einer läuft an der Station, Vorschau mit Verzug
  big             Worst Case: 24 Spieler Doppel-K.-o. (über 40 Spiele), 8 Stationen (eine defekt, bleibt leer), lange Namen
  online          Online-Turnier: Planer ohne Stationen, Fristen je Spiel
  online_draft    Online-Turnier mit Vorschau-Baum: die Spiele stehen als Vorschau da
  league          Liga online: Spielwochen mit Fristen

Nach einer Änderung an Planer, Generator oder Fristen neu erzeugen (mit der Backend-Umgebung, z. B. dem Venv von
local_check):

    python scripts/make_matchplan_fixture.py
"""
import asyncio
import json
import pathlib
import sys
from datetime import timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "e2e" / "fixtures" / "matchplanGenerated.json"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.match_scheduler import apply_plan, plan_for_tournament  # noqa: E402

CUP_SCHEMA = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
# Runde 2
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
# Runde 3
G=[W:E:1,W:E:2,W:F:1,W:F:2]

[LB]
# Runde 1
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
LB=[L:C:1,L:C:2,L:D:1,L:D:2]
# Runde 2
LC=[W:LA:1,W:LA:2,L:E:1,L:E:2]
LD=[W:LB:1,W:LB:2,L:F:1,L:F:2]
# Runde 3
LE=[W:LC:1,W:LC:2,W:LD:1,W:LD:2]
# Runde 4
LF=[W:LE:1,W:LE:2,L:G:1,L:G:2]

[FINAL]
# Finale
FINAL=[W:G:1,W:G:2,W:LF:1,W:LF:2]"""

NAMES = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke",
         "KurvenKarl", "NitroNina", "BlitzBea", "RaketenRudi", "SternSeppi", "GipfelGabi", "PistenPaul", "ZickZackZoe"]
# Worst Case (break-ui): lange, diakritische und Emoji-Namen, eine E-Mail als Name, ein sehr kurzer Name.
LONG = ["Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter", "Aleksandra Wiśniewska-Kowalczyk",
        "🦁 Löwenherz", "Nguyễn Thị Thanh Hương", "bartholomew.fitzgerald@northwind-industries.example", "Jo"]

MK8 = {"id": "game-mk8", "name": "Mario Kart 8 Deluxe", "slug": "mario-kart-8-deluxe", "station_devices": ["switch", "switch2"],
       "match_modes": [{"mode": "gp4", "label": "Grand Prix (4 Rennen)", "minutes": 12}], "setup_minutes": 0}


def quarter(moment):
    """Auf die Viertelstunde - so sehen Startzeiten in der Verwaltung aus."""
    moment = moment.replace(second=0, microsecond=0)
    return moment - timedelta(minutes=moment.minute % 15)


async def named(flow, regs, names):
    for index, reg in enumerate(sorted(regs, key=lambda r: r.get("seed") or 0)):
        name = names[index] if index < len(names) else f"Fahrer {index + 1}"
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"display_name": name, "ingame_name": name}})


async def stations(flow, tournament, names, device="switch2", broken=()):
    docs = []
    for name in names:
        doc = {"id": new_id(), "name": name, "device_type": device, "tournament_id": tournament["id"],
               "status": "broken" if name in broken else "free", "current_match_id": None, "notes": None}
        await flow.db.stations.insert_one(dict(doc))
        docs.append(doc)
    return docs


async def cup(flow, staff, start, title="Mario Kart 8 Autumn Cup", preview=False):
    """Der Cup aus dem Prototyp: 16 Fahrer, je 4 im Lauf, zwei kommen weiter, Loser Bracket, Finale."""
    await flow.db.games.update_one({"id": MK8["id"]}, {"$set": MK8}, upsert=True)
    tournament, _users, regs = await flow.with_participants(
        16, format="ffa_custom_bracket", title=title, slug=f"cup-{new_id()[:6]}", event_mode="local",
        schedule_mode="fixed_by_staff", result_entry_mode="staff_only", start_date=start.isoformat(), game_id=MK8["id"],
        match_duration_minutes=None, match_buffer_minutes=8, match_break_minutes=5)
    await named(flow, regs, NAMES)
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview={'true' if preview else 'false'}", json={
        "name": "Läufe", "stage_type": "ffa_custom_bracket", "match_type": "ffa",
        "settings": {"schema": CUP_SCHEMA, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2}})
    assert response.status_code == 200, response.text
    return tournament


async def snapshot(flow, tournament, *, plan=True):
    tid = tournament["id"]
    data = {
        "tournament": (await flow.get(f"/api/tournaments/{tid}?include_draft=true")).json(),
        "matches": (await flow.get(f"/api/tournaments/{tid}/matches-v2")).json(),
        "stages": (await flow.get(f"/api/tournaments/{tid}/stages")).json(),
        "stations": (await flow.get(f"/api/stations?tournament_id={tid}")).json(),
    }
    bracket = (await flow.get(f"/api/tournaments/{tid}/bracket")).json()
    data["duration_game"] = bracket.get("duration_game")
    data["registrations"] = [{key: reg.get(key) for key in ("id", "display_name", "ingame_name", "status", "seed", "team_id")}
                             for reg in (await flow.get(f"/api/tournaments/{tid}/registrations")).json()]
    if plan:
        response = await flow.post(f"/api/tournaments/{tid}/schedule/plan")
        assert response.status_code == 200, response.text
        data["plan"] = response.json()
    return data


async def result(flow, match, *, scores=(15, 12, 9, 6)):
    ranking = [slot["registration_id"] for slot in match["slots"] if slot.get("registration_id")]
    response = await flow.post(f"/api/matches/{match['id']}/result", json={
        "results": [{"registration_id": reg, "rank": index + 1, "score": scores[index] if index < len(scores) else 0}
                    for index, reg in enumerate(ranking)]})
    assert response.status_code == 200, response.text


async def local_states(out):
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        start = quarter(now_utc() + timedelta(hours=2))
        tournament = await cup(flow, staff, start)
        await stations(flow, tournament, ["Switch 1", "Switch 2"])
        out["local"] = {"preview": await snapshot(flow, tournament)}
        plan = out["local"]["preview"]["plan"]
        applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                                  json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})
        assert applied.status_code == 200, applied.text
        out["local"]["apply_response"] = applied.json()
        out["local"]["applied"] = await snapshot(flow, tournament)

        stale = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                                json={"fingerprint": "veraltet", "planned_at": now_utc().isoformat()})
        assert stale.status_code == 409, stale.text
        by_key = {match["match_key"]: match for match in await flow.matches(tournament)}
        # Eine Station doppelt belegen: der Server lehnt ab (so wie beim Ziehen auf ein belegtes Feld).
        taken = await flow.put(f"/api/matches/{by_key['B']['id']}", json={
            "scheduled_at": by_key["A"]["scheduled_at"], "station_id": by_key["A"]["station_id"]})
        assert taken.status_code == 409, taken.text
        # E von Hand vor das Ende von A legen: der Planer meldet „zu früh“, verschiebt aber nicht.
        early = await flow.put(f"/api/matches/{by_key['E']['id']}", json={
            "scheduled_at": (start + timedelta(minutes=10)).isoformat(), "station_id": None})
        assert early.status_code == 200, early.text
        out["local"]["conflict"] = await snapshot(flow, tournament)
        out["local"]["errors"] = {"stale_apply": stale.json(), "station_taken": taken.json()}
    finally:
        await shutdown()


async def draft_state(out):
    """Vor dem Check-in-Ende: der Baum ist eine Vorschau (so steht der Cup bis zum Turniertag) - der Planer meldet „none“."""
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        start = quarter(now_utc() + timedelta(days=2))
        tournament = await cup(flow, staff, start, title="Mario Kart 8 Autumn Cup (Vorschau)", preview=True)
        await stations(flow, tournament, ["Switch 1", "Switch 2"])
        out["draft"] = await snapshot(flow, tournament)
    finally:
        await shutdown()


async def live_state(out):
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        start = quarter(now_utc() - timedelta(minutes=70))
        tournament = await cup(flow, staff, start, title="Mario Kart 8 Autumn Cup (läuft)")
        await stations(flow, tournament, ["Switch 1", "Switch 2"])
        stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
        # Geplant wurde vor dem Start - mit dem echten Planer, Anker = Turnierstart.
        plan = await plan_for_tournament(flow.db, stored, now=start)
        await apply_plan(flow.db, stored, plan)
        await flow.start(tournament)
        flow.act_as(staff)
        by_key = {match["match_key"]: match for match in await flow.matches(tournament)}
        for key in ("A", "B"):
            await result(flow, by_key[key])
        # C hätte längst beginnen sollen und startet erst jetzt an seiner Station - der Rest rutscht nach.
        current = await flow.reload(by_key["C"])
        started = await flow.post(f"/api/stations/{current['station_id']}/assign/{current['id']}?start_now=true")
        assert started.status_code == 200, started.text
        out["live"] = await snapshot(flow, tournament)
        out["live"]["now"] = now_utc().isoformat()
    finally:
        await shutdown()


async def big_state(out):
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        start = quarter(now_utc() + timedelta(hours=1))
        tournament, _users, regs = await flow.with_participants(
            24, format="double_elim", title="Lions Smash Open mit einem sehr langen Turniernamen, der nicht in eine Zeile passt",
            event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode="staff_only", start_date=start.isoformat(),
            match_duration_minutes=None, match_break_minutes=5)
        await named(flow, regs, LONG + NAMES)
        flow.act_as(staff)
        response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
        assert response.status_code == 200, response.text
        names = [f"Station {index}" for index in range(1, 8)] + ["Übertragungsplatz Bühne links (Beamer und Kamera)"]
        await stations(flow, tournament, names, broken={"Station 7"})
        out["big"] = await snapshot(flow, tournament)
    finally:
        await shutdown()


async def online_state(out):
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        start = (now_utc() - timedelta(minutes=10)).replace(second=0, microsecond=0)
        tournament, _users, regs = await flow.with_participants(
            8, format="single_elim", title="Online-Abend Rocket League", event_mode="online", schedule_mode="player_proposal",
            start_date=start.isoformat())
        await named(flow, regs, NAMES)
        flow.act_as(staff)
        response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
        assert response.status_code == 200, response.text
        await flow.start(tournament)
        matches = sorted(await flow.matches(tournament), key=lambda row: (row["round"], row.get("match_key") or ""))
        await result(flow, matches[0], scores=(3, 1))
        out["online"] = await snapshot(flow, tournament)
        deadlines = await flow.get(f"/api/tournaments/{tournament['id']}/schedule/deadlines")
        assert deadlines.status_code == 200, deadlines.text
        out["online"]["deadlines"] = deadlines.json()
    finally:
        await shutdown()


async def online_draft_state(out):
    """Online, Baum noch Vorschau (Anmeldung offen): die Spiele stehen als Vorschau da."""
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        start = quarter(now_utc() + timedelta(days=3))
        tournament, _users, regs = await flow.with_participants(
            8, format="single_elim", title="Online-Abend (Vorschau)", event_mode="online", schedule_mode="player_proposal",
            start_date=start.isoformat())
        await named(flow, regs, NAMES)
        flow.act_as(staff)
        response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=true")
        assert response.status_code == 200, response.text
        out["online_draft"] = await snapshot(flow, tournament)
        deadlines = await flow.get(f"/api/tournaments/{tournament['id']}/schedule/deadlines")
        out["online_draft"]["deadlines"] = deadlines.json()
    finally:
        await shutdown()


async def league_state(out):
    flow, shutdown = make_flow()
    try:
        staff = await flow.add_staff()
        start = quarter(now_utc() - timedelta(days=8))
        tournament, _users, regs = await flow.with_participants(
            6, format="league", title="Lionsquad-Liga Herbst", event_mode="online", schedule_mode="player_proposal",
            start_date=start.isoformat(), matchday_days=7, default_match_weekday=6, default_match_time="20:00")
        await named(flow, regs, ["Lions A", "Lions B", "Pride", "Roar", "Mane", "Claws"])
        flow.act_as(staff)
        response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
        assert response.status_code == 200, response.text
        await flow.start(tournament)
        out["league"] = await snapshot(flow, tournament)
        matchdays = await flow.get(f"/api/tournaments/{tournament['id']}/matchdays")
        assert matchdays.status_code == 200, matchdays.text
        out["league"]["matchdays"] = matchdays.json()
        deadlines = await flow.get(f"/api/tournaments/{tournament['id']}/schedule/deadlines")
        out["league"]["deadlines"] = deadlines.json()
    finally:
        await shutdown()


INFO = ("Erzeugt von scripts/make_matchplan_fixture.py mit dem echten Generator, dem echten Planer (#1552) und den "
        "echten Routen (#1557). Zeiten sind relativ zum Erzeugen. Nicht von Hand ändern - neu erzeugen.")


async def main():
    out = {"_info": INFO, "generated_at": now_utc().isoformat()}
    await local_states(out)
    await draft_state(out)
    await live_state(out)
    await big_state(out)
    await online_state(out)
    await online_draft_state(out)
    await league_state(out)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")
    for key in ("preview", "applied", "conflict"):
        plan = out["local"][key]["plan"]
        print("local", key, plan["mode"], len(plan["assignments"]), [w["type"] for w in plan["warnings"]])
    print("draft", out["draft"]["plan"]["mode"], out["draft"]["plan"]["reason"], sum(1 for m in out["draft"]["matches"] if m.get("is_preview")))
    print("live", len(out["live"]["plan"]["assignments"]), [w["type"] for w in out["live"]["plan"]["warnings"]])
    print("big", len(out["big"]["matches"]), out["big"]["plan"]["mode"], len(out["big"]["plan"]["assignments"]))
    print("online", out["online"]["plan"]["mode"], len(out["online"]["deadlines"]["matches"]))
    print("online_draft", out["online_draft"]["plan"]["mode"], sum(1 for m in out["online_draft"]["matches"] if m.get("is_preview")))
    print("league", out["league"]["plan"]["mode"], len(out["league"]["matchdays"].get("matchdays") or []))


if __name__ == "__main__":
    asyncio.run(main())
