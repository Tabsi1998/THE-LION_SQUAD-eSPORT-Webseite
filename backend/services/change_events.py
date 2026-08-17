"""Scoped, replayable API invalidation events for the browser SSE bridge.

The transport intentionally remains in-process. Production therefore runs one
API worker until a shared event bus is introduced. Public subscribers only see
redacted resource invalidations; authenticated staff can receive the original
API path needed by internal screens.
"""
import asyncio
import json
import time
import uuid
from collections import deque
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
    "pages",
    "partners",
    "references",
    "seasons",
    "sponsors",
    "stations",
    "streams",
    "tournaments",
})
PUBLIC_RESOURCE_ALIASES = {
    "admin/nav": "nav",
    "admin/pages": "pages",
    "admin/streams": "streams",
    "settings/branding": "settings",
    "settings/site-banners/admin": "settings",
}
STAFF_STREAM_ROLES = frozenset({"moderator", "tournament_admin", "club_admin", "superadmin"})
EVENT_BUFFER_SIZE = 256
SUBSCRIBER_QUEUE_SIZE = 100

_subscribers: set[tuple[asyncio.Queue, str]] = set()
_event_buffer: deque[dict] = deque(maxlen=EVENT_BUFFER_SIZE)
_stream_epoch = str(uuid.uuid4())
_version = 0


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


def _event_for_scope(event: dict, visibility_scope: str) -> dict | None:
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


def _replay_after(last_event_id: str, visibility_scope: str) -> tuple[list[dict], bool]:
    if not last_event_id:
        return [], False
    events = list(_event_buffer)
    for index, event in enumerate(events):
        if event.get("event_id") == last_event_id:
            replay = [
                scoped
                for item in events[index + 1:]
                if (scoped := _event_for_scope(item, visibility_scope)) is not None
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


async def publish_api_change(method: str, path: str, status_code: int):
    normalized_path = _normalized_path(path)
    if normalized_path.startswith("/api/auth/refresh") or normalized_path.startswith("/api/changes/stream"):
        return

    event = _build_api_change_event(method, normalized_path, status_code)
    _event_buffer.append(event)
    for queue, visibility_scope in list(_subscribers):
        scoped_event = _event_for_scope(event, visibility_scope)
        if scoped_event is None:
            continue
        try:
            queue.put_nowait(("change", scoped_event))
        except asyncio.QueueFull:
            _queue_reset(queue, visibility_scope, event["version"])


async def change_event_stream(request: Request, visibility_scope: str = "public"):
    scope = "staff" if visibility_scope == "staff" else "public"
    queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE)
    subscriber = (queue, scope)
    _subscribers.add(subscriber)
    last_event_id = request.headers.get("last-event-id", "").strip()
    replay, reset_required = _replay_after(last_event_id, scope)
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
