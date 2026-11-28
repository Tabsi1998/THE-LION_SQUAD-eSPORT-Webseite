"""Mindestanzahl an Anmeldungen bis zu einer Frist (#2614, handbuch/events.md „Mindestanzahl bis zu einer Frist“).

Ein Event findet nur statt, wenn bis zu einer Frist genug dabei sind - die Verwaltung entscheidet, nie der Server
(wie bei der Liga, Entscheidung Nr. 302).

- **Einstellung je Event** (``min_registrations``): Mindestzahl, Frist, ob Begleitpersonen mitzählen und ob die Event-Seite
  den Stand zeigt. Ohne Einstellung verhält sich ein Event wie bisher.
- **Gezählt** wird dieselbe Rechnung wie bei den Plätzen (``event_registration.summary``): angemeldet und eingecheckt, nicht
  die Warteliste; Begleitpersonen nur, wenn eingestellt. Wenn Begleitpersonen später Namen bekommen (#2615), bleibt
  ``companion_count`` die Zahl - an dieser Stelle ändert sich dann nichts.
- **Frist erreicht, zu wenige:** Job ``event_minimum_shortfall`` meldet es der Turnierleitung einmal je Event und Frist
  (Marke ``min_registrations_notice`` mit bedingtem Schreiben, dazu ``dedupe_key`` je Person) - mit dem Vorschlag, abzusagen.
  Wird die Frist verschoben, gilt die neue Frist neu. Nach dem Beginn meldet der Job nichts mehr.
- **Absagen:** der vorhandene Weg (Status „Abgesagt“, ``event_changes.cancel_event``) - mit Grund in der Nachricht an alle.
  Hat das Event eine Mindestzahl, ist der Grund Pflicht.
"""
from __future__ import annotations

import logging

from models import new_id, now_utc
from services.checkin_rules import when_text
from services.log_safe import log_safe
from services.public_phase import parse_dt

logger = logging.getLogger("tls.events.minimum")

FIELD = "min_registrations"
NOTICE_FIELD = "min_registrations_notice"
REASON_MIN = 5
REASON_MAX = 500
NOTICE_KEY = "event-minimum-short"
NOTICE_KIND = "event_registration"
NOTICE_REASON = "event_minimum_short"
# Hier gibt es nichts mehr zu entscheiden: noch nicht veröffentlicht, schon vorbei oder schon abgesagt.
SETTLED_STATUSES = frozenset({"draft", "archived", "cancelled", "completed", "results_published"})

OPEN = "open"
REACHED = "reached"
SHORT = "short"

REASON_SHORT = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Er steht in der Nachricht an alle Angemeldeten."
NEEDS_SITE_REGISTRATION = "Eine Mindestzahl braucht die Anmeldung über die Website – sonst gibt es nichts zu zählen."
NEEDS_OWN_REGISTRATION = "Mit externem Anmeldelink zählt die Website keine Anmeldungen – eine Mindestzahl geht nur mit der Anmeldung hier."
DEADLINE_AFTER_START = "Die Frist für die Mindestzahl muss vor dem Beginn des Events liegen."
MORE_THAN_SEATS = "Die Mindestzahl ({count}) ist größer als die Plätze ({seats}) – so würde sie nie erreicht."


