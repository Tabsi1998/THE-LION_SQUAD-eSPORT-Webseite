"""User safety controls: blocking and a reviewable moderation queue."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import Literal

from auth import get_current_user, require_role, require_area
from database import get_db
from models import new_id, now_utc
from services.rate_limit import enforce_rate_limit
from services import media_scan, moderation_standing, word_filter

router = APIRouter(prefix="/api/moderation", tags=["moderation"])

ReportCategory = Literal["harassment", "spam", "hate", "impersonation", "privacy", "cheating", "other"]
# „berechtigt“ (#416): erledigt und zählt als Treffer für die Stufen.
ReportStatus = Literal["open", "reviewing", "resolved", "dismissed", "justified"]


class UserReportCreate(BaseModel):
    target_user_id: str
    category: ReportCategory
    details: str = Field(min_length=5, max_length=2000)
    message_id: str | None = None


class UserReportPatch(BaseModel):
    status: ReportStatus
    resolution_note: str | None = Field(default=None, max_length=2000)


@router.get("/blocks")
async def list_blocks(me: dict = Depends(get_current_user)):
    db = get_db()
    rows = await db.user_blocks.find({"blocker_id": me["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    ids = [row.get("blocked_id") for row in rows if row.get("blocked_id")]
    users = {row["id"]: row for row in await db.users.find(
        {"id": {"$in": ids}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "avatar_url": 1},
    ).to_list(500)}
    return [{**row, "user": users.get(row.get("blocked_id"))} for row in rows]


@router.post("/blocks/{user_id}")
async def block_user(user_id: str, request: Request, me: dict = Depends(get_current_user)):
    if user_id == me["id"]:
        raise HTTPException(400, "Du kannst dich nicht selbst blockieren.")
    await enforce_rate_limit(request, "moderation:block:user", limit=30, window_seconds=3600, subject=me["id"])
    db = get_db()
    target = await db.users.find_one({"id": user_id, "is_active": True}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(404, "Benutzer nicht gefunden")
    now = now_utc().isoformat()
    await db.user_blocks.update_one(
        {"blocker_id": me["id"], "blocked_id": user_id},
        {"$set": {"updated_at": now}, "$setOnInsert": {"id": new_id(), "blocker_id": me["id"], "blocked_id": user_id, "created_at": now}},
        upsert=True,
    )
    pair_key = ":".join(sorted((me["id"], user_id)))
    await db.friendships.update_one(
        {"pair_key": pair_key, "status": {"$in": ["pending", "accepted"]}},
        {"$set": {"status": "removed", "acted_at": now, "updated_at": now}},
    )
    await db.notifications.update_many(
        {"user_id": me["id"], "meta.thread_user_id": user_id, "read": {"$ne": True}},
        {"$set": {"read": True}},
    )
    return {"ok": True}


@router.delete("/blocks/{user_id}")
async def unblock_user(user_id: str, me: dict = Depends(get_current_user)):
    db = get_db()
    await db.user_blocks.delete_one({"blocker_id": me["id"], "blocked_id": user_id})
    return {"ok": True}


@router.post("/reports")
async def report_user(body: UserReportCreate, request: Request, me: dict = Depends(get_current_user)):
    if body.target_user_id == me["id"]:
        raise HTTPException(400, "Du kannst dich nicht selbst melden.")
    await enforce_rate_limit(request, "moderation:report:user", limit=8, window_seconds=86400, subject=me["id"])
    db = get_db()
    if not await db.users.find_one({"id": body.target_user_id}, {"_id": 1}):
        raise HTTPException(404, "Benutzer nicht gefunden")
    if body.message_id and not await db.direct_messages.find_one({
        "id": body.message_id,
        "$or": [
            {"sender_id": me["id"], "recipient_id": body.target_user_id},
            {"sender_id": body.target_user_id, "recipient_id": me["id"]},
        ],
    }, {"_id": 1}):
        raise HTTPException(400, "Die gemeldete Nachricht gehört nicht zu diesem Gespräch.")
    now = now_utc().isoformat()
    doc = {
        "id": new_id(), "reporter_id": me["id"], "target_user_id": body.target_user_id,
        "category": body.category, "details": body.details.strip(), "message_id": body.message_id,
        "status": "open", "created_at": now, "updated_at": now,
    }
    await db.user_reports.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "report": doc}


# ---------------------------------------------------------------- Wortfilter (#417)

class WordFilterSettings(BaseModel):
    enabled: bool | None = None


class WordFilterEntry(BaseModel):
    term: str = Field(min_length=1, max_length=80)
    action: Literal["hold", "flag"] = "flag"
    note: str | None = Field(default=None, max_length=200)


class WordFilterEntryPatch(BaseModel):
    action: Literal["hold", "flag"] | None = None
    note: str | None = Field(default=None, max_length=200)


class WordFilterImport(BaseModel):
    entries: list[dict]
    replace: bool = False


class ModerationDecision(BaseModel):
    decision: Literal["release", "reject", "noted"]
    note: str | None = Field(default=None, max_length=500)


async def _audit(actor_id: str, action: str, target_id: str | None, data: dict | None = None) -> None:
    db = get_db()
    await db.audit_logs.insert_one({"id": new_id(), "action": action, "actor_id": actor_id, "target_id": target_id, "data": data or {}, "created_at": now_utc().isoformat()})


async def _word_filter_view(db) -> dict:
    config = await word_filter.load_config(db)
    pending = await db.moderation_items.count_documents({"state": "pending"})
    flagged = await db.moderation_items.count_documents({"state": "flagged"})
    return {"enabled": config["enabled"], "entries": config["entries"], "counts": {"entries": len(config["entries"]), "pending": pending, "flagged": flagged}}


@router.get("/word-filter")
async def get_word_filter(me: dict = Depends(require_area("moderation"))):
    return await _word_filter_view(get_db())


@router.put("/word-filter")
async def update_word_filter(body: WordFilterSettings, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    if body.enabled is not None:
        await word_filter.save_config(db, enabled=body.enabled)
        await _audit(me["id"], "word_filter.enabled" if body.enabled else "word_filter.disabled", None)
    return await _word_filter_view(db)


@router.post("/word-filter/entries")
async def add_word_filter_entry(body: WordFilterEntry, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    config = await word_filter.load_config(db)
    entry = word_filter.clean_entry(body.term, body.action, body.note)
    if any(word_filter.normalize_term(e.get("term")) == word_filter.normalize_term(entry["term"]) for e in config["entries"]):
        raise HTTPException(409, "Diesen Eintrag gibt es schon.")
    if len(config["entries"]) >= word_filter.MAX_ENTRIES:
        raise HTTPException(400, f"Höchstens {word_filter.MAX_ENTRIES} Einträge.")
    entry["created_by"] = me["id"]
    await word_filter.save_config(db, entries=[*config["entries"], entry])
    await _audit(me["id"], "word_filter.entry_added", entry["id"], {"term": entry["term"], "action": entry["action"]})
    return await _word_filter_view(db)


@router.patch("/word-filter/entries/{entry_id}")
async def update_word_filter_entry(entry_id: str, body: WordFilterEntryPatch, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    config = await word_filter.load_config(db)
    entries = config["entries"]
    target = next((e for e in entries if e.get("id") == entry_id), None)
    if not target:
        raise HTTPException(404, "Eintrag nicht gefunden.")
    if body.action is not None:
        target["action"] = body.action
    if body.note is not None:
        target["note"] = body.note.strip()[:200] or None
    await word_filter.save_config(db, entries=entries)
    await _audit(me["id"], "word_filter.entry_changed", entry_id, {"term": target["term"], "action": target["action"]})
    return await _word_filter_view(db)


@router.delete("/word-filter/entries/{entry_id}")
async def delete_word_filter_entry(entry_id: str, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    config = await word_filter.load_config(db)
    remaining = [e for e in config["entries"] if e.get("id") != entry_id]
    if len(remaining) == len(config["entries"]):
        raise HTTPException(404, "Eintrag nicht gefunden.")
    await word_filter.save_config(db, entries=remaining)
    await _audit(me["id"], "word_filter.entry_removed", entry_id)
    return await _word_filter_view(db)


@router.get("/word-filter/export")
async def export_word_filter(me: dict = Depends(require_area("moderation"))):
    config = await word_filter.load_config(get_db())
    return {"version": 1, "entries": word_filter.export_entries(config)}


@router.post("/word-filter/import")
async def import_word_filter(body: WordFilterImport, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    config = await word_filter.load_config(db)
    entries = word_filter.import_entries(config["entries"], body.entries, replace=body.replace)
    for entry in entries:
        entry.setdefault("created_by", me["id"])
    await word_filter.save_config(db, entries=entries)
    await _audit(me["id"], "word_filter.imported", None, {"count": len(entries), "replace": body.replace})
    return await _word_filter_view(db)


@router.get("/items")
async def list_moderation_items(state: Literal["pending", "flagged", "released", "rejected", "noted"] | None = None, me: dict = Depends(require_area("moderation"))):
    """Die Funde des Wortfilters: zurückgehaltene Nachrichten warten auf eine Entscheidung, markierte stehen nur da."""
    db = get_db()
    query = {"state": state} if state else {"state": {"$in": ["pending", "flagged"]}}
    items = await db.moderation_items.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    user_ids = list({i.get("user_id") for i in items if i.get("user_id")})
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(500)}
    for item in items:
        user = users.get(item.get("user_id")) or {}
        item["user"] = {"id": user.get("id"), "username": user.get("username"), "display_name": user.get("display_name")}
        item["kind_label"] = word_filter.KIND_LABELS.get(item.get("kind"), item.get("kind"))
    return items


@router.patch("/items/{item_id}")
async def decide_moderation_item(item_id: str, body: ModerationDecision, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    item = await db.moderation_items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(404, "Fund nicht gefunden.")
    updated = await word_filter.review(db, item, decision=body.decision, moderator_id=me["id"], note=body.note)
    await _audit(me["id"], f"moderation_item.{body.decision}", item_id, {"kind": item.get("kind"), "user_id": item.get("user_id")})
    if body.decision in ("release", "reject") and item.get("kind") in word_filter.CHAT_COLLECTIONS:
        await _after_message_decision(db, item, body.decision, me)
    return updated


async def _after_message_decision(db, item: dict, decision: str, moderator: dict) -> None:
    """Freigegeben: jetzt sehen es die anderen, die Direktnachricht meldet sich beim Empfänger.
    Zurückgewiesen: der Absender erfährt es - ohne die Treffer zu nennen."""
    from services.change_events import publish_user_change
    from services.user_notifications import create_user_notification

    context = item.get("context") or {}
    author_id = item.get("user_id")
    if decision == "release":
        if item.get("kind") == "direct":
            recipient_id = context.get("recipient_id")
            await publish_user_change([author_id, recipient_id], "messages")
            if recipient_id:
                sender = await db.users.find_one({"id": author_id}, {"_id": 0, "username": 1, "display_name": 1}) or {}
                await create_user_notification(recipient_id, title=f"Neue Nachricht von {sender.get('display_name') or sender.get('username') or 'Mitglied'}",
                                               body=item.get("excerpt") or "", url=f"/profile?tab=inbox&to={author_id}", kind="direct_message",
                                               meta={"message_id": item.get("ref_id"), "thread_user_id": author_id})
        elif item.get("kind") == "team":
            await publish_user_change(context.get("member_ids") or [author_id], "teams")
        return
    await create_user_notification(author_id, title="Nachricht von der Moderation zurückgewiesen",
                                   body="Eine deiner Nachrichten hat gegen die Regeln verstoßen und wurde nicht zugestellt.", url="/profile?tab=inbox", kind="moderation")


@router.get("/reports")
async def list_reports(status: ReportStatus | None = None, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    query = {"status": status} if status else {}
    return await db.user_reports.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.patch("/reports/{report_id}")
async def review_report(report_id: str, body: UserReportPatch, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    report = await db.user_reports.find_one({"id": report_id}, {"_id": 0})
    if not report:
        raise HTTPException(404, "Meldung nicht gefunden")
    now = now_utc().isoformat()
    await db.user_reports.update_one({"id": report_id}, {"$set": {
        "status": body.status, "resolution_note": (body.resolution_note or "").strip() or None,
        "reviewed_by": me["id"], "reviewed_at": now, "updated_at": now,
    }})
    result: dict = {"ok": True}
    # „berechtigt“ zählt genau einmal als Treffer (#416) - und stößt die Stufe an.
    if body.status == "justified" and report.get("status") != "justified":
        outcome = await moderation_standing.add_strike(
            db, report["target_user_id"], source="report", kind=report.get("category"), ref_id=report.get("message_id"),
            report_id=report_id, moderator_id=me["id"], note=body.resolution_note,
        )
        result["strike"] = outcome["strike"]["id"]
        result["sanction"] = outcome["sanction"]
        await _audit(me["id"], "moderation.report_justified", report["target_user_id"], {"report_id": report_id})
    return result


# ---------------------------------------------------------------- Verwarnungen mit Stufen (#416)

class LevelsBody(BaseModel):
    levels: list[dict] | None = None
    strike_ttl_months: int | None = Field(default=None, ge=1, le=60)


class SanctionBody(BaseModel):
    action: Literal["notice", "warning", "suspension"]
    reason: str = Field(min_length=3, max_length=1000)
    chat_hours: int | None = Field(default=None, ge=1, le=720)


class NoteBody(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class AppealBody(BaseModel):
    sanction_id: str
    message: str = Field(min_length=10, max_length=2000)


class AppealDecisionBody(BaseModel):
    decision: Literal["lift", "keep"]
    note: str | None = Field(default=None, max_length=1000)


@router.get("/levels")
async def get_levels(me: dict = Depends(require_area("moderation"))):
    return await moderation_standing.load_settings(get_db())


@router.put("/levels")
async def update_levels(body: LevelsBody, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    saved = await moderation_standing.save_settings(db, body.model_dump(exclude_unset=True))
    await _audit(me["id"], "moderation.levels", None, saved)
    return saved


@router.get("/people")
async def list_people(me: dict = Depends(require_area("moderation"))):
    return await moderation_standing.people_overview(get_db())


@router.get("/people/export.csv")
async def export_people(me: dict = Depends(require_area("moderation"))):
    rows = await moderation_standing.people_overview(get_db())
    await _audit(me["id"], "moderation.people_export", None, {"rows": len(rows)})
    return Response(content="\ufeff" + moderation_standing.export_csv(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=moderation-personen.csv"})


@router.get("/people/{user_id}")
async def person_history(user_id: str, me: dict = Depends(require_area("moderation"))):
    return await moderation_standing.person_history(get_db(), user_id)


@router.post("/people/{user_id}/strikes")
async def add_manual_strike(user_id: str, body: NoteBody, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 1}):
        raise HTTPException(404, "Benutzer nicht gefunden")
    outcome = await moderation_standing.add_strike(db, user_id, source="manual", moderator_id=me["id"], note=body.note)
    await _audit(me["id"], "moderation.strike", user_id, {"strike_id": outcome["strike"]["id"], "note": body.note})
    return {"ok": True, "strike": outcome["strike"], "sanction": outcome["sanction"]}


@router.post("/people/{user_id}/sanctions")
async def set_person_sanction(user_id: str, body: SanctionBody, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 1}):
        raise HTTPException(404, "Benutzer nicht gefunden")
    return await moderation_standing.set_sanction(db, user_id, body.action, moderator_id=me["id"], reason=body.reason, chat_hours=body.chat_hours)


@router.post("/sanctions/{sanction_id}/lift")
async def lift_sanction(sanction_id: str, body: NoteBody, me: dict = Depends(require_area("moderation"))):
    return await moderation_standing.lift_sanction(get_db(), sanction_id, moderator_id=me["id"], note=body.note)


@router.post("/strikes/{strike_id}/revoke")
async def revoke_strike(strike_id: str, body: NoteBody, me: dict = Depends(require_area("moderation"))):
    return await moderation_standing.revoke_strike(get_db(), strike_id, moderator_id=me["id"], note=body.note)


@router.post("/sanctions/{sanction_id}/appeal-decision")
async def decide_appeal(sanction_id: str, body: AppealDecisionBody, me: dict = Depends(require_area("moderation"))):
    return await moderation_standing.decide_appeal(get_db(), sanction_id, moderator_id=me["id"], decision=body.decision, note=body.note)


@router.get("/me/standing")
async def my_standing(me: dict = Depends(get_current_user)):
    return await moderation_standing.standing_for(get_db(), me["id"])


@router.post("/me/appeal")
async def my_appeal(body: AppealBody, request: Request, me: dict = Depends(get_current_user)):
    await enforce_rate_limit(request, "moderation:appeal", limit=5, window_seconds=86400, subject=me["id"])
    await moderation_standing.submit_appeal(get_db(), me["id"], body.sanction_id, body.message)
    return {"ok": True, "standing": await moderation_standing.standing_for(get_db(), me["id"])}


# ---------- Bildprüfung (#415) ----------
# Anbieter, Schwellen und Schalter; die Warteschlange mit Vorschau (nur hier sichtbar); Freigeben oder
# Entfernen durch einen Menschen - alles im Audit-Log.

class MediaScanSettingsBody(BaseModel):
    provider: str | None = None
    review_threshold: float | None = None
    block_threshold: float | None = None
    strike_on_block: bool | None = None
    retention_days: int | None = None
    google_api_key: str | None = None
    clear_google_api_key: bool | None = None


class MediaScanDecision(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


@router.get("/media-scan/settings")
async def media_scan_settings(me: dict = Depends(require_area("moderation"))):
    return await media_scan.load_settings(get_db())


@router.put("/media-scan/settings")
async def update_media_scan_settings(body: MediaScanSettingsBody, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    saved = await media_scan.save_settings(db, body.model_dump(exclude_unset=True))
    await _audit(me["id"], "media_scan.settings", None, {k: v for k, v in saved.items() if k != "google_api_key_masked"})
    return saved


@router.get("/media-scan/status")
async def media_scan_status(me: dict = Depends(require_area("moderation"))):
    return await media_scan.status(get_db())


@router.get("/media-scan/queue")
async def media_scan_queue(state: str = "review", limit: int = 100, me: dict = Depends(require_area("moderation"))):
    if state not in ("all", *media_scan.STATES):
        raise HTTPException(400, "Unbekannter Stand.")
    return await media_scan.queue(get_db(), state=state, limit=limit)


@router.get("/media-scan/{scan_id}/preview")
async def media_scan_preview(scan_id: str, me: dict = Depends(require_area("moderation"))):
    doc = await media_scan.get_scan(get_db(), scan_id)
    path = media_scan.preview_path(doc)
    if path is None:
        raise HTTPException(404, "Kein Bild mehr vorhanden (Aufbewahrung abgelaufen).")
    return FileResponse(path, headers={"X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Cache-Control": "private, no-store"})


@router.post("/media-scan/{scan_id}/approve")
async def media_scan_approve(scan_id: str, body: MediaScanDecision | None = None, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    doc = await media_scan.approve(db, scan_id, moderator_id=me["id"], note=body.note if body else None)
    await _audit(me["id"], "media_scan.approved", scan_id, {"kind": doc.get("kind"), "owner_id": doc.get("owner_id"), "note": doc.get("note")})
    return doc


@router.post("/media-scan/{scan_id}/remove")
async def media_scan_remove(scan_id: str, body: MediaScanDecision | None = None, me: dict = Depends(require_area("moderation"))):
    db = get_db()
    doc = await media_scan.remove(db, scan_id, moderator_id=me["id"], note=body.note if body else None)
    await _audit(me["id"], "media_scan.removed", scan_id, {"kind": doc.get("kind"), "owner_id": doc.get("owner_id"), "note": doc.get("note")})
    return doc
