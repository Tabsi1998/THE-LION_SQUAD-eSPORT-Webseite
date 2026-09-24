"""Dolibarr-Anbindung (#316, #295, #297, #330): Verwaltung, Zuordnungen, Webhook.

Wer was sieht:
- **System** (Club-Admin, Superadmin): Verbindung und API-Schlüssel. Der
  Schlüssel kommt nie zurück, nur „gespeichert“.
- **Vereinsverwaltung**: Stand des Abgleichs, Zuordnungen Konto ↔ Mitglied,
  Vorschau der Umstellung. Das sind Mitgliederdaten - die Redaktion und die
  Turnierleitung sehen nichts davon.
- **Superadmin**: die Freigabe „Funktion → Bereich“, weil sie Rechte vergibt.
- Die betroffene Person: den eigenen Stand unter `/api/membership/me`.
"""
from __future__ import annotations

import re

import hmac
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user, require_area, require_super
from database import get_db
from models import new_id, now_utc
from services.dolibarr_billing import DEFAULT_MODE_CODE, DEFAULT_TAX_RATES, DEFAULT_TERM_CODE, TERM_FIELDS, tax_confirmed, tax_rate_for, terms_complete
from services.dolibarr_client import (
    ENVIRONMENTS, MODES, SETTINGS_ID, DolibarrClient, DolibarrError, capabilities_for, clean_base_url, load_settings,
    write_capable,
)
from services.dolibarr_links import OPEN_STATUSES, LinkConflict, close_link, link_for_user, note_candidate, verify_link
from services.dolibarr_policy import DERIVABLE_AREAS, areas_from_functions, clean_policy_map, policy_active
from services.dolibarr_sync import DEFAULT_FIELD_MAP, FIELD_MAP_COLUMNS, apply_summary, migration_preview, queue_member, run_sync, sync_state
from services.membership_service import VALID_TYPES
from services.rate_limit import enforce_rate_limit
from services.secret_store import decrypt_secret, encrypt_secret, secret_is_configured

admin_router = APIRouter(prefix="/api/admin/dolibarr", tags=["dolibarr-admin"])
public_router = APIRouter(prefix="/api/integrations/dolibarr", tags=["dolibarr"])
member_router = APIRouter(prefix="/api/membership/dolibarr", tags=["membership"])


async def _audit(actor_id: str | None, action: str, target_id: str, data: dict | None = None):
    await get_db().audit_logs.insert_one({
        "id": new_id(), "action": action, "actor_id": actor_id, "target_id": target_id,
        "data": data or {}, "created_at": now_utc().isoformat(),
    })


def _error(exc: DolibarrError) -> HTTPException:
    return HTTPException(502, f"Dolibarr: {exc.text}")


# ---------------------------------------------------------------- Stand (Vereinsverwaltung und System)

