"""Phase E + F + Discord-Counter — Bundled routes.

Endpoints:
  GET  /api/streams/live                            — public list of live streams
  POST /api/admin/streams/refresh                   — admin force-poll Twitch

  GET  /api/pages/{slug}                            — public CMS page
  GET  /api/admin/pages                             — admin list
  POST /api/admin/pages                             — create
  PATCH /api/admin/pages/{slug}                     — update
  DELETE /api/admin/pages/{slug}                    — delete (only admin-created)

  GET  /api/admin/email-templates                   — list templates
  PATCH /api/admin/email-templates/{key}            — update template

  POST /api/admin/discord/counter/{user_id}         — bump discord_messages_count (+N)
  GET  /api/admin/discord/counters                  — list users with counter
"""
from typing import Optional, Literal
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from database import get_db
from auth import get_current_user, require_admin
from models import now_utc, new_id
from services.content_embed_service import resolve_content_embeds


# ============= Streams (public + admin) =============
streams_router = APIRouter(prefix="/api/streams", tags=["streams"])


@streams_router.get("/live")
async def list_live_streams():
    db = get_db()
    streams = await db.live_streams.find({}, {"_id": 0}).sort("viewer_count", -1).to_list(50)
    return streams


admin_streams_router = APIRouter(prefix="/api/admin/streams", tags=["streams-admin"])


@admin_streams_router.post("/refresh")
async def admin_streams_refresh(me: dict = Depends(require_admin())):
    from services.twitch_service import fetch_live_streams
    return await fetch_live_streams()


# ============= Pages CMS =============
pages_router = APIRouter(prefix="/api/pages", tags=["cms"])
admin_pages_router = APIRouter(prefix="/api/admin/pages", tags=["cms-admin"])

# Default seeded pages
DEFAULT_PAGES = [
    {"slug": "about",   "title": "Über uns",    "body_md": "# Über THE LION SQUAD\n\nWir sind ein eSports-Verein…",
     "meta_description": "Lerne THE LION SQUAD eSPORTS kennen.", "is_default": True},
    {"slug": "values",  "title": "Werte & Ziele", "body_md": "# Werte & Ziele\n\nFairplay · Community · Wachstum.",
     "meta_description": "Unsere Werte und Ziele.", "is_default": True},
    {"slug": "imprint", "title": "Impressum",   "body_md": "# Impressum\n\nTHE LION SQUAD — eSPORTS\n…",
     "meta_description": "Impressum / Anbieterkennzeichnung.", "is_default": True},
    {"slug": "privacy", "title": "Datenschutz", "body_md": "# Datenschutz\n\nDeine Privatsphäre ist uns wichtig…",
     "meta_description": "Datenschutzerklärung.", "is_default": True},
]


async def seed_default_pages():
    db = get_db()
    for p in DEFAULT_PAGES:
        await db.cms_pages.update_one(
            {"slug": p["slug"]},
            {"$setOnInsert": {**p, "id": p["slug"], "created_at": now_utc().isoformat(),
                              "updated_at": now_utc().isoformat()}},
            upsert=True,
        )


@pages_router.get("/{slug}")
async def public_get_page(slug: str):
    db = get_db()
    page = await db.cms_pages.find_one({"slug": slug, "is_published": {"$ne": False}}, {"_id": 0})
    if not page:
        raise HTTPException(404, "Seite nicht gefunden.")
    page["content_embeds"] = await resolve_content_embeds(db, page.get("body_md"), None)
    return page


class PageCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9\-]+$")
    title: str
    body_md: str = ""
    meta_description: Optional[str] = None
    is_published: bool = True


class PagePatch(BaseModel):
    title: Optional[str] = None
    body_md: Optional[str] = None
    meta_description: Optional[str] = None
    is_published: Optional[bool] = None


@admin_pages_router.get("")
async def admin_list_pages(me: dict = Depends(require_admin())):
    db = get_db()
    return await db.cms_pages.find({}, {"_id": 0}).sort("slug", 1).to_list(500)


