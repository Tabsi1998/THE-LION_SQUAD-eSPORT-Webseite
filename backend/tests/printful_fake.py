"""Ein Printful für die Tests, das sich an den abgelegten Vertrag hält (#1705).

Jeder Aufruf wird gegen ``contracts/printful/openapi-v2-excerpt.json`` geprüft: Weg und Methode müssen im Vertrag
stehen, Abfrage und Rumpf passen auf die Beschreibung (Anfragen sind enger als bei Printful - ein Feld, das die Website
nicht senden soll, etwa ``confirm`` beim Anlegen, lässt den Test scheitern), und jede Antwort des Fakes passt auf das
Antwortschema. Weicht der Client oder der Fake vom Vertrag ab, scheitert der Test hier und nicht erst bei Printful.

Fehler lassen sich einspielen (``fail``): Zeitüberschreitung, Netzfehler, 429 mit ``Retry-After``, 5xx, 400 und jeder
andere Status - je Operation (``operationId`` aus dem Vertrag) oder für alle. Kein echter Schlüssel, keine echten
Personen, keine echten Aufrufe.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import pathlib
import re
from decimal import Decimal

import httpx

CONTRACTS = pathlib.Path(__file__).resolve().parent / "contracts" / "printful"
SPEC = json.loads((CONTRACTS / "openapi-v2-excerpt.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((CONTRACTS / "manifest.json").read_text(encoding="utf-8"))
API_KEY = "pf-testschluessel-nicht-echt-0123456789"
HOST = "api.printful.com"
# Ein erfundenes Webhook-Geheimnis, wie Printful es liefert: als Hex-Text.
WEBHOOK_SECRET_HEX = "6c73772d746573742d67656865696d6e69732d6e696368742d6563687421"

TYPES = {"object": dict, "array": list, "string": str, "boolean": bool}


class ContractViolation(AssertionError):
    pass


def _schema(ref_or_schema: dict) -> dict:
    if "$ref" in ref_or_schema:
        return SPEC["components"]["schemas"][ref_or_schema["$ref"].rsplit("/", 1)[-1]]
    return ref_or_schema


def validate(value, schema: dict, where: str = "$") -> None:
    """Der Teil von OpenAPI 3.0, den der Vertrag benutzt."""
    schema = _schema(schema)
    if value is None:
        if schema.get("nullable"):
            return
        raise ContractViolation(f"{where}: null ist nicht erlaubt")
    kind = schema.get("type")
    if kind == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            raise ContractViolation(f"{where}: Ganzzahl erwartet, {value!r} bekommen")
    elif kind == "number":
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ContractViolation(f"{where}: Zahl erwartet, {value!r} bekommen")
    elif kind in TYPES and not isinstance(value, TYPES[kind]):
        raise ContractViolation(f"{where}: {kind} erwartet, {value!r} bekommen")
    if "enum" in schema and value not in schema["enum"]:
        raise ContractViolation(f"{where}: {value!r} steht nicht in {schema['enum']}")
    if "pattern" in schema and isinstance(value, str) and not re.search(schema["pattern"], value):
        raise ContractViolation(f"{where}: {value!r} passt nicht auf {schema['pattern']}")
    if "minimum" in schema and value < schema["minimum"]:
        raise ContractViolation(f"{where}: {value!r} unter {schema['minimum']}")
    if "maximum" in schema and value > schema["maximum"]:
        raise ContractViolation(f"{where}: {value!r} über {schema['maximum']}")
    if kind == "object":
        properties = schema.get("properties") or {}
        for name in schema.get("required") or []:
            if name not in value:
                raise ContractViolation(f"{where}: Pflichtfeld {name} fehlt")
        for name, item in value.items():
            if name in properties:
                validate(item, properties[name], f"{where}.{name}")
            elif schema.get("additionalProperties") is False:
                raise ContractViolation(f"{where}: Feld {name} steht nicht im Vertrag")
    if kind == "array":
        for index, item in enumerate(value):
            validate(item, schema.get("items") or {}, f"{where}[{index}]")


def _template_regex(template: str) -> re.Pattern:
    return re.compile("^" + re.sub(r"\\\{[a-z_]+\\\}", "([^/]+)", re.escape(template)) + "$")


ROUTES = [(template, _template_regex(template)) for template in SPEC["paths"]]


def operation_for(method: str, path: str) -> tuple[str, dict, list[str]]:
    for template, pattern in ROUTES:
        match = pattern.match(path)
        if match and method.lower() in SPEC["paths"][template]:
            return template, SPEC["paths"][template][method.lower()], list(match.groups())
    raise ContractViolation(f"{method} {path} steht nicht im Vertrag")


def _check_query(operation: dict, params: dict, where: str) -> None:
    declared = {param["name"]: param for param in operation.get("parameters") or [] if param["in"] == "query"}
    for name in params:
        if name not in declared:
            raise ContractViolation(f"{where}: Abfrage {name} steht nicht im Vertrag")
    for name, param in declared.items():
        if name not in params:
            if param.get("required"):
                raise ContractViolation(f"{where}: Abfrage {name} fehlt")
            continue
        raw = params[name]
        value = int(raw) if param["schema"].get("type") == "integer" and re.fullmatch(r"-?\d+", raw) else raw
        validate(value, param["schema"], f"{where}?{name}")


def _money(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01'))}"


def _error(status: int, message: str = "x") -> httpx.Response:
    # So beschreibt der Vertrag die Fehler (BadRequest, NotFound, Conflict ...): code, result, error.
    return httpx.Response(status, json={"code": status, "result": message, "error": {"reason": "x", "message": message}})


COLOR_CODES = {"Black": "#0c0c0c", "White": "#ffffff", "Navy": "#1d2335", "Sport Grey": "#9b969c"}

# Druckvorgaben echter Produkte (#2069) - Maße aus den offiziellen Printful-Vorlagen, siehe manifest.json
# („print_templates“): (Platzierung, Technik, Breite Zoll, Höhe Zoll, DPI, Anzeigename). Daraus folgt die Pixelgröße
# der Druckdatei, etwa Gildan 5000 vorne 12 × 16 Zoll bei 150 DPI = 1800 × 2400 px.
PROFILES = {
    # Das Testshirt der bisherigen Tests: nur vorne und hinten.
    "testshirt": (("front", "dtg", 12, 16, 150, "Front print"), ("back", "dtg", 12, 16, 150, "Back print")),
    "gildan5000": (("front", "dtg", 12, 16, 150, "Front print"), ("back", "dtg", 12, 16, 150, "Back print"),
                   ("sleeve_left", "dtg", 4, 3.5, 150, "Left sleeve"), ("sleeve_right", "dtg", 4, 3.5, 150, "Right sleeve"),
                   ("label_inside", "dtg", 3, 3, 150, "Inside label")),
    "jersey": (("front", "sublimation", 33, 45, 150, "Front"), ("back", "sublimation", 33, 45, 150, "Back"),
               ("sleeve_left", "sublimation", 33, 15, 150, "Left sleeve"),
               ("sleeve_right", "sublimation", 33, 15, 150, "Right sleeve"),
               ("label_outside", "sublimation", 3, 3, 150, "Outside label")),
    "snapback": (("front", "dtf", 4.5, 2.35, 300, "Front"),),
}
TEMPLATE_HOST = "files.cdn.printful.com"


def template_box(width_in: float, height_in: float, size: int = 1000, inner: int = 600) -> dict:
    """Wo der Druckbereich im (erfundenen) Vorlagenbild liegt - mittig, mit dem Seitenverhältnis der Fläche."""
    scale = inner / max(width_in, height_in)
    width, height = int(round(width_in * scale)), int(round(height_in * scale))
    return {"template_width": size, "template_height": size, "print_area_width": width, "print_area_height": height,
            "print_area_left": (size - width) // 2, "print_area_top": (size - height) // 2}


def product(product_id: int, *, name: str = "Unisex Staple T-Shirt | Bella + Canvas 3001", variant_count: int = 2,
            sizes=("M", "L"), colors=("Black",)) -> dict:
    return {
        "id": product_id, "main_category_id": 24, "type": "T-SHIRT", "name": name, "brand": "Bella + Canvas", "model": "3001",
        "image": f"https://files.example.test/products/{product_id}.png", "variant_count": variant_count, "is_discontinued": False,
        "description": "Testprodukt", "sizes": list(sizes),
        "colors": [{"name": color, "value": COLOR_CODES.get(color, "#777777")} for color in colors],
        "techniques": [{"key": "dtg", "display_name": "DTG printing", "is_default": True}],
        "placements": [
            {"placement": "front", "technique": "dtg", "layers": [], "print_area_width": 12, "print_area_height": 16,
             "placement_options": [], "conflicting_placements": []},
            {"placement": "back", "technique": "dtg", "layers": [], "print_area_width": 12, "print_area_height": 16,
             "placement_options": [], "conflicting_placements": []},
        ],
        "product_options": [], "_links": {"self": {"href": f"https://api.printful.com/v2/catalog-products/{product_id}"}},
    }


def variant(variant_id: int, product_id: int, *, size: str, color: str = "Black", color_code: str = "#0c0c0c") -> dict:
    return {"id": variant_id, "catalog_product_id": product_id, "name": f"Testshirt ({color} / {size})", "size": size,
            "color": color, "color_code": color_code, "color_code2": None,
            "image": f"https://files.example.test/variants/{variant_id}.png", "_links": {}}


class FakePrintful:
    def __init__(self):
        self.key = API_KEY
        self.stores = [{"id": 17, "type": "native", "name": "Teststore Löwen"}]
        self.products: dict[int, dict] = {}
        self.variants: dict[int, dict] = {}
        self.prices: dict[int, Decimal] = {}
        # Aufpreis je Druckfläche (Printful: ``product.placements`` in der Preisantwort), je Produkt.
        self.placement_prices: dict[int, dict[str, Decimal]] = {}
        self.stock: dict[int, str] = {}
        self.orders: dict[int, dict] = {}
        self.order_items: dict[int, list[dict]] = {}
        self.files: dict[int, dict] = {}
        self.broken_file_urls: set[str] = set()
        self.estimations: dict[str, dict] = {}
        self.mockups: dict[int, dict] = {}
        # Druckvorgaben (mockup-styles) und Vorlagenbilder (mockup-templates) je Produkt (#2069).
        self.print_areas: dict[int, list[dict]] = {}
        self.templates: dict[int, list[dict]] = {}
        # Kategorien des Katalogs für die Produktsuche (#2069) - erfundene Nummern, Titel wie bei Printful.
        self.categories: list[dict] = [
            {"id": 1, "parent_id": None, "title": "Men's clothing", "image_url": "https://files.cdn.printful.com/c/1.png", "_links": {}},
            {"id": 24, "parent_id": 1, "title": "T-shirts", "image_url": "https://files.cdn.printful.com/c/24.png", "_links": {}},
            {"id": 42, "parent_id": None, "title": "Hats", "image_url": "https://files.cdn.printful.com/c/42.png", "_links": {}},
            {"id": 112, "parent_id": None, "title": "Home & living", "image_url": "https://files.cdn.printful.com/c/112.png", "_links": {}},
        ]
        # Operationen, deren Antwort bewusst vom Vertrag abweicht (#2091): echte Antworten tun das gelegentlich - so
        # prüfen Tests, dass der Adapter einzelne kaputte Zeilen überspringt statt alles zu verwerfen.
        self.off_contract: set[str] = set()
        self.calls: list[dict] = []
        self.confirmations: list[int] = []
        self.faults: list[dict] = []
        self.next_id = 9000
        # Wie oft der Stand einer Aufgabe gelesen wird, bevor sie fertig ist (Kostenschätzung, Mockups).
        self.estimation_polls = 1
        self.mockup_polls = 1
        # Produktoptionen, die Printful je Produkt verlangt (#2158) - die Katalogantwort sagt das nicht, Printful lehnt
        # einen Auftrag oder eine Schätzung ohne sie mit 400 ab.
        self.required_options: dict[int, set[str]] = {}
        self.shipping = Decimal("4.95")
        self.vat_rate = Decimal("0.20")

    # ------------------------------------------------ Testdaten
    def add_product(self, product_id: int = 71, variants=((4012, "M"), (4013, "L")), *, price: str = "12.50",
                    stock: str = "in stock", placement_prices: dict[str, str] | None = None,
                    name: str | None = None) -> dict:
        """Varianten als ``(nummer, größe)`` oder ``(nummer, größe, farbe)``; Farben und Größen des Produkts folgen
        daraus. ``placement_prices`` ist der Aufpreis je Druckfläche (etwa ``{"back": "5.25"}``)."""
        rows = [(row[0], row[1], row[2] if len(row) > 2 else "Black") for row in variants]
        sizes = tuple(dict.fromkeys(size for _id, size, _color in rows))
        colors = tuple(dict.fromkeys(color for _id, _size, color in rows))
        extra = {"name": name} if name else {}
        self.products[product_id] = product(product_id, variant_count=len(rows), sizes=sizes, colors=colors, **extra)
        self.placement_prices[product_id] = {key: Decimal(value) for key, value in (placement_prices or {}).items()}
        for variant_id, size, color in rows:
            self.variants[variant_id] = variant(variant_id, product_id, size=size, color=color,
                                                color_code=COLOR_CODES.get(color, "#777777"))
            self.prices[variant_id] = Decimal(price)
            self.stock[variant_id] = stock
        self.use_profile(product_id, "testshirt")
        return self.products[product_id]

    def set_product_options(self, product_id: int, options: list[dict], *, required: tuple[str, ...] = ()) -> None:
        """Produktoptionen des Katalogs (#2158, ``CatalogOption``: name, techniques, type, values) und welche davon
        Printful bei Schätzung und Auftrag verlangt - wie die Nahtfarbe bei Zuschnitt und Naht."""
        self.products[product_id]["product_options"] = [dict(option) for option in options]
        self.required_options[product_id] = set(required)

    def _option_problem(self, items: list[dict]) -> str | None:
        """Wie Printful: fehlt eine Pflichtoption oder ist ein Wert nicht im Katalog, ist das ein Datenfehler (400)."""
        for item in items:
            product_id = (self.variants.get(item["catalog_variant_id"]) or {}).get("catalog_product_id")
            catalog = {row["name"]: row for row in (self.products.get(product_id) or {}).get("product_options") or []}
            given = {row["name"]: row["value"] for row in item.get("product_options") or []}
            for name in sorted(self.required_options.get(product_id) or ()):
                if name not in given:
                    return f"The required product option: `{name}` is missing."
            for name, value in given.items():
                if name not in catalog or value not in catalog[name]["values"]:
                    return f"Invalid value for product option `{name}`."
        return None

    def use_profile(self, product_id: int, profile: str) -> None:
        """Druckvorgaben und Vorlagenbilder eines echten Produkts (``PROFILES``) - ersetzt die bisherigen."""
        self.print_areas[product_id] = []
        self.templates[product_id] = []
        placements = []
        for placement, technique, width, height, dpi, name in PROFILES[profile]:
            self.set_print_area(product_id, placement, width, height, dpi=dpi, technique=technique, display_name=name)
            placements.append({"placement": placement, "technique": technique, "layers": [], "print_area_width": width,
                               "print_area_height": height, "placement_options": [], "conflicting_placements": []})
        techniques = list(dict.fromkeys(row["technique"] for row in placements))
        self.products[product_id]["placements"] = placements
        self.products[product_id]["techniques"] = [{"key": key, "display_name": key.upper(), "is_default": index == 0}
                                                   for index, key in enumerate(techniques)]

    def set_print_area(self, product_id: int, placement: str, width_in: float, height_in: float, *, dpi: int = 150,
                       technique: str = "dtg", variants: tuple[int, ...] | None = None, display_name: str | None = None,
                       template: bool = True) -> None:
        """Eine Druckvorgabe (mockup-styles) setzen - mit ``variants`` nur für diese Varianten (Tassengröße …)."""
        rows = self.print_areas.setdefault(product_id, [])
        rows[:] = [row for row in rows if not (row["placement"] == placement and row["technique"] == technique
                                               and (row["mockup_styles"][0]["restricted_to_variants"] or None)
                                               == (list(variants) if variants else None))]
        rows.append({"placement": placement, "display_name": display_name or placement.replace("_", " ").title(),
                     "technique": technique, "print_area_width": width_in, "print_area_height": height_in,
                     "print_area_type": "simple", "dpi": dpi,
                     "mockup_styles": [{"id": 16000 + len(rows), "category_name": "Flat", "view_name": "Front",
                                        "restricted_to_variants": list(variants) if variants else None}]})
        if template:
            ids = list(variants) if variants else [variant_id for variant_id, row in self.variants.items()
                                                     if row["catalog_product_id"] == product_id]
            templates = self.templates.setdefault(product_id, [])
            templates[:] = [row for row in templates if not (row["placement"] == placement
                                                             and row["technique"] == technique
                                                             and set(row["catalog_variant_ids"]) & set(ids))]
            templates.append({
                "catalog_variant_ids": ids, "placement": placement, "technique": technique,
                "image_url": f"https://{TEMPLATE_HOST}/upload/product-templates/{product_id}-{placement}-{len(templates)}.png",
                "background_url": None, "background_color": 0xFFFFFF, **template_box(width_in, height_in),
                "template_positioning": "overlay", "orientation": "any", "template_type": "native", "role": "template"})

    def fail(self, what, *, operation: str | None = None, times: int = 1, retry_after: str | None = None) -> None:
        """Den nächsten Aufruf(en) einer Operation (oder jeder) scheitern lassen: ``"timeout"``, ``"network"`` oder ein
        HTTP-Status. Bei 429 mit ``Retry-After``."""
        self.faults.append({"what": what, "operation": operation, "times": times, "retry_after": retry_after})

    def set_order_status(self, order_id: int, status: str) -> None:
        """Was in Printful passiert, ohne die Website: jemand bestätigt im Dashboard, Printful produziert …"""
        self.orders[order_id]["status"] = status

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def calls_to(self, operation: str) -> list[dict]:
        return [call for call in self.calls if call["operation"] == operation]

    @staticmethod
    def sign(body: bytes, secret_hex: str = WEBHOOK_SECRET_HEX) -> str:
        """So signiert Printful einen Webhook (Vertrag ``x-webhooks``): HMAC-SHA256 mit dem dekodierten Geheimnis, hex."""
        return hmac.new(bytes.fromhex(secret_hex), body, hashlib.sha256).hexdigest()

    # ------------------------------------------------ Aufrufe
    def _handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.scheme == "https", "Printful nur über https"
        assert request.url.host == HOST, f"nur {HOST}, nicht {request.url.host}"
        assert self.key not in str(request.url), "der Schlüssel gehört nur in den Kopf"
        template, operation, args = operation_for(request.method, request.url.path)
        params = dict(request.url.params)
        body = json.loads(request.content.decode("utf-8")) if request.content else None
        name = operation["operationId"]
        self.calls.append({"method": request.method, "path": request.url.path, "operation": name, "params": params,
                           "body": body, "headers": dict(request.headers)})
        if request.headers.get("authorization") != f"Bearer {self.key}":
            return _error(401, "Unauthorized")
        _check_query(operation, params, name)
        declared_body = operation.get("requestBody")
        if declared_body:
            if body is None:
                raise ContractViolation(f"{name}: Rumpf fehlt")
            validate(body, declared_body["content"]["application/json"]["schema"], name)
        elif body is not None:
            raise ContractViolation(f"{name}: dieser Weg nimmt keinen Rumpf")
        fault = self._fault(name)
        if fault is not None:
            return self._inject(fault, request)
        status, payload = getattr(self, f"_op_{name}")(args, params, body)
        if status == 200:
            if name not in self.off_contract:
                validate(payload, operation["responses"]["200"]["content"]["application/json"]["schema"], f"{name} → 200")
            return httpx.Response(200, json=payload)
        if status == 204:
            assert "204" in operation["responses"], f"{name}: 204 steht nicht im Vertrag"
            return httpx.Response(204)
        return _error(status, payload or "x")

    def _fault(self, name: str) -> dict | None:
        for fault in self.faults:
            if fault["times"] > 0 and fault["operation"] in (None, name):
                fault["times"] -= 1
                return fault
        return None

    @staticmethod
    def _inject(fault: dict, request: httpx.Request) -> httpx.Response:
        what = fault["what"]
        if what == "timeout":
            raise httpx.ReadTimeout("Zeitüberschreitung (Test)", request=request)
        if what == "network":
            raise httpx.ConnectError("Verbindung abgelehnt (Test)", request=request)
        headers = {"Retry-After": fault["retry_after"]} if fault.get("retry_after") is not None else {}
        if 300 <= what < 400:
            headers["Location"] = "https://anderswo.example.test/"
        return httpx.Response(what, headers=headers, json={"code": what, "result": "Fehler (Test)",
                                                           "error": {"reason": "x", "message": "Fehler (Test)"}})

    def _new_id(self) -> int:
        self.next_id += 1
        return self.next_id

    # ------------------------------------------------ Katalog
    def _op_getStores(self, args, params, body):
        return 200, {"data": self.stores, "paging": {"total": len(self.stores), "offset": 0, "limit": 20}, "_links": {}}

    def _op_getProductById(self, args, params, body):
        found = self.products.get(int(args[0])) if args[0].isdigit() else None
        return (200, {"data": found}) if found else (404, "Product not found")

    def _paged(self, rows: list, params: dict) -> tuple[list, dict]:
        limit, offset = int(params.get("limit") or 20), int(params.get("offset") or 0)
        return rows[offset:offset + limit], {"total": len(rows), "offset": offset, "limit": limit}

    def _op_getProductVariantsById(self, args, params, body):
        product_id = int(args[0]) if args[0].isdigit() else 0
        if product_id not in self.products:
            return 404, "Product not found"
        rows, paging = self._paged([row for row in self.variants.values() if row["catalog_product_id"] == product_id], params)
        return 200, {"data": rows, "paging": paging, "_links": {"self": {}, "product_details": {}}}

    def _op_getVariantPricesById(self, args, params, body):
        variant_id = int(args[0]) if args[0].isdigit() else 0
        if variant_id not in self.variants:
            return 404, "Variant not found"
        price = self.prices[variant_id]
        product_id = self.variants[variant_id]["catalog_product_id"]
        surcharges = [{"id": key, "title": f"{key} print", "type": "printfile", "technique_key": "dtg",
                       "price": _money(value), "discounted_price": _money(value), "placement_options": [], "layers": []}
                      for key, value in (self.placement_prices.get(product_id) or {}).items()]
        return 200, {"data": {"currency": params.get("currency") or "USD",
                              "product": {"id": product_id, "placements": surcharges},
                              "variant": {"id": variant_id, "techniques": [
                                  {"technique_key": "dtg", "technique_display_name": "DTG printing",
                                   "price": _money(price + Decimal("1.00")), "discounted_price": _money(price)}]}},
                     "_links": {}}

    def _op_getProductStockAvailabilityById(self, args, params, body):
        product_id = int(args[0]) if args[0].isdigit() else 0
        if product_id not in self.products:
            return 404, "Product not found"
        rows = [{"catalog_variant_id": variant_id,
                 "techniques": [{"technique": "dtg", "selling_regions": [
                     {"name": "europe", "availability": self.stock[variant_id], "placement_option_availability": []},
                     {"name": "usa", "availability": "in stock", "placement_option_availability": []}]}],
                 "_links": {}}
                for variant_id, row in self.variants.items() if row["catalog_product_id"] == product_id]
        rows, paging = self._paged(rows, params)
        return 200, {"data": rows, "paging": paging, "filter_settings": [], "_links": {"self": {}, "product": {}}}

    def _op_getProducts(self, args, params, body):
        rows, paging = self._paged(sorted(self.products.values(), key=lambda row: row["id"]), params)
        return 200, {"data": rows, "paging": paging, "_links": {"self": {}}}

    def _op_getCategories(self, args, params, body):
        return 200, {"data": self.categories, "_links": {"self": {}}}

    def _op_retrieveMockupStylesByProductId(self, args, params, body):
        product_id = int(args[0]) if args[0].isdigit() else 0
        if product_id not in self.products:
            return 404, "Product not found"
        rows, paging = self._paged(list(self.print_areas.get(product_id) or []), params)
        return 200, {"data": rows, "paging": paging, "_links": {"self": {}}}

    def _op_getMockupTemplatesByProductId(self, args, params, body):
        product_id = int(args[0]) if args[0].isdigit() else 0
        if product_id not in self.products:
            return 404, "Product not found"
        rows, paging = self._paged(list(self.templates.get(product_id) or []), params)
        return 200, {"data": rows, "paging": paging, "_links": {"self": {}}}

    # ------------------------------------------------ Kosten
    def _costs(self, items: list[dict], *, done: bool = True) -> dict:
        subtotal = sum((self.prices[item["catalog_variant_id"]] * item["quantity"] for item in items), Decimal("0"))
        shipping = self.shipping
        vat = ((subtotal + shipping) * self.vat_rate).quantize(Decimal("0.01"))
        return {"calculation_status": "done" if done else "calculating", "currency": "EUR",
                "subtotal": _money(subtotal), "discount": "0.00", "shipping": _money(shipping), "digitization": "0.00",
                "additional_fee": "0.00", "fulfillment_fee": "0.00", "retail_delivery_fee": "0.00",
                "vat": _money(vat), "tax": "0.00", "total": _money(subtotal + shipping + vat)}

    def _unknown_variant(self, items: list[dict]) -> int | None:
        return next((item["catalog_variant_id"] for item in items if item["catalog_variant_id"] not in self.variants), None)

    def _op_createOrderEstimationTask(self, args, params, body):
        problem = self._option_problem(body["order_items"])
        if problem:
            return 400, problem
        task_id = f"est-{self._new_id()}"
        unknown = self._unknown_variant(body["order_items"])
        self.estimations[task_id] = {"items": body["order_items"], "polls": 0,
                                     "failed": [f"Variant {unknown} not found"] if unknown else []}
        return 200, {"data": {"id": task_id, "status": "pending", "costs": None, "retail_costs": None,
                              "failure_reasons": []}}

    def _op_getOrderEstimationTask(self, args, params, body):
        task = self.estimations.get(params["id"])
        if task is None:
            return 404, "Task not found"
        task["polls"] += 1
        if task["failed"]:
            return 200, {"data": {"id": params["id"], "status": "failed", "costs": None, "retail_costs": None,
                                  "failure_reasons": task["failed"]}}
        if task["polls"] < self.estimation_polls:
            return 200, {"data": {"id": params["id"], "status": "pending", "costs": None, "retail_costs": None,
                                  "failure_reasons": []}}
        return 200, {"data": {"id": params["id"], "status": "completed", "costs": self._costs(task["items"]),
                              "retail_costs": None, "failure_reasons": []}}

    # ------------------------------------------------ Aufträge
    def _order_view(self, order_id: int) -> dict:
        order = self.orders[order_id]
        items = self.order_items[order_id]
        return {**order, "order_items": [
            {"id": item["id"], "type": "order_item", "source": "catalog", "catalog_variant_id": item["catalog_variant_id"],
             "external_id": item["external_id"], "name": item["name"], "quantity": item["quantity"],
             "price": _money(self.prices[item["catalog_variant_id"]]), "retail_price": None, "currency": "EUR",
             "retail_currency": None, "_links": {"self": {}}} for item in items]}

    def _order_ref(self, raw: str) -> int | None:
        if raw.startswith("@"):
            return next((oid for oid, row in self.orders.items() if row["external_id"] == raw[1:]), None)
        return int(raw) if raw.isdigit() and int(raw) in self.orders else None

    def _op_createOrder(self, args, params, body):
        if any(row["external_id"] == body["external_id"] for row in self.orders.values()):
            # Annahme (Doku sagt nichts): eine zweite Anlage mit derselben external_id lehnt Printful ab.
            return 400, "external_id already used"
        unknown = self._unknown_variant(body["order_items"])
        if unknown:
            return 400, f"Variant {unknown} not found"
        problem = self._option_problem(body["order_items"])
        if problem:
            return 400, problem
        order_id = self._new_id()
        recipient = {field: body["recipient"].get(field) or "" for field in
                     ("name", "company", "address1", "address2", "city", "state_code", "country_code", "zip", "phone", "email")}
        recipient.update(state_name="", country_name="Austria" if recipient["country_code"] == "AT" else "", tax_number="")
        self.orders[order_id] = {
            "id": order_id, "external_id": body["external_id"], "store_id": self.stores[0]["id"],
            "shipping": body.get("shipping") or "STANDARD", "status": "draft",
            "created_at": "2026-10-27T10:00:00Z", "updated_at": "2026-10-27T10:00:00Z", "recipient": recipient,
            "costs": self._costs(body["order_items"]), "retail_costs": None, "customization": None,
            "_links": {"self": {}, "order_confirmation": {}, "order_invoices": {}, "order_items": {}, "shipments": {}},
        }
        self.order_items[order_id] = [
            {"id": self._new_id(), "catalog_variant_id": item["catalog_variant_id"], "quantity": item["quantity"],
             "external_id": item.get("external_id"), "name": item.get("name") or self.variants[item["catalog_variant_id"]]["name"],
             "placements": [{"placement": place["placement"], "technique": place["technique"], "print_area_type": "simple",
                             "layers": [{"type": layer["type"], "url": layer["url"]} for layer in place["layers"]],
                             "placement_options": [], "status": "ok", "status_explanation": ""}
                            for place in item["placements"]],
             "product_options": [dict(row) for row in item.get("product_options") or []]}
            for item in body["order_items"]]
        return 200, {"data": self._order_view(order_id)}

    def _op_getOrder(self, args, params, body):
        order_id = self._order_ref(args[0])
        return (200, {"data": self._order_view(order_id)}) if order_id else (404, "Order not found")

    def _op_getItemsByOrderId(self, args, params, body):
        order_id = self._order_ref(args[0])
        if not order_id:
            return 404, "Order not found"
        rows = [{"source": "catalog", "catalog_variant_id": item["catalog_variant_id"], "id": item["id"],
                 "external_id": item["external_id"], "quantity": item["quantity"], "retail_price": None,
                 "name": item["name"], "placements": item["placements"],
                 "product_options": item.get("product_options") or [], "_links": {"self": {}}}
                for item in self.order_items[order_id]]
        rows, paging = self._paged(rows, params)
        return 200, {"data": rows, "paging": paging, "_links": {}}

    def _op_deleteOrder(self, args, params, body):
        order_id = self._order_ref(args[0])
        if not order_id:
            return 404, "Order not found"
        if self.orders[order_id]["status"] not in ("draft", "failed"):
            return 409, "Order can not be deleted in this state"
        del self.orders[order_id]
        del self.order_items[order_id]
        return 204, None

    def _op_confirmOrder(self, args, params, body):
        order_id = self._order_ref(args[0])
        if not order_id:
            return 404, "Order not found"
        if self.orders[order_id]["status"] != "draft":
            return 409, "Order is not a draft"
        self.confirmations.append(order_id)
        self.orders[order_id]["status"] = "pending"
        return 200, {"data": self._order_view(order_id), "_links": {"self": {}, "order": {}, "order_items": {}, "shipments": {}}}

    # ------------------------------------------------ Dateien und Mockups
    def _file_view(self, file_id: int) -> dict:
        return self.files[file_id]

    def _op_addFile(self, args, params, body):
        file_id = self._new_id()
        broken = body["url"] in self.broken_file_urls
        self.files[file_id] = {
            "id": file_id, "url": body["url"], "hash": None if broken else hashlib.sha256(body["url"].encode()).hexdigest()[:32],
            "filename": body.get("filename"), "mime_type": None if broken else "image/png", "size": 0 if broken else 123456,
            "width": None if broken else 4500, "height": None if broken else 5400, "dpi": None if broken else 300,
            "status": "failed" if broken else "ok", "created": "2026-10-27T10:00:00Z",
            "thumbnail_url": None, "preview_url": None, "visible": body.get("visible", True), "is_temporary": False,
            "_links": {"self": {}}}
        return 200, {"data": self._file_view(file_id)}

    def _op_getFileById(self, args, params, body):
        file_id = int(args[0]) if args[0].isdigit() else 0
        return (200, {"data": self._file_view(file_id)}) if file_id in self.files else (404, "File not found")

    def _mockup_view(self, task_id: int) -> dict:
        task = self.mockups[task_id]
        done = task["polls"] >= self.mockup_polls
        product_row = task["product"]
        mockups = [{"catalog_variant_id": variant_id, "mockups": [
            {"placement": place["placement"], "display_name": place["placement"].title(), "technique": place["technique"],
             "style_id": 1, "mockup_url": f"https://files.example.test/mockups/{task_id}-{variant_id}-{place['placement']}.png"}
            for place in product_row["placements"]]} for variant_id in product_row.get("catalog_variant_ids") or []]
        return {"id": task_id, "status": "completed" if done else "pending",
                "catalog_variant_mockups": mockups if done else [], "failure_reasons": [], "_links": {"self": {}}}

    def _op_createMockupGeneratorTasks(self, args, params, body):
        rows = []
        for product_row in body["products"]:
            if product_row["catalog_product_id"] not in self.products:
                return 400, "Product not found"
            task_id = self._new_id()
            self.mockups[task_id] = {"product": product_row, "polls": -1}
            rows.append(self._mockup_view(task_id))
            self.mockups[task_id]["polls"] = 0
        return 200, {"data": rows}

    def _op_getMockupGeneratorTasks(self, args, params, body):
        task_id = int(params["id"])
        if task_id not in self.mockups:
            return 404, "Task not found"
        self.mockups[task_id]["polls"] += 1
        return 200, {"data": [self._mockup_view(task_id)], "paging": {"total": 1, "offset": 0, "limit": 20}, "_links": {}}
