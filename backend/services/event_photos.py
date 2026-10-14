"""Fotos vom Event (#1185, #1186): Hinweis an die Teilnehmer und Fotos von Mitgliedern mit Freigabe.

**Die Fotos sind da (#1185).** Ein veröffentlichtes Album, das an einem Event hängt, meldet sich genau einmal bei allen,
die beim Event angemeldet waren: Event-Anmeldungen (angemeldet oder eingecheckt) und die Anmeldungen der Turniere des
Events - bei Teams jedes Mitglied samt Leitung (``match_audience.player_user_ids``). Wer das Album nicht sehen darf,
bekommt nichts (Mitglieder-Alben nur an Mitglieder). Thema „Turnier-Updates“ wie „Wie war …?“ (#1196, Entscheidung des
Betreibers - „News & Events“ ist ohne Newsletter-Zustimmung aus), bei Mitglieder- und internen Alben „Vereinsintern“.
Ein Job sieht jede Minute nach (``notify_due``) und wartet, bis zehn Minuten lang kein Foto mehr dazugekommen ist -
sonst stünde in der Meldung die Zahl vom ersten Bild. Liegt das letzte Foto beim ersten Blick schon länger als einen Tag
zurück (alte Alben beim Einspielen des Updates), wird das Album still als gemeldet markiert.

Genau einmal: Ein Lauf beansprucht das Album, bevor er sendet (``participants_notified_at`` wird atomar gesetzt - ein
zweiter, überlappender Lauf findet es nicht mehr). Je Album und Person steht vor dem Senden eine Quittung in
``gallery_album_notices`` mit eindeutigem Index; bricht ein Lauf mittendrin ab, nimmt ein späterer Lauf das Album nach
``CLAIM_STALE_MINUTES`` wieder auf und überspringt alle, die schon eine Quittung haben.

**Fotos einsenden (#1186).** Mitglieder schicken vom ersten Event-Tag bis sieben Tage nach dem letzten bis zu 20 Bilder
ins Album des Events - nur mit dem Haken „Die Personen auf den Fotos sind einverstanden“. Jedes Bild geht durch
denselben Weg wie jeder Bild-Upload (``services.image_upload._encode_image_bytes``: nur PNG, JPG oder WebP, Größe und
Pixel begrenzt, neu gespeichert - EXIF mit GPS-Ort und Kamera fällt weg) und durch die Bildprüfung. Die Höchstzahl hält
ein Zähler je Person und Album (``gallery_submission_quota``), der vor dem Hochladen atomar hochzählt und bei einem Fehler
oder einer Ablehnung wieder zurückzählt - parallele Uploads kommen so nicht darüber. Es liegt privat in
``SUBMISSION_DIR`` und ist nur für die einsendende Person und die Freigabe sichtbar. Freigeben oder ablehnen dürfen
Redaktion und Vereinsverwaltung (der Vorstand hat sie von selbst) in Admin → Galerie. Freigegeben wird das Bild ein
normales Galerie-Foto, auf Wunsch mit „Foto: Name“; abgelehnt wird die Datei sofort gelöscht. Die einsendende Person
bekommt in beiden Fällen Bescheid (Thema „Vereinsintern“).
"""
from __future__ import annotations

import logging
import pathlib
import shutil
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, UploadFile

from database import ensure_event_photo_indexes
from models import new_id, now_utc
from services.private_fields import private_projection
from storage import GALLERY_SUBMISSION_DIR, PUBLIC_UPLOAD_DIR, ensure_directory

logger = logging.getLogger("tls.event_photos")

VIENNA = ZoneInfo("Europe/Vienna")

# ---------- Die Fotos sind da (#1185) ----------
SETTLE_MINUTES = 10
MAX_AGE_HOURS = 24
PUBLIC_KIND = "gallery_event"
MEMBER_KIND = "gallery_member"
PUBLIC_CATEGORY = "tournament_updates"
MEMBER_CATEGORY = "club_internal"
CLAIM_STALE_MINUTES = 30
EVENT_REGISTRATION_STATUSES = ("registered", "checked_in")
TOURNAMENT_REGISTRATION_STATUSES = ("approved", "checked_in")

