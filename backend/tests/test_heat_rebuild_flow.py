"""FFA-Läufe zusammenlegen (#1550) über die Routen: Vorschlag oder Automatik je Turnier (Entscheidung E13),
Bestätigen und Ablehnen mit den Rechten der Turnierleitung, Turnier-Sperre, Protokoll, Live-Ereignis, Idempotenz.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import change_events  # noqa: E402

SIXTEEN = """[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]
C=[9,10,11,12]
D=[13,14,15,16]
# Halbfinale
E=[W:A:1,W:A:2,W:B:1,W:B:2]
F=[W:C:1,W:C:2,W:D:1,W:D:2]
# Finale
G=[W:E:1,W:E:2,W:F:1,W:F:2]
"""


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def sixteen_scheme(flow, count: int, mode: str) -> tuple[dict, dict]:
    tournament, _users, _regs = await flow.with_participants(
        count, format="ffa_custom_bracket", heat_rebuild_mode=mode, status="registration_open")
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": 16}})
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": SIXTEEN, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    return tournament, staff


async def heats(flow, tournament: dict) -> dict[str, dict]:
    return {m["match_key"]: m for m in await flow.matches(tournament)}


async def audit_actions(flow, tournament: dict) -> list[str]:
    rows = await flow.db.audit_logs.find({"target_id": tournament["id"]}, {"_id": 0, "action": 1}).to_list(200)
    return sorted(row["action"] for row in rows)


async def stored(flow, tournament: dict) -> dict:
    return await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})


# ---------------------------------------------------------------------------------------------- Automatik

@pytest.mark.asyncio
async def test_auto_mode_rebuilds_at_check_in_and_writes_the_protocol(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "auto")
    by_key = await heats(flow, tournament)
    assert by_key["D"]["status"] == "cancelled" and by_key["D"]["merged_into"] == by_key["C"]["id"]
    assert len([s for s in by_key["C"]["slots"] if s["status"] == "filled"]) == 4
    assert by_key["C"]["settings"]["qualifiers_per_match"] == 2
    assert sorted(len([s for s in by_key[k]["slots"] if s["status"] == "pending"]) for k in ("E", "F")) == [3, 3]
    actions = await audit_actions(flow, tournament)
    assert actions.count("tournament.heats.merged") == 1
    assert actions.count("tournament.heats.rebalanced") == 1
    assert (await stored(flow, tournament)).get("heat_rebuild_plan") is None
    # Live-Ereignis (öffentlich, nur der Pfad): TV und Web laden neu.
    events = [e for e in change_events._event_buffer if e.get("path") == f"/api/tournaments/{tournament['id']}/heat-rebuild"]
    assert events and events[-1]["visibility_scope"] == "public"


@pytest.mark.asyncio
async def test_auto_mode_shortens_to_the_final_and_results_keep_it_consistent(flow):
    tournament, _staff = await sixteen_scheme(flow, 6, "auto")
    by_key = await heats(flow, tournament)
    assert by_key["G"]["status"] == "cancelled" and by_key["E"]["advancement"] == []
    assert (await audit_actions(flow, tournament)).count("tournament.round.shortened") == 1
    await flow.start(tournament)
    for key in ("A", "B"):
        match = by_key[key]
        ranking = [s["registration_id"] for s in match["slots"] if s["status"] == "filled"]
        response = await flow.post(f"/api/matches/{match['id']}/result", json={
            "results": [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]})
        assert response.status_code == 200, response.text
    by_key = await heats(flow, tournament)
    assert by_key["E"]["status"] == "ready"
    assert len([s for s in by_key["E"]["slots"] if s["status"] == "filled"]) == 4
    # Zweimal ausgelöst (zwei Ergebnisse) - der Umbau bleibt einer, das Protokoll auch.
    assert (await audit_actions(flow, tournament)).count("tournament.round.shortened") == 1


# ---------------------------------------------------------------------------------------------- Vorschlag

@pytest.mark.asyncio
async def test_suggest_mode_stores_a_plan_and_applies_only_what_needs_no_confirmation(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    by_key = await heats(flow, tournament)
    assert by_key["D"]["status"] == "ready" and by_key["D"].get("merged_into") is None
    assert by_key["C"]["settings"]["qualifiers_per_match"] == 1
    plan = (await stored(flow, tournament)).get("heat_rebuild_plan")
    assert plan and plan["id"] and plan["summary"]
    assert {op["kind"] for op in plan["ops"]} >= {"merged", "rebalanced"}
    assert "zusammengelegt" in plan["summary"] and "ausgeglichen" in plan["summary"]
    assert "tournament.heats.merged" not in await audit_actions(flow, tournament)
    assert (await audit_actions(flow, tournament)).count("tournament.heats.proposed") == 1
    # Noch einmal prüfen lassen: derselbe Vorschlag, kein zweiter Protokolleintrag.
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/check")
    assert response.status_code == 200, response.text
    assert (await stored(flow, tournament))["heat_rebuild_plan"]["id"] == plan["id"]
    assert (await audit_actions(flow, tournament)).count("tournament.heats.proposed") == 1
    # Die Turnierleitung sieht den Vorschlag am Turnier, Gäste nicht.
    assert (await flow.get(f"/api/tournaments/{tournament['id']}")).json()["heat_rebuild_plan"]["id"] == plan["id"]
    flow.act_as(None)
    assert "heat_rebuild_plan" not in (await flow.get(f"/api/tournaments/{tournament['id']}")).json()


@pytest.mark.asyncio
async def test_confirming_the_plan_applies_it_once(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["applied"]
    by_key = await heats(flow, tournament)
    assert by_key["D"]["status"] == "cancelled" and by_key["D"]["merged_into"] == by_key["C"]["id"]
    assert by_key["C"]["settings"]["qualifiers_per_match"] == 2
    assert (await stored(flow, tournament)).get("heat_rebuild_plan") is None
    actions = await audit_actions(flow, tournament)
    assert actions.count("tournament.heats.merged") == 1 and actions.count("tournament.heats.rebalanced") == 1
    again = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
    assert again.status_code == 409
    assert (await audit_actions(flow, tournament)).count("tournament.heats.merged") == 1


@pytest.mark.asyncio
async def test_rejecting_the_plan_keeps_the_heats_and_does_not_ask_again(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/reject", json={"plan_id": plan["id"]})
    assert response.status_code == 200, response.text
    assert (await stored(flow, tournament)).get("heat_rebuild_plan") is None
    assert (await heats(flow, tournament))["D"]["status"] == "ready"
    check = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/check")
    assert check.status_code == 200
    assert (await stored(flow, tournament)).get("heat_rebuild_plan") is None
    actions = await audit_actions(flow, tournament)
    assert actions.count("tournament.heats.rejected") == 1 and actions.count("tournament.heats.proposed") == 1


@pytest.mark.asyncio
async def test_a_stale_plan_is_refused_when_a_heat_has_started(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    by_key = await heats(flow, tournament)
    await flow.db.matches_v2.update_one({"id": by_key["C"]["id"]}, {"$set": {"status": "in_progress"}})
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
    assert response.status_code == 409, response.text
    assert (await heats(flow, tournament))["D"]["status"] == "ready"
    assert "tournament.heats.merged" not in await audit_actions(flow, tournament)


# ---------------------------------------------------------------------------------------------- Rechte und Sperre

@pytest.mark.asyncio
async def test_only_structure_staff_may_decide(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    url = f"/api/tournaments/{tournament['id']}/heat-rebuild"
    player = await flow.add_user(name="Spieler")
    flow.act_as(player)
    assert (await flow.post(f"{url}/confirm", json={"plan_id": plan["id"]})).status_code == 403
    assert (await flow.post(f"{url}/reject", json={"plan_id": plan["id"]})).status_code == 403
    assert (await flow.post(f"{url}/check")).status_code == 403
    flow.act_as(None)
    assert (await flow.post(f"{url}/confirm", json={"plan_id": plan["id"]})).status_code == 401
    scorekeeper = await flow.add_user(name="Ergebnisdienst")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": scorekeeper["id"], "role": "scorekeeper",
        "scope": "tournament", "is_active": True})
    flow.act_as(scorekeeper)
    assert (await flow.post(f"{url}/confirm", json={"plan_id": plan["id"]})).status_code == 403
    organizer = await flow.add_user(name="Organisation")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": organizer["id"], "role": "organizer",
        "scope": "tournament", "is_active": True})
    flow.act_as(organizer)
    response = await flow.post(f"{url}/confirm", json={"plan_id": plan["id"]})
    assert response.status_code == 200, response.text
    assert (await heats(flow, tournament))["D"]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_locked_tournament_refuses_the_decision(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"locked_at": now_utc().isoformat()}})
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
    assert response.status_code == 423
    assert (await heats(flow, tournament))["D"]["status"] == "ready"


@pytest.mark.asyncio
async def test_mode_is_a_tournament_field_with_suggest_as_default(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    game = {"id": new_id(), "name": "Mario Kart", "slug": "mario-kart"}
    await flow.db.games.insert_one(game)
    body = {"title": "Lauf-Cup", "game_id": game["id"], "format": "ffa_custom_bracket", "max_participants": 16}
    created = await flow.post("/api/tournaments", json=body)
    assert created.status_code in (200, 201), created.text
    assert created.json()["heat_rebuild_mode"] == "suggest"
    tid = created.json()["id"]
    updated = await flow.put(f"/api/tournaments/{tid}", json={"heat_rebuild_mode": "auto"})
    assert updated.status_code == 200, updated.text
    assert updated.json()["heat_rebuild_mode"] == "auto"
    assert (await flow.put(f"/api/tournaments/{tid}", json={"heat_rebuild_mode": "sofort"})).status_code == 422


# ---------------------------------------------------------------------------------------------- Codex-Nacharbeit

@pytest.mark.asyncio
async def test_a_heat_called_between_reading_and_writing_stays_untouched(flow, monkeypatch):
    """Compare-and-Set: wird ein Lauf aufgerufen, während der Umbau schon gerechnet ist, schreibt der Umbau nichts -
    auch nicht halb. (Die Stationsrouten laufen heute ohne die Turnier-Schreibsperre; #1569 holt sie nach.)"""
    import services.heat_rebuild as heat_rebuild

    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    heat_c = (await heats(flow, tournament))["C"]
    real_validate = heat_rebuild.validate_competition_graph
    sync_matches = flow.db.matches_v2._AsyncMongoMockCollection__collection

    def validate_while_a_station_calls(snapshot):
        # Zwischen Lesen und Schreiben: eine Station ruft C auf.
        sync_matches.update_one({"id": heat_c["id"]}, {"$set": {"called_at": now_utc().isoformat()}})
        return real_validate(snapshot)

    monkeypatch.setattr(heat_rebuild, "validate_competition_graph", validate_while_a_station_calls)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
    assert response.status_code == 409, response.text
    by_key = await heats(flow, tournament)
    assert by_key["D"]["status"] == "ready" and by_key["D"].get("merged_into") is None
    assert len([s for s in by_key["C"]["slots"] if s["status"] == "filled"]) == 2
    assert by_key["C"].get("called_at")
    assert sorted(len([s for s in by_key[k]["slots"] if s["status"] == "pending"]) for k in ("E", "F")) == [2, 4]
    assert "tournament.heats.merged" not in await audit_actions(flow, tournament)


@pytest.mark.asyncio
async def test_the_list_route_hides_the_plan_from_everyone_but_the_tournament_lead(flow):
    tournament, staff = await sixteen_scheme(flow, 10, "suggest")
    flow.act_as(None)
    rows = (await flow.get("/api/tournaments")).json()
    row = next(r for r in rows if r["id"] == tournament["id"])
    assert "heat_rebuild_plan" not in row and "heat_rebuild_dismissed" not in row
    player = await flow.add_user(name="Spieler")
    flow.act_as(player)
    row = next(r for r in (await flow.get("/api/tournaments")).json() if r["id"] == tournament["id"])
    assert "heat_rebuild_plan" not in row
    flow.act_as(staff)
    row = next(r for r in (await flow.get("/api/tournaments")).json() if r["id"] == tournament["id"])
    assert row["heat_rebuild_plan"]["id"]


@pytest.mark.asyncio
async def test_the_detail_route_shows_the_plan_only_to_structure_staff(flow):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    url = f"/api/tournaments/{tournament['id']}"
    for role, visible in (("stream_operator", False), ("station_manager", False), ("scorekeeper", False), ("referee", True), ("organizer", True)):
        helper = await flow.add_user(name=f"Helfer {role}")
        await flow.db.tournament_staff_assignments.insert_one({
            "id": new_id(), "tournament_id": tournament["id"], "user_id": helper["id"], "role": role,
            "scope": "tournament", "is_active": True})
        flow.act_as(helper)
        data = (await flow.get(url)).json()
        assert ("heat_rebuild_plan" in data) is visible, role
        assert "heat_rebuild_dismissed" not in data or visible
