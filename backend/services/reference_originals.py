"""Original-Bilder des Veranstalters je Termin (#1933): Screenshots oder Fotos, die ein Ergebnis belegen.

Je Termin (bei einer Runde mit Läufen je Lauf, #1930) mehrere Bilder, je Bild eine Art (``KINDS``: Qualifying, Sprint,
Rennen, Scoreboard mit Map-Nummer, Tabelle, Sonstiges), optional ein Quellen-Link (nur ``https``) und „öffentlich“ oder
„nur Verwaltung“ (Vorgabe öffentlich).

- **Ablage:** dieselbe Prüfung wie beim Lesen eines Ergebnis-Bilds (``result_image_ocr.open_image``: Format am Inhalt,
  nicht an Endung oder angegebenem Typ - nur PNG, JPG, WebP -, Pixel am Kopf der Datei, Größe ``MAX_BYTES``), dann neu
  kodiert als WebP ohne EXIF und Ort (``result_image_ocr.encode_original``). Die Datei liegt privat unter
  ``REFERENCE_ORIGINAL_DIR`` mit Vorschaubildern (``image_variants``) und geht nur über die Routen hinaus - nie über
  eine öffentliche Upload-Adresse.
- **Freigabe:** Bilder des Vorstands und von Captains mit Recht zum Veröffentlichen sind gleich freigegeben; die anderer
  Captains sind Entwürfe (``DRAFT``). Sie werden mit dem Ergebnis freigegeben (Veröffentlichen oder Freigeben des
  Blatts, ``release_round``) oder vom Vorstand einzeln.
- **Öffentlich** (``public_map``, ``is_public``) ist ein Bild nur, wenn es öffentlich und freigegeben ist, sein Termin
  nicht archiviert und sein Ergebnis veröffentlicht ist - und kein Name in diesem Ergebnis ausgeblendet ist (das Bild
  zeigte ihn sonst doch). Die Sichtbarkeit der Saison prüft die Route (``visible_series``).
- **Bleibt:** Die Bilder hängen an der Kennung des Termins - sie wandern beim Verschieben mit und bleiben beim
  Archivieren liegen (öffentlich dann unsichtbar). Löschen darf nur der Vorstand, mit Protokoll.
- **Zählen ohne Vollscan:** ``media_summary`` summiert die gespeicherten Größen in der Datenbank (Mediathek).
"""
from __future__ import annotations

import asyncio
import logging
import os
import pathlib
import uuid
from urllib.parse import urlsplit

from fastapi import HTTPException, Request

from models import new_id, now_utc
from services import result_image_ocr
from services.image_upload import MAX_BYTES as IMAGE_MAX_BYTES, MAX_IMAGE_UPLOAD_MB
from services.image_variants import VARIANT_WIDTHS, build_all_variants, resolve_variant, variant_path
from storage import REFERENCE_ORIGINAL_DIR, ensure_directory

logger = logging.getLogger("tls-arena.reference-originals")

KINDS = ("qualifying", "sprint", "race", "scoreboard", "table", "other")
ORIGINS = ("upload", "reading")
DRAFT = "draft"
RELEASED = "released"
MAX_MAP = 15
MAX_URL = 500
FORMATS = ["image/png", "image/jpeg", "image/webp"]


def _env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


# Einstellbar über die Umgebung (Standard in Klammern): Bilder je Termin (24), Hochladen je Konto (60 in 10 Minuten),
# gleichzeitig neu kodierte Bilder (2). Größe und Pixel wie bei jedem Bild-Upload (``MAX_IMAGE_UPLOAD_MB``).
MAX_PER_ROUND = _env_int("REFERENCE_ORIGINAL_MAX_PER_ROUND", 24)
RATE_LIMIT = _env_int("REFERENCE_ORIGINAL_RATE_LIMIT", 60)
RATE_WINDOW_SECONDS = _env_int("REFERENCE_ORIGINAL_RATE_WINDOW_SECONDS", 600)
CONCURRENCY = _env_int("REFERENCE_ORIGINAL_CONCURRENCY", 2)
MAX_BYTES = IMAGE_MAX_BYTES
ORIGINAL_DIR = REFERENCE_ORIGINAL_DIR
_gate = asyncio.Semaphore(CONCURRENCY)

