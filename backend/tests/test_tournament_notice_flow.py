"""Hinweis der Turnierleitung (#1166): Empfänger (Teams, abgemeldet, gesperrt, Event-Ziel), Ablauf, Rechte (auch negativ),
Protokoll, kein Doppelversand, Banner und TV ohne Personendaten. Über die echten Routen, nur erfundene Namen."""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from squad_world import make_team  # noqa: E402
from models import now_utc  # noqa: E402

PERSON_KEYS = {"created_by", "author", "removed_by", "actor_id", "actor", "display_name", "username", "user_id"}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def lead_url(tournament: dict, tail: str = "") -> str:
    return f"/api/tournaments/{tournament['id']}/lead/notices{tail}"


def request_id() -> str:
    return f"req-{new_id()}"


async def referee_of(flow, tournament: dict, name: str = "Schiri", *, role: str = "referee", scope: str | None = None,
                     scope_id: str | None = None) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.tournament_staff_assignments.insert_one({
        "id": new_id(), "tournament_id": tournament["id"], "user_id": user["id"], "role": role,
        **({"scope": scope, "scope_id": scope_id} if scope else {}),
    })
    return user


async def notified(flow, user: dict) -> list[dict]:
    return await flow.db.notifications.find({"user_id": user["id"], "kind": "tournament_notice"}, {"_id": 0}).to_list(None)


async def send(flow, tournament: dict, text: str = "Pause bis 14:30", **body):
    payload = {"request_id": body.pop("request_id", None) or request_id(), "text": text, **body}
    return await flow.post(lead_url(tournament), json=payload)


async def solo_world(flow) -> dict:
    tournament = await flow.create_tournament(status="live", max_participants=16)
    people = {}
    for name, status in (("Aria", "approved"), ("Bodo", "checked_in"), ("Cleo", "pending"), ("Dana", "withdrawn"),
                         ("Emil", "waitlist"), ("Fred", "rejected"), ("Gesperrt", "approved"), ("Still", "approved")):
        people[name] = await flow.add_user(name=name)
        await flow.register(tournament, people[name], status=status)
    await flow.db.users.update_one({"id": people["Gesperrt"]["id"]}, {"$set": {"is_banned": True}})
    await flow.db.users.update_one({"id": people["Still"]["id"]}, {"$set": {"is_active": False}})
    people["Fremd"] = await flow.add_user(name="Fremd")
    lead = await flow.add_staff()
    return {"tournament": tournament, "people": people, "lead": lead}


# ---------------------------------------------------------------- Empfänger


@pytest.mark.asyncio
async def test_reaches_exactly_the_registered_and_nobody_else(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    response = await send(flow, world["tournament"], "Bitte zum Check-in")
    assert response.status_code == 200, response.text
    assert response.json()["recipients"] == 3
    people = world["people"]
    for name in ("Aria", "Bodo", "Cleo"):
        rows = await notified(flow, people[name])
        assert len(rows) == 1, name
        assert rows[0]["title"] == "Hinweis der Turnierleitung · Testturnier"
        assert rows[0]["body"] == "Bitte zum Check-in"
        assert rows[0]["meta"]["category"] == "tournament_updates"
        assert rows[0]["url"] == f"/tournaments/{world['tournament']['slug']}"
    for name in ("Dana", "Emil", "Fred", "Gesperrt", "Still", "Fremd"):
        assert await notified(flow, people[name]) == [], name
    assert await notified(flow, world["lead"]) == []
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    assert (notice["state"], notice["processed"], notice["delivered"]) == ("sent", 3, 3)


@pytest.mark.asyncio
async def test_team_registration_reaches_every_member_but_not_the_sender(flow):
    tournament = await flow.create_tournament(status="live", team_mode="team", team_size=3)
    leader, mate, sub = [await flow.add_user(name=name) for name in ("Leiterin", "Mitspieler", "Ersatz")]
    team = await make_team(flow, "Löwen", leader=leader, members=[mate, sub])
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": tournament["id"], "team_id": team["id"],
                                                       "user_id": leader["id"], "display_name": "Löwen", "status": "approved"})
    other_team_member = await flow.add_user(name="Anderes Team")
    await make_team(flow, "Andere", leader=other_team_member)
    referee = await referee_of(flow, tournament)
    flow.act_as(referee)
    response = await send(flow, tournament, "Finale an PC 1")
    assert response.status_code == 200, response.text
    for person in (leader, mate, sub):
        assert len(await notified(flow, person)) == 1
    assert await notified(flow, other_team_member) == []
    assert await notified(flow, referee) == []


