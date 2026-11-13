"""Liga-Erinnerungen im Fristen-Job (docs/LIGA.md, „E.5 Benachrichtigungen und Erinnerungen“, #1647) - läuft im Fristen-Job
(``match_deadline_sweep``) mit denselben laufenden Turnieren, nur für Liga-Staffeln. Einstellbar je Season (``league_reminder_rules``).

- **Spiel steht an:** ``upcoming_early_hours`` und ``upcoming_late_minutes`` vor dem Termin an die Spieler der Aufstellung (ohne
  Aufstellung den Kader) und die Captains, mit Gegner und Zeit. Nicht bei abgesagten, schon gestarteten oder verschobenen Spielen
  (ein neuer Termin erinnert neu, der alte nie), nicht, wenn der Termin in einer Sperrzeit liegt (Nr. 151 - die Erinnerung selbst darf hineinfallen).
- **Termin offen:** bei ``unscheduled_week_percent`` der Spielwoche an die Captains beider Seiten, solange kein Termin fest steht
  (Einigung, 72-h-Regel, Verschiebung oder Leitung). Danach gilt der Standardtermin; wer ihn nie meldet, ist überfällig bei der
  Leitung (Nr. 28, ``league_schedule_sweep.overdue``).

Kein Merker am Spiel: Jede Nachricht hat einen Schlüssel je Spiel, Termin und Art (``meta.dedupe_key``), der Teilindex
``user_unique_dedupe`` lässt je Person nur eine Zeile zu - ein zweiter Lauf, auch gleichzeitig, schickt nichts mehr.
Die Erinnerung 10 Minuten vorher (``match_reminder``) gilt für alle Spiele und bleibt, wie sie ist.
"""
from __future__ import annotations

import logging
from datetime import datetime

from models import now_utc
from services import league_reminder_rules as reminder_rules
from services import league_schedule
from services.league_schedule import _moment, is_fixed, when_text, window_of
from services.log_safe import log_safe
from services.matchday_schedule import blocked_period_at

logger = logging.getLogger("tls.league_reminders")

# Nur Spiele, die noch vor sich gehen - abgesagt, kampflos, gestartet oder entschieden erinnert nichts mehr.
OPEN_STATUSES = ("ready", "scheduled")
EARLY, LATE = "upcoming_early", "upcoming_late"
UNSCHEDULED = "unscheduled"


def _filled(match: dict) -> list[str]:
    return [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]


def _open(match: dict) -> bool:
    return (str(match.get("status") or "") in OPEN_STATUSES and not match.get("started_at") and not match.get("is_preview")
            and len(_filled(match)) == 2)


def upcoming_due(tournament: dict, match: dict, rules: dict, now: datetime) -> str | None:
    """Welche Erinnerung vor dem Spiel jetzt fällig ist (``EARLY``/``LATE``) - ``None``: keine. Reine Rechnung.

    Fällig ist sie ab dem Zeitpunkt und bis ``CATCH_UP_MINUTES`` danach (ein langsamer Lauf holt sie nach, ein Spiel, das erst kurz
    vorher feststeht, bekommt die frühe nicht mehr)."""
    if not rules.get("upcoming") or not _open(match):
        return None
    start = _moment(match.get("scheduled_at"))
    if not start or start <= now:
        return None
    # Nr. 151: Nur der Spieltermin zählt. Liegt der Zeitpunkt der Erinnerung noch in einer Sperrzeit (das erste Spiel nach der Pause),
    # kommt sie trotzdem - sonst ginge sie nach jeder Pause nie raus.
    if blocked_period_at(tournament, start):
        return None
    left = (start - now).total_seconds() / 60
    catch_up = reminder_rules.CATCH_UP_MINUTES
    for kind, minutes in ((EARLY, int(rules["upcoming_early_hours"]) * 60), (LATE, int(rules["upcoming_late_minutes"]))):
        if minutes - catch_up < left <= minutes:
            return kind
    return None


def unscheduled_due(tournament: dict, match: dict, rules: dict, now: datetime):
    """Ist „Termin offen“ jetzt fällig? Gibt die Spielwoche zurück - ``None``: nicht fällig. Reine Rechnung."""
    if not rules.get("unscheduled") or not _open(match) or is_fixed(match):
        return None
    window = window_of(tournament, match)
    if not window or not window.start <= now < window.end:
        return None
    point = window.start + (window.end - window.start) * (int(rules["unscheduled_week_percent"]) / 100)
    if now < point or blocked_period_at(tournament, now):
        return None
    default = _moment(match.get("scheduled_at"))
    if default and default <= now:
        return None  # Der Standardtermin ist schon vorbei - das ist ein Fall für „Ergebnis fehlt“ und „überfällig“.
    return window


def _name(registration: dict | None) -> str:
    registration = registration or {}
    return registration.get("display_name") or registration.get("team_name") or registration.get("ingame_name") or "Gegner"