class MinimumError(Exception):
    """Ein Satz fürs Formular - mit dem HTTP-Status der Route."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def settings(event: dict | None) -> dict | None:
    """Die Einstellung des Events - ``None`` heißt: keine Mindestzahl, das Event findet in jedem Fall statt."""
    raw = (event or {}).get(FIELD)
    if not isinstance(raw, dict):
        return None
    try:
        count = int(raw.get("count") or 0)
    except (TypeError, ValueError):
        return None
    deadline = parse_dt(raw.get("deadline"))
    if count < 1 or deadline is None:
        return None
    return {"count": count, "deadline": deadline.isoformat(), "count_companions": raw.get("count_companions") is not False,
            "public": raw.get("public") is not False}


def normalize(raw: dict | None) -> dict | None:
    """Was gespeichert wird: die Frist als ISO-Zeitpunkt in UTC. Leer heißt: keine Mindestzahl."""
    if not raw:
        return None
    deadline = parse_dt(raw.get("deadline"))
    return {"count": int(raw["count"]), "deadline": deadline.isoformat() if deadline else None,
            "count_companions": raw.get("count_companions") is not False, "public": raw.get("public") is not False}


def validate(event: dict) -> None:
    """Passt die Mindestzahl zum Event (so, wie es nach dem Speichern aussieht)? Wirft ``MinimumError`` (400)."""
    minimum = settings(event)
    if minimum is None:
        return
    if not event.get("has_registration"):
        raise MinimumError(400, NEEDS_SITE_REGISTRATION)
    if event.get("registration_url"):
        raise MinimumError(400, NEEDS_OWN_REGISTRATION)
    start = parse_dt(event.get("start_date"))
    if start is not None and parse_dt(minimum["deadline"]) > start:
        raise MinimumError(400, DEADLINE_AFTER_START)
    seats = event.get("max_participants")
    if seats and minimum["count"] > int(seats):
        raise MinimumError(400, MORE_THAN_SEATS.format(count=minimum["count"], seats=int(seats)))


def clean_reason(raw, *, required: bool) -> str | None:
    """Der Grund der Absage: eine Zeile, höchstens 500 Zeichen. Pflicht (mindestens 5 Zeichen) bei einer Mindestzahl."""
    text = " ".join(str(raw or "").split())[:REASON_MAX]
    if required and len(text) < REASON_MIN:
        raise MinimumError(422, REASON_SHORT)
    return text or None


def counted(minimum: dict, summary: dict) -> tuple[int, int]:
    """Wie viele zählen - und wie viele davon Begleitpersonen sind."""
    registrations = int(summary.get("registered_count") or 0)
    companions = int(summary.get("companion_count") or 0) if minimum["count_companions"] else 0
    return registrations + companions, companions


def view(event: dict, summary: dict, now=None) -> dict | None:
    """Der Stand für Event-Seite und Verwaltung - ``None`` ohne Mindestzahl.

    ``state``: ``reached`` (genug dabei), ``open`` (noch nicht genug, Frist läuft) oder ``short`` (Frist vorbei, zu wenige)."""
    minimum = settings(event)
    if minimum is None:
        return None
    moment = now or now_utc()
    have, companions = counted(minimum, summary)
    missing = max(0, minimum["count"] - have)
    passed = moment >= parse_dt(minimum["deadline"])
    state = REACHED if not missing else SHORT if passed else OPEN
    return {**minimum, "have": have, "companions": companions, "missing": missing, "deadline_passed": passed, "state": state}


def unit(minimum: dict, count: int) -> str:
    if minimum.get("count_companions"):
        return "Person" if count == 1 else "Personen"
    return "Anmeldung" if count == 1 else "Anmeldungen"


def proposal(minimum: dict) -> str:
    """Der vorgeschlagene Grund für die Absage - die Verwaltung kann ihn ändern."""
    return (f"Zu wenige Anmeldungen: Bis {when_text(minimum['deadline'])} waren {minimum['have']} von mindestens "
            f"{minimum['count']} {unit(minimum, minimum['count'])} dabei.")


async def _lead_ids(db) -> list[str]:
    from services.permissions import tournament_lead_filter

    rows = await db.users.find({**tournament_lead_filter(), "is_active": True, "is_banned": {"$ne": True}},
                               {"_id": 0, "id": 1}).to_list(500)
    return sorted({row["id"] for row in rows if row.get("id")})


async def _tell_leads(db, event: dict, state: dict) -> int:
    from services.user_notifications import create_user_notification

    name = event.get("name") or "Event"
    text = (f"{name}: Bis {when_text(state['deadline'])} sind {state['have']} von mindestens {state['count']} "
            f"{unit(state, state['count'])} angemeldet. Das Event wird nicht von selbst abgesagt – du entscheidest. "
            "Vorschlag: absagen, mit Grund und Nachricht an alle Angemeldeten (Verwaltung → Event → Mindestanzahl).")
    told = 0
    for user_id in await _lead_ids(db):
        key = f"{NOTICE_KEY}:{event['id']}:{state['deadline']}:{user_id}"
        if await create_user_notification(user_id, "Zu wenige Anmeldungen", text, url=f"/admin/events/{event['id']}", kind=NOTICE_KIND,
                                          meta={"category": "tournament_updates", "reason": NOTICE_REASON, "event_id": event["id"],
                                                "dedupe_key": key, "unique_dedupe": True, "importance": "important"}):
            told += 1
    return told


async def shortfall_sweep(db, now=None) -> dict:
    """Job „event_minimum_shortfall“: Frist vorbei, zu wenige, Event noch nicht begonnen - die Turnierleitung hört es einmal je Event
    und Frist. Ein zweiter Lauf (auch gleichzeitig) findet die Marke schon gesetzt und schickt nichts. Nie automatisch abgesagt."""
    from services import event_registration

    moment = now or now_utc()
    told = checked = 0
    events = await db.events.find({f"{FIELD}.count": {"$gte": 1}, "status": {"$nin": sorted(SETTLED_STATUSES)}},
                                  {"_id": 0}).to_list(1000)
    for event in events:
        try:
            minimum = settings(event)
            if minimum is None or moment < parse_dt(minimum["deadline"]):
                continue
            start = parse_dt(event.get("start_date"))
            if start is not None and moment >= start:
                continue
            checked += 1
            state = view(event, await event_registration.summary(db, event), moment)
            if state["state"] != SHORT:
                continue
            # Je Frist genau ein Lauf, der meldet: nur, wer die Marke für diese Frist setzt.
            claimed = await db.events.update_one(
                {"id": event["id"], f"{NOTICE_FIELD}.deadline": {"$ne": minimum["deadline"]}},
                {"$set": {NOTICE_FIELD: {"deadline": minimum["deadline"], "count": state["count"], "have": state["have"],
                                         "at": moment.isoformat()}}})
            if not claimed.modified_count:
                continue
            sent = await _tell_leads(db, event, state)
            told += sent
            await db.audit_logs.insert_one({
                "id": new_id(), "action": "event.minimum_short", "actor_id": None, "target_id": event["id"],
                "data": {"deadline": minimum["deadline"], "count": state["count"], "have": state["have"], "told": sent},
                "created_at": moment.isoformat(),
            })
        except Exception:  # noqa: BLE001 - ein Event hält die anderen nicht auf
            logger.warning("[events] Mindestzahl nicht geprüft: %s", log_safe(event.get("id")), exc_info=True)
    return {"checked": checked, "told": told}
