"""Der eine Weg zu Printful (#1705): API v2, feste Wege, Fehlerklassen, Entwurf und Bestätigung getrennt.

Umsetzung der Schnittstelle aus ``services/shop_fulfillment.py``. Vertrag und Fake: ``tests/contracts/printful/`` und
``tests/printful_fake.py``; Doku: ``docs/SHOP.md`` (Abschnitt „Printful-Adapter“).

Warum API v2 (Stand 27.10.2026 noch „Open Beta“, laut Printful für den Betrieb freigegeben):
- ``POST /v2/orders`` legt **immer** einen Entwurf an; bestätigt wird nur über ``POST /v2/orders/{id}/confirmation``.
  In v1 entscheidet ein Abfrageparameter (``confirm=true``) beim Anlegen - genau die Falle, die hier ausgeschlossen
  sein soll.
- Nur v2 signiert Webhooks (HMAC-SHA256, ``x-pf-webhook-signature``) - v1 hat keine Signatur.
- Katalog mit Druckflächen, Techniken, Preisen und Lager je Region, Kostenschätzung als Aufgabe (nur Land und PLZ),
  Mockup-Aufgaben und ``Retry-After`` sind in v2 beschrieben.

Regeln, die hier durchgesetzt werden:
- Nur ``https://api.printful.com``; jede Methode baut ihren festen Weg selbst, Nummern nur als eigene Typen, keine
  Weiterleitungen, feste Zeitgrenze.
- Der Schlüssel steht nur im Kopf ``Authorization`` - nie in einer Meldung, einer Ausnahme oder einem Log. Logs nur
  über ``services/log_safe.py``.
- Wiederholt wird nur Lesen (höchstens zweimal, nach Zeitüberschreitung, Netzfehler, 429 oder 5xx); bei 429 gilt
  ``Retry-After``. Schreiben wird nie still wiederholt - wer es noch einmal versucht, entscheidet selbst.
- Entwurf anlegen, Entwurf löschen und Druckdateien: ``shop_config.require_printful_drafts`` (Stufe ab „Nur Admins“,
  Schlüssel), auch bei ausgeschaltetem Notschalter - ein Entwurf kostet nichts. Bestätigen:
  ``shop_config.require_printful_writes`` (Notschalter und Schlüssel) und ein Idempotenzschlüssel.
"""
from __future__ import annotations

import asyncio
import email.utils
import hashlib
import hmac
import logging
import math
import re
import secrets
import time
from collections import Counter, deque
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import quote

import httpx
from pymongo.errors import DuplicateKeyError

from services import shop_config
from services.log_safe import log_safe, mask_addresses
from services.shop_fulfillment import (
    CatalogCategory, CatalogEntry, CatalogProduct, CatalogProductId, CatalogVariant, CatalogVariantId, Costs, DraftLine, DraftOrder,
    FulfillmentError, FulfillmentInvalid, FulfillmentOrder, FulfillmentPermanent, FulfillmentTransient, MockupImage,
    MockupTask, MockupTemplate, OrderItem, PLACEMENT_RE, PlacedFile, Placement, PrintArea, PrintFile, PrintfulOrderId,
    ProductPlacementInfo, Rows, TECHNIQUE_RE, check_external_id, check_https_url, is_test_external_id, require)

logger = logging.getLogger("tls.printful")

API_BASE = "https://api.printful.com"
TIMEOUT_SECONDS = 15.0
RETRY_PAUSES = (1.0, 3.0)
# Längere Wartezeiten aus ``Retry-After`` gibt der Client als Fehler zurück, statt eine Anfrage zu blockieren.
MAX_RETRY_AFTER = 30.0
# Gemeinsames Fenster für alle Clients im Prozess, je Schlüssel. Das Fenster heißt nach einer zufälligen Kennung je
# Schlüssel (nur im Speicher dieses Prozesses, nie geloggt) - kein Hash des Schlüssels.
_RATE_WINDOWS: dict[str, deque] = {}
_WINDOW_IDS: dict[str, str] = {}
PAGE_LIMIT = 100
MAX_PAGES = 20
ESTIMATE_POLLS = 10
ESTIMATE_PAUSE = 1.0
CONFIRMATIONS = "shop_printful_confirmations"
DRAFTS = "shop_printful_drafts"
# Testentwürfe aus dem Admin (#2062, services/shop_test_drafts.py): ihre Aufträge bestätigt confirm_order nie.
TEST_DRAFTS = "shop_test_drafts"
# So lange gilt ein Claim im Zustand „sending“ als „läuft noch“; danach: Entwurf erst nachsuchen, Bestätigung unklar.
CONFIRM_CLAIM_SECONDS = 300
DRAFT_CLAIM_SECONDS = 60
# So weit darf ein Stempel in der Zukunft liegen (Uhren mehrerer Server), bevor er als abgelaufen gilt.
CLOCK_SKEW_SECONDS = 60
# Schonfrist: ein angelegter Entwurf, den Printful gerade nicht findet, gilt erst nach so langer Zeit seit dem letzten
# erfolgreichen Lesen als weg - vorher ist es eher eine Verzögerung bei Printful als ein gelöschter Auftrag.
DRAFT_GONE_GRACE_SECONDS = 600
# Nur diese Antworten sind eine eindeutige Ablehnung der Bestätigung - alles andere ist ein unklarer Ausgang.
CONFIRM_REFUSED = frozenset({400, 409, 422})
IDEMPOTENCY_KEY_RE = re.compile(r"[A-Za-z0-9:_-]{8,128}")
FILENAME_RE = re.compile(r"[A-Za-z0-9._-]{1,100}")
CURRENCY_RE = re.compile(r"[A-Z]{3}")
REGION_RE = re.compile(r"[a-z_]{2,32}")
# Vorlagenbilder (#2091): Zusatzbilder braucht die Vorschau nicht - sie werden still ausgelassen, nicht als Fehler gezählt.
IGNORED_TEMPLATE_ROLES = frozenset({"extra", "advanced_template"})
PREVIEW_TEMPLATE_ROLES = frozenset({"primary", "template", "unknown"})
# So viele verschiedene Gründe für übersprungene Zeilen stehen höchstens in der Liste (gleiche zusammengefasst).
MAX_SKIP_REASONS = 12

# Printful erlaubt 120 Aufrufe je Minute und Store (manifest.json). Ein Client bleibt mit Luft darunter - für andere
# Aufrufe desselben Stores - und wartet, statt in 429 zu laufen. Gezählt wird je Client (ein Abgleich, ein Admin-Klick).
RATE_LIMIT_PER_MINUTE = 120
RATE_BUDGET_PER_MINUTE = 100
RATE_WINDOW_SECONDS = 60.0

# Nur Tests setzen einen Transport (Fake) und ersetzen Warten und Uhr.
TRANSPORT: httpx.AsyncBaseTransport | None = None
_sleep = asyncio.sleep
_clock = time.monotonic

STATUS_ERRORS = {
    400: (FulfillmentInvalid, "bad_request"), 409: (FulfillmentInvalid, "conflict"),
    422: (FulfillmentInvalid, "bad_request"),
    401: (FulfillmentPermanent, "unauthorized"), 403: (FulfillmentPermanent, "forbidden"),
    404: (FulfillmentPermanent, "not_found"),
}


def _cents(value) -> int | None:
    """``"12.50"`` → 1250. ``None`` bleibt ``None``; alles andere ist eine unerwartete Antwort."""
    if value is None:
        return None
    try:
        amount = Decimal(str(value))
    except InvalidOperation as exc:
        raise FulfillmentPermanent("invalid_response") from exc
    if not amount.is_finite():
        raise FulfillmentPermanent("invalid_response")
    return int((amount * 100).to_integral_value())


def _retry_after(response: httpx.Response) -> float | None:
    raw = (response.headers.get("Retry-After") or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"\d{1,6}(\.\d+)?", raw):
        return float(raw)
    try:
        moment = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return max(0.0, (moment - datetime.now(timezone.utc)).total_seconds())


