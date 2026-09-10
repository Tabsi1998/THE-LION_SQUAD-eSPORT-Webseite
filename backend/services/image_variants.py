"""Smaller copies of an uploaded image, made once and kept on disk.

A gallery tile is roughly 300 to 400 pixels wide. Until now it was handed the
stored image, which may be up to 4096 pixels across - around a hundred times
the pixels the tile actually shows. The bytes matter on a phone connection, but
the decoding matters more: eleven megapixels per tile is what makes a gallery
stall, and no amount of compression helps with that.

Variants are produced on the first request for a width and then read from disk,
so images uploaded long before this existed benefit too - there is nothing to
migrate.

Only a fixed set of widths is allowed. An open resizer is a way to fill a disk:
a few thousand requests with different widths would write a few thousand files.
"""
from __future__ import annotations

import logging
from pathlib import Path

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Passend zu den Kacheln der Oberfläche: Vorschau im Raster, mittlere Ansicht,
# und eine Fassung für grosse Bildschirme.
VARIANT_WIDTHS: tuple[int, ...] = (400, 800, 1600)
VARIANT_DIR_NAME = "variants"
VARIANT_QUALITY = {400: 78, 800: 80, 1600: 82}
RESIZABLE_SUFFIXES = frozenset({".webp", ".jpg", ".jpeg", ".png"})


def is_resizable(source: Path | str) -> bool:
    return Path(source).suffix.lower() in RESIZABLE_SUFFIXES


def normalize_width(requested) -> int | None:
    """The allowed width closest to what was asked for, or None.

    Anything outside the list is refused rather than rounded up, so a request
    for width 4095 does not quietly produce a full size copy.
    """
    try:
        value = int(requested)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return value if value in VARIANT_WIDTHS else None


def variant_path(source: Path, width: int) -> Path:
    """Where the variant of ``source`` at ``width`` lives."""
    return source.parent / VARIANT_DIR_NAME / f"{source.stem}-{width}.webp"


def build_variant(source: Path, width: int) -> Path | None:
    """Write the variant and return its path; None when it makes no sense.

    A picture that is already narrower than the requested width is served as it
    is - shrinking it further would cost quality for nothing, and blowing it up
    would cost bytes for nothing.
    """
    if width not in VARIANT_WIDTHS or not is_resizable(source):
        return None
    target = variant_path(source, width)
    if target.exists():
        return target
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            if image.width <= width:
                return None
            copy = image.copy()
            copy.thumbnail((width, width * 4), Image.Resampling.LANCZOS)
            if copy.mode not in ("RGB", "RGBA"):
                copy = copy.convert("RGBA" if "A" in copy.getbands() else "RGB")
            target.parent.mkdir(parents=True, exist_ok=True)
            copy.save(target, format="WEBP", quality=VARIANT_QUALITY.get(width, 80), method=6)
        return target
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.warning("[media] variant %s@%s failed: %s", source.name, width, exc)
        return None


def resolve_variant(source: Path, requested) -> Path | None:
    """The file to serve for a requested width, or None to serve the original."""
    width = normalize_width(requested)
    if width is None or not source.is_file():
        return None
    target = variant_path(source, width)
    if target.is_file():
        return target
    return build_variant(source, width)


def srcset_widths(image_width: int | None = None) -> list[int]:
    """The widths worth offering for an image of this size.

    Offering a 1600 pixel entry for a 900 pixel picture would let a browser
    download the same file twice under two names.
    """
    if not image_width:
        return list(VARIANT_WIDTHS)
    return [width for width in VARIANT_WIDTHS if width < image_width]
