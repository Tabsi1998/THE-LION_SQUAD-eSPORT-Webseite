"""Abstimmung im Event (#2612): Die Verwaltung legt am Event Abstimmungen an, die Angemeldeten stimmen ab.

Kein zweites System: Antworten, Auszählung und Ergebnis haben die Form aus ``ballot_views`` - dieselbe wie bei den
Versammlungen (#327). Anders als dort zählt hier die Website selbst, weil eine Rodelbahn kein Vereinsbeschluss ist.

**Einstellbar je Abstimmung**

- ``closes_at``: die Frist (optional). Sie ist ausschließlich: genau zur Frist ist die Abstimmung zu. Maßgeblich ist der
  Zeitpunkt, zu dem der Server die Stimme annimmt. Ohne Frist bleibt sie offen, bis die Verwaltung sie beendet.
- ``max_choices``: 1 heißt eine Antwort, mehr heißt bis zu so viele.
- ``results_visibility``: ``live`` (Ergebnis sofort) oder ``after_close`` (erst nach der Frist bzw. dem Beenden).
- ``voters``: wer abstimmt - heute nur ``registered``. Für Begleitpersonen (#2615) kommt ein zweiter Wert dazu.

**Wer abstimmt**

Nur Angemeldete (``registered``, ``checked_in``). Wer abgesagt hat oder auf der Warteliste steht, stimmt nicht ab: Die
Abstimmung entscheidet über den Ablauf für die, die fix dabei sind, und eine Warteliste soll keine Stimmen sammeln
können. Rückt jemand nach, stimmt er ab dann mit. Sagt jemand ab, zählt seine Stimme nicht mehr - sie bleibt gespeichert
und zählt wieder, falls die Anmeldung zurückkommt.

**Wähler als Schlüssel**

Eine Stimme gehört einem Wähler ``voter_key`` aus Art und Kennung, heute ``user:<id>``. Das Konto, das handelt, steht
als ``user_id`` daneben (Rechte, Kontolöschung, Auskunft). Begleitpersonen (#2615) bekommen später die Art ``companion``
mit eigener Kennung, die die anmeldende Person mit abgibt - ohne Umbau, weil die Ansicht schon eine Liste von
Stimmrechten (``rights``) zeigt, wie bei den Versammlungen (eigenes Recht, Vollmacht).

**Geheim**

Wer wie gestimmt hat, steht nirgends offen. Die Person sieht ihre eigene Stimme, die Verwaltung nur Zahlen. Das
Protokoll hält Anlegen, Ändern, Beenden und Löschen fest - nie eine Stimme.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import ballot_views
from services.log_safe import log_safe

logger = logging.getLogger("tls.events.polls")

POLL_LIMIT = 10
OPTION_MIN, OPTION_MAX = 2, 12
QUESTION_MIN, QUESTION_MAX = 3, 200
LABEL_MAX = 80
RESULTS = ("live", "after_close")
VOTERS = ("registered",)
ELIGIBLE_STATUSES = ("registered", "checked_in")
CODE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
VOTER_USER = "user"

STATUS_LABELS = {"open": "offen", "closed": "beendet"}
OUTCOME_LABELS = {"winner": "Mehrheit", "tie": "Gleichstand", "none": "Noch keine Stimmen"}
REASON_TEXTS = {
    "login": "Abstimmen können nur Angemeldete – melde dich zuerst an.",
    "not_registered": "Abstimmen können nur Angemeldete dieses Events.",
    "waitlist": "Du stehst auf der Warteliste – abstimmen kannst du, sobald du nachrückst.",
    "cancelled": "Du hast dich abgemeldet – abstimmen können nur Angemeldete.",
}


class PollError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


# ---------------------------------------------------------------- Zeit

def _dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def is_closed(poll: dict, now: datetime) -> bool:
    """Zu, wenn die Verwaltung sie beendet hat oder die Frist erreicht ist - genau zur Frist ist sie schon zu."""
    if poll.get("closed_at"):
        return True
    closes = _dt(poll.get("closes_at"))
    return bool(closes and now >= closes)


def results_visible(poll: dict, now: datetime) -> bool:
    return poll.get("results_visibility") == "live" or is_closed(poll, now)


# ---------------------------------------------------------------- Prüfen

def _options(raw, existing: list[dict] | None = None) -> list[dict]:
    if not isinstance(raw, list) or len(raw) < OPTION_MIN:
        raise PollError(400, "Eine Abstimmung braucht mindestens zwei Antworten.")
    if len(raw) > OPTION_MAX:
        raise PollError(400, f"Höchstens {OPTION_MAX} Antworten je Abstimmung.")
    used = {option["code"] for option in existing or []}
    taken: set[str] = set()
    seen: set[str] = set()
    out = []
    for index, item in enumerate(raw):
        item = item if isinstance(item, dict) else {}
        label = " ".join(str(item.get("label") or "").split())
        if not label:
            raise PollError(400, f"Antwort {index + 1} ist leer.")
        if len(label) > LABEL_MAX:
            raise PollError(400, f"Antwort {index + 1}: höchstens {LABEL_MAX} Zeichen.")
        if label.casefold() in seen:
            raise PollError(400, f"Die Antwort „{label}“ steht doppelt da.")
        seen.add(label.casefold())
        code = str(item.get("code") or "").strip().lower()
        if code and not CODE.match(code):
            raise PollError(400, f"Antwort {index + 1}: Code nur aus Kleinbuchstaben, Ziffern und Bindestrich.")
        if code in taken:
            raise PollError(400, f"Antwort {index + 1}: Code steht doppelt da.")
        if code:
            taken.add(code)
        out.append({"code": code, "label": label})
    # Neue Antworten ohne Code bekommen den nächsten freien - nie einen, den es früher gab (alte Stimmen zeigen sonst auf
    # die neue Antwort).
    number = 1
    for option in out:
        if option["code"]:
            continue
        while f"o{number}" in taken or f"o{number}" in used:
            number += 1
        option["code"] = f"o{number}"
        taken.add(option["code"])
    return out


def _question(raw) -> str:
    question = " ".join(str(raw or "").split())
    if not QUESTION_MIN <= len(question) <= QUESTION_MAX:
        raise PollError(400, f"Die Frage braucht {QUESTION_MIN} bis {QUESTION_MAX} Zeichen.")
    return question


def _max_choices(raw, options: list[dict]) -> int:
    try:
        value = int(raw if raw is not None else 1)
    except (TypeError, ValueError):
        value = 0
    if not 1 <= value <= len(options):
        raise PollError(400, f"Wie viele Antworten jede Person wählen darf: 1 bis {len(options)}.")
    return value


def _results(raw) -> str:
    value = str(raw or "live")
    if value not in RESULTS:
        raise PollError(400, "Ergebnis: sofort sichtbar (live) oder erst nach der Frist (after_close).")
    return value


def _closes(raw, now: datetime, *, must_be_future: bool) -> str | None:
    if raw in (None, ""):
        return None
    moment = _dt(raw)
    if not moment:
        raise PollError(400, "Die Frist ist kein gültiger Zeitpunkt.")
    if must_be_future and moment <= now:
        raise PollError(400, "Die Frist liegt in der Vergangenheit.")
    return moment.astimezone(timezone.utc).isoformat()


# ---------------------------------------------------------------- Lesen

async def _active_user_ids(db, event_id: str) -> set[str]:
    return {uid for uid in await db.event_registrations.distinct(
        "user_id", {"event_id": event_id, "status": {"$in": list(ELIGIBLE_STATUSES)}}) if uid}


async def eligibility(db, event: dict, user: dict | None) -> tuple[bool, str | None]:
    """Darf die Person abstimmen? Sonst der Grund (``login``, ``not_registered``, ``waitlist``, ``cancelled``)."""
    if not user or not user.get("id"):
        return False, "login"
    registration = await db.event_registrations.find_one(
        {"event_id": event["id"], "user_id": user["id"]}, {"_id": 0, "status": 1})
    status = (registration or {}).get("status")
    if status in ELIGIBLE_STATUSES:
        return True, None
    if status == "waitlist":
        return False, "waitlist"
    if status in ("cancelled", "no_show"):
        return False, "cancelled"
    return False, "not_registered"


def voter_key(kind: str, ref: str) -> str:
    return f"{kind}:{ref}"


async def _counted(db, poll: dict, active: set[str]) -> list[dict]:
    """Die Stimmen, die zählen: die der Wähler, deren Konto gerade angemeldet ist."""
    rows = await db.event_poll_votes.find({"poll_id": poll["id"]}, {"_id": 0, "user_id": 1, "choices": 1}).to_list(5000)
    return [row for row in rows if row.get("user_id") in active]


def _result(poll: dict, counted: list[dict]) -> dict:
    options = ballot_views.options_view(poll.get("options"))
    tallied = ballot_views.tally([row.get("choices") or [] for row in counted], options)
    return ballot_views.result_view(
        counts=tallied["counts"], options=options, outcome=tallied["outcome"],
        outcome_label=OUTCOME_LABELS[tallied["outcome"]], valid=tallied["valid"], winner=tallied["winner"],
    )


def _base(poll: dict, now: datetime) -> dict:
    options = ballot_views.options_view(poll.get("options"))
    status = "closed" if is_closed(poll, now) else "open"
    max_choices = int(poll.get("max_choices") or 1)
    return {
        "id": poll["id"], "event_id": poll.get("event_id"), "question": poll.get("question") or "",
        "options": options, "max_choices": max_choices, "multiple": max_choices > 1,
        "closes_at": poll.get("closes_at"), "closed_at": poll.get("closed_at"),
        "results_visibility": poll.get("results_visibility") or "live", "voters": poll.get("voters") or "registered",
        "status": status, "status_label": STATUS_LABELS[status],
    }


async def poll_view(db, poll: dict, user: dict | None, *, now: datetime, eligible: tuple[bool, str | None],
                    active: set[str]) -> dict:
    """Eine Abstimmung, wie die Event-Seite und die App sie der Person zeigen."""
    view = _base(poll, now)
    ok, reason = eligible
    rights = []
    if ok:
        own = await db.event_poll_votes.find_one({"poll_id": poll["id"], "voter_key": voter_key(VOTER_USER, user["id"])},
                                                 {"_id": 0, "choices": 1})
        choices = list((own or {}).get("choices") or [])
        labels = ballot_views.labels_of(view["options"])
        rights.append({
            "right_id": voter_key(VOTER_USER, user["id"]), "for": "self", "name": "",
            "state": "used" if own else "open", "choices": choices,
            "option": choices[0] if choices else "", "option_label": labels.get(choices[0], "") if choices else "",
            "can_use": view["status"] == "open",
        })
    visible = results_visible(poll, now)
    view.update({
        "rights": rights, "can_vote": bool(rights) and view["status"] == "open",
        "reason": None if ok else reason, "reason_text": "" if ok else REASON_TEXTS.get(reason or "", ""),
        "result": _result(poll, await _counted(db, poll, active)) if visible else None,
        "result_hidden": not visible,
    })
    return view


async def admin_view(db, event: dict, poll: dict, *, now: datetime, active: set[str] | None = None) -> dict:
    """Für die Verwaltung: immer das Ergebnis als Zahlen, dazu wie viele abstimmen dürfen und abgestimmt haben.
    ``place_plan_poll``: die Antworten sind die Ort-Pläne (#2613) - das Ergebnis lässt sich als Ort übernehmen."""
    from services.event_place_plans import stored_plans

    if active is None:
        active = await _active_user_ids(db, event["id"])
    counted = await _counted(db, poll, active)
    view = _base(poll, now)
    plan_keys = {plan["key"] for plan in stored_plans(event)}
    codes = [option["code"] for option in view["options"]]
    view.update({"result": _result(poll, counted), "voters_count": len(counted), "eligible_count": len(active),
                 "place_plan_poll": bool(plan_keys and codes) and all(code in plan_keys for code in codes),
                 "created_at": poll.get("created_at"), "updated_at": poll.get("updated_at")})
    return view


async def _polls(db, event_id: str) -> list[dict]:
    return await db.event_polls.find({"event_id": event_id}, {"_id": 0}).sort([("created_at", 1)]).to_list(POLL_LIMIT * 2)


async def polls_for_event(db, event: dict, user: dict | None) -> list[dict]:
    now = now_utc()
    polls = await _polls(db, event["id"])
    if not polls:
        return []
    eligible = await eligibility(db, event, user)
    active = await _active_user_ids(db, event["id"])
    return [await poll_view(db, poll, user, now=now, eligible=eligible, active=active) for poll in polls]


async def admin_polls(db, event: dict) -> list[dict]:
    now = now_utc()
    active = await _active_user_ids(db, event["id"])
    return [await admin_view(db, event, poll, now=now, active=active) for poll in await _polls(db, event["id"])]


# ---------------------------------------------------------------- Verwaltung

async def _audit(db, action: str, me: dict, event: dict, data: dict) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": me["id"], "target_id": event["id"],
                                    "data": data, "created_at": now_utc().isoformat()})


