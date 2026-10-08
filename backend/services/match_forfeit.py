"""„Nicht erschienen“ als Wertung (Forfeit): ein Ergebnis, bei dem eine Seite nicht angetreten ist.

Die Wertung ist eine gewöhnliche Platzierung - wer nicht erschienen ist, steht hinten -, die über den einen
Ergebnis-Weg (``submit_v2_result``) läuft und damit den Baum weiterschiebt. Dazu kommen der Stand „forfeit“, die
Begründung für die betroffene Person (sie sieht sie unter ihren Strafen) und der Eintrag „nicht erschienen“.

Zwei Wege nutzen das: die Turnierleitung über ``POST /matches/{id}/forfeit`` und das Ergebnis-Fenster (#1156), wenn
im Duell eine Seite „Nicht erschienen“ hat - dort geht es erst nach den 10 Sekunden „Rückgängig“ raus.
"""
from __future__ import annotations

import logging

from models import now_utc
from services.v2_match_flows import results_for_forfeit
from services.v2_result_submission import submit_v2_result

logger = logging.getLogger("tls.match")


async def record_walkover_incident(db, match: dict, forfeiting_registration_id: str, actor_id: str) -> None:
    """Die Wertung zählt bei der Person, die nicht angetreten ist - sie sieht sie unter ihren Strafen."""
    try:
        from badges import trigger_negative_incident

        registration = await db.tournament_registrations.find_one(
            {"id": forfeiting_registration_id}, {"_id": 0, "user_id": 1})
        if registration and registration.get("user_id"):
            await trigger_negative_incident(
                registration["user_id"], "no_show",
                {"match_id": match["id"], "reason": "forfeit"}, awarded_by=actor_id)
    except Exception as exc:  # noqa: BLE001 - die Wertung gilt auch ohne den Eintrag
        logger.warning("Walkover incident failed for match=%s type=%s", match.get("id"), type(exc).__name__)


async def apply_forfeit(db, match: dict, forfeiting_registration_id: str, *, note: str, actor_id: str,
                        force: bool, reason: str | None = None, hold_id: str | None = None) -> dict:
    """Die Wertung schreiben: Platzierung über den Ergebnis-Weg, dann Stand und Begründung am Spiel."""
    results = results_for_forfeit(match, forfeiting_registration_id)
    outcome = await submit_v2_result(
        db,
        match,
        results,
        actor_id=actor_id,
        proof_url=None,
        note=note,
        force=force,
        audit_action="match.forfeit",
        reason=reason,
        hold_id=hold_id,
    )
    updated = outcome.get("match") or match
    now_iso = now_utc().isoformat()
    await db.matches_v2.update_one({"id": match["id"]}, {"$set": {
        "status": "forfeit",
        "forfeit_registration_id": forfeiting_registration_id,
        "admin_decision_note": note,
        "admin_decision_by": actor_id,
        "admin_decision_at": now_iso,
        "updated_at": now_iso,
    }})
    result = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0}) or updated
    result["idempotent_replay"] = bool(outcome.get("idempotent_replay"))
    await record_walkover_incident(db, match, forfeiting_registration_id, actor_id)
    return result
