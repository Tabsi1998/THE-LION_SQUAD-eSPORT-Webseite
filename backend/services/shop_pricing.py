"""Bruttopreise aus der Kostenschätzung von Printful (#2135): Mitglieder zahlen, was der Verein an Printful zahlt.

Der Verein zahlt Printful immer brutto - Ware, Versand und Steuer. Genau diesen Betrag zahlen Mitglieder; öffentliche
Käufe zahlen ihn plus den Vereinsaufschlag je Artikel. Die Quelle ist dieselbe wie beim Testentwurf (#2062):
``estimate_costs`` des Adapters (Land und PLZ, nie Name oder Straße).

- **Je Variante** (``estimate_variant``, ``refresh_estimates``): eine Schätzung für ein Stück nach Österreich, an der
  Printful-Zuordnung zwischengespeichert (``gross_estimate``) und beim Abgleich erneuert. Daraus kommen der angezeigte
  Preis (``display_price``, „zzgl. Versand, genauer Betrag an der Kasse“), der Mitgliederpreis in Schritt 4
  (``member_price``) und das Versandbeispiel. Varianten mit gleichem Einkauf laut Katalog teilen sich eine Schätzung.
- **Je Bestellung** (``order_prices``, von ``shop_orders.place_order``): eine Schätzung für den ganzen Warenkorb mit
  den eingefrorenen Druckdateien - mehrere Artikel teilen sich den Versand, wie Printful es rechnet. Eingefroren werden
  Ware, Versand, Zusatzkosten, Steuer und Gesamt (``frozen.printful_costs``) und je Position ihr Anteil
  (``gross``: netto, Steuer, brutto).
- **Vor dem Auslösen** (``recheck_before_release``, für #1718): nach dem Zahlungseingang neu schätzen. Teurer um mehr
  als die Toleranz (Einstellung ``price_tolerance_cents``, Vorgabe 0,50 €): nicht auslösen, Stand „Preis geändert“
  für die Leitung. Günstiger: auslösen - die Differenz bleibt beim Verein (Entscheidung Obmann, keine Rückbuchung).
- **Rechnung** (``invoice_lines``, für #1717): Positionen mit den eingefrorenen Bruttobeträgen. Bis #1701 „Steuer
  geklärt“ entschieden hat, ohne eigenen Steuerausweis.

Rückfall ohne Printful (kein Schlüssel, Printful nicht erreichbar, keine https-Adresse der Druckdateien): der
Mitgliederpreis der Variante (zuletzt übernommen) und der Versand wie bisher (Schätzung oder Ersatzpauschale). Die
Bestellung trägt dann ``price_source = "fallback"`` - die Prüfung vor dem Auslösen fängt eine Abweichung ab.

Beträge sind ganze Cent; Steuer und Netto werden mit der Methode der größten Reste verteilt - die Teile ergeben immer
genau den Gesamtbetrag von Printful.
"""
from __future__ import annotations

import logging
from typing import Any

from models import now_utc
from services import shop_catalog, shop_config, shop_costs, shop_designs, shop_print_files
from services.log_safe import log_safe
from services.shop_common import ShopError
from services.shop_fulfillment import (
    CatalogVariantId, Costs, DraftLine, FulfillmentError, FulfillmentInvalid, FulfillmentProvider, Placement)

logger = logging.getLogger("tls.shop-pricing")

SOURCE_ESTIMATE = "printful_estimate"
SOURCE_FALLBACK = "fallback"
# Die Schätzung je Variante rechnet ein Stück nach Wien - die Steuer in Österreich hängt nicht von der PLZ ab.
SAMPLE_COUNTRY = "AT"
SAMPLE_ZIP = "1010"
PRICE_NOTE = "zzgl. Versand, genauer Betrag an der Kasse"
# „Prüfen“ in Schritt 4 nur bei starker Abweichung zwischen Katalog (netto) und Schätzung (netto): mehr als 10 % und
# mehr als 1 €.
STRONG_DEVIATION_PERCENT = 10
STRONG_DEVIATION_MIN_CENTS = 100
# So viele Schätzungen höchstens je Produkt und Abgleich (je Preisgruppe eine) - der Rest behält seinen letzten Stand.
MAX_ESTIMATE_GROUPS = 20
STATUS_PRICE_CHANGED = "price_changed"
DECISIONS = ("release", "hold", "retry", "blocked")


