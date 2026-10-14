"""Was beim Löschen eines Kontos über das Konto selbst hinaus aufgeräumt wird (#928).

Je Sammlung eine Entscheidung - die vollständige Liste führt ``services/personal_data.py`` (ein Test verlangt jede
Sammlung dort, #1029). Sie steht für Betroffene in der Datenschutzerklärung (``site_texts``, Abschnitt „Konto löschen“)
und für den Betreiber in ``DATA_PROTECTION.md``:

- **Gelöscht**, weil ohne Konto ohne Zweck: XP und ihre Ereignisse, Erfolge, Einladungen zur Mitgliedschaft und in
  Teams, die Tokens der Mitgliedskarte, der persönliche Kalender-Link (#1189), Discord-Aktivität und -Zugehörigkeit,
  die Warteschlangen der Erfolge, Stream-Zustände, Aufgaben im Turnier- und F1-Team, Lesestände, Sticker, die
  Verbindung zur Mitgliederakte, der selbst angelegte Eintrag im Mitgliederverzeichnis und die eigenen Bilder.
- **Überschrieben**, weil die Zeile als Zählung oder Nachweis bleibt: Anmeldungen zu Events und Turnieren,
  Mitgliedsanträge, Rundenzeiten, Gewinne, die Textauszüge der Moderation, Zugangslinks, Kontaktanfragen und
  gespeicherte Namen (News-Beitrag, Protokoll der Erfolge, Daten im Adminprotokoll).
- **Gelöst**, nicht gelöscht: Vorstandsposten sowie redaktionelle und aus der Mitgliederverwaltung stammende
  Einträge im Verzeichnis verlieren nur die Verknüpfung zum Konto - sie gehören dem Verein. Ebenso der Einlass bei
  einer Generalversammlung (``meeting_admissions``, #845): die Anwesenheit ist Sache des Vereins; wer als Vorstand
  selbst eingelassen hat, steht dort danach ohne Namen.
"""
from __future__ import annotations

import logging
import pathlib
import re
from datetime import datetime, timezone

from bson import ObjectId

from models import now_utc
from services import media_audit, uploads_inventory
from services.image_variants import VARIANT_WIDTHS, variant_path
from storage import PUBLIC_UPLOAD_DIR, QUARANTINE_DIR, UPLOAD_DIR

logger = logging.getLogger(__name__)

GONE = "Gelöschter User"
DELETED_TEXT = "[Nachricht gelöscht]"

# Zeilen, die nur mit Konto einen Zweck haben: Verhalten, Zustände und Zugänge.
PURGED = (
    "user_xp", "xp_events", "membership_invitations", "member_card_tokens", "discord_activity", "discord_guild_active", "discord_memberships",
    "achievement_eval_queue", "live_streams", "twitch_stream_sessions", "tournament_staff_assignments", "calendar_feed_tokens",
    # Seit #1029: Lesestände, Einladungen in Teams, Erfolge samt Warteschlange, Sticker, Verlauf der Saisonränge, Merker zu
    # Jahresrückblick, Feedback und Stream-Ankündigungen, F1-Aufgaben und die Verbindung zur Mitgliederakte samt Ehrungen.
    "chat_reads", "document_opens", "team_invites", "user_achievements", "achievement_outbox", "user_stickers", "season_rank_snapshots",
    "year_review_notices", "feedback_receipts", "tournament_stream_announcements", "f1_staff_assignments", "dolibarr_identities",
    "dolibarr_honours",
)
# Angaben zur Person, die in den Daten des Adminprotokolls stehen können (#1029). Der Vorgang bleibt, die Angaben nicht.
AUDIT_PERSONAL_KEYS = ("display_name", "username", "real_name", "first_name", "last_name", "nickname", "email", "phone", "address",
                       "birth_date")
