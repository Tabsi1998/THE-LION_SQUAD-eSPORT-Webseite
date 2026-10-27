"""Druckvorlagen je Produkt direkt von Printful (#2069): exakte Druckdatei-Größen, Vorlagenbilder, Positions-Vorgaben.

Eine Printful-Druckdatei ist **immer die ganze Fläche einer Platzierung** in exakter Pixelgröße - das Motiv liegt darin,
der Rest ist transparent. Dieses Modul liefert die Maße dafür und rechnet Positionen auf jede Fläche um; die Datei selbst
baut ``services/shop_print_files.py``.

1. **Vorlagen aus der API** (``refresh``): je Printful-Produkt die Druckvorgaben aus
   ``GET /v2/catalog-products/{id}/mockup-styles`` (Druckbereich in Zoll und DPI je Platzierung und Technik - daraus
   ``round(Zoll × DPI)`` Pixel) und die Vorlagenbilder aus ``GET /v2/catalog-products/{id}/mockup-templates`` (Bild mit
   Sicherheitslinien, Lage des Druckbereichs darin). Gilt eine Vorgabe nur für bestimmte Varianten (Tassen- oder
   Tuchgröße), entsteht eine eigene Gruppe mit eigener Dateigröße. Gespeichert in ``shop_print_templates``; jeder
   Abgleich (Schritt 1 und ``shop_catalog_sync``) holt sie neu und meldet Abweichungen (``changes``, Protokoll
   ``shop.print_template.change``). Die Prüfsumme (``hash``) deckt nur die Maße ab - an ihr hängen die erzeugten Dateien.
2. **Vorlagenbilder über die Website** (``template_image``): nur für Adressen aus der gespeicherten Vorlage, nur feste
   Printful-Hosts (``IMAGE_HOSTS``), keine Weiterleitung, Größenlimit, neu kodiert und zwischengespeichert. Eine Adresse
   aus einer Anfrage wird nie geholt - es gibt keine offene Weiterleitung.
3. **Positions-Vorgaben** (``load_presets``/``save_presets``, Dokument ``settings`` mit ``id = "shop_print_presets"``):
   eine einstellbare Liste wie „Brust links“, „Rücken groß“, „Tasse umlaufend“ - relativ zur Fläche (waagrechte Mitte
   als Anteil der Breite, Anker oben/mittig/unten, Abstand oben in cm, Standardbreite in cm). ``place_motif`` und
   ``place_text`` rechnen sie für jede Fläche in Pixel der Druckdatei um.

Maße im Admin immer in cm und Zoll; Pixel gelten bei der DPI der Vorlage.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable, Sequence

import httpx
from PIL import Image, UnidentifiedImageError

import storage
from models import now_utc
from services.shop_common import ShopError, clean_reason, record_admin_action
from services.shop_fulfillment import (
    CatalogProductId, FulfillmentError, FulfillmentProvider, MockupTemplate, PrintArea)

logger = logging.getLogger("tls-arena.shop-print-templates")

CM_PER_INCH = 2.54
SETTINGS_ID = "shop_print_presets"

# ---------------------------------------------------------------- Namen und Familien der Printful-Platzierungen

PLACEMENT_LABELS = {
    "front": "Vorderseite", "back": "Rückseite", "sleeve_left": "Ärmel links", "sleeve_right": "Ärmel rechts",
    "label_inside": "Innenetikett", "label_outside": "Außenetikett", "default": "Druckfläche",
    "front_large": "Vorderseite groß", "back_large": "Rückseite groß", "embroidery_front": "Stickerei vorne",
    "embroidery_chest_left": "Stickerei Brust links", "embroidery_chest_right": "Stickerei Brust rechts",
}
FAMILIES = {"front": "Vorderseite", "back": "Rückseite", "sleeve": "Ärmel", "label": "Etikett",
            "other": "Sonstige Fläche (Tasse, Tuch …)"}


def placement_label(placement: str, display_name: str | None = None) -> str:
    return PLACEMENT_LABELS.get(placement) or (display_name or placement.replace("_", " ").capitalize())


def family(placement: str) -> str:
    """Zu welcher Art Fläche eine Printful-Platzierung gehört - danach richten sich die passenden Vorgaben."""
    key = str(placement or "").lower()
    if "sleeve" in key:
        return "sleeve"
    if "label" in key:
        return "label"
    if key.startswith("back") or "_back" in key:
        return "back"
    if "front" in key or "chest" in key:
        return "front"
    return "other"


def _number(value: float, digits: int) -> str:
    return f"{value:.{digits}f}".rstrip("0").rstrip(".").replace(".", ",")


def cm(value_cm: float) -> str:
    """„20 cm (7,87 Zoll)“ - im Admin immer beides."""
    return f"{_number(value_cm, 1)} cm ({_number(value_cm / CM_PER_INCH, 2)} Zoll)"


def px_to_cm(px: float, dpi: int) -> float:
    return px / dpi * CM_PER_INCH


def cm_to_px(value_cm: float, dpi: int) -> float:
    return value_cm / CM_PER_INCH * dpi


def measure(px: float, dpi: int) -> str:
    """„1800 px = 30,5 cm (12 Zoll)“."""
    return f"{int(round(px))} px = {cm(px_to_cm(px, dpi))}"


# ---------------------------------------------------------------- Vorlagen aus den Printful-Daten bauen

GROUP_ALL = "all"
ASPECT_TOLERANCE = 0.02
# Größte Druckdatei, die die Website erzeugt: 80 Millionen Pixel (Badetuch 11100 × 5700 passt, RGBA gut 250 MB). Eine
# Vorgabe darüber (Zoll × DPI) wird beim Einlesen nicht übernommen, sondern gemeldet - nie still ein Riesenbild.
MAX_FILE_PIXELS = 80_000_000


def group_key(variant_ids: Iterable[int] | None) -> str:
    """Kennung einer Varianten-Gruppe mit eigener Fläche - ``all`` für „gilt für alle“."""
    ids = sorted(set(variant_ids or ()))
    if not ids:
        return GROUP_ALL
    return "v" + hashlib.sha256(",".join(map(str, ids)).encode()).hexdigest()[:12]


def _preview(index: int, row: MockupTemplate) -> dict:
    return {"index": index, "variant_ids": list(row.variant_ids), "placement": row.placement,
            "technique": row.technique, "image_url": row.image_url, "background_url": row.background_url,
            "background_color": row.background_color, "template_width": row.template_width,
            "template_height": row.template_height,
            "area": {"left": row.area_left, "top": row.area_top, "width": row.area_width, "height": row.area_height},
            "positioning": row.positioning, "orientation": row.orientation}


def build(areas: Sequence[PrintArea], templates: Sequence[MockupTemplate]) -> tuple[list[dict], list[dict], list[str]]:
    """Aus den Printful-Daten: Einträge je Platzierung, Technik und Varianten-Gruppe mit exakter Dateigröße, die
    Vorlagenbilder (flache Liste, Einträge zeigen über ``preview_indexes`` darauf) und was zu groß war
    (``MAX_FILE_PIXELS``) - als Sätze."""
    previews = [_preview(index, row) for index, row in enumerate(templates)]
    entries, skipped = [], []
    for area in areas:
        if area.width_px * area.height_px > MAX_FILE_PIXELS:
            skipped.append(f"{placement_label(area.placement, area.display_name)} ({area.technique}): "
                           f"{area.width_px} × {area.height_px} px bei {area.dpi} DPI - mehr als "
                           f"{MAX_FILE_PIXELS // 1_000_000} Millionen Pixel, nicht übernommen.")
            continue
        variant_ids = sorted(area.variant_ids) if area.variant_ids else None
        mine = [item for item in previews if item["placement"] == area.placement
                and item["technique"] == area.technique
                and (variant_ids is None or set(item["variant_ids"]) & set(variant_ids))]
        ratio = area.height_px / area.width_px
        aspect_ok = all(abs(item["area"]["height"] / item["area"]["width"] - ratio) <= ratio * ASPECT_TOLERANCE
                        for item in mine)
        entries.append({
            "placement": area.placement, "technique": area.technique, "family": family(area.placement),
            "label": placement_label(area.placement, area.display_name), "display_name": area.display_name,
            "width_in": round(area.width_in, 4), "height_in": round(area.height_in, 4), "dpi": area.dpi,
            "width_px": area.width_px, "height_px": area.height_px,
            "width_cm": round(area.width_in * CM_PER_INCH, 2), "height_cm": round(area.height_in * CM_PER_INCH, 2),
            "area_type": area.area_type, "variant_ids": variant_ids, "group": group_key(variant_ids),
            "preview_indexes": [item["index"] for item in mine], "aspect_ok": aspect_ok,
        })
    entries.sort(key=lambda row: (row["technique"], row["placement"], row["group"]))
    return entries, previews, skipped


def _spec(entry: dict) -> dict:
    return {key: entry[key] for key in ("placement", "technique", "group", "width_px", "height_px", "dpi",
                                         "variant_ids")}


def spec_hash(entries: Sequence[dict]) -> str:
    """Prüfsumme über die Maße (nicht über die Bildadressen) - eine erzeugte Datei gilt nur zu genau diesen Maßen."""
    data = json.dumps(sorted((_spec(row) for row in entries), key=lambda row: (row["technique"], row["placement"],
                                                                                row["group"])),
                      sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


def entry_hash(entry: dict) -> str:
    return hashlib.sha256(json.dumps(_spec(entry), sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def _size(entry: dict) -> str:
    return f"{entry['width_px']} × {entry['height_px']} px bei {entry['dpi']} DPI"


def diff(before: Sequence[dict], after: Sequence[dict]) -> list[str]:
    """Was sich an den Maßen geändert hat - als Sätze für den Admin und das Protokoll."""
    def key(row):
        return row["placement"], row["technique"], row["group"]

    old = {key(row): row for row in before}
    new = {key(row): row for row in after}
    out = []
    for item in sorted(set(old) | set(new)):
        name = f"{(new.get(item) or old.get(item))['label']} ({item[1]})"
        if item[2] != GROUP_ALL:
            name += f", Varianten {', '.join(map(str, (new.get(item) or old.get(item))['variant_ids']))}"
        if item not in old:
            out.append(f"Neu: {name} - {_size(new[item])}.")
        elif item not in new:
            out.append(f"Entfällt: {name} (bisher {_size(old[item])}).")
        elif _spec(old[item]) != _spec(new[item]):
            out.append(f"Geändert: {name} - {_size(old[item])} → {_size(new[item])}.")
    return out


# ---------------------------------------------------------------- Speichern und Abgleich

async def get(db, printful_product_id: int) -> dict | None:
    if type(printful_product_id) is not int:
        return None
    return await db.shop_print_templates.find_one({"printful_product_id": printful_product_id}, {"_id": 0})


async def refresh(db, printful_product_id: int, *, provider: FulfillmentProvider, actor_id: str,
                  reason: Any = None) -> dict:
    """Druckvorgaben und Vorlagenbilder neu von Printful holen und speichern. Weichen die Maße von der gespeicherten
    Vorlage ab, steht das in ``changes`` (und im Protokoll) - erzeugte Druckdateien gelten dann nicht mehr. Scheitert
    Printful, bleibt der letzte Stand mit Datum; ``ok`` sagt, ob es geklappt hat."""
    reason = clean_reason(reason, required=False)
    product_id = CatalogProductId(printful_product_id)
    current = await get(db, printful_product_id)
    now = now_utc().isoformat()
    try:
        areas = await provider.print_areas(product_id)
        templates = await provider.mockup_templates(product_id)
    except FulfillmentError as exc:
        logger.warning("[shop-print-templates] refresh failed: %s", exc.reason)
        await db.shop_print_templates.update_one(
            {"printful_product_id": printful_product_id},
            {"$set": {"printful_product_id": printful_product_id, "last_error": {"at": now, "detail": exc.text}}},
            upsert=True)
        return {"ok": False, "changed": False, "changes": [], "detail": exc.text, "template": await get(db, printful_product_id)}
    entries, previews, skipped = build(areas, templates)
    if not entries:
        detail = "Printful liefert für dieses Produkt keine Druckvorgaben (mockup-styles)." + (
            " " + " ".join(skipped) if skipped else "")
        await db.shop_print_templates.update_one(
            {"printful_product_id": printful_product_id},
            {"$set": {"printful_product_id": printful_product_id, "last_error": {"at": now, "detail": detail}}},
            upsert=True)
        return {"ok": False, "changed": False, "changes": [], "detail": detail, "template": await get(db, printful_product_id)}
    new_hash = spec_hash(entries)
    changes = diff(current.get("entries") or [], entries) if current and current.get("entries") else []
    update: dict = {"printful_product_id": printful_product_id, "entries": entries, "previews": previews,
                    "hash": new_hash, "checked_at": now, "last_error": None, "skipped": skipped}
    if not current or current.get("hash") != new_hash:
        update.update(fetched_at=now, changed_at=now if current and current.get("hash") else None,
                      changes=changes, previous_hash=(current or {}).get("hash"))
    await db.shop_print_templates.update_one({"printful_product_id": printful_product_id}, {"$set": update},
                                             upsert=True)
    if changes:
        await record_admin_action(db, "shop.print_template.change", actor_id=actor_id,
                                  target_id=str(printful_product_id), reason=reason,
                                  data={"changes": changes, "before_hash": current.get("hash"),
                                        "after_hash": new_hash})
    return {"ok": True, "changed": bool(changes), "changes": changes, "detail": None,
            "template": await get(db, printful_product_id)}


def entries_for(template: dict | None, technique: str | None) -> list[dict]:
    """Die Einträge für eine Technik (ohne Technik: die erste, die es gibt)."""
    entries = list((template or {}).get("entries") or [])
    if not entries:
        return []
    techniques = list(dict.fromkeys(row["technique"] for row in entries))
    chosen = technique if technique in techniques else techniques[0]
    return [row for row in entries if row["technique"] == chosen]


def placements_of(template: dict | None, technique: str | None) -> list[str]:
    return list(dict.fromkeys(row["placement"] for row in entries_for(template, technique)))


def groups_for(template: dict | None, technique: str | None, placement: str,
               variant_ids: Iterable[int] | None = None) -> list[tuple[dict, list[int] | None]]:
    """Die Flächen einer Platzierung mit den angebotenen Varianten, die darauf fallen - meist genau eine Gruppe
    (``all``). Gibt es Gruppen je Größe, bekommt jede ihre Varianten; der Rest fällt auf ``all``."""
    rows = [row for row in entries_for(template, technique) if row["placement"] == placement]
    if variant_ids is None:
        return [(row, row["variant_ids"]) for row in rows]
    wanted = set(variant_ids)
    out, claimed = [], set()
    for row in rows:
        if row["variant_ids"]:
            mine = sorted(wanted & set(row["variant_ids"]))
            if mine:
                out.append((row, mine))
                claimed.update(mine)
    rest = sorted(wanted - claimed)
    general = next((row for row in rows if not row["variant_ids"]), None)
    if general is not None and (rest or not out):
        out.append((general, rest or None))
    return out


def entry_for_variant(template: dict | None, technique: str | None, placement: str, variant_id: int | None) -> dict | None:
    rows = [row for row in entries_for(template, technique) if row["placement"] == placement]
    if variant_id is not None:
        own = next((row for row in rows if row["variant_ids"] and variant_id in row["variant_ids"]), None)
        if own:
            return own
    return next((row for row in rows if not row["variant_ids"]), None)


def preview_for(template: dict | None, entry: dict) -> dict | None:
    previews = (template or {}).get("previews") or []
    for index in entry.get("preview_indexes") or []:
        if 0 <= index < len(previews):
            return previews[index]
    return None


# ---------------------------------------------------------------- Vorlagenbilder über die Website (Proxy mit Cache)

# Nur diese Hosts liefern Vorlagenbilder von Printful - eine Adresse aus der gespeicherten Vorlage mit anderem Host wird
# nicht geholt. Kein Platzhalter, keine Unterdomäne „irgendwas.printful.com“.
IMAGE_HOSTS = frozenset({"files.cdn.printful.com", "printful-upload.s3-accelerate.amazonaws.com",
                         "static.cdn.printful.com", "www.printful.com"})
IMAGE_MAX_BYTES = 8 * 1024 * 1024
IMAGE_MAX_PIXELS = 30_000_000
IMAGE_TIMEOUT = 15.0
IMAGE_TRANSPORT: httpx.AsyncBaseTransport | None = None  # nur Tests
CACHE_FOLDER = "shop-templates"


class TemplateImageUnavailable(ShopError):
    """Das Vorlagenbild ist gerade nicht zu haben (Printful nicht erreichbar, falsche Antwort) - 502."""


def cache_dir() -> Path:
    return storage.UPLOAD_DIR / CACHE_FOLDER


def allowed_image_url(url: Any) -> bool:
    if not isinstance(url, str) or len(url) > 2000:
        return False
    try:
        parsed = httpx.URL(url)
    except (httpx.InvalidURL, TypeError, ValueError):
        return False
    return (parsed.scheme == "https" and parsed.host in IMAGE_HOSTS and parsed.port in (None, 443)
            and not parsed.userinfo)


async def _download(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=IMAGE_TIMEOUT, follow_redirects=False, transport=IMAGE_TRANSPORT) as client:
        async with client.stream("GET", url, headers={"Accept": "image/png, image/jpeg"}) as response:
            if response.status_code != 200:
                raise TemplateImageUnavailable(f"Printful liefert das Vorlagenbild gerade nicht ({response.status_code}).")
            kind = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
            if kind not in ("image/png", "image/jpeg"):
                raise TemplateImageUnavailable("Das Vorlagenbild ist kein PNG oder JPG.")
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > IMAGE_MAX_BYTES:
                raise TemplateImageUnavailable("Das Vorlagenbild ist zu groß.")
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                size += len(chunk)
                if size > IMAGE_MAX_BYTES:
                    raise TemplateImageUnavailable("Das Vorlagenbild ist zu groß.")
                chunks.append(chunk)
    return b"".join(chunks)


def _reencode(data: bytes) -> bytes:
    """Nur Pixel: neu als PNG, ohne Metadaten. Zu viele Pixel oder kein Bild: abgelehnt."""
    try:
        with Image.open(BytesIO(data)) as probe:
            if (probe.format or "").upper() not in ("PNG", "JPEG"):
                raise TemplateImageUnavailable("Das Vorlagenbild ist kein PNG oder JPG.")
            if probe.width * probe.height > IMAGE_MAX_PIXELS:
                raise TemplateImageUnavailable("Das Vorlagenbild hat zu viele Pixel.")
            probe.load()
            pixels = probe.convert("RGBA")
    except TemplateImageUnavailable:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError) as exc:
        raise TemplateImageUnavailable("Das Vorlagenbild ließ sich nicht lesen.") from exc
    clean = Image.new("RGBA", pixels.size)
    clean.paste(pixels)
    out = BytesIO()
    clean.save(out, format="PNG", compress_level=6)
    return out.getvalue()


async def template_image(db, printful_product_id: int, index: int, *, layer: str = "image") -> bytes:
    """Das Vorlagenbild Nummer ``index`` einer gespeicherten Vorlage als PNG - aus dem Zwischenspeicher oder einmal
    von Printful geholt. Nur Adressen aus der Vorlage, nur ``IMAGE_HOSTS``; sonst ``LookupError`` (404)."""
    template = await get(db, printful_product_id)
    previews = (template or {}).get("previews") or []
    if type(index) is not int or not 0 <= index < len(previews) or layer not in ("image", "background"):
        raise LookupError("Dieses Vorlagenbild gibt es nicht.")
    url = previews[index].get("image_url" if layer == "image" else "background_url")
    if not allowed_image_url(url):
        raise LookupError("Dieses Vorlagenbild gibt es nicht.")
    name = hashlib.sha256(url.encode()).hexdigest() + ".png"
    path = cache_dir() / name
    if path.is_file():
        return path.read_bytes()
    try:
        data = await _download(url)
    except httpx.HTTPError as exc:
        raise TemplateImageUnavailable("Printful ist gerade nicht erreichbar.") from exc
    payload = _reencode(data)
    storage.ensure_directory(cache_dir())
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(payload)
    temporary.replace(path)
    return payload


async def template_image_rgba(db, template: dict, preview: dict, *, layer: str = "image") -> Image.Image | None:
    """Für die Vorschau: das Vorlagenbild als Pillow-Bild - ``None``, wenn es gerade nicht zu haben ist."""
    try:
        data = await template_image(db, template["printful_product_id"], preview["index"], layer=layer)
    except (LookupError, ShopError):
        return None
    with Image.open(BytesIO(data)) as img:
        img.load()
        return img.convert("RGBA")


# ---------------------------------------------------------------- Positions-Vorgaben (einstellbar)

PRESET_KINDS = {"motif": "Motiv", "text": "Gamertag oder Vereinsnummer"}
ANCHORS = {"top": "oben", "middle": "mittig", "bottom": "unten"}
FOLLOWS = {"opposite": "gespiegelt zum ersten Motiv, senkrecht auf dessen Mitte", "below": "unter dem ersten Motiv"}
ALL_FAMILIES = list(FAMILIES)
DEFAULT_PRESETS: list[dict] = [
    {"key": "chest_right", "label": "Brust rechts (vom Träger aus)", "kind": "motif", "families": ["front"],
     "hint": "Vom Träger aus rechts - von vorne gesehen links. Hier sitzt der Löwe.",
     "center_x": 0.27, "anchor": "top", "top_cm": 5.0, "width_cm": 8.9},
    {"key": "chest_left", "label": "Brust links (vom Träger aus)", "kind": "motif", "families": ["front"],
     "hint": "Vom Träger aus links - von vorne gesehen rechts.",
     "center_x": 0.73, "anchor": "top", "top_cm": 5.0, "width_cm": 8.9},
    {"key": "front_center", "label": "Vorne mittig", "kind": "motif", "families": ["front"],
     "hint": "Mittig auf Brusthöhe.", "center_x": 0.5, "anchor": "top", "top_cm": 7.5, "width_cm": 20.0},
    {"key": "front_large", "label": "Vorne groß", "kind": "motif", "families": ["front"],
     "hint": "Über die ganze Breite der Vorderseite.", "center_x": 0.5, "anchor": "top", "top_cm": 2.5, "width_cm": 28.0},
    {"key": "back_large", "label": "Rücken groß", "kind": "motif", "families": ["back"],
     "hint": "Über die ganze Breite des Rückens.", "center_x": 0.5, "anchor": "top", "top_cm": 5.0, "width_cm": 28.0},
    {"key": "back_top", "label": "Rücken oben", "kind": "motif", "families": ["back"],
     "hint": "Zwischen den Schulterblättern.", "center_x": 0.5, "anchor": "top", "top_cm": 2.5, "width_cm": 12.0},
    {"key": "neck", "label": "Nacken", "kind": "motif", "families": ["back"],
     "hint": "Klein, direkt unter dem Kragen.", "center_x": 0.5, "anchor": "top", "top_cm": 0.0, "width_cm": 7.0},
    {"key": "sleeve", "label": "Ärmel", "kind": "motif", "families": ["sleeve"],
     "hint": "Mittig auf dem Ärmel.", "center_x": 0.5, "anchor": "middle", "top_cm": 0.0, "width_cm": 7.5},
    {"key": "label", "label": "Etikett", "kind": "motif", "families": ["label"],
     "hint": "Mittig im Etikett.", "center_x": 0.5, "anchor": "middle", "top_cm": 0.0, "width_cm": 6.0},
    {"key": "cap_front", "label": "Kappe vorne", "kind": "motif", "families": ["front"],
     "hint": "Mittig auf der Kappe - die Größe begrenzt die Fläche.", "center_x": 0.5, "anchor": "middle",
     "top_cm": 0.0, "width_cm": 10.0},
    {"key": "mug_wrap", "label": "Tasse umlaufend", "kind": "motif", "families": ["other"],
     "hint": "Über die ganze Druckfläche der Tasse.", "center_x": 0.5, "anchor": "middle", "top_cm": 0.0,
     "width_cm": 200.0},
    {"key": "mug_side", "label": "Tasse einseitig", "kind": "motif", "families": ["other"],
     "hint": "Auf einer Seite der Tasse.", "center_x": 0.25, "anchor": "middle", "top_cm": 0.0, "width_cm": 8.0},
    {"key": "towel_center", "label": "Tuch mittig", "kind": "motif", "families": ["other"],
     "hint": "Mittig auf dem Tuch.", "center_x": 0.5, "anchor": "middle", "top_cm": 0.0, "width_cm": 40.0},
    {"key": "text_opposite", "label": "Brust gegenüber dem Motiv", "kind": "text", "families": ["front"],
     "hint": "Gespiegelt zum ersten Motiv, die senkrechte Mitte des Namens auf der Mitte des Motivs - etwa der Gamertag "
             "gegenüber dem Löwen.", "follow": "opposite", "center_x": 0.5, "anchor": "top", "top_cm": 0.0},
    {"key": "text_below", "label": "Unter dem Motiv", "kind": "text", "families": ALL_FAMILIES,
     "hint": "Mittig unter dem ersten Motiv.", "follow": "below", "gap_cm": 1.0, "center_x": 0.5, "anchor": "top",
     "top_cm": 0.0},
    {"key": "text_back_top", "label": "Rücken oben (Name)", "kind": "text", "families": ["back"],
     "hint": "Name oben am Rücken.", "center_x": 0.5, "anchor": "top", "top_cm": 3.0},
    {"key": "text_center", "label": "Mittig (Name)", "kind": "text", "families": ALL_FAMILIES,
     "hint": "Mittig in der Fläche.", "center_x": 0.5, "anchor": "middle", "top_cm": 0.0},
]
DEFAULT_RULES: dict[str, Any] = {
    # Sicherheitsrand je Art der Fläche in cm: ein Motiv muss so weit vom Rand der Druckfläche bleiben (Allover-Trikot:
    # die Sicherheitslinie im Vorlagenbild). Vorgabe 0 - Printful druckt bei Shirts die ganze Fläche.
    "safe_margin_cm": {name: 0.0 for name in FAMILIES},
    # Auflösung eines Rastermotivs (PNG) bei der gewählten Größe, als Anteil der DPI der Vorlage: darunter abgelehnt,
    # darunter gewarnt. Vorgabe: unter 2/3 der Vorlage (100 DPI bei 150) abgelehnt, unter der Vorlage gewarnt.
    "min_dpi_ratio": 0.66,
    "warn_dpi_ratio": 1.0,
    # Kleinste Breite eines Motivs in cm (Regler im Admin).
    "min_width_cm": 1.0,
}
PRESET_KEY = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
MAX_PRESETS = 40


def _float(value: Any, label: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) \
            or not low <= value <= high:
        raise ShopError(f"{label}: eine Zahl von {_number(low, 2)} bis {_number(high, 2)}.")
    return round(float(value), 3)


def _text(value: Any, label: str, limit: int, *, required: bool = True) -> str:
    text = " ".join(str(value or "").split())
    if required and not text:
        raise ShopError(f"{label} fehlt.")
    if len(text) > limit:
        raise ShopError(f"{label}: höchstens {limit} Zeichen.")
    return text


def clean_preset(raw: Any) -> dict:
    if not isinstance(raw, dict):
        raise ShopError("Vorgabe: als Objekt angeben.")
    known = {"key", "label", "hint", "kind", "families", "center_x", "anchor", "top_cm", "width_cm", "follow", "gap_cm"}
    unknown = sorted(set(raw) - known)
    if unknown:
        raise ShopError(f"Vorgabe: unbekannte Felder {', '.join(unknown)}.")
    key = str(raw.get("key") or "")
    if not PRESET_KEY.match(key):
        raise ShopError("Kennung einer Vorgabe: Kleinbuchstaben, Ziffern und _ (z. B. chest_left).")
    label = _text(raw.get("label"), "Bezeichnung", 60)
    kind = raw.get("kind")
    if kind not in PRESET_KINDS:
        raise ShopError(f"{label}: Art „Motiv“ oder „Gamertag/Nummer“.")
    families = raw.get("families")
    if not isinstance(families, list) or not families or set(families) - set(FAMILIES):
        raise ShopError(f"{label}: mindestens eine Art Fläche ({', '.join(FAMILIES)}).")
    anchor = raw.get("anchor", "top")
    if anchor not in ANCHORS:
        raise ShopError(f"{label}: Anker oben, mittig oder unten.")
    preset = {"key": key, "label": label, "hint": _text(raw.get("hint"), "Hinweis", 240, required=False),
              "kind": kind, "families": [name for name in FAMILIES if name in families],
              "center_x": _float(raw.get("center_x", 0.5), f"{label}: waagrechte Mitte", 0.0, 1.0),
              "anchor": anchor, "top_cm": _float(raw.get("top_cm", 0.0), f"{label}: Abstand oben (cm)", 0.0, 300.0)}
    if kind == "motif":
        preset["width_cm"] = _float(raw.get("width_cm"), f"{label}: Standardbreite (cm)", 0.5, 400.0)
    else:
        follow = raw.get("follow")
        if follow not in (None, *FOLLOWS):
            raise ShopError(f"{label}: Bezug „gegenüber“, „unter dem Motiv“ oder keiner.")
        preset["follow"] = follow
        if follow == "below":
            preset["gap_cm"] = _float(raw.get("gap_cm", 1.0), f"{label}: Abstand (cm)", 0.0, 50.0)
    return preset


def clean_rules(raw: Any) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    margins = raw.get("safe_margin_cm") if isinstance(raw.get("safe_margin_cm"), dict) else {}
    unknown = sorted(set(margins) - set(FAMILIES))
    if unknown:
        raise ShopError(f"Sicherheitsrand: unbekannte Fläche {', '.join(unknown)}.")
    rules = {
        "safe_margin_cm": {name: _float(margins.get(name, DEFAULT_RULES["safe_margin_cm"][name]),
                                        f"Sicherheitsrand {FAMILIES[name]} (cm)", 0.0, 10.0) for name in FAMILIES},
        "min_dpi_ratio": _float(raw.get("min_dpi_ratio", DEFAULT_RULES["min_dpi_ratio"]), "Mindest-Auflösung", 0.3, 1.0),
        "warn_dpi_ratio": _float(raw.get("warn_dpi_ratio", DEFAULT_RULES["warn_dpi_ratio"]), "Warnschwelle", 0.3, 2.0),
        "min_width_cm": _float(raw.get("min_width_cm", DEFAULT_RULES["min_width_cm"]), "Kleinste Breite (cm)", 0.5, 20.0),
    }
    if rules["warn_dpi_ratio"] < rules["min_dpi_ratio"]:
        raise ShopError("Die Warnschwelle darf nicht unter der Mindest-Auflösung liegen.")
    return rules


def clean_presets(raw: Any) -> list[dict]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_PRESETS:
        raise ShopError(f"1 bis {MAX_PRESETS} Vorgaben.")
    presets = [clean_preset(item) for item in raw]
    keys = [item["key"] for item in presets]
    if len(set(keys)) != len(keys):
        raise ShopError("Jede Kennung einer Vorgabe nur einmal.")
    return presets


async def load_presets(db) -> dict:
    """Die geltenden Vorgaben und Regeln - gespeichert oder Vorgabe. Unsinn in der Datenbank gilt als Vorgabe."""
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    try:
        presets = clean_presets(doc["presets"]) if doc.get("presets") else clean_presets(DEFAULT_PRESETS)
        rules = clean_rules(doc.get("rules") or {})
    except ShopError:
        logger.warning("[shop-print-templates] stored presets invalid - defaults apply")
        presets, rules = clean_presets(DEFAULT_PRESETS), clean_rules({})
    return {"presets": presets, "rules": rules, "updated_at": doc.get("updated_at"),
            "is_default": not doc.get("presets")}


async def save_presets(db, *, presets: Any = None, rules: Any = None, actor_id: str, reason: Any) -> dict:
    """Vorgaben bzw. Regeln ändern (Grund optional), vorher/nachher im Protokoll ``shop.print.presets``. Eine Vorgabe,
    die ein Produkt benutzt, bleibt dort gültig, solange es ihre Kennung gibt - entfernte Kennungen meldet die Prüfung
    des Produkts."""
    reason = clean_reason(reason, required=False)
    current = await load_presets(db)
    after_presets = clean_presets(presets) if presets is not None else current["presets"]
    after_rules = clean_rules({**current["rules"], **rules}) if isinstance(rules, dict) else current["rules"]
    if after_presets == current["presets"] and after_rules == current["rules"]:
        return current
    await db.settings.update_one(
        {"id": SETTINGS_ID},
        {"$set": {"id": SETTINGS_ID, "presets": after_presets, "rules": after_rules,
                  "updated_at": now_utc().isoformat(), "updated_by": actor_id}}, upsert=True)
    before_keys = {item["key"]: item for item in current["presets"]}
    after_keys = {item["key"]: item for item in after_presets}
    await record_admin_action(db, "shop.print.presets", actor_id=actor_id, target_id=SETTINGS_ID, reason=reason, data={
        "added": sorted(set(after_keys) - set(before_keys)), "removed": sorted(set(before_keys) - set(after_keys)),
        "changed": sorted(key for key in set(before_keys) & set(after_keys) if before_keys[key] != after_keys[key]),
        "rules_before": current["rules"] if after_rules != current["rules"] else None,
        "rules_after": after_rules if after_rules != current["rules"] else None})
    return await load_presets(db)


def presets_for(presets: Sequence[dict], placement_family: str, kind: str | None = None) -> list[dict]:
    return [item for item in presets if placement_family in item["families"] and (kind is None or item["kind"] == kind)]


# ---------------------------------------------------------------- Umrechnen auf eine Fläche

@dataclass(frozen=True)
class Box:
    """Ein Rahmen in Pixeln der Druckdatei (von links oben, von vorne gesehen)."""
    left: float
    top: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.left + self.width

    @property
    def bottom(self) -> float:
        return self.top + self.height

    def rounded(self) -> tuple[int, int, int, int]:
        """Ganze Pixel - links und oben gerundet, Breite und Höhe aus den gerundeten Kanten (keine Lücke, kein Pixel
        zu viel)."""
        left, top = int(round(self.left)), int(round(self.top))
        return left, top, max(1, int(round(self.right)) - left), max(1, int(round(self.bottom)) - top)

    def as_dict(self, dpi: int) -> dict:
        left, top, width, height = self.rounded()
        return {"left_px": left, "top_px": top, "width_px": width, "height_px": height,
                "left_cm": round(px_to_cm(left, dpi), 2), "top_cm": round(px_to_cm(top, dpi), 2),
                "width_cm": round(px_to_cm(width, dpi), 2), "height_cm": round(px_to_cm(height, dpi), 2)}


def margin_px(entry: dict, rules: dict) -> float:
    return cm_to_px(float((rules.get("safe_margin_cm") or {}).get(entry["family"], 0.0)), entry["dpi"])


def max_width_cm(entry: dict, aspect: float, rules: dict) -> float:
    """Die größte Breite eines Motivs mit Seitenverhältnis ``aspect`` (Höhe/Breite) in dieser Fläche."""
    margin = margin_px(entry, rules)
    inner_w = entry["width_px"] - 2 * margin
    inner_h = entry["height_px"] - 2 * margin
    width = min(inner_w, inner_h / aspect if aspect > 0 else inner_w)
    return math.floor(px_to_cm(max(width, 0.0), entry["dpi"]) * 10) / 10


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high)) if high >= low else low


def _anchored(entry: dict, preset: dict, width: float, height: float, margin: float) -> Box:
    area_w, area_h = entry["width_px"], entry["height_px"]
    left = preset["center_x"] * area_w - width / 2
    if preset["anchor"] == "middle":
        top = (area_h - height) / 2
    elif preset["anchor"] == "bottom":
        top = area_h - height - cm_to_px(preset["top_cm"], entry["dpi"])
    else:
        top = cm_to_px(preset["top_cm"], entry["dpi"])
    # Die Vorgabe ist eine Empfehlung: in der Fläche gehalten (innerhalb des Sicherheitsrands).
    return Box(_clamp(left, margin, area_w - margin - width), _clamp(top, margin, area_h - margin - height),
               width, height)


def place_motif(entry: dict, preset: dict, *, width_cm: float, aspect: float, offset_x_cm: float = 0.0,
                offset_y_cm: float = 0.0, rules: dict | None = None) -> Box:
    """Rahmen eines Motivs: Vorgabe auf die Fläche umgerechnet, Breite in cm, Höhe aus dem Seitenverhältnis, dann die
    Feinjustierung (Versatz in cm). Prüfen, ob es passt, tut ``problems``."""
    rules = rules or DEFAULT_RULES
    dpi = entry["dpi"]
    width = cm_to_px(width_cm, dpi)
    height = width * aspect
    box = _anchored(entry, preset, width, height, margin_px(entry, rules))
    return Box(box.left + cm_to_px(offset_x_cm, dpi), box.top + cm_to_px(offset_y_cm, dpi), width, height)


def place_text(entry: dict, preset: dict, *, width_px: float, height_px: float, follow: Box | None,
               offset_x_cm: float = 0.0, offset_y_cm: float = 0.0, rules: dict | None = None) -> Box:
    """Rahmen eines Namens (Gamertag, Vereinsnummer): die Leinwand der Gamertag-Datei hat für jeden Namen dieselbe
    Größe, ihre senkrechte Mitte ist der Anker (``shop_gamertag.canvas``). „Gegenüber“ spiegelt die Mitte des ersten
    Motivs an der Mitte der Fläche und legt den Anker auf dessen senkrechte Mitte; „unter dem Motiv“ setzt den Namen
    mittig darunter."""
    rules = rules or DEFAULT_RULES
    dpi = entry["dpi"]
    if preset.get("follow") and follow is None:
        raise ShopError(f"„{preset['label']}“ braucht ein Motiv auf derselben Fläche.")
    if preset.get("follow") == "opposite":
        center_x = entry["width_px"] - (follow.left + follow.width / 2)
        center_y = follow.top + follow.height / 2
        box = Box(center_x - width_px / 2, center_y - height_px / 2, width_px, height_px)
    elif preset.get("follow") == "below":
        center_x = follow.left + follow.width / 2
        box = Box(center_x - width_px / 2, follow.bottom + cm_to_px(preset.get("gap_cm", 1.0), dpi), width_px,
                  height_px)
    else:
        box = _anchored(entry, preset, width_px, height_px, margin_px(entry, rules))
    return Box(box.left + cm_to_px(offset_x_cm, dpi), box.top + cm_to_px(offset_y_cm, dpi), width_px, height_px)


def problems(entry: dict, box: Box, label: str, rules: dict | None = None) -> list[str]:
    """Liegt der Rahmen ganz in der Fläche (innerhalb des Sicherheitsrands)? Sonst Sätze mit px, cm und Zoll."""
    rules = rules or DEFAULT_RULES
    dpi = entry["dpi"]
    margin = margin_px(entry, rules)
    area = f"{entry['label']} ({measure(entry['width_px'], dpi)} × {measure(entry['height_px'], dpi)})"
    out = []
    tolerance = 0.5  # ein halbes Pixel: Rundung, kein Überstand
    if box.width < 1 or box.height < 1:
        out.append(f"{label} ist kleiner als ein Pixel.")
    if box.left < margin - tolerance:
        out.append(f"{label} ragt links um {measure(margin - box.left, dpi)} aus der Fläche {area}.")
    if box.top < margin - tolerance:
        out.append(f"{label} ragt oben um {measure(margin - box.top, dpi)} aus der Fläche {area}.")
    if box.right > entry["width_px"] - margin + tolerance:
        out.append(f"{label} ragt rechts um {measure(box.right - (entry['width_px'] - margin), dpi)} aus der Fläche "
                   f"{area}.")
    if box.bottom > entry["height_px"] - margin + tolerance:
        out.append(f"{label} ragt unten um {measure(box.bottom - (entry['height_px'] - margin), dpi)} aus der Fläche "
                   f"{area}.")
    if margin and out:
        out.append(f"Sicherheitsrand: {cm(px_to_cm(margin, dpi))}.")
    return out
