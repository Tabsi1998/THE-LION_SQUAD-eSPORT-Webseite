"""Der Fristen-Job (#1551): einmal je Minute, auf genau einem Server (Scheduler-Job „match_deadlines“ mit Lease).

- „Nicht erschienen“: ist die Frist eines Spiels um (services/match_deadlines), legt der Job genau einen Vorschlag
  „kampflos verloren“ an das Spiel (``no_show_proposal``), schreibt „match.no_show.proposed“ ins Protokoll und meldet
  es der Turnierleitung mit Ergebnis-Recht für dieses Spiel. Sichtbar wird der Vorschlag in „Braucht Aufmerksamkeit“;
  die Turnierleitung bestätigt (Wertung über den Forfeit-Weg) oder verlängert (routes/tournament_lead_routes). Liga-
  Staffeln bekommen keinen Vorschlag; alte offene räumt der Job ab („match.no_show.cleared“, #2201).
- „Ergebnis gilt“: ist die Frist einer einzelnen Meldung um und hat niemand widersprochen, trägt der Job sie über den
  einen Ergebnis-Weg ein (``submit_v2_result``, Protokoll „match.result.auto_confirm“) - unter der Schreibsperre des
  Turniers, mit erneuter Prüfung. Ein zweiter Lauf findet nichts mehr.
"""
from __future__ import annotations

import logging
from datetime import datetime

from models import new_id, now_utc
from services.match_deadlines import (
    NO_SHOW_OPEN_STATUSES,
    auto_confirm_due,
    no_show_action,
    no_show_deadline,
    no_show_due_text,
    single_report,
)
from services.league_scope import is_league_staffel
from services.live_sweep import live_tournaments_with
from services.match_timing import registration_name
from services.match_v2_results import MatchV2ResultError
from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource
from services.tournament_permissions import result_staff_user_ids
from services.user_notifications import create_user_notification
from services.v2_result_submission import submit_v2_result

logger = logging.getLogger("tls.match_deadlines")

REMOVED_STATUSES = ["withdrawn", "disqualified"]
SWEEP_STATUSES = ["ready", "scheduled", "in_progress", "running", "waiting_result"]


async def _audit(db, action: str, match: dict, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id"), "actor_id": None,
        "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"),
                 **data},
        "created_at": now_utc().isoformat(),
    })


async def _fresh(db, tournament_id: str, match_id: str) -> tuple[dict | None, dict | None, dict | None]:
    """Turnier, Spiel und Phase so, wie sie jetzt sind - unter der Schreibsperre gelesen, nicht aus dem Lauf."""
    tournament = await db.tournaments.find_one({"id": tournament_id}, {"_id": 0, "creation_key": 0, "billing": 0})
    match = await db.matches_v2.find_one({"id": match_id}, {"_id": 0})
    stage = await db.tournament_stages.find_one({"id": match.get("stage_id")}, {"_id": 0}) \
        if match and match.get("stage_id") else None
    if not tournament or tournament.get("status") != "live":
        return None, None, None
    return tournament, match, stage


