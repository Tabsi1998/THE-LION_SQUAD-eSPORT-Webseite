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
    # Externe Serien (#1741): Tabellen und Kalender der Serienseiten laden nach jeder Änderung neu.
    "reference-series",
    "seasons",
    "sponsors",
    "stations",
    "stickers",
    "streams",
    "tournaments",
    # TV & Beamer (#1110): neue Grundwerte und widerrufene Schlüssel erreichen die Bildschirme ohne Anmeldung.
    "tv",
})
PUBLIC_RESOURCE_ALIASES = {
    "admin/nav": "nav",
    "admin/streams": "streams",
    "settings/branding": "settings",
    "settings/site-banners/admin": "settings",
}
# Volle Pfade interner Änderungen für die Verwaltungsseiten; die Moderationsseite braucht sie nicht. Wie jeder
# Adminbereich nur mit bestätigter Zwei-Faktor-Anmeldung (#1469) - ohne bleibt der öffentliche Strom.
STAFF_STREAM_ROLES = frozenset({"tournament_admin", "club_admin", "superadmin"})
USER_SCOPE = "user"
# Held only in the in-memory buffer; stripped before an event reaches a client.
TARGETS_KEY = "_target_user_ids"
# Live-Nachladen je Turnier (#1801): Eine Änderung nennt ihr Turnier und dessen Event, damit nur die Seiten dieses
# Turniers nachladen (bzw. die des Events, wo sich Turniere Stationen teilen). Öffentlich nur, wenn Turnier und Event
# öffentlich sind - ob, merkt sich die Meldung im Puffer unter SCOPE_PUBLIC_KEY; ohne Kennung laden alle nach.
SCOPE_KEYS = ("tournament_id", "parent_event_id")
SCOPE_PUBLIC_KEY = "_scope_public"
# Unter /api/tournaments/<…>, aber kein Turnier.
NON_TOURNAMENT_SEGMENTS = frozenset({"onsite"})
_SCOPE_FIELDS = {"_id": 0, "id": 1, "event_id": 1, "status": 1, "is_public": 1, "visibility": 1}
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
    """Den staff-Strom bekommen Admin-Rollen und die Turnierleitung aus Rolle oder Freigabe (#1350) - beide nur mit
    bestätigter Zwei-Faktor-Anmeldung (#1469). Helfer-Einsätze je Turnier und Moderation bleiben beim öffentlichen."""
    from services.permissions import is_confirmed_admin_role, is_confirmed_tournament_lead

    if is_confirmed_admin_role(user, STAFF_STREAM_ROLES) or is_confirmed_tournament_lead(user):
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


def current_version() -> int:
    """Die Nummer der letzten Meldung in diesem Prozess - ein kurzer Zwischenspeicher verfällt, sobald sie sich ändert."""
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


def _scope_target(path: str) -> tuple[str, str] | None:
    """Worauf eine Änderung zeigt (#1801): ``("tournament", Kennung oder Slug)``, ``("match", Kennung)`` oder None.

    Ohne Turnier bleiben Stationen (die Turniere eines Events teilen sie sich), das Turnier selbst (Einstellungen, Event,
    Sichtbarkeit - danach sollen alle Seiten nachladen), neue Turniere und was zu keinem Turnier gehört (Vor-Ort-Zugang).
    """
    parts = [part for part in _normalized_path(path).split("/") if part]
    if parts and parts[0] == "api":
        parts = parts[1:]
    if len(parts) < 2:
        return None
    resource, ref = parts[0], parts[1]
    if resource == "matches":
        return "match", ref
    if resource == "matches-v2":
        return "tournament", ref
    if resource == "tournaments" and len(parts) > 2 and ref not in NON_TOURNAMENT_SEGMENTS:
        return "tournament", ref
    return None


async def _lookup_scope(db, kind: str, ref: str) -> dict | None:
    """Turnier und Event einer Änderung - und ob beide öffentlich sind (dieselbe Regel wie ``public_tournament`` und
    die Event-Seite: kein Entwurf, Sichtbarkeit öffentlich). Ein Turnier in einem nicht öffentlichen Event bleibt
    öffentlich ohne Kennung: Seiten mit geteilten Stationen könnten sonst nicht erkennen, dass es sie betrifft."""
    from services.slug_utils import find_by_slug_or_history
    from services.tournament_visibility import public_tournament

    if kind == "match":
        match = await db.matches_v2.find_one({"id": ref}, {"_id": 0, "tournament_id": 1})
        if not match or not match.get("tournament_id"):
            return None
        tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, _SCOPE_FIELDS)
    else:
        tournament, _ = await find_by_slug_or_history(db.tournaments, ref, _SCOPE_FIELDS)
    if not tournament or not tournament.get("id"):
        return None
    event_id = tournament.get("event_id") or None
    visible = public_tournament(tournament)
    if visible and event_id:
        event = await db.events.find_one({"id": event_id}, {"_id": 0, "status": 1, "visibility": 1})
        visible = bool(event) and event.get("status") != "draft" and (event.get("visibility") or "public") == "public"
    return {"tournament_id": tournament["id"], "parent_event_id": event_id, SCOPE_PUBLIC_KEY: visible}


