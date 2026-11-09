"""Mehrere Termine auf einmal (#2325) über die echten Routen: bis zu drei Termine mit einer Notiz, jeder einzeln geprüft, alle oder
keiner gespeichert, genau eine Nachricht an die Gegenseite. Annehmen schließt die übrigen der Gruppe - in der Liga wie ohne
Liga-Regeln. 72-h-Regel und ``after_agreement`` bleiben, wie sie sind. Erfundene Namen."""
import os
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import world as league_world  # noqa: E402
from models import now_utc  # noqa: E402
from services import league_schedule, league_schedule_sweep  # noqa: E402
from services.league_schedule import DEFAULTS  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


_BASE: dict[str, datetime] = {}


def at(hours: float) -> str:
    """Termin in ``hours`` Stunden, auf die Minute - je Test fest (wie in test_league_schedule_flow)."""
    base = _BASE.setdefault(os.environ.get("PYTEST_CURRENT_TEST", ""), now_utc().replace(second=0, microsecond=0))
    return (base + timedelta(hours=hours)).isoformat()


async def live_world(flow, rules: dict | None = DEFAULTS, **fields) -> dict:
    """Staffel seit gestern live (Spielwoche bis in sechs Tagen), Spiel am ersten Spieltag ohne Termin. ``rules=None``: ohne
    Liga-Terminregeln, wie ein Turnier."""
    world = await league_world(flow)
    start = (now_utc() - timedelta(days=1)).replace(microsecond=0)
    update = {"start_date": start.isoformat(), "matchday_days": 7, **fields}
    if rules is not None:
        update["schedule_rules"] = dict(rules)
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]}, {"$set": update})
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]}, {"$set": {"scheduled_at": None, "status": "ready"}})
    return world


def base_url(world) -> str:
    return f"/api/matches/{world['match']['id']}/schedule-proposals"


async def propose(flow, world, user: str, hours: list[float], note: str | None = "Abends geht immer"):
    flow.act_as(world["users"][user])
    return await flow.post(f"{base_url(world)}/group", json={"scheduled_ats": [at(h) for h in hours], "note": note})


async def group_decision(flow, world, user: str, proposal_id: str, action: str, hours: list[float] | None = None):
    flow.act_as(world["users"][user])
    body = {"action": action, "note": "Passt leider nicht"}
    if hours is not None:
        body["scheduled_ats"] = [at(h) for h in hours]
    return await flow.post(f"{base_url(world)}/{proposal_id}/group-decision", json=body)


async def accept(flow, world, user: str, proposal_id: str):
    flow.act_as(world["users"][user])
    return await flow.post(f"{base_url(world)}/{proposal_id}/decision", json={"action": "accept"})


async def rows(flow, world) -> dict[str, dict]:
    found = await flow.db.match_schedule_proposals.find({"match_id": world["match"]["id"]}, {"_id": 0}).to_list(50)
    return {row["id"]: row for row in found}


async def notes(flow, reason: str) -> list[dict]:
    return await flow.db.notifications.find({"meta.reason": reason}, {"_id": 0}).to_list(50)


async def tournament_of(flow, world) -> dict:
    return await flow.db.tournaments.find_one({"id": world["tournament"]["id"]}, {"_id": 0})


# ---------------------------------------------------------------- Vorschlagen

