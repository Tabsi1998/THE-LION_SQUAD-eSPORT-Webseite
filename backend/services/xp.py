"""XP (#617): was man tut, bringt Erfahrung - getrennt von den Erfolgspunkten, mit Tagesdeckeln, Vereinsbonus
und Prestige. Jede Gutschrift ist ein Ereignis in ``xp_events`` (nachvollziehbar, Wochenrückblick #622),
der Stand je Person steht in ``user_xp``. Ein Level-Aufstieg legt eine Benachrichtigung an; die Zeremonie
(#618) und die Push (#622) hängen sich daran.

``ref`` macht eine Gutschrift eindeutig: dasselbe Match zweimal melden bringt nichts doppelt.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from pymongo.errors import DuplicateKeyError

from database import get_db
from models import new_id, now_utc
from services import levels

logger = logging.getLogger("tls.xp")
VIENNA = ZoneInfo("Europe/Vienna")
PRESTIGE_UNDO_HOURS = 24

# Quelle → (XP je Ereignis, Deckel je Tag in Ereignissen oder None). Erfolge bringen Punkte × 10.
SOURCES: dict[str, tuple[int, int | None]] = {
    "match_played": (20, None),
    "match_won": (40, None),
    "tournament_registered": (30, None),
    "checked_in": (10, None),
    "tournament_completed": (50, None),
    "podium_1": (150, None),
    "podium_2": (100, None),
    "podium_3": (60, None),
    "lap_valid": (5, 100),
    "personal_best": (15, None),
    "pole": (50, None),
    "event_attended": (60, None),
    "discord_message": (1, 50),
    "community_chat": (1, 30),
    "team_chat": (1, 30),
    "daily_login": (10, 1),
    "friend": (10, None),
    "team_joined": (30, None),
    "season_completed": (100, None),
    "meeting": (100, None),
    "helper_hour": (50, None),
    "vote": (20, None),
    "achievement": (0, None),
    "correction": (0, None),
}
ACHIEVEMENT_FACTOR = 10
LOGIN_STREAK_STEP = 5
LOGIN_STREAK_MAX = 50


def today_key(now: datetime | None = None) -> str:
    return (now or now_utc()).astimezone(VIENNA).date().isoformat()


async def ensure_indexes(db) -> None:
    await db.xp_events.create_index([("user_id", 1), ("source", 1), ("ref", 1)], unique=True)
    await db.xp_events.create_index([("user_id", 1), ("at", -1)])
    await db.xp_events.create_index([("user_id", 1), ("source", 1), ("day", 1)])
    await db.user_xp.create_index([("total", -1)])


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


async def grant(user_id: str, source: str, ref: str, *, amount: int | None = None, count: int = 1, note: str | None = None) -> dict | None:
    """XP gutschreiben. None, wenn die Quelle unbekannt ist, der Bezug schon gezählt wurde oder der Tagesdeckel voll ist."""
    if source not in SOURCES or not user_id:
        return None
    base, cap = SOURCES[source]
    if amount is None:
        amount = base * max(1, int(count))
    if amount <= 0 and source != "correction":
        return None
    db = get_db()
    day = today_key()
    if cap is not None:
        used = await db.xp_events.count_documents({"user_id": user_id, "source": source, "day": day})
        if used >= cap:
            return None
    member = await _is_member(user_id)
    before = await state(user_id)
    prestige = int(before.get("prestige") or 0)
    bonus = int(round(amount * levels.MEMBER_BONUS)) if member and amount > 0 else 0
    event = {
        "id": new_id(), "user_id": user_id, "source": source, "ref": str(ref), "amount": int(amount), "bonus": bonus,
        "note": note, "day": day, "at": now_utc().isoformat(),
    }
    try:
        await db.xp_events.insert_one(event)
    except DuplicateKeyError:
        return None
    total_before = int(before.get("total") or 0)
    total_after = max(0, total_before + amount + bonus)
    level_before = levels.level_for_xp(total_before, prestige)
    level_after = levels.level_for_xp(total_after, prestige)
    await db.user_xp.update_one({"user_id": user_id}, {"$set": {"total": total_after, "level": level_after, "updated_at": event["at"]}, "$setOnInsert": {"user_id": user_id, "prestige": prestige}}, upsert=True)
    result = {"amount": amount, "bonus": bonus, "total": total_after, "level": level_after, "level_up": level_after > level_before, "title_changed": levels.title_for_level(level_after) != levels.title_for_level(level_before)}
    if result["level_up"]:
        await _announce_level_up(user_id, level_before, level_after, prestige)
        try:
            from services.achievement_queue import request_evaluation
            await request_evaluation([user_id], "level_up", sources={"xp"})
        except Exception:  # noqa: BLE001
            logger.debug("[xp] queue after level-up failed", exc_info=True)
    return result


async def _announce_level_up(user_id: str, before: int, after: int, prestige: int) -> None:
    try:
        from services.user_notifications import create_user_notification
        title = levels.title_for_level(after)
        changed = title != levels.title_for_level(before)
        await create_user_notification(
            user_id, f"Level {after} erreicht", f"Du bist jetzt {title}." if changed else f"Weiter so – als Nächstes {levels.next_title_at(after) or levels.MAX_LEVEL}: {levels.title_for_level(levels.next_title_at(after) or levels.MAX_LEVEL)}.",
            url="/profile?tab=achievements", kind="level",
            meta={"level": after, "previous": before, "title": title, "title_changed": changed, "prestige": prestige, "dedupe_key": f"level:{user_id}:{prestige}:{after}"},
        )
    except Exception:  # noqa: BLE001 - ein Fehler hier darf keine Gutschrift verhindern
        logger.warning("[xp] level-up notification failed", exc_info=True)


_daily_seen: dict[str, str] = {}


async def daily_login_once(user_id: str) -> dict | None:
    """Wie grant_daily_login, aber je Prozess und Tag nur ein Blick in die Datenbank."""
    day = today_key()
    if _daily_seen.get(user_id) == day:
        return None
    _daily_seen[user_id] = day
    if len(_daily_seen) > 20000:
        _daily_seen.clear()
    return await grant_daily_login(user_id)


async def grant_daily_login(user_id: str) -> dict | None:
    """Ein Tag mit Anmeldung: 10 XP plus 5 je Serientag (höchstens 50). Serie reißt nach einem Tag Pause."""
    db = get_db()
    day = today_key()
    doc = await state(user_id)
    if doc.get("last_login_day") == day:
        return None
    yesterday = (now_utc().astimezone(VIENNA).date() - timedelta(days=1)).isoformat()
    streak = int(doc.get("login_streak") or 0) + 1 if doc.get("last_login_day") == yesterday else 1
    update = {"$set": {"last_login_day": day, "login_streak": streak, "login_streak_max": max(streak, int(doc.get("login_streak_max") or 0))}, "$setOnInsert": {"user_id": user_id, "total": 0, "prestige": 0, "level": 1}}
    # Geburtstagskind (#616): eine Anmeldung am eigenen Geburtstag zählt - aus dem Profil, nie nach außen.
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "birth_date": 1}) or {}
    if str(user.get("birth_date") or "")[5:10] == day[5:10]:
        update["$inc"] = {"birthday_logins": 1}
    await db.user_xp.update_one({"user_id": user_id}, update, upsert=True)
    amount = min(SOURCES["daily_login"][0] + LOGIN_STREAK_STEP * (streak - 1), LOGIN_STREAK_MAX)
    return await grant(user_id, "daily_login", day, amount=amount)


async def grant_achievement(user_id: str, tier: dict) -> dict | None:
    points = int(tier.get("points") or 0)
    return await grant(user_id, "achievement", str(tier.get("code")), amount=points * ACHIEVEMENT_FACTOR)


async def grant_achievement_many(user_ids: list[str], tier: dict) -> list[dict]:
    points = int(tier.get("points") or 0)
    return await grant_many(user_ids, "achievement", str(tier.get("code")), amount=points * ACHIEVEMENT_FACTOR)


async def grant_many(user_ids: list[str], source: str, ref: str, *, amount: int) -> list[dict]:
    """Dieselbe Gutschrift für viele (Massenvergabe, E10) - rechnet wie ``grant``, aber in wenigen Schreibzügen:
    schon gezählte Bezüge, Stände und Mitgliedschaften gesammelt lesen, die Ereignisse in einem Zug schreiben, die
    Stände je gleichem Zuwachs und Ziel-Level gemeinsam erhöhen ($inc, atomar). Level-ups melden sich wie bei
    ``grant``. Nur für Gutschriften ohne Tagesdeckel und mit positivem Betrag - sonst einzeln."""
    from collections import defaultdict
    from pymongo.errors import BulkWriteError
    from services.membership_service import is_active_member

    ids = [uid for uid in dict.fromkeys(user_ids or []) if uid]
    if source not in SOURCES or not ids or amount <= 0:
        return []
    if SOURCES[source][1] is not None:
        out = [await grant(uid, source, ref, amount=amount) for uid in ids]
        return [r for r in out if r]
    db = get_db()
    counted = {row["user_id"] async for row in db.xp_events.find({"user_id": {"$in": ids}, "source": source, "ref": str(ref)}, {"_id": 0, "user_id": 1})}
    ids = [uid for uid in ids if uid not in counted]
    if not ids:
        return []
    states = {doc["user_id"]: doc async for doc in db.user_xp.find({"user_id": {"$in": ids}}, {"_id": 0})}
    members = {doc["user_id"] async for doc in db.memberships.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "member_status": 1}) if is_active_member(doc)}
    day = today_key()
    stamp = now_utc().isoformat()
    events, plans = [], {}
    for uid in ids:
        before = states.get(uid) or {}
        prestige = int(before.get("prestige") or 0)
        bonus = int(round(amount * levels.MEMBER_BONUS)) if uid in members and amount > 0 else 0
        events.append({"id": new_id(), "user_id": uid, "source": source, "ref": str(ref), "amount": int(amount), "bonus": bonus, "note": None, "day": day, "at": stamp})
        total_before = int(before.get("total") or 0)
        total_after = max(0, total_before + amount + bonus)
        plans[uid] = (prestige, bonus, total_before, total_after)
    try:
        await db.xp_events.insert_many(events, ordered=False)
    except BulkWriteError as exc:
        # Dazwischen schon gezählt (eindeutiger Index): diese Personen bekommen hier nichts.
        for err in (exc.details or {}).get("writeErrors", []):
            plans.pop(events[err["index"]]["user_id"], None)
    together: dict[tuple[int, int], list[str]] = defaultdict(list)
    new_docs: list[dict] = []
    results, risen = [], []
    for uid, (prestige, bonus, total_before, total_after) in plans.items():
        level_before = levels.level_for_xp(total_before, prestige)
        level_after = levels.level_for_xp(total_after, prestige)
        if uid in states:
            together[(amount + bonus, level_after)].append(uid)
        else:
            new_docs.append({"user_id": uid, "total": total_after, "level": level_after, "prestige": prestige, "updated_at": stamp})
        result = {"user_id": uid, "amount": amount, "bonus": bonus, "total": total_after, "level": level_after, "level_up": level_after > level_before,
                  "title_changed": levels.title_for_level(level_after) != levels.title_for_level(level_before)}
        results.append(result)
        if result["level_up"]:
            risen.append((uid, level_before, level_after, prestige))
    for (increment, level), uids in together.items():
        await db.user_xp.update_many({"user_id": {"$in": uids}}, {"$inc": {"total": increment}, "$set": {"level": level, "updated_at": stamp}})
    if new_docs:
        try:
            await db.user_xp.insert_many(new_docs, ordered=False)
        except BulkWriteError as exc:
            # Dazwischen angelegt: dann eben erhöhen.
            for err in (exc.details or {}).get("writeErrors", []):
                doc = new_docs[err["index"]]
                await db.user_xp.update_one({"user_id": doc["user_id"]}, {"$inc": {"total": doc["total"]}, "$set": {"level": doc["level"], "updated_at": stamp}})
    for uid, level_before, level_after, prestige in risen:
        await _announce_level_up(uid, level_before, level_after, prestige)
    if risen:
        try:
            from services.achievement_queue import request_evaluation
            await request_evaluation([uid for uid, *_ in risen], "level_up", sources={"xp"})
        except Exception:  # noqa: BLE001
            logger.debug("[xp] queue after level-up failed", exc_info=True)
    return results


async def correct(user_id: str, amount: int, reason: str, actor_id: str) -> dict:
    """Admin-Korrektur, auch negativ - immer mit Grund und Protokoll."""
    ref = f"{actor_id}:{now_utc().isoformat()}"
    result = await grant(user_id, "correction", ref, amount=int(amount), note=reason)
    await get_db().audit_logs.insert_one({"id": new_id(), "action": "xp.correction", "actor_id": actor_id, "target_id": user_id, "data": {"amount": int(amount), "reason": reason}, "created_at": now_utc().isoformat()})
    return result or await view(user_id)


# ------------------------------------------------------------------ Prestige

async def prestige(user_id: str) -> dict:
    """Ab Level 60, freiwillig: ein Stern, Level zurück auf 1, XP auf null, Erfolge bleiben. 24 Stunden rücknehmbar."""
    db = get_db()
    doc = await state(user_id)
    stars = int(doc.get("prestige") or 0)
    if levels.level_for_xp(doc.get("total", 0), stars) < levels.MAX_LEVEL:
        raise ValueError("Prestige gibt es erst ab Level 60.")
    if stars >= levels.MAX_PRESTIGE:
        raise ValueError("Mehr als fünf Sterne gibt es nicht.")
    stamp = now_utc().isoformat()
    await db.user_xp.update_one({"user_id": user_id}, {"$set": {"prestige": stars + 1, "total": 0, "level": 1, "prestige_at": stamp, "prestige_undo": {"total": int(doc.get("total") or 0), "prestige": stars, "until": (now_utc() + timedelta(hours=PRESTIGE_UNDO_HOURS)).isoformat()}}})
    await db.audit_logs.insert_one({"id": new_id(), "action": "xp.prestige", "actor_id": user_id, "target_id": user_id, "data": {"stars": stars + 1}, "created_at": stamp})
    await _announce_prestige(user_id, stars + 1, stamp)
    return await own_view(user_id)


async def _announce_prestige(user_id: str, stars: int, stamp: str) -> None:
    """Ein Eintrag im Postfach (#622) - die Person hat es selbst ausgelöst, also kein Push."""
    try:
        from services.user_notifications import create_user_notification
        await create_user_notification(
            user_id, f"Prestige {'★' * stars}", "Level zurück auf 1, deine Erfolge bleiben. 24 Stunden lang kannst du es rückgängig machen.",
            url="/profile?tab=achievements", kind="prestige",
            meta={"prestige": stars, "in_app_only": True, "dedupe_key": f"prestige:{user_id}:{stars}:{stamp}"},
        )
    except Exception:  # noqa: BLE001 - ein Fehler hier darf den Prestige nicht verhindern
        logger.warning("[xp] prestige notification failed", exc_info=True)


async def undo_prestige(user_id: str) -> dict:
    db = get_db()
    doc = await state(user_id)
    undo = doc.get("prestige_undo") or {}
    if not undo or str(undo.get("until") or "") < now_utc().isoformat():
        raise ValueError("Die Rücknahme war nur 24 Stunden lang möglich.")
    # Was seit dem Prestige dazukam, bleibt: zurück kommt der alte Stand plus die XP der letzten Stunden.
    restored = int(undo["total"]) + int(doc.get("total") or 0)
    await db.user_xp.update_one({"user_id": user_id}, {"$set": {"prestige": int(undo["prestige"]), "total": restored, "level": levels.level_for_xp(restored, int(undo["prestige"]))}, "$unset": {"prestige_undo": "", "prestige_at": ""}})
    return await own_view(user_id)


# ------------------------------------------------------------------ Erstberechnung

BASELINE_SOURCES = (
    ("matches_played", "match_played"), ("matches_won", "match_won"), ("tournaments_registered", "tournament_registered"),
    ("events_attended", "event_attended"), ("fastlap_valid_count", "lap_valid"), ("pole_count", "pole"),
    ("friends_count", "friend"), ("teams_founded", "team_joined"),
)


async def rebuild(user_id: str) -> dict:
    """Erstberechnung aus der Historie: Zähler × XP je Quelle plus Erfolge × 10 - einmal je Person, gemerkt.
    Danach zählen nur noch die Ereignisse; ein zweiter Aufruf ändert nichts."""
    db = get_db()
    doc = await state(user_id)
    if doc.get("baseline_at"):
        return doc
    from badges import compute_user_progress
    counters = await compute_user_progress(user_id)
    total = 0
    for counter, source in BASELINE_SOURCES:
        base, cap = SOURCES[source]
        count = int(counters.get(counter) or 0)
        total += base * (min(count, cap * 30) if cap else count)
    neg_groups = {g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})}
    tiers = {t["code"]: int(t.get("points") or 0) async for t in db.achievements.find({}, {"_id": 0, "code": 1, "points": 1})}
    async for award in db.user_achievements.find({"user_id": user_id}, {"_id": 0, "tier_code": 1, "group_code": 1}):
        if award.get("group_code") not in neg_groups:
            total += tiers.get(award.get("tier_code"), 0) * ACHIEVEMENT_FACTOR
    if await _is_member(user_id):
        total = int(round(total * (1 + levels.MEMBER_BONUS)))
    stamp = now_utc().isoformat()
    prestige_stars = int(doc.get("prestige") or 0)
    await db.user_xp.update_one({"user_id": user_id}, {"$set": {"total": total, "level": levels.level_for_xp(total, prestige_stars), "baseline_at": stamp, "updated_at": stamp}, "$setOnInsert": {"user_id": user_id, "prestige": 0}}, upsert=True)
    return await state(user_id)


