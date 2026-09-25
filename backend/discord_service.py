"""Discord-Meldungen - über den Bot (#566).

Seit Discord III schickt die Website alles über den Vereins-Bot: je Ziel ein Kanal aus
``settings.discord.channels`` statt einer Webhook-Adresse. Öffentliche Ziele - ``news``,
``events`` - fallen ohne eigenen Kanal auf ``community`` zurück. Private Ziele - ``board``
(Vorstand) und ``ops`` (Betrieb, #265) - fallen **nie** zurück: fehlt ihr Kanal, wird nichts
gesendet. Und was nur Mitglieder oder der Vorstand sehen dürfen, geht nie an ein öffentliches
Ziel, egal welcher Schalter an ist. Beides entscheidet ``send_event`` an einer Stelle.

Ist der Bot aus oder nicht verbunden, wird nichts gesendet - kein Rückfall auf einen Webhook
(Entscheidung des Betreibers, 25.09.). Das Versand-Log (``email_logs``, channel ``discord``)
hält jeden Versuch fest, mit Kanal und Nachrichten-ID, damit spätere Pakete Nachrichten
bearbeiten können.
"""
import logging
import os
from urllib.parse import urlparse

from database import get_db
from models import new_id, now_utc

logger = logging.getLogger("tls-arena.discord")
PRIVATE_DISCORD_VISIBILITIES = {"members", "internal"}

PUBLIC_TARGETS = ("community", "news", "events")
PRIVATE_TARGETS = ("board", "ops")
TARGETS = PUBLIC_TARGETS + PRIVATE_TARGETS
TARGET_LABELS = {
    "community": "Community (Standard)", "news": "News", "events": "Events und Turniere",
    "board": "Vorstand (privat)", "ops": "Betrieb (privat)",
}
# Ereignis → Ziel, Beschriftung, Standard. Neue Ereignisse sind aus, bis der Betreiber sie
# einschaltet; was es vor #300 schon gab, bleibt an. Erfolge gehen seit #566 in keinen Kanal
# mehr - die Person selbst bekommt die Gratulation (#568).
EVENTS = {
    "news.published": {"target": "news", "label": "News veröffentlicht", "default": False},
    "event.announced": {"target": "events", "label": "Event angekündigt", "default": False},
    "tournament.registration_open": {"target": "events", "label": "Turnier: Anmeldung offen", "default": True},
    "tournament.live": {"target": "events", "label": "Turnier: jetzt live", "default": True},
    "tournament.completed": {"target": "events", "label": "Turnier: beendet", "default": True},
    "tournament.results_published": {"target": "events", "label": "Turnier: Ergebnisse veröffentlicht", "default": True},
    "f1.new_leader": {"target": "events", "label": "Fast Lap: neue Bestzeit", "default": True},
    "membership.application": {"target": "board", "label": "Neuer Mitgliedsantrag", "default": False},
    "contact.request": {"target": "board", "label": "Neue Kontaktanfrage", "default": False},
}
# Warum nichts ankam - in Worten mit Klickweg, für Versand-Log, Admin und Betrieb & Logs.
REASON_TEXTS = {
    "disabled": "Discord-Meldungen sind ausgeschaltet (Verbindungen → Discord → „Versand aktiv“).",
    "bot_off": "Der Bot ist aus – ohne Bot keine Meldung (Verbindungen → Discord → „Bot verbinden“).",
    "bot_offline": "Der Bot ist nicht verbunden – der Grund steht im Bot-Kasten unter Verbindungen → Discord.",
    "channel_missing": "Kein Kanal gewählt (Verbindungen → Discord → Kanäle je Zweck).",
    "forbidden": ("Der Bot darf in diesem Kanal nicht schreiben: Kanal → Bearbeiten → Berechtigungen → Bot-Rolle: "
                  "„Kanal ansehen“, „Nachrichten senden“, „Links einbetten“."),
    "unknown_channel": "Kanal nicht gefunden – gelöscht, oder der Bot ist nicht auf diesem Server.",
    # Direktnachrichten (#567)
    "dm_forbidden": ("Discord lässt keine Direktnachricht zu – in Discord unter Einstellungen → Datenschutz „Direktnachrichten von "
                     "Servermitgliedern erlauben“, und der Bot muss mit dir auf dem Vereinsserver sein."),
    "unknown_user": "Discord kennt dieses Konto nicht mehr – im Profil unter Socials neu verknüpfen.",
}
# Ein Ziel, dessen letzter Versuch so scheiterte, ist eine Aufgabe für die Tageszentrale (#303).
BROKEN_REASONS = ("forbidden", "unknown_channel")


