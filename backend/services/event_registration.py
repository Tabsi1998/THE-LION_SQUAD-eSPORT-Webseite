"""Die eine Anmeldung zum Event (#885): das Website-Formular und der Discord-Knopf rufen denselben Dienst - mit denselben
Prüfungen (Entwurf, Sichtbarkeit, Frist, Begleitpersonen, Doppelanmeldung, Kosten und Rechnung, Plätze und Warteliste).
Es gibt keinen zweiten, schwächeren Weg. Fehler sind Sätze mit dem HTTP-Status, den die Route daraus macht; im Audit
steht, über welchen Weg die Anmeldung kam (``via``)."""
from __future__ import annotations

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import billing_orders, pricing
from services.access_links import AccessLinkUsedUp, claim_access_link_use, release_access_link_use
from services.permissions import is_confirmed_tournament_lead
from services.public_phase import derive_public_phase
from services.visibility import user_can_see
from services.mutation_lock import MutationLockBusy, mutation_lock

# Wer sich auch für einen Event-Entwurf anmelden darf: die Turnierleitung (Events gehören zu ihr) - seit #1350 nach
# Bereich (Rolle oder Freigabe); die Rollenliste bleibt nur als Auskunft.
STAFF_ROLES = {"tournament_admin", "club_admin", "superadmin"}
ACTIVE_STATUSES = {"registered", "checked_in"}


