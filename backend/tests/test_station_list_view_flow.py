"""Die Stationsliste (#1822, Nachtrag): Wer nicht leitet, bekommt die Anzeige-Felder (TV, Spielplan, Live-Seite) der
Stationen, deren Turnier bzw. Event er sehen darf - mit Anzeige-Schlüssel (Turnier oder Event) auch die des Schlüssels.
Turnier- und Stationsleitung sehen ihre Stationen, Admins mit dem Bereich Turniere alle, jeweils vollständig wie bisher.
"""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402

DISPLAY_FIELDS = {"id", "name", "label", "device_type", "status", "current_match_id", "current_match_type", "called_at",
                  "queue_match_ids", "tournament_id", "event_id"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def soon(hours: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()


async def station(flow, name: str, **fields) -> dict:
    doc = {"id": new_id(), "name": name, "label": name, "device_type": "switch2", "status": "free", "current_match_id": None,
           "current_match_type": None, "queue_match_ids": ["m-1"], "game_id": "g-1", "notes": f"Notiz {name}",
           "broken_since": None, "created_at": soon(), "updated_at": soon(), **fields}
    await flow.db.stations.insert_one(dict(doc))
    return doc


async def setting(flow):
    """Ein Event mit einem öffentlichen Cup, einem Cup „Nur Mitglieder“ und einer Station am Event selbst; dazu ein
    Event „Nur Mitglieder“ mit eigener Station und eine Station ohne Turnier und Event."""
    event = {"id": new_id(), "slug": "vereinsabend", "name": "Vereinsabend", "status": "live", "visibility": "public",
             "start_date": soon(-1), "end_date": soon(6)}
    hidden_event = {"id": new_id(), "slug": "intern", "name": "Mitgliederabend", "status": "live", "visibility": "members",
                    "start_date": soon(-1), "end_date": soon(6)}
    await flow.db.events.insert_many([dict(event), dict(hidden_event)])
    public_cup = await flow.create_tournament(title="Sofort-Cup", event_id=event["id"], status="live")
    members_cup = await flow.create_tournament(title="Probelauf-Cup", event_id=event["id"], status="live", visibility="members")
    rows = {
        "public": await station(flow, "Switch 1", tournament_id=public_cup["id"]),
        "members": await station(flow, "Switch 2", tournament_id=members_cup["id"], status="reserved", called_at=soon()),
        "event": await station(flow, "Beamer", event_id=event["id"], device_type="beamer"),
        "hidden_event": await station(flow, "Bar", event_id=hidden_event["id"]),
        "loose": await station(flow, "Lager"),
    }
    return event, hidden_event, public_cup, members_cup, rows


async def listed(flow, **params) -> dict:
    response = await flow.get("/api/stations", params=params or None)
    assert response.status_code == 200, response.text
    return {row["name"]: row for row in response.json()}


@pytest.mark.asyncio
async def test_without_login_only_display_fields_of_what_one_may_see(flow):
    event, hidden_event, public_cup, members_cup, _rows = await setting(flow)
    flow.act_as(None)
    everything = await listed(flow)
    assert set(everything) == {"Switch 1", "Beamer"}, "nur öffentliche Turniere und Events"
    for row in everything.values():
        assert set(row) <= DISPLAY_FIELDS, set(row) - DISPLAY_FIELDS
        assert "notes" not in row and "game_id" not in row and "created_at" not in row
    assert everything["Switch 1"]["queue_match_ids"] == ["m-1"], "die Stations-Ansicht braucht die Warteschlange"
    assert set(await listed(flow, tournament_id=public_cup["id"])) == {"Switch 1"}
    assert await listed(flow, tournament_id=members_cup["id"]) == {}, "leer statt Fehler"
    assert set(await listed(flow, event_id=event["id"])) == {"Beamer"}
    assert await listed(flow, event_id=hidden_event["id"]) == {}
    assert await listed(flow, tournament_id="gibt-es-nicht") == {}

    # Ein Mitglied sieht auch den Cup und das Event „Nur Mitglieder“ - aber ebenso nur die Anzeige-Felder.
    member = await flow.add_user(role="player", name="Mitglied")
    flow.act_as({**member, "is_club_member": True})
    seen = await listed(flow)
    assert set(seen) == {"Switch 1", "Switch 2", "Beamer", "Bar"}
    assert all("notes" not in row for row in seen.values())


@pytest.mark.asyncio
async def test_leads_see_everything_as_before_and_staff_their_tournament(flow):
    _event, _hidden_event, _public_cup, members_cup, rows = await setting(flow)
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    everything = await listed(flow)
    assert set(everything) == {"Switch 1", "Switch 2", "Beamer", "Bar", "Lager"}
    assert everything["Switch 2"] == rows["members"], "vollständig wie bisher"

    helper = await flow.add_user(role="player", name="Stationsleitung")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": members_cup["id"], "user_id": helper["id"],
                                                          "role": "station_manager", "scope": "tournament", "is_active": True})
    flow.act_as(helper)
    own = await listed(flow, tournament_id=members_cup["id"])
    assert own["Switch 2"] == rows["members"], "die eigene Turnierleitung sieht ihre Stationen vollständig"
    others = await listed(flow)
    assert "notes" not in others["Switch 1"] and others["Switch 2"] == rows["members"]


@pytest.mark.asyncio
async def test_a_display_key_opens_the_stations_of_its_tournament_or_event(flow):
    event, hidden_event, _public_cup, members_cup, _rows = await setting(flow)
    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung"))
    cup_key = (await flow.post("/api/tv/keys", json={"tournament_id": members_cup["id"]})).json()
    event_key = (await flow.post("/api/tv/keys", json={"event_id": event["id"]})).json()
    other_key = (await flow.post("/api/tv/keys", json={"event_id": hidden_event["id"]})).json()

    flow.act_as(None)
    with_cup_key = await listed(flow, tournament_id=members_cup["id"], key=cup_key["token"])
    assert set(with_cup_key) == {"Switch 2"} and set(with_cup_key["Switch 2"]) <= DISPLAY_FIELDS
    assert with_cup_key["Switch 2"]["status"] == "reserved" and with_cup_key["Switch 2"]["called_at"]
    assert set(await listed(flow, tournament_id=members_cup["id"], key=event_key["token"])) == {"Switch 2"}, "Event-Schlüssel: Turniere des Events"
    assert set(await listed(flow, key=event_key["token"])) == {"Switch 1", "Switch 2", "Beamer"}
    assert set(await listed(flow, key=cup_key["token"])) == {"Switch 1", "Switch 2", "Beamer"}, "dazu, was öffentlich ist"
    assert await listed(flow, tournament_id=members_cup["id"], key=other_key["token"]) == {}, "ein fremder Schlüssel öffnet nichts"
    assert await listed(flow, tournament_id=members_cup["id"], key="erfunden") == {}

    flow.act_as(await flow.add_user(role="tournament_admin", name="Turnierleitung 2"))
    revoked = await flow.delete(f"/api/tv/keys/{cup_key['id']}")
    assert revoked.status_code == 200
    flow.act_as(None)
    assert await listed(flow, tournament_id=members_cup["id"], key=cup_key["token"]) == {}, "widerrufen: nichts mehr"
