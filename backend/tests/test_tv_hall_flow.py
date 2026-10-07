"""TV III (#1121-#1127): was der Turniertag in der Halle am Bildschirm braucht - und später die App.

- Grundwerte: Wiedergabeliste (Folien, Reihenfolge, 3 bis 120 Sekunden), Aufrufe (Gong, Zeit zum Antreten), Zahlen
  zwischendurch, Sponsoren am TV (Moment, „präsentiert von“, Laufband), Streckenwechsel 20 bis 120 Sekunden.
- „aufgerufen um“: beim Reservieren gesetzt, beim Start, Freigeben oder Ergebnis wieder weg - an Station und Spiel.
- „Pause bis“: nur die Turnierleitung, nur beim Status „Pausiert“, beim Weiterspielen gelöscht.
- Sponsor je Runde: nur die Turnierleitung, nur Sponsoren mit „TV / Anzeige“.
- Der Anzeige-Schlüssel liefert davon, was der TV zeigt - Namen und Stand des Check-ins, aber nie Konten oder Notizen.
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


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def bracket_of(flow, count=4, **fields):
    staff = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(count, **fields)
    response = await flow.post(f"/api/tournaments/{tournament['id']}/bracket/from-format?preview=false")
    assert response.status_code == 200, response.text
    await flow.start(tournament)
    return staff, tournament, users, registrations


async def station_for(flow, tournament, name="PC 3"):
    station = {"id": new_id(), "name": name, "device_type": "pc", "tournament_id": tournament["id"], "status": "free",
               "current_match_id": None, "queue_match_ids": []}
    await flow.db.stations.insert_one(dict(station))
    return station


async def playable_match(flow, tournament):
    return next(row for row in await flow.matches(tournament) if all(slot.get("registration_id") for slot in row["slots"]))


async def display_key(flow, tournament):
    response = await flow.post("/api/tv/keys", json={"tournament_id": tournament["id"], "label": "Beamer Halle"})
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def show_tv(flow, tournament, token):
    response = await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display", params={"key": token})
    assert response.status_code == 200, response.text
    return response.json()


async def as_organizer(flow, tournament, role="organizer"):
    user = await flow.add_user(role="player", name="Turnierleitung vor Ort")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": user["id"],
                                                          "role": role, "scope": "tournament", "is_active": True})
    return user


# ---------------------------------------------------------------- Grundwerte

@pytest.mark.asyncio
async def test_new_defaults_are_fabians_pick_and_wrong_values_are_refused(flow):
    flow.act_as(None)
    settings = (await flow.get("/api/tv/settings")).json()["settings"]
    assert [entry["slide"] for entry in settings["playlist"]] == ["tree", "live", "calls", "sponsor", "stats"]
    assert [entry["seconds"] for entry in settings["playlist"]] == [12, 8, 8, 6, 8], "Baum 12 s · Live 8 s · Aufrufe 8 s · Sponsor 6 s"
    assert settings["call_sound"] is False, "Gong beim Aufruf: Standard aus"
    assert settings["report_minutes"] == 2, "Zeit zum Antreten: 2 Minuten"
    assert settings["stats"] is True and settings["stats_every"] == 10, "Zahlen zwischendurch: an, höchstens alle 10 Minuten"
    assert (settings["sponsor_moment"], settings["sponsor_every"], settings["sponsor_presented"], settings["sponsor_ticker"]) == (True, 3, True, False), \
        "Sponsoren nach Wahl C: Moment an (alle 3 Minuten), „präsentiert von“ an, Laufband aus"
    assert settings["track_seconds"] == 45, "Streckenwechsel wie bisher alle 45 Sekunden"

    flow.act_as(await flow.add_user(role="tournament_admin"))
    for body in (
        {"playlist": []},
        {"playlist": [{"slide": "tree", "seconds": 2}]},
        {"playlist": [{"slide": "tree", "seconds": 121}]},
        {"playlist": [{"slide": "tree", "seconds": "12"}]},
        {"playlist": [{"slide": "werbung", "seconds": 12}]},
        {"playlist": [{"slide": "tree", "seconds": 12}, {"slide": "tree", "seconds": 8}]},
        {"playlist": [{"slide": "tree", "seconds": 12, "extra": 1}]},
        {"playlist": "tree"},
        {"track_seconds": 19}, {"track_seconds": 121}, {"track_seconds": 45.5}, {"track_seconds": True},
        {"report_minutes": 0}, {"report_minutes": 31}, {"stats_every": 0}, {"sponsor_every": 61},
        {"call_sound": "an"}, {"sponsor_ticker": 1}, {"stats": None, "laufband": True},
    ):
        response = await flow.put("/api/tv/settings", json=body)
        assert response.status_code == 422, (body, response.text)
    assert await flow.db.settings.find_one({"id": tv_display.SETTINGS_ID}) is None, "nichts Falsches gespeichert"


@pytest.mark.asyncio
async def test_new_values_are_saved_by_the_tournaments_area_and_read_without_login(flow):
    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.put("/api/tv/settings", json={"track_seconds": 30})).status_code == 403
    flow.act_as(await flow.add_user(role="tournament_admin"))
    one_slide = [{"slide": "calls", "seconds": 3}]
    saved = await flow.put("/api/tv/settings", json={"playlist": one_slide, "call_sound": True, "report_minutes": 5, "stats": False,
                                                     "stats_every": 15, "sponsor_moment": False, "sponsor_every": 7,
                                                     "sponsor_presented": False, "sponsor_ticker": True, "track_seconds": 120})
    assert saved.status_code == 200, saved.text
    flow.act_as(None)
    settings = (await flow.get("/api/tv/settings")).json()["settings"]
    assert settings["playlist"] == one_slide
    assert (settings["call_sound"], settings["report_minutes"], settings["stats"], settings["stats_every"]) == (True, 5, False, 15)
    assert (settings["sponsor_moment"], settings["sponsor_every"], settings["sponsor_presented"], settings["sponsor_ticker"]) == (False, 7, False, True)
    assert settings["track_seconds"] == 120
    # Ein kaputt gespeicherter Wert zählt als Standard - der TV läuft weiter.
    await flow.db.settings.update_one({"id": tv_display.SETTINGS_ID}, {"$set": {"playlist": [{"slide": "tree"}], "track_seconds": 5}})
    settings = (await flow.get("/api/tv/settings")).json()["settings"]
    assert settings["playlist"] == tv_display.DEFAULTS["playlist"] and settings["track_seconds"] == 45
    # Der Standard bleibt unberührt, auch wenn jemand die Antwort verändert.
    settings["playlist"].append({"slide": "x", "seconds": 1})
    assert len(tv_display.DEFAULTS["playlist"]) == 5


# ---------------------------------------------------------------- Aufrufe (#1122)

@pytest.mark.asyncio
async def test_reserving_calls_the_match_and_starting_ends_the_call(flow):
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    station = await station_for(flow, tournament)
    match = await playable_match(flow, tournament)
    token = await display_key(flow, tournament)

    before = datetime.now(timezone.utc)
    assert (await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")).status_code == 200
    stored_station = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    stored_match = await flow.reload(match)
    assert stored_station["status"] == "reserved" and stored_station["called_at"]
    assert stored_match["called_at"] == stored_station["called_at"], "Station und Spiel nennen dieselbe Zeit"
    assert datetime.fromisoformat(stored_match["called_at"]) >= before - timedelta(seconds=1)
    # Noch einmal zugewiesen: die erste Zeit bleibt, der Countdown springt nicht.
    first = stored_match["called_at"]
    assert (await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")).status_code == 200
    assert (await flow.reload(match))["called_at"] == first

    # Der TV mit Schlüssel sieht den Aufruf - ohne Neuladen über den Änderungsstrom „stations“.
    flow.act_as(None)
    shown = next(row for row in (await show_tv(flow, tournament, token))["matches_v2"] if row["id"] == match["id"])
    assert shown["called_at"] == first and shown["station_id"] == station["id"]
    # Die Stationsliste (öffentlich, wie bisher) nennt den Aufruf auch.
    listed = (await flow.get("/api/stations", params={"tournament_id": tournament["id"]})).json()
    assert listed[0]["called_at"] == first

    flow.act_as(staff)
    assert (await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}", params={"start_now": "true"})).status_code == 200
    stored_station = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    stored_match = await flow.reload(match)
    assert stored_station["status"] == "busy" and "called_at" not in stored_station
    assert stored_match["status"] == "in_progress" and "called_at" not in stored_match and stored_match["started_at"]


@pytest.mark.asyncio
async def test_releasing_or_a_result_ends_the_call(flow):
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    station = await station_for(flow, tournament)
    match = await playable_match(flow, tournament)
    assert (await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")).status_code == 200
    assert (await flow.post(f"/api/stations/{station['id']}/clear")).status_code == 200
    assert "called_at" not in await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    assert "called_at" not in await flow.reload(match)

    # Aufgerufen, nie gestartet, Ergebnis eingetragen: Station frei, Aufruf weg.
    assert (await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")).status_code == 200
    ranking = [{"registration_id": match["slots"][0]["registration_id"], "rank": 1, "score": 2},
               {"registration_id": match["slots"][1]["registration_id"], "rank": 2, "score": 0}]
    result = await flow.post(f"/api/matches/{match['id']}/result", json={"results": ranking})
    assert result.status_code == 200, result.text
    stored_station = await flow.db.stations.find_one({"id": station["id"]}, {"_id": 0})
    assert stored_station["status"] == "free" and "called_at" not in stored_station
    assert "called_at" not in await flow.reload(match)


@pytest.mark.asyncio
async def test_changing_the_station_by_hand_ends_the_call(flow):
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    station = await station_for(flow, tournament)
    match = await playable_match(flow, tournament)
    assert (await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")).status_code == 200
    response = await flow.put(f"/api/stations/{station['id']}", json={"status": "broken"})
    assert response.status_code == 200, response.text
    assert "called_at" not in response.json()
    assert "called_at" not in await flow.reload(match)

    # Über die Matchplanung gestartet: auch dann ist der Aufruf vorbei.
    other = await station_for(flow, tournament, "PC 4")
    assert (await flow.post(f"/api/stations/{other['id']}/assign/{match['id']}")).status_code == 200
    assert (await flow.reload(match))["called_at"]
    patched = await flow.patch(f"/api/matches/{match['id']}", json={"status": "in_progress"})
    assert patched.status_code == 200, patched.text
    assert "called_at" not in await flow.reload(match)


def keys_ending_in_by(value) -> list[str]:
    """Alle Schlüssel „…_by“ (wer etwas getan hat) - irgendwo in einer Antwort."""
    if isinstance(value, dict):
        return [key for key in value if key.endswith("_by")] + [found for item in value.values() for found in keys_ending_in_by(item)]
    if isinstance(value, list):
        return [found for item in value for found in keys_ending_in_by(item)]
    return []


@pytest.mark.asyncio
async def test_players_and_the_tv_see_call_and_pause_but_not_who_made_them(flow):
    """Spielseiten zeigen Internes nur der Turnierleitung (#1141). Station, „aufgerufen um“ und „Pause bis“ brauchen
    Spieler, Gäste, der TV und später die App („Du bist dran an PC 3“) - wer aufgerufen oder pausiert hat, nicht."""
    staff, tournament, users, registrations = await bracket_of(flow, 4)
    station = await station_for(flow, tournament)
    match = await playable_match(flow, tournament)
    token = await display_key(flow, tournament)
    assert (await flow.post(f"/api/stations/{station['id']}/assign/{match['id']}")).status_code == 200
    called_at = (await flow.reload(match))["called_at"]
    # Internes, wie es Abläufe hineinschreiben - auch ein „wer hat aufgerufen“, falls es später jemand speichert.
    await flow.db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "admin_note": "Interne Notiz", "called_by": staff["id"], "updated_by": staff["id"]}})
    until = (datetime.now(timezone.utc) + timedelta(minutes=15)).replace(microsecond=0)
    paused = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused", "paused_until": until.isoformat()})
    assert paused.status_code == 200, paused.text

    owners = {reg["id"]: reg.get("user_id") for reg in registrations}
    player = next(user for user in users if user["id"] == owners[match["slots"][0]["registration_id"]])
    for viewer in (player, None):
        flow.act_as(viewer)
        detail = await flow.get(f"/api/matches/{match['id']}")
        page = await flow.get(f"/api/matches/{match['id']}/page")
        assert detail.status_code == 200 and page.status_code == 200, (detail.text, page.text)
        for shown in (detail.json(), page.json()["match"]):
            assert shown["called_at"] == called_at and shown["station_id"] == station["id"], "Aufruf und Station bleiben sichtbar"
            assert "admin_note" not in shown and keys_ending_in_by(shown) == [], "wer aufgerufen hat, bleibt intern"
        assert datetime.fromisoformat(page.json()["tournament"]["paused_until"]) == until, "„Pause bis“ für Spieler und App"

    flow.act_as(None)
    tv = await show_tv(flow, tournament, token)
    shown = next(row for row in tv["matches_v2"] if row["id"] == match["id"])
    assert shown["called_at"] == called_at and shown["station_name"] == "PC 3"
    assert datetime.fromisoformat(tv["tournament"]["paused_until"]) == until
    assert keys_ending_in_by(tv) == [] and staff["id"] not in json.dumps(tv) and "Interne Notiz" not in json.dumps(tv)

    flow.act_as(staff)
    assert (await flow.get(f"/api/matches/{match['id']}")).json()["called_by"] == staff["id"], "die Turnierleitung sieht alles"


# ---------------------------------------------------------------- Pause bis (#1123)

@pytest.mark.asyncio
async def test_pause_until_is_saved_with_the_pause_and_cleared_when_play_goes_on(flow):
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    token = await display_key(flow, tournament)
    until = (datetime.now(timezone.utc) + timedelta(minutes=15)).replace(microsecond=0)
    paused = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused", "paused_until": until.isoformat()})
    assert paused.status_code == 200, paused.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["status"] == "paused" and datetime.fromisoformat(stored["paused_until"]) == until
    flow.act_as(None)
    assert datetime.fromisoformat((await show_tv(flow, tournament, token))["tournament"]["paused_until"]) == until

    # Während der Pause verschieben, dann ohne Uhrzeit („Kurze Pause“).
    flow.act_as(staff)
    later = until + timedelta(minutes=5)
    moved = await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": later.isoformat()})
    assert moved.status_code == 200, moved.text
    assert datetime.fromisoformat((await flow.db.tournaments.find_one({"id": tournament["id"]}))["paused_until"]) == later
    assert (await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": None})).json() == {"paused_until": None}
    assert "paused_until" not in await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})

    await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": later.isoformat()})
    resumed = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "live"})
    assert resumed.status_code == 200, resumed.text
    stored = await flow.db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0})
    assert stored["status"] == "live" and "paused_until" not in stored, "beim Weiterspielen gelöscht"
    refused = await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": later.isoformat()})
    assert refused.status_code == 409, "nur während der Pause"
    audit = await flow.db.audit_logs.find_one({"action": "tournament.pause_until"}, {"_id": 0})
    assert audit and audit["actor_id"] == staff["id"]


@pytest.mark.asyncio
async def test_only_the_tournament_leadership_sets_pause_until_and_only_sensible_times(flow):
    staff, tournament, _users, registrations = await bracket_of(flow, 4)
    until = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()
    for wrong in ("morgen", (datetime.now(timezone.utc) + timedelta(hours=25)).isoformat()):
        response = await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused", "paused_until": wrong})
        assert response.status_code == 422, wrong
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["status"] == "live", "nichts geändert"

    flow.act_as(await flow.add_user(role="player", name="Spieler Fremd"))
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused", "paused_until": until})).status_code == 403
    flow.act_as(staff)
    other, _more, _regs = await flow.with_participants(2)
    flow.act_as(await as_organizer(flow, other))
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused", "paused_until": until})).status_code == 403, \
        "Turnierleitung eines anderen Turniers"
    flow.act_as(await as_organizer(flow, tournament, role="scorekeeper"))
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused", "paused_until": until})).status_code == 403, \
        "Ergebnis-Eintragen reicht nicht"
    flow.act_as(await as_organizer(flow, tournament))
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/status", json={"status": "paused", "paused_until": until})).status_code == 200
    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.put(f"/api/tournaments/{tournament['id']}/pause", json={"paused_until": None})).status_code == 403
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["paused_until"]


# ---------------------------------------------------------------- Sponsor je Runde (#1125)

@pytest.mark.asyncio
async def test_round_sponsors_only_by_the_leadership_and_only_tv_sponsors(flow):
    await flow.db.sponsors.insert_many([
        {"id": "sp-tv", "name": "Pixelwerk", "tier": "gold", "logo_url": "/uploads/pixelwerk.png", "show_on_tv": True, "is_active": True},
        {"id": "sp-web", "name": "Nur Website", "tier": "gold", "logo_url": "/uploads/web.png", "show_on_tv": False, "is_active": True},
        {"id": "sp-old", "name": "Ausgelaufen", "tier": "gold", "logo_url": "/uploads/old.png", "show_on_tv": True, "is_active": True,
         "contract_end": "2020-01-01"},
    ])
    staff, tournament, _users, _registrations = await bracket_of(flow, 4)
    token = await display_key(flow, tournament)
    match = await playable_match(flow, tournament)
    row = {"stage_id": match["stage_id"], "section": match.get("section") or "WB", "round": 1, "sponsor_id": "sp-tv"}
    url = f"/api/tournaments/{tournament['id']}/round-sponsors"

    for sponsor in ("sp-web", "sp-old", "gibt-es-nicht"):
        refused = await flow.put(url, json={"items": [{**row, "sponsor_id": sponsor}]})
        assert refused.status_code == 422, sponsor
    assert (await flow.put(url, json={"items": [row, {**row}]})).status_code == 422, "jede Runde nur einmal"
    assert (await flow.put(url, json={"items": [{**row, "round": 0}]})).status_code == 422

    saved = await flow.put(url, json={"items": [row]})
    assert saved.status_code == 200, saved.text
    expected = [{"stage_id": match["stage_id"], "section": (match.get("section") or "WB").upper(), "round": 1, "sponsor_id": "sp-tv"}]
    assert saved.json()["round_sponsors"] == expected
    flow.act_as(None)
    assert (await show_tv(flow, tournament, token))["tournament"]["round_sponsors"] == expected

    flow.act_as(await flow.add_user(role="player"))
    assert (await flow.put(url, json={"items": []})).status_code == 403
    flow.act_as(await as_organizer(flow, tournament, role="station_manager"))
    assert (await flow.put(url, json={"items": []})).status_code == 403, "Stationsbetreuung ist nicht die Turnierleitung"
    flow.act_as(staff)
    assert (await flow.put(url, json={"items": []})).json() == {"round_sponsors": []}
    assert (await flow.db.tournaments.find_one({"id": tournament["id"]}))["round_sponsors"] == []


# ---------------------------------------------------------------- Check-in und Anmeldung (#1123)

@pytest.mark.asyncio
async def test_the_key_shows_check_in_names_and_free_places_but_no_accounts(flow):
    staff = await flow.add_user(role="tournament_admin")
    flow.act_as(staff)
    tournament, users, registrations = await flow.with_participants(4, status="check_in",
                                                                    check_in_until=(datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat())
    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"max_participants": 8}})
    await flow.db.tournament_registrations.update_one({"id": registrations[0]["id"]}, {"$set": {"status": "checked_in", "notes": "geheim"}})
    pending_user = await flow.add_user(name="Noch offen")
    await flow.register(tournament, pending_user, status="pending")
    waiting_user = await flow.add_user(name="Warteliste")
    await flow.register(tournament, waiting_user, status="waitlist")
    token = await display_key(flow, tournament)

    flow.act_as(None)
    body = await show_tv(flow, tournament, token)
    names = {reg["display_name"]: reg["status"] for reg in body["registrations"]}
    assert names == {"Spieler 1": "checked_in", "Spieler 2": "approved", "Spieler 3": "approved", "Spieler 4": "approved"}, \
        "alle Bestätigten mit Stand - ohne Offene und Warteliste"
    assert body["seats"] == {"taken": 5, "capacity": 8}, "offene Anmeldungen belegen einen Platz, die Warteliste nicht"
    assert body["tournament"]["check_in_until"] and body["tournament"]["max_participants"] == 8
    text = json.dumps(body)
    for user in [*users, pending_user, waiting_user]:
        assert user["id"] not in text and user["email"] not in text
    assert "user_id" not in text and "geheim" not in text and "notes" not in text
