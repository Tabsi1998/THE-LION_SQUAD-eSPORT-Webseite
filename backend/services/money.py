"""Beträge in Euro zu ganzen Cent - eine Regel für alle Wege (#1908, Fabians Entscheidung vom 16.11.).

Kaufmännisch gerundet: ``Decimal`` statt ``float`` und ``ROUND_HALF_UP``, die Hälfte rundet vom Betrag weg
(1,005 → 101, 0,125 → 13, -0,005 → -1). Nimmt Zahlen und Texte, auch mit Komma; was keine endliche Zahl ist,
wirft ``ValueError`` - der Aufrufer entscheidet, ob das ``None``, ein Fehler für Menschen oder eine kaputte Antwort ist.
"""
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

ONE = Decimal("1")
HUNDRED = Decimal("100")


def to_decimal(value) -> Decimal:
    """Ein Betrag als ``Decimal`` - ``float`` über seinen Text, damit 0.1 nicht 0.1000000000000000055 wird."""
    if isinstance(value, bool):
        raise ValueError("kein Betrag")
    try:
        amount = value if isinstance(value, Decimal) else Decimal(str(value).replace(",", ".").strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("kein Betrag") from exc
    if not amount.is_finite():
        raise ValueError("kein Betrag")
    return amount


def to_cents(value) -> int:
    """``"12.34000000"`` → 1234, ``1.005`` → 101, ``"-0.005"`` → -1."""
    return int((to_decimal(value) * HUNDRED).quantize(ONE, rounding=ROUND_HALF_UP))
