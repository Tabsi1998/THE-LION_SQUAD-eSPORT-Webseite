"""Zugangslinks mit Nutzungslimit (#1036): das Limit hält auch bei gleichzeitigen Anmeldungen.

Ein Link „für 1 Anmeldung“ darf genau eine Anmeldung tragen - auch wenn zwei Personen im selben Augenblick
abschicken. Dieselbe Person verbraucht den Link nur einmal, ein widerrufener Link trägt keine Anmeldung mehr.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import EventRegistrationCreate, RegistrationCreate  # noqa: E402
from services.access_links import hash_access_token, new_access_token  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def access_link(flow, target_type: str, target_id: str, *, max_uses: int | None = 1) -> tuple[str, dict]:
    token = new_access_token()
    link = {
        "id": new_id(), "target_type": target_type, "target_id": target_id, "grants": ["view", "register"],
        "token_hash": hash_access_token(token), "expires_at": None, "max_uses": max_uses, "use_count": 0,
        "user_id": None, "email": None, "note": None, "is_active": True,
    }
    await flow.db.access_links.insert_one(dict(link))
    return token, link


async def draft_event(flow) -> dict:
    event = {"id": new_id(), "slug": f"event-{new_id()[:8]}", "name": "Geschlossenes Event", "status": "draft",
             "visibility": "public", "has_registration": True, "max_participants": 20}
    await flow.db.events.insert_one(dict(event))
    return event


async def stored_link(flow, link: dict) -> dict:
    return await flow.db.access_links.find_one({"id": link["id"]}, {"_id": 0})


def both_validated_first(monkeypatch, module) -> None:
    """Beide Anfragen haben den Link für die Anmeldung geprüft, bevor eine von ihnen weiterschreibt - wie zwei Worker
    auf echtem MongoDB. Wer erst beim Schreiben atomar bedingt zählt, merkt davon nichts."""
    barrier = asyncio.Barrier(2)
    real = module.validate_access_link

    async def validate(db, token, target_type, target_id, user=None, grant="view"):
        link = await real(db, token, target_type, target_id, user, grant)
        if grant == "register":
            await asyncio.wait_for(barrier.wait(), 1.0)
        return link

    monkeypatch.setattr(module, "validate_access_link", validate)


async def outcome(call):
    from fastapi import HTTPException
    try:
        await call
        return 200
    except HTTPException as exc:
        return exc.status_code


@pytest.mark.asyncio
async def test_two_people_at_once_get_only_as_many_event_seats_as_the_link_allows(flow):
    from services import event_registration

    event = await draft_event(flow)
    _, link = await access_link(flow, "event", event["id"], max_uses=1)
    anna, ben = await flow.add_user(name="Anna"), await flow.add_user(name="Ben")

    async def register(who):
        try:
            await event_registration.register(flow.db, event, who, register_access=dict(link))
            return 200
        except event_registration.RegistrationError as exc:
            return exc.status

    # Beide haben den Link noch mit einer freien Nutzung gesehen und schicken gleichzeitig ab.
    results = await asyncio.gather(register(anna), register(ben))

    assert sorted(results) == [200, 409]
    assert await flow.db.event_registrations.count_documents({"event_id": event["id"]}) == 1
    assert (await stored_link(flow, link))["use_count"] == 1


@pytest.mark.asyncio
async def test_two_people_at_once_get_only_as_many_tournament_places_as_the_link_allows(flow, monkeypatch):
    from routes import tournament_registration_routes

    tournament = await flow.create_tournament(status="draft", visibility="private")
    token, link = await access_link(flow, "tournament", tournament["id"], max_uses=1)
    anna, ben = await flow.add_user(name="Anna"), await flow.add_user(name="Ben")
    both_validated_first(monkeypatch, tournament_registration_routes)
    body = RegistrationCreate(accept_rules=True, accept_privacy=True)

    results = await asyncio.gather(*(
        outcome(tournament_registration_routes.register_for_tournament(tournament["id"], body, access=token, me=who))
        for who in (anna, ben)
    ))

    assert sorted(results) == [200, 409]
    assert await flow.db.tournament_registrations.count_documents({"tournament_id": tournament["id"]}) == 1
    assert (await stored_link(flow, link))["use_count"] == 1


@pytest.mark.asyncio
async def test_the_same_person_uses_a_link_only_once_even_after_signing_off_and_on_again(flow):
    from routes import event_routes

    event = await draft_event(flow)
    token, link = await access_link(flow, "event", event["id"], max_uses=2)
    anna, ben = await flow.add_user(name="Anna"), await flow.add_user(name="Ben")

    await event_routes.register_for_event(event["id"], EventRegistrationCreate(), access=token, me=anna)
    flow.act_as(anna)
    assert (await flow.client.delete(f"/api/events/{event['id']}/registrations/me")).status_code == 200
    await event_routes.register_for_event(event["id"], EventRegistrationCreate(), access=token, me=anna)
    assert (await stored_link(flow, link))["use_count"] == 1, "Anna zählt einmal"

    await event_routes.register_for_event(event["id"], EventRegistrationCreate(), access=token, me=ben)
    assert (await stored_link(flow, link))["use_count"] == 2


@pytest.mark.asyncio
async def test_a_link_revoked_in_the_meantime_carries_no_registration(flow):
    from services import event_registration

    event = await draft_event(flow)
    _, link = await access_link(flow, "event", event["id"], max_uses=None)
    anna = await flow.add_user(name="Anna")
    # Geprüft war der Link noch gültig, dann widerruft ihn die Verwaltung - die Anmeldung kommt danach an.
    await flow.db.access_links.update_one({"id": link["id"]}, {"$set": {"is_active": False}})

    with pytest.raises(event_registration.RegistrationError) as refused:
        await event_registration.register(flow.db, event, anna, register_access=link)

    assert refused.value.status == 409
    assert await flow.db.event_registrations.count_documents({"event_id": event["id"]}) == 0
    assert (await stored_link(flow, link))["use_count"] == 0
