"""Der Eintrag „nicht erschienen“ zu einer Wertung (Forfeit) - setzen und wieder zurücknehmen.

Eigenes Modul (#1420): ``services.v2_result_submission`` nimmt den Eintrag bei einer Korrektur zurück, und
``services.match_forfeit`` schreibt die Wertung über ``submit_v2_result`` - so importieren sich die beiden nicht im Kreis.
"""
from __future__ import annotations

import logging

from services.achievement_core import NEGATIVE_INCIDENTS

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


async def revoke_walkover_incident(db, match_id: str, forfeiting_registration_id: str) -> bool:
    """Gegenstück (#1035): gilt die Wertung nach einer Korrektur nicht mehr, fällt der Eintrag „nicht erschienen“ weg -
    aber nur der aus diesem Spiel."""
    try:
        registration = await db.tournament_registrations.find_one(
            {"id": forfeiting_registration_id}, {"_id": 0, "user_id": 1})
        if not registration or not registration.get("user_id"):
            return False
        removed = await db.user_achievements.delete_one({
            "user_id": registration["user_id"],
            "tier_code": NEGATIVE_INCIDENTS["no_show"],
            "context.match_id": match_id,
        })
        return bool(removed.deleted_count)
    except Exception as exc:  # noqa: BLE001 - die Korrektur gilt auch ohne den Eintrag
        logger.warning("Walkover incident revoke failed for match=%s type=%s", match_id, type(exc).__name__)
        return False
