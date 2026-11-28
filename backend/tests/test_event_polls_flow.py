"""Abstimmung im Event (#2612): Die Verwaltung legt am Event Abstimmungen an, die Angemeldeten stimmen ab.

- Einstellbar je Abstimmung: Frist, eine oder mehrere Antworten (``max_choices``), Ergebnis sofort oder erst nach der
  Frist (``results_visibility``). Eine Stimme je Person, ändern bis zur Frist; genau zur Frist ist sie zu.
- Abstimmen dürfen nur Angemeldete (angemeldet oder eingecheckt). Wer abgesagt hat oder auf der Warteliste steht,
  stimmt nicht ab - die Abstimmung entscheidet über den Ablauf für die, die fix dabei sind, und eine Warteliste soll
  keine Stimmen sammeln können. Fremde bekommen 403, Gäste 401.
- Wer wie gestimmt hat, steht nirgends offen: die Verwaltung sieht nur Zahlen, das Protokoll keine Antworten.
- Ein Wähler ist ein Schlüssel aus Art und Kennung (``user:<id>``) - Begleitpersonen (#2615) kommen später als eigene Art.

Namen sind erfunden; es wird nichts echt verschickt (Mails landen nur in der Warteschlange der Testdatenbank).
"""
import asyncio
import json
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import InterleavedReads, make_flow  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def person(flow, name, *, role="player", **fields):
    user = await flow.add_user(role=role, name=name)
    fields = {"email": f"{name}@lionsquad-test.at", **fields}
    await flow.db.users.update_one({"id": user["id"]}, {"$set": fields})
    user.update(fields)
    return user


async def register(flow, event, user):
    flow.act_as(user)
    response = await flow.post(f"/api/events/{event['id']}/registrations", json={"companion_count": 0})
    assert response.status_code == 200, response.text
    return response.json()


async def setup_event(flow):
    """Zwei Plätze: paula und max sind angemeldet, otto steht auf der Warteliste, fremd ist nicht dabei."""
    leitung = await person(flow, "leitung", role="tournament_admin")
    flow.act_as(leitung)
    payload = {"name": "Silvesterparty", "status": "registration_open", "visibility": "public", "has_registration": True,
               "max_participants": 2, "location": "Vereinsheim", "start_date": (now_utc() + timedelta(days=30)).isoformat()}
    response = await flow.post("/api/events", json=payload)
    assert response.status_code == 200, response.text
    event = response.json()
    people = {name: await person(flow, name) for name in ("paula", "max", "otto", "fremd")}
    for name in ("paula", "max", "otto"):
        await register(flow, event, people[name])
    return leitung, event, people


def poll_body(**extra):
    return {"question": "Welche Rodelbahn?", "options": [{"label": "Rodelbahn A"}, {"label": "Rodelbahn B"}, {"label": "Rodelbahn C"}],
            "max_choices": 1, "results_visibility": "live", **extra}


async def create_poll(flow, leitung, event, **extra):
    flow.act_as(leitung)
    response = await flow.post(f"/api/admin/events/{event['id']}/polls", json=poll_body(**extra))
    assert response.status_code == 200, response.text
    return response.json()


async def vote(flow, user, event, poll, choices):
    flow.act_as(user)
    return await flow.put(f"/api/events/{event['id']}/polls/{poll['id']}/vote", json={"choices": choices})


async def public_polls(flow, user, event):
    flow.act_as(user)
    response = await flow.get(f"/api/events/{event['slug']}")
    assert response.status_code == 200, response.text
    return response.json()["polls"]


def at(monkeypatch, moment):
    from services import event_polls

    monkeypatch.setattr(event_polls, "now_utc", lambda: moment)