# ---------- Fotos einsenden (#1186) ----------
# Eingesandtes liegt privat - nie unter einer öffentlichen Upload-Adresse, bis es freigegeben ist.
SUBMISSION_DIR = GALLERY_SUBMISSION_DIR
PUBLIC_DIR = PUBLIC_UPLOAD_DIR
SUBMIT_DAYS_AFTER = 7
MAX_PER_PERSON = 20
MAX_SUBMISSION_MB = 25
SUBMISSION_KIND = "gallery_submission"
CLOSED_EVENT_STATUSES = {"draft", "cancelled"}
APPROVABLE_SCAN_STATES = {"safe", "failed"}
DECIDE_AREAS = ("content", "club")


def _parse(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _vienna_day(value) -> date | None:
    parsed = _parse(value)
    return parsed.astimezone(VIENNA).date() if parsed else None


def count_label(photos: int, videos: int = 0) -> str:
    parts = []
    if photos:
        parts.append(f"{photos} {'Bild' if photos == 1 else 'Bilder'}")
    if videos:
        parts.append(f"{videos} {'Video' if videos == 1 else 'Videos'}")
    return " und ".join(parts) or "neue Fotos"


def album_path(album: dict) -> str:
    return f"/galerie/{album.get('slug') or album['id']}"


# ---------- Wer beim Event war ----------

async def event_audience(db, event: dict) -> set[str]:
    """Alle Angemeldeten des Events: Event-Anmeldung und die Turniere des Events (Teams mit allen Mitgliedern)."""
    from services.match_audience import player_user_ids

    out: set[str] = set()
    rows = await db.event_registrations.find(
        {"event_id": event["id"], "status": {"$in": list(EVENT_REGISTRATION_STATUSES)}}, {"_id": 0, "user_id": 1},
    ).to_list(5000)
    out.update(row["user_id"] for row in rows if row.get("user_id"))
    tournament_ids = [row["id"] for row in await db.tournaments.find({"event_id": event["id"]}, {"_id": 0, "id": 1}).to_list(200)]
    if tournament_ids:
        regs = await db.tournament_registrations.find(
            {"tournament_id": {"$in": tournament_ids}, "status": {"$in": list(TOURNAMENT_REGISTRATION_STATUSES)}}, {"_id": 0},
        ).to_list(5000)
        out |= await player_user_ids(db, regs)
    return {user_id for user_id in out if user_id}


async def _media_counts(db, album_id: str) -> tuple[int, int, str | None]:
    """Bilder, Videos und wann das letzte Stück dazukam."""
    items = await db.gallery_photos.find({"album_id": album_id}, {"_id": 0, "media_type": 1, "video_url": 1, "embed_url": 1, "uploaded_at": 1}).to_list(5000)
    videos = sum(1 for item in items if item.get("media_type") in {"video", "embed"} or item.get("video_url") or item.get("embed_url"))
    newest = max((str(item.get("uploaded_at") or "") for item in items), default="") or None
    return len(items) - videos, videos, newest


# Eindeutige Schlüssel, auf denen „genau einmal“ und die Höchstzahl ruhen - angelegt in database.py (#1420).
ensure_indexes = ensure_event_photo_indexes


def _is_duplicate(exc: Exception) -> bool:
    return type(exc).__name__ == "DuplicateKeyError" or getattr(exc, "code", None) == 11000


async def _mark_notified(db, album_id: str, count: int) -> None:
    await db.gallery_albums.update_one({"id": album_id}, {"$set": {
        "participants_notified_at": now_utc().isoformat(), "participants_notified_count": count, "participants_notify_state": "done"}})


async def _claim(db, album_id: str, current: datetime) -> bool:
    """Das Album für diesen Lauf beanspruchen - atomar, bevor gesendet wird. Ein liegengebliebener Anspruch (Lauf
    abgebrochen) gilt nach ``CLAIM_STALE_MINUTES`` als frei; die Quittungen verhindern dann doppelte Meldungen."""
    stale = (current - timedelta(minutes=CLAIM_STALE_MINUTES)).isoformat()
    claimed = await db.gallery_albums.find_one_and_update(
        {"id": album_id, "$or": [
            {"participants_notified_at": {"$exists": False}},
            {"participants_notify_state": "sending", "participants_notified_at": {"$lt": stale}},
        ]},
        {"$set": {"participants_notified_at": current.isoformat(), "participants_notify_state": "sending"}},
        projection={"_id": 0, "id": 1},
    )
    return bool(claimed)


async def _receipt(db, album_id: str, user_id: str) -> bool:
    """Die Quittung je Album und Person - nur wer sie als Erster schreibt, sendet."""
    try:
        await db.gallery_album_notices.insert_one({"album_id": album_id, "user_id": user_id, "created_at": now_utc().isoformat()})
    except Exception as exc:  # noqa: BLE001 - nur der doppelte Schlüssel heißt „schon gemeldet“
        if _is_duplicate(exc):
            return False
        raise
    return True


async def notify_album(db, album: dict, event: dict, photos: int, videos: int) -> int:
    """Die Meldung „Die Fotos sind da“ an jeden Teilnehmer, der das Album sehen darf - je Album und Person einmal."""
    from services.user_notifications import create_user_notification
    from services.visibility import user_can_see

    visibility = album.get("visibility") or "public"
    internal = visibility in {"members", "internal"}
    recipients = sorted(await event_audience(db, event))
    users = await db.users.find(
        {"id": {"$in": recipients}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}}, private_projection(),
    ).to_list(len(recipients) + 1) if recipients else []
    sent = 0
    for user in users:
        if not await user_can_see(user, visibility):
            continue
        if not await _receipt(db, album["id"], user["id"]):
            continue
        created = await create_user_notification(
            user["id"], f"Die Fotos sind da: {count_label(photos, videos)}",
            f"{event.get('name') or 'Event'} – {album.get('title') or 'Album'}",
            url=album_path(album), kind=MEMBER_KIND if internal else PUBLIC_KIND,
            meta={"category": MEMBER_CATEGORY if internal else PUBLIC_CATEGORY, "dedupe_key": f"gallery_album:{album['id']}",
                  "album_id": album["id"], "event_id": event["id"]},
        )
        if created:
            sent += 1
    return sent


