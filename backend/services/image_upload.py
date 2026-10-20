"""Grenzen und Formate der Uploads, Bilder prüfen und neu kodieren (#1420: aus routes/upload_routes.py herausgelöst).

Derselbe Weg für jeden Bild-Upload: öffentliche Uploads, Chat-Anhänge, Spielberichts-Fotos und Fotos vom Event.
Nur PNG, JPG oder WebP, Größe und Pixel begrenzt, gedreht, verkleinert und neu gespeichert (EXIF fällt weg).
Steht unter services/, damit Dienste es nutzen können, ohne eine Route zu importieren.
"""
import logging
import os
import pathlib
from io import BytesIO

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError

from services.media_formats import BROWSER_IMAGE_MIME_BY_EXT, PLAYABLE_VIDEO_MIME_ALIASES, PLAYABLE_VIDEO_MIME_BY_EXT
from services.photo_cutout import is_cutout
from storage import ensure_directory

logger = logging.getLogger("tls-arena.uploads")
ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_VIDEO = {"video/mp4", "video/webm", "video/quicktime", "video/x-m4v"}
SUPPORTED_VIDEO_LABEL = "MP4, WebM, MOV oder M4V"
IMAGE_MIME_BY_EXT = BROWSER_IMAGE_MIME_BY_EXT
VIDEO_MIME_BY_EXT = PLAYABLE_VIDEO_MIME_BY_EXT
VIDEO_MIME_ALIASES = PLAYABLE_VIDEO_MIME_ALIASES
VIDEO_EXT_BY_MIME = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "video/x-m4v": ".m4v",
}
PIL_IMAGE_FORMATS = {
    "PNG": ("image/png", ".png"),
    "JPEG": ("image/jpeg", ".jpg"),
    "WEBP": ("image/webp", ".webp"),
}


def _upload_mb_from_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("[uploads] invalid %s, falling back to %s MB", name, default)
        return default
    if value < 1:
        logger.warning("[uploads] invalid %s=%s, falling back to %s MB", name, value, default)
        return default
    return value


def _int_from_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        logger.warning("[uploads] invalid %s, falling back to %s", name, default)
        return default
    return value if value > 0 else default


ALLOWED_DOC = {
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "text/markdown",
    "image/png", "image/jpeg",
}
MAX_IMAGE_UPLOAD_MB = _upload_mb_from_env("MAX_IMAGE_UPLOAD_MB", 50)
MAX_DOCUMENT_UPLOAD_MB = _upload_mb_from_env("MAX_DOCUMENT_UPLOAD_MB", 50)
MAX_VIDEO_UPLOAD_MB = _upload_mb_from_env("MAX_VIDEO_UPLOAD_MB", 1536)
MAX_ORIGINAL_UPLOAD_MB = _upload_mb_from_env("MAX_ORIGINAL_UPLOAD_MB", MAX_VIDEO_UPLOAD_MB)
MAX_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024  # images before re-encoding

# SVG bleibt gesperrt (Sicherheit); die Meldung sagt nur, was stattdessen geht (#1419). Feste Wörter, nie aus einer Ausnahme gebaut.
SVG_REFUSED_MESSAGE = (
    "SVG-Dateien gehen hier nicht. Bitte als PNG mit durchsichtigem Hintergrund (z. B. 2000 px breit) "
    "oder als WebP exportieren – die Website macht daraus alle Größen."
)


def looks_like_svg(suffix: str = "", content_type: str = "", head: bytes = b"") -> bool:
    """SVG nach Endung, Typ oder Anfang des Inhalts (``<svg`` oder ``<?xml``)."""
    if (suffix or "").strip().lower() == ".svg":
        return True
    if (content_type or "").split(";")[0].strip().lower() == "image/svg+xml":
        return True
    start = (head or b"")[:512].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    return start.startswith((b"<svg", b"<?xml"))
