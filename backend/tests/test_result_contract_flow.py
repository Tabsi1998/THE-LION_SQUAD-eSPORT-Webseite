"""Ergebnis-Vertrag (#1035) über die echten Routen: gleiche Regeln für Ergebnis-Fenster, direktes Eintragen,
Meldung der Spieler und Wertung; Korrektur nur mit Grund; der Stand eines Spiels mit Ergebnis ändert sich nur über die
Ergebnis-Wege; nachvollziehbare Historie, auch wenn eine Korrektur ein Folgespiel zurücksetzt.
"""
import asyncio
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
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
    tournament, users, registrations = await flow.with_participants(4, **{"result_entry_mode": "staff_only", **fields})
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    matches = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))
    match = matches[0]
    first, second = [slot["registration_id"] for slot in match["slots"]]
    player = {reg["id"]: users[index] for index, reg in enumerate(registrations)}
    return staff, tournament, match, first, second, player


def duel(winner, loser, score=(2, 1), **extra):
    return {"results": [{"registration_id": winner, "score": score[0]}, {"registration_id": loser, "score": score[1]}], **extra}


async def raw_post(flow, url, text):
    return await flow.post(url, content=text, headers={"content-type": "application/json"})


async def audit(flow, action):
    return await flow.db.audit_logs.find({"action": action}, {"_id": 0}).to_list(50)


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("score", "NaN"), ("score", "Infinity"), ("points", "1e400"),
                                         ("time_ms", "99999999999999999999999"), ("score", "-1")])
async def test_values_outside_the_contract_are_refused_on_every_entry_path(flow, field, value):
    staff, tournament, match, first, second, player = await bracket(flow)
    body = '{"hold": %s, "results": [{"registration_id": "%s", "%s": %s}, {"registration_id": "%s", "score": 0}]}'
    for hold in ("true", "false"):
        refused = await raw_post(flow, f"/api/matches/{match['id']}/result", body % (hold, first, field, value, second))
        assert refused.status_code == 422, refused.text
    stored = await flow.reload(match)
    assert not stored.get("results") and "pending_result" not in stored


@pytest.mark.asyncio
async def test_player_reports_follow_the_same_rules(flow):
    staff, tournament, match, first, second, player = await bracket(flow, result_entry_mode="player_confirmed", best_of=3)
    flow.act_as(player[first])
    for payload in (duel(first, second, (1, 0)), duel(first, second, (2, 2)), duel(first, second, (3, 1))):
        refused = await flow.post(f"/api/matches/{match['id']}/report", json=payload)
        assert refused.status_code == 422, refused.text
    nan = '{"results": [{"registration_id": "%s", "score": NaN}, {"registration_id": "%s", "score": 0}]}' % (first, second)
    assert (await raw_post(flow, f"/api/matches/{match['id']}/report", nan)).status_code == 422
    assert not (await flow.reload(match)).get("reports")
    accepted = await flow.post(f"/api/matches/{match['id']}/report", json=duel(first, second, (2, 1)))
    assert accepted.status_code == 200, accepted.text


@pytest.mark.asyncio
async def test_staff_entry_checks_best_of_and_knockout_ties_on_both_paths(flow):
    staff, tournament, match, first, second, player = await bracket(flow, best_of=3)
    for hold in (True, False):
        for score in ((1, 0), (2, 2), (3, 0)):
            refused = await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second, score, hold=hold))
            assert refused.status_code == 422, refused.text
    saved = await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second, (2, 0)))
    assert saved.status_code == 200, saved.text


@pytest.mark.asyncio
async def test_a_correction_needs_force_and_a_reason_on_every_path(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    assert (await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second))).status_code == 200

    plain = await flow.post(f"/api/matches/{match['id']}/result", json=duel(second, first))
    assert plain.status_code == 409 and "Grund" in plain.json()["detail"]
    for hold in (True, False):
        no_reason = await flow.post(f"/api/matches/{match['id']}/result?force=true", json=duel(second, first, hold=hold))
        assert no_reason.status_code == 422, no_reason.text
    assert {row["registration_id"]: row["rank"] for row in (await flow.reload(match))["results"]} == {first: 1, second: 2}

    corrected = await flow.post(f"/api/matches/{match['id']}/result?force=true",
                                json=duel(second, first, reason="Stand vertauscht"))
    assert corrected.status_code == 200, corrected.text
    stored = await flow.reload(match)
    assert stored["result_meta"]["correction_reason"] == "Stand vertauscht"

    # Historie: der neue Eintrag sagt, welchen er ersetzt und was vorher galt.
    reports = await flow.db.match_reports_v2.find({"match_id": match["id"]}, {"_id": 0}).sort("created_at", 1).to_list(10)
    assert len(reports) == 2
    assert reports[1]["replaces_report_id"] == reports[0]["id"]
    assert {row["registration_id"]: row["rank"] for row in reports[1]["previous_results"]} == {first: 1, second: 2}
    assert reports[1]["reason"] == "Stand vertauscht"
    logged = [row for row in await audit(flow, "match.result.submit") if row["data"].get("force")]
    assert logged and logged[0]["data"]["replaces_report_id"] == reports[0]["id"]


