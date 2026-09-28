"""Erfolge II (#611): bestehende Vergaben in die neue Welt heben - nichts geht verloren, nichts feiert zweimal.

Zwei Schritte, beide idempotent, beide beim Start nach dem Katalog-Seed:

1. ``annotate_awards``: jede Vergabe in ``user_achievements`` bekommt Material und Rang ihrer Stufe.
2. ``apply_group_mapping``: für jede alte Gruppe aus ``achievement_catalog.migration_map.GROUP_MAPPING``
   - mit Gegenstück: die Zähler der Person neu auswerten, die höchste erreichte neue Stufe (und alle
     darunter) mit dem ursprünglichen Datum vergeben, ohne Meldung; alte Vergaben und alte Gruppe weg.
   - ohne Gegenstück (None): Gruppe und Stufen werden zu „Vermächtnis“ (``legacy_…``), die Vergaben
     hängen daran und bleiben im Profil sichtbar.

``python -m services.achievement_migration --dry-run`` zeigt vorher, was passieren würde.
"""
from __future__ import annotations

import argparse
import asyncio
import logging

from models import new_id, now_utc
from achievement_catalog import GROUP_MAPPING, annotate_tier, material_rank

logger = logging.getLogger("tls.achievements.migration")
MARKER_ID = "achievements_v2_migration"


async def annotate_awards(db) -> dict:
    """Material und Rang an alle Vergaben schreiben, denen sie fehlen."""
    tiers = {t["code"]: t async for t in db.achievements.find({}, {"_id": 0})}
    groups = {g["code"]: g async for g in db.achievement_groups.find({}, {"_id": 0})}
    updated = orphans = 0
    async for award in db.user_achievements.find({"$or": [{"material": {"$exists": False}}, {"rank": {"$exists": False}}]}, {"_id": 0, "id": 1, "tier_code": 1, "level": 1, "group_code": 1}):
        tier = tiers.get(award.get("tier_code"))
        if not tier:
            orphans += 1
            continue
        annotated = annotate_tier(tier, groups.get(tier.get("group_code")))
        await db.user_achievements.update_one({"id": award["id"]}, {"$set": {"material": annotated["material"], "rank": annotated["rank"]}})
        updated += 1
    return {"updated": updated, "orphans": orphans}


def legacy_group_doc(group: dict) -> dict:
    return {
        **group, "code": f"legacy_{group['code']}", "id": f"legacy_{group['code']}",
        "name": f"Vermächtnis: {group.get('name') or group['code']}", "category": "special", "is_special": True,
        "public": True, "legacy": True, "legacy_of": group["code"], "sort_order": 900,
        "description": f"Aus dem alten Katalog übernommen: {group.get('description') or ''}".strip(),
    }


def legacy_tier_doc(tier: dict) -> dict:
    return {**tier, "code": f"legacy_{tier['code']}", "id": f"legacy_{tier['code']}", "group_code": f"legacy_{tier['group_code']}",
            "manual_only": True, "condition_key": None, "progress_target": None, "legacy_of": tier["code"]}


async def _plan_for_group(db, old_code: str, new_code: str | None, compute_progress) -> dict:
    """Was mit einer alten Gruppe passieren würde - als Zahlen und Zeilen, ohne zu schreiben."""
    old_group = await db.achievement_groups.find_one({"code": old_code}, {"_id": 0})
    if not old_group:
        return {"old": old_code, "new": new_code, "skipped": "alte Gruppe nicht in der Datenbank"}
    awards = await db.user_achievements.find({"group_code": old_code}, {"_id": 0}).to_list(100000)
    plan = {"old": old_code, "new": new_code, "awards": len(awards), "users": len({a["user_id"] for a in awards}), "moves": []}
    if new_code is None:
        plan["mode"] = "legacy"
        return plan
    new_group = await db.achievement_groups.find_one({"code": new_code}, {"_id": 0})
    if not new_group:
        return {**plan, "skipped": f"neue Gruppe {new_code} nicht in der Datenbank"}
    new_tiers = sorted(await db.achievements.find({"group_code": new_code, "manual_only": {"$ne": True}}, {"_id": 0}).to_list(500), key=lambda t: material_rank(t.get("material")))
    plan["mode"] = "remap"
    by_user: dict[str, list[dict]] = {}
    for award in awards:
        by_user.setdefault(award["user_id"], []).append(award)
    for user_id, rows in by_user.items():
        counters = await compute_progress(user_id)
        earned_at = min(str(row.get("earned_at") or "") for row in rows) or now_utc().isoformat()
        reached = [t for t in new_tiers if t.get("condition_key") and t.get("progress_target") and counters.get(t["condition_key"], 0) >= int(t["progress_target"])]
        plan["moves"].append({"user_id": user_id, "old_tiers": [row["tier_code"] for row in rows], "new_tiers": [t["code"] for t in reached], "earned_at": earned_at})
    return plan


