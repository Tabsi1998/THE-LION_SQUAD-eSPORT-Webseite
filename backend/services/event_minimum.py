"""Mindestanzahl an Anmeldungen bis zu einer Frist (#2614, handbuch/events.md „Mindestanzahl bis zu einer Frist“).

Ein Event findet nur statt, wenn bis zu einer Frist genug dabei sind - die Verwaltung entscheidet, nie der Server
(wie bei der Liga, Entscheidung Nr. 302).

- **Einstellung je Event** (``min_registrations``): Mindestzahl, Frist, ob Begleitpersonen mitzählen und ob die Event-Seite
  den Stand zeigt. Ohne Einstellung verhält sich ein Event wie bisher.
- **Gezählt** wird dieselbe Rechnung wie bei den Plätzen (``event_registration.summary``): angemeldet und eingecheckt, nicht
  die Warteliste; Begleitpersonen nur, wenn eingestellt. Wenn Begleitpersonen später Namen bekommen (#2615), bleibt
  ``companion_count`` die Zahl - an dieser Stelle ändert sich dann nichts.
- **Frist erreicht, zu wenige:** Job ``event_minimum_shortfall`` meldet es der Turnierleitung einmal je Event und Frist - erst die
  Benachrichtigung (``dedupe_key`` je Person), dann die Marke ``min_registrations_notice`` - mit dem Vorschlag, abzusagen. Keine Mail.
  Wird die Frist verschoben, gilt die neue Frist neu. Nach dem Beginn meldet der Job nichts mehr - darum liegt die Frist mindestens
  1 Stunde vor dem Beginn. Ist die Zahl erreicht, kommt kein Hinweis.
- **Absagen:** der vorhandene Weg (Status „Abgesagt“, ``event_changes.cancel_event``) - mit Grund in der Nachricht an alle.
  Hat das Event eine Mindestzahl, ist der Grund Pflicht; sonst ist er freiwillig.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from models import new_id, now_utc
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
NEEDS_SITE_REGISTRATION = ("Eine Mindestzahl braucht die Anmeldung über die Website – sonst gibt es nichts zu zählen. Bitte zuerst die "
                           "Mindestanzahl ausschalten (Kasten „Anmeldung“) und dann die Anmeldung.")
NEEDS_OWN_REGISTRATION = ("Mit externem Anmeldelink zählt die Website keine Anmeldungen – eine Mindestzahl geht nur mit der Anmeldung hier. "
                          "Bitte zuerst die Mindestanzahl ausschalten (Kasten „Anmeldung“) und dann den Link eintragen.")
# Mindestens so viel Zeit zwischen Frist und Beginn: Der Job läuft alle 15 Minuten und meldet nach dem Beginn nichts mehr.
DEADLINE_GAP = timedelta(hours=1)
DEADLINE_TOO_LATE = "Die Frist für die Mindestzahl muss mindestens 1 Stunde vor dem Beginn des Events liegen."
# Vorschlag ohne Zahlen, wenn die Event-Seite den Stand nicht zeigt - der Grund steht öffentlich auf der Seite.
PROPOSAL_HIDDEN = "Zu wenige Anmeldungen bis zur Frist."
WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")
MONTHS = ("Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember")
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
    # Begleitpersonen zählen nur, wo sie erlaubt sind - sonst heißt es „Anmeldungen“ statt „Personen“.
    companions = raw.get("count_companions") is not False and bool(event.get("allow_companions"))
    return {"count": count, "deadline": deadline.isoformat(), "count_companions": companions, "public": raw.get("public") is not False}


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
    if start is not None and parse_dt(minimum["deadline"]) > start - DEADLINE_GAP:
        raise MinimumError(400, DEADLINE_TOO_LATE)
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


VIENNA = ZoneInfo("Europe/Vienna")


def deadline_text(value, now=None) -> str:
    """„Fr 18. Dezember · 18:00“ in Wiener Zeit - dieselbe Schreibweise wie die Website (``formatWhen``, docs/date-cases.json), das Jahr
    nur, wenn es nicht das laufende ist. Ohne „heute“ und „morgen“: Ein Grund bleibt stehen und wird später gelesen. Ohne Zone gilt
    Wiener Uhr (wie in docs/date-cases.json)."""
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return ""
    local = (moment if moment.tzinfo else moment.replace(tzinfo=VIENNA)).astimezone(VIENNA)
    this_year = (now or now_utc()).astimezone(VIENNA).year
    year = f" {local.year}" if local.year != this_year else ""
    return f"{WEEKDAYS[local.weekday()]} {local.day}. {MONTHS[local.month - 1]}{year} · {local.strftime('%H:%M')}"


def proposal(minimum: dict, now=None) -> str:
    """Der vorgeschlagene Grund für die Absage - die Verwaltung kann ihn ändern. Zeigt die Event-Seite den Stand nicht, bleiben die Zahlen
    draußen: Der Grund steht nach der Absage öffentlich auf der Seite."""
    if minimum.get("public") is False:
        return PROPOSAL_HIDDEN
    return (f"Zu wenige Anmeldungen: Bis {deadline_text(minimum['deadline'], now)} waren {minimum['have']} von mindestens "
            f"{minimum['count']} {unit(minimum, minimum['count'])} dabei.")


async def _lead_ids(db) -> list[str]:
    from services.permissions import tournament_lead_filter

    rows = await db.users.find({**tournament_lead_filter(), "is_active": {"$ne": False}, "is_banned": {"$ne": True}},
                               {"_id": 0, "id": 1}).to_list(500)
    return sorted({row["id"] for row in rows if row.get("id")})


async def _tell_leads(db, event: dict, state: dict, now=None) -> tuple[int, bool]:
    """Jede Leitung einmal (``dedupe_key`` je Event, Frist und Person). Gibt zurück, wie viele neu benachrichtigt wurden und ob alle
    durchgingen - nur dann setzt der Job die Marke."""
    from services import user_notifications

    name = event.get("name") or "Event"
    text = (f"{name}: Bis {deadline_text(state['deadline'], now)} sind {state['have']} von mindestens {state['count']} "
            f"{unit(state, state['count'])} angemeldet. Das Event wird nicht von selbst abgesagt – du entscheidest. "
            "Vorschlag: absagen, mit Grund und Nachricht an alle Angemeldeten (Verwaltung → Event → Mindestanzahl).")
    told, complete = 0, True
    for user_id in await _lead_ids(db):
        key = f"{NOTICE_KEY}:{event['id']}:{state['deadline']}:{user_id}"
        try:
            if await user_notifications.create_user_notification(
                    user_id, "Zu wenige Anmeldungen", text, url=f"/admin/events/{event['id']}", kind=NOTICE_KIND,
                    meta={"category": "tournament_updates", "reason": NOTICE_REASON, "event_id": event["id"],
                          "dedupe_key": key, "unique_dedupe": True, "importance": "important"}):
                told += 1
        except Exception:  # noqa: BLE001 - die anderen Leitungen hören es trotzdem; der nächste Lauf holt diese nach
            complete = False
            logger.warning("[events] Hinweis Mindestzahl an %s nicht angelegt", log_safe(user_id), exc_info=True)
    return told, complete


async def shortfall_sweep(db, now=None) -> dict:
    """Job „event_minimum_shortfall“: Frist vorbei, zu wenige, Event noch nicht begonnen - die Turnierleitung hört es einmal je Event
    und Frist. Erst benachrichtigen (``dedupe_key`` hält es bei einmal je Person), dann die Marke setzen - wie
    ``league_season_cancel.shortfall_sweep``. Fällt dabei eine Leitung aus, bleibt die Marke offen und der nächste Lauf holt sie nach.
    Steht die Marke für diese Frist, liest der Job das Event nicht mehr. Nie automatisch abgesagt."""
    from services import event_registration

    moment = now or now_utc()
    told = checked = 0
    # Gleich in der Abfrage eingegrenzt: Frist vorbei (gespeichert als ISO in UTC) und Beginn noch nicht vorbei. Der Beginn kann eine
    # andere Zone tragen - darum grob mit einem Tag Spielraum, genau prüft es die Schleife.
    query = {f"{FIELD}.count": {"$gte": 1}, f"{FIELD}.deadline": {"$lte": moment.isoformat()},
             "status": {"$nin": sorted(SETTLED_STATUSES)},
             "$or": [{"start_date": {"$gt": (moment - timedelta(days=1)).isoformat()}}, {"start_date": None}]}
    events = await db.events.find(query, {"_id": 0}).to_list(1000)
    for event in events:
        try:
            minimum = settings(event)
            if minimum is None or moment < parse_dt(minimum["deadline"]):
                continue
            start = parse_dt(event.get("start_date"))
            if start is not None and moment >= start:
                continue
            if (event.get(NOTICE_FIELD) or {}).get("deadline") == minimum["deadline"]:
                continue  # schon gemeldet
            checked += 1
            state = view(event, await event_registration.summary(db, event), moment)
            if state["state"] != SHORT:
                continue
            sent, complete = await _tell_leads(db, event, state, moment)
            told += sent
            if not complete:
                continue
            # Die Marke für Anzeige und Protokoll - bedingt, damit zwei gleichzeitige Läufe nur ein Protokoll schreiben.
            marked = await db.events.update_one(
                {"id": event["id"], f"{NOTICE_FIELD}.deadline": {"$ne": minimum["deadline"]}},
                {"$set": {NOTICE_FIELD: {"deadline": minimum["deadline"], "count": state["count"], "have": state["have"],
                                         "at": moment.isoformat()}}})
            if marked.modified_count:
                await db.audit_logs.insert_one({
                    "id": new_id(), "action": "event.minimum_short", "actor_id": None, "target_id": event["id"],
                    "data": {"deadline": minimum["deadline"], "count": state["count"], "have": state["have"]},
                    "created_at": moment.isoformat(),
                })
        except Exception:  # noqa: BLE001 - ein Event hält die anderen nicht auf
            logger.warning("[events] Mindestzahl nicht geprüft: %s", log_safe(event.get("id")), exc_info=True)
    return {"checked": checked, "told": told}
