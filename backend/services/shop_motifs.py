"""Motiv-Bibliothek des Vereinsshops (#2069 Teil A): ein Motiv, zwei Fassungen - für dunkle und für helle Shirts.

Ein Motiv ist ein Design aus #1708 (``shop_design_profiles`` mit seinen Fassungen in ``shop_designs``), erweitert:

- **Für dunkle Shirts** ist die Hauptdatei: SVG (bevorzugt, über ``services/svg_safe.py`` streng bereinigt) oder PNG/JPG
  wie bisher. Gespeichert wird je Fassung die Druckdatei (PNG) und bei SVG daneben das bereinigte SVG - nie öffentlich,
  nie das Original.
- **Für helle Shirts** gilt entweder eine eigene Datei (``light_mode = "file"``, hat Vorrang) oder die automatische
  Fassung (``light_mode = "auto"``, Vorgabe): Weiß wird durch die Ersatzfarbe ersetzt (Einstellung, Vorgabe
  ``#111111``), die Markenfarbe bleibt. Bei SVG über ``svg_safe.recolor``, bei PNG nur, wenn es sauber geht
  (durchsichtiger Hintergrund, keine Grautöne) - sonst der Hinweis „bitte eigene Datei für helle Shirts“. Enthält das
  Motiv kein Weiß, gilt die Hauptdatei auch für helle Shirts.
- **Versionen** wie bisher: jede Fassung (auch die automatische) ist eine eigene Version mit Prüfsumme und Adresse;
  eine Bestellung behält ihre.
- **Welche Fassung zu einer Shirtfarbe gehört**, entscheidet ``variant_for_garment`` nach der Helligkeit des Farbwerts
  (relative Luminanz, Schwelle einstellbar); eine Ausnahme je Farbe und Motiv (``color_variants``) geht vor.

Für den Druckdatei-Generator (#2069 Teil B): ``render_motif_png`` rastert ein Motiv in genau der verlangten Breite.
Migration 14 (``shop_motif_variants``) mit Trockenlauf und Rückweg: ``backend/scripts/shop_motifs.py``.
Beschreibung: ``docs/SHOP.md``, Abschnitt „Motive (#2069)“.
"""
from __future__ import annotations

import asyncio
import io
import logging
import math
import re
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops

from models import now_utc
from services import shop_catalog, shop_designs, svg_safe
from services.shop_common import ShopError, clean_reason, record_admin_action

logger = logging.getLogger("tls-arena.shop-motifs")

# Fassungen, Ausnahmen und ihre Prüfung stehen in shop_designs (ohne Import-Kreis), hier dieselben Namen.
VARIANTS = shop_designs.VARIANTS
MAX_EXCEPTIONS = shop_designs.MAX_EXCEPTIONS
clean_exceptions = shop_designs.clean_exceptions
VARIANT_LABELS = {"dark": "für dunkle Shirts", "light": "für helle Shirts"}
SETTINGS_ID = "shop_motifs"
REPLACED_COLOR = "#ffffff"
DEFAULT_LIGHT_INK = "#111111"
# Relative Luminanz (0 = Schwarz, 1 = Weiß). Bei 0,18 ist der Kontrast zu Schwarz und Weiß etwa gleich: darunter
# trägt ein Shirt helle Motive (Schwarz, Navy, Rot, Royal), darüber dunkle (Weiß, Grau meliert, Gelb).
DEFAULT_THRESHOLD = 0.18
MIN_THRESHOLD, MAX_THRESHOLD = 0.02, 0.9
HEX6 = re.compile(r"^#[0-9a-fA-F]{6}$")
# SVG wird für die Druckdatei mindestens so fein gerastert, dass die Ampel „gut“ zeigt.
SVG_DPI_FLOOR = 300


class SvgRefused(ShopError):
    """Ein abgelehntes SVG als Fehler des Shops - mit der festen Meldung aus ``svg_safe`` und passendem Status."""

    def __init__(self, rejected: svg_safe.SvgRejected):
        super().__init__(rejected.message)
        self.status = svg_safe.STATUS.get(rejected.code, 400)
        self.findings = rejected.findings
        self.is_vector = rejected.is_vector


# ---------------------------------------------------------------- Shirtfarbe → Fassung

def _color_key(color: Any) -> str:
    return " ".join(str(color or "").split()).casefold()


def relative_luminance(color_hex: Any) -> float | None:
    """Relative Luminanz nach WCAG (0 bis 1) - ``None`` ohne lesbaren Farbwert."""
    value = svg_safe.normalize_color(color_hex) if isinstance(color_hex, str) else None
    if value is None:
        return None

    def linear(channel: int) -> float:
        part = channel / 255
        return part / 12.92 if part <= 0.04045 else ((part + 0.055) / 1.055) ** 2.4

    red, green, blue = (int(value[index:index + 2], 16) for index in (1, 3, 5))
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)


