"""Druckdateien aus Vorlage, Motiv und Position (#2069) - die Website erzeugt sie selbst, exakt passend zu Printful.

Der Obmann wählt je Platzierung Motiv, Vorgabe-Position und Größe in cm; dieses Modul baut daraus genau ein
transparentes PNG in der Pixelgröße der Printful-Vorlage (``shop_print_templates``). Ohne eigenes Grafikprogramm.

- **Aufbau je Produkt** (``product.placements``, neu seit #2069): je Printful-Platzierung eine Zeile mit Ebenen
  (``layers``): Motive (``kind = "motif"``: Vorgabe, Breite in cm, Feinjustierung) und Platzhalter für den Gamertag
  bzw. die Vereinsnummer (``gamertag``, ``member_number``), deren Datei erst je Bestellung entsteht. ``mode = "upload"``
  heißt: für diese Fläche lädt ein Profi eine fertige Druckdatei hoch (``upload``), exakt gegen die Vorlage geprüft.
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
  Fläche, Farbe (und Varianten-Gruppe) mit Versionen; Bestelldateien (``order``) je Bestellposition mit Gamertag -
  personenbezogen wie in ``shop_gamertag`` (das PNG zeigt den Namen).
- **Motive**: der Zugriff steht an genau einer Stelle (``_motif_source``/``_motif_png``, Abschnitt „Motive“). Bis die
  Motiv-Bibliothek aus #2069 Teil A da ist, rastert sie die Design-Fassungen aus ``shop_designs``.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import secrets
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any, Sequence

from PIL import Image
from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import shop_catalog, shop_designs, shop_gamertag, shop_motifs, shop_print_templates as templates
from services.log_safe import log_safe, mask_addresses
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.shop_common import ShopConflict, ShopError, clean_reason, record_admin_action

logger = logging.getLogger("tls-arena.shop-print-files")

RENDERER_VERSION = 1  # ändert sich, wenn der Generator andere Pixel liefert - dann gelten erzeugte Dateien nicht mehr
NOT_ORDERABLE = "Dieses Produkt ist gerade nicht bestellbar."
LAYER_KINDS = {"motif": "Motiv", "gamertag": "Gamertag (Datei je Bestellung)",
               "member_number": "Vereinsnummer (Datei je Bestellung, #1727)"}
TEXT_KINDS = ("gamertag", "member_number")
MODES = {"layout": "Motiv und Position", "upload": "Fertige Druckdatei (für Profis)"}
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


async def _motif_source(db, motif: dict, color: str, color_hex: str | None) -> MotifSource | None:
    """Das Motiv einer Ebene für eine Shirtfarbe (Fassung hell oder dunkel samt Version) - oder ``None``, wenn es
    dafür keine Fassung gibt (etwa ein PNG, das sich nicht für helle Shirts umfärben ließ)."""
    key = _design_key_for(motif or {}, color)
    row = await shop_motifs.file_for_garment(db, key, color=color, color_hex=color_hex) if key else None
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
                width, height = text_canvas_px(entry, gamertag_rules)
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


# ================================================================ Plan je Fläche und Farbe

@dataclass
class Planned:
    index: int
    kind: str
    label: str
    box: templates.Box
    source: MotifSource | None = None


@dataclass
class Plan:
    entry: dict
    color: str
    layers: list[Planned]
    problems: list[str]
    layout_hash: str
    template_hash: str
    mode: str = "layout"

    @property
    def motifs(self) -> list[Planned]:
        return [layer for layer in self.layers if layer.kind == "motif"]

    @property
    def texts(self) -> list[Planned]:
        return [layer for layer in self.layers if layer.kind in TEXT_KINDS]

    @property
    def needs_base(self) -> bool:
        return self.mode == "upload" or bool(self.motifs)


def text_canvas_px(entry: dict, gamertag_rules: dict) -> tuple[float, float]:
    """Die Leinwand der Gamertag-Datei (für jeden Namen gleich groß) in Pixeln dieser Fläche."""
    width, height = shop_gamertag.canvas(gamertag_rules)
    scale = entry["dpi"] / gamertag_rules["dpi"]
    return width * scale, height * scale


async def plan_placement(db, row: dict, entry: dict, *, color: str, color_hex: str | None, presets_doc: dict,
                         gamertag_rules: dict) -> Plan:
    """Eine Fläche für eine Shirtfarbe: Vorgaben umgerechnet, Rahmen geprüft, Prüfsumme des Aufbaus."""
    by_key = {item["key"]: item for item in presets_doc["presets"]}
    rules = presets_doc["rules"]
    planned: list[Planned] = []
    found: list[str] = []
    mode = row.get("mode") or "layout"
    layers = list(enumerate(row.get("layers") or []))
    for index, layer in sorted(layers, key=lambda item: item[1].get("kind") != "motif"):
        kind = layer.get("kind")
        if mode == "upload" and kind == "motif":
            continue
        preset = by_key.get(layer.get("preset"))
        if preset is None:
            found.append(f"{entry['label']}: die Vorgabe „{layer.get('preset')}“ gibt es nicht mehr - bitte neu wählen.")
            continue
        offsets = {"offset_x_cm": float(layer.get("offset_x_cm") or 0.0),
                   "offset_y_cm": float(layer.get("offset_y_cm") or 0.0)}
        if kind == "motif":
            source = await _motif_source(db, layer.get("motif") or {}, color, color_hex)
            if source is None:
                found.append(f"{entry['label']}: für „{color}“ fehlt das Motiv.")
                continue
            box = templates.place_motif(entry, preset, width_cm=float(layer.get("width_cm") or preset.get("width_cm")
                                                                       or 5.0),
                                        aspect=source.aspect, rules=rules, **offsets)
            label = f"Motiv „{source.title}“ ({preset['label']})"
            planned.append(Planned(index, "motif", label, box, source))
        else:
            width, height = text_canvas_px(entry, gamertag_rules)
            follow = next((item.box for item in planned if item.kind == "motif"), None)
            try:
                box = templates.place_text(entry, preset, width_px=width, height_px=height, follow=follow,
                                           rules=rules, **offsets)
            except ShopError as exc:
                found.append(f"{entry['label']}: {exc}")
                continue
            label = f"{'Gamertag' if kind == 'gamertag' else 'Vereinsnummer'} ({preset['label']})"
            planned.append(Planned(index, kind, label, box))
        found += templates.problems(entry, box, label, rules)
    template_hash = templates.entry_hash(entry)
    payload = {"renderer": RENDERER_VERSION, "template": template_hash, "mode": mode,
               "motifs": [{"box": item.box.rounded(), "ref": item.source.ref} for item in planned
                          if item.kind == "motif"]}
    layout_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    planned.sort(key=lambda item: item.index)
    return Plan(entry=entry, color=color, layers=planned, problems=found, layout_hash=layout_hash,
                template_hash=template_hash, mode=mode)


def plan_view(plan: Plan) -> dict:
    dpi = plan.entry["dpi"]
    return {"placement": plan.entry["placement"], "group": plan.entry["group"], "color": plan.color,
            "problems": plan.problems, "layout_hash": plan.layout_hash,
            "layers": [{"index": item.index, "kind": item.kind, "label": item.label, **item.box.as_dict(dpi),
                        "source": item.source.ref if item.source else None,
                        # das Bild genau der Fassung, die gedruckt wird - für die Vorschau in Schritt 3
                        "image_path": item.source.image_path if item.source else None,
                        "aspect": round(item.source.aspect, 6) if item.source else None} for item in plan.layers]}


# ================================================================ Ablage der Druckdateien

def file_name(row: dict) -> str:
    """Name unter der öffentlichen Adresse: Grunddatei mit Fläche, Farbe und Version (Printful lädt eine neue Version
    nicht aus dem Zwischenspeicher), Bestelldatei nur mit dem Anfang der Prüfsumme - nie ein Name."""
    return row.get("file_name") or f"druck-{row['sha256'][:16]}.png"


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


async def latest_base(db, product_id: str, placement: str, group: str, color: str) -> dict | None:
    rows = await db.shop_print_files.find(
        {"product_id": product_id, "placement": placement, "group": group, "color_key": _color_key(color),
         "purpose": "base"}, {"_id": 0}).sort("version", -1).to_list(1)
    return rows[0] if rows else None


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
            "codes": codes, "variants": variants, "technique": technique}


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
                plan = await plan_placement(db, row, entry, color=color, color_hex=context["codes"].get(color),
                                            presets_doc=context["presets"], gamertag_rules=context["gamertag_rules"])
                out.append((row, plan, color, ids or []))
    return out, context


def _upload_valid(row: dict | None, plan: Plan) -> bool:
    return bool(row and row.get("origin") == "upload" and row.get("template_hash") == plan.template_hash
                and file_exists(row))


def _base_valid(row: dict | None, plan: Plan) -> bool:
    if plan.mode == "upload":
        return _upload_valid(row, plan)
    return bool(row and row.get("layout_hash") == plan.layout_hash and file_exists(row))


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
                        "detail": f"Die Fläche {row['key']} hat bei Printful keine Druckvorgabe (mehr).", "file": None,
                        "plan": None})
            continue
        latest = await latest_base(db, product["id"], row["key"], plan.entry["group"], color)
        state, detail = "ok", ""
        if plan.problems:
            state, detail = "invalid", " ".join(plan.problems)
        elif not plan.needs_base:
            state, detail = "not_needed", "Nur Platzhalter - die Datei entsteht je Bestellung."
        elif _base_valid(latest, plan):
            state = "ok"
        elif latest is None or (plan.mode == "upload" and latest.get("origin") != "upload"):
            state, detail = "missing", ("Noch keine fertige Druckdatei hochgeladen." if plan.mode == "upload"
                                        else "Noch nicht erzeugt.")
        else:
            state, detail = "outdated", ("Vorlage von Printful geändert - neu hochladen." if plan.mode == "upload"
                                         else "Aufbau, Motiv oder Vorlage geändert - neu erzeugen.")
        out.append({**base, "group": plan.entry["group"], "state": state, "detail": detail,
                    "file": file_view(latest), "plan": plan_view(plan)})
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


async def _render_base(db, plan: Plan, rules: dict) -> Composed:
    entry = plan.entry
    layers = []
    for item in plan.motifs:
        left, top, width, height = item.box.rounded()
        png = await _motif_png(db, item.source, width_px=width, dpi=entry["dpi"])
        layers.append(Layer(png=png, left=left, top=top, width=width, height=height, label=item.source.title,
                            native_width_px=None if item.source.vector else item.source.width_px))
    return await asyncio.to_thread(
        compose_print_file, entry["width_px"], entry["height_px"], entry["dpi"], layers,
        min_dpi_ratio=rules["min_dpi_ratio"], warn_dpi_ratio=rules["warn_dpi_ratio"],
        safe_margin_px=templates.margin_px(entry, rules))


async def _generate(db, product: dict, *, actor_id: str, reason: str) -> dict:
    plans, context = await plans_for(db, product)
    if not context["template"] or not (context["template"].get("entries")):
        raise ShopError("Erst die Druckvorlagen von Printful laden (Schritt 1 oder „Mit Printful abgleichen“).")
    rules = context["presets"]["rules"]
    created, failed, unchanged = [], [], 0
    for row, plan, color, ids in plans:
        if plan is None or plan.mode == "upload" or not plan.motifs:
            continue
        name = f"{plan.entry['label']} / {color}"
        if plan.problems:
            failed.append({"placement": row["key"], "color": color, "detail": " ".join(plan.problems)})
            continue
        latest = await latest_base(db, product["id"], row["key"], plan.entry["group"], color)
        if _base_valid(latest, plan):
            unchanged += 1
            continue
        try:
            composed = await _render_base(db, plan, rules)
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
            "sources": [item.source.ref for item in plan.motifs], "warnings": list(composed.warnings),
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
    plan = await plan_placement(db, row, entry, color=color, color_hex=context["codes"].get(color),
                                presets_doc=context["presets"], gamertag_rules=context["gamertag_rules"])
    latest = await latest_base(db, product_id, placement, entry["group"], color)
    if latest and latest.get("sha256") == hashlib.sha256(payload).hexdigest():
        raise ShopConflict(f"Diese Datei ist schon die aktuelle Version (v{latest['version']}).")
    stored = await _store_base(db, payload, {
        "origin": "upload", "product_id": product_id, "slug": product.get("slug") or "produkt",
        "placement": placement, "printful_placement": placement, "technique": entry["technique"],
        "group": entry["group"], "variant_ids": ids or [], "color": color, "color_key": _color_key(color),
        "width_px": want_w, "height_px": want_h, "dpi": dpi, "layout_hash": "upload",
        "template_hash": plan.template_hash, "sources": [{"source": "upload", "format": source_format}],
        "warnings": notes, "created_by": actor_id})
    await record_admin_action(db, "shop.print_file.add", actor_id=actor_id, target_id=product_id, reason=reason,
                              data={"created": [{"placement": placement, "color": color, "version": stored["version"],
                                                 "sha256": stored["sha256"]}], "origin": "upload"})
    return {**file_view(stored), "notes": notes}


def measure_pair(width_px: int, height_px: int, dpi: int) -> str:
    return (f"{width_px} × {height_px} px = {templates.cm(templates.px_to_cm(width_px, dpi))} × "
            f"{templates.cm(templates.px_to_cm(height_px, dpi))}")


# ================================================================ Bestellung: Dateien je Position einfrieren

async def freeze_line(db, product: dict, variant: dict, *, gamertag: str | None, position: int, user_id: str,
                      order_id: str, item_id: str, printful_variant_id: int | None) -> tuple[list[dict], list[dict]]:
    """Was eine Bestellposition an Druckdateien einfriert - je Fläche genau eine Datei:

    - ohne Namen die geltende Grunddatei (Fassung mit Prüfsumme), die zum Aufbau und zur Vorlage passen muss;
    - mit Gamertag eine **eigene** Datei für genau diese Position: Grunddatei plus Gamertag am Anker
      (``shop_gamertag.store`` legt den Namen als Bestelldatei ab). Personenbezogen: Konto, Bestellung, Position.

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
        plan = await plan_placement(db, row, entry, color=color, color_hex=color_hex, presets_doc=context["presets"],
                                    gamertag_rules=context["gamertag_rules"])
        if plan.problems:
            _refuse(position, product, variant, area=row["key"], reason="layout does not fit: " + " ".join(plan.problems))
        base_row = None
        if plan.needs_base:
            base_row = await latest_base(db, product["id"], row["key"], entry["group"], color)
            if not _base_valid(base_row, plan):
                _refuse(position, product, variant, area=row["key"],
                        reason="print file missing" if base_row is None else "print file outdated or not on disk")
            sources += [{"placement": row["key"], **item.source.ref} for item in plan.motifs]
        gamertag_layers = [item for item in plan.texts if item.kind == "gamertag"]
        if gamertag_layers and not gamertag:
            raise ShopError(f"Position {position}: für dieses Produkt fehlt der Gamertag.")
        frozen = {"placement": row["key"], "printful_placement": row["key"], "technique": entry["technique"],
                  "group": entry["group"], "width_px": entry["width_px"], "height_px": entry["height_px"],
                  "dpi": entry["dpi"]}
        if gamertag_layers:
            personal = await _personal_file(db, product, plan, base_row, gamertag=gamertag, color=color,
                                            user_id=user_id, order_id=order_id, item_id=item_id,
                                            variant=variant, position=position)
            files.append({**frozen, "kind": "personal", "file_id": personal["id"], "version": None,
                          "sha256": personal["sha256"], "gamertag_file_id": personal["gamertag_file_id"]})
        elif base_row is not None:
            files.append({**frozen, "kind": "base", "file_id": base_row["id"], "version": base_row["version"],
                          "sha256": base_row["sha256"]})
        # Vereinsnummer (#1727): Platzhalter - die Datei kommt mit der Nummer; bis dahin geht nur die Grunddatei.
    return files, sources