# --------------------------------------------------------------------------- Anlegen
@pytest.mark.asyncio
async def test_admin_creates_a_poll_with_codes_and_settings(flow):
    leitung, event, _people = await setup_event(flow)
    closes = (now_utc() + timedelta(days=10)).replace(microsecond=0)
    poll = await create_poll(flow, leitung, event, closes_at=closes.isoformat(), results_visibility="after_close", max_choices=2)
    assert poll["question"] == "Welche Rodelbahn?"
    assert [option["label"] for option in poll["options"]] == ["Rodelbahn A", "Rodelbahn B", "Rodelbahn C"]
    assert len({option["code"] for option in poll["options"]}) == 3
    assert poll["max_choices"] == 2 and poll["multiple"] is True and poll["results_visibility"] == "after_close"
    assert poll["voters"] == "registered" and poll["status"] == "open"
    assert poll["eligible_count"] == 2 and poll["voters_count"] == 0
    stored = await flow.db.event_polls.find_one({"id": poll["id"]}, {"_id": 0})
    assert stored["event_id"] == event["id"] and stored["created_by"] == leitung["id"]
    assert await flow.db.audit_logs.count_documents({"action": "event.poll.create", "target_id": event["id"]}) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("body, word", [
    ({"options": [{"label": "Nur eine"}]}, "zwei"),
    ({"question": "?"}, "Frage"),
    ({"max_choices": 4}, "Antworten"),
    ({"max_choices": 0}, "Antworten"),
    ({"results_visibility": "nie"}, "Ergebnis"),
    ({"options": [{"label": "Garage"}, {"label": "garage "}]}, "doppelt"),
    ({"options": [{"label": "Garage"}, {"label": ""}]}, "leer"),
])
async def test_invalid_polls_are_refused(flow, body, word):
    leitung, event, _people = await setup_event(flow)
    flow.act_as(leitung)
    response = await flow.post(f"/api/admin/events/{event['id']}/polls", json=poll_body(**body))
    assert response.status_code in (400, 422), response.text
    if response.status_code == 400:
        assert word.lower() in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_a_deadline_in_the_past_is_refused(flow):
    leitung, event, _people = await setup_event(flow)
    flow.act_as(leitung)
    response = await flow.post(f"/api/admin/events/{event['id']}/polls",
                               json=poll_body(closes_at=(now_utc() - timedelta(minutes=1)).isoformat()))
    assert response.status_code == 400 and "Frist" in response.json()["detail"]


