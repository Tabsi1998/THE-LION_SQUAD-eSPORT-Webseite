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
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import quote

import httpx
from pymongo.errors import DuplicateKeyError

from services import shop_config
from services.log_safe import log_safe, mask_addresses
from services.shop_fulfillment import (
    CatalogProduct, CatalogProductId, CatalogVariant, CatalogVariantId, Costs, DraftLine, DraftOrder,
    FulfillmentError, FulfillmentInvalid, FulfillmentOrder, FulfillmentPermanent, FulfillmentTransient, MockupImage,
    MockupTask, OrderItem, PlacedFile, Placement, PrintFile, PrintfulOrderId, ProductPlacementInfo, check_external_id,
    check_https_url, require)

logger = logging.getLogger("tls.printful")

API_BASE = "https://api.printful.com"
TIMEOUT_SECONDS = 15.0
RETRY_PAUSES = (1.0, 3.0)
# Längere Wartezeiten aus ``Retry-After`` gibt der Client als Fehler zurück, statt eine Anfrage zu blockieren.
MAX_RETRY_AFTER = 30.0
PAGE_LIMIT = 100
MAX_PAGES = 20
ESTIMATE_POLLS = 10
ESTIMATE_PAUSE = 1.0
CONFIRMATIONS = "shop_printful_confirmations"
# So lange gilt eine Bestätigung ohne bekanntes Ergebnis (Zeitüberschreitung) als „läuft noch“.
CONFIRM_CLAIM_SECONDS = 300
IDEMPOTENCY_KEY_RE = re.compile(r"[A-Za-z0-9:_-]{8,128}")
FILENAME_RE = re.compile(r"[A-Za-z0-9._-]{1,100}")
CURRENCY_RE = re.compile(r"[A-Z]{3}")
REGION_RE = re.compile(r"[a-z_]{2,32}")