@pytest.mark.asyncio
@pytest.mark.parametrize("rules", [DEFAULTS, None], ids=["liga", "ohne-liga-regeln"])
async def test_three_times_make_one_group_and_one_message(flow, rules):
    world = await live_world(flow, rules=rules)
    created = await propose(flow, world, "Kapitaen", [110, 50, 80])
    assert created.status_code == 200, created.text
    answer = created.json()
    assert answer["idempotent_replay"] is False
    assert [row["scheduled_at"] for row in answer["proposals"]] == [at(50), at(80), at(110)], "früheste zuerst"
    stored = list((await rows(flow, world)).values())
    assert len(stored) == 3
    assert {row["group_id"] for row in stored} == {answer["group_id"]}
    assert len({row["created_at"] for row in stored}) == 1, "eine Gruppe, ein Zeitpunkt - die Antwortfrist läuft für alle gleich"
    assert {row["note"] for row in stored} == {"Abends geht immer"}
    assert {row["status"] for row in stored} == {"pending"} and {row["kind"] for row in stored} == {"proposal"}
    assert (await flow.reload(world["match"]))["schedule_status"] == "proposed"

    sent = await notes(flow, "schedule_proposed")
    assert [row["user_id"] for row in sent] == [world["users"]["Falke1"]["id"]], "genau eine Nachricht an die Gegenseite"
    assert sent[0]["title"] == "Neue Terminvorschläge"
    assert "drei Termine" in sent[0]["body"] and sent[0]["body"].count(" Uhr") == 3
    assert "Abends geht immer" in sent[0]["body"]
    assert sent[0]["meta"]["dedupe_key"] == f"match-schedule-group:{answer['group_id']}:proposed"


@pytest.mark.asyncio
async def test_a_double_click_saves_nothing_twice(flow):
    world = await live_world(flow)
    first = await propose(flow, world, "Kapitaen", [50, 80])
    again = await propose(flow, world, "Kapitaen", [80, 50])
    assert again.status_code == 200, again.text
    assert again.json()["idempotent_replay"] is True and again.json()["group_id"] == first.json()["group_id"]
    assert len(await rows(flow, world)) == 2
    assert len(await notes(flow, "schedule_proposed")) == 1


@pytest.mark.asyncio
async def test_a_subset_of_an_open_group_is_a_new_proposal_not_a_replay(flow):
    world = await live_world(flow)
    first = (await propose(flow, world, "Kapitaen", [50, 80, 110])).json()
    subset = await propose(flow, world, "Kapitaen", [50, 80])
    assert subset.status_code == 200, subset.text
    assert subset.json()["idempotent_replay"] is False and subset.json()["group_id"] != first["group_id"]
    assert len(subset.json()["proposals"]) == 2
    other_note = await propose(flow, world, "Kapitaen", [50, 80, 110], note="Anderer Text")
    assert other_note.json()["idempotent_replay"] is False
    assert len(await rows(flow, world)) == 8


@pytest.mark.asyncio
async def test_every_time_is_checked_and_nothing_is_half_saved(flow):
    world = await live_world(flow, blocked_periods=[])
    past = await propose(flow, world, "Kapitaen", [50, -2, 80])
    assert past.status_code == 422
    detail = past.json()["detail"]
    assert detail["errors"] == [{"index": 1, "detail": detail["errors"][0]["detail"]}]
    assert "Vergangenheit" in detail["errors"][0]["detail"] and detail["message"].startswith("Termin 2:")

    twice = await propose(flow, world, "Kapitaen", [50, 50])
    assert twice.status_code == 422
    assert [row["index"] for row in twice.json()["detail"]["errors"]] == [1]

    assert await rows(flow, world) == {}
    assert await notes(flow, "schedule_proposed") == []
    assert (await flow.reload(world["match"])).get("schedule_status") is None


@pytest.mark.asyncio
async def test_outside_the_week_is_a_hint_not_a_refusal(flow):
    """Nicht strenger als der einzelne Vorschlag (App): ein Termin außerhalb der Spielwoche geht, mit Hinweis an seiner Stelle."""
    world = await live_world(flow)
    flow.act_as(world["users"]["Kapitaen"])
    single = await flow.post(base_url(world), json={"scheduled_at": at(170)})
    assert single.status_code == 200, "der einzelne Weg nimmt ihn an"
    outside = await propose(flow, world, "Kapitaen", [50, 175])
    assert outside.status_code == 200, outside.text
    hints = outside.json()["hints"]
    assert [row["index"] for row in hints] == [1]
    assert "außerhalb der Spielwoche" in hints[0]["detail"] and "72-h-Regel" in hints[0]["detail"]
    assert len(await rows(flow, world)) == 3