async def _poll(db, event: dict, poll_id: str) -> dict:
    poll = await db.event_polls.find_one({"id": poll_id, "event_id": event["id"]}, {"_id": 0})
    if not poll:
        raise PollError(404, "Diese Abstimmung gibt es bei diesem Event nicht.")
    return poll


async def _notice(db, event: dict, poll: dict) -> dict | None:
    """Neue Abstimmung (#2612): wer abstimmen darf, erfährt es einmal - nicht die Warteliste."""
    from services.calendar_items import vienna
    from services.event_changes import inform_registrants

    if event.get("status") in ("draft", "archived", "cancelled"):
        return None
    message = f"Stimm ab: {poll['question']}"
    if poll.get("closes_at"):
        message += f" Abstimmen bis {vienna(poll['closes_at'])}."
    return await inform_registrants(db, event, title="Neue Abstimmung", message=message, dedupe=f"event-poll:{poll['id']}",
                                    statuses=ELIGIBLE_STATUSES)


async def create_poll(db, event: dict, raw: dict, me: dict, *, notify: bool = False) -> dict:
    now = now_utc()
    if await db.event_polls.count_documents({"event_id": event["id"]}) >= POLL_LIMIT:
        raise PollError(409, f"Höchstens {POLL_LIMIT} Abstimmungen je Event.")
    options = _options(raw.get("options"))
    poll = {
        "id": new_id(), "event_id": event["id"], "question": _question(raw.get("question")), "options": options,
        "max_choices": _max_choices(raw.get("max_choices"), options),
        "closes_at": _closes(raw.get("closes_at"), now, must_be_future=True),
        "results_visibility": _results(raw.get("results_visibility")), "voters": VOTERS[0],
        "closed_at": None, "created_by": me["id"], "created_at": now.isoformat(), "updated_at": now.isoformat(),
    }
    await db.event_polls.insert_one(dict(poll))
    await _audit(db, "event.poll.create", me, event,
                 {"poll_id": poll["id"], "question": poll["question"], "options": len(options)})
    view = await admin_view(db, event, poll, now=now)
    view["notice"] = await _notice(db, event, poll) if notify else None
    return view


