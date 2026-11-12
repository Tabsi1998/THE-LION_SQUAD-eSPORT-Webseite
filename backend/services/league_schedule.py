"""Termine in der Liga (docs/LIGA.md, Abschnitt „D.1 Termine“, #2194; Regelwerk § 7, Nr. 17, 18, 28).

- ``schedule_rules`` an Season und Staffel: 72-h-Regel, Verschiebung, Erinnerung und „überfällig“. Ohne das Feld verhält sich
  eine Staffel wie vorher - kein Teil hier greift dann.
- **Fester Termin:** ``scheduled_at`` mit ``schedule_source`` ``accepted`` oder ``manual``. Davor gilt die Ersteinigung über
  Terminvorschläge, danach nur noch die Verschiebung (beide Seiten) oder die Leitung.
- **Verschiebung:** ein Antrag je Spiel zur Zeit (``matches_v2.reschedule_requests``), mit Grund, Vorlauf, Höchstzahl und auf
  Wunsch nur in der Spielwoche. Alles darüber entscheidet die Leitung.
- **Historie** (``matches_v2.schedule_history``): jede Änderung des Termins mit Art, wer, wann, Grund.

Geschrieben wird immer mit Bedingung auf den gelesenen Stand; die Routen halten dazu die Schreibsperre des Turniers.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from models import new_id, now_utc
from services import checkin_rules
from services.league_scope import is_league_staffel
from services.matchday_schedule import (
    LOCAL_TZ,
    MatchdayScheduleError,
    blocked_period_at,
    home_registration_id,
    matchday_number_of,
    response_deadline,
    tournament_matchday_window,
)

logger = logging.getLogger("tls.league_schedule")

DEFAULTS: dict = {
    "home_rule": True,
    "home_rule_hours": 72,
    "reschedule_notice_hours": 24,
    "reschedule_max": 2,
    "reschedule_same_week": True,
    "result_reminder_hours": 24,
    "result_overdue_hours": 48,
}
# Ganze Zahlen: (kleinster, größter Wert, Name in der Meldung).
NUMBERS: dict[str, tuple[int, int, str]] = {
    "home_rule_hours": (1, 336, "Frist der 72-h-Regel"),
    "reschedule_notice_hours": (0, 336, "Vorlauf für eine Verschiebung"),
    "reschedule_max": (0, 10, "Verschiebungen je Spiel"),
    "result_reminder_hours": (1, 336, "Erinnerung ohne Ergebnis"),
    "result_overdue_hours": (1, 720, "Überfällig nach"),
}
FLAGS = ("home_rule", "reschedule_same_week")
FIXED_SOURCES = frozenset({"accepted", "manual"})
HISTORY_KINDS = ("agreement", "home_rule", "default", "reschedule", "lead")
HISTORY_LIMIT = 50
REQUEST_LIMIT = 30
REASON_MIN = 5
REASON_MAX = 500
LEAD_MINUTES = 5
# Spiele, an deren Termin nichts mehr zu verschieben ist.
CLOSED_MATCH_STATUSES = frozenset({"running", "in_progress", "waiting_result", "completed", "archived", "forfeit", "bye",
                                   "no_show", "cancelled", "disputed"})

LEAD_HINT = "Das entscheidet die Liga-Leitung – bitte im Matchchat @leitung schreiben."
FIXED_DETAIL = "Der Termin steht fest – für einen anderen Termin bitte eine Verschiebung beantragen."
NO_RULES_DETAIL = "Hier gibt es keine Verschiebung – Termine laufen über Terminvorschläge."
NOT_A_SIDE_DETAIL = ("Eine Verschiebung beantragen Captain oder Vertreter einer Seite. Die Liga-Leitung legt den Termin direkt "
                     "fest.")
CHANGED_DETAIL = "Gerade hat sich am Termin etwas geändert – bitte die Seite neu laden."
WEEKDAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


class ScheduleProblem(Exception):
    """Eine Aktion geht nicht - mit deutscher Meldung und HTTP-Status (Vorgabe 409)."""

    def __init__(self, detail: str, status_code: int = 409):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


# ---------------------------------------------------------------- Regeln

def normalize(raw) -> dict:
    """Die Regeln aus einer Eingabe der Verwaltung - fehlende Felder mit Vorgabe, Falsches mit deutscher Meldung (422)."""
    if not isinstance(raw, dict):
        raise ScheduleProblem("Die Terminregeln fehlen.", 422)
    if set(raw) - set(DEFAULTS):
        raise ScheduleProblem("Die Terminregeln enthalten ein unbekanntes Feld.", 422)
    out = dict(DEFAULTS)
    for key in FLAGS:
        value = raw.get(key)
        if value is None:
            continue
        if not isinstance(value, bool):
            raise ScheduleProblem("Ein Schalter der Terminregeln ist weder an noch aus.", 422)
        out[key] = value
    for key, (low, high, label) in NUMBERS.items():
        value = raw.get(key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int):
            raise ScheduleProblem(f"{label}: bitte eine ganze Zahl.", 422)
        if not low <= value <= high:
            raise ScheduleProblem(f"{label}: erlaubt sind {low} bis {high}.", 422)
        out[key] = value
    if out["result_overdue_hours"] < out["result_reminder_hours"]:
        raise ScheduleProblem("„Überfällig nach“ darf nicht vor der Erinnerung liegen.", 422)
    return out


def rules_of(tournament: dict | None) -> dict | None:
    """Die geltenden Regeln einer Staffel - ``None`` für Staffeln ohne ``schedule_rules`` und alle anderen Turniere."""
    if not is_league_staffel(tournament):
        return None
    raw = tournament.get("schedule_rules")
    if not isinstance(raw, dict):
        return None
    try:
        return normalize({key: value for key, value in raw.items() if key in DEFAULTS})
    except ScheduleProblem:
        # Ein von Hand verbogener Wert sperrt die Staffel nicht - es gelten die Vorgaben.
        logger.warning("[league_schedule] Terminregeln von %s ungültig, Vorgaben gelten", tournament.get("id"))
        return dict(DEFAULTS)


def _moment(value) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _iso(value) -> str | None:
    moment = _moment(value)
    return moment.astimezone(timezone.utc).isoformat() if moment else None


def when_text(value) -> str:
    """„Sa 14.11. 20:00“ in Wiener Zeit - für Meldungen und Nachrichten."""
    moment = _moment(value)
    if not moment:
        return "ohne Termin"
    local = moment.astimezone(LOCAL_TZ)
    return f"{WEEKDAYS[local.weekday()]} {local.strftime('%d.%m. %H:%M')}"


def is_fixed(match: dict | None) -> bool:
    """Steht der Termin fest? Einigung, 72-h-Regel, Verschiebung oder Leitung - der Standardtermin nicht."""
    return bool((match or {}).get("scheduled_at")) and (match or {}).get("schedule_source") in FIXED_SOURCES


def blocks_proposals(tournament: dict | None, match: dict | None) -> bool:
    """Staffel mit Regeln und festem Termin: keine neuen Vorschläge, kein Gegenvorschlag, keine Annahme mehr."""
    return bool(rules_of(tournament)) and is_fixed(match)


def window_of(tournament: dict | None, match: dict | None):
    """Die Spielwoche des Spiels (mit Sperrwochen) - ``None`` ohne Startdatum oder Spieltag."""
    number = matchday_number_of(match or {})
    if not number or not (tournament or {}).get("start_date"):
        return None
    try:
        return tournament_matchday_window(tournament, number)
    except MatchdayScheduleError:
        return None


def _requests(match: dict | None) -> list[dict]:
    return [dict(row) for row in (match or {}).get("reschedule_requests") or [] if isinstance(row, dict)]


def pending_request(match: dict | None) -> dict | None:
    return next((row for row in _requests(match) if row.get("status") == "pending"), None)


async def matches_with_open_requests(db, sides: dict, closed_statuses: list[str], limit: int = 100) -> list[dict]:
    """Spiele der eigenen Seiten mit offenem Verschiebungsantrag - für die Aufgabe „Verschiebung beantworten“."""
    return await db.matches_v2.find(
        {**sides, "reschedule_requests.status": "pending", "status": {"$nin": list(closed_statuses)}}, {"_id": 0}).to_list(limit)


def request_until(match: dict | None, rules: dict) -> datetime | None:
    current = _moment((match or {}).get("scheduled_at"))
    return current - timedelta(hours=int(rules["reschedule_notice_hours"])) if current else None


def remaining(match: dict | None, rules: dict) -> int:
    return max(0, int(rules["reschedule_max"]) - int((match or {}).get("reschedule_count") or 0))


def request_refusal(match: dict, rules: dict, now: datetime) -> str | None:
    """Warum gerade keine Verschiebung beantragt werden kann - ``None``: es geht."""
    if str(match.get("status") or "") in CLOSED_MATCH_STATUSES or match.get("started_at"):
        return "Das Spiel läuft schon oder ist entschieden – verschieben geht nicht mehr."
    if not is_fixed(match):
        return "Es steht noch kein fester Termin – bitte zuerst über einen Terminvorschlag einigen."
    if pending_request(match):
        return "Es ist schon eine Verschiebung offen – erst muss darüber entschieden werden."
    if int(rules["reschedule_max"]) == 0:
        return f"In dieser Season verschieben die Teams nicht selbst. {LEAD_HINT}"
    if remaining(match, rules) <= 0:
        times = int(rules["reschedule_max"])
        return f"Dieses Spiel wurde schon {'einmal' if times == 1 else f'{times}-mal'} verschoben. {LEAD_HINT}"
    until = request_until(match, rules)
    if until and now > until:
        return (f"Verschieben geht nur bis {int(rules['reschedule_notice_hours'])} Stunden vor dem Termin "
                f"(bis {when_text(until)}). {LEAD_HINT}")
    return None


def target_refusal(tournament: dict, match: dict, rules: dict, new_at: datetime) -> str | None:
    """Was gegen den neuen Termin spricht - ``None``: passt."""
    if _moment(match.get("scheduled_at")) == new_at:
        return "Das ist schon der geltende Termin."
    blocked = blocked_period_at(tournament, new_at)
    if blocked:
        return f"In dieser Zeit wird nicht gespielt ({blocked.get('label') or 'Sperrzeit'}) – bitte einen anderen Termin wählen."
    if rules["reschedule_same_week"]:
        window = window_of(tournament, match)
        if window and not window.contains(new_at):
            last = window.end - timedelta(minutes=1)
            return (f"Der neue Termin muss in der Spielwoche liegen ({when_text(window.start)} bis {when_text(last)}). "
                    f"{LEAD_HINT}")
    return None


def _too_soon(moment: datetime, now: datetime) -> bool:
    return moment < now + timedelta(minutes=LEAD_MINUTES)


# ---------------------------------------------------------------- Historie

def history_entry(kind: str, *, by: str | None = None, registration_id: str | None = None, from_at=None, to_at=None,
                  reason: str | None = None, request_id: str | None = None, at: datetime | None = None, **extra) -> dict:
    entry = {"id": new_id(), "at": (at or now_utc()).isoformat(), "kind": kind, "by": by, "registration_id": registration_id,
             "from": _iso(from_at), "to": _iso(to_at), "reason": reason or None, "request_id": request_id}
    entry.update({key: value for key, value in extra.items() if value is not None})
    return entry


def history_push(entry: dict) -> dict:
    return {"schedule_history": {"$each": [entry], "$slice": -HISTORY_LIMIT}}


async def record_history(db, match_id: str, tournament: dict | None, entry: dict) -> None:
    """Ein Eintrag in die Historie - nur in Staffeln mit Terminregeln, eine fehlende Zeile hält nichts auf."""
    if not rules_of(tournament):
        return
    try:
        await db.matches_v2.update_one({"id": match_id}, {"$push": history_push(entry)})
    except Exception:  # noqa: BLE001 - der Termin ist schon geschrieben
        logger.warning("[league_schedule] Historie von %s nicht geschrieben", match_id, exc_info=True)


async def after_agreement(db, match: dict, tournament: dict | None, proposal: dict, user: dict | None,
                          registration_id: str | None) -> None:
    """Ein Vorschlag wurde angenommen (Einigung): Historie, und mit Regeln schließen die übrigen offenen Vorschläge - der
    Termin steht jetzt fest. Nur in Staffeln mit Terminregeln - Altbestand bekommt keine D.1-Felder."""
    if not rules_of(tournament):
        return
    await record_history(db, match["id"], tournament, history_entry(
        "agreement", by=(user or {}).get("id"), registration_id=registration_id, from_at=match.get("scheduled_at"),
        to_at=proposal.get("scheduled_at"), reason=proposal.get("note"), request_id=proposal.get("id")))
    await db.match_schedule_proposals.update_many(
        {"match_id": match["id"], "status": "pending", "id": {"$ne": proposal.get("id")}},
        {"$set": {"status": "declined", "decision_rule": "agreed_elsewhere", "updated_at": now_utc().isoformat()}})


async def lead_changed(db, before: dict, after: dict, user: dict | None, reason: str | None) -> None:
    """Die Leitung hat den Termin gesetzt oder aufgehoben: Historie mit Grund, offene Anträge sind erledigt, „überfällig“
    und die Erinnerung fallen weg (die Leitung hat entschieden)."""
    if _moment(before.get("scheduled_at")) == _moment(after.get("scheduled_at")):
        return
    tournament = await db.tournaments.find_one({"id": after.get("tournament_id")},
                                               {"_id": 0, "id": 1, "league_context": 1, "schedule_rules": 1})
    if not rules_of(tournament):
        return
    now = now_utc()
    requests = _requests(after)
    changed = False
    for row in requests:
        if row.get("status") == "pending":
            row.update({"status": "superseded", "decided_at": now.isoformat(), "decided_by": (user or {}).get("id")})
            changed = True
    update: dict = {
        "$push": history_push(history_entry("lead", by=(user or {}).get("id"), from_at=before.get("scheduled_at"),
                                            to_at=after.get("scheduled_at"), reason=reason, at=now)),
        "$unset": {"result_reminded_at": "", "result_overdue_at": ""},
    }
    condition = {"id": after["id"]}
    if changed:
        update["$set"] = {"reschedule_requests": requests}
        condition["reschedule_requests"] = after.get("reschedule_requests")
    result = await db.matches_v2.update_one(condition, update)
    if changed and not result.matched_count:
        # Ein Antrag kam gerade dazu: Historie trotzdem, der Antrag scheitert beim Annehmen am geänderten Termin.
        await db.matches_v2.update_one({"id": after["id"]}, {"$push": update["$push"], "$unset": update["$unset"]})


# ---------------------------------------------------------------- Verschiebung

def _clean_reason(reason: str | None) -> str:
    text = " ".join(str(reason or "").split())
    if len(text) < REASON_MIN:
        raise ScheduleProblem("Bitte einen Grund angeben (mindestens fünf Zeichen).", 422)
    if len(text) > REASON_MAX:
        raise ScheduleProblem("Der Grund ist zu lang (höchstens 500 Zeichen).", 422)
    return text


async def _audit(db, action: str, match: dict, actor_id: str | None, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id"), "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"), **data},
        "created_at": now_utc().isoformat(),
    })


REQUEST_EVENTS = {
    "requested": ("Verschiebung beantragt", "{who} möchte den Termin von {old} auf {new} verschieben. Grund: „{reason}“. "
                                           "Bitte zustimmen oder ablehnen."),
    "accepted": ("Verschiebung angenommen", "{who} hat zugestimmt – das Spiel ist jetzt am {new}."),
    "declined": ("Verschiebung abgelehnt", "{who} hat die Verschiebung auf {new} abgelehnt – es bleibt bei {old}."),
    "withdrawn": ("Verschiebung zurückgezogen", "{who} hat den Antrag auf {new} zurückgezogen – es bleibt bei {old}."),
}


async def _tell(db, match: dict, event: str, request: dict, actor: dict | None, actor_registration_id: str | None,
                *, both: bool = False) -> int:
    """Die andere Seite (bei ``both`` beide) erfährt jeden Schritt sofort - eine Nachricht hält die Aktion nie auf."""
    from services.match_audience import registrations_for_match, responsible_user_ids
    from services.match_notifications import match_title
    from services.user_notifications import create_user_notification

    try:
        registrations = await registrations_for_match(db, match)
        regs_by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
        targets = registrations if both else [reg for reg in registrations if reg.get("id") != actor_registration_id]
        recipients = await responsible_user_ids(db, targets) - {(actor or {}).get("id")}
        tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
        who_reg = regs_by_id.get(actor_registration_id or "") or {}
        who = who_reg.get("display_name") or who_reg.get("team_name") or "Die Gegenseite"
        title, sentence = REQUEST_EVENTS[event]
        text = sentence.format(who=who, old=when_text(request.get("from_at")), new=when_text(request.get("to_at")),
                               reason=" ".join(str(request.get("reason") or "").split())[:120])
        body = f"{tournament.get('title') or 'Liga'} · {match_title(match, regs_by_id)}: {text}"
        sent = 0
        for user_id in sorted(recipients):
            if await create_user_notification(
                user_id, title, body, url=f"/matches/{match.get('id')}", kind="match_schedule",
                meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                      "reason": f"reschedule_{event}", "dedupe_key": f"match-reschedule:{request.get('id')}:{event}"},
            ):
                sent += 1
        return sent
    except Exception:  # noqa: BLE001 - der Schritt ist schon gespeichert
        logger.warning("[league_schedule] Nachricht zur Verschiebung von %s nicht verschickt", match.get("id"), exc_info=True)
        return 0


async def request_reschedule(db, match: dict, tournament: dict | None, acting_reg: dict | None, user: dict,
                             scheduled_at: datetime, reason: str | None, *, now: datetime | None = None) -> dict:
    """Eine Seite beantragt eine Verschiebung (Nr. 18)."""
    rules = rules_of(tournament)
    if not rules:
        raise ScheduleProblem(NO_RULES_DETAIL)
    if not acting_reg:
        raise ScheduleProblem(NOT_A_SIDE_DETAIL, 403)
    text = _clean_reason(reason)
    now = now or now_utc()
    new_at = _moment(scheduled_at)
    if new_at is None:
        raise ScheduleProblem("Bitte Tag und Uhrzeit für den neuen Termin wählen.", 422)
    new_at = new_at.astimezone(timezone.utc)
    open_request = pending_request(match)
    if (open_request and open_request.get("requested_by") == user.get("id") and _moment(open_request.get("to_at")) == new_at
            and open_request.get("reason") == text):
        return {**open_request, "idempotent_replay": True}
    refusal = request_refusal(match, rules, now)
    if refusal:
        raise ScheduleProblem(refusal)
    if _too_soon(new_at, now):
        raise ScheduleProblem(f"Der neue Termin liegt in der Vergangenheit – bitte frühestens {LEAD_MINUTES} Minuten ab jetzt.", 422)
    problem = target_refusal(tournament, match, rules, new_at)
    if problem:
        raise ScheduleProblem(problem)
    entry = {
        "id": new_id(), "status": "pending", "from_at": _iso(match.get("scheduled_at")), "to_at": new_at.isoformat(),
        "reason": text, "requested_by": user.get("id"), "requested_registration_id": acting_reg.get("id"),
        "requested_at": now.isoformat(),
        "approvals": [{"registration_id": acting_reg.get("id"), "user_id": user.get("id"), "at": now.isoformat()}],
    }
    requests = _requests(match)[-(REQUEST_LIMIT - 1):]
    written = await db.matches_v2.update_one(
        {"id": match["id"], "scheduled_at": match.get("scheduled_at"), "status": match.get("status"),
         "reschedule_requests": match.get("reschedule_requests")},
        {"$set": {"reschedule_requests": [*requests, entry], "updated_at": now.isoformat()}})
    if not written.matched_count:
        raise ScheduleProblem(CHANGED_DETAIL)
    await _audit(db, "match.reschedule.request", match, user.get("id"),
                 {"request_id": entry["id"], "from": entry["from_at"], "to": entry["to_at"], "reason": text})
    await _tell(db, match, "requested", entry, user, acting_reg.get("id"))
    return {**entry, "idempotent_replay": False}


async def _close_request(db, match: dict, request_id: str, status: str, now: datetime) -> None:
    """Einen Antrag still beenden (abgelaufen, durch einen anderen Termin erledigt) - nur, wenn nichts dazwischenkam."""
    requests = _requests(match)
    for row in requests:
        if row.get("id") == request_id and row.get("status") == "pending":
            row.update({"status": status, "decided_at": now.isoformat()})
    await db.matches_v2.update_one({"id": match["id"], "reschedule_requests": match.get("reschedule_requests")},
                                   {"$set": {"reschedule_requests": requests}})


DECISION_STATUS = {"accept": "accepted", "decline": "declined", "withdraw": "withdrawn"}


async def decide_reschedule(db, match: dict, tournament: dict | None, acting_reg: dict | None, user: dict, request_id: str,
                            action: str, note: str | None = None, *, now: datetime | None = None) -> dict:
    """Zustimmen, ablehnen (andere Seite) oder zurückziehen (beantragende Seite)."""
    rules = rules_of(tournament)
    if not rules:
        raise ScheduleProblem(NO_RULES_DETAIL)
    if action not in DECISION_STATUS:
        raise ScheduleProblem("Unbekannte Entscheidung.", 422)
    request = next((row for row in _requests(match) if row.get("id") == request_id), None)
    if not request:
        raise ScheduleProblem("Diese Verschiebung gibt es nicht.", 404)
    if not acting_reg:
        raise ScheduleProblem("Über eine Verschiebung entscheiden Captain oder Vertreter der Seiten.", 403)
    own = request.get("requested_registration_id") == acting_reg.get("id")
    if action == "withdraw" and not own:
        raise ScheduleProblem("Zurückziehen kann nur die Seite, die beantragt hat.", 403)
    if action != "withdraw" and own:
        raise ScheduleProblem("Zustimmen oder ablehnen kann nur die andere Seite.", 403)
    status = DECISION_STATUS[action]
    note_text = " ".join(str(note or "").split())[:REASON_MAX] or None
    if request.get("status") == status and request.get("decided_by") == user.get("id"):
        return {**request, "idempotent_replay": True}
    if request.get("status") != "pending":
        raise ScheduleProblem("Über diese Verschiebung wurde schon entschieden.")
    now = now or now_utc()
    current = _moment(match.get("scheduled_at"))
    if current != _moment(request.get("from_at")):
        await _close_request(db, match, request_id, "superseded", now)
        raise ScheduleProblem("Der Termin hat sich inzwischen geändert – dieser Antrag ist damit erledigt.")
    new_at = _moment(request.get("to_at"))
    if action == "accept":
        if current and now >= current:
            await _close_request(db, match, request_id, "expired", now)
            raise ScheduleProblem(f"Der alte Termin ist schon erreicht – die Verschiebung ist abgelaufen. {LEAD_HINT}")
        if str(match.get("status") or "") in CLOSED_MATCH_STATUSES or match.get("started_at"):
            raise ScheduleProblem("Das Spiel läuft schon oder ist entschieden – verschieben geht nicht mehr.")
        if remaining(match, rules) <= 0:
            raise ScheduleProblem(f"Die Verschiebungen für dieses Spiel sind aufgebraucht. {LEAD_HINT}")
        if not new_at or _too_soon(new_at, now):
            raise ScheduleProblem("Der neue Termin ist schon zu nah oder vorbei – bitte eine neue Verschiebung beantragen.")
        blocked = blocked_period_at(tournament, new_at)
        if blocked:
            raise ScheduleProblem(f"In dieser Zeit wird nicht gespielt ({blocked.get('label') or 'Sperrzeit'}).")
    requests = _requests(match)
    updated = None
    for row in requests:
        if row.get("id") == request_id:
            row.update({"status": status, "decided_by": user.get("id"), "decided_registration_id": acting_reg.get("id"),
                        "decided_at": now.isoformat(), "decision_note": note_text})
            if action == "accept":
                row["approvals"] = [*(row.get("approvals") or []),
                                    {"registration_id": acting_reg.get("id"), "user_id": user.get("id"), "at": now.isoformat()}]
            updated = row
    condition = {"id": match["id"], "scheduled_at": match.get("scheduled_at"),
                 "reschedule_requests": match.get("reschedule_requests")}
    change: dict = {"$set": {"reschedule_requests": requests, "updated_at": now.isoformat()}}
    if action == "accept":
        condition["reschedule_count"] = match.get("reschedule_count")
        change["$set"].update({
            "scheduled_at": new_at.isoformat(), "schedule_source": "accepted", "schedule_status": "accepted",
            "schedule_written_at": now.isoformat(), "reschedule_count": int(match.get("reschedule_count") or 0) + 1,
        })
        # Mit dem neuen Termin fällt auch eine Verlängerung des alten Check-in-Fensters (D.2, #1652), die Termin-Revision steigt (D.3).
        change["$unset"] = {"schedule_deadline_at": "", "schedule_escalated_at": "", "result_reminded_at": "", "result_overdue_at": ""}
        change = checkin_rules.new_time_change(tournament, change)
        change["$push"] = history_push(history_entry(
            "reschedule", by=user.get("id"), registration_id=acting_reg.get("id"), from_at=request.get("from_at"),
            to_at=new_at, reason=request.get("reason"), request_id=request_id, at=now,
            requested_by=request.get("requested_by"), requested_registration_id=request.get("requested_registration_id")))
    written = await db.matches_v2.update_one(condition, change)
    if not written.matched_count:
        raise ScheduleProblem(CHANGED_DETAIL)
    await _audit(db, f"match.reschedule.{action}", match, user.get("id"),
                 {"request_id": request_id, "from": request.get("from_at"), "to": request.get("to_at"),
                  "reason": request.get("reason"), **({"note": note_text} if note_text else {})})
    await _tell(db, match, status, updated, user, acting_reg.get("id"))
    return {**updated, "idempotent_replay": False}


# ---------------------------------------------------------------- Matchseite

async def _names(db, user_ids) -> dict[str, str]:
    wanted = sorted({value for value in user_ids if value})
    if not wanted:
        return {}
    rows = await db.users.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}) \
        .to_list(len(wanted) + 1)
    return {row["id"]: row.get("display_name") or row.get("username") or "Benutzer" for row in rows}


def home_rule_at(tournament: dict, match: dict, proposals: list[dict], rules: dict) -> str | None:
    """Wann der früheste offene Vorschlag der Heimseite nach der 72-h-Regel gilt - ``None``, wenn keiner gelten kann."""
    if not rules["home_rule"] or is_fixed(match):
        return None
    home = home_registration_id(match)
    window = window_of(tournament, match)
    best = None
    for proposal in proposals:
        if proposal.get("status") != "pending" or not home or proposal.get("actor_registration_id") != home:
            continue
        moment = _moment(proposal.get("scheduled_at"))
        if not moment or (window and not window.contains(moment)) or blocked_period_at(tournament, moment):
            continue
        due = response_deadline(tournament, proposal.get("created_at"), int(rules["home_rule_hours"]))
        if due and due < moment and (best is None or due < best):
            best = due
    return best.isoformat() if best else None


async def page_block(db, match: dict, tournament: dict | None, *, acting_reg: dict | None, involved: bool, lead: bool,
                     can_lead_set: bool, proposals: list[dict] | None = None, now: datetime | None = None) -> dict | None:
    """Der Block ``schedule_block`` der Matchseite: Regeln im Klartext, Anträge, Historie - nur für Beteiligte und Leitung."""
    rules = rules_of(tournament)
    if not rules or not (involved or lead):
        return None
    from services.match_audience import registrations_for_match

    now = now or now_utc()
    registrations = await registrations_for_match(db, match)
    side_names = {reg["id"]: reg.get("display_name") or reg.get("team_name") or "Seite" for reg in registrations if reg.get("id")}
    requests = _requests(match)
    history = [row for row in match.get("schedule_history") or [] if isinstance(row, dict)]
    names = await _names(db, [row.get("requested_by") for row in requests] + [row.get("decided_by") for row in requests]
                         + [row.get("by") for row in history])
    own_id = (acting_reg or {}).get("id")
    window = window_of(tournament, match)
    refusal = request_refusal(match, rules, now)
    until = request_until(match, rules)

    def request_view(row: dict) -> dict:
        status = row.get("status")
        if status == "pending" and (_moment(row.get("from_at")) or now) <= now:
            status = "expired"
        open_ = status == "pending"
        mine = bool(own_id and row.get("requested_registration_id") == own_id)
        return {
            "id": row.get("id"), "status": status, "from_at": row.get("from_at"), "to_at": row.get("to_at"),
            "reason": row.get("reason"), "requested_at": row.get("requested_at"),
            "requested_by_name": names.get(row.get("requested_by") or ""),
            "side_name": side_names.get(row.get("requested_registration_id") or ""),
            "own": mine, "decided_at": row.get("decided_at"), "decided_by_name": names.get(row.get("decided_by") or ""),
            "decision_note": row.get("decision_note"),
            "can_answer": bool(open_ and own_id and not mine), "can_withdraw": bool(open_ and mine),
        }

    return {
        "rules": rules,
        "fixed": is_fixed(match),
        "source": match.get("schedule_source"),
        "scheduled_at": match.get("scheduled_at"),
        "window": {"start": window.start.isoformat(), "end": window.end.isoformat()} if window else None,
        "count": int(match.get("reschedule_count") or 0),
        "remaining": remaining(match, rules),
        "request_until": until.isoformat() if until else None,
        "can_request": bool(own_id) and refusal is None,
        "request_hint": refusal if own_id else None,
        "requests": [request_view(row) for row in reversed(requests)],
        "history": [{"id": row.get("id"), "at": row.get("at"), "kind": row.get("kind"), "from": row.get("from"),
                     "to": row.get("to"), "reason": row.get("reason"), "by_name": names.get(row.get("by") or ""),
                     "side_name": side_names.get(row.get("registration_id") or "")} for row in reversed(history)],
        "home_rule_at": home_rule_at(tournament, match, proposals or [], rules),
        "own_registration_id": own_id,
        "can_lead_set": bool(can_lead_set),
    }


# ---------------------------------------------------------------- Überfällig (für F.1)

OVERDUE_OPEN_STATUSES = ("ready", "scheduled")


def overdue_query(tournament_ids: list[str]) -> dict:
    """Offene Fälle „überfällig“: markiert, ohne Meldung, nicht entschieden."""
    return {"tournament_id": {"$in": tournament_ids}, "result_overdue_at": {"$nin": [None, ""]},
            "status": {"$in": list(OVERDUE_OPEN_STATUSES)}, "reports.0": {"$exists": False}, "is_preview": {"$ne": True}}


async def open_overdue(db, season_id: str) -> list[dict]:
    """Für F.1: die überfälligen Spiele einer Season, über die noch niemand entschieden hat. Ohne Entscheidung kein
    Saisonabschluss."""
    tournament_ids = [row["id"] for row in await db.tournaments.find(
        {"league_context.season_id": season_id}, {"_id": 0, "id": 1}).to_list(500) if row.get("id")]
    if not tournament_ids:
        return []
    return await db.matches_v2.find(overdue_query(tournament_ids), {
        "_id": 0, "id": 1, "tournament_id": 1, "scheduled_at": 1, "result_overdue_at": 1, "round": 1, "matchday_number": 1,
        "slots": 1, "status": 1}).sort("scheduled_at", 1).to_list(1000)


# ---------------------------------------------------------------- Datenschutz (Auskunft, Kontolöschung)

def privacy_query(user_id: str) -> dict:
    """Spiele, in deren Anträgen oder Historie die Person steht."""
    return {"$or": [{"reschedule_requests.requested_by": user_id}, {"reschedule_requests.decided_by": user_id},
                    {"reschedule_requests.approvals.user_id": user_id}, {"schedule_history.by": user_id},
                    {"schedule_history.requested_by": user_id}]}


def _export_request(row: dict, user_id: str) -> dict | None:
    """Eigener Antrag mit Grund; als Seite entschieden nur die eigene Antwort; als Leitung (ohne Seite) nur der Vorgang."""
    if row.get("requested_by") == user_id:
        return {"id": row.get("id"), "role": "requested", "status": row.get("status"), "from_at": row.get("from_at"),
                "to_at": row.get("to_at"), "reason": row.get("reason"), "at": row.get("requested_at")}
    if row.get("decided_by") == user_id and row.get("decided_registration_id"):
        return {"id": row.get("id"), "role": "decided", "status": row.get("status"), "from_at": row.get("from_at"),
                "to_at": row.get("to_at"), "decision_note": row.get("decision_note"), "at": row.get("decided_at")}
    if row.get("decided_by") == user_id:
        return {"id": row.get("id"), "role": "lead", "status": row.get("status"), "at": row.get("decided_at")}
    if any((approval or {}).get("user_id") == user_id for approval in row.get("approvals") or []):
        return {"id": row.get("id"), "role": "approved", "status": row.get("status"), "at": row.get("decided_at")}
    return None


def _export_history(entry: dict, user_id: str) -> dict | None:
    if entry.get("requested_by") == user_id:
        return {"kind": entry.get("kind"), "at": entry.get("at"), "from": entry.get("from"), "to": entry.get("to"),
                "reason": entry.get("reason")}
    if entry.get("by") != user_id:
        return None
    if not entry.get("registration_id"):
        return {"kind": entry.get("kind"), "at": entry.get("at")}  # als Leitung: der Vorgang ohne Inhalt
    return {"kind": entry.get("kind"), "at": entry.get("at"), "from": entry.get("from"), "to": entry.get("to")}


async def export_snapshot(db, user_id: str) -> list[dict]:
    """Für die Auskunft (``league_schedule``): je Spiel die eigenen Anträge und Schritte - ohne Kennungen anderer."""
    out = []
    for match in await db.matches_v2.find(privacy_query(user_id), {
            "_id": 0, "id": 1, "tournament_id": 1, "reschedule_requests": 1, "schedule_history": 1}).to_list(None):
        requests = [row for row in (_export_request(row, user_id) for row in match.get("reschedule_requests") or [] if isinstance(row, dict)) if row]
        history = [row for row in (_export_history(row, user_id) for row in match.get("schedule_history") or [] if isinstance(row, dict)) if row]
        if requests or history:
            out.append({"match_id": match.get("id"), "tournament_id": match.get("tournament_id"), "requests": requests, "history": history})
    return out


async def scrub_person(db, user_id: str) -> int:
    """Kontolöschung: Anträge und Historie bleiben (sportlicher Ablauf, Gründe), die Kennung der Person fällt heraus."""
    done = 0
    for match in await db.matches_v2.find(privacy_query(user_id), {"_id": 0, "id": 1, "reschedule_requests": 1,
                                                                    "schedule_history": 1}).to_list(None):
        requests = []
        for row in match.get("reschedule_requests") or []:
            row = dict(row)
            for key in ("requested_by", "decided_by"):
                if row.get(key) == user_id:
                    row[key] = None
            row["approvals"] = [{**approval, "user_id": None} if (approval or {}).get("user_id") == user_id else approval
                                for approval in row.get("approvals") or []]
            requests.append(row)
        history = [{**entry, **{key: None for key in ("by", "requested_by") if entry.get(key) == user_id}}
                   for entry in match.get("schedule_history") or []]
        update = {}
        if "reschedule_requests" in match:
            update["reschedule_requests"] = requests
        if "schedule_history" in match:
            update["schedule_history"] = history
        if update:
            await db.matches_v2.update_one({"id": match["id"]}, {"$set": update})
            done += 1
    return done
