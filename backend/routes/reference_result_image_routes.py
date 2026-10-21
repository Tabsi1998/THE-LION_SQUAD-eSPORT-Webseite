"""Externe Serien - Ergebnis-Bild auslesen (#1756): einen Screenshot des Veranstalters auf dem eigenen Server lesen
(Tesseract, kein externer Dienst) und als Zeilen für die Vorschau des Ergebnis-Blatts (#1744) zurückgeben.

Rechte wie beim Eintragen: Vorstand (Bereich Redaktion) und gültige Captains der Saison (``require_series_editor``,
#1749); der Termin muss zur Serie aus dem Pfad gehören. Gespeichert wird **nichts** - weder das Bild noch ein
Ergebnis. Erst wenn jemand die Zeilen im Blatt prüft (unsichere sind gelb) und übernimmt, entsteht ein Blatt über
``PUT …/results``.

**GET …/results/image** - ob und mit welcher Vorlage ausgelesen werden kann::

    {template: {id, name, fields, header} | null, available, max_mb, formats}

``available`` ist falsch, wenn es keine Vorlage gibt (Art ohne Vorlage oder abgeschaltet) oder Tesseract auf dem
Server fehlt.

**POST …/results/image** - Body ist das Bild selbst (PNG, JPG oder WebP, ``Content-Type`` beliebig; geprüft wird der
Inhalt). Antwort::

    {template, rows: [{index, place, dnf, marks, start_number, name, participant_id, team, grid, time, gap,
                       uncertain: [Feld], read: {Feld: gelesen}}],
     track: {name, uncertain} | null, fastest_lap: {name, participant_id, time, uncertain, read} | null,
     driver_of_the_day: {name, participant_id, uncertain, read} | null, uncertain_rows, warnings: [{code, message}]}

- **Grenzen:** Größe ``MAX_IMAGE_UPLOAD_MB`` (schon am Kopf der Anfrage geprüft), Pixel ``MAX_IMAGE_PIXELS`` (am Kopf
  der Bilddatei, vor dem Dekodieren) - wie bei jedem Bild-Upload (``services/image_upload.py``). Das Bild wird nur im
  Speicher gelesen; die Anfrage wird dafür nicht als Formular (mit Zwischendatei) angenommen.
- **Rate-Limit** je Konto: ``RESULT_IMAGE_RATE_LIMIT`` Bilder je ``RESULT_IMAGE_RATE_WINDOW_SECONDS`` (Standard 30 in
  10 Minuten); gleichzeitig liest der Server höchstens ``RESULT_IMAGE_CONCURRENCY`` Bilder (Standard 1).
- **Datenschutz:** Aliase der Mitglieder helfen beim Wiedererkennen nur, wenn der Vorstand liest (wie in #1743);
  Captains bekommen nur, was sie im Blatt ohnehin sehen (Name und Kennung der Teilnehmer).
- Meldungen sind feste Texte, nie aus einer Ausnahme gebaut. Lesen und Abgleich: ``services/result_image_ocr.py`` und
  ``services/result_image_match.py``, Vorlagen: ``services/result_image_templates.py``.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

from fastapi import APIRouter, Depends, HTTPException, Request

from database import get_db
from routes.reference_result_routes import MAX_ROWS
from services import result_image_match, result_image_ocr, result_image_templates
from services.image_upload import MAX_BYTES, MAX_IMAGE_UPLOAD_MB
from services.rate_limit import enforce_rate_limit, keyed_subject
from services.reference_series_access import SeriesAccess, require_series_editor
from services.series_identity import normalize_name
from services.series_participants import series_game_id

logger = logging.getLogger("tls-arena.result-image")
router = APIRouter(prefix="/api/reference-series", tags=["reference-series"])

BASE = "/admin/series/{series_id}/rounds/{round_id}/results/image"
FORMATS = ["image/png", "image/jpeg", "image/webp"]


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


RATE_LIMIT = _env_int("RESULT_IMAGE_RATE_LIMIT", 30)
RATE_WINDOW_SECONDS = _env_int("RESULT_IMAGE_RATE_WINDOW_SECONDS", 600)
CONCURRENCY = _env_int("RESULT_IMAGE_CONCURRENCY", 1)
QUEUE_SECONDS = 30
_gate = asyncio.Semaphore(CONCURRENCY)

NO_TEMPLATE = ("Für diese Serie ist keine Vorlage für Ergebnis-Bilder festgelegt. Der Vorstand wählt sie bei Spur oder "
               "Saison.")
UNAVAILABLE = "Die Texterkennung ist auf dem Server gerade nicht verfügbar. Bitte die Liste einfügen oder abtippen."
BUSY = "Gerade wird schon ein Bild gelesen. Bitte gleich noch einmal versuchen."
TOO_MANY = "Zu viele Bilder in kurzer Zeit. Bitte warte noch {wait}."
NO_TABLE = ("Im Bild wurde keine Ergebnistabelle gefunden. Passt die Vorlage zum Bild? Sonst die Liste einfügen oder "
            "abtippen.")
TOO_MANY_ROWS = (f"Im Bild stehen mehr als {MAX_ROWS} Ergebniszeilen - so viele nimmt ein Ergebnis-Blatt nicht. Bitte "
                 "nur das Ergebnis dieses Termins einfügen.")
BLURRY = "Das Bild ist unscharf oder sehr klein - bitte die gelben Felder genau prüfen."
NO_HEADER = "Die Kopfzeile der Tabelle wurde nicht erkannt - die Spalten sind nach der Vorlage geschätzt."
PARTICIPANT_FIELDS = {"_id": 0, "id": 1, "name": 1, "start_number": 1, "default_team": 1, "link": 1, "profile_id": 1,
                      "guest_name": 1}


async def _template(db, series: dict) -> dict | None:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")},
                                                   {"_id": 0, "kind": 1, "result_image_template": 1}) or {}
    return result_image_templates.get(result_image_templates.effective_id(series, lineage))


async def _body(request: Request) -> bytes:
    """Der Body als Bytes, höchstens ``MAX_BYTES`` - die angegebene Länge wird vor dem Lesen geprüft."""
    declared = request.headers.get("content-length") or ""
    if declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, result_image_ocr.TOO_LARGE)
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise HTTPException(413, result_image_ocr.TOO_LARGE)
        chunks.append(chunk)
    return b"".join(chunks)


async def _aliases(db, series: dict, participants: list[dict]) -> list[dict]:
    """Aliase, die auf Teilnehmer dieser Saison zeigen (Mitglied über das Profil, Gast über den Namen) - für das Spiel
    der Spur oder für alle Spiele. Nur für den Vorstand."""
    by_profile = {row["profile_id"]: row["id"] for row in participants
                  if row.get("link") == "member" and row.get("profile_id")}
    by_guest = {normalize_name(row["guest_name"]): row["id"] for row in participants
                if row.get("link") == "guest" and row.get("guest_name")}
    if not by_profile and not by_guest:
        return []
    game_id = await series_game_id(db, series)
    guest_names = sorted({row["guest_name"] for row in participants
                          if row.get("link") == "guest" and row.get("guest_name")})
    rows = await db.reference_aliases.find(
        {"$or": [{"profile_id": {"$in": sorted(by_profile)}}, {"guest_name": {"$in": guest_names}}]},
        {"_id": 0, "name": 1, "target": 1, "profile_id": 1, "guest_name": 1, "game_id": 1}).to_list(2000)
    out = []
    for alias in rows:
        if alias.get("game_id") not in (game_id, None) or not alias.get("name"):
            continue
        pid = (by_guest.get(normalize_name(alias.get("guest_name"))) if alias.get("target") == "guest"
               else by_profile.get(alias.get("profile_id")))
        if pid:
            out.append({"name": alias["name"], "participant_id": pid})
    return out


def _warnings(reading: result_image_ocr.Reading, built: dict, round_doc: dict) -> list[dict]:
    out = []
    if not reading.header_found:
        out.append({"code": "no_header", "message": NO_HEADER})
    if reading.text_height < 12 or reading.mean_conf < 85:
        out.append({"code": "blurry", "message": BLURRY})
    venue = str(round_doc.get("venue") or "").strip()
    track = (built.get("track") or {}).get("name") or ""
    if venue and track and result_image_match.similarity(track, venue) < 0.72:
        out.append({"code": "other_track", "message": (
            f"Im Bild steht die Strecke „{track[:80]}“, beim Termin „{venue[:80]}“ - richtiges Bild?")})
    return out


@router.get(BASE)
async def result_image_info(series_id: str, round_id: str, access: SeriesAccess = Depends(require_series_editor)):
    """Welche Vorlage gilt und ob der Server lesen kann."""
    await access.round(round_id)
    template = await _template(get_db(), access.series)
    return {"template": result_image_templates.summary(template),
            "available": bool(template) and result_image_ocr.available(),
            "max_mb": MAX_IMAGE_UPLOAD_MB, "formats": FORMATS}


@router.post(BASE)
async def read_result_image(series_id: str, round_id: str, request: Request,
                            access: SeriesAccess = Depends(require_series_editor)):
    """Das Bild lesen und als Zeilen zurückgeben - speichert nichts."""
    db = get_db()
    round_doc = await access.round(round_id)
    template = await _template(db, access.series)
    if template is None:
        raise HTTPException(409, NO_TEMPLATE)
    if not result_image_ocr.available():
        raise HTTPException(503, UNAVAILABLE)
    await enforce_rate_limit(request, "result_image", RATE_LIMIT, RATE_WINDOW_SECONDS,
                             subject=keyed_subject(access.user["id"]), message=TOO_MANY)
    opened = result_image_ocr.open_image(await _body(request))
    if opened.image is None:
        raise HTTPException(opened.status, opened.message)

    try:
        await asyncio.wait_for(_gate.acquire(), timeout=QUEUE_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(503, BUSY) from None
    started = time.monotonic()
    try:
        # Höchstens so viele Zeilen wie die Vorschau des Blatts nimmt - dieselbe Grenze (``MAX_ROWS``).
        reading = await asyncio.to_thread(result_image_ocr.read, opened.image, template, max_rows=MAX_ROWS)
    except result_image_ocr.OcrUnavailable:
        raise HTTPException(503, UNAVAILABLE) from None
    finally:
        _gate.release()
    opened.image = None  # das Bild wird nicht mehr gebraucht
    if reading.too_many_rows:
        raise HTTPException(422, TOO_MANY_ROWS)

    participants = await db.reference_participants.find({"series_id": series_id}, PARTICIPANT_FIELDS).to_list(None)
    aliases = await _aliases(db, access.series, participants) if access.is_board else []
    built = result_image_match.build(reading, template, participants, aliases=aliases)
    logger.info("[result-image] read %s rows (%s uncertain) in %.1fs", len(built["rows"]), built["uncertain_rows"],
                time.monotonic() - started)
    if not built["rows"]:
        raise HTTPException(422, NO_TABLE)
    return {"template": result_image_templates.summary(template), **built,
            "warnings": _warnings(reading, built, round_doc)}
