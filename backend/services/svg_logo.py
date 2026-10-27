"""Logos als SVG (#1952): sicher bereinigt, scharf im Web, als PNG für alles, was kein SVG kann.

Die Bereinigung ist der gemeinsame Baustein ``services/svg_safe.py`` (#2069, auch für die Shop-Motive): Positivliste,
``defusedxml``, Grenzen und das Zeichnen mit ``resvg`` in einem eigenen Prozess. Das Branding nutzt ihn bis zum Umbau der
Logo-Felder (#2073) **nachsichtig** (``strict=False``): Gefährliches fällt still weg, der Rest bleibt. Gespeichert wird
nur die neu geschriebene Fassung, nie die hochgeladene Datei.

Hier steht, was nur die Logos brauchen: Zuschnitt auf das Sichtbare, die Rasterfassung (PNG neben dem SVG, gleicher
Name) für Mails, PDF, Teilen-Bilder, Discord, Favicons und die App (``raster_url``) und die Regel „SVG nur in
Logo-Feldern“ (``SvgFieldGate``).
"""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

from defusedxml.ElementTree import fromstring as parse_xml

from services import svg_safe
from services.svg_safe import (  # noqa: F401 - die Namen bleiben hier erreichbar (Routen, Tests, ältere Aufrufer)
    BUSY, INTRINSIC_PX, MAX_DEPTH, MAX_ELEMENTS, MAX_LAYERS, MAX_PATH_NUMBERS, MAX_SVG_BYTES, MAX_SVG_UPLOAD_MB,
    MESSAGES, NO_DRAW, NO_DTD, NO_SIZE, NOT_SVG, NOTHING, RASTER_PX, STATUS, TOO_BIG, TOO_COMPLEX, TOO_DEEP, TOO_MANY,
    CleanSvg, SvgRejected, png_bytes,
)
from storage import PUBLIC_UPLOAD_DIR, ensure_directory