def variant_for_garment(color_hex: Any, *, color: Any = None, threshold: float = DEFAULT_THRESHOLD,
                        exceptions: list[dict] | None = None) -> str | None:
    """``"dark"`` (Motiv für dunkle Shirts) oder ``"light"`` (für helle Shirts) zu einer Shirtfarbe.

    Eine Ausnahme mit demselben Farbnamen (Groß-/Kleinschreibung und Leerraum egal) geht vor; sonst entscheidet die
    Helligkeit: ab ``threshold`` gilt das Shirt als hell. Ohne Farbwert und ohne Ausnahme ``None`` - der Aufrufer
    entscheidet dann (die Bestellung nimmt die Hauptdatei, wie vor #2069)."""
    key = _color_key(color)
    if key:
        for item in exceptions or []:
            if isinstance(item, dict) and _color_key(item.get("color")) == key and item.get("variant") in VARIANTS:
                return item["variant"]
    luminance = relative_luminance(color_hex)
    if luminance is None:
        return None
    return "light" if luminance >= threshold else "dark"


# ---------------------------------------------------------------- Einstellungen

def _valid_ink(value: Any) -> str | None:
    return value.lower() if isinstance(value, str) and HEX6.match(value.strip()) and value == value.strip() else None


def _valid_threshold(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(float(value), 3) if MIN_THRESHOLD <= value <= MAX_THRESHOLD else None


async def load_settings(db) -> dict:
    """Ersatzfarbe für helle Shirts und Helligkeits-Schwelle - gespeichert oder Vorgabe."""
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    ink = _valid_ink(doc.get("light_ink")) or DEFAULT_LIGHT_INK
    threshold = _valid_threshold(doc.get("threshold"))
    threshold = DEFAULT_THRESHOLD if threshold is None else threshold
    return {"light_ink": ink, "threshold": threshold, "replaced_color": REPLACED_COLOR,
            "is_default": ink == DEFAULT_LIGHT_INK and threshold == DEFAULT_THRESHOLD,
            "defaults": {"light_ink": DEFAULT_LIGHT_INK, "threshold": DEFAULT_THRESHOLD},
            "limits": {"min_threshold": MIN_THRESHOLD, "max_threshold": MAX_THRESHOLD}}


async def set_settings(db, fields: dict, *, actor_id: str, reason: Any) -> tuple[dict, list[str]]:
    """Ersatzfarbe bzw. Schwelle ändern - mit vorher/nachher im Protokoll. Eine neue Ersatzfarbe erzeugt die
    automatischen Fassungen neu (neue Versionen; Bestellungen behalten ihre)."""
    unknown = sorted(set(fields) - {"light_ink", "threshold"})
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    reason = clean_reason(reason)
    current = await load_settings(db)
    after = {"light_ink": current["light_ink"], "threshold": current["threshold"]}
    if "light_ink" in fields:
        ink = _valid_ink(fields["light_ink"])
        if ink is None:
            raise ShopError("Ersatzfarbe als Farbwert wie #111111.")
        if ink == REPLACED_COLOR:
            raise ShopError("Die Ersatzfarbe darf nicht Weiß sein - sonst gibt es keine Fassung für helle Shirts.")
        after["light_ink"] = ink
    if "threshold" in fields:
        threshold = _valid_threshold(fields["threshold"])
        if threshold is None:
            raise ShopError(f"Schwelle: Zahl von {MIN_THRESHOLD} bis {MAX_THRESHOLD}.")
        after["threshold"] = threshold
    changed = [name for name in ("light_ink", "threshold") if after[name] != current[name]]
    if not changed:
        return current, []
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {"id": SETTINGS_ID, **after, "updated_at": now_utc().isoformat(), "updated_by": actor_id}},
        upsert=True)
    await record_admin_action(db, "shop.motif.settings", actor_id=actor_id, target_id=SETTINGS_ID, reason=reason,
                              data={"before": {name: current[name] for name in changed},
                                    "after": {name: after[name] for name in changed}})
    if "light_ink" in changed:
        await refresh_all_auto(db, actor_id=actor_id, reason=reason)
    return await load_settings(db), changed


# ---------------------------------------------------------------- Dateien

def print_dpi(spec: dict) -> int:
    return max(SVG_DPI_FLOOR, math.ceil(float(spec["min_dpi"]) * shop_designs.SNUG_FACTOR - 1e-9))


def _open_png(payload: bytes) -> Image.Image:
    with Image.open(io.BytesIO(payload)) as image:
        image.load()
        return image.convert("RGBA")