@pytest.mark.asyncio
async def test_event_target_reaches_every_tournament_of_the_event_only(flow):
    await flow.db.events.insert_one({"id": "ev1", "slug": "lan-party", "name": "LAN Party", "status": "published", "visibility": "public"})
    first = await flow.create_tournament(status="live", event_id="ev1", title="Kart-Cup")
    second = await flow.create_tournament(status="check_in", event_id="ev1", title="FC-Cup")
    draft = await flow.create_tournament(status="draft", event_id="ev1", title="Entwurf")
    elsewhere = await flow.create_tournament(status="live", title="Anderswo")
    people = {}
    for name, tournament in (("Kartfahrer", first), ("Kicker", second), ("Entwurfsspieler", draft), ("Anderswer", elsewhere)):
        people[name] = await flow.add_user(name=name)
        await flow.register(tournament, people[name])
    flow.act_as(await flow.add_staff())
    preview = await flow.post(lead_url(first, "/preview"), json={"target": "event"})
    assert preview.json()["recipients"] == 2
    response = await send(flow, first, "Pause bis 14:30", target="event")
    assert response.status_code == 200, response.text
    assert response.json()["recipients"] == 2
    assert len(await notified(flow, people["Kartfahrer"])) == 1
    rows = await notified(flow, people["Kicker"])
    assert len(rows) == 1 and rows[0]["url"] == "/events/lan-party"
    assert rows[0]["title"] == "Hinweis der Turnierleitung · LAN Party"
    assert await notified(flow, people["Entwurfsspieler"]) == []
    assert await notified(flow, people["Anderswer"]) == []
    # Das Banner steht auf der Event-Seite und auf beiden Turnierseiten - nicht beim Turnier anderswo.
    flow.act_as(None)
    for tournament in (first, second):
        banner = await flow.get(f"/api/tournaments/{tournament['id']}/notices")
        assert [row["text"] for row in banner.json()["items"]] == ["Pause bis 14:30"]
    assert (await flow.get(f"/api/tournaments/{elsewhere['id']}/notices")).json()["items"] == []
    event_banner = await flow.get("/api/events/lan-party/notices")
    assert [(row["text"], row["target"]) for row in event_banner.json()["items"]] == [("Pause bis 14:30", "event")]


