"""Abstimmung live (#844, Vereine 1.7.0): Öffnet die Versammlungsleitung in Dolibarr eine Abstimmung, erfahren es die
Mitglieder binnen Sekunden - Popup in Web und App, Push aufs Handy.

Das Signal ist der Änderungsfeed des Vereinsmoduls (``GET /vereine/changes?types=ballot,meeting``): Er nennt nur
Kennung, Zustand und Zeitpunkt, nie Stimmen. Die Website liest ihn alle paar Sekunden, solange eine Versammlung läuft,
sonst jede Minute. Bei jeder Abstimmungs-Änderung sagt sie den Mitgliedern mit Zuordnung „Abstimmungen neu laden“
(nur das Was, nie das Wer). Wer ein offenes Stimmrecht hat, bekommt beim Öffnen einmal eine Benachrichtigung.

Ohne das Recht „Änderungen abholen (Änderungsfeed)“ fragen offene Seiten am Versammlungstag selbst in kurzem Takt nach -
langsamer, aber es geht.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from models import now_utc
from services import dolibarr_identity, dolibarr_meetings
from services.dolibarr_client import DolibarrClient, DolibarrError, instance_key, load_settings

STATE_ID = "dolibarr_ballot_watch"
MIN_VERSION = (1, 7, 0)
LIVE_SECONDS = 5
IDLE_SECONDS = 60
MAX_EVENT_AGE = timedelta(minutes=10)


def _parse(moment: str) -> datetime | None:
    try:
        value = datetime.fromisoformat(str(moment or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def _members(db, settings: dict) -> list[str]:
    """Konten mit Weg zur Akte: bestätigte Zuordnung oder Bindung dieser Installation."""
    instance = instance_key(settings)
    users = {row["user_id"] async for row in db.dolibarr_links.find({"instance": instance, "status": "verified"}, {"_id": 0, "user_id": 1}) if row.get("user_id")}
    users |= {row["user_id"] async for row in db[dolibarr_identity.COLLECTION].find({"instance": instance, "status": "bound"}, {"_id": 0, "user_id": 1})
              if row.get("user_id")}
    return sorted(users)


async def _notify_opened(db, user_ids: list[str], ballot_ids: set[int]) -> int:
    """Wer bei einer gerade geöffneten Abstimmung ein offenes Stimmrecht hat, bekommt einmal Bescheid (Push und Glocke)."""
    from services.user_notifications import create_user_notification

    sent = 0
    for user_id in user_ids:
        user = await db.users.find_one({"id": user_id, "is_active": {"$ne": False}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1})
        if not user:
            continue
        view = await dolibarr_meetings.open_ballots(db, user)
        for ballot in view.get("ballots") or []:
            if ballot["id"] not in ballot_ids or not ballot["can_vote"]:
                continue
            note = await create_user_notification(user_id, "Abstimmung offen", ballot["question"], url="/members/meetings", kind="ballot_open",
                                                  meta={"dedupe_key": f"ballot:{ballot['id']}", "ballot_id": ballot["id"]})
            sent += 1 if note else 0
    return sent


async def load_state(db) -> dict:
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {"id": STATE_ID}


async def poll(db, *, now=None) -> dict:
    """Ein Blick in den Feed - alle fünf Sekunden, solange eine Versammlung läuft, sonst jede Minute."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return {"ok": False, "skipped": "not_live"}
    sync = await db.settings.find_one({"id": dolibarr_identity.STATE_ID}, {"_id": 0, "module_version": 1}) or {}
    if dolibarr_identity.parse_version(sync.get("module_version")) < MIN_VERSION:
        return {"ok": False, "skipped": "module_version"}
    state = await load_state(db)
    moment = now or now_utc()
    last = _parse(state.get("polled_at"))
    pause = LIVE_SECONDS if state.get("live_meetings") else IDLE_SECONDS
    if last and (moment - last).total_seconds() < pause:
        return {"ok": True, "skipped": "not_due"}
    try:
        client = DolibarrClient(settings)
        feed = await client.changes(state.get("cursor") or "", types="ballot,meeting", limit=500)
    except DolibarrError as exc:
        failed = {"id": STATE_ID, "polled_at": moment.isoformat(), "feed": "forbidden" if exc.kind == "forbidden" else "error", "error": exc.kind}
        await db.settings.update_one({"id": STATE_ID}, {"$set": failed}, upsert=True)
        return {"ok": False, "error": exc.kind}
    live = set(state.get("live_meetings") or [])
    opened: set[int] = set()
    changed = False
    fresh_start = not state.get("cursor")
    for event in feed.get("events") or []:
        when = _parse(event.get("occurred_at"))
        if fresh_start and when and moment - when > MAX_EVENT_AGE:
            continue   # beim allerersten Lesen zählt nur, was gerade passiert
        kind, ident, value = event.get("object_type"), int(event.get("object_id") or 0), event.get("state")
        if kind == "meeting":
            if value == "started":
                live.add(ident)
            elif value in ("ended", "cancelled") or event.get("change") == "deleted":
                live.discard(ident)
        elif kind == "ballot":
            changed = True
            if value == "opened":
                opened.add(ident)
    cursor = "" if feed.get("resync_required") else str(feed.get("next_cursor") or state.get("cursor") or "")
    read = {"id": STATE_ID, "polled_at": moment.isoformat(), "cursor": cursor, "feed": "ok", "live_meetings": sorted(live)}
    await db.settings.update_one({"id": STATE_ID}, {"$set": read, "$unset": {"error": ""}}, upsert=True)
    notified = 0
    if changed or opened:
        from services.change_events import publish_user_change
        members = await _members(db, settings)
        await publish_user_change(members, "ballots")
        if opened:
            notified = await _notify_opened(db, members, opened)
    return {"ok": True, "events": len(feed.get("events") or []), "opened": sorted(opened), "notified": notified, "live_meetings": sorted(live)}


async def run_due() -> dict:
    from database import get_db
    return await poll(get_db())


async def feed_state(db) -> str:
    """„ok“, „forbidden“ oder „error“ - ohne Feed fragen offene Seiten am Versammlungstag selbst nach."""
    return str((await load_state(db)).get("feed") or "")
