"""Einkauf eines Shop-Produkts aus Printful-Preisen (#1707, #1709) - ein Blatt-Modul ohne Shop-Abhängigkeiten.

Gebraucht von ``services/shop_products.py`` (Ansicht, Preise übernehmen, Prüfung) und ``services/shop_catalog_sync.py``
(Preiswarnung beim Abgleich). Selbstkostenpreis = Grundpreis der Variante für die Technik plus Aufpreis jeder weiteren
Printful-Druckfläche; eine Fläche steckt im Grundpreis (``included_placement``).
"""
from __future__ import annotations


def technique_of(product: dict) -> str | None:
    printful = product.get("printful") or {}
    return product.get("technique") or printful.get("default_technique")


def used_printful_placements(product: dict) -> list[str]:
    out: list[str] = []
    for row in product.get("placements") or []:
        if row.get("printful_placement") and row["printful_placement"] not in out:
            out.append(row["printful_placement"])
    return out


def included_placement(product: dict) -> str | None:
    """Die Druckfläche, die im Grundpreis der Variante steckt - die anderen kosten ihren Aufpreis."""
    used = used_printful_placements(product)
    chosen = product.get("included_placement")
    if chosen in used:
        return chosen
    if "front" in used:
        return "front"
    return used[0] if used else None


def cost_cents(product: dict, mapping: dict | None) -> int | None:
    """Einkauf je Variante: Grundpreis der Technik plus Aufpreis jeder weiteren Druckfläche. ``None``, wenn ein Preis
    fehlt - dann gibt es keinen Preis, nie einen geratenen."""
    if not mapping or not isinstance(mapping.get("base_cost_cents"), int):
        return None
    total = mapping["base_cost_cents"]
    included = included_placement(product)
    costs = mapping.get("placement_costs") or {}
    for placement in used_printful_placements(product):
        if placement == included:
            continue
        extra = costs.get(placement)
        if not isinstance(extra, int):
            return None
        total += extra
    return total
