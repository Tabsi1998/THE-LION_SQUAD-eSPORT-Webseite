"""Grafiken für den Play-Store-Eintrag der LionsAPP aus den Markenbildern (#219).

    python scripts/store_graphics.py            schreibt docs/store/icon-512.png und feature-graphic-1024x500.png

Quellen: mobile/assets/icon.png (Löwe auf Schwarz) und mobile/assets/brand/ (Maskottchen weiß auf
transparent, Wortmarke in Vereinsblau). Die Play Console verlangt ein Symbol mit 512 × 512 px ohne
Transparenz und eine Funktionsgrafik mit 1024 × 500 px. Schriften: Segoe UI (Windows); fehlt sie,
nimmt das Skript die Standardschrift von Pillow - dann sieht die Grafik anders aus, sag es dazu.
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
ASSETS = ROOT / "mobile" / "assets"
OUT = ROOT / "docs" / "store"
BLACK = (10, 10, 10)
WHITE = (255, 255, 255)
CYAN = (41, 182, 232)
GOLD = (255, 215, 0)
MUTED = (255, 255, 255, 170)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ([r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"] if bold else [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    print("Warnung: keine Systemschrift gefunden, Pillow-Standardschrift", file=sys.stderr)
    return ImageFont.load_default(size)


def icon_512() -> pathlib.Path:
    """Das App-Symbol ohne Transparenz, wie die Play Console es will."""
    source = Image.open(ASSETS / "icon.png").convert("RGBA")
    canvas = Image.new("RGB", source.size, BLACK)
    canvas.paste(source, mask=source.getchannel("A"))
    target = OUT / "icon-512.png"
    canvas.resize((512, 512), Image.Resampling.LANCZOS).save(target, format="PNG", optimize=True)
    return target


def feature_graphic() -> pathlib.Path:
    """1024 × 500: Löwe links, rechts Wortmarke, App-Name und was die App kann."""
    width, height = 1024, 500
    canvas = Image.new("RGBA", (width, height), BLACK + (255,))

    mascot = Image.open(ASSETS / "brand" / "tls-mascot.png").convert("RGBA")
    mascot = mascot.crop(mascot.getbbox())
    mascot.thumbnail((400, 400), Image.Resampling.LANCZOS)
    canvas.alpha_composite(mascot, (60, (height - mascot.height) // 2))

    wordmark = Image.open(ASSETS / "brand" / "tls-wordmark.png").convert("RGBA")
    wordmark = wordmark.crop(wordmark.getbbox())
    wordmark.thumbnail((440, 120), Image.Resampling.LANCZOS)
    left = 500
    canvas.alpha_composite(wordmark, (left, 92))

    draw = ImageDraw.Draw(canvas)
    draw.text((left + 4, 190), "LionsAPP", font=font(88, bold=True), fill=WHITE)
    draw.rectangle((left + 6, 300, left + 126, 306), fill=GOLD)
    draw.text((left + 4, 326), "Turniere · Events · Team", font=font(34), fill=MUTED)
    draw.text((left + 4, 372), "Chat · Mitgliedschaft", font=font(34), fill=MUTED)

    target = OUT / "feature-graphic-1024x500.png"
    canvas.convert("RGB").save(target, format="PNG", optimize=True)
    return target


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for target in (icon_512(), feature_graphic()):
        with Image.open(target) as image:
            print(f"{target.relative_to(ROOT)}: {image.width}x{image.height}, {target.stat().st_size // 1024} KiB")


if __name__ == "__main__":
    main()
