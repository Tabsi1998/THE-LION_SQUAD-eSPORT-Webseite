"""Anmeldungen & Einlass (#1372): die Arbeitsseite der Turnierleitung für die Anmeldungen eines Events.

Die Seite ``/events/<slug>/leitung`` liest hier die Liste - nach Namen sortiert, mit Suche und den Filtern „noch nicht
da“, „da“, „Warteliste“ und „alle“ - und den Zähler „84 von 120 da“. Geändert wird nur über den vorhandenen Weg
(``PATCH /api/events/{id}/registrations/{rid}``): Einchecken, „Rückgängig“, Nachrücken mit Platzprüfung,
Begleitpersonen und Status. So gilt dort jede Prüfung (Plätze, Preis, Belohnung beim Einchecken) auch für diese Seite.

Datenschutz: eine Zeile trägt nur, was an der Tür und für die Leitung nötig ist - keine ganze Mail-Adresse (gekürzt
wie in der Mail-Warteschlange, #1418), keine Konto-Kennung, kein Geld. Die eingeschränkte Zeile (``full=False``) ist
für den Einlass-Helfer (#1375) gedacht: nur Name, Status, Plätze und Begleitpersonen.

„Nachricht an alle“: geht an die Angemeldeten (angemeldet oder eingecheckt) - je Person einmal, als Benachrichtigung
(Postfach, Push, Discord nach Einstellung) und als Mail über die Warteschlange, wenn die Person Mails zu
„Turnier-Updates“ zulässt. Sie geht nur hinaus, wenn die Leitung die Empfängerzahl bestätigt hat, die der Server
gerade zählt; gleich danach ein zweites Mal geht nicht. Jede Nachricht steht mit Text und Zahl im Protokoll
(``event_messages``) und im Audit.
"""
from __future__ import annotations

import logging
import unicodedata
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services.event_registration import seats
from services.log_safe import log_safe, mask_addresses
from services.mutation_lock import MutationLockBusy, mutation_lock

logger = logging.getLogger("tls.events.lead")

FILTER_STATUSES: dict[str, frozenset[str] | None] = {
    "open": frozenset({"registered"}),
    "here": frozenset({"checked_in"}),
    "waitlist": frozenset({"waitlist"}),
    "all": None,
}
RECIPIENT_STATUSES = ("registered", "checked_in")
MESSAGE_MAX = 1000
MESSAGE_COOLDOWN_SECONDS = 60
MESSAGE_KIND = "event_message"
MESSAGE_TEMPLATE = "event_message"
MESSAGE_CATEGORY = "tournament_updates"
LOG_SHOWN = 5


class LeadError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def normalized(text) -> str:
    """Für die Suche: klein, ohne Akzente - „Brünner“ findet man mit „brunner“, „Zoë“ mit „zoe“."""
    decomposed = unicodedata.normalize("NFKD", str(text or ""))
    return "".join(char for char in decomposed if not unicodedata.combining(char)).casefold().strip()


def matches(registration: dict, query: str) -> bool:
    """Jedes Wort der Suche steht im Namen. Gesucht wird nur im Namen - die Mail-Adresse steht nicht in der Liste."""
    words = normalized(query).split()
    name = normalized(registration.get("display_name"))
    return all(word in name for word in words)


def registration_row(registration: dict, *, full: bool = True) -> dict:
    row = {
        "id": registration.get("id"),
        "display_name": registration.get("display_name") or "Teilnehmer",
        "status": registration.get("status"),
        "companion_count": max(0, int(registration.get("companion_count") or 0)),
        "seat_count": seats(registration),
    }
    if full:
        email = str(registration.get("email") or "")
        # Notizen stehen nicht in der Liste (Codex-Prüfung #1517): nur der Merker; den Text holt die Detailansicht je Person.
        row.update({
            "email_masked": mask_addresses(email) if "@" in email else "",
            "has_note": bool(registration.get("note") or registration.get("internal_note")),
            "created_at": registration.get("created_at"),
            "updated_at": registration.get("updated_at"),
        })
    return row


