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


@pytest.mark.asyncio
async def test_a_league_staffel_gets_no_extra_schedule_message(flow):
    """Liga-Staffeln haben eigene Meldungen (docs/LIGA.md) - „Der Spielplan ist da“ kommt dort nicht dazu (Fachfrage #1662)."""
    from services.tournament_progress import notify_bracket_ready

    staff, tournament, player = await _bracket(flow)
    staffel = {**tournament, "matchday_weeks_total": 6}
    assert await notify_bracket_ready(flow.db, staffel) == 0
    assert await notify_bracket_ready(flow.db, {**tournament, "league_context": {"season_id": "s1"}}) == 0
    assert await flow.db.notifications.count_documents({"kind": "tournament_bracket"}) == 0


# ---------------------------------------------------------------- Nachbesserung (Prüfung 26.11.)

def _staff_duel(winner, loser, **extra):
    return {"results": [{"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 1}], **extra}


async def _latest(flow, user_id):
    rows = await flow.db.notifications.find({"kind": "tournament_progress", "user_id": user_id}, {"_id": 0}).to_list(20)
    rows.sort(key=lambda row: row["created_at"])
    return rows


@pytest.mark.asyncio
async def test_corrections_leave_the_right_last_message(flow):
    """A schlägt B, Korrektur: B gewinnt, Korrektur: A gewinnt. Die letzte Meldung stimmt, überholte sind als überholt markiert."""
    staff, tournament, player = await _bracket(flow)
    await flow.start(tournament)
    semi = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    a, b = [slot["registration_id"] for slot in semi["slots"]]
    flow.act_as(staff)
    first = await flow.post(f"/api/matches/{semi['id']}/result", json=_staff_duel(a, b))
    assert first.status_code == 200, first.text
    for winner, loser in ((b, a), (a, b)):
        corrected = await flow.post(f"/api/matches/{semi['id']}/result?force=true", json=_staff_duel(winner, loser, reason="vertauscht"))
        assert corrected.status_code == 200, corrected.text
    rows_a, rows_b = await _latest(flow, player[a]["id"]), await _latest(flow, player[b]["id"])
    assert [row["title"] for row in rows_a] == ["Du bist weiter!", "Ausgeschieden", "Du bist weiter!"]
    assert [row["title"] for row in rows_b] == ["Ausgeschieden", "Du bist weiter!", "Ausgeschieden"]
    for rows in (rows_a, rows_b):
        assert not rows[-1]["meta"].get("superseded")
        assert all(row["meta"].get("superseded") is True and row["read"] is True for row in rows[:-1])


async def _play_out(flow, tournament, player, staff):
    """Spielt alles, was spielbar ist; immer gewinnt der kleinere Setzplatz."""
    seeds = {reg["id"]: reg.get("seed") or 99 for reg in await flow.db.tournament_registrations.find(
        {"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)}
    flow.act_as(staff)
    for _round in range(20):
        open_matches = [row for row in await flow.matches(tournament)
                        if row.get("status") not in ("completed", "forfeit", "cancelled")
                        and len([slot for slot in row.get("slots") or [] if slot.get("registration_id")]) == 2]
        if not open_matches:
            return
        row = sorted(open_matches, key=lambda item: (item.get("round") or 0, item.get("match_key") or ""))[0]
        first, second = sorted([slot["registration_id"] for slot in row["slots"]], key=lambda rid: seeds[rid])
        res = await flow.post(f"/api/matches/{row['id']}/result", json=_staff_duel(first, second))
        assert res.status_code == 200, res.text


@pytest.mark.asyncio
async def test_double_elimination_grand_final_won_by_the_top_seed_says_nothing(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, format="double_elim", title="Winter Cup")
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    await _play_out(flow, tournament, player, staff)
    matches = await flow.matches(tournament)
    reset = [row for row in matches if row.get("status") == "cancelled"]
    assert reset, "der Reset des Grand Finals entfällt"
    finals = [row for row in matches if any(edge.get("to_match_id") == reset[0]["id"] or edge.get("to_match_key") == reset[0].get("match_key")
                                            for edge in row.get("advancement") or [])]
    assert finals
    for final in finals:
        assert await flow.db.notifications.count_documents({"kind": "tournament_progress", "meta.source_match_id": final["id"]}) == 0


@pytest.mark.asyncio
async def test_the_scheduler_start_tells_the_bracket_too(flow):
    staff, tournament, player = await _bracket(flow)
    past = (now_utc() - timedelta(minutes=5)).isoformat()
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "status": "registration_closed", "auto_start_enabled": True, "start_date": past,
        "end_date": (now_utc() + timedelta(hours=4)).isoformat()}})
    from services import scheduler
    await scheduler._safe_status_transitions()
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, "status": 1}))["status"] == "live"
    assert await flow.db.notifications.count_documents({"kind": "tournament_bracket"}) == len(player)


