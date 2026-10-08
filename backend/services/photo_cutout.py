"""Freigestellte Fotos erkennen (#1332): Vorstands-Porträts aus einem Guss.

Ein freigestelltes Foto (Person ohne Hintergrund, durchsichtig) bekommt auf der Website den Vereins-Hintergrund
dahinter; ein Foto mit eigenem Hintergrund steht im Duoton. Erkannt wird das beim Hochladen (``is_cutout`` am
fertigen Bild, gespeichert als ``cutout`` am Eintrag in ``media_uploads``). Ältere Uploads ohne Vermerk prüft
``flags_for`` einmal von der Platte und schreibt das Ergebnis nach - so reichen auch Fotos von früher.

Freigestellt heißt: das Bild hat eine Deckkraft-Ebene, ein spürbarer Teil ist durchsichtig, und die beiden oberen
Ecken sind es auch (bei Kopf und Schultern liegt dort der Hintergrund). Ein Logo mit durchsichtigem Rand zählt
ebenso - für Porträts spielt das keine Rolle.
"""
from __future__ import annotations

import logging
import re

from PIL import Image, UnidentifiedImageError

from storage import PUBLIC_UPLOAD_DIR

logger = logging.getLogger("tls.photo_cutout")

CLEAR_ALPHA = 24          # darunter gilt ein Bildpunkt als durchsichtig
MIN_CLEAR_SHARE = 0.08    # so viel des Bildes muss durchsichtig sein
SAMPLE = 64               # geprüft wird eine verkleinerte Fassung - schnell und reicht
UPLOAD_URL = re.compile(r"^/api/static/uploads/([A-Za-z0-9_-]{1,80}\.(?:png|webp|jpe?g))$")
_DISK_CACHE: dict[str, bool] = {}
DISK_CACHE_LIMIT = 256


def is_cutout(img: Image.Image) -> bool:
    """Ist das Bild freigestellt? Ohne Deckkraft-Ebene nie."""
    bands = img.getbands()
    if "A" not in bands and not (img.mode == "P" and "transparency" in img.info):
        return False
    alpha = img.convert("RGBA").getchannel("A").resize((SAMPLE, SAMPLE))
    clear = sum(alpha.histogram()[:CLEAR_ALPHA])
    if clear < MIN_CLEAR_SHARE * SAMPLE * SAMPLE:
        return False
    return alpha.getpixel((0, 0)) < CLEAR_ALPHA and alpha.getpixel((SAMPLE - 1, 0)) < CLEAR_ALPHA


def _from_disk(filename: str) -> bool:
    if filename in _DISK_CACHE:
        return _DISK_CACHE[filename]
    path = PUBLIC_UPLOAD_DIR / filename
    try:
        with Image.open(path) as img:
            result = is_cutout(img)
    except (OSError, UnidentifiedImageError, ValueError):
        result = False
    if len(_DISK_CACHE) >= DISK_CACHE_LIMIT:
        _DISK_CACHE.clear()
    _DISK_CACHE[filename] = result
    return result


async def flags_for(db, urls) -> dict[str, bool]:
    """Je Bild-Adresse: freigestellt ja/nein. Nur eigene Uploads (`/api/static/uploads/…`); fremde Adressen nie."""
    wanted = sorted({str(url) for url in urls or [] if url and UPLOAD_URL.match(str(url))})
    if not wanted:
        return {}
    out: dict[str, bool] = {}
    async for row in db.media_uploads.find({"url": {"$in": wanted}}, {"_id": 0, "id": 1, "url": 1, "filename": 1, "cutout": 1}):
        if "cutout" in row:
            out[row["url"]] = bool(row["cutout"])
            continue
        # Hochgeladen vor der Erkennung: einmal von der Platte prüfen und am Eintrag vermerken.
        value = _from_disk(str(row.get("filename") or UPLOAD_URL.match(row["url"]).group(1)))
        out[row["url"]] = value
        try:
            await db.media_uploads.update_one({"id": row.get("id"), "url": row["url"]}, {"$set": {"cutout": value}})
        except Exception as exc:  # noqa: BLE001 - ein fehlender Vermerk kostet nur eine zweite Prüfung
            logger.warning("[photo_cutout] Vermerk für %s nicht geschrieben: %s", row["url"], exc)
    for url in wanted:
        if url not in out:
            out[url] = _from_disk(UPLOAD_URL.match(url).group(1))
    return out