TOO_MANY = "Höchstens {n} Original-Bilder je Termin. Bitte erst ein altes Bild löschen lassen."
ROUND_ARCHIVED = "Der Termin ist archiviert - neue Original-Bilder gehen nur an Termine im Kalender."
UNWRITABLE = "Upload-Speicher ist nicht beschreibbar."
BAD_KIND = "Unbekannte Art. Möglich: Qualifying, Sprint, Rennen, Scoreboard, Tabelle, Sonstiges."
MAP_ONLY_SCOREBOARD = f"Eine Map-Nummer (1 bis {MAX_MAP}) gibt es nur beim Scoreboard."
BAD_URL = "Quellen-Link nur als vollständige https-Adresse, etwa https://veranstalter.example/ergebnis."
BAD_ORIGIN = "Unbekannte Herkunft."

PROJECTION = {"_id": 0}
ADMIN_FIELDS = ("id", "round_id", "kind", "map", "source_url", "public", "state", "origin", "width", "height", "size",
                "created_at", "released_at")
BOARD_FIELDS = ("created_by", "released_by", "updated_by")
PUBLIC_FIELDS = ("id", "kind", "map", "source_url", "width", "height")


# ---------------------------------------------------------------- Prüfen
def clean_source_url(value) -> str | None:
    """Quellen-Link: leer heißt keiner, sonst nur ``https://host/…`` ohne Leerraum und Steuerzeichen - wie
    ``safeHttpUrl`` in der Oberfläche, aber nur https. Ohne Regex, damit eine lange Eingabe nichts kostet."""
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > MAX_URL or any(char.isspace() or ord(char) < 32 or char == "\\" for char in text):
        raise ValueError(BAD_URL)
    try:
        parts = urlsplit(text)
    except ValueError:
        raise ValueError(BAD_URL) from None
    if parts.scheme.lower() != "https" or not parts.hostname or "." not in parts.hostname:
        raise ValueError(BAD_URL)
    return text


def check_kind(kind: str | None, map_number: int | None) -> tuple[str, int | None]:
    """Art und Map-Nummer: die Nummer nur beim Scoreboard."""
    if kind not in KINDS:
        raise HTTPException(422, BAD_KIND)
    if map_number is not None and (kind != "scoreboard" or not 1 <= int(map_number) <= MAX_MAP):
        raise HTTPException(422, MAP_ONLY_SCOREBOARD)
    return kind, (int(map_number) if map_number is not None else None)


def path_of(key: str | None) -> pathlib.Path | None:
    if not key or "/" in key or "\\" in key or ".." in key or key.startswith("."):
        return None
    return ORIGINAL_DIR / key


async def read_body(request: Request) -> bytes:
    """Der Body als Bytes, höchstens ``MAX_BYTES`` - die angegebene Länge wird vor dem Lesen geprüft. Keine
    Zwischendatei (wie beim Lesen eines Ergebnis-Bilds)."""
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


def _encode(body: bytes) -> tuple[bytes, int, int]:
    opened = result_image_ocr.open_image(body)
    if opened.image is None:
        raise HTTPException(opened.status, opened.message)
    width, height = opened.image.size
    data, _ = result_image_ocr.encode_original(opened)
    return data, width, height


# ---------------------------------------------------------------- Ablegen
async def store(db, *, series_id: str, round_doc: dict, user: dict, kind: str, map_number: int | None, origin: str,
                state: str, body: bytes) -> dict:
    """Prüfen, als WebP ohne Metadaten ablegen, Vorschaubilder bauen, Eintrag schreiben. Höchstens ``MAX_PER_ROUND``
    Bilder je Termin - gezählt nach dem Schreiben, damit zwei gleichzeitige Uploads die Grenze nicht gemeinsam
    überspringen."""
    if origin not in ORIGINS:
        raise HTTPException(422, BAD_ORIGIN)
    if round_doc.get("archived_at"):
        raise HTTPException(409, ROUND_ARCHIVED)
    if await db.reference_round_originals.count_documents({"round_id": round_doc["id"]}) >= MAX_PER_ROUND:
        raise HTTPException(409, TOO_MANY.format(n=MAX_PER_ROUND))
    async with _gate:
        data, width, height = await asyncio.to_thread(_encode, body)
    del body
    key = f"{uuid.uuid4().hex}.webp"
    path = ORIGINAL_DIR / key
    try:
        ensure_directory(ORIGINAL_DIR)
        path.write_bytes(data)
    except OSError as exc:
        logger.error("[originals] could not write %s: %s", key, type(exc).__name__)
        raise HTTPException(500, UNWRITABLE) from None
    try:
        # Das Vorschaubild gleich mit - die Liste im Blatt zeigt es sofort.
        await asyncio.to_thread(build_all_variants, path)
    except Exception as exc:  # noqa: BLE001 - ohne Vorschaubild kommt beim Abruf das Original
        logger.warning("[originals] variants for %s failed: %s", key, type(exc).__name__)
    now = now_utc().isoformat()
    released = state == RELEASED
    doc = {
        "id": new_id(), "series_id": series_id, "round_id": round_doc["id"], "kind": kind, "map": map_number,
        "source_url": None, "public": True, "state": state, "origin": origin, "storage_key": key,
        "mime": "image/webp", "size": len(data), "width": width, "height": height,
        "created_at": now, "created_by": user["id"], "updated_at": now, "updated_by": user["id"],
        "released_at": now if released else None, "released_by": user["id"] if released else None,
    }
    await db.reference_round_originals.insert_one(dict(doc))
    if await db.reference_round_originals.count_documents({"round_id": round_doc["id"]}) > MAX_PER_ROUND:
        await delete(db, doc)
        raise HTTPException(409, TOO_MANY.format(n=MAX_PER_ROUND))
    return doc


