"""Standard-Favicon, das auf hell und dunkel trägt (#229).

Der Verein führt Favicons doppelt - eine Fassung für hellen, eine für dunklen Modus - und als
Standard steht bei ihm die weiße. Browser ohne ``prefers-color-scheme`` und der Home-Bildschirm
nehmen nur den Standard, und Weiß auf einer hellen Tableiste zeigt nichts. Hier entsteht auf
Knopfdruck im Admin eine Fassung, die überall trägt: das weiße Logo auf einem Kreis in der
Akzentfarbe. Reine Bildlogik oben, ohne Datenbank; die Route in ``settings_routes`` speichert.
"""
from __future__ import annotations

import io
import uuid
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw

from storage import PUBLIC_UPLOAD_DIR, UPLOAD_DIR, ensure_directory

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_BRAND_DIR = REPO_ROOT / "frontend" / "public" / "assets" / "brand"
BUILTIN_MASCOT = "/assets/brand/tls-mascot.png"
# Die Fassungen für dunklen Hintergrund sind die hellen Bilder - genau die kommen auf den Kreis.
SOURCE_ORDER = ("favicon_dark_url", "mascot_url", "logo_dark_url")
DEFAULT_COLOR = (41, 182, 232)  # #29B6E8
SIZE = 512
LOGO_SHARE = 0.66


def hex_to_rgb(value, fallback: tuple[int, int, int] = DEFAULT_COLOR) -> tuple[int, int, int]:
    raw = str(value or "").strip().lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        return fallback
    try:
        return tuple(int(raw[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return fallback


def pick_source(branding: dict | None) -> str:
    """Welches Bild auf den Kreis kommt - sonst das eingebaute Maskottchen."""
    branding = branding or {}
    for key in SOURCE_ORDER:
        value = str(branding.get(key) or "").strip()
        if value:
            return value
    return BUILTIN_MASCOT


def dark_only_default(branding: dict | None) -> bool:
    """Wahr, wenn der Standard-Favicon nur die Fassung für dunkel ist - dann zeigt der Admin den Hinweis."""
    branding = branding or {}
    default = str(branding.get("favicon_url") or "").strip()
    if not default:
        return False
    return default in {str(branding.get(key) or "").strip() for key in SOURCE_ORDER}


def asset_path(url: str | None) -> Path | None:
    """Datei zu einer Markenbild-Adresse: eingebaut unter ``/assets/brand/``, sonst ein Upload."""
    raw = str(url or "").strip()
    if not raw:
        return None
    path = urlparse(raw).path or raw
    name = Path(path).name
    if path.startswith("/assets/brand/"):
        candidate = FRONTEND_BRAND_DIR / name
        return candidate if candidate.is_file() else None
    if not path.startswith(("/api/static/uploads/", "/static/uploads/", "/uploads/")):
        return None
    for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR):
        candidate = base / name
        if candidate.is_file():
            return candidate
    return None


def compose(logo: Image.Image, color: tuple[int, int, int], size: int = SIZE, scale: int = 4) -> Image.Image:
    """Kreis in der Akzentfarbe, das Logo auf seinen sichtbaren Teil beschnitten in der Mitte.

    Gezeichnet wird vierfach groß und dann verkleinert, damit der Kreisrand weich ist."""
    big = size * scale
    canvas = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).ellipse((0, 0, big - 1, big - 1), fill=(*color, 255))
    mark = logo.convert("RGBA")
    bbox = mark.getchannel("A").getbbox()
    if bbox:
        mark = mark.crop(bbox)
    inner = int(big * LOGO_SHARE)
    mark.thumbnail((inner, inner), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mark, ((big - mark.width) // 2, (big - mark.height) // 2))
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def universal_favicon_png(logo_bytes: bytes, color_hex: str | None) -> bytes:
    with Image.open(io.BytesIO(logo_bytes)) as logo:
        out = compose(logo, hex_to_rgb(color_hex))
    buffer = io.BytesIO()
    out.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def store_png(data: bytes) -> tuple[str, Path]:
    """Ablegen wie ein Upload: Zufallsname im öffentlichen Upload-Ordner, Adresse wie gewohnt."""
    filename = f"{uuid.uuid4().hex}.png"
    ensure_directory(PUBLIC_UPLOAD_DIR)
    path = PUBLIC_UPLOAD_DIR / filename
    path.write_bytes(data)
    return f"/api/static/uploads/{filename}", path