async def _propose_no_show(db, tournament: dict, match: dict, info: dict, now: datetime) -> int:
    """Den Vorschlag schreiben - unter der Turniersperre mit frischem Stand, und nur für ein Spiel, das noch offen ist,
    keine Meldung hat und nicht begonnen hat (dieselbe Prüfung steckt im Filter des Schreibens)."""
    try:
        async with mutation_lock(db, tournament_write_resource(tournament["id"]), wait_seconds=2.0):
            tournament, match, stage = await _fresh(db, tournament["id"], match["id"])
            info = no_show_deadline(match or {}, tournament, stage) if match else None
            if not match or not info or info["due_at"] > now or match.get("no_show_proposal"):
                return 0
            filled = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
            # Ausgeschiedene (Austritt, Disqualifikation #1553) erscheinen nicht mehr - dafür gibt es keinen Vorschlag.
            if await db.tournament_registrations.count_documents({"id": {"$in": filled}, "status": {"$in": REMOVED_STATUSES}}):
                return 0
            proposal = {
                "id": new_id(), "rule": info["rule"], "minutes": info["minutes"], "registration_ids": filled,
                "due_at": info["due_at"].isoformat(), "created_at": now.isoformat(),
            }
            if info.get("missing"):
                # Liga-Check-in (D.2, #1652): der Vorschlag nennt die Seiten ohne Check-in - nur über sie entscheidet die Leitung.
                proposal["missing_registration_ids"] = list(info["missing"])
            stored = await db.matches_v2.update_one(
                {"id": match["id"], "no_show_proposal": None, "status": {"$in": sorted(NO_SHOW_OPEN_STATUSES)},
                 "reports.0": {"$exists": False}, "started_at": None, "pending_result": None},
                {"$set": {"no_show_proposal": proposal}},
            )
            if not getattr(stored, "modified_count", 0):
                return 0
    except MutationLockBusy:
        logger.info("No-show proposal for match=%s waits for the tournament lock", match.get("id"))
        return 0
    await _audit(db, "match.no_show.proposed", match,
                 {"proposal_id": proposal["id"], "rule": info["rule"], "minutes": info["minutes"]})
    regs = await db.tournament_registrations.find(
        {"id": {"$in": filled}}, {"_id": 0, "id": 1, "display_name": 1, "ingame_name": 1, "team_name": 1},
    ).to_list(64)
    names = " gegen ".join(registration_name(reg) for reg in regs) if len(regs) == 2 else f"{len(regs)} Teilnehmer"
    label = match.get("round_name") or match.get("matchday_label") or match.get("match_key") or "Spiel"
    key = tournament.get("slug") or tournament["id"]
    if info["rule"] == "check_in":
        # Liga (D.2): keine Wertung von selbst - die Leitung wertet kampflos, trägt die Seite nach oder verlängert.
        regs_by_id = {reg["id"]: reg for reg in regs if reg.get("id")}
        missing = ", ".join(registration_name(regs_by_id.get(reg_id)) for reg_id in proposal.get("missing_registration_ids") or [])
        body = (f"{tournament.get('title') or 'Liga'} · {label}: {names} – {no_show_due_text(match, info)}, "
                f"{missing or 'eine Seite'} nicht eingecheckt. Kampflos werten, Seite nachtragen oder verlängern?")
    else:
        action = no_show_action(match)
        body = (f"{tournament.get('title') or 'Turnier'} · {label}: {names} – "
                f"{no_show_due_text(match, info)}. {action[:1].upper()}{action[1:]}?")
    for user_id in sorted(await result_staff_user_ids(db, match)):
        await create_user_notification(
            user_id, "Nicht erschienen?", body, url=f"/tournaments/{key}/leitung?fall=ns-{match['id']}",
            kind="match_attention",
            meta={"category": "tournament_updates", "tournament_id": tournament["id"], "match_id": match["id"],
                  "reason": "no_show", "dedupe_key": f"no-show:{proposal['id']}"},
        )
    return 1


def _league_proposal_stale(tournament: dict, match: dict) -> str | None:
    """Warum ein offener Liga-Vorschlag weg darf: ohne Regel ``check_in`` stammt er aus der Zeit vor dem Check-in (#2201); mit ihr
    ist er erledigt, sobald die fehlenden Seiten eingecheckt sind (D.2, die Leitung hat sie nachgetragen). Sonst ``None``."""
    from services.checkin_rules import missing_sides, no_show_info

    proposal = match.get("no_show_proposal")
    if not isinstance(proposal, dict) or proposal.get("decision"):
        return None
    if proposal.get("rule") != "check_in":
        return "league_without_check_in"
    wanted = set(proposal.get("missing_registration_ids") or []) or set(missing_sides(match))
    if not (wanted & set(missing_sides(match))):
        return "checked_in"
    # Neuer Termin (Leitung, „Neu ansetzen“ aus E.1): der Vorschlag gehört zum alten Fenster - nach dem neuen kommt er neu.
    info = no_show_info(match, tournament)
    if not info or info["due_at"].isoformat() != str(proposal.get("due_at") or ""):
        return "rescheduled"
    return None


async def _clear_league_proposal(db, tournament: dict, match: dict) -> None:
    """Liga-Staffel: ein offener Vorschlag aus der Zeit vor dem Check-in (#2201) oder ein erledigter aus dem Check-in (D.2) bleibt
    nicht stehen. Unter der Turniersperre, denn die Leitung schreibt beim Bestätigen in den Vorschlag. Entschiedene bleiben als
    Verlauf."""
    try:
        async with mutation_lock(db, tournament_write_resource(tournament["id"]), wait_seconds=2.0):
            fresh = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or {}
            reason = _league_proposal_stale(tournament, fresh)
            if not reason:
                return
            proposal = fresh.get("no_show_proposal") or {}
            await db.matches_v2.update_one({"id": match["id"], "no_show_proposal.id": proposal.get("id")},
                                           {"$set": {"no_show_proposal": None}})
    except MutationLockBusy:
        logger.info("No-show proposal of match=%s waits for the tournament lock", match.get("id"))
        return
    await _audit(db, "match.no_show.cleared", match, {"proposal_id": proposal.get("id"), "reason": reason})


def league_missing(match: dict, games: list[dict] | None) -> list[str]:
    """Seiten des Spiels ohne Aufstellung in den Maps der Erstmeldung."""
    from services.league_games import missing_lineups

    sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
    return missing_lineups(games or [], sides)


