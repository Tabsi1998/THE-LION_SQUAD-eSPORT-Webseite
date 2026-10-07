"""Erfolge II (#619): was die Seiten über Erfolge zeigen, jenseits der reinen Liste.

- Seltenheit: wie viele der aktiven Konten eine Stufe haben („4,2 % haben Diamant“). Für Vereins-Stufen
  zählt die Zahl der aktiven Mitglieder als Grundlage, sonst hätte ein Vereinserfolg nie mehr als ein
  paar Prozent.
- Fortschritt der Community je Kategorie: Vergaben geteilt durch (Konten × Stufen).
- „Als Nächstes“: die drei Stufen, die dem Ziel am nächsten sind - je Gruppe nur die nächste offene.
- Ranglisten nach Erfolgspunkten, wahlweise je Kategorie und Zeitraum (gesamt, Jahr, Saison, Monat).
- Der Erfolg der Woche: die Freischaltung der vergangenen Woche, die am wenigsten Leute haben.
- Das Laufband: die neuesten Freischaltungen öffentlicher Profile.
- Angeheftete Erfolge (bis zu sechs, nur eigene Vergaben) und der Schalter „Erfolge öffentlich“.

Negative Gruppen erscheinen hier nie. Geheime zeigen nach der Freischaltung ihren Namen, vorher nur
die Zahl („0 von 13 gefunden“).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from achievement_catalog import CATEGORIES, MATERIALS, category_v2
from models import now_utc

logger = logging.getLogger("tls.achievements.visibility")
VIENNA = ZoneInfo("Europe/Vienna")

MAX_PINS = 6
WEEK_START_HOUR = 8
WEEK_SETTING_ID = "achievement_of_week"
RARITY_TTL_SECONDS = 60
PERIODS = ("all", "year", "season", "month")

# Wohin „So schaffst du es“ führt - je Kategorie eine Seite, auf der man den Fortschritt macht.
CATEGORY_LINKS: dict[str, str] = {
    "match": "/tournaments",
    "tournament": "/tournaments",
    "fastlap": "/fastlap",
    "season": "/seasons/current",
    "team": "/teams",
    "community": "/community",
    "creator": "/profile?tab=socials",
    "profile": "/profile",
    "club": "/events",
    "special": "/achievements",
    "hidden": "/achievements",
}

_rarity_cache: dict = {"at": None, "data": None}


# ------------------------------------------------------------------ Grundlagen

def _parse_when(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _user_projection() -> dict:
    return {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "privacy_public_profile": 1,
            "privacy_achievements_public": 1}


def _public_user(user: dict) -> dict:
    return {
        "id": user["id"], "user_id": user["id"], "username": user.get("username"),
        "display_name": user.get("display_name") or user.get("username") or "Spieler",
        "avatar_url": user.get("avatar_url"),
    }


def achievements_public(user: dict | None) -> bool:
    """Der Schalter „Erfolge öffentlich“ - fehlt er, ist er an (Standard aus dem Issue)."""
    if user is None:
        return False
    return user.get("privacy_achievements_public") is not False


async def _bases(db) -> dict:
    """Wie viele Konten zählen als Grundlage: alle aktiven, und die aktiven Mitglieder."""
    users = await db.users.count_documents({"is_active": {"$ne": False}, "is_banned": {"$ne": True}})
    members = await db.memberships.count_documents({"member_status": {"$in": ["active", "honorary"]}})
    return {"all": max(users, 0), "members": max(members, 0)}


async def _catalog(db) -> tuple[dict, dict]:
    groups = {g["code"]: g for g in await db.achievement_groups.find({}, {"_id": 0}).to_list(1000)}
    tiers = {t["code"]: t for t in await db.achievements.find({}, {"_id": 0}).to_list(5000)}
    return groups, tiers


def _percent(part: int, whole: int) -> float:
    if whole <= 0:
        return 0.0
    return round(100.0 * part / whole, 1)


def _group_is_member_only(group: dict | None) -> bool:
    return bool(group and (group.get("member_only") or category_v2(group.get("category")) == "club"))


# ------------------------------------------------------------------ Seltenheit

async def rarity(db, *, force: bool = False, now: datetime | None = None) -> dict:
    """Je Stufe: wie viele Konten sie haben und wie viel Prozent das sind. Je Gruppe dazu die höchste
    Stufe („top“) mit ihrer Seltenheit - das ist die Zahl auf der Karte. Eine Minute zwischengespeichert."""
    now = now or now_utc()
    cached = _rarity_cache.get("data")
    if cached and not force and _rarity_cache.get("at") and (now - _rarity_cache["at"]).total_seconds() < RARITY_TTL_SECONDS:
        return cached
    bases = await _bases(db)
    groups, tiers = await _catalog(db)
    holders: dict[str, set] = {}
    async for award in db.user_achievements.find({}, {"_id": 0, "user_id": 1, "tier_code": 1}):
        holders.setdefault(award["tier_code"], set()).add(award["user_id"])
    tier_rows: dict[str, dict] = {}
    for code, tier in tiers.items():
        group = groups.get(tier.get("group_code"))
        if not group or group.get("is_negative"):
            continue
        base = bases["members"] if _group_is_member_only(group) else bases["all"]
        count = len(holders.get(code, ()))
        tier_rows[code] = {"holders": count, "percent": _percent(count, base), "base": base}
    group_rows: dict[str, dict] = {}
    for code, group in groups.items():
        if group.get("is_negative"):
            continue
        own = [t for t in tiers.values() if t.get("group_code") == code and t["code"] in tier_rows]
        if not own:
            continue
        own.sort(key=lambda t: (int(t.get("rank") or 0), int(t.get("level") or 0)))
        top = own[-1]
        anyone = set()
        for t in own:
            anyone |= holders.get(t["code"], set())
        base = tier_rows[top["code"]]["base"]
        group_rows[code] = {
            "holders": len(anyone),
            "percent": _percent(len(anyone), base),
            "top": {
                "code": top["code"], "material": top.get("material"),
                "material_name": top.get("material_name") or MATERIALS.get(top.get("material") or "", {}).get("name"),
                "holders": tier_rows[top["code"]]["holders"], "percent": tier_rows[top["code"]]["percent"],
            },
        }
    data = {"base": bases["all"], "members_base": bases["members"], "tiers": tier_rows, "groups": group_rows,
            "computed_at": now.isoformat()}
    _rarity_cache.update({"at": now, "data": data})
    return data


def reset_rarity_cache() -> None:
    _rarity_cache.update({"at": None, "data": None})


# ------------------------------------------------------------------ Kategorien

async def category_overview(db, *, rarity_data: dict | None = None) -> list[dict]:
    """Je Kategorie: Gruppen, Stufen, wie viele Leute etwas davon haben und der Fortschritt der
    Community (Vergaben geteilt durch Konten × Stufen). Negativ bleibt draußen, Geheim zählt nur."""
    rarity_data = rarity_data or await rarity(db)
    groups, tiers = await _catalog(db)
    per_cat: dict[str, dict] = {}
    for key, meta in CATEGORIES.items():
        if meta.get("negative"):
            continue
        per_cat[key] = {"key": key, "label": meta["label"], "order": meta["order"], "icon": meta["icon"], "accent": meta["accent"],
                        "member_only": bool(meta.get("member_only")), "hidden": bool(meta.get("hidden")),
                        "groups": 0, "tiers": 0, "points": 0, "awards": 0, "holders": 0, "community_percent": 0.0,
                        "link": CATEGORY_LINKS.get(key)}
    tier_cat: dict[str, str] = {}
    for group in groups.values():
        if group.get("is_negative"):
            continue
        cat = category_v2(group.get("category"))
        row = per_cat.get(cat)
        if not row:
            continue
        if not group.get("public") and not group.get("hidden"):
            continue
        row["groups"] += 1
        for tier in tiers.values():
            if tier.get("group_code") == group["code"]:
                row["tiers"] += 1
                row["points"] += int(tier.get("points") or 0)
                tier_cat[tier["code"]] = cat
    holders: dict[str, set] = {}
    async for award in db.user_achievements.find({}, {"_id": 0, "user_id": 1, "tier_code": 1}):
        cat = tier_cat.get(award["tier_code"])
        if not cat:
            continue
        per_cat[cat]["awards"] += 1
        holders.setdefault(cat, set()).add(award["user_id"])
    for key, row in per_cat.items():
        base = rarity_data["members_base"] if row["member_only"] else rarity_data["base"]
        row["holders"] = len(holders.get(key, ()))
        row["community_percent"] = _percent(row["awards"], base * row["tiers"]) if row["tiers"] else 0.0
    return sorted(per_cat.values(), key=lambda r: r["order"])


async def my_progress(db, user_id: str) -> dict:
    """Der eigene Stand für die Erfolge-Seite (#1229): Stufen und Punkte insgesamt und je Kategorie - gezählt wie in
    category_overview (öffentliche und geheime Gruppen), damit „12 von 40“ zusammenpasst. Negatives zählt nicht mit;
    wie viele davon da sind, steht extra - dafür zeigt die Seite die eigene Zeile „Geheim / Fun“."""
    groups, tiers = await _catalog(db)
    per_cat: dict[str, int] = {}
    count = points = negative = 0
    async for award in db.user_achievements.find({"user_id": user_id}, {"_id": 0, "tier_code": 1}):
        tier = tiers.get(award.get("tier_code"))
        group = groups.get(tier.get("group_code")) if tier else None
        if not group:
            continue
        if group.get("is_negative"):
            negative += 1
            continue
        if not group.get("public") and not group.get("hidden"):
            continue
        cat = category_v2(group.get("category"))
        per_cat[cat] = per_cat.get(cat, 0) + 1
        count += 1
        points += int(tier.get("points") or 0)
    return {"count": count, "points": points, "categories": per_cat, "negative": negative}


async def hidden_summary(db, user_id: str | None) -> dict:
    """„0 von 13 gefunden“ - die Zahl der geheimen Gruppen und wie viele davon die Person schon hat."""
    total = await db.achievement_groups.count_documents({"hidden": True, "is_negative": {"$ne": True}})
    earned = 0
    if user_id and total:
        codes = [g["code"] async for g in db.achievement_groups.find({"hidden": True, "is_negative": {"$ne": True}}, {"_id": 0, "code": 1})]
        found = await db.user_achievements.distinct("group_code", {"user_id": user_id, "group_code": {"$in": codes}})
        earned = len(found)
    return {"total": total, "earned": earned}


# ------------------------------------------------------------------ Als Nächstes

def next_up(groups: list[dict], limit: int = 3) -> list[dict]:
    """Die Stufen, die dem Ziel am nächsten sind: je Gruppe nur die nächste offene, messbar, nicht von
    Hand, nicht geplant, nicht geheim. Sortiert nach Prozent, dann nach dem, was noch fehlt."""
    candidates = []
    for group in groups:
        if group.get("is_negative") or group.get("hidden"):
            continue
        tiers = sorted(group.get("tiers") or [], key=lambda t: (int(t.get("rank") or 0), int(t.get("level") or 0)))
        for tier in tiers:
            if tier.get("earned"):
                continue
            if tier.get("manual_only") or tier.get("condition_status") == "planned" or not tier.get("target"):
                break
            target = int(tier.get("target") or 0)
            current = min(int(tier.get("current") or 0), target)
            cat = category_v2(group.get("category"))
            candidates.append({
                "code": tier["code"], "name": tier.get("name"), "description": tier.get("description"),
                "group_code": group.get("code"), "group_name": group.get("name"), "group_icon": group.get("icon"),
                "group_accent": group.get("accent_color"), "category": cat,
                "icon": tier.get("icon") or group.get("icon"), "art": tier.get("art"),
                "material": tier.get("material"), "material_name": tier.get("material_name"),
                "material_color": tier.get("material_color"), "level": tier.get("level"),
                "points": int(tier.get("points") or 0), "percent": int(tier.get("percent") or 0),
                "current": current, "target": target, "missing": max(target - current, 0),
                "how_to": tier.get("how_to") or tier.get("description") or "",
                "member_only": bool(tier.get("member_only")), "link": CATEGORY_LINKS.get(cat, "/achievements"),
            })
            break
    candidates.sort(key=lambda c: (-c["percent"], c["missing"], -c["points"], c["name"] or ""))
    return candidates[:max(0, int(limit or 0))]


# ------------------------------------------------------------------ Ranglisten

def period_start(period: str, *, now: datetime | None = None, season: dict | None = None) -> datetime | None:
    """Ab wann Vergaben zählen: gesamt → None, Jahr → 1. Januar Wien, Monat → 1. des Monats, Saison → ihr Start."""
    now = (now or now_utc()).astimezone(VIENNA)
    if period == "year":
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "season":
        return _parse_when((season or {}).get("start_date")) if season else None
    return None


async def leaderboard(db, *, category: str | None = None, period: str = "all", limit: int = 24, now: datetime | None = None) -> list[dict]:
    """Erfolgspunkte je Person - öffentliche Profile, ohne Negatives; wahlweise nur eine Kategorie und nur
    Vergaben ab einem Zeitpunkt. Mit Level und Sternen aus dem XP-Stand für die Podestplätze."""
    period = period if period in PERIODS else "all"
    season = await db.seasons.find_one({"status": "active"}, {"_id": 0, "id": 1, "start_date": 1, "name": 1}) if period == "season" else None
    since = period_start(period, now=now, season=season)
    groups, tiers = await _catalog(db)
    wanted = category_v2(category) if category else None
    allowed: dict[str, int] = {}
    for code, tier in tiers.items():
        group = groups.get(tier.get("group_code"))
        if not group or group.get("is_negative"):
            continue
        if wanted and category_v2(group.get("category")) != wanted:
            continue
        allowed[code] = int(tier.get("points") or 0)
    agg: dict[str, dict] = {}
    async for award in db.user_achievements.find({}, {"_id": 0, "user_id": 1, "tier_code": 1, "earned_at": 1}):
        points = allowed.get(award["tier_code"])
        if points is None:
            continue
        if since:
            when = _parse_when(award.get("earned_at"))
            if not when or when < since:
                continue
        entry = agg.setdefault(award["user_id"], {"count": 0, "points": 0})
        entry["count"] += 1
        entry["points"] += points
    if not agg:
        return []
    users = await db.users.find({"id": {"$in": list(agg)}, "privacy_public_profile": True, "is_active": {"$ne": False}, "is_banned": {"$ne": True}},
                                _user_projection()).to_list(5000)
    levels = {doc["user_id"]: doc async for doc in db.user_xp.find({"user_id": {"$in": [u["id"] for u in users]}}, {"_id": 0, "user_id": 1, "level": 1, "prestige": 1})}
    rows = []
    for user in users:
        if not achievements_public(user):
            continue
        stats = agg[user["id"]]
        level = levels.get(user["id"]) or {}
        rows.append({**_public_user(user), "count": stats["count"], "points": stats["points"],
                     "level": int(level.get("level") or 1), "prestige": int(level.get("prestige") or 0)})
    rows.sort(key=lambda r: (-r["points"], -r["count"], (r["display_name"] or "").lower()))
    capped = max(1, min(int(limit or 24), 100))
    rows = rows[:capped]
    for index, row in enumerate(rows):
        row["rank"] = index + 1
    return rows


# ------------------------------------------------------------------ Erfolg der Woche

def week_window(now: datetime | None = None) -> tuple[datetime, datetime, str]:
    """Die Woche, die am letzten Montag 08:00 Wien endete: (von, bis, Schlüssel wie „2026-W40“)."""
    now = (now or now_utc()).astimezone(VIENNA)
    monday = now - timedelta(days=now.weekday())
    end = monday.replace(hour=WEEK_START_HOUR, minute=0, second=0, microsecond=0)
    if now < end:
        end -= timedelta(days=7)
    start = end - timedelta(days=7)
    iso = end.isocalendar()
    return start, end, f"{iso.year}-W{iso.week:02d}"


async def _pick_week_award(db, start: datetime, end: datetime) -> dict | None:
    groups, tiers = await _catalog(db)
    rarity_data = await rarity(db)
    candidates = []
    async for award in db.user_achievements.find({}, {"_id": 0}):
        when = _parse_when(award.get("earned_at"))
        if not when or when < start or when >= end:
            continue
        tier = tiers.get(award["tier_code"])
        group = groups.get(tier.get("group_code")) if tier else None
        if not tier or not group or group.get("is_negative"):
            continue
        rare = rarity_data["tiers"].get(tier["code"], {"holders": 0, "percent": 0.0})
        candidates.append((rare["holders"], -int(tier.get("rank") or 0), -when.timestamp(), award, tier, group, rare))
    if not candidates:
        return None
    candidates.sort(key=lambda c: c[:3])
    for _holders, _rank, _ts, award, tier, group, rare in candidates:
        user = await db.users.find_one({"id": award["user_id"], "privacy_public_profile": True, "is_active": {"$ne": False}, "is_banned": {"$ne": True}}, _user_projection())
        if not user or not achievements_public(user):
            continue
        return {
            "award_id": award.get("id"), "tier_code": tier["code"], "name": tier.get("name"), "description": tier.get("description"),
            "group_code": group["code"], "group_name": group.get("name"), "category": category_v2(group.get("category")),
            "icon": tier.get("icon") or group.get("icon"), "art": tier.get("art"), "rank": int(tier.get("rank") or 0), "material": tier.get("material"),
            "material_name": tier.get("material_name"), "material_color": tier.get("material_color"),
            "level": tier.get("level"), "points": int(tier.get("points") or 0), "earned_at": award.get("earned_at"),
            "holders": rare["holders"], "percent": rare["percent"], "user": _public_user(user),
        }
    return None


async def achievement_of_week(db, *, now: datetime | None = None, force: bool = False) -> dict:
    """Der Erfolg der Woche: berechnet am Montag 08:00 (Planer) und sonst beim ersten Abruf der Woche,
    dann in den Einstellungen abgelegt, damit alle dieselbe Kachel sehen (auch Discord, E12)."""
    start, end, key = week_window(now)
    stored = await db.settings.find_one({"id": WEEK_SETTING_ID}, {"_id": 0})
    if stored and stored.get("week_key") == key and not force:
        return stored
    doc = {"id": WEEK_SETTING_ID, "week_key": key, "from": start.isoformat(), "to": end.isoformat(),
           "award": await _pick_week_award(db, start, end), "computed_at": (now or now_utc()).isoformat()}
    await db.settings.update_one({"id": WEEK_SETTING_ID}, {"$set": doc}, upsert=True)
    return doc


# ------------------------------------------------------------------ Laufband

async def recent_unlocks(db, limit: int = 20) -> list[dict]:
    """Die neuesten Freischaltungen öffentlicher Profile - ohne Negatives, mit Person und Material."""
    groups, tiers = await _catalog(db)
    capped = max(1, min(int(limit or 20), 60))
    out: list[dict] = []
    users: dict[str, dict | None] = {}
    async for award in db.user_achievements.find({}, {"_id": 0}).sort("earned_at", -1).limit(capped * 6):
        tier = tiers.get(award["tier_code"])
        group = groups.get(tier.get("group_code")) if tier else None
        if not tier or not group or group.get("is_negative"):
            continue
        if award["user_id"] not in users:
            users[award["user_id"]] = await db.users.find_one({"id": award["user_id"], "privacy_public_profile": True, "is_active": {"$ne": False}, "is_banned": {"$ne": True}}, _user_projection())
        user = users[award["user_id"]]
        if not user or not achievements_public(user):
            continue
        out.append({
            "award_id": award.get("id"), "tier_code": tier["code"], "name": tier.get("name"), "group_code": group["code"],
            "group_name": group.get("name"), "category": category_v2(group.get("category")), "icon": tier.get("icon") or group.get("icon"),
            "art": tier.get("art"), "rank": int(tier.get("rank") or 0), "material": tier.get("material"), "material_name": tier.get("material_name"),
            "material_color": tier.get("material_color"), "level": tier.get("level"), "points": int(tier.get("points") or 0),
            "earned_at": award.get("earned_at"), "user": _public_user(user),
        })
        if len(out) >= capped:
            break
    return out


# ------------------------------------------------------------------ Dashboard-Kachel

async def my_summary(db, user_id: str, groups: list[dict], awards: list[dict]) -> dict:
    """Die Kachel „Deine Erfolge“ (#619): Level-Stand, was als Nächstes dran ist, die letzte Freischaltung,
    Anzahl und Punkte - ohne den ganzen Katalog zu schicken."""
    from services import xp
    earned = [a for a in awards if not a.get("is_negative")]
    earned.sort(key=lambda a: str(a.get("earned_at") or ""), reverse=True)
    last = earned[0] if earned else None
    nxt = next_up(groups, 1)
    return {
        "level": await xp.view(user_id),
        "next_up": nxt[0] if nxt else None,
        "last_award": {k: last.get(k) for k in ("award_id", "code", "name", "group_name", "material", "material_name", "material_color", "icon", "art", "rank", "level", "points", "earned_at")} if last else None,
        "count": len(earned),
        "points": sum(int(a.get("points") or 0) for a in earned),
        "hidden": await hidden_summary(db, user_id),
    }


# ------------------------------------------------------------------ Angeheftet

async def set_pins(db, user_id: str, tier_codes: list[str]) -> list[str]:
    """Bis zu sechs eigene Vergaben anheften, in dieser Reihenfolge. Fremde oder negative Codes fliegen raus."""
    cleaned: list[str] = []
    for code in tier_codes or []:
        code = str(code or "").strip()
        if code and code not in cleaned:
            cleaned.append(code)
    if len(cleaned) > MAX_PINS:
        raise ValueError(f"Höchstens {MAX_PINS} Erfolge lassen sich anheften.")
    if cleaned:
        owned = {a["tier_code"] async for a in db.user_achievements.find({"user_id": user_id, "tier_code": {"$in": cleaned}}, {"_id": 0, "tier_code": 1})}
        negative = {g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})}
        tiers = {t["code"]: t async for t in db.achievements.find({"code": {"$in": cleaned}}, {"_id": 0, "code": 1, "group_code": 1})}
        for code in cleaned:
            if code not in owned:
                raise ValueError("Nur eigene Erfolge lassen sich anheften.")
            if tiers.get(code, {}).get("group_code") in negative:
                raise ValueError("Dieser Erfolg lässt sich nicht anheften.")
    await db.users.update_one({"id": user_id}, {"$set": {"pinned_achievements": cleaned}})
    return cleaned


def pinned_awards(user: dict | None, awards: list[dict]) -> list[dict]:
    """Die angehefteten Vergaben in der gespeicherten Reihenfolge - nur, was die Liste auch enthält."""
    if not user:
        return []
    by_code = {a.get("code"): a for a in awards if not a.get("is_negative")}
    return [by_code[code] for code in (user.get("pinned_achievements") or []) if code in by_code][:MAX_PINS]


# ------------------------------------------------------------------ Fremde Profile

async def viewer_sees_club(db, viewer: dict | None, target_id: str) -> bool:
    """Die Verein-Kategorie zeigt sich in fremden Profilen nur Mitgliedern und dem Admin-Team."""
    if not viewer:
        return False
    if viewer.get("id") == target_id:
        return True
    if viewer.get("role") in ("tournament_admin", "club_admin", "superadmin"):
        return True
    if viewer.get("is_club_member"):
        return True
    membership = await db.memberships.find_one({"user_id": viewer["id"]}, {"_id": 0, "member_status": 1})
    return bool(membership and membership.get("member_status") in ("active", "honorary"))


def without_club(groups: list[dict], awards: list[dict]) -> tuple[list[dict], list[dict]]:
    groups = [g for g in groups if not _group_is_member_only(g)]
    awards = [a for a in awards if category_v2(a.get("group_category")) != "club" and not a.get("member_only")]
    return groups, awards
