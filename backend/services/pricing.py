"""Preis- und Buchungsmodell (#315): Kostenpositionen, Angebot, unveränderlicher Preis-Snapshot.

Ein Angebot (Event, später Turnier) hat null oder mehr **Positionen**. Jede Position ist typisiert:
Bezeichnung, Betrag in Cent, Währung, Preisbasis, Steuerprofil, optional die Dolibarr-Leistung.
Keine Formeln, keine Geldlogik aus Freitext. Beträge sind ganze Cent - nie Gleitkomma.

Preisbasen:
- ``per_registration``: einmal je Anmeldung (Menge 1)
- ``per_person``: je Person - buchende Person plus abrechenbare Begleitpersonen
- ``per_team``: einmal je Team (Turniere, später)

``quote`` rechnet aus Angebot und Buchung die Summe. ``snapshot`` friert das Ergebnis ein: Was
die Person bestätigt hat, bleibt so - auch wenn der Admin die Positionen danach ändert. Der
Snapshot trägt die Version des Angebots und einen Prüfwert.

Bestehende Angebote sind kostenlos (``enabled`` False, keine Positionen); nichts davon ändert
das Verhalten bestehender Anmeldungen.
"""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP

from models import now_utc

PRICE_BASES = ("per_registration", "per_person", "per_team")
PRICE_BASE_LABELS = {"per_registration": "je Anmeldung", "per_person": "je Person", "per_team": "je Team"}
CURRENCIES = ("EUR",)
# Steuerprofile sind Buchhaltungsentscheide (#317, #322): nur freigegebene Schlüssel, keine Sätze im Freitext.
TAX_PROFILES = {
    "none": "Ohne Umsatzsteuer (Verein, Kleinunternehmer)",
    "standard": "Normalsatz",
    "reduced": "Ermäßigter Satz",
}
INVOICE_TIMINGS = ("on_confirm", "manual")
MAX_POSITIONS = 12
MAX_AMOUNT_CENTS = 1_000_000_00  # eine Million Euro - alles darüber ist ein Tippfehler


class PricingError(ValueError):
    """Ein Angebot ist nicht zulässig - die Meldung ist für Menschen."""


def cents_from_amount(value) -> int:
    """„20“, „20.50“, 20.5 → 2050. Rundet kaufmännisch auf ganze Cent."""
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        raise PricingError("Betrag muss eine Zahl sein.")
    try:
        amount = Decimal(str(value).replace(",", ".").strip())
    except Exception as exc:  # noqa: BLE001 - jede Nicht-Zahl ist derselbe Fehler
        raise PricingError("Betrag muss eine Zahl sein.") from exc
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    if cents < 0:
        raise PricingError("Beträge sind nicht negativ.")
    if cents > MAX_AMOUNT_CENTS:
        raise PricingError("Betrag ist unrealistisch hoch.")
    return cents


def format_cents(cents: int, currency: str = "EUR") -> str:
    euros, rest = divmod(int(cents), 100)
    symbol = "€" if currency == "EUR" else currency
    return f"{euros},{rest:02d} {symbol}"


def normalize_position(raw: dict, index: int) -> dict:
    """Eine Position aus der Eingabe - typisiert, mit klaren Fehlern."""
    if not isinstance(raw, dict):
        raise PricingError("Position muss ein Objekt sein.")
    label = str(raw.get("label") or "").strip()
    if not label:
        raise PricingError(f"Position {index + 1}: Bezeichnung fehlt.")
    basis = str(raw.get("basis") or "per_person")
    if basis not in PRICE_BASES:
        raise PricingError(f"Position „{label}“: unbekannte Preisbasis.")
    currency = str(raw.get("currency") or "EUR").upper()
    if currency not in CURRENCIES:
        raise PricingError(f"Position „{label}“: nur Euro ist eingerichtet.")
    tax_profile = str(raw.get("tax_profile") or "none")
    if tax_profile not in TAX_PROFILES:
        raise PricingError(f"Position „{label}“: unbekanntes Steuerprofil.")
    cents = raw.get("amount_cents")
    cents = int(cents) if cents is not None and cents != "" else cents_from_amount(raw.get("amount"))
    if cents < 0 or cents > MAX_AMOUNT_CENTS:
        raise PricingError(f"Position „{label}“: Betrag außerhalb des Rahmens.")
    product_id = raw.get("dolibarr_product_id")
    if product_id not in (None, ""):
        try:
            product_id = int(product_id)
        except (TypeError, ValueError) as exc:
            raise PricingError(f"Position „{label}“: Dolibarr-Leistung muss eine Nummer sein.") from exc
        if product_id < 1:
            raise PricingError(f"Position „{label}“: Dolibarr-Leistung muss eine Nummer sein.")
    else:
        product_id = None
    key = str(raw.get("key") or "").strip() or f"pos-{index + 1}"
    return {
        "key": key[:40],
        "label": label[:120],
        "description": str(raw.get("description") or "").strip()[:500],
        "amount_cents": cents,
        "currency": currency,
        "basis": basis,
        "tax_profile": tax_profile,
        "optional": bool(raw.get("optional")),
        "dolibarr_product_id": product_id,
        "order": index,
    }


