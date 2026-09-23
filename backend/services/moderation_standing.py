"""Verwarnungen mit Stufen (#416, Moderation II): Hinweis, Verwarnung mit Chat-Sperre, Sperre bis
zur Entscheidung - automatisch angestoßen, dokumentiert, mit Einspruch.

Ein **Treffer** (``moderation_strikes``) entsteht, wenn die Moderation einen Wortfilter-Fund
zurückweist, eine Meldung als „berechtigt“ erledigt oder einen Treffer von Hand einträgt (später
auch die Bildprüfung, #415). Treffer verfallen nach ``strike_ttl_months`` und lassen sich mit Grund
zurücknehmen.

Die **Stufen** stehen in ``settings id moderation_levels``: ab wie vielen Treffern welche Maßnahme
(``notice`` Hinweis, ``warning`` Verwarnung mit Chat-Sperre für ``chat_hours``, ``suspension``
Sperre, bis ein Mensch entscheidet). Nach jedem Treffer wird die Stufe neu bestimmt; eine
**Sanktion** (``moderation_sanctions``) entsteht nur, wenn die neue Stufe höher ist als die
laufende. Stufe 3 endet nie von selbst - sie hebt die Moderation auf.

Die Chat-Routen (Direktnachrichten, Team-, Turnier- und Match-Chat, Anhänge) fragen
``require_chat_allowed``. Die Person sieht ihren Stand unter „Meine Strafen“ (Web) und im
Profil (App) und legt dort Einspruch ein; die Moderation sieht die Historie je Person unter
Admin → Moderation → Personen. Kein Pranger: nach außen ist nichts davon sichtbar.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from models import new_id, now_utc

logger = logging.getLogger("tls.moderation")

SETTINGS_ID = "moderation_levels"
ACTIONS = ("notice", "warning", "suspension")
ACTION_RANK = {action: index for index, action in enumerate(ACTIONS)}
ACTION_LABELS = {"notice": "Hinweis", "warning": "Verwarnung mit Chat-Sperre", "suspension": "Sperre bis zur Entscheidung"}
SOURCE_LABELS = {"word_filter": "Wortfilter", "report": "Meldung", "image_scan": "Bildprüfung", "manual": "Moderation"}
DEFAULT_LEVELS = [
    {"strikes": 1, "action": "notice", "chat_hours": 0},
    {"strikes": 2, "action": "warning", "chat_hours": 24},
    {"strikes": 3, "action": "suspension", "chat_hours": 0},
]
DEFAULT_TTL_MONTHS = 12
STANDING_URL = "/my/penalties"
MODERATION_ROLES = ("moderator", "tournament_admin", "club_admin", "superadmin")


# ---------------------------------------------------------------- Zeit und Einstellungen

def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _fmt(value) -> str:
    moment = _parse(value)
    return moment.astimezone(timezone.utc).strftime("%d.%m.%Y, %H:%M") + " UTC" if moment else ""


def normalize_settings(raw: dict | None) -> dict:
    """Stufen prüfen: 1-5 Stufen, aufsteigende Trefferzahlen, gültige Maßnahmen; sonst 400."""
    raw = raw or {}
    levels_in = raw.get("levels")
    if levels_in is None:
        levels_in = DEFAULT_LEVELS
    if not isinstance(levels_in, list) or not 1 <= len(levels_in) <= 5:
        raise HTTPException(400, "Es braucht eine bis fünf Stufen.")
    levels = []
    last = 0
    for row in levels_in:
        if not isinstance(row, dict):
            raise HTTPException(400, "Jede Stufe braucht Treffer und Maßnahme.")
        try:
            strikes = int(row.get("strikes"))
            chat_hours = int(row.get("chat_hours") or 0)
        except (TypeError, ValueError):
            raise HTTPException(400, "Treffer und Stunden sind ganze Zahlen.")
        action = str(row.get("action") or "")
        if action not in ACTIONS:
            raise HTTPException(400, "Maßnahme ist Hinweis, Verwarnung oder Sperre.")
        if not 1 <= strikes <= 50 or strikes <= last:
            raise HTTPException(400, "Die Trefferzahlen müssen aufsteigen (1 bis 50).")
        if not 0 <= chat_hours <= 720:
            raise HTTPException(400, "Die Chat-Sperre dauert 0 bis 720 Stunden.")
        if action == "warning" and chat_hours == 0:
            chat_hours = 24
        if action != "warning":
            chat_hours = 0
        levels.append({"strikes": strikes, "action": action, "chat_hours": chat_hours})
        last = strikes
    try:
        ttl = int(raw.get("strike_ttl_months") or DEFAULT_TTL_MONTHS)
    except (TypeError, ValueError):
        raise HTTPException(400, "Die Verfallszeit ist eine Zahl in Monaten.")
    if not 1 <= ttl <= 60:
        raise HTTPException(400, "Treffer verfallen nach 1 bis 60 Monaten.")
    return {"levels": levels, "strike_ttl_months": ttl}


async def load_settings(db) -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    try:
        return normalize_settings(doc)
    except HTTPException:
        return normalize_settings(None)


async def save_settings(db, updates: dict) -> dict:
    current = await load_settings(db)
    merged = normalize_settings({**current, **{k: v for k, v in (updates or {}).items() if v is not None}})
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, **merged, "updated_at": now_utc().isoformat()}}, upsert=True)
    return merged


def level_for(count: int, settings: dict) -> dict | None:
    """Die höchste Stufe, deren Trefferzahl erreicht ist - oder None."""
    best = None
    for level in settings["levels"]:
        if count >= level["strikes"]:
            best = level
    return best


# ---------------------------------------------------------------- Treffer

def _cutoff(settings: dict, now: datetime) -> str:
    return (now - timedelta(days=30.44 * settings["strike_ttl_months"])).isoformat()


async def active_strikes(db, user_id: str, settings: dict | None = None, now: datetime | None = None) -> list[dict]:
    settings = settings or await load_settings(db)
    now = now or now_utc()
    rows = await db.moderation_strikes.find(
        {"user_id": user_id, "revoked": {"$ne": True}, "created_at": {"$gte": _cutoff(settings, now)}}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    return rows


async def add_strike(db, user_id: str, *, source: str, kind: str | None = None, ref_id: str | None = None, item_id: str | None = None,
                     report_id: str | None = None, moderator_id: str | None = None, note: str | None = None) -> dict:
    """Einen Treffer eintragen und die Stufe neu bestimmen."""
    now = now_utc().isoformat()
    strike = {
        "id": new_id(), "user_id": user_id, "source": source, "kind": kind, "ref_id": ref_id, "item_id": item_id, "report_id": report_id,
        "moderator_id": moderator_id, "note": (note or "").strip() or None, "created_at": now,
    }
    await db.moderation_strikes.insert_one(dict(strike))
    sanction = await apply_levels(db, user_id, actor_id=moderator_id)
    return {"strike": strike, "sanction": sanction}


async def revoke_strike(db, strike_id: str, *, moderator_id: str, note: str | None = None) -> dict:
    strike = await db.moderation_strikes.find_one({"id": strike_id}, {"_id": 0})
    if not strike:
        raise HTTPException(404, "Treffer nicht gefunden.")
    if strike.get("revoked"):
        raise HTTPException(409, "Dieser Treffer ist schon zurückgenommen.")
    now = now_utc().isoformat()
    await db.moderation_strikes.update_one({"id": strike_id}, {"$set": {"revoked": True, "revoked_by": moderator_id, "revoked_at": now, "revoke_note": (note or "").strip() or None}})
    await _audit(db, moderator_id, "moderation.strike_revoked", strike["user_id"], {"strike_id": strike_id, "note": note})
    return await db.moderation_strikes.find_one({"id": strike_id}, {"_id": 0})


# ---------------------------------------------------------------- Sanktionen

async def active_sanction(db, user_id: str, now: datetime | None = None) -> dict | None:
    """Die laufende Sanktion - abgelaufene Verwarnungen werden dabei als „abgelaufen“ markiert."""
    now = now or now_utc()
    rows = await db.moderation_sanctions.find({"user_id": user_id, "status": "active"}, {"_id": 0}).sort("created_at", -1).to_list(20)
    current = None
    for row in rows:
        expires = _parse(row.get("expires_at"))
        if expires and expires <= now:
            await db.moderation_sanctions.update_one({"id": row["id"]}, {"$set": {"status": "expired", "updated_at": now.isoformat()}})
            continue
        if current is None:
            current = row
    return current


async def apply_levels(db, user_id: str, *, actor_id: str | None = None) -> dict | None:
    """Nach einem Treffer: Stufe bestimmen; eine neue Sanktion nur, wenn sie höher ist als die laufende."""
    settings = await load_settings(db)
    strikes = await active_strikes(db, user_id, settings)
    level = level_for(len(strikes), settings)
    if not level:
        return None
    current = await active_sanction(db, user_id)
    if current and ACTION_RANK.get(current.get("action"), -1) >= ACTION_RANK[level["action"]]:
        return None
    reason = f"{len(strikes)}. Treffer innerhalb von {settings['strike_ttl_months']} Monaten"
    last = strikes[-1] if strikes else None
    if last and last.get("note"):
        reason += f" – zuletzt: {last['note']}"
    elif last:
        reason += f" – zuletzt: {SOURCE_LABELS.get(last.get('source'), last.get('source') or '')}"
    return await _create_sanction(db, user_id, level["action"], reason=reason, chat_hours=level.get("chat_hours") or 0, created_by=actor_id,
                                  automatic=True, strike_ids=[s["id"] for s in strikes], strike_count=len(strikes), supersede=current)


async def set_sanction(db, user_id: str, action: str, *, moderator_id: str, reason: str, chat_hours: int | None = None) -> dict:
    """Von Hand eine Stufe setzen - ersetzt die laufende Sanktion."""
    if action not in ACTIONS:
        raise HTTPException(400, "Maßnahme ist Hinweis, Verwarnung oder Sperre.")
    settings = await load_settings(db)
    hours = chat_hours if chat_hours is not None else next((lvl["chat_hours"] for lvl in settings["levels"] if lvl["action"] == action), 24)
    strikes = await active_strikes(db, user_id, settings)
    current = await active_sanction(db, user_id)
    return await _create_sanction(db, user_id, action, reason=reason.strip(), chat_hours=hours if action == "warning" else 0, created_by=moderator_id,
                                  automatic=False, strike_ids=[s["id"] for s in strikes], strike_count=len(strikes), supersede=current)


async def _create_sanction(db, user_id: str, action: str, *, reason: str, chat_hours: int, created_by: str | None, automatic: bool,
                           strike_ids: list[str], strike_count: int, supersede: dict | None) -> dict:
    now = now_utc()
    blocked_until = (now + timedelta(hours=chat_hours)).isoformat() if action == "warning" and chat_hours else None
    doc = {
        "id": new_id(), "user_id": user_id, "action": action, "label": ACTION_LABELS[action], "reason": reason,
        "strike_ids": strike_ids, "strike_count": strike_count, "created_by": created_by, "automatic": automatic,
        "status": "active", "chat_blocked_until": blocked_until, "expires_at": blocked_until, "open_until_decision": action == "suspension",
        "appeal": None, "created_at": now.isoformat(), "updated_at": now.isoformat(),
    }
    if supersede:
        await db.moderation_sanctions.update_one({"id": supersede["id"]}, {"$set": {"status": "superseded", "superseded_by": doc["id"], "updated_at": now.isoformat()}})
    await db.moderation_sanctions.insert_one(dict(doc))
    await _audit(db, created_by or "auto", "moderation.sanction", user_id, {"sanction_id": doc["id"], "action": action, "automatic": automatic, "reason": reason})
    await _notify(db, user_id, doc)
    return doc


async def lift_sanction(db, sanction_id: str, *, moderator_id: str, note: str | None = None) -> dict:
    sanction = await db.moderation_sanctions.find_one({"id": sanction_id}, {"_id": 0})
    if not sanction:
        raise HTTPException(404, "Sanktion nicht gefunden.")
    if sanction.get("status") != "active":
        raise HTTPException(409, "Diese Sanktion läuft nicht mehr.")
    now = now_utc().isoformat()
    await db.moderation_sanctions.update_one({"id": sanction_id}, {"$set": {"status": "lifted", "lifted_by": moderator_id, "lifted_at": now, "lift_note": (note or "").strip() or None, "updated_at": now}})
    await _audit(db, moderator_id, "moderation.sanction_lifted", sanction["user_id"], {"sanction_id": sanction_id, "note": note})
    await _notify_lifted(db, sanction["user_id"], sanction, note)
    return await db.moderation_sanctions.find_one({"id": sanction_id}, {"_id": 0})


# ---------------------------------------------------------------- Chat-Sperre

async def chat_block(db, user_id: str) -> dict | None:
    """Ob die Person gerade nicht schreiben darf - und warum."""
    sanction = await active_sanction(db, user_id)
    if not sanction:
        return None
    if sanction["action"] == "suspension":
        return {"sanction_id": sanction["id"], "action": "suspension", "until": None, "reason": sanction.get("reason") or ""}
    if sanction["action"] == "warning" and sanction.get("chat_blocked_until"):
        until = _parse(sanction["chat_blocked_until"])
        if until and until > now_utc():
            return {"sanction_id": sanction["id"], "action": "warning", "until": sanction["chat_blocked_until"], "reason": sanction.get("reason") or ""}
    return None


def block_text(block: dict) -> str:
    if block["action"] == "suspension":
        return "Dein Konto ist gesperrt, bis die Moderation entschieden hat – Schreiben ist so lange nicht möglich. Deinen Stand und den Einspruch findest du unter „Meine Strafen“."
    return f"Dein Chat ist bis {_fmt(block['until'])} gesperrt (Verwarnung). Deinen Stand und den Einspruch findest du unter „Meine Strafen“."


async def require_chat_allowed(db, me: dict) -> None:
    block = await chat_block(db, me["id"])
    if block:
        raise HTTPException(403, block_text(block))


# ---------------------------------------------------------------- Sichten

def _strike_view(strike: dict, *, for_person: bool) -> dict:
    view = {
        "id": strike["id"], "source": strike.get("source"), "source_label": SOURCE_LABELS.get(strike.get("source"), strike.get("source") or ""),
        "kind": strike.get("kind"), "note": strike.get("note"), "created_at": strike.get("created_at"), "revoked": bool(strike.get("revoked")),
    }
    if not for_person:
        view.update({"ref_id": strike.get("ref_id"), "item_id": strike.get("item_id"), "report_id": strike.get("report_id"),
                     "moderator_id": strike.get("moderator_id"), "revoked_by": strike.get("revoked_by"), "revoked_at": strike.get("revoked_at"), "revoke_note": strike.get("revoke_note")})
    return view


def _sanction_view(sanction: dict, *, for_person: bool) -> dict:
    appeal = sanction.get("appeal") or None
    view = {
        "id": sanction["id"], "action": sanction["action"], "label": ACTION_LABELS.get(sanction["action"], sanction["action"]), "reason": sanction.get("reason"),
        "status": sanction.get("status"), "automatic": bool(sanction.get("automatic")), "created_at": sanction.get("created_at"),
        "chat_blocked_until": sanction.get("chat_blocked_until"), "open_until_decision": bool(sanction.get("open_until_decision")),
        "lifted_at": sanction.get("lifted_at"), "lift_note": sanction.get("lift_note"), "strike_count": sanction.get("strike_count"),
        "appeal": {"message": appeal.get("message"), "created_at": appeal.get("created_at"), "status": appeal.get("status"), "decision": appeal.get("decision"), "decision_note": appeal.get("decision_note"), "decided_at": appeal.get("decided_at")} if appeal else None,
    }
    if not for_person:
        view.update({"user_id": sanction["user_id"], "created_by": sanction.get("created_by"), "lifted_by": sanction.get("lifted_by"), "strike_ids": sanction.get("strike_ids") or []})
    return view


async def standing_for(db, user_id: str) -> dict:
    """Für die Person selbst: Treffer, laufende Sanktion, was beim nächsten Treffer käme, Einspruch."""
    settings = await load_settings(db)
    strikes = await active_strikes(db, user_id, settings)
    current = await active_sanction(db, user_id)
    history = await db.moderation_sanctions.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    next_level = level_for(len(strikes) + 1, settings)
    block = await chat_block(db, user_id)
    return {
        "strike_count": len(strikes), "strike_ttl_months": settings["strike_ttl_months"],
        "strikes": [_strike_view(s, for_person=True) for s in strikes],
        "active": _sanction_view(current, for_person=True) if current else None,
        "chat_block": block, "chat_block_text": block_text(block) if block else None,
        "history": [_sanction_view(s, for_person=True) for s in history],
        "next_level": {"strikes": next_level["strikes"], "action": next_level["action"], "label": ACTION_LABELS[next_level["action"]], "chat_hours": next_level["chat_hours"]} if next_level else None,
        "levels": settings["levels"], "can_appeal": bool(current and not (current.get("appeal") or {}).get("status") == "open"),
    }


async def submit_appeal(db, user_id: str, sanction_id: str, message: str) -> dict:
    sanction = await db.moderation_sanctions.find_one({"id": sanction_id, "user_id": user_id}, {"_id": 0})
    if not sanction:
        raise HTTPException(404, "Sanktion nicht gefunden.")
    if sanction.get("status") != "active":
        raise HTTPException(409, "Diese Sanktion läuft nicht mehr – ein Einspruch ist nicht mehr nötig.")
    if (sanction.get("appeal") or {}).get("status") == "open":
        raise HTTPException(409, "Dein Einspruch liegt schon bei der Moderation.")
    now = now_utc().isoformat()
    appeal = {"message": message.strip(), "created_at": now, "status": "open"}
    await db.moderation_sanctions.update_one({"id": sanction_id}, {"$set": {"appeal": appeal, "updated_at": now}})
    await _audit(db, user_id, "moderation.appeal", user_id, {"sanction_id": sanction_id})
    await _notify_moderators(db, user_id, sanction)
    return {**sanction, "appeal": appeal}


async def decide_appeal(db, sanction_id: str, *, moderator_id: str, decision: str, note: str | None = None) -> dict:
    sanction = await db.moderation_sanctions.find_one({"id": sanction_id}, {"_id": 0})
    if not sanction or not sanction.get("appeal"):
        raise HTTPException(404, "Kein Einspruch zu dieser Sanktion.")
    if sanction["appeal"].get("status") != "open":
        raise HTTPException(409, "Dieser Einspruch ist schon entschieden.")
    now = now_utc().isoformat()
    await db.moderation_sanctions.update_one({"id": sanction_id}, {"$set": {
        "appeal.status": "decided", "appeal.decision": decision, "appeal.decision_note": (note or "").strip() or None,
        "appeal.decided_by": moderator_id, "appeal.decided_at": now, "updated_at": now,
    }})
    await _audit(db, moderator_id, "moderation.appeal_decided", sanction["user_id"], {"sanction_id": sanction_id, "decision": decision, "note": note})
    if decision == "lift" and sanction.get("status") == "active":
        await lift_sanction(db, sanction_id, moderator_id=moderator_id, note=note or "Einspruch angenommen")
    else:
        from services.user_notifications import create_user_notification
        await create_user_notification(sanction["user_id"], "Dein Einspruch wurde geprüft", f"Die Moderation belässt es bei: {ACTION_LABELS.get(sanction['action'], sanction['action'])}.{(' ' + note.strip()) if note else ''}", url=STANDING_URL, kind="moderation", meta={"category": "moderation", "sanction_id": sanction_id})
    return await db.moderation_sanctions.find_one({"id": sanction_id}, {"_id": 0})


async def person_history(db, user_id: str) -> dict:
    """Für die Moderation: alles zu einer Person - Meldungen gegen sie, Treffer, Sanktionen, Einsprüche."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1, "role": 1, "is_banned": 1})
    if not user:
        raise HTTPException(404, "Benutzer nicht gefunden.")
    settings = await load_settings(db)
    strikes = await db.moderation_strikes.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    sanctions = await db.moderation_sanctions.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    reports = await db.user_reports.find({"target_user_id": user_id}, {"_id": 0, "id": 1, "category": 1, "status": 1, "details": 1, "created_at": 1, "reviewed_at": 1, "resolution_note": 1}).sort("created_at", -1).to_list(100)
    active = await active_sanction(db, user_id)
    cutoff = _cutoff(settings, now_utc())
    return {
        "user": user,
        "active_strike_count": sum(1 for s in strikes if not s.get("revoked") and (s.get("created_at") or "") >= cutoff),
        "strikes": [_strike_view(s, for_person=False) for s in strikes],
        "sanctions": [_sanction_view(s, for_person=False) for s in sanctions],
        "active": _sanction_view(active, for_person=False) if active else None,
        "reports": reports, "settings": settings,
    }


