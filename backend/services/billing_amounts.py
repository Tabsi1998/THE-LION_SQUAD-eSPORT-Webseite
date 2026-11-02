"""Was an einem Rechnungsauftrag an Geld geflossen ist (#321): bezahlt, erstattet, gutgeschrieben.

Ein Blatt ohne Importe aus ``services`` - die Aufträge (``billing_orders``) und der Abgleich mit Dolibarr
(``dolibarr_billing``) rechnen beide damit, ohne einander dafür zu importieren (sonst entstünde ein
Import-Zyklus, #1408).
"""
from __future__ import annotations


def paid_cents(order: dict, payments: list[dict] | None = None) -> int:
    """Was laut Dolibarr an Geld gekommen ist: die Summe der gebuchten Zahlungen. Eine Gutschrift
    ist keine Zahlung. Kennt die Website die Zahlungen nicht (Recht fehlt), gilt Summe minus Rest
    minus Gutschriften - lieber zu wenig als eine Gutschrift, die sich erstatten lässt (#2226)."""
    payments = order.get("payments") if payments is None else payments
    if payments is not None:
        return sum(int(row.get("amount_cents") or 0) for row in payments)
    total = int(order.get("total_cents") or 0)
    remaining = order.get("remaining_cents")
    if remaining is None:
        return total if order.get("paid") else 0
    return max(0, total - int(remaining) - max(0, credited_cents(order)))


def waived_cents(order: dict) -> int:
    """Was bei „Bezahlt (mit Abzug)“ erlassen wurde (#2226): der Rest, den Dolibarr stehen lässt. Kein Geld und keine Gutschrift -
    zählt nie zu ``paid_cents`` und damit nie zum Erstattungslimit."""
    return max(0, int(order.get("remaining_cents") or 0)) if order.get("payment_state") == "paid_reduced" else 0


def public_payment_state(state: str | None) -> str | None:
    """Der Zahlungsstand für die Person selbst (Web und App): „mit Abzug“ heißt für sie schlicht bezahlt. So kommt bei keinem
    App-Build ein Wert an, den es nicht kennt; die Gründe bleiben in der Verwaltung."""
    return "paid" if state == "paid_reduced" else state


def refunded_cents(order: dict) -> int:
    return sum(int(row.get("amount_cents") or 0) for row in order.get("refunds") or [])


def credited_cents(order: dict) -> int:
    """Was gutgeschrieben ist: ein Entwurf gleicht noch nichts aus - derselbe Maßstab wie beim Zahlungsstand (``dolibarr_billing``)."""
    return sum(int(row.get("total_cents") or 0) for row in order.get("credit_notes") or [] if row.get("status") != "draft")
