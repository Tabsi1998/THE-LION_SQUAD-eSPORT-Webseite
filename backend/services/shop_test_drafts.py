"""Testentwurf an Printful (#2062) - Verwaltung → Finanzen → Shop → Testentwurf.

Die Finanzen legen eine Bestellung **nur als Entwurf** bei Printful an (nie bestätigt, nie bezahlt), prüfen sie im
Printful-Dashboard und löschen sie wieder. So zeigt sich vor der ersten echten Bestellung, ob Produkt, Variante,
Druckdateien, Positionen, Anschrift, ``external_id`` und Preise sauber übergeben werden.

Ablauf:

1. ``preview`` - erzeugt die Druckdateien über **denselben Weg wie eine Bestellung** (``shop_print_files.freeze_line``:
   Grunddatei je Fläche, mit Gamertag eine eigene Datei), baut daraus den Auftrag (``DraftOrder``) und fragt Printful
   nur nach der Kostenschätzung - bei Printful wird nichts gespeichert. Der Rumpf, der später hinausgeht
   (``printful_client.order_payload``), steht fertig im Protokoll (``shop_test_drafts``, Stand ``preview``).
2. ``send`` - sendet **genau diesen Rumpf** als Entwurf (``create_draft``) und hält fest, was Printful zurückmeldet und
   wo es von der Vorschau abweicht (Varianten-Nummer, Dateien, Positionen, Preise). Ein Idempotenzschlüssel und ein
   bedingter Wechsel des Stands verhindern doppeltes Senden; der Claim des Adapters (je ``external_id``) verhindert
   zusätzlich einen zweiten Auftrag.
3. ``delete`` - löscht den Entwurf bei Printful (``delete_draft``) und nimmt die eigenen Druckdateien der Vorschau vom
   Netz; das Protokoll bleibt mit Prüfsummen.

Ein **Bestätigen** gibt es hier nicht - keine Funktion, keine Route; ``printful_client.confirm_order`` lehnt einen
Auftrag aus dieser Sammlung ab (``test_draft``). Entwürfe gehen auch bei ausgeschaltetem Notschalter
(``shop_config.require_printful_drafts``: Stufe ab „Nur Admins (Test)“ und lesbarer Schlüssel).

Ein Testentwurf ist eine eigene Art (``kind = "test_draft"``) in einer eigenen Sammlung: er ist keine Bestellung und
zählt nicht in Umsatz, Rechnungen, Dolibarr oder Statistiken. Keine Mitgliederdaten - nur die Vereinsadresse (aus den
Rechtsangaben vorbelegt, im Formular änderbar) und Test-Gamertags; der Gamertag selbst steht nirgends als Text.
"""
from __future__ import annotations

import dataclasses
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from models import new_id, now_utc
from services import shop_catalog, shop_common, shop_config, shop_gamertag, shop_print_files, shop_products
from services.mutation_lock import MutationLockBusy, mutation_lock
from services.printful_client import order_payload
from services.shop_common import ShopConflict, ShopError, record_admin_action
from services.shop_fulfillment import (
    ERROR_TEXTS, CatalogVariantId, DraftLine, DraftOrder, FulfillmentError, FulfillmentInvalid, FulfillmentOrder,
    FulfillmentPermanent, FulfillmentProvider, Placement, PrintfulOrderId, Recipient)

COLLECTION = "shop_test_drafts"
KIND = "test_draft"
EXTERNAL_PREFIX = "lsw-test-"
STATES = ("preview", "sending", "sent", "deleting", "deleted")
STATE_LABELS = {"preview": "Vorschau", "sending": "wird gesendet", "sent": "Entwurf bei Printful",
                "deleting": "wird gelöscht", "deleted": "gelöscht"}
MOCKUP_PENDING = "Mockup folgt (#1710)."
NO_PUBLIC_URL = ("Die Druckdateien haben keine öffentliche https-Adresse - Printful kann sie so nicht holen. "
                 "PUBLIC_BACKEND_URL (oder PUBLIC_BASE_URL) in der .env auf die https-Adresse der Website setzen.")
DEFAULT_DASHBOARD_URL = "https://www.printful.com/dashboard/default/orders?search={order_id}"
DASHBOARD_PREFIX = "https://www.printful.com/"
# Unterhalb dieser Zahl an Cent gilt ein Preisunterschied als Rundung (Schätzung und Auftrag rechnen getrennt).
PRICE_TOLERANCE_CENTS = 1


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if low <= value <= high else default