async def prepare_svg(data: bytes, spec: dict) -> tuple[Image.Image, bytes, dict]:
    """SVG streng bereinigen und für die Druckdatei rastern (Druckbreite × mindestens 300 DPI). Liefert das Bild, das
    bereinigte SVG und die Analyse (Farben, viewBox, Seitenverhältnis)."""
    try:
        clean = svg_safe.sanitize(data)
        info = svg_safe.analyze(clean.data)
        width = math.ceil(float(spec["print_width_in"]) * print_dpi(spec) - 1e-9)
        payload = await asyncio.to_thread(svg_safe.rasterize, clean.data, width_px=width)
    except svg_safe.SvgRejected as rejected:
        raise SvgRefused(rejected) from None
    image = _open_png(payload)
    if image.getchannel("A").getbbox() is None:
        raise ShopError(svg_safe.NOTHING)
    return image, clean.data, info


# ---------------------------------------------------------------- Hell-Variante aus einem PNG

WHITE_VALUE = 200   # ab dieser Helligkeit (HSV, 0-255) und
WHITE_SATURATION = 40   # bis zu dieser Sättigung ist ein Pixel „weiß“
GRAY_VALUE = 90     # dazwischen und kaum gesättigt: Grauton - der lässt sich nicht eindeutig umfärben
UNCLEAR_SHARE = 0.02
PNG_HINTS = {
    "opaque": "Bitte eine eigene Datei für helle Shirts hochladen: das PNG hat keinen durchsichtigen Hintergrund - "
              "beim Umfärben würde die Fläche mitgefärbt.",
    "gray": "Bitte eine eigene Datei für helle Shirts hochladen: das PNG enthält Grautöne, die sich nicht sauber "
            "umfärben lassen.",
    "empty": "Bitte eine eigene Datei für helle Shirts hochladen: im PNG ist nichts Sichtbares.",
    "file": "Die Hauptdatei fehlt auf dem Server - bitte neu hochladen.",
}


def light_from_png(image: Image.Image, ink: str) -> tuple[Image.Image | None, str]:
    """Weiße Pixel eines Motivs mit durchsichtigem Hintergrund in ``ink`` umfärben - weich an den Kanten, Deckkraft
    bleibt, gesättigte Farben (die Markenfarbe) bleiben. ``(bild, "auto")``, ``(None, "same")`` ohne Weiß oder
    ``(None, grund)``, wenn es nicht sauber geht (``opaque``, ``gray``, ``empty``)."""
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getextrema()[0] == 255:
        return None, "opaque"
    rgb = rgba.convert("RGB")
    _hue, saturation, value = rgb.convert("HSV").split()
    visible = alpha.point(lambda a: 255 if a >= 128 else 0)
    pale = saturation.point(lambda s: 255 if s <= WHITE_SATURATION else 0)
    white = ImageChops.multiply(ImageChops.multiply(value.point(lambda v: 255 if v >= WHITE_VALUE else 0), pale),
                                visible)
    gray = ImageChops.multiply(ImageChops.multiply(
        value.point(lambda v: 255 if GRAY_VALUE <= v < WHITE_VALUE else 0), pale), visible)
    visible_count, white_count, gray_count = (mask.histogram()[255] for mask in (visible, white, gray))
    if not visible_count:
        return None, "empty"
    if not white_count:
        return None, "same"
    if gray_count > visible_count * UNCLEAR_SHARE:
        return None, "gray"
    # Gewicht 0..255: je heller und je weniger gesättigt, desto mehr Ersatzfarbe - weiche Kanten statt Treppen.
    by_value = value.point(lambda v: max(0, min(255, round((v - 180) * 255 / 75))))
    by_saturation = saturation.point(lambda s: max(0, min(255, round((60 - s) * 255 / 60))))
    weight = ImageChops.multiply(by_value, by_saturation)
    red, green, blue = (int(ink[index:index + 2], 16) for index in (1, 3, 5))
    out = Image.composite(Image.new("RGB", rgba.size, (red, green, blue)), rgb, weight).convert("RGBA")
    out.putalpha(alpha)
    return out, "auto"


# ---------------------------------------------------------------- Welche Fassung gilt?

async def _rows(db, key: str) -> list[dict]:
    return await db.shop_designs.find({"design_key": key}, {"_id": 0}).sort("version", -1).to_list(2000)


def light_state(profile: dict | None, rows: list[dict], settings: dict) -> dict:
    """Wie ein Motiv auf hellen Shirts aussieht: ``file`` (eigene Datei), ``auto`` (umgefärbt), ``same`` (kein Weiß -
    die Hauptdatei gilt), ``missing`` (PNG lässt sich nicht sauber umfärben), ``pending`` (noch nicht erzeugt, etwa
    nach einer neuen Ersatzfarbe) oder ``none`` (keine Hauptdatei). ``version`` ist die Fassung, die gilt."""
    dark = next((row for row in rows if row.get("variant") != "light"), None)
    if not dark:
        return {"state": "none", "version": None, "hint": "Noch keine Hauptdatei."}
    if (profile or {}).get("light_mode") == "file":
        own = next((row for row in rows if row.get("variant") == "light" and row.get("origin") == "upload"), None)
        if own:
            return {"state": "file", "version": own["version"], "hint": "Eigene Datei für helle Shirts."}
        return {"state": "missing", "version": None, "hint": "Die eigene Datei für helle Shirts fehlt."}
    auto = (profile or {}).get("light_auto") or {}
    if auto.get("for_version") != dark["version"] or auto.get("ink") != settings["light_ink"]:
        return {"state": "pending", "version": None,
                "hint": "Die Fassung für helle Shirts ist noch nicht erzeugt - „Hell-Variante erzeugen“."}
    state = auto.get("state")
    if state == "auto" and auto.get("light_version"):
        return {"state": "auto", "version": auto["light_version"],
                "hint": f"Automatisch: Weiß wird {settings['light_ink']}, alle anderen Farben bleiben."}
    if state == "same":
        return {"state": "same", "version": dark["version"],
                "hint": "Kein Weiß im Motiv - die Hauptdatei gilt auch für helle Shirts."}
    return {"state": "missing", "version": None,
            "hint": PNG_HINTS.get(auto.get("reason"), "Bitte eine eigene Datei für helle Shirts hochladen.")}


