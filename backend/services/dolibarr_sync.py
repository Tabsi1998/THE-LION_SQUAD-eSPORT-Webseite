"""Mitgliedschaft und Beitragsstand aus Dolibarr übernehmen (#295).

Dolibarr mit dem Vereinsmodul führt, die Website bildet ab. Übernommen wird nur
für **bestätigt** zugeordnete Konten (services/dolibarr_links.py) und nur im
Modus `live`; `preview` liest und zählt, schreibt aber nichts.

Was dieser Abgleich nie tut:
- Mails, Discord-Meldungen oder Erfolge auslösen - eine Umstellung darf
  niemanden rückwirkend anschreiben;
- bei einem unvollständigen Lauf jemanden austragen: fehlt eine Seite, bleibt
  alles stehen, und der Merker für `changed_since` rückt nicht vor;
- aus einem Beitragsrückstand ein Ende der Mitgliedschaft machen. `active` mit
  fälligem Beitrag bleibt Mitglied; `paid_until` ist kein Austrittsdatum.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import re
import logging
from datetime import datetime, timedelta, timezone

from database import get_db
from models import new_id, now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError, capabilities_for, instance_key, load_settings
from services.dolibarr_links import close_link, note_candidate, verified_link_for_member, verify_link
from services.slug_utils import slugify
from storage import UPLOAD_DIR
from services.membership_service import ACTIVE_STATUSES, VALID_TYPES, end_self_directory_entry

logger = logging.getLogger("tls.dolibarr.sync")

STATE_ID = "dolibarr_sync_state"
ACTOR = "dolibarr"
MAX_PAGES = 500
FULL_SYNC_HOURS = 24
PENDING_DELAY_SECONDS = 5
PENDING_MAX_ATTEMPTS = 5
AUTO_LINK_RETRY_HOURS = 24

# Dolibarr-Status → Status der Website. `excluded` wird nach außen nicht
# anders gezeigt als `terminated`; der genaue Wert bleibt unter `dolibarr`.
# Der Verlauf steht auch auf „Meine Mitgliedschaft“ - also für das Mitglied geschrieben.
HISTORY_NOTE = "Aus der Mitgliederverwaltung übernommen"
STATUS_MAP = {"draft": "pending", "active": "active", "terminated": "former", "excluded": "former"}
# Mitgliederverzeichnis aus der Einwilligung (#410 Nachtrag): Einträge, die der Abgleich angelegt hat.
DIRECTORY_SOURCE = "dolibarr"
# Website-Profil aus Zusatzfeldern (Vereine 1.2): welche Feldcodes in die Spalten des Verzeichnisses laufen;
# der Verein ändert das unter Dolibarr → Verbindung. Nach dem Update aus 1.1 heißen die Felder genau so.
FIELD_MAP_COLUMNS = ("gamertag", "bio", "games", "platforms")
DEFAULT_FIELD_MAP = {"gamertag": "gamertag", "bio": "bio", "games": "games", "platforms": "platforms"}
CONSENT_WITHDRAWN = "consent_withdrawn"
DIRECTORY_CHANGES = ("created", "activated", "deactivated", "updated", "merged")
DUPLICATE = "duplicate"
# Foto der Mitgliedskarte (#255): als Datei unter den Uploads, benannt nach Profil und Prüfsumme.
PHOTO_PREFIX = "member-photo-"
PHOTO_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}


# ---------------------------------------------------------------- Abbildung

def project_summary(summary: dict, settings: dict) -> dict:
    """Aus einer Zusammenfassung die Felder der Website. Rechnet nichts nach, was Dolibarr schon entschieden hat."""
    type_info = summary.get("type") or {}
    mapped_type = (settings.get("type_map") or {}).get(str(type_info.get("id")))
    if mapped_type not in VALID_TYPES:
        mapped_type = None
    status = STATUS_MAP.get(summary.get("status"), "none")
    if status == "active" and mapped_type == "honorary":
        status = "honorary"
    fee = summary.get("fee") or {}
    return {
        "member_status": status,
        "membership_type": mapped_type,
        "member_number": str(summary.get("ref") or "") or None,
        "member_since": summary.get("member_since") or None,
        "dolibarr": {
            "instance": instance_key(settings),
            "member_id": int(summary["id"]),
            "ref": str(summary.get("ref") or ""),
            "status": summary.get("status"),
            "type": {"id": type_info.get("id"), "label": type_info.get("label")},
            # Eine unbekannte Mitgliedsart wird nie still als „ordentlich“ geführt.
            "type_unmapped": mapped_type is None,
            "paid_until": summary.get("paid_until") or None,
            "membership_ends": summary.get("membership_ends") or None,
            "fee": {
                "required": bool(fee.get("required")),
                "status": fee.get("status"),
                "next_due": fee.get("next_due") or None,
                "amount": fee.get("amount"),
                "currency": summary.get("currency") or "EUR",
                "discount": fee.get("discount") or {"kind": "none", "label": ""},
                "payer": fee.get("payer") or "self",
            },
            "functions": [
                {"code": str(fn.get("code") or ""), "label": str(fn.get("label") or ""), "since": fn.get("since") or None}
                for fn in (summary.get("functions") or []) if fn.get("code")
            ],
            "updated_at": summary.get("updated_at"),
        },
    }


async def apply_summary(db, settings: dict, link: dict, summary: dict) -> str:
    """Stand eines bestätigt zugeordneten Mitglieds schreiben. Liefert `applied`, `unchanged` oder `stale`."""
    user_id = link["user_id"]
    projected = project_summary(summary, settings)
    now = now_utc().isoformat()
    existing = await db.memberships.find_one({"user_id": user_id}, {"_id": 0})
    previous = (existing or {}).get("dolibarr") or {}
    incoming_at = projected["dolibarr"].get("updated_at") or ""
    if previous.get("member_id") == projected["dolibarr"]["member_id"] and previous.get("updated_at") and incoming_at < previous["updated_at"]:
        return "stale"

    projected["dolibarr"]["synced_at"] = now
    update = {
        "member_status": projected["member_status"],
        "membership_type": projected["membership_type"],
        "member_since": projected["member_since"],
        "member_since_precision": "day" if projected["member_since"] else None,
        "source": "dolibarr",
        "dolibarr": projected["dolibarr"],
        "updated_at": now,
        "updated_by": ACTOR,
    }
    number = projected["member_number"]
    if number:
        clash = await db.memberships.find_one({"member_number": number, "user_id": {"$ne": user_id}}, {"_id": 0, "user_id": 1})
        if clash:
            update["dolibarr"]["number_conflict"] = True
        else:
            update["member_number"] = number

    unchanged = bool(existing) and existing.get("source") == "dolibarr" and all(
        existing.get(key) == value for key, value in update.items() if key not in ("updated_at", "dolibarr")
    ) and {k: v for k, v in previous.items() if k != "synced_at"} == {k: v for k, v in update["dolibarr"].items() if k != "synced_at"}

    if existing:
        ops: dict = {"$set": update}
        if existing.get("member_status") != update["member_status"]:
            ops["$push"] = {"history": {
                "actor_id": ACTOR, "at": now, "from_status": existing.get("member_status"),
                "to_status": update["member_status"], "notes": HISTORY_NOTE,
            }}
        await db.memberships.update_one({"user_id": user_id}, ops)
    else:
        await db.memberships.insert_one({
            "id": new_id(), "user_id": user_id, "member_number": None, "internal_role": None, "notes": None,
            "show_member_number_publicly": False, "created_at": now, "created_by": ACTOR,
            "history": [{"actor_id": ACTOR, "at": now, "from_status": None, "to_status": update["member_status"],
                         "notes": HISTORY_NOTE}],
            **update,
        })
    is_member = update["member_status"] in ACTIVE_STATUSES
    await db.users.update_one({"id": user_id}, {"$set": {
        "user_type": "club_member" if is_member else "community_user", "is_club_member": is_member, "updated_at": now,
    }})
    await end_self_directory_entry(user_id, is_member)
    if unchanged:
        return "unchanged"
    try:
        from services.change_events import publish_user_change
        await publish_user_change([user_id], "membership")
    except Exception:  # noqa: BLE001 - der Live-Hinweis darf den Abgleich nie scheitern lassen
        logger.debug("[dolibarr] live hint failed", exc_info=True)
    return "applied"


# ---------------------------------------------------------------- Mitgliederverzeichnis aus der Einwilligung (#410 Nachtrag)

def _full_name(summary: dict) -> str:
    return " ".join(str(part).strip() for part in (summary.get("firstname"), summary.get("lastname")) if part).strip()


async def _unique_directory_slug(db, source: str) -> str:
    base = slugify(source, fallback="mitglied", max_length=60)
    candidate, counter = base, 2
    while await db.club_member_profiles.find_one({"slug": candidate}, {"_id": 1}):
        candidate = f"{base}-{counter}"
        counter += 1
    return candidate


async def _store_member_photo(client: DolibarrClient, member_id: int, photo: dict, profile_id: str) -> str | None:
    """Das Foto der Mitgliedskarte holen, gegen die Prüfsumme prüfen und unter den Uploads ablegen."""
    try:
        data = await client.member_photo(member_id)
    except DolibarrError as exc:
        logger.warning("[dolibarr] Foto von Mitglied %s nicht lesbar: %s", member_id, exc.kind)
        return None
    try:
        content = base64.b64decode(str(data.get("content") or ""), validate=True)
    except (ValueError, binascii.Error):
        return None
    expected = str(photo.get("sha256") or "")
    extension = PHOTO_TYPES.get(str(data.get("content_type") or ""))
    if not content or not extension or hashlib.sha256(content).hexdigest() != expected:
        return None
    name = f"{PHOTO_PREFIX}{profile_id}-{expected[:12]}.{extension}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / name).write_bytes(content)
    return f"/api/static/uploads/{name}"


LEGACY_FIELDS = (("gamertag", "Gamertag", "text", 40), ("bio", "Kurztext", "textarea", 2000), ("games", "Spiele", "text", 255), ("platforms", "Plattformen", "text", 255))


def _legacy_fields(data: dict) -> list[dict]:
    """Vereine 1.1 liefert feste Felder statt `fields` - in die Feldform übersetzt, damit der Abgleich gleich bleibt."""
    fields = []
    for code, label, kind, limit in LEGACY_FIELDS:
        if code not in data:
            continue
        value = data.get(code)
        if isinstance(value, list):
            value = ", ".join(str(v).strip() for v in value if str(v).strip())
        fields.append({"code": code, "label": label, "type": kind, "editable": False, "value": str(value or "").strip() or None, "max_length": limit})
    return fields


async def _member_website_profile(client: DolibarrClient, member_id: int) -> dict | None:
    """Das Website-Profil der Mitgliedskarte - nur mit Einwilligung; ein älteres Modul kennt es nicht."""
    try:
        data = await client.member_profile(member_id)
    except DolibarrError as exc:
        if exc.kind not in ("not_found", "module_off"):
            logger.warning("[dolibarr] Website-Profil von Mitglied %s nicht lesbar: %s", member_id, exc.kind)
        return None
    if not isinstance(data, dict) or not data.get("given"):
        return None
    if "fields" not in data:
        data = {**data, "fields": _legacy_fields(data)}
    return data


async def _apply_dolibarr_profile(db, client: DolibarrClient, profile: dict, member_id: int, data: dict | None = None) -> bool:
    """Was der Verein in Dolibarr am Website-Profil pflegt (Gamertag, Kurztext, Spiele, Plattformen, Foto),
    führt; was dort leer ist, lässt den Stand der Website stehen. Liefert True, wenn sich etwas geändert hat."""
    if data is None:
        data = await _member_website_profile(client, member_id)
    if not data:
        return False
    update: dict = {}
    fields = [f for f in (data.get("fields") or []) if isinstance(f, dict) and f.get("code")]
    field_map = await directory_field_map(db)
    by_code = {str(f["code"]): f for f in fields}
    for column, limit in (("gamertag", 40), ("bio", 2000)):
        field = by_code.get(field_map.get(column) or "")
        value = _field_text(field)[:limit] if field else ""
        if value and value != (profile.get(column) or ""):
            update[column] = value
    for column in ("games", "platforms"):
        field = by_code.get(field_map.get(column) or "")
        values = _field_list(field)[:20] if field else []
        if values and values != (profile.get(column) or []):
            update[column] = values
    mapped = {code for code in field_map.values() if code}
    extra = [{"code": str(f["code"]), "label": str(f.get("label") or f["code"]), "value": _field_text(f)} for f in fields if str(f["code"]) not in mapped and _field_text(f)]
    if extra != (profile.get("extra_fields") or []):
        update["extra_fields"] = extra
    if fields:
        await _remember_website_fields(db, fields)
    photo = data.get("photo") if isinstance(data.get("photo"), dict) else None
    if photo and photo.get("sha256") and photo.get("sha256") != profile.get("dolibarr_photo_sha"):
        url = await _store_member_photo(client, member_id, photo, profile["id"])
        if url:
            update.update({"photo_url": url, "dolibarr_photo_sha": photo["sha256"]})
    if not update:
        return False
    update.update({"dolibarr_profile_at": now_utc().isoformat(), "updated_at": now_utc().isoformat(), "updated_by": ACTOR})
    await db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": update})
    profile.update(update)
    return True


async def directory_field_map(db) -> dict:
    settings = await db.settings.find_one({"id": "dolibarr"}, {"_id": 0, "directory_field_map": 1}) or {}
    chosen = {k: str(v or "").strip() for k, v in (settings.get("directory_field_map") or {}).items() if k in FIELD_MAP_COLUMNS}
    return {**DEFAULT_FIELD_MAP, **chosen}


def _option_label(field: dict, code) -> str:
    for option in field.get("options") or []:
        if isinstance(option, dict) and str(option.get("code")) == str(code):
            return str(option.get("label") or code)
    return str(code)


def _field_text(field: dict | None) -> str:
    """Der Wert eines Zusatzfelds als Text - so, wie er auf der Website stehen kann."""
    if not field:
        return ""
    value = field.get("value")
    if value is None or value == "" or value == []:
        return ""
    kind = field.get("type")
    if kind == "boolean":
        return "Ja" if value else "Nein"
    if kind == "multi" and isinstance(value, list):
        return ", ".join(_option_label(field, v) for v in value)
    if kind == "select":
        return _option_label(field, value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _field_list(field: dict | None) -> list[str]:
    """Ein Zusatzfeld als Liste: Mehrfachauswahl über die Bezeichnungen, Text getrennt an Komma/Strichpunkt/Zeile."""
    if not field:
        return []
    value = field.get("value")
    if field.get("type") == "multi" and isinstance(value, list):
        return [_option_label(field, v) for v in value if str(v).strip()]
    return [part.strip() for part in re.split(r"[,;\n]+", _field_text(field)) if part.strip()]


async def _website_gamertag(db, website: dict | None) -> str:
    """Der Gamertag aus dem Website-Profil des Moduls - das Feld, das der Verein der Spalte zugeordnet hat."""
    if not website:
        return ""
    code = (await directory_field_map(db)).get("gamertag") or ""
    field = next((f for f in website.get("fields") or [] if isinstance(f, dict) and str(f.get("code")) == code), None)
    return _field_text(field)[:40]


async def _remember_website_fields(db, fields: list[dict]) -> None:
    """Welche Felder das Modul fürs Website-Profil kennt - für die Zuordnung im Admin, ohne Werte."""
    catalog = [{"code": str(f["code"]), "label": str(f.get("label") or f["code"]), "type": str(f.get("type") or "text")} for f in fields]
    state = await sync_state(db)
    if state.get("website_profile_fields") != catalog:
        await _save_state(db, {"website_profile_fields": catalog})


def _norm(value) -> str:
    """Namen vergleichbar machen: Kleinbuchstaben, nur Buchstaben und Ziffern."""
    return "".join(ch for ch in str(value or "").casefold() if ch.isalnum())


async def _find_directory_profile(db, member_id: int, user_id: str | None, name: str, gamertags: list[str], *, fuzzy: bool):
    """Das bestehende Profil dieses Mitglieds (#504): Mitgliedsnummer, dann Konto, dann Gamertag/Slug, dann
    Klarname. Treffen mehrere, führt das von Hand gepflegte; vom Abgleich angelegte Doppelte kommen als Liste
    zurück und werden zusammengeführt. Ohne `fuzzy` (keine Einwilligung) zählen nur Nummer und Konto."""
    matches: list[dict] = []
    found = await db.club_member_profiles.find_one({"dolibarr_member_id": member_id}, {"_id": 0})
    if found:
        matches.append(found)
    keys = {slugify(str(g), fallback="", max_length=60) for g in gamertags if str(g or "").strip()}
    keys.discard("")
    wanted = _norm(name) if len(str(name or "").split()) >= 2 else ""
    async for row in db.club_member_profiles.find({"dolibarr_member_id": {"$ne": member_id}}, {"_id": 0}):
        if row.get("dolibarr_member_id") or row.get("deactivated_reason") == DUPLICATE:
            continue  # gehört einem anderen Mitglied oder ist schon als Doppel erkannt
        if user_id and row.get("user_id") == user_id:
            matches.append(row)
            continue
        if not fuzzy or (row.get("user_id") and user_id and row.get("user_id") != user_id):
            continue  # ein anderes Konto hängt dran - dann entscheidet kein Name
        if keys and (slugify(str(row.get("gamertag") or ""), fallback="", max_length=60) in keys or row.get("slug") in keys):
            matches.append(row)
            continue
        if wanted and wanted in (_norm(row.get("real_name")), _norm(row.get("dolibarr_name")), _norm(row.get("display_name"))):
            matches.append(row)
    seen: set[str] = set()
    unique = [m for m in matches if not (m["id"] in seen or seen.add(m["id"]))]
    if not unique:
        return None, []
    unique.sort(key=lambda m: (m.get("source") == DIRECTORY_SOURCE, str(m.get("created_at") or "")))
    primary = unique[0]
    return primary, [m for m in unique[1:] if m.get("source") == DIRECTORY_SOURCE]


async def _merge_duplicate_profile(db, primary: dict, dup: dict) -> None:
    """Ein vom Abgleich angelegtes Doppel geht im gepflegten Profil auf (#504): Einwilligung, Mitgliedsnummer
    und Dolibarr-Stand ziehen um, Foto/Kurztext/Spiele nur, wo das gepflegte Profil leer ist; Verweise
    (Vorstand, Referenzen) hängen um. Nie von Hand bearbeitet → weg, sonst offline mit Grund `duplicate`."""
    now = now_utc().isoformat()
    update: dict = {}
    for key in ("consent", "dolibarr_member_id", "dolibarr_name", "dolibarr_profile_at", "dolibarr_photo_sha", "user_id",
                "photo_url", "bio", "games", "platforms", "gamertag"):
        if dup.get(key) not in (None, "", []) and primary.get(key) in (None, "", []):
            update[key] = dup[key]
    if update:
        update.update({"updated_at": now, "updated_by": ACTOR})
        await db.club_member_profiles.update_one({"id": primary["id"]}, {"$set": update})
        primary.update(update)
    await db.board_positions.update_many({"user_id": dup["id"]}, {"$set": {"user_id": primary["id"]}})
    async for ref in db.references.find({"member_profile_ids": dup["id"]}, {"_id": 0, "id": 1, "member_profile_ids": 1}):
        ids = [primary["id"] if v == dup["id"] else v for v in ref.get("member_profile_ids") or []]
        await db.references.update_one({"id": ref["id"]}, {"$set": {"member_profile_ids": list(dict.fromkeys(ids))}})
    untouched = dup.get("created_by") == ACTOR and dup.get("updated_by") == ACTOR
    if untouched:
        await db.club_member_profiles.delete_one({"id": dup["id"]})
    else:
        await db.club_member_profiles.update_one({"id": dup["id"]}, {"$set": {
            "is_active": False, "deactivated_reason": DUPLICATE, "dolibarr_member_id": None, "updated_at": now, "updated_by": ACTOR}})
    logger.info("[dolibarr] Verzeichnis: Doppel %s in %s zusammengeführt (%s)", dup["id"], primary["id"], "entfernt" if untouched else "offline")


async def sync_directory_entry(db, settings: dict, client: DolibarrClient, link: dict | None, summary: dict) -> str:
    """Ein Eintrag im Mitgliederverzeichnis folgt der Einwilligung in Dolibarr (Code `directory_consent_code`):
    „given“ legt ihn an oder schaltet ihn frei - Name aus der Mitgliederverwaltung, Foto und Spiele vom Konto,
    alles Weitere pflegt der Vorstand und bleibt beim nächsten Abgleich stehen. Der Klarname folgt der
    Mitgliederverwaltung nur, solange der Vorstand ihn nicht selbst geändert hat (etwa nur der Vorname, wenn
    der Nachname nicht öffentlich stehen soll); leer heißt wieder aus Dolibarr. „withdrawn“ nimmt ihn
    offline, auch einen Eintrag, den das Mitglied selbst angelegt hat. Ohne Code passiert nichts.
    Ist auf der Website kein Code gewählt, gilt der, den das Modul für das Website-Profil nennt. Mit
    Einwilligung führt außerdem, was der Verein in Dolibarr am Website-Profil pflegt (#255).
    Ein Website-Konto ist keine Voraussetzung (#505): ohne Zuordnung (`link` None) entsteht das Profil aus
    der Vereinsakte allein. Ein bestehendes Profil wird gefunden, nie verdoppelt (#504).
    Liefert `created|activated|deactivated|updated|merged|unchanged|skipped`."""
    if settings.get("mode") != "live":
        return "skipped"
    code = str(settings.get("directory_consent_code") or "").strip()
    if not code:
        code = str((await sync_state(db)).get("website_profile_consent") or "").strip()
    if not code:
        return "skipped"
    try:
        rows = await client.member_consents(int(summary["id"]))
    except DolibarrError as exc:
        logger.warning("[dolibarr] Einwilligungen von Mitglied %s nicht lesbar: %s", summary.get("id"), exc.kind)
        return "skipped"
    consent = next((row for row in rows if isinstance(row, dict) and row.get("code") == code), None)
    state = str((consent or {}).get("state") or "none")
    consent_info = {"code": code, "state": state, "version": (consent or {}).get("version"), "moment": (consent or {}).get("moment")}
    member_id = int(summary["id"])
    user_id = link["user_id"] if link else None
    now = now_utc().isoformat()
    active_member = summary.get("status") == "active"
    name = _full_name(summary)
    listed = state == "given" and active_member
    website = await _member_website_profile(client, member_id) if listed else None
    website_gamertag = await _website_gamertag(db, website)
    user = (await db.users.find_one({"id": user_id}, {"_id": 0, "username": 1, "display_name": 1, "avatar_url": 1, "favorite_games": 1,
                                     "main_platforms": 1, "gender": 1}) if user_id else None) or {}
    profile, duplicates = await _find_directory_profile(db, member_id, user_id, name, [website_gamertag, user.get("username") or ""], fuzzy=listed)
    for dup in duplicates:
        await _merge_duplicate_profile(db, profile, dup)
    merged = bool(duplicates)
    claim: dict = {}
    if profile is not None:
        if profile.get("dolibarr_member_id") != member_id:
            claim["dolibarr_member_id"] = member_id
        if user_id and not profile.get("user_id"):
            claim["user_id"] = user_id

    if listed:
        if profile is None:
            display_name = name or str(user.get("display_name") or user.get("username") or "Mitglied").strip()
            gamertag = str(website_gamertag or user.get("username") or "").strip()[:40] or None
            doc = {
                "id": new_id(), "display_name": display_name, "gamertag": gamertag, "real_name": name or None,
                "slug": await _unique_directory_slug(db, gamertag or display_name),
                "role_title": None, "photo_url": user.get("avatar_url") or None, "cover_url": None, "bio": "", "birth_date": None,
                "gender": user.get("gender") if user.get("gender") in ("male", "female", "diverse") else None,
                "games": [str(g).strip() for g in (user.get("favorite_games") or []) if str(g).strip()][:20],
                "platforms": [str(p).strip() for p in (user.get("main_platforms") or []) if str(p).strip()][:20],
                "user_id": user_id, "dolibarr_member_id": member_id, "order_index": 0, "is_active": True, "source": DIRECTORY_SOURCE,
                "consent": consent_info, "dolibarr_name": name or None,
                "created_at": now, "created_by": ACTOR, "updated_at": now, "updated_by": ACTOR,
            }
            await db.club_member_profiles.insert_one(doc)
            logger.info("[dolibarr] Verzeichnis-Eintrag angelegt für Mitglied %s%s", member_id, "" if user_id else " (ohne Konto)")
            await _apply_dolibarr_profile(db, client, doc, member_id, website)
            return "created"
        update: dict = {"consent": consent_info, **claim}
        previous_name = profile.get("dolibarr_name")
        if name and name != previous_name:
            update["dolibarr_name"] = name
        overridden = bool(profile.get("real_name")) and profile.get("real_name") != previous_name
        if name and profile.get("real_name") != name and not overridden:
            update["real_name"] = name  # der Klarname folgt Dolibarr, solange der Vorstand ihn nicht selbst gesetzt hat
        reactivate = (not profile.get("is_active", True) and not profile.get("directory_blocked")
                      and (profile.get("deactivated_reason") == CONSENT_WITHDRAWN or profile.get("source") == DIRECTORY_SOURCE))
        if reactivate:
            update.update({"is_active": True, "deactivated_reason": None})
        changed = await _apply_dolibarr_profile(db, client, profile, member_id, website)
        if (profile.get("consent") or {}) == consent_info and not {k: v for k, v in update.items() if k != "consent"}:
            return "merged" if merged else ("updated" if changed else "unchanged")
        update.update({"updated_at": now, "updated_by": ACTOR})
        await db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": update})
        return "activated" if reactivate else ("merged" if merged else ("updated" if changed or claim else "unchanged"))

    if profile is None:
        return "unchanged"
    goes_offline = profile.get("is_active", True) and (state == "withdrawn" or profile.get("source") == DIRECTORY_SOURCE)
    update = {"consent": consent_info, **claim}
    if goes_offline:
        update.update({"is_active": False, "deactivated_reason": CONSENT_WITHDRAWN if state == "withdrawn" or active_member else "membership_ended"})
    if (profile.get("consent") or {}) == consent_info and not goes_offline and not claim:
        return "unchanged"
    update.update({"updated_at": now, "updated_by": ACTOR})
    await db.club_member_profiles.update_one({"id": profile["id"]}, {"$set": update})
    return "deactivated" if goes_offline else "unchanged"


async def end_membership_of_gone_member(db, link: dict) -> None:
    """Das Mitglied gibt es in Dolibarr nicht mehr (404 beim direkten Lesen)."""
    now = now_utc().isoformat()
    existing = await db.memberships.find_one({"user_id": link["user_id"]}, {"_id": 0, "member_status": 1})
    if existing:
        await db.memberships.update_one({"user_id": link["user_id"]}, {
            "$set": {"member_status": "former", "dolibarr.status": "deleted", "dolibarr.functions": [],
                     "dolibarr.synced_at": now, "updated_at": now, "updated_by": ACTOR},
            "$push": {"history": {"actor_id": ACTOR, "at": now, "from_status": existing.get("member_status"),
                                  "to_status": "former", "notes": HISTORY_NOTE}},
        })
    await db.users.update_one({"id": link["user_id"]}, {"$set": {"user_type": "community_user", "is_club_member": False, "updated_at": now}})
    await end_self_directory_entry(link["user_id"], False)
    await close_link(db, link, status="gone", actor_id=ACTOR, note="in Dolibarr nicht mehr vorhanden")


# ---------------------------------------------------------------- Stand des Abgleichs

async def sync_state(db=None) -> dict:
    db = db if db is not None else get_db()
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0, "id": 0}) or {}


async def _save_state(db, fields: dict) -> None:
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, **fields}}, upsert=True)


def _hours_since(value: str | None) -> float | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0.0, (now_utc() - parsed).total_seconds() / 3600)


# ---------------------------------------------------------------- Abgleich

async def run_sync(db=None, *, full: bool | None = None) -> dict:
    """Ein Lauf. `full=None` entscheidet selbst: einmal am Tag alles, sonst nur Geändertes."""
    db = db if db is not None else get_db()
    settings = await load_settings(db)
    if settings["mode"] == "off":
        return {"ok": False, "skipped": "off"}
    state = await sync_state(db)
    if full is None:
        age = _hours_since(state.get("last_full_at"))
        full = age is None or age >= FULL_SYNC_HOURS or not state.get("cursor")
    started = now_utc().isoformat()
    counts = {"seen": 0, "applied": 0, "unchanged": 0, "stale": 0, "unlinked": 0, "gone": 0, "directory": 0}
    live = settings["mode"] == "live"
    try:
        client = DolibarrClient(settings)
        status = await client.status()
        # Website-Profil (#255): die Einwilligung, die das Modul dafür nennt, gleich merken - der Verzeichnis-Abgleich
        # in diesem Lauf greift darauf zurück, wenn auf der Website kein eigener Code gewählt ist.
        await _save_state(db, {"website_profile_consent": str(status.get("website_profile_consent") or "")})
        cursor = None if full else state.get("cursor")
        seen_ids: set[int] = set()
        page = 0
        while True:
            rows = await client.members_page(page=page, changed_since=cursor)
            if not rows:
                break
            for summary in rows:
                counts["seen"] += 1
                seen_ids.add(int(summary["id"]))
                link = await verified_link_for_member(db, settings, int(summary["id"]))
                if not link:
                    counts["unlinked"] += 1
                if live:
                    if link:
                        counts[await apply_summary(db, settings, link, summary)] += 1
                    # Das Verzeichnis braucht kein Website-Konto (#505): die Einwilligung allein zählt.
                    if await sync_directory_entry(db, settings, client, link, summary) in DIRECTORY_CHANGES:
                        counts["directory"] += 1
            page += 1
            if page >= MAX_PAGES:
                raise DolibarrError("invalid_response")
        if full and live:
            # Erst nach einem vollständigen Lauf, und jedes Fehlen einzeln nachgelesen.
            async for link in db.dolibarr_links.find({"instance": instance_key(settings), "status": "verified"}, {"_id": 0}):
                if link.get("member_id") in seen_ids:
                    continue
                try:
                    summary = await client.member_summary(link["member_id"])
                except DolibarrError as exc:
                    if exc.kind == "not_found":
                        await end_membership_of_gone_member(db, link)
                        counts["gone"] += 1
                    continue
                counts[await apply_summary(db, settings, link, summary)] += 1
                if await sync_directory_entry(db, settings, client, link, summary) in DIRECTORY_CHANGES:
                    counts["directory"] += 1
    except DolibarrError as exc:
        await _save_state(db, {"last_run_at": started, "ok": False, "last_error": {"kind": exc.kind, "status": exc.status, "text": exc.text, "at": started}})
        return {"ok": False, "error": exc.kind, "text": exc.text, "status": exc.status}

    fields = {
        "last_run_at": started, "last_ok_at": now_utc().isoformat(), "ok": True, "last_error": None,
        "cursor": status.get("server_time"), "counts": counts, "was_full": bool(full), "applied_live": live,
        "module_version": status.get("module_version"), "api_version": status.get("api_version"),
        "capabilities": capabilities_for(status),
        # Website-Profil (#255): welche Einwilligung das Modul dafür nennt - Rückfall für das Verzeichnis.
        "website_profile_consent": str(status.get("website_profile_consent") or ""),
    }
    if full:
        fields["last_full_at"] = fields["last_ok_at"]
    await _save_state(db, fields)
    return {"ok": True, "full": bool(full), "live": live, **counts}


# ---------------------------------------------------------------- Webhook: Anlass zum Nachlesen

async def queue_member(db, settings: dict, member_id: int) -> None:
    """Das Ereignis selbst trägt keinen Stand - es ist nur der Anlass, gleich nachzulesen."""
    due = (now_utc() + timedelta(seconds=PENDING_DELAY_SECONDS)).isoformat()
    await db.dolibarr_pending.update_one(
        {"key": f"{instance_key(settings)}:{int(member_id)}"},
        {"$set": {"member_id": int(member_id), "instance": instance_key(settings), "due_at": due},
         "$setOnInsert": {"attempts": 0, "created_at": now_utc().isoformat()}},
        upsert=True,
    )


async def process_pending(db=None) -> dict:
    db = db if db is not None else get_db()
    settings = await load_settings(db)
    if settings["mode"] != "live":
        return {"ok": False, "skipped": settings["mode"]}
    due = await db.dolibarr_pending.find({"instance": instance_key(settings), "due_at": {"$lte": now_utc().isoformat()}}, {"_id": 0}).to_list(50)
    if not due:
        return {"ok": True, "processed": 0}
    processed = 0
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "error": exc.kind}
    for entry in due:
        link = await verified_link_for_member(db, settings, entry["member_id"])
        try:
            summary = await client.member_summary(entry["member_id"])
        except DolibarrError as exc:
            if exc.kind == "not_found":
                if link:
                    await end_membership_of_gone_member(db, link)
                await db.dolibarr_pending.delete_one({"key": entry["key"]})
            elif entry.get("attempts", 0) + 1 >= PENDING_MAX_ATTEMPTS:
                # Der regelmäßige Abgleich holt es nach.
                await db.dolibarr_pending.delete_one({"key": entry["key"]})
            else:
                retry = (now_utc() + timedelta(seconds=30 * (entry.get("attempts", 0) + 1))).isoformat()
                await db.dolibarr_pending.update_one({"key": entry["key"]}, {"$set": {"due_at": retry}, "$inc": {"attempts": 1}})
            continue
        if link:
            await apply_summary(db, settings, link, summary)
        await sync_directory_entry(db, settings, client, link, summary)  # auch ohne Zuordnung (#505)
        await db.dolibarr_pending.delete_one({"key": entry["key"]})
        processed += 1
    return {"ok": True, "processed": processed}


# ---------------------------------------------------------------- Zuordnung über die bestätigte E-Mail

async def try_auto_link(db, settings: dict, user: dict) -> dict | None:
    """Nur wenn der Betreiber es eingeschaltet hat: bestätigte E-Mail, genau ein Treffer, niemand sonst zugeordnet."""
    if settings["mode"] == "off" or not settings.get("auto_link_verified_email"):
        return None
    if user.get("email_verified") is not True or not user.get("email"):
        return None
    existing = await db.dolibarr_links.find_one({"user_id": user["id"], "instance": instance_key(settings)}, {"_id": 0})
    if existing:
        if existing.get("status") in ("verified", "revoked", "requested"):
            return existing
        age = _hours_since(existing.get("updated_at"))
        if age is not None and age < AUTO_LINK_RETRY_HOURS:
            return existing
    try:
        summary = await DolibarrClient(settings).lookup_by_email(user["email"])
    except DolibarrError as exc:
        if exc.kind == "conflict":
            return await note_candidate(db, settings, user_id=user["id"], member_id=None, member_ref=None, source="email_match",
                                        status="conflict", note="mehrere Mitglieder teilen sich diese E-Mail-Adresse")
        if exc.kind == "not_found":
            return await note_candidate(db, settings, user_id=user["id"], member_id=None, member_ref=None, source="email_match",
                                        status="candidate", note="kein Mitglied mit dieser E-Mail-Adresse")
        return existing
    if summary.get("status") == "draft":
        return await note_candidate(db, settings, user_id=user["id"], member_id=summary["id"], member_ref=summary.get("ref"),
                                    source="email_match", status="candidate", note="Mitglied ist in Dolibarr noch ein Entwurf")
    from services.dolibarr_links import LinkConflict
    try:
        link = await verify_link(db, settings, user_id=user["id"], member_id=summary["id"], member_ref=summary.get("ref"),
                                 source="email_match", actor_id=None)
    except LinkConflict as exc:
        return await note_candidate(db, settings, user_id=user["id"], member_id=summary["id"], member_ref=summary.get("ref"),
                                    source="email_match", status="conflict", note=str(exc))
    if settings["mode"] == "live":
        await apply_summary(db, settings, link, summary)
    return link


# ---------------------------------------------------------------- Vorschau der Umstellung (#330)

async def migration_preview(db=None, *, max_users: int = 500) -> dict:
    """Trockenlauf: wer würde wem zugeordnet, wo hakt es. Schreibt nichts."""
    db = db if db is not None else get_db()
    settings = await load_settings(db)
    client = DolibarrClient(settings)
    members: dict[int, dict] = {}
    page = 0
    while page < MAX_PAGES:
        rows = await client.members_page(page=page)
        if not rows:
            break
        for summary in rows:
            members[int(summary["id"])] = summary
        page += 1

    local = {m["user_id"]: m async for m in db.memberships.find({}, {"_id": 0, "user_id": 1, "member_status": 1, "member_number": 1, "source": 1})}
    links = {l["user_id"]: l async for l in db.dolibarr_links.find({"instance": instance_key(settings)}, {"_id": 0})}
    users = await db.users.find(
        {"is_active": True, "email": {"$nin": [None, ""]}},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1, "email": 1, "email_verified": 1},
    ).sort("username", 1).to_list(max_users)

    rows = []
    matched_members: dict[int, list[str]] = {}
    for user in users:
        link = links.get(user["id"])
        membership = local.get(user["id"]) or {}
        is_local_member = membership.get("member_status") in ACTIVE_STATUSES
        if link and link.get("status") == "verified":
            summary = members.get(link.get("member_id"))
            rows.append(_preview_row(user, membership, "linked", summary, link=link))
            if summary:
                matched_members.setdefault(int(summary["id"]), []).append(user["id"])
            continue
        # Auch ein Konto mit unbestätigter E-Mail wird gesucht: Hier bestätigt ein Mensch aus der
        # Vereinsverwaltung, und der darf den Treffer sehen. Von selbst zugeordnet wird so ein
        # Konto nie (try_auto_link verlangt die bestätigte E-Mail).
        verified_email = user.get("email_verified") is True
        try:
            summary = await client.lookup_by_email(user["email"])
        except DolibarrError as exc:
            if exc.kind == "conflict":
                rows.append(_preview_row(user, membership, "shared_email", None, link=link))
            elif exc.kind in ("not_found", "bad_request"):
                if is_local_member or link:
                    rows.append(_preview_row(user, membership, "not_in_dolibarr", None, link=link))
            else:
                raise
            continue
        matched_members.setdefault(int(summary["id"]), []).append(user["id"])
        rows.append(_preview_row(user, membership, "match" if verified_email else "match_unverified_email", summary, link=link))

    for row in rows:
        if row["member_id"] and len(matched_members.get(row["member_id"], [])) > 1:
            row["state"] = "member_claimed_twice"
    # Wer in Dolibarr steht und hier kein Konto hat - beendete Mitgliedschaften getrennt
    # ausgewiesen, damit niemand Ehemalige für Mitglieder hält. Zugleich die Auswahl für
    # das Zuordnen von Hand.
    without_account = [
        {"member_id": mid, "ref": s.get("ref"), "name": _member_name(s), "status": s.get("status"),
         "ended": s.get("status") in ("terminated", "excluded")}
        for mid, s in sorted(members.items()) if mid not in matched_members and s.get("status") != "draft"
    ]
    type_map = settings.get("type_map") or {}
    types = {}
    for summary in members.values():
        info = summary.get("type") or {}
        key = str(info.get("id"))
        types.setdefault(key, {"id": info.get("id"), "label": info.get("label"), "members": 0, "mapped_to": type_map.get(key)})
        types[key]["members"] += 1
    codes: dict[str, dict] = {}
    for summary in members.values():
        for fn in summary.get("functions") or []:
            entry = codes.setdefault(fn.get("code"), {"code": fn.get("code"), "label": fn.get("label"), "holders": 0})
            entry["holders"] += 1
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["state"]] = counts.get(row["state"], 0) + 1
    return {
        "at": now_utc().isoformat(), "mode": settings["mode"], "members_in_dolibarr": len(members),
        "rows": rows, "counts": counts, "members_without_account": without_account,
        "types": sorted(types.values(), key=lambda t: str(t["label"])), "function_codes": sorted(codes.values(), key=lambda c: str(c["code"])),
        "users_checked": len(users), "users_limit_reached": len(users) >= max_users,
    }


def _member_name(summary: dict | None) -> str:
    if not summary:
        return ""
    return summary.get("company") or " ".join(part for part in (summary.get("firstname"), summary.get("lastname")) if part)


def _preview_row(user: dict, membership: dict, state: str, summary: dict | None, *, link: dict | None) -> dict:
    projected_status = STATUS_MAP.get((summary or {}).get("status")) if summary else None
    return {
        "user_id": user["id"], "username": user.get("username"), "display_name": user.get("display_name"),
        "state": state, "link_status": (link or {}).get("status"),
        "requested_ref": (link or {}).get("member_ref") if (link or {}).get("status") == "requested" else None,
        "local_status": membership.get("member_status") or "none",
        "member_id": int(summary["id"]) if summary else None,
        "member_ref": (summary or {}).get("ref"), "member_name": _member_name(summary),
        "dolibarr_status": (summary or {}).get("status"),
        "would_change_status": bool(summary) and projected_status != (membership.get("member_status") or "none")
                               and not (projected_status == "active" and membership.get("member_status") == "honorary"),
    }
