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

    {template, rows: [{index, place, dnf, marks, start_number, name, participant_id, team, grid, time, gap, points,
                       color, uncertain: [Feld], read: {Feld: gelesen}}],
     track: {name, uncertain} | null, session: {name, kind: race|sprint|qualifying} | null,
     fastest_lap | pole: {name, participant_id, time, uncertain, read} | null,
     driver_of_the_day: {name, participant_id, uncertain, read} | null, uncertain_rows,
     team_colors: {Team: "#rrggbb"}, suggested_round: {id, code, venue, club_day} | null,
     warnings: [{code, message}]}

``session`` und ``suggested_round`` (der Termin, zu dem die Strecke im Bild passt) sind nur Hinweise; ``color`` und
``team_colors`` (Schriftfarbe von Startnummer bzw. Team) sind ein Vorschlag für Teamfarben - gespeichert wird nichts.
Saisontabellen und Kalender (keine Zeiten) lehnt die Route mit 422 ab.

- **Grenzen:** Größe ``MAX_IMAGE_UPLOAD_MB`` (schon am Kopf der Anfrage geprüft), Pixel ``MAX_IMAGE_PIXELS`` (am Kopf
  der Bilddatei, vor dem Dekodieren) - wie bei jedem Bild-Upload (``services/image_upload.py``). Das Bild wird nur im
  Speicher gelesen; die Anfrage wird dafür nicht als Formular (mit Zwischendatei) angenommen.
- **Rate-Limit** je Konto: ``RESULT_IMAGE_RATE_LIMIT`` Bilder je ``RESULT_IMAGE_RATE_WINDOW_SECONDS`` (Standard 30 in
  10 Minuten), je Konto ein Bild zur Zeit; gleichzeitig liest der Server höchstens ``RESULT_IMAGE_CONCURRENCY`` Bilder
  (Standard 1). Dekodiert wird erst mit einem freien Platz - wer wartet, hält nur die Datei, kein entpacktes Bild.
- **Zeitbudget** je Bild (``RESULT_IMAGE_OCR_BUDGET_SECONDS``, Standard 60): reicht es nicht für die Seite, kommt 422;
  reicht es nur nicht für die zweiten Lesungen, ist der Rest gelb (Warnung ``out_of_time``).
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
_reading_accounts: set[str] = set()  # Konten, deren Bild dieser Prozess gerade liest - je Konto eins zur Zeit

NO_TEMPLATE = ("Für diese Serie ist keine Vorlage für Ergebnis-Bilder festgelegt. Der Vorstand wählt sie bei Spur oder "
               "Saison.")
UNAVAILABLE = "Die Texterkennung ist auf dem Server gerade nicht verfügbar. Bitte die Liste einfügen oder abtippen."
BUSY = "Gerade wird schon ein Bild gelesen. Bitte gleich noch einmal versuchen."
BUSY_ACCOUNT = "Dein letztes Bild wird noch gelesen. Bitte warte, bis es fertig ist."
TOO_SLOW = ("Das Bild braucht zu lange zum Lesen. Bitte nur die Ergebnistabelle als Screenshot einfügen - oder die "
            "Liste einfügen.")
OUT_OF_TIME = "Das Bild war zu aufwendig, um alles zweimal zu lesen - die gelben Felder bitte genau prüfen."
TOO_MANY = "Zu viele Bilder in kurzer Zeit. Bitte warte noch {wait}."
NO_TABLE = ("Im Bild wurde keine Ergebnistabelle gefunden. Passt die Vorlage zum Bild? Sonst die Liste einfügen oder "
            "abtippen.")
NOT_A_RESULT = ("Das Bild sieht nicht nach einem Rennergebnis aus (keine Zeiten) - etwa eine Saisontabelle oder der "
                "Kalender? Bitte das Ergebnis dieses Termins einfügen.")
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