@pytest.mark.asyncio
async def test_event_target_without_event_is_refused(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    response = await send(flow, world["tournament"], target="event")
    assert response.status_code == 409
    assert await flow.db.tournament_notices.count_documents({}) == 0


# ---------------------------------------------------------------- Ablauf


@pytest.mark.asyncio
async def test_banner_stands_two_hours_by_default_and_disappears_after(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    await send(flow, world["tournament"])
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    span = datetime.fromisoformat(notice["expires_at"]) - datetime.fromisoformat(notice["created_at"])
    assert span == timedelta(hours=2)
    url = f"/api/tournaments/{world['tournament']['id']}/notices"
    assert len((await flow.get(url)).json()["items"]) == 1
    await flow.db.tournament_notices.update_one({"id": notice["id"]}, {"$set": {"expires_at": (now_utc() - timedelta(seconds=1)).isoformat()}})
    assert (await flow.get(url)).json()["items"] == []
    listed = (await flow.get(lead_url(world["tournament"]))).json()["items"]
    assert listed[0]["active"] is False


@pytest.mark.asyncio
async def test_duration_is_set_in_the_form_within_limits(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    res = await send(flow, world["tournament"], duration_minutes=30)
    assert res.status_code == 200
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    span = datetime.fromisoformat(notice["expires_at"]) - datetime.fromisoformat(notice["created_at"])
    assert span == timedelta(minutes=30)
    res = await send(flow, world["tournament"], duration_minutes=5)
    assert res.status_code == 422
    res = await send(flow, world["tournament"], duration_minutes=13 * 60)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_text_is_one_short_line(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    too_long = await send(flow, world["tournament"], "x" * 141)
    assert too_long.status_code == 422
    assert "140" in too_long.json()["detail"]
    res = await send(flow, world["tournament"], "  ")
    assert res.status_code == 422
    fine = await send(flow, world["tournament"], "Pause   bis\n14:30")
    assert fine.status_code == 200
    assert (await flow.db.tournament_notices.find_one({}, {"_id": 0}))["text"] == "Pause bis 14:30"


@pytest.mark.asyncio
async def test_removed_notice_leaves_banner_and_tv_and_removing_twice_changes_nothing(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    await send(flow, world["tournament"], show_on_tv=True)
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    first = await flow.delete(lead_url(world["tournament"], f"/{notice['id']}"))
    assert first.json() == {"ok": True, "idempotent_replay": False}
    second = await flow.delete(lead_url(world["tournament"], f"/{notice['id']}"))
    assert second.json()["idempotent_replay"] is True
    assert (await flow.get(f"/api/tournaments/{world['tournament']['id']}/notices")).json()["items"] == []
    display = await flow.get(f"/api/tournaments/{world['tournament']['id']}/bracket/display")
    assert display.json()["notices"] == []
    assert await flow.db.audit_logs.count_documents({"action": "tournament.notice.remove"}) == 1


# ---------------------------------------------------------------- Rechte


@pytest.mark.asyncio
async def test_only_the_lead_of_this_tournament_writes_and_removes(flow):
    world = await solo_world(flow)
    tournament = world["tournament"]
    other = await flow.create_tournament(status="live")
    outsiders = {
        "Spieler": world["people"]["Aria"],
        "Stationsleitung": await referee_of(flow, tournament, "Stationsleitung", role="station_manager"),
        "Stream": await referee_of(flow, tournament, "Stream", role="stream_operator"),
        "Schiri einer Station": await referee_of(flow, tournament, "Schiri Station", scope="station", scope_id="pc1"),
        "Schiri anderswo": await referee_of(flow, other, "Schiri anderswo"),
    }
    for label, user in outsiders.items():
        flow.act_as(user)
        response = await send(flow, tournament)
        assert response.status_code == 403, label
        assert (await flow.get(lead_url(tournament))).status_code == 403, label
    flow.act_as(None)
    res = await send(flow, tournament)
    assert res.status_code == 401
    assert await flow.db.tournament_notices.count_documents({}) == 0

    organizer = await referee_of(flow, tournament, "Organisation", role="organizer")
    flow.act_as(organizer)
    res = await send(flow, tournament)
    assert res.status_code == 200
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    flow.act_as(world["people"]["Aria"])
    res = await flow.delete(lead_url(tournament, f"/{notice['id']}"))
    assert res.status_code == 403
    flow.act_as(outsiders["Schiri anderswo"])
    res = await flow.delete(lead_url(other, f"/{notice['id']}"))
    assert res.status_code == 404
    assert (await flow.db.tournament_notices.find_one({}, {"_id": 0})).get("removed_at") is None
    flow.act_as(await referee_of(flow, tournament, "Zweiter Schiri"))
    res = await flow.delete(lead_url(tournament, f"/{notice['id']}"))
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_event_target_needs_the_right_in_every_tournament_of_the_event(flow):
    await flow.db.events.insert_one({"id": "ev2", "slug": "hallenfest", "name": "Hallenfest", "status": "published", "visibility": "public"})
    first = await flow.create_tournament(status="live", event_id="ev2")
    second = await flow.create_tournament(status="live", event_id="ev2")
    referee = await referee_of(flow, first)
    flow.act_as(referee)
    res = await send(flow, first, target="event")
    assert res.status_code == 403
    assert (await flow.get(lead_url(first))).json()["can_target_event"] is False
    res = await send(flow, first, target="tournament")
    assert res.status_code == 200
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": second["id"], "user_id": referee["id"], "role": "organizer"})
    assert (await flow.get(lead_url(first))).json()["can_target_event"] is True
    res = await send(flow, first, "Finale an PC 1", target="event")
    assert res.status_code == 200
    # Einen Hinweis an das ganze Event entfernt nur, wer das ganze Event darf.
    event_notice = await flow.db.tournament_notices.find_one({"target": "event"}, {"_id": 0})
    lone = await referee_of(flow, second, "Nur zweites Turnier")
    flow.act_as(lone)
    listed = (await flow.get(lead_url(second))).json()["items"]
    assert [row["can_remove"] for row in listed if row["target"] == "event"] == [False]
    res = await flow.delete(lead_url(second, f"/{event_notice['id']}"))
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_lead_view_says_who_may_write_and_pause(flow):
    world = await solo_world(flow)
    tournament = world["tournament"]
    flow.act_as(await referee_of(flow, tournament, "Ergebnisdienst", role="scorekeeper"))
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()["tournament"]
    assert (view["can_notice"], view["can_pause"]) == (False, False)
    flow.act_as(await referee_of(flow, tournament, "Schiri"))
    view = (await flow.get(f"/api/tournaments/{tournament['id']}/lead")).json()["tournament"]
    assert (view["can_notice"], view["can_pause"]) == (True, True)


# ---------------------------------------------------------------- Protokoll und Doppelversand


@pytest.mark.asyncio
async def test_protocol_says_who_when_to_whom_and_how_many(flow):
    world = await solo_world(flow)
    referee = await referee_of(flow, world["tournament"], "Schiri Sam")
    flow.act_as(referee)
    await send(flow, world["tournament"], "Finale an PC 1", show_on_tv=True)
    log = await flow.db.audit_logs.find_one({"action": "tournament.notice.send"}, {"_id": 0})
    assert log["actor_id"] == referee["id"]
    assert log["target_id"] == world["tournament"]["id"]
    assert log["created_at"]
    assert (log["data"]["target"], log["data"]["recipients"], log["data"]["show_on_tv"]) == ("tournament", 3, True)
    listed = (await flow.get(lead_url(world["tournament"]))).json()["items"]
    assert len(listed) == 1
    row = listed[0]
    assert (row["author"], row["target_label"], row["recipients"], row["delivered"], row["state"]) == ("Schiri Sam", "Alle im Turnier", 3, 3, "sent")
    assert row["created_at"] and row["tv"] is True and row["active"] is True


@pytest.mark.asyncio
async def test_same_request_twice_sends_nothing_twice(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    rid = request_id()
    first = await send(flow, world["tournament"], "Pause bis 14:30", request_id=rid)
    second = await send(flow, world["tournament"], "Pause bis 14:30", request_id=rid)
    assert (first.json()["replay"], second.json()["replay"]) == (False, True)
    assert second.json()["delivered"] == 3
    for name in ("Aria", "Bodo", "Cleo"):
        assert len(await notified(flow, world["people"][name])) == 1, name
    assert await flow.db.tournament_notices.count_documents({}) == 1
    assert await flow.db.audit_logs.count_documents({"action": "tournament.notice.send"}) == 1
    other = await send(flow, world["tournament"], "Etwas anderes", request_id=rid)
    assert other.status_code == 409


@pytest.mark.asyncio
async def test_interrupted_delivery_resumes_without_doubles(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    rid = request_id()
    await send(flow, world["tournament"], request_id=rid)
    # Als wäre der Versand nach der ersten Person abgebrochen: zwei Personen fehlen noch.
    aria = world["people"]["Aria"]
    await flow.db.notifications.delete_many({"kind": "tournament_notice", "user_id": {"$ne": aria["id"]}})
    await flow.db.tournament_notices.update_one({}, {"$set": {"state": "interrupted", "processed": 1, "delivered": 1}})
    resumed = await send(flow, world["tournament"], request_id=rid)
    assert resumed.json()["resumed"] is True
    for name in ("Aria", "Bodo", "Cleo"):
        assert len(await notified(flow, world["people"][name])) == 1, name
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    assert (notice["state"], notice["processed"], notice["delivered"]) == ("sent", 3, 3)


@pytest.mark.asyncio
async def test_running_delivery_is_not_started_a_second_time(flow):
    world = await solo_world(flow)
    flow.act_as(world["lead"])
    rid = request_id()
    await send(flow, world["tournament"], request_id=rid)
    await flow.db.notifications.delete_many({"kind": "tournament_notice"})
    await flow.db.tournament_notices.update_one({}, {"$set": {"state": "sending", "progress_at": now_utc().isoformat()}})
    again = await send(flow, world["tournament"], request_id=rid)
    assert again.json()["replay"] is True and "resumed" not in again.json()
    assert await flow.db.notifications.count_documents({"kind": "tournament_notice"}) == 0


# ---------------------------------------------------------------- Banner und TV ohne Personendaten


def _assert_no_person(rows: list[dict]) -> None:
    for row in rows:
        assert not PERSON_KEYS & set(row), row


@pytest.mark.asyncio
async def test_banner_and_tv_show_text_and_time_but_no_person(flow):
    await flow.db.events.insert_one({"id": "ev3", "slug": "sommer-lan", "name": "Sommer-LAN", "status": "published", "visibility": "public"})
    tournament = await flow.create_tournament(status="live", event_id="ev3", title="Kart-Cup")
    player = await flow.add_user(name="Spielerin")
    await flow.register(tournament, player)
    flow.act_as(await referee_of(flow, tournament, "Schiri Sichtbar"))
    await send(flow, tournament, "Bitte zum Check-in")
    await send(flow, tournament, "Finale an PC 1", show_on_tv=True)

    flow.act_as(None)
    banner = (await flow.get(f"/api/tournaments/{tournament['slug']}/notices")).json()["items"]
    assert [row["text"] for row in banner] == ["Finale an PC 1", "Bitte zum Check-in"]
    assert all(row["created_at"] and row["expires_at"] for row in banner)
    _assert_no_person(banner)
    assert "Schiri Sichtbar" not in str(banner)

    event_banner = (await flow.get("/api/events/sommer-lan/notices")).json()["items"]
    assert {row["tournament_title"] for row in event_banner} == {"Kart-Cup"}
    _assert_no_person(event_banner)

    flow.act_as(await flow.add_staff())
    tv = (await flow.get(f"/api/tournaments/{tournament['id']}/bracket/display")).json()["notices"]
    assert [row["text"] for row in tv] == ["Finale an PC 1"]
    _assert_no_person(tv)


@pytest.mark.asyncio
async def test_hall_tv_with_key_gets_the_tv_notices(flow):
    from services.access_links import hash_access_token

    await flow.db.events.insert_one({"id": "ev4", "slug": "winter-lan", "name": "Winter-LAN", "status": "published", "visibility": "public"})
    tournament = await flow.create_tournament(status="live", event_id="ev4", title="FC-Cup")
    lead = await flow.add_staff()
    flow.act_as(lead)
    await send(flow, tournament, "Pause bis 14:30", target="event", show_on_tv=True)
    await send(flow, tournament, "Nur im Web")
    token = f"tv-{new_id()}"
    await flow.db.access_links.insert_one({"id": new_id(), "token_hash": hash_access_token(token), "target_type": "event",
                                           "target_id": "ev4", "grants": ["display"], "is_active": True})
    flow.act_as(None)
    response = await flow.get("/api/events/ev4/display", params={"key": token})
    assert response.status_code == 200, response.text
    rows = response.json()["notices"]
    assert [(row["text"], row["target"]) for row in rows] == [("Pause bis 14:30", "event")]
    _assert_no_person(rows)


@pytest.mark.asyncio
async def test_hidden_tournament_shows_no_banner(flow):
    tournament = await flow.create_tournament(status="live", visibility="internal")
    flow.act_as(await flow.add_staff())
    await send(flow, tournament)
    flow.act_as(None)
    assert (await flow.get(f"/api/tournaments/{tournament['id']}/notices")).status_code in (403, 404)


@pytest.mark.asyncio
async def test_closed_tournament_takes_no_new_notices(flow):
    tournament = await flow.create_tournament(status="cancelled")
    flow.act_as(await flow.add_staff())
    res = await send(flow, tournament)
    assert res.status_code == 409


# ---------------------------------------------------------------- Liga-Staffel (Review N3, N5)


async def staffel_of(flow, **fields) -> dict:
    return await flow.create_tournament(status="live", title="Staffel A",
                                        league_context={"league_id": "liga", "season_id": "s1", "division_id": "liga-1", "staffel": "A"},
                                        **fields)


async def league_lead(flow, name: str, *capabilities: str) -> dict:
    user = await flow.add_user(name=name)
    await flow.db.league_staff.insert_one({"id": new_id(), "league_id": "liga", "user_id": user["id"],
                                           "capabilities": list(capabilities), "created_at": now_utc().isoformat()})
    return user


@pytest.mark.asyncio
async def test_staffel_needs_the_league_right_matches(flow):
    staffel = await staffel_of(flow)
    player = await flow.add_user(name="Captain")
    await flow.register(staffel, player)
    flow.act_as(await league_lead(flow, "Nur Tabelle", "table"))
    res = await send(flow, staffel)
    assert res.status_code == 403
    # Ein Helfer-Einsatz als Schiedsrichter zählt in einer Staffel nicht - dort gilt das Liga-Recht.
    flow.act_as(await referee_of(flow, staffel, "Schiri ohne Liga-Recht"))
    res = await send(flow, staffel)
    assert res.status_code == 403
    flow.act_as(await league_lead(flow, "Spielbetreuung", "matches"))
    res = await send(flow, staffel, "Bitte zum Check-in")
    assert res.status_code == 200, res.text
    assert len(await notified(flow, player)) == 1


@pytest.mark.asyncio
async def test_event_target_with_a_staffel_needs_the_league_right_even_for_the_tournament_lead(flow):
    await flow.db.events.insert_one({"id": "ev5", "slug": "liga-abend", "name": "Liga-Abend", "status": "published", "visibility": "public"})
    cup = await flow.create_tournament(status="live", event_id="ev5", title="Cup")
    await staffel_of(flow, event_id="ev5")
    # Turnierleitung als Rolle (mit Zwei-Faktor), aber ohne Liga-Recht.
    lead = await flow.add_user(role="tournament_admin", name="Turnierleitung")
    flow.act_as(lead)
    assert (await flow.get(lead_url(cup))).json()["can_target_event"] is False
    res = await send(flow, cup, target="event")
    assert res.status_code == 403
    res = await send(flow, cup, target="tournament")
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_person_in_two_tournaments_of_the_event_gets_one_notice(flow):
    await flow.db.events.insert_one({"id": "ev6", "slug": "doppel-lan", "name": "Doppel-LAN", "status": "published", "visibility": "public"})
    first = await flow.create_tournament(status="live", event_id="ev6")
    second = await flow.create_tournament(status="live", event_id="ev6")
    both = await flow.add_user(name="Doppelstarter")
    await flow.register(first, both)
    await flow.register(second, both)
    flow.act_as(await flow.add_staff())
    res = await send(flow, first, "Finale an PC 1", target="event")
    assert res.json()["recipients"] == 1
    assert len(await notified(flow, both)) == 1


# ---------------------------------------------------------------- Fehler bei einer Person (Review N4)


@pytest.mark.asyncio
async def test_a_person_that_failed_is_not_counted_and_is_caught_up_when_resuming(flow, monkeypatch):
    from services import user_notifications

    world = await solo_world(flow)
    bodo = world["people"]["Bodo"]["id"]
    real = user_notifications.create_user_notification
    broken = {"on": True}

    async def flaky(user_id, *args, **kwargs):
        if broken["on"] and user_id == bodo:
            raise RuntimeError("Push-Dienst weg")
        return await real(user_id, *args, **kwargs)

    monkeypatch.setattr(user_notifications, "create_user_notification", flaky)
    flow.act_as(world["lead"])
    rid = request_id()
    await send(flow, world["tournament"], request_id=rid)
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    assert (notice["state"], notice["processed"], notice["delivered"], notice["failed"]) == ("interrupted", 2, 2, 1)
    row = (await flow.get(lead_url(world["tournament"]))).json()["items"][0]
    assert (row["state"], row["stale"], row["failed"]) == ("interrupted", True, 1)
    assert await notified(flow, world["people"]["Bodo"]) == []

    broken["on"] = False
    again = await send(flow, world["tournament"], request_id=rid)
    assert again.json()["resumed"] is True
    notice = await flow.db.tournament_notices.find_one({}, {"_id": 0})
    assert (notice["state"], notice["processed"], notice["delivered"], notice["failed"]) == ("sent", 3, 3, 0)
    for name in ("Aria", "Bodo", "Cleo"):
        assert len(await notified(flow, world["people"][name])) == 1, name
