"""Der XP-Stand lesen (#617; #1420: aus services/xp.py herausgelöst) - ohne Gutschrift, Meldung und Warteschlange.

Profil, App und die Erfolge-Kachel zeigen den Level-Stand; dafür brauchen sie nur ``user_xp`` und die Level-Tabelle.
Eigenes Modul, damit die Erfolge-Anzeige den Stand lesen kann, ohne services/xp.py zu importieren (das stellt nach
einem Aufstieg Auswertungen in die Warteschlange und legt Benachrichtigungen an).
"""
from __future__ import annotations

from database import get_db
from models import now_utc
from services import levels


async def _is_member(user_id: str) -> bool:
    from services.membership_service import get_membership, is_active_member
    try:
        return is_active_member(await get_membership(user_id))
    except Exception:  # noqa: BLE001
        return False


async def state(user_id: str) -> dict:
    db = get_db()
    doc = await db.user_xp.find_one({"user_id": user_id}, {"_id": 0})
    return doc or {"user_id": user_id, "total": 0, "prestige": 0, "level": 1}


async def view(user_id: str) -> dict:
    """Der Level-Stand einer Person, wie Profil und App ihn zeigen."""
    doc = await state(user_id)
    return {**levels.level_view(doc.get("total", 0), doc.get("prestige", 0), member=await _is_member(user_id)), "login_streak": int(doc.get("login_streak") or 0)}


async def own_view(user_id: str) -> dict:
    """Der eigene Level-Stand - dazu, bis wann sich ein Prestige zurücknehmen lässt (sonst None). Nur für die Person
    selbst: das öffentliche Profil nutzt `view` und verrät nicht, wann jemand Prestige gemacht hat."""
    doc = await state(user_id)
    undo_until = str((doc.get("prestige_undo") or {}).get("until") or "")
    return {**await view(user_id), "prestige_undo_until": undo_until if undo_until and undo_until >= now_utc().isoformat() else None}