class EstimateUnusable(ValueError):
    """Die Schätzung passt nicht zusammen (andere Währung, negative Teile, Summe stimmt nicht) - nie verwenden."""


# ---------------------------------------------------------------- Rechnen

def _amount(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def split(costs: Costs) -> dict:
    """Die Schätzung in Teile: Ware (Zwischensumme minus Rabatt), Versand, Zusatzkosten (etwa Digitalisierung - was
    Printful im Gesamt mehr rechnet), Steuer (``tax`` plus ``vat``) und Gesamt. Der Gesamtbetrag von Printful zählt."""
    if (costs.currency or "EUR") != "EUR":
        raise EstimateUnusable("Währung")
    tax = (costs.tax_cents or 0) + (costs.vat_cents or 0)
    discount = costs.discount_cents or 0
    values = (costs.subtotal_cents, costs.shipping_cents, costs.total_cents, discount, tax)
    if not all(_amount(value) for value in values):
        raise EstimateUnusable("Beträge")
    goods = costs.subtotal_cents - discount
    fees = costs.total_cents - goods - costs.shipping_cents - tax
    if goods <= 0 or fees < 0:
        raise EstimateUnusable("Summe")
    return {"goods_cents": goods, "shipping_cents": costs.shipping_cents, "fees_cents": fees, "tax_cents": tax,
            "total_cents": costs.total_cents}


def allocate(amount: int, weights: list[int]) -> list[int]:
    """``amount`` im Verhältnis der Gewichte auf ganze Cent - Methode der größten Reste, bei Gleichstand die frühere
    Stelle. Die Summe ist immer genau ``amount``. Ohne Gewicht zu gleichen Teilen."""
    if not weights:
        return []
    weights = [max(int(weight), 0) for weight in weights]
    total = sum(weights)
    if total <= 0:
        weights, total = [1] * len(weights), len(weights)
    shares = [amount * weight // total for weight in weights]
    rest = amount - sum(shares)
    order = sorted(range(len(weights)), key=lambda index: (-(amount * weights[index] % total), index))
    for index in order[:rest]:
        shares[index] += 1
    return shares


def _part(net: int, tax: int) -> dict:
    return {"net_cents": net, "tax_cents": tax, "gross_cents": net + tax}


def breakdown(parts: dict, weights: list[int]) -> dict:
    """Die Steuer auf Ware, Versand und Zusatzkosten verteilt, die Ware auf die Positionen (nach ``weights``, etwa
    Menge × Katalogpreis). Jede Position bekommt netto, Steuer und brutto; zusammen genau der Gesamtbetrag."""
    goods_tax, shipping_tax, fees_tax = allocate(parts["tax_cents"], [parts["goods_cents"], parts["shipping_cents"],
                                                                      parts["fees_cents"]])
    nets = allocate(parts["goods_cents"], weights)
    taxes = allocate(goods_tax, nets)
    lines = [_part(net, tax) for net, tax in zip(nets, taxes)]
    return {"lines": lines, "shipping": _part(parts["shipping_cents"], shipping_tax),
            "fees": _part(parts["fees_cents"], fees_tax),
            "goods_gross_cents": sum(line["gross_cents"] for line in lines),
            "tax_cents": parts["tax_cents"], "total_cents": parts["total_cents"]}


def strong_deviation(catalog_cents: int | None, estimate_cents: int | None) -> bool:
    """Liegen Katalog und Schätzung (beide netto) stark auseinander? Nur dann zeigt der Admin „prüfen“."""
    if not _amount(catalog_cents) or not _amount(estimate_cents):
        return False
    difference = abs(catalog_cents - estimate_cents)
    return difference > STRONG_DEVIATION_MIN_CENTS and difference * 100 > STRONG_DEVIATION_PERCENT * estimate_cents


def euro(cents: int | None) -> str:
    return shop_costs.euro(cents) if _amount(cents) else "–"


# ---------------------------------------------------------------- Je Variante (zwischengespeichert)

def current_estimate(product: dict, mapping: dict | None) -> dict | None:
    """Die gespeicherte Schätzung - nur, solange sie zum Einkauf laut Katalog passt, auf dem sie entstand. Ändert
    Printful den Einkauf oder das Produkt eine Fläche, gilt sie bis zur nächsten Schätzung nicht mehr."""
    estimate = (mapping or {}).get("gross_estimate")
    if not isinstance(estimate, dict) or not _amount(estimate.get("goods_gross_cents")):
        return None
    if estimate.get("catalog_net_cents") != shop_costs.cost_cents(product, mapping):
        return None
    return estimate


def member_price(product: dict, mapping: dict | None) -> tuple[int | None, str]:
    """Mitgliederpreis je Stück: Printful brutto (Ware) aus der Schätzung, sonst als Rückfall der Katalog netto."""
    estimate = current_estimate(product, mapping)
    if estimate:
        return estimate["goods_gross_cents"], "estimate"
    return shop_costs.cost_cents(product, mapping), "catalog"


def display_price(config: dict, product: dict, variant: dict, mapping: dict | None, *,
                  buyer_kind: str = "member") -> dict:
    """Angezeigter Preis auf Produktseite und Warenkorb (#1712): brutto je Stück plus Aufschlag (nur öffentlich), mit
    dem Hinweis „zzgl. Versand, genauer Betrag an der Kasse“. Ohne frische Schätzung der übernommene Preis."""
    estimate = current_estimate(product, mapping) if product.get("printful") else None
    unit = estimate["goods_gross_cents"] if estimate else variant.get("price_cents")
    if unit is None:
        unit = product.get("base_price_cents")
    markup = shop_config.markup_cents(config, buyer_kind, product)
    return {"price_cents": unit + markup if isinstance(unit, int) else None, "markup_cents": markup,
            "source": "estimate" if estimate else "accepted", "estimated_at": (estimate or {}).get("estimated_at"),
            "shipping_example_cents": (estimate or {}).get("shipping_gross_cents"), "note": PRICE_NOTE}


async def _variant_line(db, product: dict, variant: dict, mapping: dict, quantity: int = 1) -> DraftLine | None:
    """Ein Stück dieser Variante mit den Grunddateien je Fläche. Eine reine Platzhalter-Fläche (Gamertag, Nummer)
    bekommt für die Schätzung die Adresse einer anderen Grunddatei - für den Preis zählen nur Fläche und Technik."""
    places = await shop_print_files.base_placements(db, product, variant,
                                                    printful_variant_id=mapping.get("printful_variant_id"))
    if not places:
        return None
    spare = next((place["url"] for place in places if place["url"]), None)
    try:
        return DraftLine(variant=CatalogVariantId(int(mapping["printful_variant_id"])), quantity=quantity,
                         placements=tuple(Placement(placement=place["placement"], technique=place["technique"],
                                                    file_url=place["url"] or spare) for place in places))
    except (KeyError, TypeError, ValueError):
        return None  # keine öffentliche https-Adresse (PUBLIC_BACKEND_URL) - dann keine Schätzung


async def estimate_variant(db, product: dict, variant: dict, mapping: dict, *, provider: FulfillmentProvider,
                           line: DraftLine | None = None) -> dict | None:
    """Ein Stück nach Österreich schätzen lassen. ``None``, wenn es nicht geht - nie ein geratener Preis."""
    line = line or await _variant_line(db, product, variant, mapping)
    if line is None:
        return None
    try:
        costs = await provider.estimate_costs((line,), country_code=SAMPLE_COUNTRY, zip_code=SAMPLE_ZIP)
        parts = split(costs)
    except (FulfillmentError, EstimateUnusable) as exc:
        logger.warning("[shop-pricing] variant estimate failed: product=%s reason=%s", log_safe(product.get("id")),
                       log_safe(getattr(exc, "reason", str(exc))))
        return None
    shares = breakdown(parts, [1])
    (line_share,) = shares["lines"]
    return {"goods_net_cents": line_share["net_cents"], "goods_tax_cents": line_share["tax_cents"],
            "goods_gross_cents": line_share["gross_cents"], "shipping_gross_cents": shares["shipping"]["gross_cents"],
            "fees_gross_cents": shares["fees"]["gross_cents"], "tax_cents": parts["tax_cents"],
            "total_cents": parts["total_cents"], "country": SAMPLE_COUNTRY,
            "catalog_net_cents": shop_costs.cost_cents(product, mapping), "estimated_at": now_utc().isoformat()}


def public_https() -> bool:
    """Hat die Website eine öffentliche https-Adresse (``PUBLIC_BACKEND_URL`` …)? Sonst kann Printful nichts schätzen."""
    return shop_designs._public_base_url().startswith("https://")


def _group_key(mapping: dict) -> tuple | None:
    base = mapping.get("base_cost_cents")
    if not _amount(base) or not base:
        return None
    return (mapping.get("technique"), base, tuple(sorted((mapping.get("placement_costs") or {}).items())))


async def estimates_for(db, product: dict, variants: list[dict], mappings: dict[str, dict], *,
                        provider: FulfillmentProvider) -> dict[str, dict]:
    """Schätzungen für die angebotenen Varianten - je Preisgruppe (gleicher Einkauf und gleiche Aufpreise laut
    Katalog) eine, höchstens ``MAX_ESTIMATE_GROUPS``. Liefert nur, was geklappt hat (Variante → Schätzung). Ohne
    öffentliche https-Adresse der Website holt Printful keine Druckdatei - dann gar nicht erst rechnen."""
    if not public_https():
        return {}
    groups: dict[tuple, list[dict]] = {}
    for variant in variants:
        mapping = mappings.get(variant["id"])
        key = _group_key(mapping) if variant.get("active") and mapping else None
        if key is not None:
            groups.setdefault(key, []).append(variant)
    out: dict[str, dict] = {}
    for members in list(groups.values())[:MAX_ESTIMATE_GROUPS]:
        # Die erste Variante mit gültigen Druckdateien steht für die Gruppe - geschätzt wird je Gruppe einmal.
        estimate = None
        for variant in members:
            line = await _variant_line(db, product, variant, mappings[variant["id"]])
            if line is not None:
                estimate = await estimate_variant(db, product, variant, mappings[variant["id"]], provider=provider,
                                                  line=line)
                break
        if estimate is None:
            continue
        for variant in members:
            out[variant["id"]] = {**estimate,
                                  "catalog_net_cents": shop_costs.cost_cents(product, mappings[variant["id"]])}
    return out


async def refresh_estimates(db, product_id: str, *, provider: FulfillmentProvider, actor_id: str) -> dict:
    """Schritt 4 „Brutto bei Printful schätzen“: die Schätzungen eines Produkts neu holen und speichern. Ändert keine
    Entscheidung der Finanzen (der Mitgliederpreis bleibt bis „Preise übernehmen“)."""
    product = await shop_catalog.get_product(db, product_id)
    if not product:
        raise LookupError("Produkt nicht gefunden.")
    if not (product.get("printful") or {}).get("product_id"):
        raise ShopError("Ohne Printful-Produkt gibt es nichts zu schätzen.")
    variants = await shop_catalog.variants_of(db, product_id)
    mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
    estimates = await estimates_for(db, product, variants, mappings, provider=provider)
    async with shop_catalog.product_lock(db, product_id, wait_seconds=5.0):
        for variant_id, estimate in estimates.items():
            await shop_catalog.set_catalog_mapping(db, variant_id, {"gross_estimate": estimate}, actor_id=actor_id)
    offered = [variant for variant in variants if variant.get("active") and variant["id"] in mappings]
    return {"estimated": len(estimates), "offered": len(offered),
            "detail": (f"{len(estimates)} von {len(offered)} Varianten brutto geschätzt." if estimates else
                       "Keine Schätzung möglich - Druckdateien erzeugen (Schritt 3), Schlüssel und öffentliche Adresse "
                       "prüfen.")}


# ---------------------------------------------------------------- An der Kasse (#1712, #1714)

async def quote_cart(db, lines: list, *, provider: FulfillmentProvider | None, country: str, zip_code: str,
                     buyer_kind: str = "member") -> dict:
    """Der Betrag an der Kasse vor dem Bestellen: eine Schätzung für den ganzen Warenkorb (Grunddateien je Fläche,
    ein Gamertag ändert den Preis nicht) - derselbe Betrag, den ``place_order`` danach mit den eigenen Dateien
    einfriert. Ohne Printful der Rückfall wie in der Bestellung (übernommener Preis plus Ersatzpauschale; fehlt die,
    ``ShopError``). Nimmt nur Variante und Menge (wie der Warenkorb), nie einen Preis."""
    from services import shop_orders

    clean = shop_orders._lines(lines, consent=False)
    shop_config.check_shipping_country(country)
    config = await shop_config.load(db)
    rows, drafts = [], []
    for position, line in enumerate(clean, start=1):
        variant = await shop_catalog.get_variant(db, line["variant_id"])
        product = await shop_catalog.get_product(db, variant["product_id"]) if variant else None
        if (not variant or not product or not variant.get("active") or variant.get("blocked_reason")
                or product.get("status") != "active"):
            raise ShopError(f"Position {position}: {shop_print_files.NOT_ORDERABLE}")
        mapping = await shop_catalog.printful_variant_for(db, variant["id"]) or {}
        unit = variant.get("price_cents") if variant.get("price_cents") is not None else product.get("base_price_cents")
        if unit is None:
            raise ShopError(f"Position {position}: {shop_print_files.NOT_ORDERABLE}")
        rows.append({"variant_id": variant["id"], "quantity": line["quantity"], "unit_price_cents": int(unit),
                     "markup_cents": shop_config.markup_cents(config, buyer_kind, product)})
        drafts.append(await _variant_line(db, product, variant, mapping, line["quantity"])
                      if provider is not None and mapping.get("printful_variant_id") else None)
    markup = sum(row["quantity"] * row["markup_cents"] for row in rows)
    parts = None
    if provider is not None and all(drafts):
        try:
            parts = await _estimate(provider, tuple(drafts), {"country": country, "zip": zip_code})
        except (FulfillmentError, EstimateUnusable) as exc:
            logger.warning("[shop-pricing] cart estimate failed, fallback: reason=%s",
                           log_safe(getattr(exc, "reason", str(exc))))
    if parts is not None:
        shares = breakdown(parts, _weights(rows))
        out_lines = [{"variant_id": row["variant_id"], "quantity": row["quantity"],
                      "line_total_cents": share["gross_cents"] + row["quantity"] * row["markup_cents"]}
                     for row, share in zip(rows, shares["lines"])]
        return {"source": SOURCE_ESTIMATE, "lines": out_lines, "items_cents": shares["goods_gross_cents"],
                "shipping_cents": shares["shipping"]["gross_cents"], "fees_cents": shares["fees"]["gross_cents"],
                "tax_cents": parts["tax_cents"], "markup_cents": markup, "total_cents": parts["total_cents"] + markup}
    shipping = shop_config.shipping_cents(config, None)
    items = sum(row["quantity"] * row["unit_price_cents"] for row in rows)
    return {"source": SOURCE_FALLBACK,
            "lines": [{"variant_id": row["variant_id"], "quantity": row["quantity"],
                       "line_total_cents": row["quantity"] * (row["unit_price_cents"] + row["markup_cents"])}
                      for row in rows],
            "items_cents": items, "shipping_cents": shipping, "fees_cents": 0, "tax_cents": None,
            "markup_cents": markup, "total_cents": items + markup + shipping}


# ---------------------------------------------------------------- Je Bestellung

async def order_lines(db, items: list[dict]) -> tuple[DraftLine, ...] | None:
    """Die Positionen einer Bestellung, wie sie an Printful gingen: Variante, Menge, je Fläche die eingefrorene
    Druckdatei mit ihrer öffentlichen Adresse. ``None``, wenn eine Position keine Printful-Variante oder keine Datei
    hat (alte Produkte ohne Druckvorlage) oder eine Adresse nicht https ist."""
    lines = []
    for item in items:
        printful = item.get("printful") or {}
        files = item.get("print_files") or []
        if not printful.get("variant_id") or not files:
            return None
        places = []
        for frozen in files:
            row = await db.shop_print_files.find_one({"id": frozen.get("file_id")}, {"_id": 0})
            url = shop_print_files.public_url(row) if row and not row.get("public_disabled_at") else None
            try:
                places.append(Placement(placement=frozen["printful_placement"], technique=frozen["technique"],
                                        file_url=url))
            except (KeyError, TypeError, ValueError):
                return None
        try:
            lines.append(DraftLine(variant=CatalogVariantId(int(printful["variant_id"])),
                                   quantity=int(item["quantity"]), placements=tuple(places)))
        except (TypeError, ValueError):
            return None
    return tuple(lines) or None


async def _estimate(provider: FulfillmentProvider, lines: tuple[DraftLine, ...], address: dict) -> dict:
    """Schätzung für Positionen und Lieferanschrift (nur Land und PLZ). Wirft ``FulfillmentError`` bzw.
    ``EstimateUnusable``."""
    try:
        costs = await provider.estimate_costs(lines, country_code=str(address.get("country") or ""),
                                              zip_code=str(address.get("zip") or ""))
    except ValueError as exc:  # PLZ in einer Form, die Printful nicht nimmt
        raise EstimateUnusable("PLZ") from exc
    return split(costs)


def _weights(items: list[dict]) -> list[int]:
    return [int(item["quantity"]) * max(int(item.get("unit_price_cents") or 0), 1) for item in items]


async def order_prices(db, items: list[dict], *, provider: FulfillmentProvider | None,
                       shipping_address: dict) -> dict | None:
    """Brutto für die eingefrorenen Positionen einer neuen Bestellung - eine Schätzung für den ganzen Warenkorb.
    ``None`` heißt Rückfall (kein Anbieter, keine Dateien, Printful nicht erreichbar oder Schätzung unbrauchbar)."""
    if provider is None:
        return None
    lines = await order_lines(db, items)
    if lines is None:
        return None
    try:
        parts = await _estimate(provider, lines, shipping_address)
    except (FulfillmentError, EstimateUnusable) as exc:
        logger.warning("[shop-pricing] order estimate failed, fallback: reason=%s",
                       log_safe(getattr(exc, "reason", str(exc))))
        return None
    return {"parts": parts, "shares": breakdown(parts, _weights(items)), "estimated_at": now_utc().isoformat(),
            "country": shipping_address.get("country")}


def apply_order_prices(items: list[dict], priced: dict) -> None:
    """Die Anteile in die Positionen: ``gross`` (netto, Steuer, brutto der Zeile), Zeilensumme brutto plus Aufschlag,
    Einzelpreis gerundet (maßgeblich ist die Zeilensumme)."""
    for item, share in zip(items, priced["shares"]["lines"]):
        quantity = int(item["quantity"])
        item["gross"] = dict(share)
        item["unit_price_cents"] = (share["gross_cents"] + quantity // 2) // quantity
        item["line_total_cents"] = share["gross_cents"] + quantity * int(item["markup_cents"])


def frozen_prices(priced: dict, markup_cents: int) -> dict:
    """Was die Bestellung bei einer Schätzung einfriert: Ware, Versand, Zusatzkosten brutto und die Teile von Printful
    (netto, Steuer, Gesamt) samt Zeitpunkt."""
    parts, shares = priced["parts"], priced["shares"]
    return {
        "items_cents": shares["goods_gross_cents"], "shipping_cents": shares["shipping"]["gross_cents"],
        "fees_cents": shares["fees"]["gross_cents"], "shipping_source": "estimate",
        "total_cents": parts["total_cents"] + markup_cents, "price_source": SOURCE_ESTIMATE,
        "printful_costs": {**parts, "estimated_at": priced["estimated_at"], "country": priced["country"]},
        "tax_shares": {"goods_cents": sum(line["tax_cents"] for line in shares["lines"]),
                       "shipping_cents": shares["shipping"]["tax_cents"], "fees_cents": shares["fees"]["tax_cents"]},
    }


def printful_amount(order: dict) -> int:
    """Was der Verein für diese Bestellung an Printful zu zahlen erwartet: der eingefrorene Gesamtbetrag von Printful,
    bei Rückfall und älteren Bestellungen das Gesamt ohne Vereinsaufschlag."""
    frozen = order.get("frozen") or {}
    costs = frozen.get("printful_costs") or {}
    if _amount(costs.get("total_cents")):
        return costs["total_cents"]
    return int(frozen.get("total_cents") or 0) - int(frozen.get("markup_cents") or 0)


# ---------------------------------------------------------------- Vor dem Auslösen (#1718)

async def recheck_before_release(db, order_id: str, *, provider: FulfillmentProvider, actor_id: str) -> dict:
    """Nach dem Zahlungseingang, vor dem Auslösen bei Printful: neu schätzen und mit dem eingefrorenen Betrag
    vergleichen. Liefert die Entscheidung:

    - ``release``: auslösen. Höchstens um die Toleranz teurer (der Verein trägt das) oder günstiger (die Differenz
      bleibt beim Verein - keine Rückbuchung).
    - ``hold``: teurer als die Toleranz - Stand „Preis geändert“, die Leitung entscheidet. Nichts geht hinaus.
    - ``retry``: Printful gerade nicht erreichbar oder Schätzung unbrauchbar - später erneut, nichts geändert.
    - ``blocked``: die Bestellung lässt sich so nicht schätzen (Druckdatei fehlt, Printful lehnt die Daten ab) - die
      Leitung muss nachsehen; der Stand bleibt.

    Jede Prüfung steht als Ereignis an der Bestellung (``order.price_checked`` bzw. ``order.price_changed``) und als
    ``price_check`` an der Bestellung. Diese Funktion löst nichts aus - sie ist das Tor davor."""
    from services import shop_orders

    order = await shop_orders.get_order(db, order_id)
    if not order:
        raise LookupError("Bestellung nicht gefunden.")
    if order.get("status") == STATUS_PRICE_CHANGED:
        return {"decision": "hold", "reason": "Die Bestellung wartet schon auf die Leitung (Preis geändert).",
                **(order.get("price_check") or {})}
    tolerance = (await shop_config.load(db))["price_tolerance_cents"]
    frozen_cents = printful_amount(order)
    items = await shop_orders.items_for(db, order_id)
    lines = await order_lines(db, items)
    if lines is None:
        return {"decision": "blocked", "reason": "Die Bestellung lässt sich nicht schätzen: Druckdatei oder "
                                                 "Printful-Variante fehlt.", "frozen_cents": frozen_cents}
    try:
        parts = await _estimate(provider, lines, order.get("shipping_address") or {})
    except FulfillmentInvalid as exc:
        return {"decision": "blocked", "reason": exc.text, "frozen_cents": frozen_cents}
    except (FulfillmentError, EstimateUnusable) as exc:
        return {"decision": "retry", "reason": getattr(exc, "text", "Die Schätzung von Printful passt nicht zusammen."),
                "frozen_cents": frozen_cents}
    difference = parts["total_cents"] - frozen_cents
    hold = difference > tolerance
    check = {"at": now_utc().isoformat(), "decision": "hold" if hold else "release", "frozen_cents": frozen_cents,
             "estimate_cents": parts["total_cents"], "difference_cents": difference, "tolerance_cents": tolerance,
             "estimate": parts, "club_keeps_cents": max(0, -difference), "club_bears_cents": max(0, difference)}
    update: dict = {"price_check": check, "updated_at": check["at"]}
    if hold:
        update["status"] = STATUS_PRICE_CHANGED
    await db.shop_orders.update_one({"id": order_id, "status": {"$ne": STATUS_PRICE_CHANGED}}, {"$set": update})
    event = {key: check[key] for key in ("frozen_cents", "estimate_cents", "difference_cents", "tolerance_cents")}
    await shop_orders.append_event(db, order_id, "order.price_changed" if hold else "order.price_checked",
                                   actor_id=actor_id, data=event)
    if hold:
        logger.warning("[shop-pricing] order held for review: order=%s difference=%s", log_safe(order_id),
                       log_safe(difference))
    return check


# ---------------------------------------------------------------- Rechnung (#1717)

def _line(kind: str, label: str, quantity: int, amount: int, tax: int | None = None) -> dict:
    return {"kind": kind, "label": label, "quantity": quantity, "total_cents": amount,
            "unit_cents": amount // quantity if quantity and amount % quantity == 0 else None, "tax_cents": tax}


def invoice_lines(order: dict, items: list[dict], *, show_tax: bool = False) -> list[dict]:
    """Rechnungspositionen mit den eingefrorenen Beträgen: Ware je Artikel, Versand, Zusatzkosten (nur wenn größer 0)
    und - nur mit ``show_tax`` - eine eigene Steuerzeile (dann Ware und Versand netto). Ob Steuer ausgewiesen wird,
    entscheidet #1701 („Steuer geklärt“); bis dahin ``show_tax=False``: Bruttobeträge ohne eigenen Steuerausweis.
    Bestellungen ohne Schätzung (Rückfall, ältere) kennen keine Steuer - dort gilt immer brutto. Die Summe der Zeilen
    ist immer genau der eingefrorene Gesamtbetrag."""
    frozen = order.get("frozen") or {}
    gross = frozen.get("price_source") == SOURCE_ESTIMATE and all(item.get("gross") for item in items)
    show_tax = bool(show_tax and gross)
    out = []
    for item in sorted(items, key=lambda row: row.get("position") or 0):
        variant = item.get("variant_display") or item.get("variant_label") or ""
        label = f"{item.get('product_title') or 'Artikel'} - {variant}"
        quantity = int(item["quantity"])
        markup = quantity * int(item.get("markup_cents") or 0)
        if gross:
            share = item["gross"]
            amount = (share["net_cents"] if show_tax else share["gross_cents"]) + markup
            out.append(_line("item", label.strip(" -"), quantity, amount, share["tax_cents"] if show_tax else None))
        else:
            out.append(_line("item", label.strip(" -"), quantity, int(item["line_total_cents"])))
    costs, taxes = frozen.get("printful_costs") or {}, frozen.get("tax_shares") or {}
    shipping = costs.get("shipping_cents", 0) if show_tax else int(frozen.get("shipping_cents") or 0)
    out.append(_line("shipping", "Versand", 1, shipping, taxes.get("shipping_cents") if show_tax else None))
    fees = costs.get("fees_cents", 0) if show_tax else int(frozen.get("fees_cents") or 0)
    if fees:
        out.append(_line("fees", "Zusatzkosten Printful", 1, fees, taxes.get("fees_cents") if show_tax else None))
    if show_tax:
        out.append(_line("tax", "Steuer laut Printful", 1, int(costs.get("tax_cents") or 0)))
    total = sum(line["total_cents"] for line in out)
    if total != int(frozen.get("total_cents") or 0):
        raise ShopError("Rechnungspositionen ergeben nicht den eingefrorenen Gesamtbetrag.")
    return out