# Nachweise, die nach der Löschung bleiben, aber nicht ewig (Entscheidung zu #1029): Einwilligungen, Moderationsfälle
# (Meldungen von und über die Person, Verwarnungen, Sperren), Ergebnismeldungen und angemeldet geschriebene Kontaktanfragen. Die Löschung setzt ``erase_after`` auf drei
# Jahre danach; der tägliche Job ``purge_expired_records`` löscht, was abgelaufen ist. Zeilen aktiver Konten tragen das
# Feld nie und laufen nicht ab. (Sammlung, Feld mit der Konto-ID)
RETENTION_YEARS = 3
RETAINED = (("consent_records", "user_id"), ("consent_decisions", "user_id"), ("moderation_strikes", "user_id"),
            ("moderation_sanctions", "user_id"), ("user_reports", "reporter_id"), ("user_reports", "target_user_id"),
            ("match_reports_v2", "reporter_user_id"))
RETAINED_COLLECTIONS = tuple(dict.fromkeys(name for name, _field in RETAINED)) + ("contact_messages",)
# Ein Antrag in diesen Zuständen läuft noch - ohne Konto ist er zurückgezogen (der Abgleich mit der
# Mitgliederverwaltung fasst ihn dann nicht mehr an).
OPEN_APPLICATIONS = ("pending", "submitting", "failed")


async def _directory(db, user_id: str, now: str) -> list[str]:
    """Der selbst angelegte Eintrag verschwindet samt Text; alle anderen gehören dem Verein und verlieren die Verknüpfung."""
    own = await db.club_member_profiles.find(
        {"user_id": user_id, "source": "member"}, {"_id": 0, "id": 1, "photo_url": 1, "cover_url": 1},
    ).to_list(50)
    if own:
        await db.club_member_profiles.delete_many({"id": {"$in": [row["id"] for row in own]}})
    await db.club_member_profiles.update_many({"user_id": user_id}, {"$set": {"user_id": None, "updated_at": now}})
    return [row[field] for row in own for field in ("photo_url", "cover_url") if row.get(field)]


async def _applications(db, user_id: str, now: str) -> None:
    await db.membership_applications.update_many({"user_id": user_id}, {
        "$set": {"motivation": None, "notes": None, "decision_note": None, "anonymized_at": now, "updated_at": now},
        "$unset": {"person": "", "fields": "", "consents": ""},
    })
    await db.membership_applications.update_many(
        {"user_id": user_id, "status": {"$in": list(OPEN_APPLICATIONS)}}, {"$set": {"status": "withdrawn", "withdrawn_at": now}},
    )


async def _registrations(db, user_id: str, now: str) -> None:
    """Die Anmeldung bleibt als Zählung und für den Turnierbaum - ohne die Kopien von Name, Adresse und Notiz."""
    await db.event_registrations.update_many(
        {"user_id": user_id}, {"$set": {"display_name": GONE, "email": None, "note": None, "anonymized_at": now}},
    )
    await db.tournament_registrations.update_many(
        {"user_id": user_id}, {"$set": {"ingame_name": None, "discord": None, "platform_id": None, "notes": None, "anonymized_at": now}},
    )
    # Ein Team behält seinen Namen; nur die Einzelanmeldung trug den der Person.
    await db.tournament_registrations.update_many(
        {"user_id": user_id, "registration_type": {"$ne": "team"}}, {"$set": {"display_name": GONE}},
    )


def erase_after(erased_at: str) -> datetime:
    """Drei Jahre nach der Löschung - am 29. Februar gelöscht heißt: am 28. Februar abgelaufen."""
    base = datetime.fromisoformat(str(erased_at))
    base = (base if base.tzinfo else base.replace(tzinfo=timezone.utc)).replace(microsecond=0)
    try:
        return base.replace(year=base.year + RETENTION_YEARS)
    except ValueError:
        return base.replace(year=base.year + RETENTION_YEARS, day=28)


async def _retention(db, user_id: str, until: datetime) -> None:
    """Frist für die Nachweise dieses Kontos - eine schon gesetzte bleibt (der Nachzug verschiebt sie nicht)."""
    for name, field in RETAINED:
        await getattr(db, name).update_many({field: user_id, "erase_after": {"$exists": False}}, {"$set": {"erase_after": until}})


async def purge_expired_records(db, now: datetime | None = None) -> int:
    """Der tägliche Job: Nachweise gelöschter Konten, deren Frist abgelaufen ist, endgültig löschen."""
    now = now or now_utc()
    removed = 0
    for name in RETAINED_COLLECTIONS:
        removed += (await getattr(db, name).delete_many({"erase_after": {"$lte": now}})).deleted_count
    return removed


