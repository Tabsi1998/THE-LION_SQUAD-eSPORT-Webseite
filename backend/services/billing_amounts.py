"""Was an einem Rechnungsauftrag an Geld geflossen ist (#321): bezahlt, erstattet, gutgeschrieben.

Ein Blatt ohne Importe aus ``services`` - die Aufträge (``billing_orders``) und der Abgleich mit Dolibarr
(``dolibarr_billing``) rechnen beide damit, ohne einander dafür zu importieren (sonst entstünde ein
Import-Zyklus, #1408).
"""
from __future__ import annotations


def paid_cents(order: dict, payments: list[dict] | None = None) -> int:
    """Was laut Dolibarr an Geld gekommen ist: die Summe der gebuchten Zahlungen. Eine Gutschrift
    ist keine Zahlung. Kennt die Website die Zahlungen nicht (Recht fehlt), gilt Summe minus Rest."""
    payments = order.get("payments") if payments is None else payments
    if payments is not None:
        return sum(int(row.get("amount_cents") or 0) for row in payments)
    total = int(order.get("total_cents") or 0)
    remaining = order.get("remaining_cents")
    if remaining is None:
        return total if order.get("paid") else 0
    return max(0, total - int(remaining))


def refunded_cents(order: dict) -> int:
    return sum(int(row.get("amount_cents") or 0) for row in order.get("refunds") or [])


def credited_cents(order: dict) -> int:
    return sum(int(row.get("total_cents") or 0) for row in order.get("credit_notes") or [])
