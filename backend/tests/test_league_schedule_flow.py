"""Liga-Termine (#2194, docs/LIGA.md D.1) über die echten Routen: Einigung, Verschiebung mit Grenzen, Leitung, 72-h-Regel,
überfällige Spiele, Historie, Aufgaben und Einstellung je Season. Erfundene Namen."""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_schedule, league_schedule_sweep  # noqa: E402
from services.league_schedule import DEFAULTS  # noqa: E402
from services.match_public_view import public_match_view  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def at(hours: float) -> str:
    return (now_utc() + timedelta(hours=hours)).replace(second=0, microsecond=0).isoformat()


async def live_world(flow, rules: dict | None = DEFAULTS, **fields) -> dict:
    """Staffel seit gestern live (Spielwoche bis in sechs Tagen), Spiel am ersten Spieltag ohne Termin."""
    world = await league_world(flow)
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    update = {"start_date": start.isoformat(), "matchday_days": 7, **fields}
    if rules is not None:
        update["schedule_rules"] = dict(rules)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": update})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": None, "status": "ready"}})
    return world


def mid(world) -> str:
    return world["match"]["id"]


async def agree(flow, world, hours: float = 72) -> dict:
    """Heimseite schlägt vor, Gastseite nimmt an - der Termin steht fest."""
    flow.act_as(world["users"]["Kapitaen"])
    proposal = (await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(hours)})).json()
    flow.act_as(world["users"]["Falke1"])
    answer = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals/{proposal['id']}/decision", json={"action": "accept"})
    assert answer.status_code == 200, answer.text
    return proposal


async def request(flow, world, user: str, hours: float, reason: str = "Spieler im Nachtdienst"):
    flow.act_as(world["users"][user])
    return await flow.post(f"/api/matches/{mid(world)}/reschedule", json={"scheduled_at": at(hours), "reason": reason})


async def decide(flow, world, user: str, request_id: str, action: str):
    flow.act_as(world["users"][user])
    return await flow.post(f"/api/matches/{mid(world)}/reschedule/{request_id}/decision", json={"action": action})


async def page(flow, world, user: str | None) -> dict:
    flow.act_as(world["users"][user] if user else None)
    answer = await flow.get(f"/api/matches/{mid(world)}/page")
    assert answer.status_code == 200, answer.text
    return answer.json()


# ---------------------------------------------------------------- Fester Termin, Einigung

@pytest.mark.asyncio
async def test_agreement_fixes_the_time_and_records_history(flow):
    world = await live_world(flow)
    proposal = await agree(flow, world)
    stored = await flow.reload(world["match"])
    assert stored["schedule_source"] == "accepted"
    assert [row["kind"] for row in stored["schedule_history"]] == ["agreement"]
    assert stored["schedule_history"][0]["request_id"] == proposal["id"]

    flow.act_as(world["users"]["Kapitaen"])
    again = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(80)})
    assert again.status_code == 409 and "Verschiebung beantragen" in again.json()["detail"]

    captain = await page(flow, world, "Kapitaen")
    assert captain["can_propose_schedule"] is False
    block = captain["schedule_block"]
    assert block["fixed"] and block["remaining"] == 2 and block["can_request"] is True
    assert block["history"][0]["kind"] == "agreement" and block["history"][0]["by_name"] == "Falke1"
    assert (await page(flow, world, "Fremd"))["schedule_block"] is None, "Unbeteiligte sehen keine Historie"


@pytest.mark.asyncio
async def test_without_rules_everything_stays_as_before(flow):
    world = await live_world(flow, rules=None)
    await agree(flow, world)
    flow.act_as(world["users"]["Kapitaen"])
    again = await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(80)})
    assert again.status_code == 200, "ohne Regeln bleibt die neue Einigung möglich"
    assert (await request(flow, world, "Kapitaen", 90)).status_code == 409
    captain = await page(flow, world, "Kapitaen")
    assert captain["schedule_block"] is None and captain["can_propose_schedule"] is True


# ---------------------------------------------------------------- Verschiebung

