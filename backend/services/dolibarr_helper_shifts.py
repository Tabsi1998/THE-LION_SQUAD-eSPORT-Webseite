"""Helferdienste an Vereinsevents aus der Vereinsakte (#331, Vereine 1.4).

Kein zweites Schichtregister: Veranstaltungen, Helferdienste, Plätze und Bestätigungen führt das Vereinsmodul
(``GET /vereine/me/events``). Die Website zeigt, was für diese Person gilt, und reicht Anfrage und Rücknahme
durch (``PUT``/``DELETE …/shifts/{shift}``). Der Vorstand bestätigt in Dolibarr; erst ein als geleistet
bestätigter Dienst zählt - selbst eingetragen ist kein Nachweis. Der Weg zur Akte ist derselbe wie bei
Versammlungen (``dolibarr_identity.access_for``): Zuordnung per ``member_id`` oder Bindung mit Fähigkeit
``events``. Wo man sich zur Veranstaltung selbst anmeldet, sagt das Modul je Event (``registration``) -
die Website erfindet keinen zweiten Anmeldeweg.
"""
from __future__ import annotations

from datetime import date

from services import dolibarr_identity
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

STATUS_LABELS = {"planned": "geplant", "done": "vorbei", "cancelled": "abgesagt"}
VISIBILITY_LABELS = {"public": "öffentlich", "members": "nur für Mitglieder"}
MINE_LABELS = {"": "", "requested": "angefragt – der Vorstand bestätigt", "confirmed": "bestätigt", "done": "geleistet", "cancelled": "abgesagt"}
SHIFT_CONFLICTS = {
    "full": "Dieser Dienst ist schon voll.",
    "past": "Dieser Dienst ist vorbei.",
    "cancelled": "Die Veranstaltung ist abgesagt.",
    "overlap": "Der Dienst überschneidet sich mit einem anderen Dienst von dir.",
    "confirmed": "Ein bestätigter Dienst wird mit dem Verein abgesagt – bitte beim Vorstand melden.",
}
REASON_TEXTS = {
    "not_connected": "Die Mitgliederverwaltung ist nicht live angebunden.",
    "not_bound": "Dafür muss dein Konto mit deinem Mitgliedseintrag verbunden sein – das passiert von selbst über die bestätigte "
                 "E-Mail-Adresse oder durch den Vorstand (Dolibarr → Zuordnungen); alternativ mit einem Einladungscode unter Meine Mitgliedschaft.",
    "right_missing": dolibarr_identity.MEMBER_RIGHT_TEXT,
    "no_capability_events": "Deine Verbindung erlaubt Veranstaltungen noch nicht – der Vorstand schaltet die Fähigkeit „Veranstaltungen“ in Dolibarr ein.",
}


