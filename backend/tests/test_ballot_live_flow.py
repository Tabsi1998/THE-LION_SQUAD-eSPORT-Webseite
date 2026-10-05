"""Abstimmung live (#844, Vereine 1.7.0): Öffnet die Versammlungsleitung eine Abstimmung, meldet der Änderungsfeed sie;
die Website sagt den Mitgliedern „Abstimmungen neu laden“ und benachrichtigt einmal, wer ein offenes Stimmrecht hat.
Das Popup bekommt nur offene Abstimmungen mit eigenem Stimmrecht (und geheime als Hinweis); eine Stimme geht durch,
doppelt senden ändert nichts, geschlossen gibt es keine Stimme mehr. Ohne Feed fragen Seiten am Versammlungstag selbst."""
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from dolibarr_fake import API_KEY, BASE_URL, FakeDolibarr, member  # noqa: E402
from flow_harness import make_flow  # noqa: E402
from services import change_events, dolibarr_ballot_watch, dolibarr_client, dolibarr_identity, dolibarr_policy  # noqa: E402
from services.secret_store import encrypt_secret  # noqa: E402

GV, BALLOT, SECRET = 5, 7, 8
NOW = datetime(2026, 9, 25, 17, 0, 30, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def fake(monkeypatch):
    instance = FakeDolibarr()
    monkeypatch.setattr(dolibarr_client, "_transport", instance.transport())
    monkeypatch.setattr(dolibarr_client, "RETRY_PAUSES", (0, 0))
    monkeypatch.setattr(dolibarr_policy, "club_today", lambda: instance.today)
    dolibarr_identity.reset_cache()
    return instance


@pytest.fixture
def signals(monkeypatch):
    sent: list[tuple[frozenset, str]] = []

    async def capture(user_ids, resource):
        sent.append((frozenset(user_ids), resource))

    monkeypatch.setattr(change_events, "publish_user_change", capture)
    return sent


async def scene(flow, fake) -> dict:
    await flow.db.settings.update_one({"id": "dolibarr"}, {"$set": {
        "id": "dolibarr", "mode": "live", "environment": "production", "base_url": BASE_URL, "api_key": encrypt_secret(API_KEY),
        "instance": "verein", "entity": 1,
    }}, upsert=True)
    await flow.db.settings.update_one({"id": "dolibarr_sync_state"}, {"$set": {"id": "dolibarr_sync_state", "module_version": "1.9.0"}}, upsert=True)
    people = {}
    for member_id, name in ((12, "paula"), (13, "carl")):
        fake.add(member(member_id, firstname=name.capitalize()))
        user = await flow.add_user(role="player", name=name)
        await flow.db.users.update_one({"id": user["id"]}, {"$set": {"is_club_member": True}})
        await flow.db.memberships.insert_one({"user_id": user["id"], "member_status": "active"})
        await flow.db.dolibarr_links.insert_one({"id": f"l-{name}", "user_id": user["id"], "instance": "verein:1", "member_key": f"verein:1:{member_id}",
                                                 "member_id": member_id, "member_ref": str(member_id), "status": "verified"})
        people[name] = user
    fake.add_meeting(GV, day=fake.today, invited=[(12, True), (13, False)])
    fake.present[GV] = {12, 13}
    # Stimmrechte kommen aus der Einladung: Paula stimmberechtigt, Carl nicht.
    fake.add_ballot(BALLOT, GV, question="Entlastung des Vorstands")
    fake.add_ballot(SECRET, GV, item=4, kind="election", question="Wahl der Obfrau", secret=True)
    return people


@pytest.mark.asyncio
async def test_an_opened_ballot_reaches_only_members_with_an_open_right(flow, fake, signals):
    people = await scene(flow, fake)
    fake.feed_event("meeting", GV, "started")
    fake.set_ballot_status(BALLOT, "open")
    first = await dolibarr_ballot_watch.poll(flow.db, now=NOW)
    assert first["ok"] is True and first["opened"] == [BALLOT] and first["notified"] == 1 and first["live_meetings"] == [GV], first
    assert (frozenset({people["paula"]["id"], people["carl"]["id"]}), "ballots") in signals
    notes = await flow.db.notifications.find({"kind": "ballot_open"}, {"_id": 0}).to_list(10)
    assert [(n["user_id"], n["body"]) for n in notes] == [(people["paula"]["id"], "Entlastung des Vorstands")], "Carl hat kein Stimmrecht"

    # Während die Versammlung läuft, alle fünf Sekunden - und dieselbe Abstimmung meldet niemand zweimal.
    assert (await dolibarr_ballot_watch.poll(flow.db, now=NOW + timedelta(seconds=2)))["skipped"] == "not_due"
    again = await dolibarr_ballot_watch.poll(flow.db, now=NOW + timedelta(seconds=6))
    assert again["events"] == 0 and await flow.db.notifications.count_documents({"kind": "ballot_open"}) == 1
    fake.feed_event("meeting", GV, "ended")
    ended = await dolibarr_ballot_watch.poll(flow.db, now=NOW + timedelta(seconds=12))
    assert ended["live_meetings"] == []
    assert (await dolibarr_ballot_watch.poll(flow.db, now=NOW + timedelta(seconds=30)))["skipped"] == "not_due", "danach jede Minute"


@pytest.mark.asyncio
async def test_the_popup_gets_open_ballots_and_a_vote_goes_through_once(flow, fake, signals):
    people = await scene(flow, fake)
    fake.set_ballot_status(BALLOT, "open")
    fake.set_ballot_status(SECRET, "open")
    flow.act_as(people["paula"])
    view = (await flow.get("/api/membership/me/ballots/open")).json()
    assert [(b["id"], b["can_vote"], b["secret"]) for b in view["ballots"]] == [(BALLOT, True, False), (SECRET, False, True)]
    assert view["live"] is True and view["poll_seconds"] == 15, "ohne gelesenen Feed fragt die Seite selbst"

    right = next(r for r in view["ballots"][0]["rights"] if r["can_use"])
    vote = await flow.post(f"/api/membership/me/ballots/{BALLOT}/votes", json={"right_id": right["right_id"], "option": "yes"})
    assert vote.status_code == 200, vote.text
    again = await flow.post(f"/api/membership/me/ballots/{BALLOT}/votes", json={"right_id": right["right_id"], "option": "yes"})
    assert again.status_code == 200, "dieselbe Stimme noch einmal ändert nichts"
    assert [b["id"] for b in (await flow.get("/api/membership/me/ballots/open")).json()["ballots"]] == [SECRET]

    # Carl ist ohne Stimmrecht eingeladen: kein Popup, auch nicht für die geheime Wahl.
    flow.act_as(people["carl"])
    assert (await flow.get("/api/membership/me/ballots/open")).json()["ballots"] == []

    # Geschlossen: keine Stimme mehr.
    fake.set_ballot_status(BALLOT, "closed")
    flow.act_as(people["paula"])
    late = await flow.post(f"/api/membership/me/ballots/{BALLOT}/votes", json={"right_id": right["right_id"], "option": "no"})
    assert late.status_code == 409


@pytest.mark.asyncio
async def test_without_the_feed_pages_ask_themselves_only_on_meeting_day(flow, fake, signals):
    people = await scene(flow, fake)
    fake.feed_right = False
    failed = await dolibarr_ballot_watch.poll(flow.db, now=NOW)
    assert failed == {"ok": False, "error": "forbidden"} and await dolibarr_ballot_watch.feed_state(flow.db) == "forbidden"
    flow.act_as(people["paula"])
    assert (await flow.get("/api/membership/me/ballots/open")).json()["poll_seconds"] == 15
    fake.meetings[GV]["day"] = "2026-10-24"
    for ballot in fake.ballots.values():
        ballot["status"] = "released"
    later = (await flow.get("/api/membership/me/ballots/open")).json()
    assert later["live"] is False and later["poll_seconds"] == 0

    # Mit Feed reicht ein Blick pro Minute als Sicherheitsnetz.
    fake.feed_right = True
    fake.meetings[GV]["day"] = fake.today
    await dolibarr_ballot_watch.poll(flow.db, now=NOW + timedelta(minutes=2))
    assert (await flow.get("/api/membership/me/ballots/open")).json()["poll_seconds"] == 60
