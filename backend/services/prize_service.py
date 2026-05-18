"""Phase 9: PrizePickup service. Auto-creates pickup tickets when tournaments
publish results, sends emails via the mail queue and tracks pickup status.

Status flow: pending  → ready → picked_up
                              → expired (after deadline reached)
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls.prizes")

DEFAULT_PICKUP_WINDOW_DAYS = 90


def _ordinal(rank: int) -> str:
    return f"{rank}."


async def auto_create_for_tournament(tid: str) -> int:
    """Build PrizePickups when tournament results are published.

    Reads `prize_places` (list of {group, place, label, value}) and the placements that
    were derived from matches.final_position. Idempotent: skips already-existing
    (tournament_id, user_id, place) combinations.

    Bracket-specific prize groups are displayed publicly, but are not auto-assigned
    here until bracket-specific final placements exist in match data.
    """
    db = get_db()
    t = await db.tournaments.find_one({"id": tid}, {"_id": 0}) or {}
    prize_places = t.get("prize_places") or []
    if not prize_places:
        return 0

    regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
    reg_map = {r["id"]: r for r in regs}
    matches = await db.matches.find(
        {"tournament_id": tid, "final_position": {"$ne": None}}, {"_id": 0}
    ).to_list(500)

    placement_by_rank: dict[int, dict] = {}
    for m in matches:
        rid = m.get("winner_id")
        rank = m.get("final_position")
        if not rid or not rank or rid not in reg_map:
            continue
        if rank in placement_by_rank:
            continue  # already mapped (first writer wins)
        reg = reg_map[rid]
        placement_by_rank[rank] = {
            "user_id": reg.get("user_id"),
            "team_id": reg.get("team_id"),
        }
    last_rank = max(placement_by_rank.keys(), default=0)

    created = 0
    deadline = (now_utc() + timedelta(days=DEFAULT_PICKUP_WINDOW_DAYS)).isoformat()
    for prize in prize_places:
        prize_group = prize.get("group") or "overall"
        if prize_group != "overall":
            continue
        try:
            raw_place = prize.get("place")
            place = last_rank if str(raw_place).lower() in {"last", "letzter", "-1"} else int(raw_place)
        except Exception:
            continue
        winner = placement_by_rank.get(place)
        if not winner:
            continue
        uid = winner.get("user_id")
        team_id = winner.get("team_id")
        if not (uid or team_id):
            continue
        # idempotent
        existing = await db.prize_pickups.find_one({
            "tournament_id": tid,
            "place": place,
            "user_id": uid,
            "team_id": team_id,
        })
        if existing:
            continue
        doc = {
            "id": new_id(),
            "tournament_id": tid,
            "tournament_title": t.get("title"),
            "tournament_slug": t.get("slug"),
            "user_id": uid,
            "team_id": team_id,
            "place": place,
            "prize_group": prize_group,
            "place_label": prize.get("label") or _ordinal(place),
            "prize_label": prize.get("label") or "",
            "prize_value": prize.get("value") or "",
            "status": "pending",
            "pickup_deadline": deadline,
            "ready_at": None,
            "picked_up_at": None,
            "picked_up_by": None,
            "notes": "",
            "created_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        }
        await db.prize_pickups.insert_one(doc)
        created += 1
        if uid:
            try:
                from services.user_notifications import create_user_notification
                prize_text = doc.get("prize_value") or doc.get("prize_label") or "ein Preis"
                await create_user_notification(
                    uid,
                    "Gewinn vorgemerkt",
                    f"{doc.get('place_label') or _ordinal(place)} Platz bei {t.get('title') or 'dem Turnier'}: {prize_text}. Sobald der Gewinn abholbereit ist, bekommst du die naechste Meldung.",
                    url="/me/prizes",
                    kind="prize_pending",
                    meta={"tournament_id": tid, "pickup_id": doc["id"], "place": place},
                )
            except Exception as exc:
                logger.warning(f"[prizes] notification failed for pickup {doc['id']}: {exc}")
        logger.info(f"[prizes] created pickup {doc['id']} place {place} tournament {tid}")
    return created


async def mark_ready(pickup_id: str, actor_id: str) -> Optional[dict]:
    db = get_db()
    p = await db.prize_pickups.find_one({"id": pickup_id})
    if not p:
        return None
    await db.prize_pickups.update_one(
        {"id": pickup_id},
        {"$set": {
            "status": "ready",
            "ready_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        }},
    )
    # Mail user
    if p.get("user_id"):
        u = await db.users.find_one(
            {"id": p["user_id"]},
            {"email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1},
        )
        if u and u.get("email"):
            from services.notification_preferences import send_user_template
            deadline_str = ""
            try:
                deadline_str = datetime.fromisoformat(p.get("pickup_deadline")).strftime("%d.%m.%Y")
            except Exception:
                pass
            await send_user_template(
                u, "prize_ready",
                display_name=u.get("display_name", ""),
                tournament_title=p.get("tournament_title", ""),
                place=str(p.get("place_label") or p.get("place")),
                prize_label=p.get("prize_label", ""),
                deadline=deadline_str,
            )
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


async def mark_picked_up(pickup_id: str, actor_id: str, notes: str = "") -> Optional[dict]:
    db = get_db()
    p = await db.prize_pickups.find_one({"id": pickup_id})
    if not p:
        return None
    await db.prize_pickups.update_one(
        {"id": pickup_id},
        {"$set": {
            "status": "picked_up",
            "picked_up_at": now_utc().isoformat(),
            "picked_up_by": actor_id,
            "notes": notes or p.get("notes", ""),
            "updated_at": now_utc().isoformat(),
        }},
    )
    if p.get("user_id"):
        u = await db.users.find_one(
            {"id": p["user_id"]},
            {"email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1},
        )
        if u and u.get("email"):
            from services.notification_preferences import send_user_template
            await send_user_template(
                u, "prize_picked_up",
                display_name=u.get("display_name", ""),
                tournament_title=p.get("tournament_title", ""),
                prize_label=p.get("prize_label", ""),
            )
    return await db.prize_pickups.find_one({"id": pickup_id}, {"_id": 0})


async def expire_overdue() -> int:
    """Background sweep: mark `ready`/`pending` pickups as expired when their
    deadline is in the past. Notifies users via mail queue."""
    db = get_db()
    now_iso = now_utc().isoformat()
    cursor = db.prize_pickups.find({
        "status": {"$in": ["pending", "ready"]},
        "pickup_deadline": {"$lt": now_iso},
    })
    expired = 0
    async for p in cursor:
        await db.prize_pickups.update_one(
            {"id": p["id"]},
            {"$set": {
                "status": "expired",
                "updated_at": now_utc().isoformat(),
            }},
        )
        expired += 1
        if p.get("user_id"):
            u = await db.users.find_one(
                {"id": p["user_id"]},
                {"email": 1, "display_name": 1, "username": 1, "newsletter_consent": 1, "notification_preferences": 1},
            )
            if u and u.get("email"):
                from services.notification_preferences import send_user_template
                await send_user_template(
                    u, "prize_expired",
                    display_name=u.get("display_name", ""),
                    tournament_title=p.get("tournament_title", ""),
                    prize_label=p.get("prize_label", ""),
                    dedupe_key=f"prize_expired:{p['id']}",
                )
    return expired
