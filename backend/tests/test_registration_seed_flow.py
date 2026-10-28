"""Setzplatz bis zum Ende des Check-ins (#2111, TA15).

Der Setzplatz ließ sich nur beim Hinzufügen von Hand setzen - bei vorhandenen Anmeldungen weder sehen noch ändern,
„Manuell“ hieß damit Anmeldereihenfolge. Jetzt ändert die Turnierleitung ihn, solange der Baum noch Vorschau ist;
leer nimmt ihn weg. Steht der Baum, lehnt der Server ab.
"""
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


@pytest.mark.asyncio
async def test_the_seed_changes_until_the_bracket_is_fixed(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(status="registration_open", seeding_mode="manual")
    paula = await flow.register(tournament, await flow.add_user(name="Paula"))
    url = f"/api/tournaments/{tournament['id']}/registrations/{paula['id']}"

    seeded = await flow.patch(url, json={"seed": 2})
    assert seeded.status_code == 200, seeded.text
    assert (await flow.db.tournament_registrations.find_one({"id": paula["id"]}))["seed"] == 2
    entry = await flow.db.audit_logs.find_one({"action": "tournament.registration.seed"}, {"_id": 0})
    assert entry["data"] == {"registration_id": paula["id"], "from_seed": None, "to_seed": 2}

    cleared = await flow.patch(url, json={"seed": None})
    assert cleared.status_code == 200, cleared.text
    assert (await flow.db.tournament_registrations.find_one({"id": paula["id"]})).get("seed") is None
    assert (await flow.patch(url, json={"seed": 0})).status_code == 422

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"check_in_closed_at": "2026-10-31T17:00:00+00:00"}})
    refused = await flow.patch(url, json={"seed": 1})
    assert refused.status_code == 409
    assert "Ende des Check-ins" in refused.json()["detail"]
    # Ein Status ohne Setzplatz geht weiter.
    assert (await flow.patch(url, json={"status": "checked_in"})).status_code == 200
