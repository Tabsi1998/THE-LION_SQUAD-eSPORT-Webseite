"""Private Live-Meldungen, durch die echte Anwendung geschickt.

Direktnachrichten, Team-Chat und Benachrichtigungen sind keine öffentlichen
Ressourcen. Der Änderungsstrom kannte bisher nur "öffentlich" und "Staff" - ein
normales Mitglied erfuhr also nie von seiner eigenen neuen Nachricht. Web und
App mussten dafür abfragen.

Diese Tests prüfen den ganzen Weg: Route, Benachrichtigung und Strom. Und sie
prüfen die Kehrseite, auf die es ankommt - wer nicht beteiligt ist, bekommt
nichts, auch Staff nicht.
"""
import asyncio
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow, new_id  # noqa: E402
from services import change_events  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    change_events._subscribers.clear()
    try:
        yield instance
    finally:
        change_events._subscribers.clear()
        await shutdown()


def listen(user: dict | None, scope: str = "public") -> asyncio.Queue:
    """Ein offener Strom, so wie server.py ihn für diesen Nutzer anlegt."""
    queue: asyncio.Queue = asyncio.Queue()
    change_events._subscribers.add((queue, scope, user["id"] if user else None))
    return queue


def private_resources(queue: asyncio.Queue) -> set[str]:
    resources = set()
    while not queue.empty():
        _name, event = queue.get_nowait()
        if event.get("visibility_scope") == change_events.USER_SCOPE:
            resources.add(event["resource"])
    return resources


@pytest.mark.asyncio
async def test_a_direct_message_reaches_both_sides_and_nobody_else(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    carol = await flow.add_user(name="carol")
    moderator = await flow.add_staff(name="moderation")
    alice_stream, bob_stream = listen(alice), listen(bob)
    carol_stream, staff_stream, guest_stream = listen(carol), listen(moderator, "staff"), listen(None)

    flow.act_as(alice)
    response = await flow.post(f"/api/messages/direct/{bob['id']}", json={"message": "Training heute?"})

    assert response.status_code == 200, response.text
    assert private_resources(bob_stream) == {"messages", "notifications"}
    # Alices andere Geräte zeigen die gesendete Nachricht, ihre Glocke bleibt still.
    assert private_resources(alice_stream) == {"messages"}
    assert private_resources(carol_stream) == set()
    assert private_resources(staff_stream) == set()
    assert private_resources(guest_stream) == set()


@pytest.mark.asyncio
async def test_team_chat_reaches_members_only(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    carol = await flow.add_user(name="carol")
    team = {
        "id": new_id(),
        "name": "Lions Rot",
        "tag": "LSR",
        "captain_id": alice["id"],
        "owner_id": alice["id"],
        "member_ids": [alice["id"], bob["id"]],
        "is_public": True,
    }
    await flow.db.teams.insert_one(dict(team))
    bob_stream, carol_stream = listen(bob), listen(carol)

    flow.act_as(alice)
    response = await flow.post(f"/api/teams/{team['id']}/chat", json={"message": "Aufstellung steht"})

    assert response.status_code == 200, response.text
    assert "teams" in private_resources(bob_stream)
    assert private_resources(carol_stream) == set()


@pytest.mark.asyncio
async def test_a_private_event_names_the_resource_and_nothing_else(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    bob_stream = listen(bob)

    flow.act_as(alice)
    await flow.post(f"/api/messages/direct/{bob['id']}", json={"message": "streng geheim"})

    rendered = []
    while not bob_stream.empty():
        _name, event = bob_stream.get_nowait()
        rendered.append(change_events._format_sse("change", event))
    text = "".join(rendered)
    assert text
    assert "streng geheim" not in text
    assert alice["id"] not in text
    assert bob["id"] not in text
    assert change_events.TARGETS_KEY not in text
