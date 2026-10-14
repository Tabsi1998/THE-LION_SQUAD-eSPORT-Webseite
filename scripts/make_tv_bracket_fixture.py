"""Erzeugt frontend/e2e/fixtures/tvGenerated.json - die TV-Bäume aus dem echten Generator (#1564).

Wie scripts/make_ffa_bracket_fixture.py (#1561), aber so, wie der Beamer sie sieht: gelesen über die echte
TV-Antwort GET /api/tournaments/:id/bracket/display (Flow-Testumgebung, In-Memory, kein Server, keine echten Konten).
Der Baum kommt aus services/custom_bracket (from-format), Zeiten und Stationen aus dem echten Planer
(services/match_scheduler, #1569), Ergebnisse, kampflos und Zusammenlegen über die echten Routen.

Zustände (Zeitpunkt der Erzeugung steht in ``_generated_at``; die Tests stellen ihre Uhr relativ dazu):

* ``se8_planned``  K.-o. mit 8, vor Ort, zwei Stationen, Plan übernommen (Runde 1 fest, danach Prognose)
* ``se8_live``     Spiel A läuft an Switch 1 (gestartet zur geplanten Zeit)
* ``se8_after_a``  A ist entschieden, der Sieger steht im Halbfinale
* ``se8_corrected`` das Ergebnis von A ist korrigiert (umgedreht), der andere steht jetzt im Halbfinale
* ``se8_walkover`` B kampflos (nicht erschienen)
* ``se6``          K.-o. mit 6: zwei Freilose in Runde 1
* ``de16`` … ``de16_champion`` Doppel-K.-o. mit 16 und Reset, lange Namen: Start, nach Winner Runde 1, vor dem
  Grand Final, Reset nötig (Sieger aus dem Loser Bracket gewinnt das Grand Final), Sieger nach dem Reset
* ``de16_before_no_reset`` / ``de16_no_reset`` derselbe Baum noch einmal, vor dem Grand Final und danach - diesmal gewinnt
  der Sieger des Winner Bracket: der Reset entfällt
* ``ffa8_before_merge`` / ``ffa8_after_merge`` 8 von 16 in 4er-Läufen mit Stationen, vor und nach dem Zusammenlegen
* ``ffa16`` / ``ffa16_round1`` 16 Fahrer, Start und nach Runde 1 (in Lauf A kommt der Letzte nicht ins Ziel); ``ffa40`` 40 Fahrer mit langen Namen

Nach einer Änderung an Generator, Planer, Umbau oder TV-Antwort neu erzeugen (Backend-Umgebung, z. B. das Venv von
local_check):

    python scripts/make_tv_bracket_fixture.py
"""
import asyncio
import json
import pathlib
import sys
from datetime import timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "e2e" / "fixtures" / "tvGenerated.json"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from services import scheduler  # noqa: E402
from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services.custom_bracket import _auto_ffa_custom_schema  # noqa: E402

NAMES = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke",
         "KurvenKarl", "NitroNina", "BlitzBea", "RaketenRudi", "SternSeppi", "GipfelGabi", "PistenPaul", "ZickZackZoe"]
# Worst Case (break-ui): lange, diakritische und Emoji-Namen, eine E-Mail als Name, ein ganz kurzer.
LONG = {3: "Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter", 6: "Aleksandra Wiśniewska-Kowalczyk",
        9: "🦁 Löwenherz", 12: "Nguyễn Thị Thanh Hương", 14: "bartholomew.fitzgerald@northwind-industries.example", 15: "Jo"}
FFA_LONG = {16: LONG[3], 17: LONG[6], 18: LONG[9], 19: LONG[12], 20: LONG[14], 21: LONG[15]}
DONE = {"completed", "forfeit", "cancelled"}


def on_site(**extra):
    start = now_utc().replace(microsecond=0)
    return {"event_mode": "local", "schedule_mode": "fixed_by_staff", "result_entry_mode": None, "start_date": start.isoformat(),
            "status": "registration_open", **extra}


async def name_players(flow, regs, names):
    for index, reg in enumerate(sorted(regs, key=lambda r: r.get("seed") or 0)):
        name = names(index)
        await flow.db.tournament_registrations.update_one({"id": reg["id"]}, {"$set": {"display_name": name, "ingame_name": name}})


async def add_stations(flow, tournament, *names):
    docs = []
    for name in names:
        doc = {"id": new_id(), "name": name, "device_type": "switch2", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None, "notes": None}
        await flow.db.stations.insert_one(dict(doc))
        docs.append(doc)
    return docs


async def plan(flow, tournament):
    planned = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")
    assert planned.status_code == 200, planned.text
    body = planned.json()
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                              json={"fingerprint": body["fingerprint"], "planned_at": body["planned_at"]})
    assert applied.status_code == 200, applied.text


KEYS: dict[str, str] = {}


