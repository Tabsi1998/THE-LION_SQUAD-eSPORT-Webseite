"""Freundschaften in der App (#240): jede Änderung meldet der Änderungsstrom beiden Seiten
(„friends“ je Nutzer), und die Benachrichtigung nennt den Nutzernamen, damit die App zum Profil
führt. Die Routen selbst gab es schon (#259)."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from routes import friend_routes  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def published(monkeypatch):
    calls: list[tuple[set[str], str]] = []

    async def fake_publish(user_ids, resource):
        calls.append(({uid for uid in user_ids if uid}, resource))

    monkeypatch.setattr(friend_routes, "publish_user_change", fake_publish)
    return calls


@pytest.mark.asyncio
async def test_request_accept_and_remove_reach_both_users(flow, published):
    paula = await flow.add_user(role="player", name="paula")
    max_ = await flow.add_user(role="player", name="max")
    pair = {paula["id"], max_["id"]}

    flow.act_as(paula)
    sent = await flow.post(f"/api/friends/{max_['id']}/request")
    assert sent.status_code == 200 and sent.json()["status"] == "pending" and sent.json()["outgoing"] is True
    assert published[-1] == (pair, "friends")
    note = await flow.db.notifications.find_one({"user_id": max_["id"], "kind": "friend_request"}, {"_id": 0})
    assert note["meta"]["requester_username"] == paula["username"]

    flow.act_as(max_)
    listing = (await flow.get("/api/friends")).json()
    assert [row["user"]["id"] for row in listing["incoming"]] == [paula["id"]]
    friendship_id = listing["incoming"][0]["id"]
    assert (await flow.post(f"/api/friends/{friendship_id}/accept")).status_code == 200
    assert published[-1] == (pair, "friends")
    accepted = await flow.db.notifications.find_one({"user_id": paula["id"], "kind": "friend_accept"}, {"_id": 0})
    assert accepted["meta"]["username"] == max_["username"]
    flow.act_as(paula)
    assert (await flow.get(f"/api/friends/status/{max_['id']}")).json()["status"] == "accepted"

    assert (await flow.client.delete(f"/api/friends/{max_['id']}")).status_code == 200
    assert published[-1] == (pair, "friends")
    assert (await flow.get(f"/api/friends/status/{max_['id']}")).json()["can_request"] is True


@pytest.mark.asyncio
async def test_decline_and_cancel_also_publish(flow, published):
    paula = await flow.add_user(role="player", name="paula")
    max_ = await flow.add_user(role="player", name="max")
    flow.act_as(paula)
    await flow.post(f"/api/friends/{max_['id']}/request")
    flow.act_as(max_)
    friendship_id = (await flow.get("/api/friends")).json()["incoming"][0]["id"]
    assert (await flow.post(f"/api/friends/{friendship_id}/decline")).status_code == 200
    assert published[-1] == ({paula["id"], max_["id"]}, "friends")

    flow.act_as(paula)
    await flow.post(f"/api/friends/{max_['id']}/request")
    published.clear()
    assert (await flow.client.delete(f"/api/friends/{max_['id']}")).status_code == 200
    assert published == [({paula["id"], max_["id"]}, "friends")]
