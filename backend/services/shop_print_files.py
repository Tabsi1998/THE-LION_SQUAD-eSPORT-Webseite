"""Druckdateien aus Vorlage, Motiv und Position (#2069) - die Website erzeugt sie selbst, exakt passend zu Printful.

Der Obmann wählt je Platzierung Motiv, Vorgabe-Position und Größe in cm; dieses Modul baut daraus genau ein
transparentes PNG in der Pixelgröße der Printful-Vorlage (``shop_print_templates``). Ohne eigenes Grafikprogramm.

- **Aufbau je Produkt** (``product.placements``, neu seit #2069): je Printful-Platzierung eine Zeile mit Ebenen
  (``layers``): Motive (``kind = "motif"``: Vorgabe, Breite in cm, Feinjustierung) und Platzhalter für den Gamertag
  bzw. die Vereinsnummer (``gamertag``, ``member_number``), deren Datei erst je Bestellung entsteht. ``mode = "upload"``
  heißt: je Farbe eine fertige Datei der ganzen Fläche (``upload``), exakt gegen die Vorlage geprüft - seit #2141 als
  Hintergrund, auf den die Motive kommen (Allover); ohne Motive ist sie selbst die Grunddatei. Hell oder dunkel je
  Ebene entscheidet der Abschnitt „Untergrund“.
  Ältere Produkte mit festen Zoll-Positionen (#1707) rechnet ``layout_rows`` beim Lesen um; ``scripts/shop_print_layout.py``
  speichert das mit Trockenlauf und Rückweg (``migrate``/``rollback_migration``).
- **Plan** (``plan_placement``): Vorgabe auf die Fläche umgerechnet, Rahmen in Pixeln, geprüft (ganz in der Fläche bzw.
  im Sicherheitsrand). ``layout_hash`` hält fest, was die Pixel bestimmt (Maße der Vorlage, Rahmen, Motiv-Fassung) - eine
  erzeugte Datei gilt nur, solange er passt.
- **Generator** (``compose_print_file``): rein, ohne Datenbank. Exakte Pixelgröße, transparent, sRGB, im PNG nur die
  DPI, deterministisch (gleiche Eingaben = gleiche Prüfsumme). Ein Rastermotiv mit zu wenig DPI bei der gewählten Größe
  wird abgelehnt bzw. gewarnt - mit Zahlen in px, cm und Zoll.
- **Ablage** (``shop_print_files``): wie die Designs (#1708) - eigene Datei, SHA-256, Zufallsschlüssel (256 Bit) für die
  öffentliche Adresse ``/api/shop/print-files/<schlüssel>/<name>.png``. Grunddateien (``purpose = "base"``) je Produkt,
  Fläche, Farbe (und Varianten-Gruppe) mit Versionen; Bestelldateien (``order``) je Bestellposition mit Gamertag bzw.
  Vereinsnummer (#2150) - personenbezogen wie in ``shop_gamertag`` (das PNG zeigt Name bzw. Nummer).
- **Motive**: der Zugriff steht an genau einer Stelle (``_motif_source``/``_motif_png``, Abschnitt „Motive“). Bis die
  Motiv-Bibliothek aus #2069 Teil A da ist, rastert sie die Design-Fassungen aus ``shop_designs``.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import struct
from dataclasses import dataclass, field, replace
from io import BytesIO
from typing import Any, Sequence

from PIL import Image
from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import shop_catalog, shop_colors, shop_designs, shop_gamertag, shop_motifs
from services import shop_print_templates as templates
from services.log_safe import log_safe, mask_addresses
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.shop_common import ShopConflict, ShopError, clean_reason, record_admin_action

logger = logging.getLogger("tls-arena.shop-print-files")

RENDERER_VERSION = 1  # ändert sich, wenn der Generator andere Pixel liefert - dann gelten erzeugte Dateien nicht mehr
NOT_ORDERABLE = "Dieses Produkt ist gerade nicht bestellbar."
LAYER_KINDS = {"motif": "Motiv", "gamertag": "Gamertag (Datei je Bestellung)",
               "member_number": "Vereinsnummer (Datei je Bestellung, #1727)",
               "text": "Fester Text (in der Grunddatei, etwa der Vereinsname)"}
# Was in die Grunddatei kommt (gleich für alle Bestellungen) und was erst je Bestellung (#2141). Der feste Text (#2142)
# ist für alle Bestellungen gleich - er gehört in die Grunddatei.
BASE_KINDS = ("motif", "text")
TEXT_KINDS = ("gamertag", "member_number")
# Wie ``shop_gamertag.render`` eine Textebene rendert (#2142): Name, Nummer (nur Ziffern) oder fester Text.
RENDER_KINDS = {"gamertag": "gamertag", "member_number": "number", "text": "text"}
SHORT_LABELS = {"gamertag": "Gamertag", "member_number": "Vereinsnummer", "text": "Fester Text"}
MODES = {"layout": "Motiv und Position", "upload": "Fertige Druckdatei als Hintergrund"}
MODE_HINTS = {
    "layout": "Die Website erzeugt die Druckdatei: Motive an ihrer Stelle, der Rest durchsichtig.",
    "upload": "Für Allover (etwa ein Trikot): je Farbe eine fertige Datei der ganzen Fläche als Hintergrund. Motive, "
              "Gamertag und Vereinsnummer liegen als Ebenen darüber - mit Position, Größe und Vorschau.",
}
MAX_LAYERS = 6
MAX_OFFSET_CM = 300.0
# 80 Millionen Pixel: das größte Badetuch (11100 × 5700) passt, RGBA braucht dann gut 250 MB.
MAX_COMPOSE_PIXELS = templates.MAX_FILE_PIXELS
PUBLIC_ID = re.compile(r"^[A-Za-z0-9_-]{43}$")


# ================================================================ Motive (die eine Stelle, verdrahtet mit #2069 Teil A)
#
# Ein Motiv ist ein Design der Motiv-Bibliothek (``services/shop_motifs.py``) mit zwei Fassungen: die Hauptdatei für
# dunkle Shirts und die Fassung für helle Shirts (eigene Datei oder automatisch umgefärbt). Welche Fassung zu einer
# Shirtfarbe gehört, entscheidet ``shop_motifs.file_for_garment`` (Helligkeit des Printful-Farbwerts, Ausnahme je Farbe
# am Motiv); ``motif.by_color`` am Produkt kann für eine Farbe ein ganz anderes Motiv nehmen. Gerastert wird mit
# ``shop_motifs.render_motif_png`` in genau der Breite des Rahmens - aus dem SVG scharf, ein altes PNG wie bisher
# skaliert. Die Fassung samt Version steht in ``MotifSource.ref``: sie geht in den ``layout_hash`` ein (neue Version =
# neue Druckdatei) und wird mit der Bestellung eingefroren. Tests ersetzen ``_motif_source``/``_motif_png`` durch
# einen Fake (``monkeypatch``).

@dataclass(frozen=True)
class MotifSource:
    """Was ein Motiv für eine Shirtfarbe ist: Fassung (``ref`` - friert die Bestellung ein), Pixel der Quelle für das
    Seitenverhältnis und die DPI-Prüfung (``vector``: keine DPI-Grenze) und ein Titel für Meldungen."""
    ref: dict
    width_px: int
    height_px: int
    title: str
    vector: bool = False
    file_ref: str | None = None
    image_path: str | None = None

    @property
    def aspect(self) -> float:
        return self.height_px / self.width_px


def _design_key_for(motif: dict, color: str) -> str | None:
    return (motif.get("by_color") or {}).get(color) or motif.get("key") or None


async def _motif_source(db, motif: dict, color: str, color_hex: str | None,
                        variant: str | None = None) -> MotifSource | None:
    """Das Motiv einer Ebene für eine Shirtfarbe (Fassung hell oder dunkel samt Version) - oder ``None``, wenn es
    dafür keine Fassung gibt (etwa ein PNG, das sich nicht für helle Shirts umfärben ließ). Mit ``variant`` ist der
    Untergrund schon entschieden (Hintergrund, Vorgabe des Produkts oder von Hand, #2141)."""
    key = _design_key_for(motif or {}, color)
    if not key:
        row = None
    elif variant:
        row = await shop_motifs.file_for_surface(db, key, variant)
    else:
        row = await shop_motifs.file_for_garment(db, key, color=color, color_hex=color_hex)
    if not row:
        return None
    view_box = row.get("view_box")
    if view_box and len(view_box) == 4 and view_box[2] and view_box[3]:
        width, height = float(view_box[2]), float(view_box[3])
    else:
        width, height = float(row.get("width_px") or 0), float(row.get("height_px") or 0)
    if not width or not height:
        return None
    vector = bool(row.get("svg_ref"))
    # Seitenverhältnis aus der viewBox (SVG) bzw. den Pixeln; die DPI-Prüfung braucht die echten Pixel eines Rasters.
    scale = 1000.0 / width if vector else 1.0
    variant = row.get("variant") or "dark"
    profile = await shop_designs.get_profile(db, key) or {}
    public = bool(row.get("public_id")) and not row.get("public_disabled_at")
    title = (profile.get("title") or key) + (" (für helle Shirts)" if variant == "light" else "")
    return MotifSource(ref={"source": "motif", "design_key": key, "variant": variant, "version": row["version"],
                            "sha256": row["sha256"]},
                       width_px=max(1, int(round(width * scale))), height_px=max(1, int(round(height * scale))),
                       title=title, vector=vector, file_ref=row.get("file_ref"),
                       image_path=shop_designs.public_path(row) if public else None)


async def _motif_png(db, source: MotifSource, *, width_px: int, dpi: int) -> bytes:
    """Das Motiv als PNG in genau ``width_px`` Breite (transparent) - die eingefrorene Fassung samt Version."""
    ref = source.ref
    try:
        return await shop_motifs.render_motif_png(db, ref["design_key"], ref.get("variant") or "dark",
                                                  width_px=width_px, dpi=dpi, version=ref.get("version"))
    except LookupError as exc:
        raise ShopError(f"Die Datei des Motivs „{source.title}“ fehlt auf dem Server - bitte neu hochladen.") from exc


async def motif_options(db) -> list[dict]:
    """Die Motive zur Auswahl im Admin: die Motiv-Bibliothek mit Hauptdatei (Vorschaubild, Seitenverhältnis)."""
    out = []
    async for profile in db.shop_design_profiles.find({}, {"_id": 0}).sort("design_key", 1):
        latest = await shop_catalog.latest_design(db, profile["design_key"])
        if not latest:
            continue
        public = bool(latest.get("public_id")) and not latest.get("public_disabled_at")
        view_box = latest.get("view_box")
        width, height = latest.get("width_px"), latest.get("height_px")
        if view_box and len(view_box) == 4 and view_box[2] and view_box[3]:
            width, height = int(round(1000)), int(round(1000 * float(view_box[3]) / float(view_box[2])))
        out.append({"key": profile["design_key"], "title": profile.get("title") or profile["design_key"],
                    "version": latest["version"], "width_px": width, "height_px": height,
                    "has_alpha": latest.get("has_alpha"), "is_vector": bool(latest.get("svg_ref")),
                    "light_mode": profile.get("light_mode"),
                    "image_path": shop_designs.public_path(latest) if public else None})
    return out


async def motif_exists(db, key: Any) -> bool:
    return isinstance(key, str) and bool(await shop_catalog.latest_design(db, key))


# ================================================================ Generator (rein, ohne Datenbank)

@dataclass(frozen=True)
class Layer:
    """Eine Ebene der Druckdatei: PNG und Rahmen in ganzen Pixeln. ``native_width_px`` sind die Pixel der Quelle eines
    Rastermotivs (für die DPI-Prüfung) - ``None`` bei Vektoren und Namen."""
    png: bytes
    left: int
    top: int
    width: int
    height: int
    label: str
    native_width_px: int | None = None


@dataclass(frozen=True)
class Composed:
    payload: bytes
    sha256: str
    width_px: int
    height_px: int
    dpi: int
    warnings: tuple[str, ...] = field(default_factory=tuple)


def _dpi_text(layer: Layer, dpi: int, effective: float, needed: float) -> str:
    width_cm = templates.px_to_cm(layer.width, dpi)
    return (f"„{layer.label}“ hat {layer.native_width_px} px Breite und wird {templates.cm(width_cm)} breit gedruckt - "
            f"das sind {int(effective)} DPI, nötig sind {int(round(needed))} DPI (dafür "
            f"{int(-(-layer.width * needed // dpi))} px Breite).")


def compose_print_file(width_px: int, height_px: int, dpi: int, layers: Sequence[Layer], *,
                       min_dpi_ratio: float = 0.66, warn_dpi_ratio: float = 1.0, safe_margin_px: float = 0.0,
                       base: bytes | None = None) -> Composed:
    """Genau eine Druckdatei: ``width_px`` × ``height_px`` transparent, die Ebenen an ihrem Rahmen, im PNG nur die DPI.

    Lehnt ab (``ShopError``, Text mit px, cm und Zoll): Rahmen nicht ganz in der Fläche bzw. im Sicherheitsrand, ein
    Rastermotiv unter ``min_dpi_ratio`` × DPI, zu viele Pixel, eine Grunddatei (``base``) in anderer Größe. Warnt
    (``warnings``) unter ``warn_dpi_ratio`` × DPI. Gleiche Eingaben ergeben Byte für Byte dieselbe Datei."""
    if type(width_px) is not int or type(height_px) is not int or width_px < 1 or height_px < 1:
        raise ShopError("Druckdatei: Breite und Höhe in ganzen Pixeln.")
    if width_px * height_px > MAX_COMPOSE_PIXELS:
        raise ShopError(f"Die Druckdatei hätte {width_px} × {height_px} px - mehr als "
                        f"{MAX_COMPOSE_PIXELS // 1_000_000} Millionen Pixel.")
    warnings: list[str] = []
    refused: list[str] = []
    area = {"family": "other", "dpi": dpi, "width_px": width_px, "height_px": height_px, "label": "Druckfläche"}
    for layer in layers:
        box = templates.Box(layer.left, layer.top, layer.width, layer.height)
        margin_rules = {"safe_margin_cm": {"other": templates.px_to_cm(safe_margin_px, dpi)}}
        refused += templates.problems(area, box, f"„{layer.label}“", margin_rules)
        if layer.native_width_px:
            effective = layer.native_width_px / (layer.width / dpi)
            if effective + 1e-6 < dpi * min_dpi_ratio:
                refused.append("Zu wenig Auflösung: " + _dpi_text(layer, dpi, effective, dpi * min_dpi_ratio))
            elif effective + 1e-6 < dpi * warn_dpi_ratio:
                warnings.append("Knapp: " + _dpi_text(layer, dpi, effective, dpi * warn_dpi_ratio))
    if refused:
        raise ShopError(" ".join(refused))
    if base is not None:
        with Image.open(BytesIO(base)) as img:
            img.load()
            canvas = img.convert("RGBA")
        if canvas.size != (width_px, height_px):
            raise ShopError(f"Die Grunddatei hat {canvas.width} × {canvas.height} px, die Vorlage verlangt "
                            f"{width_px} × {height_px} px.")
    else:
        canvas = Image.new("RGBA", (width_px, height_px), (0, 0, 0, 0))
    for layer in layers:
        with Image.open(BytesIO(layer.png)) as img:
            img.load()
            part = img.convert("RGBA")
        if part.size != (layer.width, layer.height):
            part = part.resize((layer.width, layer.height), Image.Resampling.LANCZOS)
        canvas.alpha_composite(part, dest=(layer.left, layer.top))
    out = BytesIO()
    canvas.save(out, format="PNG", dpi=(dpi, dpi), compress_level=6)
    payload = out.getvalue()
    return Composed(payload=payload, sha256=hashlib.sha256(payload).hexdigest(), width_px=width_px,
                    height_px=height_px, dpi=dpi, warnings=tuple(warnings))


# ================================================================ Aufbau je Produkt (Ebenen) und Umrechnung alter Positionen

def is_layout(row: dict) -> bool:
    return isinstance(row, dict) and isinstance(row.get("layers"), list)


def _color_key(color: str) -> str:
    return " ".join(str(color or "").split()).casefold()


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _color_key(text).replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
                  .replace("ß", "ss")).strip("-")[:40] or "x"


