"""Shop (#1699): was alle Shop-Services teilen - Fehler, Anschriften, Schutz vor Adressen im Protokoll, die Liste der
Adminaktionen und die personenbezogenen Felder.

Schreibzugriffe auf die Shop-Sammlungen gehen nur über ``services/shop_catalog.py`` und ``services/shop_orders.py``;
Routen und andere Services rufen diese Funktionen, nie die Sammlungen direkt. Beschreibung: ``docs/SHOP.md``.

Bewusst nicht im Modell: Bankverbindungen, Karten, Passwörter, Schlüssel oder Tokens. Bezahlt wird per Überweisung auf
eine Dolibarr-Rechnung; Zugangsdaten zu Printful gehören in den verschlüsselten Speicher (#1705/#1706), nie in eine
Shop-Sammlung. ``FORBIDDEN_FIELD_PARTS`` hält das für jedes Feld fest, ``test_shop_model_unit`` prüft es.
"""
from __future__ import annotations

from typing import Any

from models import new_id, now_utc
from services.log_safe import log_safe, mask_addresses


class ShopError(ValueError):
    """Eine Eingabe passt nicht zum Shop-Modell - Text für die Antwort, ohne interne Kennungen."""


class ShopConflict(ShopError):
    """Derselbe Schlüssel steht schon für etwas anderes (Idempotenzschlüssel mit anderer Bestellung, Slug, SKU)."""


# ---------------------------------------------------------------- Modell auf einen Blick