MAX_VIDEO_BYTES = MAX_VIDEO_UPLOAD_MB * 1024 * 1024
MAX_DOC_BYTES = MAX_DOCUMENT_UPLOAD_MB * 1024 * 1024  # docs
MAX_ORIGINAL_BYTES = MAX_ORIGINAL_UPLOAD_MB * 1024 * 1024
MAX_IMAGE_DIMENSION = _int_from_env("MAX_IMAGE_DIMENSION", 4096)
MAX_IMAGE_PIXELS = _int_from_env("MAX_IMAGE_PIXELS", 50_000_000)
ADMIN_UPLOAD_RATE_LIMIT = _int_from_env("ADMIN_UPLOAD_RATE_LIMIT", 240)
ADMIN_UPLOAD_RATE_WINDOW_SECONDS = _int_from_env("ADMIN_UPLOAD_RATE_WINDOW_SECONDS", 600)
USER_UPLOAD_RATE_LIMIT = _int_from_env("USER_UPLOAD_RATE_LIMIT", 30)
USER_UPLOAD_RATE_WINDOW_SECONDS = _int_from_env("USER_UPLOAD_RATE_WINDOW_SECONDS", 3600)
UPLOAD_EVENT_RETENTION_DAYS = _int_from_env("UPLOAD_EVENT_RETENTION_DAYS", 60)
UPLOAD_STREAM_CHUNK_BYTES = 1024 * 1024
VIDEO_SNIFF_BYTES = 4096
Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


async def _read_upload_limited(file: UploadFile, max_bytes: int, max_mb: int) -> bytes:
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail=f"Datei zu groß (max {max_mb} MB)")
    return data


async def _write_upload_stream_limited(
    file: UploadFile,
    path: pathlib.Path,
    first_chunk: bytes,
    max_bytes: int,
    max_mb: int,
) -> int:
    total = 0
    try:
        ensure_directory(path.parent)
        with path.open("wb") as out:
            if first_chunk:
                total += len(first_chunk)
                if total > max_bytes:
                    raise HTTPException(status_code=413, detail=f"Datei zu groß (max {max_mb} MB)")
                out.write(first_chunk)
            while True:
                chunk = await file.read(UPLOAD_STREAM_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(status_code=413, detail=f"Datei zu groß (max {max_mb} MB)")
                out.write(chunk)
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    except OSError as exc:
        path.unlink(missing_ok=True)
        logger.error("[uploads] failed to write stream %s: %s", path, exc)
        raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar. Bitte Docker-Volume/UPLOAD_DIR prüfen.")
    return total


def _resize_for_storage(img: Image.Image) -> tuple[Image.Image, bool]:
    if img.width <= MAX_IMAGE_DIMENSION and img.height <= MAX_IMAGE_DIMENSION:
        return img, False
    resized = img.copy()
    resized.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
    return resized, True


def _crop_with_padding(img: Image.Image, bbox: tuple[int, int, int, int] | None) -> tuple[Image.Image, bool]:
    if not bbox:
        return img, False
    left, top, right, bottom = bbox
    if left <= 0 and top <= 0 and right >= img.width and bottom >= img.height:
        return img, False
    crop_w = right - left
    crop_h = bottom - top
    if crop_w >= img.width * 0.97 and crop_h >= img.height * 0.97:
        return img, False
    pad = max(4, int(max(crop_w, crop_h) * 0.06))
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(img.width, right + pad)
    bottom = min(img.height, bottom + pad)
    return img.crop((left, top, right, bottom)), True


def _trim_empty_borders(img: Image.Image) -> tuple[Image.Image, bool]:
    """Crop transparent or flat-color whitespace around logos.

    This is intentionally conservative and only crops when the detected content
    is clearly smaller than the canvas.
    """
    rgba = img.convert("RGBA")
    alpha_mask = rgba.getchannel("A").point(lambda p: 255 if p > 8 else 0)
    alpha_bbox = alpha_mask.getbbox()
    if alpha_bbox:
        alpha_area = (alpha_bbox[2] - alpha_bbox[0]) * (alpha_bbox[3] - alpha_bbox[1])
        full_area = rgba.width * rgba.height
        if alpha_area < full_area * 0.92:
            return _crop_with_padding(rgba, alpha_bbox)

    bg = Image.new("RGBA", rgba.size, rgba.getpixel((0, 0)))
    diff = ImageChops.difference(rgba, bg)
    mask = diff.convert("L").point(lambda p: 255 if p > 18 else 0)
    return _crop_with_padding(rgba, mask.getbbox())


def _encode_image_bytes(
    data: bytes,
    declared_content_type: str,
    suffix: str,
    filename_hint: str,
    trim_empty_borders: bool = False,
) -> dict:
    """Check, rotate, shrink and re-encode an image without storing it.

    Public uploads and private chat attachments share this path, so both get the
    same format checks and pixel limits."""
    original_size = len(data)
    original_width = 0
    original_height = 0
    stored_width = 0
    stored_height = 0
    cutout = False
    try:
        with Image.open(BytesIO(data)) as img:
            img.verify()
        with Image.open(BytesIO(data)) as img:
            detected_format = (img.format or "").upper()
            if detected_format not in PIL_IMAGE_FORMATS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Nur PNG, JPG oder WebP erlaubt. Erkannt: {detected_format or declared_content_type or 'unbekannt'}",
                )
            if img.width * img.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Bildauflösung ist zu groß")
            original_width, original_height = img.width, img.height
            content_type, ext = PIL_IMAGE_FORMATS[detected_format]
            img = ImageOps.exif_transpose(img)
            if declared_content_type and declared_content_type not in ALLOWED_IMAGE:
                logger.info(
                    "[uploads] accepted image with browser content-type %s after detecting %s (%s)",
                    declared_content_type,
                    detected_format,
                    filename_hint,
                )
            elif suffix in IMAGE_MIME_BY_EXT and IMAGE_MIME_BY_EXT[suffix] != content_type:
                logger.info(
                    "[uploads] accepted image with mismatched suffix %s after detecting %s (%s)",
                    suffix,
                    detected_format,
                    filename_hint,
                )
            trimmed = False
            if trim_empty_borders:
                img, trimmed = _trim_empty_borders(img)
            img, resized = _resize_for_storage(img)
            output_format = img.format or detected_format
            if trimmed or resized or original_size > 12 * 1024 * 1024:
                output_format = "WEBP"
                content_type, ext = "image/webp", ".webp"
            out = BytesIO()
            save_kwargs = {}
            if output_format == "JPEG":
                img = img.convert("RGB")
                save_kwargs = {"quality": 88, "optimize": True}
            elif output_format == "PNG":
                img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
                save_kwargs = {"optimize": True}
            elif output_format == "WEBP":
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
                save_kwargs = {"quality": 88, "method": 6}
            stored_width, stored_height = img.width, img.height
            # Freigestellt (#1332): Vorstands-Porträts bekommen dann den Vereins-Hintergrund dahinter.
            cutout = is_cutout(img)
            img.save(out, format=output_format, **save_kwargs)
            data = out.getvalue()
    except UnidentifiedImageError:
        if looks_like_svg(suffix, declared_content_type, data):
            raise HTTPException(status_code=400, detail=SVG_REFUSED_MESSAGE)
        raise HTTPException(status_code=400, detail="Ungültige Bilddatei")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("[uploads] image processing failed: %s", exc)
        raise HTTPException(status_code=400, detail="Bild konnte nicht verarbeitet werden. Bitte PNG, JPG oder WebP erneut exportieren.")
    return {
        "data": data,
        "content_type": content_type,
        "ext": ext,
        "original_size": original_size,
        "original_width": original_width,
        "original_height": original_height,
        "width": stored_width,
        "height": stored_height,
        "cutout": cutout,
    }


