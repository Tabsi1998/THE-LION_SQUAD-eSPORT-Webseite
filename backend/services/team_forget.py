"""Personenlöschung in aufgelösten Teams (#2128, TM8): die Person verschwindet sofort aus ``dissolved_teams``.

Eigenes Blatt-Modul: Die Kontolöschung (``services/account_erasure.py``) ruft es auf, und das Aufräumen nach der Frist
(``services/team_dissolve.py``) löscht Dateien über die Kontolöschung - beides zusammen wäre ein Import-Kreis."""
from __future__ import annotations

from models import now_utc


def _without_person(row: dict, user_id: str) -> dict:
    """Die Person aus Mitgliedern, Rollen, Co-Teams und Mitgliederzeilen nehmen - das Team bleibt bis zum Ende der Frist."""
    changes: dict = {
        "member_ids": [uid for uid in row.get("member_ids") or [] if uid != user_id],
        "co_leader_ids": [uid for uid in row.get("co_leader_ids") or [] if uid != user_id],
        "memberships": [member for member in row.get("memberships") or [] if member.get("user_id") != user_id],
    }
    if row.get("leader_id") == user_id:
        changes["leader_id"] = None
    if row.get("dissolved_by") == user_id:
        changes["dissolved_by"] = None
    squads = []
    for squad in row.get("squads") or []:
        clean = {**squad, "member_ids": [uid for uid in squad.get("member_ids") or [] if uid != user_id]}
        for field in ("captain_id", "vice_captain_id"):
            if clean.get(field) == user_id:
                clean.pop(field)
        if clean.get("created_by") == user_id:
            clean["created_by"] = None
        squads.append(clean)
    changes["squads"] = squads
    return changes


async def forget_person(db, user_id: str) -> int:
    """Personenlöschung: gilt auch für aufgelöste Teams. Bleibt niemand übrig, lässt sich das Team nicht mehr führen - die
    Frist endet sofort, und der tägliche Job räumt beim nächsten Lauf auf (``team_dissolve.purge_dissolved_teams``).
    Beim Nachzug einer Löschung läuft das wieder - es ändert dann nichts."""
    rows = await db.dissolved_teams.find({"purged_at": {"$exists": False}, "$or": [
        {"member_ids": user_id}, {"leader_id": user_id}, {"co_leader_ids": user_id}, {"dissolved_by": user_id},
        {"memberships.user_id": user_id}, {"squads.member_ids": user_id}, {"squads.captain_id": user_id},
        {"squads.vice_captain_id": user_id}, {"squads.created_by": user_id},
    ]}, {"_id": 0}).to_list(200)
    for row in rows:
        changes = _without_person(row, user_id)
        if not changes["member_ids"]:
            changes["purge_at"] = now_utc().isoformat()
        await db.dissolved_teams.update_one({"id": row["id"]}, {"$set": changes})
    return len(rows)
