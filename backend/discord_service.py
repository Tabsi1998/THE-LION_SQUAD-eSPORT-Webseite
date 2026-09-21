"""Discord webhook notifications. Reads webhook URLs from settings 'discord' doc.
Silent failure if not configured.

Ein Webhook je Zweck (#300). Öffentliche Ziele - ``news``, ``events``,
``achievements`` - fallen ohne eigenen Webhook auf ``community`` zurück. Private
Ziele - ``board`` (Vorstand) und ``ops`` (Betrieb, #265) - fallen **nie**
zurück: fehlt ihr Webhook, wird nichts gesendet. Und was nur Mitglieder oder
der Vorstand sehen dürfen, geht nie an ein öffentliches Ziel, egal welcher
Schalter an ist. Beides entscheidet ``send_event`` an einer Stelle.
"""
import logging
import os
import httpx
from urllib.parse import urlparse
from database import get_db
from models import now_utc, new_id
from services.secret_store import decrypt_secret

logger = logging.getLogger("tls-arena.discord")
VALID_WEBHOOK_HOSTS = {"discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"}
PRIVATE_DISCORD_VISIBILITIES = {"members", "internal"}
OPS_BOT_NAME = "LION Betrieb"
BOARD_BOT_NAME = "LION Vorstand"

PUBLIC_TARGETS = ("community", "news", "events", "achievements")
PRIVATE_TARGETS = ("board", "ops")
TARGETS = PUBLIC_TARGETS + PRIVATE_TARGETS
# Ziele mit eigenem Eintrag unter settings.discord.targets; Community und
# Betrieb behalten ihre Felder von früher (webhook_url, ops_webhook_url).
EXTRA_TARGETS = ("news", "events", "achievements", "board")
TARGET_LABELS = {
    "community": "Community (Standard)", "news": "News", "events": "Events und Turniere",
    "achievements": "Erfolge", "board": "Vorstand (privat)", "ops": "Betrieb (privat)",
}
# Ereignis → Ziel, Beschriftung, Standard. Neue Ereignisse sind aus, bis der
# Betreiber sie einschaltet; was es vor #300 schon gab, bleibt an.
EVENTS = {
    "news.published": {"target": "news", "label": "News veröffentlicht", "default": False},
    "event.announced": {"target": "events", "label": "Event angekündigt", "default": False},
    "tournament.registration_open": {"target": "events", "label": "Turnier: Anmeldung offen", "default": True},
    "tournament.live": {"target": "events", "label": "Turnier: jetzt live", "default": True},
    "tournament.completed": {"target": "events", "label": "Turnier: beendet", "default": True},
    "tournament.results_published": {"target": "events", "label": "Turnier: Ergebnisse veröffentlicht", "default": True},
    "f1.new_leader": {"target": "events", "label": "Fast Lap: neue Bestzeit", "default": True},
    "achievement.awarded": {"target": "achievements", "label": "Erfolg freigeschaltet", "default": True},
    "membership.application": {"target": "board", "label": "Neuer Mitgliedsantrag", "default": False},
    "contact.request": {"target": "board", "label": "Neue Kontaktanfrage", "default": False},
}


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
    webhook_url = decrypt_secret(s.get("webhook_url")).strip()
    ops_webhook_url = decrypt_secret(s.get("ops_webhook_url")).strip()
    targets = {}
    for name, entry in (s.get("targets") or {}).items():
        if name in EXTRA_TARGETS and isinstance(entry, dict):
            targets[name] = {
                "webhook_url": decrypt_secret(entry.get("webhook_url")).strip(),
                "username": (entry.get("username") or "").strip(),
            }
    return {
        "webhook_url": webhook_url,
        "ops_webhook_url": ops_webhook_url,
        "master": bool(s.get("enabled", True)),
        "enabled": bool(s.get("enabled", True) and webhook_url),
        "ops_enabled": bool(s.get("enabled", True) and ops_webhook_url),
        "username": s.get("username") or "THE LION SQUAD",
        "avatar_url": await _public_avatar_url(s.get("avatar_url")),
        "targets": targets,
        "events": s.get("events") or {},
    }


def event_enabled(cfg: dict, event_key: str) -> bool:
    spec = EVENTS.get(event_key)
    if not spec:
        return True
    value = (cfg.get("events") or {}).get(event_key)
    return bool(spec["default"] if value is None else value)


