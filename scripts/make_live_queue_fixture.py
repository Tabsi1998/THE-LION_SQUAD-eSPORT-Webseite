"""Erzeugt frontend/e2e/fixtures/liveQueueGenerated.json - die Warteschlange vor Ort (#1556) aus den echten Routen.

Keine handgeschriebenen Daten: Baum aus ``from-format``, Zeiten und Stationen aus „Planen“ und „Übernehmen“, Aufruf und
Start über ``/live-queue/call`` und ``/live-queue/start``, gelesen über ``GET /live-queue`` (Turnierleitung) und
``GET /live-queue/me`` (Spieler). Flow-Testumgebung (In-Memory), keine echten Konten, erfundene Namen.

Zustände (je eine Zeile in ``states``):
- ``start``: K.-o. 8 vor Ort, drei Stationen, Plan übernommen, nichts läuft.
- ``live``: Viertelfinale 1 läuft seit 25 Minuten (Uhr gelb), Viertelfinale 2 ist aufgerufen, alles 15 Minuten hinter
  dem Plan; Station 3 ist defekt. Dazu ``me`` (Sicht eines Spielers aus Viertelfinale 3) und ``match_page`` (die
  Matchseite dieses Spiels).
- ``worst``: dasselbe mit langen, diakritischen und Emoji-Namen (break-ui).
- ``online``: ein Online-Turnier - keine Warteschlange.

Nach einer Änderung an Planer oder Warteschlange neu erzeugen (Backend-Umgebung, z. B. Venv von local_check):

    python scripts/make_live_queue_fixture.py
"""
import asyncio
import json
import pathlib
import sys
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "e2e" / "fixtures" / "liveQueueGenerated.json"
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "backend" / "tests"))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402

NAMES = ["NeonFalke", "KartKönigin", "LuckyLion", "PixelPaula", "DriftDaniel", "BoostBerta", "TurboTom", "SchnellSchnecke"]
WORST = ["Der unglaublich lange Spielername Nummer Eins mit noch mehr Text dahinter", "Aleksandra Wiśniewska-Kowalczyk",
         "🦁 Löwenherz", "Nguyễn Thị Thanh Hương", "bartholomew.fitzgerald@northwind-industries.example", "Jo", "Ω", "ØrjanÅsbø"]


async def on_site(flow, names: list[str]) -> tuple[dict, list[dict], list[dict], list[dict]]:
    staff = await flow.add_staff()
    flow.act_as(staff)
    start = (now_utc() - timedelta(minutes=40)).replace(second=0, microsecond=0)
    tournament = await flow.create_tournament(
        title="Herbst-LAN Mario Kart Cup", slug="herbst-lan-cup", max_participants=len(names), event_mode="local",
        schedule_mode="fixed_by_staff", result_entry_mode="staff_only", start_date=start.isoformat())
    users, registrations = [], []
    for seed, name in enumerate(names, start=1):
        user = await flow.add_user(name=name)
        users.append(user)
        registrations.append(await flow.register(tournament, user, seed=seed))
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    stations = []
    for name in ("1", "2", "3"):
        doc = {"id": f"st{name}", "name": name, "device_type": "switch2", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None, "notes": None}
        await flow.db.stations.insert_one(dict(doc))
        stations.append(doc)
    planned = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                              json={"fingerprint": planned["fingerprint"], "planned_at": planned["planned_at"]})
    assert applied.status_code == 200, applied.text
    return tournament, users, registrations, stations


async def queue(flow, tournament) -> dict:
    response = await flow.get(f"/api/tournaments/{tournament['id']}/live-queue")
    assert response.status_code == 200, response.text
    return response.json()


async def go_live(flow, tournament, users, registrations, stations) -> dict:
    """QF1 läuft seit 25 Minuten an Station 1, QF2 ist an Station 2 aufgerufen, Station 3 defekt, alles 15 Min. zu spät."""
    rows = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("order") or 0))
    first_round = [row for row in rows if row.get("round") == 1]
    by_station: dict[str, dict] = {}
    for row in sorted(first_round, key=lambda item: item.get("scheduled_at") or ""):
        by_station.setdefault(row.get("station_id"), row)
    one = by_station.get("st1") or first_round[0]
    two = by_station.get("st2") or first_round[1]
    response = await flow.post(f"/api/tournaments/{tournament['id']}/live-queue/start", json={"station_id": "st1", "match_id": one["id"]})
    assert response.status_code == 200, response.text
    response = await flow.post(f"/api/tournaments/{tournament['id']}/live-queue/call", json={"station_id": "st2", "match_id": two["id"]})
    assert response.status_code == 200, response.text
    now = now_utc()
    await flow.db.matches_v2.update_one({"id": one["id"]}, {"$set": {"started_at": (now - timedelta(minutes=25)).isoformat(),
                                                                   "scheduled_at": (now - timedelta(minutes=40)).isoformat()}})
    for row in rows:
        if row.get("scheduled_at") and row["id"] != one["id"]:
            shifted = (datetime.fromisoformat(row["scheduled_at"]) - timedelta(minutes=15)).isoformat()
            await flow.db.matches_v2.update_one({"id": row["id"]}, {"$set": {"scheduled_at": shifted}})
    await flow.db.stations.update_one({"id": "st3"}, {"$set": {"status": "broken"}})
    view = await queue(flow, tournament)
    # Ein Spieler, dessen Spiel als Nächstes kommt (nicht aufgerufen, nicht laufend).
    waiting = next(entry for entry in view["matches"].values() if entry["state"] == "queued" and entry["ready"])
    match = next(row for row in rows if row["id"] == waiting["match_id"])
    player = next(users[index] for index, reg in enumerate(registrations) if reg["id"] == match["slots"][0]["registration_id"])
    flow.act_as(player)
    me = (await flow.get(f"/api/tournaments/{tournament['id']}/live-queue/me")).json()
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    flow.act_as(None)
    public = await queue(flow, tournament)
    return {"view": view, "me": me, "match_page": page, "public": public, "match_id": match["id"], "now": view["now"]}


async def build() -> dict:
    out: dict = {"states": {}}
    flow, shutdown = make_flow()
    try:
        tournament, users, registrations, stations = await on_site(flow, NAMES)
        out["tournament"] = {"id": tournament["id"], "slug": tournament["slug"], "title": tournament["title"], "event_mode": "local"}
        out["states"]["start"] = await queue(flow, tournament)
        live = await go_live(flow, tournament, users, registrations, stations)
        out["states"]["live"] = live["view"]
        out["states"]["public"] = live["public"]
        out["me"] = live["me"]
        out["match_page"] = live["match_page"]
        out["match_id"] = live["match_id"]
        out["now"] = live["now"]
    finally:
        await shutdown()
    flow, shutdown = make_flow()
    try:
        tournament, users, registrations, stations = await on_site(flow, WORST)
        live = await go_live(flow, tournament, users, registrations, stations)
        out["states"]["worst"] = live["view"]
        out["worst_now"] = live["now"]
        flow.act_as(await flow.add_staff())
        online = await flow.create_tournament(title="Online Cup", event_mode="online", schedule_mode="player_proposal", status="live")
        out["states"]["online"] = await queue(flow, online)
    finally:
        await shutdown()
    return out


def main() -> None:
    data = asyncio.run(build())
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    print(f"geschrieben: {OUT.relative_to(ROOT)} ({len(data['states'])} Zustände)")


if __name__ == "__main__":
    main()