async def apply_group_mapping(db, mapping: dict | None = None, *, dry_run: bool = False, compute_progress=None) -> dict:
    """Die Abbildung anwenden (oder nur zeigen). Jede alte Gruppe genau einmal, gemerkt im Marker."""
    mapping = GROUP_MAPPING if mapping is None else mapping
    if compute_progress is None:
        from badges import compute_user_progress
        compute_progress = compute_user_progress
    marker = await db.settings.find_one({"id": MARKER_ID}, {"_id": 0}) or {}
    done = set(marker.get("applied") or [])
    report = {"dry_run": dry_run, "groups": []}
    for old_code, new_code in mapping.items():
        if old_code in done:
            continue
        plan = await _plan_for_group(db, old_code, new_code, compute_progress)
        report["groups"].append(plan)
        if dry_run or plan.get("skipped"):
            continue
        stamp = now_utc().isoformat()
        if plan["mode"] == "legacy":
            old_group = await db.achievement_groups.find_one({"code": old_code}, {"_id": 0})
            await db.achievement_groups.update_one({"code": f"legacy_{old_code}"}, {"$set": legacy_group_doc(old_group)}, upsert=True)
            async for tier in db.achievements.find({"group_code": old_code}, {"_id": 0}):
                doc = legacy_tier_doc(tier)
                await db.achievements.update_one({"code": doc["code"]}, {"$set": doc}, upsert=True)
                await db.user_achievements.update_many({"tier_code": tier["code"]}, {"$set": {"tier_code": doc["code"], "group_code": doc["group_code"], "migrated_at": stamp, "migrated_from": tier["code"]}})
        else:
            for move in plan["moves"]:
                for code in move["new_tiers"]:
                    tier = await db.achievements.find_one({"code": code}, {"_id": 0})
                    if await db.user_achievements.find_one({"user_id": move["user_id"], "tier_code": code}):
                        continue
                    await db.user_achievements.insert_one({
                        "id": new_id(), "user_id": move["user_id"], "tier_code": code, "group_code": tier["group_code"],
                        "level": tier.get("level", 1), "material": tier.get("material"), "rank": tier.get("rank"),
                        "earned_at": move["earned_at"], "context": {"migrated_from": old_code, "old_tiers": move["old_tiers"]},
                        "awarded_by": None, "migrated_at": stamp,
                    })
                await db.user_achievements.delete_many({"user_id": move["user_id"], "group_code": old_code})
        await db.achievements.delete_many({"group_code": old_code})
        await db.achievement_groups.delete_one({"code": old_code})
        done.add(old_code)
        await db.settings.update_one({"id": MARKER_ID}, {"$set": {"id": MARKER_ID, "applied": sorted(done), "updated_at": stamp}}, upsert=True)
        logger.info("[achievements] Gruppe %s → %s migriert (%s Vergaben)", old_code, new_code, plan.get("awards"))
    return report


async def run_all(db, *, dry_run: bool = False) -> dict:
    annotated = {"updated": 0, "orphans": 0} if dry_run else await annotate_awards(db)
    mapped = await apply_group_mapping(db, dry_run=dry_run)
    return {"annotated": annotated, "mapping": mapped}


def print_report(report: dict) -> None:
    print(f"Vergaben mit Material versehen: {report['annotated']['updated']} (ohne Stufe: {report['annotated']['orphans']})")
    for plan in report["mapping"]["groups"]:
        if plan.get("skipped"):
            print(f"- {plan['old']} → {plan['new']}: übersprungen ({plan['skipped']})")
            continue
        print(f"- {plan['old']} → {plan['new'] or 'Vermächtnis'}: {plan['awards']} Vergaben bei {plan['users']} Personen")
        for move in plan.get("moves", [])[:20]:
            print(f"    {move['user_id']}: {', '.join(move['old_tiers'])} → {', '.join(move['new_tiers']) or 'nichts erreicht'}")


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Erfolge in den Katalog v2 heben")
    parser.add_argument("--dry-run", action="store_true", help="nur zeigen, nichts schreiben")
    args = parser.parse_args()
    from database import get_db
    report = await run_all(get_db(), dry_run=args.dry_run)
    print_report(report)


if __name__ == "__main__":
    asyncio.run(_main())
