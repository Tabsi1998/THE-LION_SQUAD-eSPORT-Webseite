"""Erfolge II (E10, #620): der Admin-Bereich der Erfolge - Übersicht, Katalog-Prüfung, Export und Import,
Protokoll, Einzel- und Massenvergabe (auch rückwirkend und ohne Zeremonie), Saison-Vorschau, XP-Deckel
und Prestige-Rücksetzung, Statistik. Jede Aktion landet in ``achievement_events`` mit Person, Admin
und Grund; die Ranglisten und Seltenheiten kommen aus achievement_visibility, damit Admin und Seite
dieselben Zahlen zeigen.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from achievement_catalog import CATEGORIES, CONDITION_KEY_STATUS, MATERIALS, annotate_tier, category_v2
from achievement_catalog.validate import validate_catalog
from models import new_id, now_utc
from services import achievement_visibility as visibility

logger = logging.getLogger("tls.achievements.admin")
VIENNA = ZoneInfo("Europe/Vienna")
EVENTS = "achievement_events"
RECONCILE_SETTING_ID = "achievements_reconcile_last"
BULK_LIMIT = 500
ACTIVE_TOURNAMENT_STATUSES = ("approved", "checked_in")
ACTIVE_EVENT_STATUSES = ("registered", "checked_in")
ACTIVE_MEMBER_STATUSES = ("active", "honorary")


# ------------------------------------------------------------------ Protokoll

async def log_event(db, kind: str, actor: dict | None, *, user_id: str | None = None, tier_code: str | None = None, note: str | None = None, data: dict | None = None) -> dict:
    """Ein Eintrag im Protokoll: was, wer, für wen, warum."""
    tier = await db.achievements.find_one({"code": tier_code}, {"_id": 0, "name": 1, "group_code": 1, "material": 1}) if tier_code else None
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "display_name": 1}) if user_id else None
    doc = {
        "id": new_id(), "kind": kind, "at": now_utc().isoformat(),
        "actor_id": (actor or {}).get("id"), "actor_name": (actor or {}).get("display_name") or (actor or {}).get("username"),
        "user_id": user_id, "username": (user or {}).get("username"), "user_name": (user or {}).get("display_name") or (user or {}).get("username"),
        "tier_code": tier_code, "tier_name": (tier or {}).get("name"), "group_code": (tier or {}).get("group_code"), "material": (tier or {}).get("material"),
        "note": (note or "").strip() or None, "data": data or {},
    }
    await db[EVENTS].insert_one(dict(doc))
    return doc


async def list_events(db, *, limit: int = 100, kind: str | None = None, user_id: str | None = None) -> list[dict]:
    query: dict = {}
    if kind:
        query["kind"] = kind
    if user_id:
        query["user_id"] = user_id
    capped = max(1, min(int(limit or 100), 500))
    return await db[EVENTS].find(query, {"_id": 0}).sort("at", -1).to_list(capped)


# ------------------------------------------------------------------ Übersicht

def _parse(value) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def overview(db) -> dict:
    """Kennzahlen: Freischaltungen 7/30 Tage, seltenste Stufe, aktivste Kategorie, Level-Verteilung,
    Personen ohne Erfolg, Warteschlange, letzter nächtlicher Abgleich."""
    now = now_utc()
    since7 = (now - timedelta(days=7)).isoformat()
    since30 = (now - timedelta(days=30)).isoformat()
    groups, tiers = await visibility._catalog(db)
    negative = {code for code, g in groups.items() if g.get("is_negative")}
    tier_category = {code: category_v2(groups.get(t.get("group_code"), {}).get("category")) for code, t in tiers.items() if t.get("group_code") not in negative}
    unlocks7 = unlocks30 = 0
    per_category: dict[str, int] = {}
    async for award in db.user_achievements.find({"earned_at": {"$gte": since30}}, {"_id": 0, "tier_code": 1, "earned_at": 1}):
        cat = tier_category.get(award["tier_code"])
        if not cat:
            continue
        unlocks30 += 1
        per_category[cat] = per_category.get(cat, 0) + 1
        if str(award.get("earned_at") or "") >= since7:
            unlocks7 += 1
    rarity = await visibility.rarity(db)
    rarest = None
    for code, row in rarity["tiers"].items():
        if row["holders"] <= 0:
            continue
        if rarest is None or (row["holders"], -int(tiers[code].get("rank") or 0)) < (rarest["holders"], -int(tiers[rarest["code"]].get("rank") or 0)):
            rarest = {"code": code, "holders": row["holders"], "percent": row["percent"]}
    if rarest:
        t = tiers[rarest["code"]]
        rarest.update({"name": t.get("name"), "material": t.get("material"), "material_name": t.get("material_name"), "group_name": groups.get(t.get("group_code"), {}).get("name")})
    most_active = max(per_category.items(), key=lambda kv: kv[1])[0] if per_category else None
    buckets = {"1-9": 0, "10-19": 0, "20-29": 0, "30-39": 0, "40-49": 0, "50-59": 0, "60": 0}
    prestige_total = 0
    async for row in db.user_xp.find({}, {"_id": 0, "level": 1, "prestige": 1}):
        level = int(row.get("level") or 1)
        key = "60" if level >= 60 else f"{(level // 10) * 10 or 1}-{(level // 10) * 10 + 9}"
        buckets[key] = buckets.get(key, 0) + 1
        prestige_total += 1 if int(row.get("prestige") or 0) > 0 else 0
    users_total = await db.users.count_documents({"is_active": {"$ne": False}, "is_banned": {"$ne": True}})
    holders = len(await db.user_achievements.distinct("user_id", {"tier_code": {"$in": list(tier_category)}}))
    from services.achievement_queue import queue_state
    return {
        "unlocks_7d": unlocks7, "unlocks_30d": unlocks30,
        "rarest": rarest,
        "most_active_category": {"key": most_active, "label": CATEGORIES.get(most_active, {}).get("label"), "count": per_category.get(most_active, 0)} if most_active else None,
        "per_category_30d": per_category,
        "levels": buckets, "prestige_holders": prestige_total,
        "users_total": users_total, "users_without_award": max(users_total - holders, 0),
        "queue": await queue_state(),
        "reconcile": await db.settings.find_one({"id": RECONCILE_SETTING_ID}, {"_id": 0, "id": 0}),
        "catalog": {"groups": len([g for g in groups.values()]), "tiers": len(tiers)},
    }


# ------------------------------------------------------------------ Katalog

async def catalog_check(db) -> dict:
    groups = await db.achievement_groups.find({}, {"_id": 0}).to_list(2000)
    tiers = await db.achievements.find({}, {"_id": 0}).to_list(10000)
    return validate_catalog(groups, tiers, CONDITION_KEY_STATUS)


async def export_catalog(db) -> dict:
    groups = await db.achievement_groups.find({}, {"_id": 0}).sort("sort_order", 1).to_list(2000)
    tiers = await db.achievements.find({}, {"_id": 0}).sort([("group_code", 1), ("rank", 1)]).to_list(10000)
    return {"format": "tls-achievements/1", "exported_at": now_utc().isoformat(), "groups": groups, "tiers": tiers}


GROUP_FIELDS = ("name", "category", "icon", "art", "accent_color", "description", "how_to", "public", "is_special", "is_negative", "hidden", "sort_order", "member_only", "staff_only")
TIER_FIELDS = ("group_code", "name", "description", "how_to", "art", "icon", "material", "level", "condition_key", "progress_target", "points", "manual_only", "member_only")


async def import_catalog(db, payload: dict, actor: dict | None, *, dry_run: bool = False) -> dict:
    """Gruppen und Stufen aus einem Export übernehmen: erst prüfen (zusammen mit dem Bestand), dann
    einspielen. Löscht nichts; neue Gruppen gelten als vom Admin angelegt."""
    if not isinstance(payload, dict) or not isinstance(payload.get("groups"), list) or not isinstance(payload.get("tiers"), list):
        raise ValueError("Die Datei braucht „groups“ und „tiers“ als Listen.")
    incoming_groups = [dict(g) for g in payload["groups"] if isinstance(g, dict) and g.get("code")]
    incoming_tiers = [dict(t) for t in payload["tiers"] if isinstance(t, dict) and t.get("code")]
    existing_groups = {g["code"]: g for g in await db.achievement_groups.find({}, {"_id": 0}).to_list(2000)}
    existing_tiers = {t["code"]: t for t in await db.achievements.find({}, {"_id": 0}).to_list(10000)}
    merged_groups = dict(existing_groups)
    for g in incoming_groups:
        base = dict(existing_groups.get(g["code"]) or {"code": g["code"], "id": g["code"], "is_admin_created": True, "public": True, "is_special": False, "is_negative": False})
        for key in GROUP_FIELDS:
            if key in g:
                base[key] = g[key]
        merged_groups[g["code"]] = base
    merged_tiers = dict(existing_tiers)
    for t in incoming_tiers:
        base = dict(existing_tiers.get(t["code"]) or {"code": t["code"], "id": t["code"]})
        for key in TIER_FIELDS:
            if key in t:
                base[key] = t[key]
        group = merged_groups.get(base.get("group_code"))
        merged_tiers[t["code"]] = annotate_tier(base, group) if group else base
    report = validate_catalog(list(merged_groups.values()), list(merged_tiers.values()), CONDITION_KEY_STATUS)
    result = {"groups": len(incoming_groups), "tiers": len(incoming_tiers), "check": report, "applied": False}
    if report["errors"] or dry_run:
        return result
    for g in incoming_groups:
        await db.achievement_groups.update_one({"code": g["code"]}, {"$set": merged_groups[g["code"]]}, upsert=True)
    for t in incoming_tiers:
        await db.achievements.update_one({"code": t["code"]}, {"$set": merged_tiers[t["code"]]}, upsert=True)
    await log_event(db, "import", actor, data={"groups": len(incoming_groups), "tiers": len(incoming_tiers)})
    result["applied"] = True
    return result


# ------------------------------------------------------------------ Vergeben

async def award_with_options(db, actor: dict, user_id: str, tier_code: str, *, note: str | None = None, earned_at: str | None = None, silent: bool = False) -> dict:
    """Einzelvergabe mit Datum (rückwirkend) und „ohne Zeremonie“ - Web und App überspringen dann das Fest,
    die Benachrichtigung bleibt dem Postfach (E12) überlassen."""
    from badges import award_achievement, can_award_tier_to_user
    tier = await db.achievements.find_one({"code": tier_code}, {"_id": 0})
    if not tier:
        raise LookupError("Stufe nicht gefunden.")
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise LookupError("Nutzer nicht gefunden.")
    if not await can_award_tier_to_user(user_id, tier):
        raise ValueError("Dieses Achievement ist nur für aktive Vereinsmitglieder.")
    when = _parse(earned_at) if earned_at else None
    if earned_at and not when:
        raise ValueError("Das Datum ist nicht lesbar.")
    if when and when > now_utc() + timedelta(minutes=5):
        raise ValueError("Das Datum liegt in der Zukunft.")
    awarded = await award_achievement(user_id, tier_code, context={"manual": True, "by": actor["id"], "note": note, "silent": silent}, awarded_by=actor["id"])
    if not awarded:
        return {"ok": True, "already_awarded": True}
    updates: dict = {}
    if when:
        updates["earned_at"] = when.astimezone(timezone.utc).isoformat()
    if silent:
        updates["silent"] = True
    if updates:
        await db.user_achievements.update_one({"user_id": user_id, "tier_code": tier_code}, {"$set": updates})
    await log_event(db, "award", actor, user_id=user_id, tier_code=tier_code, note=note, data={"earned_at": updates.get("earned_at"), "silent": silent})
    return {"ok": True, "newly_awarded": True, "earned_at": updates.get("earned_at"), "silent": silent}


async def revoke_with_reason(db, actor: dict, user_id: str, tier_code: str, *, note: str | None) -> dict:
    res = await db.user_achievements.delete_one({"user_id": user_id, "tier_code": tier_code})
    if res.deleted_count == 0:
        raise LookupError("Nicht vergeben.")
    await log_event(db, "revoke", actor, user_id=user_id, tier_code=tier_code, note=note)
    await _tell_revoked(db, user_id, tier_code)
    return {"ok": True}


async def _tell_revoked(db, user_id: str, tier_code: str) -> None:
    """Die Person erfährt es im Postfach (#622) - ohne Push, ohne Discord und ohne die interne Notiz des Admins."""
    try:
        from services.user_notifications import create_user_notification
        tier = await db.achievements.find_one({"code": tier_code}, {"_id": 0, "name": 1}) or {}
        await create_user_notification(
            user_id, "Erfolg zurückgenommen", f"„{tier.get('name') or tier_code}“ wurde vom Verein zurückgenommen. Fragen? Schreib dem Vorstand.",
            url="/profile?tab=achievements", kind="achievement_revoked",
            meta={"tier_code": tier_code, "in_app_only": True, "dedupe_key": f"revoked:{user_id}:{tier_code}:{now_utc().isoformat()}"},
        )
    except Exception:  # noqa: BLE001 - die Rücknahme selbst ist schon geschehen
        logger.warning("[achievements] revoke notification failed", exc_info=True)


async def resolve_recipients(db, selection: dict) -> list[str]:
    """Wer bekommt es: eine Liste von Konten, die Teilnehmer eines Turniers oder Events, ein Team, alle
    Mitglieder oder alle mit einer Rolle. Ergebnis ohne Doppelte, in stabiler Reihenfolge."""
    ids: list[str] = []
    seen: set[str] = set()

    def add(values):
        for value in values:
            if value and value not in seen:
                seen.add(value)
                ids.append(value)

    add([str(v).strip() for v in (selection.get("user_ids") or []) if str(v).strip()])
    if selection.get("tournament_id"):
        add([r["user_id"] async for r in db.tournament_registrations.find({"tournament_id": selection["tournament_id"], "status": {"$in": list(ACTIVE_TOURNAMENT_STATUSES)}}, {"_id": 0, "user_id": 1}) if r.get("user_id")])
    if selection.get("event_id"):
        add([r["user_id"] async for r in db.event_registrations.find({"event_id": selection["event_id"], "status": {"$in": list(ACTIVE_EVENT_STATUSES)}}, {"_id": 0, "user_id": 1}) if r.get("user_id")])
    if selection.get("team_id"):
        add([m["user_id"] async for m in db.team_members.find({"team_id": selection["team_id"]}, {"_id": 0, "user_id": 1}) if m.get("user_id")])
    if selection.get("members"):
        add([m["user_id"] async for m in db.memberships.find({"member_status": {"$in": list(ACTIVE_MEMBER_STATUSES)}}, {"_id": 0, "user_id": 1}) if m.get("user_id")])
    if selection.get("role"):
        add([u["id"] async for u in db.users.find({"role": selection["role"], "is_active": {"$ne": False}}, {"_id": 0, "id": 1})])
    return ids


async def bulk_award(db, actor: dict, tier_code: str, selection: dict, *, note: str | None = None, earned_at: str | None = None, silent: bool = False, dry_run: bool = False) -> dict:
    """Massenvergabe: Empfänger auflösen, jede Vergabe wie eine Einzelvergabe (Prüfungen, Protokoll),
    höchstens 500 auf einmal. ``dry_run`` zählt nur."""
    recipients = await resolve_recipients(db, selection)
    if len(recipients) > BULK_LIMIT:
        raise ValueError(f"Höchstens {BULK_LIMIT} Personen auf einmal - es wären {len(recipients)}.")
    tier = await db.achievements.find_one({"code": tier_code}, {"_id": 0})
    if not tier:
        raise LookupError("Stufe nicht gefunden.")
    result = {"recipients": len(recipients), "awarded": 0, "already": 0, "skipped": 0, "dry_run": dry_run, "user_ids": recipients}
    if dry_run:
        return result
    from badges import award_achievement, can_award_tier_to_user
    when = _parse(earned_at) if earned_at else None
    if earned_at and not when:
        raise ValueError("Das Datum ist nicht lesbar.")
    for user_id in recipients:
        if not await can_award_tier_to_user(user_id, tier):
            result["skipped"] += 1
            continue
        awarded = await award_achievement(user_id, tier_code, context={"manual": True, "bulk": True, "by": actor["id"], "note": note, "silent": silent}, awarded_by=actor["id"])
        if not awarded:
            result["already"] += 1
            continue
        updates: dict = {}
        if when:
            updates["earned_at"] = when.astimezone(timezone.utc).isoformat()
        if silent:
            updates["silent"] = True
        if updates:
            await db.user_achievements.update_one({"user_id": user_id, "tier_code": tier_code}, {"$set": updates})
        result["awarded"] += 1
    await log_event(db, "bulk_award", actor, tier_code=tier_code, note=note, data={"selection": {k: v for k, v in selection.items() if k != "user_ids"}, **{k: result[k] for k in ("recipients", "awarded", "already", "skipped")}, "silent": silent, "earned_at": earned_at})
    return result


# ------------------------------------------------------------------ Saison

async def season_preview(db, season_id: str) -> dict:
    """Was der Saisonabschluss vergeben würde: die Rangliste (festgeschrieben würde sie beim Bestätigen) und
    die Saison-Gruppen, die dann ausgewertet werden - als Vorschau, ohne etwas zu schreiben."""
    season = await db.seasons.find_one({"id": season_id}, {"_id": 0, "id": 1, "name": 1, "status": 1, "start_date": 1, "end_date": 1})
    if not season:
        raise LookupError("Saison nicht gefunden.")
    from services.season_ranks import ranks_for_season
    ranks = await ranks_for_season(db, season_id)
    user_ids = [r.get("user_id") for r in ranks if r.get("user_id")]
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(5000)}
    standings = [{"rank": r.get("rank"), "user_id": r.get("user_id"), "points": r.get("points"), "username": users.get(r.get("user_id"), {}).get("username"), "display_name": users.get(r.get("user_id"), {}).get("display_name")} for r in ranks]
    groups = await db.achievement_groups.find({"category": "season", "is_negative": {"$ne": True}}, {"_id": 0, "code": 1, "name": 1, "condition_key": 1}).sort("sort_order", 1).to_list(100)
    existing = await db.season_standings.count_documents({"season_id": season_id}) if "season_standings" in await db.list_collection_names() else 0
    return {"season": season, "standings": standings, "ranked": len(standings), "season_groups": groups, "already_written": existing > 0}