def convert_legacy(product: dict, template: dict | None, presets_doc: dict,
                   aspects: dict[str, float] | None = None,
                   gamertag_rules: dict | None = None, colors: Sequence[str] = (),
                   sources: dict | None = None) -> tuple[list[dict], list[str], list[str]]:
    """Alte Platzierungen (#1707: Schlüssel wie ``front_right``, Position in Zoll, Design je Farbe) als Ebenen je
    Printful-Fläche. Die Position bleibt erhalten: die nächste Vorgabe nach der waagrechten Mitte, die Breite in cm, der
    Rest als Feinjustierung. Gamertag und Vereinsnummer bekommen eine Vorgabe (``text_opposite`` vorne, sonst die erste
    passende) - die Hinweise sagen, was zu prüfen ist.

    Hat die Fläche nur Gruppen je Größe (Tasse 11/15 oz, Badetuch), wird an der kleinsten Fläche umgerechnet; danach wird
    **jede** Gruppe einzeln geprüft: jedes Motiv muss dort genau an seiner alten Stelle liegen (höchstens ein Pixel
    Abweichung) und mit dem Namen (``gamertag_rules``) ganz in der Fläche bleiben. Weicht eine Gruppe ab - etwa weil sie
    schmaler ist und die Vorgabe relativ zur Breite rechnet -, steht das in der dritten Liste (``blocked``). Ebenso eine
    alte Platzierung ohne Fläche. Nie ein stiller Teil-Erfolg: die Umstellung des Produkts hält dann an und die alten
    Platzierungen bleiben.

    Mit ``colors`` und ``sources`` (je Fläche, Ebene und Farbe das Motiv, das wirklich gedruckt wird: Seitenverhältnis
    und Titel - ``conversion`` ermittelt sie über ``_motif_source``) wird jede Farbe mit ihrem eigenen Motiv geprüft,
    der Name an dessen echtem Rahmen."""
    aspects = aspects or {}
    presets = presets_doc["presets"]
    rules = presets_doc["rules"]
    technique = product.get("technique") or (product.get("printful") or {}).get("default_technique")
    rows: dict[str, dict] = {}
    notes: list[str] = []
    blocked: list[str] = []
    targets: dict[str, list[tuple[dict, float, float, float, str]]] = {}
    areas: dict[str, list[dict]] = {}
    for old in product.get("placements") or []:
        if is_layout(old):
            rows[old["key"]] = old
            continue
        printful_placement = old.get("printful_placement") or old.get("key")
        same = [row for row in templates.entries_for(template, technique) if row["placement"] == printful_placement]
        entry = next((row for row in same if not row["variant_ids"]), None)
        label = shop_designs.PLACEMENT_LABELS.get(old.get("key"), old.get("key"))
        if entry is None and same:
            # Nach der Geometrie: die kleinste Fläche - die anderen Gruppen prüft der Schluss einzeln.
            entry = min(same, key=lambda row: (row["width_in"] * row["height_in"], row["width_in"], row["group"]))
            notes.append(f"„{label}“: {entry['label']} hat je Größe eine eigene Fläche - umgerechnet an der kleinsten "
                         f"({entry['width_px']} × {entry['height_px']} px), jede Größe einzeln geprüft.")
        areas[printful_placement] = same
        if entry is None:
            blocked.append(f"„{label}“ bleibt unverändert: die Fläche {printful_placement} hat keine Druckvorgabe bei "
                           "Printful.")
            continue
        row = rows.setdefault(printful_placement, {"key": printful_placement, "printful_placement": printful_placement,
                                                   "technique": entry["technique"], "mode": "layout", "layers": []})
        position = old.get("position") or {}
        width_cm = round(float(position.get("width_in") or 3.5) * templates.CM_PER_INCH, 2)
        if old.get("kind", "design") == "design":
            cells = [cell for cell in old.get("designs") or [] if cell.get("design_key")]
            key = cells[0]["design_key"] if cells else None
            aspect = aspects.get(key) or (float(position.get("height_in") or 1) / float(position.get("width_in") or 1))
            center = ((float(position.get("left_in") or 0) + float(position.get("width_in") or 0) / 2)
                      / entry["width_in"])
            choices = templates.presets_for(presets, entry["family"], "motif") or [
                item for item in presets if item["kind"] == "motif"]
            # Alte Positionen zählen von oben: bei gleicher Nähe gewinnt eine oben verankerte Vorgabe - dann liegt ein Motiv
            # mit anderem Seitenverhältnis (andere Farbe) nicht senkrecht verschoben.
            preset = min(choices, key=lambda item: (abs(item["center_x"] - center), item["anchor"] != "top", item["key"]))
            planned = templates.place_motif(entry, preset, width_cm=width_cm, aspect=aspect, rules=rules)
            wanted_left = templates.cm_to_px(float(position.get("left_in") or 0) * templates.CM_PER_INCH, entry["dpi"])
            wanted_top = templates.cm_to_px(float(position.get("top_in") or 0) * templates.CM_PER_INCH, entry["dpi"])
            targets.setdefault(printful_placement, []).append(
                (None, float(position.get("left_in") or 0), float(position.get("top_in") or 0), aspect, label))
            row["layers"].append({
                "kind": "motif", "preset": preset["key"], "width_cm": width_cm,
                "offset_x_cm": round(templates.px_to_cm(wanted_left - planned.left, entry["dpi"]), 2),
                "offset_y_cm": round(templates.px_to_cm(wanted_top - planned.top, entry["dpi"]), 2),
                "motif": {"key": key, "by_color": {cell["color"]: cell["design_key"] for cell in cells
                                                   if cell["design_key"] != key}}})
            targets[printful_placement][-1] = (row["layers"][-1], *targets[printful_placement][-1][1:])
            notes.append(f"„{label}“ → {entry['label']}, Vorgabe „{preset['label']}“, {templates.cm(width_cm)} breit"
                         + ("" if key else " - noch ohne Motiv") + ".")
        else:
            kind = old["kind"]
            texts = templates.presets_for(presets, entry["family"], "text")
            has_motif = any(layer["kind"] == "motif" for layer in row["layers"]) or any(
                (item.get("printful_placement") == printful_placement and item.get("kind", "design") == "design")
                for item in product.get("placements") or [] if not is_layout(item))
            preset = next((item for item in texts if item.get("follow") == "opposite" and has_motif), None) or next(
                (item for item in texts if not item.get("follow")), None) or (texts[0] if texts else None)
            if preset is None:
                blocked.append(f"„{label}“ bleibt unverändert: keine Vorgabe für einen Namen auf {entry['label']}.")
                continue
            row["layers"].append({"kind": kind, "preset": preset["key"], "offset_x_cm": 0.0, "offset_y_cm": 0.0})
            notes.append(f"„{label}“ ({LAYER_KINDS[kind]}) → Vorgabe „{preset['label']}“ - bitte in der Vorschau prüfen.")
    for row in rows.values():  # Motive zuerst: ein Name folgt dem ersten Motiv
        row["layers"].sort(key=lambda layer: layer["kind"] != "motif")
    by_key = {item["key"]: item for item in presets}
    for key, row in rows.items():
        for entry in areas.get(key) or []:
            found = _check_group(entry, row, targets.get(key) or [], by_key, rules, gamertag_rules,
                                 colors=colors, sources=sources or {})
            if found:
                size = f"{templates.cm(entry['width_cm'])} × {templates.cm(entry['height_cm'])}"
                group = (f", Varianten {', '.join(map(str, entry['variant_ids']))}" if entry["variant_ids"] else "")
                blocked.append(f"{entry['label']} ({size}{group}) bleibt unverändert: {' '.join(found)}")
    return list(rows.values()), notes, blocked


def _check_group(entry: dict, row: dict, targets: list, by_key: dict, rules: dict, gamertag_rules: dict | None, *,
                 colors: Sequence[str] = (), sources: dict | None = None) -> list[str]:
    """Eine Gruppe einer umgerechneten Fläche: liegt jedes Motiv genau an seiner alten Stelle und alles in der Fläche -
    für jede Farbe mit dem Motiv, das dort gedruckt wird, und der Name an dessen Rahmen?"""
    dpi = entry["dpi"]
    sources = sources or {}
    found: list[str] = []
    for color in list(colors) or [None]:
        boxes = []
        for layer, left_in, top_in, aspect, label in targets:
            index = next(at for at, item in enumerate(row["layers"]) if item is layer)
            own = sources.get((row["key"], index, color))
            if own is not None:
                aspect = own[0]
                label = f"{label}, {color}: Motiv „{own[1]}“"
            elif color is not None:
                label = f"{label}, {color}"
            preset = by_key.get(layer["preset"])
            box = templates.place_motif(entry, preset, width_cm=layer["width_cm"], aspect=aspect, rules=rules,
                                        offset_x_cm=layer["offset_x_cm"], offset_y_cm=layer["offset_y_cm"])
            boxes.append(box)
            shift_x, shift_y = box.left - left_in * dpi, box.top - top_in * dpi
            if abs(shift_x) > 1 or abs(shift_y) > 1:
                found.append(f"„{label}“ läge um {templates.measure(abs(shift_x), dpi)} waagrecht bzw. "
                             f"{templates.measure(abs(shift_y), dpi)} senkrecht anders.")
            found += templates.problems(entry, box, f"„{label}“", rules)
        if gamertag_rules is not None:
            for layer in row["layers"]:
                if layer["kind"] not in TEXT_KINDS:
                    continue
                name = LAYER_KINDS[layer["kind"]] + (f" ({color})" if color else "")
                width, height = text_canvas_px(entry, gamertag_rules, None, layer["kind"])
                try:
                    box = templates.place_text(entry, by_key[layer["preset"]], width_px=width, height_px=height,
                                               follow=boxes[0] if boxes else None, rules=rules)
                except (KeyError, ShopError):
                    found.append(f"{name}: keine passende Vorgabe.")
                    continue
                found += templates.problems(entry, box, name, rules)
    return list(dict.fromkeys(found))


async def _aspects(db, product: dict) -> dict[str, float]:
    out = {}
    for old in product.get("placements") or []:
        for cell in old.get("designs") or []:
            key = cell.get("design_key")
            if key and key not in out:
                latest = await shop_catalog.latest_design(db, key)
                if latest and latest.get("width_px") and latest.get("height_px"):
                    out[key] = int(latest["height_px"]) / int(latest["width_px"])
    return out


async def layout_rows(db, product: dict, *, template: dict | None = None,
                      presets_doc: dict | None = None) -> list[dict]:
    """Die Platzierungen eines Produkts als Ebenen - ältere Produkte (#1707) werden beim Lesen umgerechnet."""
    rows = product.get("placements") or []
    if all(is_layout(row) for row in rows):
        return [dict(row) for row in rows]
    if template is None:
        template = await templates.get(db, (product.get("printful") or {}).get("product_id"))
    presets_doc = presets_doc or await templates.load_presets(db)
    converted, _notes, _blocked = convert_legacy(product, template, presets_doc, await _aspects(db, product))
    return converted


