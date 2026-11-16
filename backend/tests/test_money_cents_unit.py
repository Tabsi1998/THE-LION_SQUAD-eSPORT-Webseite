"""Geld in Cent kaufmännisch gerundet (#1908, Fabians Entscheidung vom 16.11.).

Jeder Weg, der einen Betrag in Euro zu ganzen Cent macht - Dolibarr-Belege und -Zahlungen, Dolibarr-Produkte,
Printful-Preise, Turnier- und Eventpreise -, rechnet mit ``Decimal`` und ``ROUND_HALF_UP``: die Hälfte rundet vom
Betrag weg. Vorher rechneten zwei Wege mit ``float`` (1.005 wurde 100 Cent, 10.005 aber 1001) und Printful rundete
auf die gerade Zahl.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from services import dolibarr_billing, money, pricing, printful_client  # noqa: E402

CASES = [("1.005", 101), ("10.005", 1001), ("0.125", 13), ("-0.005", -1), ("12.34000000", 1234), ("2.675", 268), (19.995, 2000)]


@pytest.mark.parametrize("value, cents", CASES)
def test_the_shared_rule_rounds_half_away_from_zero(value, cents):
    assert money.to_cents(value) == cents


@pytest.mark.parametrize("value, cents", CASES)
def test_dolibarr_amounts_follow_the_rule(value, cents):
    assert dolibarr_billing._cents(value) == cents


def test_dolibarr_keeps_empty_and_unreadable_as_none():
    assert dolibarr_billing._cents(None) is None and dolibarr_billing._cents("") is None
    assert dolibarr_billing._cents("kein Betrag") is None


@pytest.mark.parametrize("value, cents", [("1.005", 101), ("0.125", 13), ("12.50", 1250)])
def test_printful_prices_follow_the_rule(value, cents):
    assert printful_client._cents(value) == cents


@pytest.mark.parametrize("value, cents", [("1,005", 101), ("0.125", 13), (20.5, 2050)])
def test_tournament_and_event_prices_follow_the_rule(value, cents):
    assert pricing.cents_from_amount(value) == cents


def test_dolibarr_products_are_rounded_the_same_way():
    # Bruttopreis aus Dolibarr: 1,005 € sind kaufmännisch 101 Cent (mit float waren es 100).
    assert dolibarr_billing.service_view({"id": 7, "price_ttc": "1.005", "tva_tx": "20"})["amount_cents"] == 101
    # Ohne Bruttopreis aus netto und Steuersatz: 0,125 € netto ohne Steuer sind 13 Cent (mit float 12).
    assert dolibarr_billing.service_view({"id": 8, "price": "0.125", "tva_tx": "0"})["amount_cents"] == 13