# ------------------------------------------------------------------ XP

async def xp_caps(db, user_id: str) -> dict:
    """Die Tagesdeckel je Quelle: heute verbraucht gegen den Deckel (Wien)."""
    from services import xp
    day = xp.today_key()
    counts: dict[str, int] = {}
    async for row in db.xp_events.find({"user_id": user_id, "day": day}, {"_id": 0, "source": 1}):
        counts[row["source"]] = counts.get(row["source"], 0) + 1
    rows = []
    for source, (amount, cap) in xp.SOURCES.items():
        if cap is None and counts.get(source, 0) == 0:
            continue
        rows.append({"source": source, "xp": amount, "cap": cap, "used": counts.get(source, 0), "full": cap is not None and counts.get(source, 0) >= cap})
    return {"day": day, "rows": rows, "view": await xp.view(user_id)}


async def prestige_reset(db, actor: dict, user_id: str, reason: str) -> dict:
    """Sterne zurücksetzen (von Hand, mit Grund): Prestige 0, XP bleiben, Level wird neu gerechnet."""
    from services import levels, xp
    doc = await xp.state(user_id)
    total = int(doc.get("total") or 0)
    await db.user_xp.update_one({"user_id": user_id}, {"$set": {"prestige": 0, "level": levels.level_for_xp(total, 0), "total": total}, "$unset": {"prestige_undo": "", "prestige_at": ""}}, upsert=True)
    await log_event(db, "prestige_reset", actor, user_id=user_id, note=reason, data={"stars_before": int(doc.get("prestige") or 0)})
    return await xp.view(user_id)


