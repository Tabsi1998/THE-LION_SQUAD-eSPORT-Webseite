"""Viele Anmeldungen (#2216): Teilnehmerliste, Baum, Tabelle und Auslosung sehen jede Anmeldung des Turniers.

Ein Turnier hat bis zu ``PARTICIPANT_LIMIT`` Plätze. Teilnehmerliste, Baum, Tabelle und die Auslosung der Gruppen lasen die
Anmeldungen aber nur bis 500 - wer danach kam, fehlte in der Liste und wurde in keine Gruppe gelost. ``to_list(n)`` liefert
auf mongomock wie bei Motor höchstens n Einträge (#2357), der Fehler ist also auf beiden Datenbanken zu sehen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402

# Mehr als die alte Grenze von 500, in Gruppen zu vier.
PARTICIPANTS = 520
GROUPS = PARTICIPANTS // 4


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_list_bracket_table_and_draw_see_every_registration(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament, _users, registrations = await flow.with_participants(PARTICIPANTS, format="groups")
    everyone = {registration["id"] for registration in registrations}
    assert len(everyone) == PARTICIPANTS

    listed = await flow.get(f"/api/tournaments/{tournament['id']}/registrations")
    assert listed.status_code == 200, listed.text
    assert {row["id"] for row in listed.json()} == everyone, "die Teilnehmerliste zeigt jede Anmeldung"

    drawn = await flow.post(f"/api/tournaments/{tournament['id']}/groups/generate", json={"group_count": GROUPS})
    assert drawn.status_code == 200, drawn.text
    in_groups = {slot.get("registration_id") for match in await flow.db.matches_v2.find(
                     {"tournament_id": tournament["id"]}, {"_id": 0, "slots": 1}).to_list(None)
                 for slot in match.get("slots") or [] if slot.get("registration_id")}
    assert in_groups == everyone, "die Auslosung lost jede Anmeldung in eine Gruppe"

    bracket = await flow.get(f"/api/tournaments/{tournament['id']}/bracket")
    assert bracket.status_code == 200, bracket.text
    assert {row["id"] for row in bracket.json()["registrations"]} == everyone, "der Baum kennt jede Anmeldung"

    table = await flow.get(f"/api/tournaments/{tournament['id']}/standings")
    assert table.status_code == 200, table.text
    in_table = {row.get("registration_id") for group in table.json() for row in group["standings"]}
    assert in_table == everyone, "die Tabelle hat eine Zeile je Anmeldung"
