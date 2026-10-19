"""Anzeige-Schlüssel je Event (#1822): Hallen-Tafel und Aufruf-Tafel laufen am Hallen-TV ohne Anmeldung.

Ein Schlüssel für ein Event (angelegt unter TV & Beamer, wie der Turnierbaum-Schlüssel nur als Hash gespeichert und
widerrufbar) öffnet die TV-Daten aller Turniere des Events - auch „Nur Mitglieder“ - und nur die Felder, die die Tafeln
zeigen. Ohne Schlüssel bleibt alles, wie es ist: nicht öffentliche Turniere stehen nirgends. Ein Event-Schlüssel öffnet
kein anderes Event und keinen Turnierbaum-TV, ein Turnier-Schlüssel kein Event.
"""
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import tv_display  # noqa: E402
from services.access_links import hash_access_token  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def soon(hours: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


async def event_of(flow, **fields) -> dict:
    event = {"id": new_id(), "slug": f"event-{new_id()[:8]}", "name": "Vereinsabend", "status": "live", "visibility": "public",
             "start_date": soon(-1), "end_date": soon(6), "location": "Vereinsheim", "city": "Wien",
             "billing": {"price_cents": 500}, "internal_notes": "nur für den Vorstand", **fields}
    await flow.db.events.insert_one(dict(event))
    return event


async def cup_of(flow, event: dict | None, title: str, count: int = 4, **fields) -> tuple[dict, list[dict]]:
    """Ein laufendes Turnier mit Baum, am Event."""
    tournament, users, _registrations = await flow.with_participants(
        count, title=title, event_id=(event or {}).get("id"), start_date=soon(-0.5), internal_notes="geheim", **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return tournament, users


async def called_station(flow, tournament: dict, name: str = "Station 1") -> tuple[dict, dict]:
    """Ein Aufruf: ein spielbereites Spiel an einer reservierten Station."""
    match = next(row for row in await flow.matches(tournament) if all(slot.get("registration_id") for slot in row["slots"]))
    called_at = soon()
    station = {"id": new_id(), "name": name, "device_type": "pc", "tournament_id": tournament["id"], "status": "reserved",
               "current_match_id": match["id"], "called_at": called_at, "queue_match_ids": [], "notes": "Kabel wackelt, Schlüssel bei Max"}
    await flow.db.stations.insert_one(dict(station))
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {"station_id": station["id"], "station_name": name, "called_at": called_at}})
    return station, match


async def event_key(flow, event: dict, label: str = "Beamer Halle") -> dict:
    response = await flow.post("/api/tv/keys", json={"event_id": event["id"], "label": label})
    assert response.status_code == 200, response.text
    return response.json()


async def hall(flow, event_ref: str, key: str | None):
    return await flow.get(f"/api/events/{event_ref}/display", params={"key": key} if key is not None else None)