async def _auto_confirm(db, tournament: dict, match_id: str, stage: dict | None, now: datetime) -> int:
    """Die eine Meldung eintragen - unter der Turniersperre mit Turnier, Phase und Spiel, wie sie jetzt sind: eine
    inzwischen geänderte Frist oder Austragung (vor Ort) gilt."""
    try:
        async with mutation_lock(db, tournament_write_resource(tournament["id"]), wait_seconds=5.0):
            tournament, match, stage = await _fresh(db, tournament["id"], match_id)
            due = auto_confirm_due(match or {}, tournament, stage) if match else None
            report = single_report(match or {})
            if not match or not due or due > now or not report:
                return 0
            # Liga (#1650): die Maps der Erstmeldung gelten mit; die Gegenseite trägt ihre Aufstellung nach.
            games = [dict(game) for game in report.get("games") or []] or None
            missing = league_missing(match, games)
            # Teilnehmerliste (#2204): Die Liste der Meldung gilt, die Gegenseite trägt ihre nach. Ohne Maps keine Liga-Meldung.
            lineups = None
            if games and tournament.get("lineup_mode") == "series":
                from services.league_games import missing_participants

                lineups = {report.get("registration_id"): report["lineup"]} if report.get("lineup") else {}
                sides = [slot["registration_id"] for slot in match.get("slots") or [] if slot.get("registration_id")]
                missing = missing_participants(lineups, sides)
            results = report.get("results") or []
            if games and match.get("incidents"):
                # Vorfälle (D.5, #1619): je Position genau eine geltende Austragung. Passt die Meldung nicht zur Entscheidung der
                # Leitung, trägt sie das Ergebnis ein - der Job wartet still.
                from services import league_incidents

                try:
                    games, results = await league_incidents.finalize(db, match, games, results)
                except league_incidents.IncidentProblem:
                    return 0
                if lineups is None:
                    missing = league_missing(match, games)
            try:
                await submit_v2_result(
                    db, match, results, actor_id=report.get("user_id"),
                    proof_url=report.get("proof_url"), note=None, force=False, audit_action="match.result.auto_confirm",
                    games=games, lineups_missing=missing if games else None, match_lineups=lineups,
                )
            except MatchV2ResultError as exc:
                await _audit(db, "match.result.auto_confirm_failed", match, {"detail": str(exc)[:200]})
                return 0
            if games and missing:
                from services.league_games import tell_missing_lineups
                await tell_missing_lineups(db, match, missing)
            await db.matches_v2.update_one({"id": match_id}, {"$set": {
                "result_meta.auto_confirmed": True, "result_meta.auto_confirmed_at": now.isoformat(),
            }})
    except MutationLockBusy:
        logger.info("Auto confirm for match=%s waits for the tournament lock", match_id)
        return 0
    try:
        from services.change_events import publish_api_change

        await publish_api_change("POST", f"/api/matches/{match_id}/result", 200)
    except Exception:  # noqa: BLE001 - die Anzeige holt es beim nächsten Abruf
        logger.debug("Live-Meldung für Match %s nicht verschickt", match_id, exc_info=True)
    return 1


async def sweep_overdue_lineups(db, *, now: datetime) -> int:
    """Frist für die Teilnehmerliste abgelaufen (#2204): Der Fall geht einmal an die Leitung. Das Ergebnis bleibt gültig, es gibt keine
    Wertung. Trägt jemand nach, ist der Fall erledigt."""
    from services.league_games import amend_deadline_for
    from services.league_permissions import staff_user_ids
    from services.user_notifications import create_user_notification

    tournaments = await db.tournaments.find(
        {"league_context": {"$type": "object"}, "lineup_mode": "series", "status": {"$nin": ["archived", "cancelled"]}},
        {"_id": 0, "id": 1, "title": 1, "slug": 1, "league_context": 1, "lineup_amend_hours": 1, "blocked_periods": 1, "matchday_blocked_weeks": 1,
         "start_date": 1, "matchday_days": 1},
    ).to_list(500)
    count = 0
    for tournament in tournaments:
        matches = await db.matches_v2.find(
            {"tournament_id": tournament["id"], "lineups_missing.0": {"$exists": True}, "status": {"$in": ["completed", "forfeit"]},
             "games.0": {"$exists": True}, "lineup_overdue_at": None},
            {"_id": 0, "id": 1, "tournament_id": 1, "completed_at": 1, "lineups_missing": 1, "round_name": 1, "matchday_label": 1},
        ).to_list(500)
        for match in matches:
            deadline = amend_deadline_for(tournament, match)
            if not deadline or deadline >= now:
                continue
            marked = await db.matches_v2.update_one({"id": match["id"], "lineup_overdue_at": None}, {"$set": {"lineup_overdue_at": now.isoformat()}})
            if not marked.modified_count:
                continue
            count += 1
            await _audit(db, "match.lineup.overdue", match, {"sides": match.get("lineups_missing")})
            label = match.get("round_name") or match.get("matchday_label") or "ein Spiel"
            staff = await staff_user_ids(db, tournament["league_context"].get("league_id"), ("matches", "results"))
            for user_id in sorted(staff):
                await create_user_notification(
                    user_id, "Teilnehmerliste fehlt nach der Frist",
                    f"{tournament.get('title') or 'Liga'} · {label}: Eine Seite hat ihre Teilnehmerliste nicht nachgetragen. Das Ergebnis bleibt "
                    "gültig. Bitte auf der Matchseite entscheiden und mit Grund eintragen.",
                    url=f"/matches/{match['id']}", kind="match_attention",
                    meta={"category": "tournament_updates", "tournament_id": tournament["id"], "match_id": match["id"],
                          "reason": "lineup_overdue", "dedupe_key": f"lineup-overdue:{match['id']}"},
                )
    return count


