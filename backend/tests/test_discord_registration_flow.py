"""Anmeldung im Discord (#885) durch die echte Anwendung: mit verknüpftem Konto in zwei Klicks, privat, über denselben
Dienst wie das Formular - mit denselben Prüfungen, Kosten und Rechnung, Warteliste, Event-Pflicht (#875), Team nur über
den Kapitän; ohne Verknüpfung, bei geschlossener Anmeldung, fehlender Sichtbarkeit oder ausgeschaltetem Schalter kommt
der Grund und nie eine Anmeldung. Doppelklick und zweites Gerät ergeben keine zweite Anmeldung."""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import now_utc  # noqa: E402
from services import discord_announcements, discord_registration  # noqa: E402

DISCORD_ID = "300000000000000001"
OTHER_ID = "300000000000000002"
OFFER = {"enabled": True, "positions": [{"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "basis": "per_person"}]}
RULES = {"accept_rules": True, "accept_privacy": True}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, role="player", member=False, discord_id=None):
    user = await flow.add_user(role=role, name=name)
    fields = {"email": f"{name}@lionsquad-test.at"}
    if member:
        await flow.db.memberships.insert_one({"id": f"m-{name}", "user_id": user["id"], "member_status": "active"})
        fields["is_club_member"] = True
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    if discord_id:
        await flow.db.platform_links.insert_one({"id": f"l-{name}", "user_id": user["id"], "platform": "discord", "external_id": discord_id, "handle": name})
    return user


async def admin(flow):
    return await person(flow, "chef", role="superadmin")


async def make_event(flow, boss, **extra):
    flow.act_as(boss)
    payload = {"name": "Vereins-LAN", "status": "registration_open", "visibility": "public", "has_registration": True,
               "start_date": (now_utc() + timedelta(days=14)).isoformat(), "location": "Vereinsheim", **extra}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    flow.act_as(None)
    return response.json()


def custom_ids(reply):
    return [button.get("custom_id") for button in reply["buttons"] if button.get("custom_id")]


def text_of(reply):
    return reply.get("content") or ""


async def registrations(flow, event_id):
    return await flow.db.event_registrations.find({"event_id": event_id}, {"_id": 0}).to_list(50)


# ---------------------------------------------------------------- Event: zwei Klicks, privat, derselbe Weg

@pytest.mark.asyncio
async def test_event_in_two_clicks_with_the_same_service_as_the_form(flow):
    boss = await admin(flow)
    event = await make_event(flow, boss)
    paula = await person(flow, "paula", discord_id=DISCORD_ID)

    shown = await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"event:{event['id']}")
    fields = {field["name"]: field["value"] for field in shown["embed"]["fields"]}
    assert fields["Kosten"] == "kostenlos" and fields["Plätze"] == "ohne Limit" and fields["Wo"] == "Vereinsheim"
    assert custom_ids(shown) == [f"tls:reg:event:{event['id']}"], "erst der zweite Klick meldet an"
    assert await registrations(flow, event["id"]) == []

    done = await discord_registration.handle_button(flow.db, DISCORD_ID, f"tls:reg:event:{event['id']}")
    assert text_of(done).startswith("✅ Du bist angemeldet")
    [reg] = await registrations(flow, event["id"])
    assert reg["user_id"] == paula["id"] and reg["status"] == "registered" and reg["registered_via"] == "discord"
    audit = await flow.db.audit_logs.find_one({"action": "event.registration.create", "target_id": event["id"]}, {"_id": 0})
    assert audit["data"]["via"] == "discord" and audit["actor_id"] == paula["id"]

    # Doppelklick und zweites Gerät: keine zweite Anmeldung; die Website sieht dieselbe Anmeldung.
    again = await discord_registration.handle_button(flow.db, DISCORD_ID, f"tls:reg:event:{event['id']}")
    assert text_of(again) == discord_registration.DOUBLE and len(await registrations(flow, event["id"])) == 1
    flow.act_as(paula)
    web = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert web.status_code == 409 and len(await registrations(flow, event["id"])) == 1

    # Die Zusammenfassung kennt die Anmeldung und bietet das Abmelden an; /abmelden fragt erst nach.
    known = await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"event:{event['id']}")
    assert "schon angemeldet" in text_of(known) and custom_ids(known) == [f"tls:unreg:event:{event['id']}"]
    asked = await discord_registration.answer_abmelden(flow.db, DISCORD_ID)
    assert text_of(asked).endswith("Wirklich abmelden?") and custom_ids(asked) == [f"tls:unreg:event:{event['id']}"]
    gone = await discord_registration.handle_button(flow.db, DISCORD_ID, f"tls:unreg:event:{event['id']}")
    assert "abgemeldet" in text_of(gone)
    [reg] = await registrations(flow, event["id"])
    assert reg["status"] == "cancelled"
    cancel = await flow.db.audit_logs.find_one({"action": "event.registration.cancel"}, {"_id": 0})
    assert cancel["data"]["via"] == "discord"

    # Die Website-Anmeldung trägt ihren Weg ebenso.
    again_web = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert again_web.status_code == 200
    [reg] = await registrations(flow, event["id"])
    assert reg["status"] == "registered" and reg["registered_via"] == "web"


