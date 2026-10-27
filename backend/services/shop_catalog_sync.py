"""Katalogabgleich mit Printful (#1709): Lager und Einkaufspreise der angebotenen Varianten aktuell halten.

Läuft auf Knopfdruck („Mit Printful abgleichen“ im Admin) und täglich als Job (``scheduler._safe_shop_catalog_sync``).

- **Nicht bestellbar** - fail-closed: Printful meldet nicht „in stock“, meldet gar nichts („Lager unbekannt“), kennt die
  Variante nicht mehr, oder der Einkauf fehlt bzw. ist 0 € („Preis fehlt“). Die Variante wird gesperrt
  (``blocked_reason``) - ``place_order`` nimmt sie nicht an. Nur „in stock“ mit gültigem Preis hebt die Sperre auf.
- **Preisänderung**: der neue Einkauf steht an der Zuordnung, dazu eine Warnung (``price_warning``) für den Admin. Der
  Preis der Variante bleibt, bis die Finanzen „Preise übernehmen“ (``shop_products.accept_prices``). Bestehende
  Bestellungen haben ihre Preise eingefroren und bleiben unverändert.
- **Ausfall**: nichts wird geändert; der Abgleich merkt sich Zeitpunkt und Ursache, ``last_ok_at`` bleibt der letzte
  erfolgreiche Stand - den zeigt der Admin mit Datum.
- **Kein Schreiben mit altem Stand**: Printful wird ohne Sperre gefragt (das dauert). Geschrieben wird danach unter der
  Sperre des Produkts (``shop_catalog.product_lock``, dieselbe wie bei allen Schritten des Aufbaus) und nur, wenn die
  ``version`` des Produkts noch die gelesene ist - sonst verwirft der Abgleich sein Ergebnis („übersprungen“).
- **Einer zur Zeit**: eine Sperre mit Ablauf (``SYNC_RESOURCE``) über alle Prozesse; ein zweiter Abgleich bekommt „läuft
  gerade“. Zusammen mit dem gemeinsamen Rate-Limit des Adapters (``printful_client``, je Schlüssel im Prozess; das
  Backend läuft mit einem Uvicorn-Worker) bleibt der Shop unter 120 Aufrufen je Minute.
- **Alle Produkte**: der Tagesjob geht seitenweise (``PAGE_SIZE``) über alle nicht archivierten Printful-Produkte.

Protokoll: ``shop.catalog.sync`` mit gesperrten, freigegebenen Varianten und Preisänderungen - nur, wenn sich etwas
ändert (der tägliche Job schreibt sonst nichts).
"""
from __future__ import annotations

import logging
from typing import Any

from models import now_utc
from services import shop_catalog, shop_config, shop_costs
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.shop_common import ShopConflict, ShopError, clean_reason, record_admin_action
from services.shop_fulfillment import CatalogProductId, CatalogVariantId, FulfillmentError, FulfillmentProvider

logger = logging.getLogger("tls.shop-catalog-sync")

SYSTEM_ACTOR = "system:printful-abgleich"
DAILY_REASON = "Täglicher Abgleich mit Printful"
SYNC_RESOURCE = "shop:catalog-sync"
SYNC_LEASE_SECONDS = 900.0
BUSY = "Ein Abgleich mit Printful läuft gerade - bitte gleich noch einmal."
DAILY_BUSY = "Abgleich läuft gerade"
SKIPPED = "Abgleich übersprungen: das Produkt wurde gerade geändert - bitte noch einmal abgleichen."
PAGE_SIZE = 200
NOT_IN_CATALOG = "Bei Printful nicht mehr im Katalog."
STOCK_UNKNOWN = "Lager bei Printful unbekannt."
PRICE_MISSING = "Preis fehlt bei Printful."