def _detect_video_upload(data: bytes, declared_content_type: str, suffix: str) -> tuple[str, str]:
    """Return (content_type, extension) after lightweight container sniffing."""
    declared = (declared_content_type or "").split(";")[0].strip().lower()
    declared_video = VIDEO_MIME_ALIASES.get(declared, declared)
    suffix = (suffix or "").lower()
    if data.startswith(b"\x1a\x45\xdf\xa3"):
        return "video/webm", ".webm"
    ftyp_at = data[:512].find(b"ftyp")
    if ftyp_at >= 4 and len(data) >= ftyp_at + 8:
        major_brand = data[ftyp_at + 4:ftyp_at + 8].lower()
        if suffix == ".mov" or major_brand == b"qt  ":
            return "video/quicktime", ".mov"
        if suffix == ".m4v" or declared in {"video/x-m4v", "video/m4v"}:
            return "video/mp4", ".m4v"
        return "video/mp4", ".mp4"
    if suffix in VIDEO_MIME_BY_EXT:
        return VIDEO_MIME_BY_EXT[suffix], suffix
    if declared_video in ALLOWED_VIDEO:
        return declared_video, VIDEO_EXT_BY_MIME.get(declared_video) or ".mp4"
    detail = f"Nur {SUPPORTED_VIDEO_LABEL} erlaubt."
    if suffix or declared:
        detail += f" Erkannt: {suffix or 'keine Dateiendung'} / {declared_content_type or 'unbekannt'}."
    raise HTTPException(status_code=400, detail=detail)