class RegistrationError(Exception):
    """Ein Satz fürs Formular bzw. die private Discord-Antwort - mit dem HTTP-Status der Route."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class SeatsBusy(RegistrationError):
    """Die Platzsperre war zu lange belegt (#1037) - kein „schon angemeldet“, sondern „gleich nochmal versuchen“."""

    def __init__(self):
        super().__init__(409, SEAT_BUSY)


def registration_open(event: dict) -> bool:
    return bool(event.get("has_registration") and derive_public_phase(event, "event").get("state") == "registration_open")


def seats(registration: dict) -> int:
    try:
        companion_count = int(registration.get("companion_count") or 0)
    except (TypeError, ValueError):
        companion_count = 0
    return 1 + max(0, companion_count)


def validated_companion_count(event: dict, value: int | None) -> int:
    companion_count = int(value or 0)
    if companion_count < 0:
        raise RegistrationError(400, "Begleitpersonen duerfen nicht negativ sein")
    max_companions = int(event.get("max_companions_per_registration") or 0)
    if companion_count and not event.get("allow_companions"):
        raise RegistrationError(400, "Bei diesem Event sind keine Begleitpersonen aktiviert")
    if companion_count > max_companions:
        raise RegistrationError(400, f"Maximal {max_companions} Begleitpersonen erlaubt")
    return companion_count


COUNT_GROUP = {"count": {"$sum": 1}, "companions": {"$sum": {"$max": [0, {"$ifNull": ["$companion_count", 0]}]}}}


def _summary_from(by_status: dict, event: dict) -> dict:
    """Die Rechnung aus den Zählern je Status ``{status: (Anzahl, Begleitpersonen)}``."""

    def count(*statuses: str) -> int:
        return sum(by_status.get(status, (0, 0))[0] for status in statuses)

    def companions(*statuses: str) -> int:
        return sum(by_status.get(status, (0, 0))[1] for status in statuses)

    companion_count = companions(*ACTIVE_STATUSES)
    reserved_seats = count(*ACTIVE_STATUSES) + companion_count
    waitlist_seats = count("waitlist") + companions("waitlist")
    max_participants = event.get("max_participants")
    spots_left = None
    if max_participants:
        spots_left = max(int(max_participants) - reserved_seats, 0)
    return {
        "registered_count": count(*ACTIVE_STATUSES),
        "waitlist_count": count("waitlist"),
        "checked_in_count": count("checked_in"),
        "no_show_count": count("no_show"),
        "cancelled_count": count("cancelled"),
        "reserved_seats": reserved_seats,
        "waitlist_seats": waitlist_seats,
        "companion_count": companion_count,
        "spots_left": spots_left,
        "max_participants": max_participants,
    }


async def summary(db, event: dict, exclude_registration_id: str | None = None) -> dict:
    """Plätze, Warteliste und Zähler - dieselbe Rechnung für Formular, Teilnehmerliste und Discord-Zusammenfassung."""
    # In der Datenbank gezählt, über alle Anmeldungen (#1037): Eine gelesene Liste hätte eine Obergrenze, und was darüber
    # liegt, zählte nicht mit. Je Status Anzahl und Begleitpersonen (nicht negativ; was keine Zahl ist, zählt 0).
    match = {"event_id": event["id"]}
    if exclude_registration_id:
        match["id"] = {"$ne": exclude_registration_id}
    rows = await db.event_registrations.aggregate([
        {"$match": match},
        {"$group": {"_id": "$status", **COUNT_GROUP}},
    ]).to_list(None)
    by_status = {row["_id"]: (int(row.get("count") or 0), int(row.get("companions") or 0)) for row in rows}
    return _summary_from(by_status, event)


async def summaries(db, events: list[dict]) -> dict[str, dict]:
    """Dieselbe Rechnung für mehrere Events mit einer Abfrage - Listen (z. B. verknüpfte Events einer News)."""
    ids = [event["id"] for event in events if event.get("id")]
    if not ids:
        return {}
    rows = await db.event_registrations.aggregate([
        {"$match": {"event_id": {"$in": ids}}},
        {"$group": {"_id": {"event_id": "$event_id", "status": "$status"}, **COUNT_GROUP}},
    ]).to_list(None)
    by_event: dict[str, dict] = {}
    for row in rows:
        key = row["_id"]
        by_event.setdefault(key["event_id"], {})[key.get("status")] = (int(row.get("count") or 0), int(row.get("companions") or 0))
    return {event["id"]: _summary_from(by_event.get(event["id"], {}), event) for event in events if event.get("id")}


async def ensure_can_register(db, event: dict, me: dict, *, has_access: bool = False, register_access: dict | None = None) -> None:
    """Die Prüfungen vor der Anmeldung - Website und Discord stellen dieselben Fragen in derselben Reihenfolge."""
    if event.get("status") == "draft" and not is_confirmed_tournament_lead(me) and not has_access:
        raise RegistrationError(404, "Event nicht gefunden")
    if not has_access and not await user_can_see(me, event.get("visibility") or "public"):
        raise RegistrationError(403, "Event ist nicht sichtbar")
    if not registration_open(event) and not register_access:
        raise RegistrationError(400, "Die Anmeldung ist aktuell nicht offen")
    if not event.get("has_registration"):
        raise RegistrationError(400, "Dieses Event hat keine Anmeldung")


async def existing_registration(db, event: dict, me: dict) -> dict | None:
    return await db.event_registrations.find_one({"event_id": event["id"], "user_id": me["id"]}, {"_id": 0})


# Die Platzsperre des Events (#1037): Zählen und Schreiben einer Anmeldung geschehen in einem Zug - bei der Anmeldung
# wie beim Nachrücken, Einchecken oder Ändern der Begleitpersonen durch die Turnierleitung. Ohne sie sähen zwei
# gleichzeitige Anfragen denselben freien Platz und bekämen ihn beide. Wer ansteht, wartet kurz; dauert es zu lange,
# kommt ein Satz zum Wiederholen.
SEAT_WAIT_SECONDS = 5.0
SEAT_BUSY = "Gerade melden sich viele gleichzeitig an – bitte versuch es gleich noch einmal."


def seat_resource(event_id: str) -> str:
    return f"event:{event_id}:seats"


async def register(db, event: dict, me: dict, *, companion_count: int | None = 0, note: str | None = None,
                   selected_positions: list[str] | None = None, register_access: dict | None = None, via: str = "web") -> dict:
    """Anmelden unter der Platzsperre - jeder Weg (Website, App, Discord, Zugangslink) kommt hier durch (#1037)."""
    try:
        async with mutation_lock(db, seat_resource(event["id"]), wait_seconds=SEAT_WAIT_SECONDS):
            return await _register(db, event, me, companion_count=companion_count, note=note,
                                   selected_positions=selected_positions, register_access=register_access, via=via)
    except MutationLockBusy:
        raise SeatsBusy()


async def _register(db, event: dict, me: dict, *, companion_count: int | None, note: str | None,
                    selected_positions: list[str] | None, register_access: dict | None, via: str) -> dict:
    """Anmelden - Platz oder Warteliste, Preis eingefroren und Auftrag angelegt, Audit mit dem Weg (``via``)."""
    companions = validated_companion_count(event, companion_count)
    requested_seats = 1 + companions
    existing = await existing_registration(db, event, me)
    if existing and existing.get("status") not in {"cancelled", "no_show"}:
        await repair_order(db, event, existing)
        raise RegistrationError(409, "Du bist für dieses Event bereits angemeldet")

    # Preis (#315, #318): vor der Buchung rechnen, damit eine unbekannte Position sauber scheitert.
    offer = event.get("billing") or {}
    try:
        price = pricing.quote(offer, seats=requested_seats, selected=selected_positions)
    except pricing.PricingError as exc:
        raise RegistrationError(400, str(exc))

    counts = await summary(db, event, exclude_registration_id=existing.get("id") if existing else None)
    status = "registered"
    max_participants = event.get("max_participants")
    if max_participants and counts["reserved_seats"] + requested_seats > int(max_participants):
        status = "waitlist"

    now = now_utc().isoformat()
    doc = {
        "event_id": event["id"],
        "user_id": me["id"],
        "display_name": me.get("display_name") or me.get("username"),
        "email": me.get("email"),
        "status": status,
        "companion_count": companions,
        "seat_count": requested_seats,
        "note": note,
        "selected_positions": list(selected_positions or []),
        "registered_via": via,
        "updated_at": now,
    }
    # Eingefroren wird nur eine verbindliche Anmeldung - die Warteliste bekommt ihren Preis beim
    # Nachrücken (Admin setzt „registered“), nicht jetzt.
    if status == "registered" and not price.get("free"):
        doc["price_snapshot"] = pricing.snapshot(price, recipient=me, source={"kind": "event", "id": event["id"], "slug": event.get("slug")},
                                                 invoice_timing=offer.get("invoice_timing") or "on_confirm")
        doc["billing_status"] = "pending"
    # Zugangslink mit Limit (#1036): die Nutzung atomar belegen, bevor die Anmeldung geschrieben wird.
    try:
        claimed = await claim_access_link_use(db, register_access, me)
    except AccessLinkUsedUp as exc:
        raise RegistrationError(409, exc.detail)
    try:
        if existing:
            await db.event_registrations.update_one({"id": existing["id"]}, {"$set": doc})
            doc = await db.event_registrations.find_one({"id": existing["id"]}, {"_id": 0})
        else:
            doc["id"] = new_id()
            doc["created_at"] = now
            await db.event_registrations.insert_one(doc)
            doc.pop("_id", None)
    except DuplicateKeyError:
        # Zwei gleichzeitige Anmeldungen derselben Person (Doppelklick, Website und Discord): der eindeutige Index
        # lässt nur eine durch. Die andere antwortet wie jede Wiederholung und holt einen fehlenden Auftrag nach
        # (#1491). Die Link-Nutzung bleibt: sie gilt je Person (``used_by``), und die Person ist angemeldet - gäbe
        # die unterlegene Anfrage ihre Zählung zurück, stünde die Anmeldung ohne Nutzung da.
        current = await existing_registration(db, event, me)
        if current:
            await repair_order(db, event, current)
        raise RegistrationError(409, "Du bist für dieses Event bereits angemeldet")
    except Exception:
        if claimed:
            await release_access_link_use(db, register_access, me)
        raise
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "event.registration.create",
        "target_id": event["id"],
        "actor_id": me["id"],
        "data": {"registration_id": doc["id"], "status": status, "companion_count": companions,
                 "total_cents": doc.get("price_snapshot", {}).get("total_cents"), "via": via},
        "created_at": now,
    })
    if doc.get("price_snapshot"):
        await billing_orders.create_order(db, kind="event", source_id=event["id"], registration_id=doc["id"], user_id=me["id"],
                                          snapshot=doc["price_snapshot"], timing=pricing.order_timing(doc["price_snapshot"], offer))
    return doc