def _blocked_reason(row, *, active: bool, cost: int | None) -> str | None:
    """Warum diese Variante nicht bestellbar ist - oder ``None``. Unbekannt heißt nicht bestellbar."""
    if row is None:
        return NOT_IN_CATALOG
    if row.in_stock is None:
        return STOCK_UNKNOWN
    if row.in_stock is False:
        return f"Bei Printful nicht lieferbar ({row.availability or 'kein Lagerstand'})."
    if active and cost is None:
        return PRICE_MISSING
    return None


async def sync_product(db, product_id: str, *, provider: FulfillmentProvider, actor_id: str, reason: Any,
                       wait_seconds: float = 0.0) -> dict:
    """Ein Produkt abgleichen. Läuft schon ein Abgleich, ``ShopConflict`` („läuft gerade“)."""
    reason = clean_reason(reason)
    try:
        async with mutation_lock(db, SYNC_RESOURCE, wait_seconds=wait_seconds, lease_seconds=SYNC_LEASE_SECONDS):
            return await _sync_product_unlocked(db, product_id, provider=provider, actor_id=actor_id, reason=reason)
    except MutationLockBusy as exc:
        raise ShopConflict(BUSY) from exc


async def _failed(db, product_id: str, previous: dict, now: str, detail: str, *, skipped: bool = False) -> dict:
    state = {"at": now, "ok": False, "skipped": skipped, "detail": detail, "last_ok_at": previous.get("last_ok_at"),
             "blocked": previous.get("blocked", 0), "warnings": previous.get("warnings", 0)}
    await shop_catalog.record_catalog_sync(db, product_id, state)
    return {"ok": False, "skipped": skipped, "detail": detail, "at": now, "blocked": [], "unblocked": [],
            "price_changes": []}


async def _sync_product_unlocked(db, product_id: str, *, provider: FulfillmentProvider, actor_id: str,
                                 reason: str) -> dict:
    product = await shop_catalog.get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    printful = product.get("printful") or {}
    if not printful.get("product_id"):
        raise ShopError("Ohne Printful-Produkt gibt es nichts abzugleichen.")
    read_version = product.get("version", 1)
    variants = await shop_catalog.variants_of(db, product_id)
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    price_for = tuple(CatalogVariantId(mappings[variant["id"]]["printful_variant_id"]) for variant in variants
                      if variant.get("active") and variant["id"] in mappings)
    now = now_utc().isoformat()
    previous = product.get("catalog_sync") or {}
    try:
        rows = await provider.catalog_variants(CatalogProductId(printful["product_id"]), price_for=price_for)
    except FulfillmentError as exc:
        logger.warning("[shop-sync] product failed: %s", exc.reason)
        return await _failed(db, product_id, previous, now, exc.text)
    by_id = {row.id.value: row for row in rows}
    try:
        async with shop_catalog.product_lock(db, product_id, wait_seconds=5.0):
            current = await shop_catalog.get_product(db, product_id)
            if not current or current.get("version", 1) != read_version:
                logger.info("[shop-sync] product changed during the sync - result discarded")
                return await _failed(db, product_id, previous, now, SKIPPED, skipped=True)
            return await _write(db, current, by_id, set(item.value for item in price_for), now=now,
                                actor_id=actor_id, reason=reason)
    except ShopConflict:
        return await _failed(db, product_id, previous, now, SKIPPED, skipped=True)