async def people_overview(db) -> list[dict]:
    """Alle Personen mit Treffern oder Sanktionen: Stand auf einen Blick, neueste zuerst."""
    settings = await load_settings(db)
    cutoff = _cutoff(settings, now_utc())
    people: dict[str, dict] = {}
    async for strike in db.moderation_strikes.find({}, {"_id": 0, "user_id": 1, "created_at": 1, "revoked": 1}):
        row = people.setdefault(strike["user_id"], {"user_id": strike["user_id"], "strikes": 0, "active_strikes": 0, "last_event_at": ""})
        row["strikes"] += 1
        if not strike.get("revoked") and (strike.get("created_at") or "") >= cutoff:
            row["active_strikes"] += 1
        row["last_event_at"] = max(row["last_event_at"], strike.get("created_at") or "")
    async for sanction in db.moderation_sanctions.find({}, {"_id": 0}).sort("created_at", 1):
        row = people.setdefault(sanction["user_id"], {"user_id": sanction["user_id"], "strikes": 0, "active_strikes": 0, "last_event_at": ""})
        row["last_event_at"] = max(row["last_event_at"], sanction.get("created_at") or "")
        row["sanctions"] = row.get("sanctions", 0) + 1
        if sanction.get("status") == "active":
            expires = _parse(sanction.get("expires_at"))
            if not expires or expires > now_utc():
                row["active"] = _sanction_view(sanction, for_person=False)
        if (sanction.get("appeal") or {}).get("status") == "open":
            row["open_appeal"] = True
    if not people:
        return []
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": list(people)}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1}).to_list(len(people))}
    rows = []
    for user_id, row in people.items():
        user = users.get(user_id) or {"id": user_id, "username": "?", "display_name": "(gelöscht)"}
        rows.append({**row, "sanctions": row.get("sanctions", 0), "active": row.get("active"), "open_appeal": bool(row.get("open_appeal")), "user": user})
    rows.sort(key=lambda r: r["last_event_at"], reverse=True)
    return rows


