"""Was beim Löschen eines Kontos über das Konto selbst hinaus aufgeräumt wird (#928).

Je Sammlung eine Entscheidung - sie steht für Betroffene in der Datenschutzerklärung (``site_texts``, Abschnitt
„Konto löschen“) und für den Betreiber in ``DATA_PROTECTION.md``:

- **Gelöscht**, weil ohne Konto ohne Zweck: XP und ihre Ereignisse, Einladungen zur Mitgliedschaft, die Tokens der
  Mitgliedskarte, Discord-Aktivität und -Zugehörigkeit, die Warteschlange der Erfolge, Stream-Zustände, Aufgaben im
  Turnier-Team, der selbst angelegte Eintrag im Mitgliederverzeichnis und die eigenen Bilder.
- **Überschrieben**, weil die Zeile als Zählung oder Nachweis bleibt: Anmeldungen zu Events und Turnieren,
  Mitgliedsanträge, Rundenzeiten, Gewinne, die Textauszüge der Moderation, Zugangslinks.
- **Gelöst**, nicht gelöscht: Vorstandsposten sowie redaktionelle und aus der Mitgliederverwaltung stammende
  Einträge im Verzeichnis verlieren nur die Verknüpfung zum Konto - sie gehören dem Verein. Ebenso der Einlass bei
  einer Generalversammlung (``meeting_admissions``, #845): die Anwesenheit ist Sache des Vereins; wer als Vorstand
  selbst eingelassen hat, steht dort danach ohne Namen.
"""
from __future__ import annotations

import logging
import re

from services import media_audit
from services.image_variants import VARIANT_WIDTHS, variant_path
from storage import PUBLIC_UPLOAD_DIR, QUARANTINE_DIR, UPLOAD_DIR

logger = logging.getLogger(__name__)

GONE = "Gelöschter User"
DELETED_TEXT = "[Nachricht gelöscht]"

# Zeilen, die nur mit Konto einen Zweck haben: Verhalten, Zustände und Zugänge.
PURGED = (
    "user_xp", "xp_events", "membership_invitations", "member_card_tokens", "discord_activity", "discord_memberships",
    "achievement_eval_queue", "live_streams", "twitch_stream_sessions", "tournament_staff_assignments",
)
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


async def _records(db, user: dict, now: str) -> None:
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


async def _still_used(db, filename: str) -> bool:
    """Ob ein Bild noch irgendwo steht - als Teamlogo etwa gehört es längst dem Team."""
    ending = re.escape(filename) + "$"
    for collection, fields in media_audit.TARGETS:
        if await getattr(db, collection).find_one({"$or": [{field: {"$regex": ending}} for field in fields]}, {"_id": 1}):
            return True
    anywhere = re.escape(filename)
    for collection, fields in media_audit.TEXT_TARGETS:
        if await getattr(db, collection).find_one({"$or": [{field: {"$regex": anywhere}} for field in fields]}, {"_id": 1}):
            return True
    return False


def _filename(url: str | None) -> str | None:
    path = media_audit._upload_path(url or "")
    return media_audit._filename_from_upload_path(path) if path else None


async def _own_images(db, user_id: str, urls: list[str | None]) -> int:
    """Avatar, Banner und alles, was das Konto für sich hochgeladen hat: Datei, kleinere Fassungen, eine Kopie in der
    Quarantäne der Bildprüfung und die Verwaltungszeilen. Was noch verwendet wird, bleibt."""
    names = {name for name in (_filename(url) for url in urls) if name}
    async for row in db.media_uploads.find({"owner_id": user_id, "media_scope": "user"}, {"_id": 0, "filename": 1}):
        if _filename(f"/api/static/uploads/{row.get('filename') or ''}"):
            names.add(row["filename"])
    removed = 0
    for name in sorted(names):
        if await _still_used(db, name):
            continue
        for base in (PUBLIC_UPLOAD_DIR, UPLOAD_DIR):
            path = base / name
            try:
                for width in VARIANT_WIDTHS:
                    variant_path(path, width).unlink(missing_ok=True)
                path.unlink(missing_ok=True)
            except OSError as exc:  # die Löschung des Kontos darf an einer gesperrten Datei nicht scheitern
                logger.warning("[dsgvo] Bild %s nicht gelöscht: %s", name, exc)
        scans = {"owner_id": user_id, "url": {"$regex": re.escape(name) + "$"}}
        async for scan in db.media_scans.find(scans, {"_id": 0, "quarantine_key": 1}):
            key = media_audit._filename_from_upload_path(str(scan.get("quarantine_key") or ""))
            if key:
                (QUARANTINE_DIR / key).unlink(missing_ok=True)
        await db.media_scans.delete_many(scans)
        await db.media_uploads.delete_many({"filename": name})
        removed += 1
    return removed


async def erase_related(db, user: dict, now: str) -> dict:
    """Alles außerhalb des Kontos selbst. ``user`` ist der Stand **vor** dem Überschreiben (E-Mail, Avatar, Banner)."""
    user_id = user["id"]
    purged = 0
    for name in PURGED:
        purged += (await getattr(db, name).delete_many({"user_id": user_id})).deleted_count
    directory_images = await _directory(db, user_id, now)
    await _applications(db, user_id, now)
    await _registrations(db, user_id, now)
    await _records(db, user, now)
    images = await _own_images(db, user_id, [user.get("avatar_url"), user.get("banner_url"), *directory_images])
    return {"purged_rows": purged, "images": images}
