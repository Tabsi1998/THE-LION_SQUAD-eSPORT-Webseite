"""Event als Klammer in der Verwaltung (#1371): Turniere und Fast Laps werden im Event angelegt oder dort hinzugefügt -
das Turnier- und das Fast-Lap-Formular verbinden nicht mehr. Neu Angelegtes übernimmt Ort, Tag, Partner und
Discord-Einstellungen des Events; der Tag muss im Zeitraum des Events liegen. Event-Sponsoren legt nur noch die
Redaktion beim Sponsor fest. Alles nur für die Turnierleitung mit Zwei-Faktor - die Organisation eines Turniers darf
nichts zuordnen."""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow, new_id  # noqa: E402

DAY_1 = "2026-11-14T10:00:00+01:00"
DAY_2_EVENING = "2026-11-15T19:00:00+01:00"
END = "2026-11-15T23:00:00+01:00"
AFTER = "2026-11-17T18:00:00+01:00"


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow):
    lead = await flow.add_user(role="tournament_admin", name="leitung")
    await flow.db.games.insert_one({"id": "g1", "name": "Mario Kart 8", "slug": "mario-kart-8"})
    await flow.db.partners.insert_one({"id": "p1", "name": "Gamers Heaven", "is_active": True})
    flow.act_as(lead)
    response = await flow.post("/api/events", json={
        "name": "Herbst-LAN", "status": "scheduled", "visibility": "public", "start_date": DAY_1, "end_date": END,
        "location": "Vereinsheim", "city": "Telfs", "partner_ids": ["p1"], "discord_skip": True, "discord_registration": False,
    })
    assert response.status_code == 200, response.text
    return lead, response.json()


async def in_event(flow, event, **fields):
    return await flow.post(f"/api/events/{event['id']}/tournaments", json={"title": "Kart-Cup", "game_id": "g1", **fields})


@pytest.mark.asyncio
async def test_new_tournament_in_event_takes_place_day_partners_and_discord_settings(flow):
    _, event = await setup(flow)
    response = await in_event(flow, event)
    assert response.status_code == 200, response.text
    cup = response.json()
    assert cup["event_id"] == event["id"]
    assert cup["location"] == "Vereinsheim · Telfs"
    assert cup["partner_ids"] == ["p1"]
    assert cup["discord_skip"] is True and cup["discord_registration"] is False
    assert cup["event_mode"] == "local"
    assert cup["start_date"].startswith("2026-11-14")

    # Was das Formular ausdrücklich setzt, bleibt - auch ein anderer Tag innerhalb des Events.
    own = await in_event(flow, event, title="Abend-Cup", location="Halle B", start_date=DAY_2_EVENING)
    assert own.status_code == 200, own.text
    assert own.json()["location"] == "Halle B"

    program = await flow.get(f"/api/events/{event['id']}/program")
    assert program.status_code == 200, program.text
    data = program.json()
    assert [row["title"] for row in data["tournaments"]] == ["Kart-Cup", "Abend-Cup"]
    assert data["event"]["window"] == "vom 14.11.2026 bis 15.11.2026"
    assert data["defaults"]["tournament"]["location"] == "Vereinsheim · Telfs"


@pytest.mark.asyncio
async def test_day_outside_the_event_is_refused(flow):
    _, event = await setup(flow)
    late = await in_event(flow, event, start_date=AFTER)
    assert late.status_code == 400
    assert "17.11.2026" in late.json()["detail"] and "vom 14.11.2026 bis 15.11.2026" in late.json()["detail"]

    # Eine Fast Lap darf vorher beginnen, solange sie in das Event hineinreicht.
    lap = await flow.post(f"/api/events/{event['id']}/fastlaps", json={
        "title": "LAN-Lap", "start_date": "2026-11-01T10:00:00+01:00", "end_date": DAY_1,
    })
    assert lap.status_code == 200, lap.text
    assert lap.json()["event_id"] == event["id"]
    gone = await flow.post(f"/api/events/{event['id']}/fastlaps", json={
        "title": "Zu früh", "start_date": "2026-11-01T10:00:00+01:00", "end_date": "2026-11-02T10:00:00+01:00",
    })
    assert gone.status_code == 400