# Sammlung -> Felder. Die Liste ist zugleich die Prüfung, dass nichts mit Bank- oder Zugangsdaten hineinkommt.
MODEL_FIELDS: dict[str, tuple[str, ...]] = {
    "shop_products": ("id", "slug", "title", "description", "status", "visibility", "base_price_cents", "markup_cents",
                      "currency", "gamertag_allowed", "tax_profile", "design_key", "version", "created_at",
                      "created_by", "updated_at", "updated_by",
                      # Produktverwaltung (#1707, services/shop_products.py) und Abgleich (#1709)
                      "personalization", "printful", "technique", "offer", "placements", "included_placement",
                      "review", "published_at", "archived_at", "catalog_sync",
                      # Druckvorlagen (#2069): die alten Platzierungen nach der Umstellung, für den Rückweg
                      "placements_legacy"),
    "shop_variants": ("id", "product_id", "sku", "label", "size", "color", "price_cents", "active", "version",
                      "created_at", "created_by", "updated_at", "updated_by",
                      "color_code", "blocked_reason", "blocked_at"),
    "shop_designs": ("id", "design_key", "version", "file_ref", "sha256", "placement", "created_at", "created_by",
                     # Druckdatei (#1708, services/shop_designs.py): Maße, Prüfung und öffentlicher Zufallsschlüssel
                     "public_id", "public_disabled_at", "content_type", "size_bytes", "width_px", "height_px",
                     "has_alpha", "source_format", "dpi", "print_width_in", "print_height_in", "min_dpi",
                     "area_width_in", "area_height_in", "origin"),
    # Gamertag-Druckdateien (#1711, services/shop_gamertag.py): Herkunft „gamertag“, ohne den Namen als Text - aber
    # das PNG einer Bestelldatei zeigt ihn: die Zeile gehört dann zu Konto, Bestellung und Position.
    "shop_gamertag_files": ("id", "origin", "purpose", "sha256", "file_ref", "public_id", "content_type", "size_bytes",
                            "placement", "width_px", "height_px", "dpi", "print_width_in", "print_height_in",
                            "text_height_in", "text_width_in", "scaled", "font", "align", "color_key", "color_hex",
                            "anchor_x_in", "anchor_y_in", "anchor_y_px", "rules_hash", "user_id", "order_id",
                            "order_item_id", "created_at", "created_by", "last_used_at", "public_disabled_at",
                            "erase_pending_at", "file_deleted_at"),
    # Druckvorlagen von Printful (#2069, services/shop_print_templates.py): Maße je Fläche, Vorlagenbilder, Abgleich.
    "shop_print_templates": ("printful_product_id", "entries", "previews", "hash", "previous_hash", "fetched_at",
                             "checked_at", "changed_at", "changes", "last_error"),
    # Erzeugte bzw. hochgeladene Druckdateien (#2069, services/shop_print_files.py). Bestelldateien mit Gamertag zeigen
    # den Namen: die Zeile gehört dann zu Konto, Bestellung und Position - nie der Name als Text.
    "shop_print_files": ("id", "origin", "purpose", "product_id", "placement", "printful_placement", "technique",
                         "group", "variant_ids", "color", "color_key", "version", "file_name", "sha256", "file_ref",
                         "public_id", "content_type", "size_bytes", "width_px", "height_px", "dpi", "layout_hash",
                         "template_hash", "sources", "warnings", "base_file_id", "gamertag_file_id", "user_id",
                         "order_id", "order_item_id", "created_at", "created_by", "public_disabled_at",
                         "erase_pending_at", "file_deleted_at"),
    "shop_design_profiles": ("design_key", "title", "placement", "garment_colors", "note", "version", "created_at",
                             "created_by", "updated_at", "updated_by"),
    "shop_design_colors": ("placement", "color_key", "color", "design_key", "claimed_at"),
    "shop_printful_variants": ("provider", "variant_id", "printful_variant_id", "printful_product_id", "updated_at",
                               "updated_by",
                               # Einkauf und Lager aus dem Abgleich (#1709)
                               "technique", "currency", "base_cost_cents", "placement_costs", "availability",
                               "in_stock", "synced_at", "price_warning"),
    "shop_carts": ("user_id", "items", "updated_at"),
    "shop_orders": ("id", "user_id", "idempotency_key", "request_hash", "status", "frozen", "billing_address",
                    "shipping_address", "printful_external_id", "printful_order_id", "item_count", "created_at",
                    "updated_at", "anonymized_at"),
    "shop_order_items": ("id", "order_id", "user_id", "position", "product_id", "variant_id", "product_title",
                         "variant_label", "sku", "quantity", "unit_price_cents", "markup_cents", "line_total_cents",
                         "gamertag", "design", "printful", "tax_profile",
                         # je Platzierung die Druckdatei-Fassung, Druckfläche und Position (#1707)
                         "designs",
                         # je Fläche genau eine Druckdatei (#2069): Grunddatei oder eigene mit Gamertag
                         "print_files"),
    "shop_order_events": ("id", "order_id", "event_key", "kind", "at", "actor_id", "data"),
}
FORBIDDEN_FIELD_PARTS = ("iban", "bic", "bank", "account_number", "card", "cvv", "password", "passwort", "secret",
                         "token", "api_key", "apikey")

# Personenbezogene Felder je Sammlung - für Auskunft und Kontolöschung (#1731, services/personal_data.py). Alles andere
# in den Shop-Sammlungen ist Katalog, Betrag oder Kennung.
PERSONAL_FIELDS: dict[str, tuple[str, ...]] = {
    "shop_orders": ("user_id", "billing_address", "shipping_address"),
    "shop_order_items": ("user_id", "gamertag"),
    "shop_carts": ("user_id", "items"),
    "shop_gamertag_files": ("user_id",),  # und die Datei selbst (sie zeigt den Gamertag)
    "shop_print_files": ("user_id",),  # Bestelldateien mit Gamertag (#2069) - und die Datei selbst
}


def model_field_names() -> set[str]:
    names = {field for fields in MODEL_FIELDS.values() for field in fields}
    return names | set(BILLING_FIELDS) | set(SHIPPING_FIELDS)


# ---------------------------------------------------------------- Anschriften

