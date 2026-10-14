"""Vorplanen im Vorschau-Baum (Fabian live 14.10.): damit sich jede Person schon vorher einplanen kann.

Der Planer plant auch die Spiele eines Vorschau-Baums (vor Ort) - mit denselben Abhängigkeiten wie im fixen Baum, als
Planer-Termin und „voraussichtlich“ (wer gegen wen spielt, kann sich bis zum Check-in-Ende noch ändern). Das Check-in-
Ende übernimmt Zeit, Station und Herkunft je Spiel; passt der Baum nicht mehr (andere Spielzahl), bekommen unpassende
Spiele nichts und die Phase den Hinweis „neu planen“.
"""
import pathlib
import sys
from datetime import datetime

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from routes.tournament_lifecycle_routes import _finalize_stage_previews_for_checkin  # noqa: E402
from test_match_scheduler_order_flow import cup, flow  # noqa: E402,F401
from models import new_id  # noqa: E402


async def preplanned(flow):
    tournament = await cup(flow, preview=True)
    for name in ("Switch 1", "Switch 2"):
        await flow.db.stations.insert_one({"id": new_id(), "name": name, "device_type": "switch", "tournament_id": tournament["id"],
                                           "status": "free", "current_match_id": None})
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    assert plan["mode"] == "stations", plan.get("reason")
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                              json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})
    assert applied.status_code == 200, applied.text
    return tournament, plan, {match["match_key"]: match for match in await flow.matches(tournament)}


def at(value: str) -> datetime:
    return datetime.fromisoformat(value)


@pytest.mark.asyncio
async def test_a_preview_bracket_can_be_planned_ahead(flow):
    tournament, plan, matches = await preplanned(flow)
    assert len(plan["assignments"]) == 14
    assert all(item["forecast"] for item in plan["assignments"]), "Vorschau: alles nur voraussichtlich"
    for key, match in matches.items():
        assert match["is_preview"] and match["status"] == "preview", key
        assert match["scheduled_at"] and match["station_id"], key
        assert match["schedule_source"] == "planner" and match["schedule_forecast"] is True, key
    # Abhängigkeiten wie im fixen Baum: E wartet auf A und B, LE auf LC und LD, das Finale auf G und LF.
    for later, earlier in (("E", "A"), ("E", "B"), ("LE", "LC"), ("LE", "LD"), ("FINAL", "G"), ("FINAL", "LF")):
        assert at(matches[later]["scheduled_at"]) > at(matches[earlier]["scheduled_at"]), f"{later} nach {earlier}"


@pytest.mark.asyncio
async def test_check_in_end_keeps_the_preplanned_times_as_planner_times(flow):
    tournament, _plan, before = await preplanned(flow)
    await _finalize_stage_previews_for_checkin(flow.db, tournament, None)
    after = {match["match_key"]: match for match in await flow.matches(tournament)}
    assert set(after) == set(before)
    for key, match in after.items():
        assert not match.get("is_preview"), key
        assert match["scheduled_at"] == before[key]["scheduled_at"] and match["station_id"] == before[key]["station_id"], key
        assert match["schedule_source"] == "planner", f"{key}: Planer-Termin bleibt Planer-Termin, nicht „von Hand“"
    stages = await flow.db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(10)
    assert not any(stage.get("schedule_hint") for stage in stages)
    # Danach einmal „Automatisch planen“: die Planer-Termine dürfen neu gesetzt werden.
    replan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    assert {item["match_id"] for item in replan["assignments"]} == {match["id"] for match in after.values()}


@pytest.mark.asyncio
async def test_check_in_end_with_a_smaller_field_keeps_the_plan_of_a_fixed_schema(flow):
    # Das Schema des Cups steht fest (14 Läufe für bis zu 16): weniger Eingecheckte ändern den Baum nicht - der Plan bleibt.
    tournament, _plan, before = await preplanned(flow)
    registrations = await flow.db.tournament_registrations.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)
    for registration in registrations[:7]:
        await flow.db.tournament_registrations.update_one({"id": registration["id"]}, {"$set": {"status": "withdrawn"}})
    await _finalize_stage_previews_for_checkin(flow.db, tournament, None)
    after = {match["match_key"]: match for match in await flow.matches(tournament) if not match.get("is_preview")}
    assert set(after) == set(before)
    assert all(after[key]["scheduled_at"] == before[key]["scheduled_at"] for key in after)
    stages = await flow.db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(10)
    assert not any(stage.get("schedule_hint") for stage in stages)


@pytest.mark.asyncio
async def test_check_in_end_with_a_changed_tree_asks_for_a_new_plan(flow):
    # Der fixe Baum hat andere Spiele als die Vorschau (hier fehlt der Vorschau das Finale): was nicht passt, bleibt ohne
    # Termin, und die Phase trägt „Baum hat sich geändert - neu planen“, bis neu geplant und übernommen ist.
    tournament, _plan, before = await preplanned(flow)
    await flow.db.matches_v2.delete_one({"id": before["FINAL"]["id"]})
    await _finalize_stage_previews_for_checkin(flow.db, tournament, None)
    after = {match["match_key"]: match for match in await flow.matches(tournament) if not match.get("is_preview")}
    assert not after["FINAL"].get("scheduled_at") and not after["FINAL"].get("station_id")
    assert after["A"]["scheduled_at"] == before["A"]["scheduled_at"]
    stages = await flow.db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(10)
    assert any(stage.get("schedule_hint") == "tree_changed" for stage in stages)
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/schedule/plan")).json()
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/schedule/apply",
                              json={"fingerprint": plan["fingerprint"], "planned_at": plan["planned_at"]})
    assert applied.status_code == 200, applied.text
    stages = await flow.db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(10)
    assert not any(stage.get("schedule_hint") for stage in stages), "neu geplant: Hinweis weg"
    final = next(match for match in await flow.matches(tournament) if match["match_key"] == "FINAL")
    assert final["scheduled_at"] and final["station_id"]
