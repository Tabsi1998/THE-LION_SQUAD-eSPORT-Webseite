"""Die interne Notiz der Turnierleitung (#2127): Wer sie nicht sehen soll, bekommt sie auf keinem Weg - auch nicht nach
Storno und Neuanmeldung oder mit dem Bereich Vereinsverwaltung. Namen sind erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, **extra):
    lead = await flow.add_user(role="tournament_admin", name="leitung")
    flow.act_as(lead)
    response = await flow.post("/api/events", json={"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "show_participants": True, "start_date": (now_utc() + timedelta(days=3)).isoformat(), **extra})
    assert response.status_code == 200, response.text
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    registration = (await flow.post(f"/api/events/{response.json()['id']}/registrations", json={"companion_count": 0})).json()
    flow.act_as(lead)
    return lead, response.json(), player, registration


@pytest.mark.asyncio
async def test_neuanmeldung_nach_storno_zeigt_die_notiz_nicht(flow):
    _lead, event, player, first = await setup(flow)
    written = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"internal_note": "nur intern", "status": "cancelled"})
    assert written.status_code == 200, written.text

    flow.act_as(player)
    again = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert again.status_code == 200, again.text
    body = again.json()
    assert "internal_note" not in body and body["status"] == "registered" and body["can_cancel"] is True
    assert "nur intern" not in again.text
    # Die Notiz selbst bleibt für die Leitung.
    stored = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    assert stored["internal_note"] == "nur intern"


@pytest.mark.asyncio
async def test_vorstand_sieht_teilnehmer_aber_nicht_die_notiz(flow):
    lead, event, _player, first = await setup(flow)
    written = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"internal_note": "nur intern"})
    assert written.status_code == 200, written.text

    vorstand = await flow.add_user(role="player", name="vorstand")
    await flow.db.users.update_one({"id": vorstand["id"]}, {"$set": {"areas": ["club"]}})
    vorstand["areas"] = ["club"]
    flow.act_as(vorstand)
    page = await flow.get(f"/api/events/{event['slug']}")
    assert page.status_code == 200, page.text
    assert page.json()["participant_view"] == "staff" and len(page.json()["registrations"]) == 1
    assert "internal_note" not in page.json()["registrations"][0] and "nur intern" not in page.text
    assert (await flow.get(f"/api/events/{event['slug']}/lead")).status_code == 403

    # Die Turnierleitung sieht sie weiter - als Rolle und als Freigabe.
    flow.act_as(lead)
    assert (await flow.get(f"/api/events/{event['slug']}")).json()["registrations"][0]["internal_note"] == "nur intern"
    freigabe = await flow.add_user(role="player", name="freigabe")
    await flow.db.users.update_one({"id": freigabe["id"]}, {"$set": {"areas": ["tournaments"]}})
    freigabe["areas"] = ["tournaments"]
    flow.act_as(freigabe)
    assert (await flow.get(f"/api/events/{event['slug']}")).json()["registrations"][0]["internal_note"] == "nur intern"


# ---------------------------------------------------------------- Lesen und Schreiben nach derselben Regel (#2591)

async def with_areas(flow, name: str, areas: list[str], **fields) -> dict:
    person = await flow.add_user(role="player", name=name)
    await flow.db.users.update_one({"id": person["id"]}, {"$set": {"areas": areas, **fields}})
    person.update({"areas": areas, **fields})
    return person


@pytest.mark.asyncio
async def test_vorstand_ohne_turnierleitung_schreibt_die_notiz_nicht_und_liest_sie_nirgends(flow):
    lead, event, _player, first = await setup(flow)
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"internal_note": "nur intern"})).status_code == 200
    vorstand = await with_areas(flow, "vorstand", ["club"], is_club_member=True)
    flow.act_as(vorstand)
    # Schreiben: Die Notiz gehört der Turnierleitung - abgelehnt, nichts geändert, die Antwort verrät sie nicht.
    refused = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"internal_note": "vom Vorstand"})
    assert refused.status_code == 403 and "nur intern" not in refused.text
    stored = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    assert stored["internal_note"] == "nur intern"
    # Auch keine andere Änderung über diesen Weg und keine Liste der Verwaltung - wie die Leitungsseite.
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": "checked_in"})).status_code == 403
    listed = await flow.get(f"/api/events/{event['id']}/registrations")
    assert listed.status_code == 403 and "nur intern" not in listed.text
    detail = await flow.get(f"/api/events/{event['slug']}/lead/registrations/{first['id']}")
    assert detail.status_code == 403 and "nur intern" not in detail.text
    # Lesen: Teilnehmer ja, Notiz nein.
    page = await flow.get(f"/api/events/{event['slug']}")
    assert page.status_code == 200 and page.json()["registrations"] and "nur intern" not in page.text
    assert all("internal_note" not in row for row in page.json()["registrations"])


@pytest.mark.asyncio
async def test_turnierleitung_liest_und_schreibt_die_notiz_als_rolle_und_als_freigabe(flow):
    lead, event, _player, first = await setup(flow)
    url = f"/api/events/{event['id']}/registrations/{first['id']}"
    written = await flow.patch(url, json={"internal_note": "Platz 4 reserviert"})
    assert written.status_code == 200 and written.json()["internal_note"] == "Platz 4 reserviert"
    assert (await flow.get(f"/api/events/{event['slug']}")).json()["registrations"][0]["internal_note"] == "Platz 4 reserviert"
    assert (await flow.get(f"/api/events/{event['slug']}/lead/registrations/{first['id']}")).json()["internal_note"] == "Platz 4 reserviert"
    freigabe = await with_areas(flow, "freigabe", ["tournaments"])
    flow.act_as(freigabe)
    changed = await flow.patch(url, json={"internal_note": "Platz 5 reserviert"})
    assert changed.status_code == 200 and changed.json()["internal_note"] == "Platz 5 reserviert"
    listed = (await flow.get(f"/api/events/{event['id']}/registrations")).json()["registrations"]
    assert [row["internal_note"] for row in listed] == ["Platz 5 reserviert"]
    # Leer gespeichert löscht sie.
    cleared = await flow.patch(url, json={"internal_note": None})
    assert cleared.status_code == 200 and cleared.json()["internal_note"] is None


@pytest.mark.asyncio
async def test_mitglied_sieht_und_schreibt_keine_notiz(flow):
    _lead, event, player, first = await setup(flow)
    assert (await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"internal_note": "nur intern"})).status_code == 200
    mitglied = await with_areas(flow, "mitglied", [], is_club_member=True)
    for person in (mitglied, player):
        flow.act_as(person)
        page = await flow.get(f"/api/events/{event['slug']}")
        assert page.status_code == 200 and "nur intern" not in page.text
        assert all("internal_note" not in row for row in page.json()["registrations"])
        assert "internal_note" not in (page.json().get("own_registration") or {})
        refused = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"internal_note": "von mir"})
        assert refused.status_code == 403 and "nur intern" not in refused.text
    stored = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    assert stored["internal_note"] == "nur intern"


def test_eine_regel_fuer_lesen_und_schreiben():
    from routes.event_routes import _sees_internal_note

    # Vorstand (Bereich Vereinsverwaltung) nein, Turnierleitung als Bereich ja, Mitglied ohne Bereich nein.
    assert _sees_internal_note({"role": "player"}, {"club"}) is False
    assert _sees_internal_note({"role": "player"}, {"tournaments"}) is True
    assert _sees_internal_note({"role": "player"}, set()) is False
    assert _sees_internal_note(None, set()) is False
