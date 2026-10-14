"""FFA-Läufe zusammenlegen (#1550) über die Routen: Vorschlag oder Automatik je Turnier (Entscheidung E13),
Bestätigen und Ablehnen mit den Rechten der Turnierleitung, Turnier-Sperre, Protokoll, Live-Ereignis, Idempotenz.
"""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import change_events, scheduler  # noqa: E402

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
    # Der Baum entsteht mit dem Ende des Check-ins aus den Eingecheckten (#1551) - alle sind da, der Check-in endet.
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0}))["check_in_closed_at"]
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


# ---------------------------------------------------------------------------------------------- Codex-Nachprüfung

def _failing_second_write(flow, monkeypatch, *, foreign_change: dict | None = None):
    """Der zweite Schreibzugriff des Umbaus trifft einen Lauf, der sich gerade geändert hat - und den ersten Lauf hat
    optional auch jemand angefasst (``foreign_change``). Jeder Zugriff auf ``db.matches_v2`` liefert einen neuen
    Wrapper, deshalb hängt der Haken an der Klasse und greift nur bei Schreibzugriffen des Umbaus."""
    collection = flow.db.matches_v2
    sync = collection._AsyncMongoMockCollection__collection
    collection_class = type(collection)
    real_update = collection_class.update_one
    state = {"writes": 0, "first": None}

    async def update_one(self, filter_doc, update, *args, **kwargs):
        if self.name == "matches_v2" and "rebuild_token" in (update.get("$set") or {}):
            state["writes"] += 1
            if state["writes"] == 1:
                state["first"] = filter_doc["id"]
            if state["writes"] == 2:
                sync.update_one({"id": filter_doc["id"]}, {"$set": {"updated_at": "2099-01-01T00:00:00+00:00"}})
                if foreign_change:
                    sync.update_one({"id": state["first"]}, {"$set": foreign_change})
        return await real_update(self, filter_doc, update, *args, **kwargs)

    monkeypatch.setattr(collection_class, "update_one", update_one)
    return state


@pytest.mark.asyncio
async def test_rollback_restores_the_first_heat_exactly_including_new_fields(flow, monkeypatch):
    tournament, _staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    before = {m["id"]: m for m in await flow.matches(tournament)}
    state = _failing_second_write(flow, monkeypatch)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
    assert response.status_code == 409, response.text
    assert state["writes"] == 2
    after = {m["id"]: m for m in await flow.matches(tournament)}
    first = after[state["first"]]
    assert first == before[state["first"]], "der zurückgesetzte Lauf ist wieder genau der alte - ohne neue Felder"
    assert not {"merged_into", "rebuilt_at", "rebuild_token", "qualifiers_effective"} & set(first)
    assert (await stored(flow, tournament)).get("heat_rebuild_incomplete") is None


@pytest.mark.asyncio
async def test_rollback_never_overwrites_a_foreign_change_but_flags_and_notifies(flow, monkeypatch):
    tournament, staff = await sixteen_scheme(flow, 10, "suggest")
    plan = (await stored(flow, tournament))["heat_rebuild_plan"]
    state = _failing_second_write(flow, monkeypatch, foreign_change={"status": "in_progress", "updated_at": "2099-01-01T00:00:01+00:00"})
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/confirm", json={"plan_id": plan["id"]})
    assert response.status_code == 409, response.text
    first = await flow.db.matches_v2.find_one({"id": state["first"]}, {"_id": 0})
    assert first["status"] == "in_progress", "die fremde Änderung bleibt stehen"
    incomplete = (await stored(flow, tournament))["heat_rebuild_incomplete"]
    assert incomplete["match_ids"] == [state["first"]] and incomplete["match_keys"]
    assert (await audit_actions(flow, tournament)).count("tournament.heats.incomplete") == 1
    note = await flow.db.notifications.find_one({"user_id": staff["id"], "kind": "tournament_heat_rebuild"}, {"_id": 0})
    assert note and incomplete["match_keys"][0] in note["body"]


