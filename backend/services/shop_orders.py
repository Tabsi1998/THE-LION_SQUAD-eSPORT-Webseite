"""Shop-Bestellungen (#1703): eingefrorene Bestellungen, Positionen, Ereignisse (nur anhängen) und Warenkörbe.

Einziger Weg, diese Sammlungen zu schreiben. Was eine Bestellung festhält, ändert sich danach nicht mehr:

- ``frozen``: Währung, Summe der Artikel, Vereinsaufschlag, Versand, Gesamtbetrag, Steuerprofil (nur die Referenz aus
  dem Produkt - gerechnet wird hier nichts, #1701), Art des Kaufs und die Zahlungsregeln der Bestellung (#1706).
- ``billing_address`` und ``shipping_address`` getrennt, je mit Quelle und Zeitpunkt (``confirmed_at`` bzw.
  ``captured_at``). Eine spätere Änderung am Profil oder in Dolibarr erreicht die Bestellung nie.
- je Position (``shop_order_items``): Produkt- und Variantenname, SKU, Preis, Aufschlag, Gamertag, Druckdatei-Fassung
  mit Prüfsumme und die Printful-Nummern.

Idempotenz: der Schlüssel des Aufrufers gilt je Konto (``<konto>:<schlüssel>``, eindeutiger Index). Derselbe Aufruf
noch einmal liefert dieselbe Bestellung, derselbe Schlüssel mit anderem Inhalt ist ein Konflikt.
``printful_external_id`` ist je Bestellung eindeutig - darüber erkennt Printful einen wiederholten Auftrag (#1705).

Ereignisse (``shop_order_events``) werden nur angehängt; es gibt keine Funktion zum Ändern oder Löschen. Ein
einmaliges Ereignis trägt einen festen ``event_key`` (eindeutig je Bestellung), wiederholbare bekommen einen neuen.
Ereignisse und Protokoll tragen nie eine Anschrift.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from pymongo.errors import DuplicateKeyError

from models import new_id, now_utc
from services import shop_catalog, shop_common, shop_config
from services.shop_common import ShopConflict, ShopError, assert_no_address

BUYER_KINDS = ("member", "public")
STATUS_LABELS = {"placed": "bestellt"}  # die Statusmaschine folgt mit #1716
MAX_LINES = 20
MAX_QUANTITY = 20
MAX_SHIPPING_CENTS = 10_000
KEY = re.compile(r"^[A-Za-z0-9_.:-]{8,128}$")
EVENT_KIND = re.compile(r"^[a-z][a-z0-9_.]{1,63}$")
GAMERTAG = re.compile(r"^[\w .\-]{2,24}$")
PAYMENT_RULE_KEYS = ("dolibarr_payment_term_id", "reminder_days", "overdue_after_days", "cancel_procedure")
LIST_FIELDS = {"_id": 0, "billing_address": 0, "shipping_address": 0, "request_hash": 0, "idempotency_key": 0}


def _lines(raw: Any) -> list[dict]:
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_LINES:
        raise ShopError(f"Eine Bestellung hat 1 bis {MAX_LINES} Positionen.")
    out = []
    for line in raw:
        if not isinstance(line, dict) or set(line) - {"variant_id", "quantity", "gamertag"}:
            raise ShopError("Position: nur Variante, Menge und Gamertag.")
        quantity = line.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= MAX_QUANTITY:
            raise ShopError(f"Menge: 1 bis {MAX_QUANTITY}.")
        gamertag = " ".join(str(line.get("gamertag") or "").split()) or None
        if gamertag and not GAMERTAG.match(gamertag):
            raise ShopError("Gamertag: 2 bis 24 Zeichen - Buchstaben, Ziffern, Leerzeichen, Punkt, Binde- und "
                            "Unterstrich.")
        out.append({"variant_id": str(line.get("variant_id") or ""), "quantity": quantity, "gamertag": gamertag})
    return out


def _payment_rules(raw: Any) -> dict | None:
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) - set(PAYMENT_RULE_KEYS):
        raise ShopError("Zahlungsregeln: unbekannte Angaben.")
    assert_no_address(raw, where="Zahlungsregeln")
    return json.loads(json.dumps(raw))


def _request_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def _without_stamp(address: dict) -> dict:
    return {key: value for key, value in address.items() if key not in ("confirmed_at", "captured_at")}


async def _existing(db, key: str) -> dict | None:
    return await db.shop_orders.find_one({"idempotency_key": key}, {"_id": 0})


async def _same_order(db, order: dict, request_hash: str) -> tuple[dict, bool]:
    if order.get("request_hash") != request_hash:
        raise ShopConflict("Dieser Bestellschlüssel gehört schon zu einer anderen Bestellung.")
    await append_event(db, order["id"], "order.placed", event_key="placed", actor_id=order.get("user_id"))
    return order, False


async def _freeze_line(db, line: dict, position: int, buyer_kind: str, config: dict) -> dict:
    variant = await shop_catalog.get_variant(db, line["variant_id"])
    product = await shop_catalog.get_product(db, variant["product_id"]) if variant else None
    if not variant or not product or not variant.get("active") or product.get("status") != "active":
        raise ShopError(f"Position {position}: dieser Artikel ist nicht bestellbar.")
    if line["gamertag"] and not (buyer_kind == "member" and product.get("gamertag_allowed")):
        raise ShopError(f"Position {position}: ein Gamertag geht nur für Mitglieder bei Produkten mit Gamertag.")
    design = None
    if product.get("design_key"):
        latest = await shop_catalog.latest_design(db, product["design_key"])
        if not latest:
            raise ShopError(f"Position {position}: zur Druckdatei gibt es noch keine Fassung.")
        design = {"design_key": latest["design_key"], "version": latest["version"], "sha256": latest["sha256"]}
    mapping = await shop_catalog.printful_variant_for(db, variant["id"])
    unit = variant["price_cents"] if variant.get("price_cents") is not None else product["base_price_cents"]
    markup = shop_config.markup_cents(config, buyer_kind, product)
    return {
        "position": position, "product_id": product["id"], "variant_id": variant["id"],
        "product_title": product["title"], "variant_label": variant["label"], "sku": variant["sku"],
        "quantity": line["quantity"], "unit_price_cents": int(unit), "markup_cents": markup,
        "line_total_cents": line["quantity"] * (int(unit) + markup), "gamertag": line["gamertag"], "design": design,
        "printful": ({"variant_id": mapping["printful_variant_id"], "product_id": mapping.get("printful_product_id")}
                     if mapping else None),
        "tax_profile": product.get("tax_profile"),
    }


async def place_order(db, *, user_id: str, idempotency_key: str, buyer_kind: str, lines: list,
                      shipping_estimate_cents: int | None, billing_address: dict, shipping_address: dict,
                      actor_id: str, payment_rules: dict | None = None) -> tuple[dict, bool]:
    """Eine Bestellung anlegen und alles einfrieren. Liefert (Bestellung, neu angelegt).

    Den Versand bestimmt die Bestellung selbst (``shop_config.shipping_cents``): der Aufrufer gibt nur die Schätzung
    von Printful oder ``None``. Ohne Schätzung gilt die Ersatzpauschale, fehlt auch die, wird nicht bestellt. 0 € Versand
    nur, wenn die Schätzung ausdrücklich 0 ist."""
    if not user_id:
        raise ShopError("Ohne Konto keine Bestellung.")
    if not KEY.match(str(idempotency_key or "")):
        raise ShopError("Bestellschlüssel: 8 bis 128 Zeichen aus Buchstaben, Ziffern und _.:-")
    if buyer_kind not in BUYER_KINDS:
        raise ShopError("Unbekannte Art des Kaufs.")
    estimate = shipping_estimate_cents
    if estimate is not None and (isinstance(estimate, bool) or not isinstance(estimate, int)
                                 or not 0 <= estimate <= MAX_SHIPPING_CENTS):
        raise ShopError("Versand: die Schätzung in ganzen Cent, nicht negativ - oder keine.")
    clean_lines = _lines(lines)
    billing = shop_common.billing_address(billing_address)
    shipping = shop_common.shipping_address(shipping_address)
    shop_config.check_shipping_country(shipping["country"])
    rules = _payment_rules(payment_rules)
    key = f"{user_id}:{idempotency_key}"
    request_hash = _request_hash({"user_id": user_id, "buyer_kind": buyer_kind, "lines": clean_lines,
                                  "shipping_estimate_cents": estimate, "billing": _without_stamp(billing),
                                  "shipping": _without_stamp(shipping), "payment_rules": rules})
    existing = await _existing(db, key)
    if existing:
        return await _same_order(db, existing, request_hash)

    # Die Einstellungen (Aufschlag, Ersatzpauschale) einmal lesen und mit einfrieren - eine spätere Änderung wirkt nicht
    # zurück.
    config = await shop_config.load(db)
    shipping_cents = shop_config.shipping_cents(config, estimate)
    shipping_source = "estimate" if estimate is not None else "fallback"
    items = [await _freeze_line(db, line, index, buyer_kind, config)
             for index, line in enumerate(clean_lines, start=1)]
    tax_profiles = {item["tax_profile"] for item in items}
    order_id, now = new_id(), now_utc().isoformat()
    items_cents = sum(item["quantity"] * item["unit_price_cents"] for item in items)
    markup_cents = sum(item["quantity"] * item["markup_cents"] for item in items)
    order = {
        "id": order_id, "user_id": user_id, "idempotency_key": key, "request_hash": request_hash, "status": "placed",
        "frozen": {"currency": "EUR", "items_cents": items_cents, "markup_cents": markup_cents,
                   "shipping_cents": shipping_cents, "shipping_source": shipping_source,
                   "total_cents": items_cents + markup_cents + shipping_cents,
                   # Ein Steuerprofil je Bestellung; mischen Positionen verschiedene, bleibt es offen (#1701).
                   "tax_profile": next(iter(tax_profiles)) if len(tax_profiles) == 1 else None,
                   "buyer_kind": buyer_kind, "payment_rules": rules},
        "billing_address": billing, "shipping_address": shipping,
        "printful_external_id": f"lsw-{order_id}", "printful_order_id": None,
        "item_count": len(items), "created_at": now, "updated_at": now,
    }
    # Erst die Positionen, dann die Bestellung: gewinnt eine gleichzeitige Anfrage das Rennen um den Schlüssel, räumt
    # diese ihre eigenen (noch zu keiner Bestellung gehörenden) Positionen weg.
    await db.shop_order_items.insert_many([{"id": new_id(), "order_id": order_id, "user_id": user_id, **item}
                                           for item in items])
    try:
        await db.shop_orders.insert_one(dict(order))
    except DuplicateKeyError:
        await db.shop_order_items.delete_many({"order_id": order_id})
        winner = await _existing(db, key)
        if not winner:
            raise
        return await _same_order(db, winner, request_hash)
    await append_event(db, order_id, "order.placed", event_key="placed", actor_id=actor_id,
                       data={"total_cents": order["frozen"]["total_cents"], "item_count": len(items)})
    return order, True


async def get_order(db, order_id: str) -> dict | None:
    return await db.shop_orders.find_one({"id": order_id}, {"_id": 0})


async def items_for(db, order_id: str) -> list[dict]:
    return await db.shop_order_items.find({"order_id": order_id}, {"_id": 0}).sort("position", 1).to_list(MAX_LINES)


async def list_orders(db, *, status: str | None = None, limit: int = 200) -> list[dict]:
    """Bestellungen für die Finanzen - ohne Anschriften und ohne Schlüssel."""
    query = {"status": status} if status else {}
    return await db.shop_orders.find(query, LIST_FIELDS).sort("created_at", -1).to_list(limit)


# ---------------------------------------------------------------- Ereignisse

async def append_event(db, order_id: str, kind: str, *, actor_id: str | None, event_key: str | None = None,
                       data: dict | None = None) -> tuple[dict, bool]:
    """Ein Ereignis anhängen. Mit ``event_key`` höchstens einmal je Bestellung - ein zweiter Aufruf liefert das
    erste."""
    if not EVENT_KIND.match(str(kind or "")):
        raise ShopError("Unbekannte Art von Ereignis.")
    payload = dict(data or {})
    assert_no_address(payload, where="Ereignis")
    if not await db.shop_orders.find_one({"id": order_id}, {"_id": 1}):
        raise ShopError("Bestellung nicht gefunden.")
    event = {"id": new_id(), "order_id": order_id, "event_key": event_key or f"once:{new_id()}", "kind": kind,
             "at": now_utc().isoformat(), "actor_id": actor_id, "data": payload}
    try:
        await db.shop_order_events.insert_one(dict(event))
    except DuplicateKeyError:
        first = await db.shop_order_events.find_one({"order_id": order_id, "event_key": event_key}, {"_id": 0})
        if first:
            return first, False
        raise
    return event, True


async def events_for(db, order_id: str) -> list[dict]:
    rows = await db.shop_order_events.find({"order_id": order_id}).sort([("at", 1), ("_id", 1)]).to_list(500)
    return [{key: value for key, value in row.items() if key != "_id"} for row in rows]


# ---------------------------------------------------------------- Warenkorb

async def save_cart(db, user_id: str, items: list) -> dict:
    """Der Warenkorb eines Kontos - nur Variante, Menge und Gamertag; Preise rechnet erst die Bestellung (#1713)."""
    if not user_id:
        raise ShopError("Ohne Konto kein Warenkorb.")
    clean = _lines(items) if items else []
    cart = {"user_id": user_id, "items": clean, "updated_at": now_utc().isoformat()}
    await db.shop_carts.update_one({"user_id": user_id}, {"$set": cart}, upsert=True)
    return cart


# ---------------------------------------------------------------- Kontolöschung

ERASED_ADDRESS = "Gelöschter User"


async def anonymize_user(db, user_id: str) -> dict:
    """Kontolöschung (#1731 verfeinert das): Bestellungen behalten Beträge, Positionen und Verlauf für die Buchhaltung -
    die Rechnung selbst liegt in Dolibarr. Anschriften werden bis auf das Land überschrieben, der Gamertag entfernt,
    der Warenkorb gelöscht."""
    now = now_utc().isoformat()
    orders = 0
    open_orders = {"user_id": user_id, "anonymized_at": {"$exists": False}}
    fields = {"_id": 0, "id": 1, "billing_address": 1, "shipping_address": 1}
    async for order in db.shop_orders.find(open_orders, fields):
        update = {"anonymized_at": now, "updated_at": now}
        for field, person in (("billing_address", "name"), ("shipping_address", "recipient")):
            address = order.get(field) or {}
            update[field] = {person: ERASED_ADDRESS, "country": address.get("country"), "source": address.get("source"),
                             "anonymized": True}
        await db.shop_orders.update_one({"id": order["id"]}, {"$set": update})
        orders += 1
    items = await db.shop_order_items.update_many({"user_id": user_id, "gamertag": {"$ne": None}},
                                                  {"$set": {"gamertag": None}})
    carts = await db.shop_carts.delete_many({"user_id": user_id})
    return {"orders": orders, "items": int(items.modified_count), "carts": int(carts.deleted_count)}