def remove_files(doc: dict) -> None:
    path = path_of(doc.get("storage_key"))
    if path is None:
        return
    path.unlink(missing_ok=True)
    for width in VARIANT_WIDTHS:
        variant_path(path, width).unlink(missing_ok=True)


async def delete(db, doc: dict) -> None:
    remove_files(doc)
    await db.reference_round_originals.delete_one({"id": doc["id"]})


def file_for(doc: dict, width) -> tuple[pathlib.Path, str] | None:
    """Datei (oder Vorschaubild bei ``width``) und Medientyp - ``None``, wenn sie fehlt."""
    path = path_of(doc.get("storage_key"))
    if path is None or not path.is_file():
        return None
    if width is not None:
        variant = resolve_variant(path, width)
        if variant is not None:
            return variant, "image/webp"
    return path, doc.get("mime") or "image/webp"


async def release_round(db, series_id: str, round_id: str, actor_id: str) -> int:
    """Entwürfe eines Termins freigeben - mit dem Ergebnis (Veröffentlichen oder Freigeben des Blatts)."""
    now = now_utc().isoformat()
    result = await db.reference_round_originals.update_many(
        {"series_id": series_id, "round_id": round_id, "state": DRAFT},
        {"$set": {"state": RELEASED, "released_at": now, "released_by": actor_id, "updated_at": now,
                  "updated_by": actor_id}})
    return int(result.modified_count or 0)


# ---------------------------------------------------------------- Sichtbarkeit
def order_key(doc: dict) -> tuple:
    return (KINDS.index(doc["kind"]) if doc.get("kind") in KINDS else len(KINDS), doc.get("map") or 0,
            doc.get("created_at") or "", doc.get("id") or "")


def _people_in(sheet: dict) -> set[str]:
    """Wer in einem Ergebnis steht: Zeilen samt Partner im Double Up, Aufstellung je Spiel und je Map."""
    found: set[str] = set()
    for row in sheet.get("rows") or []:
        found.update(pid for pid in (row.get("participant_id"), row.get("partner_id")) if pid)
    for match in sheet.get("matches") or []:
        lineups = [match.get("lineup") or [], *[(item.get("lineup") or []) for item in match.get("maps") or []]]
        for lineup in lineups:
            for entry in lineup:
                pid = entry.get("participant_id") if isinstance(entry, dict) else entry
                if pid:
                    found.add(str(pid))
    return found


async def round_reasons(db, series_id: str, round_ids: list[str]) -> dict[str, str | None]:
    """Je Termin, warum seine Bilder öffentlich nicht erscheinen: ``not_published`` (kein veröffentlichtes Ergebnis)
    oder ``hidden_name`` (ein ausgeblendeter Name steht im Ergebnis) - ``None``, wenn nichts dagegen spricht."""
    if not round_ids:
        return {}
    sheets = {sheet["round_id"]: sheet async for sheet in db.reference_round_results.find(
        {"series_id": series_id, "round_id": {"$in": sorted(set(round_ids))}, "status": "published"},
        {"_id": 0, "round_id": 1, "rows.participant_id": 1, "rows.partner_id": 1, "matches.lineup": 1,
         "matches.maps.lineup": 1})}
    hidden = {row["id"] async for row in db.reference_participants.find(
        {"series_id": series_id, "name_hidden": True}, {"_id": 0, "id": 1})}
    out: dict[str, str | None] = {}
    for round_id in round_ids:
        sheet = sheets.get(round_id)
        if sheet is None:
            out[round_id] = "not_published"
        elif hidden and _people_in(sheet) & hidden:
            out[round_id] = "hidden_name"
        else:
            out[round_id] = None
    return out


