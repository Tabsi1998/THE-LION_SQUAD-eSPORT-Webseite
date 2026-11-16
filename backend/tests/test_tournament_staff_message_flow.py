"""Helfer eintragen (#1384): Eintragen und Rollenwechsel schicken genau eine Nachricht mit dem Satz der Rolle und dem Weg zu
„Mein Dienst“ - im Postfach, per Push und (nach Einstellung „Turnier-Updates“) per Mail. Unverändertes Speichern schickt nichts."""
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


async def notes(flow, user) -> list[dict]:
    return await flow.db.notifications.find({"user_id": user["id"], "kind": "tournament_staff"}, {"_id": 0}).sort("created_at", 1).to_list(20)


async def mails(flow, user) -> list[dict]:
    return await flow.db.mail_jobs.find({"template_key": "tournament_staff", "to": user["email"]}, {"_id": 0}).to_list(20)


@pytest.mark.asyncio
async def test_enlisting_sends_one_message_with_the_role_sentence(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(title="Mario Kart Cup")
    helper = await flow.add_user(name="Hanna Helfer")
    url = f"/api/tournaments/{tournament['id']}/staff"

    created = await flow.post(url, json={"user_id": helper["id"], "role": "scorekeeper"})
    assert created.status_code == 200, created.text
    again = await flow.post(url, json={"user_id": helper["id"], "role": "scorekeeper"})
    assert again.json()["idempotent_replay"] is True

    rows = await notes(flow, helper)
    assert len(rows) == 1, "genau eine Nachricht, auch bei doppeltem Absenden"
    assert "Mario Kart Cup" in rows[0]["title"] and rows[0]["url"] == "/admin/dienst"
    assert "als Ergebnisdienst" in rows[0]["body"] and "Teilnehmer, Ergebnisse und Check-in" in rows[0]["body"]
    sent = await mails(flow, helper)
    assert len(sent) == 1 and "Teilnehmer, Ergebnisse und Check-in" in sent[0]["html"] and "/admin/dienst" in sent[0]["html"]


@pytest.mark.asyncio
async def test_a_role_change_sends_one_message_unchanged_saving_none(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(title="Mario Kart Cup")
    helper = await flow.add_user(name="Hanna Helfer")
    url = f"/api/tournaments/{tournament['id']}/staff"
    assignment = (await flow.post(url, json={"user_id": helper["id"], "role": "scorekeeper"})).json()

    same = await flow.patch(f"{url}/{assignment['id']}", json={"role": "scorekeeper", "notes": "Samstag"})
    assert same.status_code == 200, same.text
    paused = await flow.patch(f"{url}/{assignment['id']}", json={"is_active": False})
    assert paused.status_code == 200
    assert len(await notes(flow, helper)) == 1, "keine Nachricht ohne Rollenwechsel"

    await flow.patch(f"{url}/{assignment['id']}", json={"is_active": True})
    changed = await flow.patch(f"{url}/{assignment['id']}", json={"role": "referee"})
    assert changed.status_code == 200, changed.text
    rows = await notes(flow, helper)
    assert len(rows) == 2, "genau eine Nachricht zum Rollenwechsel"
    assert "als Schiedsrichter" in rows[-1]["body"] and "Ablauf und Baum" in rows[-1]["body"]
    assert "Neue Rolle" in rows[-1]["title"]
    assert len(await mails(flow, helper)) == 2

    back = await flow.patch(f"{url}/{assignment['id']}", json={"role": "scorekeeper"})
    assert back.status_code == 200
    assert len(await notes(flow, helper)) == 3, "auch zurück zur alten Rolle gibt es Bescheid"


@pytest.mark.asyncio
async def test_a_paused_assignment_hears_once_when_it_becomes_active(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(title="Mario Kart Cup")
    helper = await flow.add_user(name="Hanna Helfer")
    url = f"/api/tournaments/{tournament['id']}/staff"
    assignment = (await flow.post(url, json={"user_id": helper["id"], "role": "scorekeeper", "is_active": False})).json()
    await flow.patch(f"{url}/{assignment['id']}", json={"role": "referee"})
    assert await notes(flow, helper) == [], "Rollenwechsel während der Pause schicken nichts"

    # Aktiv geschaltet: genau eine Nachricht - mit der Rolle, die jetzt gilt; erneutes Pausieren und Aktivieren schickt keine.
    activated = await flow.patch(f"{url}/{assignment['id']}", json={"is_active": True})
    assert activated.status_code == 200, activated.text
    rows = await notes(flow, helper)
    assert len(rows) == 1 and "als Schiedsrichter" in rows[0]["body"]
    for active in (False, True):
        toggled = await flow.patch(f"{url}/{assignment['id']}", json={"is_active": active})
        assert toggled.status_code == 200
    assert len(await notes(flow, helper)) == 1
    assert len(await mails(flow, helper)) == 1


@pytest.mark.asyncio
async def test_without_tournament_mails_only_bell_and_push(flow):
    staff = await flow.add_staff()
    flow.act_as(staff)
    tournament = await flow.create_tournament(title="Mario Kart Cup")
    helper = await flow.add_user(name="Hanna Helfer")
    await flow.db.users.update_one({"id": helper["id"]}, {"$set": {"notification_preferences": {"email:tournament_updates": False}}})
    await flow.post(f"/api/tournaments/{tournament['id']}/staff", json={"user_id": helper["id"], "role": "station_manager"})
    assert await mails(flow, helper) == []


@pytest.mark.asyncio
async def test_fast_lap_helpers_get_the_same_message(flow):
    """Fast Lap (#1384, Review): Eintragen schickt dieselbe Nachricht; pausiert eingetragen kommt sie beim Aktivieren."""
    flow.act_as(await flow.add_user(role="superadmin", name="leitung"))
    await flow.db.f1_challenges.insert_one({"id": "fl-1", "slug": "monza", "title": "Monza Fast Lap", "status": "registration_open"})
    helper = await flow.add_user(name="Hanna Helfer")
    later = await flow.add_user(name="Paul Pause")
    created = await flow.post("/api/f1/challenges/fl-1/staff", json={"user_id": helper["id"], "role": "scorekeeper"})
    assert created.status_code == 200, created.text
    rows = await notes(flow, helper)
    assert len(rows) == 1 and "Monza Fast Lap" in rows[0]["title"] and "Zeiten eintragen" in rows[0]["body"]
    assert rows[0]["url"] == "/admin/dienst" and len(await mails(flow, helper)) == 1

    paused = await flow.post("/api/f1/challenges/fl-1/staff", json={"user_id": later["id"], "role": "referee", "is_active": False})
    assert paused.status_code == 200 and await notes(flow, later) == []
    for active in (True, False, True):
        toggled = await flow.patch(f"/api/f1/challenges/fl-1/staff/{paused.json()['id']}", json={"is_active": active})
        assert toggled.status_code == 200, toggled.text
    rows = await notes(flow, later)
    assert len(rows) == 1 and "als Schiedsrichter" in rows[0]["body"]
