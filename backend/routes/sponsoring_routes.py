"""Sponsor werden (#1254): was eine Firma oder ein Verein bekommt, ehrlich und gepflegt.

Die Sponsoren-Seite zeigt unter „Sponsor werden“ ein paar Zahlen, was jede Stufe bekommt (TV-Moment, Website, Urkunden,
Laufband …) und „Unterlagen anfordern“ (Kontaktformular mit Thema Sponsoring), dazu auf Wunsch eine Mappe als PDF.
Gepflegt wird unter Verwaltung → Sponsoren (Bereich Inhalte). Zahlen gibt es nur zwei Arten: die der Vorstand selbst
einträgt (etwa Besuche im Monat) und die die Website selbst zählt (Mitglieder, Discord-Mitglieder, Events und Turniere
der letzten zwölf Monate) - nichts Erfundenes. Ohne gepflegte Inhalte bleibt die Seite bei der kleinen Karte von früher.
"""
from __future__ import annotations

import pathlib
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from auth import require_area
from database import get_db
from models import now_utc
from services.rate_limit import enforce_rate_limit
from storage import PRIVATE_DOC_DIR, ensure_directory

router = APIRouter(prefix="/api/sponsoring", tags=["sponsoring"])

SETTINGS_ID = "sponsoring_offer"
TIERS = ("main", "platinum", "gold", "silver", "bronze")
DEFAULT_TIERS = ["gold", "silver", "bronze"]
AUTO_NUMBERS = {
    "members": "Mitglieder",
    "discord": "im Discord",
    "events_year": "Events im letzten Jahr",
    "tournaments_year": "Turniere im letzten Jahr",
}
PDF_MAX_BYTES = 15 * 1024 * 1024
NUMBERS_MAX = 4
BENEFITS_MAX = 12


class OfferNumber(BaseModel):
    value: str = Field(..., min_length=1, max_length=12)
    label: str = Field(..., min_length=1, max_length=40)


class OfferBenefit(BaseModel):
    label: str = Field(..., min_length=1, max_length=120)
    tiers: list[str] = Field(default_factory=list)


class OfferBody(BaseModel):
    intro: str = Field("", max_length=600)
    numbers: list[OfferNumber] = Field(default_factory=list)
    auto_numbers: list[str] = Field(default_factory=list)
    tiers: list[str] = Field(default_factory=lambda: list(DEFAULT_TIERS))
    benefits: list[OfferBenefit] = Field(default_factory=list)


def _clean(body: dict) -> dict:
    tiers = [tier for tier in TIERS if tier in set(body.get("tiers") or [])] or list(DEFAULT_TIERS)
    benefits = []
    for row in body.get("benefits") or []:
        label = str(row.get("label") or "").strip()[:120]
        if label:
            benefits.append({"label": label, "tiers": [tier for tier in tiers if tier in set(row.get("tiers") or [])]})
    numbers = []
    for row in body.get("numbers") or []:
        value, label = str(row.get("value") or "").strip()[:12], str(row.get("label") or "").strip()[:40]
        if value and label:
            numbers.append({"value": value, "label": label})
    auto = [key for key in AUTO_NUMBERS if key in set(body.get("auto_numbers") or [])]
    return {"intro": str(body.get("intro") or "").strip()[:600], "numbers": numbers[:NUMBERS_MAX], "auto_numbers": auto,
            "tiers": tiers, "benefits": benefits[:BENEFITS_MAX]}


async def _stored(db) -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    return {**_clean(doc), "pdf_key": doc.get("pdf_key") or "", "pdf_name": doc.get("pdf_name") or "", "updated_at": doc.get("updated_at")}


async def counted_numbers(db) -> dict[str, int]:
    """Was die Website selbst zählt - nur Öffentliches, nichts Geschätztes."""
    from services import discord_guilds

    now = now_utc()
    since, until = (now - timedelta(days=365)).isoformat()[:10], now.isoformat()
    main = await db[discord_guilds.COLLECTION].find_one({"role": "main"}, {"_id": 0, "channel_list": 0})
    server = await discord_guilds.public_server(db, main) if main else {"available": False}

    def in_last_year(value) -> bool:
        text = value.isoformat() if hasattr(value, "isoformat") else str(value or "")
        return bool(text) and since <= text <= until

    events = 0
    async for row in db.events.find({"status": {"$nin": ["draft", "cancelled"]}, "visibility": {"$in": [None, "public"]}}, {"_id": 0, "start_date": 1}):
        events += in_last_year(row.get("start_date"))
    tournaments = 0
    async for row in db.tournaments.find({"status": {"$nin": ["draft", "cancelled"]}, "is_public": {"$ne": False}}, {"_id": 0, "start_date": 1, "created_at": 1}):
        tournaments += in_last_year(row.get("start_date") or row.get("created_at"))
    return {
        "members": await db.memberships.count_documents({"member_status": {"$in": ["active", "honorary"]}}),
        "discord": int(server.get("member_count") or 0) if server.get("available") else 0,
        "events_year": events,
        "tournaments_year": tournaments,
    }


