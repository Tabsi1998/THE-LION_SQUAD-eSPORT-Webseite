"""Druckvorlagen und Positions-Vorgaben im Shop-Admin (#2069) - Verwaltung → Finanzen → Shop → Produkte, Schritt 3.

Wie alle Shop-Adminrouten nur der Bereich „Finanzen“ mit Zwei-Faktor (``require_area("finance")``, Regel 3 in
``scripts/check-code-patterns.py``). Die Logik steht in ``services/shop_print_templates.py``:

- Vorlagenbilder von Printful über die Website: nur Bilder aus der gespeicherten Vorlage, nur feste Printful-Hosts,
  keine Weiterleitung, Größenlimit, neu kodiert, zwischengespeichert. Eine Adresse aus der Anfrage gibt es nicht.
- Positions-Vorgaben (Brust links, Rücken groß, Tasse umlaufend …) lesen und ändern - Grund optional, Protokoll
  ``shop.print.presets``.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from services import shop_print_templates as templates
from services.shop_common import ShopError

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])

IMAGE_HEADERS = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600",
                 "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer"}


class PresetsUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    presets: list[dict[str, Any]] | None = Field(None, max_length=templates.MAX_PRESETS)
    rules: dict[str, Any] | None = None
    # Vorlagen mit mehreren Ebenen (#2142), etwa „Trikot Rücken“.
    sets: list[dict[str, Any]] | None = Field(None, max_length=templates.MAX_SETS)
    reason: str = Field("", max_length=500)


def _presets_view(doc: dict) -> dict:
    presets = templates.clean_presets(templates.DEFAULT_PRESETS)
    return {**doc, "defaults": presets, "default_sets": templates.clean_sets(templates.DEFAULT_SETS, presets),
            "labels": {"families": templates.FAMILIES, "kinds": templates.PRESET_KINDS,
                       "anchors": templates.ANCHORS, "follows": templates.FOLLOWS, "set_kinds": templates.SET_KINDS}}


@router.get("/print-presets")
async def read_presets(me: dict = Depends(require_area("finance"))):
    """Die Positions-Vorgaben je Art der Fläche und die Regeln (Sicherheitsrand, Auflösung, kleinste Breite)."""
    return _presets_view(await templates.load_presets(get_db()))


@router.put("/print-presets")
async def save_presets(body: PresetsUpdate, me: dict = Depends(require_area("finance"))):
    """Vorgaben bzw. Regeln ändern (Grund optional, Protokoll mit vorher/nachher)."""
    try:
        doc = await templates.save_presets(get_db(), presets=body.presets, rules=body.rules, sets=body.sets,
                                           actor_id=me["id"],
                                           reason=body.reason)
    except ShopError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _presets_view(doc)


@router.get("/print-templates/{printful_product_id}/images/{index}")
async def template_image(printful_product_id: int, index: int, layer: Literal["image", "background"] = "image",
                         tint: str | None = Query(None, pattern=r"^[0-9A-Fa-f]{6}$"),
                         me: dict = Depends(require_area("finance"))):
    """Ein Vorlagenbild von Printful (mit Sicherheitslinien) für die Vorschau - aus dem Zwischenspeicher. Mit ``tint``
    in der Shirtfarbe eingefärbt (#2105) - nur ein Farbcode aus den gespeicherten Printful-Daten, sonst 404."""
    try:
        payload = await templates.template_image(get_db(), printful_product_id, index, layer=layer, tint=tint)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except templates.TemplateImageUnavailable as exc:
        raise HTTPException(502, str(exc)) from exc
    return Response(payload, media_type="image/png", headers=IMAGE_HEADERS)
