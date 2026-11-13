"""Liga-Erinnerungen im Fristen-Job (docs/LIGA.md, „E.5 Benachrichtigungen und Erinnerungen“, #1647) - läuft im Fristen-Job
(``match_deadline_sweep``) mit denselben laufenden Turnieren, nur für Liga-Staffeln. Einstellbar je Season (``league_reminder_rules``).

- **Spiel steht an:** ``upcoming_early_hours`` und ``upcoming_late_minutes`` vor dem Termin an die Spieler der Aufstellung (ohne
  Aufstellung den Kader) und die Captains, mit Gegner und Zeit. Nicht bei abgesagten, schon gestarteten oder verschobenen Spielen
  (ein neuer Termin erinnert neu, der alte nie), nicht, wenn der Termin in einer Sperrzeit liegt (Nr. 151 - die Erinnerung selbst darf hineinfallen).
- **Termin offen:** bei ``unscheduled_week_percent`` der Spielwoche (spätestens ``unscheduled_hours_before_default`` Stunden vor dem
  Standardtermin) an die Captains beider Seiten, solange kein Termin fest steht
  (Einigung, 72-h-Regel, Verschiebung oder Leitung). Danach gilt der Standardtermin; wer ihn nie meldet, ist überfällig bei der
  Leitung (Nr. 28, ``league_schedule_sweep.overdue``).

Jede Nachricht hat einen Schlüssel je Spiel, Termin und Art (``meta.dedupe_key``), der Teilindex ``user_unique_dedupe`` lässt je
Person nur eine Zeile zu - ein zweiter Lauf, auch gleichzeitig, schickt nichts mehr. Nach dem Versand merkt sich das Spiel den Schlüssel
(``reminder_notes.<art>``), damit spätere Läufe die Empfänger gar nicht erst neu auflösen.
Die Erinnerung 10 Minuten vorher (``match_reminder``) gilt für alle Spiele und bleibt, wie sie ist.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

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
    default = _moment(match.get("scheduled_at"))
    if default:
        # Liegt der Standardtermin vor der Wochenmitte, käme die Erinnerung sonst nie - dann spätestens so viele Stunden vor ihm.
        point = min(point, default - timedelta(hours=int(rules["unscheduled_hours_before_default"])))
    if now < point or blocked_period_at(tournament, now):
        return None
    if default and default <= now:
        return None  # Der Standardtermin ist schon vorbei - das ist ein Fall für „Ergebnis fehlt“ und „überfällig“.
    return window


def upcoming_key(match: dict, kind: str) -> str:
    return f"league-upcoming:{match['id']}:{league_schedule._iso(match.get('scheduled_at'))}:{kind}"


def unscheduled_key(match: dict, window) -> str:
    return f"league-unscheduled:{match['id']}:{window.start.isoformat()}"


def already_sent(match: dict, kind: str, key: str) -> bool:
    """Ging diese Erinnerung zu diesem Spiel schon raus? Merker ``reminder_notes.<art>`` = Schlüssel (#1647, N1) - so löst ein
    späterer Lauf Anmeldungen, Teams und Kader nicht jede Minute neu auf. Ein neuer Termin ergibt einen neuen Schlüssel."""
    return ((match.get("reminder_notes") or {}).get(kind)) == key


async def _note_sent(db, match: dict, kind: str, key: str) -> None:
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {f"reminder_notes.{kind}": key}})


def _name(registration: dict | None) -> str:
    registration = registration or {}
    return registration.get("display_name") or registration.get("team_name") or registration.get("ingame_name") or "Gegner"


async def _send(db, user_ids, title: str, body: str, match: dict, rules: dict, kind: str, dedupe: str, *,
                notification_kind: str) -> int:
    from services.match_audience import users_for
    from services.user_notifications import create_user_notification

    # Gesperrte Konten bekommen nichts (wie ``users_for`` überall).
    allowed = {user["id"] for user in await users_for(db, user_ids, {"_id": 0, "id": 1})}
    sent = 0
    for user_id in sorted(allowed):
        if await create_user_notification(
            user_id, title, body, url=f"/matches/{match.get('id')}", kind=notification_kind,
            meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                  "reason": kind, "dedupe_key": dedupe, **reminder_rules.notice_meta(rules, kind)}):
            sent += 1
    return sent


async def _players(db, tournament: dict, match: dict, registrations: list[dict], teams: dict, now: datetime | None) -> dict[str, set]:
    """Je Anmeldung, wer als Spieler erinnert wird: die Aufgestellten, soweit noch im Kader (ohne Aufstellung der Kader) - ohne
    Personen, die laut E.3 für dieses Spiel gesperrt sind (Spielsperre, oder das ganze Co-Team gesperrt)."""
    from services import league_sanction_bans
    from services.match_audience import playing_ids, roster_ids

    out: dict[str, set] = {}
    for reg in registrations:
        team = teams.get(reg.get("team_id") or "")
        people = playing_ids(reg, team)
        if reg.get("team_id") and reg.get("lineup"):
            people &= roster_ids(reg, team)
        out[reg["id"]] = people
    context = tournament.get("league_context") or {}
    everyone = set().union(*out.values()) if out else set()
    found = await league_sanction_bans.bans(db, context.get("league_id"), context.get("season_id"), everyone, match=match, now=now)
    for reg in registrations:
        if league_sanction_bans.squad_ban(found, reg.get("squad_id")):
            out[reg["id"]] = set()
        else:
            out[reg["id"]] = {user_id for user_id in out[reg["id"]] if user_id not in found.users}
    return out


async def remind_upcoming(db, tournament: dict, match: dict, rules: dict, kind: str, *, now: datetime | None = None) -> int:
    """„Liga-Spiel in 24 Stunden“ an Aufstellung bzw. Kader und Captains - je Seite mit dem Namen der anderen. Gesperrte Spieler
    (E.3) bekommen sie nicht, als Captain schon."""
    from services.match_audience import registrations_for_match, responsible_ids, teams_by_id

    registrations = [reg for reg in await registrations_for_match(db, match) if reg.get("id") in _filled(match)]
    if len(registrations) != 2:
        return 0
    teams = await teams_by_id(db, registrations)
    players = await _players(db, tournament, match, registrations, teams, now)
    minutes = int(rules["upcoming_early_hours"]) * 60 if kind == EARLY else int(rules["upcoming_late_minutes"])
    start = league_schedule._iso(match.get("scheduled_at"))
    dedupe = upcoming_key(match, kind)
    title = f"Liga-Spiel in {reminder_rules.lead_text(minutes)}"
    sent = 0
    for reg in registrations:
        other = next(row for row in registrations if row.get("id") != reg.get("id"))
        team = teams.get(reg.get("team_id") or "")
        people = players[reg["id"]] | responsible_ids(reg, team)
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
    dedupe = unscheduled_key(match, window)
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
             "slots": 1, "matchday_number": 1, "round": 1, "round_index": 1, "match_key": 1, "is_preview": 1,
             "reminder_notes": 1}).to_list(3000)
        for match in matches:
            try:
                kind = upcoming_due(tournament, match, rules, now)
                if kind and not already_sent(match, kind, upcoming_key(match, kind)):
                    if await remind_upcoming(db, tournament, match, rules, kind, now=now):
                        counts[kind] += 1
                    await _note_sent(db, match, kind, upcoming_key(match, kind))
                window = unscheduled_due(tournament, match, rules, now)
                if window and not already_sent(match, UNSCHEDULED, unscheduled_key(match, window)):
                    if await remind_unscheduled(db, tournament, match, rules, window):
                        counts[UNSCHEDULED] += 1
                    await _note_sent(db, match, UNSCHEDULED, unscheduled_key(match, window))
            except Exception:  # noqa: BLE001 - ein Spiel hält die anderen nicht auf
                logger.warning("[league_reminders] Erinnerung zu Spiel %s nicht verschickt", log_safe(match.get("id")), exc_info=True)
    return counts