async def sweep(db, *, now: datetime | None = None) -> dict:
    """Ein Lauf über alle laufenden Turniere mit offenen Spielen (#1940). Gibt zurück, wie viele Vorschläge und
    Bestätigungen er geschrieben hat."""
    now = now or now_utc()
    proposed = confirmed = 0
    tournaments = await live_tournaments_with(db, {"status": {"$in": SWEEP_STATUSES}}, job="match_deadlines", now=now)
    for tournament in tournaments:
        stage_rows = await db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)
        stages = {row["id"]: row for row in stage_rows if row.get("id")}
        matches = await db.matches_v2.find(
            {"tournament_id": tournament["id"], "status": {"$in": SWEEP_STATUSES}, "is_preview": {"$ne": True}},
            {"_id": 0},
        ).to_list(3000)
        league_staffel = is_league_staffel(tournament)
        for match in matches:
            stage = stages.get(match.get("stage_id") or "")
            if league_staffel and _league_proposal_stale(tournament, match):
                await _clear_league_proposal(db, tournament, match)
                match = {**match, "no_show_proposal": None}
            due = auto_confirm_due(match, tournament, stage)
            if due and due <= now:
                confirmed += await _auto_confirm(db, tournament, match["id"], stage, now)
                continue
            info = no_show_deadline(match, tournament, stage)
            if info and info["due_at"] <= now and not match.get("no_show_proposal"):
                proposed += await _propose_no_show(db, tournament, match, info, now)
    overdue = await sweep_overdue_lineups(db, now=now)
    # Liga-Termine (#2194): 72-h-Regel, abgelaufene Verschiebungen, überfällige Spiele - dieselben laufenden Turniere.
    from services import league_schedule_sweep, tournament_overrun

    schedule = await league_schedule_sweep.sweep(db, tournaments, now=now)
    # Liga-Check-in (#1652, D.2): Erinnerungen bei Öffnung und vor Schluss des Fensters - dieselben laufenden Turniere.
    from services import league_checkin_sweep

    checkin = await league_checkin_sweep.sweep(db, tournaments, now=now)
    # Liga-Erinnerungen (#1647, E.5): Spiel steht an (24 h / 1 h) und Termin offen - dieselben laufenden Turniere.
    from services import league_reminders

    reminders = await league_reminders.sweep(db, tournaments, now=now)
    # Veto (#1618, D.3): abgelaufene Fristen - dieselben laufenden Turniere (der eigene Job league_veto läuft dazu alle 10 Sekunden).
    from services import league_veto_sweep

    veto = await league_veto_sweep.sweep(db, tournaments, now=now)
    # Verfahren (#1619, E.2): Zielfrist, Stellungnahme, MOSS - erinnert und eskaliert nur, auch nach dem letzten Spiel der Staffel.
    from services import league_procedure_sweep

    try:
        procedures = await league_procedure_sweep.sweep(db, now=now)
    except Exception:  # noqa: BLE001 - die Erinnerung holt der nächste Lauf nach
        logger.warning("Verfahren der Liga nicht geprüft", exc_info=True)
        procedures = {}
    # Vorfälle (#1619, D.5): abgelaufene Antwortfristen gehen an die Leitung („in Klärung“) - dieselben laufenden Turniere.
    from services import league_incidents

    incidents = await league_incidents.sweep(db, tournaments, now=now)
    # Turnier nach dem Ende noch „Live“ (#2194): für alle Turniere, eine Abfrage je laufendem Turnier nach dem Ende.
    try:
        overrun = await tournament_overrun.refresh(db, now=now)
    except Exception:  # noqa: BLE001 - die Anzeige holt es im nächsten Lauf
        logger.warning("Stand „läuft länger“ nicht aktualisiert", exc_info=True)
        overrun = {}
    return {"proposed": proposed, "confirmed": confirmed, "overdue_lineups": overdue, "schedule": schedule, "checkin": checkin,
            "veto": veto, "procedures": procedures, "incidents": incidents, "overrun": overrun, "reminders": reminders}
