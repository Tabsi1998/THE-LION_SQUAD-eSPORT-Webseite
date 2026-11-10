"""Preisträger (#2337): „Ein vergebener Preis aus einem Turnier zählt“ - und nur der.

Bisher zählte jeder Eintrag in ``prize_pickups`` mit der Person darin: auch Fast-Lap-Preise, Verlosungen und verfallene
Gewinne. Ein Team-Preis zählte nur für die Person, die das Team angemeldet hat.
Die Preise entstehen hier wie im Betrieb: Preisstruktur am Turnier, Ergebnisse veröffentlichen.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import achievement_play as play  # noqa: E402
from flow_harness import make_flow, new_id  # noqa: E402
import badges  # noqa: E402
from models import now_utc  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import prize_service  # noqa: E402

PRIZES = [{"group": "overall", "place": 1, "label": "Pokal", "value": "Gutschein 50 €"},
          {"group": "overall", "place": 2, "label": "Medaille", "value": "Gutschein 20 €"}]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await badges.seed_badges()
        yield instance
    finally:
        await shutdown()


async def prizes(user: dict) -> int:
    return (await counters.compute(user["id"], {"prizes_received"}))["prizes_received"]


@pytest.mark.asyncio
async def test_turnierpreis_zaehlt_solange_er_nicht_verfaellt(flow):
    field = [await flow.add_user(name=f"Spieler {n}") for n in range(1, 5)]
    staff = await flow.add_staff()
    tournament, _regs = await play.played_cup(flow, field, prize_places=PRIZES)
    pickups = {doc["user_id"]: doc async for doc in flow.db.prize_pickups.find({"tournament_id": tournament["id"]}, {"_id": 0})}
    assert {pickups[field[0]["id"]]["place"], pickups[field[1]["id"]]["place"]} == {1, 2} and len(pickups) == 2
    assert all(doc["status"] == "pending" for doc in pickups.values())
    assert [await prizes(person) for person in field] == [1, 1, 0, 0], "vorgemerkt ist vergeben"

    mine = pickups[field[0]["id"]]
    await prize_service.mark_ready(mine["id"], staff["id"])
    assert await prizes(field[0]) == 1, "abholbereit"
    await prize_service.mark_picked_up(mine["id"], staff["id"])
    assert await prizes(field[0]) == 1, "abgeholt"

    # Der zweite Preis wird bereitgestellt, aber nie abgeholt: Er verfällt und zählt dann nicht mehr.
    other = pickups[field[1]["id"]]
    await prize_service.mark_ready(other["id"], staff["id"])
    await flow.db.prize_pickups.update_one({"id": other["id"]}, {"$set": {"pickup_deadline": (now_utc() - timedelta(days=1)).isoformat()}})
    expired = await prize_service.expire_overdue()
    assert expired == 1
    assert await prizes(field[1]) == 0, "verfallen"


@pytest.mark.asyncio
async def test_strittiger_preis_nach_einer_korrektur_zaehlt_nicht(flow):
    field = [await flow.add_user(name=f"Spieler {n}") for n in range(1, 3)]
    tournament, _regs = await play.played_cup(flow, field, prize_places=PRIZES[:1])
    assert await prizes(field[0]) == 1
    await flow.db.prize_pickups.update_one({"tournament_id": tournament["id"]}, {"$set": {"needs_review": True}})
    assert await prizes(field[0]) == 0, "„nach Korrektur prüfen“ ist kein vergebener Preis"


@pytest.mark.asyncio
async def test_fast_lap_und_verlosung_sind_keine_turnierpreise(flow):
    me = await flow.add_user(name="Gewinnerin")
    stamp = now_utc().isoformat()
    await flow.db.prize_pickups.insert_many([
        {"id": new_id(), "source_type": "fastlap", "fastlap_challenge_id": "c1", "user_id": me["id"], "place": 1, "prize_label": "Bestzeit",
         "status": "picked_up", "created_at": stamp, "updated_at": stamp},
        {"id": new_id(), "source_type": "season", "season_key": "easter", "season_year": 2026, "user_id": me["id"], "prize_label": "Osterkorb",
         "status": "ready", "created_at": stamp, "updated_at": stamp},
    ])
    assert await prizes(me) == 0


@pytest.mark.asyncio
async def test_sonderpreis_von_hand_zaehlt(flow):
    """Ein Sonderpreis, den die Turnierleitung über die Verwaltung anlegt (#2112), ist ein Preis aus dem Turnier."""
    field = [await flow.add_user(name=f"Spieler {n}") for n in range(1, 3)]
    tournament, _regs = await play.played_cup(flow, field)
    flow.act_as(await flow.add_staff())
    response = await flow.post("/api/prizes", json={"tournament_id": tournament["id"], "user_id": field[1]["id"], "place": 2, "prize_label": "Fair-Play-Preis"})
    assert response.status_code == 200, response.text
    assert [await prizes(person) for person in field] == [0, 1]


@pytest.mark.asyncio
async def test_team_preis_zaehlt_fuer_alle_die_gespielt_haben(flow):
    staff, tournament, team, registration, (lead, member, bench), rival_regs = await play.team_cup(flow, tournament_fields={"prize_places": PRIZES[:1]})
    await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"lineup": [member["id"], bench["id"]]}})
    await play.play_out(flow, staff, tournament, [registration["id"], *[reg["id"] for reg in rival_regs]])
    await play.finish(flow, staff, tournament)
    pickup = await flow.db.prize_pickups.find_one({"tournament_id": tournament["id"]}, {"_id": 0})
    assert (pickup["team_id"], pickup["user_id"]) == (team["id"], lead["id"]), "der Gewinn hängt am Team - eingetragen ist, wer angemeldet hat"
    assert [await prizes(person) for person in (lead, member, bench)] == [0, 1, 1], "gespielt haben die Aufgestellten"
