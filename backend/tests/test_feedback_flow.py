"""Rückmeldung nach Turnier oder Event (#1196): nur wer dabei war wird gefragt, genau einmal; „Lieber nicht“ beendet
die Frage; die Verwaltung sieht die Auswertung ohne Namen und erst ab drei Rückmeldungen Einzelheiten. Die Uhr steht
fest (18.10.2026, der Tag nach dem Turnier). Erfundene Daten, keine echten Personen."""
import json
import pathlib
import sys
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import feedback  # noqa: E402

NOW = datetime(2026, 10, 18, 8, 30, tzinfo=timezone.utc)   # 10:30 in Wien, am Tag nach dem Turnier


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def clock(monkeypatch):
    state = {"now": NOW}
    monkeypatch.setattr(feedback, "now_utc", lambda: state["now"])
    return state


async def setup_cup(flow):
    cup = await flow.create_tournament(title="Herbst-Cup", status="results_published", start_date="2026-10-17T12:00:00+00:00")
    checked = await flow.add_user(role="player", name="eingecheckt")
    played = await flow.add_user(role="player", name="gespielt")
    absent = await flow.add_user(role="player", name="nie-da")
    stranger = await flow.add_user(role="player", name="fremd")
    await flow.register(cup, checked, status="checked_in")
    played_reg = await flow.register(cup, played, status="approved")
    await flow.register(cup, absent, status="approved")
    await flow.db.matches_v2.insert_one({"id": new_id(), "tournament_id": cup["id"], "status": "completed",
                                         "slots": [{"slot": 1, "registration_id": played_reg["id"]}],
                                         "results": [{"registration_id": played_reg["id"], "rank": 1}]})
    return cup, checked, played, absent, stranger


@pytest.mark.asyncio
async def test_only_participants_are_asked_once_and_decline_ends_it(flow, clock):
    cup, checked, played, absent, stranger = await setup_cup(flow)
    # Team mit Aufstellung: Aufgestellte und Ersatz werden gefragt, wer nicht dabei war nicht.
    captain = await flow.add_user(role="player", name="kapitaen")
    sub = await flow.add_user(role="player", name="ersatz")
    outside = await flow.add_user(role="player", name="zuhause")
    team = {"id": new_id(), "name": "Lions Rocket", "tag": "LRK", "leader_id": captain["id"], "member_ids": [captain["id"], sub["id"], outside["id"]]}
    await flow.db.teams.insert_one(dict(team))
    await flow.db.tournament_registrations.insert_one({"id": new_id(), "tournament_id": cup["id"], "team_id": team["id"], "user_id": captain["id"],
                                                       "status": "checked_in", "lineup": [captain["id"]], "substitutes": [sub["id"]]})

    flow.act_as(checked)
    items = (await flow.get("/api/feedback/open")).json()["items"]
    assert [row["question"] for row in items] == ["Wie war der Herbst-Cup?"]
    for user in (played, captain, sub):
        flow.act_as(user)
        assert len((await flow.get("/api/feedback/open")).json()["items"]) == 1, user["username"]
    for user in (absent, stranger, outside):
        flow.act_as(user)
        assert (await flow.get("/api/feedback/open")).json()["items"] == [], user["username"]
        assert (await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 5})).status_code == 403

    flow.act_as(checked)
    assert (await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 6})).status_code == 422
    ok = await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 4, "tags": ["Ablauf", "Quatsch", "Stimmung"], "text": "  Schnelle Aufrufe,   tolle Stimmung. "})
    assert ok.status_code == 200
    again = await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 1})
    assert again.status_code == 409, "einmal je Turnier"
    assert (await flow.get("/api/feedback/open")).json()["items"] == []

    flow.act_as(played)
    assert (await flow.post(f"/api/feedback/tournament/{cup['id']}/decline")).status_code == 200
    assert (await flow.get("/api/feedback/open")).json()["items"] == [], "„Lieber nicht“ beendet die Frage"
    assert (await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 3})).status_code == 409

    # Die Antwort steht ohne Person; wer geantwortet hat, steht getrennt davon.
    entry = await flow.db.feedback_entries.find_one({"target_id": cup["id"]}, {"_id": 0})
    assert "user_id" not in entry and entry["tags"] == ["Ablauf", "Stimmung"] and entry["text"] == "Schnelle Aufrufe, tolle Stimmung."
    assert entry["day"] == "2026-10-18" and entry["tone"] == "good"

    # Nach zwei Wochen fragt niemand mehr.
    clock["now"] = NOW + timedelta(days=15)
    flow.act_as(sub)
    assert (await flow.get("/api/feedback/open")).json()["items"] == []


