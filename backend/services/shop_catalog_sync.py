"""Katalogabgleich mit Printful (#1709): Lager und Einkaufspreise der angebotenen Varianten aktuell halten.

Läuft auf Knopfdruck („Mit Printful abgleichen“ im Admin) und täglich als Job (``scheduler._safe_shop_catalog_sync``).

- **Nicht lieferbar** (Printful meldet nicht „in stock“ oder kennt die Variante nicht mehr): die Variante wird gesperrt
  (``blocked_reason``) - ``place_order`` nimmt sie nicht an. Ist sie wieder lieferbar, hebt der Abgleich die Sperre auf.
- **Preisänderung**: der neue Einkauf steht an der Zuordnung, dazu eine Warnung (``price_warning``) für den Admin. Der
  Preis der Variante bleibt, bis die Finanzen „Preise übernehmen“ (``shop_products.accept_prices``). Bestehende
  Bestellungen haben ihre Preise eingefroren und bleiben unverändert.
- **Ausfall**: nichts wird geändert; der Abgleich merkt sich Zeitpunkt und Ursache, ``last_ok_at`` bleibt der letzte
  erfolgreiche Stand - den zeigt der Admin mit Datum.
- **Rate-Limit**: je angebotener Variante ein Preisaufruf; ein Client für den ganzen Lauf, der unter 120 Aufrufen je
  Minute bleibt (``printful_client.RATE_BUDGET_PER_MINUTE``).

Protokoll: ``shop.catalog.sync`` mit gesperrten, freigegebenen Varianten und Preisänderungen - nur, wenn sich etwas
ändert (der tägliche Job schreibt sonst nichts).
"""
from __future__ import annotations

import logging
from typing import Any

from models import now_utc
from services import shop_catalog, shop_config, shop_products
from services.shop_common import ShopError, clean_reason, record_admin_action
from services.shop_fulfillment import CatalogProductId, CatalogVariantId, FulfillmentError, FulfillmentProvider

logger = logging.getLogger("tls.shop-catalog-sync")

SYSTEM_ACTOR = "system:printful-abgleich"
DAILY_REASON = "Täglicher Abgleich mit Printful"


def _blocked_text(availability: str | None, known: bool) -> str:
    if not known:
        return "Bei Printful nicht mehr im Katalog."
    return f"Bei Printful nicht lieferbar ({availability or 'kein Lagerstand'})."