class _RowSkip(Exception):
    """Eine Zeile einer Liste passt nicht (#2091): Feldname und erwarteter Typ - nie der Wert aus der Antwort."""

    def __init__(self, field: str, expected: str):
        super().__init__(field)
        self.field = field
        self.expected = expected

    @property
    def text(self) -> str:
        return f"Feld {self.field} fehlt oder passt nicht (erwartet: {self.expected})."


def _dig(data, *path):
    for step in path:
        if not isinstance(data, dict):
            return None
        data = data.get(step)
    return data


def _data(body, kind: type = dict):
    value = _dig(body, "data")
    if not isinstance(value, kind):
        raise FulfillmentPermanent("invalid_response")
    return value


def order_payload(draft: DraftOrder) -> dict:
    """Der Rumpf für ``POST /v2/orders`` - genau diese Felder, nichts aus einer Anfrage durchgereicht. Ein Feld zum
    Bestätigen gibt es nicht: v2 legt immer einen Entwurf an."""
    require(draft, DraftOrder, "draft")
    recipient = draft.recipient
    address = {"name": recipient.name, "address1": recipient.address1, "city": recipient.city, "zip": recipient.zip,
               "country_code": recipient.country_code}
    for optional in ("company", "address2", "state_code", "phone", "email"):
        if getattr(recipient, optional):
            address[optional] = getattr(recipient, optional)
    return {"external_id": draft.external_id, "shipping": draft.shipping, "recipient": address,
            "order_items": [_line_payload(line) for line in draft.lines]}


def _placement_payload(place: Placement) -> dict:
    return {"placement": place.placement, "technique": place.technique,
            "layers": [{"type": "file", "url": place.file_url}]}


def _line_payload(line: DraftLine) -> dict:
    require(line, DraftLine, "line")
    item = {"source": "catalog", "catalog_variant_id": line.variant.value, "quantity": line.quantity,
            "placements": [_placement_payload(place) for place in line.placements]}
    if line.external_id:
        item["external_id"] = line.external_id
    if line.name:
        item["name"] = line.name[:200]
    return item


def verify_webhook_signature(body: bytes, signature: str | None, secret_hex: str | None) -> bool:
    """Prüft ``x-pf-webhook-signature``: HMAC-SHA256 über den **unveränderten** Rumpf, Schlüssel = ``secret_key`` aus
    der Webhook-Einrichtung (Hex-Text, vorher zu Bytes). Fehlt etwas oder passt es nicht: ``False`` - nie eine
    Ausnahme, die ein Angreifer auslösen könnte. Nur ``bytes`` - ein neu serialisierter Rumpf passt nie."""
    if not isinstance(body, (bytes, bytearray)):
        raise TypeError("Den unveränderten Rumpf als bytes übergeben")
    if not signature or not secret_hex:
        return False
    try:
        key = bytes.fromhex(str(secret_hex).strip())
    except ValueError:
        return False
    if not key:
        return False
    expected = hmac.new(key, bytes(body), hashlib.sha256).hexdigest().encode("ascii")
    # Als Bytes vergleichen: ein Kopf mit Nicht-ASCII-Zeichen ist dann nur „passt nicht“, keine Ausnahme.
    return hmac.compare_digest(expected, str(signature).strip().lower().encode("utf-8"))


