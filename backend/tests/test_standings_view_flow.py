"""Rangliste und TV-Tabelle (#2121) über die echten Wege: nur wer dazugehört, im K.-o. Plätze erst mit dem ersten
Ergebnis, und der TV bekommt die Tabelle einer Liga mit seinem Anzeige-Schlüssel - ohne Konten. Namen sind erfunden."""
import json
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def drawn(flow, count=4, **fields):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    for status in ("waitlist", "pending", "rejected", "no_show"):
        await flow.register(tournament, await flow.add_user(name=f"Nicht dabei {status}"), status=status)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


async def standings(flow, tournament):
    response = await flow.get(f"/api/tournaments/{tournament['id']}/standings")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_a_knockout_has_no_places_before_the_first_result_and_never_lists_the_waitlist(flow):
    staff, tournament, _users, registrations = await drawn(flow, 4)
    flow.act_as(None)
    assert await standings(flow, tournament) == [], "vor dem ersten Ergebnis: Noch keine Ergebnisse"

    flow.act_as(staff)
    match = next(m for m in sorted(await flow.matches(tournament), key=lambda m: m.get("round") or 0)
                 if len([s for s in m["slots"] if s.get("registration_id")]) == 2)
    winner, loser = [slot["registration_id"] for slot in match["slots"]]
    response = await flow.post(f"/api/matches/{match['id']}/result", json={"results": [
        {"registration_id": winner, "rank": 1, "score": 2}, {"registration_id": loser, "rank": 2, "score": 0}]})
    assert response.status_code == 200, response.text
    flow.act_as(None)

    rows = {row["registration_id"]: row for row in await standings(flow, tournament)}
    assert set(rows) == {registration["id"] for registration in registrations}
    assert (rows[winner]["won"], rows[winner]["lost"]) == (1, 0)
    assert (rows[loser]["won"], rows[loser]["lost"]) == (0, 1), "eine Niederlage im K.-o. zählt"


@pytest.mark.asyncio
async def test_the_tv_gets_the_league_table_with_its_display_key_and_without_accounts(flow):
    _staff, tournament, users, registrations = await drawn(flow, 4, format="league")
    created = await flow.post("/api/tv/keys", json={"tournament_id": tournament["id"], "label": "Beamer"})
    assert created.status_code == 200, created.text
    flow.act_as(None)

    body = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display",
                           params={"key": created.json()["token"]})).json()

    assert {row["registration_id"] for row in body["standings"]} == {registration["id"] for registration in registrations}
    assert all(row["played"] == 0 and row["rank"] == 1 for row in body["standings"])
    text = json.dumps(body["standings"])
    assert "user_id" not in text and "team_id" not in text
    for user in users:
        assert user["id"] not in text


@pytest.mark.asyncio
async def test_a_knockout_tv_gets_no_table(flow):
    staff, tournament, _users, _registrations = await drawn(flow, 4)
    flow.act_as(staff)
    body = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display")).json()
    assert "standings" not in body