def limits() -> dict:
    """Alle Grenzen einstellbar über die Umgebung (Vorgaben in Klammern):

    - ``SHOP_TEST_DRAFT_PREVIEW_LIMIT`` (20) Vorschauen und ``SHOP_TEST_DRAFT_SEND_LIMIT`` (5) Sende- bzw.
      Löschaufrufe je Konto im Fenster ``SHOP_TEST_DRAFT_WINDOW_SECONDS`` (60 s),
    - ``SHOP_TEST_DRAFT_PREVIEW_MINUTES`` (60): so lange darf eine Vorschau gesendet werden,
    - ``SHOP_TEST_DRAFT_MAX_OPEN`` (5): so viele Testentwürfe dürfen gleichzeitig bei Printful liegen,
    - ``SHOP_TEST_DRAFT_SENDING_SECONDS`` (120): ein hängendes „wird gesendet“ darf danach erneut senden (der Claim des
      Adapters findet einen schon angelegten Auftrag über die ``external_id``)."""
    return {
        "preview_limit": _env_int("SHOP_TEST_DRAFT_PREVIEW_LIMIT", 20, 1, 1000),
        "send_limit": _env_int("SHOP_TEST_DRAFT_SEND_LIMIT", 5, 1, 1000),
        "window_seconds": _env_int("SHOP_TEST_DRAFT_WINDOW_SECONDS", 60, 1, 86_400),
        "preview_minutes": _env_int("SHOP_TEST_DRAFT_PREVIEW_MINUTES", 60, 1, 7 * 24 * 60),
        "max_open": _env_int("SHOP_TEST_DRAFT_MAX_OPEN", 5, 1, 100),
        "sending_seconds": _env_int("SHOP_TEST_DRAFT_SENDING_SECONDS", 120, 30, 3600),
    }


def dashboard_url(order_id: int | None) -> str | None:
    """Link ins Printful-Dashboard. Vorlage ``SHOP_PRINTFUL_DASHBOARD_ORDER_URL`` mit ``{order_id}`` - nur Adressen
    unter https://www.printful.com/, sonst gilt die Vorgabe (Auftragsliste mit Suche nach der Nummer)."""
    if not order_id:
        return None
    template = (os.environ.get("SHOP_PRINTFUL_DASHBOARD_ORDER_URL") or "").strip()
    if not template.startswith(DASHBOARD_PREFIX) or "{order_id}" not in template or any(c.isspace() for c in template):
        template = DEFAULT_DASHBOARD_URL
    return template.replace("{order_id}", str(int(order_id)))


def _collection(db):
    return db[COLLECTION]


def _now() -> datetime:
    return now_utc()


def _parse(stamp: Any) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(stamp))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


# ================================================================ Zugang und Vorbelegung

async def access(db) -> dict:
    """Darf gerade ein Testentwurf an Printful gehen? Stufe ab „Nur Admins (Test)“ und lesbarer Schlüssel - der
    Notschalter spielt keine Rolle (er sperrt nur das Bestätigen)."""
    config = await shop_config.load(db)
    stage = shop_config.effective_stage(config)
    key = shop_config.key_state(config)
    problems = []
    if stage not in shop_config.DRAFT_STAGES:
        problems.append(f"Der Shop steht auf „{shop_config.STAGE_LABELS[stage]}“ - Testentwürfe erst ab der Stufe "
                        "„Nur Admins (Test)“ (Shop → Einstellungen).")
    if key != "ok":
        problems.append("Kein lesbarer Printful-Schlüssel hinterlegt (Shop → Einstellungen).")
    return {"allowed": not problems, "problems": problems, "stage": stage,
            "stage_label": shop_config.STAGE_LABELS[stage], "key_state": key,
            "orders_to_printful": config["orders_to_printful"]}


_COUNTRY_CODES = {"österreich": "AT", "austria": "AT", "at": "AT"}


async def club_address(db) -> dict:
    """Die Vereinsadresse aus den Rechtsangaben (Einstellungen → Rechtliches, bzw. aus Dolibarr übernommen) - als
    Vorbelegung des Formulars. Fehlt etwas, bleibt das Feld leer und ``complete`` ist ``False``: dann im Formular
    eintragen oder in den Rechtsangaben pflegen. Nie eine Person: Empfänger ist der Verein."""
    from services import club_facts
    from services.public_site_settings import build_public_legal_settings

    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0}) or {}
    overlay, _source = await club_facts.public_legal_source(db, branding)
    legal = build_public_legal_settings(branding, overlay)
    country = str(legal.get("country") or "").strip()
    code = _COUNTRY_CODES.get(country.casefold(), country.upper() if re.fullmatch(r"[A-Za-z]{2}", country) else "")
    address = {"name": legal.get("legal_name") or "", "street": legal.get("street_address") or "",
               "street2": legal.get("address_extra") or "", "zip": legal.get("postal_code") or "",
               "city": legal.get("city") or "", "country": code or "AT"}
    complete = all(address[key] for key in ("name", "street", "zip", "city"))
    return {"address": address, "complete": complete,
            "hint": None if complete else "Die Vereinsadresse ist in den Rechtsangaben nicht vollständig - bitte hier "
                                          "eintragen oder unter Einstellungen → Rechtliches pflegen."}


