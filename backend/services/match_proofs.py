"""Foto vom Ergebnis (#1157, #1158): ein Beweisfoto zur Ergebnis-Meldung oder zu „Problem melden“.

Ein Beweisfoto ist persönlich (Gesichter, Bildschirme, Wohnzimmer). Deshalb:

- Sehen dürfen es nur die Spieler dieses Spiels (bei Teams jedes Mitglied) und die Turnierleitung dieses Turniers -
  global oder mit Ergebnis-Recht für genau dieses Spiel. Nie öffentlich, nicht in Galerie oder Suche.
- Ausgeliefert wird es nur über ``GET /api/matches/{id}/proof-photos/{foto}`` nach dieser Prüfung, nie über eine
  öffentliche Upload-Adresse. Wer nicht darf, bekommt 404 (wie bei Chat-Anhängen - sonst ließe sich prüfen, ob es
  ein Foto gibt).
- Beim Hochladen wird das Bild geprüft und neu gespeichert (derselbe Weg wie jeder Bild-Upload,
  ``services.image_upload._encode_image_bytes``): nur PNG, JPG oder WebP, Größe und Pixel begrenzt, Drehung übernommen,
  EXIF mit GPS-Ort und Kamera fällt dabei weg.
- Bildprüfung wie im Chat (#415): bis das Ergebnis da ist, sieht das Foto nur, wer es hochgeladen hat.
- Gelöscht wird es mit dem Turnier, mit dem Konto (Kontolöschung) und sonst 30 Tage nach dem Hochladen - außer das
  Spiel ist dann noch in Klärung. Nie verwendete Fotos verschwinden nach 24 Stunden.

Ablauf wie bei Chat-Anhängen: hochladen (``pending``, sichtbar nur für den Absender) → mit der Meldung oder dem
Problem abschicken (``attached``, Bezug gespeichert) → die anderen sehen es.
"""
from __future__ import annotations

import logging
import pathlib
import uuid
from datetime import timedelta

from fastapi import HTTPException, UploadFile

from models import new_id, now_utc
from storage import PROOF_DIR, ensure_directory

logger = logging.getLogger("tls.match_proofs")

PENDING_TTL = timedelta(hours=24)
RETENTION_DAYS = 30
VISIBLE_SCAN_STATES = {"safe", "failed"}


def proof_path(key: str | None) -> pathlib.Path | None:
    if not key or "/" in key or "\\" in key or ".." in key or key.startswith("."):
        return None
    return PROOF_DIR / key


def proof_url(match_id: str, photo_id: str) -> str:
    return f"/api/matches/{match_id}/proof-photos/{photo_id}"


def public_proof(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "url": proof_url(doc.get("match_id") or "", doc["id"]),
        "width": doc.get("width"),
        "height": doc.get("height"),
        # Bildprüfung (#415): „pending“ und „review“ sieht nur, wer es hochgeladen hat.
        "scan_state": doc.get("scan_state") or "safe",
    }