async def _personal_file(db, product: dict, plan: Plan, base_row: dict | None, *, gamertag: str, color: str,
                         user_id: str, order_id: str, item_id: str, variant: dict | None = None,
                         position: int = 1) -> dict:
    rules = await shop_gamertag.load_rules(db)
    ink = shop_gamertag.inks_for_garment(rules, color)[0]["key"]
    stored = await shop_gamertag.store(db, gamertag, purpose="order", color_key=ink, user_id=user_id,
                                       order_id=order_id, order_item_id=item_id)
    tag_row = stored["row"]
    tag_path = shop_designs._path_of(tag_row["file_ref"])
    if tag_path is None or not tag_path.is_file():
        # Nie der Gamertag selbst im Log - nur Produkt, Variante, Farbe und Fläche.
        _refuse(position, product, variant, area=plan.entry["placement"], reason="gamertag file missing on disk")
    tag_png = tag_path.read_bytes()
    entry = plan.entry
    layers = []
    for item in plan.texts:
        if item.kind != "gamertag":
            continue
        left, top, width, height = item.box.rounded()
        layers.append(Layer(png=tag_png, left=left, top=top, width=width, height=height, label="Gamertag"))
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
        "gamertag_file_id": tag_row["id"], "user_id": user_id, "order_id": order_id, "order_item_id": item_id,
        "created_by": None, "file_name": None})
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