async def _features(db, settings: dict) -> list[dict]:
    """Was Dolibarr auf der Website übernimmt - je Funktion: an oder aus, und wo der Schalter liegt.
    Der Betreiber wollte das an einer Stelle sehen, weil die Schalter über mehrere Seiten verteilt sind."""
    from services import club_facts, dolibarr_sponsors
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1}) or {}
    source = await dolibarr_sponsors.load_source_settings(db)
    facts = await club_facts.snapshot(db)
    mode = settings.get("mode") or "off"
    live = mode == "live"
    connection = "/admin/dolibarr?tab=connection"
    # Mitgliederverzeichnis aus der Einwilligung (#410 Nachtrag): eigener Code oder der des Moduls fürs Website-Profil.
    directory_code = str(settings.get("directory_consent_code") or (await sync_state(db)).get("website_profile_consent") or "").strip()
    directory_entries = await db.club_member_profiles.count_documents({"source": "dolibarr"})
    # Ohne Website-Konto (#505): die Karte kommt aus der Vereinsakte allein, das Konto verknüpft der Vorstand später.
    directory_without_account = await db.club_member_profiles.count_documents({"source": "dolibarr", "user_id": None})
    facts_state = "an" if branding.get("legal_from_dolibarr") else "aus"
    if facts.get("fetched_at"):
        facts_state += f" · Stand {str(facts['fetched_at'])[:16].replace('T', ' ')}"
    elif mode != "off":
        facts_state += " · noch nie gelesen (Rechtliches → „Jetzt nachlesen“)"
    mode_state = {"live": "Modus Live", "preview": "Modus Vorschau (liest, übernimmt nichts)", "off": "aus"}.get(mode, mode)
    return [
        {"key": "members", "label": "Mitgliedschaft, Beitrag und Funktionen aus Dolibarr", "enabled": live, "state": mode_state,
         "hint": "Gilt für Konten mit bestätigter Zuordnung (Reiter Zuordnungen und Umstellung).", "where": connection, "where_label": "Verbindung → Modus"},
        {"key": "club_facts", "label": "Vereinsdaten, Obmann und Vorstand aus Dolibarr", "enabled": bool(branding.get("legal_from_dolibarr")), "state": facts_state,
         "hint": "Impressum, Kontakt, Datenschutz, „Über uns“ und die Vorstandsseite nehmen Name, ZVR, Anschrift, Telefon, Obmann und die Vorstandsfunktionen aus dem Vereinsmodul (stündlich); Namen nur mit Einwilligung.",
         "where": "/admin/club", "where_label": "Verein → Vereinsdaten"},
        {"key": "sponsors", "label": "Sponsoren und Partner aus Dolibarr", "enabled": bool(source.get("from_dolibarr")), "state": "an" if source.get("from_dolibarr") else "aus",
         "hint": "Geschäftspartner in den Kategorien Sponsor und Partner; Unterkategorie = Stufe, Zusatzfelder = Laufzeit. Ehemalige rutschen von selbst nach unten.",
         "where": "/admin/sponsors", "where_label": "Verein → Sponsoren"},
        {"key": "applications", "label": "Beitrittsanträge nach Dolibarr", "enabled": live and bool(settings.get("applications_enabled")),
         "state": "an" if live and settings.get("applications_enabled") else ("Haken gesetzt, wirkt erst im Modus Live" if settings.get("applications_enabled") else "aus"),
         "hint": "Braucht in Dolibarr das API-Recht „Beitrittsanträge über die API anlegen“ und die Pflichtfelder unter Einrichtung › Vereine › Mitgliedsantrag.",
         "where": connection, "where_label": "Verbindung → Beitrittsanträge"},
        {"key": "consents", "label": "Einwilligungen unter „Meine Mitgliedschaft“", "enabled": live, "state": "an (Modus Live)" if live else "erst im Modus Live",
         "hint": "Läuft von selbst mit Vereinsmodul ab 0.8.0; das API-Recht für Beitrittsanträge deckt es mit ab.",
         "where": connection, "where_label": "Verbindung → Modus"},
        {"key": "directory", "label": "Mitgliederverzeichnis und Profile aus Dolibarr", "enabled": live and bool(directory_code),
         "state": (f"Einwilligung „{directory_code}“{' (aus dem Modul)' if directory_code and not settings.get('directory_consent_code') else ''} · "
                   f"{directory_entries} Einträge aus Dolibarr" + (f", davon {directory_without_account} ohne Konto" if directory_without_account else "")) if live and directory_code else ("erst im Modus Live" if directory_code else "aus (keine Einwilligung gewählt)"),
         "hint": "Wer in Dolibarr dieser Einwilligung zugestimmt hat, bekommt sein Vereinsprofil von selbst; Gamertag, Kurztext, Spiele und Foto kommen von der Mitgliedskarte (Reiter Verein), wenn sie dort gepflegt sind. Widerruf nimmt den Eintrag offline.",
         "where": connection, "where_label": "Verbindung → Mitgliederverzeichnis"},
        {"key": "invoices", "label": "Rechnungen und Geschäftspartner in Dolibarr anlegen", "enabled": bool(settings.get("write_enabled")), "state": "an" if settings.get("write_enabled") else "aus",
         "hint": "Schreibzugriff einschalten; Belege werden erst mit vollständigen Konditionen und geprüften Steuersätzen von selbst freigegeben.",
         "where": connection, "where_label": "Verbindung → Schreibzugriff"},
        {"key": "webhook", "label": "Benachrichtigung aus Dolibarr (Webhook)", "enabled": secret_is_configured(settings.get("webhook_token")), "state": "eingerichtet" if secret_is_configured(settings.get("webhook_token")) else "aus (Abgleich alle 10 Minuten)",
         "hint": "Optional: Dolibarr meldet Änderungen sofort, sonst holt der Abgleich alle 10 Minuten auf.",
         "where": connection, "where_label": "Verbindung → Webhook"},
    ]


