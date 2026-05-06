"""Admin settings (email config, branding), Seasons/Circuits, Widgets, DSGVO, Audit Logs, PDF exports."""
import secrets as secrets_lib
from fastapi import APIRouter, HTTPException, Depends, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Literal
from datetime import datetime, timezone
import io

from database import get_db
from auth import require_admin, require_super, get_current_user
from services.visibility import user_can_see
from models import now_utc, new_id
from email_service import send_template, _get_email_config
from pdf_service import (
    pdf_participants, pdf_f1_leaderboard, pdf_matches, pdf_standings, pdf_checkin,
)

# ---------- Settings ----------
settings_router = APIRouter(prefix="/api/settings", tags=["settings"])


class EmailSettings(BaseModel):
    resend_api_key: Optional[str] = None
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None
    reply_to_email: Optional[str] = None
    enabled: bool = True


class BrandingSettings(BaseModel):
    club_name: Optional[str] = None
    tagline: Optional[str] = None
    site_description: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None
    mascot_url: Optional[str] = None
    favicon_url: Optional[str] = None
    domain: Optional[str] = None
    timezone: Optional[str] = None
    contact_email: Optional[str] = None
    imprint: Optional[str] = None
    privacy_policy: Optional[str] = None
    legal_name: Optional[str] = None
    legal_form: Optional[str] = None
    zvr_number: Optional[str] = None
    street_address: Optional[str] = None
    address_extra: Optional[str] = None
    postal_code: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    registered_seat: Optional[str] = None
    register_authority: Optional[str] = None
    representative_name: Optional[str] = None
    representative_role: Optional[str] = None
    content_responsible: Optional[str] = None
    phone: Optional[str] = None
    privacy_contact_email: Optional[str] = None
    hosting_provider: Optional[str] = None
    hosting_country: Optional[str] = None
    vat_number: Optional[str] = None
    tournament_terms_url: Optional[str] = None
    paid_tournaments_enabled: Optional[bool] = None
    legal_extra: Optional[str] = None
    privacy_extra: Optional[str] = None
    discord_invite_url: Optional[str] = None
    twitch_channel: Optional[str] = None
    # Social channels (Phase X — full social presence)
    facebook_url: Optional[str] = None
    instagram_url: Optional[str] = None
    tiktok_url: Optional[str] = None
    youtube_url: Optional[str] = None
    # Phase E — Twitch Helix credentials
    twitch_client_id: Optional[str] = None
    twitch_client_secret: Optional[str] = None
    twitch_live_detection: Optional[bool] = None


class TestEmailBody(BaseModel):
    to: EmailStr


class DiscordSettings(BaseModel):
    webhook_url: Optional[str] = None
    clear_webhook: Optional[bool] = None
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    enabled: bool = True


SETTING_AUDIT_SECRET_FIELDS = {"resend_api_key", "smtp_pass", "webhook_url"}


def _normalize_setting_value(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return [_normalize_setting_value(v) for v in value]
    if isinstance(value, dict):
        return {k: _normalize_setting_value(v) for k, v in sorted(value.items())}
    return value


def _changed_setting_fields(current: dict | None, updates: dict, unset: dict | None = None) -> list[str]:
    current = current or {}
    changed = set()
    for key, value in updates.items():
        if key in {"id", "updated_at"}:
            continue
        if key in SETTING_AUDIT_SECRET_FIELDS:
            if value and _normalize_setting_value(current.get(key)) != _normalize_setting_value(value):
                changed.add(key)
            continue
        if _normalize_setting_value(current.get(key)) != _normalize_setting_value(value):
            changed.add(key)
    for key in (unset or {}):
        if _normalize_setting_value(current.get(key)) != "":
            changed.add(key)
    return sorted(changed)


async def _audit_settings_change(db, action: str, setting_id: str, actor_id: str, changed_fields: list[str]) -> None:
    if not changed_fields:
        return
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": action,
        "target_id": setting_id,
        "actor_id": actor_id,
        "data": {"changed_fields": changed_fields},
        "created_at": now_utc().isoformat(),
    })