@pytest.mark.asyncio
async def test_tournament_and_fastlap_forms_do_not_change_the_event(flow):
    _, event = await setup(flow)
    cup = (await in_event(flow, event)).json()
    other = (await flow.post("/api/events", json={"name": "Winter-LAN", "start_date": DAY_1})).json()

    moved = await flow.patch(f"/api/tournaments/{cup['id']}", json={"event_id": other["id"]})
    assert moved.status_code == 400
    assert "im Event" in moved.json()["detail"]
    dropped = await flow.patch(f"/api/tournaments/{cup['id']}", json={"event_id": None})
    assert dropped.status_code == 400
    # Derselbe Wert (ganzes Formular geschickt) stört nicht.
    same = await flow.patch(f"/api/tournaments/{cup['id']}", json={"event_id": event["id"], "title": "Kart-Cup 2026"})
    assert same.status_code == 200, same.text
    assert same.json()["event_id"] == event["id"]

    lap = (await flow.post("/api/f1/challenges", json={"title": "Solo-Lap"})).json()
    refused = await flow.patch(f"/api/f1/challenges/{lap['id']}", json={"event_id": event["id"]})
    assert refused.status_code == 400
    assert (await flow.db.f1_challenges.find_one({"id": lap["id"]}))["event_id"] is None


@pytest.mark.asyncio
async def test_add_existing_and_remove_again_in_the_event(flow):
    _, event = await setup(flow)
    lap = (await flow.post("/api/f1/challenges", json={"title": "Solo-Lap", "start_date": DAY_1})).json()
    view = (await flow.get(f"/api/events/{event['id']}/program")).json()
    assert lap["id"] in [row["id"] for row in view["candidates"]["fastlaps"]]

    added = await flow.post(f"/api/events/{event['id']}/program", json={"kind": "fastlap", "item_id": lap["id"]})
    assert added.status_code == 200, added.text
    view = (await flow.get(f"/api/events/{event['id']}/program")).json()
    assert [row["id"] for row in view["fastlaps"]] == [lap["id"]]
    assert lap["id"] not in [row["id"] for row in view["candidates"]["fastlaps"]]

    other = (await flow.post("/api/events", json={"name": "Winter-LAN", "start_date": DAY_1})).json()
    taken = await flow.post(f"/api/events/{other['id']}/program", json={"kind": "fastlap", "item_id": lap["id"]})
    assert taken.status_code == 409
    assert "Herbst-LAN" in taken.json()["detail"]

    removed = await flow.delete(f"/api/events/{event['id']}/program/fastlap/{lap['id']}")
    assert removed.status_code == 200
    assert (await flow.db.f1_challenges.find_one({"id": lap["id"]}))["event_id"] is None
    again = await flow.delete(f"/api/events/{event['id']}/program/fastlap/{lap['id']}")
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_only_tournament_leads_with_second_factor_may_link(flow):
    lead, event = await setup(flow)
    cup = (await in_event(flow, event)).json()
    loose = (await flow.post("/api/tournaments", json={"title": "Freies Turnier", "game_id": "g1", "start_date": DAY_1})).json()

    organizer = await flow.add_user(name="orga")
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": loose["id"], "user_id": organizer["id"], "role": "organizer", "scope": "tournament", "is_active": True,
    })
    moderator = await flow.add_user(role="moderator", name="moderation")
    player = await flow.add_user(name="spieler")
    no_second_factor = await flow.add_user(role="tournament_admin", name="ohne-2fa")
    no_second_factor.update({"mfa_enabled": False, "auth_mfa_verified": False})
    for actor in (organizer, moderator, player, no_second_factor):
        flow.act_as(actor)
        assert (await flow.get(f"/api/events/{event['id']}/program")).status_code == 403
        assert (await flow.post(f"/api/events/{event['id']}/program", json={"kind": "tournament", "item_id": loose["id"]})).status_code == 403
        refused = await flow.delete(f"/api/events/{event['id']}/program/tournament/{cup['id']}")
        assert refused.status_code == 403
        assert (await in_event(flow, event, title="Heimlich")).status_code == 403
    assert (await flow.db.tournaments.find_one({"id": loose["id"]})).get("event_id") is None

    flow.act_as(lead)
    assert (await flow.post(f"/api/events/{event['id']}/program", json={"kind": "tournament", "item_id": loose["id"]})).status_code == 200


