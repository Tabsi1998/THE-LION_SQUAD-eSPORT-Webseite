"""Admin settings: email, SMTP, branding, socials, legal texts, banners, Discord and auth."""

import logging
import os
from fastapi import Query, APIRouter, HTTPException, Depends, Response
from pydantic import BaseModel, EmailStr
from typing import Optional, List, Literal
from datetime import datetime, timezone
import httpx

from database import get_db
from auth import require_admin, require_club_admin, require_super, get_optional_user, require_area
from services.public_site_settings import PUBLIC_LEGAL_SOURCE_FIELDS, build_public_legal_settings
from services.auth_settings import is_google_client_id, load_auth_settings
from services.secret_store import decrypt_secret, encrypt_secret, secret_is_configured
from models import now_utc, new_id
from email_service import send_template

settings_router = APIRouter(prefix="/api/settings", tags=["settings"])

DEFAULT_SOCIAL_LINKS = [
    {"platform": "discord", "label": "Discord", "url": "https://discord.com/invite/thelionsquadesports", "enabled": True},
    {"platform": "whatsapp", "label": "WhatsApp Kanal", "url": "https://whatsapp.com/channel/0029VaaWufTGU3BNG6VOxo1I", "enabled": True},
    {"platform": "facebook", "label": "Facebook", "url": "https://www.facebook.com/thelionsquadesports", "enabled": True},
    {"platform": "instagram", "label": "Instagram", "url": "https://instagram.com/thelionsquadesports", "enabled": True},
    {"platform": "tiktok", "label": "TikTok", "url": "https://www.tiktok.com/@thelionsquadesports", "enabled": True},
    {"platform": "youtube", "label": "YouTube", "url": "https://www.youtube.com/@TheLionSquadeSports", "enabled": True},
    {"platform": "twitch", "label": "Twitch", "url": "https://www.twitch.tv/the_lion_squad_esports", "enabled": True},
]

SOCIAL_LEGACY_FIELDS = {
    "discord": "discord_invite_url",
    "whatsapp": "whatsapp_channel_url",
    "facebook": "facebook_url",
    "instagram": "instagram_url",
    "tiktok": "tiktok_url",
    "youtube": "youtube_url",
}


class EmailSettings(BaseModel):
    resend_api_key: Optional[str] = None
    clear_resend_api_key: Optional[bool] = None
    sender_name: Optional[str] = None
    sender_email: Optional[str] = None
    reply_to_email: Optional[str] = None
    enabled: bool = True


class SocialLinkSettings(BaseModel):
    platform: Optional[str] = None
    label: Optional[str] = None
    url: Optional[str] = None
    enabled: Optional[bool] = True


class BrandingSettings(BaseModel):
    club_name: Optional[str] = None
    tagline: Optional[str] = None
    site_title: Optional[str] = None
    site_description: Optional[str] = None
    primary_color: Optional[str] = None
    logo_url: Optional[str] = None
    logo_light_url: Optional[str] = None
    logo_dark_url: Optional[str] = None
    share_banner_url: Optional[str] = None
    mascot_url: Optional[str] = None
    qr_logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    favicon_light_url: Optional[str] = None
    favicon_dark_url: Optional[str] = None
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
    # Vereinsdaten aus Dolibarr (#326): Name, ZVR, Behörde, Anschrift, Telefon und die vertretungsbefugte
    # Person kommen aus dem Vereinsmodul; von Hand gepflegte Werte bleiben Rückfall.
    legal_from_dolibarr: Optional[bool] = None
    # Kanäle aus Dolibarr (#326 Teil 4): Footer und Suchmaschinen nehmen die öffentlichen Kanäle des Vereins
    # aus dem Vereinsmodul; stehen dort keine, gilt die Liste von Hand.
    channels_from_dolibarr: Optional[bool] = None
    legal_extra: Optional[str] = None
    privacy_extra: Optional[str] = None
    terms_of_use: Optional[str] = None
    discord_invite_url: Optional[str] = None
    # Play-Store-Link (#425): leer, bis der Eintrag öffentlich ist - erst dann zeigt die Website den
    # offiziellen Badge (Googles Regel: nur mit Link zum erreichbaren Eintrag).
    play_store_url: Optional[str] = None
    twitch_channel: Optional[str] = None
    analytics_provider: Optional[Literal["", "google", "plausible"]] = None
    google_analytics_id: Optional[str] = None
    plausible_domain: Optional[str] = None
    google_site_verification: Optional[str] = None
    msvalidate_01: Optional[str] = None
    indexnow_key: Optional[str] = None
    whatsapp_channel_url: Optional[str] = None
    # Social channels (Phase X — full social presence)
    facebook_url: Optional[str] = None
    instagram_url: Optional[str] = None
    tiktok_url: Optional[str] = None
    youtube_url: Optional[str] = None
    social_links: Optional[List[SocialLinkSettings]] = None
    # Phase E — Twitch Helix credentials
    twitch_client_id: Optional[str] = None
    twitch_client_secret: Optional[str] = None
    clear_twitch_client_secret: Optional[bool] = None
    twitch_live_detection: Optional[bool] = None
    # Plattform-Konten verknüpfen (#260): Discord-App und optionaler Steam-Schlüssel (Twitch nutzt die Helix-App).
    discord_client_id: Optional[str] = None
    discord_client_secret: Optional[str] = None
    clear_discord_client_secret: Optional[bool] = None
    steam_api_key: Optional[str] = None
    clear_steam_api_key: Optional[bool] = None
    # Weitere Plattformen zum Verknüpfen (#260 II): je App Client ID + Secret, Secret verschlüsselt.
    battlenet_client_id: Optional[str] = None
    battlenet_client_secret: Optional[str] = None
    clear_battlenet_client_secret: Optional[bool] = None
    x_client_id: Optional[str] = None
    x_client_secret: Optional[str] = None
    clear_x_client_secret: Optional[bool] = None
    youtube_client_id: Optional[str] = None
    youtube_client_secret: Optional[str] = None
    clear_youtube_client_secret: Optional[bool] = None
    tiktok_client_key: Optional[str] = None
    tiktok_client_secret: Optional[str] = None
    clear_tiktok_client_secret: Optional[bool] = None
    riot_client_id: Optional[str] = None
    riot_client_secret: Optional[str] = None
    clear_riot_client_secret: Optional[bool] = None
    xbox_client_id: Optional[str] = None
    xbox_client_secret: Optional[str] = None
    clear_xbox_client_secret: Optional[bool] = None
    epic_client_id: Optional[str] = None
    epic_client_secret: Optional[str] = None
    clear_epic_client_secret: Optional[bool] = None
    site_banner_enabled: Optional[bool] = None
    site_banner_text: Optional[str] = None
    site_banner_tone: Optional[Literal["info", "live", "warning", "success"]] = None
    site_banner_mode: Optional[Literal["ticker", "static"]] = None
    site_banner_speed_seconds: Optional[int] = None
    site_banner_style: Optional[Literal["neon", "solid", "minimal"]] = None
    site_banner_position: Optional[Literal["below_nav", "bottom_fixed", "above_footer"]] = None
    site_banner_scope: Optional[Literal["all", "tournaments", "fastlap", "events", "news", "community", "servers", "members", "custom"]] = None
    site_banner_path: Optional[str] = None
    site_banner_audience: Optional[Literal["all", "logged_in", "members", "admins"]] = None
    site_banner_link_url: Optional[str] = None
    site_banner_link_label: Optional[str] = None
    site_banner_starts_at: Optional[str] = None
    site_banner_ends_at: Optional[str] = None


class TestEmailBody(BaseModel):
    to: EmailStr


class NewsletterTriggerBody(BaseModel):
    kind: Literal["news", "event"]
    id: str
    force: bool = False


class IndexNowSubmitBody(BaseModel):
    urls: Optional[List[str]] = None


BannerTone = Literal["info", "live", "warning", "success"]
BannerMode = Literal["ticker", "static"]
BannerStyle = Literal["neon", "solid", "minimal"]
BannerPosition = Literal["below_nav", "bottom_fixed", "above_footer"]
BannerScope = Literal["all", "tournaments", "fastlap", "events", "news", "community", "servers", "members", "custom"]
BannerAudience = Literal["all", "logged_in", "members", "admins"]
BannerTemplate = Literal["custom", "live", "maintenance", "event", "registration", "discord"]
BannerChannel = Literal["web", "app"]


