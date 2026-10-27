"""Die austauschbare Schnittstelle zum Druckdienstleister des Shops (#1705): Typen, Fehlerklassen, Protokoll.

Die erste Umsetzung ist Printful (``services/printful_client.py``, API v2). Alles, was der Shop von einem Anbieter
braucht, steht hier - ein späterer Wechsel tauscht nur die Umsetzung, nicht die Aufrufer.

Gegen Verwechslungen: Produkt-, Varianten- und Auftragsnummer sind eigene Typen. ``CatalogVariantId(4012)`` ist nie
gleich ``CatalogProductId(4012)``, und jede Methode prüft den Typ - eine bloße Zahl wird abgelehnt (``TypeError``).

Fehlerklassen - was der Aufrufer tut:

- ``FulfillmentTransient`` (Zeitüberschreitung, Netz, 429, 5xx): später erneut versuchen; ``retry_after`` sagt, wann.
- ``FulfillmentPermanent`` (401, 403, 404, Weiterleitung, unerwartete Antwort, kein Schlüssel): Admin informieren.
- ``FulfillmentInvalid`` (400, 409, 422, gescheiterte Schätzung, kein Entwurf mehr, Testentwurf bestätigen): diese
  Bestellung blockieren.

Die Meldung (``str``) ist ein fester deutscher Satz; was der Anbieter dazu sagt, steht gekürzt und maskiert in
``provider_detail`` (Mail-Adressen gekürzt, nie der Schlüssel).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

PLACEMENT_RE = re.compile(r"[a-z0-9_]{1,64}")
TECHNIQUE_RE = re.compile(r"[a-z0-9-]{1,32}")
EXTERNAL_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
HTTPS_URL_RE = re.compile(r"https://[^\s/?#]+\.[^\s/?#]+(/[^\s]*)?")
MAX_QUANTITY = 20
MAX_LINES = 20
# Testentwürfe aus dem Admin (#2062) tragen diesen Anfang in der external_id - sie werden nie bestätigt.
TEST_EXTERNAL_PREFIX = "lsw-testentwurf-"


def is_test_external_id(value) -> bool:
    return isinstance(value, str) and value.startswith(TEST_EXTERNAL_PREFIX)


# ---------------------------------------------------------------- Nummern (eigene Typen)

@dataclass(frozen=True, slots=True)
class _Number:
    value: int

    def __post_init__(self) -> None:
        if type(self.value) is not int:
            raise TypeError(f"{type(self).__name__} braucht eine ganze Zahl")
        if self.value < 1:
            raise ValueError(f"{type(self).__name__} ist mindestens 1")


@dataclass(frozen=True, slots=True)
class CatalogProductId(_Number):
    """Nummer eines Produkts im Katalog des Anbieters (Printful: ``catalog_product_id``)."""


@dataclass(frozen=True, slots=True)
class CatalogVariantId(_Number):
    """Nummer einer Variante (Größe/Farbe) im Katalog - das, was bestellt wird (``catalog_variant_id``)."""


@dataclass(frozen=True, slots=True)
class PrintfulOrderId(_Number):
    """Nummer eines Auftrags beim Anbieter."""


def require(value, kind: type, label: str):
    """``value`` muss genau vom Typ ``kind`` sein - eine Zahl oder die falsche Nummer ist ein Programmfehler."""
    if type(value) is not kind:
        raise TypeError(f"{label}: {kind.__name__} erwartet, {type(value).__name__} bekommen")
    return value


def check_external_id(value) -> str:
    if not isinstance(value, str) or not EXTERNAL_ID_RE.fullmatch(value):
        raise ValueError("external_id: 1 bis 64 Zeichen aus Buchstaben, Ziffern, - und _")
    return value


def check_https_url(value) -> str:
    if not isinstance(value, str) or not HTTPS_URL_RE.fullmatch(value) or len(value) > 2000:
        raise ValueError("Nur https-Adressen mit Host, ohne Leerzeichen")
    return value


# ---------------------------------------------------------------- Was gesendet wird

@dataclass(frozen=True, slots=True)
class Placement:
    """Eine Druckfläche mit genau einer Datei: ``front``, ``back`` … und Technik (``dtg``, ``embroidery`` …)."""
    placement: str
    technique: str
    file_url: str

    def __post_init__(self) -> None:
        if not isinstance(self.placement, str) or not PLACEMENT_RE.fullmatch(self.placement):
            raise ValueError("Druckfläche: Kleinbuchstaben, Ziffern und _")
        if not isinstance(self.technique, str) or not TECHNIQUE_RE.fullmatch(self.technique):
            raise ValueError("Technik: Kleinbuchstaben, Ziffern und -")
        check_https_url(self.file_url)


@dataclass(frozen=True, slots=True)
class DraftLine:
    variant: CatalogVariantId
    quantity: int
    placements: tuple[Placement, ...]
    external_id: str | None = None
    name: str | None = None

    def __post_init__(self) -> None:
        require(self.variant, CatalogVariantId, "variant")
        if type(self.quantity) is not int or not 1 <= self.quantity <= MAX_QUANTITY:
            raise ValueError(f"Menge 1 bis {MAX_QUANTITY}")
        if not isinstance(self.placements, tuple) or not self.placements:
            raise ValueError("Mindestens eine Druckfläche (als Tupel)")
        for place in self.placements:
            require(place, Placement, "placements")
        if self.external_id is not None:
            check_external_id(self.external_id)


@dataclass(frozen=True, slots=True)
class Recipient:
    """Lieferanschrift. Für die Kostenschätzung gehen nur Land und PLZ hinaus, nie der Name."""
    name: str
    address1: str
    city: str
    zip: str
    country_code: str
    company: str = ""
    address2: str = ""
    state_code: str = ""
    phone: str = ""
    email: str = ""

    def __post_init__(self) -> None:
        for label in ("name", "address1", "city", "zip"):
            value = getattr(self, label)
            if not isinstance(value, str) or not value.strip() or len(value) > 200:
                raise ValueError(f"Anschrift: {label} fehlt oder ist zu lang")
        if not re.fullmatch(r"[A-Z]{2}", str(self.country_code)):
            raise ValueError("Anschrift: Land als zwei Großbuchstaben (AT)")


@dataclass(frozen=True, slots=True)
class DraftOrder:
    """Ein Auftrag, der beim Anbieter **nur als Entwurf** entsteht. Es gibt bewusst kein Feld zum Bestätigen."""
    external_id: str
    recipient: Recipient
    lines: tuple[DraftLine, ...]
    shipping: str = "STANDARD"

    def __post_init__(self) -> None:
        check_external_id(self.external_id)
        require(self.recipient, Recipient, "recipient")
        if not isinstance(self.lines, tuple) or not 1 <= len(self.lines) <= MAX_LINES:
            raise ValueError(f"1 bis {MAX_LINES} Positionen (als Tupel)")
        for line in self.lines:
            require(line, DraftLine, "lines")
        if not re.fullmatch(r"[A-Z_]{1,32}", str(self.shipping)):
            raise ValueError("Versandart: Großbuchstaben und _")


# ---------------------------------------------------------------- Was zurückkommt

@dataclass(frozen=True, slots=True)
class ProductPlacementInfo:
    placement: str
    technique: str
    width: float | None
    height: float | None
    conflicts: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CatalogProduct:
    id: CatalogProductId
    name: str
    type: str
    brand: str | None
    model: str | None
    is_discontinued: bool
    techniques: tuple[str, ...]
    default_technique: str | None
    placements: tuple[ProductPlacementInfo, ...]
    sizes: tuple[str, ...]
    colors: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class CatalogVariant:
    id: CatalogVariantId
    product_id: CatalogProductId
    name: str
    size: str
    color: str | None
    color_code: str | None
    currency: str
    # Einkaufspreis je Technik in Cent (Printful: ``discounted_price``, der Preis nach Tarif).
    prices: dict[str, int] = field(default_factory=dict)
    # Lager in der gewählten Verkaufsregion: True nur bei „in stock“; None, wenn Printful nichts meldet.
    in_stock: bool | None = None
    availability: str | None = None
    # Aufpreis je Technik und Druckfläche in Cent (Printful: ``product.placements`` der Preisantwort, #1709) - etwa
    # ``{"dtg": {"front": 525, "back": 525}}``. Welche Fläche im Grundpreis steckt, entscheidet der Shop.
    placement_prices: dict[str, dict[str, int]] = field(default_factory=dict)
    # Ob für diese Variante Preise abgefragt wurden (``catalog_variants(price_for=…)``) - sonst sind beide leer.
    priced: bool = True

    def price_cents(self, technique: str) -> int | None:
        return self.prices.get(technique)

    def placement_price_cents(self, technique: str, placement: str) -> int | None:
        return (self.placement_prices.get(technique) or {}).get(placement)


@dataclass(frozen=True, slots=True)
class CatalogEntry:
    """Ein Produkt aus der Katalogliste (#2069, Produktsuche) - ohne Varianten und Preise."""
    id: CatalogProductId
    name: str
    brand: str | None
    model: str | None
    type: str
    main_category_id: int | None
    image: str | None
    techniques: tuple[str, ...]
    colors: int
    sizes: int
    is_discontinued: bool


@dataclass(frozen=True, slots=True)
class CatalogCategory:
    id: int
    parent_id: int | None
    title: str


@dataclass(frozen=True, slots=True)
class PrintArea:
    """Die Druckvorgabe einer Platzierung (#2069): Druckbereich in Zoll und die DPI, mit der Printful die Druckdatei
    erwartet - Druckdatei = ``round(width_in × dpi)`` × ``round(height_in × dpi)`` Pixel. ``variant_ids`` ist ``None``,
    wenn die Vorgabe für alle Varianten gilt, sonst nur für diese (etwa je Tassen- oder Tuchgröße)."""
    placement: str
    technique: str
    display_name: str
    width_in: float
    height_in: float
    dpi: int
    area_type: str | None = None
    variant_ids: tuple[int, ...] | None = None

    @property
    def width_px(self) -> int:
        return int(round(self.width_in * self.dpi))

    @property
    def height_px(self) -> int:
        return int(round(self.height_in * self.dpi))


@dataclass(frozen=True, slots=True)
class MockupTemplate:
    """Vorlagenbild einer Platzierung (#2069): das halbdurchsichtige Bild mit Sicherheitslinien und wo darin der
    Druckbereich liegt (Pixel des Vorlagenbilds). ``positioning`` sagt, ob das Bild über (``overlay``) oder unter
    (``background``) der Druckdatei liegt."""
    variant_ids: tuple[int, ...]
    placement: str
    technique: str
    image_url: str
    background_url: str | None
    background_color: str | None
    template_width: int
    template_height: int
    area_left: int
    area_top: int
    area_width: int
    area_height: int
    positioning: str
    orientation: str
    # ``template``/``primary`` sind die eigentlichen Vorlagen (für die Vorschau bevorzugt), ``unknown`` geht auch (#2091).
    role: str | None = None


class Rows(tuple):
    """Gelesene Zeilen einer Liste vom Anbieter plus kurze Gründe, warum einzelne Zeilen übersprungen wurden (#2091) -
    ohne Werte aus der Antwort, nur Platzierung, Technik, Feld und erwarteter Typ. Sonst ein gewöhnliches Tupel.

    ``incomplete``: Paare (Platzierung, Technik), zu denen mindestens eine Zeile übersprungen wurde - deren gelesene
    Zeilen sind unvollständig (etwa fehlt die Fläche einer Tassengröße). ``unreadable``: so viele übersprungene Zeilen,
    deren Platzierung oder Technik nicht lesbar war - sie lassen sich keinem Paar zuordnen."""
    skipped: tuple[str, ...]
    incomplete: frozenset[tuple[str, str]]
    unreadable: int

    def __new__(cls, items=(), skipped=(), incomplete=(), unreadable=0):
        rows = super().__new__(cls, items)
        rows.skipped = tuple(skipped)
        rows.incomplete = frozenset(incomplete)
        rows.unreadable = int(unreadable)
        return rows


@dataclass(frozen=True, slots=True)
class Costs:
    currency: str | None
    calculation_status: str
    subtotal_cents: int | None
    discount_cents: int | None
    shipping_cents: int | None
    tax_cents: int | None
    vat_cents: int | None
    total_cents: int | None


@dataclass(frozen=True, slots=True)
class PlacedFile:
    placement: str
    technique: str
    file_urls: tuple[str, ...]
    status: str
    status_explanation: str


@dataclass(frozen=True, slots=True)
class OrderItem:
    id: int
    external_id: str | None
    variant_id: CatalogVariantId
    quantity: int
    name: str
    price_cents: int | None
    placements: tuple[PlacedFile, ...]


@dataclass(frozen=True, slots=True)
class FulfillmentOrder:
    id: PrintfulOrderId
    external_id: str | None
    status: str
    shipping: str
    costs: Costs
    items: tuple[OrderItem, ...]


@dataclass(frozen=True, slots=True)
class PrintFile:
    id: int
    status: str
    url: str
    hash: str | None
    filename: str | None
    mime_type: str | None
    width: int | None
    height: int | None
    dpi: int | None


@dataclass(frozen=True, slots=True)
class MockupImage:
    variant_id: CatalogVariantId
    placement: str
    url: str


@dataclass(frozen=True, slots=True)
class MockupTask:
    id: int
    status: str
    mockups: tuple[MockupImage, ...]
    failures: tuple[str, ...]


# ---------------------------------------------------------------- Fehler

ERROR_TEXTS = {
    "timeout": "Der Anbieter antwortet nicht (Zeitüberschreitung)",
    "network": "Der Anbieter ist nicht erreichbar (Netzwerk)",
    "rate_limited": "Zu viele Anfragen beim Anbieter - später erneut versuchen",
    "server": "Fehler beim Anbieter",
    "estimate_pending": "Die Kostenschätzung ist noch nicht fertig",
    "confirm_in_progress": "Die Bestätigung läuft schon - Ergebnis abwarten",
    "draft_in_progress": "Der Entwurf wird gerade angelegt - Ergebnis abwarten",
    "draft_unreadable": "Entwurf bei Printful gerade nicht lesbar – bitte gleich noch einmal",
    "draft_claim_broken": "Entwurfs-Merkposten beschädigt – bitte in Printful prüfen",
    "confirm_unclear": "Bestätigung unklar – bitte in Printful prüfen",
    "unauthorized": "Der Anbieter lehnt den Schlüssel ab",
    "forbidden": "Dem Schlüssel fehlt ein Recht beim Anbieter",
    "not_found": "Beim Anbieter nicht gefunden",
    "redirect": "Der Anbieter leitet um - wird nicht verfolgt",
    "invalid_response": "Der Anbieter antwortet, aber nicht wie erwartet",
    "no_usable_rows": "Der Anbieter liefert keine einzige brauchbare Zeile",
    "no_key": "Kein lesbarer Schlüssel für den Anbieter hinterlegt",
    "unexpected": "Unerwartete Antwort des Anbieters",
    "bad_request": "Der Anbieter lehnt die Daten ab",
    "conflict": "Der Auftrag ist beim Anbieter in einem anderen Stand",
    "estimate_failed": "Die Kostenschätzung ist gescheitert",
    "not_draft": "Der Auftrag ist kein Entwurf mehr",
    "idempotency_conflict": "Dieser Schlüssel gehört schon zu einem anderen Auftrag",
    "test_draft": "Ein Testentwurf wird nie bestätigt - nur angesehen und gelöscht",
    "not_test_draft": "Der Auftrag ist kein Testentwurf",
}


class FulfillmentError(Exception):
    kind = "permanent"

    def __init__(self, reason: str, *, status: int | None = None, retry_after: float | None = None,
                 provider_detail: str = ""):
        self.reason = reason if reason in ERROR_TEXTS else "unexpected"
        self.status = status
        self.retry_after = retry_after
        self.provider_detail = provider_detail
        super().__init__(self.text)

    @property
    def text(self) -> str:
        return ERROR_TEXTS[self.reason] + (f" ({self.status})" if self.status else "")

    def __repr__(self) -> str:
        return f"{type(self).__name__}(reason={self.reason!r}, status={self.status!r})"


class FulfillmentTransient(FulfillmentError):
    """Vorübergehend: später erneut versuchen."""
    kind = "transient"


class FulfillmentPermanent(FulfillmentError):
    """Dauerhaft: der Admin muss etwas tun (Schlüssel, Rechte, Nummer)."""
    kind = "permanent"


class FulfillmentInvalid(FulfillmentError):
    """Daten ungültig: diese Bestellung blockieren, bis jemand sie korrigiert."""
    kind = "invalid"


# ---------------------------------------------------------------- Die Schnittstelle

@runtime_checkable
class FulfillmentProvider(Protocol):
    """Was der Shop von einem Druckdienstleister braucht. Schreibende Aufrufe nehmen ``db`` für die Sperren aus
    ``shop_config``: Entwürfe ``require_printful_drafts``, Bestätigen ``require_printful_writes``."""

    async def check_connection(self) -> dict: ...

    async def catalog_product(self, product_id: CatalogProductId) -> CatalogProduct: ...

    async def catalog_variants(self, product_id: CatalogProductId, *, currency: str = "EUR",
                               region: str = "europe",
                               price_for: tuple[CatalogVariantId, ...] | None = None) -> tuple[CatalogVariant, ...]: ...

    async def catalog_products(self, *, region: str = "europe") -> tuple[CatalogEntry, ...]: ...

    async def catalog_categories(self) -> tuple[CatalogCategory, ...]: ...

    async def print_areas(self, product_id: CatalogProductId) -> tuple[PrintArea, ...]: ...

    async def mockup_templates(self, product_id: CatalogProductId) -> tuple[MockupTemplate, ...]: ...

    async def estimate_costs(self, lines: tuple[DraftLine, ...], *, country_code: str, zip_code: str,
                             state_code: str = "") -> Costs: ...

    async def create_draft(self, db, draft: DraftOrder) -> FulfillmentOrder: ...

    async def get_order(self, order: PrintfulOrderId | str) -> FulfillmentOrder: ...

    async def delete_draft(self, db, order_id: PrintfulOrderId, *, test_draft: bool = False) -> None: ...

    async def confirm_order(self, db, order_id: PrintfulOrderId, *, idempotency_key: str,
                            force_after_review: bool = False) -> FulfillmentOrder: ...

    async def add_file(self, db, url: str, *, filename: str | None = None) -> PrintFile: ...

    async def get_file(self, file_id: int) -> PrintFile: ...

    async def create_mockup_task(self, product_id: CatalogProductId, variant_ids: tuple[CatalogVariantId, ...],
                                 placements: tuple[Placement, ...]) -> MockupTask: ...

    async def get_mockup_task(self, task_id: int) -> MockupTask: ...