@pytest.mark.asyncio
async def test_reschedule_needs_both_sides_and_a_reason(flow):
    world = await live_world(flow)
    await agree(flow, world, 72)
    assert (await request(flow, world, "Kapitaen", 96, reason="kurz")).status_code == 422
    assert (await request(flow, world, "Mila", 96)).status_code == 403, "nur Captain oder Vertreter"
    created = await request(flow, world, "Kapitaen", 96)
    assert created.status_code == 200, created.text
    rid = created.json()["id"]
    replay = await request(flow, world, "Kapitaen", 96)
    assert replay.json()["idempotent_replay"] is True
    assert (await request(flow, world, "Falke1", 100)).status_code == 409, "nur ein offener Antrag"
    assert (await decide(flow, world, "Kapitaen", rid, "accept")).status_code == 403, "die eigene Seite stimmt nicht zu"
    assert (await decide(flow, world, "Falke1", rid, "withdraw")).status_code == 403

    notes = await flow.db.notifications.find({"meta.reason": "reschedule_requested"}, {"_id": 0}).to_list(20)
    assert {row["user_id"] for row in notes} == {world["users"]["Falke1"]["id"]}

    accepted = await decide(flow, world, "Falke1", rid, "accept")
    assert accepted.status_code == 200, accepted.text
    stored = await flow.reload(world["match"])
    assert stored["scheduled_at"] == at(96) and stored["schedule_source"] == "accepted" and stored["reschedule_count"] == 1
    entry = stored["schedule_history"][-1]
    assert entry["kind"] == "reschedule" and entry["reason"] == "Spieler im Nachtdienst" and entry["from"] == at(72)
    assert len(stored["reschedule_requests"][0]["approvals"]) == 2
    audit = await flow.db.audit_logs.find({"action": {"$regex": "^match.reschedule"}}, {"_id": 0}).to_list(10)
    assert [row["action"] for row in audit] == ["match.reschedule.request", "match.reschedule.accept"]
    assert "reschedule_requests" not in public_match_view(stored) and "schedule_history" not in public_match_view(stored)


@pytest.mark.asyncio
async def test_the_third_reschedule_goes_to_the_lead(flow):
    world = await live_world(flow)
    await agree(flow, world, 48)
    for hours, user, other in ((72, "Kapitaen", "Falke1"), (96, "Falke1", "Kapitaen")):
        rid = (await request(flow, world, user, hours)).json()["id"]
        assert (await decide(flow, world, other, rid, "accept")).status_code == 200
    third = await request(flow, world, "Kapitaen", 120)
    assert third.status_code == 409 and "2-mal" in third.json()["detail"] and "@leitung" in third.json()["detail"]
    block = (await page(flow, world, "Kapitaen"))["schedule_block"]
    assert block["remaining"] == 0 and block["can_request"] is False and "2-mal" in block["request_hint"]

    flow.act_as(world["staff"])
    lead = (await page(flow, world, None))  # Gäste sehen nichts
    assert lead["schedule_block"] is None
    flow.act_as(world["staff"])
    staff_page = (await flow.get(f"/api/matches/{mid(world)}/page")).json()
    assert staff_page["schedule_block"]["can_lead_set"] is True
    changed = await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(130), "schedule_reason": "Serverausfall"})
    assert changed.status_code == 200, changed.text
    stored = await flow.reload(world["match"])
    assert stored["schedule_source"] == "manual" and stored["schedule_history"][-1]["kind"] == "lead"
    assert stored["schedule_history"][-1]["reason"] == "Serverausfall"
    audit = await flow.db.audit_logs.find_one({"action": "match.plan.change"}, {"_id": 0})
    assert audit["data"]["reason"] == "Serverausfall"
    assert "schedule_reason" not in stored


@pytest.mark.asyncio
async def test_notice_limit(flow):
    world = await live_world(flow)
    await agree(flow, world, 20)
    late = await request(flow, world, "Kapitaen", 30)
    assert late.status_code == 409 and "24 Stunden" in late.json()["detail"]


@pytest.mark.asyncio
async def test_week_limit_and_its_switch(flow):
    other = await live_world(flow)
    await agree(flow, other, 72)
    outside = await request(flow, other, "Kapitaen", 24 * 8)
    assert outside.status_code == 409 and "Spielwoche" in outside.json()["detail"]
    await flow.db.tournaments.update_one({"id": other["tournament"]["id"]},
                                         {"$set": {"schedule_rules": {**DEFAULTS, "reschedule_same_week": False}}})
    assert (await request(flow, other, "Kapitaen", 24 * 8)).status_code == 200


@pytest.mark.asyncio
async def test_lead_change_supersedes_an_open_request_and_withdraw_works(flow):
    world = await live_world(flow)
    await agree(flow, world, 72)
    rid = (await request(flow, world, "Kapitaen", 96)).json()["id"]
    flow.act_as(world["staff"])
    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(100)})).status_code == 200
    answer = await decide(flow, world, "Falke1", rid, "accept")
    assert answer.status_code == 409
    stored = await flow.reload(world["match"])
    assert stored["reschedule_requests"][0]["status"] == "superseded" and stored["scheduled_at"] == at(100)

    rid = (await request(flow, world, "Falke1", 110)).json()["id"]
    assert (await decide(flow, world, "Falke1", rid, "withdraw")).status_code == 200
    assert (await flow.reload(world["match"]))["reschedule_requests"][-1]["status"] == "withdrawn"


