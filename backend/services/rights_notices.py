"""Wer Rolle, Freigabe oder Vorstandsposten bekommt oder verliert, erfährt es (#2125).

Eine Meldung in Glocke und App, nicht abbestellbar: sie sagt, was sich geändert hat, welche Bereiche dazukommen oder
wegfallen und - fehlt sie noch - dass der Adminbereich die Zwei-Faktor-Anmeldung braucht. Eine Meldung darf die Änderung
selbst nie aufhalten."""
from __future__ import annotations

import logging

from services.permissions import MFA_AREAS, area_labels, areas_for
from services.user_notifications import create_user_notification

logger = logging.getLogger("tls.rights")

USER_FIELDS = {"_id": 0, "id": 1, "role": 1, "areas": 1, "mfa_enabled": 1}


async def areas_snapshot(db, user_ids) -> dict[str, set[str]]:
    """Die Bereiche dieser Personen jetzt - vor und nach einer Änderung lesen, damit die Meldung den Unterschied kennt."""
    wanted = sorted({user_id for user_id in user_ids if user_id})
    snapshot: dict[str, set[str]] = {}
    async for user in db.users.find({"id": {"$in": wanted}}, USER_FIELDS):
        snapshot[user["id"]] = await areas_for(user, db)
    return snapshot


def _sentence(headline: str, gained: set[str], lost: set[str], second_factor_missing: bool) -> str:
    parts = [headline] if headline else []
    if gained:
        parts.append(f"Neu dazu: {area_labels(gained)}.")
    if lost:
        parts.append(f"Nicht mehr dabei: {area_labels(lost)}.")
    if second_factor_missing:
        parts.append("Für den Adminbereich brauchst du die Zwei-Faktor-Anmeldung: Richte sie unter Profil → Sicherheit ein.")
    return " ".join(parts)


async def tell_rights_change(db, user_id: str | None, headline: str, before: set[str], after: set[str]) -> None:
    """Die Meldung an eine Person. Ohne Satz und ohne Unterschied bei den Bereichen geht nichts hinaus."""
    gained, lost = after - before, before - after
    if not user_id or not (headline or gained or lost):
        return
    try:
        user = await db.users.find_one({"id": user_id}, USER_FIELDS)
        if not user:
            return
        missing = bool(gained & MFA_AREAS) and not user.get("mfa_enabled")
        await create_user_notification(
            user_id, title="Deine Rechte im Verein haben sich geändert", body=_sentence(headline, gained, lost, missing),
            url="/profile?tab=security" if missing else "", kind="rights_change",
        )
    except Exception:  # noqa: BLE001 - die Meldung darf die Änderung nicht aufhalten
        logger.exception("Meldung zur Rechteänderung fehlgeschlagen")
