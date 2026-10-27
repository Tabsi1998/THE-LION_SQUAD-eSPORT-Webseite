"""Hilfen für Shop-Tests (#1707, #2069) - nur Tests, nie im Betrieb.

Seit der Produktverwaltung geht „veröffentlicht“ nur über die Vorab-Prüfung (``shop_products.set_status``): Printful-
Produkt, Farben und Größen, Druckdateien je Farbe, Lager, Preise und Mockup. Tests der Bestellung und der Preise brauchen
aber ein bestellbares Produkt ohne diesen ganzen Aufbau. ``publish_unchecked`` setzt den Stand darum direkt in der
Datenbank - so, wie ihn eine bestandene Prüfung hinterlässt. Der Service selbst kennt diesen Weg nicht.

``stored_design`` legt ein Design mit einer **echten** PNG-Datei im Speicher der Designs ab (der Test setzt
``storage.SHOP_DESIGN_DIR`` auf einen eigenen Ordner) - der Druckdatei-Generator (#2069) rastert sie.
"""
from __future__ import annotations

import hashlib
import secrets
from io import BytesIO

from PIL import Image, ImageDraw


async def publish_unchecked(db, product_id: str) -> None:
    await db.shop_products.update_one({"id": product_id}, {"$set": {"status": "active"}})


def logo_png(width: int, height: int, color: tuple[int, int, int, int] = (255, 255, 255, 255)) -> bytes:
    """Ein erfundenes Logo: Ellipse auf durchsichtigem Grund - bis an den Rand der Datei."""
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse((0, 0, width - 1, height - 1), fill=color)
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def stored_design(db, key: str, placement: str, colors: list[str], *, width: int = 1200, height: int = 1200,
                        color: tuple[int, int, int, int] = (255, 255, 255, 255), actor_id: str = "finanzen-test",
                        reason: str = "Testdaten anlegen") -> dict:
    """Design mit neuer Fassung und echter Datei (``shop_designs._store``) - wie ein Upload, ohne Route."""
    from services import shop_catalog, shop_designs

    payload = logo_png(width, height, color)
    file_ref, _path = shop_designs._store(payload)
    if not await shop_designs.get_profile(db, key):
        await shop_designs.create_profile(db, key, title=key, placement=placement, garment_colors=colors,
                                          actor_id=actor_id, reason=reason)
    return await shop_catalog.add_design_version(
        db, key, file_ref=file_ref, sha256=hashlib.sha256(payload).hexdigest(), placement=placement,
        details={"public_id": secrets.token_urlsafe(32), "width_px": width, "height_px": height, "has_alpha": True},
        actor_id=actor_id, reason=reason)
