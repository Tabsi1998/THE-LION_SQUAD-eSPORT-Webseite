"""Chat und Erfolge (#2338): eine Nachricht merkt die Person in der Warteschlange vor, statt sie im Anfrage-Pfad voll
auszuwerten - viele Nachrichten hintereinander ergeben eine Auswertung."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import word_filter  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.fixture
def no_direct_evaluation(monkeypatch):
    import badges

    called = []

    async def evaluate(*args, **kwargs):
        called.append(args)
        return 0

    monkeypatch.setattr(badges, "evaluate_user_progress", evaluate)
    return called


@pytest.mark.asyncio
async def test_a_chat_message_is_evaluated_through_the_queue_not_in_the_request(flow, no_direct_evaluation):
    me = await flow.add_user(name="teamchat")
    await flow.db.teams.insert_one({"id": "tm-q", "name": "Lions", "tag": "LQ", "leader_id": me["id"], "co_leader_ids": [], "member_ids": [me["id"]]})
    flow.act_as(me)
    for text in ("eins", "zwei", "drei"):
        response = await flow.post("/api/teams/tm-q/chat", json={"message": text})
        assert response.status_code == 200, response.text
    assert no_direct_evaluation == [], "keine volle Auswertung je Nachricht"
    entries = await flow.db.achievement_eval_queue.find({"user_id": me["id"]}, {"_id": 0}).to_list(10)
    assert len(entries) == 1, "drei Nachrichten, eine Auswertung"
    assert set(entries[0]["sources"]) == {"chat", "community"} and not entries[0].get("full")


@pytest.mark.asyncio
async def test_a_released_message_queues_its_author(flow, no_direct_evaluation):
    """Zurückgehalten zählte sie nicht - freigegeben zählt sie, also wird der Absender vorgemerkt."""
    author = await flow.add_user(name="freigabe")
    moderator = await flow.add_user(name="moderation")
    db = flow.db
    await db.team_chat_messages.insert_one({"id": "held-1", "team_id": "tm", "user_id": author["id"], "message": "x", "moderation": {"state": "held"}})
    item = {"id": "mi-1", "kind": "team", "collection": "team_chat_messages", "ref_id": "held-1", "user_id": author["id"], "state": "pending"}
    await db.moderation_items.insert_one(dict(item))
    await word_filter.review(db, item, decision="release", moderator_id=moderator["id"])
    entry = await db.achievement_eval_queue.find_one({"user_id": author["id"]}, {"_id": 0})
    assert entry and set(entry["sources"]) == {"chat", "community"}