async def notify_due(*, now: datetime | None = None, limit: int = 1000) -> dict:
    """Veröffentlichte Event-Alben mit Fotos, die noch niemand gemeldet hat."""
    from database import get_db

    db = get_db()
    current = now or now_utc()
    settle = (current - timedelta(minutes=SETTLE_MINUTES)).isoformat()
    too_old = (current - timedelta(hours=MAX_AGE_HOURS)).isoformat()
    # Leere Alben bleiben ungemeldet in der Liste, bis Fotos kommen - deshalb großzügig statt der ersten 50.
    stale = (current - timedelta(minutes=CLAIM_STALE_MINUTES)).isoformat()
    albums = await db.gallery_albums.find(
        {"published": True, "event_id": {"$nin": [None, ""]}, "$or": [
            {"participants_notified_at": {"$exists": False}},
            {"participants_notify_state": "sending", "participants_notified_at": {"$lt": stale}},
        ]}, {"_id": 0},
    ).to_list(limit)
    done = 0
    sent = 0
    for album in albums:
        photos, videos, newest = await _media_counts(db, album["id"])
        if not photos and not videos:
            continue  # leeres Album: wartet auf die ersten Fotos
        if newest and newest < too_old:
            await _mark_notified(db, album["id"], 0)
            continue
        if newest and newest > settle:
            continue  # es kommen gerade noch Fotos dazu
        event = await db.events.find_one({"id": album["event_id"]}, {"_id": 0})
        if not event or event.get("status") in CLOSED_EVENT_STATUSES:
            await _mark_notified(db, album["id"], 0)
            continue
        if not await _claim(db, album["id"], current):
            continue  # ein anderer Lauf ist schon dran
        count = await notify_album(db, album, event, photos, videos)
        await _mark_notified(db, album["id"], count)
        done += 1
        sent += count
    return {"items": done, "sent": sent}


# ---------- Fotos einsenden ----------

def submission_window(event: dict) -> tuple[date | None, date | None]:
    """Vom ersten Event-Tag bis sieben Tage nach dem letzten (Wiener Tage)."""
    first = _vienna_day(event.get("start_date"))
    last = _vienna_day(event.get("end_date")) or first
    return first, (last + timedelta(days=SUBMIT_DAYS_AFTER)) if last else None


def window_open(event: dict | None, today: date) -> bool:
    if not event or event.get("status") in CLOSED_EVENT_STATUSES:
        return False
    first, until = submission_window(event)
    return bool(first and until and first <= today <= until)


def vienna_today(now: datetime | None = None) -> date:
    return (now or now_utc()).astimezone(VIENNA).date()