@admin_router.get("/status")
async def dolibarr_status(me: dict = Depends(require_area("club", "system"))):
    db = get_db()
    settings = await load_settings(db)
    state = await sync_state(db)
    links = {}
    async for row in db.dolibarr_links.aggregate([{"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        links[row["_id"]] = row["n"]
    unmapped = await db.memberships.count_documents({"source": "dolibarr", "dolibarr.type_unmapped": True})
    policy = settings.get("function_policy") or {}
    return {
        "mode": settings["mode"],
        "environment": settings["environment"],
        "instance": settings.get("instance") or "",
        "entity": settings.get("entity") or 1,
        "base_url": settings.get("base_url") or "",
        "api_key_configured": secret_is_configured(settings.get("api_key")),
        "write_api_key_configured": secret_is_configured(settings.get("write_api_key")),
        "write_enabled": bool(settings.get("write_enabled")),
        "write_capable": write_capable(settings),
        "invoice_auto_validate": bool(settings.get("invoice_auto_validate")),
        # Steuersätze (#322): was je Profil auf den Beleg käme - und ob das jemand bestätigt hat.
        "tax_rates": {profile: tax_rate_for(settings, profile) for profile in DEFAULT_TAX_RATES},
        "tax_confirmed": {"at": settings.get("tax_confirmed_at"), "by": settings.get("tax_confirmed_by_name")} if settings.get("tax_confirmed_at") else None,
        # Konditionen (#370): ohne die drei bleibt jeder Beleg Entwurf.
        "invoice_terms": {
            "payment_term_id": settings.get("invoice_payment_term_id") or None,
            "payment_mode_id": settings.get("invoice_payment_mode_id") or None,
            "bank_account_id": settings.get("invoice_bank_account_id") or None,
            "complete": terms_complete(settings),
        },
        "webhook_configured": secret_is_configured(settings.get("webhook_token")),
        "auto_link_verified_email": bool(settings.get("auto_link_verified_email")),
        "applications_enabled": bool(settings.get("applications_enabled")),
        "applications_coupled": settings["mode"] == "live" and bool(settings.get("applications_enabled")),
        "type_map": settings.get("type_map") or {},
        "website_types": sorted(VALID_TYPES),
        # Mitgliederverzeichnis aus der Einwilligung (#410 Nachtrag): welcher Einwilligungscode den Eintrag steuert.
        "directory_consent_code": settings.get("directory_consent_code") or "",
        # Feldzuordnung fürs Verzeichnis (Vereine 1.2): welcher Feldcode in Gamertag, Kurztext, Spiele, Plattformen landet.
        "directory_field_map": {**DEFAULT_FIELD_MAP, **{k: v for k, v in (settings.get("directory_field_map") or {}).items() if k in FIELD_MAP_COLUMNS}},
        "website_profile_fields": state.get("website_profile_fields") or [],
        "sync": state,
        "links": links,
        "open_links": sum(links.get(status, 0) for status in OPEN_STATUSES),
        "members_led_by_dolibarr": await db.memberships.count_documents({"source": "dolibarr"}),
        "unmapped_types": unmapped,
        "features": await _features(db, settings),
        "policy": {
            "active": policy_active(settings), "version": policy.get("version"), "map": policy.get("map") or {},
            "approved_at": policy.get("approved_at"), "derivable_areas": list(DERIVABLE_AREAS),
        },
    }


# ---------------------------------------------------------------- Vereinsdaten und Vorstand (#326)

@admin_router.get("/public")
async def dolibarr_public(me: dict = Depends(require_area("club", "system"))):
    """Für den Reiter Rechtliches: was Dolibarr über den Verein und den Vorstand liefert, Stand und Fehler."""
    from services import club_facts
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1}) or {}
    return await club_facts.admin_view(db, branding)


@admin_router.post("/public/refresh")
async def dolibarr_public_refresh(me: dict = Depends(require_area("club", "system"))):
    """Jetzt nachlesen statt beim stündlichen Job - nur lesen."""
    from services import club_facts
    db = get_db()
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        raise HTTPException(409, "Dolibarr ist nicht angebunden.")
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        raise HTTPException(503, f"Dolibarr: {exc.text}")
    result = await club_facts.refresh(db, settings, client)
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "legal_from_dolibarr": 1}) or {}
    return {**result, "view": await club_facts.admin_view(db, branding)}


# ---------------------------------------------------------------- Sponsoren und Partner (#405)

class SponsorSourceUpdate(BaseModel):
    from_dolibarr: bool | None = None
    sponsor_category: str | None = Field(None, max_length=80)
    partner_category: str | None = Field(None, max_length=80)


@admin_router.get("/sponsors")
async def dolibarr_sponsors(me: dict = Depends(require_area("content", "system"))):
    """Für den Block „Aus Dolibarr“ auf den Sponsoren- und Partnerseiten: Schalter, Kategorien, Stand, Fehler."""
    from services import dolibarr_sponsors
    return await dolibarr_sponsors.admin_view(get_db())


