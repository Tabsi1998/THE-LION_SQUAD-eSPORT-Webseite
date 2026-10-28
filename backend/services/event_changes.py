"""Absagen, Verschieben und Löschen eines Events (#2118) - was daraus für Angemeldete, Warteliste und Rechnungen folgt.

- **Absagen** (Status wechselt auf ``cancelled``): jede aktive Anmeldung und die Warteliste gelten als storniert
  (``cancelled_with_event``), offene Rechnungsaufträge werden storniert, ein schon angelegter Beleg wird zum Prüffall
  (``billing_orders.cancel_orders_for``). Alle Betroffenen bekommen eine Benachrichtigung (Postfach, Push, Discord nach
  Einstellung) und die Mail „Event abgesagt“ (``event_cancelled``, #2119), wenn sie Mails zu Turnier-Updates
  zulassen. Protokoll ``event.cancel``.
- **Verschieben**: neuer Termin oder Ort. Ob die Angemeldeten es erfahren, entscheidet die Verwaltung beim Speichern
  (``notify_registrants``); dieselben Wege, Protokoll ``event.change_notice``.
- **Löschen**: nur, wenn nichts mehr daran hängt - keine aktive Anmeldung (sonst zuerst absagen), kein Beleg (dann
  archivieren) und kein verknüpftes Turnier mit Anmeldungen (wie beim Lösen im Programm). Protokoll ``event.delete``.
"""
from __future__ import annotations

import logging

from models import new_id, now_utc
from services import billing_orders
from services.event_lead import MESSAGE_CATEGORY, MESSAGE_KIND, MESSAGE_TEMPLATE
from services.log_safe import log_safe

logger = logging.getLogger("tls.events.changes")

# Wer betroffen ist: angemeldet, eingecheckt oder auf der Warteliste.
AFFECTED_STATUSES = ("registered", "checked_in", "waitlist")
# Was als „Termin oder Ort geändert“ gilt.
SCHEDULE_FIELDS = ("start_date", "end_date", "days")
PLACE_FIELDS = ("location", "address", "postal_code", "city", "locations", "is_online")
# Aktive Turnier-Anmeldungen - dieselbe Liste wie beim Lösen eines Turniers aus dem Programm.
ACTIVE_TOURNAMENT_REGISTRATIONS = ("pending", "approved", "checked_in", "waitlist")


def _path(event: dict) -> str:
    return f"/events/{event.get('slug') or event['id']}"


async def active_registration_counts(db, event_ids: list[str]) -> dict[str, int]:
    """Bestehende Anmeldungen samt Warteliste je Event - unabhängig davon, ob die Anmeldung gerade an ist."""
    if not event_ids:
        return {}
    rows = await db.event_registrations.aggregate([
        {"$match": {"event_id": {"$in": event_ids}, "status": {"$in": list(AFFECTED_STATUSES)}}},
        {"$group": {"_id": "$event_id", "n": {"$sum": 1}}},
    ]).to_list(len(event_ids))
    return {row["_id"]: int(row["n"]) for row in rows}


async def _cancel_orders(db, registration_id: str, reason: str) -> int:
    """Offene, zurückgehaltene und fehlgeschlagene Aufträge zu (``failed`` dazu, sonst erzeugte „Erneut versuchen“
    später eine Rechnung zum abgesagten Event); ein gestellter Beleg wird Prüffall (``cancel_orders_for``)."""
    count = await billing_orders.cancel_orders_for(db, kind="event", registration_id=registration_id, reason=reason)
    failed = await db.billing_orders.update_many(
        {"kind": "event", "registration_id": registration_id, "status": "failed"},
        {"$set": {"status": "cancelled", "cancel_reason": reason, "updated_at": now_utc().isoformat()}},
    )
    return count + int(failed.modified_count)


async def _affected_registrations(db, event_id: str) -> list[dict]:
    return await db.event_registrations.find(
        {"event_id": event_id, "status": {"$in": list(AFFECTED_STATUSES)}},
        {"_id": 0, "id": 1, "user_id": 1, "status": 1, "price_snapshot": 1},
    ).to_list(5000)


