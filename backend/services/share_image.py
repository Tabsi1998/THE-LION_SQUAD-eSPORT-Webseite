"""Der gemeinsame Bild-Baustein für Teilen-Bilder (#1194): Erfolge (#619), Turnier-Ergebnisse (#1194), der
Jahresrückblick (#1195) und das Vorschaubild mit Datum und Ort (#1281) zeichnen mit denselben Werkzeugen.

Serverseitig mit Pillow, ohne Browser: Schriften (die Lionsquad-Schriften aus ``static/fonts``, #2435 - Saira Condensed
für Überschriften und Zahlen, Outfit für Text; fehlt eine Datei oder ein Zeichen, DejaVu bzw. die des Rechners), Farben, Umbruch,
Kürzen mit „…“, Sterne als Polygon (nicht jede Schrift hat ein ★), dunkler Grund mit Schein in der Akzentfarbe,
doppelter Rahmen und die Ausgabe als PNG. Zwei Formate: breit (1200×630, Link-Vorschau) und hoch (1080×1920,
WhatsApp-Status und Instagram-Story).
"""
from __future__ import annotations

import io
import math
import os
from datetime import datetime, timezone
from functools import lru_cache
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFilter, ImageFont

WIDE = (1200, 630)
STORY = (1080, 1920)
BACKGROUND = (10, 10, 10)
CYAN = "#29B6E8"
GOLD = "#FFD700"
VIENNA = ZoneInfo("Europe/Vienna")
_ASSETS = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "fonts")
FONT_CANDIDATES = (
    os.path.join(_ASSETS, "DejaVuSans-Bold.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
)
FONT_REGULAR_CANDIDATES = (
    os.path.join(_ASSETS, "DejaVuSans.ttf"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)
# Die Lionsquad-Schriften (#2435) - dieselben Dateien wie die Website und die Shop-Bilder (services/shop_gamertag.py), SIL Open
# Font License. ``bold``: Überschriften, Namen, Zahlen und Kennzeichen in Saira Condensed Black (schmal, sportlich - Unbounded
# wäre für Namen und Kacheln zu breit); sonst Text in Outfit (Mittel). Lokal und in Produktion dieselbe Schrift.
BRAND_FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "fonts")
BRAND_FONTS = {
    True: {"file": "saira-condensed-latin-900.woff2", "weight": None},
    False: {"file": "outfit-latin-wght.woff2", "weight": 500},
}
# Ein Zeichen, das keine der Schriften hat - sein Bild ist das „fehlt“-Kästchen, mit dem jedes andere Zeichen verglichen wird.
_MISSING_PROBE = "\ue000"
_PROBE_SIZE = 64
# Trenner „·“ mit Luft (#2435): Saira Condensed und Outfit haben schmale Leerzeichen - ein festes und ein normales je Seite,
# damit der Punkt nicht an den Wörtern klebt. Schmale Sonderleerzeichen (U+2009) haben die Schriften nicht.
SEP = "  ·  "


def joined(parts) -> str:
    """Teile mit dem Trenner der Teilen-Bilder - leere fallen weg, ein „ · “ in einem Teil bekommt dieselbe Luft."""
    return SEP.join(spaced(part) for part in parts if part)


def spaced(text) -> str:
    return str(text or "").replace(" · ", SEP)


# Platz 1–3 in den Farben der Medaillen, alles darunter weiß.
RANK_COLORS = {1: GOLD, 2: "#D9DEE5", 3: "#E0A06A"}


@lru_cache(maxsize=4)
def _brand_bytes(file_name: str) -> bytes | None:
    try:
        with open(os.path.join(BRAND_FONT_DIR, file_name), "rb") as handle:
            return handle.read()
    except OSError:
        return None


def _glyph_print(probe: ImageFont.FreeTypeFont, char: str) -> tuple:
    box = ImageFont.FreeTypeFont.getbbox(probe, char)
    image = Image.new("L", (max(1, box[2]) + 2, max(1, box[3]) + 2))
    ImageDraw.Draw(image).text((0, 0), char, font=probe, fill=255)
    return box, ImageFont.FreeTypeFont.getlength(probe, char), image.tobytes()


@lru_cache(maxsize=4)
def _probe(bold: bool) -> tuple[ImageFont.FreeTypeFont, tuple] | None:
    data = _brand_bytes(BRAND_FONTS[bold]["file"])
    if data is None:
        return None
    try:
        probe = ImageFont.FreeTypeFont(io.BytesIO(data), _PROBE_SIZE)
    except OSError:
        return None
    return probe, _glyph_print(probe, _MISSING_PROBE)


@lru_cache(maxsize=2048)
def has_glyph(bold: bool, char: str) -> bool:
    """Hat die Lionsquad-Schrift dieses Zeichen? Die Dateien tragen nur den lateinischen Zeichensatz (mit Umlauten und ß) - ein
    Zeichen aus Osteuropa, Kyrillisch oder ein Symbol fehlt. Erkannt am Bild: Ein fehlendes Zeichen sieht aus wie das
    „fehlt“-Kästchen."""
    # Auch Leerzeichen prüfen: ein schmales (U+2009) fehlt den Schriften - ohne Prüfung stünde dort das „fehlt“-Kästchen.
    found = _probe(bold)
    if found is None:
        return False
    probe, missing = found
    return _glyph_print(probe, char) != missing


class BrandFont(ImageFont.FreeTypeFont):
    """Eine Lionsquad-Schrift mit sauberem Ersatz (#2435): Enthält ein Text ein Zeichen, das sie nicht hat, misst und zeichnet ihn
    die Ersatzschrift (DejaVu bzw. die des Rechners) - ganz, nie gemischt, und nie als Kästchen. Messen (``textlength``,
    ``textbbox``) und Zeichnen gehen über dieselbe Wahl, darum passen Umbruch und Kürzen weiter."""

    def __init__(self, data: bytes, size: int, *, bold: bool, weight: int | None, fallback: ImageFont.ImageFont):
        super().__init__(io.BytesIO(data), size)
        if weight:
            self.set_variation_by_axes([weight])
        self.bold = bold
        self.fallback = fallback

    def covers(self, text) -> bool:
        return all(has_glyph(self.bold, char) for char in set(str(text or "")))

    def getbbox(self, text, *args, **kwargs):
        if self.covers(text):
            return super().getbbox(text, *args, **kwargs)
        return self.fallback.getbbox(text, *args, **kwargs)

    def getlength(self, text, *args, **kwargs):
        if self.covers(text):
            return super().getlength(text, *args, **kwargs)
        return self.fallback.getlength(text, *args, **kwargs)

    def getmask(self, text, *args, **kwargs):
        if self.covers(text):
            return super().getmask(text, *args, **kwargs)
        return self.fallback.getmask(text, *args, **kwargs)

    def getmask2(self, text, *args, **kwargs):
        if self.covers(text):
            return super().getmask2(text, *args, **kwargs)
        return self.fallback.getmask2(text, *args, **kwargs)


@lru_cache(maxsize=48)
def system_font(size: int, bold: bool = True) -> ImageFont.ImageFont:
    """Die Ersatzschrift: DejaVu im Container, sonst die des Rechners, zuletzt die eingebaute von Pillow."""
    for path in (FONT_CANDIDATES if bold else FONT_REGULAR_CANDIDATES):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # sehr altes Pillow
        return ImageFont.load_default()


@lru_cache(maxsize=48)
def font(size: int, bold: bool = True) -> ImageFont.ImageFont:
    """Die Schrift aller Teilen-Bilder und des Rankingbanners (#2435): die Lionsquad-Schrift, mit Ersatz je Text. Fehlt die
    Datei oder lässt sie sich nicht laden, gilt die Ersatzschrift allein - das Bild entsteht trotzdem."""
    fallback = system_font(size, bold)
    spec = BRAND_FONTS[bool(bold)]
    data = _brand_bytes(spec["file"])
    if data is None:
        return fallback
    try:
        return BrandFont(data, size, bold=bool(bold), weight=spec["weight"], fallback=fallback)
    except OSError:
        return fallback


def hex_color(color: str | None, alpha: int = 255, fallback: str = "FFD700") -> tuple:
    value = str(color or "").strip().lstrip("#")
    if len(value) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in value):
        value = fallback
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