async def may_submit(user: dict | None) -> bool:
    """Mitglieder (nicht Gäste) - dieselbe Regel wie für Mitglieder-Inhalte."""
    from services.visibility import sees_member_content

    return bool(user) and await sees_member_content(user)


async def _used(db, album_id: str, user_id: str) -> tuple[int, int]:
    quota = await db.gallery_submission_quota.find_one({"album_id": album_id, "owner_id": user_id}, {"_id": 0, "count": 1}) or {}
    pending = await db.gallery_submissions.count_documents({"album_id": album_id, "owner_id": user_id, "status": "pending"})
    return int(quota.get("count") or 0), pending


async def _take_slot(db, album_id: str, user_id: str) -> bool:
    """Einen der 20 Plätze atomar nehmen - erst den Zähler anlegen (eindeutig je Person und Album), dann nur hochzählen,
    solange er unter der Höchstzahl liegt."""
    key = {"album_id": album_id, "owner_id": user_id}
    try:
        await db.gallery_submission_quota.update_one(key, {"$setOnInsert": {**key, "count": 0}}, upsert=True)
    except Exception as exc:  # noqa: BLE001 - zwei gleichzeitige erste Uploads: der Zähler steht schon da
        if not _is_duplicate(exc):
            raise
    taken = await db.gallery_submission_quota.find_one_and_update(
        {**key, "count": {"$lt": MAX_PER_PERSON}}, {"$inc": {"count": 1}}, projection={"_id": 0, "count": 1},
    )
    return bool(taken)


async def _give_back(db, album_id: str, user_id: str, count: int = 1) -> None:
    await db.gallery_submission_quota.update_one(
        {"album_id": album_id, "owner_id": user_id, "count": {"$gte": count}}, {"$inc": {"count": -count}})


async def submission_info(db, album: dict, user: dict | None) -> dict | None:
    """Was das Album zum Einsenden sagt - nur für Mitglieder und nur bei Event-Alben; sonst ``None`` (kein Knopf)."""
    if not album.get("event_id") or not await may_submit(user):
        return None
    event = await db.events.find_one({"id": album["event_id"]}, {"_id": 0})
    if not event or event.get("status") in CLOSED_EVENT_STATUSES:
        return None
    first, until = submission_window(event)
    used, pending = await _used(db, album["id"], user["id"])
    is_open = window_open(event, vienna_today())
    return {
        "open": is_open,
        "opens": first.isoformat() if first else None,
        "until": until.isoformat() if until else None,
        "max": MAX_PER_PERSON,
        "used": used,
        "pending": pending,
        "remaining": max(0, MAX_PER_PERSON - used),
        "can_submit": is_open and used < MAX_PER_PERSON,
    }


def submission_path(key: str | None) -> pathlib.Path | None:
    if not key or "/" in key or "\\" in key or ".." in key or key.startswith("."):
        return None
    return SUBMISSION_DIR / key


def image_url(doc: dict) -> str:
    return f"/api/gallery/submissions/{doc['id']}/image"


def public_submission(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "album_id": doc.get("album_id"),
        "status": doc.get("status"),
        "credit": bool(doc.get("credit")),
        "image_url": image_url(doc),
        "width": doc.get("width"),
        "height": doc.get("height"),
        "scan_state": doc.get("scan_state") or "pending",
        "created_at": doc.get("created_at"),
    }


async def find_album(db, album_id_or_slug: str) -> dict:
    album = await db.gallery_albums.find_one({"$or": [{"id": album_id_or_slug}, {"slug": album_id_or_slug}]}, {"_id": 0})
    if not album or not album.get("published", True):
        raise HTTPException(status_code=404, detail="Album nicht gefunden.")
    return album


