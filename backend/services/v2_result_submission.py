"""Single implementation for idempotent v2 match-result persistence."""
from __future__ import annotations

import hashlib
import json
import logging

from models import now_utc
from services.match_notifications import notify_match_result_confirmed
from services.match_v2_results import (
    build_v2_result_application,
    checked_results,
    ensure_correction_allowed,
    is_v2_result_replay,
    normalize_v2_results,
)
from services.station_runtime import release_station_for_match
from services.competition_usage import GRAPH, record_write
from services.heat_no_show import result_marks


logger = logging.getLogger("tls.match_results")
# Ergebnisse aus Spieler-Meldungen: zwei gleiche Meldungen oder eine Meldung nach Ablauf der Frist (#1551).
PLAYER_RESULT_ACTIONS = {"match.result.auto_resolution", "match.result.auto_confirm"}


def _submission_identity(
    match: dict,
    raw_results: list[dict],
    proof_url: str | None,
    note: str | None,
    force: bool,
) -> tuple[str, list[dict]]:
    normalized = normalize_v2_results(match, raw_results)
    parent_report_id = (match.get("result_meta") or {}).get("report_id")
    payload = {
        "match_id": match["id"],
        "parent_report_id": parent_report_id,
        "results": normalized,
        "proof_url": (proof_url or "").strip() or None,
        "note": (note or "").strip() or None,
        "force": bool(force),
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    return f"v2-result-{digest}", normalized


async def _upsert_result_audit(
    db,
    *,
    audit_action: str,
    match: dict,
    actor_id: str,
    report_id: str,
    advanced_match_ids: list[str],
    force: bool,
    created_at: str,
    reason: str | None = None,
    hold_id: str | None = None,
    history: dict | None = None,
) -> None:
    # Gegenstueck zur Messung im klassischen Pfad: hier laeuft die Graph-Engine.
    await record_write(GRAPH, audit_action, tournament_id=match.get("tournament_id"))
    await db.audit_logs.update_one(
        {"id": f"audit-{report_id}"},
        {"$setOnInsert": {
            "id": f"audit-{report_id}",
            "action": audit_action,
            "target_id": match["tournament_id"],
            "actor_id": actor_id,
            "data": {
                "match_id": match["id"],
                "stage_id": match["stage_id"],
                "match_key": match.get("match_key"),
                "advanced_matches": advanced_match_ids,
                "force": force,
                "report_id": report_id,
                # Korrektur mit Grund (#1156) und ob das Ergebnis erst nach „Rückgängig“ rausging.
                **({"reason": reason} if reason else {}),
                **({"held": True, "hold_id": hold_id} if hold_id else {}),
                # Historie (#1035): welcher Eintrag ersetzt wurde und welche Folgespiele dabei zurückgesetzt wurden.
                **(history or {}),
            },
            "created_at": created_at,
        }},
        upsert=True,
    )


async def _close_disputes(db, match: dict, actor_id: str, now_iso: str) -> None:
    """Die Turnierleitung hat ein Ergebnis zu einem Spiel in Klärung eingetragen - damit ist der Dispute entschieden
    (#1134). Jeder offene Dispute bekommt „entschieden am/von“, das Spiel ebenso."""
    disputes = [
        {**row, "resolved_at": row.get("resolved_at") or now_iso, "resolved_by": row.get("resolved_by") or actor_id}
        for row in match.get("disputes") or [] if isinstance(row, dict)
    ]
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "disputes": disputes, "dispute_resolved_at": now_iso, "dispute_resolved_by": actor_id,
    }})


async def eliminated_registration_ids(db, tournament_id: str | None) -> set[str]:
    """Wer disqualifiziert oder ausgetreten ist (#1553), rückt bei keinem Ergebnis und keiner Korrektur mehr ein."""
    if not tournament_id:
        return set()
    rows = await db.tournament_registrations.find(
        {"tournament_id": tournament_id, "status": {"$in": ["withdrawn", "disqualified"]}}, {"_id": 0, "id": 1},
    ).to_list(1000)
    return {row["id"] for row in rows if row.get("id")}