@admin_router.patch("/sponsors")
async def update_sponsor_source(body: SponsorSourceUpdate, me: dict = Depends(require_area("content", "system"))):
    """Schalter und Kategorienamen. Einschalten liest sofort nach, damit die Listen nicht eine Stunde leer bleiben."""
    from services import dolibarr_sponsors
    db = get_db()
    current = await dolibarr_sponsors.load_source_settings(db)
    updates = {key: value for key, value in body.model_dump(exclude_unset=True).items() if value is not None}
    for key in ("sponsor_category", "partner_category"):
        if key in updates and not str(updates[key]).strip():
            raise HTTPException(422, "Der Kategoriename darf nicht leer sein.")
    merged = dolibarr_sponsors.normalize_settings({**current, **updates})
    if merged["from_dolibarr"] and not current["from_dolibarr"]:
        settings = await load_settings(db)
        if settings.get("mode") == "off":
            raise HTTPException(409, "Dolibarr ist nicht angebunden (Finanzen → Dolibarr-Anbindung).")
    await db.settings.update_one({"id": dolibarr_sponsors.SETTINGS_ID}, {"$set": {"id": dolibarr_sponsors.SETTINGS_ID, **merged}}, upsert=True)
    changed = sorted(key for key in merged if merged[key] != current[key])
    if changed:
        await _audit(me.get("id"), "dolibarr.sponsor_source", dolibarr_sponsors.SETTINGS_ID, {"changed": changed, "from_dolibarr": merged["from_dolibarr"]})
    result = None
    if merged["from_dolibarr"] and changed:
        settings = await load_settings(db)
        if settings.get("mode") != "off":
            try:
                result = await dolibarr_sponsors.refresh(db, DolibarrClient(settings), source=merged)
            except DolibarrError as exc:
                result = {"ok": False, "kind": exc.kind, "text": exc.text}
    return {"ok": True, "result": result, "view": await dolibarr_sponsors.admin_view(db)}


@admin_router.post("/sponsors/refresh")
async def dolibarr_sponsors_refresh(me: dict = Depends(require_area("content", "system"))):
    """Jetzt nachlesen statt beim stündlichen Job - nur lesen aus Dolibarr, schreiben nur in die eigenen Listen."""
    from services import dolibarr_sponsors
    db = get_db()
    source = await dolibarr_sponsors.load_source_settings(db)
    if not source["from_dolibarr"]:
        raise HTTPException(409, "Der Schalter „Sponsoren und Partner aus Dolibarr“ ist aus.")
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        raise HTTPException(409, "Dolibarr ist nicht angebunden.")
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        raise HTTPException(503, f"Dolibarr: {exc.text}")
    result = await dolibarr_sponsors.refresh(db, client, source=source)
    return {**result, "view": await dolibarr_sponsors.admin_view(db)}


# ---------------------------------------------------------------- Verbindung (System)

class DolibarrSettingsUpdate(BaseModel):
    mode: str | None = None
    environment: str | None = None
    base_url: str | None = Field(None, max_length=300)
    api_key: str | None = Field(None, max_length=300)
    # Schreibzugriff (#316): eigener Schlüssel eines Dolibarr-Benutzers mit Rechten auf Kunden
    # und Rechnungen - getrennt vom Lese-Schlüssel, getrennt einschaltbar.
    write_api_key: str | None = Field(None, max_length=300)
    write_enabled: bool | None = None
    # Rechnungen gleich freigeben - oder als Entwurf zur Prüfung lassen (sichere Erstinbetriebnahme, #317).
    invoice_auto_validate: bool | None = None
    # Steuersätze bestätigt (#322): Voraussetzung fürs automatische Freigeben; wer und wann wird gemerkt.
    tax_confirmed: bool | None = None
    # Konditionen (#370): Dolibarr-Nummern aus den Wörterbüchern und der Kontenliste; 0 löscht.
    invoice_payment_term_id: int | None = Field(None, ge=0, le=999999)
    invoice_payment_mode_id: int | None = Field(None, ge=0, le=999999)
    invoice_bank_account_id: int | None = Field(None, ge=0, le=999999)
    instance: str | None = Field(None, max_length=60)
    entity: int | None = Field(None, ge=1, le=9999)
    auto_link_verified_email: bool | None = None
    # Beitrittsanträge nach Dolibarr (#328): nur im Modus „live“ wirksam; aus = Antrag und Entscheidung auf der Website.
    applications_enabled: bool | None = None
    type_map: dict[str, str] | None = None
    directory_consent_code: str | None = Field(None, max_length=60)
    directory_field_map: dict[str, str] | None = None


@admin_router.get("/consent-texts")
async def dolibarr_consent_texts(me: dict = Depends(require_area("system"))):
    """Die Einwilligungstexte des Vereins (Code, Bezeichnung) - für die Auswahl, welche das Verzeichnis steuert."""
    settings = await load_settings(get_db())
    if settings.get("mode") == "off":
        return []
    try:
        texts = await DolibarrClient(settings).consent_texts()
    except DolibarrError as exc:
        return {"error": exc.kind, "texts": []}
    return [{"code": str(t.get("code") or ""), "label": str(t.get("label") or t.get("code") or ""), "version": t.get("version")} for t in texts if t.get("code")]