def _clean_address(raw: Any) -> dict:
    """Die Anschrift für den Entwurf - geprüft wie eine Lieferanschrift (``shop_common.shipping_address``), nur
    Österreich."""
    if not isinstance(raw, dict):
        raise ShopError("Anschrift fehlt.")
    unknown = sorted(set(raw) - {"name", "street", "street2", "zip", "city", "country"})
    if unknown:
        raise ShopError(f"Anschrift: unbekannte Felder ({', '.join(unknown)}).")
    checked = shop_common.shipping_address({"recipient": raw.get("name"), "street": raw.get("street"),
                                            "street2": raw.get("street2"), "zip": raw.get("zip"),
                                            "city": raw.get("city"), "country": raw.get("country"),
                                            "source": "checkout"})
    shop_config.check_shipping_country(checked["country"])
    return {"name": checked["recipient"], "street": checked["street"], "street2": checked.get("street2") or "",
            "zip": checked["zip"], "city": checked["city"], "country": checked["country"]}


# ================================================================ Produkte und Varianten zur Auswahl

def _has_gamertag(rows: list[dict]) -> bool:
    return any(layer.get("kind") == "gamertag" for row in rows for layer in row.get("layers") or [])


async def products(db) -> list[dict]:
    """Produkte mit Printful-Produkt und angebotenen Varianten - auch Entwürfe (getestet wird vor dem
    Veröffentlichen)."""
    out = []
    for product in await shop_catalog.list_products(db):
        if product.get("status") == "archived" or not (product.get("printful") or {}).get("product_id"):
            continue
        variants = [variant for variant in await shop_catalog.variants_of(db, product["id"]) if variant.get("active")]
        mappings = await shop_catalog.printful_variants_for(db, [variant["id"] for variant in variants])
        rows = await shop_print_files.layout_rows(db, product)
        out.append({
            "id": product["id"], "title": product["title"], "status": product.get("status"),
            "status_label": shop_catalog.STATUS_LABELS.get(product.get("status"), product.get("status")),
            "printful_name": product["printful"].get("name"), "printful_product_id": product["printful"]["product_id"],
            "gamertag": _has_gamertag(rows),
            "variants": [{"id": variant["id"], "label": variant.get("label"), "size": variant.get("size"),
                          "color": variant.get("color"), "color_code": variant.get("color_code"),
                          "price_cents": variant.get("price_cents"),
                          "printful_variant_id": (mappings.get(variant["id"]) or {}).get("printful_variant_id"),
                          "in_stock": (mappings.get(variant["id"]) or {}).get("in_stock"),
                          "blocked_reason": variant.get("blocked_reason")}
                         for variant in variants if mappings.get(variant["id"])],
        })
    return out


async def overview(db) -> dict:
    """Alles für die Seite: Zugang, Produkte, Vereinsadresse, Regeln des Gamertags, Grenzen und die Testentwürfe."""
    rules = await shop_gamertag.load_rules(db)
    return {"access": await access(db), "products": await products(db), "address": await club_address(db),
            "gamertag": {"allowed_text": shop_gamertag.allowed_text(rules), "min_length": rules["min_length"],
                         "max_length": rules["max_length"]},
            "limits": {key: value for key, value in limits().items() if key in ("preview_minutes", "max_open")},
            "drafts": await list_drafts(db), "mockup": MOCKUP_PENDING}


# ================================================================ Vorschau

def _cents_view(costs) -> dict | None:
    return dataclasses.asdict(costs) if costs is not None else None


def _not_sendable(check: dict) -> str:
    failed = [f"{item['label']}: {item['detail']}" for item in check["items"]
              if item["for_review"] and not item["ok"] and item["key"] not in ("prices", "stock")]
    if not failed:
        return ("Nicht sendbar: für diese Variante fehlt eine gültige Druckdatei oder Fläche. Details stehen im "
                "Server-Log; die Vorab-Prüfung im Reiter Produkte hilft weiter.")
    return "Nicht sendbar - die Vorab-Prüfung des Produkts meldet: " + " · ".join(failed[:4])