async def display(flow, tournament, staff):
    """Die TV-Antwort mit einem echten Anzeige-Schlüssel (#1110) - genau das, was der Beamer ohne Anmeldung sieht."""
    flow.act_as(staff)
    if tournament["id"] not in KEYS:
        created = await flow.post("/api/tv/keys", json={"tournament_id": tournament["id"], "label": "Beamer Halle"})
        assert created.status_code == 200, created.text
        KEYS[tournament["id"]] = created.json()["token"]
    flow.act_as(None)
    response = await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display", params={"key": KEYS[tournament["id"]]})
    flow.act_as(staff)
    assert response.status_code == 200, response.text
    return response.json()


async def by_key(flow, tournament):
    return {m["match_key"]: m for m in await flow.matches(tournament)}


async def decide(flow, match, ranking, dnf_last=False):
    rows = [{"registration_id": reg, "rank": index + 1, "score": max(0, 2 - index)} for index, reg in enumerate(ranking)]
    if dnf_last:
        # Ausgefallen (#1564): der Letzte kam nicht ins Ziel.
        rows[-1] = {**rows[-1], "score": 0, "dnf": True}
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": rows})
    assert response.status_code == 200, response.text


def players(match):
    return [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]


async def knockout(flow, count, fmt, names, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, regs = await flow.with_participants(count, format=fmt, title=fields.pop("title", "Lions Herbst-Cup"), **on_site(**fields))
    await name_players(flow, regs, names)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    return staff, tournament


async def se8(data):
    flow, shutdown = make_flow()
    try:
        staff, t = await knockout(flow, 8, "single_elim", lambda i: NAMES[i])
        switch1, _switch2 = await add_stations(flow, t, "Switch 1", "Switch 2")
        await plan(flow, t)
        await flow.start(t)
        data["se8_planned"] = await display(flow, t, staff)
        matches = await by_key(flow, t)
        first = min((m for m in matches.values() if m["station_id"] == switch1["id"]), key=lambda m: m["scheduled_at"])
        response = await flow.post(f"/api/stations/{switch1['id']}/assign/{first['id']}?start_now=true")
        assert response.status_code == 200, response.text
        data["se8_live"] = await display(flow, t, staff)
        await decide(flow, first, players(first))
        data["se8_after_a"] = await display(flow, t, staff)
        # Korrigiert (#1564): die Turnierleitung dreht das Ergebnis von A um - mit Grund, wie im Ergebnis-Fenster.
        response = await flow.post(f"/api/matches/{first['id']}/result?force=true", json={
            "results": [{"registration_id": reg, "rank": index + 1, "score": 2 - index} for index, reg in enumerate(reversed(players(first)))],
            "reason": "Ergebnis vertauscht eingetragen"})
        assert response.status_code == 200, response.text
        data["se8_corrected"] = await display(flow, t, staff)
        matches = await by_key(flow, t)
        other = next(m for m in sorted(matches.values(), key=lambda m: m["match_key"]) if m["round"] == 1 and m["status"] not in DONE)
        response = await flow.post(f"/api/matches/{other['id']}/forfeit", json={"forfeit_registration_id": players(other)[1], "note": "Nicht erschienen"})
        assert response.status_code == 200, response.text
        data["se8_walkover"] = await display(flow, t, staff)
    finally:
        await shutdown()


async def se6(data):
    """K.-o. mit 6: zwei Freilose in Runde 1 - die Freilos-Zeile am TV."""
    flow, shutdown = make_flow()
    try:
        staff, t = await knockout(flow, 6, "single_elim", lambda i: NAMES[i])
        await add_stations(flow, t, "Switch 1", "Switch 2")
        await plan(flow, t)
        await flow.start(t)
        data["se6"] = await display(flow, t, staff)
    finally:
        await shutdown()


async def play_open(flow, t, stop):
    """Spielt alle spielbaren Spiele (beide Plätze besetzt), der obere Platz gewinnt - bis ``stop(match)`` zutrifft."""
    while True:
        matches = await by_key(flow, t)
        ready = [m for m in sorted(matches.values(), key=lambda m: (m["round"], m.get("order") or 0))
                 if m["status"] not in DONE and len(players(m)) == len(m["slots"]) and not stop(m)]
        if not ready:
            return
        await decide(flow, ready[0], players(ready[0]))


async def de16(data, *, reset: bool):
    flow, shutdown = make_flow()
    try:
        staff, t = await knockout(flow, 16, "double_elim", lambda i: LONG.get(i, NAMES[i]), grand_final_mode="reset", title="Lions Smash-Cup")
        await add_stations(flow, t, "Switch 1", "Switch 2", "Switch 3")
        await plan(flow, t)
        await flow.start(t)
        if reset:
            data["de16"] = await display(flow, t, staff)
            await play_open(flow, t, lambda m: m["round"] > 1 or str(m.get("section")).upper() != "WB")
            data["de16_wb1"] = await display(flow, t, staff)
        await play_open(flow, t, lambda m: str(m.get("section")).upper() == "GF")
        data["de16_before_gf" if reset else "de16_before_no_reset"] = await display(flow, t, staff)
        matches = await by_key(flow, t)
        grand_final = min((m for m in matches.values() if str(m.get("section")).upper() == "GF"), key=lambda m: m["round"])
        by_id = {m["id"]: m for m in matches.values()}
        by_match_key = {m["match_key"]: m for m in matches.values()}

        def from_loser(slot):
            source = slot.get("source") or {}
            origin = by_match_key.get(source.get("match_key")) if isinstance(source, dict) else None
            return str((origin or {}).get("section")).upper() == "LB"

        lower = next(slot["registration_id"] for slot in grand_final["slots"] if from_loser(slot))
        upper = next(slot["registration_id"] for slot in grand_final["slots"] if not from_loser(slot))
        await decide(flow, grand_final, [lower, upper] if reset else [upper, lower])
        if reset:
            data["de16_reset"] = await display(flow, t, staff)
            matches = await by_key(flow, t)
            final_reset = next(m for m in matches.values() if (m.get("settings") or {}).get("bracket_reset"))
            await decide(flow, final_reset, players(final_reset))
            data["de16_champion"] = await display(flow, t, staff)
        else:
            data["de16_no_reset"] = await display(flow, t, staff)
        assert by_id
    finally:
        await shutdown()


async def ffa(flow, count, mode, plan_size, stations=("Switch 1", "Switch 2", "Switch 3", "Switch 4")):
    tournament, _users, regs = await flow.with_participants(
        count, format="ffa_custom_bracket", heat_rebuild_mode=mode, title="Lions Kart-Cup", **on_site())
    await name_players(flow, regs, lambda index: NAMES[index] if index < len(NAMES) else FFA_LONG.get(index, f"Fahrer {index + 1}"))
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": plan_size, "slug": f"kart-cup-{count}"}})
    schema = _auto_ffa_custom_schema(plan_size, 4, 2)
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": schema, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    await add_stations(flow, tournament, *stations)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    # Der Baum entsteht mit dem Ende des Check-ins aus den Eingecheckten (#1551).
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()
    flow.act_as(staff)
    await plan(flow, tournament)
    return tournament, staff


async def ffa_states(data):
    flow, shutdown = make_flow()
    try:
        t16, staff16 = await ffa(flow, 16, "auto", 16)
        await flow.start(t16)
        data["ffa16"] = await display(flow, t16, staff16)
        matches = await by_key(flow, t16)
        for key in ("A", "B", "C", "D"):
            await decide(flow, matches[key], players(matches[key]), dnf_last=key == "A")
        data["ffa16_round1"] = await display(flow, t16, staff16)
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        t8, staff8 = await ffa(flow, 8, "suggest", 16)
        data["ffa8_before_merge"] = await display(flow, t8, staff8)
        flow.act_as(staff8)
        rebuild = (await flow.db.tournaments.find_one({"id": t8["id"]}, {"_id": 0}))["heat_rebuild_plan"]
        response = await flow.post(f"/api/tournaments/{t8['id']}/heat-rebuild/confirm", json={"plan_id": rebuild["id"]})
        assert response.status_code == 200, response.text
        data["ffa8_after_merge"] = await display(flow, t8, staff8)
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        t40, staff40 = await ffa(flow, 40, "auto", 40, stations=tuple(f"Switch {n}" for n in range(1, 9)))
        data["ffa40"] = await display(flow, t40, staff40)
    finally:
        await shutdown()


INFO = ("Erzeugt von scripts/make_tv_bracket_fixture.py mit dem echten Generator, dem echten Planer und den echten Routen, "
        "gelesen über die TV-Antwort /bracket/display (#1564). Nicht von Hand ändern - neu erzeugen. Uhr der Tests: "
        "relativ zu _generated_at.")


async def main():
    generated_at = now_utc().replace(microsecond=0)
    data = {}
    await se8(data)
    await se6(data)
    await de16(data, reset=True)
    await de16(data, reset=False)
    await ffa_states(data)
    out = {"_info": INFO, "_generated_at": generated_at.isoformat(), **{key: data[key] for key in sorted(data)}}
    # Je Zustand eine Zeile: klein genug fürs Repo, und ein neu erzeugter Zustand ist im Diff genau eine Zeile.
    lines = [f"{json.dumps(key)}: {json.dumps(value, ensure_ascii=False, separators=(',', ':'), default=str)}" for key, value in out.items()]
    OUT.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8", newline="\n")
    for key in sorted(data):
        rows = [(m["match_key"], m.get("section"), m["round"], m.get("status"), len(m["slots"]), m.get("station_name"),
                 (m.get("scheduled_at") or "")[11:16], m.get("schedule_forecast"), m.get("merged_into_key"))
                for m in sorted(data[key]["matches_v2"], key=lambda m: (m["round"], m.get("order") or 0))]
        print(key, rows[:6], "…" if len(rows) > 6 else "")


if __name__ == "__main__":
    asyncio.run(main())