# Nur Tests setzen einen Transport (Fake) und ersetzen das Warten.
TRANSPORT: httpx.AsyncBaseTransport | None = None
_sleep = asyncio.sleep

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

    async def _pages(self, path: str, *, operation: str) -> list[dict]:
        rows: list[dict] = []
        for page in range(MAX_PAGES):
            body = await self._get(path, operation=operation, params={"limit": PAGE_LIMIT, "offset": page * PAGE_LIMIT})
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

    async def catalog_variants(self, product_id: CatalogProductId, *, currency: str = "EUR",
                               region: str = "europe") -> tuple[CatalogVariant, ...]:
        """Alle Varianten eines Produkts mit Größe, Farbe, Nummer, Einkaufspreis je Technik und Lager in ``region``.
        Je Variante ein Preisaufruf - für ein Produkt mit wenigen Größen gut innerhalb von 120 Aufrufen je Minute."""
        require(product_id, CatalogProductId, "product_id")
        if not CURRENCY_RE.fullmatch(str(currency)) or not REGION_RE.fullmatch(str(region)):
            raise ValueError("Währung (EUR) oder Region (europe) ungültig")
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
            price_body = await self._get(f"/v2/catalog-variants/{variant_id.value}/prices",
                                         operation="getVariantPricesById",
                                         params={"currency": currency, "selling_region_name": region})
            prices_data = _data(price_body)
            prices = {str(item.get("technique_key")): _cents(item.get("discounted_price") or item.get("price"))
                      for item in _dig(prices_data, "variant", "techniques") or [] if isinstance(item, dict)}
            availability = stock.get(variant_id.value)
            variants.append(CatalogVariant(
                id=variant_id, product_id=product_id, name=str(row.get("name") or ""), size=str(row.get("size") or ""),
                color=row.get("color"), color_code=row.get("color_code"),
                currency=str(prices_data.get("currency") or currency), prices=prices,
                in_stock=None if availability is None else availability == "in stock", availability=availability))
        return tuple(variants)

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

    async def create_draft(self, db, draft: DraftOrder) -> FulfillmentOrder:
        """Einen Auftrag als **Entwurf** anlegen. Bestätigen geht hier nicht: es gibt keinen Parameter dafür, v2 legt
        immer einen Entwurf an, und der Weg zur Bestätigung ist in ``_request`` gesperrt. Gibt es die ``external_id``
        bei Printful schon, kommt dieser Auftrag zurück - kein zweiter."""
        require(draft, DraftOrder, "draft")
        await shop_config.require_printful_drafts(db)
        existing = await self._find(draft.external_id)
        if existing is not None:
            return existing
        body = await self._request("POST", "/v2/orders", operation="createOrder", payload=order_payload(draft))
        data = _data(body)
        if type(data.get("id")) is not int:
            raise FulfillmentPermanent("invalid_response")
        return await self.get_order(PrintfulOrderId(data["id"]))

    async def delete_draft(self, db, order_id: PrintfulOrderId) -> None:
        """Einen Entwurf löschen. Was kein Entwurf mehr ist, bleibt unberührt (``not_draft``) - storniert wird ein
        bestätigter Auftrag nur über einen eigenen Weg hinter dem Notschalter (#1721)."""
        require(order_id, PrintfulOrderId, "order_id")
        await shop_config.require_printful_drafts(db)
        current = await self.get_order(order_id)
        if current.status != "draft":
            raise FulfillmentInvalid("not_draft")
        await self._request("DELETE", f"/v2/orders/{order_id.value}", operation="deleteOrder")

    async def confirm_order(self, db, order_id: PrintfulOrderId, *, idempotency_key: str) -> FulfillmentOrder:
        """Einen Entwurf bestätigen - **kostet Geld**, darum nur mit Notschalter an. Ein Schlüssel gehört zu genau einem
        Auftrag; derselbe Schlüssel noch einmal sendet nicht noch einmal. Ist der Auftrag kein Entwurf mehr, wird nie
        gesendet. Nie still wiederholt; bei unbekanntem Ausgang (Zeitüberschreitung) bleibt der Schlüssel eine Weile
        belegt, danach entscheidet der Stand bei Printful."""
        require(order_id, PrintfulOrderId, "order_id")
        if not isinstance(idempotency_key, str) or not IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
            raise ValueError("Idempotenzschlüssel: 8 bis 128 Zeichen aus Buchstaben, Ziffern, :, - und _")
        await shop_config.require_printful_writes(db)
        store = db[CONFIRMATIONS]
        now = datetime.now(timezone.utc)
        try:
            await store.insert_one({"_id": idempotency_key, "order_id": order_id.value, "state": "claimed",
                                    "claimed_at": now.isoformat()})
        except DuplicateKeyError:
            earlier = await store.find_one({"_id": idempotency_key}) or {}
            if earlier.get("order_id") != order_id.value:
                raise FulfillmentInvalid("idempotency_conflict") from None
            if earlier.get("state") == "done":
                return await self.get_order(order_id)
            stamp = str(earlier.get("claimed_at") or "")
            try:
                claimed = datetime.fromisoformat(stamp)
            except ValueError:
                claimed = now
            if now - claimed < timedelta(seconds=CONFIRM_CLAIM_SECONDS):
                raise FulfillmentTransient("confirm_in_progress") from None
            # Übernehmen nur, wenn niemand anderes es inzwischen getan hat (bedingtes Update auf den alten Stempel).
            taken = await store.update_one({"_id": idempotency_key, "state": "claimed", "claimed_at": stamp},
                                           {"$set": {"claimed_at": now.isoformat()}})
            if taken.modified_count != 1:
                raise FulfillmentTransient("confirm_in_progress") from None
        current = await self.get_order(order_id)
        if current.status != "draft":
            await store.update_one({"_id": idempotency_key}, {"$set": {"state": "done", "status": current.status}})
            return current
        try:
            body = await self._request("POST", f"/v2/orders/{order_id.value}/confirmation", operation="confirmOrder",
                                       allow_confirmation=True)
        except FulfillmentError as exc:
            if exc.status is not None:
                # Printful hat geantwortet und abgelehnt: ein neuer Versuch mit demselben Schlüssel ist möglich.
                await store.delete_one({"_id": idempotency_key, "state": "claimed"})
            raise
        data = _data(body)
        await store.update_one({"_id": idempotency_key}, {"$set": {"state": "done", "status": str(data.get("status"))}})
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