# Woher eine Anschrift kommt: aus Dolibarr (führend für Mitglieder und Geschäftspartner), aus dem Website-Konto
# (Nichtmitglieder) oder im Checkout für genau diese Bestellung eingegeben.
ADDRESS_SOURCES = ("dolibarr", "account", "checkout")
_ADDRESS_LINES = ("street", "street2", "zip", "city", "country")
BILLING_FIELDS = ("name", "company", *_ADDRESS_LINES, "source", "dolibarr_thirdparty_id", "confirmed_at")
SHIPPING_FIELDS = ("recipient", "company", *_ADDRESS_LINES, "source", "captured_at")
_LIMITS = {"name": 120, "recipient": 120, "company": 120, "street": 120, "street2": 120, "zip": 12, "city": 80}
# Felder, die in keinem Protokoll und keinem Ereignis stehen dürfen.
ADDRESS_KEYS = frozenset({"billing_address", "shipping_address", "address", "recipient", "street", "street2", "zip",
                          "postal_code", "city"})


def _address(raw: Any, *, person_field: str, allowed: tuple[str, ...], stamp_field: str, label: str) -> dict:
    if not isinstance(raw, dict):
        raise ShopError(f"{label}: fehlt.")
    unknown = sorted(set(raw) - set(allowed) - {stamp_field})
    if unknown:
        raise ShopError(f"{label}: unbekannte Felder ({', '.join(unknown)}).")
    out: dict[str, Any] = {}
    for key, limit in _LIMITS.items():
        if key not in allowed:
            continue
        value = " ".join(str(raw.get(key) or "").split())
        if len(value) > limit:
            raise ShopError(f"{label}: {key} ist zu lang.")
        out[key] = value or None
    for key in (person_field, "street", "zip", "city"):
        if not out.get(key):
            raise ShopError(f"{label}: {key} fehlt.")
    country = str(raw.get("country") or "").strip().upper()
    if len(country) != 2 or not country.isalpha():
        raise ShopError(f"{label}: Land als zweistelliger Code (AT).")
    out["country"] = country
    source = raw.get("source")
    if source not in ADDRESS_SOURCES:
        raise ShopError(f"{label}: unbekannte Quelle.")
    out["source"] = source
    out[stamp_field] = now_utc().isoformat()
    return out


def billing_address(raw: Any) -> dict:
    """Bestätigte Rechnungsanschrift - eingefroren mit Quelle und dem Zeitpunkt der Bestätigung. Die Verknüpfung zum
    Geschäftspartner in Dolibarr ist nur eine Nummer; die Anschrift selbst führt Dolibarr."""
    out = _address(raw, person_field="name", allowed=BILLING_FIELDS, stamp_field="confirmed_at",
                   label="Rechnungsanschrift")
    thirdparty = raw.get("dolibarr_thirdparty_id")
    if thirdparty not in (None, ""):
        if not str(thirdparty).isdigit():
            raise ShopError("Rechnungsanschrift: Geschäftspartner-Nummer ist keine Zahl.")
        out["dolibarr_thirdparty_id"] = int(thirdparty)
    return out


def shipping_address(raw: Any) -> dict:
    """Lieferanschrift mit Empfänger - unabhängig von der Rechnungsanschrift; nur sie geht später an Printful."""
    return _address(raw, person_field="recipient", allowed=SHIPPING_FIELDS, stamp_field="captured_at",
                    label="Lieferanschrift")


def assert_no_address(data: Any, *, where: str) -> None:
    """Kein Adressfeld - auch nicht verschachtelt. Laut statt still: wer eins mitgibt, hat etwas falsch verstanden."""
    if isinstance(data, dict):
        for key, value in data.items():
            if str(key).lower() in ADDRESS_KEYS:
                raise ShopError(f"{where}: Anschriften gehören nicht hierher ({key}).")
            assert_no_address(value, where=where)
    elif isinstance(data, (list, tuple)):
        for value in data:
            assert_no_address(value, where=where)


# ---------------------------------------------------------------- Adminaktionen

