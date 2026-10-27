"""Produktsuche im Printful-Katalog (#2069): Schritt 1 der Produktverwaltung ohne Produktnummer.

Im Printful-Dashboard steht die Nummer eines Katalogprodukts nirgends. Darum lädt die Website den Katalog einmal über den
Adapter (``GET /v2/catalog-products``, seitenweise, Verkaufsregion Europa, und ``GET /v2/catalog-categories``) und
speichert ihn als Zwischenstand (Sammlung ``shop_printful_catalog``, ein Dokument, Ablauf ``MAX_AGE_HOURS``). Printful v2
hat keinen Textfilter - gesucht wird hier lokal:

- über Name, Marke, Modell und Art, ohne Groß-/Kleinschreibung und Umlaute, jedes Wort muss passen; deutsche Begriffe
  wie „Trikot“, „Tasse“ oder „Kappe“ finden auch die englischen Namen (``SYNONYMS``);
- mit Filter nach Kategorie (samt Unterkategorien);
- über einen eingefügten Dashboard-Link: der letzte Teil der Adresse (``unisex-classic-tee-gildan-5000``) wird mit dem
  Namen in Kleinbuchstaben mit Bindestrichen verglichen. Die API liefert keinen Slug - das zählt darum nur, wenn genau
  ein Produkt passt.

Ein Produkt je Modell: Farben und Größen sind Varianten und kommen erst in Schritt 2.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from models import now_utc
from services import shop_print_templates
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.shop_common import ShopConflict, ShopError
from services.shop_fulfillment import FulfillmentError, FulfillmentProvider

DOC_ID = "catalog"
MAX_AGE_HOURS = 24
MAX_RESULTS = 40
REGION = "europe"
LOCK = "shop:printful-catalog"
# Deutsche Suchwörter → Wörter, die in den (englischen) Printful-Namen stehen. Jedes Suchwort passt, wenn es selbst oder
# eines seiner Synonyme vorkommt.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "trikot": ("jersey",), "tasse": ("mug",), "becher": ("mug", "tumbler"), "kappe": ("cap", "hat", "snapback"),
    "muetze": ("beanie", "hat", "cap"), "haube": ("beanie",), "tuch": ("towel",), "handtuch": ("towel",),
    "badetuch": ("towel",), "shirt": ("t-shirt", "tee", "shirt"), "tshirt": ("t-shirt", "tee"),
    "kapuzenpullover": ("hoodie",), "pullover": ("sweatshirt", "hoodie"), "jacke": ("jacket",),
    "tasche": ("bag", "tote"), "rucksack": ("backpack",), "aufkleber": ("sticker",), "poster": ("poster",),
    "mauspad": ("mouse pad",), "flasche": ("bottle",), "socken": ("socks",), "kinder": ("kids", "youth"),
    "damen": ("women", "women's"), "herren": ("men", "men's"), "langarm": ("long sleeve",),
}
SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _fold(text: Any) -> str:
    """Kleinbuchstaben ohne Akzente; ä/ö/ü/ß wie „ae/oe/ue/ss“ - so findet „Muetze“ auch „Mütze“."""
    value = str(text or "").casefold().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    value = unicodedata.normalize("NFKD", value)
    return "".join(char for char in value if not unicodedata.combining(char))


def slug(text: Any) -> str:
    """So sehen die Adressen im Printful-Dashboard aus: „Unisex Classic Tee | Gildan 5000“ → unisex-classic-tee-gildan-5000."""
    return re.sub(r"[^a-z0-9]+", "-", _fold(text)).strip("-")


def _entry(row) -> dict:
    image = row.image if shop_print_templates.allowed_image_url(row.image) else None
    return {"id": row.id.value, "name": row.name, "brand": row.brand, "model": row.model, "type": row.type,
            "category_id": row.main_category_id, "image": image, "techniques": list(row.techniques),
            "colors": row.colors, "sizes": row.sizes, "is_discontinued": row.is_discontinued, "slug": slug(row.name)}


def _fresh(doc: dict | None, now: datetime) -> bool:
    try:
        fetched = datetime.fromisoformat(str((doc or {}).get("fetched_at")))
    except ValueError:
        return False
    if fetched.tzinfo is None:
        fetched = fetched.replace(tzinfo=timezone.utc)
    return timedelta(0) <= now - fetched < timedelta(hours=MAX_AGE_HOURS)


async def load(db, *, provider: FulfillmentProvider | None, refresh: bool = False) -> dict:
    """Der Katalog aus dem Zwischenstand - älter als ``MAX_AGE_HOURS`` (oder ``refresh``) neu von Printful. Scheitert
    Printful, bleibt der letzte Stand (``stale``); gibt es keinen, ``ShopError``. Nur ein Laden zur Zeit (Sperre) - das
    Rate-Limit des Adapters gilt ohnehin."""
    doc = await db.shop_printful_catalog.find_one({"id": DOC_ID}, {"_id": 0})
    now = now_utc()
    if doc and not refresh and _fresh(doc, now):
        return {**doc, "stale": False}
    if provider is None:
        if doc:
            return {**doc, "stale": True}
        raise ShopError("Der Printful-Katalog ist noch nicht geladen.")
    try:
        async with mutation_lock(db, LOCK, wait_seconds=10.0, lease_seconds=300.0):
            doc = await db.shop_printful_catalog.find_one({"id": DOC_ID}, {"_id": 0})
            if doc and not refresh and _fresh(doc, now_utc()):
                return {**doc, "stale": False}
            try:
                products = await provider.catalog_products(region=REGION)
                categories = await provider.catalog_categories()
            except FulfillmentError as exc:
                if doc:
                    return {**doc, "stale": True, "error": exc.text}
                raise ShopError(f"Printful ist gerade nicht erreichbar: {exc.text}.") from exc
            fresh = {"id": DOC_ID, "fetched_at": now_utc().isoformat(), "region": REGION,
                     "products": [_entry(row) for row in products],
                     "categories": [{"id": row.id, "parent_id": row.parent_id, "title": row.title}
                                    for row in categories]}
            await db.shop_printful_catalog.update_one({"id": DOC_ID}, {"$set": fresh}, upsert=True)
            return {**fresh, "stale": False}
    except MutationLockBusy as exc:
        raise ShopConflict("Der Printful-Katalog wird gerade geladen - bitte gleich noch einmal.") from exc


def _descendants(categories: list[dict], root: int) -> set[int]:
    out, todo = {root}, [root]
    while todo:
        current = todo.pop()
        for row in categories:
            if row.get("parent_id") == current and row["id"] not in out:
                out.add(row["id"])
                todo.append(row["id"])
    return out


def _matches(product: dict, words: list[str]) -> bool:
    haystack = _fold(" ".join(str(product.get(key) or "") for key in ("name", "brand", "model", "type")))
    for word in words:
        options = (word, *SYNONYMS.get(word, ()))
        if not any(option in haystack for option in options):
            return False
    return True


# So sehen Produktadressen im Printful-Dashboard aus: /dashboard/custom/<Bereich>/<Unterbereich …>/<produkt> - nur dieses
# Muster zählt; alles andere (Shop-Seiten, Vorlagen, andere Hosts) ergibt keinen Treffer, dann wird gesucht.
DASHBOARD_HOSTS = frozenset({"printful.com", "www.printful.com"})
DASHBOARD_PREFIX = ("dashboard", "custom")


def dashboard_slug(link: Any) -> str | None:
    """Der Produktteil eines Dashboard-Links (``https://www.printful.com/dashboard/custom/mens/shirts/
    unisex-classic-tee-gildan-5000?…``) - nur https bzw. ohne Schema, nur printful.com, nur ``/dashboard/custom/…`` mit
    mindestens einem Bereich vor dem Produkt; sonst ``None``."""
    text = str(link or "").strip()
    if not text or len(text) > 500:
        return None
    try:
        parsed = urlparse(text if "://" in text else f"https://{text}")
        port = parsed.port  # ein ungültiger Port („:abc“) wirft ValueError - dann ist es kein Dashboard-Link
    except ValueError:
        return None
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in DASHBOARD_HOSTS or port not in (None, 443):
        return None
    if parsed.username or parsed.password:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 4 or tuple(part.lower() for part in parts[:2]) != DASHBOARD_PREFIX:
        return None
    candidate = parts[-1].lower()
    return candidate if SLUG.match(candidate) else None


def search(catalog: dict, *, query: Any = "", category_id: int | None = None, link: Any = None) -> dict:
    """Treffer im geladenen Katalog: Wörter (alle müssen passen), Kategorie samt Unterkategorien, oder ein Dashboard-Link.
    Eingestellte Produkte stehen hinten."""
    products = list(catalog.get("products") or [])
    categories = list(catalog.get("categories") or [])
    if link:
        wanted = dashboard_slug(link)
        if wanted is None:
            return {"results": [], "total": 0, "link": {"ok": False, "detail": "Das ist kein Link aus dem "
                                                                             "Printful-Dashboard."}}
        found = [row for row in products if row.get("slug") == wanted]
        if len(found) != 1:
            detail = ("Zu diesem Link passt kein Produkt im Katalog - bitte über den Namen suchen." if not found else
                      "Zu diesem Link passen mehrere Produkte - bitte über den Namen suchen.")
            return {"results": [], "total": 0, "link": {"ok": False, "detail": detail, "slug": wanted}}
        return {"results": found, "total": 1, "link": {"ok": True, "detail": "Eindeutig gefunden.", "slug": wanted}}
    words = [word for word in re.split(r"[^a-z0-9-]+", _fold(query)) if word]
    allowed = _descendants(categories, category_id) if category_id is not None else None
    hits = [row for row in products if (allowed is None or row.get("category_id") in allowed)
            and _matches(row, words)]
    hits.sort(key=lambda row: (row.get("is_discontinued") is True, row.get("name") or ""))
    return {"results": hits[:MAX_RESULTS], "total": len(hits), "link": None}


def category_tree(catalog: dict) -> list[dict]:
    """Kategorien als flache Liste mit Ebene (für ein Auswahlfeld), Oberkategorien zuerst."""
    categories = list(catalog.get("categories") or [])
    by_parent: dict[int | None, list[dict]] = {}
    for row in categories:
        by_parent.setdefault(row.get("parent_id"), []).append(row)
    out: list[dict] = []

    def walk(parent, depth):
        for row in sorted(by_parent.get(parent, []), key=lambda item: item["title"]):
            out.append({"id": row["id"], "title": row["title"], "depth": depth})
            if depth < 4:
                walk(row["id"], depth + 1)

    walk(None, 0)
    return out