def _number_text(value: int) -> str:
    return f"{value:,}".replace(",", ".")


@router.get("/offer")
async def public_offer():
    """„Sponsor werden“ für alle - ohne gepflegte Inhalte `available: false` (dann bleibt die kleine Karte)."""
    db = get_db()
    offer = await _stored(db)
    counted = await counted_numbers(db) if offer["auto_numbers"] else {}
    numbers = list(offer["numbers"]) + [{"value": _number_text(counted[key]), "label": AUTO_NUMBERS[key], "counted": True}
                                        for key in offer["auto_numbers"] if counted.get(key)]
    available = bool(offer["benefits"] or offer["intro"] or numbers)
    return {
        "available": available, "intro": offer["intro"], "numbers": numbers, "tiers": offer["tiers"], "benefits": offer["benefits"],
        "pdf_url": "/api/sponsoring/offer/pdf" if offer["pdf_key"] else "",
    }


@router.get("/offer/admin")
async def admin_offer(me: dict = Depends(require_area("content"))):
    db = get_db()
    offer = await _stored(db)
    return {**offer, "counted": await counted_numbers(db), "auto_labels": AUTO_NUMBERS, "all_tiers": list(TIERS)}


@router.put("/offer/admin")
async def save_offer(body: OfferBody, me: dict = Depends(require_area("content"))):
    db = get_db()
    clean = _clean(body.model_dump())
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {**clean, "updated_at": now_utc().isoformat(), "updated_by": me.get("id")},
                                                       "$setOnInsert": {"id": SETTINGS_ID}}, upsert=True)
    return await admin_offer(me)


def _pdf_path(key: str) -> pathlib.Path | None:
    if not key or "/" in key or "\\" in key or ".." in key or not key.endswith(".pdf"):
        return None
    return PRIVATE_DOC_DIR / key


@router.post("/offer/pdf")
async def upload_pdf(request: Request, file: UploadFile = File(...), me: dict = Depends(require_area("content"))):
    """Die Sponsoring-Mappe als PDF - nur echte PDFs, höchstens 15 MB; ersetzt die vorige."""
    await enforce_rate_limit(request, "sponsoring:pdf", limit=20, window_seconds=3600, subject=me["id"])
    data = await file.read(PDF_MAX_BYTES + 1)
    if len(data) > PDF_MAX_BYTES:
        raise HTTPException(413, "Die Mappe ist größer als 15 MB.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, "Das ist kein PDF.")
    db = get_db()
    previous = (await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0, "pdf_key": 1}) or {}).get("pdf_key")
    key = f"sponsoring-{uuid.uuid4().hex}.pdf"
    ensure_directory(PRIVATE_DOC_DIR)
    (PRIVATE_DOC_DIR / key).write_bytes(data)
    name = pathlib.Path(file.filename or "Sponsoring.pdf").name[:120] or "Sponsoring.pdf"
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"pdf_key": key, "pdf_name": name, "updated_at": now_utc().isoformat()},
                                                       "$setOnInsert": {"id": SETTINGS_ID}}, upsert=True)
    old = _pdf_path(previous or "")
    if old and old.exists():
        old.unlink()
    return await admin_offer(me)


@router.delete("/offer/pdf")
async def delete_pdf(me: dict = Depends(require_area("content"))):
    db = get_db()
    previous = (await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0, "pdf_key": 1}) or {}).get("pdf_key")
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"pdf_key": "", "pdf_name": ""}})
    old = _pdf_path(previous or "")
    if old and old.exists():
        old.unlink()
    return await admin_offer(me)


@router.get("/offer/pdf")
async def offer_pdf():
    """Die Mappe für alle, die „Sponsor werden“ lesen."""
    offer = await _stored(get_db())
    path = _pdf_path(offer["pdf_key"])
    if not path or not path.is_file():
        raise HTTPException(404, "Keine Sponsoring-Mappe hinterlegt.")
    return FileResponse(path, media_type="application/pdf", filename=offer["pdf_name"] or "Sponsoring.pdf",
                        content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff"})