async def resolve(db, motif_key: str, variant: str) -> dict | None:
    """Die Fassung eines Motivs, die für ``variant`` gilt - oder ``None`` (für helle Shirts fehlt sie)."""
    if variant not in VARIANTS:
        raise ValueError("variant: 'dark' oder 'light'")
    if variant == "dark":
        return await shop_catalog.latest_design(db, motif_key)
    rows = await _rows(db, motif_key)
    state = light_state(await shop_designs.get_profile(db, motif_key), rows, await load_settings(db))
    return next((row for row in rows if row["version"] == state["version"]), None) if state["version"] else None


async def file_for_garment(db, motif_key: str, *, color: Any, color_hex: Any) -> dict | None:
    """Die Druckdatei-Fassung eines Motivs für eine Shirtfarbe (Bestellung, Vorab-Prüfung der Produktverwaltung):
    Ausnahme des Motivs, sonst Helligkeit; ohne Farbwert die Hauptdatei wie vor #2069. ``None``, wenn die passende
    Fassung fehlt - dann ist die Farbe nicht bestellbar."""
    profile = await shop_designs.get_profile(db, motif_key)
    settings = await load_settings(db)
    variant = variant_for_garment(color_hex, color=color, threshold=settings["threshold"],
                                  exceptions=exceptions_of(profile)) or "dark"
    return await resolve(db, motif_key, variant)


def exceptions_of(profile: dict | None) -> list[dict]:
    """Die Ausnahmen eines Motivs: eigene (``color_variants``) zuerst, danach die festen Shirtfarben aus #1708
    (``garment_colors``) - für sie gilt wie bisher die Hauptdatei."""
    profile = profile or {}
    own = [item for item in profile.get("color_variants") or [] if isinstance(item, dict)]
    return own + [{"color": color, "variant": "dark"} for color in profile.get("garment_colors") or []]


# ---------------------------------------------------------------- Automatische Fassung für helle Shirts

def _spec_of(row: dict, fallback: dict) -> dict:
    """Die Maße, mit denen die Hauptdatei geprüft wurde - die automatische Fassung hat dieselben."""
    names = ("print_width_in", "area_width_in", "area_height_in", "min_dpi")
    return {name: row[name] for name in names} if all(row.get(name) for name in names) else fallback


async def refresh_auto_light(db, motif_key: str, *, actor_id: str, reason: Any) -> dict:
    """Die automatische Fassung für helle Shirts zur neuesten Hauptdatei und Ersatzfarbe erzeugen - einmal je
    Hauptdatei und Ersatzfarbe (ein zweiter Aufruf ändert nichts). Liefert den Zustand wie ``light_state``."""
    profile = await shop_designs.get_profile(db, motif_key)
    dark = await shop_catalog.latest_design(db, motif_key)
    settings = await load_settings(db)
    if not profile or not dark or profile.get("light_mode") == "file":
        return light_state(profile, await _rows(db, motif_key), settings)
    ink = settings["light_ink"]
    done = profile.get("light_auto") or {}
    if done.get("for_version") == dark["version"] and done.get("ink") == ink:
        return light_state(profile, await _rows(db, motif_key), settings)
    state = {"for_version": dark["version"], "ink": ink, "light_version": None, "state": "missing", "reason": None,
             "checked_at": now_utc().isoformat()}
    image = None
    svg_bytes = None
    if dark.get("svg_ref"):
        path = shop_designs.svg_path_of(dark["svg_ref"])
        if path is None or not path.is_file():
            state["reason"] = "file"
        else:
            source = path.read_bytes()
            try:
                recolored = svg_safe.recolor(source, {REPLACED_COLOR: ink})
                if recolored == svg_safe.sanitize(source).data:
                    state["state"] = "same"
                else:
                    payload = await asyncio.to_thread(svg_safe.rasterize, recolored, width_px=int(dark["width_px"]))
                    image, svg_bytes = _open_png(payload), recolored
            except svg_safe.SvgRejected as rejected:
                raise SvgRefused(rejected) from None
    else:
        path = shop_designs._path_of(dark.get("file_ref"))
        if path is None or not path.is_file():
            state["reason"] = "file"
        else:
            with Image.open(path) as stored:
                stored.load()
                light, outcome = light_from_png(stored, ink)
            if outcome == "same":
                state["state"] = "same"
            elif light is None:
                state["reason"] = outcome
            else:
                image = light
    if image is not None:
        spec = _spec_of(dark, (await shop_designs.placement_specs(db))[dark["placement"]])
        extra = {"derived_from": dark["version"], "recolor": {REPLACED_COLOR: ink}}
        if svg_bytes is not None:
            extra["colors"] = [item["hex"] for item in svg_safe.colors(svg_bytes)][:24]
            extra["view_box"] = dark.get("view_box")
        design, _fit = await shop_designs.save_version(
            db, motif_key, image=image, spec=spec, placement=dark["placement"], source_format=dark.get(
                "source_format") or "PNG", variant="light", origin="auto_light", actor_id=actor_id, reason=reason,
            svg_bytes=svg_bytes, extra=extra)
        state.update(state="auto", light_version=design["version"])
    await db.shop_design_profiles.update_one({"design_key": motif_key}, {"$set": {"light_auto": state}})
    return light_state(await shop_designs.get_profile(db, motif_key), await _rows(db, motif_key), settings)