def resolve_target(cfg: dict, target: str) -> dict:
    """Webhook, Name und tatsächliches Ziel. Privat fällt nie zurück - auch nicht auf ein anderes privates Ziel."""
    if target not in TARGETS:
        target = "community"
    if target == "ops":
        return {"target": "ops", "webhook_url": cfg.get("ops_webhook_url") or "", "username": OPS_BOT_NAME, "fallback": False}
    if target == "board":
        entry = (cfg.get("targets") or {}).get("board") or {}
        return {"target": "board", "webhook_url": entry.get("webhook_url") or "",
                "username": entry.get("username") or BOARD_BOT_NAME, "fallback": False}
    entry = (cfg.get("targets") or {}).get(target) or {}
    if target != "community" and entry.get("webhook_url"):
        return {"target": target, "webhook_url": entry["webhook_url"],
                "username": entry.get("username") or cfg.get("username"), "fallback": False}
    return {"target": "community", "webhook_url": cfg.get("webhook_url") or "",
            "username": cfg.get("username"), "fallback": target != "community"}


async def build_embed(title: str, description: str = "", *, color: int = 0x29B6E8, url: str | None = None,
                      fields: list | None = None, image_url: str | None = None) -> dict:
    """Das Embed, wie Discord es bekommt - auch die Vorschau im Admin baut es hiermit (#303)."""
    embed = {"title": title[:256], "description": (description or "")[:4000], "color": color}
    embed_url = await _public_link_url(url)
    if embed_url:
        embed["url"] = embed_url
    if fields:
        embed["fields"] = [{"name": str(f["name"])[:256], "value": str(f["value"])[:1024], "inline": f.get("inline", True)} for f in fields[:10]]
    image = await _public_avatar_url(image_url)
    if image:
        embed["image"] = {"url": image}
    return embed


async def _post_embed(webhook_url: str, *, username: str | None, avatar_url: str | None,
                      title: str, description: str, color: int, url: str | None,
                      fields: list | None, log: dict, image_url: str | None = None) -> dict:
    """Ein Embed an genau diesen Webhook; das Log landet in email_logs."""
    db = get_db()
    embed = await build_embed(title, description, color=color, url=url, fields=fields, image_url=image_url)
    payload = {"embeds": [embed]}
    if username:
        payload["username"] = username
    if _is_public_http_url(avatar_url):
        payload["avatar_url"] = avatar_url
    # Für „erneut senden“ (#303): was gesendet werden sollte - ohne die Adresse des Webhooks.
    log["payload"] = {"title": title[:256], "description": (description or "")[:4000], "color": color, "url": url,
                      "fields": (fields or [])[:10], "image_url": image_url}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(webhook_url, json=payload)
            if r.status_code == 400 and "avatar_url" in payload and "avatar_url" in r.text:
                payload.pop("avatar_url", None)
                r = await client.post(webhook_url, json=payload)
        log["status_code"] = r.status_code
        if r.status_code >= 400:
            log["status"] = "failed"
            log["error"] = f"{r.status_code} {r.text[:200]}"
        else:
            log["status"] = "sent"
        await db.email_logs.insert_one(log)
        return {"ok": log["status"] == "sent", "status_code": r.status_code, "error": log["error"], "target": log.get("target")}
    except Exception as e:
        logger.error(f"[discord] {type(e).__name__}")
        log["status"] = "failed"
        log["error"] = type(e).__name__
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": type(e).__name__, "target": log.get("target")}


def _new_log(event_key: str, title: str, target: str) -> dict:
    return {
        "id": new_id(), "channel": "discord", "target": target, "event_key": event_key,
        "title": title, "status": "skipped", "error": None,
        "created_at": now_utc().isoformat(),
    }


