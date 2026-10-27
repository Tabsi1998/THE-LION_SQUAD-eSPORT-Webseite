"""Hilfen für Shop-Tests (#1707) - nur Tests, nie im Betrieb.

Seit der Produktverwaltung geht „veröffentlicht“ nur über die Vorab-Prüfung (``shop_products.set_status``): Printful-
Produkt, Farben und Größen, Druckdateien je Farbe, Lager, Preise und Mockup. Tests der Bestellung und der Preise brauchen
aber ein bestellbares Produkt ohne diesen ganzen Aufbau. ``publish_unchecked`` setzt den Stand darum direkt in der
Datenbank - so, wie ihn eine bestandene Prüfung hinterlässt. Der Service selbst kennt diesen Weg nicht.
"""
from __future__ import annotations


async def publish_unchecked(db, product_id: str) -> None:
    await db.shop_products.update_one({"id": product_id}, {"$set": {"status": "active"}})