async def store_submission(db, album: dict, user: dict, file: UploadFile, *, consent: bool, credit: bool) -> dict:
    """Ein Foto prüfen, ohne EXIF neu speichern und als „wartet auf Freigabe“ ablegen."""
    from services.image_upload import _encode_image_bytes, _read_upload_limited
    from services.visibility import user_can_see

    if not await may_submit(user):
        raise HTTPException(status_code=403, detail="Fotos einsenden können nur Vereinsmitglieder.")
    if not await user_can_see(user, album.get("visibility") or "public"):
        raise HTTPException(status_code=404, detail="Album nicht gefunden.")
    if not album.get("event_id"):
        raise HTTPException(status_code=409, detail="Fotos einsenden geht nur bei Alben eines Events.")
    event = await db.events.find_one({"id": album["event_id"]}, {"_id": 0})
    if not window_open(event, vienna_today()):
        raise HTTPException(status_code=409, detail="Einsenden geht vom ersten Event-Tag bis eine Woche nach dem Event.")
    if not consent:
        raise HTTPException(status_code=400, detail="Bitte bestätige, dass die Personen auf den Fotos einverstanden sind.")
    if not await _take_slot(db, album["id"], user["id"]):
        raise HTTPException(status_code=409, detail=f"Du hast schon {MAX_PER_PERSON} Fotos zu diesem Album geschickt.")
    try:
        data = await _read_upload_limited(file, MAX_SUBMISSION_MB * 1024 * 1024, MAX_SUBMISSION_MB)
        suffix = pathlib.Path(file.filename or "").suffix.lower()
        encoded = _encode_image_bytes(data, file.content_type or "", suffix, file.filename or "foto")
        key = f"{uuid.uuid4().hex}{encoded['ext']}"
        path = SUBMISSION_DIR / key
        try:
            ensure_directory(SUBMISSION_DIR)
            path.write_bytes(encoded["data"])
        except OSError as exc:
            logger.error("[event_photos] could not write %s: %s", key, type(exc).__name__)
            raise HTTPException(status_code=500, detail="Upload-Speicher ist nicht beschreibbar.")
    except BaseException:
        # Nicht angenommen (kein Bild, zu groß, Speicher): der Platz gehört wieder der Person.
        await _give_back(db, album["id"], user["id"])
        raise
    now = now_utc().isoformat()
    doc = {
        "id": new_id(),
        "album_id": album["id"],
        "event_id": album["event_id"],
        "owner_id": user["id"],
        "storage_key": key,
        "mime": encoded["content_type"],
        "size": len(encoded["data"]),
        "width": encoded["width"],
        "height": encoded["height"],
        "credit": bool(credit),
        "consent_at": now,
        "status": "pending",
        "scan_state": "pending",
        "created_at": now,
        "updated_at": now,
    }
    await db.gallery_submissions.insert_one(dict(doc))
    from services import media_scan

    try:
        scan = await media_scan.enqueue(db, kind=SUBMISSION_KIND, ref_id=doc["id"], owner_id=user["id"], path=path,
                                        context={"type": SUBMISSION_KIND, "album_id": album["id"]})
        doc["scan_state"] = "safe" if scan.get("state") == "failed" else (scan.get("state") or "pending")
    except Exception as exc:  # noqa: BLE001 - die Einsendung gilt; der Sammler holt die Prüfung nach
        logger.warning("[event_photos] Bildprüfung für %s nicht angestoßen: %s", doc["id"], type(exc).__name__)
    return public_submission(doc)


async def can_view(db, doc: dict, user: dict | None) -> bool:
    """Die einsendende Person; die Freigabe (Redaktion, Vereinsverwaltung) erst, wenn die Bildprüfung nichts fand."""
    from services.permissions import areas_for, needs_mfa

    if not user or (doc.get("scan_state") or "pending") == "blocked":
        return False
    if user.get("id") == doc.get("owner_id"):
        return True
    if (doc.get("scan_state") or "pending") not in APPROVABLE_SCAN_STATES:
        return False
    return not needs_mfa(user) and bool(set(DECIDE_AREAS) & await areas_for(user))