@pytest.mark.asyncio
async def test_a_conflict_after_a_result_is_retried_once_and_then_queued(flow, monkeypatch):
    import services.heat_rebuild as heat_rebuild

    tournament, _staff = await sixteen_scheme(flow, 10, "auto")
    real = heat_rebuild.evaluate_heat_rebuild
    calls = {"n": 0, "fail": 2}

    async def flaky(db, tid, **kwargs):
        calls["n"] += 1
        if calls["n"] <= calls["fail"]:
            raise heat_rebuild.HeatRebuildError(heat_rebuild.STALE_DETAIL, 409)
        return await real(db, tid, **kwargs)

    monkeypatch.setattr(heat_rebuild, "evaluate_heat_rebuild", flaky)
    # Zweimal Konflikt: einmal frisch wiederholt, dann eingereiht.
    assert await heat_rebuild.evaluate_after_write(flow.db, tournament["id"], actor_id=None, trigger="result") is None
    assert calls["n"] == 2
    assert (await stored(flow, tournament))["heat_rebuild_pending"]["trigger"] == "result"
    # Der Minuten-Job arbeitet die Warteschlange ab - unter der Turnier-Schreibsperre.
    calls["fail"] = 0
    processed = await heat_rebuild.process_pending_heat_rebuilds(flow.db)
    assert processed == 1 and calls["n"] == 3
    assert (await stored(flow, tournament)).get("heat_rebuild_pending") is None
    # Ein Konflikt, dann Erfolg: kein Eintrag in die Warteschlange.
    calls.update(n=0, fail=1)
    assert (await heat_rebuild.evaluate_after_write(flow.db, tournament["id"], actor_id=None, trigger="result"))["ok"]
    assert calls["n"] == 2
    assert (await stored(flow, tournament)).get("heat_rebuild_pending") is None


# ---------------------------------------------------------------------------------------------- Backoff, Dedupe

@pytest.mark.asyncio
async def test_pending_retries_back_off_and_stop_after_the_limit(flow, monkeypatch):
    import services.heat_rebuild as heat_rebuild

    tournament, staff = await sixteen_scheme(flow, 10, "auto")
    calls = {"n": 0}

    async def always_conflict(db, tid, **kwargs):
        calls["n"] += 1
        raise heat_rebuild.HeatRebuildError(heat_rebuild.STALE_DETAIL, 409)

    monkeypatch.setattr(heat_rebuild, "evaluate_heat_rebuild", always_conflict)
    await heat_rebuild.evaluate_after_write(flow.db, tournament["id"], actor_id=None, trigger="result")
    pending = (await stored(flow, tournament))["heat_rebuild_pending"]
    assert pending["attempts"] == 0 and pending["next_at"] <= now_utc().isoformat()
    expected_minutes = [1, 2, 5, 10]
    for attempt in range(1, 5):
        assert await heat_rebuild.process_pending_heat_rebuilds(flow.db) == 1
        pending = (await stored(flow, tournament))["heat_rebuild_pending"]
        assert pending["attempts"] == attempt
        wait = (datetime.fromisoformat(pending["next_at"]) - now_utc()).total_seconds()
        assert 60 * expected_minutes[attempt - 1] - 5 <= wait <= 60 * expected_minutes[attempt - 1] + 5, (attempt, wait)
        # Noch nicht fällig: der Takt überspringt das Turnier.
        before = calls["n"]
        assert await heat_rebuild.process_pending_heat_rebuilds(flow.db) == 0
        assert calls["n"] == before
        await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"heat_rebuild_pending.next_at": "2000-01-01T00:00:00+00:00"}})
    # Fünfter Versuch: Schluss - vermerkt, protokolliert, einmal gemeldet.
    assert await heat_rebuild.process_pending_heat_rebuilds(flow.db) == 1
    doc = await stored(flow, tournament)
    assert doc.get("heat_rebuild_pending") is None
    assert doc["heat_rebuild_incomplete"]["reason"] == "retries_exhausted"
    assert (await audit_actions(flow, tournament)).count("tournament.heats.incomplete") == 1
    assert await flow.db.notifications.count_documents({"user_id": staff["id"], "kind": "tournament_heat_rebuild"}) == 1
    assert await heat_rebuild.process_pending_heat_rebuilds(flow.db) == 0
    # „Neu prüfen“ von Hand setzt alles zurück - auch wenn es wieder schiefgeht, zählt es von vorn.
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"heat_rebuild_pending": {"attempts": 3, "next_at": "2000-01-01T00:00:00+00:00"}}})
    monkeypatch.undo()
    response = await flow.post(f"/api/tournaments/{tournament['id']}/heat-rebuild/check")
    assert response.status_code == 200, response.text
    doc = await stored(flow, tournament)
    assert doc.get("heat_rebuild_pending") is None and doc.get("heat_rebuild_incomplete") is None