async def repair_order(db, event: dict, registration: dict) -> dict | None:
    """Nachholen (#1491, wie ``tournament_fees.repair_order``): eine verbindliche, kostenpflichtige Anmeldung mit
    eingefrorenem Preis, aber ohne Rechnungsauftrag, bekommt ihn bei der Wiederholung.

    Anmeldung, Preis und Auftrag werden nacheinander gespeichert. Bricht der Auftrag danach ab, antwortet die
    Wiederholung sonst nur „bereits angemeldet“, und es entstünde nie eine Rechnung. Genau einmal: ein vorhandener
    Auftrag zum selben Preis (auch ein stornierter) bleibt, und gleichzeitige Wiederholungen fängt der eindeutige
    ``booking_key`` ab. Gibt den neuen Auftrag zurück, sonst ``None``.

    Grundlage ist der eingefrorene Preis, nicht die heutige Abrechnung des Events (Codex-Prüfung #1500): wurde die
    Abrechnung nach dem Abbruch abgeschaltet, gilt der vereinbarte Preis trotzdem."""
    snapshot = registration.get("price_snapshot")
    if registration.get("status") not in ACTIVE_STATUSES or not snapshot or int(snapshot.get("total_cents") or 0) <= 0:
        return None
    if registration.get("billing_status") not in (None, "pending"):
        return None
    key = billing_orders.booking_key("event", registration["id"], snapshot)
    known = {"booking_key": key} if key else {"kind": "event", "registration_id": registration["id"], "status": {"$nin": ["cancelled", "failed"]}}
    if await db.billing_orders.find_one(known, {"_id": 0, "id": 1}):
        return None
    offer = event.get("billing") or {}
    return await billing_orders.create_order(db, kind="event", source_id=event["id"], registration_id=registration["id"],
                                             user_id=registration["user_id"], snapshot=snapshot, timing=pricing.order_timing(snapshot, offer))


