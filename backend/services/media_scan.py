"""Bildprüfung (#415, Moderation II): hochgeladene Bilder automatisch auf Nacktheit und Gewalt prüfen.

Jedes neue Bild (Chat-Anhang, Profil-/Team-/Galerie-Upload) bekommt einen Eintrag `media_scans` und
wird im Hintergrund geprüft: `safe` → nichts; `review` → ein Chat-Bild bleibt verborgen, bis ein
Mensch freigibt; ein öffentlicher Upload (Avatar, Banner, Teamlogo) geht in die Quarantäne, seine Adresse
liefert bis zur Entscheidung einen Platzhalter „Bild wird geprüft“ (nicht cachebar), die Verweise bleiben;
`blocked` → das Bild geht sofort in die Quarantäne, Verweise (Avatar, Banner, Teamlogo) werden
gelöscht, die Person bekommt einen Treffer für die Verwarnungsstufen (#416) und eine Nachricht.
Der Anbieter ist ein Schalter: `local` (NudeNet, ONNX im Backend - kein Bild verlässt den Server),
`google_vision` (SafeSearch, Schlüssel im Geheimnisspeicher) oder `off`. Die Maschine entscheidet
nie endgültig: die Moderation sieht jede Entscheidung mit Vorschau und kann sie umdrehen. Fällt der
Anbieter aus, gilt das Bild nach drei Versuchen als `failed` und bleibt sichtbar - mit rotem Stand
im Admin, statt Chats stumm zu blockieren. Entfernte Originale liegen 90 Tage in der Quarantäne.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
import shutil
import tempfile
from datetime import timedelta
from pathlib import Path

import httpx
from fastapi import HTTPException

from database import get_db
from models import new_id, now_utc
from services.secret_store import decrypt_secret, encrypt_secret, secret_is_configured
from storage import QUARANTINE_DIR, ensure_directory

logger = logging.getLogger("tls.media_scan")

SETTINGS_ID = "media_scan"
PROVIDERS = ("off", "local", "google_vision")
STATES = ("pending", "safe", "review", "blocked", "failed")
STAFF_ROLES = ("moderator", "tournament_admin", "club_admin", "superadmin")
MODERATION_ROLES = ("moderator", "club_admin", "superadmin")
MAX_ATTEMPTS = 3
LOCK_SECONDS = 90
GOOGLE_VISION_URL = "https://vision.googleapis.com/v1/images:annotate"
PREVIEW_URL = "/api/moderation/media-scan/{id}/preview"
# Platzhalter statt Bild (#415): was die Adresse eines Uploads liefert, solange er in der Quarantäne liegt.
PLACEHOLDER_TEXT = {"review": "Bild wird geprüft", "blocked": "Bild entfernt - Moderation"}
_placeholders: dict[str, bytes] = {}
STANDING_URL = "/my/penalties"

# Tests hängen hier einen MockTransport (Google Vision) ein und füllen `fake_results`; ohne Ergebnis
# antwortet der Testanbieter „harmlos“. Im Testbetrieb läuft die Prüfung sofort im Upload (auto_process),
# damit bestehende Chat-Tests ihr Bild gleich sehen; die Bildprüfungs-Tests schalten das ab.
_transport = None
fake_results: list[dict] = []
auto_process = True

# NudeNet 3.x: was als Nacktheit zählt und was nur „anzüglich“ ist (schwächer, nur Hinweis).
NUDITY_LABELS = {"FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_EXPOSED", "BUTTOCKS_EXPOSED"}
RACY_LABELS = {"FEMALE_GENITALIA_COVERED", "FEMALE_BREAST_COVERED", "BUTTOCKS_COVERED", "ANUS_COVERED"}
# Google SafeSearch antwortet mit Wahrscheinlichkeitsstufen; hier ihre Zahl fürs Schwellenmodell.
LIKELIHOOD = {"VERY_UNLIKELY": 0.05, "UNLIKELY": 0.2, "POSSIBLE": 0.5, "LIKELY": 0.75, "VERY_LIKELY": 0.95}
PROVIDER_LABELS = {"off": "aus", "local": "Selbst gehostet (NudeNet)", "google_vision": "Google Cloud Vision (SafeSearch)", "fake": "Testanbieter"}
KIND_LABELS = {"chat": "Chat-Bild", "upload": "Upload"}
# Wo ein öffentlicher Upload verwiesen wird - beim Entfernen werden diese Felder geleert.
REFERENCE_FIELDS = (("users", "avatar_url"), ("users", "banner_url"), ("teams", "logo_url"), ("teams", "banner_url"))

DEFAULTS = {"review_threshold": 0.6, "block_threshold": 0.85, "strike_on_block": True, "retention_days": 90}


def default_provider() -> str:
    """Im Betrieb selbst gehostet (Entscheidung des Betreibers); in Tests der Testanbieter."""
    return "fake" if os.environ.get("APP_ENV") == "test" else "local"


def immediate_scans() -> bool:
    """Im Betrieb startet die Prüfung sofort nach dem Upload; Tests stoßen sie selbst an."""
    return os.environ.get("APP_ENV") != "test"


def is_staff(user: dict | None) -> bool:
    return bool(user and user.get("role") in STAFF_ROLES)


# ---------- Einstellungen ----------

def _threshold(value, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{label}: bitte eine Zahl zwischen 0 und 1 (zum Beispiel 0,6).")
    if not 0.0 <= number <= 1.0:
        raise HTTPException(400, f"{label}: bitte eine Zahl zwischen 0 und 1.")
    return round(number, 3)


def normalize_settings(raw: dict | None, *, allow_fake: bool | None = None) -> dict:
    doc = dict(raw or {})
    allow_fake = (os.environ.get("APP_ENV") == "test") if allow_fake is None else allow_fake
    provider = str(doc.get("provider") or default_provider()).strip().lower()
    if provider not in PROVIDERS and not (allow_fake and provider == "fake"):
        raise HTTPException(400, "Anbieter: aus, local (selbst gehostet) oder google_vision.")
    review = _threshold(doc.get("review_threshold", DEFAULTS["review_threshold"]), "Schwelle „Prüfung nötig“")
    block = _threshold(doc.get("block_threshold", DEFAULTS["block_threshold"]), "Schwelle „Entfernen“")
    if review > block:
        raise HTTPException(400, "Die Schwelle „Prüfung nötig“ muss unter der Schwelle „Entfernen“ liegen.")
    try:
        retention = int(doc.get("retention_days", DEFAULTS["retention_days"]))
    except (TypeError, ValueError):
        raise HTTPException(400, "Aufbewahrung: bitte Tage als ganze Zahl.")
    if not 1 <= retention <= 3650:
        raise HTTPException(400, "Aufbewahrung: zwischen 1 und 3650 Tagen.")
    return {
        "provider": provider,
        "review_threshold": review,
        "block_threshold": block,
        "strike_on_block": bool(doc.get("strike_on_block", DEFAULTS["strike_on_block"])),
        "retention_days": retention,
    }


async def _raw_settings(db) -> dict:
    return await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}


async def load_settings(db) -> dict:
    """Die Einstellungen ohne Geheimnis - der Google-Schlüssel steht nur als „gespeichert“ da."""
    raw = await _raw_settings(db)
    settings = normalize_settings({**DEFAULTS, **raw})
    settings["google_api_key_masked"] = secret_is_configured(raw.get("google_api_key"))
    return settings


async def save_settings(db, updates: dict) -> dict:
    raw = await _raw_settings(db)
    merged = {**DEFAULTS, **raw, **{k: v for k, v in (updates or {}).items() if v is not None}}
    settings = normalize_settings(merged)
    values: dict = {**settings, "id": SETTINGS_ID, "updated_at": now_utc().isoformat()}
    unset: dict = {}
    key = str((updates or {}).get("google_api_key") or "").strip()
    if key:
        values["google_api_key"] = encrypt_secret(key)
    if (updates or {}).get("clear_google_api_key"):
        unset["google_api_key"] = ""
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": values, **({"$unset": unset} if unset else {})}, upsert=True)
    return await load_settings(db)


async def google_api_key(db) -> str:
    raw = await _raw_settings(db)
    try:
        return decrypt_secret(raw.get("google_api_key")) or ""
    except RuntimeError:
        return ""


# ---------- Anbieter ----------

_detector = None
_detector_error: str | None = None


def local_available() -> tuple[bool, str]:
    """Ist NudeNet im Backend da? (Das Modell selbst lädt erst beim ersten Bild.)"""
    if _detector_error:
        return False, _detector_error
    try:
        import importlib.util
        if importlib.util.find_spec("nudenet") is None:
            return False, "Das Paket nudenet fehlt im Backend (requirements.txt, neu bauen)."
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"
    return True, ""


def _load_detector():
    global _detector, _detector_error
    if _detector is None and _detector_error is None:
        try:
            from nudenet import NudeDetector  # noqa: PLC0415 - nur laden, wenn wirklich geprüft wird
            _detector = NudeDetector()
        except Exception as exc:  # noqa: BLE001
            _detector_error = f"{type(exc).__name__}: {exc}"
            logger.error("[media_scan] NudeNet konnte nicht geladen werden: %s", _detector_error)
    return _detector


def _still_frame(path: Path) -> Path | None:
    """GIFs und animierte WebPs (#239) kann OpenCV nicht lesen: das erste Bild als PNG, nur für die Prüfung."""
    from PIL import Image

    try:
        with Image.open(path) as img:
            if path.suffix.lower() != ".gif" and not getattr(img, "is_animated", False):
                return None
            handle, name = tempfile.mkstemp(prefix="media-scan-", suffix=".png")
            os.close(handle)
            img.convert("RGB").save(name, format="PNG")
            return Path(name)
    except Exception as exc:  # noqa: BLE001 - dann prüft der Anbieter die Datei selbst
        logger.warning("[media_scan] Standbild für %s nicht möglich: %s", path.name, exc)
        return None


def _scan_local_sync(path: Path) -> dict:
    still = _still_frame(path)
    try:
        return _detect_local(still or path)
    finally:
        if still is not None:
            still.unlink(missing_ok=True)


def _detect_local(path: Path) -> dict:
    detector = _load_detector()
    if detector is None:
        raise RuntimeError(_detector_error or "NudeNet nicht verfügbar")
    detections = detector.detect(str(path)) or []
    nudity = max((float(d.get("score") or 0) for d in detections if d.get("class") in NUDITY_LABELS), default=0.0)
    racy = max((float(d.get("score") or 0) for d in detections if d.get("class") in RACY_LABELS), default=0.0)
    labels = sorted(
        ({"label": d.get("class"), "score": round(float(d.get("score") or 0), 3)} for d in detections if float(d.get("score") or 0) >= 0.2),
        key=lambda item: -item["score"],
    )[:20]
    return {"scores": {"nudity": round(nudity, 3), "racy": round(racy, 3), "violence": 0.0}, "labels": labels, "covers": ["nudity"]}


async def _scan_google(path: Path, api_key: str) -> dict:
    if not api_key:
        raise RuntimeError("Google Vision: kein API-Schlüssel gespeichert")
    content = base64.b64encode(path.read_bytes()).decode("ascii")
    body = {"requests": [{"image": {"content": content}, "features": [{"type": "SAFE_SEARCH_DETECTION"}]}]}
    async with httpx.AsyncClient(timeout=20, transport=_transport) as cli:
        response = await cli.post(GOOGLE_VISION_URL, params={"key": api_key}, json=body)
    if response.status_code != 200:
        raise RuntimeError(f"Google Vision HTTP {response.status_code}")
    first = ((response.json() or {}).get("responses") or [{}])[0] or {}
    if first.get("error"):
        raise RuntimeError(f"Google Vision: {first['error'].get('message') or 'Fehler'}")
    annotation = first.get("safeSearchAnnotation") or {}
    scores = {
        "nudity": LIKELIHOOD.get(annotation.get("adult"), 0.0),
        "racy": LIKELIHOOD.get(annotation.get("racy"), 0.0),
        "violence": LIKELIHOOD.get(annotation.get("violence"), 0.0),
    }
    labels = [{"label": key, "score": LIKELIHOOD.get(value, 0.0), "likelihood": value} for key, value in annotation.items()]
    return {"scores": scores, "labels": labels, "covers": ["nudity", "violence"]}


async def run_provider(db, settings: dict, path: Path) -> dict:
    provider = settings["provider"]
    if provider == "off":
        return {"scores": {"nudity": 0.0, "racy": 0.0, "violence": 0.0}, "labels": [], "covers": [], "provider": "off"}
    if provider == "fake":
        result = fake_results.pop(0) if fake_results else {"scores": {"nudity": 0.0, "racy": 0.0, "violence": 0.0}}
        if result.get("error"):
            raise RuntimeError(str(result["error"]))
        return {"labels": [], "covers": ["nudity", "violence"], **result, "provider": "fake"}
    if provider == "local":
        result = await asyncio.to_thread(_scan_local_sync, path)
        return {**result, "provider": "local"}
    if provider == "google_vision":
        result = await _scan_google(path, await google_api_key(db))
        return {**result, "provider": "google_vision"}
    raise RuntimeError(f"Unbekannter Anbieter {provider}")


async def provider_health(db, settings: dict | None = None) -> dict:
    settings = settings or await load_settings(db)
    provider = settings["provider"]
    if provider == "off":
        return {"provider": provider, "label": PROVIDER_LABELS["off"], "ok": False, "detail": "Bildprüfung ist ausgeschaltet - kein Bild wird geprüft."}
    if provider == "local":
        ok, detail = local_available()
        return {"provider": provider, "label": PROVIDER_LABELS["local"], "ok": ok, "detail": detail or "NudeNet im Backend; kein Bild verlässt den Server."}
    if provider == "google_vision":
        ok = bool(settings.get("google_api_key_masked"))
        return {"provider": provider, "label": PROVIDER_LABELS["google_vision"], "ok": ok, "detail": "" if ok else "Kein API-Schlüssel gespeichert."}
    return {"provider": provider, "label": PROVIDER_LABELS.get(provider, provider), "ok": True, "detail": ""}


def decide(scores: dict, settings: dict) -> str:
    worst = max(float(scores.get("nudity") or 0.0), float(scores.get("violence") or 0.0))
    if worst >= settings["block_threshold"]:
        return "blocked"
    if worst >= settings["review_threshold"]:
        return "review"
    return "safe"


# ---------- Warteschlange ----------

async def enqueue(db, *, kind: str, ref_id: str, owner_id: str | None, path: Path, url: str | None = None, context: dict | None = None) -> dict:
    settings = await load_settings(db)
    now = now_utc().isoformat()
    doc = {
        "id": new_id(), "kind": kind, "ref_id": ref_id, "owner_id": owner_id, "path": str(path), "url": url,
        "context": context or {}, "state": "pending", "scores": {}, "labels": [], "provider": settings["provider"],
        "attempts": 0, "error": None, "lock_until": None, "created_at": now, "updated_at": now, "scanned_at": None,
        "decided_by": None, "decided_at": None, "note": None, "quarantine_key": None, "original_removed_at": None,
    }
    await db.media_scans.insert_one(dict(doc))
    await _mark_ref(db, doc, "pending")
    if immediate_scans():
        schedule_scan(doc["id"])
    elif auto_process:
        await process_pending(limit=1, only_id=doc["id"])
        return await db.media_scans.find_one({"id": doc["id"]}, {"_id": 0}) or doc
    return doc


def schedule_scan(scan_id: str) -> None:
    """Die Prüfung gleich nach dem Upload anstoßen; der Hintergrundjob fängt alles Übrige auf."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    async def _run() -> None:
        try:
            await process_pending(limit=3, only_id=scan_id)
        except Exception as exc:  # noqa: BLE001 - nie den Upload gefährden
            logger.warning("[media_scan] sofortige Prüfung %s fehlgeschlagen: %s", scan_id, exc)

    loop.create_task(_run())


async def process_pending(limit: int = 10, *, only_id: str | None = None) -> dict:
    db = get_db()
    settings = await load_settings(db)
    processed = 0
    for _ in range(max(1, limit)):
        now = now_utc()
        query: dict = {"state": "pending", "$or": [{"lock_until": None}, {"lock_until": {"$lt": now.isoformat()}}]}
        if only_id:
            query["id"] = only_id
        candidates = await db.media_scans.find(query, {"_id": 0, "id": 1}).sort("created_at", 1).limit(1).to_list(1)
        if not candidates:
            break
        # Sperre setzen, bevor die Prüfung läuft - ein zweiter Läufer nimmt den Eintrag dann nicht mehr.
        claimed = await db.media_scans.update_one(
            {**query, "id": candidates[0]["id"]},
            {"$set": {"lock_until": (now + timedelta(seconds=LOCK_SECONDS)).isoformat()}, "$inc": {"attempts": 1}},
        )
        if not claimed.modified_count:
            continue
        doc = await db.media_scans.find_one({"id": candidates[0]["id"]}, {"_id": 0})
        if not doc:
            continue
        await process_one(db, doc, settings)
        processed += 1
    return {"processed": processed}


async def process_one(db, doc: dict, settings: dict) -> dict:
    path = Path(doc["path"])
    if not path.is_file():
        return await _finish(db, doc, "failed", error="Datei fehlt")
    try:
        result = await run_provider(db, settings, path)
    except Exception as exc:  # noqa: BLE001
        message = f"{exc}"[:200]
        logger.warning("[media_scan] %s (%s, Versuch %s): %s", doc["id"], settings["provider"], doc.get("attempts"), message)
        if int(doc.get("attempts") or 0) >= MAX_ATTEMPTS:
            # Fail-open: sichtbar, aber mit rotem Stand im Admin - sonst blockiert ein toter Anbieter jeden Chat.
            return await _finish(db, doc, "failed", error=message)
        await db.media_scans.update_one({"id": doc["id"]}, {"$set": {"error": message, "lock_until": None, "updated_at": now_utc().isoformat()}})
        return {**doc, "error": message}
    state = decide(result["scores"], settings)
    return await _finish(db, {**doc, "scores": result["scores"], "labels": result.get("labels") or [], "provider": result.get("provider")}, state, settings=settings)


async def _finish(db, doc: dict, state: str, *, error: str | None = None, actor: str = "system", note: str | None = None, settings: dict | None = None) -> dict:
    now = now_utc().isoformat()
    updates = {
        "state": state, "scores": doc.get("scores") or {}, "labels": doc.get("labels") or [], "provider": doc.get("provider"),
        "error": error, "scanned_at": doc.get("scanned_at") or now, "updated_at": now, "lock_until": None,
        "decided_by": actor, "decided_at": now, "note": (note or "").strip() or None,
    }
    # Entfernt: immer in die Quarantäne. Prüfung nötig: ein öffentlicher Upload auch - nginx liefert die Datei
    # sonst direkt von der Platte, und ein unsicheres Avatar wäre bis zur Entscheidung für alle sichtbar (#415).
    hide = state == "blocked" or (state == "review" and doc.get("kind") == "upload")
    if hide and not doc.get("quarantine_key"):
        updates["quarantine_key"] = await asyncio.to_thread(_quarantine, doc)
    await db.media_scans.update_one({"id": doc["id"]}, {"$set": updates})
    finished = {**doc, **updates}
    await _mark_ref(db, finished, "safe" if state == "failed" else state)
    if state == "blocked":
        await _on_blocked(db, finished, settings or await load_settings(db), actor=actor)
    elif state == "review" and actor == "system":
        await _notify_moderators(db, "Bild wartet auf Prüfung", f"Die Bildprüfung ist sich bei einem {KIND_LABELS.get(doc.get('kind'), 'Bild')} nicht sicher. Bitte ansehen und entscheiden.", scan_id=doc["id"])
    return finished


def _variant_cleanup(path: Path) -> None:
    from services.image_variants import VARIANT_WIDTHS, variant_path

    for width in VARIANT_WIDTHS:
        variant_path(path, width).unlink(missing_ok=True)


def _quarantine(doc: dict) -> str | None:
    """Original in die Quarantäne verschieben (nur die Moderation sieht es), Varianten löschen."""
    source = Path(doc["path"])
    if not source.is_file():
        return None
    ensure_directory(QUARANTINE_DIR)
    key = f"{doc['id']}{source.suffix.lower()}"
    shutil.move(str(source), str(QUARANTINE_DIR / key))
    _variant_cleanup(source)
    return key


def _restore(doc: dict) -> bool:
    """Aus der Quarantäne zurück an den alten Platz (Freigabe durch einen Menschen)."""
    key = doc.get("quarantine_key")
    if not key:
        return False
    source = QUARANTINE_DIR / key
    if not source.is_file():
        return False
    target = Path(doc["path"])
    ensure_directory(target.parent)
    shutil.move(str(source), str(target))
    return True


def placeholder_png(state: str) -> bytes:
    """Ein PNG mit dem Satz, warum hier kein Bild ist - einmal gebaut, dann aus dem Speicher (auch die App
    zeigt es, denn sie kann kein SVG)."""
    text = PLACEHOLDER_TEXT.get(state) or PLACEHOLDER_TEXT["review"]
    cached = _placeholders.get(text)
    if cached:
        return cached
    import io
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (640, 400), (18, 18, 18))
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.load_default(size=30)
    except TypeError:   # ältere Pillow: nur die kleine Bitmap-Schrift
        font = ImageFont.load_default()
    draw.rectangle((16, 16, 623, 383), outline=(41, 182, 232), width=3)
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(((640 - (box[2] - box[0])) / 2, (400 - (box[3] - box[1])) / 2), text, fill=(235, 235, 235), font=font)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    _placeholders[text] = buffer.getvalue()
    return _placeholders[text]


async def placeholder_for(db, url: str) -> bytes | None:
    """Liegt das Bild hinter dieser Adresse in der Quarantäne (Prüfung nötig oder entfernt), der passende
    Platzhalter - sonst None, dann gilt 404 wie bisher."""
    doc = await db.media_scans.find_one({"url": url, "kind": "upload", "state": {"$in": ["review", "blocked"]}},
                                        {"_id": 0, "state": 1}, sort=[("created_at", -1)])
    if not doc:
        return None
    return placeholder_png(doc["state"])


def preview_path(doc: dict) -> Path | None:
    if doc.get("quarantine_key"):
        path = QUARANTINE_DIR / doc["quarantine_key"]
        return path if path.is_file() else None
    path = Path(doc.get("path") or "")
    return path if path.is_file() else None


async def _mark_ref(db, doc: dict, state: str) -> None:
    collection = db.chat_attachments if doc.get("kind") == "chat" else db.media_uploads
    await collection.update_one({"id": doc["ref_id"]}, {"$set": {"scan_state": state, "scan_id": doc["id"]}})


async def _clear_references(db, url: str | None) -> int:
    if not url:
        return 0
    cleared = 0
    for collection, field in REFERENCE_FIELDS:
        result = await db[collection].update_many({field: url}, {"$set": {field: None}})
        cleared += int(result.modified_count or 0)
    return cleared


async def _on_blocked(db, doc: dict, settings: dict, *, actor: str) -> None:
    from services import moderation_standing
    from services.user_notifications import create_user_notification

    cleared = await _clear_references(db, doc.get("url")) if doc.get("kind") == "upload" else 0
    if cleared:
        await db.media_scans.update_one({"id": doc["id"]}, {"$set": {"references_cleared": cleared}})
    if settings.get("strike_on_block") and doc.get("owner_id"):
        existing = await db.moderation_strikes.find_one({"source": "image_scan", "ref_id": doc["id"], "revoked_at": None}, {"_id": 0, "id": 1})
        if not existing:
            try:
                await moderation_standing.add_strike(
                    db, doc["owner_id"], source="image_scan", kind=doc.get("kind"), ref_id=doc["id"],
                    moderator_id=None if actor == "system" else actor, note="Bild entfernt (Bildprüfung).",
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("[media_scan] Treffer für %s nicht eingetragen: %s", doc.get("owner_id"), exc)
    if doc.get("owner_id"):
        try:
            await create_user_notification(
                doc["owner_id"], "Ein Bild wurde entfernt",
                "Die automatische Bildprüfung hat ein Bild von dir entfernt (Nacktheit oder Gewalt). Die Moderation sieht es sich an - melde dich, wenn das ein Fehler ist.",
                url=STANDING_URL, kind="moderation", meta={"category": "moderation", "scan_id": doc["id"], "dedupe_key": f"media_scan:{doc['id']}"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[media_scan] Nachricht an %s nicht zugestellt: %s", doc.get("owner_id"), exc)
    if actor == "system":
        await _notify_moderators(db, "Bild automatisch entfernt", f"Die Bildprüfung hat ein {KIND_LABELS.get(doc.get('kind'), 'Bild')} entfernt. Bitte prüfen, ob das richtig war.", scan_id=doc["id"])


async def _notify_moderators(db, title: str, body: str, *, scan_id: str) -> None:
    from services.user_notifications import create_user_notification

    query = {"is_active": {"$ne": False}, "$or": [{"role": {"$in": list(MODERATION_ROLES)}}, {"granted_areas": "moderation"}, {"areas": "moderation"}]}
    moderators = await db.users.find(query, {"_id": 0, "id": 1}).to_list(200)
    for moderator in moderators:
        try:
            await create_user_notification(
                moderator["id"], title, body, url="/admin/moderation?tab=images", kind="moderation",
                meta={"category": "moderation", "scan_id": scan_id, "dedupe_key": f"media_scan:{scan_id}:{title}"},
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[media_scan] Moderation nicht benachrichtigt: %s", exc)


# ---------- Moderation ----------

async def get_scan(db, scan_id: str) -> dict:
    doc = await db.media_scans.find_one({"id": scan_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Prüfung nicht gefunden.")
    return doc


async def approve(db, scan_id: str, *, moderator_id: str, note: str | None = None) -> dict:
    """Ein Mensch gibt frei: Bild zurück, Treffer weg, Stand `safe`."""
    from services import moderation_standing

    doc = await get_scan(db, scan_id)
    restored = await asyncio.to_thread(_restore, doc) if doc.get("quarantine_key") else False
    now = now_utc().isoformat()
    await db.media_scans.update_one({"id": scan_id}, {"$set": {
        "state": "safe", "decided_by": moderator_id, "decided_at": now, "note": (note or "").strip() or None,
        "updated_at": now, "quarantine_key": None if restored else doc.get("quarantine_key"), "restored_at": now if restored else doc.get("restored_at"),
    }})
    await _mark_ref(db, doc, "safe")
    strike = await db.moderation_strikes.find_one({"source": "image_scan", "ref_id": scan_id, "revoked_at": None}, {"_id": 0, "id": 1})
    if strike:
        try:
            await moderation_standing.revoke_strike(db, strike["id"], moderator_id=moderator_id, note="Bildprüfung: von der Moderation freigegeben.")
        except Exception as exc:  # noqa: BLE001
            logger.warning("[media_scan] Treffer %s nicht zurückgenommen: %s", strike["id"], exc)
    return await get_scan(db, scan_id)


async def remove(db, scan_id: str, *, moderator_id: str, note: str | None = None) -> dict:
    """Ein Mensch entfernt: Quarantäne, Verweise weg, Treffer, Nachricht."""
    doc = await get_scan(db, scan_id)
    if doc.get("state") == "blocked":
        return doc
    await _finish(db, doc, "blocked", actor=moderator_id, note=note)
    return await get_scan(db, scan_id)


def _context_label(doc: dict, chat_context: dict | None = None) -> str:
    context = doc.get("context") or {}
    if doc.get("kind") == "chat":
        # Der Chat ist erst bekannt, wenn die Nachricht gesendet ist - daher aus dem Anhang lesen.
        kind = (chat_context or {}).get("type") or context.get("type") or "chat"
        return {"direct": "Direktnachricht", "team": "Team-Chat", "tournament": "Turnier-Chat", "match": "Match-Chat"}.get(kind, "Chat")
    scope = context.get("media_scope") or "user"
    return {"user": "Profil/Team", "club": "Verein", "admin": "Admin"}.get(scope, f"Upload ({scope})")


async def queue(db, *, state: str = "review", limit: int = 100) -> list[dict]:
    query: dict = {}
    if state and state != "all":
        query["state"] = state
    docs = await db.media_scans.find(query, {"_id": 0}).sort([("created_at", -1)]).to_list(max(1, min(int(limit), 500)))
    owner_ids = list({d.get("owner_id") for d in docs if d.get("owner_id")})
    owners = {u["id"]: u for u in await db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}).to_list(len(owner_ids) or 1)} if owner_ids else {}
    chat_refs = [d["ref_id"] for d in docs if d.get("kind") == "chat"]
    contexts = {a["id"]: (a.get("context") or {}) for a in await db.chat_attachments.find({"id": {"$in": chat_refs}}, {"_id": 0, "id": 1, "context": 1}).to_list(len(chat_refs))} if chat_refs else {}
    rows = []
    for doc in docs:
        rows.append({
            **{k: v for k, v in doc.items() if k not in ("path", "lock_until")},
            "owner": owners.get(doc.get("owner_id")),
            "context_label": _context_label(doc, contexts.get(doc.get("ref_id"))),
            "kind_label": KIND_LABELS.get(doc.get("kind"), doc.get("kind")),
            "provider_label": PROVIDER_LABELS.get(doc.get("provider"), doc.get("provider")),
            "preview_url": PREVIEW_URL.format(id=doc["id"]) if (doc.get("quarantine_key") or doc.get("state") != "blocked") else None,
        })
    return rows


async def status(db) -> dict:
    settings = await load_settings(db)
    since = (now_utc() - timedelta(days=30)).isoformat()
    counts = {s: 0 for s in STATES}
    for state in STATES:
        counts[state] = await db.media_scans.count_documents({"state": state, "created_at": {"$gte": since}})
    pending_total = await db.media_scans.count_documents({"state": "pending"})
    latest = await db.media_scans.find({"scanned_at": {"$ne": None}}, {"_id": 0, "scanned_at": 1, "provider": 1}).sort("scanned_at", -1).limit(1).to_list(1)
    last = latest[0] if latest else None
    return {
        "settings": settings,
        "health": await provider_health(db, settings),
        "counts_30d": counts,
        "pending": pending_total,
        "review_open": await db.media_scans.count_documents({"state": "review"}),
        "last_scanned_at": (last or {}).get("scanned_at"),
        "last_provider": (last or {}).get("provider"),
    }


async def purge_quarantine(db, *, now=None) -> int:
    """Entfernte Originale nach der Aufbewahrungsfrist endgültig löschen; der Eintrag bleibt als Verlauf."""
    settings = await load_settings(db)
    cutoff = ((now or now_utc()) - timedelta(days=settings["retention_days"])).isoformat()
    # Nur Entferntes verfällt - ein Prüffall wartet auf einen Menschen, sein Original bleibt.
    rows = await db.media_scans.find({"state": "blocked", "quarantine_key": {"$ne": None}, "decided_at": {"$lt": cutoff}}, {"_id": 0, "id": 1, "quarantine_key": 1}).to_list(500)
    removed = 0
    for row in rows:
        path = QUARANTINE_DIR / row["quarantine_key"]
        path.unlink(missing_ok=True)
        await db.media_scans.update_one({"id": row["id"]}, {"$set": {"quarantine_key": None, "original_removed_at": now_utc().isoformat()}})
        removed += 1
    return removed