async def refresh_all_auto(db, *, actor_id: str, reason: Any) -> int:
    """Nach einer neuen Ersatzfarbe: jede automatische Fassung neu. Ein Motiv, das scheitert, hält die anderen nicht
    auf - es zeigt danach „noch nicht erzeugt“."""
    done = 0
    async for profile in db.shop_design_profiles.find({"light_mode": {"$ne": "file"}}, {"_id": 0, "design_key": 1}):
        try:
            await refresh_auto_light(db, profile["design_key"], actor_id=actor_id, reason=reason)
            done += 1
        except ShopError as exc:
            logger.warning("[shop-motifs] Hell-Variante für %s nicht erzeugt: %s", profile["design_key"], exc)
    return done


async def use_auto_light(db, motif_key: str, *, actor_id: str, reason: Any) -> dict:
    """„Zurück auf automatisch“ bzw. „Hell-Variante erzeugen“: die eigene Datei bleibt als Version liegen, gilt aber
    nicht mehr."""
    reason = clean_reason(reason)
    profile = await shop_designs.get_profile(db, motif_key)
    if not profile:
        raise LookupError("Motiv nicht gefunden.")
    if profile.get("light_mode") == "file":
        await set_light_mode(db, motif_key, "auto", actor_id=actor_id, reason=reason)
    return await refresh_auto_light(db, motif_key, actor_id=actor_id, reason=reason)


async def set_light_mode(db, motif_key: str, mode: str, *, actor_id: str, reason: Any) -> None:
    if mode not in ("auto", "file"):
        raise ShopError("Fassung für helle Shirts: automatisch oder eigene Datei.")
    profile = await shop_designs.get_profile(db, motif_key)
    before = (profile or {}).get("light_mode") or "auto"
    if not profile or before == mode:
        return
    await db.shop_design_profiles.update_one(
        {"design_key": motif_key},
        {"$set": {"light_mode": mode, "updated_at": now_utc().isoformat(), "updated_by": actor_id},
         "$inc": {"version": 1}})
    await record_admin_action(db, "shop.design.light", actor_id=actor_id, target_id=motif_key, reason=reason,
                              data={"before": before, "after": mode})


# ---------------------------------------------------------------- Upload und Ansicht für den Admin