class SiteBannerPayload(BaseModel):
    title: Optional[str] = None
    text: str
    enabled: bool = True
    priority: int = 50
    tone: BannerTone = "info"
    mode: BannerMode = "ticker"
    speed_seconds: int = 22
    style: BannerStyle = "neon"
    position: BannerPosition = "below_nav"
    scope: BannerScope = "all"
    path: Optional[str] = None
    audience: BannerAudience = "all"
    link_url: Optional[str] = None
    link_label: Optional[str] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    template: BannerTemplate = "custom"
    # Wo der Banner läuft (#245): Website, App oder beides. Bestehende Banner bleiben Website-only.
    channels: List[BannerChannel] = ["web"]


class SiteBannerPatch(BaseModel):
    title: Optional[str] = None
    text: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    tone: Optional[BannerTone] = None
    mode: Optional[BannerMode] = None
    speed_seconds: Optional[int] = None
    style: Optional[BannerStyle] = None
    position: Optional[BannerPosition] = None
    scope: Optional[BannerScope] = None
    path: Optional[str] = None
    audience: Optional[BannerAudience] = None
    link_url: Optional[str] = None
    link_label: Optional[str] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    template: Optional[BannerTemplate] = None
    channels: Optional[List[BannerChannel]] = None


class SiteBannerStatBody(BaseModel):
    banner_id: str


async def _newsletter_source(kind: str, source_id: str) -> dict:
    db = get_db()
    if kind == "news":
        item = await db.news_posts.find_one({"$or": [{"id": source_id}, {"slug": source_id}]}, {"_id": 0})
    elif kind == "event":
        item = await db.events.find_one({"$or": [{"id": source_id}, {"slug": source_id}]}, {"_id": 0})
    else:
        item = None
    if not item:
        raise HTTPException(404, "Newsletter-Quelle nicht gefunden.")
    return item


class DiscordSettings(BaseModel):
    webhook_url: Optional[str] = None
    clear_webhook: Optional[bool] = None
    # Eigener Kanal für den Betrieb (#265): Alarme gehen nie in den Community-Kanal.
    ops_webhook_url: Optional[str] = None
    clear_ops_webhook: Optional[bool] = None
    username: Optional[str] = None
    avatar_url: Optional[str] = None
    enabled: bool = True
    # Ein Webhook je Zweck (#300): news, events, achievements, board. Je Ziel
    # `webhook_url` (leer lassen = behalten), `clear` und ein eigener Name.
    targets: Optional[dict[str, dict]] = None
    # Schalter je Ereignis; die Schlüssel stehen in discord_service.EVENTS.
    events: Optional[dict[str, bool]] = None
    # Discord-Bot (#302): Token verschlüsselt (leer lassen = behalten), Schalter, Server, Rollennamen.
    bot_token: Optional[str] = None
    clear_bot_token: Optional[bool] = None
    bot_enabled: Optional[bool] = None
    bot_guild_id: Optional[str] = None
    bot_roles: Optional[dict[str, str]] = None
    bot_count_messages: Optional[bool] = None


class AmpSettings(BaseModel):
    base_url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    clear_password: Optional[bool] = None
    enabled: bool = True


class AuthSettings(BaseModel):
    password_login_enabled: Optional[bool] = None
    registration_enabled: Optional[bool] = None
    google_login_enabled: Optional[bool] = None
    google_registration_enabled: Optional[bool] = None
    google_linking_enabled: Optional[bool] = None
    google_client_id: Optional[str] = None


SETTING_AUDIT_SECRET_FIELDS = {"resend_api_key", "smtp_pass", "webhook_url", "ops_webhook_url", "twitch_client_secret", "discord_client_secret", "steam_api_key",
                               "battlenet_client_secret", "x_client_secret", "youtube_client_secret", "tiktok_client_secret", "riot_client_secret", "xbox_client_secret", "epic_client_secret"}
# Geheimnisse der Branding-Einstellungen: nie zurückgeben, nur „gespeichert“ melden (#260 dazu: Discord, Steam).
BRANDING_SECRET_FIELDS = ("twitch_client_secret", "discord_client_secret", "steam_api_key", "battlenet_client_secret", "x_client_secret", "youtube_client_secret", "tiktok_client_secret", "riot_client_secret", "xbox_client_secret", "epic_client_secret")


def _hide_branding_secrets(settings: dict) -> dict:
    out = dict(settings or {})
    for field in BRANDING_SECRET_FIELDS:
        if secret_is_configured(out.get(field)):
            out[f"{field}_masked"] = "********"
        out.pop(field, None)
    return out