async def send_to(target: str, title: str, description: str = "", *, color: int = 0x29B6E8, url: str = None,
                  fields: list = None, image_url: str = None, event_key: str = "custom") -> dict:
    """An ein Ziel senden. Öffentliche Ziele fallen auf Community zurück, private nie."""
    db = get_db()
    cfg = await _get_discord_config()
    resolved = resolve_target(cfg, target)
    log = _new_log(event_key, title, resolved["target"])
    if resolved["fallback"]:
        log["wanted_target"] = target
    if not cfg["master"] or not resolved["webhook_url"]:
        private = resolved["target"] in PRIVATE_TARGETS
        log["error"] = "Discord ist ausgeschaltet" if not cfg["master"] else (
            f"Discord {resolved['target']} webhook not configured" if private else "Discord webhook not configured")
        await db.email_logs.insert_one(log)
        reason = "disabled" if not cfg["master"] or not private else f"{resolved['target']}_webhook_missing"
        return {"ok": False, "reason": reason, "error": log["error"], "target": resolved["target"]}
    if not is_valid_discord_webhook_url(resolved["webhook_url"]):
        log["status"] = "failed"
        log["error"] = "Invalid Discord webhook URL"
        await db.email_logs.insert_one(log)
        return {"ok": False, "reason": "invalid_webhook_url", "error": log["error"], "target": resolved["target"]}
    return await _post_embed(
        resolved["webhook_url"], username=resolved["username"], avatar_url=cfg.get("avatar_url"),
        title=title, description=description, color=color, url=url, fields=fields, image_url=image_url, log=log,
    )


async def send_event(event_key: str, title: str, description: str = "", *, item: dict | None = None,
                     color: int = 0x29B6E8, url: str = None, fields: list = None, image_url: str = None) -> dict:
    """Ein benanntes Ereignis melden: Schalter, Ziel und die Grenze „privat nie öffentlich“ an einer Stelle."""
    spec = EVENTS.get(event_key) or {"target": "community"}
    if spec["target"] in PUBLIC_TARGETS and item is not None and not should_post_to_public_discord(item):
        return {"ok": False, "reason": "private_visibility"}
    cfg = await _get_discord_config()
    if not event_enabled(cfg, event_key):
        return {"ok": False, "reason": "event_disabled"}
    return await send_to(spec["target"], title, description, color=color, url=url, fields=fields,
                         image_url=image_url, event_key=event_key)


async def send_discord(title: str, description: str = "", *,
                       color: int = 0x29B6E8, url: str = None,
                       fields: list = None, event_key: str = "custom") -> dict:
    """Send an embed to the community Discord webhook."""
    return await send_to("community", title, description, color=color, url=url, fields=fields, event_key=event_key)


async def send_ops_discord(title: str, description: str = "", *,
                           color: int = 0xFF3B30, url: str = None,
                           fields: list = None, event_key: str = "ops") -> dict:
    """Send an embed to the operations webhook only - never to the community channel (#265)."""
    return await send_to("ops", title, description, color=color, url=url, fields=fields, event_key=event_key)


async def send_public_discord(item: dict | None, title: str, description: str = "", *,
                              color: int = 0x29B6E8, url: str = None,
                              fields: list = None, event_key: str = "custom", image_url: str = None) -> dict:
    """Send to a public Discord target only for publicly visible content."""
    if not should_post_to_public_discord(item):
        return {"ok": False, "reason": "private_visibility"}
    if event_key in EVENTS:
        return await send_event(event_key, title, description, item=item, color=color, url=url,
                                fields=fields, image_url=image_url)
    return await send_discord(title, description, color=color, url=url, fields=fields, event_key=event_key)


async def target_status(db=None) -> dict:
    """Je Ziel: eingerichtet, wohin es wirklich geht, letzter Versuch."""
    db = db if db is not None else get_db()
    cfg = await _get_discord_config()
    status = {}
    for target in TARGETS:
        resolved = resolve_target(cfg, target)
        own = not resolved["fallback"] and bool(resolved["webhook_url"])
        last = await db.email_logs.find_one(
            {"channel": "discord", "target": target, "status": {"$in": ["sent", "failed"]}},
            {"_id": 0, "status": 1, "status_code": 1, "error": 1, "event_key": 1, "created_at": 1},
            sort=[("created_at", -1)],
        )
        status[target] = {
            "label": TARGET_LABELS[target], "private": target in PRIVATE_TARGETS, "configured": own,
            "delivers_to": resolved["target"] if resolved["webhook_url"] else None, "last": last,
        }
    return status


async def broken_targets(db=None) -> list[dict]:
    """Ziele, deren letzter Versuch an einem kaputten Webhook scheiterte (401/403/404) - für die Tageszentrale (#303)."""
    broken = []
    for target, entry in (await target_status(db)).items():
        last = entry.get("last") or {}
        if entry["configured"] and last.get("status") == "failed" and last.get("status_code") in (401, 403, 404):
            broken.append({"target": target, "label": entry["label"], "status_code": last.get("status_code"), "at": last.get("created_at")})
    return broken