async def _records(db, user: dict, now: str, until: datetime) -> int:
    """Überschreibt Nachweise und Kopien; liefert die Zahl der Kontaktanfragen ohne Konto mit derselben Adresse."""
    user_id = user["id"]
    await db.f1_lap_times.update_many({"user_id": user_id}, {"$set": {"proof_url": None, "admin_note": None}})
    await db.prize_pickups.update_many({"user_id": user_id}, {"$set": {"notes": ""}})
    await db.moderation_items.update_many({"user_id": user_id}, {"$set": {"excerpt": DELETED_TEXT}})
    await db.board_positions.update_many({"user_id": user_id}, {"$set": {"user_id": None}})
    await db.board_positions.update_many({"deputy_user_id": user_id}, {"$set": {"deputy_user_id": None}})
    # Einlass bei der Generalversammlung (#845): die Anwesenheit gehört dem Verein und bleibt - ohne Verknüpfung zum
    # Konto. Wer selbst eingelassen hat, bleibt als Vorgang stehen, aber ohne Namen.
    await db.meeting_admissions.update_many({"user_id": user_id}, {"$set": {"user_id": None}})
    await db.meeting_admissions.update_many({"by": user_id}, {"$set": {"by": None, "by_name": GONE}})
    email = str(user.get("email") or "").strip().lower()
    bound = [{"user_id": user_id}] + ([{"email": email}] if email else [])
    await db.access_links.update_many({"$or": bound}, {"$set": {"is_active": False, "email": None, "note": None, "updated_at": now}})
    # Wer einen Zugangslink schon genutzt hat (#1036), steht nicht mehr daran - gezählt bleibt die Nutzung.
    await db.access_links.update_many({"used_by": user_id}, {"$pull": {"used_by": user_id}})
    await db.access_links.update_many({"last_used_by": user_id}, {"$set": {"last_used_by": None}})
    # Kontaktanfragen (#1029) bleiben als Vorgang des Vereins - ohne Name, Adresse, Betreff und Text. Nur angemeldet
    # geschriebene: eine Anfrage ohne Konto lässt sich nicht sicher zuordnen, denn ob die Adresse damals schon zu diesem
    # Konto gehörte, hält niemand fest. Solche bleiben unberührt und werden gezählt (Protokoll der Löschung).
    await db.contact_messages.update_many({"user_id": user_id}, {"$set": {
        "name": GONE, "email": None, "user_id": None, "subject": DELETED_TEXT, "message": DELETED_TEXT, "anonymized_at": now,
        "erase_after": until}})
    unlinked = await db.contact_messages.count_documents({"user_id": None, "email": email}) if email else 0
    if email:
        # Was noch in der Warteschlange steht, geht nicht mehr raus; Versandtes steht überschrieben in email_logs.
        await db.mail_jobs.delete_many({"to": email})
    # Gespeicherte Namen: am News-Beitrag, im Protokoll der Erfolge und in den Daten des Adminprotokolls.
    await db.news_posts.update_many({"author_id": user_id}, {"$set": {"author_name": GONE}})
    # Nachricht an alle Angemeldeten (#1372): der gespeicherte Name des Absenders.
    await db.event_messages.update_many({"actor_id": user_id}, {"$set": {"actor_name": GONE}})
    await db.achievement_events.update_many({"user_id": user_id}, {"$set": {"username": None, "user_name": GONE}})
    await db.achievement_events.update_many({"actor_id": user_id}, {"$set": {"actor_name": GONE}})
    await db.audit_logs.update_many({"$or": [{"actor_id": user_id}, {"target_id": user_id}], "data": {"$type": "object"}},
                                    {"$unset": {f"data.{key}": "" for key in AUDIT_PERSONAL_KEYS}})
    return unlinked


# Persönliche Profile (#1039): Steht eine eigene Datei im Profil einer anderen Person, hält das sie nicht fest - sie geht
# mit dem Konto, und das andere Profil verliert nur den Eintrag. Einträge des Vereins im Verzeichnis zählen nicht dazu.
PERSONAL_PLACES = (
    ("users", {}, ("avatar_url", "banner_url")),
    ("club_member_profiles", {"source": "member"}, ("photo_url", "cover_url")),
)
# Dateien, deren Löschung scheiterte (gesperrt, Rechte): die Verwaltungszeilen bleiben, der Aufräum-Job versucht es
# stündlich erneut (``retry_file_cleanups``).
PENDING = "pending_file_cleanups"


