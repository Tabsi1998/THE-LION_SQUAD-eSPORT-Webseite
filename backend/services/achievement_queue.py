"""Erfolge sofort auswerten und gebündelt melden (#301).

Früher wertete nur der Profilbesuch aus: Wer nach dem Turniersieg nicht ins
Profil schaute, bekam den Erfolg Tage später. Jetzt stellt jedes Ereignis, das
etwas ändern kann, die Betroffenen in eine Warteschlange; ein Job arbeitet sie
alle 30 Sekunden ab - nicht im Anfrage-Pfad, und dauerhaft, damit ein Neustart
nichts verliert.

Gemeldet wird gebündelt: Mehrere Erfolge derselben Person innerhalb einer
Minute ergeben eine Discord-Meldung und eine Benachrichtigung.

Wer im Discord genannt wird: nur, wer ein öffentliches Profil hat, und nur für
Erfolgsgruppen, die öffentlich sind. Die Benachrichtigung an die Person selbst
kommt immer.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls.achievements.queue")

EVAL_DELAY_SECONDS = 5
BUNDLE_WINDOW_SECONDS = 60
BATCH = 100
SWEEP_ACTIVE_MINUTES = 20
STATE_ID = "achievement_queue_state"
LEVEL_COLORS = {1: 0xCD7F32, 2: 0xC0C0C0, 3: 0xFFD700, 4: 0x29B6E8, 5: 0xFF3B30}


# ---------------------------------------------------------------- Auswerten

async def request_evaluation(user_ids, reason: str = "") -> int:
    """Betroffene vormerken. Idempotent: eine Person steht höchstens einmal in der Schlange."""
    db = get_db()
    due = (now_utc() + timedelta(seconds=EVAL_DELAY_SECONDS)).isoformat()
    count = 0
    for user_id in {uid for uid in (user_ids or []) if uid}:
        await db.achievement_eval_queue.update_one(
            {"user_id": user_id},
            {"$set": {"user_id": user_id, "reason": reason[:60]}, "$setOnInsert": {"due_at": due, "created_at": now_utc().isoformat()}},
            upsert=True,
        )
        count += 1
    return count


async def process_queue(limit: int = BATCH) -> dict:
    from badges import evaluate_user_progress

    db = get_db()
    due = await db.achievement_eval_queue.find({"due_at": {"$lte": now_utc().isoformat()}}, {"_id": 0}).sort("due_at", 1).to_list(limit)
    awarded = 0
    for entry in due:
        # Erst löschen: Kommt während der Auswertung ein neues Ereignis, steht die Person wieder drin.
        await db.achievement_eval_queue.delete_one({"user_id": entry["user_id"]})
        try:
            awarded += await evaluate_user_progress(entry["user_id"])
        except Exception:  # noqa: BLE001 - eine kaputte Auswertung hält die anderen nicht auf
            logger.warning("[achievements] evaluation failed", exc_info=True)
    if due:
        await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "last_queue_run_at": now_utc().isoformat()}}, upsert=True)
    return {"evaluated": len(due), "awarded": awarded}


async def sweep(*, everyone: bool = False) -> dict:
    """Netz unter den Auslösern: wer zuletzt aktiv war, wird vorgemerkt - nachts alle."""
    db = get_db()
    if everyone:
        user_ids = [u["id"] async for u in db.users.find({"is_active": True, "is_banned": {"$ne": True}}, {"_id": 0, "id": 1})]
    else:
        since = now_utc() - timedelta(minutes=SWEEP_ACTIVE_MINUTES)
        user_ids = list({s["user_id"] async for s in db.auth_sessions.find({"last_active": {"$gte": since}}, {"_id": 0, "user_id": 1}) if s.get("user_id")})
    queued = await request_evaluation(user_ids, "sweep_all" if everyone else "sweep")
    field = "last_full_sweep_at" if everyone else "last_sweep_at"
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, field: now_utc().isoformat(), f"{field}_count": queued}}, upsert=True)
    return {"queued": queued, "everyone": everyone}


async def scheduled_sweep() -> dict:
    """Alle 15 Minuten die Aktiven; einmal am Tag alle."""
    db = get_db()
    state = await db.settings.find_one({"id": STATE_ID}, {"_id": 0}) or {}
    last_full = state.get("last_full_sweep_at")
    needs_full = not last_full or last_full < (now_utc() - timedelta(hours=24)).isoformat()
    return await sweep(everyone=needs_full)


async def queue_state() -> dict:
    db = get_db()
    state = await db.settings.find_one({"id": STATE_ID}, {"_id": 0, "id": 0}) or {}
    state["waiting"] = await db.achievement_eval_queue.count_documents({})
    state["unannounced"] = await db.achievement_outbox.count_documents({})
    return state


# ---------------------------------------------------------------- Melden

async def note_award(user_id: str, tier: dict, group: dict) -> None:
    """Eine Vergabe für die gebündelte Meldung vormerken. Negative Gruppen werden nie gemeldet."""
    if group.get("is_negative"):
        return
    await get_db().achievement_outbox.insert_one({
        "id": new_id(), "user_id": user_id, "tier_code": tier.get("code"), "tier_name": tier.get("name"),
        "tier_description": tier.get("description") or "", "points": int(tier.get("points") or 0),
        "level": int(tier.get("level") or 1), "group_name": group.get("name"),
        "group_public": bool(group.get("public", True)), "created_at": now_utc().isoformat(),
    })


async def flush_awards() -> dict:
    """Je Person eine Meldung, sobald ihre älteste Vergabe eine Minute alt ist."""
    db = get_db()
    cutoff = (now_utc() - timedelta(seconds=BUNDLE_WINDOW_SECONDS)).isoformat()
    ripe_users = {row["user_id"] async for row in db.achievement_outbox.find({"created_at": {"$lte": cutoff}}, {"_id": 0, "user_id": 1})}
    sent = notified = 0
    for user_id in ripe_users:
        rows = await db.achievement_outbox.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
        if not rows:
            continue
        await db.achievement_outbox.delete_many({"id": {"$in": [row["id"] for row in rows]}})
        try:
            if await _notify_user(user_id, rows):
                notified += 1
            if await _announce(db, user_id, rows):
                sent += 1
        except Exception:  # noqa: BLE001 - eine Meldung darf die nächste nicht aufhalten
            logger.warning("[achievements] announcement failed", exc_info=True)
    return {"users": len(ripe_users), "discord": sent, "notified": notified}


def _points(rows: list[dict]) -> int:
    return sum(int(row.get("points") or 0) for row in rows)


async def _notify_user(user_id: str, rows: list[dict]) -> bool:
    from services.user_notifications import create_user_notification

    if len(rows) == 1:
        title, body = "Erfolg freigeschaltet", f"{rows[0].get('tier_name')} · +{rows[0].get('points', 0)} Punkte"
    else:
        names = ", ".join(str(row.get("tier_name")) for row in rows[:4]) + (" …" if len(rows) > 4 else "")
        title, body = f"{len(rows)} Erfolge freigeschaltet", f"{names} · +{_points(rows)} Punkte"
    created = await create_user_notification(
        user_id, title, body, url="/profile?tab=achievements", kind="achievement",
        meta={"tier_codes": [row.get("tier_code") for row in rows], "dedupe_key": f"achievement:{rows[0].get('id')}"},
    )
    return created is not None


async def _announce(db, user_id: str, rows: list[dict]) -> bool:
    """Nur öffentliche Gruppen und nur für ein öffentliches Profil - sonst erfährt der Discord nichts."""
    public_rows = [row for row in rows if row.get("group_public")]
    if not public_rows:
        return False
    user = await db.users.find_one(
        {"id": user_id, "is_active": True, "is_banned": {"$ne": True}, "privacy_public_profile": True},
        {"_id": 0, "username": 1, "display_name": 1},
    )
    if not user:
        return False
    from discord_service import send_event

    name = user.get("display_name") or user.get("username") or "Spieler"
    url = f"/u/{user['username']}" if user.get("username") else None
    top = max(public_rows, key=lambda row: (row.get("level", 1), row.get("points", 0)))
    if len(public_rows) == 1:
        row = public_rows[0]
        title = f"🏆 {row.get('group_name')} · {row.get('tier_name')}"
        description = f"**{name}** hat **{row.get('tier_name')}** freigeschaltet!\n_{row.get('tier_description')}_"
    else:
        title = f"🏆 {len(public_rows)} Erfolge freigeschaltet"
        lines = "\n".join(f"• **{row.get('tier_name')}** ({row.get('group_name')})" for row in public_rows[:10])
        more = f"\n… und {len(public_rows) - 10} weitere" if len(public_rows) > 10 else ""
        description = f"**{name}** räumt ab:\n{lines}{more}"
    result = await send_event(
        "achievement.awarded", title, description, color=LEVEL_COLORS.get(top.get("level", 1), 0x29B6E8), url=url,
        fields=[{"name": "Punkte", "value": f"+{_points(public_rows)}", "inline": True}],
    )
    return bool(result.get("ok"))