def export_csv(rows: list[dict]) -> str:
    """Für den Vorstand: eine Zeile je Person - Treffer, laufende Stufe, letzter Vorfall."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\n")
    writer.writerow(["Benutzername", "Anzeigename", "Treffer gesamt", "Treffer aktiv", "Sanktionen", "Laufende Stufe", "Chat gesperrt bis", "Einspruch offen", "Letzter Vorfall"])
    for row in rows:
        active = row.get("active") or {}
        writer.writerow([
            row["user"].get("username") or "", row["user"].get("display_name") or "", row.get("strikes", 0), row.get("active_strikes", 0), row.get("sanctions", 0),
            active.get("label") or "", _fmt(active.get("chat_blocked_until")) if active.get("chat_blocked_until") else ("bis zur Entscheidung" if active.get("open_until_decision") else ""),
            "ja" if row.get("open_appeal") else "nein", _fmt(row.get("last_event_at")),
        ])
    return buffer.getvalue()


# ---------------------------------------------------------------- Benachrichtigung, Mail, Audit

def _mail_vars(user: dict, sanction: dict) -> dict:
    until = _fmt(sanction.get("chat_blocked_until")) if sanction.get("chat_blocked_until") else ("bis zur Entscheidung der Moderation" if sanction.get("open_until_decision") else "")
    return {"display_name": user.get("display_name") or user.get("username") or "", "reason": sanction.get("reason") or "", "until": until, "appeal_url": STANDING_URL}


async def _notify(db, user_id: str, sanction: dict) -> None:
    """Die Person erfährt, was gilt, warum und wie sie Einspruch einlegt - Benachrichtigung und Mail."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1}) or {"id": user_id}
    label = ACTION_LABELS[sanction["action"]]
    if sanction["action"] == "notice":
        body = f"Grund: {sanction.get('reason') or ''}. Beim nächsten Treffer folgt die nächste Stufe. Einspruch: unter „Meine Strafen“."
    elif sanction["action"] == "warning":
        body = f"Dein Chat ist bis {_fmt(sanction.get('chat_blocked_until'))} gesperrt. Grund: {sanction.get('reason') or ''}. Einspruch: unter „Meine Strafen“."
    else:
        body = f"Dein Konto ist gesperrt, bis die Moderation entschieden hat. Grund: {sanction.get('reason') or ''}. Einspruch: unter „Meine Strafen“."
    try:
        from services.user_notifications import create_user_notification
        await create_user_notification(user_id, f"Moderation: {label}", body, url=STANDING_URL, kind="moderation", meta={"category": "moderation", "sanction_id": sanction["id"], "dedupe_key": f"sanction:{sanction['id']}"})
    except Exception as exc:  # noqa: BLE001 - die Sanktion gilt auch ohne Benachrichtigung
        logger.warning("[moderation] Benachrichtigung fehlgeschlagen: %s", exc)
    if user.get("email"):
        try:
            from routes.phase_ef_routes import render_template
            from services.mail_queue import enqueue_mail
            variables = _mail_vars(user, sanction)
            subject, html = await render_template(f"moderation_{sanction['action']}", variables, fallback_subject=f"THE LION SQUAD – {label}", fallback_html=f"<p>Hallo {variables['display_name']},</p><p>{label}. Grund: {variables['reason']}</p>")
            await enqueue_mail(to=user["email"], subject=subject, html=html, template_key=f"moderation_{sanction['action']}", meta={"user_id": user_id, "sanction_id": sanction["id"]}, dedupe_key=f"sanction-mail:{sanction['id']}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[moderation] Mail fehlgeschlagen: %s", exc)