CANCELLABLE_STATUSES = {"registered", "waitlist"}
FINISHED_EVENT_STATUSES = {"completed", "archived", "cancelled", "results_published"}


def cancel_block_reason(event: dict, registration: dict | None, now=None) -> str | None:
    """Warum die eigene Anmeldung nicht mehr zurückgezogen werden kann - ``None``, solange es geht (#1223).

    Zurückziehen geht nur bis zum Beginn des Events und nicht nach dem Check-in: wer da war oder dabei ist, kann
    seine Anmeldung (samt Kostenbeitrag) nicht mehr selbst stornieren. Dieselbe Regel gilt für Website, App und
    Discord - die Seiten fragen ``can_cancel``, der Dienst prüft beim Stornieren selbst.
    """
    from services.public_phase import parse_dt

    status = (registration or {}).get("status")
    if status == "checked_in":
        return "Du bist schon eingecheckt – abmelden geht jetzt nicht mehr. Wende dich bitte an die Turnierleitung."
    if status not in CANCELLABLE_STATUSES:
        return "Du bist für dieses Event nicht angemeldet."
    if event.get("status") in FINISHED_EVENT_STATUSES:
        return "Das Event ist vorbei – abmelden geht nicht mehr."
    start = parse_dt(event.get("start_date"))
    if start and (parse_dt(now) if now else now_utc()) >= start:
        return "Das Event hat schon begonnen – abmelden geht jetzt nicht mehr. Wende dich bitte an die Turnierleitung."
    return None


def can_cancel(event: dict, registration: dict | None, now=None) -> bool:
    return cancel_block_reason(event, registration, now) is None


async def cancel(db, event: dict, me: dict, *, via: str = "web") -> dict:
    """Die eigene Anmeldung zurückziehen - nur bis zum Beginn und nicht nach dem Check-in; Aufträge dazu werden
    storniert, Audit mit dem Weg."""
    reg = await existing_registration(db, event, me)
    if not reg or reg.get("status") in {"cancelled", "no_show"}:
        raise RegistrationError(404, "Anmeldung nicht gefunden")
    blocked = cancel_block_reason(event, reg)
    if blocked:
        raise RegistrationError(409, blocked)
    now = now_utc().isoformat()
    await db.event_registrations.update_one(
        {"id": reg["id"]},
        {"$set": {"status": "cancelled", "updated_at": now, **({"billing_status": "cancelled"} if reg.get("price_snapshot") else {})}},
    )
    await billing_orders.cancel_orders_for(db, kind="event", registration_id=reg["id"], reason="Anmeldung storniert")
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "event.registration.cancel",
        "target_id": event["id"],
        "actor_id": me["id"],
        "data": {"registration_id": reg["id"], "via": via},
        "created_at": now,
    })
    return {"ok": True, "registration": reg}
