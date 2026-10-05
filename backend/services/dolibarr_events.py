"""Öffentliche Vereinsevents aus Dolibarr als Entwurf vorschlagen (#850).

Plant der Vorstand ein öffentliches Event in Dolibarr, muss es niemand auf der Website doppelt anlegen: Unter Admin →
Events steht es als Vorschlag „aus Dolibarr übernehmen“. Übernommen wird ein Entwurf mit Name, Tagen, Ort und
Anmeldeweg, verknüpft über ``dolibarr_event_id``. Uhrzeiten kennt Dolibarr hier nicht - der Entwurf beginnt um 0:00 und
wird vor dem Veröffentlichen ergänzt.

Ändert der Vorstand danach in Dolibarr Tage oder Ort oder sagt das Event ab, zeigt die Website den Unterschied zum
Übernehmen oder Ignorieren - nie stilles Überschreiben. Verglichen wird mit dem Stand, den die Website zuletzt aus
Dolibarr übernommen hat (``dolibarr_seen``), nicht mit dem, was jemand auf der Website angepasst hat.

Der Endpunkt ``GET /vereine/events`` liefert nur öffentliche Events ab heute - nie Teilnehmer, Aufgaben oder Geld.
Gelesen wird stündlich und auf Knopfdruck; der letzte Stand liegt in ``settings`` (``dolibarr_events_state``).
"""
from __future__ import annotations

from datetime import datetime, time
from zoneinfo import ZoneInfo

from models import now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

STATE_ID = "dolibarr_events_state"
VIENNA = ZoneInfo("Europe/Vienna")
FIELDS = {"label": "Name", "day": "Tag", "end_day": "Bis", "place": "Ort", "status": "Stand"}
WATCHED = ("day", "end_day", "place", "status")
STATUS_LABELS = {"planned": "geplant", "done": "vorbei", "cancelled": "abgesagt"}
REGISTRATION_LABELS = {"none": "keine Anmeldung", "dolibarr": "Anmeldung beim Verein", "external": "Anmeldung über eine Anwendung"}


class SuggestionError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def _local(day: str, at: time) -> datetime | None:
    try:
        return datetime.combine(datetime.strptime(str(day), "%Y-%m-%d").date(), at, tzinfo=VIENNA)
    except ValueError:
        return None


def _day_of(value) -> str:
    if not value:
        return ""
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=VIENNA)
    return moment.astimezone(VIENNA).date().isoformat()


def _seen(row: dict) -> dict:
    return {key: str(row.get(key) or "") for key in FIELDS}


def row_view(row: dict) -> dict:
    registration = row.get("registration") or {}
    kind = str(registration.get("kind") or "none")
    return {
        "id": int(row.get("id") or 0), "label": str(row.get("label") or ""), "day": str(row.get("day") or ""), "end_day": str(row.get("end_day") or ""),
        "place": str(row.get("place") or ""), "status": str(row.get("status") or ""), "status_label": STATUS_LABELS.get(str(row.get("status") or ""), ""),
        "registration": kind, "registration_label": REGISTRATION_LABELS.get(kind, kind), "registration_ref": str(registration.get("external_ref") or ""),
    }


def website_value(event: dict, field: str) -> str:
    if field == "day":
        return _day_of(event.get("start_date"))
    if field == "end_day":
        return _day_of(event.get("end_date"))
    if field == "place":
        return str(event.get("location") or "")
    if field == "status":
        return str(event.get("status") or "")
    return str(event.get("name") or "")


def differences(event: dict, row: dict) -> list[dict]:
    """Was sich in Dolibarr seit dem letzten Übernehmen geändert hat - je Feld mit dem Wert auf der Website."""
    seen = event.get("dolibarr_seen") or {}
    out = []
    for field in WATCHED:
        new, before = str(row.get(field) or ""), str(seen.get(field) or "")
        if new != before:
            out.append({"field": field, "label": FIELDS[field], "dolibarr": new, "before": before, "website": website_value(event, field)})
    return out


async def load_state(db) -> dict:
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {"id": STATE_ID}


