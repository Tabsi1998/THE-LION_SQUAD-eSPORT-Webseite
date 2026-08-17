"""Regressions for scoped and replayable API change events."""
import asyncio
import json

import pytest

from services import change_events


@pytest.fixture(autouse=True)
def reset_change_event_state():
    change_events._subscribers.clear()
    change_events._event_buffer.clear()
    change_events._version = 0
    yield
    change_events._subscribers.clear()
    change_events._event_buffer.clear()


def test_public_event_redacts_raw_path_and_identifiers():
    event = change_events._build_api_change_event(
        "PATCH",
        "/api/tournaments/tournament-secret/stages/stage-secret",
        200,
    )

    public_event = change_events._event_for_scope(event, "public")
    staff_event = change_events._event_for_scope(event, "staff")

    assert public_event["visibility_scope"] == "public"
    assert public_event["path"] == "/api/tournaments"
    assert public_event["resource"] == "tournaments"
    assert public_event["entity_id"] is None
    assert "tournament-secret" not in json.dumps(public_event)
    assert staff_event["path"].endswith("/tournament-secret/stages/stage-secret")


def test_only_global_staff_roles_receive_internal_stream_scope():
    assert change_events.visibility_scope_for_user(None) == "public"
    assert change_events.visibility_scope_for_user({"role": "player"}) == "public"
    assert change_events.visibility_scope_for_user({
        "role": "player",
        "is_tournament_staff": True,
    }) == "public"
    assert change_events.visibility_scope_for_user({"role": "moderator"}) == "staff"
    assert change_events.visibility_scope_for_user({"role": "superadmin"}) == "staff"


def test_admin_cms_mutation_maps_to_public_resource_without_admin_path():
    event = change_events._build_api_change_event(
        "PUT",
        "/api/admin/pages/private-draft-slug",
        200,
    )

    public_event = change_events._event_for_scope(event, "public")

    assert public_event["entity_type"] == "pages"
    assert public_event["path"] == "/api/pages"
    assert "admin" not in json.dumps(public_event)
    assert "private-draft-slug" not in json.dumps(public_event)


def test_private_mutation_is_visible_to_staff_only():
    async def scenario():
        public_queue = asyncio.Queue()
        staff_queue = asyncio.Queue()
        change_events._subscribers.update({
            (public_queue, "public"),
            (staff_queue, "staff"),
        })

        await change_events.publish_api_change(
            "PATCH",
            "/api/users/private-user-id/role",
            200,
        )

        assert public_queue.empty()
        event_name, staff_event = staff_queue.get_nowait()
        assert event_name == "change"
        assert staff_event["visibility_scope"] == "staff"
        assert staff_event["path"] == "/api/users/private-user-id/role"

    asyncio.run(scenario())


def test_event_envelope_and_sse_id_are_stable_for_replay():
    event = change_events._build_api_change_event("POST", "/api/matches/match-1/result", 201)
    rendered = change_events._format_sse("change", event)

    assert event["event_type"] == "api.changed"
    assert event["entity_type"] == "matches"
    assert event["version"] == 1
    assert event["occurred_at"].endswith("Z")
    assert event["dedupe_key"].endswith(event["event_id"])
    assert rendered.startswith(f"id: {event['event_id']}\nevent: change\n")


def test_replay_returns_only_events_after_cursor_and_for_requested_scope():
    async def scenario():
        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        cursor = change_events._event_buffer[-1]["event_id"]
        await change_events.publish_api_change("PATCH", "/api/matches/two", 200)
        await change_events.publish_api_change("PATCH", "/api/users/private", 200)

        public_replay, public_reset = change_events._replay_after(cursor, "public")
        staff_replay, staff_reset = change_events._replay_after(cursor, "staff")

        assert public_reset is False
        assert [event["resource"] for event in public_replay] == ["matches"]
        assert public_replay[0]["path"] == "/api/matches"
        assert staff_reset is False
        assert [event["resource"] for event in staff_replay] == ["matches", "users"]

    asyncio.run(scenario())


def test_unknown_replay_cursor_requires_snapshot_reset():
    replay, reset_required = change_events._replay_after("expired-event-id", "public")

    assert replay == []
    assert reset_required is True
    reset = change_events._reset_event("public", "replay_unavailable")
    assert reset["event_type"] == "stream.reset"
    assert reset["reset"] is True
    assert reset["visibility_scope"] == "public"


def test_stream_replays_change_after_last_event_id():
    class DisconnectedRequest:
        def __init__(self, last_event_id):
            self.headers = {"last-event-id": last_event_id}

        async def is_disconnected(self):
            return True

    async def scenario():
        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        cursor = change_events._event_buffer[-1]["event_id"]
        await change_events.publish_api_change("PATCH", "/api/matches/two", 200)
        stream = change_events.change_event_stream(DisconnectedRequest(cursor), "public")
        return [chunk async for chunk in stream]

    chunks = asyncio.run(scenario())

    assert len(chunks) == 2
    assert "event: connected" in chunks[0]
    assert '"replayed":1' in chunks[0]
    assert "event: change" in chunks[1]
    assert '"resource":"matches"' in chunks[1]
    assert "/api/matches/two" not in chunks[1]


def test_stream_emits_exactly_one_reset_for_unknown_cursor():
    class DisconnectedRequest:
        headers = {"last-event-id": "cursor-from-an-old-process"}

        async def is_disconnected(self):
            return True

    async def scenario():
        stream = change_events.change_event_stream(DisconnectedRequest(), "public")
        return [chunk async for chunk in stream]

    chunks = asyncio.run(scenario())

    assert len(chunks) == 2
    assert sum("event: reset" in chunk for chunk in chunks) == 1
    assert '"reason":"replay_unavailable"' in chunks[1]
    assert "\nid: " not in chunks[1]


def test_queue_overflow_replaces_stale_changes_with_snapshot_reset():
    async def scenario():
        queue = asyncio.Queue(maxsize=1)
        change_events._subscribers.add((queue, "public"))

        await change_events.publish_api_change("PATCH", "/api/tournaments/one", 200)
        await change_events.publish_api_change("PATCH", "/api/tournaments/two", 200)

        event_name, event = queue.get_nowait()
        assert event_name == "reset"
        assert event["reason"] == "queue_overflow"
        assert event["reset"] is True
        assert queue.empty()

    asyncio.run(scenario())


def test_refresh_and_stream_endpoints_do_not_publish_changes():
    async def scenario():
        await change_events.publish_api_change("POST", "/api/auth/refresh", 200)
        await change_events.publish_api_change("POST", "/api/changes/stream", 200)

    asyncio.run(scenario())
    assert list(change_events._event_buffer) == []
