"""Shared media format registry for uploads, serving and media audits."""

BROWSER_IMAGE_MIME_BY_EXT = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

PUBLIC_IMAGE_MIME_BY_EXT = {
    **BROWSER_IMAGE_MIME_BY_EXT,
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
}

RAW_PHOTO_MIME_BY_EXT = {
    ".nef": "image/x-nikon-nef",
    ".nrw": "image/x-nikon-nrw",
    ".cr2": "image/x-canon-cr2",
    ".cr3": "image/x-canon-cr3",
    ".arw": "image/x-sony-arw",
    ".dng": "image/x-adobe-dng",
    ".raf": "image/x-fuji-raf",
    ".orf": "image/x-olympus-orf",
    ".rw2": "image/x-panasonic-rw2",
    ".pef": "image/x-pentax-pef",
    ".srw": "image/x-samsung-srw",
    ".rwl": "image/x-leica-rwl",
    ".3fr": "image/x-hasselblad-3fr",
    ".erf": "image/x-epson-erf",
    ".kdc": "image/x-kodak-kdc",
    ".dcr": "image/x-kodak-dcr",
    ".mos": "image/x-leaf-mos",
    ".raw": "image/x-raw",
}

ORIGINAL_IMAGE_MIME_BY_EXT = {
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
}

PLAYABLE_VIDEO_MIME_BY_EXT = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
}

PLAYABLE_VIDEO_MIME_ALIASES = {
    "application/mp4": "video/mp4",
    "application/quicktime": "video/quicktime",
    "video/m4v": "video/mp4",
    "video/x-quicktime": "video/quicktime",
}

ORIGINAL_VIDEO_MIME_BY_EXT = {
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".mts": "video/mp2t",
    ".m2ts": "video/mp2t",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".3gp": "video/3gpp",
    ".3g2": "video/3gpp2",
    ".wmv": "video/x-ms-wmv",
    ".mxf": "application/mxf",
    ".mvo": "application/octet-stream",
}

SIDECAR_MEDIA_MIME_BY_EXT = {
    ".xmp": "application/octet-stream",
}

ORIGINAL_MEDIA_MIME_BY_EXT = {
    **RAW_PHOTO_MIME_BY_EXT,
    **ORIGINAL_IMAGE_MIME_BY_EXT,
    **ORIGINAL_VIDEO_MIME_BY_EXT,
    **SIDECAR_MEDIA_MIME_BY_EXT,
}

PUBLIC_IMAGE_EXTS = set(PUBLIC_IMAGE_MIME_BY_EXT)
PUBLIC_VIDEO_EXTS = set(PLAYABLE_VIDEO_MIME_BY_EXT)
PUBLIC_ORIGINAL_EXTS = set(ORIGINAL_MEDIA_MIME_BY_EXT)
PUBLIC_MEDIA_EXTS = PUBLIC_IMAGE_EXTS | PUBLIC_VIDEO_EXTS | PUBLIC_ORIGINAL_EXTS
PUBLIC_MEDIA_TYPES = {
    **PUBLIC_IMAGE_MIME_BY_EXT,
    **PLAYABLE_VIDEO_MIME_BY_EXT,
    **ORIGINAL_MEDIA_MIME_BY_EXT,
}
VIDEO_MEDIA_EXTS = PUBLIC_VIDEO_EXTS

ORIGINAL_MEDIA_LABEL = "RAW/HEIC/TIFF/GIF/AVIF/BMP, XMP oder Kamera-/Video-Originale wie AVI/MKV/MTS"