async def _notify_lifted(db, user_id: str, sanction: dict, note: str | None) -> None:
    try:
        from services.user_notifications import create_user_notification
        await create_user_notification(user_id, "Moderation: aufgehoben", f"{ACTION_LABELS.get(sanction['action'], '')} vom {_fmt(sanction.get('created_at'))} ist aufgehoben.{(' ' + note.strip()) if note else ''}", url=STANDING_URL, kind="moderation", meta={"category": "moderation", "sanction_id": sanction["id"]})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[moderation] Benachrichtigung fehlgeschlagen: %s", exc)
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "email": 1, "display_name": 1, "username": 1}) or {}
    if user.get("email"):
        try:
            from routes.phase_ef_routes import render_template
            from services.mail_queue import enqueue_mail
            variables = {**_mail_vars(user, sanction), "note": note or ""}
            subject, html = await render_template("moderation_lifted", variables, fallback_subject="THE LION SQUAD – Maßnahme aufgehoben", fallback_html=f"<p>Hallo {variables['display_name']},</p><p>die Maßnahme ist aufgehoben.</p>")
            await enqueue_mail(to=user["email"], subject=subject, html=html, template_key="moderation_lifted", meta={"user_id": user_id, "sanction_id": sanction["id"]})
        except Exception as exc:  # noqa: BLE001
            logger.warning("[moderation] Mail fehlgeschlagen: %s", exc)