@pytest.mark.asyncio
async def test_only_the_event_staff_manages_polls(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    flow.act_as(people["paula"])
    assert (await flow.post(f"/api/admin/events/{event['id']}/polls", json=poll_body())).status_code == 403
    assert (await flow.get(f"/api/admin/events/{event['id']}/polls")).status_code == 403
    removed = await flow.delete(f"/api/admin/events/{event['id']}/polls/{poll['id']}")
    assert removed.status_code == 403
    flow.act_as(None)
    assert (await flow.post(f"/api/admin/events/{event['id']}/polls/{poll['id']}/close")).status_code == 401


# --------------------------------------------------------------------------- Abstimmen
@pytest.mark.asyncio
async def test_registered_people_vote_and_change_their_vote_until_the_deadline(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, closes_at=(now_utc() + timedelta(days=3)).isoformat())
    a, b = poll["options"][0]["code"], poll["options"][1]["code"]

    first = await vote(flow, people["paula"], event, poll, [a])
    assert first.status_code == 200, first.text
    own = first.json()["rights"][0]
    assert own["for"] == "self" and own["state"] == "used" and own["choices"] == [a] and own["can_use"] is True
    changed = await vote(flow, people["paula"], event, poll, [b])
    assert changed.status_code == 200 and changed.json()["rights"][0]["choices"] == [b]

    rows = await flow.db.event_poll_votes.find({"poll_id": poll["id"]}, {"_id": 0}).to_list(10)
    assert len(rows) == 1
    # Der Wähler ist ein Schlüssel aus Art und Kennung - Begleitpersonen (#2615) bekommen später eine eigene Art.
    assert rows[0]["voter_key"] == f"user:{people['paula']['id']}" and rows[0]["voter_kind"] == "user"
    assert rows[0]["user_id"] == people["paula"]["id"] and rows[0]["choices"] == [b]

    polls = await public_polls(flow, people["max"], event)
    assert polls[0]["can_vote"] is True and polls[0]["rights"][0]["state"] == "open"
    assert polls[0]["result"]["counts"][1]["count"] == 1 and polls[0]["result"]["valid"] == 1


@pytest.mark.asyncio
async def test_guests_strangers_waitlist_and_cancelled_people_do_not_vote(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    code = poll["options"][0]["code"]

    flow.act_as(None)
    assert (await flow.put(f"/api/events/{event['id']}/polls/{poll['id']}/vote", json={"choices": [code]})).status_code == 401
    stranger = await vote(flow, people["fremd"], event, poll, [code])
    assert stranger.status_code == 403 and "Angemeldete" in stranger.json()["detail"]
    waiting = await vote(flow, people["otto"], event, poll, [code])
    assert waiting.status_code == 403 and "Warteliste" in waiting.json()["detail"]

    flow.act_as(people["max"])
    left = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert left.status_code == 200
    cancelled = await vote(flow, people["max"], event, poll, [code])
    assert cancelled.status_code == 403 and "abgemeldet" in cancelled.json()["detail"]
    assert await flow.db.event_poll_votes.count_documents({}) == 0

    # Die Seite sagt jeder Person, warum sie nicht abstimmen kann - ohne Stimmrecht in der Liste.
    view = (await public_polls(flow, people["otto"], event))[0]
    assert view["can_vote"] is False and view["rights"] == [] and view["reason"] == "waitlist"
    guest = (await public_polls(flow, None, event))[0]
    assert guest["reason"] == "login" and guest["can_vote"] is False


@pytest.mark.asyncio
async def test_a_vote_on_another_events_poll_is_refused(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    flow.act_as(leitung)
    other = (await flow.post("/api/events", json={"name": "Stammtisch", "status": "scheduled"})).json()
    response = await vote(flow, people["paula"], other, poll, [poll["options"][0]["code"]])
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_a_cancelled_registration_no_longer_counts(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    code = poll["options"][0]["code"]
    for name in ("paula", "max"):
        assert (await vote(flow, people[name], event, poll, [code])).status_code == 200
    flow.act_as(people["max"])
    left = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert left.status_code == 200
    flow.act_as(leitung)
    admin_view = (await flow.get(f"/api/admin/events/{event['id']}/polls")).json()[0]
    assert admin_view["result"]["counts"][0]["count"] == 1 and admin_view["voters_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("choices, status", [([], 400), (["gibt-es-nicht"], 400), ("FIRST_TWICE", 400), ("ALL", 400)])
async def test_choices_must_fit_the_poll(flow, choices, status):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, max_choices=2)
    codes = [option["code"] for option in poll["options"]]
    wanted = {"FIRST_TWICE": [codes[0], codes[0]], "ALL": codes}.get(choices, choices) if isinstance(choices, str) else choices
    response = await vote(flow, people["paula"], event, poll, wanted)
    assert response.status_code == status, response.text


@pytest.mark.asyncio
async def test_several_answers_when_the_poll_allows_them(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, max_choices=2)
    codes = [option["code"] for option in poll["options"]]
    response = await vote(flow, people["paula"], event, poll, [codes[0], codes[2]])
    assert response.status_code == 200, response.text
    result = response.json()["result"]
    assert [row["count"] for row in result["counts"]] == [1, 0, 1] and result["valid"] == 1


# --------------------------------------------------------------------------- Frist und Ergebnis
@pytest.mark.asyncio
async def test_the_deadline_is_exclusive_a_vote_exactly_at_the_end_is_too_late(flow, monkeypatch):
    leitung, event, people = await setup_event(flow)
    closes = (now_utc() + timedelta(days=2)).replace(microsecond=0)
    poll = await create_poll(flow, leitung, event, closes_at=closes.isoformat())
    code = poll["options"][0]["code"]

    at(monkeypatch, closes - timedelta(microseconds=1))
    assert (await vote(flow, people["paula"], event, poll, [code])).status_code == 200
    at(monkeypatch, closes)
    late = await vote(flow, people["max"], event, poll, [code])
    assert late.status_code == 409 and "Frist" in late.json()["detail"]
    # Auch ändern geht nicht mehr - die Stimme von paula bleibt, wie sie war.
    assert (await vote(flow, people["paula"], event, poll, [poll["options"][1]["code"]])).status_code == 409
    assert (await flow.db.event_poll_votes.find_one({"voter_key": f"user:{people['paula']['id']}"}))["choices"] == [code]
    view = (await public_polls(flow, people["paula"], event))[0]
    assert view["status"] == "closed" and view["can_vote"] is False and view["rights"][0]["can_use"] is False


@pytest.mark.asyncio
async def test_results_after_the_deadline_stay_hidden_until_then_but_the_staff_sees_counts(flow, monkeypatch):
    leitung, event, people = await setup_event(flow)
    closes = (now_utc() + timedelta(days=2)).replace(microsecond=0)
    poll = await create_poll(flow, leitung, event, closes_at=closes.isoformat(), results_visibility="after_close")
    code = poll["options"][2]["code"]
    assert (await vote(flow, people["paula"], event, poll, [code])).status_code == 200

    before = (await public_polls(flow, people["max"], event))[0]
    assert before["result"] is None and before["result_hidden"] is True
    mine = (await public_polls(flow, people["paula"], event))[0]
    assert mine["result"] is None and mine["rights"][0]["choices"] == [code]
    flow.act_as(leitung)
    admin_view = (await flow.get(f"/api/admin/events/{event['id']}/polls")).json()[0]
    assert admin_view["result"]["counts"][2]["count"] == 1 and admin_view["voters_count"] == 1

    at(monkeypatch, closes)
    after = (await public_polls(flow, None, event))[0]
    assert after["result_hidden"] is False and after["result"]["winner"] == code
    assert after["result"]["winner_label"] == "Rodelbahn C"


@pytest.mark.asyncio
async def test_closing_early_ends_the_vote_and_shows_the_result(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, results_visibility="after_close")
    code = poll["options"][0]["code"]
    assert (await vote(flow, people["paula"], event, poll, [code])).status_code == 200
    flow.act_as(leitung)
    closed = await flow.post(f"/api/admin/events/{event['id']}/polls/{poll['id']}/close")
    assert closed.status_code == 200 and closed.json()["status"] == "closed"
    assert (await vote(flow, people["max"], event, poll, [code])).status_code == 409
    view = (await public_polls(flow, people["max"], event))[0]
    assert view["result"]["winner"] == code
    assert await flow.db.audit_logs.count_documents({"action": "event.poll.close"}) == 1


@pytest.mark.asyncio
async def test_a_cancelled_event_takes_no_votes(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    flow.act_as(leitung)
    assert (await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled"})).status_code == 200
    response = await vote(flow, people["paula"], event, poll, [poll["options"][0]["code"]])
    # Mit der Absage ist auch die Anmeldung storniert - abstimmen kann niemand mehr.
    assert response.status_code in (403, 409)
    assert await flow.db.event_poll_votes.count_documents({}) == 0


# --------------------------------------------------------------------------- Geheim
@pytest.mark.asyncio
async def test_nobody_learns_who_voted_how(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    for name, index in (("paula", 0), ("max", 1)):
        assert (await vote(flow, people[name], event, poll, [poll["options"][index]["code"]])).status_code == 200
    flow.act_as(leitung)
    admin = await flow.get(f"/api/admin/events/{event['id']}/polls")
    flow.act_as(None)
    public = await flow.get(f"/api/events/{event['slug']}")
    # Die Teilnehmerliste der Seite nennt die Angemeldeten - geprüft wird, dass die Abstimmungen niemanden nennen.
    for text in (admin.text, json.dumps(public.json()["polls"])):
        assert people["paula"]["id"] not in text and people["max"]["id"] not in text
    audits = await flow.db.audit_logs.find({"action": {"$regex": "^event\\.poll"}}, {"_id": 0}).to_list(20)
    assert all(people["paula"]["id"] not in str(row) for row in audits)


@pytest.mark.asyncio
async def test_two_votes_of_the_same_person_at_once_leave_one_vote(flow, monkeypatch):
    from routes import event_poll_routes

    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    a, b = poll["options"][0]["code"], poll["options"][1]["code"]
    gate = InterleavedReads(flow.db, "event_poll_votes", before=("update_one",))
    monkeypatch.setattr(event_poll_routes, "get_db", lambda: gate)
    flow.act_as(people["paula"])
    url = f"/api/events/{event['id']}/polls/{poll['id']}/vote"
    first, second = await asyncio.gather(flow.put(url, json={"choices": [a]}), flow.put(url, json={"choices": [b]}))
    assert [first.status_code, second.status_code] == [200, 200]
    rows = await flow.db.event_poll_votes.find({"poll_id": poll["id"]}, {"_id": 0}).to_list(10)
    assert len(rows) == 1 and rows[0]["choices"] in ([a], [b])


# --------------------------------------------------------------------------- Ändern, Löschen, Nachricht
@pytest.mark.asyncio
async def test_options_with_votes_cannot_be_removed_but_relabelled(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    first = poll["options"][0]
    assert (await vote(flow, people["paula"], event, poll, [first["code"]])).status_code == 200
    flow.act_as(leitung)
    url = f"/api/admin/events/{event['id']}/polls/{poll['id']}"
    removed = await flow.patch(url, json={"options": poll["options"][1:]})
    assert removed.status_code == 409 and "Stimmen" in removed.json()["detail"]
    relabelled = await flow.patch(url, json={"options": [{**first, "label": "Rodelbahn A (Hochegg)"}, *poll["options"][1:]],
                                             "question": "Welche Rodelbahn am 31.12.?"})
    assert relabelled.status_code == 200, relabelled.text
    assert relabelled.json()["options"][0] == {"code": first["code"], "label": "Rodelbahn A (Hochegg)"}
    assert relabelled.json()["result"]["counts"][0]["count"] == 1


@pytest.mark.asyncio
async def test_deleting_a_poll_removes_its_votes(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    assert (await vote(flow, people["paula"], event, poll, [poll["options"][0]["code"]])).status_code == 200
    flow.act_as(leitung)
    removed = await flow.delete(f"/api/admin/events/{event['id']}/polls/{poll['id']}")
    assert removed.status_code == 200
    assert await flow.db.event_polls.count_documents({}) == 0
    assert await flow.db.event_poll_votes.count_documents({}) == 0
    assert (await public_polls(flow, None, event)) == []


@pytest.mark.asyncio
async def test_deleting_the_event_takes_its_polls_and_votes_along(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    assert (await vote(flow, people["paula"], event, poll, [poll["options"][0]["code"]])).status_code == 200
    flow.act_as(leitung)
    assert (await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled"})).status_code == 200
    removed = await flow.delete(f"/api/events/{event['id']}")
    assert removed.status_code == 200, removed.text
    assert await flow.db.event_polls.count_documents({}) == 0
    assert await flow.db.event_poll_votes.count_documents({}) == 0


@pytest.mark.asyncio
async def test_a_new_poll_can_tell_the_registered_people_once(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, notify=True, closes_at=(now_utc() + timedelta(days=5)).isoformat())
    assert poll["notice"]["notified"] == 2
    notes = await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(10)
    # Nur wer abstimmen darf - nicht die Warteliste.
    assert sorted(note["user_id"] for note in notes) == sorted([people["paula"]["id"], people["max"]["id"]])
    assert all("Abstimmung" in note["title"] and "Welche Rodelbahn?" in note["body"] for note in notes)
    assert all(note["meta"]["dedupe_key"] == f"event-poll:{poll['id']}:{note['user_id']}" for note in notes)
    quiet = await create_poll(flow, leitung, event)
    assert "notice" not in quiet or quiet["notice"] is None
    assert await flow.db.notifications.count_documents({"kind": "event_message"}) == 2


@pytest.mark.asyncio
async def test_the_poll_list_reads_without_an_account_and_for_the_app(flow):
    leitung, event, _people = await setup_event(flow)
    await create_poll(flow, leitung, event)
    flow.act_as(None)
    response = await flow.get(f"/api/events/{event['id']}/polls")
    assert response.status_code == 200
    polls = response.json()["polls"]
    assert len(polls) == 1 and polls[0]["options"] and polls[0]["closes_at"] is None
    hidden = await flow.get("/api/events/gibt-es-nicht/polls")
    assert hidden.status_code == 404


# --------------------------------------------------------------------------- Review-Runde (Befunde 6, 7, 8, 11, 12)
async def admin_polls(flow, leitung, event):
    flow.act_as(leitung)
    return (await flow.get(f"/api/admin/events/{event['id']}/polls")).json()


@pytest.mark.asyncio
async def test_lowering_max_choices_below_cast_votes_is_refused(flow):
    """Befund 6: Wer schon zwei Antworten gewählt hat, behält zwei Stimmen - also nicht auf eine Antwort senken."""
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, max_choices=2)
    codes = [option["code"] for option in poll["options"]]
    assert (await vote(flow, people["paula"], event, poll, codes[:2])).status_code == 200
    flow.act_as(leitung)
    url = f"/api/admin/events/{event['id']}/polls/{poll['id']}"
    lowered = await flow.patch(url, json={"max_choices": 1})
    assert lowered.status_code == 409 and "schon" in lowered.json()["detail"]
    assert (await flow.db.event_polls.find_one({"id": poll["id"]}))["max_choices"] == 2
    # Mehr erlauben geht weiter.
    assert (await flow.patch(url, json={"max_choices": 3})).status_code == 200


@pytest.mark.asyncio
async def test_the_result_is_frozen_when_the_poll_ends(flow):
    """Befund 7: Beim Beenden steht das Ergebnis fest - spätere Abmeldungen und Kontolöschungen ändern es nicht."""
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, results_visibility="after_close")
    code = poll["options"][0]["code"]
    for name in ("paula", "max"):
        assert (await vote(flow, people[name], event, poll, [code])).status_code == 200
    flow.act_as(leitung)
    closed = (await flow.post(f"/api/admin/events/{event['id']}/polls/{poll['id']}/close")).json()
    assert closed["result"]["counts"][0]["count"] == 2
    stored_poll = await flow.db.event_polls.find_one({"id": poll["id"]})
    assert stored_poll["final_result"]["counts"] == {poll["options"][0]["code"]: 2, poll["options"][1]["code"]: 0, poll["options"][2]["code"]: 0}
    assert "user" not in str(stored_poll["final_result"]) and people["max"]["id"] not in str(stored_poll["final_result"])

    flow.act_as(people["max"])
    left = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert left.status_code == 200
    # Wie bei einer Kontolöschung: die Stimme der Person ist weg, das Ergebnis bleibt.
    removed = await flow.db.event_poll_votes.delete_many({"user_id": people["paula"]["id"]})
    assert removed.deleted_count == 1
    assert (await admin_polls(flow, leitung, event))[0]["result"]["counts"][0]["count"] == 2
    assert (await public_polls(flow, None, event))[0]["result"]["counts"][0]["count"] == 2


@pytest.mark.asyncio
async def test_the_result_is_frozen_on_the_first_read_after_the_deadline(flow, monkeypatch):
    leitung, event, people = await setup_event(flow)
    closes = (now_utc() + timedelta(days=1)).replace(microsecond=0)
    poll = await create_poll(flow, leitung, event, closes_at=closes.isoformat())
    code = poll["options"][1]["code"]
    assert (await vote(flow, people["paula"], event, poll, [code])).status_code == 200
    at(monkeypatch, closes + timedelta(minutes=5))
    assert (await public_polls(flow, None, event))[0]["result"]["counts"][1]["count"] == 1
    assert (await flow.db.event_polls.find_one({"id": poll["id"]}))["final_result"]["valid"] == 1
    flow.act_as(people["paula"])
    left = await flow.delete(f"/api/events/{event['id']}/registrations/me")
    assert left.status_code == 200
    assert (await public_polls(flow, None, event))[0]["result"]["counts"][1]["count"] == 1


@pytest.mark.asyncio
async def test_an_ended_poll_cannot_be_reopened_with_a_new_deadline(flow, monkeypatch):
    """Befund 8: Verlängern geht, solange sie läuft - eine beendete oder abgelaufene Abstimmung bleibt zu."""
    leitung, event, _people = await setup_event(flow)
    closes = (now_utc() + timedelta(hours=1)).replace(microsecond=0)
    poll = await create_poll(flow, leitung, event, closes_at=closes.isoformat(), results_visibility="after_close")
    url = f"/api/admin/events/{event['id']}/polls/{poll['id']}"
    flow.act_as(leitung)
    longer = await flow.patch(url, json={"closes_at": (closes + timedelta(days=1)).isoformat()})
    assert longer.status_code == 200, longer.text
    at(monkeypatch, closes + timedelta(days=2))
    flow.act_as(leitung)
    reopened = await flow.patch(url, json={"closes_at": (closes + timedelta(days=5)).isoformat()})
    assert reopened.status_code == 409 and "beendet" in reopened.json()["detail"]
    assert (await public_polls(flow, None, event))[0]["status"] == "closed"
    # Die Frage lässt sich noch berichtigen.
    flow.act_as(leitung)
    assert (await flow.patch(url, json={"question": "Welche Rodelbahn am 31.?"})).status_code == 200


@pytest.mark.asyncio
async def test_a_vote_racing_the_close_never_slips_through(flow, monkeypatch):
    """Befund 11: Stimme und Beenden gleichzeitig - entweder zählt die Stimme im eingefrorenen Ergebnis, oder sie wird abgelehnt."""
    from routes import event_poll_routes

    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    code = poll["options"][0]["code"]
    gate = InterleavedReads(flow.db, "event_polls", before=("find_one",))
    monkeypatch.setattr(event_poll_routes, "get_db", lambda: gate)
    flow.act_as(people["paula"])
    voted, closed = await asyncio.gather(
        flow.put(f"/api/events/{event['id']}/polls/{poll['id']}/vote", json={"choices": [code]}),
        _close_as(flow, leitung, event, poll),
    )
    assert closed.status_code == 200 and voted.status_code in (200, 409)
    final = (await flow.db.event_polls.find_one({"id": poll["id"]}))["final_result"]
    assert final["counts"][code] == (1 if voted.status_code == 200 else 0)


async def _close_as(flow, leitung, event, poll):
    """Beenden mit eigenem Konto, ohne den Wechsel des angemeldeten Kontos im anderen Lauf zu stören."""
    from auth import get_current_user
    from fastapi import Request
    from flow_harness import load_application

    server = load_application()[1]
    original = server.app.dependency_overrides[get_current_user]

    async def pick(request: Request):
        return leitung if request.url.path.endswith("/close") else await original()

    server.app.dependency_overrides[get_current_user] = pick
    try:
        return await flow.post(f"/api/admin/events/{event['id']}/polls/{poll['id']}/close")
    finally:
        server.app.dependency_overrides[get_current_user] = original


@pytest.mark.asyncio
async def test_no_show_gets_its_own_reason(flow):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    await flow.db.event_registrations.update_one({"event_id": event["id"], "user_id": people["max"]["id"]}, {"$set": {"status": "no_show"}})
    response = await vote(flow, people["max"], event, poll, [poll["options"][0]["code"]])
    assert response.status_code == 403 and "nicht erschienen" in response.json()["detail"]
    assert "abgemeldet" not in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_new_poll_message_is_a_normal_info(flow):
    leitung, event, _people = await setup_event(flow)
    await create_poll(flow, leitung, event, notify=True)
    notes = await flow.db.notifications.find({"kind": "event_message"}, {"_id": 0}).to_list(10)
    assert notes and all(note["meta"].get("timely") is not True and note["meta"].get("importance") == "normal" for note in notes)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "archived"])
async def test_a_finished_event_takes_no_more_votes(flow, status):
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event)
    await flow.db.events.update_one({"id": event["id"]}, {"$set": {"status": status}})
    response = await vote(flow, people["paula"], event, poll, [poll["options"][0]["code"]])
    assert response.status_code == 409
    view = (await public_polls(flow, people["paula"], event))[0]
    assert view["status"] == "closed" and view["can_vote"] is False


# --------------------------------------------------------------------------- Nachprüfung (N1, N2, Frist auf Minuten)
@pytest.mark.asyncio
async def test_a_running_poll_does_not_take_a_deadline_in_the_past(flow):
    """N1: Eine Frist in der Vergangenheit ließe Stimmen still herausfallen - zum Schließen gibt es „Jetzt beenden“."""
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, closes_at=(now_utc() + timedelta(days=1)).isoformat())
    assert (await vote(flow, people["paula"], event, poll, [poll["options"][0]["code"]])).status_code == 200
    flow.act_as(leitung)
    past = await flow.patch(f"/api/admin/events/{event['id']}/polls/{poll['id']}", json={"closes_at": (now_utc() - timedelta(minutes=10)).isoformat()})
    assert past.status_code == 400
    assert past.json()["detail"] == "Die Frist liegt in der Vergangenheit – zum sofortigen Schließen ‚Jetzt beenden‘ nutzen."
    view = (await public_polls(flow, None, event))[0]
    assert view["status"] == "open" and view["result"]["valid"] == 1
    flow.act_as(leitung)
    created = await flow.post(f"/api/admin/events/{event['id']}/polls", json=poll_body(closes_at=(now_utc() - timedelta(minutes=1)).isoformat()))
    assert created.status_code == 400 and "Jetzt beenden" in created.json()["detail"]


@pytest.mark.asyncio
async def test_a_cancelled_and_restored_event_keeps_its_polls_open(flow):
    """N2: Der Event-Status sperrt nur Anzeige und Stimme - eingefroren wird nur beim eigenen Ende der Abstimmung."""
    leitung, event, people = await setup_event(flow)
    poll = await create_poll(flow, leitung, event, results_visibility="after_close")
    flow.act_as(leitung)
    assert (await flow.patch(f"/api/events/{event['id']}", json={"status": "cancelled"})).status_code == 200
    seen = (await public_polls(flow, None, event))[0]
    assert seen["status"] == "closed" and seen["result"] is None and seen["result_hidden"] is True
    assert (await flow.db.event_polls.find_one({"id": poll["id"]})).get("final_result") is None
    flow.act_as(leitung)
    assert (await flow.patch(f"/api/events/{event['id']}", json={"status": "registration_open"})).status_code == 200
    await register(flow, event, people["paula"])
    again = await vote(flow, people["paula"], event, poll, [poll["options"][0]["code"]])
    assert again.status_code == 200, again.text
    assert (await public_polls(flow, people["paula"], event))[0]["status"] == "open"


@pytest.mark.asyncio
async def test_renaming_an_ended_poll_with_a_deadline_in_seconds_works(flow, monkeypatch):
    """Hinweis: Über die API mit Sekunden angelegt, schickt die Maske die Frist nur auf die Minute zurück - das ist dieselbe Frist."""
    leitung, event, _people = await setup_event(flow)
    closes = (now_utc() + timedelta(days=1)).replace(second=37, microsecond=123456)
    poll = await create_poll(flow, leitung, event, closes_at=closes.isoformat())
    at(monkeypatch, closes + timedelta(hours=1))
    flow.act_as(leitung)
    minute = closes.replace(second=0, microsecond=0).isoformat()
    renamed = await flow.patch(f"/api/admin/events/{event['id']}/polls/{poll['id']}", json={"question": "Welche Rodelbahn am 31.?", "closes_at": minute})
    assert renamed.status_code == 200, renamed.text
    assert (await flow.db.event_polls.find_one({"id": poll["id"]}))["closes_at"] == poll["closes_at"]
