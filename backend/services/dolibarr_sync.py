"""Mitgliedschaft und Beitragsstand aus Dolibarr übernehmen (#295).

Dolibarr mit dem Vereinsmodul führt, die Website bildet ab. Übernommen wird nur
für **bestätigt** zugeordnete Konten (services/dolibarr_links.py) und nur im
Modus `live`; `preview` liest und zählt, schreibt aber nichts.

Was dieser Abgleich nie tut:
- Mails, Discord-Meldungen oder Erfolge auslösen - eine Umstellung darf
  niemanden rückwirkend anschreiben;
- bei einem unvollständigen Lauf jemanden austragen: fehlt eine Seite, bleibt
  alles stehen, und der Merker für `changed_since` rückt nicht vor;
- aus einem Beitragsrückstand ein Ende der Mitgliedschaft machen. `active` mit
  fälligem Beitrag bleibt Mitglied; `paid_until` ist kein Austrittsdatum.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from database import get_db
from models import new_id, now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError, capabilities_for, instance_key, load_settings
from services.dolibarr_links import close_link, note_candidate, verified_link_for_member, verify_link
from services.membership_service import ACTIVE_STATUSES, VALID_TYPES

logger = logging.getLogger("tls.dolibarr.sync")

STATE_ID = "dolibarr_sync_state"
ACTOR = "dolibarr"
MAX_PAGES = 500
FULL_SYNC_HOURS = 24
PENDING_DELAY_SECONDS = 5
PENDING_MAX_ATTEMPTS = 5
AUTO_LINK_RETRY_HOURS = 24

# Dolibarr-Status → Status der Website. `excluded` wird nach außen nicht
# anders gezeigt als `terminated`; der genaue Wert bleibt unter `dolibarr`.
# Der Verlauf steht auch auf „Meine Mitgliedschaft“ - also für das Mitglied geschrieben.
HISTORY_NOTE = "Aus der Mitgliederverwaltung übernommen"
STATUS_MAP = {"draft": "pending", "active": "active", "terminated": "former", "excluded": "former"}


# ---------------------------------------------------------------- Abbildung

def project_summary(summary: dict, settings: dict) -> dict:
    """Aus einer Zusammenfassung die Felder der Website. Rechnet nichts nach, was Dolibarr schon entschieden hat."""
    type_info = summary.get("type") or {}
    mapped_type = (settings.get("type_map") or {}).get(str(type_info.get("id")))
    if mapped_type not in VALID_TYPES:
        mapped_type = None
    status = STATUS_MAP.get(summary.get("status"), "none")
    if status == "active" and mapped_type == "honorary":
        status = "honorary"
    fee = summary.get("fee") or {}
    return {
        "member_status": status,
        "membership_type": mapped_type,
        "member_number": str(summary.get("ref") or "") or None,
        "member_since": summary.get("member_since") or None,
        "dolibarr": {
            "instance": instance_key(settings),
            "member_id": int(summary["id"]),
            "ref": str(summary.get("ref") or ""),
            "status": summary.get("status"),
            "type": {"id": type_info.get("id"), "label": type_info.get("label")},
            # Eine unbekannte Mitgliedsart wird nie still als „ordentlich“ geführt.
            "type_unmapped": mapped_type is None,
            "paid_until": summary.get("paid_until") or None,
            "membership_ends": summary.get("membership_ends") or None,
            "fee": {
                "required": bool(fee.get("required")),
                "status": fee.get("status"),
                "next_due": fee.get("next_due") or None,
                "amount": fee.get("amount"),
                "currency": summary.get("currency") or "EUR",
                "discount": fee.get("discount") or {"kind": "none", "label": ""},
                "payer": fee.get("payer") or "self",
            },
            "functions": [
                {"code": str(fn.get("code") or ""), "label": str(fn.get("label") or ""), "since": fn.get("since") or None}
                for fn in (summary.get("functions") or []) if fn.get("code")
            ],
            "updated_at": summary.get("updated_at"),
        },
    }


async def apply_summary(db, settings: dict, link: dict, summary: dict) -> str:
    """Stand eines bestätigt zugeordneten Mitglieds schreiben. Liefert `applied`, `unchanged` oder `stale`."""
    user_id = link["user_id"]
    projected = project_summary(summary, settings)
    now = now_utc().isoformat()
    existing = await db.memberships.find_one({"user_id": user_id}, {"_id": 0})
    previous = (existing or {}).get("dolibarr") or {}
    incoming_at = projected["dolibarr"].get("updated_at") or ""
    if previous.get("member_id") == projected["dolibarr"]["member_id"] and previous.get("updated_at") and incoming_at < previous["updated_at"]:
        return "stale"

    projected["dolibarr"]["synced_at"] = now
    update = {
        "member_status": projected["member_status"],
        "membership_type": projected["membership_type"],
        "member_since": projected["member_since"],
        "member_since_precision": "day" if projected["member_since"] else None,
        "source": "dolibarr",
        "dolibarr": projected["dolibarr"],
        "updated_at": now,
        "updated_by": ACTOR,
    }
    number = projected["member_number"]
    if number:
        clash = await db.memberships.find_one({"member_number": number, "user_id": {"$ne": user_id}}, {"_id": 0, "user_id": 1})
        if clash:
            update["dolibarr"]["number_conflict"] = True
        else:
            update["member_number"] = number

    unchanged = bool(existing) and existing.get("source") == "dolibarr" and all(
        existing.get(key) == value for key, value in update.items() if key not in ("updated_at", "dolibarr")
    ) and {k: v for k, v in previous.items() if k != "synced_at"} == {k: v for k, v in update["dolibarr"].items() if k != "synced_at"}

    if existing:
        ops: dict = {"$set": update}
        if existing.get("member_status") != update["member_status"]:
            ops["$push"] = {"history": {
                "actor_id": ACTOR, "at": now, "from_status": existing.get("member_status"),
                "to_status": update["member_status"], "notes": HISTORY_NOTE,
            }}
        await db.memberships.update_one({"user_id": user_id}, ops)
    else:
        await db.memberships.insert_one({
            "id": new_id(), "user_id": user_id, "member_number": None, "internal_role": None, "notes": None,
            "show_member_number_publicly": False, "created_at": now, "created_by": ACTOR,
            "history": [{"actor_id": ACTOR, "at": now, "from_status": None, "to_status": update["member_status"],
                         "notes": HISTORY_NOTE}],
            **update,
        })
    is_member = update["member_status"] in ACTIVE_STATUSES
    await db.users.update_one({"id": user_id}, {"$set": {
        "user_type": "club_member" if is_member else "community_user", "is_club_member": is_member, "updated_at": now,
    }})
    if unchanged:
        return "unchanged"
    try:
        from services.change_events import publish_user_change
        await publish_user_change([user_id], "membership")
    except Exception:  # noqa: BLE001 - der Live-Hinweis darf den Abgleich nie scheitern lassen
        logger.debug("[dolibarr] live hint failed", exc_info=True)
    return "applied"


async def end_membership_of_gone_member(db, link: dict) -> None:
    """Das Mitglied gibt es in Dolibarr nicht mehr (404 beim direkten Lesen)."""
    now = now_utc().isoformat()
    existing = await db.memberships.find_one({"user_id": link["user_id"]}, {"_id": 0, "member_status": 1})
    if existing:
        await db.memberships.update_one({"user_id": link["user_id"]}, {
            "$set": {"member_status": "former", "dolibarr.status": "deleted", "dolibarr.functions": [],
                     "dolibarr.synced_at": now, "updated_at": now, "updated_by": ACTOR},
            "$push": {"history": {"actor_id": ACTOR, "at": now, "from_status": existing.get("member_status"),
                                  "to_status": "former", "notes": HISTORY_NOTE}},
        })
    await db.users.update_one({"id": link["user_id"]}, {"$set": {"user_type": "community_user", "is_club_member": False, "updated_at": now}})
    await close_link(db, link, status="gone", actor_id=ACTOR, note="in Dolibarr nicht mehr vorhanden")


# ---------------------------------------------------------------- Stand des Abgleichs

async def sync_state(db=None) -> dict:
    db = db if db is not None else get_db()
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0, "id": 0}) or {}


async def _save_state(db, fields: dict) -> None:
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, **fields}}, upsert=True)


def _hours_since(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0.0, (now_utc() - parsed).total_seconds() / 3600)


# ---------------------------------------------------------------- Abgleich

async def run_sync(db=None, *, full: bool | None = None) -> dict:
    """Ein Lauf. `full=None` entscheidet selbst: einmal am Tag alles, sonst nur Geändertes."""
    db = db if db is not None else get_db()
    settings = await load_settings(db)
    if settings["mode"] == "off":
        return {"ok": False, "skipped": "off"}
    state = await sync_state(db)
    if full is None:
        age = _hours_since(state.get("last_full_at"))
        full = age is None or age >= FULL_SYNC_HOURS or not state.get("cursor")
    started = now_utc().isoformat()
    counts = {"seen": 0, "applied": 0, "unchanged": 0, "stale": 0, "unlinked": 0, "gone": 0}
    live = settings["mode"] == "live"
    try:
        client = DolibarrClient(settings)
        status = await client.status()
        cursor = None if full else state.get("cursor")
        seen_ids: set[int] = set()
        page = 0
        while True:
            rows = await client.members_page(page=page, changed_since=cursor)
            if not rows:
                break
            for summary in rows:
                counts["seen"] += 1
                seen_ids.add(int(summary["id"]))
                link = await verified_link_for_member(db, settings, int(summary["id"]))
                if not link:
                    counts["unlinked"] += 1
                    continue
                if live:
                    counts[await apply_summary(db, settings, link, summary)] += 1
            page += 1
            if page >= MAX_PAGES:
                raise DolibarrError("invalid_response")
        if full and live:
            # Erst nach einem vollständigen Lauf, und jedes Fehlen einzeln nachgelesen.
            async for link in db.dolibarr_links.find({"instance": instance_key(settings), "status": "verified"}, {"_id": 0}):
                if link.get("member_id") in seen_ids:
                    continue
                try:
                    summary = await client.member_summary(link["member_id"])
                except DolibarrError as exc:
                    if exc.kind == "not_found":
                        await end_membership_of_gone_member(db, link)
                        counts["gone"] += 1
                    continue
                counts[await apply_summary(db, settings, link, summary)] += 1
    except DolibarrError as exc:
        await _save_state(db, {"last_run_at": started, "ok": False, "last_error": {"kind": exc.kind, "status": exc.status, "text": exc.text, "at": started}})
        return {"ok": False, "error": exc.kind, "text": exc.text, "status": exc.status}

    fields = {
        "last_run_at": started, "last_ok_at": now_utc().isoformat(), "ok": True, "last_error": None,
        "cursor": status.get("server_time"), "counts": counts, "was_full": bool(full), "applied_live": live,
        "module_version": status.get("module_version"), "api_version": status.get("api_version"),
        "capabilities": capabilities_for(status),
    }
    if full:
        fields["last_full_at"] = fields["last_ok_at"]
    await _save_state(db, fields)
    return {"ok": True, "full": bool(full), "live": live, **counts}


# ---------------------------------------------------------------- Webhook: Anlass zum Nachlesen

async def queue_member(db, settings: dict, member_id: int) -> None:
    """Das Ereignis selbst trägt keinen Stand - es ist nur der Anlass, gleich nachzulesen."""
    due = (now_utc() + timedelta(seconds=PENDING_DELAY_SECONDS)).isoformat()
    await db.dolibarr_pending.update_one(
        {"key": f"{instance_key(settings)}:{int(member_id)}"},
        {"$set": {"member_id": int(member_id), "instance": instance_key(settings), "due_at": due},
         "$setOnInsert": {"attempts": 0, "created_at": now_utc().isoformat()}},
        upsert=True,
    )


async def process_pending(db=None) -> dict:
    db = db if db is not None else get_db()
    settings = await load_settings(db)
    if settings["mode"] != "live":
        return {"ok": False, "skipped": settings["mode"]}
    due = await db.dolibarr_pending.find({"instance": instance_key(settings), "due_at": {"$lte": now_utc().isoformat()}}, {"_id": 0}).to_list(50)
    if not due:
        return {"ok": True, "processed": 0}
    processed = 0
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "error": exc.kind}
    for entry in due:
        link = await verified_link_for_member(db, settings, entry["member_id"])
        if not link:
            await db.dolibarr_pending.delete_one({"key": entry["key"]})
            continue
        try:
            summary = await client.member_summary(entry["member_id"])
        except DolibarrError as exc:
            if exc.kind == "not_found":
                await end_membership_of_gone_member(db, link)
                await db.dolibarr_pending.delete_one({"key": entry["key"]})
            elif entry.get("attempts", 0) + 1 >= PENDING_MAX_ATTEMPTS:
                # Der regelmäßige Abgleich holt es nach.
                await db.dolibarr_pending.delete_one({"key": entry["key"]})
            else:
                retry = (now_utc() + timedelta(seconds=30 * (entry.get("attempts", 0) + 1))).isoformat()
                await db.dolibarr_pending.update_one({"key": entry["key"]}, {"$set": {"due_at": retry}, "$inc": {"attempts": 1}})
            continue
        await apply_summary(db, settings, link, summary)
        await db.dolibarr_pending.delete_one({"key": entry["key"]})
        processed += 1
    return {"ok": True, "processed": processed}


# ---------------------------------------------------------------- Zuordnung über die bestätigte E-Mail

async def try_auto_link(db, settings: dict, user: dict) -> dict | None:
    """Nur wenn der Betreiber es eingeschaltet hat: bestätigte E-Mail, genau ein Treffer, niemand sonst zugeordnet."""
    if settings["mode"] == "off" or not settings.get("auto_link_verified_email"):
        return None
    if user.get("email_verified") is not True or not user.get("email"):
        return None
    existing = await db.dolibarr_links.find_one({"user_id": user["id"], "instance": instance_key(settings)}, {"_id": 0})
    if existing:
        if existing.get("status") in ("verified", "revoked", "requested"):
            return existing
        age = _hours_since(existing.get("updated_at"))
        if age is not None and age < AUTO_LINK_RETRY_HOURS:
            return existing
    try:
        summary = await DolibarrClient(settings).lookup_by_email(user["email"])
    except DolibarrError as exc:
        if exc.kind == "conflict":
            return await note_candidate(db, settings, user_id=user["id"], member_id=None, member_ref=None, source="email_match",
                                        status="conflict", note="mehrere Mitglieder teilen sich diese E-Mail-Adresse")
        if exc.kind == "not_found":
            return await note_candidate(db, settings, user_id=user["id"], member_id=None, member_ref=None, source="email_match",
                                        status="candidate", note="kein Mitglied mit dieser E-Mail-Adresse")
        return existing
    if summary.get("status") == "draft":
        return await note_candidate(db, settings, user_id=user["id"], member_id=summary["id"], member_ref=summary.get("ref"),
                                    source="email_match", status="candidate", note="Mitglied ist in Dolibarr noch ein Entwurf")
    from services.dolibarr_links import LinkConflict
    try:
        link = await verify_link(db, settings, user_id=user["id"], member_id=summary["id"], member_ref=summary.get("ref"),
                                 source="email_match", actor_id=None)
    except LinkConflict as exc:
        return await note_candidate(db, settings, user_id=user["id"], member_id=summary["id"], member_ref=summary.get("ref"),
                                    source="email_match", status="conflict", note=str(exc))
    if settings["mode"] == "live":
        await apply_summary(db, settings, link, summary)
    return link


# ---------------------------------------------------------------- Vorschau der Umstellung (#330)

async def migration_preview(db=None, *, max_users: int = 500) -> dict:
    """Trockenlauf: wer würde wem zugeordnet, wo hakt es. Schreibt nichts."""
    db = db if db is not None else get_db()
    settings = await load_settings(db)
    client = DolibarrClient(settings)
    members: dict[int, dict] = {}
    page = 0
    while page < MAX_PAGES:
        rows = await client.members_page(page=page)
        if not rows:
            break
        for summary in rows:
            members[int(summary["id"])] = summary
        page += 1

    local = {m["user_id"]: m async for m in db.memberships.find({}, {"_id": 0, "user_id": 1, "member_status": 1, "member_number": 1, "source": 1})}
    links = {l["user_id"]: l async for l in db.dolibarr_links.find({"instance": instance_key(settings)}, {"_id": 0})}
    users = await db.users.find(
        {"is_active": True, "email": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "email_verified": 1},
    ).sort("username", 1).to_list(max_users)

    rows = []
    matched_members: dict[int, list[str]] = {}
    for user in users:
        link = links.get(user["id"])
        membership = local.get(user["id"]) or {}
        is_local_member = membership.get("member_status") in ACTIVE_STATUSES
        if link and link.get("status") == "verified":
            summary = members.get(link.get("member_id"))
            rows.append(_preview_row(user, membership, "linked", summary, link=link))
            if summary:
                matched_members.setdefault(int(summary["id"]), []).append(user["id"])
            continue
        if user.get("email_verified") is not True:
            if is_local_member or link:
                rows.append(_preview_row(user, membership, "email_unverified", None, link=link))
            continue
        try:
            summary = await client.lookup_by_email(user["email"])
        except DolibarrError as exc:
            if exc.kind == "conflict":
                rows.append(_preview_row(user, membership, "shared_email", None, link=link))
            elif exc.kind == "not_found":
                if is_local_member or link:
                    rows.append(_preview_row(user, membership, "not_in_dolibarr", None, link=link))
            else:
                raise
            continue
        matched_members.setdefault(int(summary["id"]), []).append(user["id"])
        rows.append(_preview_row(user, membership, "match", summary, link=link))

    for row in rows:
        if row["member_id"] and len(matched_members.get(row["member_id"], [])) > 1:
            row["state"] = "member_claimed_twice"
    without_account = [
        {"member_id": mid, "ref": s.get("ref"), "name": _member_name(s), "status": s.get("status")}
        for mid, s in sorted(members.items()) if mid not in matched_members and s.get("status") != "draft"
    ]
    type_map = settings.get("type_map") or {}
    types = {}
    for summary in members.values():
        info = summary.get("type") or {}
        key = str(info.get("id"))
        types.setdefault(key, {"id": info.get("id"), "label": info.get("label"), "members": 0, "mapped_to": type_map.get(key)})
        types[key]["members"] += 1
    codes: dict[str, dict] = {}
    for summary in members.values():
        for fn in summary.get("functions") or []:
            entry = codes.setdefault(fn.get("code"), {"code": fn.get("code"), "label": fn.get("label"), "holders": 0})
            entry["holders"] += 1
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["state"]] = counts.get(row["state"], 0) + 1
    return {
        "at": now_utc().isoformat(), "mode": settings["mode"], "members_in_dolibarr": len(members),
        "rows": rows, "counts": counts, "members_without_account": without_account,
        "types": sorted(types.values(), key=lambda t: str(t["label"])), "function_codes": sorted(codes.values(), key=lambda c: str(c["code"])),
        "users_checked": len(users), "users_limit_reached": len(users) >= max_users,
    }


def _member_name(summary: dict | None) -> str:
    if not summary:
        return ""
    return summary.get("company") or " ".join(part for part in (summary.get("firstname"), summary.get("lastname")) if part)


def _preview_row(user: dict, membership: dict, state: str, summary: dict | None, *, link: dict | None) -> dict:
    projected_status = STATUS_MAP.get((summary or {}).get("status")) if summary else None
    return {
        "user_id": user["id"], "username": user.get("username"), "display_name": user.get("display_name"),
        "state": state, "link_status": (link or {}).get("status"),
        "requested_ref": (link or {}).get("member_ref") if (link or {}).get("status") == "requested" else None,
        "local_status": membership.get("member_status") or "none",
        "member_id": int(summary["id"]) if summary else None,
        "member_ref": (summary or {}).get("ref"), "member_name": _member_name(summary),
        "dolibarr_status": (summary or {}).get("status"),
        "would_change_status": bool(summary) and projected_status != (membership.get("member_status") or "none")
                               and not (projected_status == "active" and membership.get("member_status") == "honorary"),
    }
