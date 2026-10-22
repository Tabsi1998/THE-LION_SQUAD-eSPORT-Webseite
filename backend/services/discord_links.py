"""Adressen und Einbettungen für Discord ohne Rück-Importe (#1420: aus discord_service.py herausgelöst).

Website-Pfade werden volle öffentliche Adressen, ein Embed bekommt die Form, die Discord erwartet, und Link-Knöpfe
werden geprüft. Die Bot-Laufzeit (services/discord_runtime.py) baut damit die Antworten auf Slash-Befehle, ohne
discord_service zu importieren - das importiert die Laufzeit nämlich selbst.
"""
import os
from urllib.parse import urlparse

from database import get_db
from services.svg_logo import raster_url


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
        return raster_url(avatar_url)  # SVG-Logo als PNG (#1952) - Discord zeigt kein SVG
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
    return raster_url(candidate) if _is_public_http_url(candidate) else None


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


async def build_embed(title: str, description: str = "", *, color: int = 0x29B6E8, url: str | None = None,
                      fields: list | None = None, image_url: str | None = None, footer: str | None = None) -> dict:
    """Das Embed, wie Discord es bekommt - auch die Vorschau im Admin baut es hiermit (#303, #583)."""
    embed = {"title": title[:256], "description": (description or "")[:4000], "color": color}
    if footer:
        embed["footer"] = {"text": str(footer)[:2048]}
    embed_url = await _public_link_url(url)
    if embed_url:
        embed["url"] = embed_url
    if fields:
        embed["fields"] = [{"name": str(f["name"])[:256], "value": str(f["value"])[:1024], "inline": f.get("inline", True)} for f in fields[:10]]
    image = await _public_avatar_url(image_url)
    if image:
        embed["image"] = {"url": image}
    return embed


async def resolve_buttons(buttons: list | None) -> list[dict]:
    """Link-Knöpfe (#573): Website-Pfade werden volle Adressen wie der Link im Embed; was keine öffentliche
    Adresse ergibt, fällt weg."""
    out = []
    for button in buttons or []:
        if (button or {}).get("custom_id") and (button or {}).get("label"):
            # Rückruf-Knopf (#885): keine Adresse, der Bot beantwortet den Klick privat.
            out.append({"label": str(button["label"])[:80], "custom_id": str(button["custom_id"])[:100], "style": str(button.get("style") or "primary")})
            continue
        url = await _public_link_url((button or {}).get("url"))
        if url and (button or {}).get("label"):
            out.append({"label": str(button["label"])[:80], "url": url})
    return out
