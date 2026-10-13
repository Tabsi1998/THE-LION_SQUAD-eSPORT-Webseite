"""Freunde beim Event (#1188, Datenschutz): nur bestätigte Freunde sehen eine Anmeldung - nie Fremde, nie Gäste, nie bei
offener Anfrage, nie bei Blockierung, nie gesperrte Konten und nie, wenn die Person es ausgeschaltet hat (unter 14
Jahren Standard aus). Jede Absage hat ihre Gegenprobe: dieselbe Lage mit erlaubtem Weg zeigt die Person."""
import pathlib
import sys
from datetime import date

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from models import new_id  # noqa: E402
from services import event_friends  # noqa: E402
from services.friend_service import friend_pair_key  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def befriend(flow, a: dict, b: dict, status: str = "accepted") -> None:
    await flow.db.friendships.update_one(
        {"pair_key": friend_pair_key(a["id"], b["id"])},
        {"$set": {"id": new_id(), "pair_key": friend_pair_key(a["id"], b["id"]), "requester_id": a["id"], "recipient_id": b["id"], "status": status}},
        upsert=True,
    )


async def seed(flow):
    viewer = await flow.add_user(role="player", name="vera")
    friend = await flow.add_user(role="player", name="finn")
    await flow.db.events.insert_one({"id": "e-lan", "slug": "herbst-lan", "name": "Herbst-LAN", "status": "scheduled", "visibility": "public",
                                     "has_registration": True, "start_date": "2099-11-13T16:00:00+00:00"})
    await flow.db.tournaments.insert_many([
        {"id": "t-mk", "slug": "mk", "title": "Mario Kart Cup", "event_id": "e-lan", "status": "registration_open", "visibility": "public", "is_public": True, "team_mode": "solo"},
        {"id": "t-rl", "slug": "rl", "title": "Rocket League 2v2", "event_id": "e-lan", "status": "registration_open", "visibility": "public", "is_public": True, "team_mode": "team"},
        {"id": "t-intern", "slug": "intern", "title": "Vereinsturnier", "event_id": "e-lan", "status": "registration_open", "visibility": "members", "is_public": True, "team_mode": "solo"},
        {"id": "t-draft", "slug": "geheim", "title": "Geheim", "event_id": "e-lan", "status": "draft", "visibility": "public", "team_mode": "solo"},
    ])
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-lan", "user_id": friend["id"], "status": "registered"})
    await flow.db.tournament_registrations.insert_many([
        {"id": new_id(), "tournament_id": "t-mk", "user_id": friend["id"], "display_name": "Finn", "status": "approved"},
        {"id": new_id(), "tournament_id": "t-intern", "user_id": friend["id"], "display_name": "Finn", "status": "approved"},
        {"id": new_id(), "tournament_id": "t-draft", "user_id": friend["id"], "display_name": "Finn", "status": "approved"},
    ])
    return viewer, friend


async def friends_of(flow, viewer) -> list[dict]:
    flow.act_as(viewer)
    res = await flow.get("/api/events/herbst-lan/friends")
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == "private, no-store"
    return res.json()["friends"]


@pytest.mark.asyncio
async def test_confirmed_friend_sees_where_the_friend_is(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    friends = await friends_of(flow, viewer)
    assert [f["id"] for f in friends] == [friend["id"]]
    places = friends[0]["where"]
    assert {"kind": "event"} in places
    assert [p["id"] for p in places if p["kind"] == "tournament"] == ["t-mk"], "„Nur Mitglieder“ und Entwurf fehlen für Nicht-Mitglieder"
    assert friends[0]["username"] is None, "Profil nicht öffentlich: kein Link"
    assert set(friends[0]) == {"id", "display_name", "avatar_url", "username", "where"}, "keine weiteren Profildaten"


@pytest.mark.asyncio
async def test_stranger_and_guest_see_nothing(flow):
    viewer, friend = await seed(flow)
    assert await friends_of(flow, viewer) == [], "Fremde sehen keine Anmeldungen"
    flow.act_as(None)
    assert (await flow.get("/api/events/herbst-lan/friends")).status_code == 401, "Gäste bekommen nichts"
    # Gegenprobe: nach der bestätigten Freundschaft ist Finn da.
    await befriend(flow, viewer, friend)
    assert [f["id"] for f in await friends_of(flow, viewer)] == [friend["id"]]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["pending", "declined", "cancelled", "removed"])
async def test_unconfirmed_request_sees_nothing(flow, status):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend, status=status)
    assert await friends_of(flow, viewer) == []
    flow.act_as(friend)
    assert (await flow.get("/api/events/herbst-lan/friends")).json()["friends"] == [], "auch nicht in die andere Richtung"


@pytest.mark.asyncio
async def test_switched_off_sees_nothing_and_takes_effect_at_once(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    flow.act_as(friend)
    assert (await flow.put("/api/users/me", json={"privacy_friends_see_registrations": False})).status_code == 200
    assert await friends_of(flow, viewer) == [], "ausgeschaltet sieht es niemand"
    flow.act_as(friend)
    assert (await flow.put("/api/users/me", json={"privacy_friends_see_registrations": True})).status_code == 200
    assert [f["id"] for f in await friends_of(flow, viewer)] == [friend["id"]], "Gegenprobe: wieder an"


@pytest.mark.asyncio
async def test_under_14_starts_off_until_the_person_switches_it_on(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    today = event_friends._today()
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"birth_date": f"{today.year - 13}-01-01"}})
    assert await friends_of(flow, viewer) == [], "unter 14: Standard aus"
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {event_friends.SETTING: True}})
    assert [f["id"] for f in await friends_of(flow, viewer)] == [friend["id"]], "selbst eingeschaltet: sichtbar"
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"birth_date": f"{today.year - 30}-01-01"}, "$unset": {event_friends.SETTING: ""}})
    assert [f["id"] for f in await friends_of(flow, viewer)] == [friend["id"]], "erwachsen ohne Wahl: Standard an"