async def upload(db, *, design_key: Any, data: bytes, filename: str, content_type: str, actor_id: str, reason: Any,
                 title: Any = None, placement: str | None = None, garment_colors: Any = None,
                 variant: str = "dark") -> dict:
    """Eine neue Datei eines Motivs: prüfen, neu kodieren, als neue Version ablegen (#1708). ``variant`` „dark“ ist die
    Hauptdatei (für dunkle Shirts), „light“ die eigene Datei für helle Shirts (hat Vorrang vor der automatischen).
    SVG wird streng bereinigt und gerastert, PNG/JPG neu kodiert. Ein neues Motiv braucht Titel und Platzierung; ein
    bestehendes behält seine Platzierung. Nach einer neuen Hauptdatei entsteht die automatische Fassung."""
    reason = clean_reason(reason)
    if variant not in VARIANTS:
        raise ShopError("Fassung: für dunkle Shirts (dark) oder für helle Shirts (light).")
    key = shop_designs._design_key(design_key)
    profile = await shop_designs.get_profile(db, key)
    if profile:
        if placement and placement != profile["placement"]:
            raise ShopError(f"Dieses Design gehört zu „{shop_designs.PLACEMENT_LABELS[profile['placement']]}“. Für "
                            "eine andere Platzierung bitte ein eigenes Design anlegen.")
        placement = profile["placement"]
    else:
        if variant == "light":
            raise ShopError("Eine Datei für helle Shirts gehört zu einem bestehenden Motiv - zuerst die Hauptdatei "
                            "(für dunkle Shirts) hochladen.")
        if placement not in shop_catalog.PLACEMENTS:
            raise ShopError("Neues Design: bitte die Platzierung wählen.")
        shop_designs._line(title, "Titel", 120, required=True)
        await shop_designs._check_colors_free(db, key, placement, shop_designs.clean_colors(garment_colors))
    if len(data) > shop_designs.MAX_BYTES:
        raise ShopError(f"Datei zu groß (höchstens {shop_designs.MAX_UPLOAD_MB} MB).")
    if not data:
        raise ShopError("Die Datei ist leer.")

    spec = (await shop_designs.placement_specs(db))[placement]
    extra: dict[str, Any] = {}
    svg_bytes = None
    if shop_designs.looks_like_svg(Path(filename or "").suffix.lower(), content_type or "", data[:8192]):
        image, svg_bytes, info = await prepare_svg(data, spec)
        source_format = "SVG"
        extra = {"colors": [item["hex"] for item in info["colors"]][:24], "view_box": info["view_box"]}
    else:
        image, source_format = shop_designs.prepare(data, filename, content_type)

    async def create() -> None:
        await shop_designs.create_profile(db, key, title=title, placement=placement, garment_colors=garment_colors,
                                          actor_id=actor_id, reason=reason)

    design, fit = await shop_designs.save_version(
        db, key, image=image, spec=spec, placement=placement, source_format=source_format, variant=variant,
        origin="upload", actor_id=actor_id, reason=reason, svg_bytes=svg_bytes, extra=extra,
        before_insert=None if profile else create)
    warnings = []
    if not design["has_alpha"]:
        warnings.append("Kein durchsichtiger Hintergrund: die Fläche um das Motiv wird mitgedruckt."
                        + (" JPG kann keine Transparenz - für Logos besser PNG." if source_format == "JPG" else ""))
    if fit["level"] == "snug":
        warnings.append(fit["text"])
    if variant == "light":
        await set_light_mode(db, key, "file", actor_id=actor_id, reason=reason)
        light = light_state(await shop_designs.get_profile(db, key), await _rows(db, key), await load_settings(db))
    else:
        try:
            light = await refresh_auto_light(db, key, actor_id=actor_id, reason=reason)
        except ShopError as exc:  # die Hauptdatei gilt; die Hell-Variante lässt sich später erzeugen
            light = {"state": "pending", "version": None, "hint": str(exc)}
        if light["state"] in ("missing", "pending"):
            warnings.append(light["hint"])
    return {**design, "warnings": warnings, "light": light}


async def admin_view(db) -> dict:
    """Die Ansicht aus ``shop_designs.admin_view``, ergänzt um den Zustand für helle Shirts je Motiv (mit der Fassung,
    die gilt) und die Einstellungen."""
    view = await shop_designs.admin_view(db)
    settings = await load_settings(db)
    profiles = {profile["design_key"]: profile
                async for profile in db.shop_design_profiles.find({}, {"_id": 0, "design_key": 1, "light_mode": 1,
                                                                        "light_auto": 1})}
    for design in view["designs"]:
        light = light_state(profiles.get(design["design_key"]), design["versions"], settings)
        light["latest"] = next((item for item in design["versions"] if item["version"] == light["version"]), None)
        design["light"] = light
    return {**view, "motif_settings": settings}


# ---------------------------------------------------------------- Schnittstelle für Teil B: Motiv rastern

MAX_RENDER_WIDTH = 20000


async def _row_for(db, motif_key: str, variant: str, version: int | None) -> dict:
    if variant not in VARIANTS:
        raise ValueError("variant: 'dark' oder 'light'")
    if version is None:
        row = await resolve(db, motif_key, variant)
        if row is None:
            raise LookupError(f"Motiv {motif_key}: keine Fassung {VARIANT_LABELS[variant]}.")
        return row
    if isinstance(version, bool) or not isinstance(version, int):
        raise ValueError("version: ganze Zahl")
    row = await db.shop_designs.find_one({"design_key": motif_key, "version": version}, {"_id": 0})
    if row is None or (variant == "dark" and row.get("variant") == "light"):
        raise LookupError(f"Motiv {motif_key}: Version {version} gibt es {VARIANT_LABELS[variant]} nicht.")
    return row


def _png_at_width(path: Path, width_px: int, dpi: int) -> bytes:
    with Image.open(path) as stored:
        stored.load()
        image = stored.convert("RGBA")
    height = max(1, round(width_px * image.height / image.width))
    if image.size != (width_px, height):
        image = image.resize((width_px, height), Image.Resampling.LANCZOS)
    return svg_safe.png_bytes(image, dpi)


