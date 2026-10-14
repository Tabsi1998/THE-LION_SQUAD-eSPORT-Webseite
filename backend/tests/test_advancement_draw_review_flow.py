"""Gegner mischen (#1548), Prüfung durch Codex: echtes Los auch beim Strukturplan, Liga-Neuauslosung nur gemischt,
„Neu auslosen“ schreibt nur, was noch so dasteht wie gelesen.
"""
import pathlib
import random
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.custom_bracket import _round_robin_rounds  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


class SpyRandom(random.Random):
    """Zählt, wie oft gelost wird - steht für ``secrets.SystemRandom``."""

    def __init__(self):
        super().__init__(1548)
        self.calls = 0

    def random(self):
        self.calls += 1
        return super().random()

    def shuffle(self, x):
        self.calls += 1
        return super().shuffle(x)


def spy_draw_rng(monkeypatch) -> SpyRandom:
    import services.advancement_draw as advancement_draw
    import services.custom_bracket as custom_bracket
    import services.match_v2_results as match_v2_results

    spy = SpyRandom()
    for module in (advancement_draw, custom_bracket, match_v2_results):
        monkeypatch.setattr(module, "DRAW_RNG", spy)
    return spy


async def league(flow, *, shuffle: bool, count: int = 6):
    staff = await flow.add_staff()
    flow.act_as(staff)
    fields = {"format": "league", **({"randomize_advancement_rounds": True} if shuffle else {})}
    tournament, _users, registrations = await flow.with_participants(count, **fields)
    return staff, tournament, registrations


def natural_days(registrations: list[dict]) -> dict[int, set[frozenset]]:
    """Die Hinrunde nach der Kreismethode, ohne Los - Setzplatz n ist die n-te Anmeldung."""
    by_seed = {index + 1: reg["id"] for index, reg in enumerate(registrations)}
    return {day: {frozenset((by_seed[a], by_seed[b])) for a, b in pairs}
            for day, pairs in enumerate(_round_robin_rounds(list(by_seed)), start=1)}


def planned_days(structure: dict) -> dict[int, set[frozenset]]:
    days: dict[int, set[frozenset]] = {}
    for match in structure["matches"]:
        regs = frozenset(slot["registration_id"] for slot in match["slots"])
        days.setdefault(int(match["round"]), set()).add(regs)
    return days


# ---------------------------------------------------------------------------------------------- 1. Strukturplan

@pytest.mark.asyncio
async def test_structure_plan_fixes_no_draw_and_apply_draws_with_the_real_source(flow, monkeypatch):
    spy = spy_draw_rng(monkeypatch)
    _staff, tournament, registrations = await league(flow, shuffle=True)
    url = f"/api/tournaments/{tournament['id']}/bracket"
    plan = await flow.post(f"{url}/plan", json={"preview": False})
    assert plan.status_code == 200, plan.text
    body = plan.json()
    expected = natural_days(registrations)
    planned = planned_days(body["structure"])
    assert {day: planned[day] for day in expected} == expected, "der Plan legt kein Los fest"
    assert spy.calls == 0
    again = await flow.post(f"{url}/plan", json={"preview": False})
    assert again.json()["plan_hash"] == body["plan_hash"], "Plan bleibt reproduzierbar"
    assert not await flow.db.audit_logs.count_documents({"action": "tournament.draw.done"})

    applied = await flow.post(f"{url}/apply", json={"preview": False, **body["apply_requirements"]})
    assert applied.status_code == 200, applied.text
    assert spy.calls > 0, "gelost wird beim Anwenden - mit der echten Zufallsquelle"
    matches = await flow.matches(tournament)
    assert matches and all((m.get("draw") or {}).get("kind") == "league" for m in matches)
    assert await flow.db.audit_logs.count_documents({"action": "tournament.draw.done"}) == 1


# ---------------------------------------------------------------------------------------------- 2. Liga fest

@pytest.mark.asyncio
async def test_league_redraw_refused_when_shuffling_is_off(flow):
    _staff, tournament, _regs = await league(flow, shuffle=False)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    before = sorted((m["id"], m["round"], [s["registration_id"] for s in m["slots"]]) for m in await flow.matches(tournament))
    stage_id = (await flow.matches(tournament))[0]["stage_id"]
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/stages/{stage_id}/redraw", json={})
    assert refused.status_code == 409
    assert "Zufällig mischen" in refused.json()["detail"]
    after = sorted((m["id"], m["round"], [s["registration_id"] for s in m["slots"]]) for m in await flow.matches(tournament))
    assert after == before


# ---------------------------------------------------------------------------------------------- 3. Compare-and-Set

async def drawn_bracket(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, _regs = await flow.with_participants(8, randomize_advancement_rounds=True)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    first = sorted((m for m in await flow.matches(tournament) if m["round"] == 1 and m["section"] == "WB"),
                   key=lambda m: m["order"])
    for match in first:
        regs = [s["registration_id"] for s in match["slots"]]
        result = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
            {"registration_id": regs[0], "rank": 1, "score": 2}, {"registration_id": regs[1], "rank": 2, "score": 0}]})
        assert result.status_code == 200, result.text
    second = sorted((m for m in await flow.matches(tournament) if m["round"] == 2 and m["section"] == "WB"),
                    key=lambda m: m["order"])
    return tournament, second


@pytest.mark.asyncio
@pytest.mark.parametrize("change", [{"called_at": "2026-10-14T12:00:00+00:00"}, {"status": "in_progress"},
                                    {"started_at": "2026-10-14T12:00:00+00:00"}])