# ------------------------------------------------------------------ Statistik

async def stats(db, *, weeks: int = 12) -> dict:
    groups, tiers = await visibility._catalog(db)
    rarity = await visibility.rarity(db)
    rows = []
    for code, row in rarity["tiers"].items():
        t = tiers.get(code) or {}
        g = groups.get(t.get("group_code")) or {}
        rows.append({"code": code, "name": t.get("name"), "group_code": t.get("group_code"), "group_name": g.get("name"), "category": category_v2(g.get("category")),
                     "material": t.get("material"), "material_name": t.get("material_name") or MATERIALS.get(t.get("material") or "", {}).get("name"), "rank": int(t.get("rank") or 0),
                     "holders": row["holders"], "percent": row["percent"], "points": int(t.get("points") or 0)})
    rows.sort(key=lambda r: (r["percent"], r["holders"], r["name"] or ""))
    negative = {code for code, g in groups.items() if g.get("is_negative")}
    now = now_utc().astimezone(VIENNA)
    monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    start = monday - timedelta(weeks=weeks - 1)
    weekly: dict[str, int] = {}
    keys = []
    for i in range(weeks):
        wk = start + timedelta(weeks=i)
        iso = wk.isocalendar()
        key = f"{iso.year}-W{iso.week:02d}"
        keys.append(key)
        weekly[key] = 0
    async for award in db.user_achievements.find({"earned_at": {"$gte": start.astimezone(timezone.utc).isoformat()}}, {"_id": 0, "earned_at": 1, "group_code": 1}):
        if award.get("group_code") in negative:
            continue
        when = _parse(award.get("earned_at"))
        if not when:
            continue
        iso = when.astimezone(VIENNA).isocalendar()
        key = f"{iso.year}-W{iso.week:02d}"
        if key in weekly:
            weekly[key] += 1
    top = await visibility.leaderboard(db, limit=10)
    return {"rarity": rows, "weekly": [{"week": k, "unlocks": weekly[k]} for k in keys], "top": top, "base": rarity["base"], "members_base": rarity["members_base"]}


def stats_csv(data: dict) -> str:
    out = io.StringIO()
    writer = csv.writer(out, delimiter=";")
    writer.writerow(["Stufe", "Name", "Gruppe", "Kategorie", "Material", "Rang", "Punkte", "Personen", "Prozent"])
    for r in data.get("rarity", []):
        writer.writerow([r["code"], r["name"], r["group_name"], r["category"], r["material_name"], r["rank"], r["points"], r["holders"], str(r["percent"]).replace(".", ",")])
    writer.writerow([])
    writer.writerow(["Woche", "Freischaltungen"])
    for w in data.get("weekly", []):
        writer.writerow([w["week"], w["unlocks"]])
    return out.getvalue()