async def _placements(db, files: list[dict]) -> tuple[tuple[Placement, ...], list[dict]]:
    """Je eingefrorener Druckdatei die Fläche für Printful mit ihrer öffentlichen Adresse - und die Liste fürs
    Protokoll (Prüfsumme, Maße, Herkunft)."""
    places, shown = [], []
    for item in files:
        row = await db.shop_print_files.find_one({"id": item["file_id"]}, {"_id": 0})
        url = shop_print_files.public_url(row) if row and not row.get("public_disabled_at") else None
        if not url or not url.startswith("https://"):
            raise ShopError(NO_PUBLIC_URL)
        try:
            places.append(Placement(placement=item["printful_placement"], technique=item["technique"], file_url=url))
        except ValueError as exc:
            raise ShopError(NO_PUBLIC_URL) from exc
        shown.append({"placement": item["printful_placement"], "technique": item["technique"], "kind": item["kind"],
                      "file_id": item["file_id"], "version": item.get("version"), "sha256": item["sha256"],
                      "width_px": item.get("width_px"), "height_px": item.get("height_px"), "dpi": item.get("dpi"),
                      "url": url})
    return tuple(places), shown


async def _discard(db, record: dict) -> None:
    """Eine Vorschau, die nie hinausging: ihre eigenen Druckdateien (mit Gamertag) und die Zeile weg."""
    await shop_print_files.discard_order_files(db, record["id"])
    await _collection(db).delete_one({"id": record["id"], "state": "preview"})


async def _sweep_previews(db, actor_id: str) -> None:
    """Alte Vorschauen dieser Person und abgelaufene aller Personen aufräumen - es entstehen keine Dateileichen."""
    cutoff = (_now() - timedelta(minutes=limits()["preview_minutes"])).isoformat()
    query = {"state": "preview", "$or": [{"created_by": actor_id}, {"created_at": {"$lt": cutoff}}]}
    stale = await _collection(db).find(query, {"_id": 0}).to_list(200)
    for record in stale:
        await _discard(db, record)


async def preview(db, *, product_id: Any, variant_id: Any, gamertag: Any, address: Any, actor_id: str,
                  provider: FulfillmentProvider) -> dict:
    """Druckdateien wie bei einer Bestellung erzeugen, den Auftrag bauen, Kosten schätzen lassen - bei Printful wird
    nichts gespeichert. Liefert die Ansicht mit allem, was ``send`` später genau so hinausschickt."""
    await shop_config.require_printful_drafts(db)
    product = await shop_catalog.get_product(db, str(product_id or ""))
    if not product or not (product.get("printful") or {}).get("product_id"):
        raise LookupError("Produkt nicht gefunden oder ohne Printful-Produkt.")
    if product.get("status") == "archived":
        raise ShopError("Archivierte Produkte gehen nicht als Testentwurf.")
    variant = await shop_catalog.get_variant(db, str(variant_id or ""))
    if not variant or variant.get("product_id") != product["id"] or not variant.get("active"):
        raise ShopError("Diese Variante gehört nicht zum Produkt oder wird nicht angeboten.")
    mapping = await shop_catalog.printful_variant_for(db, variant["id"])
    if not mapping or not mapping.get("printful_variant_id"):
        raise ShopError("Diese Variante hat keine Printful-Variante - erst Farben und Größen wählen (Schritt 2).")
    recipient = _clean_address(address)
    rows = await shop_print_files.layout_rows(db, product)
    name = None
    raw_name = " ".join(str(gamertag or "").split())
    if _has_gamertag(rows):
        if not raw_name:
            raise ShopError("Dieses Produkt hat ein Gamertag-Feld - bitte einen erfundenen Test-Gamertag eingeben.")
        # Geprüft wie die echte Gamertag-Datei: Zeichen, Länge, Emojis, Wortfilter der Moderation.
        rules = await shop_gamertag.load_rules(db)
        name = shop_gamertag.clean_text(raw_name, rules)
        await shop_gamertag.check_words(db, name, rules)
    elif raw_name:
        raise ShopError("Dieses Produkt hat kein Gamertag-Feld - bitte das Feld leer lassen.")

    try:
        async with mutation_lock(db, f"shop:test-draft:{actor_id}", wait_seconds=0.0, lease_seconds=120.0):
            await _sweep_previews(db, actor_id)
            return await _build(db, product, variant, mapping, recipient, name, actor_id=actor_id, provider=provider)
    except MutationLockBusy as exc:
        raise ShopConflict("Die Vorschau wird gerade erstellt - bitte kurz warten.") from exc


