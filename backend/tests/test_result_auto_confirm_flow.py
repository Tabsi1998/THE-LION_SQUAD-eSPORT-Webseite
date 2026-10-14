"""Ergebnis gilt nach Frist (#1551, Entscheidung E6): meldet eine Seite und widerspricht die andere nicht, gilt das Ergebnis
online nach 15 Minuten, in der Liga nach 48 Stunden - spätestens zum Ende der Spielwoche. Vor Ort bestätigt wie bisher
die Turnierleitung. Ein Einspruch bleibt danach bis zum Rundenende möglich (Liga: bis zum Ende der Spielwoche).
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services.match_deadline_sweep import sweep  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def later(**delta):
    return now_utc() + timedelta(**delta)


async def setup(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, first, second, player


def duel(winner: str, loser: str, winner_score=2, loser_score=1) -> dict:
    return {"results": [{"registration_id": winner, "rank": 1, "score": winner_score},
                        {"registration_id": loser, "rank": 2, "score": loser_score}]}


async def report(flow, player, match, payload):
    flow.act_as(player)
    response = await flow.post(f"/api/matches/{match['id']}/report", json=payload)
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_online_result_counts_after_fifteen_minutes_without_objection(flow):
    _staff, tournament, match, first, second, player = await setup(flow, event_mode="online")
    await report(flow, player[first], match, duel(first, second))
    assert (await sweep(flow.db, now=later(minutes=14)))["confirmed"] == 0
    assert (await flow.reload(match))["status"] != "completed"

    assert (await sweep(flow.db, now=later(minutes=16)))["confirmed"] == 1
    decided = await flow.reload(match)
    assert decided["status"] == "completed"
    assert [row["registration_id"] for row in decided["results"] if row["rank"] == 1] == [first]
    assert decided["result_meta"]["auto_confirmed"] is True
    assert await flow.match_for(tournament, first, after_round=match["round"]) is not None, "der Sieger rückt weiter"
    audits = await flow.db.audit_logs.find({"action": "match.result.auto_confirm"}, {"_id": 0}).to_list(5)
    assert len(audits) == 1

    assert (await sweep(flow.db, now=later(minutes=20)))["confirmed"] == 0, "ein zweiter Lauf ändert nichts"
    assert await flow.db.audit_logs.count_documents({"action": "match.result.auto_confirm"}) == 1
    told = await flow.db.notifications.find({"kind": "match_result"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in told} == {player[first]["id"], player[second]["id"]}


@pytest.mark.asyncio
async def test_objection_or_conflict_stops_the_automatic_result(flow):
    _staff, _tournament, match, first, second, player = await setup(flow, event_mode="online")
    await report(flow, player[first], match, duel(first, second))
    await report(flow, player[second], match, duel(second, first))
    assert (await sweep(flow.db, now=later(minutes=30)))["confirmed"] == 0, "zwei verschiedene Meldungen: die Turnierleitung entscheidet"

    _staff, _tournament, other, a, b, player2 = await setup(flow, event_mode="online")
    await report(flow, player2[a], other, duel(a, b))
    flow.act_as(player2[b])
    objected = await flow.post(f"/api/matches/{other['id']}/dispute", json={"reason": "Stimmt nicht", "category": "wrong_result"})
    assert objected.status_code == 200, objected.text
    assert (await sweep(flow.db, now=later(minutes=30)))["confirmed"] == 0


@pytest.mark.asyncio
async def test_on_site_the_tournament_lead_confirms_as_before(flow):
    _staff, _tournament, match, first, second, player = await setup(flow, event_mode="local", result_entry_mode="player_confirmed")
    await report(flow, player[first], match, duel(first, second))
    assert (await sweep(flow.db, now=later(hours=3)))["confirmed"] == 0


async def league(flow, *, started_days_ago: float):
    start = (now_utc() - timedelta(days=started_days_ago)).isoformat()
    return await setup(flow, event_mode="online", format="league", start_date=start, matchday_days=7)


@pytest.mark.asyncio
async def test_league_result_counts_after_48_hours(flow):
    _staff, _tournament, match, first, second, player = await league(flow, started_days_ago=0.5)
    await report(flow, player[first], match, duel(first, second))
    assert (await sweep(flow.db, now=later(hours=47)))["confirmed"] == 0
    assert (await sweep(flow.db, now=later(hours=49)))["confirmed"] == 1


@pytest.mark.asyncio
async def test_league_result_counts_at_the_latest_when_the_week_ends(flow):
    _staff, _tournament, match, first, second, player = await league(flow, started_days_ago=6)
    await report(flow, player[first], match, duel(first, second))
    assert (await sweep(flow.db, now=later(hours=23)))["confirmed"] == 0
    assert (await sweep(flow.db, now=later(hours=25)))["confirmed"] == 1, "die Spielwoche endet nach einem Tag - früher als 48 Stunden"


@pytest.mark.asyncio
async def test_objection_after_the_automatic_result_stays_possible(flow):
    _staff, _tournament, match, first, second, player = await setup(flow, event_mode="online")
    await report(flow, player[first], match, duel(first, second))
    await sweep(flow.db, now=later(minutes=16))
    assert (await flow.reload(match))["status"] == "completed"
    flow.act_as(player[second])
    objected = await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Das war 1:2", "category": "wrong_result"})
    assert objected.status_code == 200, objected.text
    assert (await flow.reload(match))["status"] == "disputed"


@pytest.mark.asyncio
async def test_league_objection_after_the_automatic_result_until_the_week_ends(flow):
    _staff, tournament, match, first, second, player = await league(flow, started_days_ago=1)
    await report(flow, player[first], match, duel(first, second))
    await sweep(flow.db, now=later(hours=49))
    assert (await flow.reload(match))["status"] == "completed"
    two_days_ago = (now_utc() - timedelta(hours=40)).isoformat()
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"completed_at": two_days_ago, "result_meta.confirmed_at": two_days_ago}})
    page = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert page["can_dispute"] is True, "die Spielwoche läuft noch"

    # Ein Ergebnis, das beide Seiten gemeldet haben, bleibt bei 30 Minuten.
    other = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[1]
    a, b = [slot["registration_id"] for slot in other["slots"]]
    await report(flow, player[a], other, duel(a, b))
    await report(flow, player[b], other, duel(a, b))
    await flow.db.matches_v2.update_one({"id": other["id"]}, {"$set": {"completed_at": two_days_ago, "result_meta.confirmed_at": two_days_ago}})
    flow.act_as(player[b])
    page = (await flow.get(f"/api/matches/{other['id']}/page")).json()
    assert page["can_dispute"] is False
