"""Termin des eigenen Spiels (#2203, Entscheidung des Obmanns): „Spiele betreuen“ setzt im eigenen Spiel keinen Termin direkt. Wer beteiligt
ist, nutzt als Captain oder Vertreter Vorschlag und Zustimmung; direkt setzt eine andere berechtigte Person, der Superadmin nur als
Notausnahme mit Grund. Erfundene Namen."""

import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from league_match_world import world  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def holder(flow, *capabilities, user=None) -> dict:
    person = user or await flow.add_user(name="Zuständig")
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": person["id"], "capabilities": list(capabilities)})
    return person


def later(hours: int = 48) -> str:
    return (now_utc() + timedelta(hours=hours)).isoformat()


async def overrides(flow) -> list[dict]:
    return await flow.db.audit_logs.find({"action": "league.conflict.override"}, {"_id": 0}).to_list(5)


@pytest.mark.asyncio
@pytest.mark.parametrize("who", ["Kapitaen", "LoeLeitung", "Mila", "Falke1"])
async def test_involved_holder_sets_no_date(flow, who):
    w = await world(flow)
    flow.act_as(await holder(flow, "matches", user=w["users"][who]))
    before = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0, "scheduled_at": 1})
    response = await flow.patch(f"/api/matches/{w['match']['id']}", json={"scheduled_at": later()})
    assert response.status_code == 403
    assert "selbst beteiligt" in response.json()["detail"]
    assert await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0, "scheduled_at": 1}) == before


@pytest.mark.asyncio
async def test_a_second_person_sets_the_date(flow):
    w = await world(flow)
    flow.act_as(await holder(flow, "matches"))
    response = await flow.patch(f"/api/matches/{w['match']['id']}", json={"scheduled_at": later()})
    assert response.status_code == 200, response.text
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert stored["schedule_source"] == "manual"


@pytest.mark.asyncio
async def test_involved_superadmin_needs_a_reason(flow):
    w = await world(flow)
    flow.act_as({**w["users"]["Kapitaen"], "role": "superadmin"})
    url = f"/api/matches/{w['match']['id']}"
    assert (await flow.patch(url, json={"scheduled_at": later()})).status_code == 403
    assert (await flow.patch(url, json={"scheduled_at": later(), "conflict_reason": "kurz"})).status_code == 403
    assert await overrides(flow) == []

    response = await flow.patch(url, json={"scheduled_at": later(), "conflict_reason": "Sonst niemand erreichbar"})
    assert response.status_code == 200, response.text
    logged = await overrides(flow)
    assert len(logged) == 1 and logged[0]["data"]["action"] == "match_plan" and logged[0]["data"]["reason"] == "Sonst niemand erreichbar"
    stored = await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0})
    assert "conflict_reason" not in stored, "der Grund gehört ins Protokoll, nicht ans Spiel"


@pytest.mark.asyncio
async def test_the_captain_with_matches_goes_the_normal_way(flow):
    w = await world(flow)
    captain = await holder(flow, "matches", user=w["users"]["Kapitaen"])
    flow.act_as(captain)
    proposed = await flow.post(f"/api/matches/{w['match']['id']}/schedule-proposals", json={"scheduled_at": later()})
    assert proposed.status_code == 200, proposed.text
    decision = f"/api/matches/{w['match']['id']}/schedule-proposals/{proposed.json()['id']}/decision"

    own = await flow.post(decision, json={"action": "accept"})
    assert own.status_code == 400, "den eigenen Vorschlag bestätigt die Gegenseite - auch mit „Spiele betreuen“"

    flow.act_as(w["users"]["Falke1"])
    accepted = await flow.post(decision, json={"action": "accept"})
    assert accepted.status_code == 200, accepted.text


@pytest.mark.asyncio
async def test_an_uninvolved_holder_still_decides_proposals(flow):
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    proposed = await flow.post(f"/api/matches/{w['match']['id']}/schedule-proposals", json={"scheduled_at": later()})
    assert proposed.status_code == 200, proposed.text
    flow.act_as(await holder(flow, "matches"))
    accepted = await flow.post(f"/api/matches/{w['match']['id']}/schedule-proposals/{proposed.json()['id']}/decision", json={"action": "accept"})
    assert accepted.status_code == 200, accepted.text


@pytest.mark.asyncio
async def test_a_squad_member_with_matches_has_no_shortcut(flow):
    """Mila steht im Kader, ist aber weder Captain noch Vertreter: Die Zuständigkeit macht sie im eigenen Spiel nicht zur Leitung."""
    w = await world(flow)
    flow.act_as(w["users"]["Kapitaen"])
    proposed = await flow.post(f"/api/matches/{w['match']['id']}/schedule-proposals", json={"scheduled_at": later()})
    assert proposed.status_code == 200
    flow.act_as(await holder(flow, "matches", user=w["users"]["Mila"]))
    assert (await flow.post(f"/api/matches/{w['match']['id']}/schedule-proposals", json={"scheduled_at": later(72)})).status_code == 403
    decision = f"/api/matches/{w['match']['id']}/schedule-proposals/{proposed.json()['id']}/decision"
    assert (await flow.post(decision, json={"action": "accept"})).status_code == 403


