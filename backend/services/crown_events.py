"""Dynamic top-3 point crowns: compute holders, persist state, notify on transitions."""
import asyncio
import logging
from datetime import datetime, timezone

from database import get_db
from services.achievement_visibility import ranked_users_query
from services.log_safe import log_safe

logger = logging.getLogger(__name__)

RANK_ORDER = {"gold": 1, "silver": 2, "bronze": 3}
CROWN_NAMES = {"gold": "Gold-Krone", "silver": "Silber-Krone", "bronze": "Bronze-Krone"}
ONYX_FLOOR = 29 * 29 * 100

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
    # Dieselben Konten wie in der Erfolge-Rangliste (#2492): ohne gesperrte, deaktivierte, gelöschte und nicht öffentliche,
    # und ohne „Erfolge öffentlich“ aus (#2126) - die Krone verriete sonst, wie viele Punkte jemand hat.
    users = await db.users.find(ranked_users_query(agg), {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(5000)
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
    """Returns (merged crowns incl. onyx, rank-only gold/silver/bronze)."""
    merged: dict[str, str] = {}
    for row in rows:
        if int(row.get("points", 0)) >= ONYX_FLOOR:
            merged[row["user_id"]] = "onyx"
    rank_only: dict[str, str] = {}
    variants = ["gold", "silver", "bronze"]
    for row in rows:
        if not variants:
            break
        if merged.get(row["user_id"]) == "onyx":
            continue
        variant = variants.pop(0)
        merged[row["user_id"]] = variant
        rank_only[row["user_id"]] = variant
    return merged, rank_only


async def _persist_and_notify(rank_crowns: dict[str, str], onyx_holders: set[str] | frozenset[str] = frozenset()) -> list[dict]:
    from services.user_notifications import create_user_notification
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    onyx_now = set(onyx_holders)
    state = await db.crown_state.find_one({"id": "current"}, {"_id": 0})
    if state is None:
        await db.crown_state.insert_one({"id": "current", "holders": rank_crowns, "onyx": sorted(onyx_now),
                                         "onyx_announced": sorted(onyx_now), "version": 1, "updated_at": now})
        return []
    old = state.get("holders") or {}
    # Onyx (#2501): Ein Stand von vor #2501 kennt nur die Rangkronen. Wer jetzt Onyx trägt und vorher keine Rangkrone hatte,
    # trug Onyx schon - neu ist nur der Wechsel von einer Rangkrone zu Onyx.
    old_onyx = set(state["onyx"]) if "onyx" in state else {uid for uid in onyx_now if uid not in old}
    # „Onyx erreicht“ einmal je Person, unabhängig vom Postfach: Wer hier steht, hat die Meldung schon bekommen - oder trug
    # Onyx schon vor #2501 und gilt damit als gemeldet.
    announced = set(state["onyx_announced"]) if "onyx_announced" in state else set(old_onyx)
    announced_now = announced | onyx_now
    if old == rank_crowns and "onyx" in state and old_onyx == onyx_now and "onyx_announced" in state and announced_now == announced:
        return []
    version = int(state.get("version", 1)) + 1
    res = await db.crown_state.update_one(
        {"id": "current", "version": state.get("version", 1)},
        {"$set": {"holders": rank_crowns, "onyx": sorted(onyx_now), "onyx_announced": sorted(announced_now),
                  "version": version, "updated_at": now}},
    )
    if getattr(res, "modified_count", 0) == 0:
        return []  # concurrent update won the race — that run notifies
    events = []
    for uid in set(old) | set(rank_crowns) | (onyx_now - old_onyx):
        o, n = old.get(uid), rank_crowns.get(uid)
        if uid in onyx_now and uid not in old_onyx:
            # Der Aufstieg zu Onyx ist kein Verlust der Rangkrone (#2501): eine Meldung „Onyx erreicht“ - nur beim ersten Mal.
            if uid not in announced:
                events.append({"user_id": uid, "type": "onyx", "variant": "onyx", "prev": o})
            continue
        if o == n:
            continue
        if uid in old_onyx and uid not in onyx_now:
            # Onyx verloren (#2501): keine Verlust-Meldung, und wer danach eine Rangkrone trägt, hat sie nicht „erobert“.
            continue
        if n and (not o or RANK_ORDER[n] < RANK_ORDER[o]):
            events.append({"user_id": uid, "type": "gained", "variant": n, "prev": o})
        elif n and o:
            events.append({"user_id": uid, "type": "changed", "variant": n, "prev": o})
        elif o and not n:
            events.append({"user_id": uid, "type": "lost", "variant": None, "prev": o})
    # „Krone verloren“ nur, wer überholt wurde und noch auf der Rangliste steht: Wer „Erfolge öffentlich“ selbst ausschaltet
    # (#2126), sein Profil verbirgt, gesperrt, deaktiviert oder gelöscht wurde (#2492), bekommt keine Meldung.
    lost_ids = [ev["user_id"] for ev in events if ev["type"] == "lost"]
    still_ranked = {row["id"] async for row in db.users.find(ranked_users_query(lost_ids), {"_id": 0, "id": 1})} if lost_ids else set()
    for ev in events:
        uid = ev["user_id"]
        dedupe = f"crown-v{version}-{uid}"
        if ev["type"] == "onyx":
            await create_user_notification(
                uid,
                title="👑 Onyx erreicht!",
                body="Du trägst jetzt die Onyx-Krone. Sie ist die höchste Krone der Punktewertung und bleibt dir, auch wenn andere dich überholen.",
                url="/achievements",
                kind="crown_onyx",
                # Einmal je Person (#2501): Wer Onyx verliert und zurückbekommt, erfährt es nicht noch einmal.
                meta={"variant": "onyx", "prev": ev["prev"], "category": "achievements", "dedupe_key": f"crown-onyx-{uid}"},
            )
        elif ev["type"] == "gained":
            place = RANK_ORDER[ev["variant"]]
            await create_user_notification(
                uid,
                title="👑 Krone erobert!",
                body=f"Du bist jetzt Platz {place} der Punktewertung — die {CROWN_NAMES[ev['variant']]} gehört dir!",
                url="/achievements",
                kind="crown_gained",
                meta={"variant": ev["variant"], "category": "achievements", "dedupe_key": dedupe},
            )
        elif ev["type"] == "changed":
            place = RANK_ORDER[ev["variant"]]
            await create_user_notification(
                uid,
                title="Kronen-Wechsel",
                body=f"Die {CROWN_NAMES[ev['prev']]} ging an einen anderen Spieler — du trägst jetzt die {CROWN_NAMES[ev['variant']]} (Platz {place}).",
                url="/achievements",
                kind="crown_changed",
                meta={"variant": ev["variant"], "prev": ev["prev"], "category": "achievements", "dedupe_key": dedupe},
            )
        elif uid in still_ranked:
            await create_user_notification(
                uid,
                title="Krone verloren",
                body=f"Du trägst die {CROWN_NAMES[ev['prev']]} gerade nicht mehr. Sammle Punkte und hol sie dir zurück!",
                url="/achievements",
                kind="crown_lost",
                meta={"prev": ev["prev"], "category": "achievements", "dedupe_key": dedupe},
            )
    return events


async def get_crowns(force: bool = False) -> dict[str, str]:
    """Merged crown map (user_id -> gold/silver/bronze/onyx), cached briefly."""
    now = datetime.now(timezone.utc)
    if not force and _cache["at"] and (now - _cache["at"]).total_seconds() < _CACHE_TTL and _cache["data"] is not None:
        return _cache["data"]
    rows = await _points_rows()
    merged, rank_only = _split_crowns(rows)
    # Erst den neuen Stand ablegen, dann melden (#2501): Die Glocke lädt die Kronen gleich nach dem Live-Hinweis, während Push
    # und Discord noch laufen - sie muss dann schon die neue Krone sehen, sonst fällt die Feier aus.
    _cache["at"] = now
    _cache["data"] = merged
    try:
        # Stiller Modus der Neuberechnung (#2340): Kronenwechsel weder speichern noch melden - der Abschluss rechnet sie
        # einmal neu, dann erfährt nur, wer netto eine Krone gewonnen, gewechselt oder verloren hat.
        from services.achievement_core import recount_silent
        if not await recount_silent(get_db()):
            await _persist_and_notify(rank_only, {uid for uid, crown in merged.items() if crown == "onyx"})
    except Exception as e:
        logger.warning("crown transition notify failed: %s", log_safe(e))
    return merged


async def forget_person(db, user_id: str) -> None:
    """Kontolöschung (#2501): Die Kennung fällt aus dem Kronen-Stand - Rangkronen, Onyx und „Onyx erreicht schon gemeldet“."""
    await db.crown_state.update_many(
        {"id": "current"},
        # Version hoch: Ein gleichzeitiger Kronen-Lauf mit dem alten Stand scheitert an der Versionsprüfung und schreibt die
        # Kennung nicht zurück; der nächste Lauf rechnet frisch.
        {"$pull": {"onyx": user_id, "onyx_announced": user_id}, "$unset": {f"holders.{user_id}": ""}, "$inc": {"version": 1}},
    )


def schedule_crown_sync() -> None:
    """Debounced fire-and-forget crown recompute + transition notifications."""
    if _sync_state["pending"]:
        return

    async def run():
        try:
            await asyncio.sleep(2)
            await get_crowns(force=True)
        except Exception as e:
            logger.debug("crown sync skipped: %s", log_safe(e))
        finally:
            _sync_state["pending"] = False

    try:
        asyncio.get_running_loop().create_task(run())
        _sync_state["pending"] = True
    except RuntimeError:
        logger.debug("crown sync not scheduled because no event loop is running")