async def _finish_reset_side_effects(db, match: dict, reset_docs: list[dict], now_iso: str) -> None:
    """Folgespiele, die eine Korrektur zurückgesetzt hat (#1553, Ziel 4): Station und Aufruf frei, die Spieler der
    alten Paarung informiert (auch, wer nicht mehr drinsteht), ein Anzeige-Ereignis für Baum und TV."""
    from services.change_events import publish_tournament_event
    from services.match_audience import playing_user_ids, registrations_for_match
    from services.user_notifications import create_user_notification

    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
    for before in reset_docs:
        try:
            await release_station_for_match(db, before, "matches_v2")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Station release failed for reset match=%s type=%s", before.get("id"), type(exc).__name__)
        try:
            registrations = await registrations_for_match(db, before)
            name = before.get("round_name") or before.get("match_key") or "Dein Spiel"
            for user_id in sorted(await playing_user_ids(db, registrations)):
                await create_user_notification(
                    user_id, "Paarung geändert",
                    f"{tournament.get('title') or 'Turnier'}: {name} wurde nach einer Korrektur neu gesetzt. "
                    "Bitte die neue Paarung und den Aufruf abwarten.",
                    url=f"/matches/{before.get('id')}", kind="match_result",
                    meta={"match_id": before.get("id"), "tournament_id": before.get("tournament_id"),
                          "reason": "pairing_changed", "dedupe_key": f"pairing-changed:{before.get('id')}:{now_iso}"},
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Reset notice failed for match=%s type=%s", before.get("id"), type(exc).__name__)
    try:
        await publish_tournament_event(str(match.get("tournament_id") or ""), "result_corrected", match_ids=[match.get("id")])
    except Exception:  # noqa: BLE001
        logger.debug("Live-Meldung „korrigiert“ für Match %s nicht verschickt", match.get("id"), exc_info=True)


async def _finish_result_side_effects(db, match: dict, force: bool, dispute_resolved: bool = False) -> None:
    # Bracket im Discord (#571): jedes bestätigte Ergebnis merkt das Turnier für die nächste Bearbeitung vor.
    try:
        from services.discord_bracket import request_refresh
        request_refresh(str(match.get("tournament_id") or ""))
    except Exception:  # noqa: BLE001
        logger.debug("Discord-Baum für Turnier %s nicht vorgemerkt", match.get("tournament_id"), exc_info=True)
    try:
        await notify_match_result_confirmed(db, match, "matches_v2", force=force, dispute_resolved=dispute_resolved)
    except Exception as exc:
        logger.warning(
            "Result notification failed for match=%s type=%s",
            match.get("id"),
            type(exc).__name__,
        )
    try:
        await release_station_for_match(db, match, "matches_v2")
    except Exception as exc:
        logger.warning(
            "Station release failed for match=%s type=%s",
            match.get("id"),
            type(exc).__name__,
        )


def _withdrawn_walkovers(match: dict, application: dict, reset_matches: list[dict], *,
                         from_players: bool = False) -> tuple[list[dict], list[str]]:
    """Welche Wertungen „nicht erschienen“ mit diesem Ergebnis wegfallen. Am Spiel selbst werden die Felder der Wertung
    gleich mit dem Ergebnis geleert; ``apply_forfeit`` setzt sie danach neu, wenn die Korrektur wieder eine Wertung ist."""
    withdrawn = []
    previous = match.get("forfeit_registration_id")
    still_forfeit = {row.get("registration_id") for row in application["results"] if row.get("forfeit")}
    if previous and previous not in still_forfeit:
        application["match_set"].update({
            "forfeit_registration_id": None,
            "admin_decision_note": None,
            "admin_decision_by": None,
            "admin_decision_at": None,
        })
        withdrawn.append({"match_id": match["id"], "registration_id": previous})
    # „Nicht erschienen“ im Lauf (#1823, services.heat_no_show): wer markiert war und mit Platz eingetragen ist, ist doch
    # gefahren - Markierung und Eintrag fallen weg. Wen die Leitung erst hier als „nicht erschienen“ setzt, wird markiert
    # wie über die Turnierleitung (der Eintrag folgt nach dem Schreiben).
    fields, marked_now, raced = result_marks(match, application["results"], from_players=from_players)
    if fields:
        application["match_set"].update(fields)
    withdrawn.extend({"match_id": match["id"], "registration_id": item} for item in raced)
    withdrawn.extend(
        {"match_id": row["id"], "registration_id": row["forfeit_registration_id"]}
        for row in reset_matches if row.get("forfeit_registration_id")
    )
    return withdrawn, marked_now


async def submit_v2_result(
    db,
    match: dict,
    raw_results: list[dict],
    *,
    actor_id: str,
    proof_url: str | None,
    note: str | None,
    force: bool,
    audit_action: str,
    reason: str | None = None,
    hold_id: str | None = None,
) -> dict:
    """Persist one v2 result while the caller owns the tournament write lease.

    ``reason``: warum die Turnierleitung ein fertiges Ergebnis korrigiert (#1156) - steht am Ergebnis und im Protokoll.
    ``hold_id``: das Ergebnis lag 10 Sekunden für „Rückgängig“ bereit (services/result_hold) - unter dieser Kennung.

    Jeder Weg schreibt hier und prüft hier denselben Vertrag (services/match_v2_results): die Werte samt Best-of und,
    hat das Spiel schon ein Ergebnis, Korrektur nur mit ``force`` und Grund."""
    if is_v2_result_replay(match, raw_results, proof_url=proof_url, note=note):
        meta = match.get("result_meta") or {}
        report_id = meta.get("report_id")
        advanced_match_ids = meta.get("advanced_match_ids") or []
        if report_id:
            await _upsert_result_audit(
                db,
                audit_action=audit_action,
                match=match,
                actor_id=match.get("completed_by") or actor_id,
                report_id=report_id,
                advanced_match_ids=advanced_match_ids,
                force=bool(meta.get("force")),
                created_at=meta.get("confirmed_at") or match.get("completed_at") or now_utc().isoformat(),
            )
            await _finish_result_side_effects(db, match, bool(meta.get("force")))
        return {
            "ok": True,
            "match": match,
            "advanced_match_ids": advanced_match_ids,
            "report_id": report_id,
            "idempotent_replay": True,
        }

    ensure_correction_allowed(match, force=force, reason=reason)
    await checked_results(db, match, raw_results)
    stage_matches = await db.matches_v2.find(
        {"stage_id": match["stage_id"]},
        {"_id": 0},
    ).to_list(3000)
    now_iso = now_utc().isoformat()
    report_id, normalized_results = _submission_identity(match, raw_results, proof_url, note, force)
    # Die Paarung vor der Korrektur (#1553): der Anwender setzt die Plätze der Folgespiele direkt um; wer vorher
    # drinstand, soll trotzdem erfahren, dass sein Spiel neu gesetzt wurde.
    seats_before = {row["id"]: [dict(slot) for slot in row.get("slots") or []] for row in stage_matches if row.get("id")}
    application = build_v2_result_application(
        match,
        stage_matches,
        normalized_results,
        actor_id=actor_id,
        now_iso=now_iso,
        proof_url=proof_url,
        note=note,
        force=force,
        eliminated=await eliminated_registration_ids(db, match.get("tournament_id")),
    )
    advanced_match_ids = list(application["target_sets"].keys())
    reset_matches = application.get("reset_matches") or []
    reset_ids = {row["id"] for row in reset_matches}
    reset_docs = [{**row, "slots": seats_before.get(row["id"]) or []} for row in stage_matches if row.get("id") in reset_ids]
    # Eine Wertung „nicht erschienen“, die nicht mehr gilt (#1035): die Korrektur nimmt Wertung, Begründung und den
    # Eintrag bei der Person zurück - am Spiel selbst und in zurückgesetzten Folgespielen.
    withdrawn, marked_now = _withdrawn_walkovers(match, application, reset_matches,
                                                 from_players=audit_action in PLAYER_RESULT_ACTIONS)
    previous_report_id = (match.get("result_meta") or {}).get("report_id")
    history = {
        **({"replaces_report_id": previous_report_id} if previous_report_id else {}),
        **({"reset_matches": [row["id"] for row in reset_matches]} if reset_matches else {}),
        **({"withdrawn_walkovers": withdrawn} if withdrawn else {}),
    }
    application["match_set"]["result_meta"].update({
        "report_id": report_id,
        "advanced_match_ids": advanced_match_ids,
        # Für „Rückgängig“ (#1156): in welchem Stand das Spiel vor dem Ergebnis war.
        "previous_status": match.get("status"),
        **({"hold_id": hold_id} if hold_id else {}),
        **({"correction_reason": reason.strip()} if (reason or "").strip() else {}),
    })

    await db.match_reports_v2.update_one(
        {"id": report_id},
        {"$setOnInsert": {
            "id": report_id,
            "match_id": match["id"],
            "tournament_id": match["tournament_id"],
            "stage_id": match["stage_id"],
            "reporter_user_id": actor_id,
            "source": "players" if audit_action in PLAYER_RESULT_ACTIONS else "staff",
            "results": application["results"],
            "proof_url": (proof_url or "").strip() or None,
            "note": (note or "").strip() or None,
            "force": force,
            "created_at": now_iso,
            # Historie (#1035): was vorher galt, warum es sich ändert und welche Folgespiele dabei zurückgesetzt wurden.
            **({"reason": reason.strip()} if (reason or "").strip() else {}),
            **({"replaces_report_id": previous_report_id} if previous_report_id else {}),
            **({"previous_results": match.get("results")} if match.get("results") else {}),
            **({"reset_matches": reset_matches} if reset_matches else {}),
        }},
        upsert=True,
    )
    # Downstream writes are safe to repeat.  Commit the source match last so a
    # retry after interruption will resume rather than mistaking partial work
    # for a completed replay.
    for target_id, update in application["target_sets"].items():
        await db.matches_v2.update_one({"id": target_id}, {"$set": update})
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": application["match_set"]})
    if marked_now:
        from services.heat_no_show import record_marks
        await record_marks(db, {**match, **application["match_set"]}, marked_now, actor_id=actor_id, source="result")
    if withdrawn:
        from services.walkover_incidents import revoke_walkover_incident
        for row in withdrawn:
            await revoke_walkover_incident(db, row["match_id"], row["registration_id"])

    await _upsert_result_audit(
        db,
        audit_action=audit_action,
        match=match,
        actor_id=actor_id,
        report_id=report_id,
        advanced_match_ids=advanced_match_ids,
        force=force,
        created_at=now_iso,
        reason=(reason or "").strip() or None,
        hold_id=hold_id,
        history=history,
    )
    # Gemischt (#1548): hat dieses Ergebnis eine Runde fertig gemacht, ist die Folgerunde ausgelost - ins Protokoll mit
    # der Person, die das Ergebnis eingetragen hat, und als Live-Ereignis.
    if application.get("draws"):
        from services.draw_records import record_draws
        await record_draws(db, application["draws"], actor_id=actor_id, tournament_id=match.get("tournament_id"))
    dispute_resolved = match.get("status") == "disputed"
    if dispute_resolved:
        await _close_disputes(db, match, actor_id, now_iso)
    updated = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    await _finish_result_side_effects(db, updated, force, dispute_resolved=dispute_resolved)
    if reset_docs:
        await _finish_reset_side_effects(db, updated, reset_docs, now_iso)
    # Unterbesetzte Läufe (#1550): jedes Ergebnis - auch Korrektur, Wertung und Freilos-Kette - ändert, was die
    # Folgeläufe erwarten; der Aufrufer hält die Turnier-Schreibsperre.
    from services.heat_rebuild import evaluate_after_write
    await evaluate_after_write(db, match.get("tournament_id"), actor_id=actor_id, trigger="result")
    return {
        "ok": True,
        "match": updated,
        "advanced_match_ids": advanced_match_ids,
        "report_id": report_id,
        "reset_match_ids": [row["id"] for row in reset_matches],
        "idempotent_replay": False,
    }