@pytest.mark.asyncio
async def test_a_result_in_dispute_is_changed_only_as_a_correction(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    assert (await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second))).status_code == 200
    flow.act_as(player[second])
    assert (await flow.post(f"/api/matches/{match['id']}/dispute", json={"reason": "Stand stimmt nicht"})).status_code == 200
    flow.act_as(staff)
    plain = await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second, (2, 0)))
    assert plain.status_code == 409, plain.text
    corrected = await flow.post(f"/api/matches/{match['id']}/result?force=true",
                                json=duel(first, second, (2, 0), reason="Foto zeigt 2:0"))
    assert corrected.status_code == 200, corrected.text
    assert (await flow.reload(match))["status"] == "completed"


@pytest.mark.asyncio
async def test_a_forfeit_correction_counts_its_note_as_reason(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    assert (await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second))).status_code == 200
    plain = await flow.post(f"/api/matches/{match['id']}/forfeit",
                            json={"forfeit_registration_id": first, "note": "Nicht angetreten, Ersatz gespielt"})
    assert plain.status_code == 409, plain.text
    changed = await flow.post(f"/api/matches/{match['id']}/forfeit?force=true",
                              json={"forfeit_registration_id": first, "note": "Nicht angetreten, Ersatz gespielt"})
    assert changed.status_code == 200, changed.text
    stored = await flow.reload(match)
    assert stored["status"] == "forfeit" and stored["result_meta"]["correction_reason"] == "Nicht angetreten, Ersatz gespielt"


@pytest.mark.asyncio
async def test_the_plan_does_not_set_or_leave_a_result_state(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    for status in ("completed", "forfeit", "disputed"):
        refused = await flow.patch(f"/api/matches/{match['id']}", json={"status": status})
        assert refused.status_code == 422, refused.text
    assert (await flow.patch(f"/api/matches/{match['id']}", json={"status": "in_progress"})).status_code == 200

    assert (await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second))).status_code == 200
    reopened = await flow.patch(f"/api/matches/{match['id']}", json={"status": "ready"})
    assert reopened.status_code == 409, reopened.text
    stored = await flow.reload(match)
    assert stored["status"] == "completed"
    # Termin und Station bleiben planbar.
    assert (await flow.patch(f"/api/matches/{match['id']}", json={"duration_minutes": 20})).status_code == 200


@pytest.mark.asyncio
async def test_a_correction_after_the_follow_up_was_played_resets_it_and_keeps_the_history(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    assert (await flow.post(f"/api/matches/{match['id']}/result", json=duel(first, second))).status_code == 200
    other = sorted(await flow.matches(tournament), key=lambda row: (row.get("round") or 0, row.get("match_key") or ""))[1]
    third, fourth = [slot["registration_id"] for slot in other["slots"]]
    assert (await flow.post(f"/api/matches/{other['id']}/result", json=duel(third, fourth))).status_code == 200
    final = await flow.match_for(tournament, first, third, after_round=match["round"])
    assert final is not None
    assert (await flow.post(f"/api/matches/{final['id']}/result", json=duel(first, third))).status_code == 200

    corrected = await flow.post(f"/api/matches/{match['id']}/result?force=true",
                                json=duel(second, first, reason="Stand vertauscht"))
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["reset_match_ids"] == [final["id"]]
    reset = await flow.reload(final)
    assert reset["results"] == [] and reset["status"] not in {"completed", "forfeit"}
    assert second in {slot.get("registration_id") for slot in reset["slots"]}

    logged = [row for row in await audit(flow, "match.result.submit") if row["data"].get("force")]
    assert logged and logged[0]["data"]["reset_matches"] == [final["id"]]
    report = await flow.db.match_reports_v2.find_one({"match_id": match["id"], "force": True}, {"_id": 0})
    assert report["reset_matches"][0]["id"] == final["id"]
    assert {row["registration_id"] for row in report["reset_matches"][0]["results"]} == {first, third}


@pytest.mark.asyncio
async def test_two_entries_at_the_same_time_leave_exactly_one_result(flow):
    staff, tournament, match, first, second, player = await bracket(flow)
    url = f"/api/matches/{match['id']}/result"
    answers = await asyncio.gather(flow.post(url, json=duel(first, second)), flow.post(url, json=duel(second, first)))
    codes = sorted(answer.status_code for answer in answers)
    assert codes == [200, 409], [answer.text for answer in answers]
    stored = await flow.reload(match)
    assert stored["status"] == "completed" and len(stored["results"]) == 2
    assert await flow.db.match_reports_v2.count_documents({"match_id": match["id"]}) == 1

    # Und zwei Ergebnis-Fenster gleichzeitig: eines liegt bereit, das andere wartet.
    staff2, tournament2, match2, first2, second2, _player2 = await bracket(flow)
    url2 = f"/api/matches/{match2['id']}/result"
    answers = await asyncio.gather(flow.post(url2, json=duel(first2, second2, hold=True)),
                                   flow.post(url2, json=duel(second2, first2, hold=True)))
    assert sorted(answer.status_code for answer in answers) == [200, 409]
    assert await publish_due_holds(flow.db, now=now_utc() + timedelta(seconds=13)) == 1
    assert (await flow.reload(match2))["status"] == "completed"