async def update_poll(db, event: dict, poll_id: str, raw: dict, me: dict) -> dict:
    """Ändern: Frage, Antworten, Frist und Einstellungen. Eine Antwort mit Stimmen bleibt - nur ihre Beschriftung ändert sich."""
    now = now_utc()
    poll = await _poll(db, event, poll_id)
    updates: dict = {}
    if "question" in raw:
        updates["question"] = _question(raw.get("question"))
    options = poll.get("options") or []
    if "options" in raw:
        options = _options(raw.get("options"), existing=poll.get("options"))
        kept = {option["code"] for option in options}
        voted = set()
        async for row in db.event_poll_votes.find({"poll_id": poll["id"]}, {"_id": 0, "choices": 1}):
            voted.update(row.get("choices") or [])
        gone = [option["label"] for option in poll.get("options") or [] if option["code"] in voted and option["code"] not in kept]
        if gone:
            raise PollError(409, f"Für „{gone[0]}“ gibt es schon Stimmen – die Antwort bleibt; ändern lässt sich nur ihre Beschriftung.")
        updates["options"] = options
    if "max_choices" in raw or "options" in raw:
        updates["max_choices"] = _max_choices(raw.get("max_choices", poll.get("max_choices")), options)
    if "closes_at" in raw:
        updates["closes_at"] = _closes(raw.get("closes_at"), now, must_be_future=False)
    if "results_visibility" in raw:
        updates["results_visibility"] = _results(raw.get("results_visibility"))
    if updates:
        updates["updated_at"] = now.isoformat()
        await db.event_polls.update_one({"id": poll["id"]}, {"$set": updates})
        await _audit(db, "event.poll.update", me, event, {"poll_id": poll["id"], "fields": sorted(updates)})
    poll.update(updates)
    return await admin_view(db, event, poll, now=now)