async def _build(db, product: dict, variant: dict, mapping: dict, recipient: dict, name: str | None, *,
                 actor_id: str, provider: FulfillmentProvider) -> dict:
    draft_id, item_id = new_id(), new_id()
    external_id = f"{EXTERNAL_PREFIX}{draft_id}"
    try:
        # Derselbe Weg wie die Bestellung (#2069): je Fläche genau eine Datei, mit Gamertag eine eigene.
        files, _sources = await shop_print_files.freeze_line(
            db, product, variant, gamertag=name, position=1, user_id=actor_id, order_id=draft_id, item_id=item_id,
            printful_variant_id=mapping["printful_variant_id"])
        if not files:
            raise ShopError("Dieses Produkt hat keine Druckdatei - erst Druckflächen und Druckdateien anlegen.")
        placements, shown = await _placements(db, files)
    except ShopError as exc:
        await shop_print_files.discard_order_files(db, draft_id)
        if shop_print_files.NOT_ORDERABLE in str(exc):
            raise ShopError(_not_sendable(await shop_products.run_check(db, product))) from exc
        raise
    except BaseException:
        await shop_print_files.discard_order_files(db, draft_id)
        raise
    line = DraftLine(variant=CatalogVariantId(int(mapping["printful_variant_id"])), quantity=1, placements=placements,
                     external_id=item_id, name=f"{product['title']} - {variant.get('label') or ''}".strip(" -"))
    draft = DraftOrder(external_id=external_id, lines=(line,), recipient=Recipient(
        name=recipient["name"], address1=recipient["street"], address2=recipient["street2"], city=recipient["city"],
        zip=recipient["zip"], country_code=recipient["country"]))
    payload = order_payload(draft)
    estimate, estimate_error = None, None
    try:
        estimate = await provider.estimate_costs((line,), country_code=recipient["country"], zip_code=recipient["zip"])
    except FulfillmentError as exc:
        estimate_error = _error_view(exc)
    warnings = []
    if product.get("status") != "active":
        warnings.append(f"Das Produkt ist noch „{shop_catalog.STATUS_LABELS.get(product.get('status'))}“ - der "
                        "Testentwurf geht trotzdem, bestellen können Mitglieder es noch nicht.")
    if variant.get("blocked_reason") or mapping.get("in_stock") is not True:
        warnings.append("Printful meldet die Variante nicht als lieferbar - Printful kann den Entwurf ablehnen.")
    shop_cost = variant.get("price_cents")
    price = {"shop_cents": shop_cost,
             "printful_subtotal_cents": estimate.subtotal_cents if estimate else None}
    price["level"] = ("open" if None in (price["shop_cents"], price["printful_subtotal_cents"]) else
                      "ok" if abs(price["shop_cents"] - price["printful_subtotal_cents"]) <= PRICE_TOLERANCE_CENTS
                      else "warn")
    now = _now()
    record = {
        "id": draft_id, "kind": KIND, "state": "preview", "external_id": external_id, "item_external_id": item_id,
        "product_id": product["id"], "variant_id": variant["id"], "product_title": product["title"],
        "variant_label": variant.get("label"), "size": variant.get("size"), "color": variant.get("color"),
        "printful_product_id": product["printful"]["product_id"],
        "printful_variant_id": int(mapping["printful_variant_id"]), "with_gamertag": name is not None,
        "files": shown, "recipient": recipient, "payload": payload, "estimate": _cents_view(estimate),
        "estimate_error": estimate_error, "price_check": price, "warnings": warnings,
        "mockup": {"state": "pending", "detail": MOCKUP_PENDING},
        "created_by": actor_id, "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=limits()["preview_minutes"])).isoformat(),
    }
    try:
        await _collection(db).insert_one(dict(record))
    except BaseException:
        await shop_print_files.discard_order_files(db, draft_id)
        raise
    return view(record)


# ================================================================ Senden