@pytest.mark.asyncio
async def test_incomplete_notification_is_sent_once_per_incident(flow):
    import services.heat_rebuild as heat_rebuild

    tournament, staff = await sixteen_scheme(flow, 10, "auto")
    for _ in range(3):
        await heat_rebuild._notify_incomplete(flow.db, tournament, stage_id="s1", keys=["C"], reason="foreign_change")
    assert await flow.db.notifications.count_documents({"user_id": staff["id"], "kind": "tournament_heat_rebuild"}) == 1
    # Ein anderer Vorfall am selben Turnier innerhalb einer Stunde: Cooldown - erst danach wieder eine Nachricht.
    await heat_rebuild._notify_incomplete(flow.db, tournament, stage_id="s1", keys=["C"], reason="retries_exhausted")
    assert await flow.db.notifications.count_documents({"user_id": staff["id"], "kind": "tournament_heat_rebuild"}) == 1
    await flow.db.notifications.update_many({"kind": "tournament_heat_rebuild"}, {"$set": {"created_at": (now_utc() - timedelta(hours=2)).isoformat()}})
    await heat_rebuild._notify_incomplete(flow.db, tournament, stage_id="s1", keys=["C"], reason="retries_exhausted")
    assert await flow.db.notifications.count_documents({"user_id": staff["id"], "kind": "tournament_heat_rebuild"}) == 2
    # Derselbe Vorfall bleibt auch nach der Stunde einmalig.
    await heat_rebuild._notify_incomplete(flow.db, tournament, stage_id="s1", keys=["C"], reason="foreign_change")
    assert await flow.db.notifications.count_documents({"user_id": staff["id"], "kind": "tournament_heat_rebuild"}) == 2


# ---------------------------------------------------------------------------------------------- Spieldauer (#1554)

@pytest.mark.asyncio
async def test_a_merged_heat_takes_its_duration_from_the_game_and_the_replan_uses_it(flow):
    """Zusammengelegte Läufe bekommen keine Dauer eingefroren; das Neu-Planen nach dem Umbau rechnet mit dem Spiel."""
    from datetime import datetime as _dt

    game = {"id": new_id(), "name": "Mario Kart", "slug": "mk", "setup_minutes": 3,
            "match_modes": [{"mode": "gp4", "label": "Grand Prix 4 Rennen", "minutes": 12, "per_game": False}]}
    await flow.db.games.insert_one(dict(game))
    start = (now_utc() + timedelta(hours=1)).replace(microsecond=0).isoformat()
    tournament, _users, _regs = await flow.with_participants(
        10, format="ffa_custom_bracket", heat_rebuild_mode="auto", status="registration_open", game_id=game["id"],
        match_duration_minutes=None, event_mode="local", schedule_mode="fixed_by_staff", result_entry_mode=None, start_date=start)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": 16}})
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": SIXTEEN, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    await flow.db.stations.insert_one({"id": new_id(), "name": "1", "device_type": "switch", "tournament_id": tournament["id"],
                                       "status": "free", "current_match_id": None})
    flow.act_as(await flow.add_staff())
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    # Der Baum entsteht mit dem Ende des Check-ins (#1551) - wie in sixteen_scheme.
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()

    by_key = await heats(flow, tournament)
    assert by_key["D"]["status"] == "cancelled" and by_key["D"]["merged_into"] == by_key["C"]["id"]
    first_round = [by_key[key] for key in ("A", "B", "C")]
    assert all(heat.get("duration_minutes") is None and "duration_minutes" not in (heat.get("settings") or {}) for heat in first_round)
    times = sorted(_dt.fromisoformat(heat["scheduled_at"]) for heat in first_round)
    assert all(heat["schedule_source"] == "planner" for heat in first_round)
    # Eine Station: die Läufe folgen im Abstand der Spieldauer aus dem Spiel (12 Min. Grand Prix + 3 Min. Aufbau).
    assert [(later - earlier).total_seconds() / 60 for earlier, later in zip(times, times[1:])] == [15, 15]
