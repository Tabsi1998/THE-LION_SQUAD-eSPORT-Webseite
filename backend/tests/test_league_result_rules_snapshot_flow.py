"""Regelstand der Erstmeldung (docs/LIGA.md, C.3, #1617): Es gilt die Ergebnisregel, die bei der Erstmeldung galt - für jede
Bestätigung (Browser, App ohne Maps, 48-Stunden-Automatik). Die Korrektur der Leitung prüft die aktuelle Regel. Meldungen ohne
Schnappschuss (Altbestand) prüfen nichts Neues. Erfundene Namen und Werte."""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from league_match_world import ids, world  # noqa: E402
from models import now_utc  # noqa: E402
from test_league_result_rules_flow import body  # noqa: E402

LOOSE = {"stellung": {"kind": "score", "target": 250, "time_limit_seconds": 600, "draw_allowed": False, "overtime": False},
         "suchen": {"kind": "rounds", "target": 6, "round_limit": 11, "draw_allowed": False, "overtime": True}}
STRICT = {**LOOSE, "suchen": {**LOOSE["suchen"], "overtime": False}}
NO_SCORES = [("stellung", "map-hafen", "a", None), ("suchen", "map-turm", "a", None)]
OVERTIME = [("stellung", "map-hafen", "a", (250, 180)), ("suchen", "map-turm", "a", (8, 6))]


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def rules(flow, w, **fields):
    """Wie „Vorgaben übertragen“: die Staffel trägt ab jetzt diesen Regelstand."""
    await flow.db.tournaments.update_one({"id": w["tournament"]["id"]}, {"$set": fields})


async def first_report(flow, w, maps):
    flow.act_as(w["users"]["Kapitaen"])
    answer = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body(w, maps, lineup=ids(w, "Kapitaen", "Mila")))
    assert answer.status_code == 200, answer.text
    return answer


async def web_confirm(flow, w, maps):
    flow.act_as(w["users"]["Falke1"])
    return await flow.post(f"/api/matches/{w['match']['id']}/report", json=body(w, maps, lineup=ids(w, "Falke1", "Falke2")))


async def stored(flow, w):
    return await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_the_report_keeps_the_rule_state_it_was_checked_with(flow):
    w = await world(flow)
    await rules(flow, w, result_rules=LOOSE, scores_required=True)

    await first_report(flow, w, OVERTIME)

    report = (await stored(flow, w))["reports"][-1]
    assert report["result_rule_snapshot"] == {"result_rules": LOOSE, "scores_required": True}


@pytest.mark.asyncio
async def test_web_confirmation_follows_the_rules_of_the_first_report_not_the_newer_duty(flow):
    w = await world(flow)
    await first_report(flow, w, NO_SCORES)  # damals ohne Regel und ohne Punktepflicht
    await rules(flow, w, result_rules=STRICT, scores_required=True)

    confirmed = await web_confirm(flow, w, NO_SCORES)

    assert confirmed.status_code == 200, confirmed.text
    assert (await stored(flow, w))["status"] == "completed"


@pytest.mark.asyncio
async def test_web_confirmation_follows_a_looser_rule_of_the_first_report(flow):
    w = await world(flow)
    await rules(flow, w, result_rules=LOOSE, scores_required=True)
    await first_report(flow, w, OVERTIME)
    await rules(flow, w, result_rules=STRICT)

    without_scores = await web_confirm(flow, w, [(mode, map_id, winner, None) for mode, map_id, winner, _ in OVERTIME])

    assert without_scores.status_code == 200, without_scores.text
    assert [game["scores"] for game in (await stored(flow, w))["games"]][1] == {w["reg_a"]["id"]: 8, w["reg_h"]["id"]: 6}


@pytest.mark.asyncio
async def test_a_first_report_still_checks_the_current_rule(flow):
    w = await world(flow)
    await rules(flow, w, result_rules=STRICT, scores_required=True)
    flow.act_as(w["users"]["Kapitaen"])

    refused = await flow.post(f"/api/matches/{w['match']['id']}/report", json=body(w, OVERTIME, lineup=ids(w, "Kapitaen", "Mila")))

    assert refused.status_code == 422 and refused.json()["detail"] == "Map 2: höchstens 11 Runden – 8:6 sind 14."


@pytest.mark.asyncio
async def test_app_confirmation_takes_the_first_report_after_a_rule_change(flow):
    app = await world(flow)
    await first_report(flow, app, NO_SCORES)
    await rules(flow, app, result_rules=STRICT, scores_required=True)
    flow.act_as(app["users"]["Falke1"])
    answer = await flow.post(f"/api/matches/{app['match']['id']}/report", json={"results": body(app, NO_SCORES)["results"]})
    assert answer.status_code == 200, answer.text
    assert (await stored(flow, app))["status"] == "completed"


@pytest.mark.asyncio
async def test_the_automatic_takes_the_first_report_after_a_rule_change(flow):
    from services.match_deadline_sweep import _auto_confirm

    # Eine Welt je Test: auf echtem MongoDB gibt es Staffel A in Liga 1 nur einmal.
    auto = await world(flow)
    await first_report(flow, auto, NO_SCORES)
    await rules(flow, auto, result_rules=STRICT, scores_required=True)
    done = await _auto_confirm(flow.db, auto["tournament"], auto["match"]["id"], None, now_utc() + timedelta(days=8))
    assert done == 1
    assert [game["map_id"] for game in (await stored(flow, auto))["games"]] == ["map-hafen", "map-turm"]


@pytest.mark.asyncio
async def test_an_old_report_without_snapshot_checks_nothing_new(flow):
    w = await world(flow)
    await rules(flow, w, result_rules=LOOSE)
    await first_report(flow, w, OVERTIME)
    reports = [{key: value for key, value in report.items() if key != "result_rule_snapshot"}
               for report in (await stored(flow, w))["reports"]]
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"reports": reports}})
    await rules(flow, w, result_rules=STRICT, scores_required=True)

    confirmed = await web_confirm(flow, w, NO_SCORES)

    assert confirmed.status_code == 200, confirmed.text


@pytest.mark.asyncio
async def test_the_confirming_side_sees_the_rule_of_the_first_report_the_lead_the_current_one(flow):
    w = await world(flow)
    await rules(flow, w, result_rules=LOOSE, scores_required=True)
    await first_report(flow, w, OVERTIME)
    await rules(flow, w, result_rules=STRICT, scores_required=False)

    flow.act_as(w["users"]["Falke1"])
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()["league"]
    assert page["result_rules"] == LOOSE and page["scores_required"] is True

    # Die Korrektur der Leitung prüft die aktuelle Regel.
    flow.act_as(w["staff"])
    refused = await flow.post(f"/api/matches/{w['match']['id']}/result", json=body(w, OVERTIME))
    assert refused.status_code == 422 and refused.json()["detail"] == "Map 2: höchstens 11 Runden – 8:6 sind 14."