@admin_router.put("/settings")
async def update_dolibarr_settings(body: DolibarrSettingsUpdate, me: dict = Depends(require_area("system"))):
    db = get_db()
    current = await load_settings(db)
    updates: dict = {}
    data = body.model_dump(exclude_unset=True)
    if "environment" in data:
        if data["environment"] not in ENVIRONMENTS:
            raise HTTPException(400, "Umgebung ist „test“ oder „production“.")
        updates["environment"] = data["environment"]
    environment = updates.get("environment", current["environment"])
    if "base_url" in data:
        try:
            updates["base_url"] = clean_base_url(data["base_url"], environment=environment) if data["base_url"] else ""
        except DolibarrError as exc:
            raise HTTPException(400, exc.text)
    elif "environment" in updates and current.get("base_url"):
        try:
            clean_base_url(current["base_url"], environment=environment)
        except DolibarrError:
            raise HTTPException(400, "Die gespeicherte Adresse ist für diese Umgebung nicht zulässig (https nötig).")
    if data.get("api_key"):
        updates["api_key"] = encrypt_secret(data["api_key"].strip())
    if data.get("write_api_key"):
        updates["write_api_key"] = encrypt_secret(data["write_api_key"].strip())
    if "write_enabled" in data:
        if data["write_enabled"] and not (data.get("write_api_key") or current.get("write_api_key") or data.get("api_key") or current.get("api_key")):
            raise HTTPException(400, "Schreibzugriff braucht einen API-Schlüssel (der des Website-Benutzers reicht).")
        updates["write_enabled"] = bool(data["write_enabled"])
    if "applications_enabled" in data:
        updates["applications_enabled"] = bool(data["applications_enabled"])
    for key in TERM_FIELDS:
        if key in data:
            updates[key] = int(data[key]) if data[key] else None
    if "tax_confirmed" in data:
        if data["tax_confirmed"]:
            updates["tax_confirmed_at"] = now_utc().isoformat()
            updates["tax_confirmed_by"] = me["id"]
            updates["tax_confirmed_by_name"] = str(me.get("display_name") or me.get("username") or "")
        else:
            updates["tax_confirmed_at"] = None
            updates["tax_confirmed_by"] = None
            updates["tax_confirmed_by_name"] = None
            # Ohne bestätigte Steuersätze gibt die Website nichts mehr von selbst frei.
            if current.get("invoice_auto_validate"):
                updates["invoice_auto_validate"] = False
    if "invoice_auto_validate" in data:
        if data["invoice_auto_validate"] and not terms_complete({**current, **updates}):
            raise HTTPException(400, "Zum automatischen Freigeben braucht es Zahlungsziel, Zahlungsart und Bankkonto (unten eintragen).")
        if data["invoice_auto_validate"] and not tax_confirmed({**current, **updates}):
            raise HTTPException(400, "Zum automatischen Freigeben müssen die Steuersätze bestätigt sein (Haken „Steuersätze geprüft“).")
        updates["invoice_auto_validate"] = bool(data["invoice_auto_validate"])
    if "instance" in data:
        updates["instance"] = (data["instance"] or "").strip()
    if "entity" in data and data["entity"]:
        updates["entity"] = data["entity"]
    if "auto_link_verified_email" in data:
        updates["auto_link_verified_email"] = bool(data["auto_link_verified_email"])
    if "directory_consent_code" in data:
        code = str(data["directory_consent_code"] or "").strip()
        if code and not all(ch.isalnum() or ch in "_-" for ch in code):
            raise HTTPException(400, "Der Einwilligungscode besteht aus Buchstaben, Ziffern, „_“ und „-“.")
        updates["directory_consent_code"] = code
    if "directory_field_map" in data:
        cleaned_map: dict[str, str] = {}
        for column, code in (data["directory_field_map"] or {}).items():
            if column not in FIELD_MAP_COLUMNS:
                raise HTTPException(400, f"Unbekannte Spalte: {column}")
            code = str(code or "").strip()
            if code and not re.fullmatch(r"[a-z][a-z0-9_]*", code):
                raise HTTPException(400, "Ein Feldcode besteht aus Kleinbuchstaben, Ziffern und „_“.")
            cleaned_map[column] = code
        updates["directory_field_map"] = {**(current.get("directory_field_map") or {}), **cleaned_map}
    if "type_map" in data:
        cleaned = {}
        for type_id, target in (data["type_map"] or {}).items():
            if target and target not in VALID_TYPES:
                raise HTTPException(400, f"Unbekannte Mitgliedsart der Website: {target}")
            if target and str(type_id).strip().isdigit():
                cleaned[str(type_id).strip()] = target
        updates["type_map"] = cleaned
    if "mode" in data:
        if data["mode"] not in MODES:
            raise HTTPException(400, "Modus ist „off“, „preview“ oder „live“.")
        if data["mode"] == "live" and current["mode"] != "live":
            # Kein stilles Umschalten: erst ein gelungener Lauf in der Vorschau.
            state = await sync_state(db)
            if current["mode"] != "preview" or not state.get("ok"):
                raise HTTPException(409, "Erst „Vorschau“ einschalten und einen Abgleich ohne Fehler durchlaufen lassen, dann „Live“.")
        updates["mode"] = data["mode"]
    instance_changed = any(key in updates and updates[key] != current.get(key) for key in ("instance", "entity"))
    if instance_changed and await db.dolibarr_links.count_documents({"status": "verified"}):
        if updates.get("mode", current["mode"]) == "live":
            raise HTTPException(409, "Instanz oder Entity lassen sich im Live-Betrieb nicht ändern – Zuordnungen gelten je Installation.")
    if not updates:
        return {"ok": True, "changed": []}
    updates["updated_at"] = now_utc().isoformat()
    updates["updated_by"] = me["id"]
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, **updates}}, upsert=True)
    if instance_changed or "base_url" in updates:
        # Der Merker gehört zur alten Installation.
        await db.settings.update_one({"id": "dolibarr_sync_state"}, {"$unset": {"cursor": "", "last_full_at": ""}})
    changed = sorted(key for key in updates if key not in ("updated_at", "updated_by"))
    await _audit(me["id"], "dolibarr.settings", SETTINGS_ID, {"changed": changed, "mode": updates.get("mode")})
    return {"ok": True, "changed": changed}