def draft_from_payload(payload: dict) -> DraftOrder:
    """Den gespeicherten Rumpf zurück in einen ``DraftOrder`` - so geht genau das hinaus, was die Vorschau zeigte.
    Weicht der neu gebaute Rumpf ab, wird nicht gesendet."""
    try:
        recipient = payload["recipient"]
        lines = tuple(DraftLine(variant=CatalogVariantId(int(item["catalog_variant_id"])),
                                quantity=int(item["quantity"]),
                                placements=tuple(Placement(placement=place["placement"], technique=place["technique"],
                                                           file_url=place["layers"][0]["url"])
                                                 for place in item["placements"]),
                                external_id=item.get("external_id"), name=item.get("name"))
                      for item in payload["order_items"])
        draft = DraftOrder(external_id=payload["external_id"], shipping=payload.get("shipping") or "STANDARD",
                           lines=lines,
                           recipient=Recipient(name=recipient["name"], address1=recipient["address1"],
                                               address2=recipient.get("address2", ""), city=recipient["city"],
                                               zip=recipient["zip"], country_code=recipient["country_code"],
                                               company=recipient.get("company", "")))
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ShopError("Die gespeicherte Vorschau ist beschädigt - bitte neu erstellen.") from exc
    if order_payload(draft) != payload:
        raise ShopError("Die gespeicherte Vorschau ist beschädigt - bitte neu erstellen.")
    return draft


def _order_view(order: FulfillmentOrder) -> dict:
    return {"id": order.id.value, "external_id": order.external_id, "status": order.status, "shipping": order.shipping,
            "costs": _cents_view(order.costs),
            "items": [{"id": item.id, "external_id": item.external_id, "variant_id": item.variant_id.value,
                       "quantity": item.quantity, "name": item.name, "price_cents": item.price_cents,
                       "placements": [{"placement": place.placement, "technique": place.technique,
                                       "file_urls": list(place.file_urls), "status": place.status,
                                       "status_explanation": place.status_explanation}
                                      for place in item.placements]}
                      for item in order.items]}


def _row(label: str, sent: Any, answer: Any, level: str) -> dict:
    return {"label": label, "sent": sent, "printful": answer, "level": level}


def compare(record: dict, order: dict) -> list[dict]:
    """Vorschau gegen die Antwort von Printful - je Punkt eine Zeile mit Ampel: ``ok``, ``warn`` (prüfen, etwa
    Preise der Schätzung gegen den Auftrag) oder ``error`` (falsch übergeben)."""
    payload = record["payload"]
    rows = [_row("Externe Kennung", payload["external_id"], order.get("external_id"),
                 "ok" if order.get("external_id") == payload["external_id"] else "error"),
            _row("Stand bei Printful", "draft", order.get("status"),
                 "ok" if order.get("status") == "draft" else "error")]
    sent_items, got_items = payload["order_items"], order.get("items") or []
    rows.append(_row("Positionen", len(sent_items), len(got_items),
                     "ok" if len(sent_items) == len(got_items) else "error"))
    for index, sent in enumerate(sent_items, start=1):
        got = next((item for item in got_items if item.get("external_id") == sent.get("external_id")),
                   got_items[index - 1] if index <= len(got_items) else {})
        prefix = f"Position {index}: "
        rows.append(_row(prefix + "Printful-Variante", sent["catalog_variant_id"], got.get("variant_id"),
                         "ok" if got.get("variant_id") == sent["catalog_variant_id"] else "error"))
        rows.append(_row(prefix + "Menge", sent["quantity"], got.get("quantity"),
                         "ok" if got.get("quantity") == sent["quantity"] else "error"))
        placed = {place["placement"]: place for place in got.get("placements") or []}
        for place in sent["placements"]:
            answer = placed.pop(place["placement"], None)
            url = place["layers"][0]["url"]
            if answer is None:
                rows.append(_row(f"{prefix}Fläche {place['placement']}", url, None, "error"))
                continue
            same = answer.get("technique") == place["technique"] and answer.get("file_urls") == [url]
            rows.append(_row(f"{prefix}Fläche {place['placement']} ({place['technique']})", url,
                             (answer.get("file_urls") or [None])[0] if len(answer.get("file_urls") or []) <= 1
                             else answer.get("file_urls"), "ok" if same else "error"))
            status = answer.get("status") or ""
            if status and status != "ok":
                explanation = answer.get("status_explanation")
                rows.append(_row(f"{prefix}Datei {place['placement']} bei Printful", "ok",
                                 f"{status}: {explanation}" if explanation else status, "warn"))
        for extra in placed:
            rows.append(_row(f"{prefix}Fläche {extra}", None, extra, "error"))
    estimate, costs = record.get("estimate") or {}, order.get("costs") or {}
    for key, label in (("subtotal_cents", "Ware"), ("shipping_cents", "Versand"), ("vat_cents", "Umsatzsteuer"),
                       ("tax_cents", "Steuer"), ("total_cents", "Gesamt")):
        before, after = estimate.get(key), costs.get(key)
        if before is None and after is None:
            continue
        level = ("ok" if before is not None and after is not None and abs(before - after) <= PRICE_TOLERANCE_CENTS
                 else "warn")
        rows.append(_row(f"Preis: {label} (Schätzung → Auftrag)", before, after, level))
    return rows


