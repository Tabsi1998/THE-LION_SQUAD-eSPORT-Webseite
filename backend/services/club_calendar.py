"""Versammlungen und die eigenen Helferschichten als Termine (#1190, #1272).

Die Daten kommen aus dem Vereinsmodul - Dolibarr ist hier die bessere Quelle: Sitzungen, zu denen die Person
eingeladen ist (der Vorstand ist zu seinen Sitzungen eingeladen und sieht sie so), und die Schichten, für die sie
eingetragen ist. Ein Termin nennt nie andere Personen: keine Namen, keine Anträge, keine Tagesordnung und kein
Zugangslink - Details und Knöpfe bleiben im Mitgliederbereich. Wer keinen Weg zur Akte hat oder wenn das Modul
gerade nicht antwortet, gibt es schlicht keine Vereinstermine.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from services import dolibarr_helper_shifts, dolibarr_meetings

logger = logging.getLogger("tls.club_calendar")

VIENNA = ZoneInfo("Europe/Vienna")
# Eine Versammlung ohne Ende im Vereinsmodul dauert im Kalender zwei Stunden - wie jeder Termin ohne Ende.
MEETING_DURATION = timedelta(hours=2)
# Eigene Schichten: angefragt (der Vorstand bestätigt noch), bestätigt und geleistet.
OWN_SHIFT_STATES = ("requested", "confirmed", "done")


def _zone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name) if name else VIENNA
    except (ZoneInfoNotFoundError, ValueError):
        return VIENNA


def _at(day: str | None, clock: str | None, zone: ZoneInfo) -> datetime | None:
    """„2026-10-24“ und „18:00“ in der Zone des Termins als Zeitpunkt; ohne gültige Uhrzeit nichts."""
    try:
        local = datetime.strptime(f"{str(day or '')[:10]} {str(clock or '')[:5]}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    return local.replace(tzinfo=zone).astimezone(timezone.utc)


def _valid_day(day: str | None) -> str | None:
    try:
        return datetime.strptime(str(day or "")[:10], "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None


def meeting_item(meeting: dict) -> dict | None:
    """Eine Sitzung als Termin. Ohne Uhrzeit ein ganzer Tag; zugesagt heißt „deins“."""
    day = _valid_day(meeting.get("day"))
    meeting_id = int(meeting.get("id") or 0)
    if not day or not meeting_id:
        return None
    zone = _zone(meeting.get("timezone"))
    start = _at(day, meeting.get("time"), zone)
    kind_label = meeting.get("kind_label") or "Versammlung"
    title = str(meeting.get("title") or "").strip()
    place = str(meeting.get("place") or "").strip()
    status = str(meeting.get("status") or "")
    return {
        "id": f"meeting-{meeting_id}",
        "kind": "club",
        "club_kind": "meeting",
        "title": title if title and kind_label.lower() in title.lower() else (f"{kind_label}: {title}" if title else kind_label),
        "start": (start or datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=VIENNA).astimezone(timezone.utc)).isoformat(),
        "end": (start + MEETING_DURATION).isoformat() if start else None,
        "all_day": start is None,
        "day": day,
        "status": "cancelled" if status == "cancelled" else status,
        "phase": {"label": meeting.get("status_label") or "", "state": status},
        "location": place or meeting.get("format_label") or None,
        "path": f"/members/meetings?meeting={meeting_id}",
        "visibility": "members",
        "mine": str(meeting.get("response") or "") == "yes",
        "marker": "meeting",
        "meeting_id": meeting_id,
    }


def shift_item(event: dict, shift: dict) -> dict | None:
    """Eine eigene Schicht als Termin - mit Beginn und Ende; endet sie vor dem Beginn, geht sie über Mitternacht."""
    day = _valid_day(shift.get("day") or event.get("day"))
    event_id, shift_id = int(event.get("id") or 0), int(shift.get("id") or 0)
    if not day or not event_id or not shift_id:
        return None
    zone = _zone(event.get("timezone"))
    start = _at(day, shift.get("start"), zone)
    if not start:
        return None
    end = _at(day, shift.get("end"), zone)
    if end and end <= start:
        end += timedelta(days=1)
    label = str(shift.get("label") or "").strip() or "Helferschicht"
    event_label = str(event.get("label") or "").strip()
    return {
        "id": f"shift-{event_id}-{shift_id}",
        "kind": "club",
        "club_kind": "shift",
        "title": f"Helferschicht: {label}" + (f" · {event_label}" if event_label else ""),
        "start": start.isoformat(),
        "end": end.isoformat() if end else None,
        "all_day": False,
        "day": day,
        "status": "cancelled" if str(event.get("status") or "") == "cancelled" else "planned",
        "phase": {"label": shift.get("mine_label") or "", "state": str(shift.get("mine") or "")},
        "location": str(event.get("place") or "").strip() or None,
        "path": f"/members/helfen?event={event_id}",
        "visibility": "members",
        "mine": True,
        "marker": "shift",
        "event_id": event_id,
        "shift_id": shift_id,
    }


async def meetings_for(db, user: dict | None) -> list[dict]:
    """Die Sitzungen der Person aus dem Vereinsmodul (Ansichten wie im Mitgliederbereich) - oder keine."""
    if not user:
        return []
    try:
        view = await dolibarr_meetings.overview(db, user)
    except Exception as exc:  # noqa: BLE001 - ohne Vereinsmodul bleibt der Kalender, wie er ist
        logger.warning("club calendar: meetings unavailable (%s)", type(exc).__name__)
        return []
    return [meeting for meeting in view.get("meetings") or [] if isinstance(meeting, dict)]


async def own_shifts_for(db, user: dict | None) -> list[tuple[dict, dict]]:
    """Die eigenen Schichten als (Veranstaltung, Schicht) - nur, wofür die Person eingetragen ist."""
    if not user:
        return []
    try:
        view = await dolibarr_helper_shifts.overview(db, user)
    except Exception as exc:  # noqa: BLE001
        logger.warning("club calendar: helper shifts unavailable (%s)", type(exc).__name__)
        return []
    pairs = []
    for event in view.get("events") or []:
        for shift in event.get("shifts") or []:
            if str(shift.get("mine") or "") in OWN_SHIFT_STATES:
                pairs.append((event, shift))
    return pairs


async def club_items(db, user: dict | None) -> list[dict]:
    """Versammlungen und eigene Schichten der Person als Termine - für Kalender und persönlichen Feed."""
    # Beide Abrufe gleichzeitig (Codex-Prüfung #1460): jeder fängt seine Fehler selbst, fällt einer aus, kommt der andere.
    meetings, shifts = await asyncio.gather(meetings_for(db, user), own_shifts_for(db, user))
    items = [item for item in (meeting_item(meeting) for meeting in meetings) if item]
    items += [item for item in (shift_item(event, shift) for event, shift in shifts) if item]
    return items
