"""Der Zeit-Job der Liga-Termine (docs/LIGA.md, „D.1 Termine“, #2194) - läuft im Fristen-Job (``match_deadline_sweep``) mit
denselben laufenden Turnieren, nur für Staffeln mit ``schedule_rules``.

- **72-h-Regel (Nr. 17):** Ein offener Vorschlag der Heimseite gilt nach der Frist, wenn er in der Spielwoche liegt, nicht in
  einer Sperrzeit, noch in der Zukunft, und das Spiel noch keinen festen Termin hat. Sonst bleibt der Standardtermin.
- **Abgelaufene Anträge:** Eine offene Verschiebung, deren alter Termin erreicht ist, endet als ``expired``.
- **Überfällig (Nr. 28):** Termin vorbei, keine Meldung: Erinnerung an beide Seiten, danach „überfällig“ bei der Leitung.

Jeder Schritt schreibt nur mit Bedingung auf den gelesenen Stand - ein zweiter Lauf findet nichts mehr.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from models import new_id, now_utc
from services import checkin_rules, league_schedule
from services.league_schedule import CLOSED_MATCH_STATUSES, rules_of
from services.matchday_schedule import blocked_period_at, home_registration_id, response_deadline
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

logger = logging.getLogger("tls.league_schedule_sweep")


def _filled(match: dict) -> list[str]:
    return [slot.get("registration_id") for slot in match.get("slots") or [] if slot.get("registration_id")]


async def _audit(db, action: str, match: dict, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id"), "actor_id": None,
        "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"), **data},
        "created_at": now_utc().isoformat(),
    })


async def _tell_sides(db, match: dict, title: str, text: str, reason: str, dedupe: str, *, extra: dict | None = None) -> None:
    from services.match_audience import registrations_for_match, responsible_user_ids
    from services.match_notifications import match_title
    from services.user_notifications import create_user_notification

    try:
        registrations = await registrations_for_match(db, match)
        regs_by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
        tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
        body = f"{tournament.get('title') or 'Liga'} · {match_title(match, regs_by_id)}: {text}"
        for user_id in sorted(await responsible_user_ids(db, registrations)):
            await create_user_notification(
                user_id, title, body, url=f"/matches/{match.get('id')}", kind="match_schedule",
                meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                      "reason": reason, "dedupe_key": dedupe, **(extra or {})})
    except Exception:  # noqa: BLE001 - der Schritt ist schon gespeichert
        logger.warning("[league_schedule_sweep] Nachricht zu %s nicht verschickt", match.get("id"), exc_info=True)


# ---------------------------------------------------------------- 72-h-Regel

def home_rule_problem(tournament: dict, match: dict, proposal: dict, rules: dict, now: datetime) -> str | None:
    """Warum dieser Vorschlag nicht nach der Regel gilt - ``None``: er gilt jetzt. Reine Rechnung."""
    if not rules["home_rule"]:
        return "aus"
    if proposal.get("status") != "pending":
        return "entschieden"
    home = home_registration_id(match)
    if not home or proposal.get("actor_registration_id") != home or len(_filled(match)) < 2:
        return "nicht die Heimseite"
    if str(match.get("status") or "") in CLOSED_MATCH_STATUSES or match.get("started_at") or match.get("is_preview"):
        return "Spiel läuft oder ist entschieden"
    if league_schedule.is_fixed(match):
        return "Termin steht fest"
    due = response_deadline(tournament, proposal.get("created_at"), int(rules["home_rule_hours"]))
    if not due or due > now:
        return "Frist läuft noch"
    moment = league_schedule._moment(proposal.get("scheduled_at"))
    if not moment or moment <= now + timedelta(minutes=league_schedule.LEAD_MINUTES):
        return "Termin schon vorbei"
    window = league_schedule.window_of(tournament, match)
    if window and not window.contains(moment):
        return "nicht in der Spielwoche"
    if blocked_period_at(tournament, moment):
        return "Sperrzeit"
    return None


async def _apply_home_rule(db, tournament: dict, match_id: str, proposal_id: str, now: datetime) -> int:
    try:
        async with mutation_lock(db, tournament_write_resource(tournament["id"]), wait_seconds=2.0):
            fresh_tournament = await db.tournaments.find_one({"id": tournament["id"]}, {"_id": 0, "creation_key": 0, "billing": 0})
            rules = rules_of(fresh_tournament)
            match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
            proposal = await db.match_schedule_proposals.find_one({"id": proposal_id}, {"_id": 0})
            if not rules or not match or not proposal or home_rule_problem(fresh_tournament, match, proposal, rules, now):
                return 0
            now_iso = now.isoformat()
            taken = await db.match_schedule_proposals.update_one(
                {"id": proposal_id, "status": "pending"},
                {"$set": {"status": "accepted", "decision_rule": "home_rule", "decision_user_id": None, "decided_at": now_iso,
                          "updated_at": now_iso}})
            if not taken.modified_count:
                return 0
            # Der neue Termin bringt sein eigenes Check-in-Fenster - eine alte Verlängerung fällt (D.2, #1652), die Revision steigt (D.3).
            update = checkin_rules.new_time_change(fresh_tournament, {
                "$set": {"scheduled_at": league_schedule._iso(proposal["scheduled_at"]), "schedule_source": "accepted",
                         "schedule_status": "accepted", "schedule_written_at": now_iso, "updated_at": now_iso,
                         **({"status": "scheduled"} if match.get("status") in {"pending", "ready", "preview"} else {})},
                "$unset": {"schedule_deadline_at": "", "schedule_escalated_at": ""},
                "$push": league_schedule.history_push(league_schedule.history_entry(
                    "home_rule", registration_id=proposal.get("actor_registration_id"), from_at=match.get("scheduled_at"),
                    to_at=proposal["scheduled_at"], request_id=proposal_id, at=now, hours=int(rules["home_rule_hours"]))),
            })
            written = await db.matches_v2.update_one(
                {"id": match_id, "scheduled_at": match.get("scheduled_at"), "schedule_source": match.get("schedule_source"),
                 "status": match.get("status")}, update)
            if not written.matched_count:
                await db.match_schedule_proposals.update_one(
                    {"id": proposal_id, "decision_rule": "home_rule"},
                    {"$set": {"status": "pending", "updated_at": now_iso}, "$unset": {"decision_rule": "", "decided_at": ""}})
                return 0
            await db.match_schedule_proposals.update_many(
                {"match_id": match_id, "status": "pending", "id": {"$ne": proposal_id}},
                {"$set": {"status": "declined", "decision_rule": "home_rule", "updated_at": now_iso}})
    except MutationLockBusy:
        logger.info("72-h-Regel für match=%s wartet auf die Turniersperre", match_id)
        return 0
    await _audit(db, "match.schedule.home_rule", match, {"proposal_id": proposal_id, "scheduled_at": proposal["scheduled_at"],
                                                          "hours": int(rules["home_rule_hours"])})
    await _tell_sides(
        db, match, "Termin steht (72-h-Regel)",
        f"Der Terminvorschlag der Heimseite für {league_schedule.when_text(proposal['scheduled_at'])} wurde in "
        f"{int(rules['home_rule_hours'])} Stunden nicht beantwortet und gilt jetzt.",
        "schedule_home_rule", f"schedule-home-rule:{proposal_id}")
    return 1


async def home_rule(db, tournament: dict, rules: dict, now: datetime) -> int:
    if not rules["home_rule"]:
        return 0
    proposals = await db.match_schedule_proposals.find(
        {"tournament_id": tournament["id"], "status": "pending"},
        {"_id": 0, "id": 1, "match_id": 1, "actor_registration_id": 1, "scheduled_at": 1, "created_at": 1, "status": 1},
    ).to_list(3000)
    due = []
    for proposal in proposals:
        deadline = response_deadline(tournament, proposal.get("created_at"), int(rules["home_rule_hours"]))
        if deadline and deadline <= now:
            due.append(proposal)
    if not due:
        return 0
    # Je Spiel der früheste Termin der Heimseite zuerst - die übrigen schließen danach mit.
    due.sort(key=lambda row: (str(row.get("match_id")), str(row.get("scheduled_at"))))
    applied = 0
    done: set[str] = set()
    for proposal in due:
        if proposal.get("match_id") in done:
            continue
        if await _apply_home_rule(db, tournament, proposal["match_id"], proposal["id"], now):
            applied += 1
            done.add(proposal["match_id"])
    return applied


# ---------------------------------------------------------------- Anträge, überfällige Spiele

async def expire_requests(db, tournament: dict, now: datetime) -> int:
    matches = await db.matches_v2.find(
        {"tournament_id": tournament["id"], "reschedule_requests.status": "pending"}, {"_id": 0}).to_list(500)
    count = 0
    for match in matches:
        request = league_schedule.pending_request(match)
        moment = league_schedule._moment((request or {}).get("from_at"))
        if request and moment and moment <= now:
            await league_schedule._close_request(db, match, request["id"], "expired", now)
            count += 1
    return count


def result_reminder_held(match: dict) -> bool:
    """„Ergebnis fehlt“ wartet, solange ein Vorfall (D.5) oder ein Verfahren (E.2) am Spiel offen ist (#1647) - danach kommt sie."""
    from services import league_incident_rules, league_procedures

    return bool(league_incident_rules.open_incidents(match)) or league_procedures.has_open(match)


# Gespeicherte Termine sind UTC-Text; ein Termin mit anderem Versatz verschiebt den Textvergleich um höchstens 14 Stunden.
_TEXT_SLACK = timedelta(hours=14)


def overdue_filter(tournament_id: str, rules: dict, reminders: dict, now: datetime) -> dict:
    """Welche Spiele der Lauf laden muss (#1647, N5): nur Termine, deren Erinnerung oder „überfällig“ schon fällig sein kann - und
    ohne Erinnerung (aus) nur die, die noch nicht überfällig sind. So lädt nicht jede Minute jedes künftige Spiel der Staffel."""
    hours = int(rules["result_overdue_hours"])
    pending: list[dict] = [{"result_overdue_at": None}]
    if reminders.get("result_missing"):
        hours = min(hours, int(rules["result_reminder_hours"]))
        pending.append({"result_reminded_at": None})
    bound = (now - timedelta(hours=hours) + _TEXT_SLACK).isoformat()
    return {"tournament_id": tournament_id, "status": {"$in": list(league_schedule.OVERDUE_OPEN_STATUSES)},
            "scheduled_at": {"$nin": [None, ""], "$lte": bound}, "reports.0": {"$exists": False}, "is_preview": {"$ne": True},
            "$or": pending}


def result_reminder_window_open(moment: datetime, rules: dict, now: datetime) -> bool:
    """„Ergebnis fehlt“ ist fällig - und nicht zu spät (#1647, N5): nur bis „überfällig“ (mindestens eine Stunde lang). Wer die
    Erinnerung wieder einschaltet oder einen Vorfall schließt, löst keine Flut für alte Spiele aus."""
    due = moment + timedelta(hours=int(rules["result_reminder_hours"]))
    window = max(timedelta(hours=int(rules["result_overdue_hours"]) - int(rules["result_reminder_hours"])), timedelta(hours=1))
    return due <= now < due + window


async def overdue(db, tournament: dict, rules: dict, now: datetime) -> tuple[int, int]:
    """Erinnerung an beide Seiten, danach „überfällig“ bei der Leitung - je Termin einmal. Die Erinnerung lässt sich je Season
    abschalten (``reminder_rules.result_missing``, #1647) und wartet auf offene Vorfälle und Verfahren."""
    from services import league_reminder_rules
    from services.league_permissions import staff_user_ids
    from services.user_notifications import create_user_notification

    reminders = league_reminder_rules.rules_of(tournament) or league_reminder_rules.defaults()

    matches = await db.matches_v2.find(overdue_filter(tournament["id"], rules, reminders, now), {"_id": 0}).to_list(3000)
    reminded = marked = 0
    for match in matches:
        moment = league_schedule._moment(match.get("scheduled_at"))
        if not moment or len(_filled(match)) < 2 or match.get("started_at") or isinstance(match.get("pending_result"), dict):
            continue
        base = {"id": match["id"], "scheduled_at": match["scheduled_at"], "reports.0": {"$exists": False},
                "status": {"$in": list(league_schedule.OVERDUE_OPEN_STATUSES)}}
        if (not match.get("result_reminded_at") and reminders["result_missing"] and not result_reminder_held(match)
                and result_reminder_window_open(moment, rules, now)):
            done = await db.matches_v2.update_one({**base, "result_reminded_at": None},
                                                  {"$set": {"result_reminded_at": now.isoformat()}})
            if done.modified_count:
                reminded += 1
                await _tell_sides(
                    db, match, "Ergebnis fehlt",
                    f"Das Spiel war am {league_schedule.when_text(moment)} angesetzt, es ist noch kein Ergebnis gemeldet. "
                    "Bitte jetzt melden – oder im Matchchat @leitung schreiben, wenn es nicht stattgefunden hat.",
                    "result_missing_reminder", f"result-reminder:{match['id']}:{match['scheduled_at']}",
                    extra=league_reminder_rules.notice_meta(reminders, "result_missing"))
        if not match.get("result_overdue_at") and now >= moment + timedelta(hours=int(rules["result_overdue_hours"])):
            done = await db.matches_v2.update_one({**base, "result_overdue_at": None},
                                                  {"$set": {"result_overdue_at": now.isoformat()}})
            if not done.modified_count:
                continue
            marked += 1
            await _audit(db, "match.result.overdue", match, {"scheduled_at": match["scheduled_at"],
                                                            "hours": int(rules["result_overdue_hours"])})
            label = match.get("round_name") or match.get("matchday_label") or "ein Spiel"
            staff = await staff_user_ids(db, tournament["league_context"].get("league_id"), ("matches", "results"))
            for user_id in sorted(staff):
                await create_user_notification(
                    user_id, "Spiel überfällig",
                    f"{tournament.get('title') or 'Liga'} · {label}: angesetzt am {league_schedule.when_text(moment)}, nie gemeldet. "
                    "Bitte entscheiden: Ergebnis eintragen, kampflos werten oder neuen Termin setzen.",
                    url=f"/matches/{match['id']}", kind="match_attention",
                    meta={"category": "tournament_updates", "tournament_id": tournament["id"], "match_id": match["id"],
                          "reason": "result_overdue", "dedupe_key": f"result-overdue:{match['id']}:{match['scheduled_at']}"})
    return reminded, marked


async def sweep(db, tournaments: list[dict], *, now: datetime | None = None) -> dict:
    """Ein Lauf über die laufenden Turniere des Fristen-Jobs - nur Staffeln mit Terminregeln."""
    now = now or now_utc()
    counts = {"home_rule": 0, "expired": 0, "reminded": 0, "overdue": 0}
    for tournament in tournaments:
        rules = rules_of(tournament)
        if not rules:
            continue
        try:
            counts["home_rule"] += await home_rule(db, tournament, rules, now)
            counts["expired"] += await expire_requests(db, tournament, now)
            if blocked_period_at(tournament, now):
                continue  # In der Sperrzeit erinnert niemand und nichts wird überfällig.
            reminded, marked = await overdue(db, tournament, rules, now)
            counts["reminded"] += reminded
            counts["overdue"] += marked
        except Exception:  # noqa: BLE001 - eine Staffel hält die anderen nicht auf
            logger.warning("[league_schedule_sweep] Staffel %s nicht geprüft", tournament.get("id"), exc_info=True)
    return counts
