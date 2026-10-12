"""Ergebnisse am Handy (#1156): die Turnierleitung trägt ein, 10 Sekunden „Rückgängig“, erst dann geht es raus.

Geprüft wird mit echten Routen und erfundenen Konten: verzögertes Veröffentlichen (kein Baum-Fortschritt, keine
Nachricht, öffentlich nichts zu sehen), Rückgängig im Fenster und danach (samt Weiterrücken im Baum oder mit Satz
abgelehnt), Korrektur nur mit Grund im Protokoll, „Nicht erschienen“ als Wertung, Rechte je Rolle und die Ansicht
„Turnierleitung“ (zuerst, was fehlt, dann nach Station).
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
from services.match_v2_results import normalize_v2_results  # noqa: E402
from services.result_hold import publish_due_holds  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def bracket(flow, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, result_entry_mode="staff_only", **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    match = matches[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, first, second, player


def held(winner: str, loser: str, score=(2, 1), **extra) -> dict:
    return {"hold": True, "results": [{"registration_id": winner, "score": score[0]}, {"registration_id": loser, "score": score[1]}], **extra}


async def later(flow, seconds: int) -> int:
    return await publish_due_holds(flow.db, now=now_utc() + timedelta(seconds=seconds))


async def notes(flow, kind: str) -> list[dict]:
    return await flow.db.notifications.find({"kind": kind}, {"_id": 0}).to_list(200)


async def actions(flow, action: str) -> list[dict]:
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
async def test_result_is_held_ten_seconds_before_bracket_tv_and_messages(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    saved = await flow.post(f"/api/matches/{match['id']}/result", json=held(first, second))
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["held"] is True and body["hold"]["undo_seconds"] == 10 and body["hold"]["mine"] is True

    waiting = await flow.reload(match)
    assert waiting["status"] != "completed" and not waiting.get("results"), "noch nichts entschieden"
    follow_up = [row for row in await flow.matches(tournament) if row["id"] != match["id"] and any(
        (slot.get("source_result") or {}).get("from_match_id") == match["id"] for slot in row.get("slots") or [])]
    assert follow_up == [], "der Baum rückt erst nach den 10 Sekunden weiter"
    assert await notes(flow, "match_result") == []

    # Öffentlich (und für die Spieler) ist nichts zu sehen - auch nicht das bereitliegende Ergebnis.
    flow.act_as(player[first])
    public = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert "pending_result" not in public["match"] and public["result_entry"] is None

    assert await later(flow, 5) == 0, "vor Ablauf bleibt es liegen"
    assert await later(flow, 13) == 1
    done = await flow.reload(match)
    assert done["status"] == "completed" and "pending_result" not in done
    assert done["result_meta"]["hold_id"] == body["hold"]["id"]
    nxt = await flow.match_for(tournament, first, after_round=match["round"])
    assert nxt is not None, "jetzt rückt der Sieger weiter"
    told = {row["user_id"] for row in await notes(flow, "match_result")}
    assert told == {player[first]["id"], player[second]["id"]}
    audit = await actions(flow, "match.result.submit")
    assert audit and audit[0]["data"]["held"] is True and audit[0]["actor_id"] == staff["id"]
    assert len(await actions(flow, "match.result.hold")) == 1


@pytest.mark.asyncio
async def test_undo_in_the_window_leaves_nothing_and_a_new_entry_works(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    saved = (await flow.post(f"/api/matches/{match['id']}/result", json=held(first, second))).json()
    undone = await flow.post(f"/api/matches/{match['id']}/result/undo", json={"hold_id": saved["hold"]["id"]})
    assert undone.status_code == 200, undone.text
    assert undone.json() == {"ok": True, "undone": True, "held": True}
    assert await later(flow, 30) == 0
    stored = await flow.reload(match)
    assert "pending_result" not in stored and stored["status"] != "completed"
    assert await notes(flow, "match_result") == []
    undo_rows = await actions(flow, "match.result.undo")
    assert len(undo_rows) == 1 and undo_rows[0]["data"]["held"] is True

    # Erneut eintragen - diesmal andersherum.
    again = await flow.post(f"/api/matches/{match['id']}/result", json=held(second, first, (2, 0)))
    assert again.status_code == 200, again.text
    assert await later(flow, 13) == 1
    assert (await flow.match_for(tournament, second, after_round=match["round"])) is not None


@pytest.mark.asyncio
async def test_late_undo_takes_back_the_advancement(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    saved = (await flow.post(f"/api/matches/{match['id']}/result", json=held(first, second))).json()
    assert await later(flow, 13) == 1
    nxt = await flow.match_for(tournament, first, after_round=match["round"])
    assert nxt is not None

    undone = await flow.post(f"/api/matches/{match['id']}/result/undo", json={"hold_id": saved["hold"]["id"]})
    assert undone.status_code == 200, undone.text
    assert undone.json()["held"] is False and undone.json()["cleared_matches"] == [nxt["id"]]
    reopened = await flow.reload(match)
    assert reopened["status"] not in {"completed", "forfeit"} and reopened["results"] == []
    cleared = await flow.reload(nxt)
    assert first not in {slot.get("registration_id") for slot in cleared["slots"]}, "das Weiterrücken ist zurückgenommen"
    taken_back = [row for row in await notes(flow, "match_result") if row["title"] == "Ergebnis zurückgenommen"]
    assert {row["user_id"] for row in taken_back} == {player[first]["id"], player[second]["id"]}
    audit = [row for row in await actions(flow, "match.result.undo") if row["data"]["held"] is False]
    assert audit and audit[0]["data"]["cleared_matches"] == [nxt["id"]]


@pytest.mark.asyncio
async def test_undo_is_refused_with_a_sentence_once_the_next_match_started(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    saved = (await flow.post(f"/api/matches/{match['id']}/result", json=held(first, second))).json()
    assert await later(flow, 13) == 1
    nxt = await flow.match_for(tournament, first, after_round=match["round"])
    await flow.db.matches_v2.update_one({"id": nxt["id"]}, {"$set": {"status": "in_progress"}})
    refused = await flow.post(f"/api/matches/{match['id']}/result/undo", json={"hold_id": saved["hold"]["id"]})
    assert refused.status_code == 409
    assert "hat schon begonnen" in refused.json()["detail"] and "Korrigieren" in refused.json()["detail"]
    assert (await flow.reload(match))["status"] == "completed"

    # Nur der letzte Eintrag: eine fremde Kennung zählt nicht.
    await flow.db.matches_v2.update_one({"id": nxt["id"]}, {"$set": {"status": "pending"}})
    wrong = await flow.post(f"/api/matches/{match['id']}/result/undo", json={"hold_id": "etwas-anderes"})
    assert wrong.status_code == 409 and "letzten Eintrag" in wrong.json()["detail"]


@pytest.mark.asyncio
async def test_correction_needs_a_reason_and_lands_in_the_log(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    await flow.post(f"/api/matches/{match['id']}/result", json=held(first, second))
    assert await later(flow, 13) == 1

    plain = await flow.post(f"/api/matches/{match['id']}/result", json=held(second, first, (3, 0)))
    assert plain.status_code == 409 and "Grund" in plain.json()["detail"]
    no_reason = await flow.post(f"/api/matches/{match['id']}/result?force=true", json=held(second, first, (3, 0)))
    assert no_reason.status_code == 422
    corrected = await flow.post(f"/api/matches/{match['id']}/result?force=true",
                                json=held(second, first, (3, 0), reason="Stand falsch abgelesen"))
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["hold"]["correction"] is True
    assert await later(flow, 13) == 1
    stored = await flow.reload(match)
    assert stored["result_meta"]["correction_reason"] == "Stand falsch abgelesen"
    assert {row["registration_id"]: row["rank"] for row in stored["results"]} == {second: 1, first: 2}
    logged = [row for row in await actions(flow, "match.result.submit") if row["data"].get("force")]
    assert logged and logged[0]["data"]["reason"] == "Stand falsch abgelesen"
    assert any(row["title"] == "Ergebnis korrigiert" for row in await notes(flow, "match_result"))

    # Der Grund ist intern: öffentlich steht er nicht an der Matchseite.
    flow.act_as(player[first])
    public = (await flow.get(f"/api/matches/{match['id']}/page")).json()
    assert "correction_reason" not in (public["match"].get("result_meta") or {})


@pytest.mark.asyncio
async def test_no_show_in_a_duel_is_a_forfeit_with_a_reason(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    payload = {"hold": True, "results": [{"registration_id": first}, {"registration_id": second, "forfeit": True}]}
    saved = await flow.post(f"/api/matches/{match['id']}/result", json=payload)
    assert saved.status_code == 200, saved.text
    assert await later(flow, 13) == 1
    stored = await flow.reload(match)
    assert stored["status"] == "forfeit" and stored["forfeit_registration_id"] == second
    assert stored["admin_decision_note"] == "Nicht erschienen", "die betroffene Person sieht den Grund"
    assert (await flow.match_for(tournament, first, after_round=match["round"])) is not None, "der Baum rückt weiter"


@pytest.mark.asyncio
async def test_rights_per_role(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    other_station = new_id()

    async def helper(role: str, scope: str = "tournament", scope_id: str | None = None) -> dict:
        user = await flow.add_user(name=f"Helfer {role}")
        await flow.db.tournament_staff_assignments.insert_one({
            "id": new_id(), "tournament_id": tournament["id"], "user_id": user["id"], "role": role,
            "scope": scope, "scope_id": scope_id, "is_active": True})
        return user

    moderator = await flow.add_user(role="moderator", name="Moderation")
    for outsider in (player[first], moderator, await helper("stream_operator"), await helper("station_manager", "station", other_station)):
        flow.act_as(outsider)
        denied = await flow.post(f"/api/matches/{match['id']}/result", json=held(first, second))
        assert denied.status_code == 403, outsider["display_name"]

    flow.act_as(await helper("scorekeeper"))
    saved = await flow.post(f"/api/matches/{match['id']}/result", json=held(first, second))
    assert saved.status_code == 200, saved.text

    # Rückgängig nur mit Ergebnis-Recht.
    flow.act_as(player[second])
    assert (await flow.post(f"/api/matches/{match['id']}/result/undo", json={})).status_code == 403
    # Solange das Ergebnis bereitliegt, nimmt das Spiel nichts anderes an.
    flow.act_as(staff)
    busy = await flow.post(f"/api/matches/{match['id']}/result", json={"results": held(second, first)["results"]})
    assert busy.status_code == 409


@pytest.mark.asyncio
async def test_lead_view_shows_what_is_missing_first_then_by_station(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    other = matches[1]
    station = {"id": new_id(), "name": "PC 3", "device_type": "pc", "tournament_id": tournament["id"], "status": "busy"}
    await flow.db.stations.insert_one(dict(station))
    long_ago = (now_utc() - timedelta(minutes=50)).isoformat()
    await flow.db.matches_v2.update_one({"id": other["id"]}, {"$set": {"scheduled_at": long_ago, "duration_minutes": 30}})
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": station["id"]}})

    view = await flow.get(f"/api/tournaments/{tournament['slug']}/lead")
    assert view.status_code == 200, view.text
    data = view.json()
    ids = [row["id"] for row in data["matches"]]
    assert ids[:2] == [other["id"], match["id"]], "zuerst, was fehlt - dann nach Station"
    assert data["matches"][0]["timing"]["missing"] is True and data["matches"][0]["timing"]["overdue_minutes"] >= 15
    assert data["matches"][1]["station_text"].startswith("PC 3") and data["matches"][1]["timing"]["missing"] is False
    entry = data["matches"][1]
    assert entry["kind"] == "duel" and {row["registration_id"] for row in entry["participants"]} == {first, second}
    assert entry["advance"]["1"]["text"].startswith("ins "), "wohin der Sieger weiterrückt"
    assert data["counts"]["missing"] == 1

    flow.act_as(player[first])
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}/lead")).status_code == 403
    crew = await flow.add_user(name="Crew")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": crew["id"], "role": "station_manager",
        "scope": "station", "scope_id": station["id"], "is_active": True})
    flow.act_as(crew)
    crew_view = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()
    allowed = {row["id"]: row["can_enter"] for row in crew_view["matches"]}
    assert allowed[match["id"]] is True and allowed[other["id"]] is False, "nur die eigene Station"


def test_places_with_no_show_keep_the_finishing_order_even_where_draws_are_allowed():
    match = {"section": "group_a", "slots": [{"slot": index, "status": "filled", "registration_id": reg} for index, reg in enumerate("abcd", start=1)]}
    rows = normalize_v2_results(match, [
        {"registration_id": "c", "rank": 1}, {"registration_id": "a", "rank": 2},
        {"registration_id": "d", "rank": 3}, {"registration_id": "b", "rank": 4, "forfeit": True},
    ])
    assert [(row["registration_id"], row["rank"]) for row in rows] == [("c", 1), ("a", 2), ("d", 3), ("b", 4)]