@pytest.mark.asyncio
async def test_the_first_match_at_a_station_tells_the_bracket_too(flow):
    staff, tournament, player = await _bracket(flow)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"status": "registration_closed"}})
    station = {"id": "st-1", "name": "Switch 1", "status": "free", "tournament_id": tournament["id"]}
    await flow.db.stations.insert_one(dict(station))
    match = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    flow.act_as(staff)
    res = await flow.post(f"/api/stations/st-1/assign/{match['id']}?start_now=true")
    assert res.status_code == 200, res.text
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, "status": 1}))["status"] == "live"
    assert await flow.db.notifications.count_documents({"kind": "tournament_bracket"}) == len(player)


@pytest.mark.asyncio
async def test_only_a_pause_notice_for_this_tournament_replaces_the_pause_message(flow):
    staff, tournament, player = await _bracket(flow)
    await flow.start(tournament)
    stamp = now_utc().isoformat()
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"event_id": "ev-1"}})
    await flow.db.tournament_notices.insert_many([
        {"_id": "n-1", "id": "n-1", "target": "event", "event_id": "ev-1", "text": "Pause bis 14:30", "created_at": stamp},
        {"_id": "n-2", "id": "n-2", "target": "tournament", "tournament_id": tournament["id"], "text": "Finale an PC 1", "created_at": stamp},
        {"_id": "n-3", "id": "n-3", "target": "tournament", "tournament_id": "anderes", "text": "Pause bis 14:30", "created_at": stamp},
    ])
    flow.act_as(staff)
    res = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused"})
    assert res.status_code == 200, res.text
    assert await flow.db.notifications.count_documents({"kind": "tournament_pause"}) == len(player)


# ---------------------------------------------------------------- Zweite Nachprüfung (26.11.)

@pytest.mark.asyncio
async def test_a_score_only_correction_says_nothing_new(flow):
    """Sieger bleibt, nur der Spielstand ändert sich (neue report_id): keine zweite gleiche Meldung samt Push."""
    staff, tournament, player = await _bracket(flow)
    await flow.start(tournament)
    semi = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[0]
    a, b = [slot["registration_id"] for slot in semi["slots"]]
    flow.act_as(staff)
    assert (await flow.post(f"/api/matches/{semi['id']}/result", json=_staff_duel(a, b))).status_code == 200
    score = {"results": [{"registration_id": a, "rank": 1, "score": 3}, {"registration_id": b, "rank": 2, "score": 0}], "reason": "Stand"}
    assert (await flow.post(f"/api/matches/{semi['id']}/result?force=true", json=score)).status_code == 200
    assert [row["title"] for row in await _latest(flow, player[a]["id"])] == ["Du bist weiter!"]
    assert [row["title"] for row in await _latest(flow, player[b]["id"])] == ["Ausgeschieden"]
    # Ohne report_id (alter Weg über tournament_events): jede Änderung von updated_at - trotzdem nichts Neues.
    from services.tournament_progress import notify_match_progress
    match = await flow.reload(semi)
    match.pop("result_meta", None)
    match["updated_at"] = now_utc().isoformat()
    assert await notify_match_progress(flow.db, match) == 0
    assert len(await _latest(flow, player[a]["id"])) == 1


@pytest.mark.asyncio
async def test_the_grand_final_loser_reads_about_the_decider_not_a_win(flow):
    """Gewinnt im Grand Final die Seite aus dem Loser Bracket, gibt es ein Entscheidungsspiel - der Verlierer liest kein
    „gewonnen“."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, format="double_elim", title="Winter Cup")
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")).status_code == 200
    await flow.start(tournament)
    seeds = {reg["id"]: reg.get("seed") or 99 for reg in registrations}

    def is_grand_final(row):
        edges = [edge for edge in row.get("advancement") or [] if str(edge.get("flow") or "").upper() == "W"]
        targets = {edge.get("to_match_id") or edge.get("to_match_key") for edge in edges}
        return len(edges) >= 2 and len(targets) == 1

    grand_final = None
    for _round in range(20):
        open_matches = [row for row in await flow.matches(tournament)
                        if row.get("status") not in ("completed", "forfeit", "cancelled")
                        and len([slot for slot in row.get("slots") or [] if slot.get("registration_id")]) == 2]
        if not open_matches:
            break
        row = sorted(open_matches, key=lambda item: (item.get("round") or 0, item.get("match_key") or ""))[0]
        first, second = sorted([slot["registration_id"] for slot in row["slots"]], key=lambda rid: seeds[rid])
        if is_grand_final(row):
            grand_final = row
            first, second = second, first  # die Seite aus dem Loser Bracket gewinnt
        assert (await flow.post(f"/api/matches/{row['id']}/result", json=_staff_duel(first, second))).status_code == 200
        if grand_final:
            break
    assert grand_final, "Grand Final mit Entscheidungsspiel gefunden"
    rows = await flow.db.notifications.find({"kind": "tournament_progress", "meta.source_match_id": grand_final["id"]}, {"_id": 0}).to_list(10)
    by_reason = {row["meta"]["reason"]: row for row in rows}
    assert set(by_reason) == {"decider_won", "decider_lost"}
    lost = by_reason["decider_lost"]
    assert lost["title"] == "Entscheidungsspiel" and "verloren" in lost["body"] and "gewonnen" not in lost["body"]
    assert "gewonnen" in by_reason["decider_won"]["body"] and "Entscheidungsspiel" in by_reason["decider_won"]["body"]