@pytest.mark.asyncio
async def test_event_sponsors_come_from_the_sponsor_only(flow):
    lead, event = await setup(flow)
    await flow.db.sponsors.insert_many([
        {"id": "s-all", "name": "Alle-Events GmbH", "is_active": True, "show_on_events": True, "event_ids": []},
        {"id": "s-this", "name": "Nur Herbst", "is_active": True, "show_on_events": True, "event_ids": [event["id"]]},
        {"id": "s-other", "name": "Nur Winter", "is_active": True, "show_on_events": True, "event_ids": ["anderes"]},
        {"id": "s-off", "name": "Ohne Events", "is_active": True, "show_on_events": False},
    ])
    view = (await flow.get(f"/api/events/{event['id']}/program")).json()
    assert sorted(row["name"] for row in view["sponsors"]["items"]) == ["Alle-Events GmbH", "Nur Herbst"]
    assert view["sponsors"]["own_choice"] is False

    refused = await flow.patch(f"/api/events/{event['id']}", json={"sponsor_ids": ["s-all"]})
    assert refused.status_code == 400
    assert "beim Sponsor" in refused.json()["detail"]
    refused_new = await flow.post("/api/events", json={"name": "Mit Auswahl", "sponsor_ids": ["s-all"]})
    assert refused_new.status_code == 400

    # Eine alte Auswahl am Event gilt weiter, bis sie aufgehoben wird.
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"sponsor_ids": ["s-all"]}})
    view = (await flow.get(f"/api/events/{event['id']}/program")).json()
    assert view["sponsors"]["own_choice"] is True
    assert [row["name"] for row in view["sponsors"]["items"]] == ["Alle-Events GmbH"]
    cleared = await flow.patch(f"/api/events/{event['id']}", json={"sponsor_ids": []})
    assert cleared.status_code == 200, cleared.text
    assert (await flow.get(f"/api/events/{event['id']}/program")).json()["sponsors"]["own_choice"] is False


@pytest.mark.asyncio
async def test_visibility_words_for_the_list(flow):
    meta = (await flow.get("/api/events/meta")).json()
    assert {row["k"]: row["short"] for row in meta["visibilities"]} == {
        "public": "Alle", "community": "Community", "members": "Mitglieder", "internal": "Intern",
    }


# ---------------------------------------------------------------- Nach Codex-Prüfung

@pytest.mark.asyncio
async def test_finished_items_are_not_linked_even_by_direct_request(flow):
    _, event = await setup(flow)
    lap = (await flow.post("/api/f1/challenges", json={"title": "Alte Lap", "start_date": DAY_1})).json()
    for status in ("completed", "archived", "cancelled"):
        await flow.db.f1_challenges.update_one({"id": lap["id"]}, {"$set": {"status": status}})
        refused = await flow.post(f"/api/events/{event['id']}/program", json={"kind": "fastlap", "item_id": lap["id"]})
        assert refused.status_code == 400, status
        assert "nicht mehr ins Programm" in refused.json()["detail"]
    assert (await flow.db.f1_challenges.find_one({"id": lap["id"]}))["event_id"] is None


@pytest.mark.asyncio
async def test_a_tournament_with_registrations_stays_in_the_event(flow):
    _, event = await setup(flow)
    cup = (await in_event(flow, event)).json()
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": cup["id"], "user_id": "u1", "status": "pending"})
    refused = await flow.delete(f"/api/events/{event['id']}/program/tournament/{cup['id']}")
    assert refused.status_code == 409
    assert "Anmeldungen" in refused.json()["detail"]
    assert (await flow.db.tournaments.find_one({"id": cup["id"]}))["event_id"] == event["id"]

    await flow.db.tournament_registrations.update_many({"tournament_id": cup["id"]}, {"$set": {"status": "cancelled"}})
    freed = await flow.delete(f"/api/events/{event['id']}/program/tournament/{cup['id']}")
    assert freed.status_code == 200


@pytest.mark.asyncio
async def test_two_events_grabbing_the_same_item_at_once_one_wins(flow, monkeypatch):
    import routes.event_program_routes as program_routes

    _, event = await setup(flow)
    other = (await flow.post("/api/events", json={"name": "Parallel-LAN", "start_date": DAY_1, "end_date": END})).json()
    lap = (await flow.post("/api/f1/challenges", json={"title": "Begehrte Lap", "start_date": DAY_1})).json()
    gate = InterleavedReads(flow.db, "f1_challenges")
    monkeypatch.setattr(program_routes, "get_db", lambda: gate)
    first, second = await asyncio.gather(
        flow.post(f"/api/events/{event['id']}/program", json={"kind": "fastlap", "item_id": lap["id"]}),
        flow.post(f"/api/events/{other['id']}/program", json={"kind": "fastlap", "item_id": lap["id"]}),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    winner = event["id"] if first.status_code == 200 else other["id"]
    assert (await flow.db.f1_challenges.find_one({"id": lap["id"]}))["event_id"] == winner


@pytest.mark.asyncio
async def test_recap_draft_only_after_the_event(flow):
    _, event = await setup(flow)
    early = await flow.post(f"/api/events/{event['id']}/recap-draft")
    assert early.status_code == 400
    assert "vorbei" in early.json()["detail"]
    assert await flow.db.news_posts.count_documents({}) == 0

    past = (await flow.post("/api/events", json={
        "name": "Sommer-LAN", "status": "scheduled", "start_date": "2026-07-10T10:00:00+02:00", "end_date": "2026-07-12T16:00:00+02:00",
    })).json()
    made = await flow.post(f"/api/events/{past['id']}/recap-draft")
    assert made.status_code == 200, made.text
    assert made.json()["created"] is True