@pytest.mark.asyncio
async def test_blocked_banned_and_deleted_accounts_are_not_shown(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    await flow.db.user_blocks.insert_one({"id": new_id(), "blocker_id": friend["id"], "blocked_id": viewer["id"]})
    assert await friends_of(flow, viewer) == [], "blockiert (auch von der anderen Seite)"
    await flow.db.user_blocks.delete_many({})
    assert len(await friends_of(flow, viewer)) == 1, "Gegenprobe ohne Blockierung"
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"is_banned": True}})
    assert await friends_of(flow, viewer) == [], "gesperrt"
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"is_banned": False, "is_active": False}})
    assert await friends_of(flow, viewer) == [], "deaktiviert"
    await flow.db.users.update_one({"id": friend["id"]}, {"$set": {"is_active": True, "anonymized_at": "2026-10-01T00:00:00+00:00"}})
    assert await friends_of(flow, viewer) == [], "gelöscht (anonymisiert)"


@pytest.mark.asyncio
async def test_waitlist_and_cancelled_do_not_count_and_team_names_show(flow):
    viewer, friend = await seed(flow)
    other = await flow.add_user(role="player", name="olga")
    await befriend(flow, viewer, friend)
    await befriend(flow, other, viewer)
    await flow.db.event_registrations.delete_many({})
    await flow.db.tournament_registrations.delete_many({})
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-lan", "user_id": other["id"], "status": "waitlist"})
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": "t-mk", "user_id": other["id"], "status": "cancelled"})
    assert await friends_of(flow, viewer) == [], "Warteliste und Storno zählen nicht"
    await flow.db.teams.insert_one({"id": "team-rocket", "name": "Lions Rocket", "member_ids": ["leader-x", friend["id"]]})
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": "t-rl", "user_id": "leader-x", "team_id": "team-rocket",
                                                       "display_name": "Lions Rocket", "status": "approved"})
    friends = await friends_of(flow, viewer)
    assert [f["id"] for f in friends] == [friend["id"]]
    assert friends[0]["where"] == [{"kind": "tournament", "id": "t-rl", "slug": "rl", "title": "Rocket League 2v2", "team_name": "Lions Rocket"}]


@pytest.mark.asyncio
async def test_members_see_members_only_tournaments_of_friends(flow):
    viewer, friend = await seed(flow)
    lead = await flow.add_staff("Leitung")
    await befriend(flow, lead, friend)
    friends = await friends_of(flow, lead)
    assert sorted(p["id"] for p in friends[0]["where"] if p["kind"] == "tournament") == ["t-intern", "t-mk"]


@pytest.mark.asyncio
async def test_hint_once_when_it_applies_and_can_switch_off(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    flow.act_as(viewer)
    assert (await flow.get("/api/events/herbst-lan/friends")).json()["hint"] is False, "noch nicht dabei: kein Hinweis"
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-lan", "user_id": viewer["id"], "status": "registered"})
    data = (await flow.get("/api/events/herbst-lan/friends")).json()
    assert data["hint"] is True and data["sharing"] is True
    res = await flow.post("/api/users/me/friends-hint", json={})
    assert res.status_code == 200 and res.json() == {"sharing": True}
    assert (await flow.get("/api/events/herbst-lan/friends")).json()["hint"] is False, "genau einmal"

    flow.act_as(friend)
    await flow.db.event_registrations.delete_many({"user_id": viewer["id"]})
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": "e-lan", "user_id": viewer["id"], "status": "registered"})
    assert (await flow.get("/api/events/herbst-lan/friends")).json()["friends"][0]["id"] == viewer["id"]
    flow.act_as(viewer)
    await flow.db.users.update_one({"id": viewer["id"]}, {"$unset": {event_friends.HINT_FIELD: ""}})
    res = await flow.post("/api/users/me/friends-hint", json={"turn_off": True})
    assert res.json() == {"sharing": False}
    stored = await flow.db.users.find_one({"id": viewer["id"]}, {"_id": 0})
    assert stored[event_friends.SETTING] is False and stored.get(event_friends.HINT_FIELD)
    flow.act_as(friend)
    assert (await flow.get("/api/events/herbst-lan/friends")).json()["friends"] == [], "„Ausschalten“ im Hinweis wirkt sofort"


@pytest.mark.asyncio
async def test_hidden_event_gives_no_friends(flow):
    viewer, friend = await seed(flow)
    await befriend(flow, viewer, friend)
    await flow.db.events.update_one({"id": "e-lan"}, {"$set": {"visibility": "members"}})
    flow.act_as(viewer)
    res = await flow.get("/api/events/herbst-lan/friends")
    assert res.status_code == 403 and "Finn" not in res.text and res.headers["cache-control"] == "private, no-store"


def test_sharing_rules():
    today = date(2026, 10, 13)
    assert event_friends.shares_registrations({}, today) is True
    assert event_friends.shares_registrations({"birth_date": "2012-10-14"}, today) is False, "13 Jahre, einen Tag vor dem 14."
    assert event_friends.shares_registrations({"birth_date": "2012-10-13"}, today) is True, "am 14. Geburtstag"
    assert event_friends.shares_registrations({"birth_date": "2015-01-01", event_friends.SETTING: True}, today) is True
    assert event_friends.shares_registrations({event_friends.SETTING: False}, today) is False
    assert event_friends.shares_registrations({"birth_date": "kein Datum"}, today) is True
