"""Alle Chats an einem Ort (#1148) - durch die echte Anwendung geschickt.

Die Liste zeigt Direktnachrichten, Team-, Turnier- und Match-Chats einer Person, das Neueste oben, mit der Zahl der
Ungelesenen. Geprüft wird vor allem die Grenze: niemand sieht eine Unterhaltung, auf die er im Chat selbst keinen
Zugriff hat, und Turnier- und Match-Chats verschwinden drei Tage nach dem Turnierende aus der Liste.
"""
import pathlib
import sys
from datetime import timedelta

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from models import now_utc  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def ago(**delta) -> str:
    return (now_utc() - timedelta(**delta)).isoformat()


async def team_with(flow, leader, *members, name="Lions Rocket"):
    team = {
        "id": new_id(), "name": name, "tag": "LR", "leader_id": leader["id"], "co_leader_ids": [],
        "member_ids": [leader["id"], *[m["id"] for m in members]], "status": "active",
    }
    await flow.db.teams.insert_one(dict(team))
    return team


async def team_message(flow, team, author, text, created_at):
    await flow.db.team_chat_messages.insert_one({"id": new_id(), "team_id": team["id"], "user_id": author["id"], "message": text, "created_at": created_at})


async def chat_list(flow, user):
    flow.act_as(user)
    response = await flow.get("/api/chats")
    assert response.status_code == 200, response.text
    return response.json()


def keys(data):
    return [item["key"] for item in data["items"]]


@pytest.mark.asyncio
async def test_all_four_kinds_in_one_list_newest_first(flow):
    neon = await flow.add_user(name="NeonFalke")
    kiwi = await flow.add_user(name="KiwiKomet")
    luna = await flow.add_user(name="LunaByte")

    team = await team_with(flow, luna, neon)
    await team_message(flow, team, luna, "Training heute um 20 Uhr", ago(minutes=3))

    tournament, users, registrations = await flow.with_participants(2, show_chat=True, title="FC 26 Cup")
    await flow.register(tournament, neon)
    await flow.db.tournament_chat_messages.insert_one({"id": new_id(), "tournament_id": tournament["id"], "user_id": users[0]["id"], "message": "Halbfinale ab 15 Uhr", "created_at": ago(minutes=30)})

    own = await flow.db.tournament_registrations.find_one({"tournament_id": tournament["id"], "user_id": neon["id"]}, {"_id": 0})
    match = {"id": new_id(), "tournament_id": tournament["id"], "slots": [{"registration_id": own["id"]}, {"registration_id": registrations[0]["id"]}], "status": "scheduled"}
    await flow.db.matches_v2.insert_one(dict(match))
    await flow.db.match_chat_messages.insert_one({"id": new_id(), "match_id": match["id"], "tournament_id": tournament["id"], "user_id": users[0]["id"], "message": "PC 3 ist frei", "created_at": ago(hours=2)})

    await flow.db.direct_messages.insert_one({"id": new_id(), "sender_id": kiwi["id"], "recipient_id": neon["id"], "message": "gg! Revanche?", "created_at": ago(hours=1)})

    data = await chat_list(flow, neon)
    assert keys(data) == [f"team:{team['id']}", f"tournament:{tournament['id']}", f"direct:{kiwi['id']}", f"match:{match['id']}"]
    by_kind = {item["kind"]: item for item in data["items"]}
    assert by_kind["team"]["last_message"]["text"] == "Training heute um 20 Uhr"
    assert by_kind["team"]["last_message"]["author"] == "LunaByte"
    assert by_kind["team"]["subtitle"] == "Team-Chat"
    assert by_kind["direct"]["url"] == f"/messages/{kiwi['id']}"
    assert by_kind["tournament"]["url"].endswith("/chat")
    assert by_kind["match"]["title"] == f"NeonFalke gegen {users[0]['display_name']}"
    assert by_kind["match"]["context"] == "FC 26 Cup"
    # Jede Unterhaltung hat eine ungelesene Nachricht - die Summe ist die Zahl am Tab „Community“.
    assert [item["unread_count"] for item in data["items"]] == [1, 1, 1, 1]
    assert data["unread_total"] == 4


