"""Darf diese Person den Shop sehen (#1706)? Die eine Antwort für alle späteren Shop-Seiten und -Routen (#1712 ff.).

Je Stufe (``services/shop_config.py``):

- Aus: niemand - auch nicht der Superadmin; verwaltet wird der Shop im Admin, nicht über die Shop-Seiten.
- Nur Admins (Test): wer den Bereich Finanzen jetzt benutzen darf (Rolle oder Freigabe, mit bestätigter
  Zwei-Faktor-Anmeldung) - Club-Admin und Superadmin bringen ihn mit.
- Vereinsmitglieder: aktive Mitgliedschaft (``membership_service.is_active_member``, wie bei anderen Mitglieder-Funktionen;
  auch Ehrenmitglieder) - und weiter die Finanzen.
- Öffentlich: alle, auch ohne Anmeldung.

Wer nicht darf, bekommt von ``require_shop_viewer`` eine 404: der Shop verrät nicht, dass es ihn gibt.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException

from auth import get_optional_user
from services import shop_config
from services.membership_service import is_active_member
from services.permissions import can_use_area

NOT_FOUND = "Diese Seite gibt es nicht."


async def _is_member(db, user: dict) -> bool:
    if user.get("is_club_member"):
        return True
    if not user.get("id"):
        return False
    return is_active_member(await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0}))


async def can_view_shop(db, user: dict | None, config: dict | None = None) -> bool:
    stage = shop_config.effective_stage(config if config is not None else await shop_config.load(db))
    if stage == "public":
        return True
    if stage == "off" or not user:
        return False
    if await can_use_area(user, "finance", db=db):
        return True
    return stage == "members" and await _is_member(db, user)


def require_shop_viewer():
    """Wächter für Shop-Seiten: liefert die Person (oder ``None`` als Gast bei „Öffentlich“), sonst 404."""
    async def dep(user: dict | None = Depends(get_optional_user)) -> dict | None:
        from database import get_db

        if not await can_view_shop(get_db(), user):
            raise HTTPException(status_code=404, detail=NOT_FOUND)
        return user

    return dep
