"""Der Fristen-Job (#1551): einmal je Minute, auf genau einem Server (Scheduler-Job „match_deadlines“ mit Lease).

- „Nicht erschienen“: ist die Frist eines Spiels um (services/match_deadlines), legt der Job genau einen Vorschlag
  „kampflos verloren“ an das Spiel (``no_show_proposal``), schreibt „match.no_show.proposed“ ins Protokoll und meldet
  es der Turnierleitung mit Ergebnis-Recht für dieses Spiel. Sichtbar wird der Vorschlag in „Braucht Aufmerksamkeit“;
  die Turnierleitung bestätigt (Wertung über den Forfeit-Weg) oder verlängert (routes/tournament_lead_routes).
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
    NO_SHOW_RULE_TEXT,
    auto_confirm_due,
    no_show_deadline,
    single_report,
)
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
    body = (f"{tournament.get('title') or 'Turnier'} · {label}: {names} – {info['minutes']} Minuten "
            f"{NO_SHOW_RULE_TEXT[info['rule']]} sind um. Kampflos werten oder verlängern?")
    for user_id in sorted(await result_staff_user_ids(db, match)):
        await create_user_notification(
            user_id, "Nicht erschienen?", body, url=f"/tournaments/{key}/leitung?fall=ns-{match['id']}",
            kind="match_attention",
            meta={"category": "tournament_updates", "tournament_id": tournament["id"], "match_id": match["id"],
                  "reason": "no_show", "dedupe_key": f"no-show:{proposal['id']}"},
        )
    return 1


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
            try:
                await submit_v2_result(
                    db, match, report.get("results") or [], actor_id=report.get("user_id"),
                    proof_url=report.get("proof_url"), note=None, force=False, audit_action="match.result.auto_confirm",
                )
            except MatchV2ResultError as exc:
                await _audit(db, "match.result.auto_confirm_failed", match, {"detail": str(exc)[:200]})
                return 0
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
        pass
    return 1


async def sweep(db, *, now: datetime | None = None) -> dict:
    """Ein Lauf über alle laufenden Turniere. Gibt zurück, wie viele Vorschläge und Bestätigungen er geschrieben hat."""
    now = now or now_utc()
    proposed = confirmed = 0
    tournaments = await db.tournaments.find(
        {"status": "live"}, {"_id": 0, "creation_key": 0, "billing": 0}).to_list(200)
    for tournament in tournaments:
        stage_rows = await db.tournament_stages.find({"tournament_id": tournament["id"]}, {"_id": 0}).to_list(50)
        stages = {row["id"]: row for row in stage_rows if row.get("id")}
        matches = await db.matches_v2.find(
            {"tournament_id": tournament["id"], "status": {"$in": SWEEP_STATUSES}, "is_preview": {"$ne": True}},
            {"_id": 0},
        ).to_list(3000)
        for match in matches:
            stage = stages.get(match.get("stage_id") or "")
            due = auto_confirm_due(match, tournament, stage)
            if due and due <= now:
                confirmed += await _auto_confirm(db, tournament, match["id"], stage, now)
                continue
            info = no_show_deadline(match, tournament, stage)
            if info and info["due_at"] <= now and not match.get("no_show_proposal"):
                proposed += await _propose_no_show(db, tournament, match, info, now)
    return {"proposed": proposed, "confirmed": confirmed}