@pytest.mark.asyncio
async def test_reasons_come_privately_and_never_register(flow):
    boss = await admin(flow)
    public = await make_event(flow, boss)
    members_only = await make_event(flow, boss, name="Mitgliederabend", visibility="members")
    closed = await make_event(flow, boss, name="Später", status="scheduled", registration_opens_at=(now_utc() + timedelta(days=3)).isoformat())
    external = await make_event(flow, boss, name="Extern", registration_url="https://example.test/anmeldung")
    companions = await make_event(flow, boss, name="Mit Begleitung", allow_companions=True, max_companions_per_registration=2)
    switched_off = await make_event(flow, boss, name="Ohne Discord", discord_registration=False)
    await person(flow, "paula", discord_id=DISCORD_ID)

    # Ohne Verknüpfung: der Weg zur Verknüpfung, keine Daten.
    stranger = await discord_registration.answer_anmelden(flow.db, OTHER_ID, f"event:{public['id']}")
    assert "nicht mit der Website verknüpft" in text_of(stranger) and stranger["embed"] is None
    assert [b["label"] for b in stranger["buttons"]] == ["Konto verknüpfen"]
    assert "nicht mit der Website verknüpft" in text_of(await discord_registration.handle_button(flow.db, OTHER_ID, f"tls:reg:event:{public['id']}"))

    cases = {
        members_only["id"]: "Event ist nicht sichtbar",
        closed["id"]: "Die Anmeldung ist aktuell nicht offen",
        external["id"]: "externen Link",
        companions["id"]: "Begleitpersonen",
        switched_off["id"]: "ausgeschaltet",
    }
    for event_id, reason in cases.items():
        shown = await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"event:{event_id}")
        assert reason in text_of(shown) and not custom_ids(shown), (event_id, shown)
        clicked = await discord_registration.handle_button(flow.db, DISCORD_ID, f"tls:reg:event:{event_id}")
        assert reason in text_of(clicked), (event_id, clicked)
        assert await registrations(flow, event_id) == []

    # Die Auswahl zeigt nur, was offen ist und gesehen werden darf.
    names = [row["name"] for row in await discord_registration.choices(flow.db, DISCORD_ID)]
    assert names == ["📅 Vereins-LAN"]

    # Der globale Schalter unter Verbindungen → Discord: aus heißt nirgends, und die Auswahl ist leer.
    flow.act_as(boss)
    assert (await flow.put("/api/settings/discord", json={"registration": {"enabled": False}})).status_code == 200
    assert (await flow.put("/api/settings/discord", json={"registration": {"anders": True}})).status_code == 400
    state = (await flow.get("/api/settings/discord")).json()["registration"]
    assert state == {"enabled": False, "events": 0, "tournaments": 0}
    assert text_of(await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"event:{public['id']}")) == discord_registration.OFF
    assert text_of(await discord_registration.handle_button(flow.db, DISCORD_ID, f"tls:reg:event:{public['id']}")) == discord_registration.OFF
    assert await discord_registration.choices(flow.db, DISCORD_ID) == []
    assert await registrations(flow, public["id"]) == []