async def queue(db) -> list[dict]:
    """Was in Admin → Galerie auf Freigabe wartet - mit Album, Event und Namen."""
    rows = await db.gallery_submissions.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    album_ids = sorted({row["album_id"] for row in rows})
    owner_ids = sorted({row["owner_id"] for row in rows})
    albums = {a["id"]: a for a in await db.gallery_albums.find({"id": {"$in": album_ids}}, {"_id": 0, "id": 1, "title": 1, "slug": 1, "event_id": 1}).to_list(len(album_ids) + 1)} if album_ids else {}
    event_ids = sorted({a.get("event_id") for a in albums.values() if a.get("event_id")})
    events = {e["id"]: e for e in await db.events.find({"id": {"$in": event_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(event_ids) + 1)} if event_ids else {}
    owners = {u["id"]: u for u in await db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(owner_ids) + 1)} if owner_ids else {}
    out = []
    for row in rows:
        album = albums.get(row["album_id"]) or {}
        owner = owners.get(row["owner_id"]) or {}
        out.append({
            **public_submission(row),
            "album_title": album.get("title"),
            "album_slug": album.get("slug"),
            "event_name": (events.get(album.get("event_id")) or {}).get("name"),
            "owner_name": owner.get("display_name") or owner.get("username") or "Mitglied",
        })
    return out


def _remove_files(doc: dict) -> None:
    from services.image_variants import VARIANT_WIDTHS, variant_path

    path = submission_path(doc.get("storage_key"))
    if path is None:
        return
    path.unlink(missing_ok=True)
    for width in VARIANT_WIDTHS:
        variant_path(path, width).unlink(missing_ok=True)


async def _publish(db, doc: dict, actor: dict) -> dict:
    """Die Datei an die öffentliche Stelle verschieben und als Galerie-Foto eintragen."""
    from services.image_variants import schedule_variants

    source = submission_path(doc.get("storage_key"))
    if source is None or not source.is_file():
        raise HTTPException(status_code=409, detail="Die Datei zu diesem Foto fehlt - bitte ablehnen.")
    filename = f"{uuid.uuid4().hex}{source.suffix.lower()}"
    target = PUBLIC_DIR / filename
    ensure_directory(PUBLIC_DIR)
    shutil.move(str(source), str(target))
    schedule_variants(target)
    url = f"/api/static/uploads/{filename}"
    owner = await db.users.find_one({"id": doc["owner_id"]}, {"_id": 0, "display_name": 1, "username": 1}) or {}
    now = now_utc().isoformat()
    last = await db.gallery_photos.find({"album_id": doc["album_id"]}, {"_id": 0, "order_index": 1}).sort("order_index", -1).limit(1).to_list(1)
    photo = {
        "id": new_id(),
        "album_id": doc["album_id"],
        "media_type": "image",
        "source_type": "upload",
        "image_url": url,
        "caption": None,
        "order_index": int((last[0].get("order_index") if last else 0) or 0) + 1,
        "section_id": None,
        "mime": doc.get("mime"),
        "file_size": doc.get("size"),
        "width": doc.get("width"),
        "height": doc.get("height"),
        "credit": (owner.get("display_name") or owner.get("username")) if doc.get("credit") else None,
        "submitted_by": doc["owner_id"],
        "submission_id": doc["id"],
        "uploaded_at": now,
        # Zählt für den Erfolg „Fotos in der Galerie“ (gallery_uploads_approved) - bei der Person, die eingesandt hat.
        "uploaded_by": doc["owner_id"],
        "approved_by": actor["id"],
    }
    await db.gallery_photos.insert_one(dict(photo))
    await db.media_uploads.insert_one({
        "id": new_id(), "filename": filename, "url": url, "size": doc.get("size"), "width": doc.get("width"),
        "height": doc.get("height"), "mime": doc.get("mime"), "ext": source.suffix.lower().lstrip("."), "media_type": "image",
        "owner_id": doc["owner_id"], "owner_role": None, "media_scope": "gallery", "scan_state": doc.get("scan_state"),
        "created_at": now, "updated_at": now,
    })
    await db.gallery_submissions.update_one({"id": doc["id"]}, {"$set": {
        "status": "approved", "storage_key": None, "photo_id": photo["id"], "decided_by": actor["id"], "decided_at": now, "updated_at": now}})
    return photo


async def _tell_owner(db, owner_id: str, album: dict, count: int, *, approved: bool, reason: str | None) -> None:
    from services.user_notifications import create_user_notification

    things = "1 Foto" if count == 1 else f"{count} Fotos"
    if approved:
        title, body = "Deine Fotos sind online", f"{things} von dir im Album „{album.get('title') or 'Album'}“."
    else:
        title = "Fotos nicht freigegeben"
        body = f"{things} für „{album.get('title') or 'Album'}“ {'wurde' if count == 1 else 'wurden'} nicht freigegeben und gelöscht."
        if reason:
            body += f" Grund: {reason}"
    try:
        await create_user_notification(owner_id, title, body, url=album_path(album), kind=SUBMISSION_KIND,
                                       meta={"category": MEMBER_CATEGORY, "album_id": album["id"]})
    except Exception as exc:  # noqa: BLE001 - die Entscheidung gilt auch ohne Nachricht
        logger.warning("[event_photos] Nachricht an %s nicht zugestellt: %s", owner_id, type(exc).__name__)


async def decide(db, ids: list[str], *, approve: bool, actor: dict, reason: str | None = None) -> dict:
    """Freigeben oder ablehnen - je Person und Album eine Nachricht."""
    wanted = [item for item in dict.fromkeys(ids or []) if item]
    if not wanted:
        raise HTTPException(status_code=400, detail="Keine Fotos gewählt.")
    rows = await db.gallery_submissions.find({"id": {"$in": wanted}, "status": "pending"}, {"_id": 0}).to_list(len(wanted))
    if len(rows) != len(wanted):
        raise HTTPException(status_code=409, detail="Ein Foto ist schon entschieden oder gelöscht - bitte neu laden.")
    if approve:
        stuck = [row for row in rows if (row.get("scan_state") or "pending") not in APPROVABLE_SCAN_STATES]
        if stuck:
            raise HTTPException(status_code=409, detail="Die Bildprüfung ist bei einem Foto noch nicht fertig oder hat etwas gefunden - freigeben geht erst danach.")
    clean_reason = " ".join(str(reason or "").split())[:300] or None
    groups: dict[tuple[str, str], int] = {}
    for row in rows:
        if approve:
            await _publish(db, row, actor)
        else:
            _remove_files(row)
            await db.gallery_submissions.delete_one({"id": row["id"]})
            await _give_back(db, row["album_id"], row["owner_id"])
        key = (row["owner_id"], row["album_id"])
        groups[key] = groups.get(key, 0) + 1
    for (owner_id, album_id), count in groups.items():
        album = await db.gallery_albums.find_one({"id": album_id}, {"_id": 0, "id": 1, "title": 1, "slug": 1}) or {"id": album_id}
        await _tell_owner(db, owner_id, album, count, approved=approve, reason=clean_reason)
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "gallery.submission_approve" if approve else "gallery.submission_reject",
        "actor_id": actor.get("id"), "target_id": rows[0]["album_id"],
        "data": {"count": len(rows), "submission_ids": [row["id"] for row in rows]},
        "created_at": now_utc().isoformat(),
    })
    return {"ok": True, "count": len(rows)}


