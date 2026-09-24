"""Scoped, replayable API invalidation events for the browser SSE bridge.

The transport intentionally remains in-process. Production therefore runs one
API worker until a shared event bus is introduced. Public subscribers only see
redacted resource invalidations; authenticated staff can receive the original
API path needed by internal screens.

Private resources (direct messages, team chat, notifications) are not public,
so ordinary members never saw their own changes on the stream. Such changes are
published to explicit target users instead: only those subscribers receive
them, staff included only if targeted, and the event carries nothing but the
resource name.
"""
import asyncio
import json
import time
import uuid
from collections import deque
from collections.abc import Iterable
from contextlib import suppress
from datetime import datetime, timezone

from fastapi import Request


PUBLIC_RESOURCES = frozenset({
    "board",
    "events",
    "f1",
    "gallery",
    "game-servers",
    "games",
    "home",
    "matches",
    "matches-v2",
    "nav",
    "news",
    "partners",
    "references",
    "seasons",
    "sponsors",
    "stations",
    "stickers",
    "streams",
    "tournaments",
})
PUBLIC_RESOURCE_ALIASES = {
    "admin/nav": "nav",
    "admin/streams": "streams",
    "settings/branding": "settings",
    "settings/site-banners/admin": "settings",
}
STAFF_STREAM_ROLES = frozenset({"moderator", "tournament_admin", "club_admin", "superadmin"})
USER_SCOPE = "user"
# Held only in the in-memory buffer; stripped before an event reaches a client.
TARGETS_KEY = "_target_user_ids"
EVENT_BUFFER_SIZE = 256
SUBSCRIBER_QUEUE_SIZE = 100

_subscribers: set[tuple[asyncio.Queue, str, str | None]] = set()
_event_buffer: deque[dict] = deque(maxlen=EVENT_BUFFER_SIZE)
_stream_epoch = str(uuid.uuid4())
_version = 0


def last_event_occurred_at() -> str | None:
    """Zeitpunkt des letzten Ereignisses im Puffer - für die Auto-Checks (#265)."""
    return _event_buffer[-1].get("occurred_at") if _event_buffer else None


def visibility_scope_for_user(user: dict | None) -> str:
    if user and user.get("role") in STAFF_STREAM_ROLES:
        return "staff"
    return "public"


def _normalized_path(path: str) -> str:
    value = (path or "").split("?", 1)[0]
    return "/" + value.lstrip("/")


def _resource_from_path(path: str) -> str:
    parts = [part for part in _normalized_path(path).split("/") if part]
    if parts and parts[0] == "api":
        parts = parts[1:]
    if not parts:
        return ""
    if parts[0] == "admin" and len(parts) > 1:
        return "/".join(parts[:2])
    return parts[0]


def _public_resource_from_path(path: str) -> str | None:
    parts = [part for part in _normalized_path(path).split("/") if part]
    if parts and parts[0] == "api":
        parts = parts[1:]
    normalized = "/".join(parts)
    for prefix, resource in PUBLIC_RESOURCE_ALIASES.items():
        if normalized == prefix or normalized.startswith(f"{prefix}/"):
            return resource
    if parts and parts[0] in PUBLIC_RESOURCES:
        return parts[0]
    return None


def _next_version() -> int:
    global _version
    _version += 1
    return _version


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _build_api_change_event(method: str, path: str, status_code: int) -> dict:
    event_id = str(uuid.uuid4())
    raw_path = _normalized_path(path)
    resource = _resource_from_path(raw_path)
    public_resource = _public_resource_from_path(raw_path)
    return {
        "event_id": event_id,
        "event_type": "api.changed",
        "entity_type": public_resource or resource,
        "entity_id": None,
        "version": _next_version(),
        "occurred_at": _utc_now(),
        "visibility_scope": "public" if public_resource else "staff",
        "dedupe_key": f"api.changed:{event_id}",
        # Compatibility fields consumed by the existing invalidation bridge.
        "id": event_id,
        "method": method.upper(),
        "path": raw_path,
        "resource": resource,
        "status": status_code,
        "ts": int(time.time() * 1000),
    }


def _build_user_change_event(resource: str, user_ids: frozenset[str]) -> dict:
    event_id = str(uuid.uuid4())
    return {
        "event_id": event_id,
        "event_type": "api.changed",
        "entity_type": resource,
        "entity_id": None,
        "version": _next_version(),
        "occurred_at": _utc_now(),
        "visibility_scope": USER_SCOPE,
        "dedupe_key": f"api.changed:{event_id}",
        "id": event_id,
        "path": f"/api/{resource}",
        "resource": resource,
        "ts": int(time.time() * 1000),
        TARGETS_KEY: user_ids,
    }


