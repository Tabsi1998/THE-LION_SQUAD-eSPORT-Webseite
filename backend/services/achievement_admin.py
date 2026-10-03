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
        # Massenvergaben tragen ihre Empfänger in data.user_ids - so findet die Suche nach einer Person auch sie.
        query["$or"] = [{"user_id": user_id}, {"data.user_ids": user_id}]
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

async def award_with_options(db, actor: dict, user_id: str, tier_code: str, *, note: str | None = None, earned_at: str | None = None, silent: bool = False, notify: bool = True) -> dict:
    """Einzelvergabe mit Datum (rückwirkend) und „ohne Zeremonie“ - Web und App überspringen dann das Fest.
    Die Benachrichtigung (Postfach, Push, Discord) kommt wahlweise: ``notify`` aus lässt sie weg."""
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
    awarded = await award_achievement(user_id, tier_code, context={"manual": True, "by": actor["id"], "note": note, "silent": silent, "notify": notify}, awarded_by=actor["id"])
    if not awarded:
        return {"ok": True, "already_awarded": True}
    updates: dict = {}
    if when:
        updates["earned_at"] = when.astimezone(timezone.utc).isoformat()
    if silent:
        updates["silent"] = True
    if updates:
        await db.user_achievements.update_one({"user_id": user_id, "tier_code": tier_code}, {"$set": updates})
    await log_event(db, "award", actor, user_id=user_id, tier_code=tier_code, note=note, data={"earned_at": updates.get("earned_at"), "silent": silent, "notify": notify})
    return {"ok": True, "newly_awarded": True, "earned_at": updates.get("earned_at"), "silent": silent, "notify": notify}


async def revoke_with_reason(db, actor: dict, user_id: str, tier_code: str, *, note: str | None) -> dict:
    res = await db.user_achievements.delete_one({"user_id": user_id, "tier_code": tier_code})
    if res.deleted_count == 0:
        raise LookupError("Nicht vergeben.")
    await log_event(db, "revoke", actor, user_id=user_id, tier_code=tier_code, note=note)
    return {"ok": True}


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


async def resolve_names(db, names: list[str]) -> tuple[list[str], list[str]]:
    """Namen aus einer CSV-Liste (Benutzername, E-Mail oder Konto-ID, Groß-/Kleinschreibung egal) → Konten.
    Liefert (gefundene IDs in Reihenfolge, nicht gefundene Namen)."""
    import re

    wanted = [name for name in (str(raw or "").strip().lstrip("@") for raw in names or []) if name]
    if not wanted:
        return [], []
    lowered = sorted({name.lower() for name in wanted})
    projection = {"_id": 0, "id": 1, "username": 1, "email": 1}
    index: dict[str, str] = {}

    def remember(row: dict) -> None:
        index.setdefault(row["id"], row["id"])
        for field in ("username", "email"):
            if row.get(field):
                index.setdefault(str(row[field]).lower(), row["id"])

    # Ein Zug über die Indizes: Konto-ID, Benutzername wie getippt oder klein, E-Mail (immer klein gespeichert).
    query = {"$or": [{"id": {"$in": sorted(set(wanted))}}, {"username": {"$in": sorted(set(wanted) | set(lowered))}}, {"email": {"$in": lowered}}]}
    async for row in db.users.find(query, projection):
        remember(row)
    # Übrig (z. B. „Paula“ für das Konto „pAuLa“): eine einzige Suche ohne Groß/Klein-Unterschied.
    rest = sorted({name for name in wanted if name not in index and name.lower() not in index})
    if rest:
        pattern = "^(?:" + "|".join(re.escape(name) for name in rest) + ")$"
        async for row in db.users.find({"$or": [{"username": {"$regex": pattern, "$options": "i"}}, {"email": {"$regex": pattern, "$options": "i"}}]}, projection):
            remember(row)
    found: list[str] = []
    unknown: list[str] = []
    for name in wanted:
        user_id = index.get(name) or index.get(name.lower())
        if user_id:
            found.append(user_id)
        else:
            unknown.append(name)
    return found, unknown


