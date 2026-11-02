"""Belohnung für den Check-in beim Event: Jahrespunkte, XP und Erfolge - und ihre Rücknahme (#2127, EV12).

Einchecken vergibt einmal je Anmeldung; wer den Check-in zurücknimmt (auch „Storniert“ oder „Nicht erschienen“ nach dem
Check-in und die Absage des Events), verliert Punkte und XP wieder. Mehrfaches Hin und Her vergibt nie doppelt. Eine
abgeschlossene Jahreswertung bleibt, wie sie ist (wie ``sync_tournament_points``, #2123): der Eintrag steht dann weiter
dort, und ein erneuter Check-in legt keinen zweiten in der neuen Wertung an. Erfolge bleiben - sie stehen schon im Profil
und werden nicht still zurückgenommen.

Personen ohne Konto (an der Tür eingetragen, EV17) bekommen nichts.
"""
from __future__ import annotations

import logging

from services.log_safe import log_safe

logger = logging.getLogger("tls.events.rewards")

XP_SOURCE = "event_attended"
POINTS_SOURCE = "event"


def source_ref(event: dict, registration: dict) -> str:
    return f"{event['id']}:{registration['id']}"


def _earns(registration: dict) -> bool:
    return bool(registration.get("user_id")) and not registration.get("walk_in")


async def apply_checkin(db, event: dict, registration: dict) -> None:
    """Teilnahme bestätigt: Punkte, XP und Erfolge. Ein Fehler hier hält den Check-in nicht auf."""
    if not _earns(registration):
        return
    user_id = registration["user_id"]
    ref = source_ref(event, registration)
    try:
        from services.event_registration import summary
        from services.season_service import award_points

        # Auch wenn der Eintrag in einer abgeschlossenen Wertung steht: je Anmeldung nur einer.
        known = await db.season_points.find_one({"source_type": POINTS_SOURCE, "source_id": ref, "user_id": user_id}, {"_id": 0, "id": 1})
        if not known:
            counts = await summary(db, event)
            await award_points(
                user_id=user_id,
                source_type=POINTS_SOURCE,
                source_id=ref,
                source_name=event.get("name") or "Event-Teilnahme",
                rank=None,
                num_participants=max(int(counts.get("checked_in_count") or counts.get("registered_count") or 1), 1),
                weight=0.5,
                bonus=5,
                bonus_reason="Teilnahme von Admin/Moderator bestätigt",
            )
    except Exception:  # noqa: BLE001 - eine Wertung hält keinen Check-in auf
        logger.warning("Event %s: Jahrespunkte nicht vergeben", log_safe(event.get("id")), exc_info=True)
    try:
        from services import xp

        await xp.grant(user_id, XP_SOURCE, ref)
    except Exception:  # noqa: BLE001
        logger.warning("Event %s: XP nicht vergeben", log_safe(event.get("id")), exc_info=True)
    try:
        from badges import evaluate_user_progress

        await evaluate_user_progress(user_id)
    except Exception:  # noqa: BLE001
        logger.warning("Event %s: Erfolge nicht ausgewertet", log_safe(event.get("id")), exc_info=True)


async def revoke_checkin(db, event: dict, registration: dict) -> dict:
    """Check-in zurückgenommen: Punkte und XP wieder weg. Mehrfach aufgerufen ändert sich nichts mehr."""
    result = {"points_removed": 0, "points_kept_closed": 0, "xp_removed": 0}
    if not _earns(registration):
        return result
    user_id = registration["user_id"]
    ref = source_ref(event, registration)
    try:
        from services.season_service import revoke_source_points

        counts = await revoke_source_points(source_type=POINTS_SOURCE, source_id=ref, user_id=user_id)
        result.update(points_removed=counts["removed"], points_kept_closed=counts["kept_closed"])
    except Exception:  # noqa: BLE001 - eine Wertung hält die Änderung des Status nicht auf
        logger.warning("Event %s: Jahrespunkte nicht zurückgenommen", log_safe(event.get("id")), exc_info=True)
    try:
        from services import xp

        taken = await xp.revoke(user_id, XP_SOURCE, ref)
        result["xp_removed"] = int((taken or {}).get("removed") or 0)
    except Exception:  # noqa: BLE001
        logger.warning("Event %s: XP nicht zurückgenommen", log_safe(event.get("id")), exc_info=True)
    return result
