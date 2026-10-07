"""Spielseiten: Internes sieht nur die Turnierleitung.

Notizen der Turnierleitung, Begründungen ihrer Entscheidungen, wer ein Ergebnis eingetragen hat, Konto-Kennungen,
Einsprüche mit Begründung und die einzelnen Meldungen gehören nicht auf die öffentliche Spielseite. Wer selbst
gemeldet oder widersprochen hat, sieht seine eigene Meldung und seinen Einspruch; die Zahl bleibt für alle sichtbar.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services.match_public_view import public_match_view  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def match_with_internals(flow):
    """Ein laufendes Turnier, in dessen erstem Spiel Internes steht - so, wie es die Abläufe hineinschreiben."""
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    match = await flow.db.matches_v2.find_one({"tournament_id": tournament["id"], "slots.1.registration_id": {"$ne": None}}, {"_id": 0})
    reg_ids = [slot.get("registration_id") for slot in match["slots"][:2]]
    owners = {reg["id"]: reg.get("user_id") for reg in registrations}
    first, second = (next(user for user in users if user["id"] == owners[reg_id]) for reg_id in reg_ids)
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "admin_note": "Interne Notiz",
        "admin_decision_note": "Begründung der Turnierleitung",
        "admin_decision_by": staff["id"],
        "completed_by": staff["id"],
        "result_meta": {"note": "Notiz zum Ergebnis", "confirmed_by": staff["id"], "proof_url": "https://example.org/beweis.png"},
        "results": [
            {"registration_id": reg_ids[0], "user_id": first["id"], "rank": 1, "score": 3, "note": "Zeilen-Notiz"},
            {"registration_id": reg_ids[1], "user_id": second["id"], "rank": 2, "score": 1, "note": None},
        ],
        "reports": [
            {"user_id": first["id"], "registration_id": reg_ids[0], "results": [{"registration_id": reg_ids[0], "rank": 1}], "at": "2026-10-07T12:00:00+00:00"},
            {"user_id": second["id"], "registration_id": reg_ids[1], "results": [{"registration_id": reg_ids[1], "rank": 1}], "at": "2026-10-07T12:01:00+00:00"},
        ],
        "disputes": [
            {"user_id": first["id"], "reason": "Mein eigener Grund", "at": "2026-10-07T12:02:00+00:00"},
            {"user_id": second["id"], "reason": "Grund der Gegenseite", "at": "2026-10-07T12:03:00+00:00"},
        ],
    }})
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"billing": {"account": "intern-4711", "positions": []}}})
    return staff, tournament, match["id"], first, second


def assert_public(match, own_id=None):
    for key in ("admin_note", "admin_decision_note", "admin_decision_by", "completed_by"):
        assert key not in match, key
    assert match["result_meta"] == {"proof_url": "https://example.org/beweis.png"}
    assert all("user_id" not in row and "note" not in row for row in match["results"])
    assert [row["rank"] for row in match["results"]] == [1, 2]
    assert len(match["reports"]) == 2 and len(match["disputes"]) == 2, "die Zahl bleibt sichtbar"
    for row in match["reports"] + match["disputes"]:
        if own_id and row.get("user_id") == own_id:
            continue
        assert set(row) <= {"registration_id", "at"}, row
    text = str(match)
    assert "Interne Notiz" not in text and "Grund der Gegenseite" not in text


@pytest.mark.asyncio
async def test_anonymous_visitors_get_only_public_match_fields(flow):
    _staff, _tournament, match_id, _first, _second = await match_with_internals(flow)
    flow.act_as(None)
    detail = await flow.get(f"/api/matches/{match_id}")
    assert detail.status_code == 200, detail.text
    assert_public(detail.json())
    page = await flow.get(f"/api/matches/{match_id}/page")
    assert page.status_code == 200, page.text
    body = page.json()
    assert_public(body["match"])
    assert "billing" not in body["tournament"], "die interne Abrechnung bleibt intern"
    assert "Mein eigener Grund" not in str(body)


@pytest.mark.asyncio
async def test_a_participant_sees_own_report_and_dispute_but_not_the_others(flow):
    _staff, _tournament, match_id, first, _second = await match_with_internals(flow)
    flow.act_as(first)
    match = (await flow.get(f"/api/matches/{match_id}/page")).json()["match"]
    assert_public(match, own_id=first["id"])
    own_dispute = [row for row in match["disputes"] if row.get("user_id") == first["id"]]
    assert own_dispute and own_dispute[0]["reason"] == "Mein eigener Grund"
    own_report = [row for row in match["reports"] if row.get("user_id") == first["id"]]
    assert own_report and own_report[0]["results"]


@pytest.mark.asyncio
async def test_tournament_staff_still_see_everything(flow):
    staff, _tournament, match_id, _first, second = await match_with_internals(flow)
    flow.act_as(staff)
    detail = (await flow.get(f"/api/matches/{match_id}")).json()
    assert detail["admin_note"] == "Interne Notiz"
    assert detail["result_meta"]["note"] == "Notiz zum Ergebnis"
    assert {row["reason"] for row in detail["disputes"]} == {"Mein eigener Grund", "Grund der Gegenseite"}
    page = (await flow.get(f"/api/matches/{match_id}/page")).json()
    assert page["match"]["admin_decision_note"] == "Begründung der Turnierleitung"
    assert second["id"] in str(page["match"]["reports"])


def test_public_view_keeps_unknown_shapes_calm():
    assert public_match_view(None) is None
    assert public_match_view({"id": "m1", "status": "ready"}) == {"id": "m1", "status": "ready"}
    assert public_match_view({"id": "m1", "reports": None, "disputes": None}) == {"id": "m1", "reports": [], "disputes": []}