@pytest.mark.asyncio
async def test_bulk_release_with_an_own_match_is_refused(flow):
    w = await world(flow)
    await flow.db.matches_v2.update_one({"id": w["match"]["id"]}, {"$set": {"schedule_source": "manual"}})
    url = f"/api/tournaments/{w['tournament']['id']}/schedule/release"
    flow.act_as(await holder(flow, "matches", user=w["users"]["Kapitaen"]))
    refused = await flow.post(url, json={"scope": "all"})
    assert refused.status_code == 403
    assert "selbst beteiligt" in refused.json()["detail"]
    assert (await flow.db.matches_v2.find_one({"id": w["match"]["id"]}, {"_id": 0}))["schedule_source"] == "manual"

    flow.act_as(await holder(flow, "matches"))
    assert (await flow.post(url, json={"scope": "all"})).status_code == 200


@pytest.mark.asyncio
async def test_a_plan_that_frees_an_own_match_is_refused(flow, monkeypatch):
    """Der Planer löst auch Termine (``releases``): Das eigene Spiel darf nicht über diesen Teil des Plans frei werden."""
    from routes import tournament_schedule_routes

    w = await world(flow)
    match_id = w["match"]["id"]
    scheduled_at = later()
    await flow.db.matches_v2.update_one({"id": match_id}, {"$set": {"schedule_source": "planner", "scheduled_at": scheduled_at, "station_id": None}})
    stored = await flow.db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    previous = {"schedule_source": "planner", "scheduled_at": scheduled_at, "station_id": None, "status": stored.get("status")}

    async def plan_with_release(_db, _tournament, now=None):
        return {"fingerprint": "plan", "assignments": [], "releases": [{"match_id": match_id, "previous": previous}], "warnings": []}

    monkeypatch.setattr(tournament_schedule_routes, "plan_for_tournament", plan_with_release)
    url = f"/api/tournaments/{w['tournament']['id']}/schedule/apply"
    body = {"fingerprint": "plan", "planned_at": now_utc().isoformat()}

    flow.act_as(await holder(flow, "matches", user=w["users"]["Kapitaen"]))
    refused = await flow.post(url, json=body)
    assert refused.status_code == 403, refused.text
    assert "selbst beteiligt" in refused.json()["detail"]
    assert (await flow.db.matches_v2.find_one({"id": match_id}, {"_id": 0}))["scheduled_at"] == scheduled_at

    flow.act_as(await holder(flow, "matches"))
    applied = await flow.post(url, json=body)
    assert applied.status_code == 200, applied.text
    assert (await flow.db.matches_v2.find_one({"id": match_id}, {"_id": 0}))["scheduled_at"] is None


@pytest.mark.asyncio
async def test_match_page_names_the_conflict_for_matches_too(flow):
    w = await world(flow)
    flow.act_as(await holder(flow, "matches", user=w["users"]["Kapitaen"]))
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["conflict"] == {"kind": "involved", "override": False}
    assert page["can_manage_schedule"] is True, "als Captain plant er weiter"

    flow.act_as(await holder(flow, "matches", user=w["users"]["Mila"]))
    page = (await flow.get(f"/api/matches/{w['match']['id']}/page")).json()
    assert page["conflict"] == {"kind": "involved", "override": False}
    assert page["can_manage_schedule"] is False


@pytest.mark.asyncio
async def test_match_list_marks_the_own_matches_for_the_plan(flow):
    w = await world(flow)
    url = f"/api/tournaments/{w['tournament']['id']}/matches-v2"

    flow.act_as(await holder(flow, "matches", user=w["users"]["Kapitaen"]))
    row = next(item for item in (await flow.get(url)).json() if item["id"] == w["match"]["id"])
    assert row["viewer_involved"] is True and row["viewer_override"] is False

    flow.act_as({**w["users"]["Falke1"], "role": "superadmin"})
    row = next(item for item in (await flow.get(url)).json() if item["id"] == w["match"]["id"])
    assert row["viewer_involved"] is True and row["viewer_override"] is True

    flow.act_as(await holder(flow, "matches"))
    row = next(item for item in (await flow.get(url)).json() if item["id"] == w["match"]["id"])
    assert row["viewer_involved"] is False


@pytest.mark.asyncio
async def test_a_tournament_without_league_knows_nothing_of_this(flow):
    tournament, users, regs = await flow.with_participants(2, status="live")
    match = {"id": new_id(), "tournament_id": tournament["id"], "stage_id": new_id(), "match_type": "duel", "status": "scheduled", "round": 1,
             "slots": [{"slot": 1, "status": "filled", "registration_id": regs[0]["id"]},
                       {"slot": 2, "status": "filled", "registration_id": regs[1]["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    flow.act_as({**users[0], "role": "tournament_admin"})
    response = await flow.patch(f"/api/matches/{match['id']}", json={"scheduled_at": later()})
    assert response.status_code == 200, response.text
    rows = (await flow.get(f"/api/tournaments/{tournament['id']}/matches-v2")).json()
    assert "viewer_involved" not in rows[0]