def _twitch_url(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return "https://www.twitch.tv/the_lion_squad_esports"
    if raw.startswith(("http://", "https://")):
        return raw
    return f"https://www.twitch.tv/{raw.lstrip('@')}"


def _normalize_social_link(item: dict) -> dict | None:
    platform = str(item.get("platform") or "").strip().lower()
    label = str(item.get("label") or platform or "Link").strip()
    url = str(item.get("url") or "").strip()
    if not url:
        return None
    return {
        "platform": platform or "custom",
        "label": label,
        "url": url,
        "enabled": item.get("enabled") is not False,
    }


def _social_links_from_branding(settings: dict) -> list[dict]:
    raw = settings.get("social_links")
    if isinstance(raw, list) and raw:
        links = [_normalize_social_link(item) for item in raw if isinstance(item, dict)]
        return [link for link in links if link]
    links = []
    for default in DEFAULT_SOCIAL_LINKS:
        item = dict(default)
        field = SOCIAL_LEGACY_FIELDS.get(item["platform"])
        if field:
            item["url"] = settings.get(field) or item["url"]
        elif item["platform"] == "twitch":
            item["url"] = _twitch_url(settings.get("twitch_channel"))
        normalized = _normalize_social_link(item)
        if normalized:
            links.append(normalized)
    return links


async def _public_social_links(db, b: dict) -> list[dict]:
    """Footer-Kanäle: aus Dolibarr, wenn der Schalter an ist und der Verein dort welche pflegt; sonst von Hand."""
    if b.get("channels_from_dolibarr"):
        from services import club_facts
        channels = club_facts.channels_public((await club_facts.snapshot(db)).get("organization"))
        if channels:
            return channels
    return _social_links_from_branding(b)


def _sync_legacy_social_fields(updates: dict) -> None:
    raw = updates.get("social_links")
    if not isinstance(raw, list):
        return
    normalized = [_normalize_social_link(item) for item in raw if isinstance(item, dict)]
    updates["social_links"] = [item for item in normalized if item]
    for item in updates["social_links"]:
        platform = item.get("platform")
        if platform in SOCIAL_LEGACY_FIELDS:
            updates[SOCIAL_LEGACY_FIELDS[platform]] = item.get("url") or ""
        elif platform == "twitch" and item.get("url"):
            updates["twitch_channel"] = item["url"]


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


def _parse_public_dt(value: str | None):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _normalize_banner_link(value: str | None) -> str:
    link_url = str(value or "").strip()
    if link_url and not link_url.startswith(("http://", "https://", "/")):
        link_url = "https://" + link_url
    return link_url


def _banner_active(doc: dict, user: dict | None) -> bool:
    if not doc.get("enabled", True):
        return False
    if not str(doc.get("text") or "").strip():
        return False
    now = now_utc()
    starts_at = _parse_public_dt(doc.get("starts_at"))
    ends_at = _parse_public_dt(doc.get("ends_at"))
    if starts_at and starts_at > now:
        return False
    if ends_at and ends_at < now:
        return False
    audience = doc.get("audience") or "all"
    admin_roles = {"moderator", "tournament_admin", "club_admin", "superadmin"}
    if audience == "all":
        return True
    if audience == "logged_in":
        return bool(user)
    if audience == "members":
        return bool(user and (user.get("is_club_member") or user.get("role") in admin_roles))
    if audience == "admins":
        return bool(user and user.get("role") in admin_roles)
    return False


def banner_channels(doc: dict) -> list[str]:
    """Wo ein Banner läuft (#245): gespeicherte Kanäle; ohne Angabe Website - automatische
    Banner (Wartung, Anmeldung offen, Check-in) laufen überall."""
    stored = [channel for channel in (doc.get("channels") or []) if channel in ("web", "app")]
    if stored:
        return sorted(set(stored), key=("web", "app").index)
    return ["web", "app"] if doc.get("source") == "auto" else ["web"]


def _public_banner_doc(doc: dict, stats: dict | None = None) -> dict:
    return {
        "id": doc.get("id"),
        "enabled": bool(doc.get("enabled", True)),
        "title": doc.get("title") or "",
        "text": str(doc.get("text") or "").strip(),
        "tone": doc.get("tone") or "info",
        "mode": doc.get("mode") or "ticker",
        "speed_seconds": max(8, min(180, int(doc.get("speed_seconds") or 22))),
        "style": doc.get("style") or "neon",
        "position": doc.get("position") or "below_nav",
        "scope": doc.get("scope") or "all",
        "path": str(doc.get("path") or "").strip(),
        "audience": doc.get("audience") or "all",
        "link_url": _normalize_banner_link(doc.get("link_url")),
        "link_label": str(doc.get("link_label") or "").strip(),
        "priority": int(doc.get("priority") or 0),
        "template": doc.get("template") or "custom",
        "source": doc.get("source") or "manual",
        "channels": banner_channels(doc),
        "stats": {
            "impressions": int((stats or {}).get("impressions") or doc.get("impressions") or 0),
            "clicks": int((stats or {}).get("clicks") or doc.get("clicks") or 0),
        },
    }


def _parse_dt_any(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return _parse_public_dt(str(value))


async def _auto_site_banners(db) -> list[dict]:
    now = now_utc()
    items: list[dict] = []
    servers = await db.game_servers.find(
        {"status": "maintenance", "site_banner_enabled": True, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "name": 1, "maintenance_note": 1, "maintenance_until": 1, "visibility": 1},
    ).sort("sort_order", 1).to_list(3)
    for server in servers:
        until = server.get("maintenance_until")
        text = f"{server.get('name') or 'Server'} ist in Wartung"
        if server.get("maintenance_note"):
            text += f": {server['maintenance_note']}"
        if until:
            text += f" · bis {until}"
        items.append({
            "id": f"auto-server-maintenance-{server.get('id')}",
            "source": "auto",
            "template": "maintenance",
            "enabled": True,
            "priority": 80,
            "text": text,
            "tone": "warning",
            "mode": "ticker",
            "speed_seconds": 24,
            "style": "minimal",
            "position": "below_nav",
            "scope": "servers",
            "audience": "members" if server.get("visibility") == "members" else "logged_in" if server.get("visibility") == "community" else "all",
            "link_url": "/servers",
            "link_label": "Server ansehen",
        })

    tournaments = await db.tournaments.find(
        {"status": {"$in": ["registration_open", "check_in", "scheduled", "registration_closed"]}, "site_banner_enabled": True, "is_public": {"$ne": False}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "start_date": 1},
    ).sort("start_date", 1).to_list(10)
    for t in tournaments:
        start_dt = _parse_dt_any(t.get("start_date"))
        if t.get("status") == "check_in":
            text = f"Check-in offen: {t.get('title') or 'Turnier'}"
            template, tone, priority = "registration", "warning", 85
        elif t.get("status") == "registration_open":
            text = f"Anmeldung offen: {t.get('title') or 'Turnier'}"
            template, tone, priority = "registration", "success", 75
        elif start_dt and now <= start_dt and (start_dt - now).total_seconds() <= 24 * 3600:
            text = f"Turnier startet bald: {t.get('title') or 'Turnier'}"
            template, tone, priority = "event", "info", 70
        else:
            continue
        items.append({
            "id": f"auto-tournament-{template}-{t.get('id')}",
            "source": "auto",
            "template": template,
            "enabled": True,
            "priority": priority,
            "text": text,
            "tone": tone,
            "mode": "ticker",
            "speed_seconds": 24,
            "style": "neon",
            "position": "below_nav",
            "scope": "tournaments",
            "audience": "all",
            "link_url": f"/tournaments/{t.get('slug') or t.get('id')}",
            "link_label": "Zum Turnier",
        })

    fastlaps = await db.f1_challenges.find(
        {"status": {"$in": ["registration_open", "check_in", "scheduled", "registration_closed"]}, "site_banner_enabled": True, "visibility": {"$ne": "internal"}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "status": 1, "start_date": 1},
    ).sort("start_date", 1).to_list(10)
    for challenge in fastlaps:
        start_dt = _parse_dt_any(challenge.get("start_date"))
        if challenge.get("status") == "registration_open":
            text = f"Fast-Lap Einreichung offen: {challenge.get('title') or 'Challenge'}"
            template, tone, priority = "registration", "success", 75
        elif start_dt and now <= start_dt and (start_dt - now).total_seconds() <= 24 * 3600:
            text = f"Fast-Lap startet bald: {challenge.get('title') or 'Challenge'}"
            template, tone, priority = "event", "info", 70
        else:
            continue
        items.append({
            "id": f"auto-fastlap-{template}-{challenge.get('id')}",
            "source": "auto",
            "template": template,
            "enabled": True,
            "priority": priority,
            "text": text,
            "tone": tone,
            "mode": "ticker",
            "speed_seconds": 24,
            "style": "neon",
            "position": "below_nav",
            "scope": "fastlap",
            "audience": "all",
            "link_url": f"/fastlap/{challenge.get('slug') or challenge.get('id')}",
            "link_label": "Zur Challenge",
        })
    return items


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
    # Vereinsdaten aus Dolibarr (#326) liegen über den Handfeldern, wenn der Schalter gesetzt ist;
    # die Datenschutzerklärung baut sich aus den Schaltern, die wirklich an sind (privacy_facts).
    from services import site_texts
    legal_settings, facts = await site_texts.legal_context(db)
    legal_settings.pop("contact_ready", None)
    legal_settings.pop("missing_legal_fields", None)
    legal_settings["privacy_facts"] = facts
    return {
        "club_name": b.get("club_name", "THE LION SQUAD"),
        "tagline": tagline,
        "site_title": b.get("site_title") or "THE LION SQUAD - eSPORTS",
        "site_description": b.get("site_description") or "Gaming und eSports Verein aus Tirol mit Community, Turnieren, Fast-Lap-Challenges, Events, Mitgliedschaft und Vereinsleben.",
        "primary_color": b.get("primary_color", "#29B6E8"),
        "logo_url": b.get("logo_url"),
        "logo_light_url": b.get("logo_light_url"),
        "logo_dark_url": b.get("logo_dark_url"),
        "share_banner_url": b.get("share_banner_url"),
        "mascot_url": b.get("mascot_url"),
        "qr_logo_url": b.get("qr_logo_url"),
        "favicon_url": b.get("favicon_url"),
        "favicon_light_url": b.get("favicon_light_url"),
        "favicon_dark_url": b.get("favicon_dark_url"),
        "domain": domain,
        "timezone": b.get("timezone") or "Europe/Vienna",
        **legal_settings,
        "discord_invite_url": b.get("discord_invite_url") or "https://discord.com/invite/thelionsquadesports",
        "play_store_url": (b.get("play_store_url") or "").strip(),
        "twitch_channel": b.get("twitch_channel") or "the_lion_squad_esports",
        "whatsapp_channel_url": b.get("whatsapp_channel_url") or "https://whatsapp.com/channel/0029VaaWufTGU3BNG6VOxo1I",
        "analytics_provider": b.get("analytics_provider") or "",
        "google_analytics_id": b.get("google_analytics_id") or "",
        "plausible_domain": b.get("plausible_domain") or "",
        "google_site_verification": b.get("google_site_verification") or "",
        "msvalidate_01": b.get("msvalidate_01") or "",
        "indexnow_key": b.get("indexnow_key") or "",
        "facebook_url": b.get("facebook_url") or "https://www.facebook.com/thelionsquadesports",
        "instagram_url": b.get("instagram_url") or "https://instagram.com/thelionsquadesports",
        "tiktok_url": b.get("tiktok_url") or "https://www.tiktok.com/@thelionsquadesports",
        "youtube_url": b.get("youtube_url") or "https://www.youtube.com/@TheLionSquadeSports",
        "social_links": await _public_social_links(db, b),
        "channels_from_dolibarr": bool(b.get("channels_from_dolibarr")),
        **(await load_auth_settings(db)),
    }


@settings_router.get("/public/legal/{page}")
async def public_legal_page(page: str, response: Response):
    """Datenschutz, Impressum, Nutzungsbedingungen als fertige Abschnitte (#545) - dieselbe Quelle wie die
    Crawler-Vorschau, gebaut aus den öffentlichen Vereinsdaten und den Schaltern, die wirklich an sind."""
    response.headers["Cache-Control"] = "no-store"
    from services import site_texts
    legal, facts = await site_texts.legal_context(get_db())
    doc = site_texts.legal_page(page, legal, facts)
    if not doc:
        raise HTTPException(404, "Diese Rechtsseite gibt es nicht.")
    return doc


def _secret_state(value) -> str:
    """„missing“, „ok“ oder „unreadable“: ob ein gespeicherter Schlüssel sich mit dem aktuellen
    SETTINGS_ENCRYPTION_KEY lesen lässt (#546). Der Wert selbst verlässt diese Funktion nicht."""
    if not secret_is_configured(value):
        return "missing"
    try:
        decrypt_secret(value)
        return "ok"
    except RuntimeError:
        return "unreadable"


GROUP_LOGIN_MAIL = "Anmeldung und E-Mail"
GROUP_PLATFORMS = "Plattformen zum Verknüpfen"
GROUP_DISCORD = "Discord"
GROUP_OTHER = "Weitere Dienste"
UNREADABLE_TEXT = "gespeichert, aber nicht lesbar – SETTINGS_ENCRYPTION_KEY in der .env prüfen"


@settings_router.get("/integrations/overview")
async def integrations_overview(me: dict = Depends(require_area("system"))):
    """Alle Verbindungen auf einer Seite (#546): aktiv, aus, fehlt, Fehler - und „gespeichert, aber nicht
    lesbar“, wenn ein Schlüssel nicht zum aktuellen SETTINGS_ENCRYPTION_KEY passt (nach einem Server-Update
    die häufigste Ursache für „alle Verbindungen sind weg“). Nie Schlüssel oder Adressen in der Antwort."""
    from collections import Counter
    from services.platform_links import PLATFORMS
    from services.media_scan import SETTINGS_ID as MEDIA_SCAN_ID, load_settings as load_media_scan
    from services.dolibarr_client import load_settings as load_dolibarr
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    email = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    mail = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    discord = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    media_raw = await db.settings.find_one({"id": MEDIA_SCAN_ID}, {"_id": 0}) or {}
    sync_state = await db.settings.find_one({"id": "dolibarr_sync_state"}, {"_id": 0}) or {}
    auth = await load_auth_settings(db)
    media = await load_media_scan(db)
    dolibarr = await load_dolibarr(db)
    rows: list[dict] = []

    def add(key: str, label: str, group: str, to: str, state: str, detail: str = ""):
        rows.append({"key": key, "label": label, "group": group, "to": to, "state": state, "detail": detail})

    # Anmeldung und E-Mail
    google_on = any(auth.get(k) for k in ("google_login_enabled", "google_registration_enabled", "google_linking_enabled"))
    if not auth.get("google_configured"):
        add("google", "Google", GROUP_LOGIN_MAIL, "/admin/settings/google", "missing", "keine Web-Client-ID")
    else:
        add("google", "Google", GROUP_LOGIN_MAIL, "/admin/settings/google", "active" if google_on else "off",
            "Client-ID gespeichert · Anmeldung mit Google an" if google_on else "Client-ID gespeichert · alle Google-Schalter aus")
    provider = str(mail.get("provider") or ("smtp" if mail.get("smtp_host") else "resend")).strip().lower()
    enabled = bool(mail.get("enabled", True)) if "enabled" in mail else bool(email.get("enabled", True))
    key_state = _secret_state(email.get("resend_api_key"))
    if key_state == "unreadable":
        add("resend", "Resend", GROUP_LOGIN_MAIL, "/admin/settings/resend", "unreadable", f"API-Key {UNREADABLE_TEXT}")
    elif key_state == "missing":
        add("resend", "Resend", GROUP_LOGIN_MAIL, "/admin/settings/resend", "missing", "kein API-Key")
    elif provider == "resend" and enabled:
        add("resend", "Resend", GROUP_LOGIN_MAIL, "/admin/settings/resend", "active", "Versandweg der Website")
    else:
        add("resend", "Resend", GROUP_LOGIN_MAIL, "/admin/settings/resend", "off", "API-Key gespeichert · Versand läuft über SMTP" if provider == "smtp" else "API-Key gespeichert · Versand ausgeschaltet")
    pass_state = _secret_state(mail.get("smtp_pass"))
    if pass_state == "unreadable":
        add("smtp", "SMTP", GROUP_LOGIN_MAIL, "/admin/settings/smtp", "unreadable", f"Passwort {UNREADABLE_TEXT}")
    elif not mail.get("smtp_host"):
        add("smtp", "SMTP", GROUP_LOGIN_MAIL, "/admin/settings/smtp", "missing", "kein Mailserver eingetragen")
    elif provider == "smtp" and enabled:
        add("smtp", "SMTP", GROUP_LOGIN_MAIL, "/admin/settings/smtp", "active", f"Versandweg der Website · {mail.get('smtp_host')}")
    else:
        add("smtp", "SMTP", GROUP_LOGIN_MAIL, "/admin/settings/smtp", "off", "Mailserver gespeichert · Versand läuft über Resend" if provider == "resend" else "Mailserver gespeichert · Versand ausgeschaltet")

    # Plattformen zum Verknüpfen
    for key, spec in PLATFORMS.items():
        to = f"/admin/integrations/{key}"
        if not spec.get("id_field"):
            api_state = _secret_state(branding.get("steam_api_key"))
            if api_state == "unreadable":
                add(key, spec["label"], GROUP_PLATFORMS, to, "unreadable", f"Steam-API-Schlüssel {UNREADABLE_TEXT}")
            else:
                add(key, spec["label"], GROUP_PLATFORMS, to, "active",
                    "Mitglieder können verknüpfen · mit Steam-API-Schlüssel auch der Anzeigename" if api_state == "ok" else "Mitglieder können verknüpfen · ohne Steam-API-Schlüssel nur die SteamID")
            continue
        client_id = str(branding.get(spec["id_field"]) or "").strip()
        secret_state = _secret_state(branding.get(spec["secret_field"]))
        if secret_state == "unreadable":
            add(key, spec["label"], GROUP_PLATFORMS, to, "unreadable", f"Secret {UNREADABLE_TEXT}")
        elif not client_id and secret_state == "missing":
            add(key, spec["label"], GROUP_PLATFORMS, to, "missing", "Client-ID und Secret fehlen")
        elif not client_id:
            add(key, spec["label"], GROUP_PLATFORMS, to, "missing", "Client-ID fehlt")
        elif secret_state == "missing":
            add(key, spec["label"], GROUP_PLATFORMS, to, "missing", "Secret fehlt")
        else:
            add(key, spec["label"], GROUP_PLATFORMS, to, "active", "Mitglieder können verknüpfen")

    # Discord: Meldungen (Webhooks) und Bot
    targets = discord.get("targets") if isinstance(discord.get("targets"), dict) else {}
    webhooks = [discord.get("webhook_url")] + [(entry or {}).get("webhook_url") for entry in targets.values()]
    webhook_states = [_secret_state(url) for url in webhooks if secret_is_configured(url)]
    if "unreadable" in webhook_states:
        add("discord_webhooks", "Discord-Meldungen", GROUP_DISCORD, "/admin/integrations/discord", "unreadable", f"Webhook {UNREADABLE_TEXT}")
    elif not webhook_states:
        add("discord_webhooks", "Discord-Meldungen", GROUP_DISCORD, "/admin/integrations/discord", "missing", "kein Webhook eingetragen")
    else:
        add("discord_webhooks", "Discord-Meldungen", GROUP_DISCORD, "/admin/integrations/discord", "active", f"{len(webhook_states)} Webhook(s)")
    bot_state = _secret_state(discord.get("bot_token"))
    if bot_state == "unreadable":
        add("discord_bot", "Discord-Bot", GROUP_DISCORD, "/admin/integrations/discord", "unreadable", f"Bot-Token {UNREADABLE_TEXT}")
    elif bot_state == "missing":
        add("discord_bot", "Discord-Bot", GROUP_DISCORD, "/admin/integrations/discord", "missing", "kein Bot-Token")
    elif discord.get("bot_enabled"):
        add("discord_bot", "Discord-Bot", GROUP_DISCORD, "/admin/integrations/discord", "active", "Bot läuft")
    else:
        add("discord_bot", "Discord-Bot", GROUP_DISCORD, "/admin/integrations/discord", "off", "Token gespeichert · Bot aus")

    # Weitere Dienste
    analytics = str(branding.get("analytics_provider") or "").strip().lower()
    add("analytics", "Analytics", GROUP_OTHER, "/admin/settings/seo", "active" if analytics else "off",
        {"google": "Google Analytics 4", "plausible": "Plausible"}.get(analytics, "kein Statistikdienst"))
    scan_provider = str(media.get("provider") or "off").strip().lower()
    if scan_provider == "google_vision":
        vision_state = _secret_state(media_raw.get("google_api_key"))
        if vision_state == "unreadable":
            add("media_scan", "Bildprüfung", GROUP_OTHER, "/admin/moderation", "unreadable", f"Google-Schlüssel {UNREADABLE_TEXT}")
        elif vision_state == "missing":
            add("media_scan", "Bildprüfung", GROUP_OTHER, "/admin/moderation", "missing", "Google Cloud Vision gewählt, aber kein Schlüssel")
        else:
            add("media_scan", "Bildprüfung", GROUP_OTHER, "/admin/moderation", "active", "Google Cloud Vision")
    elif scan_provider not in ("", "off"):
        add("media_scan", "Bildprüfung", GROUP_OTHER, "/admin/moderation", "active", f"eigener Server ({scan_provider})")
    else:
        add("media_scan", "Bildprüfung", GROUP_OTHER, "/admin/moderation", "off", "aus")
    doli_state = _secret_state(dolibarr.get("api_key"))
    last_error = sync_state.get("last_error") if isinstance(sync_state.get("last_error"), dict) else None
    if doli_state == "unreadable":
        add("dolibarr", "Dolibarr", GROUP_OTHER, "/admin/dolibarr?tab=connection", "unreadable", f"API-Schlüssel {UNREADABLE_TEXT}")
    elif doli_state == "missing":
        add("dolibarr", "Dolibarr", GROUP_OTHER, "/admin/dolibarr?tab=connection", "missing", "kein API-Schlüssel")
    elif str(dolibarr.get("mode") or "off") == "off":
        add("dolibarr", "Dolibarr", GROUP_OTHER, "/admin/dolibarr?tab=connection", "off", "Modus aus")
    elif last_error:
        add("dolibarr", "Dolibarr", GROUP_OTHER, "/admin/dolibarr?tab=connection", "error", f"letzter Abgleich: {last_error.get('kind') or 'Fehler'} {last_error.get('text') or ''}".strip())
    else:
        add("dolibarr", "Dolibarr", GROUP_OTHER, "/admin/dolibarr?tab=connection", "active", f"Modus {dolibarr.get('mode')}")
    add("play", "Google Play", GROUP_OTHER, "/admin/settings/branding", "active" if str(branding.get("play_store_url") or "").strip() else "missing",
        "Play-Store-Link gesetzt" if str(branding.get("play_store_url") or "").strip() else "kein Play-Store-Link")

    counts = Counter(row["state"] for row in rows)
    return {
        "items": rows,
        "summary": {state: counts.get(state, 0) for state in ("active", "off", "missing", "unreadable", "error")},
        "groups": [GROUP_LOGIN_MAIL, GROUP_PLATFORMS, GROUP_DISCORD, GROUP_OTHER],
    }


@settings_router.get("/site-banner")
async def get_site_banner(response: Response, me: dict | None = Depends(get_optional_user)):
    response.headers["Cache-Control"] = "no-store"
    data = await list_site_banners(response, me)
    first = (data.get("items") or [None])[0]
    if not first:
        return {"enabled": False}
    return first


@settings_router.get("/site-banners")
async def list_site_banners(response: Response, me: dict | None = Depends(get_optional_user), channel: Optional[str] = Query(None)):
    """Aktive Banner; ``?channel=app`` nur die für die App freigegebenen (#245), sonst die der Website."""
    response.headers["Cache-Control"] = "no-store"
    db = get_db()
    manual = await db.site_banners.find({}, {"_id": 0}).sort([("priority", -1), ("updated_at", -1)]).to_list(100)
    # The legacy branding banner is intentionally no longer emitted. The
    # Banner-Manager owns public notice bars from here on.
    all_docs = manual + await _auto_site_banners(db)
    wanted = "app" if channel == "app" else "web"
    active = [doc for doc in all_docs if _banner_active(doc, me) and wanted in banner_channels(doc)]
    stats_rows = await db.site_banner_stats.find({"id": {"$in": [doc["id"] for doc in active if doc.get("id")]}}, {"_id": 0}).to_list(200)
    stats = {row["id"]: row for row in stats_rows}
    items = [_public_banner_doc(doc, stats.get(doc.get("id"))) for doc in active]
    items.sort(key=lambda row: (int(row.get("priority") or 0), row.get("id") or ""), reverse=True)
    return {"items": items[:8]}


@settings_router.get("/site-banners/admin")
async def admin_site_banners(me: dict = Depends(require_area("content"))):
    db = get_db()
    rows = await db.site_banners.find({}, {"_id": 0}).sort([("priority", -1), ("updated_at", -1)]).to_list(200)
    stats_rows = await db.site_banner_stats.find({"id": {"$in": [row["id"] for row in rows if row.get("id")]}}, {"_id": 0}).to_list(200)
    stats = {row["id"]: row for row in stats_rows}
    return [_public_banner_doc(row, stats.get(row.get("id"))) | {
        "starts_at": row.get("starts_at") or "",
        "ends_at": row.get("ends_at") or "",
    } for row in rows]


@settings_router.post("/site-banners/admin")
async def create_site_banner(body: SiteBannerPayload, me: dict = Depends(require_area("content"))):
    db = get_db()
    now = now_utc().isoformat()
    doc = {
        **body.model_dump(),
        "id": new_id(),
        "created_at": now,
        "updated_at": now,
        "created_by": me["id"],
        "source": "manual",
    }
    await db.site_banners.insert_one(doc)
    doc.pop("_id", None)
    return doc


@settings_router.patch("/site-banners/admin/{banner_id}")
@settings_router.put("/site-banners/admin/{banner_id}")
async def update_site_banner(banner_id: str, body: SiteBannerPatch, me: dict = Depends(require_area("content"))):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "Keine Änderungen.")
    updates["updated_at"] = now_utc().isoformat()
    res = await db.site_banners.update_one({"id": banner_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Banner nicht gefunden.")
    return await db.site_banners.find_one({"id": banner_id}, {"_id": 0})


@settings_router.delete("/site-banners/admin/{banner_id}")
async def delete_site_banner(banner_id: str, me: dict = Depends(require_area("content"))):
    db = get_db()
    res = await db.site_banners.delete_one({"id": banner_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Banner nicht gefunden.")
    return {"ok": True}


@settings_router.post("/site-banners/impression")
async def track_site_banner_impression(body: SiteBannerStatBody):
    db = get_db()
    now = now_utc().isoformat()
    await db.site_banner_stats.update_one(
        {"id": body.banner_id},
        {"$inc": {"impressions": 1}, "$set": {"last_impression_at": now}, "$setOnInsert": {"id": body.banner_id}},
        upsert=True,
    )
    return {"ok": True}


@settings_router.post("/site-banners/click")
async def track_site_banner_click(body: SiteBannerStatBody):
    db = get_db()
    now = now_utc().isoformat()
    await db.site_banner_stats.update_one(
        {"id": body.banner_id},
        {"$inc": {"clicks": 1}, "$set": {"last_click_at": now}, "$setOnInsert": {"id": body.banner_id}},
        upsert=True,
    )
    return {"ok": True}


@settings_router.get("/email")
async def get_email_settings(me: dict = Depends(require_club_admin())):
    db = get_db()
    s = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    # Mask the API key
    if s.get("resend_api_key"):
        s["resend_api_key_masked"] = "********"
        s.pop("resend_api_key", None)
    return s


@settings_router.put("/email")
async def update_email_settings(body: EmailSettings, me: dict = Depends(require_club_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    clear_secret = bool(updates.pop("clear_resend_api_key", False))
    unset = {"resend_api_key": ""} if clear_secret else {}
    # Only overwrite api_key if a non-empty value given
    if "resend_api_key" in updates and not updates["resend_api_key"]:
        updates.pop("resend_api_key")
    elif "resend_api_key" in updates:
        updates["resend_api_key"] = encrypt_secret(updates["resend_api_key"])
    current = await db.settings.find_one({"id": "email"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates, unset)
    if not changed_fields:
        return {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    operation = {"$set": updates, "$setOnInsert": {"id": "email"}}
    if unset:
        operation["$unset"] = unset
    await db.settings.update_one({"id": "email"}, operation, upsert=True)
    await _audit_settings_change(db, "settings.email.update", "email", me["id"], changed_fields)
    return {"ok": True, "changed": True}


@settings_router.post("/email/test")
async def send_test(body: TestEmailBody, me: dict = Depends(require_club_admin())):
    res = await send_template("test", body.to, branding="THE LION SQUAD", queue=False)
    return res


@settings_router.post("/newsletter/preview")
async def newsletter_preview(body: NewsletterTriggerBody, me: dict = Depends(require_area("content"))):
    from services.notification_preferences import newsletter_recipients
    item = await _newsletter_source(body.kind, body.id)
    visibility = item.get("visibility") or "public"
    recipients = await newsletter_recipients(visibility)
    return {
        "kind": body.kind,
        "source_id": item.get("id"),
        "title": item.get("title") or item.get("name"),
        "visibility": visibility,
        "already_sent_at": item.get("newsletter_sent_at"),
        "already_sent_count": item.get("newsletter_sent_count") or 0,
        "recipients": len(recipients),
        "sample": [
            {
                "id": u.get("id"),
                "email": u.get("email"),
                "display_name": u.get("display_name") or u.get("username"),
            }
            for u in recipients[:10]
        ],
    }


@settings_router.post("/newsletter/send")
async def newsletter_send(body: NewsletterTriggerBody, me: dict = Depends(require_area("content"))):
    db = get_db()
    from services.notification_preferences import enqueue_newsletter_for_item
    item = await _newsletter_source(body.kind, body.id)
    if item.get("newsletter_sent_at") and not body.force:
        return {
            "ok": True,
            "skipped": True,
            "reason": "already_sent",
            "queued": 0,
            "sent_at": item.get("newsletter_sent_at"),
            "sent_count": item.get("newsletter_sent_count") or 0,
        }
    suffix = f":manual:{now_utc().isoformat()}" if body.force else ""
    result = await enqueue_newsletter_for_item(body.kind, item, dedupe_suffix=suffix)
    queued = int(result.get("queued") or 0)
    collection = db.news_posts if body.kind == "news" else db.events
    await collection.update_one(
        {"id": item.get("id")},
        {"$set": {
            "newsletter_sent_at": now_utc().isoformat(),
            "newsletter_sent_count": queued,
            "newsletter_sent_by": me["id"],
        }},
    )
    await db.audit_logs.insert_one({
        "id": new_id(),
        "action": "newsletter.manual_send",
        "actor_id": me["id"],
        "target_id": item.get("id"),
        "data": {"kind": body.kind, "queued": queued, "force": body.force},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True, **result}


# ---------- Phase 8: SMTP & Mail Queue ----------
class SmtpSettings(BaseModel):
    provider: Optional[Literal["smtp", "resend"]] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    clear_smtp_pass: Optional[bool] = None
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
async def get_smtp_settings(me: dict = Depends(require_club_admin())):
    db = get_db()
    s = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    if s.get("smtp_pass"):
        s["smtp_pass_masked"] = "••••••••"
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
async def update_smtp_settings(body: SmtpSettings, me: dict = Depends(require_club_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    clear_secret = bool(updates.pop("clear_smtp_pass", False))
    unset = {"smtp_pass": ""} if clear_secret else {}
    # Only overwrite password if a non-empty value given
    if "smtp_pass" in updates and not updates["smtp_pass"]:
        updates.pop("smtp_pass")
    elif "smtp_pass" in updates:
        updates["smtp_pass"] = encrypt_secret(updates["smtp_pass"])
    current = await db.settings.find_one({"id": "mail"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates, unset)
    if not changed_fields:
        return {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    operation = {"$set": updates, "$setOnInsert": {"id": "mail"}}
    if unset:
        operation["$unset"] = unset
    await db.settings.update_one({"id": "mail"}, operation, upsert=True)
    await _audit_settings_change(db, "settings.smtp.update", "mail", me["id"], changed_fields)
    return {"ok": True, "changed": True}


@settings_router.post("/smtp/test")
async def smtp_send_test(body: TestEmailBody, me: dict = Depends(require_club_admin())):
    from services.mail_queue import smtp_test
    return await smtp_test(body.to)


@settings_router.post("/smtp/diagnose")
async def smtp_diagnose(body: TestEmailBody, me: dict = Depends(require_club_admin())):
    from services.mail_queue import smtp_diagnose as run_smtp_diagnose
    return await run_smtp_diagnose(body.to)


@settings_router.get("/smtp/deliverability")
async def smtp_deliverability(me: dict = Depends(require_club_admin())):
    from services.mail_queue import smtp_deliverability as run_smtp_deliverability
    return await run_smtp_deliverability()


@settings_router.get("/mail-queue")
async def list_mail_queue(status: Optional[str] = None, limit: int = 100,
                          me: dict = Depends(require_club_admin())):
    db = get_db()
    q = {}
    if status:
        q["status"] = status
    safe_limit = max(1, min(int(limit or 100), 500))
    jobs = await db.mail_jobs.find(q, {"_id": 0, "html": 0}).sort("created_at", -1).to_list(safe_limit)
    return jobs


@settings_router.get("/mail-queue/stats")
async def mail_queue_statistics(me: dict = Depends(require_club_admin())):
    from services.mail_queue import mail_queue_stats
    return await mail_queue_stats()


@settings_router.post("/mail-queue/process")
async def process_queue_now(me: dict = Depends(require_club_admin())):
    from services.mail_queue import process_mail_queue
    return await process_mail_queue(batch=20)


@settings_router.post("/mail-queue/recover")
async def recover_mail_queue(me: dict = Depends(require_club_admin())):
    from services.mail_queue import recover_stale_sending_jobs
    return {"recovered": await recover_stale_sending_jobs()}


@settings_router.post("/mail-queue/retry-failed")
async def retry_failed_mail_jobs(me: dict = Depends(require_club_admin())):
    from services.mail_queue import retry_failed_jobs
    return {"queued": await retry_failed_jobs()}


@settings_router.delete("/mail-queue/cleanup")
async def cleanup_mail_queue(days: int = 30, me: dict = Depends(require_club_admin())):
    from services.mail_queue import cleanup_sent_jobs
    return {"deleted": await cleanup_sent_jobs(days=days)}


@settings_router.post("/mail-queue/{job_id}/retry")
async def retry_mail_job(job_id: str, me: dict = Depends(require_club_admin())):
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
async def delete_mail_job(job_id: str, me: dict = Depends(require_club_admin())):
    db = get_db()
    res = await db.mail_jobs.delete_one({"id": job_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Job nicht gefunden")
    return {"ok": True}


@settings_router.get("/branding")
async def get_branding(response: Response, me: dict = Depends(require_club_admin())):
    """Returns the branding doc, merging in social-default URLs so the admin form
    pre-fills with sensible defaults instead of empty fields."""
    response.headers["Cache-Control"] = "no-store"
    db = get_db()
    saved = (await db.settings.find_one({"id": "branding"}, {"_id": 0})) or {}
    defaults = {
        "site_title": "THE LION SQUAD - eSPORTS",
        "discord_invite_url": "https://discord.com/invite/thelionsquadesports",
        "twitch_channel": "the_lion_squad_esports",
        "whatsapp_channel_url": "https://whatsapp.com/channel/0029VaaWufTGU3BNG6VOxo1I",
        "facebook_url": "https://www.facebook.com/thelionsquadesports",
        "instagram_url": "https://instagram.com/thelionsquadesports",
        "tiktok_url": "https://www.tiktok.com/@thelionsquadesports",
        "youtube_url": "https://www.youtube.com/@TheLionSquadeSports",
    }
    for k, v in defaults.items():
        if not saved.get(k):
            saved[k] = v
    saved["social_links"] = _social_links_from_branding(saved)
    return _hide_branding_secrets(saved)


@settings_router.put("/branding")
async def update_branding(body: BrandingSettings, me: dict = Depends(require_club_admin())):
    db = get_db()
    nullable_fields = set(BrandingSettings.model_fields.keys())
    raw = body.model_dump(exclude_unset=True)
    unset = {}
    for field in BRANDING_SECRET_FIELDS:
        if raw.pop(f"clear_{field}", False):
            unset[field] = ""
    updates = {k: v for k, v in raw.items() if v is not None or k in nullable_fields}
    for field in BRANDING_SECRET_FIELDS:
        if updates.get(field):
            updates[field] = encrypt_secret(updates[field])
        elif field in updates:
            updates.pop(field)   # leer gelassen heißt: das gespeicherte Geheimnis behalten
    _sync_legacy_social_fields(updates)
    current = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates, unset)
    if not changed_fields:
        return current or {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    if set(changed_fields) & PUBLIC_LEGAL_SOURCE_FIELDS:
        updates["legal_updated_at"] = updates["updated_at"]
    operation = {"$set": updates, "$setOnInsert": {"id": "branding"}}
    if unset:
        operation["$unset"] = unset
    await db.settings.update_one({"id": "branding"}, operation, upsert=True)
    if "twitch_client_secret" in unset:
        await db.settings.delete_one({"id": "twitch_app_token"})
    await _audit_settings_change(db, "settings.branding.update", "branding", me["id"], changed_fields)
    saved = await db.settings.find_one({"id": "branding"}, {"_id": 0})
    return _hide_branding_secrets(saved) if saved else {"ok": True}


@settings_router.post("/branding/favicon/universal")
async def generate_universal_favicon(me: dict = Depends(require_club_admin())):
    """Standard-Favicon, das auf hell und dunkel trägt (#229): das weiße Logo auf einem Kreis in der Akzentfarbe.

    Browser ohne Hell/Dunkel-Erkennung und der Home-Bildschirm nehmen nur den Standard; beim Verein
    war das die weiße Fassung. Erzeugt wird aus der dunklen Fassung (Favicon dunkel, Maskottchen,
    dunkles Logo), abgelegt wie ein Upload und als ``favicon_url`` gespeichert."""
    from services import brand_favicon
    from services.image_variants import schedule_variants
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    source = brand_favicon.pick_source(branding)
    path = brand_favicon.asset_path(source)
    if path is None:
        raise HTTPException(400, "Kein Bild für den Kreis gefunden – bitte zuerst ein Favicon für den dunklen Modus oder ein Maskottchen hochladen.")
    try:
        data = brand_favicon.universal_favicon_png(path.read_bytes(), branding.get("primary_color"))
    except Exception as exc:
        raise HTTPException(400, f"Das Bild ließ sich nicht lesen: {exc}")
    url, stored = brand_favicon.store_png(data)
    schedule_variants(stored)
    stamp = now_utc().isoformat()
    await db.media_uploads.insert_one({
        "id": new_id(), "filename": stored.name, "url": url, "size": len(data), "original_size": len(data),
        "width": brand_favicon.SIZE, "height": brand_favicon.SIZE, "original_width": brand_favicon.SIZE, "original_height": brand_favicon.SIZE,
        "original_filename": "favicon-universal.png", "mime": "image/png", "ext": "png", "media_type": "image",
        "owner_id": me.get("id"), "owner_role": me.get("role"), "media_scope": "branding",
        "created_at": stamp, "updated_at": stamp,
    })
    await db.settings.update_one({"id": "branding"}, {"$set": {"favicon_url": url, "updated_at": stamp}, "$setOnInsert": {"id": "branding"}}, upsert=True)
    await _audit_settings_change(db, "settings.branding.update", "branding", me["id"], ["favicon_url"])
    return {"favicon_url": url, "source": source, "color": branding.get("primary_color") or "#29B6E8"}


@settings_router.get("/auth")
async def get_auth_settings(response: Response, me: dict = Depends(require_super())):
    """Central login & Google configuration for the admin area."""
    response.headers["Cache-Control"] = "no-store"
    db = get_db()
    return await load_auth_settings(db)


@settings_router.put("/auth")
async def update_auth_settings(body: AuthSettings, me: dict = Depends(require_super())):
    db = get_db()
    raw = body.model_dump(exclude_unset=True)
    updates = {k: v for k, v in raw.items() if isinstance(v, bool)}
    if "google_client_id" in raw:
        client_id = str(raw.get("google_client_id") or "").strip()
        if client_id and not is_google_client_id(client_id):
            raise HTTPException(400, "Ungültige Google Web Client ID.")
        updates["google_client_id"] = client_id
        if not client_id:
            updates.update({
                "google_login_enabled": False,
                "google_registration_enabled": False,
                "google_linking_enabled": False,
            })
    if not updates:
        return await load_auth_settings(db)
    current = await db.settings.find_one({"id": "auth"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates)
    if not changed_fields:
        return await load_auth_settings(db)
    updates["updated_at"] = now_utc().isoformat()
    await db.settings.update_one(
        {"id": "auth"}, {"$set": updates, "$setOnInsert": {"id": "auth"}}, upsert=True,
    )
    await _audit_settings_change(db, "settings.auth.update", "auth", me["id"], changed_fields)
    return await load_auth_settings(db)


@settings_router.post("/auth/google/test")
async def test_google_auth_settings(me: dict = Depends(require_super())):
    """Validate the stored client shape and Google's discovery availability."""
    db = get_db()
    settings = await load_auth_settings(db)
    if not settings["google_configured"]:
        raise HTTPException(400, "Bitte zuerst eine gültige Google Web Client ID speichern.")
    provider_available = False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get("https://accounts.google.com/.well-known/openid-configuration")
            provider_available = response.status_code == 200 and bool(response.json().get("jwks_uri"))
    except (httpx.HTTPError, ValueError):
        provider_available = False
    return {
        "ok": provider_available,
        "configured": True,
        "provider_available": provider_available,
        "expected_origin": os.environ.get("FRONTEND_URL", "").rstrip("/"),
        "message": "Google ist erreichbar. Bitte den Anmeldebutton zusätzlich mit einem Testkonto prüfen." if provider_available else "Google ist derzeit nicht erreichbar.",
    }


@settings_router.post("/indexnow/submit")
async def submit_indexnow(body: IndexNowSubmitBody, me: dict = Depends(require_club_admin())):
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    key = (branding.get("indexnow_key") or "").strip()
    if not key:
        raise HTTPException(400, "IndexNow-Key fehlt. Bitte im Branding hinterlegen.")
    domain = (branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if not domain.startswith(("http://", "https://")):
        domain = "https://" + domain
    host = domain.replace("https://", "").replace("http://", "").split("/")[0]
    urls = body.urls or [domain, f"{domain}/sitemap.xml"]
    urls = [u if str(u).startswith(("http://", "https://")) else f"{domain}/{str(u).lstrip('/')}" for u in urls]
    payload = {
        "host": host,
        "key": key,
        "keyLocation": f"{domain}/indexnow-key.txt",
        "urlList": urls[:100],
    }
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post("https://api.indexnow.org/indexnow", json=payload)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"IndexNow fehlgeschlagen: {r.text[:300]}")
    return {"ok": True, "submitted": len(payload["urlList"]), "status": r.status_code}


@settings_router.get("/indexnow-key.txt")
async def indexnow_key_file():
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    key = (branding.get("indexnow_key") or "").strip()
    if not key:
        raise HTTPException(404, "IndexNow-Key nicht gesetzt")
    return Response(content=key, media_type="text/plain")


@settings_router.get("/email/logs")
async def email_logs(me: dict = Depends(require_club_admin())):
    db = get_db()
    return await db.email_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


# ---- Discord webhook ----
@settings_router.get("/discord")
async def get_discord(me: dict = Depends(require_club_admin())):
    db = get_db()
    s = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    s["configured"] = bool(s.get("webhook_url"))
    if s.get("webhook_url"):
        s["webhook_url_masked"] = "https://discord.com/api/webhooks/…"
        s.pop("webhook_url", None)
    s["ops_configured"] = bool(s.get("ops_webhook_url"))
    if s.get("ops_webhook_url"):
        s["ops_webhook_url_masked"] = "https://discord.com/api/webhooks/…"
        s.pop("ops_webhook_url", None)
    # Ziele und Schalter (#300). Eine Webhook-Adresse verlässt den Server nie.
    from discord_service import EVENTS, EXTRA_TARGETS, event_enabled, event_field, target_status
    stored_targets = s.pop("targets", None) or {}
    s["targets"] = {
        name: {"configured": bool((stored_targets.get(name) or {}).get("webhook_url")),
               "username": (stored_targets.get(name) or {}).get("username") or ""}
        for name in EXTRA_TARGETS
    }
    stored_events = s.get("events") or {}
    switches = {key: stored_events.get(event_field(key)) for key in EVENTS}
    s["events"] = [
        {"key": key, "label": spec["label"], "target": spec["target"], "enabled": event_enabled({"events": switches}, key)}
        for key, spec in EVENTS.items()
    ]
    s["target_status"] = await target_status(db)
    # Discord-Bot (#302): Stand ohne Token.
    from services import discord_bot
    s["bot"] = {**discord_bot.bot_settings(s), **await discord_bot.read_state(db), **discord_bot.bot.status()}
    for key in ("bot_token", "bot_enabled", "bot_guild_id", "bot_roles", "bot_count_messages"):
        s.pop(key, None)
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
async def update_discord(body: DiscordSettings, me: dict = Depends(require_club_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    from discord_service import is_valid_discord_webhook_url
    unset = {}
    if updates.pop("clear_webhook", False):
        unset["webhook_url"] = ""
    if updates.pop("clear_ops_webhook", False):
        unset["ops_webhook_url"] = ""
    for field in ("webhook_url", "ops_webhook_url"):
        if field in updates:
            updates[field] = str(updates[field]).strip()
            if not updates[field]:
                updates.pop(field)
                continue
            if not is_valid_discord_webhook_url(updates[field]):
                raise HTTPException(400, "Ungültige Discord Webhook URL. Erlaubt sind https://discord.com/api/webhooks/... URLs.")
            updates[field] = encrypt_secret(updates[field])
    for key in ("username", "avatar_url"):
        if key in updates and isinstance(updates[key], str):
            updates[key] = updates[key].strip()
    # Discord-Bot (#302): Token nur, wenn neu eingetippt; Rollennamen nur die drei bekannten.
    from services.discord_bot import ROLE_KEYS
    if updates.pop("clear_bot_token", False):
        unset["bot_token"] = ""
    if "bot_token" in updates:
        token = str(updates.pop("bot_token") or "").strip()
        if token:
            if len(token) < 40 or " " in token:
                raise HTTPException(400, "Das sieht nicht nach einem Bot-Token aus (Developer Portal → Bot → Reset Token).")
            updates["bot_token"] = encrypt_secret(token)
    if "bot_guild_id" in updates:
        guild_id = str(updates["bot_guild_id"] or "").strip()
        if guild_id and not guild_id.isdigit():
            raise HTTPException(400, "Die Server-ID ist eine Zahl (Discord: Server → Rechtsklick → ID kopieren, Entwicklermodus).")
        updates["bot_guild_id"] = guild_id
    if "bot_roles" in updates:
        roles = updates.pop("bot_roles") or {}
        for key, value in roles.items():
            if key not in ROLE_KEYS:
                raise HTTPException(400, f"Unbekannte Rolle: {key}")
            updates[f"bot_roles.{key}"] = str(value or "").strip()[:100]
    current = await db.settings.find_one({"id": "discord"}, {"_id": 0}) or {}
    from discord_service import EVENTS, EXTRA_TARGETS, event_field
    incoming_targets = updates.pop("targets", None)
    if incoming_targets is not None:
        for name, entry in incoming_targets.items():
            if name not in EXTRA_TARGETS or not isinstance(entry, dict):
                raise HTTPException(400, f"Unbekanntes Discord-Ziel: {name}")
            if entry.get("clear"):
                unset[f"targets.{name}.webhook_url"] = ""
            elif str(entry.get("webhook_url") or "").strip():
                url = str(entry["webhook_url"]).strip()
                if not is_valid_discord_webhook_url(url):
                    raise HTTPException(400, "Ungültige Discord Webhook URL. Erlaubt sind https://discord.com/api/webhooks/... URLs.")
                updates[f"targets.{name}.webhook_url"] = encrypt_secret(url)
            if "username" in entry:
                updates[f"targets.{name}.username"] = str(entry.get("username") or "").strip()[:80]
    incoming_events = updates.pop("events", None)
    if incoming_events is not None:
        for key, value in incoming_events.items():
            if key not in EVENTS:
                raise HTTPException(400, f"Unbekanntes Discord-Ereignis: {key}")
            updates[f"events.{event_field(key)}"] = bool(value)
    flat_current = dict(current)
    for name, entry in (current.get("targets") or {}).items():
        for field, value in (entry or {}).items():
            flat_current[f"targets.{name}.{field}"] = value
    for key, value in (current.get("events") or {}).items():
        flat_current[f"events.{key}"] = value
    for key, value in (current.get("bot_roles") or {}).items():
        flat_current[f"bot_roles.{key}"] = value
    current = flat_current
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
    # Bot-Einstellungen geändert (#302): neu verbinden oder anhalten - ohne Neustart des Servers.
    if any(field.startswith("bot_") for field in changed_fields):
        try:
            from services.discord_bot import bot as discord_bot
            await discord_bot.apply_settings()
        except Exception as exc:
            logging.getLogger("tls.discord.bot").warning("[discord-bot] Neustart nach Einstellung: %s", exc)
    return {"ok": True, "changed": True}


# ---- AMP-Panel ----
@settings_router.get("/amp")
async def get_amp(me: dict = Depends(require_club_admin())):
    db = get_db()
    settings = await db.settings.find_one({"id": "amp"}, {"_id": 0}) or {}
    # Das Passwort verlässt den Server nie; die Oberfläche braucht nur zu
    # wissen, ob eines hinterlegt ist.
    settings["configured"] = secret_is_configured(settings.get("password"))
    settings.pop("password", None)
    return settings


@settings_router.put("/amp")
async def update_amp(body: AmpSettings, me: dict = Depends(require_club_admin())):
    db = get_db()
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    clear_password = bool(updates.pop("clear_password", False))
    unset = {"password": ""} if clear_password else {}

    for key in ("base_url", "username"):
        if key in updates and isinstance(updates[key], str):
            updates[key] = updates[key].strip()
    if updates.get("base_url") and not updates["base_url"].lower().startswith("https://"):
        raise HTTPException(400, "Die AMP-Adresse muss mit https:// beginnen; über http würden Zugangsdaten offen übertragen.")
    if "password" in updates:
        password = str(updates["password"]).strip()
        if password:
            updates["password"] = encrypt_secret(password)
        else:
            updates.pop("password")

    current = await db.settings.find_one({"id": "amp"}, {"_id": 0}) or {}
    changed_fields = _changed_setting_fields(current, updates, unset)
    if not changed_fields:
        return {"ok": True, "changed": False}
    updates["updated_at"] = now_utc().isoformat()
    op = {"$set": updates, "$setOnInsert": {"id": "amp"}}
    if unset:
        op["$unset"] = unset
    await db.settings.update_one({"id": "amp"}, op, upsert=True)
    await _audit_settings_change(db, "settings.amp.update", "amp", me["id"], changed_fields)
    return {"ok": True, "changed": True}


@settings_router.post("/amp/test")
async def amp_test(me: dict = Depends(require_club_admin())):
    """Melden, ob die Anmeldung klappt und welche Instanzen das Panel kennt."""
    from services.amp_settings import load_amp_settings
    from services.amp_client import AmpClient, AmpError

    settings = await load_amp_settings()
    if not settings:
        return {"ok": False, "error": "AMP ist nicht konfiguriert."}
    try:
        async with AmpClient(settings["base_url"], settings["username"], settings["password"]) as client:
            instances = await client.instances()
    except AmpError as exc:
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "instance_count": len(instances),
        "instances": [
            {
                "id": item.get("InstanceID"),
                "name": item.get("FriendlyName") or item.get("InstanceName"),
                "running": bool(item.get("Running")),
            }
            for item in instances
        ],
    }


@settings_router.post("/discord/preview")
async def discord_preview(body: dict, me: dict = Depends(require_area("content", "tournaments", "system"))):
    """So sieht die Meldung aus (#303) - dasselbe Embed wie beim Senden, plus ob und wohin es ginge."""
    from services.discord_announcements import preview
    kind = body.get("kind")
    if kind not in ("news", "event") or not isinstance(body.get("item"), dict):
        raise HTTPException(400, "kind ist „news“ oder „event“, item das Formular.")
    return await preview(kind, body["item"])


@settings_router.post("/discord/resend/{log_id}")
async def discord_resend(log_id: str, me: dict = Depends(require_club_admin())):
    """Eine fehlgeschlagene Meldung noch einmal an dasselbe Ziel (#303)."""
    from discord_service import send_to
    db = get_db()
    entry = await db.email_logs.find_one({"id": log_id, "channel": "discord"}, {"_id": 0})
    if not entry or not entry.get("payload"):
        raise HTTPException(404, "Diese Meldung lässt sich nicht erneut senden.")
    if entry.get("status") != "failed":
        raise HTTPException(409, "Nur fehlgeschlagene Meldungen lassen sich erneut senden.")
    payload = entry["payload"]
    # An das Ziel, an das sie ging - nie an ein anderes. Privat bleibt privat.
    result = await send_to(entry.get("target") or "community", payload.get("title") or "", payload.get("description") or "",
                           color=payload.get("color") or 0x29B6E8, url=payload.get("url"), fields=payload.get("fields"),
                           image_url=payload.get("image_url"), event_key=entry.get("event_key") or "custom")
    if result.get("ok"):
        await db.email_logs.update_one({"id": log_id}, {"$set": {"status": "resent", "resent_at": now_utc().isoformat()}})
    return result


@settings_router.post("/discord/test")
async def discord_test(target: str = Query(default="community", pattern="^(community|news|events|achievements|board|ops)$"), me: dict = Depends(require_club_admin())):
    from discord_service import TARGET_LABELS, send_discord, send_ops_discord, send_to
    if target not in ("community", "ops"):
        return await send_to(
            target, f"{TARGET_LABELS[target]} · Testnachricht",
            "Diese Nachricht bestätigt, dass der Webhook für dieses Ziel funktioniert."
            + (" Hierher kommen Mitgliedsanträge und Kontaktanfragen – ohne Namen." if target == "board" else ""),
            event_key="test",
        )
    if target == "ops":
        return await send_ops_discord(
            "Betrieb · Testnachricht",
            "Diese Nachricht bestätigt, dass der Betriebs-Webhook funktioniert. Hierher kommen rote Auto-Checks und neue Serverfehler - sonst nichts.",
            event_key="test",
        )
    res = await send_discord(
        "THE LION SQUAD · Testnachricht",
        "Diese Nachricht bestätigt, dass dein Discord-Webhook korrekt funktioniert. 🦁",
        event_key="test",
    )
    return res
