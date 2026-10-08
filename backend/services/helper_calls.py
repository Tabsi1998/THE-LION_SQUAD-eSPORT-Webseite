"""Helfer-Aufruf (#1197): fehlen für ein Event noch Helfer, fragt der Vorstand mit einem Knopf alle Mitglieder.

Die Schichten stehen weiter nur im Vereinsmodul (Dolibarr, ``dolibarr_helper_shifts``) - die Website zählt nur, was
dort frei ist, und schickt den Aufruf. Der Vorstand sieht die offenen Schichten über seinen eigenen Weg zur Akte
(dieselbe Ansicht wie unter /members/helfen) und sendet je Veranstaltung höchstens einen Aufruf am Tag (Wiener Tag).

- Empfänger: nur aktive Vereinsmitglieder (Mitgliedschaft aktiv oder Ehrenmitglied), nie Gäste oder Community.
  Wer das Thema „Helferdienste“ in den Benachrichtigungen ausschaltet, bekommt nichts (Glocke, Push, Discord).
- „Ich helfe“: die Meldung führt zu /members/helfen mit der Veranstaltung oben; angefragt wird über den bestehenden
  Weg, bestätigt wie bisher im Vereinsmodul.
- Erinnerung am Vortag (täglich am Nachmittag): nur an Bestätigte - das Vereinsmodul sagt je Person, welche Dienste
  bestätigt sind. Je Person und Dienst genau einmal.
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import HTTPException

from models import new_id, now_utc
from services import dolibarr_helper_shifts, dolibarr_policy

TOPIC = "helper_shifts"
CALL_KIND = "helper_call"
REMINDER_KIND = "helper_reminder"
WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def _today(today: date | None = None) -> date:
    return today or date.fromisoformat(dolibarr_policy.club_today())


def _clock(value: str) -> str:
    """„09:00“ → „9“, „14:30“ → „14:30“ - so spricht man Uhrzeiten."""
    text = str(value or "").strip()
    if not text:
        return ""
    hour, _, minute = text.partition(":")
    hour = str(int(hour)) if hour.isdigit() else hour
    return hour if minute in ("", "00") else f"{hour}:{minute}"


def shift_line(shift: dict) -> str:
    """„Sa 9–13 Uhr Einlass“."""
    try:
        weekday = WEEKDAYS[date.fromisoformat(str(shift.get("day"))).weekday()]
    except ValueError:
        weekday = ""
    span = "–".join(part for part in (_clock(shift.get("start")), _clock(shift.get("end"))) if part)
    return " ".join(part for part in (weekday, f"{span} Uhr" if span else "", shift.get("label") or "") if part)


def call_text(open_shifts: list[dict]) -> str:
    """„Es fehlen noch 3 Helfer: Sa 9–13 Uhr Einlass, So 14–18 Uhr Abbau.“"""
    missing = sum(int(shift.get("free") or 0) for shift in open_shifts)
    who = "ein Helfer" if missing == 1 else f"{missing} Helfer"
    return f"Es {'fehlt' if missing == 1 else 'fehlen'} noch {who}: " + ", ".join(shift_line(shift) for shift in open_shifts) + "."


def _open_shifts(event: dict, today: str) -> list[dict]:
    return [
        {"id": s["id"], "label": s["label"], "day": s["day"], "start": s["start"], "end": s["end"], "free": s["free"]}
        for s in event.get("shifts") or []
        if s.get("free", 0) > 0 and (not s.get("day") or s["day"] >= today)
    ]


async def board_view(db, board_user: dict, *, today: date | None = None) -> dict:
    """Was der Vorstand für einen Aufruf braucht: kommende Veranstaltungen mit freien Plätzen und ob heute schon gerufen wurde."""
    day = _today(today)
    view = await dolibarr_helper_shifts.overview(db, board_user, today=day)
    if not view.get("available"):
        return {"available": False, "reason": view.get("reason"), "text": view.get("text"), "events": []}
    events = []
    for event in view.get("events") or []:
        if not event.get("upcoming"):
            continue
        open_shifts = _open_shifts(event, day.isoformat())
        last = await db.helper_calls.find({"event_id": event["id"]}, {"_id": 0}).sort("sent_at", -1).to_list(1)
        last = last[0] if last else None
        called_today = bool(last and last.get("day") == day.isoformat())
        events.append({
            "id": event["id"], "label": event.get("label"), "day": event.get("day"), "end_day": event.get("end_day"),
            "open_shifts": open_shifts, "open_places": sum(s["free"] for s in open_shifts),
            "text": call_text(open_shifts) if open_shifts else "",
            "last_call_at": (last or {}).get("sent_at"), "last_call_recipients": (last or {}).get("recipients"),
            "called_today": called_today, "can_call": bool(open_shifts) and not called_today,
        })
    return {"available": True, "events": events}


async def member_recipients(db) -> list[str]:
    """Aktive Vereinsmitglieder mit Konto - nur sie bekommen den Aufruf."""
    rows = await db.memberships.find({"member_status": {"$in": ["active", "honorary"]}}, {"_id": 0, "user_id": 1}).to_list(5000)
    ids = sorted({row["user_id"] for row in rows if row.get("user_id")})
    if not ids:
        return []
    users = await db.users.find({"id": {"$in": ids}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}}, {"_id": 0, "id": 1}).to_list(len(ids))
    return sorted(user["id"] for user in users)


async def send_call(db, board_user: dict, event_id: int, *, today: date | None = None) -> dict:
    from services.user_notifications import create_user_notification
    day = _today(today)
    view = await board_view(db, board_user, today=day)
    if not view["available"]:
        raise HTTPException(status_code=409, detail=view.get("text") or "Die Helferdienste sind gerade nicht erreichbar.")
    event = next((row for row in view["events"] if int(row["id"]) == int(event_id)), None)
    if not event:
        raise HTTPException(status_code=404, detail="Diese Veranstaltung gibt es nicht (mehr) oder sie ist vorbei.")
    if not event["open_shifts"]:
        raise HTTPException(status_code=409, detail="Alle Schichten sind besetzt – ein Aufruf ist nicht nötig.")
    if event["called_today"]:
        raise HTTPException(status_code=429, detail="Für diese Veranstaltung ging heute schon ein Aufruf raus. Morgen wieder.")
    recipients = [uid for uid in await member_recipients(db) if uid != board_user["id"]]
    # Erst merken, dann senden: zwei schnelle Tipps schicken nicht zweimal.
    await db.helper_calls.insert_one({
        "id": new_id(), "event_id": int(event_id), "event_label": event["label"], "day": day.isoformat(),
        "sent_at": now_utc().isoformat(), "sent_by": board_user["id"], "recipients": len(recipients), "open_places": event["open_places"],
    })
    sent = 0
    for uid in recipients:
        created = await create_user_notification(
            uid,
            title=f"Helfer gesucht: {event['label']}",
            body=event["text"],
            url=f"/members/helfen?event={int(event_id)}",
            kind=CALL_KIND,
            meta={"category": TOPIC, "event_id": int(event_id), "dedupe_key": f"helper_call:{int(event_id)}:{day.isoformat()}"},
        )
        sent += 1 if created else 0
    return {"ok": True, "recipients": len(recipients), "sent": sent}


async def send_reminders(db, *, today: date | None = None) -> dict:
    """Am Vortag (täglich am Nachmittag): eine Erinnerung je bestätigtem Dienst - nur an die Bestätigten."""
    from services.notification_preferences import discord_allowed, notification_allowed, push_allowed
    from services.user_notifications import create_user_notification
    day = _today(today)
    tomorrow = (day + timedelta(days=1)).isoformat()
    sent = checked = 0
    for uid in await member_recipients(db):
        user = await db.users.find_one({"id": uid}, {"_id": 0})
        if not user or not any(check(user, REMINDER_KIND, TOPIC) for check in (notification_allowed, push_allowed, discord_allowed)):
            continue
        checked += 1
        try:
            view = await dolibarr_helper_shifts.overview(db, user, today=day)
        except Exception:  # noqa: BLE001 - eine Person ohne Verbindung hält die anderen nicht auf
            continue
        if not view.get("available"):
            continue
        for event in view.get("events") or []:
            for shift in event.get("shifts") or []:
                if shift.get("mine") != "confirmed" or shift.get("day") != tomorrow:
                    continue
                created = await create_user_notification(
                    uid,
                    title=f"Morgen hilfst du: {shift.get('label')}",
                    body=f"{event.get('label')} · {shift_line(shift)}. Danke, dass du dabei bist!",
                    url=f"/members/helfen?event={event['id']}",
                    kind=REMINDER_KIND,
                    meta={"category": TOPIC, "event_id": event["id"], "shift_id": shift.get("id"),
                          "dedupe_key": f"helper_reminder:{event['id']}:{shift.get('id')}:{uid}"},
                )
                sent += 1 if created else 0
    return {"checked": checked, "sent": sent}
