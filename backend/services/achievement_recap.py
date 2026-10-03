"""Der Wochenrückblick (Erfolge II E12 #622).

Montags 09:00 (Wien) eine kurze Mail an jede Person, die in der Woche XP oder Erfolge gesammelt hat: XP der Woche,
Level und Titel, was neu freigeschaltet wurde, was als Nächstes dran ist und - für Nicht-Mitglieder - ein Satz zum
Vereinsbonus. Nur an die Person selbst, nie an einen Kanal; ohne Aktivität keine Mail. Abbestellbar unter
„Wochenrückblick“ in den E-Mail-Einstellungen. Die Woche ist dieselbe wie beim „Erfolg der Woche“ (Montag 08:00 bis
Montag 08:00, Wien), je Person und Woche höchstens eine Mail (``dedupe_key``).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from services.levels import MEMBER_BONUS

TEMPLATE = "achievement_recap"
MAX_LISTED = 6


def week_label(start: datetime, end: datetime) -> str:
    """„29.09. – 05.10.2026“: Montag bis Sonntag (Wien) - die Woche endet formal Montag 08:00."""
    from services.achievement_visibility import VIENNA

    first = start.astimezone(VIENNA)
    last = (end - timedelta(days=1)).astimezone(VIENNA)
    return f"{first:%d.%m.} – {last:%d.%m.%Y}"


def _material_label(row: dict) -> str:
    name = str(row.get("name") or "").strip()
    material = str(row.get("material_name") or "").strip()
    return f"{name} ({material})" if material else name


async def recap_for(db, user: dict, start: datetime, end: datetime) -> dict | None:
    """Was in der Woche geschah - oder None, wenn nichts (keine XP, kein Erfolg)."""
    from badges import list_groups_for_user
    from services import achievement_visibility as visibility
    from services import xp

    user_id = user["id"]
    window = {"$gte": start.isoformat(), "$lt": end.isoformat()}
    xp_week = 0
    async for row in db.xp_events.find({"user_id": user_id, "at": window}, {"_id": 0, "amount": 1, "bonus": 1}):
        xp_week += int(row.get("amount") or 0) + int(row.get("bonus") or 0)
    groups_by_code, tiers = await visibility._catalog(db)
    unlocked = []
    async for award in db.user_achievements.find({"user_id": user_id, "earned_at": window}, {"_id": 0}).sort("earned_at", 1):
        tier = tiers.get(award.get("tier_code"))
        group = groups_by_code.get(tier.get("group_code")) if tier else None
        if not tier or not group or group.get("is_negative") or award.get("silent"):
            continue
        unlocked.append(_material_label(tier))
    if xp_week <= 0 and not unlocked:
        return None
    level = await xp.view(user_id)
    groups = await list_groups_for_user(user_id, user)
    upcoming = visibility.next_up(groups, 1)
    nxt = upcoming[0] if upcoming else None
    return {
        "week": week_label(start, end),
        "xp_week": max(0, xp_week),
        "level": int(level.get("level") or 1),
        "title": level.get("title") or "",
        "unlocked": unlocked[:MAX_LISTED] + ([f"und {len(unlocked) - MAX_LISTED} weitere"] if len(unlocked) > MAX_LISTED else []),
        "next_up": f"{nxt['name']} – noch {nxt['missing']}" if nxt and nxt.get("missing") else "",
        "member": bool(level.get("member_bonus")),
    }


def bonus_hint(member: bool) -> str:
    """Ein Satz für Nicht-Mitglieder - kein Werbetext."""
    return "" if member else f"Vereinsmitglieder bekommen {round(MEMBER_BONUS * 100)} % mehr XP auf alles."


async def queue_weekly_recaps(now: datetime | None = None) -> dict:
    """Für die eben zu Ende gegangene Woche: je Person mit Aktivität eine Mail (Einstellungen der Person gelten)."""
    from database import get_db
    from services.achievement_visibility import week_window
    from services.notification_preferences import _site_base_url, send_user_template

    db = get_db()
    start, end, key = week_window(now)
    window = {"$gte": start.isoformat(), "$lt": end.isoformat()}
    active = set(await db.xp_events.distinct("user_id", {"at": window}))
    active |= set(await db.user_achievements.distinct("user_id", {"earned_at": window}))
    base = await _site_base_url()
    stats = {"week": key, "candidates": len(active), "queued": 0, "skipped": 0, "deduped": 0, "quiet": 0}
    for user_id in sorted(active):
        user = await db.users.find_one(
            {"id": user_id, "is_active": {"$ne": False}, "is_banned": {"$ne": True}, "email": {"$nin": [None, ""]}},
            {"_id": 0, "id": 1, "email": 1, "username": 1, "display_name": 1, "role": 1, "is_club_member": 1, "newsletter_consent": 1, "notification_preferences": 1},
        )
        if not user:
            stats["skipped"] += 1
            continue
        recap = await recap_for(db, user, start, end)
        if not recap:
            stats["quiet"] += 1
            continue
        result = await send_user_template(
            user, TEMPLATE,
            display_name=user.get("display_name") or user.get("username") or "Löwe",
            week=recap["week"], xp_week=str(recap["xp_week"]), level=str(recap["level"]), level_title=recap["title"],
            unlocked="\n".join(recap["unlocked"]), next_up=recap["next_up"], bonus_hint=bonus_hint(recap["member"]),
            url=f"{base}/profile?tab=achievements", preferences_url=f"{base}/profile?tab=notifications",
            dedupe_key=f"{TEMPLATE}:{key}:{user_id}",
            mail_meta={"kind": TEMPLATE, "user_id": user_id, "week": key},
        )
        if result.get("deduped"):
            stats["deduped"] += 1
        elif result.get("skipped"):
            stats["skipped"] += 1
        elif result.get("ok"):
            stats["queued"] += 1
    return stats