@pytest.mark.asyncio
async def test_an_event_key_shows_members_cups_of_the_event_without_login_and_only_tv_data(flow):
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    event = await event_of(flow)
    open_cup, _ = await cup_of(flow, event, "Sofort-Cup")
    members_cup, members = await cup_of(flow, event, "Probelauf-Cup", visibility="members")
    internal_cup, _ = await cup_of(flow, event, "Intern-Test", visibility="internal")
    hidden_cup, _ = await cup_of(flow, event, "Nicht öffentlich", is_public=False)
    draft = await flow.create_tournament(title="Entwurf", event_id=event["id"], status="draft", visibility="members")
    other_event = await event_of(flow, name="Anderes Event")
    elsewhere, _ = await cup_of(flow, other_event, "Anderswo", visibility="members")
    station, match = await called_station(flow, members_cup)

    created = await event_key(flow, event, "  Beamer   Halle  ")
    token = created["token"]
    assert created["path"] == f"/display/event/{event['id']}?key={token}"
    assert created["label"] == "Beamer Halle" and created["target_type"] == "event" and created["target_title"] == "Vereinsabend"
    assert created["event_id"] == event["id"]
    stored = await flow.db.access_links.find_one({"id": created["id"]}, {"_id": 0})
    assert stored["token_hash"] == hash_access_token(token) and token not in json.dumps(stored), "gespeichert wird nur der Hash"
    assert stored["grants"] == ["display"] and stored["target_type"] == "event" and stored["target_id"] == event["id"]

    flow.act_as(None)
    # Ohne Schlüssel bleibt es wie heute: der Mitglieder-Cup steht nirgends.
    public_event = (await flow.get(f"/api/events/{event['slug']}")).json()
    assert [row["id"] for row in public_event["tournaments"]] == [open_cup["id"]]
    assert (await hall(flow, event["id"], None)).status_code == 403
    assert (await hall(flow, event["id"], "")).status_code == 403

    response = await hall(flow, event["id"], token)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display_key"] is True
    assert body["event"]["id"] == event["id"] and body["event"]["name"] == "Vereinsabend" and body["event"]["city"] == "Wien"
    shown = {row["id"] for row in body["event"]["tournaments"]}
    assert shown == {open_cup["id"], members_cup["id"]}, "„Nur Mitglieder“ ja - intern, nicht öffentlich, Entwurf und andere Events nie"
    assert {payload["tournament"]["id"] for payload in body["brackets"]} == shown
    for absent in (internal_cup, hidden_cup, draft, elsewhere):
        assert absent["id"] not in json.dumps(body) and absent["title"] not in json.dumps(body, ensure_ascii=False)

    # Der Aufruf an der Station: Station, Spiel mit „aufgerufen um“ und die Namen - wie die Aufruf-Tafel sie braucht.
    [shown_station] = [row for row in body["stations"] if row["id"] == station["id"]]
    assert shown_station["status"] == "reserved" and shown_station["current_match_id"] == match["id"] and shown_station["name"] == "Station 1"
    members_payload = next(payload for payload in body["brackets"] if payload["tournament"]["id"] == members_cup["id"])
    called = next(row for row in members_payload["matches_v2"] if row["id"] == match["id"])
    assert called["called_at"] and called["station_id"] == station["id"]
    names = {reg["display_name"] for reg in members_payload["registrations"]}
    assert {f"Spieler {index}" for index in range(1, 5)} <= names

    text = json.dumps(body, ensure_ascii=False)
    assert token not in text, "der Schlüssel steht in keiner Antwort"
    assert "user_id" not in text and "email" not in text and '"user"' not in text, "keine Konten am TV"
    for user in members:
        assert user["id"] not in text and user["email"] not in text
    for private in ("Kabel wackelt", "internal_notes", "nur für den Vorstand", "price_cents", "billing", "geheim", "queue_match_ids"):
        assert private not in text, private

    # Über den Slug geht es genauso, und der Admin sieht, wann der Bildschirm zuletzt da war.
    assert (await hall(flow, event["slug"], token)).status_code == 200
    assert (await flow.db.access_links.find_one({"id": created["id"]}, {"_id": 0})).get("last_used_at")

    # Der Schlüssel ist kein Speziallink zum Ansehen: Event-Seite, Turnierseite und Baum bleiben zu.
    assert (await flow.get(f"/api/tournaments/{members_cup['slug']}", params={"access": token})).status_code in {403, 404}
    assert (await flow.get(f"/api/tournaments/{members_cup['id']}/bracket", params={"access": token})).status_code in {403, 404}
    members_event = await event_of(flow, visibility="members", name="Mitglieder-Event")
    flow.act_as(staff)
    members_event_key = (await event_key(flow, members_event))["token"]
    flow.act_as(None)
    assert (await flow.get(f"/api/events/{members_event['id']}", params={"access": members_event_key})).status_code == 403
    assert (await hall(flow, members_event["id"], members_event_key)).status_code == 200, "die Tafel auch bei einem Event „Nur Mitglieder“"


