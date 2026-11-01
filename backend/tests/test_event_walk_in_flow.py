"""„Person an der Tür hinzufügen“ (#2127, EV17): ohne Konto und ohne Preis, gleich eingecheckt, mit Protokoll - unter
derselben Platzgrenze wie jede Anmeldung. Solche Einträge bekommen weder Nachricht noch Punkte und stehen nicht in der
öffentlichen Liste. Namen sind erfunden."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import event_photos, feedback, ops_alerts, xp  # noqa: E402

PAID = {"enabled": True, "positions": [{"key": "eintritt", "label": "Eintritt", "amount_cents": 1000, "basis": "per_person"}]}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    await xp.ensure_indexes(instance.db)
    await instance.db.seasons.insert_one({"id": "s1", "name": "Wertung", "status": "active", "start_date": "2026-01-01T00:00:00+00:00"})
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, **extra):
    lead = await flow.add_user(role="superadmin", name="leitung")
    flow.act_as(lead)
    response = await flow.post("/api/events", json={"name": "Herbst-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                    "show_participants": True, "start_date": (now_utc() + timedelta(days=3)).isoformat(), **extra})
    assert response.status_code == 200, response.text
    return lead, response.json()


async def walk_in(flow, event, name="Gast Tür", **body):
    return await flow.post(f"/api/events/{event['slug']}/lead/walk-in", json={"display_name": name, **body})


@pytest.mark.asyncio
async def test_nur_die_leitung_und_mit_protokoll(flow):
    lead, event = await setup(flow)
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    assert (await walk_in(flow, event)).status_code == 403
    flow.act_as(None)
    assert (await walk_in(flow, event)).status_code == 401

    flow.act_as(lead)
    response = await walk_in(flow, event, name="  Gast   Tür ")
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["display_name"] == "Gast Tür" and row["status"] == "checked_in" and row["walk_in"] is True and row["seat_count"] == 1
    assert "user_id" not in row
    audit = await flow.db.audit_logs.find_one({"action": "event.registration.walk_in"}, {"_id": 0})
    assert audit["actor_id"] == lead["id"] and audit["data"]["registration_id"] == row["id"]
    assert "display_name" not in audit["data"], "im Protokoll nur die Kennung"
    assert (await walk_in(flow, event, name="   ")).status_code == 400


@pytest.mark.asyncio
async def test_name_berichtigen_und_eintrag_loeschen_nur_leitung_nur_tuer_eintraege(flow):
    lead, event = await setup(flow, max_participants=2)
    row = (await walk_in(flow, event, name="Gast Falsch")).json()
    url = f"/api/events/{event['slug']}/lead/walk-in/{row['id']}"
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    own = (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).json()
    assert (await flow.patch(url, json={"display_name": "Fremd"})).status_code == 403
    denied = await flow.delete(url)
    assert denied.status_code == 403

    flow.act_as(lead)
    renamed = await flow.patch(url, json={"display_name": "  Gast   Richtig "})
    assert renamed.status_code == 200 and renamed.json()["display_name"] == "Gast Richtig" and renamed.json()["walk_in"] is True
    assert (await flow.patch(url, json={"display_name": "  "})).status_code == 400
    audit = await flow.db.audit_logs.find_one({"action": "event.registration.walk_in_rename"}, {"_id": 0})
    assert audit["data"] == {"registration_id": row["id"]} and audit["actor_id"] == lead["id"]

    # Anmeldungen mit Konto gehen nicht diesen Weg.
    other = f"/api/events/{event['slug']}/lead/walk-in/{own['id']}"
    assert (await flow.patch(other, json={"display_name": "Überschrieben"})).status_code == 404
    refused = await flow.delete(other)
    assert refused.status_code == 404
    assert (await flow.db.event_registrations.find_one({"id": own["id"]}))["display_name"] != "Überschrieben"

    # Voll: Löschen macht den Platz frei; danach ist nichts mehr vom Namen da.
    assert (await walk_in(flow, event, name="Zu viel")).status_code == 400
    deleted = await flow.delete(url)
    assert deleted.status_code == 200
    assert await flow.db.event_registrations.find_one({"id": row["id"]}) is None
    audit = await flow.db.audit_logs.find_one({"action": "event.registration.walk_in_delete"}, {"_id": 0})
    assert audit["data"] == {"registration_id": row["id"]}
    assert (await walk_in(flow, event, name="Gast Neu")).status_code == 200
    gone = await flow.delete(url)
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_frist_loescht_name_und_notiz(flow):
    _lead, event = await setup(flow)
    row = (await walk_in(flow, event)).json()
    await flow.patch(f"/api/events/{event['id']}/registrations/{row['id']}", json={"internal_note": "Gast Tür, Tel 0664 1234"})
    await ops_alerts.purge_old_logs(flow.db, now=now_utc() + timedelta(days=800))
    stored = await flow.db.event_registrations.find_one({"id": row["id"]}, {"_id": 0})
    assert stored["display_name"] == "Teilnehmer" and stored["internal_note"] is None


@pytest.mark.asyncio
async def test_mehrere_ohne_konto_ohne_preis_und_ohne_rechnung(flow):
    lead, event = await setup(flow, billing=PAID)
    first = (await walk_in(flow, event, name="Gast Eins")).json()
    second = (await walk_in(flow, event, name="Gast Zwei")).json()
    assert first["id"] != second["id"], "der eindeutige Index je Event und Person lässt mehrere zu"
    stored = await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})
    assert "price_snapshot" not in stored and stored["registered_via"] == "door" and stored["added_by"] == lead["id"]
    assert await flow.db.billing_orders.count_documents({}) == 0

    # Zurückgenommen und wieder dabei: auch dann kein Preis.
    for status in ("cancelled", "registered", "checked_in"):
        response = await flow.patch(f"/api/events/{event['id']}/registrations/{first['id']}", json={"status": status})
        assert response.status_code == 200, response.text
    assert await flow.db.billing_orders.count_documents({}) == 0
    assert "price_snapshot" not in await flow.db.event_registrations.find_one({"id": first["id"]}, {"_id": 0})


@pytest.mark.asyncio
async def test_keine_nachricht_keine_punkte_keine_xp(flow):
    lead, event = await setup(flow)
    row = (await walk_in(flow, event)).json()
    await flow.patch(f"/api/events/{event['id']}/registrations/{row['id']}", json={"status": "registered"})
    await flow.patch(f"/api/events/{event['id']}/registrations/{row['id']}", json={"status": "checked_in"})
    assert await flow.db.season_points.count_documents({}) == 0
    assert await flow.db.xp_events.count_documents({}) == 0
    assert await flow.db.notifications.count_documents({"kind": "event_registration"}) == 0
    # Auch die Wege, die später alle Teilnehmenden erreichen, kennen die Person nicht.
    assert await feedback.event_participants(flow.db, event) == set()
    assert await event_photos.event_audience(flow.db, event) == set()
    assert lead


@pytest.mark.asyncio
async def test_platzgrenze_und_zaehler(flow):
    lead, event = await setup(flow, max_participants=2, allow_companions=True, max_companions_per_registration=1)
    assert (await walk_in(flow, event, companion_count=1)).status_code == 200
    full = await walk_in(flow, event, name="Noch Jemand")
    assert full.status_code == 400 and "voll" in full.json()["detail"]
    view = (await flow.get(f"/api/events/{event['slug']}/lead", params={"filter": "all"})).json()
    assert view["counts"]["here"] == 1 and view["counts"]["spots_left"] == 0 and view["can_add_walk_in"] is True
    assert (await flow.post(f"/api/events/{event['slug']}/lead/walk-in", json={"display_name": "Zu viele", "companion_count": 5})).status_code == 400
    assert lead


@pytest.mark.asyncio
async def test_nicht_in_der_oeffentlichen_liste_aber_bei_der_leitung(flow):
    lead, event = await setup(flow)
    await walk_in(flow, event, name="Gast Privat")
    player = await flow.add_user(role="player", name="spieler")
    flow.act_as(player)
    (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).raise_for_status()
    page = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert [row["display_name"] for row in page["registrations"]] != [] and all(row["display_name"] != "Gast Privat" for row in page["registrations"])
    assert page["registration_summary"]["checked_in_count"] == 1, "der Platz zählt trotzdem"
    flow.act_as(None)
    assert all(row["display_name"] != "Gast Privat" for row in (await flow.get(f"/api/events/{event['slug']}")).json()["registrations"])

    flow.act_as(lead)
    assert any(row["display_name"] == "Gast Privat" for row in (await flow.get(f"/api/events/{event['slug']}")).json()["registrations"])


@pytest.mark.asyncio
@pytest.mark.parametrize("extra", [{"status": "cancelled"}, {"registration_url": "https://example.test/anmelden"}])
async def test_abgesagt_oder_extern_geht_nicht(flow, extra):
    _lead, event = await setup(flow)
    response = await flow.patch(f"/api/events/{event['id']}", json=extra)
    assert response.status_code == 200, response.text
    assert (await walk_in(flow, event)).status_code == 409
    assert (await flow.get(f"/api/events/{event['slug']}/lead")).json()["can_add_walk_in"] is False


@pytest.mark.asyncio
async def test_absage_trifft_auch_eintraege_an_der_tuer(flow):
    _lead, event = await setup(flow)
    row = (await walk_in(flow, event)).json()
    response = await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled"})
    assert response.status_code == 200, response.text
    stored = await flow.db.event_registrations.find_one({"id": row["id"]}, {"_id": 0})
    assert stored["status"] == "cancelled"
    assert response.json()["cancellation"]["registrations"] == 1 and response.json()["cancellation"]["notified"] == 0
