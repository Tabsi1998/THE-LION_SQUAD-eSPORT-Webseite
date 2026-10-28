"""Push-Tests (#2119 ML8): der Test landet im Postfach der Person - erkennbar als Test, nicht als normale Meldung."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


@pytest.mark.asyncio
async def test_a_push_test_is_marked_as_test_in_the_inbox(flow):
    admin = await flow.add_user(role="club_admin", name="admin")
    target = await flow.add_user(name="paula")
    flow.act_as(admin)

    own_title = await flow.post("/api/admin/mobile-push/test", json={"user_id": target["id"], "title": "Hallo vom Verein", "body": "Kommt das an?"})
    assert own_title.status_code == 200, own_title.text
    default = await flow.post("/api/admin/mobile-push/test", json={"user_id": target["id"], "title": "", "body": ""})
    assert default.status_code == 200, default.text

    notes = await flow.db.notifications.find({"user_id": target["id"], "kind": "admin_push_test"}, {"_id": 0}).sort("created_at", 1).to_list(10)
    titles = sorted(note["title"] for note in notes)
    assert titles == ["Test: Hallo vom Verein", "Test: Push an dein Handy"]
    assert all(note["meta"]["admin_test"] is True for note in notes)
    assert any("Kommt das an?" == note["body"] for note in notes)