async def _send(db, user_ids, title: str, body: str, match: dict, rules: dict, kind: str, dedupe: str, *,
                notification_kind: str) -> int:
    from services.user_notifications import create_user_notification

    sent = 0
    for user_id in sorted(user_ids):
        if await create_user_notification(
            user_id, title, body, url=f"/matches/{match.get('id')}", kind=notification_kind,
            meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                  "reason": kind, "dedupe_key": dedupe, **reminder_rules.notice_meta(rules, kind)}):
            sent += 1
    return sent


async def remind_upcoming(db, tournament: dict, match: dict, rules: dict, kind: str) -> int:
    """„Liga-Spiel in 24 Stunden“ an Aufstellung bzw. Kader und Captains - je Seite mit dem Namen der anderen."""
    from services.match_audience import playing_ids, registrations_for_match, responsible_ids, teams_by_id

    registrations = [reg for reg in await registrations_for_match(db, match) if reg.get("id") in _filled(match)]
    if len(registrations) != 2:
        return 0
    teams = await teams_by_id(db, registrations)
    minutes = int(rules["upcoming_early_hours"]) * 60 if kind == EARLY else int(rules["upcoming_late_minutes"])
    start = league_schedule._iso(match.get("scheduled_at"))
    dedupe = f"league-upcoming:{match['id']}:{start}:{kind}"
    title = f"Liga-Spiel in {reminder_rules.lead_text(minutes)}"
    sent = 0
    for reg in registrations:
        other = next(row for row in registrations if row.get("id") != reg.get("id"))
        team = teams.get(reg.get("team_id") or "")
        people = playing_ids(reg, team) | responsible_ids(reg, team)
        body = f"{tournament.get('title') or 'Liga'}: gegen {_name(other)} am {when_text(start)} Uhr."
        sent += await _send(db, people, title, body, match, rules, kind, dedupe, notification_kind="match_reminder")
    return sent


async def remind_unscheduled(db, tournament: dict, match: dict, rules: dict, window) -> int:
    """„Termin noch offen“ an die Captains beider Seiten - einmal je Spielwoche."""
    from services.match_audience import registrations_for_match, responsible_user_ids
    from services.match_notifications import match_title

    registrations = [reg for reg in await registrations_for_match(db, match) if reg.get("id") in _filled(match)]
    if len(registrations) != 2:
        return 0
    regs_by_id = {reg["id"]: reg for reg in registrations}
    default = match.get("scheduled_at")
    tail = (f"ohne Einigung gilt der Standardtermin {when_text(default)} Uhr." if default
            else "ohne Einigung entscheidet die Liga-Leitung.")
    body = (f"{tournament.get('title') or 'Liga'} · {match_title(match, regs_by_id)}: Noch kein Termin vereinbart. Bitte auf der "
            f"Matchseite einen Termin vorschlagen oder annehmen – {tail}")
    dedupe = f"league-unscheduled:{match['id']}:{window.start.isoformat()}"
    return await _send(db, await responsible_user_ids(db, registrations), "Termin noch offen", body, match, rules, UNSCHEDULED,
                       dedupe, notification_kind="match_schedule")


async def sweep(db, tournaments: list[dict], *, now: datetime | None = None) -> dict:
    """Ein Lauf über die laufenden Turniere des Fristen-Jobs - nur Liga-Staffeln. Ein Spiel hält die anderen nicht auf."""
    now = now or now_utc()
    counts = {EARLY: 0, LATE: 0, UNSCHEDULED: 0}
    for tournament in tournaments:
        rules = reminder_rules.rules_of(tournament)
        if not rules or tournament.get("locked_at") or not (rules.get("upcoming") or rules.get("unscheduled")):
            continue
        matches = await db.matches_v2.find(
            {"tournament_id": tournament["id"], "status": {"$in": list(OPEN_STATUSES)}, "started_at": None,
             "is_preview": {"$ne": True}},
            {"_id": 0, "id": 1, "tournament_id": 1, "status": 1, "started_at": 1, "scheduled_at": 1, "schedule_source": 1,
             "slots": 1, "matchday_number": 1, "round": 1, "round_index": 1, "match_key": 1, "is_preview": 1}).to_list(3000)
        for match in matches:
            try:
                kind = upcoming_due(tournament, match, rules, now)
                if kind and await remind_upcoming(db, tournament, match, rules, kind):
                    counts[kind] += 1
                window = unscheduled_due(tournament, match, rules, now)
                if window and await remind_unscheduled(db, tournament, match, rules, window):
                    counts[UNSCHEDULED] += 1
            except Exception:  # noqa: BLE001 - ein Spiel hält die anderen nicht auf
                logger.warning("[league_reminders] Erinnerung zu Spiel %s nicht verschickt", log_safe(match.get("id")), exc_info=True)
    return counts
