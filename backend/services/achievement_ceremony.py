"""Zeremonie einmal je Konto (#2450): was die Person schon gesehen hat - am Server, für Website und App gemeinsam.

Vorher merkte sich jedes Gerät selbst, was es schon gefeiert hatte (Browser: ``localStorage``, App: SecureStore). Dieselbe
Zeremonie kam dadurch in der App, am PC und im Handy-Browser je einmal. Jetzt steht der Stand am Konto:

- **Erfolge und Stufen-Aufstiege:** ``user_achievements.ceremony_seen_at`` an der einzelnen Vergabe. Fehlt das Feld, ist
  sie nicht gesehen - auch im Altbestand.
- **Level-Aufstiege, Sammel-Zeremonie der Neuberechnung und der Beginn:** eine Zeile je Person in ``ceremony_seen``
  (``level`` = zuletzt gesehener Stand, ``recount_seen`` = gesehene Kennungen der Neuberechnung, ``since`` = erste
  Meldung eines Geräts am Server, ``horizon`` = ältester gemeldeter Stand eines Geräts).

Keine Flut nach dem Deploy: der Altbestand hat kein ``ceremony_seen_at``. Als „ungesehen“ zählt eine Vergabe darum nur,
wenn sie nach der ersten Meldung eines Geräts angelegt wurde (``since``, über den Zeitstempel der ``_id``) oder jünger ist als
der älteste Stand, den ein Gerät einmalig gemeldet hat (``horizon`` - was das Gerät bisher selbst noch nachgeholt
hätte). Ältere Vergaben, von denen kein Gerät etwas weiß, bekommen keine Zeremonie mehr - wie bisher beim ersten Besuch
auf einem neuen Gerät.
"""
from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId

from models import now_utc
from services import xp

MAX_CODES = 200
MAX_UNSEEN = 100
MAX_MARKERS = 20
MAX_TEXT = 120


def parse_time(value) -> datetime | None:
    """Ein Zeitpunkt aus der Datenbank oder vom Gerät - ISO-Text (auch mit ``Z``) oder datetime, immer in UTC."""
    if isinstance(value, datetime):
        stamp = value
    elif isinstance(value, str) and value.strip():
        try:
            stamp = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def level_state(value) -> dict | None:
    """Ein Level-Stand ``{level, title, prestige}`` - None, wenn nichts Brauchbares ankommt."""
    if not isinstance(value, dict):
        return None
    try:
        level = int(value.get("level") or 0)
        prestige = int(value.get("prestige") or 0)
    except (TypeError, ValueError):
        return None
    if level < 1:
        return None
    return {"level": min(level, 1000), "title": str(value.get("title") or "")[:MAX_TEXT], "prestige": max(0, min(prestige, 1000))}


def is_level_gain(prev: dict | None, nxt: dict | None) -> bool:
    """Wie im Web und in der App: mehr Sterne, oder gleich viele Sterne und ein höheres Level."""
    prev_stars, next_stars = int((prev or {}).get("prestige") or 0), int((nxt or {}).get("prestige") or 0)
    if next_stars != prev_stars:
        return next_stars > prev_stars
    return int((nxt or {}).get("level") or 0) > int((prev or {}).get("level") or 0)


async def _current_level(db, user_id: str) -> dict:
    await xp.rebuild(user_id)
    view = await xp.view(user_id)
    return {"level": int(view.get("level") or 1), "title": str(view.get("title") or ""), "prestige": int(view.get("prestige") or 0)}


async def _ensure(db, user_id: str) -> dict:
    """Die Zeile der Person - mit der ersten Meldung eines Geräts angelegt, ``since`` steht danach fest."""
    stamp = now_utc().isoformat()
    fresh = {"user_id": user_id, "since": stamp, "recount_seen": [], "created_at": stamp}
    await db.ceremony_seen.update_one({"user_id": user_id}, {"$setOnInsert": fresh}, upsert=True)
    return await db.ceremony_seen.find_one({"user_id": user_id}, {"_id": 0}) or {"user_id": user_id, "since": stamp}


def _created_at(award: dict) -> datetime | None:
    oid = award.get("_id")
    return oid.generation_time if isinstance(oid, ObjectId) else None


def _eligible(award: dict, since: datetime | None, horizon: datetime | None) -> bool:
    """Neu genug für eine Zeremonie: nach der ersten Meldung angelegt, oder jünger als der älteste gemeldete Gerätestand."""
    earned = parse_time(award.get("earned_at"))
    created = _created_at(award) or earned
    # Die _id kennt nur ganze Sekunden - eine Vergabe in derselben Sekunde wie die erste Meldung zählt als neu.
    if since and created and created >= since.replace(microsecond=0):
        return True
    return bool(horizon and earned and earned > horizon)