async def delete_for_album(db, album_id: str) -> int:
    """Album gelöscht: offene Einsendungen samt Dateien weg."""
    rows = await db.gallery_submissions.find({"album_id": album_id}, {"_id": 0}).to_list(None)
    for row in rows:
        _remove_files(row)
    await db.gallery_submissions.delete_many({"album_id": album_id})
    await db.gallery_submission_quota.delete_many({"album_id": album_id})
    await db.gallery_album_notices.delete_many({"album_id": album_id})
    return len(rows)


EXPORT_FIELDS = ("id", "album_id", "event_id", "status", "credit", "consent_at", "scan_state", "mime", "size", "width",
                 "height", "photo_id", "created_at", "updated_at", "decided_at")


async def export_for_user(db, user_id: str) -> list[dict]:
    """DSGVO-Auskunft: die eigenen Einsendungen mit Einwilligung und Stand - nur Angaben, nie die Datei oder ihr Ablageort.
    Abgelehnte stehen nicht darin: sie sind samt Datei gelöscht."""
    rows = await db.gallery_submissions.find({"owner_id": user_id}, {"_id": 0}).to_list(5000)
    rows.sort(key=lambda row: str(row.get("created_at") or ""))
    return [{key: row.get(key) for key in EXPORT_FIELDS} for row in rows]


async def delete_for_user(db, user_id: str) -> int:
    """Kontolöschung: offene Einsendungen samt Dateien weg, „Foto: Name“ an freigegebenen Bildern weg."""
    rows = await db.gallery_submissions.find({"owner_id": user_id}, {"_id": 0}).to_list(None)
    for row in rows:
        _remove_files(row)
    await db.gallery_submissions.delete_many({"owner_id": user_id})
    await db.gallery_submission_quota.delete_many({"owner_id": user_id})
    await db.gallery_album_notices.delete_many({"user_id": user_id})
    await db.gallery_photos.update_many({"submitted_by": user_id}, {"$set": {"credit": None}})
    return len(rows)
