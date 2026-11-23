"""Gleichzeitigkeit beim Vergleich über Staffeln hinweg (#1627, docs/LIGA.md „F.2 … Zielregel je Zone“): zwei Entscheide im selben
Moment und zwei Staffeln, die gleichzeitig schließen. Exklusiv ist das nur auf echtem MongoDB (``FLOW_MONGO_URL``); mongomock führt alles
nacheinander aus, das Ergebnis muss dort genauso stimmen. Erfundene Namen."""
import asyncio
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import league_cross_decisions  # noqa: E402
from services.league_cross_zones import CrossProblem  # noqa: E402
from test_league_successor_flow import ADMIN, BEST, STAFFELN, build, close, cockpit, flow, ok, zones_of  # noqa: E402,F401


async def attempt(coroutine):
    try:
        return await coroutine
    except CrossProblem as problem:
        return problem.status


@pytest.mark.asyncio
async def test_two_decisions_at_once_leave_exactly_one(flow):  # noqa: F811
    """Zwei Zuständige entscheiden denselben Gleichstand im selben Moment, jede für ein anderes Team: Die Season-Sperre lässt eine nach
    der anderen durch - genau ein Entscheid gilt, die zweite bekommt 409 („kein Gleichstand mehr“ bzw. „gleich noch einmal“)."""
    world = await build(flow, levels=2, zones=BEST, extra={2: [4]})
    top, first, second = world["tids"]
    ok(await close(flow, world, top))
    ok(await close(flow, world, first))
    division = world["divisions"][1]["id"]
    tied = [world["regs"][2][1]["id"], world["more"][2][0]["regs"][1]["id"]]
    other = await flow.add_staff(name="Zweite Leitung")
    bodies = [{"kind": "promote_best", "registration_ids": [key], "method": "lead", "reason": f"Entscheid für Team {index}"} for index, key in enumerate(tied)]

    results = await asyncio.gather(attempt(league_cross_decisions.decide(flow.db, division, bodies[0], world["lead"])),
                                   attempt(league_cross_decisions.decide(flow.db, division, bodies[1], other)))

    won = [result for result in results if isinstance(result, dict)]
    assert len(won) == 1 and [result for result in results if not isinstance(result, dict)] == [409]
    stored = (await flow.db.league_divisions.find_one({"id": division}, {"_id": 0}))["zone_decisions"]["promote_best"]
    assert stored["id"] == won[0]["id"] and stored["registration_ids"] == won[0]["registration_ids"]
    assert await flow.db.audit_logs.count_documents({"action": "league.zone.decision"}) == 1
    side = (await cockpit(flow, world))["cross"][0]["sides"][0]
    assert side["tie"] is None and [item["registration_id"] for item in side["candidates"] if item["chosen"]] == stored["registration_ids"]
    # Mit dem einen Entscheid schließt die letzte Staffel ab.
    ok(await close(flow, world, second))


@pytest.mark.asyncio
async def test_two_staffeln_closing_at_once_never_slip_a_tie_into_the_new_season(flow):  # noqa: F811
    """Beide Staffeln der Liga 2 schließen im selben Moment, ihre Zweiten stehen gleich. Nacheinander sperrt der Gleichstand den zweiten
    Abschluss; wirklich gleichzeitig sieht jede die andere noch offen, und beide schließen. In beiden Fällen gilt: Solange niemand
    entschieden hat, trägt keine Tabelle die Zone, und die neue Season lässt sich nicht anlegen."""
    world = await build(flow, levels=2, zones=BEST, extra={2: [4]})
    top, first, second = world["tids"]
    ok(await close(flow, world, top))
    flow.act_as(world["lead"])

    answers = await asyncio.gather(flow.post(f"{STAFFELN}/{first}/close", json={"confirm": True}),
                                   flow.post(f"{STAFFELN}/{second}/close", json={"confirm": True}))

    codes = sorted(answer.status_code for answer in answers)
    assert codes in ([200, 200], [200, 409]), [answer.text for answer in answers]
    for tid in (first, second):
        assert await zones_of(flow, tid) == [("promotion", False), (None, False), (None, False), (None, False)]
    if codes == [200, 200]:
        preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
        assert preview["can_create"] is False and any("Gleichstand zwischen den Staffeln" in text for text in preview["problems"])
        refused = await flow.post(f"{ADMIN}/seasons/{world['season']['id']}/successor", json={"start_date": "2031-03-01T00:00:00", "confirm": True})
        assert refused.status_code == 409
    side = (await cockpit(flow, world))["cross"][0]["sides"][0]
    assert side["tie"] is not None and side["tie"]["open"] == 1
    winner = world["more"][2][0]["regs"][1]["id"]
    ok(await flow.put(f"{ADMIN}/divisions/{world['divisions'][1]['id']}/zone-decision",
                      json={"kind": "promote_best", "registration_ids": [winner], "method": "playoff", "reason": "Entscheidungsspiel 3:1"}))
    if codes == [200, 409]:
        open_one = first if answers[0].status_code == 409 else second
        ok(await close(flow, world, open_one))
    assert await zones_of(flow, second) == [("promotion", False), ("promotion", True), (None, False), (None, False)]
    preview = ok(await flow.get(f"{ADMIN}/seasons/{world['season']['id']}/successor"))
    assert preview["can_create"] is True and preview["problems"] == []