async def render_motif_png(db, motif_key: str, variant: str, *, width_px: int, dpi: int,
                           version: int | None = None) -> bytes:
    """Ein Motiv als PNG in genau ``width_px`` Breite - Seitenverhältnis erhalten, Hintergrund durchsichtig, im PNG nur
    die DPI. Gleiche Eingabe (auch dieselbe Version) ergibt dieselben Bytes.

    - ``variant``: ``"dark"`` (für dunkle Shirts) oder ``"light"`` (für helle Shirts; eigene Datei, automatische
      Fassung oder - ohne Weiß im Motiv - die Hauptdatei). Welche zur Shirtfarbe gehört, sagt ``variant_for_garment``.
    - ``version``: eine bestimmte, etwa die einer Bestellung eingefrorene Fassung; ohne die geltende.
    - SVG-Fassungen werden aus dem bereinigten SVG neu gerastert (scharf in jeder Größe), PNG-Fassungen skaliert -
      wie fein das noch ist, sagt ``motif_info`` (Pixel der gespeicherten Datei).

    ``LookupError``, wenn es die Fassung nicht gibt (etwa „für helle Shirts“ bei einem PNG, das sich nicht umfärben
    ließ); ``ValueError`` bei unsinnigen Eingaben."""
    if isinstance(width_px, bool) or not isinstance(width_px, int) or not 1 <= width_px <= MAX_RENDER_WIDTH:
        raise ValueError(f"width_px: ganze Zahl von 1 bis {MAX_RENDER_WIDTH}")
    if isinstance(dpi, bool) or not isinstance(dpi, int) or not 1 <= dpi <= 2400:
        raise ValueError("dpi: ganze Zahl von 1 bis 2400")
    row = await _row_for(db, motif_key, variant, version)
    if row.get("svg_ref"):
        path = shop_designs.svg_path_of(row["svg_ref"])
        if path is None or not path.is_file():
            raise LookupError(f"Motiv {motif_key}: Datei von Version {row['version']} fehlt.")
        try:
            return await asyncio.to_thread(svg_safe.rasterize, path.read_bytes(), width_px=width_px, dpi=dpi)
        except svg_safe.SvgRejected as rejected:
            raise SvgRefused(rejected) from None
    path = shop_designs._path_of(row.get("file_ref"))
    if path is None or not path.is_file():
        raise LookupError(f"Motiv {motif_key}: Datei von Version {row['version']} fehlt.")
    return await asyncio.to_thread(_png_at_width, path, width_px, dpi)


async def motif_info(db, motif_key: str, variant: str, *, version: int | None = None) -> dict:
    """Was ``render_motif_png`` rastern würde: Version, Herkunft, Format, Seitenverhältnis und - bei PNG - die Pixel
    der gespeicherten Datei (darüber wird nur skaliert)."""
    row = await _row_for(db, motif_key, variant, version)
    width, height = int(row.get("width_px") or 0), int(row.get("height_px") or 0)
    view_box = row.get("view_box")
    if view_box and len(view_box) == 4 and view_box[3]:
        aspect = float(view_box[2]) / float(view_box[3])
    else:
        aspect = width / height if width and height else None
    return {"design_key": motif_key, "variant": variant, "version": row["version"],
            "served_variant": row.get("variant") or "dark", "origin": row.get("origin") or "upload",
            "source_format": row.get("source_format"), "is_vector": bool(row.get("svg_ref")),
            "width_px": width or None, "height_px": height or None, "aspect_ratio": aspect, "sha256": row.get("sha256")}


# ---------------------------------------------------------------- Migration 14: Fassungen und Ausnahmen

MIGRATION_VERSION = 14
MIGRATION_NAME = "shop_motif_variants"


async def _legacy_exceptions(db) -> dict[str, list[str]]:
    """Feste Zuordnungen aus #1708/#1707: die Farbliste eines Designs und jede Zelle „Farbe → Design“ in den
    Produkten. Sie galten bisher mit der Hauptdatei - als Ausnahme „dunkel“ bleibt das so."""
    out: dict[str, list[str]] = {}

    def add(key: Any, color: Any) -> None:
        name = " ".join(str(color or "").split())
        if not key or not name:
            return
        known = out.setdefault(str(key), [])
        if name.casefold() not in {item.casefold() for item in known}:
            known.append(name)

    async for profile in db.shop_design_profiles.find({}, {"_id": 0, "design_key": 1, "garment_colors": 1}):
        for color in profile.get("garment_colors") or []:
            add(profile["design_key"], color)
    async for product in db.shop_products.find({"placements.0": {"$exists": True}}, {"_id": 0, "placements": 1}):
        for row in product.get("placements") or []:
            for cell in row.get("designs") or []:
                add(cell.get("design_key"), cell.get("color"))
    return out


