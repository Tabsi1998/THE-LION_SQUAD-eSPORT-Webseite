"""Ehrungen aus der Mitgliederakte (#848, Vereine 1.8.0).

Ehrenmitgliedschaft, Verdienstnadel, Jubiläum: was der Vorstand in Dolibarr an der Mitgliedskarte als Ehrung
einträgt, sieht das Mitglied im eigenen Profil - alle eigenen, mit dem Hinweis, welche der Verein veröffentlichen
lässt. Aufs öffentliche Profil kommt eine Ehrung nur, wenn beides stimmt: Der Verein hat „darf veröffentlicht
werden“ angehakt, und das Mitglied hat „Ehrungen auf meinem Profil zeigen“ eingeschaltet (Standard aus).

- Eigene Liste: ``GET /vereine/me/honours`` (Fähigkeit „Mitgliederakte“, ``record``) - live, wie Unterlagen und Daten.
- Öffentlich: ``GET /vereine/members/{id}/honours`` liefert nur Veröffentlichbares. Der Stand liegt je Konto in
  ``dolibarr_honours`` und wird stündlich für alle mit Schalter aufgefrischt - das öffentliche Profil fragt Dolibarr
  nie selbst. Schalter aus oder Zuordnung weg: Die Liste ist sofort leer.
"""
from __future__ import annotations

from models import now_utc
from services import dolibarr_identity
from services.dolibarr_client import DolibarrClient, DolibarrError, load_settings

COLLECTION = "dolibarr_honours"
MIN_VERSION = (1, 8, 0)
CAPABILITY_LABEL = "Mitgliederakte: eigene Teilnahmen und Ehrungen lesen"
REASON_TEXTS = {
    "not_connected": "Die Mitgliederverwaltung ist nicht live angebunden.",
    "not_bound": "Dafür muss dein Konto mit deinem Mitgliedseintrag verbunden sein – das passiert von selbst über die bestätigte "
                 "E-Mail-Adresse oder durch den Vorstand; alternativ mit einem Einladungscode unter Meine Mitgliedschaft.",
    "module_version": "Ehrungen kennt das Vereinsmodul ab Version 1.8.0 – der Vorstand aktualisiert es.",
    "right_missing": dolibarr_identity.MEMBER_RIGHT_TEXT,
    "no_capability": f"Deine Verbindung erlaubt die Mitgliederakte noch nicht – der Vorstand schaltet die Fähigkeit „{CAPABILITY_LABEL}“ in Dolibarr ein.",
}


def honour_view(row: dict) -> dict:
    return {"kind": str(row.get("kind") or ""), "kind_label": str(row.get("kind_label") or ""), "title": str(row.get("title") or ""),
            "years": int(row.get("years") or 0), "label": str(row.get("label") or ""), "given_on": str(row.get("given_on") or ""),
            "publishable": bool(row.get("publishable"))}


def _public(rows: list[dict]) -> list[dict]:
    """Was aufs öffentliche Profil darf - ohne den Merker, der dort nichts verrät."""
    return [{key: value for key, value in honour_view(row).items() if key != "publishable"} for row in rows if row.get("publishable", True)]


async def _module_ok(db) -> bool:
    state = await db.settings.find_one({"id": dolibarr_identity.STATE_ID}, {"_id": 0, "module_version": 1}) or {}
    return dolibarr_identity.parse_version(state.get("module_version")) >= MIN_VERSION


async def _access(db, user_id: str):
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return None, None, "not_connected"
    access = await dolibarr_identity.access_for(db, settings, user_id)
    if not access:
        return None, None, "not_bound"
    if not await _module_ok(db):
        return access, None, "module_version"
    if access["mode"] == "subject" and "record" not in access["capabilities"]:
        return access, None, "no_capability"
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return access, None, exc.kind
    return access, client, None


async def _mine(db, user_id: str) -> dict:
    return await db[COLLECTION].find_one({"user_id": user_id}, {"_id": 0}) or {}