def normalize_offer(raw: dict | None) -> dict:
    """Die Abrechnungs-Einstellung eines Angebots, geprüft. Leer = kostenlos."""
    raw = raw or {}
    enabled = bool(raw.get("enabled"))
    positions = raw.get("positions") or []
    if not isinstance(positions, list):
        raise PricingError("Positionen müssen eine Liste sein.")
    if len(positions) > MAX_POSITIONS:
        raise PricingError(f"Höchstens {MAX_POSITIONS} Positionen je Angebot.")
    normalized = [normalize_position(item, index) for index, item in enumerate(positions)]
    keys = [item["key"] for item in normalized]
    if len(set(keys)) != len(keys):
        raise PricingError("Positionen brauchen eindeutige Schlüssel.")
    if enabled and not normalized:
        raise PricingError("Abrechnung aktiv, aber keine Position eingetragen.")
    if enabled and all(item["optional"] for item in normalized):
        raise PricingError("Mindestens eine Position muss Pflicht sein.")
    timing = str(raw.get("invoice_timing") or "on_confirm")
    if timing not in INVOICE_TIMINGS:
        raise PricingError("Unbekannter Rechnungszeitpunkt.")
    currencies = {item["currency"] for item in normalized}
    if len(currencies) > 1:
        raise PricingError("Alle Positionen eines Angebots haben dieselbe Währung.")
    return {
        "enabled": enabled,
        "positions": normalized,
        "invoice_timing": timing,
        "currency": next(iter(currencies), "EUR"),
        "version": int(raw.get("version") or 0),
    }


def bump_version(previous: dict | None, offer: dict) -> dict:
    """Ändert sich etwas Preisrelevantes, zählt die Version hoch - Snapshots nennen sie."""
    before = _price_relevant(previous or {})
    after = _price_relevant(offer)
    version = int((previous or {}).get("version") or 0)
    if before != after:
        version += 1
    return {**offer, "version": version, "updated_at": now_utc().isoformat()}


def _price_relevant(offer: dict) -> str:
    positions = [
        {k: item.get(k) for k in ("key", "label", "amount_cents", "currency", "basis", "tax_profile", "optional", "dolibarr_product_id")}
        for item in (offer.get("positions") or [])
    ]
    return json.dumps({"enabled": bool(offer.get("enabled")), "positions": positions}, sort_keys=True)


def is_paid(offer: dict | None) -> bool:
    return bool(offer and offer.get("enabled") and offer.get("positions"))


def quote(offer: dict | None, *, seats: int = 1, selected: list[str] | None = None, teams: int = 1) -> dict:
    """Summe für eine Buchung. `seats` = buchende Person plus Begleitpersonen.

    Optionale Positionen zählen nur, wenn sie in `selected` stehen; Pflichtpositionen immer.
    Unbekannte Schlüssel in `selected` sind ein Fehler - niemand bucht, was es nicht gibt.
    """
    if not is_paid(offer):
        return {"currency": "EUR", "positions": [], "total_cents": 0, "version": int((offer or {}).get("version") or 0), "free": True}
    seats = max(1, int(seats))
    chosen = set(selected or [])
    known = {item["key"] for item in offer["positions"]}
    unknown = chosen - known
    if unknown:
        raise PricingError("Unbekannte Position gewählt.")
    lines = []
    for item in sorted(offer["positions"], key=lambda p: p.get("order", 0)):
        if item.get("optional") and item["key"] not in chosen:
            continue
        quantity = seats if item["basis"] == "per_person" else max(1, int(teams)) if item["basis"] == "per_team" else 1
        lines.append({
            "key": item["key"],
            "label": item["label"],
            "description": item.get("description") or "",
            "basis": item["basis"],
            "quantity": quantity,
            "unit_cents": int(item["amount_cents"]),
            "total_cents": int(item["amount_cents"]) * quantity,
            "tax_profile": item["tax_profile"],
            "optional": bool(item.get("optional")),
            "dolibarr_product_id": item.get("dolibarr_product_id"),
        })
    return {
        "currency": offer.get("currency") or "EUR",
        "positions": lines,
        "total_cents": sum(line["total_cents"] for line in lines),
        "version": int(offer.get("version") or 0),
        "free": False,
    }


def snapshot(quote_result: dict, *, recipient: dict, source: dict) -> dict:
    """Der eingefrorene Preis einer bestätigten Buchung. Wird nie geändert, nur ersetzt."""
    body = {
        "currency": quote_result["currency"],
        "positions": quote_result["positions"],
        "total_cents": int(quote_result["total_cents"]),
        "offer_version": int(quote_result.get("version") or 0),
        "recipient": {
            "user_id": recipient.get("id") or recipient.get("user_id"),
            "display_name": recipient.get("display_name") or recipient.get("username"),
            "email": recipient.get("email"),
        },
        "source": source,   # z. B. {"kind": "event", "id": ..., "registration_id": ...}
        "accepted_at": now_utc().isoformat(),
    }
    digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    return {**body, "hash": digest}


def public_offer(offer: dict | None) -> dict | None:
    """Was die Anmeldeseite braucht - ohne Dolibarr-Nummern."""
    if not is_paid(offer):
        return None
    return {
        "enabled": True,
        "currency": offer.get("currency") or "EUR",
        "version": int(offer.get("version") or 0),
        "positions": [
            {k: item.get(k) for k in ("key", "label", "description", "amount_cents", "basis", "optional")}
            for item in sorted(offer["positions"], key=lambda p: p.get("order", 0))
        ],
    }


def describe(quote_result: dict) -> str:
    """„40,00 € (2 × Kostenbeitrag 20,00 €)“ - für Anmeldebestätigung und Hinweise."""
    if quote_result.get("free") or not quote_result.get("positions"):
        return "kostenlos"
    parts = []
    for line in quote_result["positions"]:
        unit = format_cents(line["unit_cents"], quote_result["currency"])
        parts.append(f"{line['quantity']} × {line['label']} {unit}" if line["quantity"] > 1 else f"{line['label']} {unit}")
    return f"{format_cents(quote_result['total_cents'], quote_result['currency'])} ({', '.join(parts)})"