async def _unseen_codes(db, user_id: str, row: dict) -> list[str]:
    since, horizon = parse_time(row.get("since")), parse_time(row.get("horizon"))
    # Umgezogene Vergaben (Katalog-Migration, ``migrated_at``) bekommen eine neue _id, sind aber alte Erfolge - nie feiern.
    query = {"user_id": user_id, "ceremony_seen_at": {"$exists": False}, "silent": {"$ne": True}, "recount": {"$ne": True},
             "migrated_at": {"$exists": False}}
    awards = await db.user_achievements.find(query, {"tier_code": 1, "earned_at": 1}).to_list(2000)
    fresh = [award for award in awards if award.get("tier_code") and _eligible(award, since, horizon)]
    fresh.sort(key=lambda award: parse_time(award.get("earned_at")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return [str(award["tier_code"]) for award in fresh[:MAX_UNSEEN]]


async def state(db, user_id: str) -> dict:
    """Was die Person schon gesehen hat - für die Prüfung vor jeder Zeremonie, auf jedem Gerät gleich.

    Fehlt der Level-Stand (erste Meldung ohne Level-Stand des Geräts), gilt der jetzige als gesehen - kein Aufstieg zum
    Start. Liegt der gemerkte Stand über dem echten (Prestige zurückgenommen), rückt er auf den echten zurück; ein
    erneutes Prestige wird dann wieder gefeiert - wie bisher im Gerät.

    Nur lesen: Ohne Zeile (noch kein Gerät hat sich gemeldet) kommt der Stand „alles bisher ist Altbestand“, ohne etwas
    anzulegen. Angelegt wird die Zeile mit der ersten Meldung eines Geräts (``import_device``) - so kann ein Gerät seinen
    Altbestand melden, bevor der Server einen Beginn festlegt, und ein älterer Client legt nichts an."""
    row = await db.ceremony_seen.find_one({"user_id": user_id}, {"_id": 0})
    current = await _current_level(db, user_id)
    if row is None:
        return {"since": None, "unseen": [], "level": current, "recount_seen": []}
    seen_level = level_state(row.get("level"))
    if seen_level is None or is_level_gain(current, seen_level):
        seen_level = current
        await db.ceremony_seen.update_one({"user_id": user_id}, {"$set": {"level": current, "updated_at": now_utc().isoformat()}})
    return {
        "since": row.get("since"),
        "unseen": await _unseen_codes(db, user_id, row),
        "level": seen_level,
        "recount_seen": [str(marker) for marker in row.get("recount_seen") or []][:MAX_MARKERS],
    }


async def _mark_codes(db, user_id: str, codes: list[str]) -> int:
    codes = [str(code)[:MAX_TEXT] for code in codes or [] if isinstance(code, str) and code][:MAX_CODES]
    if not codes:
        return 0
    result = await db.user_achievements.update_many(
        {"user_id": user_id, "tier_code": {"$in": codes}, "ceremony_seen_at": {"$exists": False}},
        {"$set": {"ceremony_seen_at": now_utc().isoformat()}})
    return int(result.modified_count or 0)


async def _raise_level(db, user_id: str, row: dict, level: dict | None) -> None:
    """Den gesehenen Level-Stand anheben - nie senken, nie über den echten Stand hinaus."""
    if level is None:
        return
    current = await _current_level(db, user_id)
    if is_level_gain(current, level):
        level = current
    known = level_state(row.get("level"))
    if known is None or is_level_gain(known, level):
        await db.ceremony_seen.update_one({"user_id": user_id}, {"$set": {"level": level, "updated_at": now_utc().isoformat()}})


async def _add_markers(db, user_id: str, markers) -> None:
    markers = [str(marker)[:MAX_TEXT] for marker in markers or [] if isinstance(marker, str) and marker][:MAX_MARKERS]
    if markers:
        await db.ceremony_seen.update_one({"user_id": user_id}, {"$addToSet": {"recount_seen": {"$each": markers}}})


async def mark_seen(db, user_id: str, *, codes: list[str] | None = None, level: dict | None = None,
                    recount_marker: str | None = None) -> dict:
    """Gesehen - nach jeder Art des Schließens. Nur eigene Vergaben; zweimal dasselbe ändert nichts."""
    row = await _ensure(db, user_id)
    seen = await _mark_codes(db, user_id, codes or [])
    await _raise_level(db, user_id, row, level_state(level))
    await _add_markers(db, user_id, [recount_marker] if recount_marker else [])
    return {"ok": True, "seen": seen}


async def import_device(db, user_id: str, *, seen_until=None, level=None, recount_markers=None) -> dict:
    """Altbestand eines Geräts, einmalig gemeldet (beliebig oft ohne Wirkung): was es bis ``seen_until`` schon gezeigt
    hat, gilt am Konto als gesehen; der älteste gemeldete Stand wird ``horizon`` - was danach kam, holt die Sammel-
    Zeremonie wie bisher nach. Dazu der zuletzt gesehene Level-Stand und die gesehenen Neuberechnungen."""
    row = await _ensure(db, user_id)
    until = parse_time(seen_until)
    now = now_utc()
    if until and until > now:
        until = now
    if until:
        stamp = until.astimezone(timezone.utc).isoformat()
        known = parse_time(row.get("horizon"))
        if known is None or until < known:
            await db.ceremony_seen.update_one({"user_id": user_id}, {"$set": {"horizon": stamp}})
        query = {"user_id": user_id, "ceremony_seen_at": {"$exists": False}}
        awards = await db.user_achievements.find(query, {"_id": 0, "tier_code": 1, "earned_at": 1}).to_list(2000)
        older = [award["tier_code"] for award in awards
                 if award.get("tier_code") and (parse_time(award.get("earned_at")) or now) <= until]
        for start in range(0, len(older), MAX_CODES):
            await _mark_codes(db, user_id, older[start:start + MAX_CODES])
    await _raise_level(db, user_id, row, level_state(level))
    await _add_markers(db, user_id, recount_markers)
    return await state(db, user_id)
