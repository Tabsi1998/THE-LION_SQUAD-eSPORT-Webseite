"""Phase 10: Setup status + sitemap + simple setup-wizard helpers."""
import json
import re
from xml.sax.saxutils import escape
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import bcrypt

from database import get_db
from auth import require_admin, require_super, get_current_user
from models import MIN_PASSWORD_LENGTH, now_utc, new_id

router = APIRouter(prefix="/api/setup", tags=["setup"])
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _normalise_base_url(value: str | None) -> str:
    base = (value or "https://lionsquad.at").strip().rstrip("/")
    if not base:
        base = "https://lionsquad.at"
    if not base.startswith(("http://", "https://")):
        base = "https://" + base
    return base


def _domain_from_url(value: str | None) -> str:
    base = _normalise_base_url(value)
    return base.replace("https://", "").replace("http://", "").split("/")[0]


def _image_mime_from_url(value: str | None) -> str:
    path = str(value or "").split("?", 1)[0].lower()
    if path.endswith(".png"):
        return "image/png"
    if path.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if path.endswith(".webp"):
        return "image/webp"
    return "image/png"


def _same_media_url(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    clean_a = re.sub(r"^https?://[^/]+", "", str(a).strip()).split("?", 1)[0]
    clean_b = re.sub(r"^https?://[^/]+", "", str(b).strip()).split("?", 1)[0]
    return clean_a == clean_b


def _effective_favicon_url(branding: dict) -> str:
    custom = branding.get("favicon_url")
    if custom and not _same_media_url(custom, branding.get("mascot_url")):
        return custom
    return "/assets/brand/tls-favicon.png?v=20260517"


def _truthy_mail_config(mail: dict, legacy_email: dict) -> bool:
    provider = mail.get("provider") or ("resend" if legacy_email.get("resend_api_key") else "")
    if provider == "resend":
        return bool(legacy_email.get("resend_api_key") or mail.get("resend_api_key"))
    return bool(mail.get("smtp_host") and (mail.get("sender_email") or legacy_email.get("sender_email")))


def _setup_checks(s: dict, branding: dict, mail: dict, legacy_email: dict, has_admin: bool) -> list[dict]:
    return [
        {"key": "admin", "label": "Superadmin vorhanden", "ok": has_admin, "target": "/admin/users"},
        {"key": "completed", "label": "Setup abgeschlossen", "ok": bool(s.get("completed")), "target": "/setup"},
        {"key": "club_name", "label": "Vereinsname gepflegt", "ok": bool(branding.get("club_name")), "target": "/admin/settings?tab=brand"},
        {"key": "domain", "label": "Öffentliche Domain gesetzt", "ok": bool(branding.get("domain")), "target": "/admin/settings?tab=brand"},
        {"key": "contact_email", "label": "Kontakt-E-Mail gesetzt", "ok": bool(branding.get("contact_email")), "target": "/admin/settings?tab=brand"},
        {"key": "legal", "label": "Impressum/Datenschutz ergänzt", "ok": bool(branding.get("imprint") or branding.get("privacy_policy")), "target": "/admin/settings?tab=legal"},
        {"key": "mail", "label": "E-Mail-Versand konfiguriert", "ok": _truthy_mail_config(mail, legacy_email), "target": "/admin/settings?tab=smtp"},
    ]


@router.get("/status")
async def setup_status():
    """Public: tells the frontend whether a one-time setup wizard should run."""
    db = get_db()
    s = await db.settings.find_one({"id": "setup"}, {"_id": 0}) or {}
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    mail = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    legacy_email = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    has_admin = await db.users.count_documents({"role": "superadmin"}) > 0
    checks = _setup_checks(s, branding, mail, legacy_email, has_admin)
    done = sum(1 for c in checks if c["ok"])
    return {
        "completed": bool(s.get("completed")),
        "completed_at": s.get("completed_at"),
        "has_admin": has_admin,
        "has_branding": bool(branding.get("club_name")),
        "has_email": _truthy_mail_config(mail, legacy_email),
        "health_score": round((done / len(checks)) * 100) if checks else 0,
        "checks": checks,
        "missing": [c for c in checks if not c["ok"]],
    }


@router.get("/defaults")
async def setup_defaults(me: dict = Depends(require_admin())):
    """Admin-only: current setup values for pre-filling the wizard."""
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    mail = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    legacy_email = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    return {
        "branding": {
            "club_name": branding.get("club_name") or "THE LION SQUAD",
            "tagline": branding.get("tagline") or "eSports Verein",
            "site_title": branding.get("site_title") or "THE LION SQUAD - eSPORTS",
            "site_description": branding.get("site_description") or "",
            "domain": branding.get("domain") or "lionsquad.at",
            "primary_color": branding.get("primary_color") or "#29B6E8",
            "contact_email": branding.get("contact_email") or "",
            "favicon_url": branding.get("favicon_url") or "",
            "imprint": branding.get("imprint") or "",
            "privacy_policy": branding.get("privacy_policy") or "",
            "discord_invite_url": branding.get("discord_invite_url") or "",
            "twitch_channel": branding.get("twitch_channel") or "",
        },
        "mail": {
            "mail_provider": mail.get("provider") or ("resend" if legacy_email.get("resend_api_key") else "smtp"),
            "smtp_host": mail.get("smtp_host") or "",
            "smtp_port": mail.get("smtp_port") or 587,
            "smtp_user": mail.get("smtp_user") or "",
            "smtp_auth": mail.get("smtp_auth") or "auto",
            "smtp_security": mail.get("smtp_security") or "starttls",
            "smtp_tls_verify": mail.get("smtp_tls_verify", True),
            "smtp_envelope_from": mail.get("smtp_envelope_from") or "",
            "smtp_helo_name": mail.get("smtp_helo_name") or "",
            "sender_name": mail.get("sender_name") or legacy_email.get("sender_name") or "THE LION SQUAD",
            "sender_email": mail.get("sender_email") or legacy_email.get("sender_email") or "noreply@lionsquad.at",
            "reply_to_email": mail.get("reply_to_email") or legacy_email.get("reply_to_email") or "office@lionsquad.at",
            "message_id_domain": mail.get("message_id_domain") or "",
            "smtp_pass_masked": "********" if mail.get("smtp_pass") else "",
            "resend_api_key_masked": "********" if legacy_email.get("resend_api_key") else "",
        },
    }


class SetupWizardBody(BaseModel):
    club_name: Optional[str] = None
    tagline: Optional[str] = None
    site_title: Optional[str] = None
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

    if body.primary_color and not HEX_COLOR_RE.match(body.primary_color):
        raise HTTPException(400, "Akzentfarbe muss ein HEX-Wert sein, z.B. #29B6E8.")
    if body.domain:
        body.domain = _normalise_base_url(body.domain)
    if body.sender_email and "@" not in body.sender_email:
        raise HTTPException(400, "Absender-E-Mail ist ungültig.")
    if body.reply_to_email and "@" not in body.reply_to_email:
        raise HTTPException(400, "Antwort-E-Mail ist ungültig.")

    # Branding
    brand_keys = ["club_name", "tagline", "site_title", "site_description", "primary_color", "contact_email",
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
        if body.mail_provider not in ("smtp", "resend"):
            raise HTTPException(400, "Mail-Provider muss smtp oder resend sein.")
        mail_updates["provider"] = body.mail_provider
    if body.mail_provider == "smtp":
        if body.smtp_port is not None and not (1 <= int(body.smtp_port) <= 65535):
            raise HTTPException(400, "SMTP-Port muss zwischen 1 und 65535 liegen.")
        if body.message_id_domain is None and body.domain:
            mail_updates["message_id_domain"] = _domain_from_url(body.domain)
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
        if len(body.new_admin_password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(400, f"Passwort muss mindestens {MIN_PASSWORD_LENGTH} Zeichen lang sein.")
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
        "details": {"fields": sorted([k for k, v in body.model_dump(exclude_unset=True).items() if v not in (None, "") and "pass" not in k and "key" not in k])},
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
SEO_HIDDEN_STATUSES = ["draft", "archived", "cancelled"]


def _parse_sitemap_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@sitemap_router.get("/api/sitemap.xml")
@sitemap_router.get("/sitemap.xml")
async def sitemap():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    base = _normalise_base_url(branding.get("domain"))

    static_paths = [
        "/", "/about", "/news", "/events", "/tournaments", "/fastlap", "/f1",
        "/teams", "/players", "/servers", "/members", "/membership/join", "/membership/apply",
        "/sponsors", "/partners", "/contact", "/board", "/values", "/galerie", "/references",
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
    async for t in db.tournaments.find({"status": {"$nin": SEO_HIDDEN_STATUSES}, "is_public": {"$ne": False}, **public_visibility}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if t.get("slug"):
            urls.append({"loc": f"{base}/tournaments/{t['slug']}", "lastmod": t.get("updated_at"), "changefreq": "weekly", "priority": "0.7"})
    # f1 challenges
    async for f in db.f1_challenges.find({"status": {"$nin": SEO_HIDDEN_STATUSES}, **public_visibility}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if f.get("slug"):
            urls.append({"loc": f"{base}/fastlap/{f['slug']}", "lastmod": f.get("updated_at"), "changefreq": "weekly", "priority": "0.7"})
    # events
    async for e in db.events.find({"status": {"$nin": SEO_HIDDEN_STATUSES}, **public_visibility}, {"slug": 1, "updated_at": 1, "_id": 0}):
        if e.get("slug"):
            urls.append({"loc": f"{base}/events/{e['slug']}", "lastmod": e.get("updated_at"), "changefreq": "weekly", "priority": "0.8"})
    # news
    async for n in db.news_posts.find(
        {"published": True, **public_visibility},
        {"slug": 1, "id": 1, "updated_at": 1, "published_at": 1, "created_at": 1, "_id": 0},
    ).sort([("published_at", -1), ("created_at", -1)]):
        published = _parse_sitemap_dt(n.get("published_at") or n.get("created_at"))
        if published and published > now_utc():
            continue
        slug = n.get("slug") or n.get("id")
        if slug:
            urls.append({"loc": f"{base}/news/{slug}", "lastmod": n.get("updated_at") or n.get("published_at") or n.get("created_at"), "changefreq": "monthly", "priority": "0.85"})
    # public profiles
    async for u in db.users.find(
        {"privacy_public_profile": True, "is_active": True, "is_banned": {"$ne": True}},
        {"username": 1, "updated_at": 1, "_id": 0},
    ):
        if u.get("username"):
            urls.append({"loc": f"{base}/u/{u['username']}", "lastmod": u.get("updated_at"), "changefreq": "monthly", "priority": "0.4"})
    # public club member profiles
    async for m in db.club_member_profiles.find(
        {"is_active": {"$ne": False}},
        {"slug": 1, "updated_at": 1, "_id": 0},
    ):
        if m.get("slug"):
            urls.append({"loc": f"{base}/members/{m['slug']}", "lastmod": m.get("updated_at"), "changefreq": "monthly", "priority": "0.55"})
    # public teams
    async for team in db.teams.find(
        {"is_public": {"$ne": False}},
        {"id": 1, "updated_at": 1, "_id": 0},
    ):
        if team.get("id"):
            urls.append({"loc": f"{base}/teams/{team['id']}", "lastmod": team.get("updated_at"), "changefreq": "monthly", "priority": "0.55"})
    # public gallery albums
    async for a in db.gallery_albums.find(
        {"visibility": {"$in": ["public", None]}, "is_public": {"$ne": False}},
        {"slug": 1, "updated_at": 1, "_id": 0},
    ):
        if a.get("slug"):
            urls.append({"loc": f"{base}/galerie/{a['slug']}", "lastmod": a.get("updated_at"), "changefreq": "monthly", "priority": "0.5"})

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
    base = _normalise_base_url(branding.get("domain"))
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
        published_dt = _parse_sitemap_dt(published)
        if not slug or not published or (published_dt and published_dt > now_utc()):
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
    name = branding.get("site_title") or name
    description = branding.get("site_description") or "THE LION SQUAD - eSPORTS"
    icon = _effective_favicon_url(branding)
    default_screenshot = branding.get("logo_url") or branding.get("mascot_url") or "/assets/brand/tls-wordmark.png"
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
            {"src": icon, "sizes": "192x192", "type": _image_mime_from_url(icon), "purpose": "any"},
            {"src": icon, "sizes": "512x512", "type": _image_mime_from_url(icon), "purpose": "any maskable"},
        ],
        "screenshots": [
            {"src": default_screenshot, "sizes": "1200x630", "type": _image_mime_from_url(default_screenshot), "form_factor": "wide"},
        ],
    }
    return Response(content=json.dumps(manifest), media_type="application/manifest+json")