async def registration_detail(db, event: dict, registration_id: str) -> dict:
    """Eine Anmeldung mit ihren Notizen - für die Detailansicht der Leitung, eine Person je Abruf."""
    registration = await db.event_registrations.find_one(
        {"id": registration_id, "event_id": event["id"]},
        {"_id": 0, "id": 1, "display_name": 1, "status": 1, "companion_count": 1, "seat_count": 1, "email": 1, "note": 1,
         "internal_note": 1, "created_at": 1, "updated_at": 1},
    )
    if not registration:
        raise LeadError(404, "Anmeldung nicht gefunden")
    return {**registration_row(registration), "note": registration.get("note"), "internal_note": registration.get("internal_note")}


def counts(registrations: list[dict]) -> dict:
    """„84 von 120 da“: Personen und Plätze (mit Begleitpersonen) - erwartet sind alle Angemeldeten."""
    by_status: dict[str, list[dict]] = {}
    for registration in registrations:
        by_status.setdefault(registration.get("status") or "", []).append(registration)
    expected = by_status.get("registered", []) + by_status.get("checked_in", [])
    here = by_status.get("checked_in", [])
    return {
        "open": len(by_status.get("registered", [])),
        "here": len(here),
        "waitlist": len(by_status.get("waitlist", [])),
        "all": len(registrations),
        "expected": len(expected),
        "expected_seats": sum(seats(r) for r in expected),
        "here_seats": sum(seats(r) for r in here),
    }


def _sort_key(registration: dict):
    return normalized(registration.get("display_name")), registration.get("created_at") or ""


async def _registrations(db, event: dict) -> list[dict]:
    return await db.event_registrations.find(
        {"event_id": event["id"]},
        {"_id": 0, "id": 1, "user_id": 1, "display_name": 1, "status": 1, "companion_count": 1, "seat_count": 1,
         "email": 1, "note": 1, "internal_note": 1, "created_at": 1, "updated_at": 1},
    ).to_list(5000)


async def recipients(db, event: dict) -> list[dict]:
    """Die Angemeldeten des Events - je Person einmal, ohne Warteliste und Abgemeldete. Gesperrte, deaktivierte und
    gelöschte (anonymisierte) Konten bekommen nichts und zählen nicht mit (Codex-Prüfung #1517)."""
    rows = await db.event_registrations.find(
        {"event_id": event["id"], "status": {"$in": list(RECIPIENT_STATUSES)}, "anonymized_at": None},
        {"_id": 0, "user_id": 1},
    ).to_list(5000)
    ids = sorted({row["user_id"] for row in rows if row.get("user_id")})
    if not ids:
        return []
    users = await db.users.find(
        {"id": {"$in": ids}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}, "anonymized_at": None},
        {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1, "newsletter_consent": 1},
    ).to_list(len(ids))
    return sorted(users, key=lambda user: user["id"])


async def recipient_ids(db, event: dict) -> list[str]:
    return [user["id"] for user in await recipients(db, event)]