async def _recipients(db, user_ids: list[str]) -> list[dict]:
    """Je Person einmal - ohne gesperrte, deaktivierte und gelöschte Konten (wie „Nachricht an alle“)."""
    ids = sorted({uid for uid in user_ids if uid})
    if not ids:
        return []
    users = await db.users.find(
        {"id": {"$in": ids}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}, "anonymized_at": None},
        {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1, "notification_preferences": 1,
         "newsletter_consent": 1},
    ).to_list(len(ids))
    return sorted(users, key=lambda user: user["id"])


async def _inform(db, event: dict, users: list[dict], *, title: str, message: str, dedupe: str,
                  template: str = MESSAGE_TEMPLATE) -> dict:
    """Benachrichtigung und Mail über die vorhandenen Wege; ein Fehler bei einer Person hält die anderen nicht auf.
    Die Absage hat ihre eigene Mail ``event_cancelled`` (#2119), die Terminänderung bleibt bei ``event_message``."""
    from services.notification_preferences import send_user_template
    from services.user_notifications import build_public_url, create_user_notification

    name = event.get("name") or "Event"
    path = _path(event)
    url = await build_public_url(path)
    notified = mails = 0
    for user in users:
        try:
            doc = await create_user_notification(
                user["id"], f"{name}: {title}", message, path, kind=MESSAGE_KIND,
                meta={"category": MESSAGE_CATEGORY, "event_id": event["id"], "dedupe_key": f"{dedupe}:{user['id']}"},
            )
            notified += 1 if doc else 0
        except Exception:
            logger.warning("Event %s: Benachrichtigung %s nicht angelegt", log_safe(event["id"]), log_safe(user["id"]),
                           exc_info=True)
        try:
            values = {"display_name": user.get("display_name") or user.get("username") or "", "event_name": name, "url": url}
            if template == MESSAGE_TEMPLATE:
                values["message"] = message
            result = await send_user_template(
                user, template, MESSAGE_CATEGORY, dedupe_key=f"{dedupe}:{user['id']}", **values,
            )
            mails += 1 if result.get("ok") and not result.get("skipped") else 0
        except Exception:
            logger.warning("Event %s: Mail an %s nicht eingereiht", log_safe(event["id"]), log_safe(user["id"]),
                           exc_info=True)
    return {"notified": notified, "mails": mails}


def _when_and_where(event: dict) -> str:
    from services.notification_preferences import _event_when

    when = _event_when(event)
    if event.get("is_online"):
        where = "online"
    else:
        where = ", ".join(part for part in (event.get("location"), event.get("city")) if part)
    return "; ".join(part for part in (f"Termin: {when}" if when else "", f"Ort: {where}" if where else "") if part)


async def cancel_event(db, event: dict, me: dict) -> dict:
    """Das Event ist abgesagt: Anmeldungen und Warteliste stornieren, Aufträge stornieren, alle informieren."""
    now = now_utc().isoformat()
    registrations = await _affected_registrations(db, event["id"])
    orders = 0
    for registration in registrations:
        await db.event_registrations.update_one(
            {"id": registration["id"], "status": {"$in": list(AFFECTED_STATUSES)}},
            {"$set": {"status": "cancelled", "cancelled_with_event": True, "updated_at": now,
                      **({"billing_status": "cancelled"} if registration.get("price_snapshot") else {})}},
        )
        orders += await _cancel_orders(db, registration["id"], "Event abgesagt")
    users = await _recipients(db, [registration.get("user_id") for registration in registrations])
    message = ("Das Event wurde abgesagt. Deine Anmeldung ist damit storniert – ein offener Kostenbeitrag wird nicht "
               "verrechnet; wurde schon eine Rechnung gestellt, meldet sich der Verein bei dir.")
    # Je Absage-Durchgang und Person genau einmal (``cancel_round`` zählt nur der bedingte Statuswechsel weiter): ein
    # doppelter Klick schickt nichts doppelt, wer sich nach dem Zurücknehmen neu anmeldet, erfährt die zweite Absage.
    round_no = int(event.get("cancel_round") or 1)
    sent = await _inform(db, event, users, title="abgesagt", message=message,
                         dedupe=f"event-cancelled:{event['id']}:{round_no}", template="event_cancelled")
    result = {"registrations": len(registrations), "notified": sent["notified"], "orders": orders}
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "event.cancel", "actor_id": me["id"], "target_id": event["id"],
        "data": {**result, "mails": sent["mails"]}, "created_at": now,
    })
    return result