async def _change_scope(path: str) -> dict:
    target = _scope_target(path)
    if not target:
        return {}
    try:
        from database import get_db

        return await _lookup_scope(get_db(), *target) or {}
    except Exception:
        # Die Meldung geht auch ohne Kennung hinaus - dann laden alle Seiten nach, wie vor #1801.
        return {}


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
        return {key: value for key, value in event.items() if key != SCOPE_PUBLIC_KEY}

    resource = event.get("entity_type") or ""
    public_event = {key: value for key, value in event.items() if key != SCOPE_PUBLIC_KEY}
    if not event.get(SCOPE_PUBLIC_KEY):
        for key in SCOPE_KEYS:
            public_event.pop(key, None)
    public_event.update({
        "entity_id": None,
        "path": f"/api/{resource}" if resource else "/api",
        "resource": resource,
    })
    if isinstance(event.get("tournament_event"), dict):
        public_event["tournament_event"] = _public_tournament_event(event["tournament_event"])
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

    # Erst das Turnier nachschlagen, dann die Nummer vergeben - so bleiben die Nummern im Puffer aufsteigend.
    scope = await _change_scope(normalized_path)
    event = _build_api_change_event(method, normalized_path, status_code)
    event.update(scope)
    _event_buffer.append(event)
    _deliver(event)


# Anzeige-Ereignisse (#1553) für Web und TV: was sich im Baum getan hat, als Typ - damit eine Animation weiß, ob ein
# Name kampflos weiterreist, ein Platz frei wird oder ein Ergebnis zurückgenommen wurde (#1561/#1564). Öffentlich ist
# nur, was heute schon öffentlich ist: Typ, Turnier und Spiel-Kennungen - keine Namen.
TOURNAMENT_EVENT_TYPES = frozenset({
    "draw_done", "slot_filled", "slot_cleared", "walkover", "player_withdrawn", "player_disqualified",
    "heats_merged", "heats_rebalanced", "result_corrected", "round_started",
    # Weiterkommen in vier Modi (#1590): Show-Runde bereit (Topf steht), ein Platz sofort zugewiesen.
    "draw_ready", "draw_assigned",
})


# Öffentlich sagt ein Ausscheiden nur „ein Platz wurde frei“ - wer und warum, bleibt im Staff-Strom.
PUBLIC_TOURNAMENT_EVENT_TYPES = {"player_withdrawn": "slot_cleared", "player_disqualified": "slot_cleared"}


def _public_tournament_event(payload: dict) -> dict:
    """Die öffentliche Sicht eines Anzeige-Ereignisses: Typ, Turnier und Spiel-Kennungen - keine Anmeldung, keine Art
    des Ausscheidens (über die Teilnehmerliste wäre sie einer Person zuzuordnen)."""
    event_type = str(payload.get("type") or "")
    return {
        "type": PUBLIC_TOURNAMENT_EVENT_TYPES.get(event_type, event_type),
        "tournament_id": payload.get("tournament_id"),
        "match_ids": list(payload.get("match_ids") or []),
    }


async def publish_tournament_event(tournament_id: str, event_type: str, *, match_ids: Iterable[str | None] = (),
                                   registration_id: str | None = None) -> None:
    """Ein Anzeige-Ereignis auf den öffentlichen Strom - als ``tournament.event`` mit Ressource ``tournaments``, sodass
    bestehende Leser nur neu laden und neue Leser den Typ lesen. Die Anmeldungs-Kennung und die Art des Ausscheidens
    bekommt nur der Staff-Strom (``_public_tournament_event``)."""
    if event_type not in TOURNAMENT_EVENT_TYPES or not tournament_id:
        return
    event = _build_api_change_event("POST", f"/api/tournaments/{tournament_id}/events", 200)
    event.update({
        "event_type": "tournament.event",
        "dedupe_key": f"tournament.event:{event['event_id']}",
        "tournament_event": {
            "type": event_type,
            "tournament_id": tournament_id,
            "match_ids": [match_id for match_id in match_ids if match_id],
            **({"registration_id": registration_id} if registration_id else {}),
        },
    })
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
