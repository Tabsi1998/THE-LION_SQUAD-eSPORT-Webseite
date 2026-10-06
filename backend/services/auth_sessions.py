"""App-Sitzungen aufräumen (#942).

Eine App-Sitzung gilt 90 Tage und verlängert sich mit jeder Nutzung. Liegt ein Gerät 30 Tage still (App gelöscht,
Handy gewechselt), bleibt die Sitzung trotzdem in der Liste und als gültiger Erneuerungs-Token - der tägliche Lauf
unter Betrieb → Alarme (``ops_retention``) schließt solche Sitzungen samt ihrer Token-Familie.
"""
from datetime import datetime, timedelta, timezone

STALE_APP_SESSION_DAYS = 30


async def purge_stale_app_sessions(db, *, days: int = STALE_APP_SESSION_DAYS, now: datetime | None = None) -> int:
    """Schließt App-Sitzungen ohne Aktivität seit ``days`` Tagen; Rückgabe: wie viele."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)
    rows = await db.auth_sessions.find(
        {"client": "mobile", "revoked": {"$ne": True}, "last_active": {"$lt": cutoff}},
        {"_id": 0, "user_id": 1, "family_id": 1},
    ).to_list(1000)
    closed = 0
    for row in rows:
        family_id = row.get("family_id")
        user_id = row.get("user_id")
        if not family_id or not user_id:
            continue
        stamp = {"revoked": True, "revoked_at": now, "revocation_reason": "inactive_30d"}
        await db.refresh_tokens.update_many(
            {"user_id": user_id, "revoked": {"$ne": True}, "$or": [{"family_id": family_id}, {"jti": family_id}]},
            {"$set": stamp},
        )
        await db.auth_sessions.update_many(
            {"user_id": user_id, "family_id": family_id, "revoked": {"$ne": True}},
            {"$set": stamp},
        )
        closed += 1
    return closed
