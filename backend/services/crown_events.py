"""Dynamic top-3 point crowns: compute holders, persist state, notify on transitions."""
import asyncio
import logging
from datetime import datetime, timezone

from database import get_db

logger = logging.getLogger(__name__)

RANK_ORDER = {"gold": 1, "silver": 2, "bronze": 3}
CROWN_NAMES = {"gold": "Gold-Krone", "silver": "Silber-Krone", "bronze": "Bronze-Krone"}
OBSIDIAN_FLOOR = 29 * 29 * 100

_cache: dict = {"at": None, "data": None}
_CACHE_TTL = 30
_sync_state = {"pending": False}


async def _points_rows() -> list[dict]:
    db = get_db()
    tiers = await db.achievements.find({}, {"_id": 0, "code": 1, "points": 1}).to_list(4000)
    points_map = {t["code"]: int(t.get("points", 0) or 0) for t in tiers}
    neg = {g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})}
    awards = await db.user_achievements.find({}, {"_id": 0, "user_id": 1, "tier_code": 1, "group_code": 1}).to_list(50000)
    agg: dict = {}
    for a in awards:
        if a.get("group_code") in neg:
            continue
        e = agg.setdefault(a["user_id"], {"count": 0, "points": 0})
        e["count"] += 1
        e["points"] += points_map.get(a["tier_code"], 0)
    if not agg:
        return []
    users = await db.users.find(
        {"id": {"$in": list(agg.keys())}, "privacy_public_profile": True},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1},
    ).to_list(5000)
    rows = []
    for u in users:
        s = agg.get(u["id"], {})
        rows.append({
            "user_id": u["id"],
            "display_name": u.get("display_name") or u.get("username") or "Spieler",
            "points": s.get("points", 0),
            "count": s.get("count", 0),
        })
    rows.sort(key=lambda r: (-r["points"], -r["count"], (r["display_name"] or "").lower()))
    return rows


def _split_crowns(rows: list[dict]) -> tuple[dict, dict]:
    """Returns (merged crowns incl. obsidian, rank-only gold/silver/bronze)."""
    merged: dict[str, str] = {}
    for row in rows:
        if int(row.get("points", 0)) >= OBSIDIAN_FLOOR:
            merged[row["user_id"]] = "obsidian"
    rank_only: dict[str, str] = {}
    variants = ["gold", "silver", "bronze"]
    for row in rows:
        if not variants:
            break
        if merged.get(row["user_id"]) == "obsidian":
            continue
        variant = variants.pop(0)
        merged[row["user_id"]] = variant
        rank_only[row["user_id"]] = variant
    return merged, rank_only


async def _persist_and_notify(rank_crowns: dict[str, str]) -> list[dict]:
    from services.user_notifications import create_user_notification
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    state = await db.crown_state.find_one({"id": "current"}, {"_id": 0})
    if state is None:
        await db.crown_state.insert_one({"id": "current", "holders": rank_crowns, "version": 1, "updated_at": now})
        return []
    old = state.get("holders") or {}
    if old == rank_crowns:
        return []
    version = int(state.get("version", 1)) + 1
    res = await db.crown_state.update_one(
        {"id": "current", "version": state.get("version", 1)},
        {"$set": {"holders": rank_crowns, "version": version, "updated_at": now}},
    )
    if getattr(res, "modified_count", 0) == 0:
        return []  # concurrent update won the race — that run notifies
    events = []
    for uid in set(old) | set(rank_crowns):
        o, n = old.get(uid), rank_crowns.get(uid)
        if o == n:
            continue
        if n and (not o or RANK_ORDER[n] < RANK_ORDER[o]):
            events.append({"user_id": uid, "type": "gained", "variant": n, "prev": o})
        elif n and o:
            events.append({"user_id": uid, "type": "changed", "variant": n, "prev": o})
        elif o and not n:
            events.append({"user_id": uid, "type": "lost", "variant": None, "prev": o})
    for ev in events:
        uid = ev["user_id"]
        dedupe = f"crown-v{version}-{uid}"
        if ev["type"] == "gained":
            place = RANK_ORDER[ev["variant"]]
            await create_user_notification(
                uid,
                title="👑 Krone erobert!",
                body=f"Du bist jetzt Platz {place} der Punktewertung — die {CROWN_NAMES[ev['variant']]} gehört dir!",
                url="/achievements",
                kind="crown_gained",
                meta={"variant": ev["variant"], "category": "achievement", "dedupe_key": dedupe},
            )
        elif ev["type"] == "changed":
            place = RANK_ORDER[ev["variant"]]
            await create_user_notification(
                uid,
                title="Kronen-Wechsel",
                body=f"Die {CROWN_NAMES[ev['prev']]} ging an einen anderen Spieler — du trägst jetzt die {CROWN_NAMES[ev['variant']]} (Platz {place}).",
                url="/achievements",
                kind="crown_changed",
                meta={"variant": ev["variant"], "prev": ev["prev"], "category": "achievement", "dedupe_key": dedupe},
            )
        else:
            await create_user_notification(
                uid,
                title="Krone verloren",
                body=f"Deine {CROWN_NAMES[ev['prev']]} wurde von einem anderen Spieler erobert. Sammle Punkte und hol sie dir zurück!",
                url="/achievements",
                kind="crown_lost",
                meta={"prev": ev["prev"], "category": "achievement", "dedupe_key": dedupe},
            )
    return events


async def get_crowns(force: bool = False) -> dict[str, str]:
    """Merged crown map (user_id -> gold/silver/bronze/obsidian), cached briefly."""
    now = datetime.now(timezone.utc)
    if not force and _cache["at"] and (now - _cache["at"]).total_seconds() < _CACHE_TTL and _cache["data"] is not None:
        return _cache["data"]
    rows = await _points_rows()
    merged, rank_only = _split_crowns(rows)
    try:
        await _persist_and_notify(rank_only)
    except Exception as e:
        logger.warning(f"crown transition notify failed: {e}")
    _cache["at"] = now
    _cache["data"] = merged
    return merged


def schedule_crown_sync() -> None:
    """Debounced fire-and-forget crown recompute + transition notifications."""
    if _sync_state["pending"]:
        return

    async def run():
        try:
            await asyncio.sleep(2)
            await get_crowns(force=True)
        except Exception as e:
            logger.debug(f"crown sync skipped: {e}")
        finally:
            _sync_state["pending"] = False

    try:
        asyncio.get_running_loop().create_task(run())
        _sync_state["pending"] = True
    except RuntimeError:
        logger.debug("crown sync not scheduled because no event loop is running")
