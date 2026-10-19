"""Druckansicht (#1283): die Check-in-Liste zum Abhaken - nur mit Check-in-Recht im Turnier, ohne private Daten.

Geprüft über die echte Route: Gäste, Spieler und ein Streamer-Einsatz bekommen nichts; die Turnierleitung und ein
Schiedsrichter-Einsatz in genau diesem Turnier bekommen die Liste - erwartet nach Setzplatz, die Warteliste darunter,
Abgelehnte fehlen. Mail-Adressen und Konten stehen nicht drin. Namen sind erfunden.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    tournament = await flow.create_tournament(title="Herbst-Cup", max_participants=8)
    people = {}
    for name, seed, status in [("Zora", 2, "approved"), ("Anton", 1, "checked_in"), ("Berta", None, "approved"),
                               ("Wanda", None, "waitlist"), ("Rudi", None, "rejected")]:
        user = await flow.add_user(name=name)
        people[name] = user
        await flow.register(tournament, user, seed=seed, status=status)
    await flow.db.tournament_registrations.update_one(
        {"user_id": people["Berta"]["id"]}, {"$set": {"ingame_name": "B3rta"}})
    return tournament, people


async def assign(flow, tournament, role):
    helper = await flow.add_user(name=f"helfer-{role}")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": helper["id"], "role": role, "is_active": True})
    return helper


@pytest.mark.asyncio
async def test_list_needs_checkin_right(flow):
    tournament, people = await setup(flow)
    url = f"/api/tournaments/{tournament['slug']}/print/checkin"

    flow.act_as(None)
    assert (await flow.get(url)).status_code == 401
    flow.act_as(people["Anton"])
    assert (await flow.get(url)).status_code == 403
    flow.act_as(await assign(flow, tournament, "stream_operator"))
    assert (await flow.get(url)).status_code == 403
    # Ein Einsatz in einem anderen Turnier hilft hier nicht.
    other = await flow.create_tournament(title="Anderes Turnier")
    flow.act_as(await assign(flow, other, "referee"))
    assert (await flow.get(url)).status_code == 403

    flow.act_as(await assign(flow, tournament, "referee"))
    response = await flow.get(url)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_list_order_waitlist_and_no_private_fields(flow):
    tournament, _people = await setup(flow)
    flow.act_as(await flow.add_staff())
    response = await flow.get(f"/api/tournaments/{tournament['id']}/print/checkin")
    assert response.status_code == 200, response.text
    body = response.json()

    assert [row["name"] for row in body["expected"]] == ["Anton", "Zora", "Berta"]
    assert [row["name"] for row in body["waitlist"]] == ["Wanda"]
    assert body["counts"] == {"expected": 3, "checked_in": 1, "waitlist": 1}
    anton, _zora, berta = body["expected"]
    assert anton["checked_in"] is True and anton["seed"] == 1
    assert berta["ingame_name"] == "B3rta" and berta["seed"] is None
    allowed = {"id", "name", "ingame_name", "team_tag", "member_count", "seed", "status", "checked_in"}
    for row in body["expected"] + body["waitlist"]:
        assert set(row) == allowed
    assert "@" not in response.text