async def close_poll(db, event: dict, poll_id: str, me: dict) -> dict:
    now = now_utc()
    poll = await _poll(db, event, poll_id)
    if not poll.get("closed_at"):
        await db.event_polls.update_one({"id": poll["id"], "closed_at": None},
                                        {"$set": {"closed_at": now.isoformat(), "updated_at": now.isoformat()}})
        await _audit(db, "event.poll.close", me, event, {"poll_id": poll["id"]})
        poll["closed_at"] = now.isoformat()
    return await admin_view(db, event, poll, now=now)


async def delete_poll(db, event: dict, poll_id: str, me: dict) -> dict:
    poll = await _poll(db, event, poll_id)
    removed = (await db.event_poll_votes.delete_many({"poll_id": poll["id"]})).deleted_count
    await db.event_polls.delete_one({"id": poll["id"]})
    await _audit(db, "event.poll.delete", me, event, {"poll_id": poll["id"], "question": poll.get("question"), "votes": removed})
    return {"ok": True, "votes": removed}


# ---------------------------------------------------------------- Abstimmen

def _choices(raw, poll: dict) -> list[str]:
    codes = [option["code"] for option in ballot_views.options_view(poll.get("options"))]
    chosen = [str(code) for code in raw] if isinstance(raw, list) else []
    if not chosen:
        raise PollError(400, "Bitte eine Antwort wählen.")
    if len(set(chosen)) != len(chosen):
        raise PollError(400, "Jede Antwort zählt nur einmal.")
    unknown = [code for code in chosen if code not in codes]
    if unknown:
        raise PollError(400, "Diese Antwort gibt es bei dieser Abstimmung nicht.")
    limit = int(poll.get("max_choices") or 1)
    if len(chosen) > limit:
        raise PollError(400, "Bitte nur eine Antwort wählen." if limit == 1 else f"Bitte höchstens {limit} Antworten wählen.")
    # In der Reihenfolge der Antworten - dieselbe Wahl ist immer dieselbe Liste.
    return [code for code in codes if code in chosen]


