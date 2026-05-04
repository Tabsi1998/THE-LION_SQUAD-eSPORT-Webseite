"""Phase 10: Setup status + sitemap + simple setup-wizard helpers."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timezone
import bcrypt

from database import get_db
from auth import require_super, get_current_user
from models import now_utc, new_id

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status")
async def setup_status():
    """Public: tells the frontend whether a one-time setup wizard should run."""
    db = get_db()
    s = await db.settings.find_one({"id": "setup"}, {"_id": 0}) or {}
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    mail = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    legacy_email = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    has_admin = await db.users.count_documents({"role": "superadmin"}) > 0
    return {
        "completed": bool(s.get("completed")),
        "completed_at": s.get("completed_at"),
        "has_admin": has_admin,
        "has_branding": bool(branding.get("club_name")),
        "has_email": bool(mail.get("smtp_host") or legacy_email.get("resend_api_key")),
    }


class SetupWizardBody(BaseModel):
    club_name: Optional[str] = None
    tagline: Optional[str] = None
    primary_color: Optional[str] = None
    domain: Optional[str] = None
    imprint: Optional[str] = None
    privacy_policy: Optional[str] = None
    discord_invite_url: Optional[str] = None
    twitch_channel: Optional[str] = None
    new_admin_password: Optional[str] = None
    # Email config
    mail_provider: Optional[str] = None  # smtp | resend
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    smtp_security: Optional[str] = None
    smtp_tls_verify: Optional[bool] = None
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None
    resend_api_key: Optional[str] = None


@router.post("/complete")
async def complete_setup(body: SetupWizardBody, me: dict = Depends(require_super())):
    """Persist wizard data + mark setup completed."""
    db = get_db()
    now_iso = now_utc().isoformat()

    # Branding
    brand_keys = ["club_name", "tagline", "primary_color", "domain", "imprint",
                  "privacy_policy", "discord_invite_url", "twitch_channel"]
    brand_updates = {k: getattr(body, k) for k in brand_keys if getattr(body, k) is not None}
    if brand_updates:
        brand_updates["updated_at"] = now_iso
        await db.settings.update_one(
            {"id": "branding"},
            {"$set": brand_updates, "$setOnInsert": {"id": "branding"}},
            upsert=True,
        )

    # Mail/SMTP
    mail_keys = ["smtp_host", "smtp_port", "smtp_user", "smtp_pass",
                 "smtp_security", "smtp_tls_verify", "sender_name", "sender_email"]
    mail_updates = {k: getattr(body, k) for k in mail_keys if getattr(body, k) not in (None, "")}
    if body.mail_provider:
        mail_updates["provider"] = body.mail_provider
    if mail_updates:
        mail_updates["updated_at"] = now_iso
        await db.settings.update_one(
            {"id": "mail"},
            {"$set": mail_updates, "$setOnInsert": {"id": "mail"}},
            upsert=True,
        )

    # Resend (legacy)
    if body.resend_api_key:
        await db.settings.update_one(
            {"id": "email"},
            {"$set": {
                "resend_api_key": body.resend_api_key,
                "sender_name": body.sender_name or "TLS ARENA",
                "sender_email": body.sender_email or "noreply@thelionsquad.at",
                "enabled": True,
                "updated_at": now_iso,
            }, "$setOnInsert": {"id": "email"}},
            upsert=True,
        )

    # Admin password change
    if body.new_admin_password:
        if len(body.new_admin_password) < 8:
            raise HTTPException(400, "Passwort muss mindestens 8 Zeichen lang sein.")
        pw_hash = bcrypt.hashpw(body.new_admin_password.encode(), bcrypt.gensalt()).decode()
        await db.users.update_one({"id": me["id"]}, {"$set": {
            "password_hash": pw_hash, "updated_at": now_iso,
        }})

    await db.settings.update_one(
        {"id": "setup"},
        {"$set": {"completed": True, "completed_at": now_iso}, "$setOnInsert": {"id": "setup"}},
        upsert=True,
    )
    await db.audit_logs.insert_one({
        "id": new_id(), "actor_id": me["id"], "action": "setup.complete",
        "created_at": now_iso,
    })
    return {"ok": True}


@router.post("/skip")
async def skip_setup(me: dict = Depends(require_super())):
    """Mark setup as done without changes."""
    db = get_db()
    await db.settings.update_one(
        {"id": "setup"},
        {"$set": {"completed": True, "completed_at": now_utc().isoformat()},
         "$setOnInsert": {"id": "setup"}},
        upsert=True,
    )
    return {"ok": True}


# ---------- SEO: sitemap.xml ----------
sitemap_router = APIRouter(tags=["seo"])


@sitemap_router.get("/api/sitemap.xml")
async def sitemap():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    base = (branding.get("domain") or "https://arena.thelionsquad.at").rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base

    static_paths = [
        "/", "/about", "/news", "/events", "/tournaments", "/fastlap", "/f1",
        "/teams", "/players", "/members", "/membership/join",
        "/sponsors", "/partners", "/contact", "/badges", "/galerie",
        "/login", "/register", "/privacy", "/imprint",
    ]
    urls: list[tuple[str, Optional[str]]] = [(base + p, None) for p in static_paths]

    # tournaments
    async for t in db.tournaments.find({"status": {"$ne": "draft"}}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if t.get("slug"):
            urls.append((f"{base}/tournaments/{t['slug']}", t.get("updated_at")))
    # f1 challenges
    async for f in db.f1_challenges.find({"status": {"$ne": "draft"}}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if f.get("slug"):
            urls.append((f"{base}/fastlap/{f['slug']}", f.get("updated_at")))
            urls.append((f"{base}/f1/{f['slug']}", f.get("updated_at")))
    # events
    async for e in db.events.find({"status": {"$ne": "draft"}}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if e.get("slug"):
            urls.append((f"{base}/events/{e['slug']}", e.get("updated_at")))
    # news
    async for n in db.news_posts.find({"published": True}, {"slug": 1, "id": 1, "updated_at": 1, "_id": 0}):
        slug = n.get("slug") or n.get("id")
        if slug:
            urls.append((f"{base}/news/{slug}", n.get("updated_at")))
    # public profiles
    async for u in db.users.find({"privacy_public_profile": True}, {"username": 1, "updated_at": 1, "_id": 0}):
        if u.get("username"):
            urls.append((f"{base}/u/{u['username']}", u.get("updated_at")))

    xml_lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u, lastmod in urls:
        xml_lines.append("<url>")
        xml_lines.append(f"<loc>{u}</loc>")
        if lastmod:
            xml_lines.append(f"<lastmod>{lastmod[:10]}</lastmod>")
        xml_lines.append("</url>")
    xml_lines.append("</urlset>")
    return Response(content="\n".join(xml_lines), media_type="application/xml")