@pytest.mark.asyncio
async def test_a_revoked_or_expired_event_key_opens_nothing(flow):
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    event = await event_of(flow)
    await cup_of(flow, event, "Probelauf-Cup", visibility="members")
    created = await event_key(flow, event)
    flow.act_as(None)
    assert (await hall(flow, event["id"], created["token"])).status_code == 200

    # Event vor sechs Tagen zu Ende: der Schlüssel gilt noch. Vor acht Tagen: abgelaufen - wie beim Turnierbaum.
    for days, status in ((6, 200), (8, 403)):
        end = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        await flow.db.events.update_one({"id": event["id"]}, {"$set": {"end_date": end}})
        response = await hall(flow, event["id"], created["token"])
        assert response.status_code == status, (days, response.text)
    assert response.json()["detail"] == tv_display.KEY_EXPIRED
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"end_date": soon(6)}})

    flow.act_as(staff)
    listed = (await flow.get("/api/tv/keys")).json()
    assert [(row["id"], row["target_type"], row["target_title"]) for row in listed] == [(created["id"], "event", "Vereinsabend")]
    assert "token" not in json.dumps(listed) and created["token"] not in json.dumps(listed)
    revoked = await flow.delete(f"/api/tv/keys/{created['id']}")
    assert revoked.status_code == 200
    assert (await flow.get("/api/tv/keys")).json() == [], "widerrufene Schlüssel stehen nicht mehr in der Liste"
    flow.act_as(None)
    refused = await hall(flow, event["id"], created["token"])
    assert refused.status_code == 403 and refused.json()["detail"] == tv_display.KEY_INVALID
    flow.act_as(staff)
    assert (await hall(flow, event["id"], created["token"])).status_code == 403, "steht ein Schlüssel im Link, zählt nur er"


@pytest.mark.asyncio
async def test_an_event_key_opens_no_other_event_and_no_tournament_tv_and_a_tournament_key_no_event(flow):
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    event = await event_of(flow)
    other = await event_of(flow, name="Anderes Event")
    cup, _ = await cup_of(flow, event, "Probelauf-Cup", visibility="members")
    key_event = (await event_key(flow, event))["token"]
    tournament_key = await flow.post("/api/tv/keys", json={"tournament_id": cup["id"], "label": "Baum"})
    assert tournament_key.status_code == 200, tournament_key.text
    key_cup = tournament_key.json()["token"]

    flow.act_as(None)
    assert (await hall(flow, other["id"], key_event)).status_code == 403
    assert (await hall(flow, "gibt-es-nicht", key_event)).status_code == 403
    assert (await hall(flow, event["id"], key_cup)).status_code == 403, "ein Turnier-Schlüssel öffnet kein Event"
    assert (await flow.get(f"/api/tournaments/{cup['id']}/bracket/display", params={"key": key_event})).status_code == 403, \
        "ein Event-Schlüssel öffnet keinen Turnierbaum-TV"
    assert (await flow.get(f"/api/tournaments/{cup['id']}/live-queue", params={"key": key_event})).status_code == 403


@pytest.mark.asyncio
async def test_a_key_belongs_to_exactly_one_tournament_or_one_event_and_only_admins_create_it(flow):
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    event = await event_of(flow)
    cup, _ = await cup_of(flow, event, "Probelauf-Cup")
    for body in ({"label": "x"}, {"tournament_id": cup["id"], "event_id": event["id"]}, {"event_id": ""}, {"event_id": None}):
        response = await flow.post("/api/tv/keys", json=body)
        assert response.status_code == 422, (body, response.text)
    assert (await flow.post("/api/tv/keys", json={"event_id": "gibt-es-nicht"})).status_code == 404
    assert await flow.db.access_links.count_documents({}) == 0

    for role in ("player", "moderator"):
        flow.act_as(await flow.add_user(role=role))
        assert (await flow.post("/api/tv/keys", json={"event_id": event["id"]})).status_code == 403, role
    flow.act_as(None)
    assert (await flow.post("/api/tv/keys", json={"event_id": event["id"]})).status_code == 401

    # Die allgemeinen Speziallinks können auch für Events keinen TV-Schlüssel anlegen.
    flow.act_as(staff)
    refused = await flow.post("/api/access-links", json={"target_type": "event", "target_id": event["id"], "grants": ["display"]})
    assert refused.status_code == 422
    # Gefiltert nach Event stehen nur dessen Schlüssel da.
    created = await event_key(flow, event)
    await flow.post("/api/tv/keys", json={"tournament_id": cup["id"]})
    assert [row["id"] for row in (await flow.get("/api/tv/keys", params={"event_id": event["id"]})).json()] == [created["id"]]