@pytest.mark.asyncio
async def test_two_answers_at_once_count_once(flow):
    world = await live_world(flow)
    await agree(flow, world, 72)
    rid = (await request(flow, world, "Kapitaen", 96)).json()["id"]
    flow.act_as(world["users"]["Falke1"])
    url = f"/api/matches/{mid(world)}/reschedule/{rid}/decision"
    first, second = await asyncio.gather(flow.post(url, json={"action": "accept"}), flow.post(url, json={"action": "decline"}))
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    stored = await flow.reload(world["match"])
    assert int(stored.get("reschedule_count") or 0) in (0, 1)
    assert [row["status"] for row in stored["reschedule_requests"]] in (["accepted"], ["declined"])


@pytest.mark.asyncio
async def test_two_requests_at_once_leave_one(flow):
    world = await live_world(flow)
    await agree(flow, world, 72)
    flow.act_as(world["users"]["Kapitaen"])
    url = f"/api/matches/{mid(world)}/reschedule"
    answers = await asyncio.gather(flow.post(url, json={"scheduled_at": at(96), "reason": "Grund eins"}),
                                   flow.post(url, json={"scheduled_at": at(97), "reason": "Grund zwei"}))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    assert len((await flow.reload(world["match"]))["reschedule_requests"]) == 1


@pytest.mark.asyncio
async def test_open_request_is_a_task_for_the_other_side(flow):
    world = await live_world(flow)
    await agree(flow, world, 72)
    await request(flow, world, "Kapitaen", 96)
    flow.act_as(world["users"]["Falke1"])
    actions = (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"]
    task = next(row for row in actions if row["type"] == "match_reschedule")
    assert task["target_id"] == mid(world) and task["label"] == "Verschiebung beantworten"
    flow.act_as(world["users"]["Kapitaen"])
    assert not [row for row in (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"] if row["type"] == "match_reschedule"]


# ---------------------------------------------------------------- Zeit-Job

async def tournament_of(flow, world) -> dict:
    return await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_home_rule_applies_once_and_tells_both_sides(flow):
    world = await live_world(flow)
    flow.act_as(world["users"]["Kapitaen"])
    proposal = (await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(100)})).json()
    flow.act_as(world["users"]["Falke1"])
    away = (await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(110)})).json()
    later = now_utc() + timedelta(hours=73)
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, world)], now=later)
    assert counts["home_rule"] == 1
    stored = await flow.reload(world["match"])
    assert stored["scheduled_at"] == at(100) and stored["schedule_source"] == "accepted"
    assert stored["schedule_history"][-1]["kind"] == "home_rule"
    rows = {row["id"]: row for row in await flow.db.match_schedule_proposals.find({}, {"_id": 0}).to_list(10)}
    assert rows[proposal["id"]]["status"] == "accepted" and rows[proposal["id"]]["decision_rule"] == "home_rule"
    assert rows[away["id"]]["status"] == "declined"
    notes = await flow.db.notifications.find({"meta.reason": "schedule_home_rule"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in notes} == {world["users"]["Kapitaen"]["id"], world["users"]["Falke1"]["id"]}
    again = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, world)], now=later)
    assert again["home_rule"] == 0


@pytest.mark.asyncio
async def test_home_rule_off_keeps_the_default(flow):
    world = await live_world(flow, rules={**DEFAULTS, "home_rule": False})
    flow.act_as(world["users"]["Kapitaen"])
    await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(100)})
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, world)], now=now_utc() + timedelta(hours=73))
    assert counts["home_rule"] == 0


@pytest.mark.asyncio
async def test_an_away_offer_never_counts_by_silence(flow):
    other = await live_world(flow)
    flow.act_as(other["users"]["Falke1"])
    await flow.post(f"/api/matches/{mid(other)}/schedule-proposals", json={"scheduled_at": at(100)})
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, other)], now=now_utc() + timedelta(hours=73))
    assert counts["home_rule"] == 0
    assert (await flow.reload(other["match"])).get("schedule_source") != "accepted"