async def rebuild_missing(limit: int = 200) -> int:
    """Konten ohne Erstberechnung nachziehen - der Scheduler ruft das minütlich, bis nichts mehr fehlt."""
    db = get_db()
    done_ids = {row["user_id"] async for row in db.user_xp.find({"baseline_at": {"$exists": True}}, {"_id": 0, "user_id": 1})}
    count = 0
    async for user in db.users.find({"user_type": {"$ne": "guest"}}, {"_id": 0, "id": 1}):
        if user["id"] in done_ids:
            continue
        await rebuild(user["id"])
        count += 1
        if count >= limit:
            break
    return count


async def leaderboard(limit: int = 24) -> list[dict]:
    """Rangliste nach Sternen, dann Level, dann XP - nur öffentliche Profile."""
    db = get_db()
    rows = await db.user_xp.find({"total": {"$gt": 0}}, {"_id": 0}).sort([("prestige", -1), ("level", -1), ("total", -1)]).to_list(500)
    if not rows:
        return []
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": [r["user_id"] for r in rows]}, "privacy_public_profile": True}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1}).to_list(500)}
    out = []
    for row in rows:
        user = users.get(row["user_id"])
        if not user:
            continue
        out.append({"user_id": user["id"], "username": user.get("username"), "display_name": user.get("display_name") or user.get("username") or "Spieler", "avatar_url": user.get("avatar_url"),
                    "level": int(row.get("level") or 1), "xp": int(row.get("total") or 0), "prestige": int(row.get("prestige") or 0), "title": levels.title_for_level(int(row.get("level") or 1))})
        if len(out) >= max(1, min(int(limit or 24), 100)):
            break
    for index, row in enumerate(out):
        row["rank"] = index + 1
    return out