def schedule_or_place_changed(before: dict, after: dict) -> bool:
    return any(before.get(field) != after.get(field) for field in (*SCHEDULE_FIELDS, *PLACE_FIELDS))


async def announce_change(db, before: dict, after: dict, me: dict) -> dict | None:
    """Neuer Termin oder Ort: die Betroffenen informieren - nur, wenn sich wirklich etwas daran geändert hat."""
    if not schedule_or_place_changed(before, after):
        return None
    registrations = await _affected_registrations(db, after["id"])
    users = await _recipients(db, [registration.get("user_id") for registration in registrations])
    now = now_utc().isoformat()
    details = _when_and_where(after)
    message = "Termin oder Ort des Events haben sich geändert."
    if details:
        message += f" {details}."
    message += " Wenn du nicht mehr kannst, melde dich bitte auf der Event-Seite ab."
    sent = await _inform(db, after, users, title="Termin oder Ort geändert", message=message,
                         dedupe=f"event-changed:{after['id']}:{now}")
    result = {"recipients": len(users), "notified": sent["notified"], "mails": sent["mails"]}
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "event.change_notice", "actor_id": me["id"], "target_id": after["id"],
        "data": result, "created_at": now,
    })
    return result


async def delete_block_reason(db, event: dict) -> str | None:
    """Warum das Event nicht gelöscht werden darf - ``None``, wenn nichts mehr daran hängt."""
    active = await db.event_registrations.count_documents(
        {"event_id": event["id"], "status": {"$in": list(AFFECTED_STATUSES)}})
    if active:
        word = "Anmeldung" if active == 1 else "Anmeldungen"
        return (f"Für dieses Event gibt es noch {active} {word} (samt Warteliste). Bitte das Event zuerst absagen – "
                "dann werden alle informiert und offene Rechnungsaufträge storniert.")
    invoiced = await db.billing_orders.count_documents(
        {"kind": "event", "source_id": event["id"], "status": "invoiced"})
    if invoiced:
        return ("Zu diesem Event gibt es schon eine Rechnung. Die Anmeldungen bleiben dafür als Nachweis – bitte das "
                "Event absagen bzw. archivieren statt löschen.")
    tournament_ids = [row["id"] async for row in db.tournaments.find({"event_id": event["id"]}, {"_id": 0, "id": 1})]
    if tournament_ids and await db.tournament_registrations.count_documents(
        {"tournament_id": {"$in": tournament_ids}, "status": {"$in": list(ACTIVE_TOURNAMENT_REGISTRATIONS)}}, limit=1,
    ):
        return ("Ein Turnier dieses Events hat noch Anmeldungen – bitte das Turnier aus dem Programm lösen oder dort "
                "die Anmeldungen klären.")
    return None


async def delete_event(db, event: dict, me: dict) -> dict:
    """Löschen, wenn nichts mehr daran hängt: Anmeldungen (alle storniert) gehen, Turniere, Fast Laps und Alben werden
    gelöst. Stornierte Aufträge bleiben als Beleg der Abrechnung."""
    now = now_utc().isoformat()
    registrations = [row["id"] async for row in
                     db.event_registrations.find({"event_id": event["id"]}, {"_id": 0, "id": 1})]
    for registration_id in registrations:
        # Sicherheitsnetz: ein noch offener Auftrag zu einer stornierten Anmeldung schriebe sonst später ins Leere.
        await _cancel_orders(db, registration_id, "Event gelöscht")
    await db.events.delete_one({"id": event["id"]})
    await db.event_registrations.delete_many({"event_id": event["id"]})
    unlinked = {}
    linked = (("tournaments", db.tournaments), ("fast_laps", db.f1_challenges), ("albums", db.gallery_albums))
    for name, collection in linked:
        result = await collection.update_many({"event_id": event["id"]},
                                              {"$set": {"event_id": None, "updated_at": now}})
        unlinked[name] = int(result.modified_count)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "event.delete", "actor_id": me["id"], "target_id": event["id"],
        "data": {"name": event.get("name"), "slug": event.get("slug"), "registrations": len(registrations), **unlinked},
        "created_at": now,
    })
    return {"ok": True, "registrations": len(registrations), **unlinked}