async def _write(db, product: dict, by_id: dict, priced_ids: set[int], *, now: str, actor_id: str,
                 reason: str) -> dict:
    """Schreibt Lager, Einkauf, Sperren und Warnungen - nach frisch gelesenen Varianten, unter der Produkt-Sperre."""
    product_id = product["id"]
    variants = await shop_catalog.variants_of(db, product_id)
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    technique = shop_costs.technique_of(product)
    blocked, unblocked, price_changes = [], [], []
    open_warnings = blocked_count = 0
    for variant in variants:
        mapping = mappings.get(variant["id"])
        if not mapping:
            continue
        row = by_id.get(mapping["printful_variant_id"])
        update: dict = {"synced_at": now, "availability": row.availability if row else None,
                        "in_stock": row.in_stock if row else False}
        priced = row is not None and row.priced and mapping["printful_variant_id"] in priced_ids
        if priced:
            base = row.price_cents(technique)
            update.update(technique=technique, currency=row.currency,
                          base_cost_cents=base if isinstance(base, int) and base > 0 else None,
                          placement_costs=dict(row.placement_prices.get(technique) or {}))
        merged = {**mapping, **update}
        cost = shop_costs.cost_cents(product, merged)
        reason_now = _blocked_reason(row, active=bool(variant.get("active")), cost=cost)
        if reason_now and not variant.get("blocked_reason"):
            await shop_catalog.set_variant_state(db, variant["id"], {"blocked_reason": reason_now, "blocked_at": now},
                                                 actor_id=actor_id)
            blocked.append(variant["label"])
        elif reason_now and variant.get("blocked_reason") != reason_now:
            await shop_catalog.set_variant_state(db, variant["id"], {"blocked_reason": reason_now},
                                                 actor_id=actor_id)
        elif not reason_now and variant.get("blocked_reason"):
            await shop_catalog.set_variant_state(db, variant["id"], {"blocked_reason": None, "blocked_at": None},
                                                 actor_id=actor_id)
            unblocked.append(variant["label"])
        if reason_now and variant.get("active"):
            blocked_count += 1
        warning = mapping.get("price_warning")
        price = variant.get("price_cents")
        if variant.get("active") and priced and isinstance(price, int):
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
    parts = [f"{len(priced_ids)} Varianten abgeglichen"]
    if blocked_count:
        parts.append(f"{blocked_count} nicht bestellbar")
    if open_warnings:
        parts.append(f"{open_warnings} Preiswarnung{'en' if open_warnings != 1 else ''}")
    state = {"at": now, "ok": True, "skipped": False, "detail": ", ".join(parts) + ".", "last_ok_at": now,
             "blocked": blocked_count, "warnings": open_warnings}
    await shop_catalog.record_catalog_sync(db, product_id, state)
    if blocked or unblocked or price_changes:
        await record_admin_action(db, "shop.catalog.sync", actor_id=actor_id, target_id=product_id, reason=reason,
                                  data={"blocked": blocked, "unblocked": unblocked, "price_changes": price_changes})
    return {"ok": True, "skipped": False, "detail": state["detail"], "at": now, "blocked": blocked,
            "unblocked": unblocked, "price_changes": price_changes}


async def sync_all(db, *, provider: FulfillmentProvider | None = None) -> dict:
    """Der tägliche Abgleich: seitenweise alle Produkte mit Printful-Produkt, außer archivierten - unter der einen
    Abgleich-Sperre. Ohne lesbaren Schlüssel nichts."""
    if provider is None:
        key = await shop_config.printful_api_key(db)
        if not key:
            return {"products": 0, "failed": 0, "skipped": "kein Printful-Schlüssel"}
        from services.printful_client import PrintfulClient

        provider = PrintfulClient(key)
    query = {"printful.product_id": {"$exists": True}, "status": {"$ne": "archived"}}
    total = failed = 0
    try:
        async with mutation_lock(db, SYNC_RESOURCE, wait_seconds=0.0, lease_seconds=SYNC_LEASE_SECONDS):
            last = ""
            while True:
                page = await db.shop_products.find({**query, "id": {"$gt": last}}, {"_id": 0, "id": 1}) \
                    .sort("id", 1).to_list(PAGE_SIZE)
                for row in page:
                    total += 1
                    try:
                        result = await _sync_product_unlocked(db, row["id"], provider=provider,
                                                              actor_id=SYSTEM_ACTOR, reason=DAILY_REASON)
                    except (ShopError, LookupError) as exc:
                        logger.warning("[shop-sync] skipped: %s", type(exc).__name__)
                        failed += 1
                        continue
                    failed += 0 if result.get("ok") else 1
                if len(page) < PAGE_SIZE:
                    break
                last = page[-1]["id"]
    except MutationLockBusy:
        return {"products": total, "failed": failed, "skipped": DAILY_BUSY}
    return {"products": total, "failed": failed}
