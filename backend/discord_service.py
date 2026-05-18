"""Discord webhook notifications. Reads webhook URL from settings 'discord' doc.
Silent failure if not configured."""
import asyncio
import logging
import os
import httpx
from urllib.parse import urlparse
from database import get_db
from models import now_utc, new_id

logger = logging.getLogger("tls-arena.discord")
VALID_WEBHOOK_HOSTS = {"discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"}
PRIVATE_DISCORD_VISIBILITIES = {"members", "internal"}


def is_valid_discord_webhook_url(url: str) -> bool:
    parsed = urlparse((url or "").strip())
    if parsed.scheme != "https" or parsed.netloc.lower() not in VALID_WEBHOOK_HOSTS:
        return False
    parts = [p for p in parsed.path.split("/") if p]
    return len(parts) >= 4 and parts[0] == "api" and parts[1] == "webhooks"


def should_post_to_public_discord(item: dict | None) -> bool:
    """Return whether a content object is safe for the public Discord webhook."""
    item = item or {}
    if item.get("is_public") is False:
        return False
    return (item.get("visibility") or "public") not in PRIVATE_DISCORD_VISIBILITIES


def _normalize_base_url(value: str | None) -> str:
    base = (value or "").strip().rstrip("/")
    if not base:
        return ""
    if not base.startswith(("http://", "https://")):
        base = f"https://{base}"
    parsed = urlparse(base)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    if parsed.path.rstrip("/") == "/api":
        base = f"{parsed.scheme}://{parsed.netloc}"
    return base


async def _public_base_url() -> str:
    env_base = _normalize_base_url(
        os.getenv("PUBLIC_BACKEND_URL")
        or os.getenv("PUBLIC_BASE_URL")
        or os.getenv("FRONTEND_URL")
        or os.getenv("PUBLIC_URL")
    )
    if env_base:
        return env_base
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    return _normalize_base_url(branding.get("domain")) or "https://lionsquad.at"


def _is_public_http_url(value: str | None) -> bool:
    parsed = urlparse((value or "").strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


async def _public_avatar_url(value: str | None) -> str | None:
    avatar_url = (value or "").strip()
    if not avatar_url:
        return None
    parsed = urlparse(avatar_url)
    if _is_public_http_url(avatar_url):
        return avatar_url
    if parsed.scheme:
        return None
    base = await _public_base_url()
    if not base:
        return None
    raw_path = avatar_url.lstrip("/")
    if raw_path.startswith("api/static/"):
        path = f"/{raw_path}"
    elif raw_path.startswith("uploads/"):
        path = f"/api/static/{raw_path}"
    else:
        path = f"/api/static/uploads/{raw_path}"
    candidate = f"{base}{path}"
    return candidate if _is_public_http_url(candidate) else None


async def _public_link_url(value: str | None) -> str | None:
    link = (value or "").strip()
    if not link:
        return None
    if _is_public_http_url(link):
        return link
    if urlparse(link).scheme:
        return None
    base = await _public_base_url()
    return f"{base}/{link.lstrip('/')}" if base else None


async def _get_discord_config() -> dict:
    db = get_db()
    s = await db.settings.find_one({"id": "discord"}) or {}
    webhook_url = (s.get("webhook_url") or "").strip()
    return {
        "webhook_url": webhook_url,
        "enabled": bool(s.get("enabled", True) and webhook_url),
        "username": s.get("username") or "THE LION SQUAD",
        "avatar_url": await _public_avatar_url(s.get("avatar_url")),
    }


async def send_discord(title: str, description: str = "", *,
                       color: int = 0x29B6E8, url: str = None,
                       fields: list = None, event_key: str = "custom") -> dict:
    """Send an embed to the configured Discord webhook."""
    db = get_db()
    cfg = await _get_discord_config()
    log = {
        "id": new_id(), "channel": "discord", "event_key": event_key,
        "title": title, "status": "skipped", "error": None,
        "created_at": now_utc().isoformat(),
    }
    if not cfg["enabled"]:
        log["error"] = "Discord webhook not configured"
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": "disabled", "error": log["error"]}
    if not is_valid_discord_webhook_url(cfg["webhook_url"]):
        log["status"] = "failed"
        log["error"] = "Invalid Discord webhook URL"
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": "invalid_webhook_url", "error": log["error"]}

    embed = {"title": title[:256], "description": description[:4000], "color": color}
    embed_url = await _public_link_url(url)
    if embed_url: embed["url"] = embed_url
    if fields: embed["fields"] = [{"name": f["name"][:256], "value": str(f["value"])[:1024], "inline": f.get("inline", True)} for f in fields[:10]]
    payload = {"embeds": [embed]}
    if cfg["username"]: payload["username"] = cfg["username"]
    if _is_public_http_url(cfg.get("avatar_url")):
        payload["avatar_url"] = cfg["avatar_url"]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(cfg["webhook_url"], json=payload)
            if r.status_code == 400 and "avatar_url" in payload and "avatar_url" in r.text:
                payload.pop("avatar_url", None)
                r = await client.post(cfg["webhook_url"], json=payload)
        if r.status_code >= 400:
            log["status"] = "failed"
            log["error"] = f"{r.status_code} {r.text[:200]}"
        else:
            log["status"] = "sent"
        await db.email_logs.insert_one(log)
        return {
            "ok": log["status"] == "sent",
            "status_code": r.status_code,
            "error": log["error"],
        }
    except Exception as e:
        logger.error(f"[discord] {e}")
        log["status"] = "failed"
        log["error"] = str(e)[:300]
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": str(e)}


async def send_public_discord(item: dict | None, title: str, description: str = "", *,
                              color: int = 0x29B6E8, url: str = None,
                              fields: list = None, event_key: str = "custom") -> dict:
    """Send to the public Discord webhook only for publicly visible content."""
    if not should_post_to_public_discord(item):
        return {"ok": False, "reason": "private_visibility"}
    return await send_discord(title, description, color=color, url=url, fields=fields, event_key=event_key)
