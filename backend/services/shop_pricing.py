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
- **An der Kasse** (``shop_orders.quote_cart`` → ``quote_lines``, für #1712/#1714): derselbe Betrag vor dem Bestellen.
- **Vor dem Auslösen** (``shop_orders.recheck_before_release`` → ``assess``, für #1718): nach dem Zahlungseingang neu
  schätzen. Teurer um mehr
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

import asyncio
import logging
from typing import Any

from models import now_utc
from services import shop_catalog, shop_config, shop_costs, shop_designs, shop_options, shop_print_files
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
    """Mitgliederpreis je Stück: Printful brutto (Ware) aus der Schätzung (``estimate``). Gab es eine Schätzung, die
    nicht mehr zum Einkauf passt, ist der Preis unbekannt (``stale``, ``None``) - nie still der Katalog netto. Nur wenn
    nie geschätzt wurde, gilt als Rückfall der Katalog netto (``catalog``)."""
    estimate = current_estimate(product, mapping)
    if estimate:
        return estimate["goods_gross_cents"], "estimate"
    if isinstance((mapping or {}).get("gross_estimate"), dict):
        return None, "stale"
    return shop_costs.cost_cents(product, mapping), "catalog"


NOTE_NET = "Katalogpreis ohne Steuer - genauer Betrag an der Kasse"


def display_price(config: dict, product: dict, variant: dict, mapping: dict | None, *,
                  buyer_kind: str = "member") -> dict:
    """Angezeigter Preis auf Produktseite und Warenkorb (#1712): brutto je Stück plus Aufschlag (nur öffentlich), mit
    dem Hinweis „zzgl. Versand, genauer Betrag an der Kasse“. Ohne aktuelle Schätzung der übernommene Preis -
    gekennzeichnet (``stale``) und mit seiner Grundlage (``basis``: ``brutto`` oder ``netto``), nie Netto als
    Brutto."""
    printful = bool(product.get("printful"))
    estimate = current_estimate(product, mapping) if printful else None
    unit = estimate["goods_gross_cents"] if estimate else variant.get("price_cents")
    if unit is None:
        unit = product.get("base_price_cents")
    if estimate or not printful or variant.get("price_source") == "estimate":
        basis = "brutto"
    else:
        basis = "netto"  # Katalog netto übernommen (nie geschätzt) bzw. ältere Preise ohne Herkunft
    markup = shop_config.markup_cents(config, buyer_kind, product)
    return {"price_cents": unit + markup if isinstance(unit, int) else None, "markup_cents": markup,
            "source": "estimate" if estimate else "accepted", "basis": basis,
            "stale": printful and estimate is None and isinstance((mapping or {}).get("gross_estimate"), dict),
            "estimated_at": (estimate or {}).get("estimated_at"),
            "shipping_example_cents": (estimate or {}).get("shipping_gross_cents"),
            "note": PRICE_NOTE if basis == "brutto" else NOTE_NET}


async def _variant_line(db, product: dict, variant: dict, mapping: dict, quantity: int = 1) -> DraftLine | None:
    """Ein Stück dieser Variante mit den Grunddateien je Fläche. Eine reine Platzhalter-Fläche (Gamertag, Nummer)
    bekommt für die Schätzung die Adresse einer anderen Grunddatei - für den Preis zählen nur Fläche und Technik."""
    places = await shop_print_files.base_placements(db, product, variant,
                                                    printful_variant_id=mapping.get("printful_variant_id"))
    if not places:
        return None
    try:
        # Pflichtoptionen von Printful (#2158), etwa die Nahtfarbe - ohne sie lehnt Printful die Schätzung ab.
        options = shop_options.line_options(product)
    except ShopError:
        return None
    spare = next((place["url"] for place in places if place["url"]), None)
    try:
        return DraftLine(variant=CatalogVariantId(int(mapping["printful_variant_id"])), quantity=quantity,
                         placements=tuple(Placement(placement=place["placement"], technique=place["technique"],
                                                    file_url=place["url"] or spare) for place in places),
                         options=options)
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
    """Hat die Website eine öffentliche https-Adresse (``PUBLIC_BACKEND_URL``)? Sonst kann Printful nichts schätzen."""
    return shop_designs._public_base_url().startswith("https://")


def _group_key(mapping: dict) -> tuple | None:
    base = mapping.get("base_cost_cents")
    if not _amount(base) or not base:
        return None
    return (mapping.get("technique"), base, tuple(sorted((mapping.get("placement_costs") or {}).items())))


# Wie Schätzungen laufen (#2135, B5). Im Admin (Knopf, Abgleich von Hand) parallel mit Grenze und Zeitbudget - die
# Anfrage bleibt so unter Proxy-Zeitgrenzen (nginx 60 s); was nicht fertig wird, bleibt „offen“ und kommt beim nächsten
# Klick. Der tägliche Abgleich schätzt nacheinander mit Pause und lässt dem gemeinsamen Rate-Limit des Adapters
# (100 von 120 Aufrufen je Minute) Luft für Schätzungen an der Kasse.
INTERACTIVE = {"concurrency": 4, "deadline_seconds": 40.0, "pause_seconds": 0.0}
BACKGROUND = {"concurrency": 1, "deadline_seconds": None, "pause_seconds": 1.0}


async def estimates_for(db, product: dict, variants: list[dict], mappings: dict[str, dict], *,
                        provider: FulfillmentProvider, budget: dict | None = None) -> tuple[dict[str, dict], int]:
    """Schätzungen für die angebotenen Varianten - je Preisgruppe (gleicher Einkauf und gleiche Aufpreise laut
    Katalog) eine, höchstens ``MAX_ESTIMATE_GROUPS``, nach ``budget`` (``INTERACTIVE`` oder ``BACKGROUND``). Liefert
    (Variante → Schätzung, Zahl der offenen Gruppen) - nur, was geklappt hat. Ohne öffentliche https-Adresse der Website
    holt Printful keine Druckdatei - dann gar nicht erst rechnen."""
    budget = {**INTERACTIVE, **(budget or {})}
    if not public_https():
        return {}, 0
    groups: dict[tuple, list[dict]] = {}
    for variant in variants:
        mapping = mappings.get(variant["id"])
        key = _group_key(mapping) if variant.get("active") and mapping else None
        if key is not None:
            groups.setdefault(key, []).append(variant)
    chosen = list(groups.values())[:MAX_ESTIMATE_GROUPS]
    # Erst ohne Printful die Vertreter je Gruppe: die erste Variante mit gültigen Druckdateien.
    planned = []
    for members in chosen:
        for variant in members:
            line = await _variant_line(db, product, variant, mappings[variant["id"]])
            if line is not None:
                planned.append((members, variant, line))
                break
    gate = asyncio.Semaphore(max(1, int(budget["concurrency"])))

    async def run(members, variant, line):
        async with gate:
            if budget["pause_seconds"]:
                await asyncio.sleep(budget["pause_seconds"])
            return members, await estimate_variant(db, product, variant, mappings[variant["id"]], provider=provider,
                                                   line=line)

    tasks = [asyncio.ensure_future(run(*entry)) for entry in planned]
    pending: set = set()
    if tasks:
        done, pending = await asyncio.wait(tasks, timeout=budget["deadline_seconds"])
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
            logger.warning("[shop-pricing] estimates out of time: product=%s open=%d", log_safe(product.get("id")),
                           len(pending))
    out: dict[str, dict] = {}
    for task in tasks:
        if task in pending or task.cancelled() or task.exception() is not None:
            continue
        members, estimate = task.result()
        if estimate is None:
            continue
        for variant in members:
            out[variant["id"]] = {**estimate,
                                  "catalog_net_cents": shop_costs.cost_cents(product, mappings[variant["id"]])}
    return out, len(pending)


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
    estimates, open_groups = await estimates_for(db, product, variants, mappings, provider=provider,
                                                 budget=INTERACTIVE)
    async with shop_catalog.product_lock(db, product_id, wait_seconds=5.0):
        for variant_id, estimate in estimates.items():
            await shop_catalog.set_catalog_mapping(db, variant_id, {"gross_estimate": estimate}, actor_id=actor_id)
    offered = [variant for variant in variants if variant.get("active") and variant["id"] in mappings]
    detail = (f"{len(estimates)} von {len(offered)} Varianten brutto geschätzt." if estimates else
              "Keine Schätzung möglich - Druckdateien erzeugen (Schritt 3), Schlüssel und öffentliche Adresse prüfen.")
    if open_groups:
        detail += f" {open_groups} Preisgruppe(n) noch offen - bitte noch einmal schätzen."
    return {"estimated": len(estimates), "offered": len(offered), "open": open_groups, "detail": detail}


# ---------------------------------------------------------------- An der Kasse (#1712, #1714)

async def estimate_rows(db, rows: list[dict], *, provider: FulfillmentProvider | None, address: dict) -> dict | None:
    """Die gemeinsame Grundlage von Kasse und Bestellung (#2135): je Position die Grunddateien der Variante
    (``_variant_line``, eine reine Platzhalter-Fläche borgt die Adresse einer Grunddatei; ein Gamertag ändert den Preis
    nicht) samt Pflichtoptionen, eine Schätzung für den ganzen Warenkorb. ``rows`` aus der Vorprüfung
    (``shop_orders._checked_line``). ``None`` heißt Rückfall - für Kasse und Bestellung gleich."""
    if provider is None:
        return None
    lines = []
    for row in rows:
        mapping = row.get("mapping") or {}
        if not row["product"].get("printful") or not mapping.get("printful_variant_id"):
            return None
        line = await _variant_line(db, row["product"], row["variant"], mapping, int(row["quantity"]))
        if line is None:
            return None
        lines.append(line)
    try:
        parts = await _estimate(provider, tuple(lines), address)
    except (FulfillmentError, EstimateUnusable) as exc:
        logger.warning("[shop-pricing] cart estimate failed, fallback: reason=%s",
                       log_safe(getattr(exc, "reason", str(exc))))
        return None
    return {"parts": parts, "shares": breakdown(parts, _weights(rows)), "estimated_at": now_utc().isoformat(),
            "country": address.get("country")}


async def quote_lines(db, rows: list[dict], *, provider: FulfillmentProvider | None, country: str, zip_code: str,
                      config: dict, shipping_estimate_cents: int | None = None) -> dict:
    """Der Betrag an der Kasse vor dem Bestellen (Aufruf über ``shop_orders.quote_cart``, das die Positionen wie die
    Bestellung prüft): ``estimate_rows`` wie ``place_order``, sonst derselbe Rückfall (übernommener Preis, Versand aus
    ``shipping_estimate_cents`` oder Ersatzpauschale; fehlt beides, ``ShopError``)."""
    markup = sum(row["quantity"] * row["markup_cents"] for row in rows)
    priced = await estimate_rows(db, rows, provider=provider, address={"country": country, "zip": zip_code})
    if priced is not None:
        parts, shares = priced["parts"], priced["shares"]
        out_lines = [{"variant_id": row["variant"]["id"], "quantity": row["quantity"],
                      "line_total_cents": share["gross_cents"] + row["quantity"] * row["markup_cents"]}
                     for row, share in zip(rows, shares["lines"])]
        return {"source": SOURCE_ESTIMATE, "lines": out_lines, "items_cents": shares["goods_gross_cents"],
                "shipping_cents": shares["shipping"]["gross_cents"], "fees_cents": shares["fees"]["gross_cents"],
                "tax_cents": parts["tax_cents"], "markup_cents": markup, "total_cents": parts["total_cents"] + markup}
    shipping = shop_config.shipping_cents(config, shipping_estimate_cents)
    items = sum(row["quantity"] * row["unit_price_cents"] for row in rows)
    return {"source": SOURCE_FALLBACK,
            "lines": [{"variant_id": row["variant"]["id"], "quantity": row["quantity"],
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
            options = tuple((row["name"], row["value"]) for row in item.get("product_options") or [])
            lines.append(DraftLine(variant=CatalogVariantId(int(printful["variant_id"])),
                                   quantity=int(item["quantity"]), placements=tuple(places), options=options))
        except (KeyError, TypeError, ValueError):
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


def _weights(rows: list[dict]) -> list[int]:
    """Gewicht je Position für die Aufteilung der Ware (#2135, B4): Menge × Ware netto aus der aktuellen Schätzung der
    Variante, sonst Menge × übernommener Preis. Maßgeblich für Rechnung und Zahlung bleibt die Zeilensumme."""
    out = []
    for row in rows:
        estimate = current_estimate(row["product"], row.get("mapping")) if row.get("product") else None
        unit = (estimate or {}).get("goods_net_cents") or row.get("unit_price_cents") or 0
        out.append(int(row["quantity"]) * max(int(unit), 1))
    return out


async def order_prices(db, rows: list[dict], *, provider: FulfillmentProvider | None,
                       shipping_address: dict) -> dict | None:
    """Brutto für eine neue Bestellung - ``estimate_rows`` mit der Vorprüfung der Positionen, dieselbe Grundlage wie an
    der Kasse. ``None`` heißt Rückfall (kein Anbieter, keine Grunddatei mit https-Adresse, Printful nicht erreichbar
    oder Schätzung unbrauchbar)."""
    return await estimate_rows(db, rows, provider=provider, address=shipping_address)


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

async def assess(db, order: dict, items: list[dict], *, provider: FulfillmentProvider) -> dict:
    """Nach dem Zahlungseingang, vor dem Auslösen bei Printful: neu schätzen und mit dem eingefrorenen Betrag
    vergleichen (Aufruf über ``shop_orders.recheck_before_release``, das Stand und Ereignis schreibt). Liefert die
    Entscheidung:

    - ``release``: auslösen. Höchstens um die Toleranz teurer (der Verein trägt das) oder günstiger (die Differenz
      bleibt beim Verein - keine Rückbuchung).
    - ``hold``: teurer als die Toleranz - Stand „Preis geändert“, die Leitung entscheidet. Nichts geht hinaus.
    - ``retry``: Printful gerade nicht erreichbar oder Schätzung unbrauchbar - später erneut, nichts geändert.
    - ``blocked``: die Bestellung lässt sich so nicht schätzen (Druckdatei fehlt, Printful lehnt die Daten ab) - die
      Leitung muss nachsehen; der Stand bleibt.

    Schreibt nichts und löst nichts aus - es ist das Tor davor."""
    tolerance = (await shop_config.load(db))["price_tolerance_cents"]
    frozen_cents = printful_amount(order)
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
    return {"at": now_utc().isoformat(), "decision": "hold" if hold else "release", "frozen_cents": frozen_cents,
            "estimate_cents": parts["total_cents"], "difference_cents": difference, "tolerance_cents": tolerance,
            "estimate": parts, "club_keeps_cents": max(0, -difference), "club_bears_cents": max(0, difference)}


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