async def test_redraw_writes_nothing_when_a_match_changed_after_reading(flow, monkeypatch, change):
    import routes.tournament_stage_routes as stage_routes

    tournament, second = await drawn_bracket(flow)
    group = second[0]["settings"]["draw_group"]
    original = stage_routes.build_redraw_application

    def meanwhile(stage_matches, group_key, **kwargs):
        application = original(stage_matches, group_key, **kwargs)
        # Zwischen Lesen und Schreiben ruft die Station das zweite Spiel auf (synchron am Speicher darunter).
        raw = getattr(flow.db.matches_v2, "_AsyncMongoMockCollection__collection")
        raw.update_one({"id": second[1]["id"]}, {"$set": change})
        return application

    monkeypatch.setattr(stage_routes, "build_redraw_application", meanwhile)
    before = {m["id"]: (m["draw"]["id"], [s["registration_id"] for s in m["slots"]]) for m in second}
    response = await flow.post(f"/api/tournaments/{tournament['id']}/stages/{second[0]['stage_id']}/redraw",
                               json={"group": group})
    assert response.status_code == 409, response.text
    after = {m["id"]: (m["draw"]["id"], [s["registration_id"] for s in m["slots"]])
             for m in await flow.matches(tournament) if m["id"] in before}
    assert after == before, "nichts geschrieben - auch nicht das erste Spiel"
    assert not await flow.db.audit_logs.count_documents({"action": "tournament.draw.redrawn"})


@pytest.mark.asyncio
async def test_redraw_rolls_back_when_a_later_write_misses(flow, monkeypatch):
    """Die Prüfung vorab passt, aber beim Schreiben des zweiten Spiels hat sich etwas geändert: das erste wird
    zurückgesetzt, 409."""
    tournament, second = await drawn_bracket(flow)
    group = second[0]["settings"]["draw_group"]
    collection_type = type(flow.db.matches_v2)
    real_update = collection_type.update_one
    state = {"writes": 0}

    async def flaky_update(self, filter_, update, *args, **kwargs):
        # Beim Schreiben des zweiten Spiels (die Prüfung vorab war schon durch) ruft die Station es gerade auf.
        if self.name == "matches_v2" and "draw" in (update.get("$set") or {}) and filter_.get("id") == second[1]["id"]                 and not state["writes"]:
            state["writes"] += 1
            await real_update(self, {"id": second[1]["id"]}, {"$set": {"called_at": "2026-10-14T12:00:00+00:00"}})
        return await real_update(self, filter_, update, *args, **kwargs)

    monkeypatch.setattr(collection_type, "update_one", flaky_update)
    before = {m["id"]: (m["draw"]["id"], [s["registration_id"] for s in m["slots"]], m["status"]) for m in second}
    response = await flow.post(f"/api/tournaments/{tournament['id']}/stages/{second[0]['stage_id']}/redraw",
                               json={"group": group})
    assert response.status_code == 409, response.text
    after = {m["id"]: (m["draw"]["id"], [s["registration_id"] for s in m["slots"]], m["status"])
             for m in await flow.matches(tournament) if m["id"] in before}
    assert state["writes"] == 1
    assert after == before


# ---------------------------------------------------------------------------------------------- Austritt (Codex 2)

@pytest.mark.asyncio
async def test_removal_that_decides_the_last_match_of_a_round_records_the_draw(flow):
    """Austritt im letzten offenen Spiel einer gemischten Runde: das Spiel ist kampflos entschieden, die Folgerunde
    wird ausgelost - mit Protokoll (Person: wer bestätigt hat) und genau einem Anzeige-Ereignis ``draw_done``."""
    from services import change_events

    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, regs = await flow.with_participants(8, randomize_advancement_rounds=True)
    built = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert built.status_code == 200, built.text
    await flow.start(tournament)
    first = sorted((m for m in await flow.matches(tournament) if m["round"] == 1 and m["section"] == "WB"),
                   key=lambda m: m["order"])
    for match in first[:-1]:
        seats = [s["registration_id"] for s in match["slots"]]
        response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
            {"registration_id": seats[0], "rank": 1, "score": 2}, {"registration_id": seats[1], "rank": 2, "score": 0}]})
        assert response.status_code == 200, response.text
    last = first[-1]
    victim = next(reg for reg in regs if reg["id"] == last["slots"][1]["registration_id"])
    url = f"/api/tournaments/{tournament['id']}/registrations/{victim['id']}/removal"
    plan = (await flow.post(url, json={"kind": "withdrawn"})).json()["plan"]
    before = len(change_events._event_buffer)
    confirmed = await flow.post(url, json={"kind": "withdrawn", "plan_id": plan["id"]})
    assert confirmed.status_code == 200, confirmed.text
    second = [m for m in await flow.matches(tournament) if m["round"] == 2 and m["section"] == "WB"]
    assert all(m.get("draw") for m in second)
    assert victim["id"] not in {s.get("registration_id") for m in second for s in m["slots"]}
    entry = await flow.db.audit_logs.find_one({"action": "tournament.draw.done"}, {"_id": 0})
    assert entry and entry["actor_id"] == staff["id"] and entry["data"]["draw_id"] == second[0]["draw"]["id"]
    drawn = [e for e in list(change_events._event_buffer)[before:]
             if (e.get("tournament_event") or {}).get("type") == "draw_done"]
    assert len(drawn) == 1