@pytest.mark.asyncio
async def test_the_week_hint_leaves_out_a_switched_off_home_rule(flow):
    world = await live_world(flow, rules={**DEFAULTS, "home_rule": False})
    outside = await propose(flow, world, "Kapitaen", [175])
    assert outside.status_code == 200, outside.text
    detail = outside.json()["hints"][0]["detail"]
    assert "außerhalb der Spielwoche" in detail and detail.endswith("gilt nur, wenn die Gegenseite annimmt.")
    assert "72-h-Regel" not in detail
    flow.act_as(world["users"]["Kapitaen"])
    page = (await flow.get(f"/api/matches/{world['match']['id']}/page")).json()
    assert page["schedule_block"]["rules"]["home_rule"] is False, "das Web liest die Regel aus dem Block"


@pytest.mark.asyncio
async def test_a_blocked_period_is_named_at_its_time(flow):
    world = await live_world(flow, rules=None)
    day = (now_utc() + timedelta(days=3)).date().isoformat()
    await flow.db.tournaments.update_one({"id": world["tournament"]["id"]},
                                         {"$set": {"blocked_periods": [{"start_date": day, "end_date": day, "label": "Turnierpause"}]}})
    refused = await propose(flow, world, "Kapitaen", [24, 72])
    assert refused.status_code == 422
    errors = refused.json()["detail"]["errors"]
    assert [row["index"] for row in errors] == [1] and "Turnierpause" in errors[0]["detail"]
    assert await rows(flow, world) == {}


@pytest.mark.asyncio
async def test_more_than_three_or_none_are_refused(flow):
    world = await live_world(flow)
    assert (await propose(flow, world, "Kapitaen", [20, 30, 40, 50])).status_code == 422
    assert (await propose(flow, world, "Kapitaen", [])).status_code == 422
    assert await rows(flow, world) == {}


@pytest.mark.asyncio
async def test_the_single_way_stays_as_it_was(flow):
    world = await live_world(flow)
    flow.act_as(world["users"]["Kapitaen"])
    single = await flow.post(base_url(world), json={"scheduled_at": at(50)})
    assert single.status_code == 200, single.text
    assert "group_id" not in single.json()
    assert (await notes(flow, "schedule_proposed"))[0]["title"] == "Neuer Terminvorschlag"


# ---------------------------------------------------------------- Gegenseite

@pytest.mark.asyncio
@pytest.mark.parametrize("rules", [DEFAULTS, None], ids=["liga", "ohne-liga-regeln"])
async def test_accepting_one_closes_the_rest_of_the_group(flow, rules):
    world = await live_world(flow, rules=rules)
    group = (await propose(flow, world, "Kapitaen", [50, 80, 110])).json()["proposals"]
    accepted = await accept(flow, world, "Falke1", group[1]["id"])
    assert accepted.status_code == 200, accepted.text
    stored = await rows(flow, world)
    assert stored[group[1]["id"]]["status"] == "accepted"
    for other in (group[0], group[2]):
        assert stored[other["id"]]["status"] == "declined" and stored[other["id"]]["decision_rule"] == "agreed_elsewhere"
    match = await flow.reload(world["match"])
    assert match["scheduled_at"] == at(80) and match["schedule_status"] == "accepted"
    confirmed = await notes(flow, "schedule_accepted")
    assert [row["user_id"] for row in confirmed] == [world["users"]["Kapitaen"]["id"]], "eine Nachricht für die Annahme"

    flow.act_as(world["users"]["Kapitaen"])
    page = (await flow.get(f"/api/matches/{world['match']['id']}/page")).json()
    assert [row["status"] for row in page["schedule_proposals"] if row["id"] != group[1]["id"]] == ["declined", "declined"]