async def bulk_award(db, actor: dict, tier_code: str, selection: dict, *, note: str | None = None, earned_at: str | None = None, silent: bool = False, notify: bool = True, dry_run: bool = False) -> dict:
    """Massenvergabe: Empfänger auflösen (Liste, Namen aus einer CSV, Turnier, Event, Team, Mitglieder, Rolle),
    prüfen und in einem Zug schreiben - höchstens 500 auf einmal. XP, Schlange und Meldung folgen wie bei der
    Einzelvergabe (``badges.after_award``); die Auswertung danach (Sammler und Co.) läuft über die Warteschlange.
    ``dry_run`` schreibt nichts und zeigt je Person, ob sie es bekäme, schon hat oder nicht darf."""
    from badges import after_award, award_doc
    from pymongo.errors import BulkWriteError

    named, unknown = await resolve_names(db, selection.get("names") or [])
    candidates = await resolve_recipients(db, {**selection, "user_ids": [*(selection.get("user_ids") or []), *named]})
    if len(candidates) > 2 * BULK_LIMIT:
        raise ValueError(f"Höchstens {BULK_LIMIT} Personen auf einmal - es wären {len(candidates)}.")
    tier = await db.achievements.find_one({"code": tier_code}, {"_id": 0})
    if not tier:
        raise LookupError("Stufe nicht gefunden.")
    group = await db.achievement_groups.find_one({"code": tier.get("group_code")}, {"_id": 0})
    if not group:
        raise LookupError("Gruppe nicht gefunden.")
    when = _parse(earned_at) if earned_at else None
    if earned_at and not when:
        raise ValueError("Das Datum ist nicht lesbar.")
    if when and when > now_utc() + timedelta(minutes=5):
        raise ValueError("Das Datum liegt in der Zukunft.")
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": candidates}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(len(candidates) or 1)}
    unknown += [uid for uid in candidates if uid not in users]
    recipients = [uid for uid in candidates if uid in users]
    if len(recipients) > BULK_LIMIT:
        raise ValueError(f"Höchstens {BULK_LIMIT} Personen auf einmal - es wären {len(recipients)}.")
    holders = set(await db.user_achievements.distinct("user_id", {"tier_code": tier_code, "user_id": {"$in": recipients}}))
    members: set[str] | None = None
    if tier.get("member_only"):
        from services.membership_service import is_active_member
        members = {m["user_id"] async for m in db.memberships.find({"user_id": {"$in": recipients}}, {"_id": 0, "user_id": 1, "member_status": 1}) if is_active_member(m)}
    states: dict[str, str] = {}
    for user_id in recipients:
        if members is not None and user_id not in members:
            states[user_id] = "skipped"
        elif user_id in holders:
            states[user_id] = "already"
        else:
            states[user_id] = "new"
    fresh = [uid for uid in recipients if states[uid] == "new"]
    result = {
        "recipients": len(recipients), "awarded": 0, "would_award": len(fresh),
        "already": sum(1 for s in states.values() if s == "already"), "skipped": sum(1 for s in states.values() if s == "skipped"),
        "unknown": unknown, "dry_run": dry_run, "user_ids": recipients,
    }
    if dry_run:
        result["people"] = [{"id": uid, "username": users[uid].get("username"), "display_name": users[uid].get("display_name"), "state": states[uid]} for uid in recipients]
        return result
    stamp = when.astimezone(timezone.utc).isoformat() if when else None
    context = {"manual": True, "bulk": True, "by": actor["id"], "note": note, "silent": silent, "notify": notify}
    docs = []
    for user_id in fresh:
        doc = award_doc(user_id, tier, group, context=dict(context), awarded_by=actor["id"], earned_at=stamp)
        if silent:
            doc["silent"] = True
        docs.append(doc)
    awarded = list(fresh)
    if docs:
        try:
            await db.user_achievements.insert_many(docs, ordered=False)
        except BulkWriteError as exc:
            # Dazwischen vergeben (die Auswertung lief parallel): diese zählen als „schon da“.
            clashed = {docs[err["index"]]["user_id"] for err in (exc.details or {}).get("writeErrors", [])}
            awarded = [uid for uid in fresh if uid not in clashed]
    await after_award(awarded, tier, group, notify=notify)
    result["awarded"] = len(awarded)
    result["already"] += len(fresh) - len(awarded)
    await log_event(db, "bulk_award", actor, tier_code=tier_code, note=note, data={
        "selection": {k: v for k, v in selection.items() if k not in ("user_ids", "names")},
        **{k: result[k] for k in ("recipients", "awarded", "already", "skipped")},
        "unknown": len(unknown), "silent": silent, "notify": notify, "earned_at": stamp, "user_ids": awarded,
    })
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
    await _season_close_awards(db, season_id, standings)
    mvp = await db.achievements.find_one({"code": MVP_TIER}, {"_id": 0, "code": 1, "name": 1, "material": 1})
    if mvp:
        mvp["holders"] = await db.user_achievements.distinct("user_id", {"tier_code": MVP_TIER})
    return {
        "season": season, "standings": standings, "ranked": len(standings), "season_groups": groups, "already_written": existing > 0,
        "finished": season.get("status") in ("completed", "archived"),
        "awards_total": sum(len(row["awards"]) for row in standings), "mvp": mvp,
    }


