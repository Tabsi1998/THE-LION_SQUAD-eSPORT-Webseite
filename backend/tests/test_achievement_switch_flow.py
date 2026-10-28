"""Der Schalter „Erfolge“ gilt auch für Kronen und Level (#2119 ML2).

Die Kronen-Meldungen trugen die Kategorie „achievement“ (ohne s) - die gibt es nicht, also galt jede Meldung als erlaubt.
Level-Meldungen hatten gar keine Kategorie. Beide kamen trotz „Erfolge aus“ in Glocke, Push und Discord.
"""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from flow_harness import make_flow  # noqa: E402

OFF = {"in_app:achievements": False, "push:achievements": False, "discord:achievements": False}


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


async def people(flow):
    quiet = await flow.add_user(name="leise")
    loud = await flow.add_user(name="laut")
    await flow.db.users.update_one({"id": quiet["id"]}, {"$set": {"notification_preferences": OFF}})
    return quiet, loud


@pytest.mark.asyncio
async def test_crown_messages_follow_the_achievements_switch(flow):
    from services.crown_events import _persist_and_notify

    quiet, loud = await people(flow)
    await flow.db.crown_state.insert_one({"id": "current", "holders": {}, "version": 1})
    await _persist_and_notify({quiet["id"]: "gold", loud["id"]: "silver"})

    assert await flow.db.notifications.count_documents({"user_id": quiet["id"]}) == 0
    note = await flow.db.notifications.find_one({"user_id": loud["id"]}, {"_id": 0})
    assert note["kind"] == "crown_gained" and note["meta"]["category"] == "achievements"


@pytest.mark.asyncio
async def test_level_messages_follow_the_achievements_switch(flow):
    from services.xp import _announce_level_up

    quiet, loud = await people(flow)
    await _announce_level_up(quiet["id"], 4, 5, 0)
    await _announce_level_up(loud["id"], 4, 5, 0)

    assert await flow.db.notifications.count_documents({"user_id": quiet["id"]}) == 0
    assert await flow.db.notifications.count_documents({"user_id": loud["id"], "kind": "level"}) == 1


def test_every_crown_and_level_kind_belongs_to_the_achievements_topic():
    from services.notification_preferences import NOTIFICATION_KIND_CATEGORY, notification_allowed

    for kind in ("crown_gained", "crown_changed", "crown_lost", "level"):
        assert NOTIFICATION_KIND_CATEGORY[kind] == "achievements", kind
        assert notification_allowed({"notification_preferences": OFF}, kind) is False, kind