async def plan(db) -> dict:
    """Trockenlauf: was Migration 14 ändert bzw. geändert hat. Schreibt nichts."""
    legacy = await _legacy_exceptions(db)
    pending = [profile["design_key"] async for profile in db.shop_design_profiles.find(
        {"light_mode": {"$exists": False}}, {"_id": 0, "design_key": 1})]
    return {
        "versions_without_variant": await db.shop_designs.count_documents({"variant": {"$exists": False}}),
        "motifs_without_mode": len(pending),
        "exceptions": {key: legacy[key] for key in sorted(pending) if legacy.get(key)},
        "light_versions": await db.shop_designs.count_documents({"variant": "light"}),
        "svg_versions": await db.shop_designs.count_documents({"source_format": "SVG"}),
    }


async def apply(db) -> str:
    """Bestehende Fassungen sind Hauptdateien („für dunkle Shirts“); bestehende Designs bekommen „Hell-Variante
    automatisch“ und ihre festen Farben als Ausnahme „dunkel“ - so druckt jede bisher zugeordnete Farbe weiter die
    Datei, die sie bisher hatte. Mehrfach aufrufbar; nur, was noch fehlt."""
    marked = await db.shop_designs.update_many({"variant": {"$exists": False}}, {"$set": {"variant": "dark"}})
    legacy = await _legacy_exceptions(db)
    motifs = exceptions = 0
    async for profile in db.shop_design_profiles.find({"light_mode": {"$exists": False}}, {"_id": 0}):
        taken = list(profile.get("color_variants") or [])
        names = {_color_key(item.get("color")) for item in taken}
        for color in legacy.get(profile["design_key"], []):
            if _color_key(color) not in names and len(taken) < MAX_EXCEPTIONS:
                taken.append({"color": color, "variant": "dark"})
                exceptions += 1
        await db.shop_design_profiles.update_one({"design_key": profile["design_key"]},
                                                 {"$set": {"light_mode": "auto", "color_variants": taken}})
        motifs += 1
    return (f"{getattr(marked, 'modified_count', 0)} versions marked dark, {motifs} motifs prepared, "
            f"{exceptions} colour exceptions kept")


async def rollback(db, *, apply: bool = False) -> dict:
    """Rückweg: Fassungs-Felder und Ausnahmen entfernen, Migration 14 austragen. Verweigert, solange es Fassungen für
    helle Shirts gibt - die ältere Version würde sie als neueste Hauptdatei nehmen."""
    light = await db.shop_designs.count_documents({"variant": "light"})
    report = {"applied": False, "blocked_by": {"light_versions": light} if light else {},
              "versions": await db.shop_designs.count_documents({"variant": "dark"}),
              "motifs": await db.shop_design_profiles.count_documents(
                  {"$or": [{"light_mode": {"$exists": True}}, {"color_variants": {"$exists": True}},
                           {"light_auto": {"$exists": True}}]})}
    if not apply or light:
        return report
    await db.shop_designs.update_many({"variant": "dark"}, {"$unset": {"variant": ""}})
    await db.shop_design_profiles.update_many({}, {"$unset": {"light_mode": "", "light_auto": "",
                                                              "color_variants": ""}})
    await db.schema_migrations.delete_many({"version": MIGRATION_VERSION, "name": MIGRATION_NAME})
    report["applied"] = True
    return report


async def migrate_motif_variants(db) -> str:
    """Migration 14 (#2069): Designs werden Motive mit Fassungen für dunkle und helle Shirts."""
    return await apply(db)


def render_text(report: dict, *, way_back: dict | None = None) -> str:
    lines = ["Motive mit Fassungen für dunkle und helle Shirts (#2069, docs/SHOP.md)"]
    lines.append(f"  offen   {report['versions_without_variant']} Fassungen ohne Variante (werden „für dunkle Shirts“)")
    lines.append(f"  offen   {report['motifs_without_mode']} Designs ohne Einstellung „Hell-Variante“")
    for key, colors in report["exceptions"].items():
        lines.append(f"  Ausnahme {key}: {', '.join(colors)} → Hauptdatei (wie bisher)")
    lines.append(f"  Daten   {report['light_versions']} Fassungen für helle Shirts, {report['svg_versions']} aus SVG")
    if way_back is not None:
        if way_back["blocked_by"]:
            lines.append(f"Rückweg verweigert: {way_back['blocked_by']['light_versions']} Fassungen für helle Shirts "
                         "vorhanden - die ältere Version würde sie als Hauptdatei nehmen.")
        elif way_back["applied"]:
            lines.append(f"Rückweg ausgeführt: Varianten von {way_back['versions']} Fassungen und Einstellungen von "
                         f"{way_back['motifs']} Designs entfernt, Migration {MIGRATION_VERSION} ausgetragen.")
        else:
            lines.append(f"Rückweg (Trockenlauf): {way_back['versions']} Fassungen und {way_back['motifs']} Designs "
                         "würden zurückgesetzt - mit --anwenden ausführen.")
    return "\n".join(lines) + "\n"