@admin_pages_router.post("")
async def admin_create_page(body: PageCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.cms_pages.find_one({"slug": body.slug}):
        raise HTTPException(409, "Slug bereits vergeben.")
    doc = {**body.model_dump(), "id": body.slug, "is_default": False,
           "created_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(),
           "created_by": me["id"]}
    await db.cms_pages.insert_one(doc)
    doc.pop("_id", None)
    return doc


@admin_pages_router.put("/{slug}")
@admin_pages_router.patch("/{slug}")
async def admin_update_page(slug: str, body: PagePatch, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"body_md", "meta_description"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    updates["updated_at"] = now_utc().isoformat()
    res = await db.cms_pages.update_one({"slug": slug}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Seite nicht gefunden.")
    return await db.cms_pages.find_one({"slug": slug}, {"_id": 0})


@admin_pages_router.delete("/{slug}")
async def admin_delete_page(slug: str, me: dict = Depends(require_admin())):
    db = get_db()
    p = await db.cms_pages.find_one({"slug": slug})
    if not p:
        raise HTTPException(404, "Seite nicht gefunden.")
    if p.get("is_default"):
        raise HTTPException(400, "Standard-Seite kann nicht gelöscht werden — nur deaktivieren via is_published=false.")
    await db.cms_pages.delete_one({"slug": slug})
    return {"ok": True}


# ============= Email Templates =============
admin_emailt_router = APIRouter(prefix="/api/admin/email-templates", tags=["cms-admin"])

DEFAULT_EMAIL_TEMPLATES = [
    {"key": "membership_approve", "name": "Mitgliedschaft akzeptiert",
     "subject": "Willkommen im Rudel 🦁",
     "html": "<p>Hallo {{display_name}},</p><p>Deine Bewerbung wurde <strong>angenommen</strong>. Willkommen im Rudel!</p><p>{{note}}</p>",
     "vars": ["display_name", "note"]},
    {"key": "membership_reject", "name": "Mitgliedschaft abgelehnt",
     "subject": "Mitgliedsbewerbung abgelehnt",
     "html": "<p>Hallo {{display_name}},</p><p>Deine Bewerbung wurde derzeit nicht angenommen.</p><p>{{note}}</p>",
     "vars": ["display_name", "note"]},
    {"key": "contact_auto_reply", "name": "Kontakt-Auto-Reply",
     "subject": "Wir haben deine Nachricht erhalten",
     "html": "<p>Hallo {{name}},</p><p>Vielen Dank für deine Nachricht zum Thema <strong>{{topic}}</strong>. Wir melden uns zeitnah.</p>",
     "vars": ["name", "topic"]},
    {"key": "membership_application_admin", "name": "Neue Bewerbung (Admin-Notify)",
     "subject": "Neue Mitgliedsbewerbung",
     "html": "<p>{{applicant}} hat eine Mitgliedsbewerbung eingereicht. Bitte im Admin-Bereich prüfen.</p>",
     "vars": ["applicant"]},
]


async def seed_email_templates():
    db = get_db()
    for t in DEFAULT_EMAIL_TEMPLATES:
        await db.email_templates.update_one(
            {"key": t["key"]},
            {"$setOnInsert": {**t, "id": t["key"], "created_at": now_utc().isoformat(),
                              "updated_at": now_utc().isoformat()}},
            upsert=True,
        )


class TemplatePatch(BaseModel):
    subject: Optional[str] = None
    html: Optional[str] = None
    name: Optional[str] = None


@admin_emailt_router.get("")
async def admin_list_templates(me: dict = Depends(require_admin())):
    db = get_db()
    return await db.email_templates.find({}, {"_id": 0}).sort("key", 1).to_list(50)


@admin_emailt_router.put("/{key}")
@admin_emailt_router.patch("/{key}")
async def admin_patch_template(key: str, body: TemplatePatch, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = {"subject", "html", "name"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    updates["updated_at"] = now_utc().isoformat()
    res = await db.email_templates.update_one({"key": key}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Template nicht gefunden.")
    return await db.email_templates.find_one({"key": key}, {"_id": 0})


async def render_template(key: str, vars_: dict, fallback_subject: str = "", fallback_html: str = "") -> tuple[str, str]:
    """Helper used by mail_queue/phase_c to substitute {{var}} placeholders."""
    db = get_db()
    t = await db.email_templates.find_one({"key": key}, {"_id": 0})
    subj = (t and t.get("subject")) or fallback_subject
    html = (t and t.get("html")) or fallback_html
    for k, v in (vars_ or {}).items():
        v_str = "" if v is None else str(v)
        subj = subj.replace("{{" + k + "}}", v_str)
        html = html.replace("{{" + k + "}}", v_str)
    return subj, html


# ============= Discord Counter (manual mods +1) =============
admin_discord_router = APIRouter(prefix="/api/admin/discord", tags=["discord"])


class CounterBody(BaseModel):
    delta: int = Field(default=1, ge=-1000, le=10000)


@admin_discord_router.post("/counter/{user_id}")
async def admin_bump_counter(user_id: str, body: CounterBody, me: dict = Depends(require_admin())):
    db = get_db()
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        raise HTTPException(404, "Nutzer nicht gefunden.")
    res = await db.users.find_one_and_update(
        {"id": user_id},
        {"$inc": {"discord_messages_count": body.delta}},
        return_document=True,
        projection={"_id": 0, "id": 1, "discord_messages_count": 1, "username": 1},
    )
    # Re-evaluate so discord_active tiers may auto-award
    try:
        from badges import evaluate_user_progress
        await evaluate_user_progress(user_id)
    except Exception:
        pass
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "discord.counter_bump",
        "actor_id": me["id"], "target_id": user_id,
        "data": {"delta": body.delta, "new_total": res.get("discord_messages_count")},
        "created_at": now_utc().isoformat(),
    })
    return res


@admin_discord_router.get("/counters")
async def admin_list_counters(me: dict = Depends(require_admin())):
    db = get_db()
    users = await db.users.find(
        {"discord_messages_count": {"$gt": 0}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "discord_name": 1, "discord_messages_count": 1}
    ).sort("discord_messages_count", -1).to_list(500)
    return users