def _event_for_scope(event: dict, visibility_scope: str, user_id: str | None = None) -> dict | None:
    targets = event.get(TARGETS_KEY)
    if targets is not None:
        if not user_id or user_id not in targets:
            return None
        return {key: value for key, value in event.items() if key != TARGETS_KEY}

    if event.get("visibility_scope") != "public" and visibility_scope != "staff":
        return None
    if visibility_scope == "staff":
        return dict(event)

    resource = event.get("entity_type") or ""
    public_event = dict(event)
    public_event.update({
        "entity_id": None,
        "path": f"/api/{resource}" if resource else "/api",
        "resource": resource,
    })
    return public_event


def _reset_event(visibility_scope: str, reason: str, version: int | None = None) -> dict:
    reset_version = _version if version is None else version
    reset_key = reset_version if reason == "queue_overflow" else visibility_scope
    event_id = f"stream-reset:{_stream_epoch}:{reason}:{reset_key}"
    return {
        "event_id": event_id,
        "event_type": "stream.reset",
        "entity_type": "*",
        "entity_id": None,
        "version": reset_version,
        "occurred_at": _utc_now(),
        "visibility_scope": visibility_scope,
        "dedupe_key": event_id,
        "reason": reason,
        "reset": True,
    }


def _format_sse(event: str, data: dict, *, include_id: bool = True) -> str:
    lines: list[str] = []
    if include_id and data.get("event_id"):
        lines.append(f"id: {data['event_id']}")
    lines.extend([
        f"event: {event}",
        f"data: {json.dumps(data, separators=(',', ':'))}",
    ])
    return "\n".join(lines) + "\n\n"


def _replay_after(last_event_id: str, visibility_scope: str, user_id: str | None = None) -> tuple[list[dict], bool]:
    if not last_event_id:
        return [], False
    events = list(_event_buffer)
    for index, event in enumerate(events):
        if event.get("event_id") == last_event_id:
            replay = [
                scoped
                for item in events[index + 1:]
                if (scoped := _event_for_scope(item, visibility_scope, user_id)) is not None
            ]
            return replay, False
    return [], True


def _queue_reset(queue: asyncio.Queue, visibility_scope: str, version: int) -> None:
    while True:
        with suppress(asyncio.QueueEmpty):
            queue.get_nowait()
            continue
        break
    queue.put_nowait(("reset", _reset_event(visibility_scope, "queue_overflow", version)))


def _deliver(event: dict) -> None:
    for queue, visibility_scope, user_id in list(_subscribers):
        scoped_event = _event_for_scope(event, visibility_scope, user_id)
        if scoped_event is None:
            continue
        try:
            queue.put_nowait(("change", scoped_event))
        except asyncio.QueueFull:
            _queue_reset(queue, visibility_scope, event["version"])


async def publish_api_change(method: str, path: str, status_code: int):
    normalized_path = _normalized_path(path)
    if normalized_path.startswith("/api/auth/refresh") or normalized_path.startswith("/api/changes/stream"):
        return

    event = _build_api_change_event(method, normalized_path, status_code)
    _event_buffer.append(event)
    _deliver(event)


async def publish_user_change(user_ids: Iterable[str | None], resource: str) -> None:
    """Tell specific signed-in users that one of their private resources changed.

    The event names the resource only. The target list never leaves the server.
    """
    targets = frozenset(user_id for user_id in (user_ids or ()) if user_id)
    if not targets or not resource:
        return
    event = _build_user_change_event(resource, targets)
    _event_buffer.append(event)
    _deliver(event)


async def change_event_stream(request: Request, visibility_scope: str = "public", user_id: str | None = None):
    scope = "staff" if visibility_scope == "staff" else "public"
    queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
    subscriber = (queue, scope, user_id or None)
    _subscribers.add(subscriber)
    last_event_id = request.headers.get("last-event-id", "").strip()
    replay, reset_required = _replay_after(last_event_id, scope, user_id)
    try:
        yield _format_sse("connected", {
            "ok": True,
            "ts": int(time.time() * 1000),
            "visibility_scope": scope,
            "replayed": len(replay),
        }, include_id=False)
        if reset_required:
            yield _format_sse(
                "reset",
                _reset_event(scope, "replay_unavailable"),
                include_id=False,
            )
        else:
            for event in replay:
                yield _format_sse("change", event)

        while True:
            if await request.is_disconnected():
                break
            try:
                event_name, event = await asyncio.wait_for(queue.get(), timeout=15)
                yield _format_sse(event_name, event, include_id=event_name == "change")
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        _subscribers.discard(subscriber)
