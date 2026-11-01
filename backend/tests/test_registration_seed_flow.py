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


@pytest.mark.asyncio
async def test_each_seed_exists_only_once(flow):
    """#2111: zweimal Setzplatz 1 lehnt der Server ab - in der Liste wie beim Hinzufügen. Wer nicht mehr mitspielt, hält
    keinen Platz fest."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(status="registration_open", seeding_mode="manual")
    base = f"/api/tournaments/{tournament['id']}/registrations"
    paula = await flow.register(tournament, await flow.add_user(name="Paula"), seed=1)
    jonas = await flow.register(tournament, await flow.add_user(name="Jonas"), seed=2)

    refused = await flow.patch(f"{base}/{jonas['id']}", json={"seed": 1})
    assert refused.status_code == 409, refused.text
    assert "Setzplatz 1 hat schon" in refused.json()["detail"] and "einen anderen" in refused.json()["detail"]
    assert (await flow.db.tournament_registrations.find_one({"id": jonas["id"]}))["seed"] == 2

    added = await flow.post(base, json={"display_name": "Gast", "seed": 2})
    assert added.status_code == 409, added.text
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == 2

    # Der eigene Platz und „kein Setzplatz“ stören nicht.
    assert (await flow.patch(f"{base}/{paula['id']}", json={"seed": 1})).status_code == 200
    assert (await flow.post(base, json={"display_name": "Ohne Platz"})).status_code == 200
    assert (await flow.post(base, json={"display_name": "Noch ohne Platz", "seed": None})).status_code == 200

    await flow.db.tournament_registrations.update_one({"id": paula["id"]}, {"$set": {"status": "no_show"}})
    assert (await flow.patch(f"{base}/{jonas['id']}", json={"seed": 1})).status_code == 200


@pytest.mark.asyncio
async def test_a_returning_registration_brings_its_seed_only_if_it_is_still_free(flow):
    """#2111: A (Platz 1) ist weg, B bekommt Platz 1 - kommt A zurück, gäbe es Platz 1 zweimal. Das sagt der Server vorher."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(status="registration_open", seeding_mode="manual")
    base = f"/api/tournaments/{tournament['id']}/registrations"
    gone = await flow.register(tournament, await flow.add_user(name="Paula"), seed=1, status="withdrawn")
    absent = await flow.register(tournament, await flow.add_user(name="Mia"), seed=3, status="no_show")
    jonas = await flow.register(tournament, await flow.add_user(name="Jonas"), seed=2)
    assert (await flow.patch(f"{base}/{jonas['id']}", json={"seed": 1})).status_code == 200

    refused = await flow.patch(f"{base}/{gone['id']}", json={"status": "approved"})
    assert refused.status_code == 409, refused.text
    assert "Setzplatz 1 hat schon Jonas" in refused.json()["detail"]
    assert (await flow.db.tournament_registrations.find_one({"id": gone["id"]}))["status"] == "withdrawn"
    # In einen anderen freien Status geht es weiter: dort hält niemand den Platz.
    assert (await flow.patch(f"{base}/{gone['id']}", json={"status": "rejected"})).status_code == 200
    assert (await flow.patch(f"{base}/{jonas['id']}", json={"seed": 2})).status_code == 200
    assert (await flow.patch(f"{base}/{gone['id']}", json={"status": "approved"})).status_code == 200

    assert (await flow.patch(f"{base}/{jonas['id']}", json={"seed": 3})).status_code == 200
    at_checkin = await flow.post(f"{base}/{absent['id']}/checkin", json={"status": "checked_in"})
    assert at_checkin.status_code == 409, at_checkin.text
    assert "Setzplatz 3 hat schon Jonas" in at_checkin.json()["detail"]
    assert (await flow.db.tournament_registrations.find_one({"id": absent["id"]}))["status"] == "no_show"
    assert (await flow.patch(f"{base}/{jonas['id']}", json={"seed": 2})).status_code == 200
    assert (await flow.post(f"{base}/{absent['id']}/checkin", json={"status": "checked_in"})).status_code == 200


@pytest.mark.asyncio
async def test_a_fixed_bracket_lets_a_late_arrival_back_despite_the_same_seed(flow):
    """Steht der Baum, ändert sich kein Setzplatz mehr - eine Meldung „anderen wählen“ wäre eine Sackgasse am Eventtag."""
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(status="registration_open", seeding_mode="manual",
                                              check_in_closed_at="2026-10-31T17:00:00+00:00")
    base = f"/api/tournaments/{tournament['id']}/registrations"
    late = await flow.register(tournament, await flow.add_user(name="Paula"), seed=1, status="no_show")
    await flow.register(tournament, await flow.add_user(name="Jonas"), seed=1)
    assert (await flow.post(f"{base}/{late['id']}/checkin", json={"status": "checked_in"})).status_code == 200