@pytest.mark.asyncio
async def test_events_ask_the_checked_in(flow, clock):
    fest = {"id": new_id(), "slug": "sommerfest", "name": "Sommerfest", "status": "published", "start_date": "2026-10-16T14:00:00+00:00", "end_date": "2026-10-17T20:00:00+00:00"}
    await flow.db.events.insert_one(dict(fest))
    there = await flow.add_user(role="player", name="dabei")
    only_registered = await flow.add_user(role="player", name="angemeldet")
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": fest["id"], "user_id": there["id"], "status": "checked_in"})
    await flow.db.event_registrations.insert_one({"id": new_id(), "event_id": fest["id"], "user_id": only_registered["id"], "status": "registered"})
    flow.act_as(there)
    assert [row["question"] for row in (await flow.get("/api/feedback/open")).json()["items"]] == ["Wie war das Sommerfest?"]
    flow.act_as(only_registered)
    assert (await flow.get("/api/feedback/open")).json()["items"] == []
    # Am Tag danach kommt einmal eine Meldung - nur an die Eingecheckten.
    assert (await feedback.send_requests(flow.db, now=NOW))["sent"] == 1
    assert (await feedback.send_requests(flow.db, now=NOW))["sent"] == 0, "genau einmal"
    note = await flow.db.notifications.find_one({"kind": "feedback_request"}, {"_id": 0})
    assert note["user_id"] == there["id"] and note["url"] == f"/dashboard?bewerten=event:{fest['id']}" and note["title"] == "Wie war das Sommerfest?"


@pytest.mark.asyncio
async def test_admin_sees_no_names_and_details_only_from_three(flow, clock):
    cup, checked, played, absent, stranger = await setup_cup(flow)
    extra = []
    for name in ("dritte", "vierte"):
        user = await flow.add_user(role="player", name=name)
        await flow.register(cup, user, status="checked_in")
        extra.append(user)
    flow.act_as(checked)
    await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 5, "tags": ["Ablauf"], "text": "Top organisiert"})
    flow.act_as(played)
    await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 2, "tags": ["Zeitplan"], "text": "Zu lange Pausen"})

    flow.act_as(stranger)
    assert (await flow.get(f"/api/admin/feedback/tournament/{cup['id']}")).status_code == 403
    flow.act_as(await flow.add_staff())
    few = (await flow.get(f"/api/admin/feedback/tournament/{cup['id']}")).json()
    assert few["count"] == 2 and few["details"] is False and "texts" not in few and "average" not in few

    flow.act_as(extra[0])
    await flow.post(f"/api/feedback/tournament/{cup['id']}", json={"stars": 4, "tags": ["Stimmung", "Ablauf"]})
    flow.act_as(extra[1])
    await flow.post(f"/api/feedback/tournament/{cup['id']}/decline")
    flow.act_as(await flow.add_staff(name="Leitung 2"))
    report = (await flow.get(f"/api/admin/feedback/tournament/{cup['id']}")).json()
    assert report["count"] == 3 and report["declined"] == 1 and report["average"] == 3.7
    assert report["distribution"] == {"1": 0, "2": 1, "3": 0, "4": 1, "5": 1}
    assert report["praised"] == {"Ablauf": 2, "Stimmung": 1} and report["criticised"] == {"Zeitplan": 1}
    assert [row["text"] for row in report["texts"]] == ["Top organisiert", "Zu lange Pausen"]
    raw = json.dumps(report)
    for user in (checked, played, *extra):
        assert user["id"] not in raw and user["username"] not in raw, "keine Namen, keine Kennungen"


@pytest.mark.asyncio
async def test_the_question_is_a_row_in_open_actions(flow, clock):
    cup, checked, *_ = await setup_cup(flow)
    flow.act_as(checked)
    actions = (await flow.get("/api/mobile/dashboard")).json()["me"]["actions"]
    row = next(action for action in actions if action["type"] == "feedback")
    assert row["label"] == "Wie war der Herbst-Cup?" and row["target_id"] == f"tournament:{cup['id']}" and row["target_type"] == "feedback"