@pytest.mark.asyncio
async def test_without_league_rules_other_proposals_outside_the_group_stay_open(flow):
    """Außerhalb der Liga schließt eine Annahme nur die eigene Gruppe - ein einzelner Vorschlag daneben bleibt wie bisher offen."""
    world = await live_world(flow, rules=None)
    flow.act_as(world["users"]["Falke1"])
    away = (await flow.post(base_url(world), json={"scheduled_at": at(60)})).json()
    group = (await propose(flow, world, "Kapitaen", [50, 80])).json()["proposals"]
    assert (await accept(flow, world, "Falke1", group[0]["id"])).status_code == 200
    stored = await rows(flow, world)
    assert stored[group[1]["id"]]["status"] == "declined"
    assert stored[away["id"]]["status"] == "pending"


@pytest.mark.asyncio
async def test_without_matchday_weeks_one_declined_time_keeps_the_match_waiting(flow):
    """Turnier ohne Spielwochen: wird ein Termin abgelehnt und ist noch einer offen, steht das Spiel auf „proposed“, nicht „declined“."""
    world = await live_world(flow, rules=None, format="single_elimination")
    group = (await propose(flow, world, "Kapitaen", [50, 80])).json()["proposals"]
    flow.act_as(world["users"]["Falke1"])
    first = await flow.post(f"{base_url(world)}/{group[0]['id']}/decision", json={"action": "decline"})
    assert first.status_code == 200, first.text
    assert (await flow.reload(world["match"]))["schedule_status"] == "proposed"
    last = await flow.post(f"{base_url(world)}/{group[1]['id']}/decision", json={"action": "decline"})
    assert last.status_code == 200, last.text
    assert (await flow.reload(world["match"]))["schedule_status"] == "declined"


@pytest.mark.asyncio
async def test_after_agreement_is_unchanged_with_a_group(flow):
    """Liga mit Regeln: genau ein Eintrag „Einigung“ mit dem angenommenen Vorschlag, alle übrigen offenen schließen - wie ohne Gruppe."""
    world = await live_world(flow)
    flow.act_as(world["users"]["Falke1"])
    away = (await flow.post(base_url(world), json={"scheduled_at": at(60)})).json()
    group = (await propose(flow, world, "Kapitaen", [50, 80, 110], note="Bitte früh")).json()["proposals"]
    assert (await accept(flow, world, "Falke1", group[2]["id"])).status_code == 200
    match = await flow.reload(world["match"])
    assert [row["kind"] for row in match["schedule_history"]] == ["agreement"]
    entry = match["schedule_history"][0]
    assert entry["request_id"] == group[2]["id"] and entry["to"] == at(110) and entry["reason"] == "Bitte früh"
    stored = await rows(flow, world)
    assert stored[away["id"]]["status"] == "declined" and stored[away["id"]]["decision_rule"] == "agreed_elsewhere"
    assert [row["id"] for row in stored.values() if row["status"] == "pending"] == []


@pytest.mark.asyncio
async def test_declining_all_sends_one_message(flow):
    world = await live_world(flow, rules=None)
    group = (await propose(flow, world, "Kapitaen", [50, 80, 110])).json()["proposals"]
    own = await group_decision(flow, world, "Kapitaen", group[0]["id"], "decline")
    assert own.status_code == 400, "die eigene Seite lehnt nicht ab - sie zieht zurück"
    declined = await group_decision(flow, world, "Falke1", group[0]["id"], "decline")
    assert declined.status_code == 200, declined.text
    assert declined.json()["count"] == 3
    stored = await rows(flow, world)
    assert {row["status"] for row in stored.values()} == {"declined"}
    assert {row["decision_note"] for row in stored.values()} == {"Passt leider nicht"}
    sent = await notes(flow, "schedule_declined")
    assert [row["user_id"] for row in sent] == [world["users"]["Kapitaen"]["id"]]
    assert "alle drei Termine" in sent[0]["body"]
    replay = await group_decision(flow, world, "Falke1", group[0]["id"], "decline")
    assert replay.status_code == 200 and replay.json()["idempotent_replay"] is True
    assert len(await notes(flow, "schedule_declined")) == 1


