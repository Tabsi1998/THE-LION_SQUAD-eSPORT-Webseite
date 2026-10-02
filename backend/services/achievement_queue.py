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
# Erfolge II (#611): Farbe je Material für Einbettungen; das alte Level bleibt als Rückfall.
MATERIAL_COLORS = {key: int(str(value["color"]).lstrip("#"), 16) for key, value in __import__("achievement_catalog").MATERIALS.items()}


# ---------------------------------------------------------------- Auswerten

async def request_evaluation(user_ids, reason: str = "", sources=None) -> int:
    """Betroffene vormerken. Idempotent: eine Person steht höchstens einmal in der Schlange. Mit ``sources``
    (#616) merkt sich der Eintrag, welche Zähler dran sind; ohne Quelle wird alles gerechnet."""
    db = get_db()
    due = (now_utc() + timedelta(seconds=EVAL_DELAY_SECONDS)).isoformat()
    count = 0
    for user_id in {uid for uid in (user_ids or []) if uid}:
        update = {"$set": {"user_id": user_id, "reason": reason[:60]}, "$setOnInsert": {"due_at": due, "created_at": now_utc().isoformat()}}
        if sources:
            update["$addToSet"] = {"sources": {"$each": sorted(set(sources))}}
        else:
            update["$set"]["full"] = True
        await db.achievement_eval_queue.update_one({"user_id": user_id}, update, upsert=True)
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
            sources = None if entry.get("full") or not entry.get("sources") else set(entry["sources"])
            awarded += await evaluate_user_progress(entry["user_id"], sources)
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
        "level": int(tier.get("level") or 1), "material": tier.get("material"), "group_name": group.get("name"),
        # Für das Abzeichen im Postfach (#622): Motiv und Symbol der Stufe.
        "art": tier.get("art"), "icon": tier.get("icon") or group.get("icon"), "rank": int(tier.get("rank") or 0),
        "group_public": bool(group.get("public", True)), "created_at": now_utc().isoformat(),
    })


async def flush_awards() -> dict:
    """Je Person eine Meldung, sobald ihre älteste Vergabe eine Minute alt ist."""
    db = get_db()
    cutoff = (now_utc() - timedelta(seconds=BUNDLE_WINDOW_SECONDS)).isoformat()
    ripe_users = {row["user_id"] async for row in db.achievement_outbox.find({"created_at": {"$lte": cutoff}}, {"_id": 0, "user_id": 1})}
    notified = 0
    for user_id in ripe_users:
        rows = await db.achievement_outbox.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(200)
        if not rows:
            continue
        await db.achievement_outbox.delete_many({"id": {"$in": [row["id"] for row in rows]}})
        try:
            # Seit #566 erfährt nur die Person davon (In-App, Push, mit #568 als Gratulation vom Bot) - kein Kanal mehr.
            if await _notify_user(user_id, rows):
                notified += 1
        except Exception:  # noqa: BLE001 - eine Meldung darf die nächste nicht aufhalten
            logger.warning("[achievements] notification failed", exc_info=True)
    return {"users": len(ripe_users), "notified": notified}


def _points(rows: list[dict]) -> int:
    return sum(int(row.get("points") or 0) for row in rows)


def top_award(rows: list[dict]) -> dict:
    """Das Wertvollste eines Pakets: höchstes Material (Reihenfolge der Leiter), dann die meisten Punkte."""
    order = list(__import__("achievement_catalog").MATERIALS)
    return max(rows, key=lambda row: (order.index(row["material"]) if row.get("material") in order else -1, int(row.get("level") or 0), int(row.get("points") or 0)))


def material_name(material: str | None) -> str:
    return str((__import__("achievement_catalog").MATERIALS.get(material or "") or {}).get("name") or "")


async def _share_award_id(user_id: str, top: dict) -> str | None:
    """Für „Legendär“ (#622): die Vergabe, deren Teilen-Karte die DM als Bild zeigt - nur wenn sie geteilt werden darf."""
    if top.get("material") != "legendary":
        return None
    from services.achievement_share import share_payload

    db = get_db()
    award = await db.user_achievements.find_one({"user_id": user_id, "tier_code": top.get("tier_code")}, {"_id": 0, "id": 1})
    if not award or not award.get("id"):
        return None
    return award["id"] if await share_payload(db, award["id"]) else None


async def _notify_user(user_id: str, rows: list[dict]) -> bool:
    from services.user_notifications import create_user_notification

    # Ein Paket ist eine Meldung (#622): Postfach, höchstens eine Push, eine DM - mit dem Wertvollsten vorne.
    top = top_award(rows)
    top_label = f"{material_name(top.get('material'))}: {top.get('tier_name')}" if material_name(top.get("material")) else str(top.get("tier_name"))
    if len(rows) == 1:
        title, body = "Erfolg freigeschaltet", f"{top_label} · +{rows[0].get('points', 0)} Punkte"
    else:
        title, body = f"{len(rows)} neue Erfolge", f"darunter {top_label} · +{_points(rows)} Punkte"
    # Was die Gratulation per Discord (#568) braucht: Namen, Gruppe, Punkte und Stufe je Erfolg.
    awards = [{"name": row.get("tier_name"), "group": row.get("group_name"), "points": int(row.get("points") or 0), "level": int(row.get("level") or 1), "material": row.get("material")} for row in rows[:10]]
    meta = {"tier_codes": [row.get("tier_code") for row in rows], "dedupe_key": f"achievement:{rows[0].get('id')}",
            "awards": awards, "points": _points(rows), "level": max(int(row.get("level") or 1) for row in rows),
            "top": {"name": top.get("tier_name"), "material": top.get("material"), "level": int(top.get("level") or 1),
                    "rank": int(top.get("rank") or 0), "art": top.get("art"), "icon": top.get("icon")}}
    share_id = await _share_award_id(user_id, top)
    if share_id:
        meta["share_award_id"] = share_id
    created = await create_user_notification(user_id, title, body, url="/profile?tab=achievements", kind="achievement", meta=meta)
    return created is not None
