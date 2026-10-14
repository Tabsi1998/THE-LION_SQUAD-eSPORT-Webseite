"""Werte für CSV-Exporte (#1584): eine Zelle, die mit ``=``, ``+``, ``-``, ``@``, Tab oder Wagenrücklauf beginnt, liest
eine Tabellenkalkulation als Formel. Solche Texte bekommen ein ``'`` davor und bleiben Text; Zahlen bleiben Zahlen."""
from __future__ import annotations

FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    text = str(value)
    return f"'{text}" if text.startswith(FORMULA_STARTS) else text
