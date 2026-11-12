"""Liga-Termine und Datenschutz (#2194): Anträge und Historie stehen in der Auskunft (eigene Anträge mit Grund, als Leitung nur
der Vorgang), die Kontolöschung nimmt die Kennung heraus, der Grund bleibt ohne Person. Erfundene Namen."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from test_league_schedule_flow import agree, at, live_world, mid, request  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def played_out(flow) -> dict:
    """Einigung, eine angenommene Verschiebung mit Grund, danach setzt die Leitung den Termin mit Grund."""
    world = await live_world(flow)
    await agree(flow, world, 72)
    rid = (await request(flow, world, "Kapitaen", 96, reason="Spieler im Nachtdienst")).json()["id"]
    flow.act_as(world["users"]["Falke1"])
    answer = await flow.post(f"/api/matches/{mid(world)}/reschedule/{rid}/decision", json={"action": "accept", "note": "passt uns"})
    assert answer.status_code == 200
    await request(flow, world, "Falke1", 110, reason="Noch eine Bitte")
    flow.act_as(world["staff"])
    assert (await flow.patch(f"/api/matches/{mid(world)}", json={"scheduled_at": at(120), "schedule_reason": "Leitung entscheidet"})).status_code == 200
    return world


def section(payload: dict, match_id: str) -> dict:
    return next(row for row in payload["league_schedule"] if row["match_id"] == match_id)


@pytest.mark.asyncio
async def test_export_shows_own_requests_with_reason_and_lead_steps_without_content(flow):
    from routes import dsgvo_routes

    world = await played_out(flow)
    captain = section(await dsgvo_routes._user_data_export(flow.db, world["users"]["Kapitaen"]["id"]), mid(world))
    own = next(row for row in captain["requests"] if row["role"] == "requested")
    assert own["reason"] == "Spieler im Nachtdienst" and own["status"] == "accepted"

    falke = section(await dsgvo_routes._user_data_export(flow.db, world["users"]["Falke1"]["id"]), mid(world))
    decided = next(row for row in falke["requests"] if row["role"] == "decided")
    assert decided["decision_note"] == "passt uns" and "reason" not in decided, "der Grund der anderen Seite gehört ihr"
    assert any(row["role"] == "requested" and row["reason"] == "Noch eine Bitte" for row in falke["requests"])

    lead = section(await dsgvo_routes._user_data_export(flow.db, world["staff"]["id"]), mid(world))
    assert lead["history"] == [{"kind": "lead", "at": lead["history"][0]["at"]}], "als Leitung nur der Vorgang"
    assert all(set(row) <= {"id", "role", "status", "at"} for row in lead["requests"])
    text = str(lead)
    assert "Leitung entscheidet" not in text and "Noch eine Bitte" not in text


@pytest.mark.asyncio
async def test_erasure_removes_the_person_but_keeps_the_reason(flow):
    from services import account_erasure

    world = await played_out(flow)
    captain = world["users"]["Kapitaen"]
    await account_erasure.erase_related(flow.db, captain, "2026-11-03T10:00:00+00:00")
    stored = await flow.reload(world["match"])
    text = str({"requests": stored["reschedule_requests"], "history": stored["schedule_history"]})
    assert captain["id"] not in text
    assert any(row.get("reason") == "Spieler im Nachtdienst" and row.get("requested_by") is None for row in stored["reschedule_requests"])
    # Die anderen bleiben, wer sie sind.
    assert world["users"]["Falke1"]["id"] in text