async def sync_product(db, product_id: str, *, provider: FulfillmentProvider, actor_id: str, reason: Any) -> dict:
    reason = clean_reason(reason)
    product = await shop_catalog.get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    printful = product.get("printful") or {}
    if not printful.get("product_id"):
        raise ShopError("Ohne Printful-Produkt gibt es nichts abzugleichen.")
    variants = await shop_catalog.variants_of(db, product_id)
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    mapped = [(variant, mappings[variant["id"]]) for variant in variants if variant["id"] in mappings]
    price_for = tuple(CatalogVariantId(mapping["printful_variant_id"]) for variant, mapping in mapped
                      if variant.get("active"))
    now = now_utc().isoformat()
    previous = product.get("catalog_sync") or {}
    try:
        rows = await provider.catalog_variants(CatalogProductId(printful["product_id"]), price_for=price_for)
    except FulfillmentError as exc:
        state = {"at": now, "ok": False, "detail": exc.text, "last_ok_at": previous.get("last_ok_at"),
                 "blocked": previous.get("blocked", 0), "warnings": previous.get("warnings", 0)}
        await shop_catalog.record_catalog_sync(db, product_id, state)
        logger.warning("[shop-sync] product failed: %s", exc.reason)
        return {"ok": False, "detail": exc.text, "at": now, "blocked": [], "unblocked": [], "price_changes": []}
    by_id = {row.id.value: row for row in rows}
    technique = shop_products.technique_of(product)
    blocked, unblocked, price_changes = [], [], []
    open_warnings = blocked_count = 0
    for variant, mapping in mapped:
        row = by_id.get(mapping["printful_variant_id"])
        update: dict = {"synced_at": now, "availability": row.availability if row else None,
                        "in_stock": row.in_stock if row else False}
        if row is not None and row.priced:
            update.update(technique=technique, currency=row.currency, base_cost_cents=row.price_cents(technique),
                          placement_costs=dict(row.placement_prices.get(technique) or {}))
        unavailable = row is None or row.in_stock is False
        if unavailable and not variant.get("blocked_reason"):
            await shop_catalog.set_variant_state(db, variant["id"], {
                "blocked_reason": _blocked_text(row.availability if row else None, row is not None),
                "blocked_at": now}, actor_id=actor_id)
            blocked.append(variant["label"])
        elif not unavailable and variant.get("blocked_reason"):
            await shop_catalog.set_variant_state(db, variant["id"], {"blocked_reason": None, "blocked_at": None},
                                                 actor_id=actor_id)
            unblocked.append(variant["label"])
        if unavailable and variant.get("active"):
            blocked_count += 1
        warning = mapping.get("price_warning")
        price = variant.get("price_cents")
        if variant.get("active") and row is not None and row.priced and isinstance(price, int):
            cost = shop_products.cost_cents(product, {**mapping, **update})
            if cost is not None and cost != price:
                if not warning or warning.get("after_cents") != cost:
                    warning = {"before_cents": price, "after_cents": cost, "at": now}
                    price_changes.append({"label": variant["label"], "before_cents": price, "after_cents": cost})
                update["price_warning"] = warning
            elif cost == price:
                warning = update["price_warning"] = None
        if variant.get("active") and warning:
            open_warnings += 1
        await shop_catalog.set_catalog_mapping(db, variant["id"], update, actor_id=actor_id)
    parts = [f"{len(price_for)} Varianten abgeglichen"]
    if blocked_count:
        parts.append(f"{blocked_count} nicht lieferbar")
    if open_warnings:
        parts.append(f"{open_warnings} Preiswarnung{'en' if open_warnings != 1 else ''}")
    state = {"at": now, "ok": True, "detail": ", ".join(parts) + ".", "last_ok_at": now, "blocked": blocked_count,
             "warnings": open_warnings}
    await shop_catalog.record_catalog_sync(db, product_id, state)
    if blocked or unblocked or price_changes:
        await record_admin_action(db, "shop.catalog.sync", actor_id=actor_id, target_id=product_id, reason=reason,
                                  data={"blocked": blocked, "unblocked": unblocked, "price_changes": price_changes})
    return {"ok": True, "detail": state["detail"], "at": now, "blocked": blocked, "unblocked": unblocked,
            "price_changes": price_changes}


async def sync_all(db, *, provider: FulfillmentProvider | None = None) -> dict:
    """Der tägliche Abgleich: alle Produkte mit Printful-Produkt, außer archivierten. Ohne lesbaren Schlüssel nichts."""
    if provider is None:
        key = await shop_config.printful_api_key(db)
        if not key:
            return {"products": 0, "failed": 0, "skipped": "kein Printful-Schlüssel"}
        from services.printful_client import PrintfulClient

        provider = PrintfulClient(key)
    query = {"printful.product_id": {"$exists": True}, "status": {"$ne": "archived"}}
    products = await db.shop_products.find(query, {"_id": 0, "id": 1}).to_list(500)
    failed = 0
    for row in products:
        try:
            result = await sync_product(db, row["id"], provider=provider, actor_id=SYSTEM_ACTOR, reason=DAILY_REASON)
        except (ShopError, LookupError) as exc:
            logger.warning("[shop-sync] skipped: %s", type(exc).__name__)
            failed += 1
            continue
        failed += 0 if result["ok"] else 1
    return {"products": len(products), "failed": failed}
