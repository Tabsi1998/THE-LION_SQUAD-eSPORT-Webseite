"""Turnier-Meldungen (#1209) im echten Ablauf: weiter und ausgeschieden nach dem bestätigten Ergebnis, „Der Turnierbaum ist
da“ beim Start, „Pause bis“ beim Pausieren - nur an Beteiligte, je Ereignis einmal, abschaltbar unter „Turnier-Updates“."""
import pathlib
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services.notification_preferences import mode_preferences  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _bracket(flow, count=4):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, result_entry_mode="player_confirmed", title="Winter Cup")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, player


async def _play(flow, match, player, winner, loser):
    duel = {"results": [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 1}]}
    flow.act_as(player[loser])
    assert (await flow.post(f"/api/matches/{match['id']}/report", json=duel)).status_code == 200
    flow.act_as(player[winner])
    confirmed = await flow.post(f"/api/matches/{match['id']}/report", json=duel)
    assert confirmed.status_code == 200, confirmed.text


async def _progress(flow, **query):
    return await flow.db.notifications.find({"kind": "tournament_progress", **query}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_the_winner_hears_he_is_through_and_the_loser_that_he_is_out(flow):
    staff, tournament, player = await _bracket(flow)
    await flow.start(tournament)
    semi = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    first, second = [slot["registration_id"] for slot in semi["slots"]]
    await _play(flow, semi, player, first, second)

    rows = await _progress(flow)
    by_user = {row["user_id"]: row for row in rows}
    assert set(by_user) == {player[first]["id"], player[second]["id"]}, "nur die beiden Beteiligten"
    won, lost = by_user[player[first]["id"]], by_user[player[second]["id"]]
    assert won["title"] == "Du bist weiter!" and won["body"].startswith("Winter Cup · ")
    assert won["meta"]["reason"] == "advanced" and won["topic"] == "tournament_updates" and won["importance"] == "important"
    final = await flow.match_for(tournament, first, after_round=semi["round"])
    assert won["url"] == f"/matches/{final['id']}", "führt zum nächsten Spiel"
    assert lost["title"] == "Ausgeschieden" and lost["meta"]["reason"] == "eliminated"
    assert lost["url"] == f"/tournaments/{tournament['slug']}"

    # Dasselbe Ergebnis noch einmal gemeldet: keine zweite Meldung.
    from services.tournament_progress import notify_match_progress
    assert await notify_match_progress(flow.db, await flow.reload(semi)) == 0
    assert len(await _progress(flow)) == 2


@pytest.mark.asyncio
async def test_the_final_says_nothing_extra(flow):
    staff, tournament, player = await _bracket(flow, count=2)
    await flow.start(tournament)
    final = (await flow.matches(tournament))[0]
    first, second = [slot["registration_id"] for slot in final["slots"]]
    await _play(flow, final, player, first, second)
    assert await _progress(flow) == [], "für das Finale gibt es „Turnier beendet“"


@pytest.mark.asyncio
async def test_switched_off_tournament_updates_stop_them(flow):
    staff, tournament, player = await _bracket(flow)
    await flow.start(tournament)
    semi = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    first, second = [slot["registration_id"] for slot in semi["slots"]]
    await flow.db.users.update_one({"id": player[first]["id"]},
                                   {"$set": {"notification_preferences": mode_preferences("tournament_updates", "off")}})
    await _play(flow, semi, player, first, second)
    assert [row["user_id"] for row in await _progress(flow)] == [player[second]["id"]]


@pytest.mark.asyncio
async def test_going_live_tells_everyone_the_bracket_is_there_once(flow):
    staff, tournament, player = await _bracket(flow)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "registration_closed"}})
    flow.act_as(staff)
    res = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live", "force": True})
    assert res.status_code == 200, res.text
    rows = await flow.db.notifications.find({"kind": "tournament_bracket"}, {"_id": 0}).to_list(50)
    assert sorted(row["user_id"] for row in rows) == sorted(user["id"] for user in player.values())
    assert all(row["title"] == "Der Turnierbaum ist da" and row["url"].startswith("/matches/") for row in rows)
    assert staff["id"] not in {row["user_id"] for row in rows}

    # Pausieren und weiterspielen: kein zweiter „Baum ist da“.
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused"})).status_code == 200
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live", "force": True})).status_code == 200
    assert await flow.db.notifications.count_documents({"kind": "tournament_bracket"}) == len(player)


@pytest.mark.asyncio
async def test_a_pause_with_a_time_is_announced_once_per_time(flow):
    staff, tournament, player = await _bracket(flow)
    await flow.start(tournament)
    flow.act_as(staff)
    res = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused"})
    assert res.status_code == 200, res.text
    short = await flow.db.notifications.find({"kind": "tournament_pause"}, {"_id": 0}).to_list(50)
    assert len(short) == len(player) and short[0]["title"] == "Kurze Pause"

    until = (now_utc() + timedelta(hours=2)).replace(second=0, microsecond=0).isoformat()
    res = await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": until})
    assert res.status_code == 200, res.text
    clock = datetime.fromisoformat(until).astimezone(ZoneInfo("Europe/Vienna")).strftime("%H:%M")
    timed = await flow.db.notifications.find({"kind": "tournament_pause", "title": f"Pause bis {clock}"}, {"_id": 0}).to_list(50)
    assert len(timed) == len(player) and timed[0]["body"] == f"Winter Cup: Es geht um {clock} Uhr weiter."
    # Dieselbe Uhrzeit noch einmal: nichts Neues.
    await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": until})
    assert await flow.db.notifications.count_documents({"kind": "tournament_pause"}) == 2 * len(player)


@pytest.mark.asyncio
async def test_no_second_pause_message_right_after_a_notice_of_the_lead(flow):
    """Der Hinweis „Pause bis 14:30“ der Turnierleitung pausiert auf Wunsch gleich mit (NoticeComposer) - dann sagt die
    automatische Meldung dasselbe kein zweites Mal."""
    staff, tournament, player = await _bracket(flow)
    await flow.start(tournament)
    await flow.db.tournament_notices.insert_one({"_id": "n-1", "id": "n-1", "target": "tournament", "tournament_id": tournament["id"],
                                                 "text": "Pause bis 14:30", "created_at": now_utc().isoformat()})
    flow.act_as(staff)
    res = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused"})
    assert res.status_code == 200, res.text
    assert await flow.db.notifications.count_documents({"kind": "tournament_pause"}) == 0