class HelperShiftsError(Exception):
    def __init__(self, status: int, detail: str, reason: str | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.reason = reason


async def _access(db, user: dict):
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return settings, None, None, "not_connected"
    access = await dolibarr_identity.access_for(db, settings, user["id"])
    if not access:
        return settings, None, None, "not_bound"
    if access["mode"] == "subject" and "events" not in access["capabilities"]:
        return settings, access, None, "no_capability_events"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return settings, access, None, exc.kind
    return settings, access, client, None


async def _denied(db, access: dict) -> str:
    await dolibarr_identity.forbidden(db, access)
    return "right_missing" if access["mode"] == "member" else "not_bound"


def _iso(today: date | None) -> str:
    return (today or date.today()).isoformat()


def registration_text(registration: dict | None) -> str:
    kind = str((registration or {}).get("kind") or "none")
    ref = str((registration or {}).get("external_ref") or "").strip()
    if kind == "dolibarr":
        return "Anmeldung beim Verein"
    if kind == "external":
        return f"Anmeldung bei {ref}" if ref else "Anmeldung außerhalb der Website"
    return "keine Anmeldung nötig"


def shift_view(row: dict, *, event_open: bool, today: str) -> dict:
    capacity, taken = int(row.get("capacity") or 0), int(row.get("taken") or 0)
    mine = str(row.get("mine") or "")
    day = str(row.get("day") or "")
    full = bool(row.get("full")) or (capacity > 0 and taken >= capacity)
    past = bool(day) and day < today
    return {
        "id": int(row.get("id") or 0), "label": row.get("label") or "", "day": day, "start": row.get("start") or "", "end": row.get("end") or "",
        "capacity": capacity, "taken": taken, "free": max(capacity - taken, 0), "full": full, "mine": mine, "mine_label": MINE_LABELS.get(mine, mine),
        "can_request": event_open and not past and not full and mine in ("", "cancelled"),
        "can_withdraw": mine == "requested",
    }


def event_view(row: dict, today: date | None = None) -> dict:
    now = _iso(today)
    status = str(row.get("status") or "")
    day, end_day = str(row.get("day") or ""), str(row.get("end_day") or "")
    open_ = status == "planned" and (end_day or day) >= now
    visibility = str(row.get("visibility") or "public")
    shifts = [shift_view(s, event_open=open_, today=now) for s in (row.get("shifts") or []) if isinstance(s, dict)]
    return {
        "id": int(row.get("id") or 0), "label": row.get("label") or "", "day": day, "end_day": end_day, "timezone": row.get("timezone") or "",
        "place": row.get("place") or "", "status": status, "status_label": STATUS_LABELS.get(status, status),
        "visibility": visibility, "visibility_label": VISIBILITY_LABELS.get(visibility, visibility),
        "registration": {**(row.get("registration") or {}), "text": registration_text(row.get("registration"))},
        "shifts": shifts, "upcoming": open_,
        "mine": [s for s in shifts if s["mine"] in ("requested", "confirmed", "done")],
        "open_places": sum(s["free"] for s in shifts if s["can_request"]),
    }


async def overview(db, user: dict, *, today: date | None = None) -> dict:
    """Veranstaltungen mit Helferdiensten für die Person - oder warum es hier nichts gibt."""
    settings, access, client, reason = await _access(db, user)
    if reason:
        return {"available": False, "reason": reason, "text": REASON_TEXTS.get(reason, ""), "events": []}
    try:
        rows = await client.my_events(access["params"])
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            reason = await _denied(db, access)
            return {"available": False, "reason": reason, "text": REASON_TEXTS[reason], "events": []}
        return {"available": False, "reason": exc.kind, "text": f"Dolibarr antwortet gerade nicht ({exc.text}).", "events": []}
    await dolibarr_identity.member_call_ok(db, access)
    events = [event_view(row, today) for row in rows]
    return {"available": True, "reason": None, "text": "", "events": events,
            "my_count": sum(len(event["mine"]) for event in events), "open_places": sum(event["open_places"] for event in events)}


def _conflict_text(exc: DolibarrError) -> str:
    text = str((exc.detail or {}).get("message") or "").lower()
    for code, sentence in SHIFT_CONFLICTS.items():
        if code in text:
            return sentence
    return "Der Verein hat die Anfrage nicht angenommen – der Dienst ist voll, vorbei oder überschneidet sich."


async def _write(db, user: dict, event_id: int, shift_id: int, *, withdraw: bool, today: date | None = None) -> dict:
    settings, access, client, reason = await _access(db, user)
    if reason:
        raise HelperShiftsError(409 if reason == "no_capability_events" else 403, REASON_TEXTS.get(reason, "Nicht möglich."), reason=reason)
    try:
        if withdraw:
            row = await client.withdraw_shift(access["params"], int(event_id), int(shift_id))
        else:
            row = await client.request_shift(access["params"], int(event_id), int(shift_id))
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            reason = await _denied(db, access)
            raise HelperShiftsError(403, REASON_TEXTS[reason], reason=reason) from exc
        if exc.kind == "not_found":
            raise HelperShiftsError(404, "Diese Veranstaltung oder diesen Dienst gibt es nicht (mehr).") from exc
        if exc.kind == "conflict":
            raise HelperShiftsError(409, SHIFT_CONFLICTS["confirmed"] if withdraw else _conflict_text(exc)) from exc
        raise HelperShiftsError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc
    return event_view(row, today)


async def request_shift(db, user: dict, event_id: int, shift_id: int, *, today: date | None = None) -> dict:
    """Helferdienst anfragen - bestätigt wird in Dolibarr; nochmal anfragen ändert nichts."""
    return await _write(db, user, event_id, shift_id, withdraw=False, today=today)


async def withdraw_shift(db, user: dict, event_id: int, shift_id: int, *, today: date | None = None) -> dict:
    """Eine noch nicht bestätigte Anfrage zurückziehen; ein bestätigter Dienst wird mit dem Verein abgesagt."""
    return await _write(db, user, event_id, shift_id, withdraw=True, today=today)