async def conversion(db, product: dict, template: dict | None, presets_doc: dict,
                     gamertag_rules: dict) -> tuple[list[dict], list[str], list[str]]:
    """Umrechnung mit voller Prüfung: erst umrechnen, dann je Fläche, Ebene und angebotener Farbe das Motiv ermitteln,
    das wirklich gedruckt wird (``_motif_source`` - auch Ausnahmen je Farbe und die automatische Fassung), und mit
    diesen Motiven jede Gruppe prüfen."""
    aspects = await _aspects(db, product)
    rows, notes, blocked = convert_legacy(product, template, presets_doc, aspects, gamertag_rules=gamertag_rules)
    printful = product.get("printful") or {}
    colors = list((product.get("offer") or {}).get("colors") or [])
    if not colors:
        return rows, notes, blocked
    codes = {item["name"]: item.get("code") for item in printful.get("colors") or []}
    sources, missing = {}, []
    for row in rows:
        for index, layer in enumerate(row.get("layers") or []):
            if layer.get("kind") != "motif" or not (layer.get("motif") or {}).get("key"):
                continue
            for color in colors:
                source = await _motif_source(db, layer["motif"], color, codes.get(color))
                if source is None:
                    missing.append(f"{row['key']}, {color}: für diese Farbe gibt es kein Motiv - die Prüfung in Schritt 5 "
                                 "meldet das.")
                    continue
                sources[(row["key"], index, color)] = (source.aspect, source.title)
    rows, notes, blocked = convert_legacy(product, template, presets_doc, aspects, gamertag_rules=gamertag_rules,
                                          colors=colors, sources=sources)
    return rows, notes + missing, blocked


async def layout_conversion(db, product: dict) -> dict:
    """Für den Admin: was die Umrechnung alter Platzierungen sagt - Hinweise und was sich nicht abbilden lässt."""
    rows = product.get("placements") or []
    if all(is_layout(row) for row in rows):
        return {"converted": False, "notes": [], "blocked": []}
    template = await templates.get(db, (product.get("printful") or {}).get("product_id"))
    _rows, notes, blocked = await conversion(db, product, template, await templates.load_presets(db),
                                             await shop_gamertag.load_rules(db))
    return {"converted": True, "notes": notes, "blocked": blocked}


# ================================================================ Untergrund: hell oder dunkel (#2141)
#
# Welche Fassung ein Motiv bekommt (für dunkle oder helle Untergründe) und welche Farbe Gamertag und Vereinsnummer: bis
# #2141 allein nach der Shirtfarbe von Printful. Ein Allover-Trikot hat aber die Grundfarbe „weiß“ und wird oft ganz
# dunkel bedruckt. Darum gilt je Ebene, in dieser Reihenfolge:
#
# 1. die Ebene selbst („Fassung: hell/dunkel“, ``layer.variant``) - etwa bei gemischtem Hintergrund;
# 2. der Hintergrund unter der Ebene: die mittlere relative Luminanz (WCAG) im Rahmen der Ebene gegen die Schwelle der
#    Motive (``shop_motifs`` ``threshold``, Vorgabe 0,18 - dieselbe wie für Shirtfarben); durchsichtige Stellen zählen
#    als Untergrund nach 3. bzw. 4.;
# 3. die Vorgabe des Produkts („Untergrund gilt als hell/dunkel“, ``product.print_surface``);
# 4. die Shirtfarbe wie bisher (``variant = None``: ``file_for_garment`` mit Ausnahmen, ``inks_for_garment``).
#
# Die Entscheidung steht im Plan (``Planned.surface``, ``Planned.ink``) - Vorschau, Planung, Grunddatei und Bestelldatei
# lesen sie dort und nirgends sonst.

SURFACES = {"garment": "wie Printful-Farbe", "light": "hell", "dark": "dunkel"}
LAYER_VARIANTS = {"auto": "automatisch", "light": "hell", "dark": "dunkel"}
SURFACE_SOURCES = {"layer": "von Hand", "background": "aus Hintergrund", "product": "Vorgabe des Produkts",
                   "garment": "aus Shirtfarbe"}
LUMA_GRID_CELLS = 96  # so viele Zellen an der längeren Seite - bei 4950 × 6750 px je Zelle gut 1,2 cm
LUMA_VERSION = 1      # ändert sich, wenn das gespeicherte Raster anders gerechnet wird - dann wird es neu gerechnet