MVP_TIER = "season_mvp_1"
# Was der Abschluss an den Zählern ändert: Platz 1 (Saisonmeister), Top 10 (Saisonspitze), jede Runde gespielt (Volle Saison).
SEASON_CLOSE_KEYS = ("season_wins", "season_top10_finishes", "seasons_fully_played")


def _top10(rank) -> bool:
    return isinstance(rank, int) and rank <= 10


async def _season_close_awards(db, season_id: str, standings: list[dict]) -> None:
    """Je Platz die Stufen, die der Abschluss neu freischalten würde - gerechnet wie die Zähler, mit dieser Saison
    als festgeschrieben und abgeschlossen. Schreibt ``awards`` in jede Zeile, ohne etwas zu speichern."""
    from badges import can_award_tier_to_user
    from services import achievement_counters as counters

    tiers = await db.achievements.find({"condition_key": {"$in": list(SEASON_CLOSE_KEYS)}, "manual_only": {"$ne": True}}, {"_id": 0}).to_list(200)
    for row in standings:
        row["awards"] = []
    if not tiers:
        return
    group_names = {g["code"]: g.get("name") for g in await db.achievement_groups.find({"code": {"$in": list({t.get("group_code") for t in tiers})}}, {"_id": 0, "code": 1, "name": 1}).to_list(50)}
    tiers.sort(key=lambda t: (str(t.get("group_code")), int(t.get("rank") or 0)))
    codes = [t["code"] for t in tiers]
    season = await db.seasons.find_one({"id": season_id}, {"_id": 0}) or {"id": season_id}
    finished = counters._finished(season)
    before = {row["user_id"]: row.get("rank") async for row in db.season_standings.find({"season_id": season_id}, {"_id": 0, "user_id": 1, "rank": 1})}
    for row in standings:
        user_id = row.get("user_id")
        if not user_id:
            continue
        values = await counters.compute(user_id, set(SEASON_CLOSE_KEYS), legacy=False)
        rank, old = row.get("rank"), before.get(user_id)
        values["season_wins"] = values.get("season_wins", 0) + int(rank == 1) - int(old == 1)
        values["season_top10_finishes"] = values.get("season_top10_finishes", 0) + int(_top10(rank)) - int(_top10(old))
        if not finished:
            points = await db.season_points.find({"user_id": user_id, "season_id": season_id}, {"_id": 0, "season_id": 1, "source_id": 1}).to_list(5000)
            values["seasons_fully_played"] = values.get("seasons_fully_played", 0) + int(counters.fully_played(season, points))
        held = set(await db.user_achievements.distinct("tier_code", {"user_id": user_id, "tier_code": {"$in": codes}}))
        for tier in tiers:
            if tier["code"] in held or values.get(tier["condition_key"], 0) < int(tier.get("progress_target") or 0):
                continue
            if tier.get("member_only") and not await can_award_tier_to_user(user_id, tier):
                continue
            row["awards"].append({"code": tier["code"], "name": tier.get("name"), "group_name": group_names.get(tier.get("group_code")), "material": tier.get("material")})


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
