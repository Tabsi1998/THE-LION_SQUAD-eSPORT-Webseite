"""Discord webhook notifications. Reads webhook URL from settings 'discord' doc.
Silent failure if not configured."""
import asyncio
import logging
import httpx
from database import get_db
from models import now_utc, new_id

logger = logging.getLogger("tls-arena.discord")


async def _get_discord_config() -> dict:
    db = get_db()
    s = await db.settings.find_one({"id": "discord"}) or {}
    return {
        "webhook_url": s.get("webhook_url") or "",
        "enabled": bool(s.get("enabled", True) and s.get("webhook_url")),
        "username": s.get("username") or "TLS ARENA",
        "avatar_url": s.get("avatar_url") or None,
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
        return {"ok": False, "reason": "disabled"}

    embed = {"title": title[:256], "description": description[:4000], "color": color}
    if url: embed["url"] = url
    if fields: embed["fields"] = [{"name": f["name"][:256], "value": str(f["value"])[:1024], "inline": f.get("inline", True)} for f in fields[:10]]
    payload = {"embeds": [embed]}
    if cfg["username"]: payload["username"] = cfg["username"]
    if cfg["avatar_url"]: payload["avatar_url"] = cfg["avatar_url"]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(cfg["webhook_url"], json=payload)
        if r.status_code >= 400:
            log["status"] = "failed"
            log["error"] = f"{r.status_code} {r.text[:200]}"
        else:
            log["status"] = "sent"
        await db.email_logs.insert_one(log)
        return {"ok": log["status"] == "sent"}
    except Exception as e:
        logger.error(f"[discord] {e}")
        log["status"] = "failed"
        log["error"] = str(e)[:300]
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": str(e)}