async def cast(db, event: dict, poll_id: str, user: dict, raw_choices) -> dict:
    """Eine Stimme abgeben oder ändern - je Wähler genau eine, bis zur Frist."""
    poll = await _poll(db, event, poll_id)
    if event.get("status") == "cancelled":
        raise PollError(409, "Das Event ist abgesagt – abgestimmt wird nicht mehr.")
    ok, reason = await eligibility(db, event, user)
    if not ok:
        raise PollError(403, REASON_TEXTS.get(reason or "", REASON_TEXTS["not_registered"]))
    choices = _choices(raw_choices, poll)
    now = now_utc()
    if is_closed(poll, now):
        raise PollError(409, "Die Frist ist vorbei – die Abstimmung ist zu." if poll.get("closes_at") and not poll.get("closed_at")
                        else "Die Abstimmung ist beendet.")
    key = voter_key(VOTER_USER, user["id"])
    stamp = now.isoformat()
    fields = {"choices": choices, "updated_at": stamp, "user_id": user["id"], "event_id": event["id"], "voter_kind": VOTER_USER}
    where = {"poll_id": poll["id"], "voter_key": key}
    try:
        # Eine Zeile je Wähler: zwei gleichzeitige Stimmen derselben Person treffen dieselbe Zeile, die spätere gilt.
        await db.event_poll_votes.update_one(where, {"$set": fields, "$setOnInsert": {"id": new_id(), "created_at": stamp}},
                                             upsert=True)
    except DuplicateKeyError:
        # Auf echtem MongoDB legen zwei gleichzeitige Upserts nicht beide an - der zweite trifft den eindeutigen Index.
        logger.info("Event %s: Stimme gleichzeitig abgegeben, zweite als Änderung", log_safe(event["id"]))
        await db.event_poll_votes.update_one(where, {"$set": fields})
    active = await _active_user_ids(db, event["id"])
    return await poll_view(db, poll, user, now=now, eligible=(True, None), active=active)


async def forget_event(db, event_id: str) -> None:
    """Mit dem Event gehen seine Abstimmungen samt Stimmen."""
    await db.event_poll_votes.delete_many({"event_id": event_id})
    await db.event_polls.delete_many({"event_id": event_id})
