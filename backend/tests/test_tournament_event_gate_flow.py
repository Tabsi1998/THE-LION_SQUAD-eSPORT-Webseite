"""Turnier nur mit Event-Anmeldung (#875): mit Schalter und Event meldet sich nur an, wer beim Event bestätigt angemeldet
ist - Teams mit mindestens so vielen Mitgliedern beim Event, wie ein Team Spieler hat. Warteliste zählt nicht; die
Turnierleitung darf beim Eintragen übergehen (Hinweis, Audit); eine spätere Event-Abmeldung entfernt nichts, die
Teilnehmerliste zeigt sie. Ohne Schalter oder ohne Event alles wie bisher."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from test_billing_invoice_terms_flow import person  # noqa: E402

RULES = {"accept_rules": True, "accept_privacy": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def setup(flow, *, team_size=1, gate=True, max_event=None, with_event=True):
    admin = await person(flow, "chef", role="superadmin")
    await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    flow.act_as(admin)
    event = None
    if with_event:
        response = await flow.post("/api/events", json={"name": "Vereins-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
                                                        "start_date": (now_utc() + timedelta(days=20)).isoformat(),
                                                        **({"max_participants": max_event} if max_event else {})})
        assert response.status_code == 200, response.text
        event = response.json()
    created = await flow.post("/api/tournaments", json={
        "title": "LAN-Cup", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True, "format": "single_elim",
        "team_mode": "team" if team_size > 1 else "solo", "team_size": team_size, "max_participants": 8, "start_date": (now_utc() + timedelta(days=20)).isoformat(),
        **({"event_id": event["id"]} if event else {}), "requires_event_registration": gate,
    })
    assert created.status_code == 200, created.text
    return admin, event, created.json()


async def join_event(flow, user, event):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_solo_needs_a_confirmed_event_registration_first(flow):
    _, event, tournament = await setup(flow)
    paula = await person(flow, "paula")
    flow.act_as(paula)
    page = (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()
    assert page["event_gate"] == {"required": True, "event": {"id": event["id"], "name": "Vereins-LAN", "slug": event.get("slug")}, "registered": False, "team_need": 1}
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=RULES)
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Für dieses Turnier musst du zuerst beim Event „Vereins-LAN“ angemeldet sein."

    await join_event(flow, paula, event)
    flow.act_as(paula)
    assert (await flow.get(f"/api/tournaments/{tournament['slug']}")).json()["event_gate"]["registered"] is True
    booked = await flow.post(f"/api/tournaments/{tournament['id']}/register", json=RULES)
    assert booked.status_code == 200, booked.text


@pytest.mark.asyncio
async def test_waitlist_does_not_count(flow):
    _, event, tournament = await setup(flow, max_event=1)
    first = await person(flow, "erste")
    await join_event(flow, first, event)
    late = await person(flow, "spaet")
    waiting = await join_event(flow, late, event)
    assert waiting["status"] == "waitlist"
    flow.act_as(late)
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/register", json=RULES)).status_code == 403


@pytest.mark.asyncio
async def test_without_switch_or_without_event_everything_stays_as_before(flow):
    _, _, open_tournament = await setup(flow, gate=False)
    max_ = await person(flow, "max")
    flow.act_as(max_)
    assert (await flow.get(f"/api/tournaments/{open_tournament['slug']}")).json()["event_gate"] is None
    assert (await flow.post(f"/api/tournaments/{open_tournament['id']}/register", json=RULES)).status_code == 200


@pytest.mark.asyncio
async def test_switch_without_event_has_no_effect(flow):
    _, _, tournament = await setup(flow, with_event=False)
    max_ = await person(flow, "max")
    flow.act_as(max_)
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/register", json=RULES)).status_code == 200


@pytest.mark.asyncio
async def test_team_needs_as_many_members_at_the_event_as_players_and_names_who_is_missing(flow):
    _, event, tournament = await setup(flow, team_size=2)
    captain = await person(flow, "captain", display_name="Cap Tain")
    mate = await person(flow, "mate", display_name="Mate One")
    bench = await person(flow, "bench", display_name="Bench Two")
    await flow.db.teams.insert_one({"id": "team-1", "name": "Lions", "tag": "TLS", "leader_id": captain["id"], "co_leader_ids": [],
                                    "member_ids": [captain["id"], mate["id"], bench["id"]]})
    await join_event(flow, captain, event)
    flow.act_as(captain)
    refused = await flow.post(f"/api/tournaments/{tournament['id']}/register", json={**RULES, "team_id": "team-1"})
    assert refused.status_code == 403
    detail = refused.json()["detail"]
    assert detail.startswith("Für dieses Turnier müssen mindestens 2 Spieler des Teams beim Event „Vereins-LAN“ angemeldet sein – angemeldet ist 1.")
    assert "Noch nicht angemeldet: Mate One, Bench Two." in detail
    # Die Ersatzbank muss nicht mit: zwei von drei reichen bei einem 2er-Team.
    await join_event(flow, mate, event)
    flow.act_as(captain)
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/register", json={**RULES, "team_id": "team-1"})).status_code == 200


@pytest.mark.asyncio
async def test_staff_may_override_with_a_note_and_sees_later_cancellations(flow):
    admin, event, tournament = await setup(flow)
    paula = await person(flow, "paula")
    gast = await person(flow, "gast")
    registration = await join_event(flow, paula, event)
    flow.act_as(paula)
    assert (await flow.post(f"/api/tournaments/{tournament['id']}/register", json=RULES)).status_code == 200

    # Die Turnierleitung trägt jemanden ohne Event-Anmeldung ein: geht, mit Hinweis und im Audit.
    flow.act_as(admin)
    added = await flow.post(f"/api/tournaments/{tournament['id']}/registrations", json={"user_id": gast["id"]})
    assert added.status_code == 200, added.text
    assert added.json()["event_gate_warning"] == "Für dieses Turnier musst du zuerst beim Event „Vereins-LAN“ angemeldet sein. Trotzdem eingetragen."
    audit = await flow.db.audit_logs.find_one({"action": "tournament.registration.staff_add"}, {"_id": 0})
    assert (audit.get("data") or audit.get("details") or {}).get("event_gate_overridden") is True

    # Paula springt vom Event ab: die Turnieranmeldung bleibt - die Liste zeigt es der Turnierleitung.
    await flow.db.event_registrations.update_one({"id": registration["id"]}, {"$set": {"status": "cancelled"}})
    rows = (await flow.get(f"/api/tournaments/{tournament['id']}/registrations")).json()
    marks = {row["user_id"]: row.get("event_gate") for row in rows}
    assert marks[paula["id"]] == {"ok": False, "label": "nicht beim Event angemeldet"}
    assert marks[gast["id"]] == {"ok": False, "label": "nicht beim Event angemeldet"}
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"], "user_id": paula["id"]}) == 1

    # Öffentlich steht davon nichts.
    flow.act_as(gast)
    public = (await flow.get(f"/api/tournaments/{tournament['id']}/registrations")).json()
    assert all("event_gate" not in row for row in public)