@pytest.mark.asyncio
async def test_the_own_side_withdraws_the_whole_group(flow):
    world = await live_world(flow)
    group = (await propose(flow, world, "Kapitaen", [50, 80])).json()["proposals"]
    assert (await group_decision(flow, world, "Falke1", group[0]["id"], "withdraw")).status_code == 403
    withdrawn = await group_decision(flow, world, "Kapitaen", group[1]["id"], "withdraw")
    assert withdrawn.status_code == 200, withdrawn.text
    assert {row["status"] for row in (await rows(flow, world)).values()} == {"withdrawn"}
    assert (await flow.reload(world["match"])).get("schedule_status") is None
    sent = await notes(flow, "schedule_withdrawn")
    assert [row["user_id"] for row in sent] == [world["users"]["Falke1"]["id"]] and "zwei" in sent[0]["body"]


@pytest.mark.asyncio
async def test_a_counter_with_two_times_answers_the_whole_group(flow):
    world = await live_world(flow)
    group = (await propose(flow, world, "Kapitaen", [50, 80, 110])).json()["proposals"]
    bad = await group_decision(flow, world, "Falke1", group[0]["id"], "counter", [60, 60])
    assert bad.status_code == 422 and bad.json()["detail"]["errors"][0]["index"] == 1
    assert {row["status"] for row in (await rows(flow, world)).values()} == {"pending"}, "nichts halb entschieden"

    counter = await group_decision(flow, world, "Falke1", group[0]["id"], "counter", [90, 60])
    assert counter.status_code == 200, counter.text
    new = counter.json()["proposals"]
    assert [row["scheduled_at"] for row in new] == [at(60), at(90)]
    assert {row["kind"] for row in new} == {"counter"} and {row["parent_proposal_id"] for row in new} == {group[0]["id"]}
    assert {row["parent_group_id"] for row in new} == {group[0]["group_id"]}
    stored = await rows(flow, world)
    assert {stored[row["id"]]["status"] for row in group} == {"countered"}
    sent = await notes(flow, "schedule_countered")
    assert [row["user_id"] for row in sent] == [world["users"]["Kapitaen"]["id"]] and "zwei Termine" in sent[0]["body"]

    replay = await group_decision(flow, world, "Falke1", group[0]["id"], "counter", [90, 60])
    assert replay.json()["idempotent_replay"] is True and len(await rows(flow, world)) == 5


@pytest.mark.asyncio
async def test_a_counter_with_only_the_offered_times_is_refused(flow):
    world = await live_world(flow)
    group = (await propose(flow, world, "Kapitaen", [50, 80, 110])).json()["proposals"]
    same = await group_decision(flow, world, "Falke1", group[0]["id"], "counter", [80, 50])
    assert same.status_code == 422
    assert "stehen schon zur Auswahl" in same.json()["detail"]
    assert {row["status"] for row in (await rows(flow, world)).values()} == {"pending"}
    mixed = await group_decision(flow, world, "Falke1", group[0]["id"], "counter", [50, 60])
    assert mixed.status_code == 200, "ein neuer Termin dabei: das ist ein Gegenvorschlag"


@pytest.mark.asyncio
async def test_the_lead_declines_and_withdraws_whole_groups(flow):
    world = await live_world(flow)
    first = (await propose(flow, world, "Kapitaen", [50, 80])).json()["proposals"]
    flow.act_as(world["staff"])
    declined = await flow.post(f"{base_url(world)}/{first[0]['id']}/group-decision", json={"action": "decline"})
    assert declined.status_code == 200, declined.text
    second = (await propose(flow, world, "Kapitaen", [60, 90])).json()["proposals"]
    flow.act_as(world["staff"])
    withdrawn = await flow.post(f"{base_url(world)}/{second[0]['id']}/group-decision", json={"action": "withdraw"})
    assert withdrawn.status_code == 200, withdrawn.text
    stored = await rows(flow, world)
    assert {stored[row["id"]]["status"] for row in first} == {"declined"}
    assert {stored[row["id"]]["status"] for row in second} == {"withdrawn"}
    sent = await notes(flow, "schedule_withdrawn")
    assert {row["user_id"] for row in sent} == {world["users"]["Kapitaen"]["id"], world["users"]["Falke1"]["id"]}, \
        "handelt die Leitung, erfahren es beide Seiten"