async def _notify_moderators(db, user_id: str, sanction: dict) -> None:
    """Ein Einspruch geht an alle mit dem Bereich Moderation - als Benachrichtigung, nicht öffentlich."""
    person = await db.users.find_one({"id": user_id}, {"_id": 0, "display_name": 1, "username": 1}) or {}
    name = person.get("display_name") or person.get("username") or "Eine Person"
    query = {"is_active": {"$ne": False}, "$or": [{"role": {"$in": list(MODERATION_ROLES)}}, {"granted_areas": "moderation"}, {"areas": "moderation"}]}
    try:
        from services.user_notifications import create_user_notification
        async for mod in db.users.find(query, {"_id": 0, "id": 1}):
            if mod["id"] == user_id:
                continue
            await create_user_notification(mod["id"], "Einspruch zur Moderation", f"{name} legt Einspruch gegen „{ACTION_LABELS.get(sanction['action'], '')}“ ein.", url="/admin/moderation?tab=people", kind="moderation", meta={"category": "moderation", "sanction_id": sanction["id"], "dedupe_key": f"appeal:{sanction['id']}"})
    except Exception as exc:  # noqa: BLE001
        logger.warning("[moderation] Benachrichtigung an die Moderation fehlgeschlagen: %s", exc)


async def _audit(db, actor_id: str | None, action: str, target_id: str, data: dict | None = None) -> None:
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": actor_id or "auto", "target_id": target_id, "data": data or {}, "created_at": now_utc().isoformat()})
