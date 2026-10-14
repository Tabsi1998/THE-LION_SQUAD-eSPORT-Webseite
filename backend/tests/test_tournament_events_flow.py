"""Turnier-Ereignisse (#1553) über die echten Routen gegen mongomock: Vorschlag und Bestätigung der Turnierleitung,
Rechte, Sperre, Protokoll je Schritt, Station frei, Benachrichtigungen, Anzeige-Ereignis, Tabelle ohne Ausgetretene,
Korrektur mit Freigabe der zurückgesetzten Folgespiele, Idempotenz und Ereignisse nacheinander.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402
from services import change_events  # noqa: E402
from services.matchday_schedule import schedule_writes  # noqa: E402
from services.result_hold import publish_due_holds  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def bracket(flow, count: int, *, fmt: str = "single_elim", stage_type: str = "single_elimination",
                  settings: dict | None = None, **fields) -> tuple[dict, list[dict], dict]:
    tournament, _users, regs = await flow.with_participants(count, format=fmt, status="registration_open", **fields)
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Phase 1",
        "stage_type": stage_type, "match_type": "duel", "status": "pending", "settings": settings or {},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return tournament, regs, staff


async def by_key(flow, tournament: dict) -> dict[str, dict]:
    return {m["match_key"]: m for m in await flow.matches(tournament)}


def filled(match: dict) -> list[str]:
    return [s["registration_id"] for s in match["slots"] if s.get("status") == "filled" and s.get("registration_id")]


async def play(flow, match: dict, ranking: list[str]) -> None:
    response = await flow.post(f"/api/matches/{match['id']}/result", json={
        "results": [{"registration_id": reg, "rank": index + 1} for index, reg in enumerate(ranking)]})
    assert response.status_code == 200, response.text


async def audit_actions(flow, tournament: dict) -> list[str]:
    rows = await flow.db.audit_logs.find({"target_id": tournament["id"]}, {"_id": 0, "action": 1}).to_list(500)
    return sorted(row["action"] for row in rows)


async def stored(flow, tournament: dict) -> dict:
    return await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})


async def registration(flow, reg: dict) -> dict:
    return await flow.db.tournament_registrations.find_one({"id": reg["id"]}, {"_id": 0})


async def station_for(flow, match: dict) -> dict:
    station = {"id": new_id(), "name": "Station 1", "status": "busy", "current_match_id": match["id"], "current_match_type": "matches_v2"}
    await flow.db.stations.insert_one(dict(station))
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": station["id"], "called_at": now_utc().isoformat()}})
    return station


def removal_url(tournament: dict, reg: dict) -> str:
    return f"/api/tournaments/{tournament['id']}/registrations/{reg['id']}/removal"


def events_of(kind: str, tournament: dict) -> list[dict]:
    return [e for e in change_events._event_buffer
            if e.get("event_type") == "tournament.event" and (e.get("tournament_event") or {}).get("type") == kind
            and e["tournament_event"].get("tournament_id") == tournament["id"]]


# ---------------------------------------------------------------------------------------------- Vorschlag

@pytest.mark.asyncio
async def test_a_removal_is_proposed_in_words_and_needs_the_confirmation(flow):
    tournament, regs, _staff = await bracket(flow, 8)
    keys = await by_key(flow, tournament)
    await play(flow, keys["A"], filled(keys["A"]))
    await play(flow, keys["B"], filled(keys["B"]))
    victim = regs[0]
    response = await flow.post(removal_url(tournament, victim), json={"kind": "disqualified", "reason": "Unsportlich"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["requires_confirmation"] is True and body["idempotent_replay"] is False
    plan = body["plan"]
    assert plan["kind"] == "disqualified" and plan["reason"] == "Unsportlich" and plan["mode"] == "bracket"
    assert "kampflos" in plan["summary"] and "Spieler 1" not in plan["summary"]
    assert any("Spieler" in op["text"] for op in plan["ops"]), "die Namen stehen im Vorschlag für die Turnierleitung"
    assert (await stored(flow, tournament))["participant_removal_plan"]["id"] == plan["id"]
    # Noch nichts passiert: die Anmeldung und das Spiel sind wie vorher.
    assert (await registration(flow, victim))["status"] == "approved"
    assert (await by_key(flow, tournament))["E"]["status"] == "ready"
    actions = await audit_actions(flow, tournament)
    assert actions.count("tournament.participant.removal_proposed") == 1
    # Derselbe Vorschlag noch einmal: kein zweiter Protokolleintrag, dieselbe Kennung.
    again = await flow.post(removal_url(tournament, victim), json={"kind": "disqualified"})
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True
    assert again.json()["plan"]["id"] == plan["id"]
    assert (await audit_actions(flow, tournament)).count("tournament.participant.removal_proposed") == 1
    # Gäste sehen den Vorschlag nicht, die Turnierleitung schon.
    assert (await flow.get(f"/api/tournaments/{tournament['id']}")).json()["participant_removal_plan"]["id"] == plan["id"]
    flow.act_as(None)
    assert "participant_removal_plan" not in (await flow.get(f"/api/tournaments/{tournament['id']}")).json()


@pytest.mark.asyncio
async def test_confirming_applies_once_with_protocol_station_notifications_and_display_events(flow):
    tournament, regs, staff = await bracket(flow, 8)
    keys = await by_key(flow, tournament)
    await play(flow, keys["A"], filled(keys["A"]))
    await play(flow, keys["B"], filled(keys["B"]))
    keys = await by_key(flow, tournament)
    station = await station_for(flow, keys["E"])
    victim = regs[0]
    opponent = next(reg for reg in regs if reg["id"] in filled(keys["E"]) and reg["id"] != victim["id"])
    plan = (await flow.post(removal_url(tournament, victim), json={"kind": "disqualified", "reason": "Unsportlich"})).json()["plan"]
    response = await flow.post(removal_url(tournament, victim), json={"kind": "disqualified", "plan_id": plan["id"]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["idempotent_replay"] is False and [op["kind"] for op in body["applied"]] == ["slot_cleared", "walkover"]
    reg = await registration(flow, victim)
    assert reg["status"] == "disqualified"
    assert reg["removal"]["kind"] == "disqualified" and reg["removal"]["mode"] == "bracket" and reg["removal"]["reason"] == "Unsportlich"
    keys = await by_key(flow, tournament)
    assert keys["E"]["status"] == "completed" and keys["E"]["results"][0]["registration_id"] == opponent["id"]
    assert keys["E"]["result_meta"]["reason"] == "disqualified"
    assert opponent["id"] in filled(keys["G"])
    assert not keys["E"].get("called_at")
    freed = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    assert freed["status"] == "free" and freed["current_match_id"] is None
    actions = await audit_actions(flow, tournament)
    assert actions.count("match.slot_cleared") == 1 and actions.count("match.walkover") == 1
    assert actions.count("tournament.participant.disqualified") == 1
    event_audit = await flow.db.audit_logs.find_one({"action": "tournament.participant.disqualified"}, {"_id": 0})
    assert event_audit["data"]["display_event"] == "player_disqualified" and event_audit["data"]["reason"] == "Unsportlich"
    assert (await stored(flow, tournament)).get("participant_removal_plan") is None
    # Nachrichten: die Person erfährt es, der Gegner bekommt „Ergebnis bestätigt“ (kampflos).
    mine = await flow.db.notifications.find({"user_id": victim["user_id"], "kind": "tournament_registration"}, {"_id": 0}).to_list(10)
    assert mine and "disqualifiziert" in mine[-1]["body"] and "Unsportlich" in mine[-1]["body"]
    theirs = await flow.db.notifications.find({"user_id": opponent["user_id"], "kind": "match_result"}, {"_id": 0}).to_list(10)
    assert theirs and theirs[-1]["meta"]["match_id"] == keys["E"]["id"]
    # Anzeige-Ereignisse: öffentlich, nur Typ, Turnier und Spiel-Kennungen - keine Namen.
    withdrawn = events_of("player_disqualified", tournament)
    assert withdrawn and withdrawn[-1]["visibility_scope"] == "public"
    assert keys["E"]["id"] in withdrawn[-1]["tournament_event"]["match_ids"]
    assert "Spieler" not in str(withdrawn[-1])
    # Öffentlich (Codex-Befund): nur „ein Platz wurde frei“ mit Spiel-Kennungen - weder die Anmeldung noch die Art.
    public = change_events._event_for_scope(withdrawn[-1], "public")
    assert public["tournament_event"]["type"] == "slot_cleared"
    assert "registration_id" not in public["tournament_event"] and victim["id"] not in str(public)
    assert public["tournament_event"]["match_ids"] == withdrawn[-1]["tournament_event"]["match_ids"]
    staff = change_events._event_for_scope(withdrawn[-1], "staff")
    assert staff["tournament_event"]["type"] == "player_disqualified"
    assert staff["tournament_event"]["registration_id"] == victim["id"]
    walkovers = events_of("walkover", tournament)
    assert walkovers and walkovers[-1]["tournament_event"]["match_ids"] == [keys["E"]["id"]]
    # Noch einmal bestätigen: einmal ausgeführt, kein zweites Protokoll.
    again = await flow.post(removal_url(tournament, victim), json={"kind": "disqualified", "plan_id": plan["id"]})
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True
    assert (await audit_actions(flow, tournament)).count("match.walkover") == 1
    # Und ein neuer Vorschlag für dieselbe Person: nichts mehr zu tun.
    assert (await flow.post(removal_url(tournament, victim), json={"kind": "disqualified"})).json()["idempotent_replay"] is True
    # Die Verwaltung sieht den neuen Status in der Teilnehmerliste.
    listed = (await flow.get(f"/api/tournaments/{tournament['id']}/registrations")).json()
    rows = listed if isinstance(listed, list) else listed.get("items") or listed.get("registrations") or []
    assert any(row["id"] == victim["id"] and row["status"] == "disqualified" for row in rows)


@pytest.mark.asyncio
async def test_a_stale_proposal_is_refused_and_replaced(flow):
    tournament, regs, _staff = await bracket(flow, 8)
    keys = await by_key(flow, tournament)
    await play(flow, keys["A"], filled(keys["A"]))
    victim = regs[0]
    plan = (await flow.post(removal_url(tournament, victim), json={"kind": "withdrawn"})).json()["plan"]
    assert [op["kind"] for op in plan["ops"]] == ["slot_cleared"]
    keys = await by_key(flow, tournament)
    await play(flow, keys["B"], filled(keys["B"]))  # jetzt ist E bereit - der Plan hätte einen Walkover mehr
    response = await flow.post(removal_url(tournament, victim), json={"kind": "withdrawn", "plan_id": plan["id"]})
    assert response.status_code == 409, response.text
    assert (await registration(flow, victim))["status"] == "approved"
    fresh = (await stored(flow, tournament))["participant_removal_plan"]
    assert fresh["id"] != plan["id"] and [op["kind"] for op in fresh["ops"]] == ["slot_cleared", "walkover"]
    confirmed = await flow.post(removal_url(tournament, victim), json={"kind": "withdrawn", "plan_id": fresh["id"]})
    assert confirmed.status_code == 200, confirmed.text
    assert (await registration(flow, victim))["status"] == "withdrawn"


@pytest.mark.asyncio
async def test_rejecting_drops_the_proposal(flow):
    tournament, regs, _staff = await bracket(flow, 4)
    plan = (await flow.post(removal_url(tournament, regs[0]), json={"kind": "withdrawn"})).json()["plan"]
    response = await flow.post(removal_url(tournament, regs[0]) + "/reject", json={"plan_id": plan["id"]})
    assert response.status_code == 200, response.text
    assert (await stored(flow, tournament)).get("participant_removal_plan") is None
    assert (await flow.post(removal_url(tournament, regs[0]), json={"kind": "withdrawn", "plan_id": plan["id"]})).status_code == 409
    assert (await audit_actions(flow, tournament)).count("tournament.participant.removal_rejected") == 1


# ---------------------------------------------------------------------------------------------- Rechte und Sperre

@pytest.mark.asyncio
async def test_only_structure_staff_may_remove_and_the_status_route_refuses_the_shortcut(flow):
    tournament, regs, _staff = await bracket(flow, 4)
    url = removal_url(tournament, regs[0])
    player = await flow.add_user(name="Spieler")
    flow.act_as(player)
    assert (await flow.post(url, json={"kind": "withdrawn"})).status_code == 403
    flow.act_as(None)
    assert (await flow.post(url, json={"kind": "withdrawn"})).status_code == 401
    scorekeeper = await flow.add_user(name="Ergebnisdienst")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": scorekeeper["id"], "role": "scorekeeper",
        "scope": "tournament", "is_active": True})
    flow.act_as(scorekeeper)
    assert (await flow.post(url, json={"kind": "withdrawn"})).status_code == 403
    organizer = await flow.add_user(name="Organisation")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": organizer["id"], "role": "organizer",
        "scope": "tournament", "is_active": True})
    flow.act_as(organizer)
    assert (await flow.post(url, json={"kind": "withdrawn"})).status_code == 200
    assert (await flow.post(url, json={"kind": "gone"})).status_code == 422
    # Der Statuswechsel über die Anmeldungsroute ist kein Ersatz: er kennt den Umbauplan nicht.
    staff = await flow.add_staff()
    flow.act_as(staff)
    response = await flow.patch(f"/api/tournaments/{tournament['id']}/registrations/{regs[0]['id']}", json={"status": "withdrawn"})
    assert response.status_code == 409, response.text
    assert "Austritt" in response.json()["detail"]


@pytest.mark.asyncio
async def test_locked_tournament_refuses_the_removal(flow):
    tournament, regs, _staff = await bracket(flow, 4)
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"locked_at": now_utc().isoformat()}})
    assert (await flow.post(removal_url(tournament, regs[0]), json={"kind": "withdrawn"})).status_code == 423


# ---------------------------------------------------------------------------------------------- Liga

@pytest.mark.asyncio
async def test_league_withdrawal_takes_the_player_out_of_the_table_and_the_matchday_run(flow):
    tournament, regs, _staff = await bracket(flow, 6, fmt="round_robin", stage_type="round_robin_groups",
                                             settings={"group_count": 1}, start_date=(now_utc() - timedelta(days=1)).isoformat())
    matches = await flow.matches(tournament)
    victim = regs[0]
    mine = sorted((m for m in matches if victim["id"] in filled(m)), key=lambda m: (m["round"], m["order"]))
    assert len(mine) == 5
    for match in mine[:2]:
        await play(flow, match, [victim["id"], *[r for r in filled(match) if r != victim["id"]]])
    plan = (await flow.post(removal_url(tournament, victim), json={"kind": "withdrawn"})).json()["plan"]
    assert plan["mode"] == "annulled" and "2 von 5" in plan["summary"]
    response = await flow.post(removal_url(tournament, victim), json={"kind": "withdrawn", "plan_id": plan["id"]})
    assert response.status_code == 200, response.text
    rows = (await flow.get(f"/api/tournaments/{tournament['id']}/standings")).json()
    assert victim["id"] not in [row["registration_id"] for row in rows]
    assert all(row["played"] == 0 for row in rows), "annullierte Spiele zählen für niemanden"
    stored_tournament = await stored(flow, tournament)
    cancelled = [m for m in await flow.matches(tournament) if m["status"] == "cancelled"]
    assert len(cancelled) == 5
    writes = schedule_writes(stored_tournament, await flow.matches(tournament), [])
    assert not any(write["match_id"] in {m["id"] for m in cancelled} for write in writes), "der Spieltag-Lauf terminiert sie nicht mehr"
    assert (await registration(flow, victim))["removal"]["mode"] == "annulled"


@pytest.mark.asyncio
async def test_league_withdrawal_after_three_matchdays_keeps_the_player_with_forfeits(flow):
    tournament, regs, _staff = await bracket(flow, 6, fmt="round_robin", stage_type="round_robin_groups", settings={"group_count": 1})
    matches = await flow.matches(tournament)
    victim = regs[0]
    mine = sorted((m for m in matches if victim["id"] in filled(m)), key=lambda m: (m["round"], m["order"]))
    for match in mine[:3]:
        await play(flow, match, [victim["id"], *[r for r in filled(match) if r != victim["id"]]])
    plan = (await flow.post(removal_url(tournament, victim), json={"kind": "disqualified"})).json()["plan"]
    assert plan["mode"] == "forfeit" and [op["kind"] for op in plan["ops"]] == ["forfeit", "forfeit"]
    assert (await flow.post(removal_url(tournament, victim), json={"kind": "disqualified", "plan_id": plan["id"]})).status_code == 200
    rows = {row["registration_id"]: row for row in (await flow.get(f"/api/tournaments/{tournament['id']}/standings")).json()}
    assert rows[victim["id"]]["played"] == 5 and rows[victim["id"]]["won"] == 3 and rows[victim["id"]]["lost"] == 2
    assert (await audit_actions(flow, tournament)).count("match.forfeit") == 2
    reports = await flow.db.match_reports_v2.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)
    assert len([r for r in reports if r.get("note") == "Disqualifikation"]) == 2


# ---------------------------------------------------------------------------------------------- Korrektur (Ziel 4)

@pytest.mark.asyncio
async def test_correction_waits_for_a_held_result_downstream_and_then_frees_the_reset_match(flow):
    tournament, regs, staff = await bracket(flow, 4)
    keys = await by_key(flow, tournament)
    a_first, a_second = filled(keys["A"])
    b_first, b_second = filled(keys["B"])
    await play(flow, keys["A"], [a_first, a_second])
    await play(flow, keys["B"], [b_first, b_second])
    keys = await by_key(flow, tournament)
    assert set(filled(keys["C"])) == {a_first, b_first}
    station = await station_for(flow, keys["C"])
    # Im Finale liegt ein Ergebnis für „Rückgängig“ bereit: die Korrektur von A wartet (409).
    held = await flow.post(f"/api/matches/{keys['C']['id']}/result", json={
        "results": [{"registration_id": a_first, "rank": 1}, {"registration_id": b_first, "rank": 2}], "hold": True})
    assert held.status_code == 200, held.text
    correction = {"results": [{"registration_id": a_second, "rank": 1}, {"registration_id": a_first, "rank": 2}], "reason": "Falsch eingetragen"}
    blocked = await flow.post(f"/api/matches/{keys['A']['id']}/result?force=true", json=correction)
    assert blocked.status_code == 409, blocked.text
    # Veröffentlicht: das Finale ist entschieden. Jetzt greift die Korrektur mit Kaskade.
    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(seconds=30)) == 1
    keys = await by_key(flow, tournament)
    assert keys["C"]["status"] == "completed"
    corrected = await flow.post(f"/api/matches/{keys['A']['id']}/result?force=true", json=correction)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["reset_match_ids"] == [keys["C"]["id"]]
    keys = await by_key(flow, tournament)
    assert keys["C"]["status"] == "ready" and set(filled(keys["C"])) == {a_second, b_first}
    assert not keys["C"].get("called_at")
    freed = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    assert freed["status"] == "free" and freed["current_match_id"] is None, "Station des zurückgesetzten Folgespiels ist frei"
    # Die Spieler des zurückgesetzten Finales erfahren es - auch der, der nicht mehr drinsteht.
    informed = await flow.db.notifications.find({"kind": "match_result", "meta.reason": "pairing_changed"}, {"_id": 0}).to_list(20)
    users_informed = {row["user_id"] for row in informed}
    first_user = next(reg["user_id"] for reg in regs if reg["id"] == a_first)
    b_user = next(reg["user_id"] for reg in regs if reg["id"] == b_first)
    assert {first_user, b_user} <= users_informed
    assert events_of("result_corrected", tournament)
    assert events_of("result_corrected", tournament)[-1]["tournament_event"]["match_ids"] == [keys["A"]["id"]]


# ---------------------------------------------------------------------------------------------- Nacheinander

@pytest.mark.asyncio
async def test_two_removals_in_a_row_leave_a_valid_bracket(flow):
    from services.competition_graph_validation import validate_competition_graph
    from services.competition_snapshot import build_structure_snapshot

    tournament, regs, _staff = await bracket(flow, 8, fmt="double_elim", stage_type="double_elimination")
    keys = await by_key(flow, tournament)
    for key in ("A", "B"):
        await play(flow, keys[key], filled(keys[key]))
    for victim in (regs[0], regs[1]):
        plan = (await flow.post(removal_url(tournament, victim), json={"kind": "withdrawn"})).json()["plan"]
        response = await flow.post(removal_url(tournament, victim), json={"kind": "withdrawn", "plan_id": plan["id"], "reason": "Krank"})
        assert response.status_code == 200, response.text
        assert (await registration(flow, victim))["removal"]["reason"] == "Krank", "der Grund aus dem Bestätigen zählt"
    matches = await flow.matches(tournament)
    gone = {regs[0]["id"], regs[1]["id"]}
    assert all(not (gone & set(filled(m))) for m in matches if m["status"] not in {"completed", "forfeit", "cancelled"})
    report = validate_competition_graph(build_structure_snapshot(tournament["id"], stage_matches=matches))
    assert report["valid"], report["issues"]
    lb_seated = {reg for m in matches if str(m.get("section")).upper() == "LB" for reg in filled(m)}
    assert not (gone & lb_seated), "kein Loser-Bracket-Eintrag nach Austritt"
    assert (await audit_actions(flow, tournament)).count("tournament.participant.withdrawn") == 2