@pytest.mark.asyncio
async def test_a_counter_on_a_fixed_league_time_is_refused(flow):
    world = await live_world(flow)
    group = (await propose(flow, world, "Kapitaen", [50, 80])).json()["proposals"]
    # Die Leitung legt den Termin fest - die Gruppe ist noch offen.
    await flow.db.matches_v2.update_one({"id": world["match"]["id"]},
                                        {"$set": {"scheduled_at": at(90), "schedule_source": "manual"}})
    refused = await group_decision(flow, world, "Falke1", group[0]["id"], "counter", [100])
    assert refused.status_code == 409 and "Verschiebung" in refused.json()["detail"]
    declined = await group_decision(flow, world, "Falke1", group[0]["id"], "decline")
    assert declined.status_code == 200, "ablehnen geht auch bei festem Termin"


@pytest.mark.asyncio
async def test_a_proposal_of_another_match_is_not_found(flow):
    world = await live_world(flow)
    group = (await propose(flow, world, "Kapitaen", [50, 80])).json()["proposals"]
    second_match = {**world["match"], "id": "zweites-spiel"}
    await flow.db.matches_v2.insert_one({**second_match, "scheduled_at": None, "status": "ready"})
    flow.act_as(world["users"]["Falke1"])
    answer = await flow.post(f"/api/matches/zweites-spiel/schedule-proposals/{group[0]['id']}/group-decision",
                             json={"action": "decline"})
    assert answer.status_code == 404
    assert {row["status"] for row in (await rows(flow, world)).values()} == {"pending"}


@pytest.mark.asyncio
async def test_a_counter_that_fails_while_closing_leaves_nothing_behind(flow, monkeypatch):
    """Alle oder keiner: scheitert das Schließen der alten Termine, gehen die neuen wieder raus, und das Spiel behält seine Frist."""
    world = await live_world(flow)
    group = (await propose(flow, world, "Kapitaen", [50, 80])).json()["proposals"]
    before = await flow.reload(world["match"])
    collection_type = type(flow.db.match_schedule_proposals)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("Verbindung weg")

    monkeypatch.setattr(collection_type, "update_many", broken)
    try:
        answer = await group_decision(flow, world, "Falke1", group[0]["id"], "counter", [60])
    except RuntimeError:
        answer = None
    monkeypatch.undo()
    assert answer is None or answer.status_code >= 500
    stored = await rows(flow, world)
    assert sorted(row["id"] for row in stored.values()) == sorted(row["id"] for row in group), "keine neuen Termine übrig"
    assert {row["status"] for row in stored.values()} == {"pending"}
    after = await flow.reload(world["match"])
    assert after["schedule_deadline_at"] == before["schedule_deadline_at"], "keine verlängerte Frist"
    assert await notes(flow, "schedule_countered") == []


# ---------------------------------------------------------------- 72-h-Regel

@pytest.mark.asyncio
async def test_home_rule_at_does_not_move_with_groups(flow):
    """``home_rule_at`` liest offene Heimvorschläge einzeln - mit oder ohne Gruppe ergibt sich dieselbe Frist."""
    world = await live_world(flow)
    tournament = await tournament_of(flow, world)
    match = await flow.reload(world["match"])
    created = (now_utc() - timedelta(hours=1)).isoformat()
    home = world["reg_a"]["id"]
    single = [{"id": f"p{n}", "status": "pending", "actor_registration_id": home, "scheduled_at": at(h), "created_at": created}
              for n, h in enumerate([100, 80, 170])]
    grouped = [{**row, "group_id": "g1"} for row in single]
    rules = league_schedule.rules_of(tournament)
    expected = league_schedule.home_rule_at(tournament, match, single, rules)
    assert expected is not None
    assert league_schedule.home_rule_at(tournament, match, grouped, rules) == expected