def _error_view(exc: FulfillmentError) -> dict:
    """Was im Protokoll steht: der feste Satz zur Ursache, Status und - nur bei abgelehnten Daten - die gekürzte,
    maskierte Begründung von Printful. Nie ein Stacktrace, nie der Schlüssel."""
    return {"reason": exc.reason, "text": ERROR_TEXTS.get(exc.reason, ERROR_TEXTS["unexpected"]), "status": exc.status,
            "provider_detail": exc.provider_detail or None, "at": _now().isoformat()}


async def _get(db, draft_id: str) -> dict:
    record = await _collection(db).find_one({"id": str(draft_id or ""), "kind": KIND}, {"_id": 0})
    if not record:
        raise LookupError("Testentwurf nicht gefunden.")
    return record


IDEMPOTENCY_RE = re.compile(r"[A-Za-z0-9:_-]{8,128}")


async def send(db, draft_id: str, *, idempotency_key: Any, actor_id: str, provider: FulfillmentProvider) -> dict:
    """Die Vorschau **als Entwurf** an Printful senden - nie bestätigen. Derselbe Schlüssel noch einmal liefert
    dasselbe Ergebnis (Doppelklick); ein anderer Schlüssel nach dem Senden ist ein Konflikt."""
    key = str(idempotency_key or "")
    if not IDEMPOTENCY_RE.fullmatch(key):
        raise ShopError("Idempotenzschlüssel: 8 bis 128 Zeichen aus Buchstaben, Ziffern, :, - und _.")
    await shop_config.require_printful_drafts(db)
    record = await _get(db, draft_id)
    if record.get("send_key") == key and record["state"] in ("sent", "deleting", "deleted"):
        return view(record)
    now = _now()
    settings = limits()
    stuck = (now - timedelta(seconds=settings["sending_seconds"])).isoformat()
    if record["state"] == "sending" and record.get("sending_at", "") >= stuck:
        raise ShopConflict("Der Testentwurf wird gerade gesendet - Ergebnis abwarten.")
    if record["state"] not in ("preview", "sending"):
        raise ShopConflict("Dieser Testentwurf wurde schon gesendet.")
    expires = _parse(record.get("expires_at"))
    if record["state"] == "preview" and (expires is None or expires <= now):
        raise ShopError("Die Vorschau ist abgelaufen - bitte neu erstellen, damit Dateien und Preise aktuell sind.")
    draft = draft_from_payload(record["payload"])
    open_drafts = await _collection(db).count_documents({"kind": KIND, "state": {"$in": ["sent", "deleting"]}})
    if open_drafts >= settings["max_open"]:
        raise ShopConflict(f"Bei Printful liegen schon {open_drafts} Testentwürfe (höchstens {settings['max_open']}) - "
                           "bitte erst einen löschen.")
    for item in record["files"]:
        row = await db.shop_print_files.find_one({"id": item["file_id"]}, {"_id": 0})
        if not row or row.get("public_disabled_at") or not shop_print_files.file_exists(row):
            raise ShopError("Eine Druckdatei der Vorschau ist nicht mehr da - bitte die Vorschau neu erstellen.")
    claimed = await _collection(db).update_one(
        {"id": record["id"], "$or": [{"state": "preview"}, {"state": "sending", "sending_at": {"$lt": stuck}}]},
        {"$set": {"state": "sending", "send_key": key, "sending_at": now.isoformat(), "sent_by": actor_id}})
    if claimed.modified_count != 1:
        current = await _get(db, draft_id)
        if current.get("send_key") == key and current["state"] in ("sent", "deleting", "deleted"):
            return view(current)
        raise ShopConflict("Der Testentwurf wird gerade gesendet - Ergebnis abwarten.")
    try:
        order = await provider.create_draft(db, draft)
    except BaseException as exc:
        # Nichts oder Unklares bei Printful: zurück auf Vorschau. Ein neuer Versuch ist sicher - der Claim des Adapters
        # findet einen schon angelegten Auftrag über die external_id, statt einen zweiten anzulegen.
        update: dict = {"state": "preview", "send_key": None}
        if isinstance(exc, FulfillmentError):
            update["last_error"] = _error_view(exc)
        await _collection(db).update_one({"id": record["id"], "state": "sending"}, {"$set": update})
        raise
    answer = _order_view(order)
    deviations = compare(record, answer)
    done = _now().isoformat()
    await _collection(db).update_one({"id": record["id"]}, {"$set": {
        "state": "sent", "printful_order_id": order.id.value, "printful_status": order.status, "response": answer,
        "deviations": deviations, "sent_at": done, "last_error": None}})
    await record_admin_action(db, "shop.test_draft.send", actor_id=actor_id, target_id=record["id"], reason="", data={
        "external_id": record["external_id"], "printful_order_id": order.id.value, "product_id": record["product_id"],
        "variant_id": record["variant_id"], "printful_variant_id": record["printful_variant_id"],
        "files": [{"placement": item["placement"], "sha256": item["sha256"]} for item in record["files"]],
        "deviations": sum(1 for row in deviations if row["level"] != "ok")})
    return view(await _get(db, draft_id))


