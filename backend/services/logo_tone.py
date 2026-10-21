"""Ist ein Logo durchsichtig? (#1321)

Sponsoren- und Partner-Logos stehen auf der Website einfarbig weiß und bekommen beim Drüberfahren ihre Farbe. Weiß
färben lässt sich ein Logo nur, wenn es durchsichtig ist - ein Logo mit weißem oder schwarzem Kasten würde zu einem
weißen Rechteck. Deshalb sieht der Server nach: hat das Bild einen Alphakanal, und ist der Rand überwiegend
durchsichtig?

Geprüft wird die Datei, die die Website zeigt (Upload oder Fassung aus dem Vereinsmodul), beim Lesen - mit einem
Zwischenspeicher je Datei, Änderungszeit und Größe. So gilt das auch für alles, was längst hochgeladen ist, und für
neue Fassungen aus Dolibarr, ohne dass ein Feld nachgezogen werden muss.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from services.image_upload import MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS
from storage import PUBLIC_UPLOAD_DIR, UPLOAD_DIR

LOCAL_PREFIX = "/api/static/uploads/"
# Ab diesem Anteil durchsichtiger Randpunkte gilt ein Logo als durchsichtig.
EDGE_TRANSPARENT_SHARE = 0.6
# Ein Punkt mit weniger Deckkraft als das gilt als durchsichtig.
TRANSPARENT_ALPHA = 32
SAMPLE_SIDE = 256
RASTER_SUFFIXES = {".png", ".webp", ".gif", ".jpg", ".jpeg", ".avif"}


def local_upload_file(url: str | None) -> Path | None:
    """Die Datei hinter einer eigenen Upload-Adresse - fremde Adressen und Pfad-Tricks ergeben ``None``."""
    text = str(url or "").strip()
    if not text.startswith(LOCAL_PREFIX):
        return None
    name = text[len(LOCAL_PREFIX):].split("?", 1)[0].split("#", 1)[0]
    if not name or "/" in name or "\\" in name or ".." in name or name.startswith("."):
        return None
    for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR):
        path = base / name
        if path.is_file():
            return path
    return None


def logo_transparent(url: str | None) -> bool | None:
    """``True``: durchsichtig, weiß färbbar. ``False``: mit Kasten. ``None``: unbekannt (fremde Adresse, SVG, kaputt)."""
    path = local_upload_file(url)
    if path is None or path.suffix.lower() not in RASTER_SUFFIXES:
        return None
    try:
        stat = path.stat()
    except OSError:
        return None
    return _transparent_cached(str(path), stat.st_mtime_ns, stat.st_size)


def header_too_large(width: int, height: int) -> bool:
    """Größer als ein Upload sein darf (``image_upload``): solche Bilder werden gar nicht erst dekodiert."""
    return width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION or width * height > MAX_IMAGE_PIXELS


@lru_cache(maxsize=1024)
def _transparent_cached(path: str, _mtime_ns: int, _size: int) -> bool | None:
    try:
        with Image.open(path) as image:
            # Erst nur der Kopf: ein klein gepacktes Riesenbild gilt als nicht prüfbar und steht auf der ruhigen Fläche.
            width, height = image.size
            if header_too_large(width, height):
                return None
            has_alpha = "A" in image.getbands() or "transparency" in image.info
            if not has_alpha:
                return False
            image.draft("RGBA", (SAMPLE_SIDE, SAMPLE_SIDE))
            image.thumbnail((SAMPLE_SIDE, SAMPLE_SIDE))
            return edge_is_transparent(image.convert("RGBA"))
    except (OSError, UnidentifiedImageError, ValueError, Image.DecompressionBombError):
        return None


def edge_is_transparent(image: Image.Image) -> bool:
    """Sind die Randpunkte überwiegend durchsichtig?"""
    alpha = image.getchannel("A")
    width, height = alpha.size
    if width < 1 or height < 1:
        return False
    pixels = alpha.load()
    edge = [(x, 0) for x in range(width)] + [(x, height - 1) for x in range(width)]
    edge += [(0, y) for y in range(1, height - 1)] + [(width - 1, y) for y in range(1, height - 1)]
    clear = sum(1 for x, y in edge if pixels[x, y] < TRANSPARENT_ALPHA)
    return clear >= EDGE_TRANSPARENT_SHARE * len(edge)