@pytest.mark.asyncio
async def test_nobody_sees_a_chat_without_access(flow):
    neon = await flow.add_user(name="NeonFalke")
    stranger = await flow.add_user(name="Fremder")
    luna = await flow.add_user(name="LunaByte")
    team = await team_with(flow, luna, neon)
    await team_message(flow, team, luna, "nur fürs Team", ago(minutes=5))

    # Turnier ohne eingeschalteten Chat: auch Teilnehmer sehen ihn nicht in der Liste.
    closed = await flow.create_tournament(show_chat=False)
    await flow.register(closed, neon)
    # Turnier mit Chat, aber Anmeldung noch nicht bestätigt.
    pending = await flow.create_tournament(show_chat=True)
    await flow.register(pending, neon, status="pending")

    assert keys(await chat_list(flow, stranger)) == []
    assert keys(await chat_list(flow, neon)) == [f"team:{team['id']}"]

    # Die Turnierleitung sieht den Turnier-Chat, auch wenn er für Teilnehmer aus ist.
    staff = await flow.add_user(name="Turnierleitung")
    await flow.db.tournament_staff_assignments.insert_one({"id": new_id(), "tournament_id": closed["id"], "user_id": staff["id"], "role": "tournament_admin", "scope": "tournament", "is_active": True})
    assert keys(await chat_list(flow, staff)) == [f"tournament:{closed['id']}"]


@pytest.mark.asyncio
async def test_team_chat_only_for_its_members(flow):
    neon = await flow.add_user(name="NeonFalke")
    luna = await flow.add_user(name="LunaByte")
    team = await team_with(flow, luna)
    await team_message(flow, team, luna, "Hallo Team", ago(minutes=1))
    assert keys(await chat_list(flow, neon)) == []
    await flow.db.teams.update_one({"id": team["id"]}, {"$push": {"member_ids": neon["id"]}})
    assert keys(await chat_list(flow, neon)) == [f"team:{team['id']}"]
    # Ein aufgelöstes Team steht nicht mehr in der Liste.
    await flow.db.teams.update_one({"id": team["id"]}, {"$set": {"status": "archived"}})
    assert keys(await chat_list(flow, neon)) == []