async def _take_off_line(db, row: dict, now: str) -> None:
    path = shop_designs._path_of(row.get("file_ref"))
    if path is not None:
        path.unlink(missing_ok=True)
    await db.shop_print_files.update_one(
        {"id": row["id"]}, {"$set": {"public_disabled_at": now, "file_deleted_at": now, "user_id": None},
                            "$unset": {"erase_pending_at": ""}})


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
    plan = await plan_placement(db, row, entry, color=color, color_hex=context["codes"].get(color),
                                presets_doc=context["presets"], gamertag_rules=context["gamertag_rules"])
    shirt = _hex_rgb(context["codes"].get(color))
    preview = templates.preview_for(context["template"], entry)
    template_img = await templates.template_image_rgba(db, context["template"], preview) if preview else None
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
    latest = await latest_base(db, product["id"], placement, entry["group"], color) if plan.mode == "upload" else None
    if latest and _base_valid(latest, plan):
        with Image.open(shop_designs._path_of(latest["file_ref"])) as img:  # fertige Datei: höchstens 80 MP (Prüfung)
            img.draft("RGBA", (target_w, target_h))
            print_img = img.convert("RGBA").resize((target_w, target_h), Image.Resampling.LANCZOS)
    elif plan.motifs and not plan.problems:
        for item in plan.motifs:
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
        gamertag_rules = context["gamertag_rules"]
        ink = shop_gamertag.inks_for_garment(gamertag_rules, color)[0]["key"]
        try:
            name = shop_gamertag.render(SAMPLE_NAME, gamertag_rules, color_key=ink)
            with Image.open(BytesIO(name.payload)) as img:
                img.load()
                tag = img.convert("RGBA")
            for item in plan.texts:
                left, top, box_w, box_h = scaled_box(item.box)
                if 0 <= left and 0 <= top and left + box_w <= target_w and top + box_h <= target_h:
                    print_img.alpha_composite(tag.resize((box_w, box_h), Image.Resampling.LANCZOS), (left, top))
        except ShopError:
            pass
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