@admin_router.delete("/settings/api-key")
async def clear_dolibarr_key(me: dict = Depends(require_area("system"))):
    db = get_db()
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"api_key": "", "mode": "off", "updated_at": now_utc().isoformat()}})
    await _audit(me["id"], "dolibarr.key_removed", SETTINGS_ID)
    return {"ok": True}


@admin_router.get("/invoice-options")
async def invoice_options(me: dict = Depends(require_area("system"))):
    """Konditionen (#370) zum Auswählen: Zahlungsziele und Zahlungsarten aus den Wörterbüchern,
    Bankkonten aus der Kontenliste. Darf der Website-Benutzer eine Liste nicht lesen, ist sie
    ``null`` - dann wird die Nummer eingetippt. Vorschlag: 30 Tage, Banküberweisung."""
    db = get_db()
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        return {"available": False, "reason": "not_connected", "terms": None, "modes": None, "accounts": None, "suggested": {}}
    client = DolibarrClient(settings)

    async def view(rows: list[dict] | None, label_keys: tuple[str, ...], german: dict[str, str] | None = None) -> list[dict] | None:
        if rows is None:
            return None
        out = []
        for row in rows:
            try:
                row_id = int(row.get("id") or row.get("rowid") or 0)
            except (TypeError, ValueError):
                continue
            if row_id < 1:
                continue
            code = str(row.get("code") or row.get("ref") or "")
            raw = next((str(row[key]) for key in label_keys if row.get(key)), "") or f"Nr. {row_id}"
            # Die API liefert die Wörterbuch-Texte auf Englisch - übersetzen tut nur Dolibarrs
            # eigene Oberfläche. Bekannte Codes bekommen hier ihren deutschen Text.
            out.append({"id": row_id, "code": code, "label": (german or {}).get(code) or raw})
        return out

    try:
        terms = await view(await client.payment_terms(), ("label", "libelle_facture", "libelle"), PAYMENT_TERM_LABELS)
        modes = await view(await client.payment_types(), ("label", "libelle"), PAYMENT_MODE_LABELS)
        accounts = await view(await client.bank_accounts(), ("label", "ref", "bank"))
    except DolibarrError as exc:
        return {"available": False, "reason": exc.kind, "reason_text": exc.text, "terms": None, "modes": None, "accounts": None, "suggested": {}}
    suggested = {
        "payment_term_id": next((row["id"] for row in terms or [] if row["code"] == DEFAULT_TERM_CODE), None),
        "payment_mode_id": next((row["id"] for row in modes or [] if row["code"] == DEFAULT_MODE_CODE), None),
        "bank_account_id": accounts[0]["id"] if accounts and len(accounts) == 1 else None,
    }
    return {
        "available": True, "terms": terms, "modes": modes, "accounts": accounts, "suggested": suggested,
        # Warum die Kontenliste fehlt - damit die Seite sagen kann, welches Recht fehlt.
        "accounts_reason": None if accounts is not None else "forbidden",
    }


# Dolibarrs Wörterbuch-Codes auf Deutsch (die API liefert die englischen Rohtexte).
PAYMENT_TERM_LABELS = {
    "RECEP": "Sofort bei Erhalt", "30D": "30 Tage", "30DENDMONTH": "30 Tage zum Monatsende", "60D": "60 Tage",
    "60DENDMONTH": "60 Tage zum Monatsende", "PT_ORDER": "Bei Bestellung", "PT_DELIVERY": "Bei Lieferung",
    "PT_5050": "50 % bei Bestellung, 50 % bei Lieferung", "10D": "10 Tage", "10DENDMONTH": "10 Tage zum Monatsende",
    "14D": "14 Tage", "14DENDMONTH": "14 Tage zum Monatsende", "7D": "7 Tage", "45D": "45 Tage", "90D": "90 Tage",
}
PAYMENT_MODE_LABELS = {
    "VIR": "Banküberweisung", "PRE": "Lastschrift", "LIQ": "Bar", "CB": "Kreditkarte", "CHQ": "Scheck", "TIP": "Zahlschein",
    "VAD": "Online-Zahlung", "FAC": "Factoring", "TRA": "Wechsel", "DC": "Bankkarte", "PP": "PayPal",
}