def _id_forms(user_id: str) -> list:
    """Die Kennung als Text und - wenn sie so aussieht - als ObjectId, damit Zeilen beider Art gefunden werden."""
    forms: list = [str(user_id)]
    if ObjectId.is_valid(str(user_id)):
        forms.append(ObjectId(str(user_id)))
    return forms


def _personal(collection: str, document: dict) -> bool:
    return any(name == collection and all(document.get(key) == value for key, value in base.items())
               for name, base, _fields in PERSONAL_PLACES)


async def _usage(db, names: set[str]) -> tuple[set[str], dict[str, list]]:
    """Wo die Dateien noch stehen (``media_audit.iter_usages``, dieselbe Liste wie die Mediathek).

    Liefert die Dateien, die außerhalb persönlicher Profile verwendet werden, und je Datei die Stellen in persönlichen
    Profilen als ``(Sammlung, _id, Feld)``."""
    elsewhere: set[str] = set()
    personal: dict[str, list] = {}
    async for collection, document, field, name, text in media_audit.iter_usages(db, names):
        if not _personal(collection, document):
            elsewhere.add(name)
        elif not text:
            personal.setdefault(name, []).append((collection, document["_id"], field))
    return elsewhere, personal


def _unlink(path: pathlib.Path) -> None:
    path.unlink(missing_ok=True)


async def _remove(db, name: str, scans: list[dict]) -> str | None:
    """Datei, kleinere Fassungen und Quarantäne-Kopien weg; erst danach die Verwaltungszeilen. Liefert den Fehler."""
    try:
        for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR):
            path = base / name
            for width in VARIANT_WIDTHS:
                _unlink(variant_path(path, width))
            _unlink(path)
        for scan in scans:
            key = media_audit._filename_from_upload_path(str(scan.get("quarantine_key") or ""))
            if key:
                _unlink(QUARANTINE_DIR / key)
    except OSError as exc:  # die Löschung des Kontos darf an einer gesperrten Datei nicht scheitern
        return str(exc)[:300] or exc.__class__.__name__
    if scans:
        await db.media_scans.delete_many({"_id": {"$in": [scan["_id"] for scan in scans]}})
    await db.media_uploads.delete_many({"filename": name})
    return None


async def _scans(db, owner_id: str, names: set[str]) -> dict[str, list[dict]]:
    """Die Einträge der Bildprüfung zu diesen Dateien - eine Abfrage für alle."""
    stems = {pathlib.PurePosixPath(name).stem: name for name in names}
    query = {"owner_id": {"$in": _id_forms(owner_id)}, "url": {"$regex": "|".join(re.escape(stem) for stem in sorted(stems))}}
    found: dict[str, list[dict]] = {}
    async for scan in db.media_scans.find(query, {"_id": 1, "url": 1, "quarantine_key": 1}):
        name = media_audit.canonical_name(scan.get("url"), stems)
        if name in names:
            found.setdefault(name, []).append(scan)
    return found


async def _remember(db, name: str, owner_id: str, owned: bool, error: str) -> None:
    """Zum Nachholen vermerken: der stündliche Aufräum-Job (``retry_file_cleanups``) versucht es erneut."""
    logger.warning("[media] Datei %s nicht gelöscht, wird nachgeholt: %s", name, error)
    now = now_utc().isoformat()
    await db[PENDING].update_one({"filename": name}, {
        "$set": {"owner_id": str(owner_id), "owned": owned, "last_error": error, "updated_at": now},
        "$inc": {"attempts": 1}, "$setOnInsert": {"created_at": now},
    }, upsert=True)


async def remove_upload(db, name: str) -> str | None:
    """Eine Datei samt kleineren Fassungen und Verwaltungszeilen löschen - für die Mediathek (#1471), nachdem sie die
    Verweise geleert hat. Scheitert das Löschen der Datei, bleibt die Verwaltungszeile und der Aufräum-Job holt es
    nach; er prüft vorher erneut, ob die Datei inzwischen wieder verwendet wird. Liefert den Fehler."""
    error = await _remove(db, name, [])
    if error:
        await _remember(db, name, "", True, error)
    else:
        await db[PENDING].delete_many({"filename": name})
    return error