def event_field(event_key: str) -> str:
    """Feldname eines Schalters in der Datenbank. Ein Punkt im Namen wäre für MongoDB ein Unterordner."""
    return event_key.replace(".", "__")


def channel_id_valid(value) -> bool:
    """Discord-Kanal-IDs sind Snowflakes: nur Ziffern, 17 bis 20 Stellen (mit Luft nach beiden Seiten)."""
    text = str(value or "").strip()
    return text.isdigit() and 15 <= len(text) <= 22


def should_post_to_public_discord(item: dict | None) -> bool:
    """Return whether a content object is safe for a public Discord channel."""
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
    from services.discord_bot import bot_settings

    db = get_db()
    s = await db.settings.find_one({"id": "discord"}) or {}
    stored = s.get("channels") if isinstance(s.get("channels"), dict) else {}
    return {
        "master": bool(s.get("enabled", True)),
        "bot": bot_settings(s),
        "channels": {target: str(stored.get(target) or "").strip() for target in TARGETS},
        "events": {key: (s.get("events") or {}).get(event_field(key)) for key in EVENTS},
    }


def event_enabled(cfg: dict, event_key: str) -> bool:
    spec = EVENTS.get(event_key)
    if not spec:
        return True
    value = (cfg.get("events") or {}).get(event_key)
    return bool(spec["default"] if value is None else value)


def resolve_target(cfg: dict, target: str) -> dict:
    """Kanal und tatsächliches Ziel. Privat fällt nie zurück - auch nicht auf ein anderes privates Ziel."""
    if target not in TARGETS:
        target = "community"
    channels = cfg.get("channels") or {}
    if target in PRIVATE_TARGETS:
        return {"target": target, "channel_id": channels.get(target) or "", "fallback": False}
    if target != "community" and channels.get(target):
        return {"target": target, "channel_id": channels[target], "fallback": False}
    return {"target": "community", "channel_id": channels.get("community") or "", "fallback": target != "community"}


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


def _new_log(event_key: str, title: str, target: str) -> dict:
    return {
        "id": new_id(), "channel": "discord", "target": target, "event_key": event_key,
        "title": title, "status": "skipped", "error": None,
        "created_at": now_utc().isoformat(),
    }


def _payload(title, description, color, url, fields, image_url) -> dict:
    """Für „erneut senden“ (#303): was gesendet werden sollte."""
    return {"title": title[:256], "description": (description or "")[:4000], "color": color, "url": url,
            "fields": (fields or [])[:10], "image_url": image_url}


async def _skip(log: dict, reason: str, error: str) -> dict:
    log["reason"] = reason
    log["error"] = error
    await get_db().email_logs.insert_one(log)
    return {"ok": False, "reason": reason, "error": error, "target": log.get("target")}