@pytest.mark.asyncio
async def test_tournament_and_match_chats_leave_three_days_after_the_end(flow):
    neon = await flow.add_user(name="NeonFalke")
    other = await flow.add_user(name="PixelPanther")
    tournament = await flow.create_tournament(show_chat=True, status="completed", end_date=ago(days=2))
    own = await flow.register(tournament, neon)
    theirs = await flow.register(tournament, other)
    match = {"id": new_id(), "tournament_id": tournament["id"], "slots": [{"registration_id": own["id"]}, {"registration_id": theirs["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    await flow.db.match_chat_messages.insert_one({"id": new_id(), "match_id": match["id"], "tournament_id": tournament["id"], "user_id": other["id"], "message": "gg", "created_at": ago(days=2)})

    assert set(keys(await chat_list(flow, neon))) == {f"tournament:{tournament['id']}", f"match:{match['id']}"}

    await flow.db.tournaments.update_one({"id": tournament["id"]}, {"$set": {"end_date": ago(days=4)}})
    assert keys(await chat_list(flow, neon)) == []

    # Auf ihrer Seite bleiben sie lesbar.
    flow.act_as(neon)
    assert (await flow.get(f"/api/matches/{match['id']}/chat")).status_code == 200


@pytest.mark.asyncio
async def test_match_chat_only_once_written_and_only_for_players(flow):
    neon = await flow.add_user(name="NeonFalke")
    other = await flow.add_user(name="PixelPanther")
    outsider = await flow.add_user(name="Zuschauer")
    tournament = await flow.create_tournament(show_chat=False)
    own = await flow.register(tournament, neon)
    theirs = await flow.register(tournament, other)
    await flow.register(tournament, outsider)
    match = {"id": new_id(), "tournament_id": tournament["id"], "slots": [{"registration_id": own["id"]}, {"registration_id": theirs["id"]}]}
    await flow.db.matches_v2.insert_one(dict(match))
    assert keys(await chat_list(flow, neon)) == []
    await flow.db.match_chat_messages.insert_one({"id": new_id(), "match_id": match["id"], "tournament_id": tournament["id"], "user_id": other["id"], "message": "bereit?", "created_at": ago(minutes=2)})
    assert keys(await chat_list(flow, neon)) == [f"match:{match['id']}"]
    assert keys(await chat_list(flow, outsider)) == []


@pytest.mark.asyncio
async def test_read_mark_resets_the_unread_count_everywhere(flow):
    neon = await flow.add_user(name="NeonFalke")
    luna = await flow.add_user(name="LunaByte")
    kiwi = await flow.add_user(name="KiwiKomet")
    team = await team_with(flow, luna, neon)
    await team_message(flow, team, luna, "eins", ago(minutes=4))
    await team_message(flow, team, luna, "zwei", ago(minutes=3))
    await team_message(flow, team, neon, "meine eigene zählt nicht", ago(minutes=2))
    await flow.db.direct_messages.insert_one({"id": new_id(), "sender_id": kiwi["id"], "recipient_id": neon["id"], "message": "hi", "created_at": ago(minutes=1)})
    await flow.db.notifications.insert_one({"id": new_id(), "user_id": neon["id"], "kind": "team_chat_message", "meta": {"team_id": team["id"]}, "read": False})

    data = await chat_list(flow, neon)
    assert {item["key"]: item["unread_count"] for item in data["items"]} == {f"team:{team['id']}": 2, f"direct:{kiwi['id']}": 1}
    assert data["unread_total"] == 3

    flow.act_as(neon)
    assert (await flow.post(f"/api/chats/team/{team['id']}/read")).status_code == 200
    assert (await flow.post(f"/api/chats/direct/{kiwi['id']}/read")).status_code == 200
    data = await chat_list(flow, neon)
    assert data["unread_total"] == 0
    # Die Glocke zählt die Teamnachricht nicht mehr.
    assert await flow.db.notifications.count_documents({"user_id": neon["id"], "read": {"$ne": True}}) == 0
    unread = await flow.get("/api/chats/unread")
    assert unread.json() == {"unread_total": 0}

    # Neue Nachricht nach der Marke zählt wieder.
    await team_message(flow, team, luna, "drei", (now_utc() + timedelta(seconds=5)).isoformat())
    assert (await chat_list(flow, neon))["unread_total"] == 1


@pytest.mark.asyncio
async def test_without_a_read_mark_only_recent_messages_count(flow):
    neon = await flow.add_user(name="NeonFalke")
    luna = await flow.add_user(name="LunaByte")
    team = await team_with(flow, luna, neon)
    await team_message(flow, team, luna, "alt", ago(days=10))
    await team_message(flow, team, luna, "neu", ago(hours=5))
    item = (await chat_list(flow, neon))["items"][0]
    assert item["unread_count"] == 1
    assert item["last_message"]["text"] == "neu"


@pytest.mark.asyncio
async def test_read_needs_a_known_chat_and_an_account(flow):
    neon = await flow.add_user(name="NeonFalke")
    flow.act_as(None)
    assert (await flow.get("/api/chats")).status_code == 401
    flow.act_as(neon)
    assert (await flow.post("/api/chats/team/gibt-es-nicht/read")).status_code == 404
    assert (await flow.post("/api/chats/raum/x/read")).status_code == 404