async def _clean(db, owner_id: str, owned: set[str], untracked: set[str]) -> int:
    """Löscht, was nirgends mehr steht. Eigene Dateien: persönliche Profile anderer verlieren den Eintrag."""
    names = owned | untracked
    if not names:
        return 0
    elsewhere, personal = await _usage(db, names)
    scans = await _scans(db, owner_id, names)
    removed = 0
    for name in sorted(names):
        if name in elsewhere or (name in untracked and name in personal):
            await db[PENDING].delete_many({"filename": name})
            continue
        error = await _remove(db, name, scans.get(name, []))
        if error:
            await _remember(db, name, owner_id, name in owned, error)
            continue
        for collection, row_id, field in personal.get(name, []):
            await getattr(db, collection).update_one({"_id": row_id}, {"$set": {field: None}})
        await db[PENDING].delete_many({"filename": name})
        removed += 1
    return removed


async def _own_images(db, user_id: str, urls: list[str | None]) -> int:
    """Avatar, Banner und alles, was das Konto für sich hochgeladen hat: Datei, kleinere Fassungen, eine Kopie in der
    Quarantäne der Bildprüfung und die Verwaltungszeilen. Was noch verwendet wird, bleibt.

    Eigen ist, was das Konto hochgeladen hat (#1039). Eine Datei im eigenen Profil, die einem anderen Konto oder dem
    Verein gehört, bleibt; eine ältere ohne Verwaltungszeile geht, wenn sie sonst nirgends steht."""
    owned: set[str] = set()
    query = {"owner_id": {"$in": _id_forms(user_id)}, "media_scope": "user"}
    async for row in db.media_uploads.find(query, {"_id": 0, "filename": 1}):
        if media_audit._filename_from_upload_path(str(row.get("filename") or "")):
            owned.add(row["filename"])
    profile = {uploads_inventory.upload_filename(str(url or "")) for url in urls} - {None}
    profile = {name for name in profile if media_audit._filename_from_upload_path(name)} - owned
    owners: dict[str, set[str]] = {name: set() for name in profile}
    if profile:
        async for row in db.media_uploads.find({"filename": {"$in": sorted(profile)}}, {"_id": 0, "filename": 1, "owner_id": 1}):
            if row.get("owner_id"):
                owners[row["filename"]].add(str(row["owner_id"]))
    untracked = {name for name in profile if not owners[name]}
    owned |= {name for name in profile if owners[name] == {str(user_id)}}
    return await _clean(db, user_id, owned, untracked)


async def retry_file_cleanups(db, limit: int = 200) -> int:
    """Der Aufräum-Job: Dateien gelöschter Konten, deren Löschung beim ersten Mal scheiterte, erneut versuchen."""
    removed = 0
    async for row in db[PENDING].find({}, {"_id": 0}).limit(limit):
        name = row.get("filename")
        if name:
            owned, untracked = ({name}, set()) if row.get("owned") else (set(), {name})
            removed += await _clean(db, row.get("owner_id") or "", owned, untracked)
    return removed


async def erase_related(db, user: dict, now: str, erased_at: str | None = None) -> dict:
    """Alles außerhalb des Kontos selbst. ``user`` ist der Stand **vor** dem Überschreiben (E-Mail, Avatar, Banner).
    ``erased_at``: Zeitpunkt der Löschung, ab dem die Frist der Nachweise zählt (beim Nachzug die damalige Löschung)."""
    user_id = user["id"]
    until = erase_after(erased_at or now)
    purged = 0
    for name in PURGED:
        purged += (await getattr(db, name).delete_many({"user_id": user_id})).deleted_count
    directory_images = await _directory(db, user_id, now)
    await _applications(db, user_id, now)
    await _registrations(db, user_id, now)
    unlinked_contacts = await _records(db, user, now, until)
    await _retention(db, user_id, until)
    images = await _own_images(db, user_id, [user.get("avatar_url"), user.get("banner_url"), *directory_images])
    return {"purged_rows": purged, "images": images, "unlinked_contact_messages": unlinked_contacts}