@pytest.mark.asyncio
async def test_overdue_reminds_then_goes_to_the_lead_and_the_lead_decides(flow):
    world = await live_world(flow)
    await flow.db.matches_v2.update_one({"id": mid(world)}, {"$set": {
        "scheduled_at": at(-30), "schedule_source": "accepted", "status": "scheduled"}})
    tournament = await tournament_of(flow, world)
    counts = await league_schedule_sweep.sweep(flow.db, [tournament])
    assert counts["reminded"] == 1 and counts["overdue"] == 0
    assert (await league_schedule_sweep.sweep(flow.db, [tournament]))["reminded"] == 0, "einmal je Termin"
    reminders = await flow.db.notifications.find({"meta.reason": "result_missing_reminder"}, {"_id": 0}).to_list(10)
    assert {row["user_id"] for row in reminders} == {world["users"]["Kapitaen"]["id"], world["users"]["Falke1"]["id"]}

    counts = await league_schedule_sweep.sweep(flow.db, [tournament], now=now_utc() + timedelta(hours=20))
    assert counts["overdue"] == 1
    assert await flow.db.audit_logs.find_one({"action": "match.result.overdue"})
    assert [row["id"] for row in await league_schedule.open_overdue(flow.db, world["season_id"])] == [mid(world)]
    flow.act_as(world["staff"])
    duty = (await flow.get("/api/users/me/duty")).json()
    assert [row["match_id"] for row in duty["overdue_matches"]] == [mid(world)]

    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(30), "schedule_reason": "Nachholtermin"})).status_code == 200
    stored = await flow.reload(world["match"])
    assert not stored.get("result_overdue_at") and not stored.get("result_reminded_at")
    assert await league_schedule.open_overdue(flow.db, world["season_id"]) == []


@pytest.mark.asyncio
async def test_an_open_request_expires_with_the_old_time(flow):
    world = await live_world(flow)
    await agree(flow, world, 30)
    await request(flow, world, "Kapitaen", 100)
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, world)], now=now_utc() + timedelta(hours=31))
    assert counts["expired"] == 1
    assert (await flow.reload(world["match"]))["reschedule_requests"][0]["status"] == "expired"


# ---------------------------------------------------------------- Einstellung je Season

@pytest.mark.asyncio
async def test_season_rules_write_season_and_staffeln(flow):
    world = await live_world(flow, rules=None)
    season = {"id": world["season_id"], "league_id": "liga", "number": 1, "name": "Season 1", "slug": "season-1"}
    await flow.db.league_seasons.insert_one(dict(season))
    url = f"/api/admin/leagues/seasons/{season['id']}/schedule-rules"
    flow.act_as(world["users"]["Kapitaen"])
    assert (await flow.get(url)).status_code == 403
    flow.act_as(world["staff"])
    first = (await flow.get(url)).json()
    assert first["active"] is False and first["defaults"] == DEFAULTS
    assert (await flow.put(url, json={"result_overdue_hours": 2})).status_code == 422
    assert (await flow.put(url, json={"was": 1})).status_code == 422
    saved = await flow.put(url, json={"home_rule_hours": 48, "reschedule_max": 1})
    assert saved.status_code == 200, saved.text
    assert saved.json()["staffeln_updated"] == 1
    tournament = await tournament_of(flow, world)
    assert tournament["schedule_rules"]["home_rule_hours"] == 48 and tournament["schedule_rules"]["reschedule_max"] == 1
    assert (await flow.get(url)).json()["schedule_rules"]["reschedule_max"] == 1
    assert await flow.db.audit_logs.find_one({"action": "league.season.schedule_rules"})


# ---------------------------------------------------------------- Codex-Prüfung (#2194)

@pytest.mark.asyncio
async def test_a_fixed_time_still_lets_sides_decline_or_withdraw_old_proposals(flow):
    """Steht der Termin fest (hier: von der Leitung), bleibt ein alter offener Vorschlag ablehnbar - nur Vorschlagen, Annehmen und
    Gegenvorschlag sind gesperrt. Die App liest ``can_manage_schedule`` für Ablehnen."""
    world = await live_world(flow)
    flow.act_as(world["users"]["Kapitaen"])
    old = (await flow.post(f"/api/matches/{mid(world)}/schedule-proposals", json={"scheduled_at": at(80)})).json()
    flow.act_as(world["staff"])
    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(90)})).status_code == 200
    away = await page(flow, world, "Falke1")
    assert away["can_propose_schedule"] is False
    assert away["can_manage_schedule"] is True
    flow.act_as(world["users"]["Falke1"])
    url = f"/api/matches/{mid(world)}/schedule-proposals/{old['id']}/decision"
    assert (await flow.post(url, json={"action": "accept"})).status_code == 409
    assert (await flow.post(url, json={"action": "decline"})).status_code == 200


@pytest.mark.asyncio
async def test_a_staffel_without_rules_gets_no_d1_fields(flow):
    """Altbestand ohne ``schedule_rules``: Einigung, Standardtermin und Termin der Leitung schreiben keine D.1-Felder."""
    from services.matchday_schedule import persist_matchday_schedule

    world = await live_world(flow, rules=None)
    await persist_matchday_schedule(flow.db, await tournament_of(flow, world))
    await agree(flow, world)
    flow.act_as(world["staff"])
    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(90), "schedule_reason": "Test"})).status_code == 200
    stored = await flow.reload(world["match"])
    for field in ("schedule_history", "reschedule_requests", "reschedule_count", "result_reminded_at", "result_overdue_at"):
        assert field not in stored, field
