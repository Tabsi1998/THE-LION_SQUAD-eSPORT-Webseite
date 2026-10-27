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

- **Als Paar** (#2084): beide Fassungen in einem Schritt (``upload_pair``) mit Paar-Prüfung (``pair_check``: Format
  und Seitenverhältnis, Umrisse, Kontrast - Ampel mit Klartext, Schwellen einstellbar) und automatischer Zuordnung
  (``assign_pair``). Gespeichert werden beide oder keine. Wird danach nur eine Fassung ersetzt, meldet ``pair_state``
  das Paar als veraltet.

Für den Druckdatei-Generator (#2069 Teil B): ``render_motif_png`` rastert ein Motiv in genau der verlangten Breite.
Migration 14 (``shop_motif_variants``) mit Trockenlauf und Rückweg: ``backend/scripts/shop_motifs.py``.
Beschreibung: ``docs/SHOP.md``, Abschnitt „Motive (#2069)“.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import io
import logging
import math
import re
import weakref
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat

from models import now_utc
from services import shop_catalog, shop_designs, svg_safe
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.shop_common import ShopConflict, ShopError, clean_reason, record_admin_action

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


def _valid_number(value: Any, low: float, high: float) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return round(float(value), 3) if low <= value <= high else None


def _valid_threshold(value: Any) -> float | None:
    return _valid_number(value, MIN_THRESHOLD, MAX_THRESHOLD)


# Paar-Prüfung (#2084): Vorgabe, kleinster und größter Wert. Seitenverhältnis: erlaubte Abweichung (0,02 = 2 %);
# Überdeckung: Anteil der gemeinsamen Silhouette (IoU der gefüllten Umrisse), darunter Gelb; Kontrast: Anteil sehr
# heller bzw. sehr dunkler Fläche, darüber Gelb; Lage: größte Verschiebung einer Kante des Logo-Rahmens, darüber Gelb.
PAIR_SETTINGS = {
    "pair_aspect_tolerance": (0.02, 0.005, 0.2, "Erlaubte Abweichung des Seitenverhältnisses"),
    "pair_min_overlap": (0.85, 0.5, 0.99, "Mindest-Überdeckung der Umrisse"),
    "pair_contrast_share": (0.03, 0.001, 0.5, "Höchstanteil sehr heller bzw. sehr dunkler Fläche"),
    "pair_position_tolerance": (0.03, 0.005, 0.3, "Erlaubte Verschiebung des Logos in der Zeichenfläche"),
}
SETTING_NAMES = ("light_ink", "threshold", *PAIR_SETTINGS)


async def load_settings(db) -> dict:
    """Ersatzfarbe für helle Shirts, Helligkeits-Schwelle und die Schwellen der Paar-Prüfung - gespeichert oder
    Vorgabe."""
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    ink = _valid_ink(doc.get("light_ink")) or DEFAULT_LIGHT_INK
    threshold = _valid_threshold(doc.get("threshold"))
    threshold = DEFAULT_THRESHOLD if threshold is None else threshold
    pair = {}
    for name, (default, low, high, _label) in PAIR_SETTINGS.items():
        value = _valid_number(doc.get(name), low, high)
        pair[name] = default if value is None else value
    defaults = {"light_ink": DEFAULT_LIGHT_INK, "threshold": DEFAULT_THRESHOLD,
                **{name: spec[0] for name, spec in PAIR_SETTINGS.items()}}
    limits = {"min_threshold": MIN_THRESHOLD, "max_threshold": MAX_THRESHOLD,
              **{f"{name}_min": spec[1] for name, spec in PAIR_SETTINGS.items()},
              **{f"{name}_max": spec[2] for name, spec in PAIR_SETTINGS.items()}}
    values = {"light_ink": ink, "threshold": threshold, **pair}
    return {**values, "replaced_color": REPLACED_COLOR,
            "is_default": all(values[name] == defaults[name] for name in SETTING_NAMES),
            "defaults": defaults, "limits": limits}


async def set_settings(db, fields: dict, *, actor_id: str, reason: Any) -> tuple[dict, list[str]]:
    """Ersatzfarbe, Schwelle bzw. Schwellen der Paar-Prüfung ändern - mit vorher/nachher im Protokoll. Eine neue
    Ersatzfarbe erzeugt die automatischen Fassungen neu (neue Versionen; Bestellungen behalten ihre)."""
    unknown = sorted(set(fields) - set(SETTING_NAMES))
    if unknown:
        raise ShopError(f"Unbekannte Felder: {', '.join(unknown)}.")
    reason = clean_reason(reason)
    current = await load_settings(db)
    after = {name: current[name] for name in SETTING_NAMES}
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
    for name, (_default, low, high, label) in PAIR_SETTINGS.items():
        if name in fields:
            value = _valid_number(fields[name], low, high)
            if value is None:
                raise ShopError(f"{label}: Zahl von {low} bis {high}.")
            after[name] = value
    changed = [name for name in SETTING_NAMES if after[name] != current[name]]
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
    # Halbe Paare (#2084, ``pending``) gelten nie - erst wenn beide Fassungen liegen.
    return await db.shop_designs.find({"design_key": key, "pending": {"$ne": True}},
                                      {"_id": 0}).sort("version", -1).to_list(2000)


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
    Ausnahme des Motivs, sonst Helligkeit; ohne Farbwert die Hauptdatei wie vor #2069.

    Wurde für ein Motiv **noch nie** eine Fassung für helle Shirts erzeugt (Designs aus der Zeit vor #2069, auch bevor
    Migration 14 fertig ist), druckt es wie bisher die Hauptdatei - statt die Bestellung scheitern zu lassen. Sonst
    ``None``, wenn die passende Fassung fehlt (etwa ein PNG, das sich nicht umfärben ließ) - dann ist die Farbe nicht
    bestellbar."""
    profile = await shop_designs.get_profile(db, motif_key)
    settings = await load_settings(db)
    variant = variant_for_garment(color_hex, color=color, threshold=settings["threshold"],
                                  exceptions=exceptions_of(profile)) or "dark"
    if variant == "light" and _never_had_light(profile):
        variant = "dark"
    return await resolve(db, motif_key, variant)


def _never_had_light(profile: dict | None) -> bool:
    profile = profile or {}
    return profile.get("light_mode") != "file" and not profile.get("light_auto")


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
    bestehendes behält seine Platzierung. Nach einer neuen Hauptdatei entsteht die automatische Fassung. Je Motiv ein
    Upload zugleich (#2084) - auch gegen ein gleichzeitiges Paar."""
    key = shop_designs._design_key(design_key)
    async with _motif_lock(db, key):
        return await _upload_locked(db, design_key=key, data=data, filename=filename, content_type=content_type,
                                    actor_id=actor_id, reason=reason, title=title, placement=placement,
                                    garment_colors=garment_colors, variant=variant)


async def _upload_locked(db, *, design_key: str, data: bytes, filename: str, content_type: str, actor_id: str,
                         reason: Any, title: Any, placement: str | None, garment_colors: Any, variant: str) -> dict:
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
    spec = (await shop_designs.placement_specs(db))[placement]
    prepared = await prepare_file(data, filename, content_type, spec)
    rows_before = await _rows(db, key) if profile else []

    async def create() -> None:
        await shop_designs.create_profile(db, key, title=title, placement=placement, garment_colors=garment_colors,
                                          actor_id=actor_id, reason=reason)

    design, fit = await shop_designs.save_version(
        db, key, image=prepared["image"], spec=spec, placement=placement, source_format=prepared["source_format"],
        variant=variant, origin="upload", actor_id=actor_id, reason=reason, svg_bytes=prepared["svg_bytes"],
        extra=prepared["extra"], before_insert=None if profile else create)
    warnings = _file_warnings(design, fit, prepared["source_format"])
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
    if profile:
        await _note_single_upload(db, key, variant, rows_before)
    pair = pair_state(await shop_designs.get_profile(db, key), await _rows(db, key))
    if pair["stale"]:
        warnings.append(pair["hint"])
    return {**design, "warnings": warnings, "light": light, "pair": pair}


def _file_warnings(design: dict, fit: dict, source_format: str) -> list[str]:
    warnings = []
    if not design["has_alpha"]:
        warnings.append("Kein durchsichtiger Hintergrund: die Fläche um das Motiv wird mitgedruckt."
                        + (" JPG kann keine Transparenz - für Logos besser PNG." if source_format == "JPG" else ""))
    if fit["level"] == "snug":
        warnings.append(fit["text"])
    return warnings


def _svg_clean(data: bytes) -> tuple[bytes, dict]:
    clean = svg_safe.sanitize(data)
    return clean.data, svg_safe.analyze(clean.data)


async def _prepare_svg_preview(data: bytes, spec: dict) -> tuple[Image.Image, bytes, dict, tuple[int, int]]:
    """Nur für die Prüfung (#2084): streng bereinigen, aber klein rastern (``PAIR_SIDE`` an der längeren Seite) - der
    gemeinsame Rasterplatz bleibt frei. Die Druckgröße folgt aus der viewBox: ein SVG erreicht jede DPI."""
    try:
        clean, info = await asyncio.to_thread(_svg_clean, data)
        aspect = float(info["aspect_ratio"])
        width = _pair_size(aspect)[0]
        payload = await asyncio.to_thread(svg_safe.rasterize, clean, width_px=width)
    except svg_safe.SvgRejected as rejected:
        raise SvgRefused(rejected) from None
    image = _open_png(payload)
    if image.getchannel("A").getbbox() is None:
        raise ShopError(svg_safe.NOTHING)
    print_width = math.ceil(float(spec["print_width_in"]) * print_dpi(spec) - 1e-9)
    return image, clean, info, (print_width, max(1, round(print_width / aspect)))


async def prepare_file(data: bytes, filename: str, content_type: str, spec: dict, *, preview: bool = False) -> dict:
    """Eine hochgeladene Datei prüfen und für die Druckdatei vorbereiten - SVG streng bereinigt und gerastert, PNG/JPG
    neu kodiert. Schreibt nichts. Liefert Bild, bereinigtes SVG (oder ``None``), Format, Seitenverhältnis (bei SVG aus
    der viewBox), die Größe der Druckdatei (``print_size``) und die Zusatzfelder der Version. Mit ``preview`` (nur
    prüfen) wird ein SVG nur klein gerastert."""
    if len(data) > shop_designs.MAX_BYTES:
        raise ShopError(f"Datei zu groß (höchstens {shop_designs.MAX_UPLOAD_MB} MB).")
    if not data:
        raise ShopError("Die Datei ist leer.")
    if shop_designs.looks_like_svg(Path(filename or "").suffix.lower(), content_type or "", data[:8192]):
        if preview:
            image, svg_bytes, info, size = await _prepare_svg_preview(data, spec)
            check = image
        else:
            image, svg_bytes, info = await prepare_svg(data, spec)
            size = image.size
            # Die Ampel beim Speichern rechnet mit demselben kleinen Raster wie die Prüfung - sonst könnte ein Paar
            # knapp an der Schwelle dort Grün und hier Gelb sein (#2084).
            try:
                small = await asyncio.to_thread(svg_safe.rasterize, svg_bytes,
                                                width_px=_pair_size(float(info["aspect_ratio"]))[0])
            except svg_safe.SvgRejected as rejected:
                raise SvgRefused(rejected) from None
            check = _open_png(small)
        return {"image": image, "check_image": check, "svg_bytes": svg_bytes, "source_format": "SVG",
                "is_vector": True, "aspect": float(info["aspect_ratio"]), "name": filename, "print_size": size,
                "extra": {"colors": [item["hex"] for item in info["colors"]][:24], "view_box": info["view_box"]}}
    # Große Pixelbilder neu kodieren dauert - außerhalb der Ereignisschleife (#2084).
    image, source_format = await asyncio.to_thread(shop_designs.prepare, data, filename, content_type)
    return {"image": image, "check_image": image, "svg_bytes": None, "source_format": source_format,
            "is_vector": False, "aspect": image.width / image.height, "name": filename, "print_size": image.size,
            "extra": {}}


# ---------------------------------------------------------------- Paar: hell + dunkel in einem Schritt (#2084)

PAIR_SIDE = 512          # die Prüfung rastert beide Fassungen gleich groß: 512 px an der längeren Seite
PALE_LUMA = 225          # ab hier (Luma 0-255) ist eine Fläche „sehr hell“ - verschwindet auf hellen Shirts
DEEP_LUMA = 40           # bis hier „sehr dunkel“ - verschwindet auf dunklen Shirts
SWAP_MARGIN = 6          # so viel heller (Luma) muss die andere Datei sein, damit die Zuordnung tauscht
MARK_COLOR = (255, 0, 170, 255)  # Markierung in der Vorschau: grelles Magenta, auf beiden Shirts sichtbar
SIDE_LABELS = {"dark": "Datei für dunkle Shirts", "light": "Datei für helle Shirts"}


def _de(value: float, digits: int = 2) -> str:
    return f"{value:.{digits}f}".replace(".", ",")


def _percent(share: float) -> str:
    return f"{share * 100:.0f} %" if share >= 0.01 or share == 0 else "unter 1 %"


def _small(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = image.convert("RGBA")
    return rgba if rgba.size == size else rgba.resize(size, Image.Resampling.BOX)


def _visible(image: Image.Image) -> Image.Image:
    return image.getchannel("A").point(lambda a: 255 if a >= 128 else 0)


def _count(mask: Image.Image) -> int:
    return mask.histogram()[255]


def _luma_mask(image: Image.Image, visible: Image.Image, *, pale: bool) -> Image.Image:
    luma = image.convert("RGB").convert("L")
    band = luma.point(lambda v: 255 if v >= PALE_LUMA else 0) if pale else luma.point(
        lambda v: 255 if v <= DEEP_LUMA else 0)
    return ImageChops.multiply(band, visible)


def _mean_luma(image: Image.Image) -> float:
    visible = _visible(image)
    if not _count(visible):
        return 0.0
    return ImageStat.Stat(image.convert("RGB").convert("L"), visible).mean[0]


def _data_url(image: Image.Image) -> str:
    return "data:image/png;base64," + base64.b64encode(svg_safe.png_bytes(image)).decode("ascii")


def _mark(mask: Image.Image) -> str:
    """Die markierten Stellen als durchsichtiges PNG - etwas verbreitert, damit auch dünne Linien sichtbar sind."""
    wide = mask.filter(ImageFilter.MaxFilter(5))
    overlay = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    overlay.paste(Image.new("RGBA", mask.size, MARK_COLOR), (0, 0), wide)
    return _data_url(overlay)


# „Closing“ bei 512 px um etwa 4 % (zehnmal 3 × 3 = 21 px): feine Linienkunst bekommt eine geschlossene Kontur, und
# Kerben zwischen Strähnen, die nur eine Fassung offen lässt, zählen nicht als anderer Umriss. Gemessen am echten
# Löwen-Paar des Vereins (Positiv gegen Negativ): 5 px ergab 88 %, 21 px 93 % gemeinsam.
CLOSE_STEPS = 10


def _check_image(item: dict) -> Image.Image:
    """Das Bild für die Ampel - bei Prüfen und Speichern dasselbe kleine Raster."""
    return item.get("check_image") or item["image"]


def _silhouette(mask: Image.Image) -> Image.Image:
    """Der gefüllte Außenumriss einer Maske (0/255): erst ein kleines Closing, dann alles, was von außen nicht
    erreichbar ist, gilt als innen - Löcher und Lücken zwischen Linien werden Fläche."""
    # Mit Rand, damit das Closing am Bildrand nichts abschneidet und das Füllen von außen überall herumkommt.
    pad = CLOSE_STEPS + 1
    padded = Image.new("L", (mask.width + 2 * pad, mask.height + 2 * pad), 0)
    padded.paste(mask, (pad, pad))
    for _ in range(CLOSE_STEPS):
        padded = padded.filter(ImageFilter.MaxFilter(3))
    for _ in range(CLOSE_STEPS):
        padded = padded.filter(ImageFilter.MinFilter(3))
    ImageDraw.floodfill(padded, (0, 0), 128, thresh=0)
    outside = padded.crop((pad, pad, mask.width + pad, mask.height + pad))
    return outside.point(lambda v: 0 if v == 128 else 255)


def _box_shift(first: Image.Image, second: Image.Image) -> float | None:
    """Wie weit die Rahmen der sichtbaren Flächen auseinanderliegen - größte Kante, als Anteil von Breite bzw. Höhe."""
    a, b = first.getbbox(), second.getbbox()
    if a is None or b is None:
        return None
    width, height = first.size
    return max(abs(a[0] - b[0]) / width, abs(a[2] - b[2]) / width, abs(a[1] - b[1]) / height,
               abs(a[3] - b[3]) / height)


def _pair_size(aspect: float) -> tuple[int, int]:
    if aspect >= 1:
        return PAIR_SIDE, max(1, round(PAIR_SIDE / aspect))
    return max(1, round(PAIR_SIDE * aspect)), PAIR_SIDE


def assign_pair(first: dict, second: dict) -> tuple[dict, dict, bool, bool]:
    """Welche Datei für dunkle Shirts ist: die mit mehr heller bzw. weißer Fläche. ``(dunkel, hell, getauscht,
    unsicher)`` - getauscht heißt, ``second`` war heller und gilt nun für dunkle Shirts. Ohne durchsichtigen
    Hintergrund (JPG, PNG mit Fläche) zählt der Hintergrund mit: dann bleibt die Zuordnung, ``unsicher`` ist wahr."""
    if not all(shop_designs.has_transparency(item["image"]) for item in (first, second)):
        return first, second, False, True
    size = _pair_size(first["aspect"])
    a, b = _mean_luma(_small(_check_image(first), size)), _mean_luma(_small(_check_image(second), size))
    return (second, first, True, False) if b > a + SWAP_MARGIN else (first, second, False, False)


def pair_check(dark: dict, light: dict, settings: dict | None = None) -> dict:
    """Passen die beiden Fassungen zusammen? Ampel mit Klartext je Prüfung:

    - **Format** (Rot): beide SVG (am besten) oder beide Pixelbild; Seitenverhältnis (bei SVG aus der viewBox) weicht
      um mehr als ``pair_aspect_tolerance`` ab; eine Datei reicht nicht für den Druckbereich.
    - **Umrisse** (Gelb): beide gleich groß gerastert (``PAIR_SIDE``), die gefüllten Außenumrisse verglichen (IoU der
      Silhouetten, nicht der Tinte - eine Fassung darf ein Negativ der anderen sein) - unter ``pair_min_overlap``.
    - **Lage** (Gelb): der Rahmen der sichtbaren Fläche liegt in beiden Dateien gleich - eine Kante weicht um mehr als
      ``pair_position_tolerance`` der Breite bzw. Höhe ab.
    - **Kontrast** (Gelb): sehr Helles in der Hell-Fassung bzw. sehr Dunkles in der Dunkel-Fassung über
      ``pair_contrast_share`` der Fläche - die Stellen kommen als Markierung (PNG) für die Vorschau mit.

    ``dark``/``light`` sind vorbereitete Dateien aus ``prepare_file`` (dazu optional ``fit``). Schreibt nichts."""
    settings = settings or {name: spec[0] for name, spec in PAIR_SETTINGS.items()}
    tolerance, min_overlap = settings["pair_aspect_tolerance"], settings["pair_min_overlap"]
    max_share = settings["pair_contrast_share"]
    max_shift = settings.get("pair_position_tolerance", PAIR_SETTINGS["pair_position_tolerance"][0])
    checks: list[dict] = []

    if dark["is_vector"] != light["is_vector"]:
        checks.append({"key": "format", "level": "red",
                       "text": "Beide Dateien bitte im selben Format: zwei SVGs (am besten) oder zwei PNG."})
    for side, item in (("dark", dark), ("light", light)):
        fit = item.get("fit")
        if fit and fit["problems"]:
            checks.append({"key": f"fit_{side}", "level": "red", "text": f"{SIDE_LABELS[side]}: {fit['text']}"})

    a_dark, a_light = dark["aspect"], light["aspect"]
    deviation = max(a_dark, a_light) / min(a_dark, a_light) - 1
    aspect_ok = deviation <= tolerance + 1e-9
    checks.append({"key": "aspect", "level": "green" if aspect_ok else "red", "dark": round(a_dark, 4),
                   "light": round(a_light, 4), "deviation": round(deviation, 4),
                   "text": (f"Gleiches Format (Seitenverhältnis {_de(a_dark)})." if aspect_ok else
                            f"Die beiden Dateien haben unterschiedliche Formate: {_de(a_dark)} zu {_de(a_light)} – "
                            "bitte gleiche Zeichenfläche verwenden.")})

    size = _pair_size(a_dark)
    small_dark, small_light = _small(_check_image(dark), size), _small(_check_image(light), size)
    seen_dark, seen_light = _visible(small_dark), _visible(small_light)
    if aspect_ok:
        # Silhouette statt Tinte: die Fassung „auf Weiß“ ist oft zeichnerisch ein Negativ - ihre Linien liegen in den
        # Lücken der Fassung „auf Schwarz“. Verglichen werden die gefüllten Außenumrisse.
        shape_dark, shape_light = _silhouette(seen_dark), _silhouette(seen_light)
        union = _count(ImageChops.lighter(shape_dark, shape_light))
        overlap = _count(ImageChops.darker(shape_dark, shape_light)) / union if union else 1.0
        good = overlap >= min_overlap
        checks.append({"key": "overlap", "level": "green" if good else "yellow", "value": round(overlap, 4),
                       "text": (f"Die Umrisse passen ({_percent(overlap)} gemeinsam)." if good else
                                f"Die Umrisse der beiden Fassungen weichen ab ({_percent(overlap)} gemeinsam) – sind "
                                "das wirklich zwei Fassungen desselben Logos?")})
        shift = _box_shift(seen_dark, seen_light)
        if shift is not None:
            placed = shift <= max_shift + 1e-9
            checks.append({"key": "position", "level": "green" if placed else "yellow", "value": round(shift, 4),
                           "text": ("Das Logo sitzt in beiden Dateien gleich." if placed else
                                    f"Das Logo sitzt in den Dateien unterschiedlich (bis {_percent(shift)} der "
                                    "Zeichenfläche verschoben) – Rand oder Position prüfen.")})

    marks: dict[str, str | None] = {"dark": None, "light": None}
    for side, small, seen, pale in (("light", small_light, seen_light, True), ("dark", small_dark, seen_dark, False)):
        flagged = _luma_mask(small, seen, pale=pale)
        hits, total = _count(flagged), _count(seen)
        share = hits / total if total else 0.0
        if hits:
            marks[side] = _mark(flagged)
        good = share <= max_share
        if pale:
            text = ("Kontrast auf hellen Shirts ok." if good else
                    f"Die Fassung für helle Shirts enthält Weiß bzw. sehr Helles ({_percent(share)} der Fläche) – das "
                    "verschwindet auf hellen Shirts. Die Stellen sind in der Vorschau markiert.")
        else:
            text = ("Kontrast auf dunklen Shirts ok." if good else
                    f"Die Fassung für dunkle Shirts enthält Schwarz bzw. sehr Dunkles ({_percent(share)} der Fläche) – "
                    "das verschwindet auf dunklen Shirts. Die Stellen sind in der Vorschau markiert.")
        checks.append({"key": f"contrast_{side}", "level": "green" if good else "yellow", "share": round(share, 4),
                       "text": text})

    levels = {item["level"] for item in checks}
    level = "red" if "red" in levels else "yellow" if "yellow" in levels else "green"
    # Wirken die Dateien vertauscht? Die Hell-Fassung ist deutlich heller als die Dunkel-Fassung.
    suggest_swap = _mean_luma(small_light) > _mean_luma(small_dark) + SWAP_MARGIN
    files = {side: {"name": item.get("name") or "", "format": item["source_format"], "is_vector": item["is_vector"],
                    "aspect": round(item["aspect"], 4),
                    "width_px": (item.get("print_size") or item["image"].size)[0],
                    "height_px": (item.get("print_size") or item["image"].size)[1]}
             for side, item in (("dark", dark), ("light", light))}
    return {"level": level, "checks": checks, "suggest_swap": suggest_swap, "files": files,
            "previews": {"dark": _data_url(small_dark), "light": _data_url(small_light)}, "marks": marks,
            "thresholds": {name: settings[name] for name in PAIR_SETTINGS}}


def _summary(report: dict) -> str:
    """Der erste rote bzw. gelbe Befund als Meldung."""
    for wanted in ("red", "yellow"):
        texts = [item["text"] for item in report["checks"] if item["level"] == wanted]
        if texts:
            return " ".join(texts)
    return "Das Paar passt."


def _without_images(report: dict) -> dict:
    return {key: value for key, value in report.items() if key not in ("previews", "marks")}


async def _pair_target(db, design_key: Any, placement: str | None, *, title: Any = None, garment_colors: Any = None,
                       saving: bool = False) -> tuple[str, dict | None, str]:
    key = shop_designs._design_key(design_key)
    profile = await shop_designs.get_profile(db, key)
    if profile:
        if placement and placement != profile["placement"]:
            raise ShopError(f"Dieses Design gehört zu „{shop_designs.PLACEMENT_LABELS[profile['placement']]}“. Für "
                            "eine andere Platzierung bitte ein eigenes Design anlegen.")
        return key, profile, profile["placement"]
    if placement not in shop_catalog.PLACEMENTS:
        raise ShopError("Neues Design: bitte die Platzierung wählen.")
    if saving:
        shop_designs._line(title, "Titel", 120, required=True)
        await shop_designs._check_colors_free(db, key, placement, shop_designs.clean_colors(garment_colors))
    return key, None, placement


async def _prepare_pair(db, placement: str, dark_file: tuple, light_file: tuple, auto_assign: bool, *,
                        preview: bool) -> tuple:
    spec = (await shop_designs.placement_specs(db))[placement]
    prepared = []
    for side, (data, filename, content_type) in (("dark", dark_file), ("light", light_file)):
        try:
            item = await prepare_file(data, filename, content_type, spec, preview=preview)
        except ShopError as exc:
            exc.args = (f"{SIDE_LABELS[side]} ({filename or 'ohne Namen'}): {exc}",)
            raise
        item["fit"] = shop_designs.check_fit(*item["print_size"], spec)
        prepared.append(item)
    dark, light = prepared
    swapped = uncertain = False
    if auto_assign:
        dark, light, swapped, uncertain = await asyncio.to_thread(assign_pair, dark, light)
    return spec, dark, light, swapped, uncertain


# Paar prüfen bzw. speichern rastert und rechnet viel: je Prozess eins zugleich - wer kurz wartet, kommt dran, sonst
# „gleich noch einmal“ (429). So bleibt der gemeinsame Rasterplatz (svg_safe) für Logos und Druckdateien frei.
PAIR_WAIT_SECONDS = 3.0
PAIR_BUSY = "Gerade wird schon ein Motiv-Paar geprüft oder gespeichert - bitte gleich noch einmal versuchen."
MOTIF_BUSY = "Für dieses Motiv läuft gerade ein Upload."
_PAIR_SLOTS: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


class PairBusy(ShopError):
    status = 429


def pair_semaphore() -> asyncio.Semaphore:
    """Der Platz für die Paar-Verarbeitung - je Ereignisschleife einer (ein Semaphor gehört zu genau einer)."""
    loop = asyncio.get_running_loop()
    slot = _PAIR_SLOTS.get(loop)
    if slot is None:
        slot = _PAIR_SLOTS[loop] = asyncio.Semaphore(1)
    return slot


@contextlib.asynccontextmanager
async def _pair_slot():
    slot = pair_semaphore()
    try:
        await asyncio.wait_for(slot.acquire(), timeout=PAIR_WAIT_SECONDS)
    except asyncio.TimeoutError:
        raise PairBusy(PAIR_BUSY) from None
    try:
        yield
    finally:
        slot.release()


@contextlib.asynccontextmanager
async def _motif_lock(db, key: str):
    """Je Motiv ein Upload zugleich (auch über mehrere Prozesse) - sonst könnten zwei Paare gemischt gelten."""
    try:
        async with mutation_lock(db, f"shop:motif:{key}", wait_seconds=0.0, lease_seconds=120.0):
            yield
    except MutationLockBusy as exc:
        raise ShopConflict(MOTIF_BUSY) from exc


async def check_pair(db, *, dark_file: tuple, light_file: tuple, design_key: Any = None, placement: str | None = None,
                     auto_assign: bool = False) -> dict:
    """Nur prüfen (Vorschau vor dem Speichern): Ampel, Klartext, Vorschau beider Fassungen und Markierungen. Die
    Platzierung kommt vom bestehenden Motiv bzw. aus dem Formular - sie bestimmt die Druckbreite. SVGs werden dafür nur
    klein gerastert (die Druckgröße folgt aus der viewBox), voll erst beim Speichern. Schreibt nichts."""
    if design_key:
        _key, _profile, placement = await _pair_target(db, design_key, placement)
    elif placement not in shop_catalog.PLACEMENTS:
        raise ShopError("Bitte die Platzierung wählen.")
    settings = await load_settings(db)
    async with _pair_slot():
        _spec, dark, light, swapped, uncertain = await _prepare_pair(db, placement, dark_file, light_file,
                                                                     auto_assign, preview=True)
        report = await asyncio.to_thread(pair_check, dark, light, settings)
    return {**report, "swapped": swapped, "assign_uncertain": uncertain, "summary": _summary(report)}


async def _in_orders(db, key: str, version: int) -> bool:
    return bool(await db.shop_order_items.count_documents({"$or": [
        {"design.design_key": key, "design.version": version},
        {"designs": {"$elemMatch": {"design_key": key, "version": version}}}]}))


async def _remove_pending(db, design: dict) -> str:
    """Rückweg, wenn ein Paar scheitert: die eben angelegte, noch nicht freigeschaltete Version samt Dateien
    entfernen - nie eine freigeschaltete und nie eine, auf die eine Bestellung zeigt. ``removed``, ``orders`` (bleibt
    wegen einer Bestellung) oder ``none`` (nicht mehr da bzw. schon freigeschaltet)."""
    if await _in_orders(db, design["design_key"], design["version"]):
        logger.error("[shop-motifs] %s v%s steht in einer Bestellung - bleibt liegen", design["design_key"],
                     design["version"])
        return "orders"
    result = await db.shop_designs.delete_one({"id": design["id"], "pending": True})
    if getattr(result, "deleted_count", 0) != 1:
        return "none"
    for path in (shop_designs._path_of(design.get("file_ref")), shop_designs.svg_path_of(design.get("svg_ref"))):
        if path is not None:
            path.unlink(missing_ok=True)
    return "removed"


async def _remove_profile(db, key: str, placement: str) -> None:
    await db.shop_design_profiles.delete_one({"design_key": key})
    await db.shop_design_colors.delete_many({"placement": placement, "design_key": key})


async def _restore_profile(db, key: str, before: dict) -> None:
    """Fassung für helle Shirts und gemerktes Paar wie vor dem gescheiterten Paar; die Markierung fällt weg."""
    values = {name: before.get(name) for name in ("light_mode", "light_pair")}
    keep = {name: value for name, value in values.items() if value is not None}
    drop = {name: "" for name, value in values.items() if value is None}
    drop["pair_pending"] = ""
    await db.shop_design_profiles.update_one({"design_key": key}, {**({"$set": keep} if keep else {}),
                                                                   "$unset": drop})


async def _mark_pair_pending(db, key: str, before: dict | None, *, created: bool) -> None:
    """Am Motiv vermerken, dass ein Paar gerade gespeichert wird - mit dem Stand davor. Stürzt der Prozess mitten im
    Speichern ab, stellt ``sweep_pending`` damit den alten Stand wieder her."""
    before = before or {}
    await db.shop_design_profiles.update_one({"design_key": key}, {"$set": {"pair_pending": {
        "at": now_utc().isoformat(), "created": created,
        "before": {"light_mode": before.get("light_mode") or "auto", "light_pair": before.get("light_pair")}}}})


# ---------------------------------------------------------------- Aufräumen nach einem Absturz (#2084)

PENDING_MAX_AGE = timedelta(minutes=15)  # deutlich länger als die Sperre je Motiv (120 s, laufend erneuert)


def _older(value: Any, cutoff: datetime) -> bool:
    try:
        stamp = datetime.fromisoformat(str(value))
    except ValueError:
        return True  # ohne lesbare Zeit: alt genug
    return stamp <= cutoff


async def sweep_pending(db, *, now: datetime | None = None) -> dict:
    """Halbe Paare nach einem Absturz aufräumen (Zeitplan, alle 15 Minuten): ``pending``-Versionen älter als
    ``PENDING_MAX_AGE`` samt Dateien entfernen - nie eine, auf die eine Bestellung zeigt -, das Motiv auf den Stand vor
    dem Paar zurücksetzen (aus ``pair_pending``), ein dabei neu angelegtes, nun leeres Motiv entfernen. Ist der alte
    Stand nicht bekannt und zeigt ``light_pair`` auf eine entfernte Version, gilt wieder „automatisch“ - das ist für
    helle Shirts besser als „fehlt“. Motive, an denen gerade jemand hochlädt, bleiben unberührt."""
    cutoff = (now or now_utc()) - PENDING_MAX_AGE
    rows: dict[str, list[dict]] = {}
    async for row in db.shop_designs.find({"pending": True}, {"_id": 0}):
        if _older(row.get("created_at"), cutoff):
            rows.setdefault(row["design_key"], []).append(row)
    marked = {profile["design_key"]: profile async for profile in db.shop_design_profiles.find(
        {"pair_pending": {"$exists": True}}, {"_id": 0}) if _older(profile["pair_pending"].get("at"), cutoff)}
    report = {"removed": 0, "kept_for_orders": 0, "motifs": []}
    for key in sorted(set(rows) | set(marked)):
        try:
            async with _motif_lock(db, key):
                gone = []
                for row in rows.get(key, []):
                    outcome = await _remove_pending(db, row)
                    if outcome == "removed":
                        gone.append(row["version"])
                    elif outcome == "orders":
                        report["kept_for_orders"] += 1
                report["removed"] += len(gone)
                await _settle_profile(db, key, gone)
                report["motifs"].append(key)
        except ShopConflict:
            continue  # dort läuft gerade ein Upload - beim nächsten Lauf
    if report["motifs"]:
        logger.warning("[shop-motifs] halbe Paare aufgeräumt: %s", report)
    return report


async def _settle_profile(db, key: str, gone: list[int]) -> None:
    profile = await shop_designs.get_profile(db, key)
    if not profile:
        return
    marker = profile.get("pair_pending") or {}
    if marker.get("created") and not await db.shop_designs.count_documents({"design_key": key}):
        await _remove_profile(db, key, profile["placement"])
        return
    pair = profile.get("light_pair") or {}
    if marker:
        live = await db.shop_designs.count_documents({"design_key": key, "pending": {"$ne": True},
                                                     "version": {"$in": [pair.get("dark"), pair.get("light")]}})
        if not gone and live == 2:  # das Paar war schon freigeschaltet - nur die Markierung blieb
            await db.shop_design_profiles.update_one({"design_key": key}, {"$unset": {"pair_pending": ""}})
        else:
            await _restore_profile(db, key, marker.get("before") or {})
        return
    if gone and (pair.get("dark") in gone or pair.get("light") in gone):
        await db.shop_design_profiles.update_one({"design_key": key}, {"$set": {"light_mode": "auto"},
                                                                       "$unset": {"light_pair": ""}})
    else:
        return
    try:
        await refresh_auto_light(db, key, actor_id="system", reason="Halbes Paar aufgeräumt")
    except ShopError as exc:
        logger.warning("[shop-motifs] Hell-Variante für %s nicht erzeugt: %s", key, exc)


async def upload_pair(db, *, design_key: Any, dark_file: tuple, light_file: tuple, actor_id: str, reason: Any,
                      title: Any = None, placement: str | None = None, garment_colors: Any = None,
                      auto_assign: bool = False, confirm_warnings: bool = False) -> dict:
    """Beide Fassungen eines Motivs in einem Schritt (#2084): prüfen, Paar-Prüfung, dann **beide oder keine**.

    - Rot (Format, Seitenverhältnis, Druckbereich): nichts wird gespeichert - Ergebnis ``{"refused": {"status": 400,
      "detail": Meldung, "pair": Bericht}}`` (keine Ausnahme: die Route baut die Antwort aus Bericht und festen Texten).
    - Gelb (Umrisse, Kontrast): gespeichert nur mit ``confirm_warnings`` - sonst ``refused`` mit 409 und dem
      Prüfbericht, damit die Oberfläche nachfragen kann.
    - Beide Versionen entstehen zuerst als ``pending`` - unsichtbar für Bestellungen, Ansicht und „neueste Fassung“.
      Erst wenn beide liegen, gilt ``light_mode`` „file“ und beide werden zusammen freigeschaltet. Scheitert etwas,
      verschwinden die noch nicht freigeschalteten Versionen samt Dateien (und ein neu angelegtes Motiv), Einstellungen
      des Motivs gehen auf den vorigen Stand. Ist eine Datei schon die aktuelle ihrer Fassung, bleibt deren Version;
      sind es beide und gilt genau dieses Paar schon, 409 - sonst (etwa nach „Zurück auf automatisch“) gilt es wieder.
    - Je Motiv ein Upload zugleich (``MOTIF_BUSY``, 409), je Prozess eine Paar-Verarbeitung (``PAIR_BUSY``, 429).
    ``dark_file``/``light_file`` sind ``(bytes, dateiname, content_type)``."""
    reason = clean_reason(reason)
    key = shop_designs._design_key(design_key)
    async with _motif_lock(db, key):
        async with _pair_slot():
            return await _upload_pair_locked(
                db, design_key=key, dark_file=dark_file, light_file=light_file, actor_id=actor_id, reason=reason,
                title=title, placement=placement, garment_colors=garment_colors, auto_assign=auto_assign,
                confirm_warnings=confirm_warnings)


async def _upload_pair_locked(db, *, design_key: str, dark_file: tuple, light_file: tuple, actor_id: str, reason: str,
                              title: Any, placement: str | None, garment_colors: Any, auto_assign: bool,
                              confirm_warnings: bool) -> dict:
    key, profile, placement = await _pair_target(db, design_key, placement, title=title,
                                                 garment_colors=garment_colors, saving=True)
    spec, dark, light, swapped, uncertain = await _prepare_pair(db, placement, dark_file, light_file, auto_assign,
                                                                preview=False)
    settings = await load_settings(db)
    report = {**await asyncio.to_thread(pair_check, dark, light, settings), "swapped": swapped,
              "assign_uncertain": uncertain}
    report["summary"] = _summary(report)
    if report["level"] == "red":
        return {"refused": {"status": 400, "detail": report["summary"], "pair": report}}
    if report["level"] == "yellow" and not confirm_warnings:
        return {"refused": {"status": 409, "detail": "Bitte bestätigen: " + report["summary"], "pair": report}}

    created = []

    async def create() -> None:
        await shop_designs.create_profile(db, key, title=title, placement=placement, garment_colors=garment_colors,
                                          actor_id=actor_id, reason=reason)
        created.append(key)
        await _mark_pair_pending(db, key, None, created=True)

    inserted: list[dict] = []
    try:
        if profile:
            await _mark_pair_pending(db, key, profile, created=False)
        saved_dark, fit_dark = await shop_designs.save_version(
            db, key, image=dark["image"], spec=spec, placement=placement, source_format=dark["source_format"],
            variant="dark", origin="upload", actor_id=actor_id, reason=reason, svg_bytes=dark["svg_bytes"],
            extra=dark["extra"], before_insert=None if profile else create, reuse_same=True, pending=True)
        if not saved_dark.get("reused"):
            inserted.append(saved_dark)
        saved_light, fit_light = await shop_designs.save_version(
            db, key, image=light["image"], spec=spec, placement=placement, source_format=light["source_format"],
            variant="light", origin="upload", actor_id=actor_id, reason=reason, svg_bytes=light["svg_bytes"],
            extra={**light["extra"], "pair_of": saved_dark["version"]}, reuse_same=True, pending=True)
        if not saved_light.get("reused"):
            inserted.append(saved_light)
        pair = {"dark": saved_dark["version"], "light": saved_light["version"]}
        if not inserted:
            current = await shop_designs.get_profile(db, key) or {}
            stored = current.get("light_pair") or {}
            if current.get("light_mode") == "file" and {name: stored.get(name) for name in pair} == pair:
                raise ShopConflict(f"Beide Dateien sind schon die aktuellen Fassungen (v{pair['dark']} und "
                                   f"v{pair['light']}) - keine neuen Versionen nötig.")
        await set_light_mode(db, key, "file", actor_id=actor_id, reason=reason)
        await db.shop_design_profiles.update_one({"design_key": key},
                                                 {"$set": {"light_pair": {**pair, "at": now_utc().isoformat()}}})
        if inserted:  # beide zugleich freischalten
            await db.shop_designs.update_many({"id": {"$in": [row["id"] for row in inserted]}, "pending": True},
                                              {"$unset": {"pending": ""}})
        await db.shop_design_profiles.update_one({"design_key": key}, {"$unset": {"pair_pending": ""}})
    except BaseException:
        for row in inserted:
            await _remove_pending(db, row)
        if created:  # nur das Motiv, das dieser Aufruf angelegt hat
            await _remove_profile(db, key, placement)
        elif profile:
            await _restore_profile(db, key, profile)
        logger.warning("[shop-motifs] Paar für %s nicht gespeichert - nichts zurückgelassen", key)
        raise
    await record_admin_action(db, "shop.design.pair", actor_id=actor_id, target_id=key, reason=reason, data={
        "dark_version": pair["dark"], "light_version": pair["light"], "level": report["level"], "swapped": swapped,
        "confirmed_warnings": report["level"] == "yellow",
        "kept": [side for side, item in (("dark", saved_dark), ("light", saved_light)) if item.get("reused")],
        "checks": {item["key"]: item["level"] for item in report["checks"]}})
    warnings = _file_warnings(saved_dark, fit_dark, dark["source_format"])
    warnings += [f"{SIDE_LABELS['light']}: {text}"
                 for text in _file_warnings(saved_light, fit_light, light["source_format"])]
    warnings += [item["text"] for item in report["checks"] if item["level"] == "yellow"]
    return {"dark": saved_dark, "light": saved_light, "pair": _without_images(report), "warnings": warnings}


# ---------------------------------------------------------------- Paar veraltet? (#2084)

def pair_versions(rows: list[dict]) -> dict:
    """Die geltende Hauptdatei und die neueste eigene Datei für helle Shirts (``rows`` neueste zuerst)."""
    dark = next((row for row in rows if row.get("variant") != "light"), None)
    own = next((row for row in rows if row.get("variant") == "light" and row.get("origin") == "upload"), None)
    return {"dark": dark["version"] if dark else None, "light": own["version"] if own else None}


def pair_state(profile: dict | None, rows: list[dict]) -> dict:
    """Gehören Hauptdatei und eigene Datei für helle Shirts noch zusammen? ``light_pair`` am Motiv merkt sich das
    letzte zusammengehörige Paar. Wurde danach nur eine Fassung ersetzt, ist das Paar veraltet: ``stale`` mit beiden
    Versionen und ``outdated`` (die Fassung, die noch die alte ist)."""
    profile = profile or {}
    current = pair_versions(rows)
    out = {"stale": False, "dark_version": current["dark"], "light_version": current["light"], "outdated": None,
           "hint": None}
    pair = profile.get("light_pair") or {}
    if profile.get("light_mode") != "file" or not pair or None in current.values():
        return out
    if current["dark"] != pair.get("dark") and current["light"] == pair.get("light"):
        outdated = "light"
    elif current["light"] != pair.get("light") and current["dark"] == pair.get("dark"):
        outdated = "dark"
    else:
        return out
    replaced = "dark" if outdated == "light" else "light"
    return {**out, "stale": True, "outdated": outdated,
            "hint": (f"Die {SIDE_LABELS[replaced]} ist neu (Version {current[replaced]}), die andere Fassung ist noch "
                     f"Version {current[outdated]} – auch ersetzen?")}


async def _note_single_upload(db, key: str, variant: str, rows_before: list[dict]) -> None:
    """Nach einer einzelnen Datei: Paar merken bzw. offen lassen. Ist die andere Fassung seit dem letzten Paar
    unverändert, bleibt das Paar stehen - es gilt dann als veraltet. Wurde die andere schon vorher allein ersetzt,
    sind jetzt beide neu: das ist das neue Paar. Ein Motiv ohne gemerktes Paar (vor #2084 oder zwei Einzelschritte)
    bekommt eins, sobald beide Fassungen da sind."""
    profile = await shop_designs.get_profile(db, key) or {}
    if profile.get("light_mode") != "file":
        return
    before, after = pair_versions(rows_before), pair_versions(await _rows(db, key))
    if None in after.values():
        return
    stored = profile.get("light_pair") or {}
    if not stored:
        known = before if None not in before.values() else after
    else:
        other = "light" if variant == "dark" else "dark"
        known = after if stored.get(other) != after[other] else stored
    pair = {"dark": known["dark"], "light": known["light"]}
    if pair != {name: stored.get(name) for name in ("dark", "light")}:
        await db.shop_design_profiles.update_one({"design_key": key},
                                                 {"$set": {"light_pair": {**pair, "at": now_utc().isoformat()}}})


async def admin_view(db) -> dict:
    """Die Ansicht aus ``shop_designs.admin_view``, ergänzt um den Zustand für helle Shirts je Motiv (mit der Fassung,
    die gilt), den Paar-Zustand (``pair_stale`` mit beiden Versionen, #2084) und die Einstellungen."""
    view = await shop_designs.admin_view(db)
    settings = await load_settings(db)
    profiles = {profile["design_key"]: profile
                async for profile in db.shop_design_profiles.find({}, {"_id": 0, "design_key": 1, "light_mode": 1,
                                                                        "light_auto": 1, "light_pair": 1})}
    for design in view["designs"]:
        profile = profiles.get(design["design_key"])
        light = light_state(profile, design["versions"], settings)
        light["latest"] = next((item for item in design["versions"] if item["version"] == light["version"]), None)
        design["light"] = light
        pair = pair_state(profile, design["versions"])
        design["pair"] = pair
        design["pair_stale"] = pair["stale"]
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
    row = await db.shop_designs.find_one({"design_key": motif_key, "version": version, "pending": {"$ne": True}},
                                         {"_id": 0})
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
    exceptions = {key: legacy[key] for key in sorted(pending) if legacy.get(key)}
    return {
        "versions_without_variant": await db.shop_designs.count_documents({"variant": {"$exists": False}}),
        "motifs_without_mode": len(pending),
        "exceptions": exceptions,
        # Mehr Ausnahmen, als der Admin je Motiv speichern kann: die Migration übernimmt trotzdem alle (sie kappt nie),
        # aber der Bericht nennt das Motiv - dort zuerst aufräumen, bevor jemand die Ausnahmen ändert.
        "over_limit": {key: len(colors) for key, colors in exceptions.items() if len(colors) > MAX_EXCEPTIONS},
        "light_versions": await db.shop_designs.count_documents({"variant": "light"}),
        "svg_versions": await db.shop_designs.count_documents({"source_format": "SVG"}),
    }


async def apply(db) -> str:
    """Bestehende Designs bekommen „Hell-Variante automatisch“ und ihre festen Farben als Ausnahme „dunkel“ - so
    druckt jede bisher zugeordnete Farbe weiter die Datei, die sie bisher hatte. **Erst danach** werden bestehende
    Fassungen als Hauptdateien („für dunkle Shirts“) markiert. Dazwischen und davor druckt ein Motiv ohne erzeugte
    Hell-Fassung ohnehin die Hauptdatei (``file_for_garment``). Übernommen wird jede Zuordnung, nie gekappt.
    Mehrfach aufrufbar; nur, was noch fehlt."""
    legacy = await _legacy_exceptions(db)
    motifs = exceptions = 0
    over: list[str] = []
    async for profile in db.shop_design_profiles.find({"light_mode": {"$exists": False}}, {"_id": 0}):
        taken = list(profile.get("color_variants") or [])
        names = {_color_key(item.get("color")) for item in taken}
        for color in legacy.get(profile["design_key"], []):
            if _color_key(color) not in names:
                names.add(_color_key(color))
                taken.append({"color": color, "variant": "dark"})
                exceptions += 1
        if len(taken) > MAX_EXCEPTIONS:
            over.append(profile["design_key"])
            logger.warning("[shop-motifs] Migration 14: %s hat %s Ausnahmen (Grenze im Admin %s) - alle übernommen",
                           profile["design_key"], len(taken), MAX_EXCEPTIONS)
        await db.shop_design_profiles.update_one({"design_key": profile["design_key"]},
                                                 {"$set": {"light_mode": "auto", "color_variants": taken}})
        motifs += 1
    marked = await db.shop_designs.update_many({"variant": {"$exists": False}}, {"$set": {"variant": "dark"}})
    result = (f"{getattr(marked, 'modified_count', 0)} versions marked dark, {motifs} motifs prepared, "
              f"{exceptions} colour exceptions kept")
    return result + (f", over the admin limit: {', '.join(over)}" if over else "")


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
    for key, count in report.get("over_limit", {}).items():
        lines.append(f"  ACHTUNG {key}: {count} Ausnahmen, im Admin sind höchstens {MAX_EXCEPTIONS} speicherbar - "
                     "die Migration übernimmt alle; vor dem nächsten Ändern dort aufräumen")
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