@settings_router.get("/public")
async def public_settings(response: Response):
    """Public-safe settings for branding on public pages."""
    response.headers["Cache-Control"] = "no-store"
    db = get_db()
    b = await db.settings.find_one({"id": "branding"}) or {}
    b.pop("_id", None)
    domain = (b.get("domain") or "https://lionsquad.at").strip()
    if domain and not domain.startswith(("http://", "https://")):
        domain = "https://" + domain
    tagline = b.get("tagline", "eSports Verein")
    if str(tagline).strip().lower() == "esports arena":
        tagline = "eSports Verein"
    city = b.get("city") or ""
    state = b.get("state") or "Tirol"
    country = b.get("country") or "Österreich"
    contact_email = b.get("contact_email") or "office@lionsquad.at"
    return {
        "club_name": b.get("club_name", "THE LION SQUAD"),
        "tagline": tagline,
        "site_description": b.get("site_description") or "THE LION SQUAD eSports - Vereinsplattform fuer Turniere, Fast Lap Challenges, News und Mitgliederbereich.",
        "primary_color": b.get("primary_color", "#29B6E8"),
        "logo_url": b.get("logo_url"),
        "mascot_url": b.get("mascot_url"),
        "favicon_url": b.get("favicon_url"),
        "domain": domain,
        "timezone": b.get("timezone") or "Europe/Vienna",
        "contact_email": contact_email,
        "imprint": b.get("imprint"),
        "privacy_policy": b.get("privacy_policy"),
        "legal_name": b.get("legal_name") or b.get("club_name") or "THE LION SQUAD eSports",
        "legal_form": b.get("legal_form") or "eingetragener Verein nach österreichischem Vereinsrecht",
        "zvr_number": b.get("zvr_number") or "",
        "street_address": b.get("street_address") or "",
        "address_extra": b.get("address_extra") or "",
        "postal_code": b.get("postal_code") or "",
        "city": city,
        "state": state,
        "country": country,
        "registered_seat": b.get("registered_seat") or city or state,
        "register_authority": b.get("register_authority") or "Vereinsbehörde am Vereinssitz in Tirol",
        "representative_name": b.get("representative_name") or "",
        "representative_role": b.get("representative_role") or "Obmann/Obfrau bzw. vertretungsbefugtes Vereinsorgan",
        "content_responsible": b.get("content_responsible") or b.get("representative_name") or "",
        "phone": b.get("phone") or "",
        "privacy_contact_email": b.get("privacy_contact_email") or contact_email,
        "hosting_provider": b.get("hosting_provider") or "",
        "hosting_country": b.get("hosting_country") or "Österreich/EU",
        "vat_number": b.get("vat_number") or "",
        "tournament_terms_url": b.get("tournament_terms_url") or "",
        "paid_tournaments_enabled": bool(b.get("paid_tournaments_enabled", False)),
        "legal_extra": b.get("legal_extra") or "",
        "privacy_extra": b.get("privacy_extra") or "",
        "discord_invite_url": b.get("discord_invite_url") or "https://discord.com/invite/thelionsquadesports",
        "twitch_channel": b.get("twitch_channel") or "the_lion_squad_esports",
        "facebook_url": b.get("facebook_url") or "https://www.facebook.com/thelionsquadesports",
        "instagram_url": b.get("instagram_url") or "https://instagram.com/thelionsquadesports",
        "tiktok_url": b.get("tiktok_url") or "https://www.tiktok.com/@thelionsquadesports",
        "youtube_url": b.get("youtube_url") or "https://www.youtube.com/@TheLionSquadeSports",
    }


@settings_router.get("/email")
async def get_email_settings(me: dict = Depends(require_admin())):
    db = get_db()
    s = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    # Mask the API key
    if s.get("resend_api_key"):
        k = s["resend_api_key"]
        s["resend_api_key_masked"] = f"{k[:6]}…{k[-4:]}" if len(k) > 12 else "***"
        s.pop("resend_api_key", None)
    return s


