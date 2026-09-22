"""Preis- und Buchungsmodell (#315): Cent-Beträge, typisierte Preisbasen, eingefrorene Snapshots."""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from services import pricing  # noqa: E402


def offer(**overrides):
    base = {
        "enabled": True,
        "positions": [
            {"key": "beitrag", "label": "Kostenbeitrag inkl. Essen", "amount": "20", "basis": "per_person"},
            {"key": "shirt", "label": "Event-Shirt", "amount": "15.5", "basis": "per_registration", "optional": True},
        ],
    }
    base.update(overrides)
    return pricing.normalize_offer(base)


def test_amounts_are_whole_cents_and_never_floats():
    assert pricing.cents_from_amount("20") == 2000
    assert pricing.cents_from_amount("20,50") == 2050
    assert pricing.cents_from_amount(0.1 + 0.2) == 30
    assert pricing.cents_from_amount("19.995") == 2000
    assert pricing.format_cents(2050) == "20,50 €"
    with pytest.raises(pricing.PricingError):
        pricing.cents_from_amount("-1")
    with pytest.raises(pricing.PricingError):
        pricing.cents_from_amount("zwanzig")
    with pytest.raises(pricing.PricingError):
        pricing.cents_from_amount(True)


def test_offer_validation_rejects_formulas_and_loose_ends():
    with pytest.raises(pricing.PricingError, match="Preisbasis"):
        pricing.normalize_offer({"enabled": True, "positions": [{"label": "x", "amount": 1, "basis": "seats*2"}]})
    with pytest.raises(pricing.PricingError, match="Steuerprofil"):
        pricing.normalize_offer({"enabled": True, "positions": [{"label": "x", "amount": 1, "tax_profile": "20%"}]})
    with pytest.raises(pricing.PricingError, match="keine Position"):
        pricing.normalize_offer({"enabled": True, "positions": []})
    with pytest.raises(pricing.PricingError, match="Pflicht"):
        pricing.normalize_offer({"enabled": True, "positions": [{"label": "x", "amount": 1, "optional": True}]})
    with pytest.raises(pricing.PricingError, match="eindeutige"):
        pricing.normalize_offer({"enabled": True, "positions": [{"key": "a", "label": "x", "amount": 1}, {"key": "a", "label": "y", "amount": 1}]})
    with pytest.raises(pricing.PricingError, match="Euro"):
        pricing.normalize_offer({"enabled": True, "positions": [{"label": "x", "amount": 1, "currency": "USD"}]})
    assert pricing.normalize_offer(None) == {"enabled": False, "positions": [], "invoice_timing": "on_confirm", "currency": "EUR", "version": 0}
    assert not pricing.is_paid(pricing.normalize_offer({"enabled": False, "positions": [{"label": "x", "amount": 5}]}))


def test_quote_per_person_counts_companions_and_optional_only_when_chosen():
    o = offer()
    alone = pricing.quote(o, seats=1)
    assert alone["total_cents"] == 2000 and [p["key"] for p in alone["positions"]] == ["beitrag"]
    with_companion = pricing.quote(o, seats=2)
    assert with_companion["total_cents"] == 4000
    assert with_companion["positions"][0]["quantity"] == 2
    with_shirt = pricing.quote(o, seats=2, selected=["shirt"])
    assert with_shirt["total_cents"] == 4000 + 1550
    assert with_shirt["positions"][1]["quantity"] == 1, "je Anmeldung zählt einmal, auch mit Begleitung"
    with pytest.raises(pricing.PricingError):
        pricing.quote(o, seats=1, selected=["gibt-es-nicht"])
    assert pricing.describe(with_companion) == "40,00 € (2 × Kostenbeitrag inkl. Essen 20,00 €)"
    assert pricing.quote(None, seats=3) == {"currency": "EUR", "positions": [], "total_cents": 0, "version": 0, "free": True}
    assert pricing.describe(pricing.quote(None)) == "kostenlos"


def test_snapshot_is_frozen_and_named_by_offer_version():
    first = pricing.bump_version(None, offer())
    assert first["version"] == 1
    same = pricing.bump_version(first, offer())
    assert same["version"] == 1, "nichts Preisrelevantes geändert"
    dearer = pricing.bump_version(first, offer(positions=[{"key": "beitrag", "label": "Kostenbeitrag inkl. Essen", "amount": "25", "basis": "per_person"}]))
    assert dearer["version"] == 2

    snap = pricing.snapshot(pricing.quote(first, seats=2), recipient={"id": "u1", "display_name": "Paula", "email": "p@example.test"}, source={"kind": "event", "id": "e1"})
    assert snap["total_cents"] == 4000 and snap["offer_version"] == 1 and snap["recipient"]["user_id"] == "u1"
    assert len(snap["hash"]) == 64
    later = pricing.quote(dearer, seats=2)
    assert later["total_cents"] == 5000, "der Admin hat den Preis erhöht ..."
    assert snap["total_cents"] == 4000, "... die bestätigte Buchung bleibt bei 40 €"


def test_public_offer_hides_erp_numbers():
    o = offer(positions=[{"key": "beitrag", "label": "Kostenbeitrag", "amount": "20", "dolibarr_product_id": 17}])
    public = pricing.public_offer(o)
    assert public["positions"][0]["amount_cents"] == 2000
    assert "dolibarr_product_id" not in public["positions"][0]
    assert pricing.public_offer(pricing.normalize_offer(None)) is None
