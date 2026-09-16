"""Direktnachrichten seitenweise (#254) - durch die echte Anwendung.

Die Unterhaltung liefert zuerst die neuesten Nachrichten; mit ``before`` kommen
die älteren davor, ohne Doppelte, bis ``has_more`` falsch ist. Gelesen markiert
wird nur beim Öffnen (erste Seite), nicht beim Nachladen.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def _send_many(flow, sender, recipient, count: int) -> list[str]:
    flow.act_as(sender)
    ids = []
    for index in range(count):
        response = await flow.post(f"/api/messages/direct/{recipient['id']}", json={"message": f"Nachricht {index + 1}"})
        assert response.status_code == 200, response.text
        ids.append(response.json()["id"])
    return ids


@pytest.mark.asyncio
async def test_the_thread_starts_with_the_newest_and_pages_backwards_without_duplicates(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    sent = await _send_many(flow, bob, alice, 7)

    flow.act_as(alice)
    first = await flow.get(f"/api/messages/direct/{bob['id']}?limit=3")
    assert first.status_code == 200, first.text
    page = first.json()
    assert [row["message"] for row in page["messages"]] == ["Nachricht 5", "Nachricht 6", "Nachricht 7"]
    assert page["has_more"] is True
    assert page["page_size"] == 3

    oldest = page["messages"][0]["id"]
    second = await flow.get(f"/api/messages/direct/{bob['id']}?before={oldest}&limit=3")
    page2 = second.json()
    assert [row["message"] for row in page2["messages"]] == ["Nachricht 2", "Nachricht 3", "Nachricht 4"]
    assert page2["has_more"] is True

    third = await flow.get(f"/api/messages/direct/{bob['id']}?before={page2['messages'][0]['id']}&limit=3")
    page3 = third.json()
    assert [row["message"] for row in page3["messages"]] == ["Nachricht 1"]
    assert page3["has_more"] is False

    seen = [row["id"] for row in page3["messages"] + page2["messages"] + page["messages"]]
    assert seen == sent


@pytest.mark.asyncio
async def test_only_opening_the_thread_marks_messages_read_and_the_default_page_is_fifty(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    sent = await _send_many(flow, bob, alice, 52)

    flow.act_as(alice)
    # Noch nichts gelesen: das Nachladen älterer Seiten ändert daran nichts.
    older = await flow.get(f"/api/messages/direct/{bob['id']}?before={sent[-1]}&limit=5")
    assert older.status_code == 200
    conversations = await flow.get("/api/messages/conversations")
    assert conversations.json()[0]["unread_count"] == 52

    opened = await flow.get(f"/api/messages/direct/{bob['id']}")
    page = opened.json()
    assert len(page["messages"]) == 50
    assert page["messages"][-1]["message"] == "Nachricht 52"
    assert page["has_more"] is True
    conversations = await flow.get("/api/messages/conversations")
    assert conversations.json()[0]["unread_count"] == 0


@pytest.mark.asyncio
async def test_a_foreign_or_unknown_anchor_is_rejected_and_the_limit_is_capped(flow):
    alice = await flow.add_user(name="alice")
    bob = await flow.add_user(name="bob")
    carol = await flow.add_user(name="carol")
    await _send_many(flow, bob, alice, 2)
    foreign = (await _send_many(flow, carol, alice, 1))[0]

    flow.act_as(alice)
    response = await flow.get(f"/api/messages/direct/{bob['id']}?before={foreign}")
    assert response.status_code == 404

    response = await flow.get(f"/api/messages/direct/{bob['id']}?limit=500")
    assert response.status_code == 200
    assert response.json()["page_size"] == 100
