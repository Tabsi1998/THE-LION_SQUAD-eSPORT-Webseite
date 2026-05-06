"""Phase 10: Setup status + sitemap + simple setup-wizard helpers."""
import json
from xml.sax.saxutils import escape
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
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
    site_description: Optional[str] = None
    primary_color: Optional[str] = None
    contact_email: Optional[str] = None
    domain: Optional[str] = None
    favicon_url: Optional[str] = None
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
    smtp_auth: Optional[str] = None
    smtp_security: Optional[str] = None
    smtp_tls_verify: Optional[bool] = None
    smtp_envelope_from: Optional[str] = None
    smtp_helo_name: Optional[str] = None
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None
    reply_to_email: Optional[str] = None
    message_id_domain: Optional[str] = None
    resend_api_key: Optional[str] = None


@router.post("/complete")
async def complete_setup(body: SetupWizardBody, me: dict = Depends(require_super())):
    """Persist wizard data + mark setup completed."""
    db = get_db()
    now_iso = now_utc().isoformat()

    # Branding
    brand_keys = ["club_name", "tagline", "site_description", "primary_color", "contact_email",
                  "domain", "favicon_url", "imprint",
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
                 "smtp_auth", "smtp_security", "smtp_tls_verify", "smtp_envelope_from",
                 "smtp_helo_name", "sender_name", "sender_email", "reply_to_email", "message_id_domain"]
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
                "sender_name": body.sender_name or "THE LION SQUAD",
                "sender_email": body.sender_email or "noreply@lionsquad.at",
                "reply_to_email": body.reply_to_email or body.sender_email or "noreply@lionsquad.at",
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
@sitemap_router.get("/sitemap.xml")
async def sitemap():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    base = (branding.get("domain") or "https://lionsquad.at").rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base

    static_paths = [
        "/", "/about", "/news", "/events", "/tournaments", "/fastlap", "/f1",
        "/teams", "/players", "/members", "/membership/join",
        "/sponsors", "/partners", "/contact", "/badges", "/galerie",
        "/privacy", "/imprint",
    ]
    urls: list[dict] = [
        {
            "loc": base + p,
            "lastmod": None,
            "changefreq": "daily" if p in ("/", "/news", "/events") else "weekly",
            "priority": "1.0" if p == "/" else "0.8" if p in ("/news", "/events", "/tournaments", "/fastlap") else "0.6",
        }
        for p in static_paths
    ]

    # tournaments
    public_visibility = {"$or": [{"visibility": "public"}, {"visibility": {"$exists": False}}, {"visibility": None}]}
    async for t in db.tournaments.find({"status": {"$ne": "draft"}, "is_public": {"$ne": False}, **public_visibility}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if t.get("slug"):
            urls.append({"loc": f"{base}/tournaments/{t['slug']}", "lastmod": t.get("updated_at"), "changefreq": "weekly", "priority": "0.7"})
    # f1 challenges
    async for f in db.f1_challenges.find({"status": {"$ne": "draft"}, **public_visibility}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if f.get("slug"):
            urls.append({"loc": f"{base}/fastlap/{f['slug']}", "lastmod": f.get("updated_at"), "changefreq": "weekly", "priority": "0.7"})
    # events
    async for e in db.events.find({"status": {"$ne": "draft"}, **public_visibility}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if e.get("slug"):
            urls.append({"loc": f"{base}/events/{e['slug']}", "lastmod": e.get("updated_at"), "changefreq": "weekly", "priority": "0.8"})
    # news
    async for n in db.news_posts.find(
        {"published": True, **public_visibility},
        {"slug": 1, "id": 1, "updated_at": 1, "published_at": 1, "created_at": 1, "_id": 0},
    ).sort([("published_at", -1), ("created_at", -1)]):
        slug = n.get("slug") or n.get("id")
        if slug:
            urls.append({"loc": f"{base}/news/{slug}", "lastmod": n.get("updated_at") or n.get("published_at") or n.get("created_at"), "changefreq": "monthly", "priority": "0.85"})
    # public profiles
    async for u in db.users.find({"privacy_public_profile": True}, {"username": 1, "updated_at": 1, "_id": 0}):
        if u.get("username"):
            urls.append({"loc": f"{base}/u/{u['username']}", "lastmod": u.get("updated_at"), "changefreq": "monthly", "priority": "0.4"})

    xml_lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for entry in urls:
        xml_lines.append("<url>")
        xml_lines.append(f"<loc>{escape(entry['loc'])}</loc>")
        lastmod = entry.get("lastmod")
        if lastmod:
            xml_lines.append(f"<lastmod>{lastmod[:10]}</lastmod>")
        xml_lines.append(f"<changefreq>{entry['changefreq']}</changefreq>")
        xml_lines.append(f"<priority>{entry['priority']}</priority>")
        xml_lines.append("</url>")
    xml_lines.append("</urlset>")
    return Response(content="\n".join(xml_lines), media_type="application/xml")


@sitemap_router.get("/api/sitemap-news.xml")
@sitemap_router.get("/sitemap-news.xml")
async def news_sitemap():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    base = (branding.get("domain") or "https://lionsquad.at").rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    name = branding.get("club_name") or "THE LION SQUAD"
    public_visibility = {"$or": [{"visibility": "public"}, {"visibility": {"$exists": False}}, {"visibility": None}]}
    rows = await db.news_posts.find(
        {"published": True, **public_visibility},
        {"slug": 1, "id": 1, "title": 1, "published_at": 1, "created_at": 1, "_id": 0},
    ).sort([("published_at", -1), ("created_at", -1)]).limit(1000).to_list(1000)
    xml_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    ]
    for n in rows:
        slug = n.get("slug") or n.get("id")
        published = n.get("published_at") or n.get("created_at")
        if not slug or not published:
            continue
        xml_lines.extend([
            "<url>",
            f"<loc>{escape(f'{base}/news/{slug}')}</loc>",
            "<news:news>",
            f"<news:publication><news:name>{escape(name)}</news:name><news:language>de</news:language></news:publication>",
            f"<news:publication_date>{escape(str(published))}</news:publication_date>",
            f"<news:title>{escape(n.get('title') or slug)}</news:title>",
            "</news:news>",
            "</url>",
        ])
    xml_lines.append("</urlset>")
    return Response(content="\n".join(xml_lines), media_type="application/xml")


@sitemap_router.get("/api/manifest.webmanifest")
async def web_manifest():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    name = branding.get("club_name") or "THE LION SQUAD"
    description = branding.get("site_description") or "THE LION SQUAD eSports Vereinsplattform"
    icon = branding.get("favicon_url") or branding.get("mascot_url") or branding.get("logo_url") or "/assets/brand/tls-mascot.png"
    manifest = {
        "name": name,
        "short_name": "TLS",
        "description": description,
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#0A0A0A",
        "theme_color": branding.get("primary_color") or "#29B6E8",
        "icons": [
            {"src": icon, "sizes": "192x192", "purpose": "any"},
            {"src": icon, "sizes": "512x512", "purpose": "any maskable"},
        ],
    }
    return Response(content=json.dumps(manifest), media_type="application/manifest+json")