@dataclass(frozen=True)
class LumaGrid:
    """Helligkeit einer Hintergrund-Datei in Zellen: je Zelle die Summe aus Luminanz × Deckkraft, die Summe der
    Deckkraft und die Zahl der Pixel. Der Mittelwert in einem Rahmen gewichtet angeschnittene Zellen nach Fläche."""
    width_px: int
    height_px: int
    cell: int
    lit: tuple[tuple[float, ...], ...]
    cover: tuple[tuple[float, ...], ...]
    count: tuple[tuple[float, ...], ...]

    def mean(self, box: templates.Box, under: float | None) -> float | None:
        """Mittlere Luminanz im Rahmen; durchsichtige Stellen zählen mit ``under`` (ohne: nur die deckenden)."""
        left, top = max(0.0, box.left), max(0.0, box.top)
        right, bottom = min(float(self.width_px), box.right), min(float(self.height_px), box.bottom)
        if right <= left or bottom <= top:
            return None
        lit = cover = pixels = 0.0
        for row in range(int(top // self.cell), min(len(self.lit), int(-(-bottom // self.cell)))):
            y0, y1 = row * self.cell, min(self.height_px, (row + 1) * self.cell)
            share_y = (min(bottom, y1) - max(top, y0)) / (y1 - y0)
            if share_y <= 0:
                continue
            for col in range(int(left // self.cell), min(len(self.lit[row]), int(-(-right // self.cell)))):
                x0, x1 = col * self.cell, min(self.width_px, (col + 1) * self.cell)
                share = share_y * (min(right, x1) - max(left, x0)) / (x1 - x0)
                if share <= 0:
                    continue
                lit += self.lit[row][col] * share
                cover += self.cover[row][col] * share
                pixels += self.count[row][col] * share
        if pixels <= 0:
            return None
        if under is None:
            return lit / cover if cover > 1e-9 else None
        return (lit + under * (pixels - cover)) / pixels


def luma_grid(image: Image.Image) -> LumaGrid:
    """Die Helligkeits-Zellen eines Bilds - streifenweise, damit eine Allover-Datei nicht dreifach im Speicher liegt.
    Rein und deterministisch."""
    import numpy as np

    channel = np.arange(256, dtype=np.float64) / 255.0
    linear = np.where(channel <= 0.04045, channel / 12.92, ((channel + 0.055) / 1.055) ** 2.4)
    rgba = image.convert("RGBA")
    width, height = rgba.size
    cell = max(1, -(-max(width, height) // LUMA_GRID_CELLS))
    starts = np.arange(0, width, cell)
    widths = np.diff(np.append(starts, width))
    lit, cover, count = [], [], []
    for y0 in range(0, height, cell):
        y1 = min(height, y0 + cell)
        strip = np.asarray(rgba.crop((0, y0, width, y1)))
        alpha = strip[..., 3].astype(np.float64) / 255.0
        luminance = (0.2126 * linear[strip[..., 0]] + 0.7152 * linear[strip[..., 1]]
                     + 0.0722 * linear[strip[..., 2]])
        lit.append(tuple(float(value) for value in np.add.reduceat((luminance * alpha).sum(axis=0), starts)))
        cover.append(tuple(float(value) for value in np.add.reduceat(alpha.sum(axis=0), starts)))
        count.append(tuple(float(value * (y1 - y0)) for value in widths))
    return LumaGrid(width, height, cell, tuple(lit), tuple(cover), tuple(count))


def grid_doc(grid: LumaGrid) -> dict:
    """Das Raster klein für die Druckdatei-Zeile: je Zelle mittlere Luminanz × Deckkraft und mittlere Deckkraft als
    16-Bit-Werte (Base64) - bei einer Allover-Fläche (96 × 71 Zellen) rund 37 KB."""
    def packed(sums: tuple) -> str:
        values = [min(65535, max(0, round(value / count * 65535))) if count else 0
                  for row, counts in zip(sums, grid.count) for value, count in zip(row, counts)]
        return base64.b64encode(struct.pack(f"<{len(values)}H", *values)).decode("ascii")

    return {"version": LUMA_VERSION, "width_px": grid.width_px, "height_px": grid.height_px, "cell": grid.cell,
            "lit": packed(grid.lit), "cover": packed(grid.cover)}


def grid_from_doc(doc: Any) -> LumaGrid | None:
    """Das gespeicherte Raster zurück - ``None``, wenn es fehlt, alt oder kaputt ist (dann wird neu gerechnet)."""
    if not isinstance(doc, dict) or doc.get("version") != LUMA_VERSION:
        return None
    try:
        width, height, cell = int(doc["width_px"]), int(doc["height_px"]), int(doc["cell"])
        cols, rows = -(-width // cell), -(-height // cell)
        lit = struct.unpack(f"<{cols * rows}H", base64.b64decode(doc["lit"]))
        cover = struct.unpack(f"<{cols * rows}H", base64.b64decode(doc["cover"]))
    except (KeyError, TypeError, ValueError, ZeroDivisionError, struct.error):
        return None
    counts = tuple(tuple(float((min(width, (col + 1) * cell) - col * cell)
                               * (min(height, (row + 1) * cell) - row * cell)) for col in range(cols))
                   for row in range(rows))
    return LumaGrid(width, height, cell,
                    tuple(tuple(lit[row * cols + col] / 65535 * counts[row][col] for col in range(cols))
                          for row in range(rows)),
                    tuple(tuple(cover[row * cols + col] / 65535 * counts[row][col] for col in range(cols))
                          for row in range(rows)), counts)


def _grid_of_file(path) -> LumaGrid:
    with Image.open(path) as img:
        img.load()
        return luma_grid(img)


_ROW_LOCKS: dict[str, asyncio.Lock] = {}


def _row_lock(key: str) -> asyncio.Lock:
    """Eine Sperre je Prüfsumme und Zweck: zwei gleichzeitige Anfragen rechnen dasselbe nicht doppelt."""
    lock = _ROW_LOCKS.get(key)
    if lock is None:
        lock = _ROW_LOCKS[key] = asyncio.Lock()
    return lock


async def background_grid(db, row: dict | None) -> LumaGrid | None:
    """Die Helligkeits-Zellen einer Hintergrund-Datei - aus der Zeile (``luma``, beim Hochladen gerechnet). Nur eine
    ältere Datei ohne Raster wird einmal geöffnet, gerechnet (außerhalb der Ereignisschleife) und nachgetragen."""
    if not row or not row.get("sha256"):
        return None
    grid = grid_from_doc(row.get("luma"))
    if grid is not None:
        return grid
    async with _row_lock(f"luma:{row['sha256']}"):
        stored = await db.shop_print_files.find_one({"id": row["id"]}, {"_id": 0, "luma": 1}) if row.get("id") else None
        grid = grid_from_doc((stored or {}).get("luma"))
        if grid is not None:
            return grid
        path = shop_designs._path_of(row.get("file_ref"))
        if path is None or not path.is_file():
            return None
        grid = await asyncio.to_thread(_grid_of_file, path)
        if row.get("id"):
            await db.shop_print_files.update_one({"id": row["id"]}, {"$set": {"luma": grid_doc(grid)}})
        return grid


GARMENT = {"variant": None, "source": "garment", "luminance": None}
SURFACE_LUMINANCE = {"dark": 0.0, "light": 1.0}


def decide_surface(layer: dict, box: templates.Box | None, *, grid: LumaGrid | None, garment_hex: str | None,
                   product_surface: str | None, threshold: float) -> dict:
    """Hell oder dunkel für eine Ebene (Reihenfolge im Kopf dieses Abschnitts). ``variant`` ``None`` heißt: wie bisher
    nach der Shirtfarbe. ``luminance`` ist der gemessene Wert (aus dem Hintergrund) bzw. 0 oder 1 bei einer Vorgabe."""
    wanted = layer.get("variant")
    if wanted in SURFACE_LUMINANCE:
        return {"variant": wanted, "source": "layer", "luminance": SURFACE_LUMINANCE[wanted]}
    if grid is not None and box is not None:
        under = (SURFACE_LUMINANCE[product_surface] if product_surface in SURFACE_LUMINANCE
                 else shop_motifs.relative_luminance(garment_hex))
        measured = grid.mean(box, under)
        if measured is not None:
            return {"variant": "light" if measured >= threshold else "dark", "source": "background",
                    "luminance": round(measured, 4)}
    if product_surface in SURFACE_LUMINANCE:
        return {"variant": product_surface, "source": "product", "luminance": SURFACE_LUMINANCE[product_surface]}
    return dict(GARMENT)


def ink_for(rules: dict, color: str, surface: dict) -> str:
    """Die Farbe von Gamertag bzw. Vereinsnummer: ohne Entscheidung wie bisher nach der Shirtfarbe, sonst die erste
    Farbe der Regeln mit genug Kontrast zum Untergrund (``shop_gamertag.ink_for_surface``)."""
    if surface.get("variant") is None:
        return shop_gamertag.inks_for_garment(rules, color)[0]["key"]
    return shop_gamertag.ink_for_surface(rules, color, float(surface["luminance"]))["key"]


def surface_text(surface: dict | None) -> str | None:
    """„Fassung: dunkel (aus Hintergrund)“ - für die Vorschau in Schritt 3."""
    if not surface or surface.get("variant") is None:
        return None
    return f"Fassung: {LAYER_VARIANTS[surface['variant']]} ({SURFACE_SOURCES[surface['source']]})"


# ================================================================ Plan je Fläche und Farbe

@dataclass
class Planned:
    index: int
    kind: str
    label: str
    box: templates.Box
    source: MotifSource | None = None
    # Texthöhe und Höchstbreite (#2105), Schrift und Kontur (#2142) einer Textebene - für Rendern und Platzieren
    # dieselben Werte (``shop_gamertag.layer_rules``). ``None``: die globalen Gamertag-Regeln.
    spec: dict | None = None
    # Untergrund hell/dunkel (#2141) und - bei Gamertag, Vereinsnummer und festem Text - die Farbe daraus.
    surface: dict = field(default_factory=lambda: dict(GARMENT))
    ink: str | None = None
    ink_fixed: bool = False  # Farbe des Namens von Hand gewählt statt nach Kontrast (#2141)
    text: str | None = None  # der feste Text (#2142)
    band: float = 0.0  # Höhe des sichtbaren Bands einer Textebene in Pixeln der Fläche (#2142)

    @property
    def visual(self) -> tuple[float, float]:
        """Oberer und unterer sichtbarer Rand: bei Motiven der Rahmen, bei Text die Großbuchstaben bzw. Ziffern."""
        if self.kind == "motif" or not self.band:
            return self.box.top, self.box.bottom
        middle = self.box.top + self.box.height / 2
        return middle - self.band / 2, middle + self.band / 2


@dataclass
class Plan:
    entry: dict
    color: str
    layers: list[Planned]
    problems: list[str]
    layout_hash: str
    template_hash: str
    mode: str = "layout"
    # Fertige Datei als Hintergrund (#2141): die neueste hochgeladene Datei dieser Fläche und Farbe; ``background_ok``,
    # wenn sie zur aktuellen Vorlage passt und auf der Platte liegt.
    background: dict | None = None
    background_ok: bool = False

    @property
    def motifs(self) -> list[Planned]:
        return [layer for layer in self.layers if layer.kind == "motif"]

    @property
    def base_layers(self) -> list[Planned]:
        return [layer for layer in self.layers if layer.kind in BASE_KINDS]

    @property
    def texts(self) -> list[Planned]:
        return [layer for layer in self.layers if layer.kind in TEXT_KINDS]

    @property
    def needs_base(self) -> bool:
        return self.mode == "upload" or bool(self.base_layers)

    @property
    def on_background(self) -> bool:
        """Hintergrund plus Ebenen: die Grunddatei wird aus der hochgeladenen Datei und den Motiven erzeugt. Ohne
        Motive ist die hochgeladene Datei selbst die Grunddatei - wie vor #2141."""
        return self.mode == "upload" and bool(self.base_layers)


def text_canvas_px(entry: dict, gamertag_rules: dict, layer: dict | None = None,
                   kind: str = "gamertag") -> tuple[float, float]:
    """Die Leinwand der Gamertag-Datei (für jeden Namen gleich groß) in Pixeln dieser Fläche - mit der Größe der Ebene
    (``layer``: Texthöhe, Höchstbreite in cm, #2105; Schrift und Kontur, #2142), sonst nach den globalen Regeln. Eine
    Vereinsnummer (``kind``) ist nur so hoch wie ihre Ziffern."""
    width, height = shop_gamertag.canvas(shop_gamertag.layer_rules(gamertag_rules, layer), RENDER_KINDS.get(kind, kind))
    scale = entry["dpi"] / gamertag_rules["dpi"]
    return width * scale, height * scale


def _text_fingerprint(item: "Planned", gamertag_rules: dict) -> dict:
    """Was die Pixel eines festen Texts bestimmt (#2142) - für den ``layout_hash`` der Grunddatei: ein anderer Text,
    eine andere Größe, Schrift, Kontur oder Farbe macht sie „veraltet“."""
    own = shop_gamertag.layer_rules(gamertag_rules, item.spec)
    fill = shop_gamertag.color_of(own, item.ink)
    out = {"box": item.box.rounded(), "text": item.text, "ink": item.ink, "hex": fill["hex"],
           "rules": shop_gamertag.rules_hash(own)}
    if own.get("outline_in"):
        out["outline_hex"] = shop_gamertag.outline_color(own, fill)["hex"]
    return out


async def text_png(item: "Planned", gamertag_rules: dict, text: str | None = None, *, preview: bool = False) -> bytes:
    """Eine Textebene als PNG der ganzen Leinwand, gerendert wie die Druckdatei (#2142) - der feste Text bzw. ein
    Beispiel (``text``) für Gamertag und Vereinsnummer. Mit ``preview`` in Vorschau-Auflösung (Maße in Zoll gleich).
    Über die gemeinsamen Plätze (``shop_gamertag.render_async``), nie in der Ereignisschleife."""
    own = shop_gamertag.layer_rules(gamertag_rules, item.spec)
    if preview:
        own = shop_gamertag.preview_rules(own)
    rendered = await shop_gamertag.render_async(item.text if text is None else text, own, color_key=item.ink,
                                                kind=RENDER_KINDS.get(item.kind, "gamertag"),
                                                wait=shop_gamertag.RENDER_WAIT_SECONDS if preview else None)
    return rendered.payload


def layer_spec(layer: dict) -> dict | None:
    """Was eine Textebene selbst festlegt (#2105, #2142): Größe, Schrift, Kontur - ``None`` heißt globale Regeln."""
    spec = {name: layer[name] for name in (*shop_gamertag.LAYER_SIZE_FIELDS, *shop_gamertag.LAYER_STYLE_FIELDS)
            if layer.get(name) not in (None, "")}
    return spec or None


def motifs_on_background(row: dict) -> bool:
    """Liegen die Motive dieser Fläche auf der fertigen Datei (#2141)? Im Modus „Motiv und Position“ immer. Im Modus
    „Fertige Druckdatei“ nur bei Zeilen, die seit #2141 gespeichert sind (``background_layers``): davor blendete Schritt
    3 die Motive dort aus und druckte sie nicht - ein älteres Produkt behält so genau seine Dateien, bis es neu
    gespeichert wird."""
    return (row.get("mode") or "layout") != "upload" or bool(row.get("background_layers"))


async def latest_background(db, product_id: str, placement: str, group: str, color: str) -> dict | None:
    """Die neueste hochgeladene Datei einer Fläche und Farbe - der Hintergrund (#2141)."""
    rows = await db.shop_print_files.find(
        {"product_id": product_id, "placement": placement, "group": group, "color_key": _color_key(color),
         "purpose": "base", "origin": "upload"}, {"_id": 0}).sort("version", -1).to_list(1)
    return rows[0] if rows else None


async def plan_placement(db, row: dict, entry: dict, *, color: str, color_hex: str | None, presets_doc: dict,
                         gamertag_rules: dict, color_label: str | None = None, product_id: str | None = None,
                         surface: str | None = None) -> Plan:
    """Eine Fläche für eine Shirtfarbe: Vorgaben umgerechnet, Rahmen geprüft, Untergrund je Ebene entschieden,
    Prüfsumme des Aufbaus. ``color_label`` ist nur die Bezeichnung in Meldungen (#2105) - gerechnet wird mit dem
    Printful-Namen. Mit ``product_id`` sucht der Plan im Modus „Fertige Druckdatei“ den Hintergrund dieser Farbe
    (#2141); ``surface`` ist die Vorgabe des Produkts („Untergrund gilt als“)."""
    by_key = {item["key"]: item for item in presets_doc["presets"]}
    rules = presets_doc["rules"]
    planned: list[Planned] = []
    found: list[str] = []
    mode = row.get("mode") or "layout"
    template_hash = templates.entry_hash(entry)
    background = None
    if mode == "upload" and product_id:
        background = await latest_background(db, product_id, row["key"], entry["group"], color)
    background_ok = bool(background and background.get("template_hash") == template_hash and file_exists(background))
    product_surface = surface if surface in SURFACE_LUMINANCE else None
    lazy: dict = {}

    async def decide(layer: dict, box: templates.Box | None) -> dict:
        if layer.get("variant") not in SURFACE_LUMINANCE and not background_ok and product_surface is None:
            return dict(GARMENT)  # wie vor #2141 - ohne die Einstellungen der Motive zu lesen
        if "grid" not in lazy:
            lazy["grid"] = await background_grid(db, background) if background_ok else None
            lazy["threshold"] = (await shop_motifs.load_settings(db))["threshold"]
        return decide_surface(layer, box, grid=lazy["grid"], garment_hex=color_hex, product_surface=product_surface,
                              threshold=lazy["threshold"])

    layers = list(enumerate(row.get("layers") or []))
    # Motive zuerst (ein Name folgt dem ersten Motiv), danach die Textebenen in ihrer Reihenfolge - „unter der Ebene
    # davor“ (#2142) meint die zuletzt geplante.
    for index, layer in sorted(layers, key=lambda item: item[1].get("kind") != "motif"):
        kind = layer.get("kind")
        if kind in BASE_KINDS and not motifs_on_background(row):
            continue
        preset = by_key.get(layer.get("preset"))
        if preset is None:
            found.append(f"{entry['label']}: die Vorgabe „{layer.get('preset')}“ gibt es nicht mehr - bitte neu wählen.")
            continue
        offsets = {"offset_x_cm": float(layer.get("offset_x_cm") or 0.0),
                   "offset_y_cm": float(layer.get("offset_y_cm") or 0.0)}
        if kind == "motif":
            motif = layer.get("motif") or {}
            width_cm = float(layer.get("width_cm") or preset.get("width_cm") or 5.0)
            source = await _motif_source(db, motif, color, color_hex)
            chosen = dict(GARMENT)
            if layer.get("variant") in SURFACE_LUMINANCE or background_ok or product_surface:
                # Erst mit der Fassung nach Shirtfarbe (bzw. der Hauptdatei) setzen, unter diesem Rahmen messen, dann
                # die passende Fassung nehmen - beide Fassungen eines Paars haben dasselbe Seitenverhältnis (#2084).
                probe = source or await _motif_source(db, motif, color, color_hex, "dark")
                if probe is not None:
                    chosen = await decide(layer, templates.place_motif(entry, preset, width_cm=width_cm,
                                                                       aspect=probe.aspect, rules=rules, **offsets))
                if chosen["variant"]:
                    source = await _motif_source(db, motif, color, color_hex, chosen["variant"])
            if source is None:
                found.append(f"{entry['label']}: für „{color_label or shop_colors.german(color)}“ fehlt das Motiv.")
                continue
            box = templates.place_motif(entry, preset, width_cm=width_cm, aspect=source.aspect, rules=rules, **offsets)
            label = f"Motiv „{source.title}“ ({preset['label']})"
            planned.append(Planned(index, "motif", label, box, source, surface=chosen))
        else:
            render_kind = RENDER_KINDS.get(kind, "gamertag")
            spec = layer_spec(layer)
            text = None
            try:
                own_rules = shop_gamertag.layer_rules(gamertag_rules, spec)
                if kind == "text":
                    text = shop_gamertag.clean_fixed_text(layer.get("text"), gamertag_rules)
                too_big = shop_gamertag.canvas_problem(own_rules, render_kind)
                if too_big:
                    raise ShopError(too_big)
            except ShopError as exc:
                found.append(f"{entry['label']}, {SHORT_LABELS.get(kind, kind)}: {exc}")
                continue
            width, height = text_canvas_px(entry, gamertag_rules, spec, kind)
            band = shop_gamertag.band_px(own_rules, render_kind) * entry["dpi"] / gamertag_rules["dpi"]
            follow = next((item.box for item in planned if item.kind == "motif"), None)
            previous = planned[-1] if planned else None
            above = ((previous.box.left + previous.box.width / 2, previous.visual[1]) if previous else None)
            try:
                box = templates.place_text(entry, preset, width_px=width, height_px=height, follow=follow,
                                           rules=rules, above=above, band_top=(height - band) / 2, **offsets)
            except ShopError as exc:
                found.append(f"{entry['label']}: {exc}")
                continue
            chosen = await decide(layer, box)
            label = f"{SHORT_LABELS.get(kind, kind)} ({preset['label']})"
            # Farbe fest gewählt (#2141) - nur eine, die es in den Gamertag-Regeln (noch) gibt; sonst automatisch.
            fixed = layer.get("ink") if layer.get("ink") in {item["key"] for item in gamertag_rules["colors"]} else None
            planned.append(Planned(index, kind, label, box, spec=spec, surface=chosen,
                                   ink=fixed or ink_for(gamertag_rules, color, chosen), ink_fixed=bool(fixed),
                                   text=text, band=band))
        found += templates.problems(entry, box, label, rules)
    payload = {"renderer": RENDERER_VERSION, "template": template_hash, "mode": mode,
               "motifs": [{"box": item.box.rounded(), "ref": item.source.ref} for item in planned
                          if item.kind == "motif"]}
    texts = [_text_fingerprint(item, gamertag_rules) for item in planned if item.kind == "text"]
    if texts:
        # Fester Text in der Grunddatei (#2142): Rahmen, Text, Farbe und alles, was die Pixel bestimmt. Ohne festen
        # Text bleibt der Fingerabdruck wie vor #2142 - bestehende Dateien bleiben gültig.
        payload["texts"] = texts
    if mode == "upload" and any(item.kind in BASE_KINDS for item in planned):
        # Hintergrund plus Ebenen (#2141): ein neuer Hintergrund macht die Grunddatei veraltet. Ohne Motive bleibt der
        # Fingerabdruck wie vor #2141 - die hochgeladene Datei ist dann selbst die Grunddatei.
        payload["background"] = (background or {}).get("sha256") if background_ok else None
    layout_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    planned.sort(key=lambda item: item.index)
    return Plan(entry=entry, color=color, layers=planned, problems=found, layout_hash=layout_hash,
                template_hash=template_hash, mode=mode, background=background, background_ok=background_ok)


def _surface_view(item: Planned, rules: dict | None) -> dict:
    out = {"surface": {**item.surface, "text": surface_text(item.surface)}}
    if item.ink and rules:
        ink = next((color for color in rules["colors"] if color["key"] == item.ink), None)
        out["ink"] = {"key": item.ink, "label": (ink or {}).get("label"), "hex": (ink or {}).get("hex"),
                      "fixed": item.ink_fixed}
    return out


def plan_view(plan: Plan, gamertag_rules: dict | None = None) -> dict:
    dpi = plan.entry["dpi"]
    return {"placement": plan.entry["placement"], "group": plan.entry["group"], "color": plan.color,
            "problems": plan.problems, "layout_hash": plan.layout_hash,
            "layers": [{"index": item.index, "kind": item.kind, "label": item.label, **item.box.as_dict(dpi),
                        "source": item.source.ref if item.source else None,
                        # das Bild genau der Fassung, die gedruckt wird - für die Vorschau in Schritt 3
                        "image_path": item.source.image_path if item.source else None,
                        "aspect": round(item.source.aspect, 6) if item.source else None,
                        **_surface_view(item, gamertag_rules)} for item in plan.layers]}


# ================================================================ Ablage der Druckdateien

def file_name(row: dict) -> str:
    """Name unter der öffentlichen Adresse: Grunddatei mit Fläche, Farbe und Version (Printful lädt eine neue Version
    nicht aus dem Zwischenspeicher), Bestelldatei nur mit dem Anfang der Prüfsumme - nie ein Name."""
    if row.get("file_name"):
        return row["file_name"]
    # Eine gelöschte Bestelldatei hat keine Prüfsumme mehr (#2150) - ihre Adresse ist ohnehin abgeschaltet.
    return f"druck-{row['sha256'][:16]}.png" if row.get("sha256") else "druck-entfernt.png"


def public_path(row: dict) -> str | None:
    return f"{shop_designs.PUBLIC_PREFIX}/{row['public_id']}/{file_name(row)}" if row.get("public_id") else None


def public_url(row: dict) -> str | None:
    path = public_path(row)
    base = shop_designs._public_base_url()
    return f"{base}{path}" if path and base else path


async def public_file(db, public_id: str, filename: str):
    """Die Datei hinter einer öffentlichen Adresse - oder ``None`` (404): falscher Schlüssel, falscher Name,
    abgeschaltet, gelöscht."""
    if not PUBLIC_ID.fullmatch(str(public_id or "")):
        return None
    row = await db.shop_print_files.find_one({"public_id": public_id}, {"_id": 0})
    if not row or row.get("public_disabled_at") or row.get("file_deleted_at"):
        return None
    if not hmac.compare_digest(str(filename or "").encode(), file_name(row).encode()):
        return None
    path = shop_designs._path_of(row.get("file_ref"))
    return path if path is not None and path.is_file() else None


def file_exists(row: dict | None) -> bool:
    path = shop_designs._path_of((row or {}).get("file_ref"))
    return path is not None and path.is_file()


async def latest_base(db, product_id: str, placement: str, group: str, color: str,
                      origin: str | None = None) -> dict | None:
    query = {"product_id": product_id, "placement": placement, "group": group, "color_key": _color_key(color),
             "purpose": "base"}
    if origin:
        query["origin"] = origin
    rows = await db.shop_print_files.find(query, {"_id": 0}).sort("version", -1).to_list(1)
    return rows[0] if rows else None


async def current_base(db, product_id: str, plan) -> dict | None:
    """Die Grunddatei, die für einen Plan zählt (#2141): bei „Hintergrund plus Ebenen“ die neueste erzeugte - ein neuer
    Hintergrund allein ist noch keine Druckdatei; bei einer fertigen Datei ohne Motive die neueste hochgeladene - auch
    wenn mit Motiven schon eine erzeugte entstand (Motive wieder entfernt); sonst die neueste überhaupt."""
    origin = None
    if plan.mode == "upload":
        origin = "composed" if plan.on_background else "upload"
    return await latest_base(db, product_id, plan.entry["placement"], plan.entry["group"], plan.color, origin=origin)


async def _store(db, payload: bytes, values: dict) -> dict:
    file_ref, path = shop_designs._store(payload)
    row = {"id": new_id(), "sha256": hashlib.sha256(payload).hexdigest(), "file_ref": file_ref,
           "public_id": secrets.token_urlsafe(32), "content_type": "image/png", "size_bytes": len(payload),
           "created_at": now_utc().isoformat(), **values}
    try:
        await db.shop_print_files.insert_one(dict(row))
    except BaseException:
        path.unlink(missing_ok=True)  # keine Datei ohne Zeile
        raise
    return row


async def _store_base(db, payload: bytes, values: dict) -> dict:
    """Eine neue Version der Grunddatei - die Nummer zählt je Produkt, Fläche, Gruppe und Farbe hoch."""
    for _attempt in range(3):
        latest = await latest_base(db, values["product_id"], values["placement"], values["group"], values["color"])
        version = (latest or {}).get("version", 0) + 1
        name = (f"{values['slug']}-{values['placement']}-{_slug(values['color'])}"
                f"{'' if values['group'] == templates.GROUP_ALL else '-' + values['group'][1:7]}-v{version}.png")
        try:
            return await _store(db, payload, {**{key: value for key, value in values.items() if key != "slug"},
                                              "purpose": "base", "version": version, "file_name": name})
        except DuplicateKeyError:
            continue
    raise ShopConflict("Die Druckdatei wurde gerade gleichzeitig erzeugt - bitte neu laden.")


def file_view(row: dict | None) -> dict | None:
    if not row:
        return None
    return {"id": row["id"], "version": row.get("version"), "origin": row.get("origin"), "sha256": row["sha256"],
            "sha256_short": row["sha256"][:12], "width_px": row.get("width_px"), "height_px": row.get("height_px"),
            "dpi": row.get("dpi"), "size_bytes": row.get("size_bytes"), "created_at": row.get("created_at"),
            "warnings": row.get("warnings") or [], "file_name": file_name(row),
            "public_url": public_url(row) if not row.get("public_disabled_at") else None,
            "exists": file_exists(row)}


# ================================================================ Was ein Produkt braucht

async def _context(db, product: dict) -> dict:
    printful = product.get("printful") or {}
    template = await templates.get(db, printful.get("product_id"))
    presets_doc = await templates.load_presets(db)
    rules = await shop_gamertag.load_rules(db)
    rows = await layout_rows(db, product, template=template, presets_doc=presets_doc)
    colors = (product.get("offer") or {}).get("colors") or []
    codes = {item["name"]: item.get("code") for item in printful.get("colors") or []}
    variants = {}
    for item in printful.get("variants") or []:
        if item.get("color") in colors and item.get("size") in ((product.get("offer") or {}).get("sizes") or []):
            variants.setdefault(item["color"], []).append(item["id"])
    technique = product.get("technique") or printful.get("default_technique")
    return {"template": template, "presets": presets_doc, "gamertag_rules": rules, "rows": rows, "colors": colors,
            "codes": codes, "variants": variants, "technique": technique,
            "labels": {color: shop_colors.label(product, color) for color in colors},
            "product_id": product.get("id"), "surface": product.get("print_surface") or "garment"}


async def _plan(db, context: dict, row: dict, entry: dict, color: str, color_hex: str | None = None) -> Plan:
    """Ein Plan mit allem aus dem Kontext - derselbe Weg für Prüfung, Erzeugen, Bestellung und Vorschau."""
    return await plan_placement(db, row, entry, color=color, color_hex=color_hex or context["codes"].get(color),
                                presets_doc=context["presets"], gamertag_rules=context["gamertag_rules"],
                                color_label=context["labels"].get(color), product_id=context["product_id"],
                                surface=context["surface"])


async def plans_for(db, product: dict, context: dict | None = None):
    """Alle Pläne eines Produkts: je Platzierung, angebotener Farbe und Varianten-Gruppe. Liefert (Zeile, Plan,
    Varianten) - eine Zeile ohne Fläche bei Printful mit ``plan = None``."""
    context = context or await _context(db, product)
    out = []
    for row in context["rows"]:
        for color in context["colors"]:
            groups = templates.groups_for(context["template"], context["technique"], row["key"],
                                          context["variants"].get(color) or [])
            if not groups:
                out.append((row, None, color, []))
                continue
            for entry, ids in groups:
                plan = await _plan(db, context, row, entry, color)
                out.append((row, plan, color, ids or []))
    return out, context


def _upload_valid(row: dict | None, plan: Plan) -> bool:
    return bool(row and row.get("origin") == "upload" and row.get("template_hash") == plan.template_hash
                and file_exists(row))


def _base_valid(row: dict | None, plan: Plan) -> bool:
    if plan.mode == "upload" and not plan.on_background:
        return _upload_valid(row, plan)
    if plan.on_background and (row or {}).get("origin") != "composed":
        return False  # Hintergrund plus Ebenen: erst die erzeugte Datei gilt, nie der Hintergrund allein
    return bool(row and row.get("layout_hash") == plan.layout_hash and file_exists(row))


def _background_state(plan: Plan, latest: dict | None) -> tuple[str, str]:
    """Stand einer Fläche „Hintergrund plus Ebenen“ (#2141), wenn die Grunddatei nicht gilt. ``latest`` ist die
    neueste erzeugte Grunddatei (``current_base``)."""
    if plan.background is None:
        return "missing", "Noch kein Hintergrund - je Farbe die fertige Datei hochladen (nach dem Speichern)."
    if not plan.background_ok:
        return "outdated", "Vorlage von Printful geändert - den Hintergrund neu hochladen."
    if latest is None:
        return "missing", "Hintergrund da - noch nicht mit den Ebenen erzeugt („Druckdateien erzeugen“)."
    return "outdated", "Neuer Hintergrund, Motiv oder Position geändert - neu erzeugen."


async def states(db, product: dict, context: dict | None = None) -> list[dict]:
    """Stand jeder Druckdatei eines Produkts: ``ok``, ``outdated`` (Aufbau oder Vorlage geändert - neu erzeugen),
    ``missing``, ``invalid`` (Plan mit Problemen), ``not_needed`` (nur ein Platzhalter, die Datei entsteht je
    Bestellung), ``no_area`` (die Fläche gibt es bei Printful nicht)."""
    plans, context = await plans_for(db, product, context)
    out = []
    for row, plan, color, ids in plans:
        base = {"placement": row["key"], "color": color, "variant_ids": ids, "mode": row.get("mode") or "layout"}
        if plan is None:
            out.append({**base, "group": None, "state": "no_area",
                        "detail": f"Die Fläche {templates.placement_label(row['key'])} hat bei Printful keine "
                                  "Druckvorgabe (mehr).", "file": None,
                        "plan": None})
            continue
        latest = await current_base(db, product["id"], plan)
        state, detail = "ok", ""
        if plan.problems:
            state, detail = "invalid", " ".join(plan.problems)
        elif not plan.needs_base:
            state, detail = "not_needed", "Nur Platzhalter - die Datei entsteht je Bestellung."
        elif _base_valid(latest, plan):
            state = "ok"
        elif plan.on_background:
            state, detail = _background_state(plan, latest)
        elif latest is None or (plan.mode == "upload" and latest.get("origin") != "upload"):
            state, detail = "missing", ("Noch keine fertige Druckdatei hochgeladen." if plan.mode == "upload"
                                        else "Noch nicht erzeugt.")
        else:
            state, detail = "outdated", ("Vorlage von Printful geändert - neu hochladen." if plan.mode == "upload"
                                         else "Aufbau, Motiv oder Vorlage geändert - neu erzeugen.")
        out.append({**base, "group": plan.entry["group"], "state": state, "detail": detail,
                    "file": file_view(latest), "plan": plan_view(plan, context["gamertag_rules"]),
                    # der Hintergrund dieser Farbe für die Vorschau in Schritt 3 (#2141)
                    "background": file_view(plan.background) if plan.mode == "upload" else None,
                    # passt der Hintergrund zur Vorlage? Sonst entscheidet nicht er über Fassung und Farbe (#2142)
                    "background_ok": plan.background_ok})
    return out


# ================================================================ Erzeugen

def _lock_name(product_id: str) -> str:
    return f"shop:print-files:{product_id}"


async def generate(db, product_id: str, *, actor_id: str, reason: Any = None) -> dict:
    """Alle Grunddateien eines Produkts erzeugen, die fehlen oder veraltet sind. Unveränderte bleiben, eine Datei mit
    gleicher Prüfsumme wird nicht noch einmal abgelegt. Liefert ``created``, ``unchanged``, ``failed`` (mit Text)."""
    reason = clean_reason(reason, required=False)
    product = await shop_catalog.get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    try:
        async with mutation_lock(db, _lock_name(product_id), wait_seconds=0.0, lease_seconds=300.0):
            return await _generate(db, product, actor_id=actor_id, reason=reason)
    except MutationLockBusy as exc:
        raise ShopConflict("Die Druckdateien werden gerade erzeugt - bitte gleich noch einmal.") from exc


async def _render_base(db, plan: Plan, rules: dict, gamertag_rules: dict | None = None) -> Composed:
    """Die Grunddatei: die Motive und festen Texte (#2142) auf einer durchsichtigen Fläche - bzw. auf dem Hintergrund
    (#2141). Reihenfolge wie die Ebenen."""
    entry = plan.entry
    layers = []
    for item in plan.base_layers:
        left, top, width, height = item.box.rounded()
        if item.kind != "motif":
            rules_for_text = gamertag_rules or await shop_gamertag.load_rules(db)
            png = await text_png(item, rules_for_text)
            layers.append(Layer(png=png, left=left, top=top, width=width, height=height, label=item.label))
            continue
        png = await _motif_png(db, item.source, width_px=width, dpi=entry["dpi"])
        layers.append(Layer(png=png, left=left, top=top, width=width, height=height, label=item.source.title,
                            native_width_px=None if item.source.vector else item.source.width_px))
    base = None
    if plan.on_background:
        path = shop_designs._path_of((plan.background or {}).get("file_ref"))
        if not plan.background_ok or path is None:
            raise ShopError("Der Hintergrund fehlt oder passt nicht mehr zur Vorlage - bitte neu hochladen.")
        base = await asyncio.to_thread(path.read_bytes)
    return await asyncio.to_thread(
        compose_print_file, entry["width_px"], entry["height_px"], entry["dpi"], layers,
        min_dpi_ratio=rules["min_dpi_ratio"], warn_dpi_ratio=rules["warn_dpi_ratio"],
        safe_margin_px=templates.margin_px(entry, rules), base=base)


async def _generate(db, product: dict, *, actor_id: str, reason: str) -> dict:
    plans, context = await plans_for(db, product)
    if not context["template"] or not (context["template"].get("entries")):
        raise ShopError("Erst die Druckvorlagen von Printful laden (Schritt 1 oder „Mit Printful abgleichen“).")
    rules = context["presets"]["rules"]
    created, failed, unchanged = [], [], 0
    for row, plan, color, ids in plans:
        # Erzeugt wird, wo Motive in die Grunddatei kommen; eine fertige Datei ohne Motive ist selbst die Grunddatei.
        if plan is None or not plan.base_layers or (plan.mode == "upload" and not plan.on_background):
            continue
        name = f"{plan.entry['label']} / {context['labels'].get(color) or color}"
        if plan.problems:
            failed.append({"placement": row["key"], "color": color, "detail": " ".join(plan.problems)})
            continue
        if plan.on_background and not plan.background_ok:
            failed.append({"placement": row["key"], "color": color,
                           "detail": f"{name}: {_background_state(plan, None)[1]}"})
            continue
        latest = await current_base(db, product["id"], plan)
        if _base_valid(latest, plan):
            unchanged += 1
            continue
        try:
            composed = await _render_base(db, plan, rules, context["gamertag_rules"])
        except ShopError as exc:
            failed.append({"placement": row["key"], "color": color, "detail": f"{name}: {exc}"})
            continue
        if latest and latest.get("sha256") == composed.sha256 and file_exists(latest):
            await db.shop_print_files.update_one({"id": latest["id"]}, {"$set": {
                "layout_hash": plan.layout_hash, "template_hash": plan.template_hash,
                "warnings": list(composed.warnings)}})
            unchanged += 1
            continue
        stored = await _store_base(db, composed.payload, {
            "origin": "composed", "product_id": product["id"], "slug": product.get("slug") or "produkt",
            "placement": row["key"], "printful_placement": row["key"], "technique": plan.entry["technique"],
            "group": plan.entry["group"], "variant_ids": ids, "color": color, "color_key": _color_key(color),
            "width_px": composed.width_px, "height_px": composed.height_px, "dpi": composed.dpi,
            "layout_hash": plan.layout_hash, "template_hash": plan.template_hash,
            "sources": ([{"source": "background", "file_id": plan.background["id"],
                          "sha256": plan.background["sha256"]}] if plan.on_background else [])
            + [item.source.ref for item in plan.motifs], "warnings": list(composed.warnings),
            "created_by": actor_id})
        created.append({"placement": row["key"], "color": color, "group": plan.entry["group"],
                        "version": stored["version"], "sha256": stored["sha256"], "warnings": list(composed.warnings)})
    if created:
        await record_admin_action(db, "shop.print_file.add", actor_id=actor_id, target_id=product["id"], reason=reason,
                                  data={"created": [{key: item[key] for key in ("placement", "color", "version",
                                                                                 "sha256")} for item in created],
                                        "failed": len(failed)})
    return {"created": created, "unchanged": unchanged, "failed": failed}


# ================================================================ Fertige Druckdatei hochladen (für Profis)

UPLOAD_ASPECT_TOLERANCE = 0.005


async def upload(db, product_id: str, *, placement: str, color: str, data: bytes, filename: str, content_type: str,
                 actor_id: str, reason: Any = None, group: str | None = None) -> dict:
    """Eine fertige Druckdatei für eine Fläche und Farbe - **exakt** gegen die Vorlage geprüft: genau die Pixel der
    Vorlage, oder dasselbe Seitenverhältnis mit mehr Pixeln (dann auf die exakte Größe verkleinert). Kleiner oder ein
    anderes Seitenverhältnis: abgelehnt mit px, cm und Zoll. Neu kodiert (sRGB, nur Pixel) wie die Designs (#1708)."""
    reason = clean_reason(reason, required=False)
    product = await shop_catalog.get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    context = await _context(db, product)
    row = next((item for item in context["rows"] if item["key"] == placement), None)
    if row is None:
        raise ShopError("Diese Fläche ist beim Produkt nicht gewählt.")
    if color not in context["colors"]:
        raise ShopError(f"Die Farbe „{color}“ wird nicht angeboten.")
    groups = templates.groups_for(context["template"], context["technique"], placement,
                                  context["variants"].get(color) or [])
    if group is not None:
        groups = [item for item in groups if item[0]["group"] == group]
    if not groups:
        raise ShopError("Für diese Fläche gibt es keine Druckvorgabe von Printful.")
    if len(groups) > 1:
        raise ShopError("Diese Farbe hat je Größe eine eigene Fläche - bitte die Gruppe wählen.")
    entry, ids = groups[0]
    if len(data) > shop_designs.MAX_BYTES:
        raise ShopError(f"Datei zu groß (höchstens {shop_designs.MAX_UPLOAD_MB} MB).")
    if not data:
        raise ShopError("Die Datei ist leer.")
    img, source_format = shop_designs.prepare(data, filename, content_type)
    want_w, want_h, dpi = entry["width_px"], entry["height_px"], entry["dpi"]
    expected = (f"{measure_pair(want_w, want_h, dpi)} bei {dpi} DPI")
    notes = []
    if img.size != (want_w, want_h):
        same_ratio = abs(img.width / img.height - want_w / want_h) <= (want_w / want_h) * UPLOAD_ASPECT_TOLERANCE
        if not same_ratio:
            raise ShopError(f"Falsches Seitenverhältnis: die Datei hat {img.width} × {img.height} px, die Vorlage "
                            f"„{entry['label']}“ verlangt {expected}.")
        if img.width < want_w:
            effective = img.width / entry["width_in"]
            raise ShopError(f"Zu wenig Pixel: die Datei hat {img.width} × {img.height} px - bei "
                            f"{templates.cm(entry['width_cm'])} Breite sind das {int(effective)} DPI. Die Vorlage "
                            f"„{entry['label']}“ verlangt {expected}.")
        img = img.convert("RGBA").resize((want_w, want_h), Image.Resampling.LANCZOS)
        notes.append(f"Auf die exakte Größe {want_w} × {want_h} px verkleinert.")
    if not shop_designs.has_transparency(img):
        notes.append("Kein durchsichtiger Hintergrund: die ganze Fläche wird bedruckt.")
    payload = shop_designs.png_bytes(img, dpi)
    sha256 = hashlib.sha256(payload).hexdigest()
    template_hash = templates.entry_hash(entry)
    background = await latest_background(db, product_id, placement, entry["group"], color)
    if (background and background.get("sha256") == sha256 and background.get("template_hash") == template_hash
            and file_exists(background)):
        raise ShopConflict(f"Diese Datei ist schon die aktuelle Version (v{background['version']}).")
    # Einmal beim Hochladen (#2141): Helligkeits-Raster und Vorschaubild - Schritt 3, Vorschau und Bestellung öffnen
    # die große Datei dafür nie wieder.
    grid, thumb = await asyncio.to_thread(lambda: (luma_grid(img), _thumb_png(img)))
    thumb_ref, thumb_path = shop_designs._store(thumb)
    try:
        stored = await _store_base(db, payload, {
            "origin": "upload", "product_id": product_id, "slug": product.get("slug") or "produkt",
            "placement": placement, "printful_placement": placement, "technique": entry["technique"],
            "group": entry["group"], "variant_ids": ids or [], "color": color, "color_key": _color_key(color),
            "width_px": want_w, "height_px": want_h, "dpi": dpi, "layout_hash": "upload",
            "template_hash": template_hash, "sources": [{"source": "upload", "format": source_format}],
            "warnings": notes, "created_by": actor_id, "luma": grid_doc(grid), "thumb_ref": thumb_ref})
    except BaseException:
        thumb_path.unlink(missing_ok=True)
        raise
    await record_admin_action(db, "shop.print_file.add", actor_id=actor_id, target_id=product_id, reason=reason,
                              data={"created": [{"placement": placement, "color": color, "version": stored["version"],
                                                 "sha256": stored["sha256"]}], "origin": "upload"})
    # Die Pixel der Vorlage sind da - ob die Datei echte Details hat oder nur hochgerechnet ist, misst keine Prüfung.
    out_notes = [*notes, "Ob die Datei echte Details in dieser Auflösung hat (nicht nur hochskaliert), lässt sich "
                         "nicht messen - bitte am Muster prüfen."]
    if motifs_on_background(row) and any(layer.get("kind") in BASE_KINDS for layer in row.get("layers") or []):
        # Hintergrund plus Ebenen (#2141): gleich die Grunddatei mit den Motiven erzeugen.
        try:
            result = await generate(db, product_id, actor_id=actor_id, reason=reason)
        except ShopError as exc:
            out_notes.append(f"Mit den Ebenen noch nicht erzeugt: {exc}")
        else:
            mine = [item for item in result["created"] if item["placement"] == placement and item["color"] == color]
            failed = [item["detail"] for item in result["failed"]
                      if item["placement"] == placement and item["color"] == color]
            if mine:
                out_notes.append(f"Mit den Ebenen zur Druckdatei v{mine[0]['version']} erzeugt.")
            elif not failed:
                out_notes.append("Mit den Ebenen: die Druckdatei hat dieselben Pixel wie bisher - sie bleibt.")
            out_notes += failed
    return {**file_view(stored), "notes": out_notes}


def measure_pair(width_px: int, height_px: int, dpi: int) -> str:
    return (f"{width_px} × {height_px} px = {templates.cm(templates.px_to_cm(width_px, dpi))} × "
            f"{templates.cm(templates.px_to_cm(height_px, dpi))}")


# ================================================================ Bestellung: Dateien je Position einfrieren

async def prints_number(db, product: dict) -> bool:
    """Druckt dieses Produkt die Vereinsnummer (#2150) - hat eine Fläche eine Vereinsnummer-Ebene? Nur Produkte mit
    Druckvorlage bzw. neuem Aufbau; alte Platzierungen ohne Printful-Produkt kennen keine Nummer."""
    rows = product.get("placements") or []
    if not rows or (not product.get("printful") and not all(is_layout(row) for row in rows)):
        return False
    return any(layer.get("kind") == "member_number" for row in await layout_rows(db, product)
               for layer in row.get("layers") or [])


async def freeze_line(db, product: dict, variant: dict, *, gamertag: str | None, position: int, user_id: str,
                      order_id: str, item_id: str, printful_variant_id: int | None,
                      number: str | None = None) -> tuple[list[dict], list[dict]]:
    """Was eine Bestellposition an Druckdateien einfriert - je Fläche genau eine Datei:

    - ohne Namen und Nummer die geltende Grunddatei (Fassung mit Prüfsumme), die zum Aufbau und zur Vorlage passen muss;
    - mit Gamertag bzw. Vereinsnummer (#2150) eine **eigene** Datei für genau diese Position: Grunddatei plus Name und
      Nummer an ihrem Platz (``shop_gamertag.store`` legt beide als Bestelldateien ab). Personenbezogen: Konto,
      Bestellung, Position. Die Nummer gibt der Server (``jersey_numbers.print_number``), nie die Anfrage.

    Liefert (Druckdateien, Motiv-Fassungen). Fehlt etwas: ``ShopError`` - die Position ist dann nicht bestellbar."""
    context = await _context(db, product)
    # Fail-closed: lässt sich auch nur eine alte Platzierung nicht abbilden, ist das ganze Produkt nicht bestellbar -
    # nie eine Bestellung, in der eine Fläche still fehlt. Die Kundschaft liest nur den festen Satz, keine Interna.
    if product.get("placements"):
        blocked = [] if context["rows"] and all(is_layout(row) for row in product["placements"]) else (
            await layout_conversion(db, product))["blocked"]
        if not context["rows"] or blocked:
            _refuse(position, product, variant, area="-", reason="layout not convertible: "
                    + (" ".join(blocked) or "keine Fläche abbildbar"))
    color = " ".join(str(variant.get("color") or "").split())
    color_hex = context["codes"].get(color) or variant.get("color_code")
    files, sources = [], []
    for row in context["rows"]:
        entry = templates.entry_for_variant(context["template"], context["technique"], row["key"], printful_variant_id)
        if entry is None:
            # Die Kundschaft liest nur den festen Satz; Fläche und Grund stehen im Log und rot in der Vorab-Prüfung
            # („Druckdateien je Farbe“: Fläche fehlt).
            _refuse(position, product, variant, area=row["key"], reason="no template for this area and variant")
        plan = await _plan(db, context, row, entry, color, color_hex)
        if plan.problems:
            _refuse(position, product, variant, area=row["key"], reason="layout does not fit: " + " ".join(plan.problems))
        base_row = None
        if plan.needs_base:
            base_row = await current_base(db, product["id"], plan)
            if not _base_valid(base_row, plan):
                _refuse(position, product, variant, area=row["key"],
                        reason="print file missing" if base_row is None else "print file outdated or not on disk")
            sources += [{"placement": row["key"], **item.source.ref} for item in plan.motifs]
        if any(item.kind == "gamertag" for item in plan.texts) and not gamertag:
            raise ShopError(f"Position {position}: für dieses Produkt fehlt der Gamertag.")
        if any(item.kind == "member_number" for item in plan.texts) and not number:
            raise ShopError(f"Position {position}: für dieses Produkt fehlt die Vereinsnummer.")
        frozen = {"placement": row["key"], "printful_placement": row["key"], "technique": entry["technique"],
                  "group": entry["group"], "width_px": entry["width_px"], "height_px": entry["height_px"],
                  "dpi": entry["dpi"]}
        if plan.texts:
            # Gamertag und Vereinsnummer (#2150) in einer eigenen Datei - auch, wenn die Fläche nur eine Nummer hat.
            personal = await _personal_file(db, product, plan, base_row, gamertag=gamertag, number=number,
                                            color=color, user_id=user_id, order_id=order_id, item_id=item_id,
                                            variant=variant, position=position)
            files.append({**frozen, "kind": "personal", "file_id": personal["id"], "version": None,
                          "sha256": personal["sha256"], "gamertag_file_id": personal["gamertag_file_id"],
                          "number_file_id": personal["number_file_id"]})
        elif base_row is not None:
            files.append({**frozen, "kind": "base", "file_id": base_row["id"], "version": base_row["version"],
                          "sha256": base_row["sha256"]})
    return files, sources


async def _personal_file(db, product: dict, plan: Plan, base_row: dict | None, *, gamertag: str | None,
                         color: str, user_id: str, order_id: str, item_id: str, variant: dict | None = None,
                         position: int = 1, number: str | None = None) -> dict:
    """Die eigene Datei einer Fläche: Grunddatei plus jede Textebene der Bestellung - Gamertag und Vereinsnummer
    (#2150). Je Ebene Farbe und Größe wie im Plan (#2105, #2141): Untergrund aus Hintergrund bzw. Shirtfarbe, die
    Leinwand der Ebene; dazu Schrift und Kontur der Ebene (#2142) - genau wie die Vorschau. Ebenen mit gleichen Regeln
    teilen sich eine Datei."""
    texts = {"gamertag": gamertag, "member_number": number}
    rendered: dict[str, tuple[dict, bytes]] = {}
    first: dict[str, str] = {}
    rules = None
    layers = []
    for item in plan.texts:
        ink = item.ink
        if ink is None:
            rules = rules or await shop_gamertag.load_rules(db)
            ink = shop_gamertag.inks_for_garment(rules, color)[0]["key"]
        key = json.dumps([item.kind, item.spec, ink], sort_keys=True)
        if key not in rendered:
            try:
                stored = await shop_gamertag.store(db, texts[item.kind], purpose="order", color_key=ink,
                                                   user_id=user_id, order_id=order_id, order_item_id=item_id,
                                                   layer=item.spec, kind=RENDER_KINDS[item.kind])
            except shop_gamertag.RenderBusy:
                raise
            except ShopError as exc:
                if item.kind == "gamertag":
                    raise  # den Namen kann die Kundschaft ändern - die Meldung sagt, was nicht passt
                # Die Nummer wählt niemand im Checkout: passt sie nicht in die Ebene, ist das ein Fehler im Aufbau -
                # nicht bestellbar, der Grund (ohne Nummer) im Log und in der Vorab-Prüfung.
                _refuse(position, product, variant, area=plan.entry["placement"],
                        reason=f"member number does not fit: {exc}")
            text_row = stored["row"]
            text_path = shop_designs._path_of(text_row["file_ref"])
            if text_path is None or not text_path.is_file():
                # Nie Gamertag oder Nummer selbst im Log - nur Produkt, Variante, Farbe und Fläche.
                _refuse(position, product, variant, area=plan.entry["placement"],
                        reason=f"{item.kind} file missing on disk")
            rendered[key] = (text_row, text_path.read_bytes())
            first.setdefault(item.kind, text_row["id"])
        left, top, width, height = item.box.rounded()
        layers.append(Layer(png=rendered[key][1], left=left, top=top, width=width, height=height,
                            label=SHORT_LABELS[item.kind]))
    entry = plan.entry
    base_png = None
    if base_row is not None:
        base_path = shop_designs._path_of(base_row["file_ref"])
        base_png = base_path.read_bytes()
    rules_doc = (await templates.load_presets(db))["rules"]
    composed = await asyncio.to_thread(compose_print_file, entry["width_px"], entry["height_px"], entry["dpi"],
                                       layers, base=base_png, safe_margin_px=templates.margin_px(entry, rules_doc))
    row = await _store(db, composed.payload, {
        "origin": "composed", "purpose": "order", "product_id": product["id"], "placement": plan.entry["placement"],
        "printful_placement": plan.entry["placement"], "technique": entry["technique"], "group": entry["group"],
        "color": color, "color_key": _color_key(color), "width_px": composed.width_px,
        "height_px": composed.height_px, "dpi": composed.dpi, "layout_hash": plan.layout_hash,
        "template_hash": plan.template_hash, "base_file_id": (base_row or {}).get("id"),
        "gamertag_file_id": first.get("gamertag"), "number_file_id": first.get("member_number"), "user_id": user_id,
        "order_id": order_id, "order_item_id": item_id, "created_by": None, "file_name": None})
    row["file_name"] = file_name(row)
    return row


def _refuse(position: int, product: dict, variant: dict | None, *, area: str, reason: str):
    """Nicht bestellbar: die Kundschaft liest nur ``NOT_ORDERABLE``; ins Log kommen Produkt, Variante, Farbe, Fläche und
    der Grund - frei gewählte Texte darin (Motivtitel) mit gekürzten Mail-Adressen, in einer Zeile, nie ein Gamertag."""
    logger.warning("[shop-print-files] order refused: product=%s variant=%s color=%s area=%s reason=%s",
                   log_safe((product or {}).get("id")), log_safe((variant or {}).get("id")),
                   log_safe(mask_addresses(str((variant or {}).get("color") or ""))), log_safe(area),
                   log_safe(mask_addresses(reason), 500))
    raise ShopError(f"Position {position}: {NOT_ORDERABLE}")


async def discard_order_files(db, order_id: str) -> int:
    """Eine Bestellung kam nicht zustande (gleichzeitiger Aufruf hat gewonnen, spätere Position nicht bestellbar):
    ihre eigenen Druckdateien wieder weg - Zeile und Datei. Grunddateien bleiben."""
    removed = 0
    rows = await db.shop_print_files.find({"order_id": order_id, "purpose": "order"}, {"_id": 0}).to_list(None)
    for row in rows:
        path = shop_designs._path_of(row.get("file_ref"))
        if path is not None:
            path.unlink(missing_ok=True)
        await db.shop_print_files.delete_one({"id": row["id"]})
        removed += 1
    return removed + await shop_gamertag.discard_order_files(db, order_id)


# ================================================================ Kontolöschung (Bestelldateien zeigen den Namen)

# Aus dem Inhalt ableitbar (#2150): Prüfsumme, Dateigröße und der Name „druck-<prüfsumme>.png“ - wie bei
# ``shop_gamertag.CONTENT_FIELDS`` ließen sich Name bzw. Nummer daraus durch Durchprobieren zurückrechnen.
CONTENT_FIELDS = ("sha256", "size_bytes", "file_name")


async def _take_off_line(db, row: dict, now: str) -> None:
    """Adresse abschalten, Datei löschen; die Zeile bleibt als Nachweis ohne Konto und ohne ``CONTENT_FIELDS`` - auch
    die Prüfsumme an der Bestellposition (``print_files[].sha256``) geht. Nach dem Löschen braucht sie kein Ablauf mehr:
    die Datei ist weg, Printful hat den Auftrag abgeschlossen (sonst stünde die Löschung noch aus)."""
    path = shop_designs._path_of(row.get("file_ref"))
    if path is not None:
        path.unlink(missing_ok=True)
    await db.shop_print_files.update_one(
        {"id": row["id"]}, {"$set": {"public_disabled_at": now, "file_deleted_at": now, "user_id": None},
                            "$unset": {"erase_pending_at": "", **{name: "" for name in CONTENT_FIELDS}}})
    if row.get("order_item_id"):
        item = await db.shop_order_items.find_one({"id": row["order_item_id"]}, {"_id": 0, "print_files": 1})
        files = (item or {}).get("print_files") or []
        if any(entry.get("file_id") == row["id"] for entry in files):
            cleared = [{**entry, "sha256": None} if entry.get("file_id") == row["id"] else entry for entry in files]
            await db.shop_order_items.update_one({"id": row["order_item_id"]}, {"$set": {"print_files": cleared}})


async def erase_for_user(db, user_id: str) -> dict:
    """Kontolöschung: wie ``shop_gamertag.erase_for_user`` - die Bestelldateien des Kontos verlieren die Verknüpfung;
    braucht kein offener Printful-Auftrag sie, sind Adresse und Datei sofort weg, sonst nach dem Abschluss
    (``complete_pending_erasures``, Job ``ops_retention``)."""
    now = now_utc().isoformat()
    removed = pending = 0
    rows = await db.shop_print_files.find({"user_id": user_id, "purpose": "order"}, {"_id": 0}).to_list(None)
    for row in rows:
        if await shop_gamertag._needed_for_production(db, row):
            await db.shop_print_files.update_one({"id": row["id"]}, {"$set": {"erase_pending_at": now, "user_id": None}})
            pending += 1
        else:
            await _take_off_line(db, row, now)
            removed += 1
    return {"removed": removed, "pending": pending}


async def complete_pending_erasures(db) -> int:
    now = now_utc().isoformat()
    done = 0
    rows = await db.shop_print_files.find({"erase_pending_at": {"$exists": True}}, {"_id": 0}).to_list(None)
    for row in rows:
        if not await shop_gamertag._needed_for_production(db, row):
            await _take_off_line(db, row, now)
            done += 1
    return done


# ================================================================ Vorschau im Admin

PREVIEW_WIDTH = 900
PREVIEW_MAX_PIXELS = 30_000_000  # so groß darf ein Vorlagenbild höchstens sein (shop_print_templates)
SAMPLE_NAME = "GAMERTAG"
SAMPLE_NUMBER = "99"  # Rückfall - sonst die höchste Wunschnummer aus den Einstellungen (``sample_number``)
SAMPLES = {"gamertag": SAMPLE_NAME, "member_number": SAMPLE_NUMBER}


async def sample_number(db) -> str:
    """Die Beispielnummer der Vorschau (#2142): die höchste Wunschnummer (#2034, Einstellung „bis“, Vorgabe 99) - so
    breit wird die breiteste Nummer. Nur gelesen."""
    from services import jersey_numbers

    highest = (await jersey_numbers.load_settings(db)).get("max")
    limit = 10 ** shop_gamertag.MAX_NUMBER_DIGITS
    if isinstance(highest, int) and not isinstance(highest, bool) and 0 <= highest < limit:
        return str(highest)
    return SAMPLE_NUMBER


async def _sample_text(db, kind: str) -> str:
    return await sample_number(db) if kind == "member_number" else SAMPLES[kind]


async def sample_png(db, product: dict, *, kind: str, color: str, layer: dict | None, ink: str | None = None,
                     text: str | None = None, bounds: dict | None = None) -> bytes:
    """Der Beispielname einer Namensebene in echter Größe (#2105) - gerendert wie die Druckdatei
    (``shop_gamertag.render`` mit den Regeln der Ebene), als PNG der ganzen Leinwand. Die Vorschau in Schritt 3 legt es
    in den Rahmen der Ebene; die Leinwand bleibt dort nur ein feiner Rahmen. Farbe des Namens wie bei der Bestellung:
    ``ink`` ist die Farbe aus dem Plan (Untergrund aus dem Hintergrund, #2141), ohne Angabe nach der Shirtfarbe. Eine
    Nummer zeigt die Beispielnummer, ein fester Text (#2142) seinen ``text`` - mit Schrift und Kontur der Ebene, in
    Vorschau-Auflösung (``shop_gamertag.preview_rules``; die Maße in Zoll sind dieselben). ``bounds``: die Grenze der
    Fläche wie beim Speichern (``shop_products.text_bounds_for``)."""
    if kind not in RENDER_KINDS:
        raise LookupError("Diese Ebene hat keinen Text.")
    if color not in ((product.get("offer") or {}).get("colors") or []):
        raise LookupError("Diese Farbe wird nicht angeboten.")
    rules = shop_gamertag.layer_rules(await shop_gamertag.load_rules(db), layer, bounds=bounds)
    if ink is not None and ink not in {item["key"] for item in rules["colors"]}:
        raise LookupError("Diese Farbe für den Namen gibt es nicht.")
    ink = ink or shop_gamertag.inks_for_garment(rules, color)[0]["key"]
    shown = text if kind == "text" else await _sample_text(db, kind)
    # Die Leinwand in Druckgröße darf nicht zu groß sein - dieselbe Grenze wie bei der Datei; gerendert wird kleiner.
    too_big = shop_gamertag.canvas_problem(rules, RENDER_KINDS[kind])
    if too_big:
        raise ShopError(too_big)
    rendered = await shop_gamertag.render_async(shown, shop_gamertag.preview_rules(rules), color_key=ink,
                                                kind=RENDER_KINDS[kind], wait=shop_gamertag.RENDER_WAIT_SECONDS)
    return rendered.payload


def _hex_rgb(value: str | None) -> tuple[int, int, int]:
    text = str(value or "").lstrip("#")
    if re.fullmatch(r"[0-9A-Fa-f]{6}", text):
        return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)
    return 128, 128, 128


async def preview_png(db, product: dict, *, placement: str, color: str, sample: bool = True,
                      width: int = PREVIEW_WIDTH) -> bytes:
    """Die Druckdatei über dem Printful-Vorlagenbild (Sicherheitslinien) und auf der Shirtfarbe - für jede angebotene
    Farbe. Mit ``sample`` steht im Platzhalter ein Beispielname. Nichts wird abgelegt."""
    context = await _context(db, product)
    if color not in context["colors"]:
        raise LookupError("Diese Farbe wird nicht angeboten.")
    row = next((item for item in context["rows"] if item["key"] == placement), None)
    variant_ids = context["variants"].get(color) or []
    entry = templates.entry_for_variant(context["template"], context["technique"], placement,
                                        variant_ids[0] if variant_ids else None)
    if row is None or entry is None:
        raise LookupError("Diese Fläche gibt es beim Produkt nicht.")
    plan = await _plan(db, context, row, entry, color)
    shirt = _hex_rgb(context["codes"].get(color))
    # Die Vorlage dieser Farbe (#2105); nicht farbspezifisch: eingefärbt mit dem Farbcode aus den Printful-Daten.
    preview, specific = templates.preview_for_color(context["template"], entry,
                                                    shop_colors.variant_ids_by_color(product).get(color) or ())
    tint = None if specific else shop_colors.code_of(product, color)
    template_img = await templates.template_image_rgba(db, context["template"], preview, tint=tint) if preview else None
    if template_img is not None and template_img.size != (preview["template_width"], preview["template_height"]):
        # Eingefärbt wird höchstens in TINT_MAX_SIDE - zurück auf die Größe, in der die Lage des Druckbereichs zählt.
        template_img = template_img.resize((preview["template_width"], preview["template_height"]),
                                           Image.Resampling.LANCZOS)
    # Gleich im Maßstab der Vorschau zeichnen - nie die volle Druckdatei im Speicher (die kann 80 Millionen Pixel haben).
    if preview and template_img is not None:
        target_w, target_h = max(1, preview["area"]["width"]), max(1, preview["area"]["height"])
    else:
        scale = min(1.0, width / entry["width_px"])
        target_w, target_h = max(1, round(entry["width_px"] * scale)), max(1, round(entry["height_px"] * scale))
    scale_x, scale_y = target_w / entry["width_px"], target_h / entry["height_px"]
    if target_w * target_h > PREVIEW_MAX_PIXELS:
        raise ShopError("Das Vorlagenbild ist für eine Vorschau zu groß.")

    def scaled_box(box: templates.Box) -> tuple[int, int, int, int]:
        left, top = int(round(box.left * scale_x)), int(round(box.top * scale_y))
        return (left, top, max(1, int(round(box.right * scale_x)) - left),
                max(1, int(round(box.bottom * scale_y)) - top))

    print_img = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    if plan.mode == "upload" and plan.background_ok:
        # Die fertige Datei als Hintergrund (#2141) - aus dem Vorschaubild (höchstens 1200 px, nie die volle Datei),
        # darüber die Ebenen wie im Modus „Motiv und Position“. Dekodiert außerhalb der Ereignisschleife.
        thumb = await thumb_bytes(db, plan.background)
        if thumb is not None:
            def scaled() -> Image.Image:
                with Image.open(BytesIO(thumb)) as img:
                    img.load()
                    return img.convert("RGBA").resize((target_w, target_h), Image.Resampling.LANCZOS)

            print_img = await asyncio.to_thread(scaled)
    gamertag_rules = context["gamertag_rules"]

    def put_text(png: bytes, box: templates.Box) -> None:
        with Image.open(BytesIO(png)) as img:
            img.load()
            tag = img.convert("RGBA")
        left, top, box_w, box_h = scaled_box(box)
        if 0 <= left and 0 <= top and left + box_w <= target_w and top + box_h <= target_h:
            print_img.alpha_composite(tag.resize((box_w, box_h), Image.Resampling.LANCZOS), (left, top))

    if plan.base_layers and not plan.problems:
        for item in plan.base_layers:
            if item.kind != "motif":
                # Fester Text (#2142) wie in der Grunddatei.
                try:
                    put_text(await text_png(item, gamertag_rules, preview=True), item.box)
                except ShopError:
                    pass
                continue
            left, top, box_w, box_h = scaled_box(item.box)
            try:
                png = await _motif_png(db, item.source, width_px=box_w, dpi=entry["dpi"])
            except ShopError:
                continue
            with Image.open(BytesIO(png)) as img:
                img.load()
                part = img.convert("RGBA")
            if part.size != (box_w, box_h):
                part = part.resize((box_w, box_h), Image.Resampling.LANCZOS)
            print_img.alpha_composite(part, (max(0, left), max(0, top)))
    if sample and plan.texts:
        for item in plan.texts:
            # Der Beispielname wie in der Druckdatei: dieselben Regeln der Ebene (#2105, Schrift und Kontur #2142),
            # dieselbe Leinwand, dieselbe Farbe aus dem Untergrund (#2141).
            ink = item.ink or shop_gamertag.inks_for_garment(gamertag_rules, color)[0]["key"]
            try:
                shown = await _sample_text(db, item.kind)
                put_text(await text_png(replace(item, ink=ink), gamertag_rules, shown, preview=True), item.box)
            except ShopError:
                continue
    if preview and template_img is not None:
        canvas = Image.new("RGBA", template_img.size, (*shirt, 255))
        area = preview["area"]
        if preview["positioning"] == "background":
            canvas.alpha_composite(template_img)
            canvas.alpha_composite(print_img, (area["left"], area["top"]))
        else:
            canvas.alpha_composite(print_img, (area["left"], area["top"]))
            canvas.alpha_composite(template_img)
    else:
        canvas = Image.new("RGBA", print_img.size, (*shirt, 255))
        canvas.alpha_composite(print_img)
    if canvas.width > width:
        canvas = canvas.resize((width, max(1, int(round(canvas.height * width / canvas.width)))),
                               Image.Resampling.LANCZOS)
    out = BytesIO()
    canvas.convert("RGB").save(out, format="PNG", compress_level=6)
    return out.getvalue()


async def admin_file(db, product_id: str, file_id: str):
    """Pfad einer Grunddatei für die Finanzen (Ansehen, Herunterladen) - Bestelldateien mit Namen nicht."""
    row = await db.shop_print_files.find_one({"id": file_id, "product_id": product_id, "purpose": "base"}, {"_id": 0})
    path = shop_designs._path_of((row or {}).get("file_ref"))
    if row is None or path is None or not path.is_file():
        raise LookupError("Diese Druckdatei gibt es nicht.")
    return path, file_name(row)


THUMB_SIDE = 1200


def _thumb_png(image: Image.Image) -> bytes:
    """Das Vorschaubild einer Druckdatei: höchstens ``THUMB_SIDE`` px, transparent, ohne Metadaten. Deterministisch."""
    part = image.convert("RGBA")
    part.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.Resampling.LANCZOS)
    out = BytesIO()
    part.save(out, format="PNG", compress_level=6)
    return out.getvalue()


def _thumb_of(path) -> bytes:
    with Image.open(path) as img:
        img.load()
        return _thumb_png(img)


async def thumb_bytes(db, row: dict) -> bytes | None:
    """Das Vorschaubild einer Grunddatei (#2141): beim Hochladen gespeichert (``thumb_ref``); fehlt es (ältere Datei,
    erzeugte Grunddatei), wird es einmal gerechnet und nachgetragen - je Prüfsumme gesperrt, nie doppelt."""
    path = shop_designs._path_of(row.get("thumb_ref"))
    if path is not None and path.is_file():
        return await asyncio.to_thread(path.read_bytes)
    async with _row_lock(f"thumb:{row['sha256']}"):
        stored = await db.shop_print_files.find_one({"id": row["id"]}, {"_id": 0, "thumb_ref": 1})
        path = shop_designs._path_of((stored or {}).get("thumb_ref"))
        if path is not None and path.is_file():
            return await asyncio.to_thread(path.read_bytes)
        source = shop_designs._path_of(row.get("file_ref"))
        if source is None or not source.is_file():
            return None
        payload = await asyncio.to_thread(_thumb_of, source)
        thumb_ref, thumb_path = shop_designs._store(payload)
        try:
            await db.shop_print_files.update_one({"id": row["id"]}, {"$set": {"thumb_ref": thumb_ref}})
        except BaseException:
            thumb_path.unlink(missing_ok=True)
            raise
        return payload


async def admin_thumb(db, product_id: str, file_id: str) -> bytes:
    """Eine Grunddatei verkleinert (höchstens ``THUMB_SIDE`` px) - für die Vorschau des Hintergrunds in Schritt 3
    (#2141). Bestelldateien mit Namen nie."""
    row = await db.shop_print_files.find_one({"id": file_id, "product_id": product_id, "purpose": "base"}, {"_id": 0})
    payload = await thumb_bytes(db, row) if row else None
    if payload is None:
        raise LookupError("Diese Druckdatei gibt es nicht.")
    return payload


# ================================================================ Umstellung alter Produkte (Trockenlauf und Rückweg)

async def migration_plan(db) -> list[dict]:
    """Welche Produkte noch feste Zoll-Positionen (#1707) haben und was daraus würde. Schreibt nichts."""
    presets_doc = await templates.load_presets(db)
    gamertag_rules = await shop_gamertag.load_rules(db)
    out = []
    async for product in db.shop_products.find({"placements.0": {"$exists": True}}, {"_id": 0}):
        if all(is_layout(row) for row in product.get("placements") or []):
            continue
        template = await templates.get(db, (product.get("printful") or {}).get("product_id"))
        if not template or not template.get("entries"):
            out.append({"id": product["id"], "slug": product.get("slug"), "title": product.get("title"),
                        "ready": False, "rows": [],
                        "notes": ["Keine Druckvorlage von Printful gespeichert - erst „Mit Printful abgleichen“."]})
            continue
        rows, notes, blocked = await conversion(db, product, template, presets_doc, gamertag_rules)
        if blocked:
            notes = [*blocked, *notes, "Umstellung angehalten - die alten Platzierungen bleiben unverändert, bis die "
                                       "Flächen bei Printful passen oder Schritt 3 neu gespeichert wird."]
        out.append({"id": product["id"], "slug": product.get("slug"), "title": product.get("title"),
                    "ready": not blocked, "rows": rows, "notes": notes, "blocked": blocked})
    return out


async def migrate(db, *, apply: bool = False, actor_id: str = "system:shop-print-layout") -> list[dict]:
    """Die Umstellung: ohne ``apply`` nur der Bericht. Mit ``apply`` werden die Ebenen gespeichert und die alten
    Platzierungen als ``placements_legacy`` aufbewahrt (Rückweg). Der Stand eines Produkts bleibt; seine Druckdateien
    entstehen danach mit „Druckdateien erzeugen“."""
    report = await migration_plan(db)
    if not apply:
        return report
    for item in report:
        if not item["ready"]:
            continue
        async with shop_catalog.product_lock(db, item["id"]):
            product = await shop_catalog.get_product(db, item["id"])
            if not product or all(is_layout(row) for row in product.get("placements") or []):
                continue
            await shop_catalog.save_setup(db, product, {"placements": item["rows"],
                                                        "placements_legacy": product.get("placements")},
                                          actor_id=actor_id)
            await record_admin_action(db, "shop.product.layout", actor_id=actor_id, target_id=item["id"],
                                      reason="Umstellung auf Druckvorlagen (#2069)",
                                      data={"migration": "apply", "notes": item["notes"]})
        item["applied"] = True
        # Gleich die Druckdateien - ein veröffentlichtes Produkt bleibt so bestellbar. Was nicht geht, steht im Bericht.
        try:
            result = await generate(db, item["id"], actor_id=actor_id, reason="Umstellung auf Druckvorlagen (#2069)")
        except ShopError as exc:
            item["notes"].append(f"Druckdateien: {exc}")
        else:
            item["notes"].append(f"Druckdateien: {len(result['created'])} erzeugt, {result['unchanged']} aktuell"
                                 + (f", {len(result['failed'])} nicht möglich: "
                                    + "; ".join(row["detail"] for row in result["failed"][:3])
                                    if result["failed"] else "") + ".")
    return report


async def rollback_migration(db, *, apply: bool = False, actor_id: str = "system:shop-print-layout") -> list[dict]:
    """Rückweg: Produkte mit aufbewahrten alten Platzierungen bekommen sie zurück. Ohne ``apply`` nur der Bericht."""
    out = []
    async for product in db.shop_products.find({"placements_legacy": {"$ne": None, "$exists": True}}, {"_id": 0}):
        entry = {"id": product["id"], "slug": product.get("slug"), "title": product.get("title"),
                 "placements": len(product.get("placements_legacy") or [])}
        if apply:
            async with shop_catalog.product_lock(db, product["id"]):
                current = await shop_catalog.get_product(db, product["id"])
                await shop_catalog.save_setup(db, current, {"placements": current.get("placements_legacy"),
                                                            "placements_legacy": None}, actor_id=actor_id)
                await record_admin_action(db, "shop.product.layout", actor_id=actor_id, target_id=product["id"],
                                          reason="Rückweg der Umstellung (#2069)", data={"migration": "rollback"})
            entry["applied"] = True
        out.append(entry)
    return out