def blend(color: tuple, alpha: int, base: tuple = BACKGROUND) -> tuple:
    """Farbe mit Deckkraft ``alpha`` (0–255) gegen den Grund vormischen - ImageDraw mischt selbst nichts."""
    a = max(0, min(alpha, 255)) / 255.0
    return tuple(int(round(base[i] * (1 - a) + color[i] * a)) for i in range(3)) + (255,)


def ellipsis(draw: ImageDraw.ImageDraw, text: str, used_font: ImageFont.ImageFont, max_width: int) -> str:
    if draw.textlength(text, font=used_font) <= max_width:
        return text
    while len(text) > 3 and draw.textlength(text + "…", font=used_font) > max_width:
        text = text[:-1]
    return text.rstrip() + "…"


def wrap(draw: ImageDraw.ImageDraw, text: str, used_font: ImageFont.ImageFont, max_width: int, max_lines: int = 2) -> list[str]:
    """Text an Wortgrenzen auf höchstens ``max_lines`` Zeilen umbrechen, die letzte mit „…“."""
    words = str(text or "").split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=used_font) <= max_width or not current:
            current = candidate
            continue
        lines.append(current)
        current = word
        if len(lines) == max_lines:
            break
    if len(lines) < max_lines and current:
        lines.append(current)
    if len(lines) == max_lines and (draw.textlength(lines[-1], font=used_font) > max_width or " ".join(lines) != " ".join(words)):
        lines[-1] = ellipsis(draw, " ".join(words[len(" ".join(lines[:-1]).split()):]), used_font, max_width)
    return lines