def own_reason(doc: dict, round_doc: dict | None) -> str | None:
    """Was am Bild selbst gegen „öffentlich“ spricht: nur Verwaltung, Entwurf, Termin archiviert oder weg."""
    if not doc.get("public", True):
        return "admin_only"
    if doc.get("state") != RELEASED:
        return "draft"
    if not round_doc or round_doc.get("archived_at"):
        return "archived"
    return None


async def is_public(db, doc: dict) -> bool:
    round_doc = await db.reference_rounds.find_one({"id": doc.get("round_id"), "series_id": doc.get("series_id")},
                                                   {"_id": 0, "id": 1, "archived_at": 1})
    if own_reason(doc, round_doc):
        return False
    return (await round_reasons(db, doc["series_id"], [doc["round_id"]])).get(doc["round_id"]) is None


def public_url(lineage_slug: str, season_slug: str, image_id: str) -> str:
    return f"/api/reference-series/public/{lineage_slug}/{season_slug}/originals/{image_id}"


def public_view(doc: dict, lineage_slug: str, season_slug: str) -> dict:
    return {**{key: doc.get(key) for key in PUBLIC_FIELDS}, "url": public_url(lineage_slug, season_slug, doc["id"])}


async def public_map(db, series: dict, rounds: list[dict], lineage_slug: str) -> dict[str, list[dict]]:
    """Termin → öffentliche Bilder, für die Termine des Kalenders (``rounds``, ohne archivierte) - zwei bis drei
    Abfragen für die ganze Saison."""
    by_id = {item["id"]: item for item in rounds if not item.get("archived_at")}
    if not by_id:
        return {}
    docs = await db.reference_round_originals.find(
        {"series_id": series["id"], "round_id": {"$in": sorted(by_id)}, "public": True, "state": RELEASED},
        PROJECTION).to_list(None)
    if not docs:
        return {}
    reasons = await round_reasons(db, series["id"], sorted({doc["round_id"] for doc in docs}))
    out: dict[str, list[dict]] = {}
    for doc in sorted(docs, key=order_key):
        if reasons.get(doc["round_id"]) is None:
            out.setdefault(doc["round_id"], []).append(public_view(doc, lineage_slug, series.get("season_slug") or ""))
    return out


# ---------------------------------------------------------------- Verwaltung
def admin_url(series_id: str, round_id: str, image_id: str) -> str:
    return f"/api/reference-series/admin/series/{series_id}/rounds/{round_id}/originals/{image_id}/file"


def admin_view(doc: dict, *, board: bool, user_id: str, reason: str | None) -> dict:
    """Ein Bild für das Ergebnisblatt. Captains bekommen keine ``*_by``-Kennungen (wie beim Blatt) - nur ``mine``."""
    view = {key: doc.get(key) for key in ADMIN_FIELDS}
    if board:
        view.update({key: doc.get(key) for key in BOARD_FIELDS})
    view.update({"url": admin_url(doc["series_id"], doc["round_id"], doc["id"]),
                 "mine": doc.get("created_by") == user_id, "shown": reason is None, "hidden_reason": reason})
    return view


async def admin_list(db, series_id: str, round_doc: dict, *, board: bool, user_id: str) -> list[dict]:
    docs = await db.reference_round_originals.find({"series_id": series_id, "round_id": round_doc["id"]},
                                                   PROJECTION).to_list(None)
    reasons = await round_reasons(db, series_id, [round_doc["id"]]) if docs else {}
    out = []
    for doc in sorted(docs, key=order_key):
        reason = own_reason(doc, round_doc) or reasons.get(round_doc["id"])
        out.append(admin_view(doc, board=board, user_id=user_id, reason=reason))
    return out


async def admin_item(db, series_id: str, round_doc: dict, doc: dict, *, board: bool, user_id: str) -> dict:
    reason = own_reason(doc, round_doc) or (await round_reasons(db, series_id, [round_doc["id"]])).get(round_doc["id"])
    return admin_view(doc, board=board, user_id=user_id, reason=reason)


async def media_summary(db) -> dict:
    """Wie viele Originale es gibt und was sie wiegen - aus der Datenbank, ohne die Platte zu durchsuchen."""
    count = total = 0
    async for row in db.reference_round_originals.aggregate([
            {"$group": {"_id": None, "count": {"$sum": 1}, "bytes": {"$sum": "$size"}}}]):
        count, total = int(row.get("count") or 0), int(row.get("bytes") or 0)
    return {"count": count, "bytes": total}


def limits() -> dict:
    """Für die Oberfläche: Größe, Bilder je Termin, Formate und Arten."""
    return {"max_mb": MAX_IMAGE_UPLOAD_MB, "max_per_round": MAX_PER_ROUND, "formats": FORMATS, "kinds": list(KINDS),
            "max_map": MAX_MAP}