# Jede Aktion der Finanzen im Shop steht im Protokoll der Adminaktionen (Betrieb → Ereignisse), mit Person und Grund,
# nie mit Anschrift (#1704). Die Namen stehen hier vorab, auch für Aktionen späterer Pakete.
ADMIN_ACTIONS: dict[str, str] = {
    "shop.product.create": "Produkt angelegt",
    "shop.product.update": "Produkt geändert",
    "shop.product.price": "Preis geändert",
    "shop.product.visibility": "Sichtbarkeit geändert",
    "shop.variant.create": "Variante angelegt",
    "shop.variant.update": "Variante geändert",
    "shop.design.add": "Druckdatei-Fassung angelegt",
    "shop.design.profile": "Design angelegt oder geändert (Titel, Shirtfarben)",
    "shop.design.placement": "Druckbereich einer Platzierung geändert",
    "shop.gamertag.rules": "Regeln der Gamertag-Druckdatei geändert",
    "shop.gamertag.file": "Gamertag-Testdatei erzeugt",
    "shop.printful_variant.set": "Printful-Variante zugeordnet",
    "shop.product.catalog": "Printful-Produkt gewählt",
    "shop.product.offer": "Farben und Größen gewählt",
    "shop.product.placements": "Platzierungen und Positionen geändert",
    "shop.product.designs": "Designs je Platzierung und Farbe zugeordnet",
    "shop.product.status": "Stand eines Produkts geändert (Prüfen, Veröffentlichen, Archivieren)",
    "shop.catalog.sync": "Mit Printful abgeglichen (gesperrt, freigegeben, Preiswarnung)",
    # Druckvorlagen und Druckdateien (#2069)
    "shop.product.layout": "Aufbau der Druckflächen geändert (Motiv, Vorgabe-Position, Größe, Platzhalter)",
    "shop.print_template.change": "Druckvorlage bei Printful geändert (Maße einer Fläche)",
    "shop.print.presets": "Positions-Vorgaben geändert",
    "shop.print_file.add": "Druckdatei erzeugt oder hochgeladen",
    "shop.order.release": "Bestellung freigegeben",
    "shop.order.printful_confirm": "Bei Printful bestätigt",
    "shop.order.cancel": "Bestellung storniert",
    "shop.order.club": "Vereinsbestellung ausgelöst",
    "shop.order.prize": "Gewinn-Bestellung ausgelöst",
    "shop.config": "Shop-Konfiguration geändert",
}
MAX_REASON = 500


def clean_reason(reason: Any, *, required: bool = False) -> str:
    """Der Grund einer Adminaktion: eine Zeile, Mail-Adressen gekürzt. Optional - wer, wann und was steht ohnehin im
    Protokoll (Entscheidung Obmann 27.10.2026). Pflicht (``required``) nur bei kritischen Schritten: Steuer freigeben,
    „Öffentlich“, Notschalter einschalten, Schlüssel entfernen."""
    text = log_safe(mask_addresses(" ".join(str(reason or "").split())), MAX_REASON)
    if required and len(text) < 3:
        raise ShopError("Bitte einen Grund angeben.")
    return text


async def record_admin_action(db, action: str, *, actor_id: str, target_id: str, reason: Any,
                              data: dict | None = None) -> dict:
    if action not in ADMIN_ACTIONS:
        raise ShopError("Unbekannte Shop-Aktion.")
    if not actor_id:
        raise ShopError("Ohne Person keine Adminaktion.")
    payload = dict(data or {})
    assert_no_address(payload, where="Protokoll")
    entry = {"id": new_id(), "action": action, "actor_id": actor_id, "target_id": target_id,
             # Ob ein Grund Pflicht ist, prüft der Schritt selbst; das Protokoll nimmt auch einen leeren.
             "data": {**payload, "reason": clean_reason(reason, required=False)}, "created_at": now_utc().isoformat()}
    await db.audit_logs.insert_one(dict(entry))
    return entry