@pytest.mark.asyncio
async def test_costs_are_shown_first_and_billed_like_the_form(flow):
    boss = await admin(flow)
    paid = await make_event(flow, boss, name="LAN mit Essen", billing=OFFER, max_participants=1)
    await person(flow, "paula", discord_id=DISCORD_ID)
    await person(flow, "otto", discord_id=OTHER_ID)

    shown = await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"event:{paid['id']}")
    fields = {field["name"]: field["value"] for field in shown["embed"]["fields"]}
    assert fields["Kosten"].startswith("20,00 €") and "Rechnung kommt über die Website" in fields["Kosten"]
    assert fields["Plätze"] == "1 frei"
    assert await flow.db.billing_orders.count_documents({}) == 0, "die Zusammenfassung bucht nichts"

    done = await discord_registration.handle_button(flow.db, DISCORD_ID, custom_ids(shown)[0])
    assert "angemeldet" in text_of(done) and "20,00 €" in text_of(done)
    [reg] = await registrations(flow, paid["id"])
    assert reg["price_snapshot"]["total_cents"] == 2000 and reg["billing_status"] == "pending"
    assert await flow.db.billing_orders.count_documents({"registration_id": reg["id"]}) == 1

    # Voll: Otto sieht „Warteliste“ und landet dort - ohne Preis, der kommt beim Nachrücken.
    full = await discord_registration.answer_anmelden(flow.db, OTHER_ID, f"event:{paid['id']}")
    assert {f["name"]: f["value"] for f in full["embed"]["fields"]}["Plätze"].startswith("voll")
    assert [b["label"] for b in full["buttons"]][0] == "Auf die Warteliste"
    waiting = await discord_registration.handle_button(flow.db, OTHER_ID, f"tls:reg:event:{paid['id']}")
    assert "Warteliste" in text_of(waiting) and "Platz 1" in text_of(waiting)
    assert await flow.db.billing_orders.count_documents({}) == 1


# ---------------------------------------------------------------- Turniere

async def make_tournament(flow, boss, *, team_size=1, event=None, gate=False, **extra):
    if not await flow.db.games.find_one({"id": "g1"}):
        await flow.db.games.insert_one({"id": "g1", "name": "Rocket League", "slug": "rocket-league"})
    flow.act_as(boss)
    created = await flow.post("/api/tournaments", json={
        "title": "LAN-Cup", "game_id": "g1", "status": "registration_open", "visibility": "public", "is_public": True, "format": "single_elim",
        "team_mode": "team" if team_size > 1 else "solo", "team_size": team_size, "max_participants": 8,
        "start_date": (now_utc() + timedelta(days=14)).isoformat(), **({"event_id": event["id"]} if event else {}), "requires_event_registration": gate, **extra,
    })
    assert created.status_code == 200, created.text
    flow.act_as(None)
    return created.json()


@pytest.mark.asyncio
async def test_tournament_with_event_requirement_leads_to_the_event_first(flow):
    boss = await admin(flow)
    event = await make_event(flow, boss)
    cup = await make_tournament(flow, boss, event=event, gate=True)
    paula = await person(flow, "paula", discord_id=DISCORD_ID)

    first = await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"tournament:{cup['id']}")
    assert "Event" in text_of(first) and custom_ids(first) == [f"tls:show:event:{event['id']}:{cup['id']}"]
    to_event = await discord_registration.handle_button(flow.db, DISCORD_ID, custom_ids(first)[0])
    assert custom_ids(to_event) == [f"tls:reg:event:{event['id']}:{cup['id']}"]
    joined = await discord_registration.handle_button(flow.db, DISCORD_ID, custom_ids(to_event)[0])
    assert "angemeldet" in text_of(joined) and custom_ids(joined) == [f"tls:show:tournament:{cup['id']}"], "danach direkt fürs Turnier"

    summary = await discord_registration.handle_button(flow.db, DISCORD_ID, custom_ids(joined)[0])
    assert custom_ids(summary) == [f"tls:reg:tournament:{cup['id']}"] and "Regeln und den Datenschutz" in summary["embed"]["description"]
    done = await discord_registration.handle_button(flow.db, DISCORD_ID, custom_ids(summary)[0])
    assert text_of(done).startswith("✅ Du bist angemeldet")
    reg = await flow.db.tournament_registrations.find_one({"tournament_id": cup["id"]}, {"_id": 0})
    assert reg["user_id"] == paula["id"] and reg["registered_via"] == "discord" and reg["accepted_rules"] and reg["accepted_privacy"]
    again = await discord_registration.handle_button(flow.db, DISCORD_ID, custom_ids(summary)[0])
    assert text_of(again) == discord_registration.DOUBLE
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": cup["id"]}) == 1

    # Die Website-Anmeldung trägt „web“.
    otto = await person(flow, "otto")
    flow.act_as(otto)
    assert (await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})).status_code == 200
    assert (await flow.post(f"/api/tournaments/{cup['id']}/register", json=RULES)).status_code == 200
    web = await flow.db.tournament_registrations.find_one({"tournament_id": cup["id"], "user_id": otto["id"]}, {"_id": 0})
    assert web["registered_via"] == "web"