@pytest.mark.asyncio
async def test_the_home_rule_takes_the_earliest_of_a_group(flow):
    world = await live_world(flow)
    flow.act_as(world["users"]["Falke1"])
    away = (await flow.post(base_url(world), json={"scheduled_at": at(40)})).json()
    group = (await propose(flow, world, "Kapitaen", [120, 100, 110])).json()["proposals"]
    later = now_utc() + timedelta(hours=73)
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, world)], now=later)
    assert counts["home_rule"] == 1
    match = await flow.reload(world["match"])
    assert match["scheduled_at"] == at(100) and match["schedule_history"][-1]["kind"] == "home_rule"
    stored = await rows(flow, world)
    assert stored[group[0]["id"]]["status"] == "accepted" and stored[group[0]["id"]]["decision_rule"] == "home_rule"
    for other in (group[1]["id"], group[2]["id"], away["id"]):
        assert stored[other]["status"] == "declined" and stored[other]["decision_rule"] == "home_rule"


@pytest.mark.asyncio
async def test_an_app_counter_to_one_time_answers_the_whole_group(flow):
    """Gegenvorschlag aus der App (``/decision``) zu einem Termin einer Gruppe: die übrigen sind damit beantwortet - die 72-h-Regel
    setzt danach keinen Heimtermin mehr."""
    world = await live_world(flow)
    group = (await propose(flow, world, "Kapitaen", [100, 110, 120])).json()["proposals"]
    flow.act_as(world["users"]["Falke1"])
    counter = await flow.post(f"{base_url(world)}/{group[0]['id']}/decision",
                              json={"action": "counter", "scheduled_at": at(60), "note": "Lieber früher"})
    assert counter.status_code == 200, counter.text
    assert counter.json()["parent_group_id"] == group[0]["group_id"]
    stored = await rows(flow, world)
    for row in group:
        assert stored[row["id"]]["status"] == "countered"
        assert stored[row["id"]]["decision_user_id"] == world["users"]["Falke1"]["id"]
        assert stored[row["id"]]["decision_note"] == "Lieber früher"
    counts = await league_schedule_sweep.sweep(flow.db, [await tournament_of(flow, world)], now=now_utc() + timedelta(hours=73))
    assert counts["home_rule"] == 0
    match = await flow.reload(world["match"])
    assert match.get("schedule_source") != "accepted" and match.get("scheduled_at") is None


# ---------------------------------------------------------------- App (#2325, Gesamtpaket)

@pytest.mark.asyncio
async def test_the_app_still_reads_and_answers_single_proposals(flow):
    """Die App liest ``schedule_proposals`` einzeln und nimmt über ``/decision`` an - mit einer Gruppe geht beides weiter."""
    world = await live_world(flow, rules=None)
    group = (await propose(flow, world, "Kapitaen", [50, 80, 110])).json()["proposals"]
    flow.act_as(world["users"]["Falke1"])
    page = (await flow.get(f"/api/matches/{world['match']['id']}/page")).json()
    assert len([row for row in page["schedule_proposals"] if row["status"] == "pending"]) == 3
    assert page["can_manage_schedule"] is True
    actions = (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"]
    assert len([row for row in actions if row["type"] == "match_schedule"]) == 1, "eine Aufgabe je Spiel, nicht je Termin"
    flow.act_as(world["users"]["Falke1"])
    declined = await flow.post(f"{base_url(world)}/{group[0]['id']}/decision", json={"action": "decline"})
    assert declined.status_code == 200
    stored = await rows(flow, world)
    assert stored[group[1]["id"]]["status"] == "pending", "einzeln abgelehnt bleibt der Rest der Gruppe offen"