def _int_env(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if low <= value <= high else default


# SVG-Uploads je Konto und Zeitfenster (zusätzlich zur Grenze für Bilder).
SVG_UPLOAD_RATE_LIMIT = _int_env("SVG_UPLOAD_RATE_LIMIT", 20, 1, 1000)
SVG_UPLOAD_RATE_WINDOW_SECONDS = _int_env("SVG_UPLOAD_RATE_WINDOW_SECONDS", 3600, 60, 86400)

# Kopfzeilen beim Ausliefern (Backend und nginx): kein Raten des Typs, und wird die Datei direkt geöffnet, darf darin
# nichts laden oder laufen - nur Zeichnen und Stil.
SERVE_CSP = "default-src 'none'; style-src 'unsafe-inline'"
SERVE_HEADERS = {"Content-Security-Policy": SERVE_CSP, "X-Content-Type-Options": "nosniff"}

FIELD_REFUSED = "SVG geht nur in Logo-Feldern. Für Fotos, Banner und Profilbilder bitte PNG, JPG oder WebP."
# Das Branding bleibt bis #2073 nachsichtig: Gefährliches fällt weg, statt das Logo abzulehnen.
STRICT = False


def sanitize(data: bytes) -> CleanSvg:
    """Das hochgeladene Logo, neu geschrieben aus der Positivliste (``svg_safe``) - oder ``SvgRejected``."""
    return svg_safe.sanitize(data, strict=STRICT)


def _trim_box(image) -> tuple[int, int, int, int] | None:
    """Der sichtbare Teil mit etwas Rand, wenn er deutlich kleiner ist als das Bild (wie beim Zuschneiden der
    Raster-Logos) - sonst ``None``."""
    bbox = image.getchannel("A").point(lambda p: 255 if p > 8 else 0).getbbox()
    if not bbox:
        return None
    left, top, right, bottom = bbox
    width, height = right - left, bottom - top
    if width * height >= image.width * image.height * 0.92:
        return None
    pad = max(4, int(max(width, height) * 0.06))
    return max(0, left - pad), max(0, top - pad), min(image.width, right + pad), min(image.height, bottom + pad)


def prepare(data: bytes, *, trim: bool) -> tuple[CleanSvg, bytes]:
    """Bereinigen und **einmal** zeichnen: Aus dem einen Bild mit ``RASTER_PX`` an der längeren Seite kommen die Prüfung
    auf Sichtbares, der Zuschnitt (neue viewBox) und die PNG-Fassung."""
    root, view_box = svg_safe.clean_tree(data, strict=STRICT)
    clean = svg_safe._serialize(root, view_box)
    image = svg_safe.render_rgba(clean.data, view_box, RASTER_PX)
    if image.getchannel("A").getbbox() is None:
        raise SvgRejected("nothing")
    if trim:
        box = _trim_box(image)
        if box:
            left, top, right, bottom = box
            x, y, w, h = view_box
            sx, sy = w / image.width, h / image.height
            clean = svg_safe._serialize(root, (x + left * sx, y + top * sy, (right - left) * sx, (bottom - top) * sy))
            image = image.crop(box)
    return clean, png_bytes(image)


def raster_png(data: bytes, long_side: int | None = None) -> bytes:
    """Die PNG-Fassung eines bereinigten SVG, die längere Seite ``long_side`` (Vorgabe ``RASTER_PX``) Pixel."""
    root = parse_xml(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    view_box = tuple(float(value) for value in root.get("viewBox").split())
    return png_bytes(svg_safe.render_rgba(data, view_box, long_side or RASTER_PX))


def store(data: bytes, *, trim: bool, directory: Path | None = None) -> dict:
    """Bereinigen, einmal zeichnen und beides ablegen: ``<zufall>.svg`` und daneben ``<zufall>.png``."""
    clean, png = prepare(data, trim=trim)
    folder = directory or PUBLIC_UPLOAD_DIR
    ensure_directory(folder)
    stem = uuid.uuid4().hex
    svg_path, png_path = folder / f"{stem}.svg", folder / f"{stem}.png"
    svg_path.write_bytes(clean.data)
    png_path.write_bytes(png)
    return {
        "filename": svg_path.name, "path": svg_path, "size": len(clean.data), "width": clean.width,
        "height": clean.height, "raster_filename": png_path.name, "raster_path": png_path, "raster_size": len(png),
    }


# ---------------------------------------------------------------- PNG-Fassung für Stellen ohne SVG

_UPLOAD_SVG = re.compile(r"/api/static/uploads/([A-Za-z0-9][A-Za-z0-9_-]{0,150})\.svg(?![A-Za-z0-9_])")
_UPLOAD_SVG_BYTES = re.compile(rb"/api/static/uploads/([A-Za-z0-9][A-Za-z0-9_-]{0,150})\.svg(?![A-Za-z0-9_])")
_UPLOAD_PNG = re.compile(r"/api/static/uploads/([A-Za-z0-9][A-Za-z0-9_-]{0,150})\.png")


def _has_raster(stem: str) -> bool:
    # Der Name kommt aus einer Adresse: nur eine Datei direkt im Upload-Ordner zählt.
    base = os.path.realpath(PUBLIC_UPLOAD_DIR)
    candidate = os.path.realpath(os.path.join(base, f"{stem}.png"))
    if not candidate.startswith(base + os.sep):
        return False
    return os.path.isfile(candidate)


def raster_url(value):
    """Die Adresse der PNG-Fassung, wenn ``value`` ein hochgeladenes SVG mit Rasterfassung ist - sonst ``value``."""
    if not isinstance(value, str) or ".svg" not in value:
        return value
    path = urlparse(value).path
    match = _UPLOAD_SVG.fullmatch(path)
    if not match or not _has_raster(match.group(1)):
        return value
    return value.replace(path, f"{path[:-4]}.png", 1)


def raster_urls_in_text(text):
    """Jede SVG-Adresse eines Uploads in einem Text (Mail, Seite) durch ihre PNG-Fassung ersetzt."""
    if not isinstance(text, str) or ".svg" not in text:
        return text
    return _UPLOAD_SVG.sub(lambda m: f"{m.group(0)[:-4]}.png" if _has_raster(m.group(1)) else m.group(0), text)


def raster_urls_in_bytes(body: bytes) -> bytes:
    if b".svg" not in body:
        return body
    return _UPLOAD_SVG_BYTES.sub(
        lambda m: m.group(0)[:-4] + b".png" if _has_raster(m.group(1).decode("ascii")) else m.group(0), body)


def raster_path(path: Path | None) -> Path | None:
    """Für eine SVG-Datei die PNG daneben (``None``, wenn es keine gibt); jede andere Datei bleibt."""
    if path is None or path.suffix.lower() != ".svg":
        return path
    sibling = path.with_suffix(".png")
    return sibling if sibling.is_file() else None


def client_is_app(headers) -> bool:
    """Die LionsAPP (bis sie SVG kann): Kopfzeile ``X-LionsApp`` (künftige Fassungen) oder die Kennung ihres
    Netzwerk-Bausteins (``User-Agent: okhttp/…``, so meldet sich die Android-App heute). Nur sie bekommt in Antworten
    auf GET-Abrufe die PNG-Fassung; Browser und alle anderen bekommen die gespeicherte Adresse."""
    lowered = {str(key).lower(): str(value) for key, value in headers.items()}
    return "x-lionsapp" in lowered or lowered.get("user-agent", "").lower().startswith("okhttp/")


# ---------------------------------------------------------------- SVG nur in Logo-Feldern

# Die Felder, in denen ein SVG-Logo stehen darf - überall gleich benannt: Branding, Sponsoren, Partner, Spiele, Teams,
# Spur und Saison einer Serie.
LOGO_FIELDS = frozenset({
    "logo_url", "logo_dark_url", "logo_light_url", "mascot_url", "qr_logo_url",
    "favicon_url", "favicon_light_url", "favicon_dark_url",
})


def _compact(value: str) -> str:
    """Für den Vergleich: mehrfach URL-dekodiert (höchstens viermal), ohne Leerraum und Steuerzeichen, klein."""
    text = value
    for _ in range(4):
        decoded = unquote(text)
        if decoded == text:
            break
        text = decoded
    return "".join(ch for ch in text if not ch.isspace() and ord(ch) >= 32 and ch != "\x7f").lower()


def _is_logo_svg_upload(path: str) -> bool:
    """Zeigt der (schon dekodierte) Pfad auf ein SVG-Logo aus dem Logo-Upload - die Datei liegt bei den Uploads und
    hat ihre PNG-Fassung daneben? Ältere SVG-Dateien ohne PNG (aus der früheren Bild-Migration) zählen nicht."""
    if "uploads/" not in path:
        return False
    name = path.rsplit("/", 1)[-1]
    if not name.endswith(".svg") or name.startswith("."):
        return False
    return (PUBLIC_UPLOAD_DIR / name).is_file() and (PUBLIC_UPLOAD_DIR / f"{name[:-4]}.png").is_file()


def _refused_outside_logo(value: str) -> bool:
    """Ein Bildfeld außerhalb der Logo-Felder darf kein SVG tragen: weder ein SVG-Logo aus dem Upload (auch kodiert,
    groß geschrieben, mit Zusatz) noch eine data-URI mit SVG. Geprüft werden nur Werte, die ganz aus einer Adresse
    bestehen; ein längerer Text (etwa Markdown mit Bild) bleibt, wie er ist - dort steht ein Bild nur über ``<img>``."""
    stripped = value.strip()
    # Browser lesen „\“ in Adressen wie „/“.
    compact = _compact(stripped).replace("\\", "/")
    if compact.startswith("data:"):
        return compact.startswith("data:image/svg")
    if not stripped or any(ch.isspace() for ch in stripped):
        return False
    target = compact.split("#", 1)[0].split("?", 1)[0]
    if "://" in target:
        target = target.split("://", 1)[1]
        target = target[target.find("/"):] if "/" in target else ""
    return _is_logo_svg_upload(target)


def vector_url(value: str) -> str:
    """Ist ``value`` die PNG-Fassung eines gespeicherten SVG-Logos (gleicher Name daneben), die Adresse des SVG -
    sonst ``value``. So bleibt das SVG, wenn ein Formular (etwa die App) die PNG zurückschickt."""
    path = urlparse(value).path
    match = _UPLOAD_PNG.fullmatch(path)
    if not match or not (PUBLIC_UPLOAD_DIR / f"{match.group(1)}.svg").is_file():
        return value
    return value.replace(path, f"{path[:-4]}.svg", 1)


INLINE_REFUSED = ("Logos bitte über „Hochladen“ oder die Mediathek wählen - eingebettete Bilddaten (data:) gehen hier "
                  "nicht.")
REFUSED_MESSAGES = {"svg": FIELD_REFUSED, "inline": INLINE_REFUSED}


class FieldRefused(ValueError):
    """Ein Wert, den ein Feld nicht nehmen darf: ``kind`` „svg“ (SVG außerhalb eines Logo-Felds) oder „inline“
    (eingebettete Bilddaten in einem Logo-Feld)."""

    def __init__(self, key, kind: str = "svg"):
        super().__init__(key)
        self.kind = kind if kind in REFUSED_MESSAGES else "svg"


def _gate_value(value, key, state):
    if isinstance(value, dict):
        return {name: _gate_value(inner, name, state) for name, inner in value.items()}
    if isinstance(value, list):
        return [_gate_value(inner, key, state) for inner in value]
    if not isinstance(value, str):
        return value
    if key in LOGO_FIELDS:
        # Logos kommen nur über die Upload-Routen (bereinigt, mit PNG-Fassung) - nie als eingebettete data-URI. Über
        # die Oberfläche entsteht so ein Wert nicht; die Felder tragen Upload- oder Web-Adressen.
        if _compact(value.strip()).startswith("data:"):
            raise FieldRefused(key, "inline")
        kept = vector_url(value) if ".png" in value else value
        if kept != value:
            state["changed"] = True
        return kept
    if _refused_outside_logo(value):
        raise FieldRefused(key)
    return value


def gate_json_body(body: bytes) -> bytes | None:
    """Prüft einen JSON-Körper vor dem Speichern: ein SVG-Logo nur in ``LOGO_FIELDS``, eine SVG-data-URI nirgends und in
    Logo-Feldern überhaupt keine data-URI, sonst ``FieldRefused``; die PNG-Fassung eines SVG-Logos in einem Logo-Feld
    wird wieder das SVG. Liefert den geänderten
    Körper oder ``None``, wenn nichts zu ändern ist (auch bei ungültigem JSON - das meldet die Route selbst)."""
    try:
        payload = json.loads(body)
    except ValueError:
        return None
    state = {"changed": False}
    result = _gate_value(payload, None, state)
    return json.dumps(result, ensure_ascii=False).encode("utf-8") if state["changed"] else None


# Wie viel JSON der Baustein vor der Route liest - darüber 413. Routen mit eigener Grenze, die den Körper selbst
# streamen (Webhooks der Integrationen, Ergebnis- und Original-Bilder einer Serie), lässt er ganz aus; sie speichern
# keine Bildfelder. Uploads (multipart) liest er nie.
JSON_BODY_MAX_BYTES = _int_env("JSON_BODY_MAX_KB", 4096, 64, 65536) * 1024
GATE_SKIPPED = (
    re.compile(r"/api/integrations/[^?#]*"),
    re.compile(r"/api/reference-series/admin/series/[^/]+/"
               r"(?:rounds/[^/]+/(?:results/image|originals)|season-table/image)"),
)
TOO_LARGE = "Die Anfrage ist zu groß."


class SvgFieldGate:
    """ASGI-Baustein vor allen Routen: jeder JSON-Körper von POST, PUT und PATCH unter ``/api/`` (bis
    ``JSON_BODY_MAX_BYTES``) geht durch ``gate_json_body`` - ein SVG außerhalb eines Logo-Felds bekommt 422, bevor eine
    Route etwas speichert."""

    METHODS = frozenset({"POST", "PUT", "PATCH"})

    def __init__(self, app):
        self.app = app

    @staticmethod
    async def _answer(scope, receive, send, status: int, detail: str):
        from starlette.responses import JSONResponse

        await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)

    async def __call__(self, scope, receive, send):
        path = str(scope.get("path") or "")
        if (scope.get("type") != "http" or scope.get("method") not in self.METHODS or not path.startswith("/api/")
                or any(pattern.fullmatch(path) for pattern in GATE_SKIPPED)):
            return await self.app(scope, receive, send)
        headers = scope.get("headers") or []
        content_type = next((value for key, value in headers if key.lower() == b"content-type"), b"")
        if b"json" not in content_type.lower():
            return await self.app(scope, receive, send)
        declared = next((value for key, value in headers if key.lower() == b"content-length"), b"")
        if declared.strip().isdigit() and int(declared) > JSON_BODY_MAX_BYTES:
            return await self._answer(scope, receive, send, 413, TOO_LARGE)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message.get("type") != "http.request":
                return None  # Verbindung weg
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > JSON_BODY_MAX_BYTES:
                return await self._answer(scope, receive, send, 413, TOO_LARGE)
            chunks.append(chunk)
            if not message.get("more_body"):
                break
        body = b"".join(chunks)
        try:
            changed = gate_json_body(body)
        except FieldRefused as refused:
            return await self._answer(scope, receive, send, 422, REFUSED_MESSAGES[refused.kind])
        if changed is not None:
            body = changed
            scope = {**scope, "headers": [(key, value) for key, value in headers if key.lower() != b"content-length"]
                     + [(b"content-length", str(len(body)).encode("ascii"))]}
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        return await self.app(scope, replay, send)