async def _suggested_round(db, series_id: str, round_doc: dict, track: str) -> dict | None:
    """Der Termin der Saison, zu dem die Strecke im Bild passt - wenn es nicht dieser ist. Nur ein Vorschlag."""
    if not track:
        return None
    rounds = await db.reference_rounds.find(
        {"series_id": series_id, "archived_at": None},
        {"_id": 0, "id": 1, "code": 1, "title": 1, "venue": 1, "club_day": 1, "order": 1}).to_list(500)

    def score(item: dict) -> float:
        return max((result_image_match.similarity(track, str(item.get(key) or "")) for key in ("venue", "title")),
                   default=0.0)

    scored = sorted(((score(item), item) for item in rounds), key=lambda pair: (-pair[0], pair[1].get("order") or 0))
    if not scored or scored[0][0] < 0.72 or scored[0][1]["id"] == round_doc["id"]:
        return None
    if score(round_doc) >= scored[0][0]:
        return None
    best = scored[0][1]
    return {key: best.get(key) for key in ("id", "code", "venue", "club_day")}


def _warnings(reading: result_image_ocr.Reading, built: dict, round_doc: dict, suggestion: dict | None) -> list[dict]:
    out = []
    if not reading.header_found:
        out.append({"code": "no_header", "message": NO_HEADER})
    if reading.out_of_time:
        out.append({"code": "out_of_time", "message": OUT_OF_TIME})
    if reading.text_height < 8 or reading.mean_conf < 85:
        out.append({"code": "blurry", "message": BLURRY})
    venue = str(round_doc.get("venue") or "").strip()
    track = (built.get("track") or {}).get("name") or ""
    if suggestion:
        label = " · ".join(str(part) for part in (suggestion.get("code"), suggestion.get("venue")) if part)
        out.append({"code": "other_track", "message": (
            f"Im Bild steht „{track[:80]}“ - das passt zum Termin {label[:100]}, nicht zu diesem. Richtiger Termin?")})
    elif venue and track and result_image_match.similarity(track, venue) < 0.72:
        out.append({"code": "other_track", "message": (
            f"Im Bild steht die Strecke „{track[:80]}“, beim Termin „{venue[:80]}“ - richtiges Bild?")})
    return out


async def _read_in_turn(body: bytes, template: dict) -> tuple[result_image_ocr.Reading, float]:
    """Mit freiem Platz (``_gate``) dekodieren und lesen - wartende Anfragen halten nur die Datei."""
    try:
        await asyncio.wait_for(_gate.acquire(), timeout=QUEUE_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(503, BUSY) from None
    started = time.monotonic()
    try:
        opened = await asyncio.to_thread(result_image_ocr.open_image, body)
        del body
        if opened.image is None:
            raise HTTPException(opened.status, opened.message)
        # Höchstens so viele Zeilen wie die Vorschau des Blatts nimmt - dieselbe Grenze (``MAX_ROWS``).
        return await asyncio.to_thread(result_image_ocr.read, opened.image, template, max_rows=MAX_ROWS), started
    except result_image_ocr.OcrUnavailable:
        raise HTTPException(503, UNAVAILABLE) from None
    except result_image_ocr.OutOfTime:
        raise HTTPException(422, TOO_SLOW) from None
    finally:
        _gate.release()


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
    # Je Konto ein Bild zur Zeit - so stellt niemand viele große Dateien in die Warteschlange.
    account = access.user["id"]
    if account in _reading_accounts:
        raise HTTPException(429, BUSY_ACCOUNT)
    _reading_accounts.add(account)
    try:
        reading, started = await _read_in_turn(await _body(request), template)
    finally:
        _reading_accounts.discard(account)
    if reading.too_many_rows:
        raise HTTPException(422, TOO_MANY_ROWS)

    participants = await db.reference_participants.find({"series_id": series_id}, PARTICIPANT_FIELDS).to_list(None)
    aliases = await _aliases(db, access.series, participants) if access.is_board else []
    built = result_image_match.build(reading, template, participants, aliases=aliases)
    logger.info("[result-image] read %s rows (%s uncertain) in %.1fs", len(built["rows"]), built["uncertain_rows"],
                time.monotonic() - started)
    if not built["rows"]:
        raise HTTPException(422, NO_TABLE)
    if not built.pop("is_result"):
        raise HTTPException(422, NOT_A_RESULT)
    suggestion = await _suggested_round(db, series_id, round_doc, (built.get("track") or {}).get("name") or "")
    return {"template": result_image_templates.summary(template), **built, "suggested_round": suggestion,
            "warnings": _warnings(reading, built, round_doc, suggestion)}