@settings_router.put("/email")
async def update_email_settings(body: EmailSettings, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    # Only overwrite api_key if a non-empty value given
    if "resend_api_key" in updates and not updates["resend_api_key"]:
        updates.pop("resend_api_key")
    current = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates)
    if not changed_fields:
        return {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    await db.settings.update_one(
        {"id": "email"}, {"$set": updates, "$setOnInsert": {"id": "email"}}, upsert=True,
    )
    await _audit_settings_change(db, "settings.email.update", "email", me["id"], changed_fields)
    return {"ok": True, "changed": True}


@settings_router.post("/email/test")
async def send_test(body: TestEmailBody, me: dict = Depends(require_admin())):
    res = await send_template("test", body.to, branding="THE LION SQUAD", queue=False)
    return res


# ---------- Phase 8: SMTP & Mail Queue ----------
class SmtpSettings(BaseModel):
    provider: Optional[Literal["smtp", "resend"]] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    smtp_auth: Optional[Literal["auto", "login", "none"]] = None
    smtp_security: Optional[Literal["auto", "starttls", "tls", "none"]] = None
    smtp_tls_verify: Optional[bool] = None
    smtp_envelope_from: Optional[str] = None
    smtp_helo_name: Optional[str] = None
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None
    reply_to_email: Optional[str] = None
    message_id_domain: Optional[str] = None
    enabled: Optional[bool] = None


@settings_router.get("/smtp")
async def get_smtp_settings(me: dict = Depends(require_admin())):
    db = get_db()
    s = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    if s.get("smtp_pass"):
        p = s["smtp_pass"]
        s["smtp_pass_masked"] = "•" * min(8, max(4, len(p)))
    s.pop("smtp_pass", None)
    s.setdefault("provider", "smtp" if s.get("smtp_host") else "resend")
    s.setdefault("smtp_auth", "login")
    if s.get("smtp_auth") == "auto":
        s["smtp_auth"] = "login"
    s.setdefault("smtp_security", "auto")
    s.setdefault("smtp_port", 587)
    s.setdefault("smtp_tls_verify", False)
    s.setdefault("smtp_helo_name", "")
    s.setdefault("enabled", True)
    s.setdefault("reply_to_email", s.get("sender_email") or "")
    s.setdefault("message_id_domain", "")
    return s


@settings_router.put("/smtp")
async def update_smtp_settings(body: SmtpSettings, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    # Only overwrite password if a non-empty value given
    if "smtp_pass" in updates and not updates["smtp_pass"]:
        updates.pop("smtp_pass")
    current = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates)
    if not changed_fields:
        return {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    await db.settings.update_one(
        {"id": "mail"}, {"$set": updates, "$setOnInsert": {"id": "mail"}}, upsert=True,
    )
    await _audit_settings_change(db, "settings.smtp.update", "mail", me["id"], changed_fields)
    return {"ok": True, "changed": True}


@settings_router.post("/smtp/test")
async def smtp_send_test(body: TestEmailBody, me: dict = Depends(require_admin())):
    from services.mail_queue import smtp_test
    return await smtp_test(body.to)


@settings_router.post("/smtp/diagnose")
async def smtp_diagnose(body: TestEmailBody, me: dict = Depends(require_admin())):
    from services.mail_queue import smtp_diagnose as run_smtp_diagnose
    return await run_smtp_diagnose(body.to)


@settings_router.get("/smtp/deliverability")
async def smtp_deliverability(me: dict = Depends(require_admin())):
    from services.mail_queue import smtp_deliverability as run_smtp_deliverability
    return await run_smtp_deliverability()


@settings_router.get("/mail-queue")
async def list_mail_queue(status: Optional[str] = None, limit: int = 100,
                          me: dict = Depends(require_admin())):
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    jobs = await db.mail_jobs.find(q, {"_id": 0, "html": 0}).sort("created_at", -1).to_list(limit)
    return jobs


@settings_router.post("/mail-queue/process")
async def process_queue_now(me: dict = Depends(require_admin())):
    from services.mail_queue import process_mail_queue
    return await process_mail_queue(batch=20)


@settings_router.post("/mail-queue/{job_id}/retry")
async def retry_mail_job(job_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.mail_jobs.update_one(
        {"id": job_id},
        {"$set": {
            "status": "pending",
            "attempts": 0,
            "next_attempt_at": now_utc().isoformat(),
            "last_error": None,
            "updated_at": now_utc().isoformat(),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Job nicht gefunden")
    return {"ok": True}


@settings_router.delete("/mail-queue/{job_id}")
async def delete_mail_job(job_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.mail_jobs.delete_one({"id": job_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Job nicht gefunden")
    return {"ok": True}


@settings_router.get("/branding")
async def get_branding(response: Response, me: dict = Depends(require_admin())):
    """Returns the branding doc, merging in social-default URLs so the admin form
    pre-fills with sensible defaults instead of empty fields."""
    response.headers["Cache-Control"] = "no-store"
    db = get_db()
    saved = (await db.settings.find_one({"id": "branding"}, {"_id": 0})) or {}
    defaults = {
        "discord_invite_url": "https://discord.com/invite/thelionsquadesports",
        "twitch_channel": "the_lion_squad_esports",
        "facebook_url": "https://www.facebook.com/thelionsquadesports",
        "instagram_url": "https://instagram.com/thelionsquadesports",
        "tiktok_url": "https://www.tiktok.com/@thelionsquadesports",
        "youtube_url": "https://www.youtube.com/@TheLionSquadeSports",
    }
    for k, v in defaults.items():
        if not saved.get(k):
            saved[k] = v
    return saved


@settings_router.put("/branding")
async def update_branding(body: BrandingSettings, me: dict = Depends(require_admin())):
    db = get_db()
    nullable_fields = set(BrandingSettings.model_fields.keys())
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    current = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates)
    if not changed_fields:
        return current or {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    await db.settings.update_one(
        {"id": "branding"}, {"$set": updates, "$setOnInsert": {"id": "branding"}}, upsert=True,
    )
    await _audit_settings_change(db, "settings.branding.update", "branding", me["id"], changed_fields)
    saved = await db.settings.find_one({"id": "branding"}, {"_id": 0})
    return saved or {"ok": True}


@settings_router.get("/email/logs")
async def email_logs(me: dict = Depends(require_admin())):
    db = get_db()
    return await db.email_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


# ---- Discord webhook ----
@settings_router.get("/discord")
async def get_discord(me: dict = Depends(require_admin())):
    db = get_db()
    s = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    s["configured"] = bool(s.get("webhook_url"))
    if s.get("webhook_url"):
        u = s["webhook_url"]
        s["webhook_url_masked"] = u[:30] + "…" if len(u) > 30 else "***"
        s.pop("webhook_url", None)
    last = await db.email_logs.find_one(
        {"channel": "discord"},
        {"_id": 0, "status": 1, "error": 1, "event_key": 1, "created_at": 1},
        sort=[("created_at", -1)],
    )
    if last:
        s["last_status"] = last.get("status")
        s["last_error"] = last.get("error")
        s["last_event_key"] = last.get("event_key")
        s["last_checked_at"] = last.get("created_at")
    return s


@settings_router.put("/discord")
async def update_discord(body: DiscordSettings, me: dict = Depends(require_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    clear_webhook = bool(updates.pop("clear_webhook", False))
    unset = {"webhook_url": ""} if clear_webhook else {}
    if "webhook_url" in updates:
        updates["webhook_url"] = updates["webhook_url"].strip()
    if "webhook_url" in updates and not updates["webhook_url"]:
        updates.pop("webhook_url")
    if "webhook_url" in updates:
        from discord_service import is_valid_discord_webhook_url
        if not is_valid_discord_webhook_url(updates["webhook_url"]):
            raise HTTPException(400, "Ungueltige Discord Webhook URL. Erlaubt sind https://discord.com/api/webhooks/... URLs.")
    for key in ("username", "avatar_url"):
        if key in updates and isinstance(updates[key], str):
            updates[key] = updates[key].strip()
    current = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates, unset)
    if not changed_fields:
        return {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    op = {"$set": updates, "$setOnInsert": {"id": "discord"}}
    if unset:
        op["$unset"] = unset
    await db.settings.update_one(
        {"id": "discord"}, op, upsert=True,
    )
    await _audit_settings_change(db, "settings.discord.update", "discord", me["id"], changed_fields)
    return {"ok": True, "changed": True}


@settings_router.post("/discord/test")
async def discord_test(me: dict = Depends(require_admin())):
    from discord_service import send_discord
    res = await send_discord(
        "THE LION SQUAD · Testnachricht",
        "Diese Nachricht bestätigt, dass dein Discord-Webhook korrekt funktioniert. 🦁",
        event_key="test",
    )
    return res


# ---------- Seasons / Circuits ----------
season_router = APIRouter(prefix="/api/seasons", tags=["seasons"])


class SeasonCreate(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    kind: Literal["season", "circuit"] = "season"
    tournament_ids: List[str] = []
    f1_challenge_ids: List[str] = []
    points_per_position: List[int] = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
    drop_worst: int = 0  # Streichresultate
    bonus_points: dict = {}
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    banner_url: Optional[str] = None


class SeasonUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    kind: Optional[Literal["season", "circuit"]] = None
    status: Optional[Literal["draft", "active", "completed", "archived"]] = None
    tournament_ids: Optional[List[str]] = None
    f1_challenge_ids: Optional[List[str]] = None
    points_per_position: Optional[List[int]] = None
    drop_worst: Optional[int] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    banner_url: Optional[str] = None


@season_router.get("")
async def list_seasons():
    db = get_db()
    return await db.seasons.find({}, {"_id": 0}).sort("start_date", -1).to_list(200)


@season_router.get("/active/featured")
async def featured_season():
    """Returns the most relevant active season + top 5 standings for public widgets."""
    db = get_db()
    s = await db.seasons.find_one({"status": "active"}, {"_id": 0},
                                    sort=[("start_date", -1)])
    if not s:
        s = await db.seasons.find_one({}, {"_id": 0}, sort=[("start_date", -1)])
    if not s:
        return {"season": None, "standings": []}
    # Reuse standings logic (season_standings defined below in this module)
    lb = await season_standings(s.get("slug") or s["id"])
    return {"season": lb["season"], "standings": (lb.get("standings") or [])[:5]}


@season_router.get("/{slug_or_id}")
async def get_season(slug_or_id: str):
    db = get_db()
    s = await db.seasons.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Saison nicht gefunden")
    tids, fids = await _resolve_season_sources(s)
    s["tournaments"] = await db.tournaments.find({"id": {"$in": tids}}, {"_id": 0}).to_list(200)
    s["f1_challenges"] = await db.f1_challenges.find({"id": {"$in": fids}},
                                                       {"_id": 0}).to_list(200)
    return s


@season_router.post("")
async def create_season(body: SeasonCreate, me: dict = Depends(require_admin())):
    db = get_db()
    if await db.seasons.find_one({"slug": body.slug}):
        raise HTTPException(status_code=409, detail="Slug bereits vergeben")
    doc = body.model_dump()
    for k in ["start_date", "end_date"]:
        if doc.get(k):
            doc[k] = doc[k].isoformat()
    doc["id"] = new_id()
    doc["status"] = "draft"
    doc["created_at"] = now_utc().isoformat()
    doc["updated_at"] = now_utc().isoformat()
    doc["created_by"] = me["id"]
    await db.seasons.insert_one(doc)
    doc.pop("_id", None)
    return doc


@season_router.put("/{sid}")
@season_router.patch("/{sid}")
async def update_season(sid: str, body: SeasonUpdate, me: dict = Depends(require_admin())):
    db = get_db()
    current = await db.seasons.find_one({"$or": [{"id": sid}, {"slug": sid}]}, {"_id": 0})
    if not current:
        raise HTTPException(404, "Saison nicht gefunden")
    nullable_fields = {"description", "banner_url", "start_date", "end_date"}
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    if "slug" in updates and updates["slug"]:
        updates["slug"] = updates["slug"].strip().lower()
        existing = await db.seasons.find_one(
            {"slug": updates["slug"], "id": {"$ne": current["id"]}},
            {"_id": 0, "id": 1},
        )
        if existing:
            raise HTTPException(409, "Slug bereits vergeben")
    for k in ["start_date", "end_date"]:
        if k in updates:
            updates[k] = updates[k].isoformat() if updates[k] else None
    updates["updated_at"] = now_utc().isoformat()
    await db.seasons.update_one({"id": current["id"]}, {"$set": updates})
    return await db.seasons.find_one({"id": current["id"]}, {"_id": 0})


@season_router.delete("/{sid}")
async def delete_season(sid: str, me: dict = Depends(require_admin())):
    db = get_db()
    await db.seasons.delete_one({"$or": [{"id": sid}, {"slug": sid}]})
    return {"ok": True}


# ---------- Phase 7: Season Pass v2 (Vereinsplattform spec) ----------
@season_router.get("/v2/leaderboard")
async def leaderboard_v2(
    season_id: str | None = None,
    only_members: bool = False,
    only_community: bool = False,
    rookie_only: bool = False,
    teams: bool = False,
    source_type: str | None = None,
    limit: int = 100,
):
    """Aggregated standings using the Phase 7 points formula
    (base × weight × participant_factor + bonus, with farming protection)."""
    from services.season_service import aggregate_leaderboard
    rows = await aggregate_leaderboard(
        season_id=season_id,
        only_members=only_members,
        only_community=only_community,
        rookie_only=rookie_only,
        teams=teams,
        source_type=source_type,
        limit=limit,
    )
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    return {"standings": rows}


@season_router.get("/v2/me")
async def my_season_points(me: dict = Depends(get_current_user)):
    db = get_db()
    season = await db.seasons.find_one({"status": "active"}, {"_id": 0})
    if not season:
        return {"season": None, "total": 0, "entries": []}
    entries = await db.season_points.find(
        {"season_id": season["id"], "user_id": me["id"]}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    total = round(sum(e.get("total_points", 0) for e in entries), 1)
    return {"season": season, "total": total, "entries": entries}


@season_router.post("/v2/award")
async def award_points_admin(body: dict, me: dict = Depends(require_admin())):
    """Admin: manually award season points to a user/team."""
    from services.season_service import award_points
    res = await award_points(
        user_id=body.get("user_id"),
        team_id=body.get("team_id"),
        source_type=body.get("source_type", "custom"),
        source_id=body.get("source_id"),
        source_name=body.get("source_name", "Manuelle Vergabe"),
        rank=body.get("rank"),
        num_participants=int(body.get("num_participants", 1)),
        weight=float(body["weight"]) if body.get("weight") is not None else None,
        bonus=int(body.get("bonus", 0)),
        bonus_reason=body.get("bonus_reason"),
        farming_exempt=bool(body.get("farming_exempt", False)),
    )
    if res is None:
        raise HTTPException(400, "Keine aktive Saison.")
    return res


@season_router.delete("/v2/entry/{entry_id}")
async def delete_season_entry(entry_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    res = await db.season_points.delete_one({"id": entry_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Eintrag nicht gefunden.")
    return {"ok": True}


async def _resolve_season_sources(s: dict) -> tuple[list[str], list[str]]:
    """Resolve which tournaments + f1 challenges feed into this season.

    Strategy:
      - If `tournament_ids`/`f1_challenge_ids` are explicitly listed → use those.
      - Otherwise auto-include every tournament/f1 challenge whose status is in
        a relevant set AND whose start/created date falls inside the season
        date range (start_date / end_date). Falls back to all if season has no
        date range yet.
    """
    db = get_db()
    explicit_t = list(s.get("tournament_ids") or [])
    explicit_f = list(s.get("f1_challenge_ids") or [])
    if explicit_t and explicit_f:
        return explicit_t, explicit_f

    # Build date filter (lenient: matches scheduled_at OR created_at fallback)
    start = s.get("start_date")
    end = s.get("end_date")
    relevant_status = {"live", "completed", "results_published", "check_in", "scheduled"}

    auto_t: list[str] = []
    if not explicit_t:
        async for t in db.tournaments.find({}, {"id": 1, "status": 1, "start_date": 1, "created_at": 1, "_id": 0}):
            if t.get("status") not in relevant_status:
                continue
            ts = t.get("start_date") or t.get("created_at")
            if start and end and ts and not (start <= ts <= end):
                continue
            auto_t.append(t["id"])
    auto_f: list[str] = []
    if not explicit_f:
        async for f in db.f1_challenges.find({}, {"id": 1, "status": 1, "start_date": 1, "created_at": 1, "_id": 0}):
            if f.get("status") not in relevant_status:
                continue
            ts = f.get("start_date") or f.get("created_at")
            if start and end and ts and not (start <= ts <= end):
                continue
            auto_f.append(f["id"])

    return (explicit_t or auto_t), (explicit_f or auto_f)


@season_router.get("/{slug_or_id}/standings")
async def season_standings(slug_or_id: str):
    """Aggregate standings over all tournaments + F1 challenges in the season."""
    db = get_db()
    s = await db.seasons.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Saison nicht gefunden")
    points_system = s.get("points_per_position", [25, 18, 15, 12, 10, 8, 6, 4, 2, 1])
    per_user_points: dict = {}  # user_id -> {points, events_points_list, wins}

    def add_points(user_id, pts, won=False):
        per_user_points.setdefault(user_id, {"user_id": user_id, "points": 0, "events": [], "wins": 0})
        per_user_points[user_id]["events"].append(pts)
        if won:
            per_user_points[user_id]["wins"] += 1

    tournament_ids, f1_ids = await _resolve_season_sources(s)

    # Tournaments: use standings endpoint results (rank -> points)
    for tid in tournament_ids:
        matches = await db.matches.find({"tournament_id": tid}, {"_id": 0}).to_list(2000)
        regs = await db.tournament_registrations.find({"tournament_id": tid}, {"_id": 0}).to_list(500)
        reg_user_map = {r["id"]: r.get("user_id") for r in regs}
        # compute rank via furthest round + wins
        rank_map = {}
        for r in regs:
            rank_map[r["id"]] = {"rid": r["id"], "furthest_round": 0, "wins": 0}
        for m in matches:
            a, b, w = m.get("participant_a_id"), m.get("participant_b_id"), m.get("winner_id")
            if a in rank_map and m.get("round"):
                rank_map[a]["furthest_round"] = max(rank_map[a]["furthest_round"], m["round"])
            if b in rank_map and m.get("round"):
                rank_map[b]["furthest_round"] = max(rank_map[b]["furthest_round"], m["round"])
            if m.get("status") == "completed" and w:
                if w in rank_map: rank_map[w]["wins"] += 1
        sorted_rs = sorted(rank_map.values(), key=lambda x: (x["furthest_round"], x["wins"]), reverse=True)
        for pos, r in enumerate(sorted_rs):
            uid = reg_user_map.get(r["rid"])
            if not uid:
                continue
            pts = points_system[pos] if pos < len(points_system) else 0
            add_points(uid, pts, pos == 0)

    # F1 Challenges: aggregate per-track then championship-style
    for cid in f1_ids:
        tracks = await db.f1_tracks.find({"challenge_id": cid}, {"_id": 0}).to_list(100)
        for tr in tracks:
            times = await db.f1_lap_times.find(
                {"challenge_id": cid, "track_id": tr["id"], "is_invalid": {"$ne": True}},
                {"_id": 0},
            ).to_list(5000)
            best_per_user: dict = {}
            for t in times:
                eff = t["time_ms"] + int(t.get("penalty_seconds", 0) * 1000)
                if t["user_id"] not in best_per_user or eff < best_per_user[t["user_id"]]:
                    best_per_user[t["user_id"]] = eff
            sorted_u = sorted(best_per_user.items(), key=lambda x: x[1])
            for pos, (uid, _) in enumerate(sorted_u):
                pts = points_system[pos] if pos < len(points_system) else 0
                add_points(uid, pts, pos == 0)

    # Apply drop_worst
    drop_worst = s.get("drop_worst", 0)
    for uid, st in per_user_points.items():
        evts = sorted(st["events"], reverse=True)
        if drop_worst and len(evts) > drop_worst:
            evts = evts[: len(evts) - drop_worst]
        st["points"] = sum(evts)
        st["events_count"] = len(st["events"])

    # Enrich users
    user_ids = list(per_user_points.keys())
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0}).to_list(500)}
    arr = []
    for uid, st in per_user_points.items():
        u = users.get(uid, {})
        arr.append({**st,
                     "display_name": u.get("display_name") or u.get("username") or "—",
                     "username": u.get("username"),
                     "avatar_url": u.get("avatar_url")})
    arr.sort(key=lambda s: (s["points"], s["wins"]), reverse=True)
    for i, s_ in enumerate(arr):
        s_["rank"] = i + 1
        s_.pop("events", None)
    return {"season": s, "standings": arr}


# ---------- Widgets ----------
widget_router = APIRouter(prefix="/api/widgets", tags=["widgets"])


async def _public_f1_challenge_or_404(slug_or_id: str) -> dict:
    db = get_db()
    c = await db.f1_challenges.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not c or c.get("status") == "draft" or (c.get("visibility") or "public") != "public":
        raise HTTPException(status_code=404)
    return c


async def _public_tournament_or_404(slug_or_id: str) -> dict:
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if (
        not t
        or t.get("status") == "draft"
        or t.get("is_public") is False
        or not await user_can_see(None, t.get("visibility") or "public")
    ):
        raise HTTPException(status_code=404)
    return t


def _public_registration(reg: dict) -> dict:
    return {
        "id": reg.get("id"),
        "tournament_id": reg.get("tournament_id"),
        "status": reg.get("status"),
        "display_name": reg.get("display_name") or reg.get("ingame_name"),
        "ingame_name": reg.get("ingame_name"),
        "team_id": reg.get("team_id"),
        "seed": reg.get("seed"),
    }


def _public_challenge_summary(challenge: dict) -> dict:
    return {
        "id": challenge.get("id"),
        "slug": challenge.get("slug"),
        "title": challenge.get("title"),
        "status": challenge.get("status"),
    }


@widget_router.get("/tournament/{slug_or_id}/bracket")
async def widget_bracket(slug_or_id: str):
    """Read-only bracket data for widget embed."""
    db = get_db()
    t = await _public_tournament_or_404(slug_or_id)
    matches = await db.matches.find({"tournament_id": t["id"]}, {"_id": 0, "admin_note": 0,
                                                                    "reports": 0, "disputes": 0}).to_list(2000)
    regs = await db.tournament_registrations.find(
        {"tournament_id": t["id"]},
        {"_id": 0},
    ).to_list(500)
    return {"tournament": {"id": t["id"], "title": t["title"], "format": t["format"], "status": t["status"]},
            "matches": matches, "registrations": [_public_registration(r) for r in regs]}


@widget_router.get("/f1/{slug_or_id}/leaderboard")
async def widget_f1(slug_or_id: str, track_id: Optional[str] = None):
    db = get_db()
    c = await _public_f1_challenge_or_404(slug_or_id)
    if not track_id:
        first = await db.f1_tracks.find_one({"challenge_id": c["id"]}, {"_id": 0}, sort=[("order_index", 1)])
        if not first:
            return {"challenge": _public_challenge_summary(c), "track": None, "entries": []}
        track_id = first["id"]
    # reuse f1 leaderboard logic (inline-light)
    track = await db.f1_tracks.find_one({"id": track_id}, {"_id": 0})
    times = await db.f1_lap_times.find(
        {"challenge_id": c["id"], "track_id": track_id, "is_invalid": {"$ne": True}},
        {"_id": 0, "admin_note": 0, "proof_url": 0},
    ).to_list(5000)
    best_per_user = {}
    for t in times:
        eff = t["time_ms"] + int(t.get("penalty_seconds", 0) * 1000)
        if t["user_id"] not in best_per_user or eff < best_per_user[t["user_id"]]["effective_ms"]:
            best_per_user[t["user_id"]] = {**t, "effective_ms": eff}
    user_ids = list(best_per_user.keys())
    users = {u["id"]: u for u in await db.users.find(
        {"id": {"$in": user_ids}}, {"_id": 0, "password_hash": 0, "email": 0}).to_list(500)}
    entries = []
    for uid, tr in best_per_user.items():
        u = users.get(uid, {})
        m = tr["effective_ms"]
        entries.append({"display_name": u.get("display_name") or u.get("username") or "—",
                         "time_ms": m,
                         "time_str": f"{m//60000}:{(m%60000)//1000:02d}.{m%1000:03d}"})
    entries.sort(key=lambda e: e["time_ms"])
    for i, e in enumerate(entries):
        e["rank"] = i + 1
        e["gap_ms"] = e["time_ms"] - entries[0]["time_ms"] if i > 0 else 0
        e["gap_str"] = f"+{e['gap_ms']/1000:.3f}s" if i > 0 else ""
    return {"challenge": _public_challenge_summary(c),
            "track": track, "entries": entries}


# ---------- DSGVO ----------
dsgvo_router = APIRouter(prefix="/api/dsgvo", tags=["dsgvo"])


@dsgvo_router.get("/export-my-data")
async def export_my_data(me: dict = Depends(get_current_user)):
    db = get_db()
    u = await db.users.find_one({"id": me["id"]}, {"_id": 0, "password_hash": 0})
    regs = await db.tournament_registrations.find({"user_id": me["id"]}, {"_id": 0}).to_list(500)
    lap_times = await db.f1_lap_times.find({"user_id": me["id"]}, {"_id": 0}).to_list(500)
    teams = await db.teams.find({"member_ids": me["id"]}, {"_id": 0}).to_list(100)
    emails = await db.email_logs.find({"to": u.get("email", "")}, {"_id": 0}).to_list(200)
    return {
        "exported_at": now_utc().isoformat(),
        "user": u,
        "tournament_registrations": regs,
        "f1_lap_times": lap_times,
        "teams": teams,
        "email_logs": emails,
    }


@dsgvo_router.post("/anonymize-me")
async def anonymize_me(me: dict = Depends(get_current_user)):
    """Anonymize own account but keep tournament history for statistical integrity."""
    db = get_db()
    anon_username = f"deleted_{me['id'][:8]}"
    anon_email = f"deleted_{me['id'][:8]}@deleted.local"
    await db.users.update_one({"id": me["id"]}, {"$set": {
        "email": anon_email, "username": anon_username,
        "display_name": "Gelöschter User", "bio": None,
        "discord_name": None, "discord_id": None,
        "switch_code": None, "steam_id": None, "epic_id": None,
        "psn_id": None, "xbox_id": None, "riot_id": None,
        "country": None, "state": None, "avatar_url": None,
        "privacy_public_profile": False, "is_active": False, "is_banned": True,
        "password_hash": "!disabled",
        "updated_at": now_utc().isoformat(),
    }})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.self_anonymize",
                                     "actor_id": me["id"], "created_at": now_utc().isoformat()})
    return {"ok": True}


@dsgvo_router.post("/admin/anonymize/{user_id}")
async def admin_anonymize(user_id: str, me: dict = Depends(require_super())):
    db = get_db()
    anon_email = f"deleted_{user_id[:8]}@deleted.local"
    anon_username = f"deleted_{user_id[:8]}"
    await db.users.update_one({"id": user_id}, {"$set": {
        "email": anon_email, "username": anon_username,
        "display_name": "Gelöschter User", "is_active": False, "is_banned": True,
        "password_hash": "!disabled", "updated_at": now_utc().isoformat(),
    }})
    await db.audit_logs.insert_one({"id": new_id(), "action": "user.admin_anonymize",
                                     "target_id": user_id, "actor_id": me["id"],
                                     "created_at": now_utc().isoformat()})
    return {"ok": True}


# ---------- PDF Exports ----------
pdf_router = APIRouter(prefix="/api/exports", tags=["exports"])


def _pdf_response(data: bytes, filename: str):
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@pdf_router.get("/tournaments/{slug_or_id}/participants.pdf")
async def pdf_tournament_participants(slug_or_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    team_ids = list({r["team_id"] for r in regs if r.get("team_id")})
    teams = {x["id"]: x for x in await db.teams.find({"id": {"$in": team_ids}}, {"_id": 0}).to_list(500)}
    for r in regs:
        if r.get("team_id"):
            r["team"] = teams.get(r["team_id"], {})
    data = pdf_participants(t, regs)
    return _pdf_response(data, f"teilnehmer_{t['slug']}.pdf")


@pdf_router.get("/tournaments/{slug_or_id}/checkin.pdf")
async def pdf_tournament_checkin(slug_or_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    return _pdf_response(pdf_checkin(t, regs), f"checkin_{t['slug']}.pdf")


@pdf_router.get("/tournaments/{slug_or_id}/matches.pdf")
async def pdf_tournament_matches(slug_or_id: str, me: dict = Depends(require_admin())):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    matches = await db.matches.find({"tournament_id": t["id"]}, {"_id": 0}).sort("round", 1).to_list(2000)
    regs = await db.tournament_registrations.find({"tournament_id": t["id"]}, {"_id": 0}).to_list(500)
    reg_map = {r["id"]: r for r in regs}
    return _pdf_response(pdf_matches(t, matches, reg_map), f"matches_{t['slug']}.pdf")


@pdf_router.get("/tournaments/{slug_or_id}/standings.pdf")
async def pdf_tournament_standings(slug_or_id: str):
    db = get_db()
    t = await db.tournaments.find_one({"$or": [{"id": slug_or_id}, {"slug": slug_or_id}]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404)
    # Reuse standings logic
    from routes.tournament_routes import standings as st_fn
    rows = await st_fn(t["id"])
    return _pdf_response(pdf_standings(t, rows), f"standings_{t['slug']}.pdf")


@pdf_router.get("/f1/{slug_or_id}/leaderboard.pdf")
async def pdf_f1_lb(slug_or_id: str, track_id: Optional[str] = None):
    db = get_db()
    c = await _public_f1_challenge_or_404(slug_or_id)
    from routes.f1_routes import leaderboard as f1_lb
    lb = await f1_lb(c["id"], track_id)
    return _pdf_response(pdf_f1_leaderboard(c, lb.get("track"), lb.get("entries", [])),
                          f"f1_{c['slug']}.pdf")


@pdf_router.get("/f1/{slug_or_id}/championship.pdf")
async def pdf_f1_championship(slug_or_id: str):
    db = get_db()
    c = await _public_f1_challenge_or_404(slug_or_id)
    from routes.f1_routes import championship_standings as f1_champ
    cs = await f1_champ(c["id"])
    # Reuse standings PDF shape
    rows = [{"rank": r["rank"], "display_name": r["display_name"],
             "won": r.get("wins", 0), "lost": (r.get("races", 0) - r.get("wins", 0)),
             "points": r.get("points", 0)} for r in (cs.get("standings") or [])]
    fake_tournament = {"title": (c.get("title") or "F1") + " · Championship", "slug": c.get("slug")}
    return _pdf_response(pdf_standings(fake_tournament, rows),
                          f"f1_championship_{c.get('slug') or slug_or_id}.pdf")


# ---------- Audit ----------
audit_router = APIRouter(prefix="/api/audit", tags=["audit"])


@audit_router.get("")
async def list_audit(action: Optional[str] = None, limit: int = 200, me: dict = Depends(require_admin())):
    db = get_db()
    q = {}
    if action:
        q["action"] = {"$regex": action}
    logs = await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    # Enrich actor
    ids = list({l.get("actor_id") for l in logs if l.get("actor_id")})
    users = {u["id"]: u for u in await db.users.find({"id": {"$in": ids}},
                                                      {"_id": 0, "password_hash": 0}).to_list(500)}
    for l in logs:
        if l.get("actor_id"):
            u = users.get(l["actor_id"], {})
            l["actor_username"] = u.get("username")
            l["actor_display_name"] = u.get("display_name")
    return logs
