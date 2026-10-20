"""„Nicht erschienen“ in einem Lauf mit mehreren Spielern (#1823).

Im Duell ist „nicht erschienen“ eine Wertung: der Gegner gewinnt kampflos (unverändert, test_match_deadlines_flow). In
einem Lauf zu viert nimmt es nur die fehlende Person heraus: der Lauf bleibt offen, die Anwesenden fahren ihn und die
Turnierleitung trägt ihre Plätze ein - wer fehlt, steht danach als „nicht erschienen“ auf dem letzten Platz. Keine
Wertung nach Sitzreihenfolge. Das gilt für jeden Weg: Vorschlag nach der Frist, Forfeit-Weg der Turnierleitung,
Ergebnis mit „Rückgängig“ und Austritt während des Laufs.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
import badges  # noqa: E402
from models import now_utc  # noqa: E402
from services import scheduler  # noqa: E402
from services.achievement_core import NEGATIVE_INCIDENTS  # noqa: E402
from services.match_deadline_sweep import sweep  # noqa: E402
from services.result_hold import publish_due_holds  # noqa: E402

# Zwei Läufe zu viert, die zwei Besten ins Finale, Platz 3 und 4 ins Loser Bracket (wie der Läufe-Cup im Seed).
SCHEME = """[WB]
A=[1,2,3,4]
B=[5,6,7,8]
F=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
LA=[L:A:1,L:A:2,L:B:1,L:B:2]
"""


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        await no_show_catalog(instance)
        yield instance
    finally:
        await shutdown()


async def no_show_catalog(flow) -> None:
    """Der Eintrag „nicht erschienen“ ist ein Erfolg mit Minus - dafür braucht es seine Stufe aus dem Katalog."""
    tier = next(row for row in badges.ACHIEVEMENT_TIERS if row["code"] == NEGATIVE_INCIDENTS["no_show"])
    group = next(row for row in badges.ACHIEVEMENT_GROUPS if row["code"] == tier["group_code"])
    await flow.db.achievement_groups.insert_one({**group, "id": group["code"]})
    await flow.db.achievements.insert_one({**tier, "id": tier["code"]})


def ago(minutes: float) -> str:
    return (now_utc() - timedelta(minutes=minutes)).isoformat()


async def heats_cup(flow) -> tuple[dict, dict, dict]:
    """Ein Läufe-Cup vor Ort mit acht Spielern, live, Lauf A aufgerufen und die Frist „nicht erschienen“ um."""
    tournament, users, registrations = await flow.with_participants(
        8, format="ffa_custom_bracket", event_mode="local", status="registration_open")
    await flow.db.tournament_stages.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "number": 1, "name": "Läufe",
        "stage_type": "ffa_custom_bracket", "match_type": "ffa", "status": "pending",
        "settings": {"schema": SCHEME, "match_size": 4, "qualifiers_per_match": 2, "min_players": 2},
        "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
    })
    staff = await flow.add_staff()
    flow.act_as(staff)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "check_in"})
    assert response.status_code == 200, response.text
    await flow.db.tournament_registrations.update_many({"tournament_id": tournament["id"]}, {"$set": {"status": "checked_in"}})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {
        "check_in_until": (now_utc() - timedelta(minutes=1)).isoformat()}})
    await scheduler._safe_status_transitions()
    await flow.start(tournament)
    heat = (await by_key(flow, tournament))["A"]
    await flow.db.matches_v2.update_one({"id": heat["id"]}, {"$set": {"station_id": "station-1", "called_at": ago(12)}})
    user_of = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return tournament, await flow.reload(heat), user_of


async def by_key(flow, tournament: dict) -> dict[str, dict]:
    return {match["match_key"]: match for match in await flow.matches(tournament)}


def seats(match: dict) -> list[str]:
    """Die Anmeldungen eines Laufs nach Sitzplatz."""
    ordered = sorted(match["slots"], key=lambda slot: slot["slot"])
    return [slot["registration_id"] for slot in ordered if slot.get("registration_id")]


def from_heat(target: dict, heat: dict) -> dict[int, str]:
    """Wer aus diesem Lauf in ``target`` sitzt - je Platz im Lauf."""
    return {
        int(slot["source_result"]["rank"]): slot["registration_id"]
        for slot in target["slots"]
        if (slot.get("source_result") or {}).get("from_match_id") == heat["id"] and slot.get("registration_id")
    }


async def confirm_no_show(flow, tournament: dict, heat: dict, registration_id: str):
    assert (await sweep(flow.db))["proposed"] == 1
    return await flow.post(f"/api/tournaments/{tournament['id']}/lead/no-show/{heat['id']}",
                           json={"action": "confirm", "registration_id": registration_id})


async def incidents(flow, user: dict, heat: dict) -> int:
    return await flow.db.user_achievements.count_documents({
        "user_id": user["id"], "tier_code": NEGATIVE_INCIDENTS["no_show"], "context.match_id": heat["id"]})


@pytest.mark.asyncio
async def test_no_show_in_a_heat_marks_only_that_person_and_the_heat_stays_open(flow):
    tournament, heat, user_of = await heats_cup(flow)
    first, missing, third, fourth = seats(heat)

    confirmed = await confirm_no_show(flow, tournament, heat, missing)
    assert confirmed.status_code == 200, confirmed.text

    stored = await flow.reload(heat)
    assert stored["status"] in {"ready", "scheduled"}, "der Lauf ist nicht beendet, er wartet auf das Ergebnis"
    assert stored.get("results") in (None, []), "keine Wertung nach Sitzreihenfolge"
    assert stored["no_show_registration_ids"] == [missing]
    assert stored.get("forfeit_registration_id") is None
    assert not stored["no_show_proposal"].get("decision"), "im Lauf gilt der Vorschlag je Person - er bleibt offen"
    after = await by_key(flow, tournament)
    assert from_heat(after["F"], heat) == {} and from_heat(after["LA"], heat) == {}, "niemand rückt ohne Lauf weiter"
    assert await flow.db.audit_logs.count_documents({"action": "match.forfeit"}) == 0
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.marked"}) == 1
    assert await incidents(flow, user_of[missing], heat) == 1, "der Eintrag „nicht erschienen“ gilt der fehlenden Person"
    # Die Rückmeldung der Turnierleitung richtet sich nach dem Stand - auch bei einem zweiten Tipp.
    assert confirmed.json()["status"] == stored["status"]
    again = await flow.post(f"/api/tournaments/{tournament['id']}/lead/no-show/{heat['id']}",
                            json={"action": "confirm", "registration_id": missing})
    assert again.json()["idempotent_replay"] is True and again.json()["status"] == stored["status"]

    lead = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    case = next(row for row in lead["attention"] if row["kind"] == "no_show")
    assert {row["registration_id"] for row in case["participants"]} == {first, third, fourth}, "nur noch, wer nicht markiert ist"
    entry = next(row for row in lead["matches"] if row["id"] == heat["id"])
    assert {row["registration_id"]: bool(row.get("no_show")) for row in entry["participants"]} == {
        first: False, missing: True, third: False, fourth: False}, "das Ergebnis-Fenster zeigt die Person als nicht erschienen"


@pytest.mark.asyncio
async def test_case_and_message_say_the_heat_stays_open(flow):
    """Im Lauf heißt der Vorschlag nicht „kampflos werten“: Karte und Nachricht sagen, dass der Lauf offen bleibt."""
    tournament, _heat, _user_of = await heats_cup(flow)
    assert (await sweep(flow.db))["proposed"] == 1
    item = next(row for row in (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()["attention"]
                if row["kind"] == "no_show")
    assert "Lauf bleibt offen" in item["detail"] and "kampflos" not in item["detail"]
    note = await flow.db.notifications.find_one({"kind": "match_attention", "meta.reason": "no_show"}, {"_id": 0})
    assert "Lauf bleibt offen" in note["body"] and "ampflos" not in note["body"]


@pytest.mark.asyncio
async def test_two_missing_are_marked_one_after_the_other_after_the_deadline(flow):
    """Die Frist gilt je Person: nach der ersten Bestätigung bleibt der Vorschlag für alle anderen offen, die zweite
    markiert die zweite Person. Idempotent ist nur dieselbe Person noch einmal."""
    tournament, heat, user_of = await heats_cup(flow)
    first, second, third, fourth = seats(heat)
    url = f"/api/tournaments/{tournament['id']}/lead/no-show/{heat['id']}"
    schedule_url = f"/api/tournaments/{tournament['id']}/schedule/deadlines"

    def due(schedule: dict) -> str | None:
        return next(row.get("no_show_due_at") for row in schedule["matches"] if row["match_id"] == heat["id"])

    assert (await sweep(flow.db))["proposed"] == 1
    one = await flow.post(url, json={"action": "confirm", "registration_id": fourth})
    assert one.status_code == 200 and one.json()["idempotent_replay"] is False, one.text
    assert due((await flow.get(schedule_url)).json()), "für die anderen läuft die Frist weiter"
    assert (await sweep(flow.db))["proposed"] == 0, "der offene Vorschlag reicht - keine zweite Nachricht"
    two = await flow.post(url, json={"action": "confirm", "registration_id": second})
    assert two.status_code == 200 and two.json()["idempotent_replay"] is False, two.text
    again = await flow.post(url, json={"action": "confirm", "registration_id": fourth})
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True

    stored = await flow.reload(heat)
    assert stored["status"] in {"ready", "scheduled"} and stored.get("results") in (None, [])
    assert set(stored["no_show_registration_ids"]) == {second, fourth}
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.marked"}) == 2
    assert await incidents(flow, user_of[second], heat) == 1 and await incidents(flow, user_of[fourth], heat) == 1
    case = next(row for row in (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()["attention"]
                if row["kind"] == "no_show")
    assert {row["registration_id"] for row in case["participants"]} == {first, third}


@pytest.mark.asyncio
async def test_the_result_window_marks_no_shows_and_records_their_entries(flow):
    """Ohne Vorschlag, nur im Ergebnis-Fenster „Nicht erschienen“ gesetzt: dieselbe Markierung und derselbe Eintrag
    „nicht erschienen“ je Person wie über die Turnierleitung."""
    tournament, heat, user_of = await heats_cup(flow)
    first, second, third, fourth = seats(heat)
    response = await flow.post(f"/api/matches/{heat['id']}/result", json={"results": [
        {"registration_id": third, "rank": 1}, {"registration_id": first, "rank": 2},
        {"registration_id": second, "rank": 3, "forfeit": True}, {"registration_id": fourth, "rank": 4, "forfeit": True}]})
    assert response.status_code == 200, response.text

    stored = await flow.reload(heat)
    assert set(stored["no_show_registration_ids"]) == {second, fourth}
    assert all("Nicht erschienen" in (row.get("note") or "") for row in stored["results"] if row["forfeit"])
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.marked"}) == 2
    assert await incidents(flow, user_of[second], heat) == 1 and await incidents(flow, user_of[fourth], heat) == 1


@pytest.mark.asyncio
async def test_deadline_and_result_window_mixed_mark_each_person_once(flow):
    """Gemischt: eine Person nach der Frist bestätigt, die zweite erst im Ergebnis-Fenster - beide markiert, jeder
    Eintrag einmal."""
    tournament, heat, user_of = await heats_cup(flow)
    first, second, third, fourth = seats(heat)
    assert (await confirm_no_show(flow, tournament, heat, fourth)).status_code == 200
    response = await flow.post(f"/api/matches/{heat['id']}/result", json={"results": [
        {"registration_id": first, "rank": 1}, {"registration_id": third, "rank": 2},
        {"registration_id": second, "rank": 3, "forfeit": True}]})
    assert response.status_code == 200, response.text

    stored = await flow.reload(heat)
    assert set(stored["no_show_registration_ids"]) == {second, fourth}
    assert {row["registration_id"] for row in stored["results"] if row["forfeit"]} == {second, fourth}
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.marked"}) == 2
    assert await incidents(flow, user_of[second], heat) == 1 and await incidents(flow, user_of[fourth], heat) == 1


@pytest.mark.asyncio
async def test_the_present_three_are_entered_and_the_best_two_advance(flow):
    tournament, heat, _user_of = await heats_cup(flow)
    first, missing, third, fourth = seats(heat)
    assert (await confirm_no_show(flow, tournament, heat, missing)).status_code == 200

    response = await flow.post(f"/api/matches/{heat['id']}/result", json={"results": [
        {"registration_id": fourth, "rank": 1}, {"registration_id": third, "rank": 2}, {"registration_id": first, "rank": 3}]})
    assert response.status_code == 200, response.text

    stored = await flow.reload(heat)
    assert stored["status"] == "completed"
    assert [(row["registration_id"], row["rank"], row["forfeit"]) for row in stored["results"]] == [
        (fourth, 1, False), (third, 2, False), (first, 3, False), (missing, 4, True)]
    assert "Nicht erschienen" in (stored["results"][-1].get("note") or ""), "die Begründung steht an der Zeile"
    after = await by_key(flow, tournament)
    assert from_heat(after["F"], heat) == {1: fourth, 2: third}, "die zwei Besten der drei Anwesenden kommen weiter"
    assert from_heat(after["LA"], heat) == {3: first, 4: missing}


@pytest.mark.asyncio
async def test_a_late_arrival_can_still_be_ranked_and_loses_the_entry(flow):
    tournament, heat, user_of = await heats_cup(flow)
    first, missing, third, fourth = seats(heat)
    assert (await confirm_no_show(flow, tournament, heat, missing)).status_code == 200

    response = await flow.post(f"/api/matches/{heat['id']}/result", json={"results": [
        {"registration_id": fourth, "rank": 1}, {"registration_id": missing, "rank": 2},
        {"registration_id": third, "rank": 3}, {"registration_id": first, "rank": 4}]})
    assert response.status_code == 200, response.text

    stored = await flow.reload(heat)
    assert not any(row["forfeit"] for row in stored["results"])
    assert stored.get("no_show_registration_ids") in (None, []), "wer mitgefahren ist, ist erschienen"
    assert await incidents(flow, user_of[missing], heat) == 0
    assert from_heat((await by_key(flow, tournament))["F"], heat) == {1: fourth, 2: missing}


@pytest.mark.asyncio
async def test_the_forfeit_route_marks_in_a_heat_too_and_repeats_idempotently(flow):
    tournament, heat, _user_of = await heats_cup(flow)
    _first, _second, missing, _fourth = seats(heat)

    response = await flow.post(f"/api/matches/{heat['id']}/forfeit",
                               json={"forfeit_registration_id": missing, "note": "Nicht am Platz"})
    assert response.status_code == 200, response.text
    assert response.json()["idempotent_replay"] is False
    again = await flow.post(f"/api/matches/{heat['id']}/forfeit",
                            json={"forfeit_registration_id": missing, "note": "Nicht am Platz"})
    assert again.status_code == 200 and again.json()["idempotent_replay"] is True

    stored = await flow.reload(heat)
    assert stored["status"] in {"ready", "scheduled"} and stored.get("results") in (None, [])
    assert stored["no_show_registration_ids"] == [missing]
    assert await flow.db.audit_logs.count_documents({"action": "match.no_show.marked"}) == 1


@pytest.mark.asyncio
async def test_undo_after_the_result_reopens_the_heat_with_the_mark(flow):
    tournament, heat, _user_of = await heats_cup(flow)
    first, missing, third, fourth = seats(heat)
    assert (await confirm_no_show(flow, tournament, heat, missing)).status_code == 200

    held = await flow.post(f"/api/matches/{heat['id']}/result", json={"hold": True, "results": [
        {"registration_id": third, "rank": 1}, {"registration_id": first, "rank": 2},
        {"registration_id": fourth, "rank": 3}, {"registration_id": missing, "rank": 4, "forfeit": True}]})
    assert held.status_code == 200, held.text
    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(seconds=30)) == 1
    assert (await flow.reload(heat))["status"] == "completed"

    undone = await flow.post(f"/api/matches/{heat['id']}/result/undo", json={})
    assert undone.status_code == 200, undone.text
    stored = await flow.reload(heat)
    assert stored["status"] in {"ready", "scheduled"} and stored["results"] == []
    assert stored["no_show_registration_ids"] == [missing], "die Markierung bleibt für das neue Eintragen"
    after = await by_key(flow, tournament)
    assert from_heat(after["F"], heat) == {} and from_heat(after["LA"], heat) == {}



@pytest.mark.asyncio
async def test_a_withdrawal_during_the_heat_keeps_it_open_for_the_others(flow):
    tournament, heat, _user_of = await heats_cup(flow)
    gone, missing, third, fourth = seats(heat)
    plan = (await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{gone}/removal",
                            json={"kind": "withdrawn"})).json()["plan"]
    applied = await flow.post(f"/api/tournaments/{tournament['id']}/registrations/{gone}/removal",
                              json={"kind": "withdrawn", "plan_id": plan["id"]})
    assert applied.status_code == 200, applied.text
    assert (await flow.reload(heat))["status"] in {"ready", "scheduled"}, "der aufgerufene Lauf bleibt, wie er ist"
    # Mit einer ausgetretenen Person im Lauf schlägt die Frist nichts vor (match_deadline_sweep) - die Leitung markiert.
    marked = await flow.post(f"/api/matches/{heat['id']}/forfeit",
                             json={"forfeit_registration_id": missing, "note": "Nicht am Platz"})
    assert marked.status_code == 200, marked.text
    assert (await flow.reload(heat))["status"] in {"ready", "scheduled"}

    response = await flow.post(f"/api/matches/{heat['id']}/result", json={"results": [
        {"registration_id": fourth, "rank": 1}, {"registration_id": gone, "rank": 2}, {"registration_id": third, "rank": 3}]})
    assert response.status_code == 200, response.text
    after = await by_key(flow, tournament)
    # Wer ausgetreten ist, rückt nirgends ein - die anderen rücken auf; wer aufrückt, steht nicht zugleich im Loser
    # Bracket. Wer nicht erschienen ist, kommt nur auf dem Verlierer-Weg weiter (wie im Duell).
    assert set(from_heat(after["F"], heat).values()) == {fourth, third}
    assert set(from_heat(after["LA"], heat).values()) == {missing}