async def store_proof(db, match: dict, owner: dict, registration_id: str | None, file: UploadFile) -> dict:
    """Ein Foto prüfen, neu speichern (ohne EXIF) und als „pending“ ablegen."""
    from services.image_upload import MAX_BYTES, MAX_IMAGE_UPLOAD_MB, _encode_image_bytes, _read_upload_limited

    data = await _read_upload_limited(file, MAX_BYTES, MAX_IMAGE_UPLOAD_MB)
    suffix = pathlib.Path(file.filename or "").suffix.lower()
    encoded = _encode_image_bytes(data, file.content_type or "", suffix, file.filename or "foto")
    key = f"{uuid.uuid4().hex}{encoded['ext']}"
    path = PROOF_DIR / key
    try:
        ensure_directory(PROOF_DIR)
        path.write_bytes(encoded["data"])
    except OSError as exc:
        logger.error("[proofs] could not write %s: %s", key, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar.")
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "match_id": match["id"],
        "tournament_id": match.get("tournament_id"),
        "owner_id": owner["id"],
        "registration_id": registration_id,
        "storage_key": key,
        "mime": encoded["content_type"],
        "size": len(encoded["data"]),
        "width": encoded["width"],
        "height": encoded["height"],
        "status": "pending",
        "context": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.match_proof_photos.insert_one(dict(doc))
    from services import media_scan

    try:
        scan = await media_scan.enqueue(db, kind="proof", ref_id=doc["id"], owner_id=owner["id"], path=path,
                                        context={"type": "proof", "match_id": match["id"]})
        doc["scan_state"] = "safe" if scan.get("state") == "failed" else (scan.get("state") or "pending")
    except Exception as exc:  # noqa: BLE001 - der Upload gilt; der Sammler holt die Prüfung nach
        logger.warning("[proofs] Bildprüfung für %s nicht angestoßen: %s", doc["id"], type(exc).__name__)
        doc["scan_state"] = "pending"
    return public_proof(doc)


async def claim_proof(db, photo_id: str | None, *, owner_id: str, match_id: str, kind: str) -> dict | None:
    """Das eigene, noch nicht verwendete Foto dieses Spiels der Meldung oder dem Problem zuordnen."""
    if not photo_id:
        return None
    query = {"id": photo_id, "owner_id": owner_id, "match_id": match_id, "status": "pending"}
    doc = await db.match_proof_photos.find_one(query, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=400, detail="Das Foto gibt es nicht mehr oder es ist schon verwendet - bitte neu wählen.")
    updated = await db.match_proof_photos.update_one(query, {"$set": {
        "status": "attached", "context": {"kind": kind}, "updated_at": now_utc().isoformat()}})
    if not updated.modified_count:
        raise HTTPException(status_code=409, detail="Das Foto wurde gleichzeitig verwendet.")
    return public_proof({**doc, "status": "attached"})


async def visible_proofs(db, photo_ids: list[str]) -> dict[str, dict]:
    """Die Fotos, die es noch gibt und die durch die Bildprüfung sind - für Karten der Gegenseite und der Leitung."""
    ids = [photo_id for photo_id in dict.fromkeys(photo_ids) if photo_id]
    if not ids:
        return {}
    rows = await db.match_proof_photos.find({"id": {"$in": ids}, "status": "attached"}, {"_id": 0}).to_list(len(ids))
    return {row["id"]: public_proof(row) for row in rows if (row.get("scan_state") or "safe") in VISIBLE_SCAN_STATES}


async def can_see(db, doc: dict, user: dict | None) -> bool:
    """Nur Spieler dieses Spiels und die Turnierleitung dieses Turniers - und bis zur Bildprüfung nur der Absender."""
    if not user or (doc.get("scan_state") or "safe") == "blocked":
        return False
    if user.get("id") == doc.get("owner_id"):
        return True
    if (doc.get("scan_state") or "safe") not in VISIBLE_SCAN_STATES or doc.get("status") != "attached":
        return False
    match = await db.matches_v2.find_one({"id": doc.get("match_id")}, {"_id": 0})
    if not match:
        return False
    from services.match_audience import player_user_ids, registrations_for_match
    from services.tournament_permissions import has_match_result_permission, is_global_tournament_staff

    if user.get("id") in await player_user_ids(db, await registrations_for_match(db, match)):
        return True
    return is_global_tournament_staff(user) or await has_match_result_permission(user, match)


def _remove_files(doc: dict) -> None:
    from services.image_variants import VARIANT_WIDTHS, variant_path

    path = proof_path(doc.get("storage_key"))
    if path is None:
        return
    path.unlink(missing_ok=True)
    for width in VARIANT_WIDTHS:
        variant_path(path, width).unlink(missing_ok=True)


async def _delete(db, rows: list[dict]) -> int:
    for row in rows:
        _remove_files(row)
    if rows:
        await db.match_proof_photos.delete_many({"id": {"$in": [row["id"] for row in rows]}})
    return len(rows)


async def delete_for_tournament(db, tournament_id: str) -> int:
    """Turnier gelöscht: seine Beweisfotos gleich mit."""
    return await _delete(db, await db.match_proof_photos.find({"tournament_id": tournament_id}, {"_id": 0}).to_list(None))


async def delete_for_user(db, user_id: str) -> int:
    """Kontolöschung: die eigenen Fotos und ihre Dateien weg."""
    return await _delete(db, await db.match_proof_photos.find({"owner_id": user_id}, {"_id": 0}).to_list(None))


async def purge(db, *, now=None) -> int:
    """Aufräumen: nie verwendete Fotos nach 24 Stunden, alle anderen 30 Tage nach dem Hochladen - außer das Spiel ist
    noch in Klärung -, und Fotos, deren Spiel es nicht mehr gibt."""
    current = now or now_utc()
    stale = await db.match_proof_photos.find(
        {"status": "pending", "created_at": {"$lt": (current - PENDING_TTL).isoformat()}}, {"_id": 0}).to_list(500)
    old = await db.match_proof_photos.find(
        {"status": "attached", "created_at": {"$lt": (current - timedelta(days=RETENTION_DAYS)).isoformat()}}, {"_id": 0}).to_list(500)
    match_ids = list({row.get("match_id") for row in old if row.get("match_id")})
    matches = {
        row["id"]: row for row in await db.matches_v2.find({"id": {"$in": match_ids}}, {"_id": 0, "id": 1, "status": 1}).to_list(len(match_ids) + 1)
    } if match_ids else {}
    expired = [row for row in old if (matches.get(row.get("match_id")) or {}).get("status") != "disputed"]
    attached_ids = await db.match_proof_photos.distinct("match_id", {"status": "attached"})
    known = set(await db.matches_v2.distinct("id", {"id": {"$in": attached_ids}})) if attached_ids else set()
    orphans = await db.match_proof_photos.find(
        {"status": "attached", "match_id": {"$nin": sorted(known)}}, {"_id": 0}).to_list(500) if attached_ids else []
    seen: set[str] = set()
    rows = []
    for row in [*stale, *expired, *orphans]:
        if row["id"] not in seen:
            seen.add(row["id"])
            rows.append(row)
    return await _delete(db, rows)
