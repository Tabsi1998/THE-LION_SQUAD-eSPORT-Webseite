"""Lightweight in-process API change event stream."""
import asyncio
import json
import time
import uuid
from contextlib import suppress

from fastapi import Request


_subscribers: set[asyncio.Queue] = set()


def _resource_from_path(path: str) -> str:
    parts = [p for p in path.split("/") if p]
    if parts and parts[0] == "api":
        parts = parts[1:]
    if not parts:
        return ""
    if parts[0] == "admin" and len(parts) > 1:
        return "/".join(parts[:2])
    return parts[0]


def _format_sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


async def publish_api_change(method: str, path: str, status_code: int):
    if path.startswith("/api/auth/refresh") or path.startswith("/api/changes/stream"):
        return
    payload = {
        "id": str(uuid.uuid4()),
        "method": method.upper(),
        "path": path,
        "resource": _resource_from_path(path),
        "status": status_code,
        "ts": int(time.time() * 1000),
    }
    for queue in list(_subscribers):
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            with suppress(asyncio.QueueEmpty):
                queue.get_nowait()
            with suppress(asyncio.QueueFull):
                queue.put_nowait(payload)


async def change_event_stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.add(queue)
    try:
        yield _format_sse("connected", {"ok": True, "ts": int(time.time() * 1000)})
        while True:
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=15)
                yield _format_sse("change", event)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        _subscribers.discard(queue)
