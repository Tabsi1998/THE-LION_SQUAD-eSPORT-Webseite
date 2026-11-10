"""Erfolge sauber zählen (#2338): Chat, Discord, Verein und Profil - je Fund ein Ablauf gegen die echten Zähler."""
import pathlib
import sys

import pytest
import pytest_asyncio

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from flow_harness import make_flow  # noqa: E402
from services import achievement_counters as counters  # noqa: E402
from services import achievement_progress  # noqa: E402


@pytest_asyncio.fixture
async def flow():
    instance, shutdown = make_flow()
    try:
        yield instance
    finally:
        await shutdown()


def stamp(day: str, hour: int, minute: int = 0) -> str:
    return f"{day}T{hour:02d}:{minute:02d}:00+00:00"


# ---------------------------------------------------------------- Chat (H3, H4)

@pytest.mark.asyncio
async def test_plauderer_has_one_definition_whatever_source_triggers_it(flow):
    """H3: früher rechnete die Registry „Turnier- und Match-Chat“, der alte Block „alle Chats“ - der Wert sprang je nach
    Auslöser. Jetzt gilt der Katalog-Text: Turnier- und Match-Chat."""
    me = await flow.add_user(name="plauderin")
    db = flow.db
    await db.direct_messages.insert_many([{"id": f"d{i}", "sender_id": me["id"], "recipient_id": "x", "message": "hi", "created_at": stamp("2026-09-01", 10)} for i in range(3)])
    await db.team_chat_messages.insert_many([{"id": f"t{i}", "team_id": "tm", "user_id": me["id"], "message": "hi", "created_at": stamp("2026-09-01", 10)} for i in range(2)])
    await db.tournament_chat_messages.insert_one({"id": "tc", "tournament_id": "t", "user_id": me["id"], "message": "hi", "created_at": stamp("2026-09-01", 10)})
    await db.match_chat_messages.insert_one({"id": "mc", "match_id": "m", "user_id": me["id"], "message": "gg", "created_at": stamp("2026-09-01", 11)})

    partial = await counters.refresh(me["id"], {"team"})
    community = await counters.refresh(me["id"], {"community"})
    full = await counters.refresh(me["id"])
    assert partial["community_messages_sent"] == community["community_messages_sent"] == full["community_messages_sent"] == 2
    assert "community_messages_sent" not in counters.REGISTRY, "nur eine Rechnung"
    assert (full["direct_messages_sent"], full["team_chat_messages_sent"]) == (3, 2)


@pytest.mark.asyncio
async def test_held_rejected_and_deleted_messages_never_count(flow):
    me = await flow.add_user(name="filterfall")
    db = flow.db
    rows = [
        {"id": "ok", "moderation": None},
        {"id": "flagged", "moderation": {"state": "flagged"}},
        {"id": "released", "moderation": {"state": "released"}},
        {"id": "held", "moderation": {"state": "held"}},
        {"id": "rejected", "moderation": {"state": "rejected"}},
        {"id": "gone", "deleted_at": stamp("2026-09-02", 9)},
    ]
    for collection, field in achievement_progress.CHAT_COLLECTIONS.values():
        await db[collection].insert_many([{**{k: v for k, v in row.items() if v is not None}, "id": f"{collection}-{row['id']}", field: me["id"],
                                           "message": "x", "created_at": stamp("2026-09-02", 8), "sticker": {"id": f"s-{row['id']}"}} for row in rows])
    values = await counters.compute(me["id"])
    for key in ("direct_messages_sent", "team_chat_messages_sent", "match_chat_messages_sent", "tournament_chat_messages_sent"):
        assert values[key] == 3, key
    assert values["community_messages_sent"] == 6
    assert values["stickers_collected"] == 3, "auch Sticker zählen nur aus sichtbaren Nachrichten"


@pytest.mark.asyncio
async def test_at_most_fifty_counted_messages_per_vienna_day(flow):
    me = await flow.add_user(name="vielschreiber")
    db = flow.db
    # 60 am 1.9. (Wien), dazu 3 um 22:30 UTC - in Wien schon der 2.9. - und 2 am 3.9.
    busy = [stamp("2026-09-01", 8 + i // 60, i % 60) for i in range(60)]
    late = [stamp("2026-09-01", 22, 30 + i) for i in range(3)]
    other = [stamp("2026-09-03", 12, i) for i in range(2)]
    await db.team_chat_messages.insert_many([{"id": f"tm{i}", "team_id": "tm", "user_id": me["id"], "message": "x", "created_at": when} for i, when in enumerate(busy + late + other)])
    # Offene Chats: 40 Turnier- und 40 Match-Nachrichten am selben Tag - zusammen gedeckelt, je Chat nicht.
    await db.tournament_chat_messages.insert_many([{"id": f"tc{i}", "tournament_id": "t", "user_id": me["id"], "message": "x", "created_at": stamp("2026-09-05", 10, i)} for i in range(40)])
    await db.match_chat_messages.insert_many([{"id": f"mc{i}", "match_id": "m", "user_id": me["id"], "message": "x", "created_at": stamp("2026-09-05", 11, i)} for i in range(40)])
    values = await counters.compute(me["id"])
    assert values["team_chat_messages_sent"] == 50 + 3 + 2
    assert values["tournament_chat_messages_sent"] == 40 and values["match_chat_messages_sent"] == 40
    assert values["community_messages_sent"] == 50, "Plauderer: ein Deckel für Turnier- und Match-Chat zusammen"
