"""Gamertag-Druckdatei im Shop-Admin (#1711) - Verwaltung → Finanzen → Shop → Gamertag.

Wie alle Shop-Adminrouten nur der Bereich „Finanzen“ mit Zwei-Faktor (``require_area("finance")``, Regel 3 in
``scripts/check-code-patterns.py``). Regeln ändern und eine Testdatei ablegen brauchen einen Grund und stehen im
Protokoll (``shop.gamertag.rules``, ``shop.gamertag.file``); Ansehen und Vorschau sind keine Adminaktion. Der Name
steht nie im Protokoll und nie im Log. Die Logik steht in ``services/shop_gamertag.py``; die öffentliche Adresse für
Printful ist dieselbe wie bei den Designs (``routes/shop_print_file_routes.py``).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from services import shop_gamertag
from services.shop_common import ShopError

router = APIRouter(prefix="/api/admin/shop", tags=["shop"])


class NameBody(BaseModel):
    model_config = {"extra": "forbid"}

    text: str = Field(..., max_length=200)
    color: str | None = Field(None, max_length=30)


class TestFileBody(NameBody):
    reason: str = Field(..., min_length=3, max_length=500)


class ColorBody(BaseModel):
    model_config = {"extra": "forbid"}

    key: str = Field(..., max_length=30)
    label: str = Field(..., max_length=40)
    hex: str = Field(..., max_length=7)
    garment_colors: list[str] = Field(default_factory=list, max_length=20)


class RulesUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    reason: str = Field(..., min_length=3, max_length=500)
    font: str | None = Field(None, max_length=40)
    height_mode: str | None = Field(None, max_length=10)
    text_height_in: float | None = None
    min_text_height_in: float | None = None
    max_width_in: float | None = None
    dpi: int | None = None
    align: str | None = Field(None, max_length=10)
    placement: str | None = Field(None, max_length=40)
    min_length: int | None = None
    max_length: int | None = None
    allowed_chars: str | None = Field(None, max_length=200)
    block_flagged: bool | None = None
    colors: list[ColorBody] | None = Field(None, max_length=shop_gamertag.MAX_COLORS)
    default_color: str | None = Field(None, max_length=30)


@router.get("/gamertag")
async def gamertag_view(me: dict = Depends(require_area("finance"))):
    """Regeln, Schriften, Leinwand und die zuletzt abgelegten Testdateien."""
    return await shop_gamertag.admin_view(get_db())


@router.post("/gamertag/preview")
async def gamertag_preview(body: NameBody, me: dict = Depends(require_area("finance"))):
    """Die Druckdatei zum Ansehen - geprüft (auch Wortfilter) und gerendert, aber nicht abgelegt."""
    try:
        return await shop_gamertag.preview(get_db(), body.text, color_key=body.color)
    except ShopError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/gamertag/test-files")
async def gamertag_test_file(body: TestFileBody, me: dict = Depends(require_area("finance"))):
    """Eine Testdatei mit Prüfsumme und öffentlicher Adresse für den Testentwurf an Printful (#2062)."""
    db = get_db()
    try:
        stored = await shop_gamertag.store(db, body.text, purpose="test", color_key=body.color, actor_id=me["id"],
                                           reason=body.reason)
    except ShopError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"file": shop_gamertag.file_view(stored["row"]), "created": stored["created"],
            "warnings": stored["warnings"], **await shop_gamertag.admin_view(db)}


@router.put("/gamertag/rules")
async def gamertag_rules(body: RulesUpdate, me: dict = Depends(require_area("finance"))):
    """Regeln und Maße ändern (Zoll; die Antwort nennt auch cm)."""
    db = get_db()
    fields = {key: value for key, value in body.model_dump(exclude_unset=True).items() if key != "reason"}
    try:
        _, changed = await shop_gamertag.save_rules(db, fields, actor_id=me["id"], reason=body.reason)
    except ShopError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"changed": changed, **await shop_gamertag.admin_view(db)}