def fit(draw: ImageDraw.ImageDraw, text: str, size: int, max_width: int, *, bold: bool = True, min_size: int = 22) -> ImageFont.ImageFont:
    """Schrift so weit verkleinern, dass der Text in die Breite passt."""
    while size > min_size:
        candidate = font(size, bold)
        if draw.textlength(text, font=candidate) <= max_width:
            return candidate
        size -= 2
    return font(min_size, bold)


def star(cx: float, cy: float, outer: float, inner: float, points: int = 5) -> list[tuple[float, float]]:
    """Ein Stern als Polygon - Schriftarten haben nicht immer ein ★, ein Polygon hat jede."""
    out = []
    for i in range(points * 2):
        radius = outer if i % 2 == 0 else inner
        angle = -math.pi / 2 + i * math.pi / points
        out.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return out


def date_label(value, *, vienna: bool = False) -> str:
    """„Sa 17. Oktober“ (#1307) - mit ``vienna`` der Tag in Wien (Turniere am späten Abend bleiben am richtigen Tag)."""
    from services.date_text import format_moment

    try:
        when = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return ""
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    # Ohne ``vienna`` zählt der Tag, wie er dasteht (ein reiner Tag ohne Uhrzeit), sonst der Wiener Tag.
    day = when.astimezone(VIENNA).date() if vienna else when.date()
    return format_moment(day)


def canvas(size: tuple[int, int], accent: tuple) -> Image.Image:
    """Dunkler Grund mit zwei weichen Scheinen in der Akzentfarbe - oben links kräftig, unten rechts leise."""
    width, height = size
    image = Image.new("RGBA", size, BACKGROUND + (255,))
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((-int(width * 0.13), -int(height * 0.35), int(width * 0.52), int(height * 0.83)), fill=accent[:3] + (70,))
    glow_draw.ellipse((int(width * 0.63), int(height * 0.48), int(width * 1.17), int(height * 1.43)), fill=accent[:3] + (28,))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(max(width, height) // 10)))
    return image


def frame(draw: ImageDraw.ImageDraw, size: tuple[int, int], accent: tuple, inset: int = 24) -> None:
    """Doppelter Rahmen in der Akzentfarbe."""
    width, height = size
    draw.rounded_rectangle((inset, inset, width - inset, height - inset), radius=8, outline=blend(accent, 150), width=3)
    draw.rounded_rectangle((inset + 12, inset + 12, width - inset - 12, height - inset - 12), radius=6, outline=blend(accent, 60), width=1)


def chip(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, used_font: ImageFont.ImageFont, *, color: tuple, padding: tuple[int, int] = (14, 8)) -> int:
    """Ein Schildchen mit Text; gibt die Breite zurück."""
    box = draw.textbbox((0, 0), text, font=used_font)
    width = box[2] - box[0] + padding[0] * 2
    height = box[3] - box[1] + padding[1] * 2
    draw.rounded_rectangle((x, y, x + width, y + height), radius=6, fill=blend(color, 38), outline=blend(color, 120), width=2)
    draw.text((x + padding[0] - box[0], y + padding[1] - box[1]), text, font=used_font, fill=(255, 255, 255, 235))
    return width


def row(draw: ImageDraw.ImageDraw, x: int, y: int, width: int, label: str, value: str, used_font: ImageFont.ImageFont, *,
        mark: tuple, value_color: tuple = (255, 255, 255, 255), height: int = 76) -> int:
    """Eine Zeile einer Liste (der Weg, Zahlen im Jahresrückblick): dunkle Fläche, links ein Farbstrich, Text links,
    Wert rechts. Gibt die Höhe zurück."""
    draw.rounded_rectangle((x, y, x + width, y + height), radius=10, fill=blend(mark, 26), outline=blend(mark, 80), width=2)
    draw.rounded_rectangle((x + 10, y + 14, x + 18, y + height - 14), radius=3, fill=mark)
    value_width = draw.textlength(value, font=used_font) if value else 0
    box = draw.textbbox((0, 0), "Ag", font=used_font)
    text_y = y + (height - (box[3] - box[1])) / 2 - box[1]
    draw.text((x + 40, text_y), ellipsis(draw, label, used_font, int(width - 80 - value_width)), font=used_font, fill=(255, 255, 255, 235))
    if value:
        draw.text((x + width - 28 - value_width, text_y), value, font=used_font, fill=value_color)
    return height


def initials(name: str) -> str:
    words = [word for word in str(name or "").replace("_", " ").replace("-", " ").split() if word]
    if len(words) > 1:
        return (words[0][0] + words[1][0]).upper()
    capitals = [ch for ch in str(name or "") if ch.isupper()]
    if len(capitals) >= 2:
        return (capitals[0] + capitals[1]).upper()
    return str(name or "?")[:2].upper()


def png(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()