async def refresh(db) -> dict:
    """Öffentliche Events aus Dolibarr nachlesen; ein Fehler lässt den alten Stand stehen."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return {"ok": False, "skipped": "not_live"}
    at = now_utc().isoformat()
    try:
        rows = await DolibarrClient(settings).public_events()
    except DolibarrError as exc:
        await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "error": exc.kind, "error_text": exc.text, "error_at": at}}, upsert=True)
        return {"ok": False, "error": exc.kind, "text": exc.text}
    events = [row_view(row) for row in rows]
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "events": events, "fetched_at": at},
                                                    "$unset": {"error": "", "error_text": "", "error_at": ""}}, upsert=True)
    return {"ok": True, "count": len(events)}


async def refresh_due() -> dict:
    from database import get_db
    return await refresh(get_db())


async def overview(db) -> dict:
    """Vorschläge (ohne Website-Gegenstück, nicht ausgeblendet) und Unterschiede bei verknüpften Events."""
    settings = await load_settings(db)
    state = await load_state(db)
    rows = state.get("events") or []
    dismissed = set(state.get("dismissed") or [])
    ids = [row["id"] for row in rows]
    linked = {doc["dolibarr_event_id"]: doc async for doc in db.events.find({"dolibarr_event_id": {"$in": ids}}, {"_id": 0})}
    suggestions = [row for row in rows if row["id"] not in linked and row["id"] not in dismissed]
    changed = []
    for row in rows:
        event = linked.get(row["id"])
        if event:
            diffs = differences(event, row)
            if diffs:
                changed.append({"event_id": event["id"], "event_name": event.get("name") or "", "dolibarr": row, "differences": diffs})
    return {"live": settings.get("mode") == "live", "fetched_at": state.get("fetched_at"), "error_text": state.get("error_text") or "",
            "suggestions": suggestions, "changed": changed, "dismissed": len(dismissed & set(ids))}


async def _row(db, dolibarr_id: int) -> dict:
    state = await load_state(db)
    row = next((item for item in state.get("events") or [] if item["id"] == int(dolibarr_id)), None)
    if not row:
        raise SuggestionError(404, "Dieses Event steht in Dolibarr nicht (mehr) unter den öffentlichen Events – bitte neu nachlesen.")
    return row


async def adopt(db, me: dict, dolibarr_id: int) -> dict:
    """Als Entwurf übernehmen: Name, Tage, Ort, Anmeldeweg - verknüpft, damit Änderungen später als Unterschied kommen."""
    from models import EventCreate
    from routes.event_routes import create_event

    row = await _row(db, dolibarr_id)
    if await db.events.find_one({"dolibarr_event_id": row["id"]}, {"_id": 1}):
        raise SuggestionError(409, "Dieses Event ist schon übernommen.")
    start = _local(row["day"], time(0, 0))
    end = _local(row["end_day"], time(23, 59)) if row["end_day"] else None
    body = EventCreate(name=row["label"] or "Vereinsevent", status="draft", visibility="public", start_date=start, end_date=end,
                       location=row["place"] or None, has_registration=row["registration"] == "external")
    created = await create_event(body, me)
    link = {"dolibarr_event_id": row["id"], "dolibarr_seen": _seen(row), "dolibarr_registration": row["registration"]}
    await db.events.update_one({"id": created["id"]}, {"$set": link})
    return {"ok": True, "event_id": created["id"], "slug": created.get("slug")}


async def dismiss(db, dolibarr_id: int) -> dict:
    await _row(db, dolibarr_id)
    await db.settings.update_one({"id": STATE_ID}, {"$addToSet": {"dismissed": int(dolibarr_id)}, "$setOnInsert": {"id": STATE_ID}}, upsert=True)
    return await overview(db)


async def settle(db, dolibarr_id: int, field: str, *, take: bool) -> dict:
    """Einen Unterschied übernehmen (``take``) oder ignorieren - beides merkt sich den neuen Dolibarr-Stand."""
    if field not in WATCHED:
        raise SuggestionError(400, "Unbekanntes Feld.")
    row = await _row(db, dolibarr_id)
    event = await db.events.find_one({"dolibarr_event_id": row["id"]}, {"_id": 0})
    if not event:
        raise SuggestionError(404, "Kein verknüpftes Event auf der Website.")
    value = row[field]
    updates: dict = {f"dolibarr_seen.{field}": value, "updated_at": now_utc().isoformat()}
    if take:
        if field == "day":
            current = _parse(event.get("start_date"))
            moment = _local(value, current.astimezone(VIENNA).time().replace(tzinfo=None) if current else time(0, 0))
            if not moment:
                raise SuggestionError(400, "Dolibarr nennt keinen gültigen Tag.")
            updates["start_date"] = moment.isoformat()
        elif field == "end_day":
            current = _parse(event.get("end_date"))
            moment = _local(value, current.astimezone(VIENNA).time().replace(tzinfo=None) if current else time(23, 59)) if value else None
            updates["end_date"] = moment.isoformat() if moment else None
        elif field == "place":
            updates["location"] = value or None
        elif field == "status" and value == "cancelled":
            updates["status"] = "cancelled"
    await db.events.update_one({"id": event["id"]}, {"$set": updates})
    return await overview(db)


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=VIENNA)