# ================================================================ Löschen

async def delete(db, draft_id: str, *, actor_id: str, provider: FulfillmentProvider) -> dict:
    """Den Entwurf bei Printful löschen (``delete_draft``: nur, solange er ein Entwurf ist) und die eigenen
    Druckdateien vom Netz nehmen. Eine Vorschau, die nie hinausging, wird einfach verworfen."""
    await shop_config.require_printful_drafts(db)
    record = await _get(db, draft_id)
    if record["state"] == "deleted":
        return view(record)
    if record["state"] == "preview":
        await _discard(db, record)
        return {**view(record), "state": "deleted", "state_label": STATE_LABELS["deleted"], "discarded": True}
    if record["state"] != "sent" or not record.get("printful_order_id"):
        raise ShopConflict("Der Testentwurf wird gerade gesendet oder gelöscht - Ergebnis abwarten.")
    claimed = await _collection(db).update_one({"id": record["id"], "state": "sent"},
                                               {"$set": {"state": "deleting", "deleting_at": _now().isoformat()}})
    if claimed.modified_count != 1:
        raise ShopConflict("Der Testentwurf wird gerade gelöscht - Ergebnis abwarten.")
    note = None
    try:
        await provider.delete_draft(db, PrintfulOrderId(int(record["printful_order_id"])))
    except FulfillmentPermanent as exc:
        if exc.reason != "not_found":
            await _back_to_sent(db, record, exc)
            raise
        note = "Bei Printful nicht mehr vorhanden (etwa im Dashboard gelöscht)."
    except FulfillmentInvalid as exc:
        await _back_to_sent(db, record, exc, status="not_draft" if exc.reason == "not_draft" else None)
        if exc.reason == "not_draft":
            raise ShopConflict("Der Auftrag ist bei Printful kein Entwurf mehr - bitte sofort im Printful-Dashboard "
                               "prüfen. Die Website löscht und storniert ihn nicht.") from exc
        raise
    except BaseException as exc:
        await _back_to_sent(db, record, exc if isinstance(exc, FulfillmentError) else None)
        raise
    await shop_print_files.discard_order_files(db, record["id"])
    await _collection(db).update_one({"id": record["id"]}, {"$set": {
        "state": "deleted", "deleted_at": _now().isoformat(), "deleted_by": actor_id, "delete_note": note,
        "last_error": None}})
    await record_admin_action(db, "shop.test_draft.delete", actor_id=actor_id, target_id=record["id"], reason="",
                              data={"external_id": record["external_id"],
                                    "printful_order_id": record["printful_order_id"], "gone_already": note is not None})
    return view(await _get(db, draft_id))


async def _back_to_sent(db, record: dict, exc: FulfillmentError | None, *, status: str | None = None) -> None:
    update: dict = {"state": "sent"}
    if exc is not None:
        update["last_error"] = _error_view(exc)
    if status:
        update["printful_status"] = status
    await _collection(db).update_one({"id": record["id"], "state": "deleting"}, {"$set": update})


# ================================================================ Ansicht

def view(record: dict) -> dict:
    out = {key: value for key, value in record.items() if key not in ("_id", "send_key")}
    out["state_label"] = STATE_LABELS.get(record.get("state"), record.get("state"))
    out["dashboard_url"] = dashboard_url(record.get("printful_order_id")) if record.get("state") in (
        "sent", "deleting") else None
    deviations = record.get("deviations") or []
    out["deviation_summary"] = {level: sum(1 for row in deviations if row["level"] == level)
                                for level in ("ok", "warn", "error")}
    return out


async def list_drafts(db, *, limit: int = 20) -> list[dict]:
    """Die gesendeten Testentwürfe (neueste zuerst) mit Printful-Nummer und Dashboard-Link - ohne Vorschauen."""
    rows = await _collection(db).find({"kind": KIND, "state": {"$ne": "preview"}}, {"_id": 0}).sort(
        "created_at", -1).to_list(limit)
    return [view(row) for row in rows]
