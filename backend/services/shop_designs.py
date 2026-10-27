"""Druckdateien des Vereins (#1708): Upload, Prüfung je Platzierung, Versionen und die Adresse für Printful.

Käufer laden nie etwas hoch - nur die Finanzen (Route ``routes/shop_design_routes.py``, ``require_area("finance")`` mit
Zwei-Faktor), immer mit Grund und Protokoll. Beschreibung: ``docs/SHOP.md``, Abschnitt „Designs und Druckdateien“.

Der Weg einer Datei:

1. **Neu kodiert.** Nur PNG oder JPG (SVG, WebP, GIF, PDF … nie). Pillow liest die Pixel, ein Farbprofil wird nach sRGB
   umgerechnet, dann entsteht aus den nackten Pixeln ein neues PNG - ohne EXIF, Texte, Profile oder sonst etwas aus der
   Originaldatei. Transparenz bleibt. Animierte Bilder und 16-Bit-Graustufen werden abgelehnt.
2. **Geprüft je Platzierung.** Die Druckbreite in Zoll ist eine einstellbare Vorgabe je Platzierung
   (``placement_specs``, Dokument ``settings`` mit ``id = "shop_design_placements"``), ebenso Druckbereich und
   Mindest-DPI. DPI = Pixelbreite / Druckbreite. Zu wenig DPI oder zu hoch für den Druckbereich: abgelehnt, mit Text in
   Zoll und cm.
3. **Als neue Version gespeichert.** Jede Datei bekommt eine neue Versionsnummer (``shop_catalog.add_design_version``),
   eine Prüfsumme (SHA-256 der gespeicherten Datei), einen eigenen Dateinamen auf der Platte und einen eigenen
   Zufallsschlüssel. Nichts wird überschrieben; alte Versionen bleiben für ihre Bestellungen abrufbar.
4. **Öffentlich nur über den Schlüssel.** ``/api/shop/print-files/<public_id>/<design>-v<version>.png`` - der Schlüssel
   hat 256 Bit Zufall (``secrets.token_urlsafe(32)``), es gibt keine Liste und keine Aufzählung; alles Unbekannte ist
   404. Ausgeliefert wird nur die fertige Druckdatei, nie ein Original.

Die Zuordnung Design ↔ Shirtfarbe steht am Design (``shop_design_profiles.garment_colors``): je Platzierung gehört eine
Farbe zu höchstens einem Design - ``design_for_color`` liefert der Produktverwaltung (#1707) das passende.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import math
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageCms, UnidentifiedImageError
from pymongo.errors import DuplicateKeyError

import storage
from models import now_utc
from services import shop_catalog
from services.image_upload import looks_like_svg
from services.shop_common import ShopConflict, ShopError, clean_reason, record_admin_action

logger = logging.getLogger("tls-arena.shop-designs")

# ---------------------------------------------------------------- Platzierungen und Druckbereiche

PLACEMENT_LABELS: dict[str, str] = {
    "front_right": "Brust rechts (vom Träger aus) – Löwe",
    "front_left": "Brust links (vom Träger aus) – Namensfeld",
    "back": "Rücken",
    "front": "Vorderseite groß",
    "sleeve_left": "Ärmel links",
    "sleeve_right": "Ärmel rechts",
    "label": "Innenetikett",
}
# Vorgaben, bis die Finanzen sie ändern. Löwe vorne 3,5 Zoll aus dem Testshirt (15.10.2026); die Druckbereiche sind
# vorsichtig gewählt und mit Printful zu bestätigen (#1700). Printful nimmt ab 150 DPI, der Verein verlangt 300.
DEFAULT_SPECS: dict[str, dict[str, float | int]] = {
    "front_right": {"print_width_in": 3.5, "area_width_in": 5.0, "area_height_in": 5.0, "min_dpi": 300},
    "front_left": {"print_width_in": 3.5, "area_width_in": 5.0, "area_height_in": 5.0, "min_dpi": 300},
    "back": {"print_width_in": 10.0, "area_width_in": 12.0, "area_height_in": 16.0, "min_dpi": 300},
    "front": {"print_width_in": 10.0, "area_width_in": 12.0, "area_height_in": 16.0, "min_dpi": 300},
    "sleeve_left": {"print_width_in": 3.0, "area_width_in": 3.5, "area_height_in": 3.5, "min_dpi": 300},
    "sleeve_right": {"print_width_in": 3.0, "area_width_in": 3.5, "area_height_in": 3.5, "min_dpi": 300},
    "label": {"print_width_in": 2.5, "area_width_in": 3.0, "area_height_in": 3.0, "min_dpi": 300},
}
SPEC_FIELDS = ("print_width_in", "area_width_in", "area_height_in", "min_dpi")
MIN_INCHES, MAX_INCHES = 0.5, 25.0
MIN_DPI, MAX_DPI = 72, 600
SNUG_FACTOR = 1.2  # unter 120 % der Mindest-DPI zeigt die Ampel „knapp“
PLACEMENT_SETTINGS_ID = "shop_design_placements"
CM_PER_INCH = 2.54


def _number(value: float, digits: int) -> str:
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def inches(value: float) -> str:
    """„3,5 Zoll (8,9 cm)“ - im Admin immer beides."""
    return f"{_number(value, 2)} Zoll ({_number(value * CM_PER_INCH, 1)} cm)"


def _spec_value(name: str, value: Any) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ShopError("Maße als Zahl angeben.")
    if name == "min_dpi":
        if int(value) != value or not MIN_DPI <= value <= MAX_DPI:
            raise ShopError(f"Mindest-DPI: ganze Zahl von {MIN_DPI} bis {MAX_DPI}.")
        return int(value)
    if not MIN_INCHES <= value <= MAX_INCHES:
        raise ShopError(f"Maße in Zoll von {_number(MIN_INCHES, 1)} bis {_number(MAX_INCHES, 1)}.")
    return round(float(value), 3)


def _valid_spec(raw: Any) -> dict | None:
    """Eine gespeicherte Vorgabe - oder ``None``, wenn sie unvollständig oder unsinnig ist (dann gilt die Vorgabe)."""
    if not isinstance(raw, dict):
        return None
    try:
        spec = {name: _spec_value(name, raw.get(name)) for name in SPEC_FIELDS}
    except ShopError:
        return None
    return spec if spec["print_width_in"] <= spec["area_width_in"] else None


def _spec_view(placement: str, spec: dict) -> dict:
    return {"key": placement, "label": PLACEMENT_LABELS[placement], **spec,
            "print_width": inches(spec["print_width_in"]), "area_width": inches(spec["area_width_in"]),
            "area_height": inches(spec["area_height_in"]),
            "min_width_px": math.ceil(spec["print_width_in"] * spec["min_dpi"] - 1e-9),
            "is_default": spec == {name: DEFAULT_SPECS[placement][name] for name in SPEC_FIELDS}}


async def placement_specs(db) -> dict[str, dict]:
    """Je Platzierung die geltende Vorgabe (gespeichert oder Vorgabe), mit Bezeichnung und Maßen in Zoll und cm."""
    doc = await db.settings.find_one({"id": PLACEMENT_SETTINGS_ID}, {"_id": 0}) or {}
    stored = doc.get("placements") or {}
    out = {}
    for placement in shop_catalog.PLACEMENTS:
        spec = _valid_spec(stored.get(placement)) or dict(DEFAULT_SPECS[placement])
        out[placement] = _spec_view(placement, spec)
    return out


async def set_placement(db, placement: str, fields: dict, *, actor_id: str, reason: Any) -> tuple[dict, list[str]]:
    """Druckbreite, Druckbereich und Mindest-DPI einer Platzierung ändern - mit Grund, vorher/nachher im Protokoll.
    Bestehende Versionen behalten die Maße, mit denen sie geprüft wurden; die Ampel rechnet mit der neuen Vorgabe."""
    if placement not in shop_catalog.PLACEMENTS:
        raise LookupError("Unbekannte Platzierung.")
    unknown = sorted(set(fields) - set(SPEC_FIELDS))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    reason = clean_reason(reason)
    current = (await placement_specs(db))[placement]
    before = {name: current[name] for name in SPEC_FIELDS}
    after = {**before, **{name: _spec_value(name, value) for name, value in fields.items()}}
    if after["print_width_in"] > after["area_width_in"]:
        raise ShopError(f"Die Druckbreite ({inches(after['print_width_in'])}) ist breiter als der Druckbereich "
                        f"({inches(after['area_width_in'])}).")
    changed = [name for name in SPEC_FIELDS if after[name] != before[name]]
    if not changed:
        return current, []
    await db.settings.update_one(
        {"id": PLACEMENT_SETTINGS_ID},
        {"$set": {"id": PLACEMENT_SETTINGS_ID, f"placements.{placement}": after, "updated_at": now_utc().isoformat(),
                  "updated_by": actor_id}},
        upsert=True)
    await record_admin_action(db, "shop.design.placement", actor_id=actor_id, target_id=placement, reason=reason,
                              data={"before": {name: before[name] for name in changed},
                                    "after": {name: after[name] for name in changed}})
    return _spec_view(placement, after), changed


def check_fit(width_px: int, height_px: int, spec: dict) -> dict:
    """DPI und Höhe einer Datei bei der Druckbreite der Platzierung - mit Ampel und Texten in Zoll und cm."""
    width_in = float(spec["print_width_in"])
    dpi = width_px / width_in
    height_in = height_px / dpi
    problems = []
    if dpi < spec["min_dpi"]:
        needed = math.ceil(width_in * spec["min_dpi"] - 1e-9)
        problems.append(f"Zu wenig Auflösung: bei {inches(width_in)} Breite hat die Datei nur {int(dpi)} DPI, nötig "
                        f"sind {spec['min_dpi']}. Dafür braucht sie mindestens {needed} Pixel Breite, sie hat "
                        f"{width_px}.")
    if height_in > float(spec["area_height_in"]) + 1e-6:
        problems.append(f"Zu hoch für den Druckbereich: bei {inches(width_in)} Breite wird das Motiv "
                        f"{inches(height_in)} hoch, erlaubt sind {inches(float(spec['area_height_in']))}.")
    if problems:
        level, text = "too_low", " ".join(problems)
    elif dpi < spec["min_dpi"] * SNUG_FACTOR:
        level, text = "snug", f"Knapp: {int(dpi)} DPI bei {inches(width_in)}, nötig sind {spec['min_dpi']}."
    else:
        level, text = "good", f"Gut: {int(dpi)} DPI bei {inches(width_in)}."
    return {"dpi": round(dpi, 1), "print_width_in": round(width_in, 3), "print_height_in": round(height_in, 3),
            "level": level, "text": text, "problems": problems}


# ---------------------------------------------------------------- Bild prüfen und neu kodieren

def _mb_from_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


MAX_UPLOAD_MB = _mb_from_env("SHOP_DESIGN_MAX_MB", 50)
MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024
FORM_OVERHEAD_BYTES = 256 * 1024  # Grund, Titel, Farben und die Trennzeilen des Formulars


def upload_body_limit() -> tuple[int, str]:
    """Für ``services/body_limits.BodySizeLimit``: höchstens so viel nimmt die Upload-Route am Eingang an."""
    return MAX_BYTES + FORM_OVERHEAD_BYTES, f"Datei zu groß (höchstens {MAX_UPLOAD_MB} MB)."


# 12 × 16 Zoll bei 300 DPI sind gut 17 Millionen; 40 Millionen lassen Luft und halten den Speicher beim Neukodieren
# (RGBA: 4 Byte je Pixel, zwei Bilder gleichzeitig) unter etwa 350 MB.
MAX_PIXELS = 40_000_000
ONLY_PNG_JPG = "Druckdateien nur als PNG (am besten mit durchsichtigem Hintergrund) oder JPG."
SVG_REFUSED = ("SVG geht für Druckdateien nicht. Bitte als PNG mit durchsichtigem Hintergrund exportieren - "
               "breit genug für 300 DPI bei der Druckbreite.")
UNREADABLE = "Die Datei ließ sich nicht als Bild lesen. Bitte als PNG neu exportieren."
BAD_PROFILE = "Das Farbprofil der Datei lässt sich nicht nach sRGB umrechnen. Bitte als PNG in sRGB exportieren."
_SRGB = ImageCms.createProfile("sRGB")


def _has_transparency_info(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA", "La", "RGBa") or "transparency" in img.info


def _to_srgb(img: Image.Image, icc: bytes) -> Image.Image:
    """Farben aus dem eingebetteten Profil nach sRGB - danach fällt das Profil mit allen anderen Metadaten weg."""
    alpha = img.getchannel("A") if img.mode == "RGBA" else None
    base = img.convert("RGB") if img.mode == "RGBA" else img
    try:
        source = ImageCms.ImageCmsProfile(BytesIO(icc))
        out = ImageCms.profileToProfile(base, source, _SRGB, outputMode="RGB")
    except (ImageCms.PyCMSError, OSError, ValueError, TypeError) as exc:
        raise ShopError(BAD_PROFILE) from exc
    if out is None:  # pragma: no cover - nur mit inPlace=True
        raise ShopError(BAD_PROFILE)
    if alpha is not None:
        out.putalpha(alpha)
    return out


def _normalized(img: Image.Image) -> Image.Image:
    if img.mode in ("I", "I;16", "I;16B", "I;16L", "I;16N", "F"):
        raise ShopError("16-Bit- bzw. Gleitkomma-Bilder gehen nicht. Bitte als 8-Bit-PNG (RGB oder RGBA) exportieren.")
    icc = img.info.get("icc_profile")
    if _has_transparency_info(img):
        img = img.convert("RGBA")
    elif img.mode not in ("RGB", "CMYK", "L"):
        img = img.convert("RGB")
    if icc:
        img = _to_srgb(img, icc)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    return img


def prepare(data: bytes, filename: str = "", content_type: str = "") -> tuple[Image.Image, str]:
    """Liest das Bild und liefert nackte Pixel (RGB oder RGBA, sRGB) samt erkanntem Format. Lehnt alles andere ab -
    mit einem Text für die Finanzen, nie mit einer Ausnahme der Bibliothek."""
    suffix = Path(filename or "").suffix.lower()
    if looks_like_svg(suffix, content_type or "", data[:8192]):
        raise ShopError(SVG_REFUSED)
    try:
        with Image.open(BytesIO(data)) as probe:
            detected = (probe.format or "").upper()
            if detected not in ("PNG", "JPEG"):
                raise ShopError(f"{ONLY_PNG_JPG} Erkannt: {detected or 'unbekannt'}.")
            if probe.width * probe.height > MAX_PIXELS:
                raise ShopError(f"Zu viele Pixel ({probe.width} × {probe.height}) - höchstens "
                                f"{MAX_PIXELS // 1_000_000} Millionen.")
            probe.verify()
        with Image.open(BytesIO(data)) as img:
            if getattr(img, "n_frames", 1) > 1:
                raise ShopError("Animierte Bilder gehen nicht - bitte ein einzelnes PNG.")
            img.load()
            pixels = _normalized(img)
            # Ein neues, leeres Bild mit den Pixeln: so kommt nichts aus der Originaldatei mit (EXIF, Texte, Profile,
            # Anhänge) - ``Image.new`` kennt keine Metadaten, ``paste`` kopiert nur Pixel.
            clean = Image.new(pixels.mode, pixels.size)
            clean.paste(pixels)
            del pixels
    except ShopError:
        raise
    except Image.DecompressionBombError as exc:
        raise ShopError(f"Zu viele Pixel - höchstens {MAX_PIXELS // 1_000_000} Millionen.") from exc
    except UnidentifiedImageError as exc:
        raise ShopError(ONLY_PNG_JPG) from exc
    except Exception as exc:  # beschädigte Datei, abgeschnittene Daten
        logger.info("[shop-designs] unreadable image: %s", type(exc).__name__)
        raise ShopError(UNREADABLE) from exc
    return clean, "JPG" if detected == "JPEG" else "PNG"


def has_transparency(img: Image.Image) -> bool:
    return img.mode == "RGBA" and img.getchannel("A").getextrema()[0] < 255


def png_bytes(img: Image.Image, dpi: float) -> bytes:
    """Die Druckdatei: PNG, nur Pixel und die DPI bei der Druckbreite (damit Printful die Größe richtig anzeigt)."""
    out = BytesIO()
    whole = max(1, int(round(dpi)))
    img.save(out, format="PNG", dpi=(whole, whole), compress_level=6)
    return out.getvalue()


# ---------------------------------------------------------------- Ablage und öffentliche Adresse

DESIGN_FOLDER = "shop-designs"
FILE_REF = re.compile(r"^shop-designs/([0-9a-f]{32})\.png$")
PUBLIC_ID = re.compile(r"^[A-Za-z0-9_-]{43}$")
PUBLIC_PREFIX = "/api/shop/print-files"


def design_dir() -> Path:
    return storage.SHOP_DESIGN_DIR


def _path_of(file_ref: str) -> Path | None:
    match = FILE_REF.fullmatch(str(file_ref or ""))
    return design_dir() / f"{match.group(1)}.png" if match else None


def _store(payload: bytes) -> tuple[str, Path]:
    """Neue Datei mit neuem Namen - ``xb`` scheitert, statt je etwas zu überschreiben."""
    storage.ensure_directory(design_dir())
    name = uuid.uuid4().hex
    path = design_dir() / f"{name}.png"
    with path.open("xb") as handle:
        handle.write(payload)
    return f"{DESIGN_FOLDER}/{name}.png", path


def file_name(row: dict) -> str:
    """Der Name, unter dem Printful die Version holt - die Version steckt drin, sonst lädt Printful nicht neu. Eine
    Gamertag-Datei (#1711) trägt den Anfang ihrer Prüfsumme - nie den Namen."""
    if row.get("origin") == "gamertag":
        return f"gamertag-{row['sha256'][:16]}.png"
    return f"{row['design_key']}-v{row['version']}.png"


def public_path(row: dict) -> str | None:
    return f"{PUBLIC_PREFIX}/{row['public_id']}/{file_name(row)}" if row.get("public_id") else None


def _public_base_url() -> str:
    base = os.getenv("PUBLIC_BACKEND_URL") or os.getenv("PUBLIC_BASE_URL") or os.getenv("FRONTEND_URL") or ""
    return base.strip().rstrip("/")


def public_url(row: dict) -> str | None:
    path = public_path(row)
    base = _public_base_url()
    return f"{base}{path}" if path and base else path


async def public_file(db, public_id: str, filename: str) -> Path | None:
    """Die Datei hinter einer öffentlichen Adresse - oder ``None`` (404) für alles, was nicht genau passt: falscher
    Schlüssel, falscher Name, abgeschaltete Version, fehlende Datei. Es gibt keinen Weg, Versionen aufzuzählen."""
    if not PUBLIC_ID.fullmatch(str(public_id or "")):
        return None
    row = await db.shop_designs.find_one({"public_id": public_id}, {"_id": 0})
    if row is None:  # Gamertag-Druckdateien (#1711) liegen im selben Speicher
        row = await db.shop_gamertag_files.find_one({"public_id": public_id}, {"_id": 0})
    if not row or row.get("public_disabled_at"):
        return None
    if not hmac.compare_digest(str(filename or "").encode(), file_name(row).encode()):
        return None
    path = _path_of(row.get("file_ref"))
    return path if path is not None and path.is_file() else None


# ---------------------------------------------------------------- Designs (Name, Platzierung, Shirtfarben)

MAX_COLORS = 20


def _line(value: Any, label: str, limit: int, *, required: bool = False) -> str | None:
    text = " ".join(str(value or "").split())
    if len(text) > limit:
        raise ShopError(f"{label} ist zu lang (höchstens {limit} Zeichen).")
    if required and not text:
        raise ShopError(f"{label} fehlt.")
    return text or None


def clean_colors(raw: Any) -> list[str]:
    """Shirtfarben wie an den Varianten („Schwarz“, „Navy“): Liste oder durch Komma getrennt, ohne Doppelte."""
    items = raw.split(",") if isinstance(raw, str) else list(raw or [])
    out: list[str] = []
    for item in items:
        if not isinstance(item, str):
            raise ShopError("Farben als Text angeben.")
        color = _line(item, "Farbe", 40)
        if color and color.casefold() not in {known.casefold() for known in out}:
            out.append(color)
    if len(out) > MAX_COLORS:
        raise ShopError(f"Höchstens {MAX_COLORS} Farben je Design.")
    return out


def _design_key(value: Any) -> str:
    key = str(value or "").strip()
    if not shop_catalog.DESIGN_KEY.match(key) or len(key) > 60:
        raise ShopError("Kennung des Designs: Kleinbuchstaben, Ziffern und Bindestriche (z. B. loewe-vorne).")
    return key


async def get_profile(db, design_key: str) -> dict | None:
    return await db.shop_design_profiles.find_one({"design_key": design_key}, {"_id": 0})


async def _check_colors_free(db, design_key: str, placement: str, colors: list[str]) -> None:
    """Je Platzierung gehört eine Shirtfarbe zu höchstens einem Design - sonst wüsste #1707 nicht, welches gilt."""
    if not colors:
        return
    wanted = {color.casefold(): color for color in colors}
    async for other in db.shop_design_profiles.find({"placement": placement, "design_key": {"$ne": design_key}},
                                                    {"_id": 0}):
        for color in other.get("garment_colors") or []:
            if color.casefold() in wanted:
                raise ShopConflict(f"„{wanted[color.casefold()]}“ hat an „{PLACEMENT_LABELS[placement]}“ schon das "
                                   f"Design {other['design_key']}. Dort zuerst entfernen.")


async def _release_colors(db, design_key: str, placement: str, keys: list[str] | set[str]) -> None:
    if keys:
        await db.shop_design_colors.delete_many({"placement": placement, "design_key": design_key,
                                                 "color_key": {"$in": sorted(keys)}})


async def _claim_colors(db, design_key: str, placement: str, colors: list[str]) -> list[str]:
    """Belegt die Farben atomar: je Platzierung und Farbe eine Zeile in ``shop_design_colors`` mit eindeutigem Index
    (``placement`` + ``color_key``). Wer zuerst schreibt, hat sie; der andere bekommt 409 und gibt alles wieder frei,
    was er in diesem Aufruf belegt hat. Liefert die neu belegten Schlüssel (schon eigene zählen nicht)."""
    claimed: list[str] = []
    for color in colors:
        color_key = color.casefold()
        row = {"placement": placement, "color_key": color_key, "color": color, "design_key": design_key,
               "claimed_at": now_utc().isoformat()}
        try:
            await db.shop_design_colors.insert_one(dict(row))
            claimed.append(color_key)
        except DuplicateKeyError:
            owner = await db.shop_design_colors.find_one({"placement": placement, "color_key": color_key}, {"_id": 0})
            if owner and owner.get("design_key") == design_key:
                continue
            await _release_colors(db, design_key, placement, claimed)
            other = (owner or {}).get("design_key", "einem anderen Design")
            raise ShopConflict(f"„{color}“ hat an „{PLACEMENT_LABELS[placement]}“ schon das Design {other}. "
                               "Dort zuerst entfernen.")
    return claimed


async def create_profile(db, design_key: str, *, title: Any, placement: str, garment_colors: Any, actor_id: str,
                         reason: Any) -> dict:
    key = _design_key(design_key)
    if placement not in shop_catalog.PLACEMENTS:
        raise ShopError("Bitte die Platzierung wählen.")
    colors = clean_colors(garment_colors)
    now = now_utc().isoformat()
    profile = {"design_key": key, "title": _line(title, "Titel", 120, required=True), "placement": placement,
               "garment_colors": colors, "note": None, "version": 1, "created_at": now, "created_by": actor_id,
               "updated_at": now, "updated_by": actor_id}
    if await get_profile(db, key):
        raise ShopConflict("Dieses Design wurde gerade angelegt - bitte neu laden.")
    claimed = await _claim_colors(db, key, placement, colors)
    try:
        await db.shop_design_profiles.insert_one(dict(profile))
    except DuplicateKeyError:
        await _release_colors(db, key, placement, claimed)
        raise ShopConflict("Dieses Design wurde gerade angelegt - bitte neu laden.")
    await record_admin_action(db, "shop.design.profile", actor_id=actor_id, target_id=key, reason=reason,
                              data={"created": True, "placement": placement, "garment_colors": colors})
    return profile


PROFILE_FIELDS = ("title", "garment_colors", "note")


async def update_profile(db, design_key: str, fields: dict, *, actor_id: str, reason: Any) -> tuple[dict, list[str]]:
    """Titel, Shirtfarben oder Notiz eines Designs - die Platzierung bleibt (sonst passen die Versionen nicht mehr)."""
    unknown = sorted(set(fields) - set(PROFILE_FIELDS))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    reason = clean_reason(reason)
    profile = await get_profile(db, design_key)
    if not profile:
        raise LookupError("Design nicht gefunden.")
    values: dict[str, Any] = {}
    if "title" in fields:
        values["title"] = _line(fields["title"], "Titel", 120, required=True)
    if "note" in fields:
        values["note"] = _line(fields["note"], "Notiz", 500)
    if "garment_colors" in fields:
        values["garment_colors"] = clean_colors(fields["garment_colors"])
    changed = sorted(name for name, value in values.items() if profile.get(name) != value)
    if not changed:
        return profile, []
    placement = profile["placement"]
    claimed: list[str] = []
    if "garment_colors" in changed:
        claimed = await _claim_colors(db, design_key, placement, values["garment_colors"])
    result = await db.shop_design_profiles.update_one(
        {"design_key": design_key, "version": profile.get("version", 1)},
        {"$set": {**{name: values[name] for name in changed}, "updated_at": now_utc().isoformat(),
                  "updated_by": actor_id}, "$inc": {"version": 1}})
    if getattr(result, "matched_count", 0) != 1:
        # Nur freigeben, was das inzwischen gespeicherte Design nicht selbst trägt.
        current = await get_profile(db, design_key) or {}
        own = {color.casefold() for color in current.get("garment_colors") or []}
        await _release_colors(db, design_key, placement, set(claimed) - own)
        raise ShopConflict("Das Design wurde gerade geändert - bitte neu laden.")
    if "garment_colors" in changed:
        kept = {color.casefold() for color in values["garment_colors"]}
        dropped = {color.casefold() for color in profile.get("garment_colors") or []} - kept
        await _release_colors(db, design_key, placement, dropped)
    data: dict[str, Any] = {"fields": changed}
    if "garment_colors" in changed:
        data["before"] = {"garment_colors": profile.get("garment_colors") or []}
        data["after"] = {"garment_colors": values["garment_colors"]}
    await record_admin_action(db, "shop.design.profile", actor_id=actor_id, target_id=design_key, reason=reason,
                              data=data)
    return await get_profile(db, design_key), changed


async def design_for_color(db, placement: str, color: str) -> dict | None:
    """Für die Produktverwaltung (#1707): das Design einer Platzierung für eine Shirtfarbe, mit seiner neuesten Version
    - oder ``None``, wenn für diese Farbe noch keins zugeordnet ist (dann ist die Variante nicht bestellbar)."""
    wanted = " ".join(str(color or "").split()).casefold()
    if not wanted:
        return None
    claim = await db.shop_design_colors.find_one({"placement": placement, "color_key": wanted}, {"_id": 0})
    profile = await get_profile(db, claim["design_key"]) if claim else None
    if not profile:
        return None
    latest = await shop_catalog.latest_design(db, profile["design_key"])
    return {"profile": profile, "latest": latest} if latest else None


# ---------------------------------------------------------------- Upload

async def upload(db, *, design_key: Any, data: bytes, filename: str, content_type: str, actor_id: str, reason: Any,
                 title: Any = None, placement: str | None = None, garment_colors: Any = None) -> dict:
    """Eine neue Druckdatei: prüfen, neu kodieren, als neue Version ablegen. Ein neues Design braucht Titel und
    Platzierung; ein bestehendes behält seine Platzierung."""
    reason = clean_reason(reason)
    key = _design_key(design_key)
    profile = await get_profile(db, key)
    if profile:
        if placement and placement != profile["placement"]:
            raise ShopError(f"Dieses Design gehört zu „{PLACEMENT_LABELS[profile['placement']]}“. Für eine andere "
                            "Platzierung bitte ein eigenes Design anlegen.")
        placement = profile["placement"]
    else:
        if placement not in shop_catalog.PLACEMENTS:
            raise ShopError("Neues Design: bitte die Platzierung wählen.")
        _line(title, "Titel", 120, required=True)
        await _check_colors_free(db, key, placement, clean_colors(garment_colors))
    if len(data) > MAX_BYTES:
        raise ShopError(f"Datei zu groß (höchstens {MAX_UPLOAD_MB} MB).")
    if not data:
        raise ShopError("Die Datei ist leer.")

    img, source_format = prepare(data, filename, content_type)
    spec = (await placement_specs(db))[placement]
    fit = check_fit(img.width, img.height, spec)
    if fit["problems"]:
        raise ShopError(fit["text"])
    payload = png_bytes(img, fit["dpi"])
    checksum = hashlib.sha256(payload).hexdigest()
    latest = await shop_catalog.latest_design(db, key)
    if latest and latest.get("sha256") == checksum:
        raise ShopConflict(f"Diese Datei ist schon die aktuelle Version (v{latest['version']}) - keine neue nötig.")

    file_ref, path = _store(payload)
    try:
        if not profile:
            await create_profile(db, key, title=title, placement=placement, garment_colors=garment_colors,
                                 actor_id=actor_id, reason=reason)
        alpha = has_transparency(img)
        details = {"origin": "upload", "public_id": secrets.token_urlsafe(32), "content_type": "image/png",
                   "size_bytes": len(payload),
                   "width_px": img.width, "height_px": img.height, "has_alpha": alpha, "source_format": source_format,
                   "dpi": fit["dpi"], "print_width_in": fit["print_width_in"],
                   "print_height_in": fit["print_height_in"], "min_dpi": spec["min_dpi"],
                   "area_width_in": spec["area_width_in"], "area_height_in": spec["area_height_in"]}
        design = await shop_catalog.add_design_version(db, key, file_ref=file_ref, sha256=checksum,
                                                       placement=placement, actor_id=actor_id, reason=reason,
                                                       details=details)
    except BaseException:
        path.unlink(missing_ok=True)  # keine Datei ohne Version
        raise
    warnings = []
    if not alpha:
        warnings.append("Kein durchsichtiger Hintergrund: die Fläche um das Motiv wird mitgedruckt."
                        + (" JPG kann keine Transparenz - für Logos besser PNG." if source_format == "JPG" else ""))
    if fit["level"] == "snug":
        warnings.append(fit["text"])
    return {**design, "warnings": warnings}


# ---------------------------------------------------------------- Ansicht für den Admin

def _version_view(row: dict, spec: dict, names: dict[str, str]) -> dict:
    view = {name: row.get(name) for name in ("version", "sha256", "placement", "created_at", "width_px", "height_px",
                                             "has_alpha", "size_bytes", "source_format", "dpi", "print_width_in",
                                             "print_height_in", "min_dpi")}
    view["sha256_short"] = str(row.get("sha256") or "")[:12]
    view["created_by"] = names.get(row.get("created_by"), row.get("created_by"))
    view["public"] = bool(row.get("public_id")) and not row.get("public_disabled_at")
    view["public_path"] = public_path(row) if view["public"] else None
    view["public_url"] = public_url(row) if view["public"] else None
    view["file_name"] = file_name(row)
    if row.get("width_px") and row.get("height_px"):
        fit = check_fit(int(row["width_px"]), int(row["height_px"]), spec)
        view["check"] = {key: fit[key] for key in ("dpi", "level", "text")}
        view["print_size"] = (f"{_number(fit['print_width_in'], 2)} × {_number(fit['print_height_in'], 2)} Zoll "
                              f"({_number(fit['print_width_in'] * CM_PER_INCH, 1)} × "
                              f"{_number(fit['print_height_in'] * CM_PER_INCH, 1)} cm)")
    else:  # ältere Einträge ohne Maße (vor #1708)
        view["check"] = {"dpi": None, "level": "unknown", "text": "Ohne Maße gespeichert - neu hochladen."}
        view["print_size"] = None
    return view


async def _names(db, ids: set[str]) -> dict[str, str]:
    ids = {item for item in ids if item}
    if not ids:
        return {}
    projection = {"_id": 0, "id": 1, "username": 1, "display_name": 1}
    users = await db.users.find({"id": {"$in": sorted(ids)}}, projection).to_list(len(ids))
    return {user["id"]: user.get("display_name") or user.get("username") or user["id"] for user in users}


async def admin_view(db) -> dict:
    specs = await placement_specs(db)
    profiles = await db.shop_design_profiles.find({}, {"_id": 0}).sort("design_key", 1).to_list(500)
    rows = await db.shop_designs.find({}, {"_id": 0}).sort([("design_key", 1), ("version", -1)]).to_list(5000)
    names = await _names(db, {row.get("created_by") for row in rows})
    by_key: dict[str, list[dict]] = {}
    for row in rows:
        by_key.setdefault(row["design_key"], []).append(row)
    known = {profile["design_key"] for profile in profiles}
    for key in sorted(set(by_key) - known):  # Versionen aus der Zeit vor den Designs
        profiles.append({"design_key": key, "title": key, "placement": by_key[key][0].get("placement"),
                         "garment_colors": [], "note": None, "version": 0})
    designs = []
    for profile in profiles:
        placement = profile.get("placement")
        spec = specs.get(placement) or specs["front"]
        versions = [_version_view(row, spec, names) for row in by_key.get(profile["design_key"], [])]
        designs.append({**{key: profile.get(key) for key in ("design_key", "title", "placement", "garment_colors",
                                                             "note")},
                        "placement_label": PLACEMENT_LABELS.get(placement, placement),
                        "latest": versions[0] if versions else None, "versions": versions})
    return {"designs": designs, "placements": [specs[key] for key in shop_catalog.PLACEMENTS],
            "limits": {"max_mb": MAX_UPLOAD_MB, "formats": ["PNG", "JPG"], "max_colors": MAX_COLORS,
                       "min_inches": MIN_INCHES, "max_inches": MAX_INCHES, "min_dpi": MIN_DPI, "max_dpi": MAX_DPI}}


# ---------------------------------------------------------------- Aufbewahrung (vorbereitet, nichts wird gelöscht)

PUBLIC_GRACE_DAYS = 90


async def retention_plan(db, *, now: datetime | None = None) -> dict:
    """Welche öffentlichen Adressen abgeschaltet werden dürften - nur ein Bericht, er ändert nichts.

    Regel (docs/SHOP.md): Die neueste Version eines Designs bleibt öffentlich. Eine ältere Version, auf die eine
    Bestellung zeigt, bleibt ebenfalls öffentlich - bis die Statusmaschine (#1716) „abgeschlossen“ kennt. Eine ältere
    Version ohne Bestellung darf ``PUBLIC_GRACE_DAYS`` Tage nach ihrer Ablösung abgeschaltet werden
    (``public_disabled_at``). Dateien selbst löscht nichts automatisch; die Frist dafür klärt #1731."""
    now = now or now_utc()
    rows = await db.shop_designs.find({}, {"_id": 0}).sort([("design_key", 1), ("version", 1)]).to_list(None)
    ordered = set()
    query = {"$or": [{"design": {"$ne": None}}, {"designs.0": {"$exists": True}}]}
    async for item in db.shop_order_items.find(query, {"_id": 0, "design": 1, "designs": 1}):
        # Seit #1707 je Platzierung eine Fassung (``designs``); ``design`` ist die Kurzform bzw. ältere Bestellungen.
        for design in [item.get("design") or {}, *(item.get("designs") or [])]:
            if design.get("design_key"):
                ordered.add((design.get("design_key"), design.get("version")))
    by_key: dict[str, list[dict]] = {}
    for row in rows:
        by_key.setdefault(row["design_key"], []).append(row)
    public_off, kept = [], 0
    for versions in by_key.values():
        for index, row in enumerate(versions):
            if row.get("public_disabled_at") or not row.get("public_id"):
                continue
            successor = versions[index + 1] if index + 1 < len(versions) else None
            if successor is None or (row["design_key"], row["version"]) in ordered:
                kept += 1
                continue
            superseded = datetime.fromisoformat(successor["created_at"])
            if now - superseded >= timedelta(days=PUBLIC_GRACE_DAYS):
                public_off.append({"design_key": row["design_key"], "version": row["version"],
                                   "superseded_at": successor["created_at"]})
            else:
                kept += 1
    return {"public_off": public_off, "kept_public": kept, "grace_days": PUBLIC_GRACE_DAYS}