class PrintfulClient:
    """Umsetzung von ``shop_fulfillment.FulfillmentProvider`` für Printful API v2."""

    def __init__(self, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None,
                 store_id: int | None = None):
        if not isinstance(api_key, str) or not api_key.strip():
            raise FulfillmentPermanent("no_key")
        self._key = api_key
        self._transport = transport
        # Nur bei einem Schlüssel auf Kontoebene nötig; empfohlen ist ein Schlüssel für genau den Vereins-Store.
        if store_id is not None and (type(store_id) is not int or store_id < 1):
            raise ValueError("Store-Nummer als ganze Zahl ab 1")
        self._store_id = store_id
        # Ein Fenster je Schlüssel (= Store) für den ganzen Prozess: zwei Clients - etwa zwei gleichzeitige Abgleiche -
        # teilen sich die Aufrufe je Minute. Das Backend läuft mit einem Uvicorn-Worker (docker-entrypoint.py); dass nur
        # ein Abgleich zur Zeit läuft, sichert zusätzlich eine MongoDB-Sperre (services/shop_catalog_sync.py).
        self._window_key = _WINDOW_IDS.setdefault(api_key, secrets.token_hex(8))

    async def _throttle(self) -> None:
        """Höchstens ``RATE_BUDGET_PER_MINUTE`` Aufrufe je Schlüssel in jedem gleitenden Fenster von 60 Sekunden.

        Jeder Aufruf reserviert seinen Zeitpunkt, bevor er wartet (ohne ``await`` dazwischen): gleichzeitige Aufrufe
        bekommen so nacheinander freie Plätze, statt gemeinsam über die Grenze zu gehen."""
        sent = _RATE_WINDOWS.setdefault(self._window_key, deque())
        now = _clock()
        while sent and now - sent[0] >= RATE_WINDOW_SECONDS:
            sent.popleft()
        slot = now
        if len(sent) >= RATE_BUDGET_PER_MINUTE:
            slot = max(now, sent[-RATE_BUDGET_PER_MINUTE] + RATE_WINDOW_SECONDS)
        sent.append(slot)
        if slot > now:
            try:
                await _sleep(slot - now)
            except BaseException:
                # Abgebrochen (CancelledError) oder gescheitert, bevor der Aufruf hinausging: den reservierten Platz
                # zurückgeben - sonst bremst er spätere Aufrufe, obwohl nie etwas gesendet wurde.
                try:
                    sent.remove(slot)
                except ValueError:
                    pass  # schon aus dem Fenster gefallen
                raise

    def __repr__(self) -> str:
        return "PrintfulClient(api_key=***)"

    @classmethod
    async def from_db(cls, db) -> "PrintfulClient":
        key = await shop_config.printful_api_key(db)
        if not key:
            raise FulfillmentPermanent("no_key")
        return cls(key)

    # ------------------------------------------------ HTTP
    def _scrub(self, text) -> str:
        """Was der Anbieter sagt, als eine kurze Zeile: ohne Schlüssel, Mail-Adressen gekürzt."""
        return log_safe(mask_addresses(str(text or "").replace(self._key, "***")), 200)

    def _provider_detail(self, response: httpx.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return ""
        if not isinstance(body, dict):
            return ""
        for value in (body.get("detail"), body.get("title"), _dig(body, "error", "message"), body.get("result")):
            if isinstance(value, str) and value.strip():
                return self._scrub(value)
        return ""

    def _error_for(self, response: httpx.Response, operation: str) -> FulfillmentError:
        status = response.status_code
        if status == 429:
            return FulfillmentTransient("rate_limited", status=status, retry_after=_retry_after(response))
        if status >= 500:
            return FulfillmentTransient("server", status=status, retry_after=_retry_after(response))
        if 300 <= status < 400:
            return FulfillmentPermanent("redirect", status=status)
        cls, reason = STATUS_ERRORS.get(status, (FulfillmentPermanent, "unexpected"))
        detail = self._provider_detail(response) if cls is FulfillmentInvalid else ""
        return cls(reason, status=status, provider_detail=detail)

    async def _request(self, method: str, path: str, *, operation: str, params: dict | None = None,
                       payload: dict | None = None, retries: int | None = None, allow_confirmation: bool = False):
        """Ein Aufruf mit festem Weg. Lesen (GET) wird bis zu zweimal wiederholt, alles andere nie."""
        if path.rstrip("/").endswith("/confirmation") and not allow_confirmation:
            raise RuntimeError("Bestätigen nur über confirm_order")
        if not path.startswith("/v2/") or "//" in path or ".." in path:
            raise RuntimeError("Nur feste Wege unter /v2/")
        read = method == "GET"
        extra = (len(RETRY_PAUSES) if read else 0) if retries is None else min(max(int(retries), 0), len(RETRY_PAUSES))
        attempts = 1 + (extra if read else 0)
        headers = {"Authorization": f"Bearer {self._key}", "Accept": "application/json"}
        if self._store_id:
            headers["X-PF-Store-Id"] = str(self._store_id)
        error: FulfillmentError = FulfillmentTransient("network")
        for attempt in range(attempts):
            await self._throttle()
            try:
                async with httpx.AsyncClient(base_url=API_BASE, timeout=TIMEOUT_SECONDS, follow_redirects=False,
                                             transport=self._transport or TRANSPORT) as client:
                    response = await client.request(method, path, params=params, json=payload, headers=headers)
            except httpx.TimeoutException:
                error = FulfillmentTransient("timeout")
            except httpx.HTTPError as exc:
                error = FulfillmentTransient("network")
                logger.debug("[printful] %s: %s", log_safe(operation), log_safe(type(exc).__name__))
            else:
                if 200 <= response.status_code < 300:
                    if response.status_code == 204 or not response.content:
                        return None
                    try:
                        return response.json()
                    except ValueError as exc:
                        raise FulfillmentPermanent("invalid_response", status=response.status_code) from exc
                error = self._error_for(response, operation)
            logger.warning("[printful] %s %s: %s (%s)", log_safe(method), log_safe(operation), log_safe(error.reason),
                           log_safe(error.status))
            if not isinstance(error, FulfillmentTransient) or attempt == attempts - 1:
                break
            wait = RETRY_PAUSES[min(attempt, len(RETRY_PAUSES) - 1)]
            if error.retry_after is not None:
                if error.retry_after > MAX_RETRY_AFTER:
                    break
                wait = error.retry_after
            await _sleep(wait)
        raise error

    async def _get(self, path: str, *, operation: str, params: dict | None = None):
        return await self._request("GET", path, operation=operation, params=params)

    async def _pages(self, path: str, *, operation: str, params: dict | None = None) -> list[dict]:
        rows: list[dict] = []
        for page in range(MAX_PAGES):
            body = await self._get(path, operation=operation,
                                   params={**(params or {}), "limit": PAGE_LIMIT, "offset": page * PAGE_LIMIT})
            chunk = _data(body, list)
            rows.extend(row for row in chunk if isinstance(row, dict))
            total = _dig(body, "paging", "total")
            if len(chunk) < PAGE_LIMIT or (isinstance(total, int) and len(rows) >= total):
                break
        return rows

    # ------------------------------------------------ Verbindungstest
    async def check_connection(self) -> dict:
        """``GET /v2/stores``, genau ein lesender Aufruf. Liefert ``{"ok", "detail"}`` und wirft nie."""
        try:
            body = await self._request("GET", "/v2/stores", operation="getStores", retries=0)
            stores = _data(body, list)
        except FulfillmentError as exc:
            if exc.reason == "timeout":
                return {"ok": False, "detail": "Printful antwortet nicht (Zeitüberschreitung)."}
            if exc.reason == "network":
                return {"ok": False, "detail": "Printful ist nicht erreichbar (Netzwerk)."}
            if exc.status in (401, 403):
                return {"ok": False, "detail": f"Printful hat den Schlüssel abgelehnt ({exc.status})."}
            if exc.status:
                return {"ok": False, "detail": f"Printful antwortet mit {exc.status}."}
            return {"ok": False, "detail": "Printful antwortet, aber nicht wie erwartet."}
        count = len(stores)
        return {"ok": True, "detail": f"Verbindung steht: {count} Store{'s' if count != 1 else ''} sichtbar."}

    # ------------------------------------------------ Katalog
    async def catalog_product(self, product_id: CatalogProductId) -> CatalogProduct:
        require(product_id, CatalogProductId, "product_id")
        data = _data(await self._get(f"/v2/catalog-products/{product_id.value}", operation="getProductById"))
        if data.get("id") != product_id.value:
            raise FulfillmentPermanent("invalid_response")
        techniques = [row for row in data.get("techniques") or [] if isinstance(row, dict) and row.get("key")]
        placements = tuple(
            ProductPlacementInfo(placement=str(row.get("placement")), technique=str(row.get("technique")),
                                 width=row.get("print_area_width"), height=row.get("print_area_height"),
                                 conflicts=tuple(str(item) for item in row.get("conflicting_placements") or []))
            for row in data.get("placements") or [] if isinstance(row, dict) and row.get("placement"))
        return CatalogProduct(
            id=product_id, name=str(data.get("name") or ""), type=str(data.get("type") or ""), brand=data.get("brand"),
            model=data.get("model"), is_discontinued=data.get("is_discontinued") is True,
            techniques=tuple(str(row["key"]) for row in techniques),
            default_technique=next((str(row["key"]) for row in techniques if row.get("is_default")), None),
            placements=placements, sizes=tuple(str(size) for size in data.get("sizes") or []),
            colors=tuple((str(row.get("name")), str(row.get("value"))) for row in data.get("colors") or []
                         if isinstance(row, dict)))

    async def catalog_variants(self, product_id: CatalogProductId, *, currency: str = "EUR", region: str = "europe",
                               price_for: tuple[CatalogVariantId, ...] | None = None) -> tuple[CatalogVariant, ...]:
        """Alle Varianten eines Produkts mit Größe, Farbe, Nummer und Lager in ``region``; dazu Einkaufspreis je
        Technik und Aufpreis je Druckfläche (#1709). Je Variante ein Preisaufruf - darum mit ``price_for`` nur für die
        angebotenen Varianten (``()`` = keine Preise, ``None`` = alle). Der Client bleibt dabei unter 120 Aufrufen je
        Minute (``RATE_BUDGET_PER_MINUTE``) und wartet sonst."""
        require(product_id, CatalogProductId, "product_id")
        if not CURRENCY_RE.fullmatch(str(currency)) or not REGION_RE.fullmatch(str(region)):
            raise ValueError("Währung (EUR) oder Region (europe) ungültig")
        wanted: set[int] | None = None
        if price_for is not None:
            wanted = {require(item, CatalogVariantId, "price_for").value for item in tuple(price_for)}
        rows = await self._pages(f"/v2/catalog-products/{product_id.value}/catalog-variants",
                                 operation="getProductVariantsById")
        stock_rows = await self._pages(f"/v2/catalog-products/{product_id.value}/availability",
                                       operation="getProductStockAvailabilityById")
        stock: dict[int, str] = {}
        for row in stock_rows:
            for technique in row.get("techniques") or []:
                for selling in (technique or {}).get("selling_regions") or []:
                    if isinstance(selling, dict) and selling.get("name") == region and isinstance(row.get("catalog_variant_id"), int):
                        value = str(selling.get("availability") or "")
                        # Mehrere Techniken: „in stock“ gewinnt, sonst der erste Stand.
                        if stock.get(row["catalog_variant_id"]) != "in stock":
                            stock[row["catalog_variant_id"]] = value
        variants = []
        for row in rows:
            if row.get("catalog_product_id") != product_id.value or type(row.get("id")) is not int:
                raise FulfillmentPermanent("invalid_response")
            variant_id = CatalogVariantId(row["id"])
            availability = stock.get(variant_id.value)
            common = {"id": variant_id, "product_id": product_id, "name": str(row.get("name") or ""),
                      "size": str(row.get("size") or ""), "color": row.get("color"), "color_code": row.get("color_code"),
                      "in_stock": None if availability is None else availability == "in stock",
                      "availability": availability}
            if wanted is not None and variant_id.value not in wanted:
                variants.append(CatalogVariant(**common, currency=currency, priced=False))
                continue
            price_body = await self._get(f"/v2/catalog-variants/{variant_id.value}/prices",
                                         operation="getVariantPricesById",
                                         params={"currency": currency, "selling_region_name": region})
            prices_data = _data(price_body)
            prices = {str(item.get("technique_key")): _cents(item.get("discounted_price") or item.get("price"))
                      for item in _dig(prices_data, "variant", "techniques") or [] if isinstance(item, dict)}
            surcharges: dict[str, dict[str, int]] = {}
            for item in _dig(prices_data, "product", "placements") or []:
                if not isinstance(item, dict) or not item.get("id") or not item.get("technique_key"):
                    continue
                amount = _cents(item.get("discounted_price") or item.get("price"))
                if amount is not None:
                    surcharges.setdefault(str(item["technique_key"]), {})[str(item["id"])] = amount
            variants.append(CatalogVariant(**common, currency=str(prices_data.get("currency") or currency),
                                           prices=prices, placement_prices=surcharges))
        return tuple(variants)

    # ------------------------------------------------ Katalogliste für die Produktsuche (#2069)
    async def catalog_products(self, *, region: str = "europe") -> tuple[CatalogEntry, ...]:
        """Alle Katalogprodukte (``GET /v2/catalog-products``, seitenweise je 100) - für die Suche im Admin. Printful v2
        hat keinen Textfilter; gesucht wird lokal über Name, Marke und Modell (``services/shop_catalog_search.py``).
        ``region`` beschränkt auf Produkte, die in der Verkaufsregion lieferbar sind (Versand nur nach Österreich)."""
        if not REGION_RE.fullmatch(str(region)):
            raise ValueError("Region (europe) ungültig")
        rows = await self._pages("/v2/catalog-products", operation="getProducts",
                                 params={"selling_region_name": region})
        out = []
        for row in rows:
            if type(row.get("id")) is not int or row["id"] < 1 or not isinstance(row.get("name"), str):
                raise FulfillmentPermanent("invalid_response")
            image = row.get("image")
            try:
                image = check_https_url(image) if image else None
            except ValueError:
                image = None
            category = row.get("main_category_id")
            out.append(CatalogEntry(
                id=CatalogProductId(row["id"]), name=row["name"][:200],
                brand=str(row["brand"])[:80] if row.get("brand") else None,
                model=str(row["model"])[:80] if row.get("model") else None, type=str(row.get("type") or "")[:40],
                main_category_id=category if type(category) is int else None, image=image,
                techniques=tuple(str(item.get("key")) for item in row.get("techniques") or []
                                 if isinstance(item, dict) and item.get("key")),
                colors=len(row.get("colors") or []), sizes=len(row.get("sizes") or []),
                is_discontinued=row.get("is_discontinued") is True))
        return tuple(out)

    async def catalog_categories(self) -> tuple[CatalogCategory, ...]:
        """Die Kategorien des Katalogs (``GET /v2/catalog-categories``) - Filter der Produktsuche."""
        body = await self._get("/v2/catalog-categories", operation="getCategories")
        out = []
        for row in _data(body, list):
            if not isinstance(row, dict) or type(row.get("id")) is not int:
                continue
            parent = row.get("parent_id")
            out.append(CatalogCategory(id=row["id"], parent_id=parent if type(parent) is int else None,
                                       title=str(row.get("title") or "")[:80]))
        return tuple(out)

    # ------------------------------------------------ Druckvorgaben und Vorlagenbilder (#2069, zeilenweise seit #2091)
    # Eine Zeile, die nicht passt, wird übersprungen - nicht die ganze Antwort verworfen. Je Zeile ein kurzer Grund ohne
    # Werte aus der Antwort (nur Platzierung und Technik, wenn lesbar, Feldname und erwarteter Typ): steht in
    # ``Rows.skipped`` (Admin unter „übersprungen“) und einmal je Abruf im Log. Nur wenn mockup-styles gar keine
    # brauchbare Zeile hat, scheitert der Abruf (``no_usable_rows`` mit dem häufigsten Grund).
    @staticmethod
    def _number(value, field: str, expected: str) -> float:
        """Zahl aus int, float oder Zahl-Text (``"12.0"``) - nie bool, nie unendlich."""
        if isinstance(value, bool) or value is None:
            raise _RowSkip(field, expected)
        if isinstance(value, str):
            try:
                value = float(value.strip())
            except ValueError as exc:
                raise _RowSkip(field, expected) from exc
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise _RowSkip(field, expected)
        return float(value)

    @classmethod
    def _inches(cls, value, field: str, *, low: float = 0.1, high: float = 400.0) -> float:
        expected = f"Zahl in Zoll von {low:g} bis {high:g}"
        number = cls._number(value, field, expected)
        if not low <= number <= high:
            raise _RowSkip(field, expected)
        return number

    @classmethod
    def _pixels(cls, value, field: str, *, low: int = 0, high: int = 100_000) -> int:
        """Pixel als ganze Zahl - ``150.0`` oder ``150.4`` (gerundet) gehen auch."""
        expected = f"Pixel von {low} bis {high}"
        number = int(round(cls._number(value, field, expected)))
        if not low <= number <= high:
            raise _RowSkip(field, expected)
        return number

    @classmethod
    def _dpi(cls, value) -> int:
        expected = "ganze Zahl von 72 bis 1200"
        number = cls._number(value, "dpi", expected)
        if number != int(number) or not 72 <= number <= 1200:
            raise _RowSkip("dpi", expected)
        return int(number)

    @staticmethod
    def _row_key(value, pattern: re.Pattern, field: str, expected: str) -> str:
        if not isinstance(value, str) or not pattern.fullmatch(value):
            raise _RowSkip(field, expected)
        return value

    @staticmethod
    def _readable(row: dict) -> tuple[str | None, str | None]:
        """Platzierung und Technik einer Zeile - nur, wenn sie auf das Muster passen (keine fremden Werte), sonst None."""
        placement, technique = row.get("placement"), row.get("technique")
        return (placement if isinstance(placement, str) and PLACEMENT_RE.fullmatch(placement) else None,
                technique if isinstance(technique, str) and TECHNIQUE_RE.fullmatch(technique) else None)

    @classmethod
    def _where(cls, row: dict) -> str:
        """Platzierung und Technik einer Zeile für den Grund."""
        placement, technique = cls._readable(row)
        return f"{placement or 'unbekannte Platzierung'} ({technique or 'unbekannte Technik'})"

    @staticmethod
    def _read_row(read, row: dict):
        """Eine Zeile lesen. Scheitert sie an einem Typ, den keine Prüfung erwartet hat (Liste statt Text …), gilt sie
        ebenfalls als übersprungen - eine Zeile darf nie den ganzen Abruf mit einem Fehler 500 abbrechen."""
        try:
            return read(row)
        except _RowSkip:
            raise
        except (TypeError, ValueError, KeyError, AttributeError, OverflowError) as exc:
            raise _RowSkip("unbekannt", "Felder mit den Typen laut Printful-Schema") from exc

    @staticmethod
    def _skip_summary(kind: str, reasons: list[str], total: int, operation: str) -> tuple[str, ...]:
        """Gleiche Gründe zusammengefasst (mit Anzahl), höchstens ``MAX_SKIP_REASONS`` - und ein Log-Eintrag je Abruf."""
        if not reasons:
            return ()
        counted = Counter(reasons)
        lines = [f"{kind} {reason}" + (f" ({count}×)" if count > 1 else "")
                 for reason, count in counted.most_common(MAX_SKIP_REASONS)]
        if len(counted) > MAX_SKIP_REASONS:
            lines.append(f"{kind}: {len(counted) - MAX_SKIP_REASONS} weitere Gründe.")
        logger.warning("[printful] %s: %d von %d Zeilen übersprungen: %s", log_safe(operation), len(reasons), total,
                       log_safe(" | ".join(lines), 600))
        return tuple(lines)

    def _print_area(self, row: dict) -> PrintArea:
        placement = self._row_key(row.get("placement"), PLACEMENT_RE, "placement", "Platzierungskennung (a-z, 0-9, _)")
        technique = self._row_key(row.get("technique"), TECHNIQUE_RE, "technique", "Technik-Kennung (a-z, 0-9, -)")
        dpi = self._dpi(row.get("dpi"))
        width = self._inches(row.get("print_area_width"), "print_area_width")
        height = self._inches(row.get("print_area_height"), "print_area_height")
        styles = [item for item in row.get("mockup_styles") or [] if isinstance(item, dict)] \
            if isinstance(row.get("mockup_styles"), list) else []
        restricted = [item.get("restricted_to_variants") for item in styles]
        variant_ids = None
        if styles and all(isinstance(item, list) and item for item in restricted):
            variant_ids = tuple(sorted({value for item in restricted for value in item if type(value) is int}))
        area_type = row.get("print_area_type")
        return PrintArea(placement=placement, technique=technique, display_name=str(row.get("display_name") or "")[:80],
                         width_in=width, height_in=height, dpi=dpi,
                         area_type=area_type if isinstance(area_type, str) else None, variant_ids=variant_ids or None)

    async def print_areas(self, product_id: CatalogProductId) -> Rows:
        """Die Druckvorgaben je Platzierung und Technik: Druckbereich in Zoll und DPI
        (``GET /v2/catalog-products/{id}/mockup-styles``). Daraus folgt die exakte Pixelgröße der Druckdatei - die
        offiziellen Vorlagen von Printful sind genau so groß (Gildan 5000 vorne 12 × 16 Zoll bei 150 DPI = 1800 × 2400).
        Sind alle Ansichten einer Zeile auf Varianten beschränkt (``restricted_to_variants``), gilt die Vorgabe nur für
        diese - so kommen Größen mit eigener Fläche (Tasse 11 oz und 15 oz) zu ihrer eigenen Druckdatei."""
        require(product_id, CatalogProductId, "product_id")
        operation = "retrieveMockupStylesByProductId"
        rows = await self._pages(f"/v2/catalog-products/{product_id.value}/mockup-styles", operation=operation)
        out, reasons, incomplete, unreadable = [], [], set(), 0
        for row in rows:
            try:
                out.append(self._read_row(self._print_area, row))
            except _RowSkip as skip:
                reasons.append((self._where(row), skip.text))
                # Wem die Zeile gehört: ein Paar (Platzierung, Technik) ist damit unvollständig (#2091, Review).
                placement, technique = self._readable(row)
                if placement and technique:
                    incomplete.add((placement, technique))
                else:
                    unreadable += 1
        skipped = self._skip_summary("Druckvorgabe", [f"{where}: {text}" for where, text in reasons], len(rows),
                                     operation)
        if rows and not out:
            # Häufigster Grund über alle Platzierungen (gleiches Feld, gleicher Typ), mit einem Beispiel.
            text, count = Counter(text for _where, text in reasons).most_common(1)[0]
            example = next(where for where, item in reasons if item == text)
            raise FulfillmentPermanent("no_usable_rows", provider_detail=(
                f"Druckvorgaben (mockup-styles): keine der {len(rows)} Zeilen brauchbar. Häufigster Grund "
                f"({count} von {len(rows)}, z. B. {example}): {text}"))
        return Rows(out, skipped, incomplete, unreadable)

    def _mockup_template(self, row: dict) -> MockupTemplate | None:
        """Eine Zeile aus mockup-templates - ``None`` für Zusatzbilder (``extra``, ``advanced*``), die die Vorschau
        nicht braucht. Fehlt das Bild oder ist es nicht https, taugt die Zeile nicht für die Vorschau (die Druckfläche
        selbst kommt aus mockup-styles)."""
        role, kind = row.get("role"), row.get("template_type")
        role = role if isinstance(role, str) else None
        kind = kind if isinstance(kind, str) else None
        if role in IGNORED_TEMPLATE_ROLES or (isinstance(role, str) and role.startswith("advanced")) or kind == "advanced":
            return None
        placement = self._row_key(row.get("placement"), PLACEMENT_RE, "placement", "Platzierungskennung (a-z, 0-9, _)")
        technique = self._row_key(row.get("technique"), TECHNIQUE_RE, "technique", "Technik-Kennung (a-z, 0-9, -)")
        try:
            image = check_https_url(row.get("image_url"))
        except ValueError as exc:
            raise _RowSkip("image_url", "https-Adresse des Vorlagenbilds; ohne sie bleibt die Vorschau ohne Bild") from exc
        background = row.get("background_url")
        try:
            background = check_https_url(background) if background else None
        except ValueError:
            background = None  # nur der Hintergrund fehlt - das Vorlagenbild bleibt nutzbar
        color = row.get("background_color")
        if type(color) is int and 0 <= color <= 0xFFFFFF:
            color = f"#{color:06x}"
        elif not (isinstance(color, str) and re.fullmatch(r"#?[0-9A-Fa-f]{6}", color)):
            color = None
        elif not color.startswith("#"):
            color = f"#{color}"
        raw_ids = row.get("catalog_variant_ids")
        variant_ids = tuple(sorted({value for value in raw_ids if type(value) is int})) if isinstance(raw_ids, list) else ()
        positioning = row.get("template_positioning")
        orientation = row.get("orientation")
        return MockupTemplate(
            variant_ids=variant_ids, placement=placement, technique=technique, image_url=image,
            background_url=background, background_color=color,
            template_width=self._pixels(row.get("template_width"), "template_width", low=1),
            template_height=self._pixels(row.get("template_height"), "template_height", low=1),
            area_left=self._pixels(row.get("print_area_left"), "print_area_left", low=-100_000),
            area_top=self._pixels(row.get("print_area_top"), "print_area_top", low=-100_000),
            area_width=self._pixels(row.get("print_area_width"), "print_area_width", low=1),
            area_height=self._pixels(row.get("print_area_height"), "print_area_height", low=1),
            positioning=positioning if positioning in ("overlay", "background") else "overlay",
            orientation=orientation if orientation in ("horizontal", "vertical", "any") else "any",
            role=role if role in PREVIEW_TEMPLATE_ROLES else None)

    async def mockup_templates(self, product_id: CatalogProductId) -> Rows:
        """Vorlagenbilder je Platzierung mit der Lage des Druckbereichs darin
        (``GET /v2/catalog-products/{id}/mockup-templates``) - für die Vorschau im Admin. Bilder nur über https.
        Eine unbrauchbare Zeile kostet nur ihre Vorschau; ganz ohne Vorlagenbild bleiben die Druckflächen wählbar."""
        require(product_id, CatalogProductId, "product_id")
        operation = "getMockupTemplatesByProductId"
        rows = await self._pages(f"/v2/catalog-products/{product_id.value}/mockup-templates", operation=operation)
        out, reasons = [], []
        for row in rows:
            try:
                template = self._read_row(self._mockup_template, row)
            except _RowSkip as skip:
                reasons.append(f"{self._where(row)}: {skip.text}")
                continue
            if template is not None:
                out.append(template)
        return Rows(out, self._skip_summary("Vorlagenbild", reasons, len(rows), operation))

    # ------------------------------------------------ Kosten
    @staticmethod
    def _costs(raw) -> Costs:
        if not isinstance(raw, dict):
            raise FulfillmentPermanent("invalid_response")
        return Costs(currency=raw.get("currency"), calculation_status=str(raw.get("calculation_status") or ""),
                     subtotal_cents=_cents(raw.get("subtotal")), discount_cents=_cents(raw.get("discount")),
                     shipping_cents=_cents(raw.get("shipping")), tax_cents=_cents(raw.get("tax")),
                     vat_cents=_cents(raw.get("vat")), total_cents=_cents(raw.get("total")))

    async def estimate_costs(self, lines: tuple[DraftLine, ...], *, country_code: str, zip_code: str,
                             state_code: str = "") -> Costs:
        """Ware, Versand und Steuer für Positionen und Ziel. Hinaus gehen nur Land und PLZ - kein Name, keine
        Straße. Die Aufgabe anlegen wird nicht wiederholt; den Stand lesen schon."""
        if not isinstance(lines, tuple) or not lines:
            raise ValueError("Positionen als Tupel")
        if not re.fullmatch(r"[A-Z]{2}", str(country_code)) or not re.fullmatch(r"[A-Za-z0-9 -]{2,12}", str(zip_code)):
            raise ValueError("Land (AT) und PLZ")
        recipient = {"country_code": country_code, "zip": zip_code}
        if state_code:
            recipient["state_code"] = str(state_code)[:8]
        body = await self._request("POST", "/v2/order-estimation-tasks", operation="createOrderEstimationTask",
                                   payload={"recipient": recipient, "order_items": [_line_payload(line) for line in lines]})
        task_id = _data(body).get("id")
        if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", task_id):
            raise FulfillmentPermanent("invalid_response")
        for poll in range(ESTIMATE_POLLS):
            task = _data(await self._get("/v2/order-estimation-tasks", operation="getOrderEstimationTask",
                                         params={"id": task_id}))
            status = task.get("status")
            if status == "completed":
                return self._costs(task.get("costs"))
            if status == "failed":
                reasons = "; ".join(str(reason) for reason in task.get("failure_reasons") or [])
                raise FulfillmentInvalid("estimate_failed", provider_detail=self._scrub(reasons))
            if poll < ESTIMATE_POLLS - 1:
                await _sleep(ESTIMATE_PAUSE)
        raise FulfillmentTransient("estimate_pending")

    # ------------------------------------------------ Aufträge
    @staticmethod
    def _order_path(order: PrintfulOrderId | str) -> str:
        if type(order) is PrintfulOrderId:
            return f"/v2/orders/{order.value}"
        if isinstance(order, str):
            return f"/v2/orders/@{quote(check_external_id(order), safe='')}"
        raise TypeError("PrintfulOrderId oder external_id erwartet")

    async def get_order(self, order: PrintfulOrderId | str) -> FulfillmentOrder:
        """Stand, Positionen mit Dateien je Druckfläche und Kosten - über die Nummer oder die ``external_id``."""
        base = self._order_path(order)
        data = _data(await self._get(base, operation="getOrder"))
        if type(data.get("id")) is not int:
            raise FulfillmentPermanent("invalid_response")
        order_id = PrintfulOrderId(data["id"])
        prices = {row.get("id"): _cents(row.get("price")) for row in data.get("order_items") or [] if isinstance(row, dict)}
        rows = await self._pages(f"/v2/orders/{order_id.value}/order-items", operation="getItemsByOrderId")
        items = []
        for row in rows:
            if type(row.get("catalog_variant_id")) is not int or type(row.get("id")) is not int:
                raise FulfillmentPermanent("invalid_response")
            placements = tuple(
                PlacedFile(placement=str(place.get("placement")), technique=str(place.get("technique")),
                           file_urls=tuple(str(layer.get("url")) for layer in place.get("layers") or []
                                           if isinstance(layer, dict) and layer.get("url")),
                           status=str(place.get("status") or ""), status_explanation=str(place.get("status_explanation") or ""))
                for place in row.get("placements") or [] if isinstance(place, dict))
            items.append(OrderItem(id=row["id"], external_id=row.get("external_id"),
                                   variant_id=CatalogVariantId(row["catalog_variant_id"]),
                                   quantity=int(row.get("quantity") or 0), name=str(row.get("name") or ""),
                                   price_cents=prices.get(row["id"]), placements=placements))
        return FulfillmentOrder(id=order_id, external_id=data.get("external_id"), status=str(data.get("status") or ""),
                                shipping=str(data.get("shipping") or ""), costs=self._costs(data.get("costs")),
                                items=tuple(items))

    async def _find(self, external_id: str) -> FulfillmentOrder | None:
        try:
            return await self.get_order(external_id)
        except FulfillmentPermanent as exc:
            if exc.reason == "not_found":
                return None
            raise

    @staticmethod
    def _fresh(stamp, seconds: int, now: datetime) -> bool:
        """Ist ein Claim jünger als ``seconds``? Ein unlesbarer Stempel gilt als alt, ebenso einer, der mehr als
        ``CLOCK_SKEW_SECONDS`` in der Zukunft liegt - eine vorgehende Uhr blockierte sonst bis dahin alles. Danach wird
        ohnehin erst nachgesehen (Entwurf) bzw. nie gesendet (Bestätigung)."""
        try:
            claimed = datetime.fromisoformat(str(stamp))
        except ValueError:
            return False
        if claimed.tzinfo is None:
            claimed = claimed.replace(tzinfo=timezone.utc)
        age = now - claimed
        return -timedelta(seconds=CLOCK_SKEW_SECONDS) <= age < timedelta(seconds=seconds)

    @staticmethod
    def _older_than(stamp, seconds: int, now: datetime) -> bool:
        """Liegt ``stamp`` sicher mehr als ``seconds`` zurück? Nur mit gültiger Zeit, die nicht in der Zukunft liegt -
        sonst ``False`` (lieber warten als doppelt anlegen)."""
        try:
            moment = datetime.fromisoformat(str(stamp))
        except ValueError:
            return False
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment <= now and now - moment >= timedelta(seconds=seconds)

    async def _draft_claim(self, store, external_id: str):
        """Den Claim für ``external_id`` gewinnen. Liefert ``(claim_id, None)`` - dann sendet dieser Aufruf - oder
        ``(None, auftrag)``, wenn es den Auftrag schon gibt. Sonst ``FulfillmentTransient`` (``draft_in_progress``
        bzw. ``draft_unreadable``)."""
        now = datetime.now(timezone.utc)
        try:
            inserted = await store.insert_one({"external_id": external_id, "state": "sending",
                                               "claimed_at": now.isoformat(), "printful_order_id": None})
        except DuplicateKeyError:
            earlier = await store.find_one({"external_id": external_id})
            if earlier is None:
                raise FulfillmentTransient("draft_in_progress") from None
            state, old_id = earlier.get("state"), earlier.get("printful_order_id")
            if state in ("created", "deleting") and not (type(old_id) is int and old_id >= 1):
                # Ein Merkposten ohne brauchbare Nummer: nie übernehmen - ein Mensch sieht in Printful nach.
                raise FulfillmentPermanent("draft_claim_broken") from None
            if state in ("created", "deleting"):
                # Erst die gespeicherte Nummer lesen. Gibt es den Auftrag, ist er es - auch nach einem abgebrochenen
                # Löschen, dessen DELETE nicht durchging.
                try:
                    order = await self.get_order(PrintfulOrderId(old_id))
                except FulfillmentPermanent as exc:
                    if exc.reason != "not_found":
                        raise
                    order = None
                if order is not None:
                    await store.update_one({"_id": earlier["_id"]},
                                           {"$set": {"state": "created", "seen_at": now.isoformat()}})
                    return None, order
            elif state == "sending" and self._fresh(earlier.get("claimed_at"), DRAFT_CLAIM_SECONDS, now):
                raise FulfillmentTransient("draft_in_progress") from None
            # Abgelaufen, abgelehnt, beim Löschen abgebrochen oder nicht lesbar: erst über @external_id nachsuchen.
            found = await self._find(external_id)
            if found is not None:
                await store.update_one({"_id": earlier["_id"]},
                                       {"$set": {"state": "created", "printful_order_id": found.id.value,
                                                 "seen_at": now.isoformat()}})
                return None, found
            # Ein „created“-Claim, dessen Auftrag nicht lesbar ist, kann bei Printful nur kurz verzögert sein
            # (eventual consistency): erst nach der Schonfrist seit dem letzten erfolgreichen Lesen übernehmen. Ein
            # hängendes „deleting“ (wir haben selbst gelöscht) braucht nur die doppelte Prüfung oben.
            # Nur seen_at zählt (kein Rückfall auf claimed_at): fehlt es oder ist es unbrauchbar, bleibt der Claim stehen.
            if state == "created" and not self._older_than(earlier.get("seen_at"), DRAFT_GONE_GRACE_SECONDS, now):
                raise FulfillmentTransient("draft_unreadable") from None
            taken = await store.update_one({"_id": earlier["_id"], "state": state,
                                            "claimed_at": earlier.get("claimed_at"), "printful_order_id": old_id,
                                            "seen_at": earlier.get("seen_at")},
                                           {"$set": {"state": "sending", "claimed_at": now.isoformat(),
                                                     "printful_order_id": None, "seen_at": None}})
            if taken.modified_count != 1:
                raise FulfillmentTransient("draft_in_progress") from None
            return earlier["_id"], None
        claim_id = inserted.inserted_id
        try:
            found = await self._find(external_id)
        except FulfillmentError:
            await store.update_one({"_id": claim_id, "state": "sending"}, {"$set": {"state": "failed"}})
            raise
        if found is not None:
            await store.update_one({"_id": claim_id}, {"$set": {"state": "created", "printful_order_id": found.id.value,
                                                                "seen_at": now.isoformat()}})
            return None, found
        return claim_id, None

    async def create_draft(self, db, draft: DraftOrder) -> FulfillmentOrder:
        """Einen Auftrag als **Entwurf** anlegen. Bestätigen geht hier nicht: es gibt keinen Parameter dafür, v2 legt
        immer einen Entwurf an, und der Weg zur Bestätigung ist in ``_request`` gesperrt.

        Nie zwei Aufträge zu einer ``external_id``: vor dem Senden ein Claim in ``shop_printful_drafts`` (eindeutiger
        Index). Nur wer ihn gewinnt, sendet; ein zweiter Aufruf bekommt den Auftrag oder „läuft schon“. Ein Claim ohne
        bekannten Ausgang wird nach ``DRAFT_CLAIM_SECONDS`` erst nach einer Nachsuche über ``@external_id``
        übernommen."""
        require(draft, DraftOrder, "draft")
        await shop_config.require_printful_drafts(db)
        store = db[DRAFTS]
        claim_id, existing = await self._draft_claim(store, draft.external_id)
        if existing is not None:
            return existing
        try:
            body = await self._request("POST", "/v2/orders", operation="createOrder", payload=order_payload(draft))
            data = _data(body)
            if type(data.get("id")) is not int:
                raise FulfillmentPermanent("invalid_response")
        except FulfillmentError as exc:
            if exc.status is not None and 400 <= exc.status < 500:
                # Printful hat abgelehnt, es gibt keinen Auftrag: die external_id ist wieder frei.
                await store.update_one({"_id": claim_id, "state": "sending"}, {"$set": {"state": "failed"}})
            raise
        order_id = PrintfulOrderId(data["id"])
        await store.update_one({"_id": claim_id}, {"$set": {"state": "created", "printful_order_id": order_id.value,
                                                            "seen_at": datetime.now(timezone.utc).isoformat()}})
        return await self.get_order(order_id)

    async def delete_draft(self, db, order_id: PrintfulOrderId, *, test_draft: bool = False) -> None:
        """Einen Entwurf löschen. Was kein Entwurf mehr ist, bleibt unberührt (``not_draft``) - storniert wird ein
        bestätigter Auftrag nur über einen eigenen Weg hinter dem Notschalter (#1721).

        ``test_draft=True`` (#2062): Aufräumen eines Testentwurfs geht auch bei Stufe „Aus“, solange der Schlüssel
        lesbar ist - aber nur für Aufträge, deren external_id mit ``lsw-testentwurf-`` beginnt (sonst
        ``not_test_draft``).
        Für echte Bestellungen gilt weiter ``require_printful_drafts``."""
        require(order_id, PrintfulOrderId, "order_id")
        if type(test_draft) is not bool:
            raise TypeError("test_draft ist True oder False")
        if test_draft:
            await shop_config.require_printful_key(db)
        else:
            await shop_config.require_printful_drafts(db)
        current = await self.get_order(order_id)
        if test_draft and not is_test_external_id(current.external_id):
            raise FulfillmentInvalid("not_test_draft")
        if current.status != "draft":
            raise FulfillmentInvalid("not_draft")
        # Erst den Claim auf „deleting“, dann DELETE, dann Claim weg. Bricht es dazwischen ab, prüft das nächste
        # Anlegen mit dieser external_id bei Printful nach, statt sie zu blockieren.
        store = db[DRAFTS]
        await store.update_one({"printful_order_id": order_id.value, "state": "created"}, {"$set": {"state": "deleting"}})
        try:
            await self._request("DELETE", f"/v2/orders/{order_id.value}", operation="deleteOrder")
        except FulfillmentError as exc:
            if exc.status is not None and 400 <= exc.status < 500 and exc.status != 404:
                # Printful hat abgelehnt: der Entwurf steht noch.
                await store.update_one({"printful_order_id": order_id.value, "state": "deleting"},
                                       {"$set": {"state": "created"}})
            raise
        # Der Entwurf ist weg - seine external_id darf wieder angelegt werden (Testentwürfe, #2062).
        await store.delete_one({"printful_order_id": order_id.value, "state": "deleting"})

    async def _resume_confirmation(self, store, order_id: PrintfulOrderId, key: str, *, force_after_review: bool):
        """Es gibt schon einen Claim für diesen Auftrag oder Schlüssel. Liefert ``(claim_id, None)`` - dann sendet
        dieser Aufruf (nur mit ``force_after_review``) - oder ``(None, auftrag)``. Sonst ein Fehler; nie ein stilles
        zweites Senden."""
        now = datetime.now(timezone.utc)
        same_key = await store.find_one({"idempotency_key": key})
        if same_key is not None and same_key.get("order_id") != order_id.value:
            raise FulfillmentInvalid("idempotency_conflict")
        earlier = await store.find_one({"order_id": order_id.value})
        if earlier is None:
            raise FulfillmentTransient("confirm_in_progress")
        state = earlier.get("state")
        if state == "sending" and self._fresh(earlier.get("claimed_at"), CONFIRM_CLAIM_SECONDS, now):
            raise FulfillmentTransient("confirm_in_progress")
        current = await self.get_order(order_id)
        if is_test_external_id(current.external_id):
            raise FulfillmentInvalid("test_draft")
        if current.status != "draft":
            await store.update_one({"_id": earlier["_id"]}, {"$set": {"state": "confirmed", "status": current.status}})
            return None, current
        if state == "sending":
            # Abgebrochen mitten im Senden: Ausgang offen.
            moved = await store.update_one({"_id": earlier["_id"], "state": "sending",
                                            "claimed_at": earlier.get("claimed_at")}, {"$set": {"state": "unclear"}})
            if moved.modified_count != 1:
                raise FulfillmentTransient("confirm_in_progress")
            state = "unclear"
        if state not in ("unclear", "confirmed"):
            raise FulfillmentTransient("confirm_in_progress")
        # Noch Entwurf nach unklarem Ausgang (oder „bestätigt“ vermerkt, aber Printful sagt Entwurf): ein Mensch sieht
        # in Printful nach. Erneut senden nur ausdrücklich - und nur einer übernimmt.
        if not force_after_review:
            raise FulfillmentPermanent("confirm_unclear")
        taken = await store.update_one({"_id": earlier["_id"], "state": state},
                                       {"$set": {"state": "sending", "claimed_at": now.isoformat(),
                                                 "forced_by": key}})
        if taken.modified_count != 1:
            raise FulfillmentTransient("confirm_in_progress")
        return earlier["_id"], None

    async def confirm_order(self, db, order_id: PrintfulOrderId, *, idempotency_key: str,
                            force_after_review: bool = False) -> FulfillmentOrder:
        """Einen Entwurf bestätigen - **kostet Geld**, darum nur mit Notschalter an.

        Printful v2 kennt keinen Idempotenzschlüssel, darum ein Claim in ``shop_printful_confirmations`` (eindeutig je
        Auftrag und je Schlüssel). Nur wer ihn gewinnt, sendet - und nur, solange der Auftrag ein Entwurf ist.
        - Eindeutige Ablehnung (400, 409, 422): Claim frei, ein neuer Versuch darf senden.
        - Unklarer Ausgang (Zeitüberschreitung, Netz, 5xx, 429, jede andere Antwort): Claim ``unclear``. Danach wird
          nur nachgelesen: kein Entwurf mehr heißt bestätigt; noch Entwurf heißt ``confirm_unclear`` - ein Mensch prüft
          in Printful und sendet dann ausdrücklich mit ``force_after_review=True``."""
        require(order_id, PrintfulOrderId, "order_id")
        if not isinstance(idempotency_key, str) or not IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
            raise ValueError("Idempotenzschlüssel: 8 bis 128 Zeichen aus Buchstaben, Ziffern, :, - und _")
        if type(force_after_review) is not bool:
            raise TypeError("force_after_review ist True oder False")
        await shop_config.require_printful_writes(db)
        # Ein Testentwurf (#2062) wird nie bestätigt - auch nicht über einen anderen Weg als die Testansicht.
        if await db[TEST_DRAFTS].find_one({"printful_order_id": order_id.value}, {"_id": 1}):
            raise FulfillmentInvalid("test_draft")
        store = db[CONFIRMATIONS]
        try:
            inserted = await store.insert_one({"idempotency_key": idempotency_key, "order_id": order_id.value,
                                               "state": "sending",
                                               "claimed_at": datetime.now(timezone.utc).isoformat()})
        except DuplicateKeyError:
            claim_id, current = await self._resume_confirmation(store, order_id, idempotency_key,
                                                                force_after_review=force_after_review)
            if current is not None:
                return current
        else:
            claim_id = inserted.inserted_id
            try:
                current = await self.get_order(order_id)
            except FulfillmentError:
                # Nichts gesendet: Claim wieder frei.
                await store.delete_one({"_id": claim_id, "state": "sending"})
                raise
            if is_test_external_id(current.external_id):
                # Ein Testentwurf (#2062, external_id „lsw-testentwurf-…“) wird nie bestätigt - auch ohne
                # Protokollzeile.
                await store.delete_one({"_id": claim_id, "state": "sending"})
                raise FulfillmentInvalid("test_draft")
            if current.status != "draft":
                await store.update_one({"_id": claim_id}, {"$set": {"state": "confirmed", "status": current.status}})
                return current
        try:
            body = await self._request("POST", f"/v2/orders/{order_id.value}/confirmation", operation="confirmOrder",
                                       allow_confirmation=True)
            data = _data(body)
        except FulfillmentError as exc:
            if exc.status in CONFIRM_REFUSED:
                await store.delete_one({"_id": claim_id, "state": "sending"})
            else:
                await store.update_one({"_id": claim_id, "state": "sending"}, {"$set": {"state": "unclear"}})
            raise
        await store.update_one({"_id": claim_id}, {"$set": {"state": "confirmed", "status": str(data.get("status"))}})
        return await self.get_order(order_id)

    # ------------------------------------------------ Druckdateien
    @staticmethod
    def _file(data: dict) -> PrintFile:
        if type(data.get("id")) is not int:
            raise FulfillmentPermanent("invalid_response")
        return PrintFile(id=data["id"], status=str(data.get("status") or ""), url=str(data.get("url") or ""),
                         hash=data.get("hash"), filename=data.get("filename"), mime_type=data.get("mime_type"),
                         width=data.get("width"), height=data.get("height"), dpi=data.get("dpi"))

    async def add_file(self, db, url: str, *, filename: str | None = None) -> PrintFile:
        """Eine Druckdatei per https-Adresse in die Dateibibliothek legen (``role = printfile``). Printful holt sie
        selbst; ``status`` sagt, ob sie brauchbar ist (``ok``, ``waiting``, ``failed``). Gilt als Entwurfs-Aufruf."""
        check_https_url(url)
        if filename is not None and not FILENAME_RE.fullmatch(str(filename)):
            raise ValueError("Dateiname: Buchstaben, Ziffern, . _ -")
        await shop_config.require_printful_drafts(db)
        payload = {"role": "printfile", "url": url, "visible": False}
        if filename:
            payload["filename"] = filename
        return self._file(_data(await self._request("POST", "/v2/files", operation="addFile", payload=payload)))

    async def get_file(self, file_id: int) -> PrintFile:
        if type(file_id) is not int or file_id < 1:
            raise TypeError("Dateinummer als ganze Zahl")
        return self._file(_data(await self._get(f"/v2/files/{file_id}", operation="getFileById")))

    # ------------------------------------------------ Mockups (Oberfläche: #1710)
    @staticmethod
    def _mockup(data: dict) -> MockupTask:
        if type(data.get("id")) is not int:
            raise FulfillmentPermanent("invalid_response")
        images = []
        for row in data.get("catalog_variant_mockups") or []:
            if not isinstance(row, dict) or type(row.get("catalog_variant_id")) is not int:
                continue
            for image in row.get("mockups") or []:
                if isinstance(image, dict) and str(image.get("mockup_url") or "").startswith("https://"):
                    images.append(MockupImage(variant_id=CatalogVariantId(row["catalog_variant_id"]),
                                              placement=str(image.get("placement")), url=str(image["mockup_url"])))
        failures = tuple(str(_dig(item, "detail") or item) for item in data.get("failure_reasons") or [])
        return MockupTask(id=data["id"], status=str(data.get("status") or ""), mockups=tuple(images), failures=failures)

    async def create_mockup_task(self, product_id: CatalogProductId, variant_ids: tuple[CatalogVariantId, ...],
                                 placements: tuple[Placement, ...], *, format: str = "png") -> MockupTask:
        """Mockups für ein Produkt und seine Varianten anfordern. Kostet nichts; nicht wiederholt (Printful erlaubt
        nur wenige Aufgaben je Minute). Abholen über ``get_mockup_task``."""
        require(product_id, CatalogProductId, "product_id")
        if not isinstance(variant_ids, tuple) or not variant_ids or not isinstance(placements, tuple) or not placements:
            raise ValueError("Varianten und Druckflächen als Tupel")
        for variant_id in variant_ids:
            require(variant_id, CatalogVariantId, "variant_ids")
        for place in placements:
            require(place, Placement, "placements")
        if format not in ("png", "jpg"):
            raise ValueError("Format png oder jpg")
        payload = {"format": format, "products": [{
            "source": "catalog", "catalog_product_id": product_id.value,
            "catalog_variant_ids": [variant_id.value for variant_id in variant_ids],
            "placements": [_placement_payload(place) for place in placements]}]}
        rows = _data(await self._request("POST", "/v2/mockup-tasks", operation="createMockupGeneratorTasks",
                                         payload=payload), list)
        if not rows or not isinstance(rows[0], dict):
            raise FulfillmentPermanent("invalid_response")
        return self._mockup(rows[0])

    async def get_mockup_task(self, task_id: int) -> MockupTask:
        if type(task_id) is not int or task_id < 1:
            raise TypeError("Aufgabennummer als ganze Zahl")
        rows = _data(await self._get("/v2/mockup-tasks", operation="getMockupGeneratorTasks",
                                     params={"id": str(task_id)}), list)
        row = next((item for item in rows if isinstance(item, dict) and item.get("id") == task_id), None)
        if row is None:
            raise FulfillmentPermanent("not_found")
        return self._mockup(row)