@pytest.mark.asyncio
async def test_team_tournament_only_through_the_captain(flow):
    boss = await admin(flow)
    cup = await make_tournament(flow, boss, team_size=2)
    captain = await person(flow, "kapitaen", discord_id=DISCORD_ID)
    mate = await person(flow, "mitspieler", discord_id=OTHER_ID)
    await flow.db.teams.insert_one({"id": "team-1", "name": "Lions", "tag": "TLS", "leader_id": captain["id"], "co_leader_ids": [],
                                    "member_ids": [captain["id"], mate["id"]]})

    told = await discord_registration.answer_anmelden(flow.db, OTHER_ID, f"tournament:{cup['id']}")
    assert "Das macht dein Kapitän" in text_of(told) and not custom_ids(told)
    assert "Das macht dein Kapitän" in text_of(await discord_registration.handle_button(flow.db, OTHER_ID, f"tls:reg:tournament:{cup['id']}"))

    shown = await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"tournament:{cup['id']}")
    assert {f["name"]: f["value"] for f in shown["embed"]["fields"]}["Team"] == "Lions"
    done = await discord_registration.handle_button(flow.db, DISCORD_ID, custom_ids(shown)[0])
    assert "mit „Lions“" in text_of(done)
    reg = await flow.db.tournament_registrations.find_one({"tournament_id": cup["id"]}, {"_id": 0})
    assert reg["team_id"] == "team-1" and reg["registered_via"] == "discord"
    assert "schon angemeldet" in text_of(await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"tournament:{cup['id']}"))

    # Ausgeschaltet je Turnier: der Grund statt eines Knopfs.
    off = await make_tournament(flow, boss, title="Ohne Discord", discord_registration=False)
    assert "ausgeschaltet" in text_of(await discord_registration.answer_anmelden(flow.db, DISCORD_ID, f"tournament:{off['id']}"))


# ---------------------------------------------------------------- Knopf unter der Ankündigung

@pytest.mark.asyncio
async def test_announcements_carry_the_button_only_where_it_works(flow):
    boss = await admin(flow)
    event = await make_event(flow, boss)
    external = await make_event(flow, boss, name="Extern", registration_url="https://example.test/anmeldung")
    stored = await flow.db.events.find_one({"id": event["id"]}, {"_id": 0})
    message = await discord_announcements.designed_event(flow.db, stored)
    assert message["buttons"][0] == {"label": "Anmelden", "custom_id": f"tls:show:event:{event['id']}", "style": "primary"}
    assert message["buttons"][1]["label"] == "Event ansehen"
    plain = await discord_announcements.designed_event(flow.db, await flow.db.events.find_one({"id": external["id"]}, {"_id": 0}))
    assert [b["label"] for b in plain["buttons"]] == ["Event ansehen"]

    cup = await make_tournament(flow, boss)
    stored_cup = await flow.db.tournaments.find_one({"id": cup["id"]}, {"_id": 0})
    open_message = await discord_announcements.designed_tournament(flow.db, stored_cup, "registration_open")
    assert [b["label"] for b in open_message["buttons"]] == ["Anmelden", "Zur Anmeldung"]
    live = await discord_announcements.designed_tournament(flow.db, stored_cup, "live")
    assert [b["label"] for b in live["buttons"]] == ["Bracket ansehen"]

    flow.act_as(boss)
    await flow.put("/api/settings/discord", json={"registration": {"enabled": False}})
    assert [b["label"] for b in (await discord_announcements.designed_event(flow.db, stored))["buttons"]] == ["Event ansehen"]


def test_button_ids_and_unknown_clicks():
    assert discord_registration.custom_id("show", "event", "e1") == "tls:show:event:e1"
    assert discord_registration.custom_id("reg", "event", "e1", "t9") == "tls:reg:event:e1:t9"
    match = discord_registration.CUSTOM_ID_PATTERN.match("tls:reg:tournament:abc-123")
    assert match["action"] == "reg" and match["kind"] == "tournament" and match["id"] == "abc-123" and match["then"] is None
    assert discord_registration.CUSTOM_ID_PATTERN.match("tls:drop:event:e1") is None
    assert discord_registration.CUSTOM_ID_PATTERN.match("tls:reg:news:e1") is None