async def message_log(db, event: dict) -> list[dict]:
    return await db.event_messages.find(
        {"event_id": event["id"]},
        {"_id": 0, "id": 1, "text": 1, "recipient_count": 1, "actor_name": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(LOG_SHOWN)


async def lead_view(db, event: dict, *, query: str = "", filter_key: str = "open", full: bool = True) -> dict:
    if filter_key not in FILTER_STATUSES:
        raise LeadError(400, "Unbekannter Filter.")
    registrations = sorted(await _registrations(db, event), key=_sort_key)
    statuses = FILTER_STATUSES[filter_key]
    shown = [r for r in registrations if (statuses is None or r.get("status") in statuses) and matches(r, query)]
    view = {
        "event": {
            "id": event["id"], "slug": event.get("slug"), "name": event.get("name"), "start_date": event.get("start_date"),
            "max_participants": event.get("max_participants"), "allow_companions": bool(event.get("allow_companions")),
            "max_companions_per_registration": int(event.get("max_companions_per_registration") or 0),
        },
        "counts": {**counts(registrations), "max_participants": event.get("max_participants")},
        "filter": filter_key,
        "registrations": [registration_row(r, full=full) for r in shown],
        "can_message": full,
    }
    if full:
        view["message_recipients"] = len(await recipient_ids(db, event))
        view["messages"] = await message_log(db, event)
    return view


async def _claim_event_gate(db, event: dict, now: str, since: str) -> None:
    """Je Event ein Eintrag (Schlüssel ist die Event-Kennung), bedingt in einem Zug geschrieben: von zwei Tipps im selben
    Moment kommt nur einer durch."""
    try:
        await db.event_message_gates.update_one({"_id": event["id"]}, {"$setOnInsert": {"last_at": ""}}, upsert=True)
    except DuplicateKeyError:
        pass
    gate = await db.event_message_gates.update_one({"_id": event["id"], "last_at": {"$lt": since}}, {"$set": {"last_at": now}})
    if not gate.modified_count:
        raise LeadError(429, "Gerade ist schon eine Nachricht an alle hinausgegangen. Bitte kurz warten.")


async def send_message(db, event: dict, me: dict, *, text: str, confirm_count: int) -> dict:
    """„Nachricht an alle Angemeldeten“ - nur mit bestätigter Empfängerzahl, je Person einmal, mit Protokoll."""
    from services.notification_preferences import send_user_template
    from services.user_notifications import create_user_notification

    message = str(text or "").strip()
    if not message:
        raise LeadError(400, "Bitte einen Text eingeben.")
    if len(message) > MESSAGE_MAX:
        raise LeadError(400, f"Die Nachricht ist zu lang (höchstens {MESSAGE_MAX} Zeichen).")
    users = await recipients(db, event)
    if not users:
        raise LeadError(400, "Für dieses Event ist niemand angemeldet.")
    if int(confirm_count) != len(users):
        raise LeadError(409, f"Die Zahl der Empfänger hat sich geändert: jetzt {len(users)}. Bitte noch einmal bestätigen.")

    message_id = new_id()
    name = event.get("name") or "Event"
    path = f"/events/{event.get('slug') or event['id']}"
    # Höchstens eine Nachricht je Minute - je Absender (über alle Events, Codex-Prüfung #1517) und je Event. Die Sperre
    # je Absender hält ein kurzer Lease; darin wird geprüft und der Protokolleintrag geschrieben, den die nächste
    # Prüfung findet.
    try:
        async with mutation_lock(db, f"event-message-sender:{me['id']}", wait_seconds=0):
            now = now_utc().isoformat()
            since = (now_utc() - timedelta(seconds=MESSAGE_COOLDOWN_SECONDS)).isoformat()
            if await db.event_messages.find_one({"actor_id": me["id"], "created_at": {"$gte": since}}, {"_id": 0, "id": 1}):
                raise LeadError(429, "Du hast gerade schon eine Nachricht an alle geschickt. Bitte kurz warten.")
            await _claim_event_gate(db, event, now, since)
            await db.event_messages.insert_one({
                "id": message_id, "event_id": event["id"], "actor_id": me["id"],
                "actor_name": me.get("display_name") or me.get("username"), "text": message,
                "recipient_count": len(users), "created_at": now,
            })
    except MutationLockBusy:
        raise LeadError(429, "Du hast gerade schon eine Nachricht an alle geschickt. Bitte kurz warten.")

    recipient_list = [user["id"] for user in users]
    notified = 0
    for user_id in recipient_list:
        try:
            doc = await create_user_notification(
                user_id, f"{name}: Nachricht der Turnierleitung", message, path, kind=MESSAGE_KIND,
                meta={"category": MESSAGE_CATEGORY, "event_id": event["id"], "dedupe_key": f"event-message:{message_id}"},
            )
            notified += 1 if doc else 0
        except Exception:
            logger.warning("Nachricht an alle: Benachrichtigung %s nicht angelegt", log_safe(user_id), exc_info=True)

    from services.user_notifications import build_public_url

    url = await build_public_url(path)
    mails = 0
    for user in users:
        try:
            result = await send_user_template(
                user, MESSAGE_TEMPLATE, MESSAGE_CATEGORY, dedupe_key=f"event-message:{message_id}:{user['id']}",
                display_name=user.get("display_name") or user.get("username") or "", event_name=name, message=message, url=url,
            )
            mails += 1 if result.get("ok") and not result.get("skipped") else 0
        except Exception:
            logger.warning("Nachricht an alle: Mail an %s nicht eingereiht", log_safe(user.get("id")), exc_info=True)

    await db.event_messages.update_one({"id": message_id}, {"$set": {"notified": notified, "mails": mails}})
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "event.message.send",
        "target_id": event["id"],
        "actor_id": me["id"],
        "data": {"message_id": message_id, "recipient_count": len(users), "notified": notified, "mails": mails,
                 "length": len(message)},
        "created_at": now,
    })
    return {"message_id": message_id, "recipient_count": len(users), "notified": notified, "mails": mails}