@pytest.mark.asyncio
async def test_event_keys_only_for_events_the_event_page_could_show(flow):
    """Wie die Event-Seite höchstens „Nur Mitglieder“: für Entwürfe und interne Events gibt es keinen Schlüssel, und ein
    Schlüssel zeigt nichts mehr, sobald sein Event Entwurf oder intern wird - auch nicht dessen Stationen."""
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    for fields in ({"status": "draft"}, {"visibility": "internal"}):
        refused = await flow.post("/api/tv/keys", json={"event_id": (await event_of(flow, **fields))["id"]})
        assert refused.status_code == 400, (fields, refused.text)
    assert await flow.db.access_links.count_documents({}) == 0
    assert (await flow.post("/api/tv/keys", json={"event_id": (await event_of(flow, visibility="members"))["id"]})).status_code == 200

    event = await event_of(flow)
    await cup_of(flow, event, "Probelauf-Cup", visibility="members")
    beamer = {"id": new_id(), "name": "Beamer", "device_type": "beamer", "event_id": event["id"], "status": "free"}
    await flow.db.stations.insert_one(dict(beamer))
    token = (await event_key(flow, event))["token"]
    flow.act_as(None)
    assert (await hall(flow, event["id"], token)).status_code == 200
    for fields in ({"status": "draft"}, {"visibility": "internal"}):
        await flow.db.events.update_one({"id": event["id"]}, {"$set": {"status": "live", "visibility": "public", **fields}})
        refused = await hall(flow, event["id"], token)
        assert refused.status_code == 403 and refused.json()["detail"] == tv_display.KEY_INVALID, fields
        stations = await flow.get("/api/stations", params={"event_id": event["id"], "key": token})
        assert stations.json() == [], fields
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"status": "live", "visibility": "public"}})
    assert (await hall(flow, event["id"], token)).status_code == 200


@pytest.mark.asyncio
async def test_stations_of_tournaments_the_hall_does_not_show_stay_off_it(flow):
    """Eine Station, die am Event und an einem Turnier hängt, das die Tafel nicht zeigt (intern, Entwurf, nicht
    öffentlich), steht nicht auf der Tafel - auch nicht über das Event. Stationen nur am Event bleiben."""
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    event = await event_of(flow)
    shown_cup, _ = await cup_of(flow, event, "Probelauf-Cup", visibility="members")
    internal_cup, _ = await cup_of(flow, event, "Intern-Test", visibility="internal")
    draft = await flow.create_tournament(title="Entwurf", event_id=event["id"], status="draft")
    hidden_cup, _ = await cup_of(flow, event, "Nicht öffentlich", is_public=False)
    rows = [
        {"id": new_id(), "name": "Switch 1", "device_type": "switch2", "status": "free", "event_id": event["id"], "tournament_id": shown_cup["id"]},
        {"id": new_id(), "name": "PC intern", "device_type": "pc", "status": "busy", "event_id": event["id"], "tournament_id": internal_cup["id"]},
        {"id": new_id(), "name": "PC Entwurf", "device_type": "pc", "status": "free", "event_id": event["id"], "tournament_id": draft["id"]},
        {"id": new_id(), "name": "PC versteckt", "device_type": "pc", "status": "free", "event_id": event["id"], "tournament_id": hidden_cup["id"]},
        {"id": new_id(), "name": "Beamer", "device_type": "beamer", "status": "free", "event_id": event["id"]},
    ]
    await flow.db.stations.insert_many([dict(row) for row in rows])
    token = (await event_key(flow, event))["token"]
    flow.act_as(None)
    body = (await hall(flow, event["id"], token)).json()
    assert sorted(row["name"] for row in body["stations"]) == ["Beamer", "Switch 1"]
    for hidden in (internal_cup, draft, hidden_cup):
        assert hidden["id"] not in json.dumps(body)