async def _send_embed(channel_id: str, *, title: str, description: str, color: int, url: str | None,
                      fields: list | None, image_url: str | None, log: dict) -> dict:
    """Ein Embed über den Bot in genau diesen Kanal; das Log landet in email_logs - mit Nachrichten-ID."""
    from services.discord_bot import bot

    db = get_db()
    embed = await build_embed(title, description, color=color, url=url, fields=fields, image_url=image_url)
    log["channel_id"] = channel_id
    try:
        result = await bot.send_embed(channel_id, embed)
    except Exception as exc:  # noqa: BLE001 - ein Discord-Fehler darf nichts abbrechen
        logger.error("[discord] %s", type(exc).__name__)
        result = {"ok": False, "reason": "error", "error": type(exc).__name__}
    if result.get("ok"):
        log["status"] = "sent"
        log["message_id"] = result.get("message_id")
    else:
        log["status"] = "failed"
        log["reason"] = result.get("reason") or "error"
        log["error"] = result.get("error") or REASON_TEXTS.get(log["reason"]) or log["reason"]
    await db.email_logs.insert_one(log)
    return {"ok": log["status"] == "sent", "reason": log.get("reason"), "error": log.get("error"), "target": log.get("target"),
            "channel_id": channel_id, "message_id": log.get("message_id")}


async def send_to(target: str, title: str, description: str = "", *, color: int = 0x29B6E8, url: str = None,
                  fields: list = None, image_url: str = None, event_key: str = "custom") -> dict:
    """An ein Ziel senden. Öffentliche Ziele fallen auf Community zurück, private nie; ohne Bot gar nichts."""
    cfg = await _get_discord_config()
    resolved = resolve_target(cfg, target)
    log = _new_log(event_key, title, resolved["target"])
    if resolved["fallback"]:
        log["wanted_target"] = target
    log["payload"] = _payload(title, description, color, url, fields, image_url)
    if not cfg["master"]:
        return await _skip(log, "disabled", REASON_TEXTS["disabled"])
    if not cfg["bot"]["enabled"]:
        return await _skip(log, "bot_off", REASON_TEXTS["bot_off"])
    if not resolved["channel_id"]:
        private = resolved["target"] in PRIVATE_TARGETS
        return await _skip(log, f"{resolved['target']}_channel_missing" if private else "channel_missing", REASON_TEXTS["channel_missing"])
    return await _send_embed(resolved["channel_id"], title=title, description=description, color=color, url=url,
                             fields=fields, image_url=image_url, log=log)


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
    """Ein Embed in den Community-Kanal."""
    return await send_to("community", title, description, color=color, url=url, fields=fields, event_key=event_key)


async def send_ops_discord(title: str, description: str = "", *,
                           color: int = 0xFF3B30, url: str = None,
                           fields: list = None, event_key: str = "ops") -> dict:
    """Ein Embed nur in den Betriebskanal - nie in die Community (#265)."""
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
    """Je Ziel: Kanal, wohin es wirklich geht, letzter Versuch."""
    from services.discord_bot import read_state

    db = db if db is not None else get_db()
    cfg = await _get_discord_config()
    names = {str(row.get("id")): row.get("name") for row in ((await read_state(db)).get("channels") or []) if row.get("id")}
    status = {}
    for target in TARGETS:
        resolved = resolve_target(cfg, target)
        own = not resolved["fallback"] and bool(resolved["channel_id"])
        last = await db.email_logs.find_one(
            {"channel": "discord", "target": target, "status": {"$in": ["sent", "failed"]}},
            {"_id": 0, "status": 1, "reason": 1, "error": 1, "event_key": 1, "created_at": 1, "channel_id": 1},
            sort=[("created_at", -1)],
        )
        channel_id = cfg["channels"].get(target) or ""
        status[target] = {
            "label": TARGET_LABELS[target], "private": target in PRIVATE_TARGETS, "configured": own,
            "channel_id": channel_id, "channel_name": names.get(channel_id),
            "delivers_to": resolved["target"] if resolved["channel_id"] else None, "last": last,
        }
    return status


async def broken_targets(db=None) -> list[dict]:
    """Ziele, deren letzter Versuch an Kanal oder Recht scheiterte - für die Tageszentrale (#303)."""
    broken = []
    for target, entry in (await target_status(db)).items():
        last = entry.get("last") or {}
        if entry["configured"] and last.get("status") == "failed" and last.get("reason") in BROKEN_REASONS:
            broken.append({"target": target, "label": entry["label"], "reason": last.get("reason"),
                           "text": REASON_TEXTS.get(last.get("reason"), ""), "at": last.get("created_at")})
    return broken