async def overview(db, user: dict) -> dict:
    """Alle eigenen Ehrungen und der Schalter fürs Profil - oder warum es hier nichts gibt."""
    mine = await _mine(db, user["id"])
    base = {"public": bool(mine.get("public")), "shown": len(mine.get("items") or []) if mine.get("public") else 0, "honours": []}
    access, client, reason = await _access(db, user["id"])
    if reason:
        return {**base, "available": False, "reason": reason, "text": REASON_TEXTS.get(reason, f"Dolibarr antwortet gerade nicht ({reason}).")}
    try:
        rows = await client.my_honours(access["params"])
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            await dolibarr_identity.forbidden(db, access)
            reason = "right_missing" if access["mode"] == "member" else "not_bound"
            return {**base, "available": False, "reason": reason, "text": REASON_TEXTS[reason]}
        return {**base, "available": False, "reason": exc.kind, "text": f"Dolibarr antwortet gerade nicht ({exc.text})."}
    await dolibarr_identity.member_call_ok(db, access)
    honours = [honour_view(row) for row in rows]
    if base["public"]:
        # Was das Mitglied gerade sieht, gilt auch öffentlich - nicht erst nach dem nächsten stündlichen Lauf.
        await _store(db, user["id"], _public(honours))
        base["shown"] = sum(1 for honour in honours if honour["publishable"])
    return {**base, "available": True, "reason": None, "text": "", "honours": honours}


async def _store(db, user_id: str, items: list[dict], **fields) -> None:
    await db[COLLECTION].update_one({"user_id": user_id}, {"$set": {"user_id": user_id, "items": items, "fetched_at": now_utc().isoformat(), **fields}}, upsert=True)


async def refresh_user(db, user_id: str) -> dict:
    """Die veröffentlichbaren Ehrungen eines Kontos neu holen. Ohne Zuordnung leer; Dolibarr stumm: alter Stand bleibt."""
    settings = await load_settings(db)
    if settings.get("mode") != "live" or not await _module_ok(db):
        return {"ok": False, "skipped": "not_live" if settings.get("mode") != "live" else "module_version"}
    access = await dolibarr_identity.access_for(db, settings, user_id)
    member_id = (access or {}).get("member_id")
    if not member_id:
        await _store(db, user_id, [])
        return {"ok": True, "count": 0, "skipped": "not_bound"}
    try:
        rows = await DolibarrClient(settings).member_honours(int(member_id))
    except DolibarrError as exc:
        if exc.kind == "not_found":
            await _store(db, user_id, [])
            return {"ok": True, "count": 0}
        return {"ok": False, "error": exc.kind}
    items = _public(rows)
    await _store(db, user_id, items)
    return {"ok": True, "count": len(items)}


async def set_public(db, user: dict, on: bool) -> dict:
    await db[COLLECTION].update_one({"user_id": user["id"]}, {"$set": {"user_id": user["id"], "public": bool(on), "updated_at": now_utc().isoformat()}}, upsert=True)
    if on:
        await refresh_user(db, user["id"])
    else:
        await _store(db, user["id"], [])
    return await overview(db, user)


async def public_honours(db, user_id: str) -> list[dict]:
    """Fürs öffentliche Profil: nur mit Schalter, nur Veröffentlichbares, nur aus dem Zwischenstand."""
    mine = await _mine(db, user_id)
    return list(mine.get("items") or []) if mine.get("public") else []


async def refresh_due() -> dict:
    """Stündlich: alle Konten mit Schalter."""
    from database import get_db
    db = get_db()
    done = 0
    async for row in db[COLLECTION].find({"public": True}, {"_id": 0, "user_id": 1}):
        result = await refresh_user(db, row["user_id"])
        if result.get("skipped") in ("not_live", "module_version"):
            return result
        done += 1
    return {"ok": True, "refreshed": done}