@admin_router.post("/test")
async def test_dolibarr_connection(me: dict = Depends(require_area("system"))):
    try:
        status = await (await DolibarrClient.from_db()).status()
    except DolibarrError as exc:
        return {"ok": False, "error": exc.kind, "text": exc.text, "status": exc.status}
    return {
        "ok": True, "module_version": status.get("module_version"), "api_version": status.get("api_version"),
        "server_time": status.get("server_time"), "capabilities": capabilities_for(status),
    }


@admin_router.post("/webhook-token")
async def new_webhook_token(me: dict = Depends(require_area("system"))):
    """Neues Token. Es wird genau einmal gezeigt - für die Ziel-URL im Dolibarr-Modul „Webhooks“."""
    token = secrets.token_urlsafe(32)
    await get_db().settings.update_one(
        {"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, "webhook_token": encrypt_secret(token)}}, upsert=True
    )
    await _audit(me["id"], "dolibarr.webhook_token", SETTINGS_ID)
    return {"ok": True, "path": f"/api/integrations/dolibarr/webhook/{token}"}


# ---------------------------------------------------------------- Abgleich und Vorschau (Vereinsverwaltung)

@admin_router.post("/sync")
async def sync_now(full: bool = False, me: dict = Depends(require_area("club", "system"))):
    result = await run_sync(get_db(), full=True if full else None)
    await _audit(me["id"], "dolibarr.sync", SETTINGS_ID, {"full": full, "ok": result.get("ok")})
    return result


@admin_router.get("/preview")
async def preview_migration(me: dict = Depends(require_area("club"))):
    settings = await load_settings()
    if settings["mode"] == "off":
        raise HTTPException(409, "Die Anbindung ist ausgeschaltet.")
    try:
        return await migration_preview(get_db())
    except DolibarrError as exc:
        raise _error(exc)


# ---------------------------------------------------------------- Zuordnungen (Vereinsverwaltung)

@admin_router.get("/links")
async def list_links(me: dict = Depends(require_area("club"))):
    db = get_db()
    links = await db.dolibarr_links.find({}, {"_id": 0, "history": 0}).sort("updated_at", -1).to_list(1000)
    users = {
        u["id"]: u async for u in db.users.find(
            {"id": {"$in": [link["user_id"] for link in links]}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1}
        )
    }
    for link in links:
        user = users.get(link["user_id"]) or {}
        link["username"] = user.get("username")
        link["display_name"] = user.get("display_name")
    return links


class LinkConfirm(BaseModel):
    user_id: str
    member_id: int = Field(ge=1)


@admin_router.post("/links")
async def confirm_link(body: LinkConfirm, me: dict = Depends(require_area("club"))):
    """Geprüfte Zuordnung: Die Vereinsverwaltung bestätigt, dass dieses Konto dieses Mitglied ist."""
    db = get_db()
    settings = await load_settings(db)
    if settings["mode"] == "off":
        raise HTTPException(409, "Die Anbindung ist ausgeschaltet.")
    user = await db.users.find_one({"id": body.user_id}, {"_id": 0, "id": 1})
    if not user:
        raise HTTPException(404, "Benutzer nicht gefunden.")
    try:
        summary = await DolibarrClient(settings).member_summary(body.member_id)
    except DolibarrError as exc:
        if exc.kind == "not_found":
            raise HTTPException(404, "Dieses Mitglied gibt es in Dolibarr nicht.")
        raise _error(exc)
    try:
        link = await verify_link(db, settings, user_id=body.user_id, member_id=body.member_id,
                                 member_ref=summary.get("ref"), source="admin", actor_id=me["id"])
    except LinkConflict as exc:
        raise HTTPException(409, str(exc))
    applied = None
    if settings["mode"] == "live":
        applied = await apply_summary(db, settings, link, summary)
    await _audit(me["id"], "dolibarr.link_verified", body.user_id, {"member_id": body.member_id, "applied": applied})
    link.pop("history", None)
    return link


@admin_router.delete("/links/{user_id}")
async def remove_link(user_id: str, me: dict = Depends(require_area("club"))):
    """Zuordnung lösen. Der zuletzt übernommene Stand bleibt stehen und wird wieder lokal gepflegt."""
    db = get_db()
    settings = await load_settings(db)
    link = await link_for_user(db, settings, user_id)
    if not link:
        raise HTTPException(404, "Keine Zuordnung.")
    await close_link(db, link, status="revoked", actor_id=me["id"], note="von der Vereinsverwaltung gelöst")
    from services.dolibarr_invoices import forget_cache
    await forget_cache(db, user_id)
    await db.memberships.update_one({"user_id": user_id, "source": "dolibarr"}, {"$set": {"source": "local", "dolibarr.functions": []}})
    await _audit(me["id"], "dolibarr.link_revoked", user_id, {"member_id": link.get("member_id")})
    return {"ok": True}


# ---------------------------------------------------------------- Funktion → Bereich (Superadmin)

class PolicyUpdate(BaseModel):
    map: dict[str, list[str]]
    confirm: bool = False


@admin_router.put("/function-policy")
async def update_function_policy(body: PolicyUpdate, me: dict = Depends(require_super())):
    """Ohne `confirm` nur die Vorschau: wer bekäme was. Mit `confirm` gilt die neue Fassung."""
    db = get_db()
    settings = await load_settings(db)
    cleaned = clean_policy_map(body.map)
    affected = []
    async for membership in db.memberships.find(
        {"source": "dolibarr", "member_status": {"$in": ["active", "honorary"]}, "dolibarr.functions.0": {"$exists": True}},
        {"_id": 0, "user_id": 1, "dolibarr.functions": 1},
    ):
        grants = areas_from_functions((membership.get("dolibarr") or {}).get("functions"), cleaned)
        if grants:
            affected.append({"user_id": membership["user_id"], "grants": grants})
    names = {
        u["id"]: u async for u in db.users.find({"id": {"$in": [row["user_id"] for row in affected]}}, {"_id": 0, "id": 1, "username": 1, "display_name": 1})
    }
    for row in affected:
        row["username"] = (names.get(row["user_id"]) or {}).get("username")
        row["display_name"] = (names.get(row["user_id"]) or {}).get("display_name")
    if not body.confirm:
        return {"ok": True, "preview": True, "map": cleaned, "affected": affected}
    previous = settings.get("function_policy") or {}
    policy = {
        "version": int(previous.get("version") or 0) + 1, "map": cleaned,
        "approved_at": now_utc().isoformat() if cleaned else None, "approved_by": me["id"],
    }
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": {"id": SETTINGS_ID, "function_policy": policy}}, upsert=True)
    await _audit(me["id"], "dolibarr.function_policy", SETTINGS_ID, {
        "version": policy["version"], "map": cleaned, "previous": previous.get("map") or {}, "affected": [row["user_id"] for row in affected],
    })
    return {"ok": True, "preview": False, "policy": policy, "affected": affected}


# ---------------------------------------------------------------- Webhook (öffentlich, mit Token)

@public_router.post("/webhook/{token}", status_code=202)
async def dolibarr_webhook(token: str, request: Request):
    """Dolibarr signiert nichts; das Token in der Adresse ist der Ausweis. Das Ereignis trägt keinen
    Stand - es ist nur der Anlass, die Zusammenfassung in ein paar Sekunden neu zu lesen."""
    await enforce_rate_limit(request, "dolibarr:webhook", limit=120, window_seconds=60)
    db = get_db()
    settings = await load_settings(db)
    try:
        expected = decrypt_secret(settings.get("webhook_token"))
    except RuntimeError:
        expected = ""
    if not expected or not hmac.compare_digest(expected.encode(), token.encode()):
        raise HTTPException(404, "Not found")
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Kein JSON.")
    obj = payload.get("object") if isinstance(payload, dict) else None
    member_id = (obj or {}).get("member_id") if isinstance(obj, dict) else None
    if payload.get("triggercode") != "VEREINE_MEMBER_CHANGED" or not isinstance(member_id, int) or member_id < 1:
        raise HTTPException(400, "Unbekanntes Ereignis.")
    if settings["mode"] == "live":
        await queue_member(db, settings, member_id)
    return {"accepted": True}


# ---------------------------------------------------------------- Die betroffene Person

class LinkRequest(BaseModel):
    member_ref: str | None = Field(None, max_length=40)


@member_router.post("/link-request")
async def request_link(body: LinkRequest, request: Request, user: dict = Depends(get_current_user)):
    """„Ich bin Mitglied“: Die Vereinsverwaltung prüft und bestätigt. Eine Mitgliedsnummer beweist nichts."""
    await enforce_rate_limit(request, "dolibarr:link-request", limit=5, window_seconds=3600)
    db = get_db()
    settings = await load_settings(db)
    if settings["mode"] == "off":
        raise HTTPException(409, "Die Mitgliederverwaltung ist noch nicht angebunden.")
    existing = await link_for_user(db, settings, user["id"])
    if existing and existing.get("status") == "verified":
        return {"status": "verified"}
    ref = (body.member_ref or "").strip() or None
    link = await note_candidate(db, settings, user_id=user["id"], member_id=None, member_ref=ref,
                                source="user_request", status="requested", note="vom Mitglied angefragt")
    return {"status": link["status"]}
