"""Vereinsakte verbinden (#324 Teil 1): persönlicher Zugriff auf das Vereinsmodul.

Der Dienstzugang der Website (API-Schlüssel) liest Mitgliedsdaten **mehrerer** Personen - er beweist
nicht, wer vor dem Bildschirm sitzt. Für persönliche Unterlagen (Bestätigungen, Protokolle,
Beschlüsse) verlangt das Modul deshalb eine **Bindung je Person**: Der Vorstand erzeugt in Dolibarr
(*Einrichtung > Externe Identitäten*) einen Einladungscode, die Person löst ihn unter „Meine
Mitgliedschaft“ ein, und die Website ruft ``POST /vereine/identities/claim`` mit ihrer Kennung
(``subject`` = Konto-ID) auf. Ab dann prüft das Modul bei jedem Abruf selbst, ob die Person das
Dokument sehen darf (``GET /vereine/me/documents``, ``…/{id}/pdf``). Ohne Bindung gibt es nur, was
der Verein für die Öffentlichkeit veröffentlicht (``GET /vereine/documents``).

Die Website hält je Konto und Installation eine Bindung in ``dolibarr_identities`` (Mitglied,
Fähigkeiten, seit wann). Widerruft der Verein, antwortet das Modul 403 - dann steht die Bindung hier
auf ``revoked``, und die Person sieht wieder nur Öffentliches, bis sie einen neuen Code einlöst.
E-Mail, Mitgliedsnummer oder eine bestätigte Zuordnung der Website gelten dem Modul nie als
Nachweis; deshalb ersetzt nichts davon den Code.

Dokumente aus der Akte erscheinen in der gemeinsamen Liste ``GET /api/documents`` mit der Kennung
``dolibarr-<document_id>`` und ``source: dolibarr``; ihr PDF kommt über denselben Weg
``/api/documents/<id>/view`` - Web und App brauchen dafür keinen zweiten Betrachter. Die Bytes
müssen zur Prüfsumme passen, die das Modul mitschickt; sonst gibt es die Datei nicht.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import logging
import time

from models import new_id, now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError, instance_key, load_settings

logger = logging.getLogger("tls.dolibarr.identity")

COLLECTION = "dolibarr_identities"
DOC_PREFIX = "dolibarr-"
LIST_TTL_SECONDS = 60.0
# Welche Dokumentart der Akte welcher Kategorie der Website entspricht (Web und App kennen die Kürzel).
KIND_CATEGORY = {"statute": "statutes", "minutes": "minutes", "resolution": "resolution", "audit_report": "audit_report",
                 "account": "account", "payout": "payout", "letter": "letter", "ballot": "ballot"}
WHAT_LABELS = {"built": "erstellt", "signed": "unterschrieben", "scan": "Scan des unterschriebenen Papiers", "excerpt": "gekürzte Fassung"}
AUDIENCE_LABELS = {"person": "nur für dich", "members": "für Mitglieder", "board": "für den Vorstand", "public": "öffentlich"}
CAPABILITY_LABELS = {"documents": "Dokumente", "consents": "Einwilligungen", "votes": "Abstimmungen", "meetings": "Sitzungen",
                     "profile": "eigene Daten", "events": "Veranstaltungen", "accounts": "Konten", "applications": "Antrag"}

_LIST_CACHE: dict[str, tuple[float, list[dict]]] = {}


class ClaimError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def subject_for(user: dict) -> str:
    """Die Kennung, unter der die Website die Person beim Modul führt - stabil, ohne Personendaten."""
    return str(user["id"])


def reset_cache() -> None:
    _LIST_CACHE.clear()


async def binding_for(db, settings: dict, user_id: str) -> dict | None:
    return await db[COLLECTION].find_one({"user_id": user_id, "instance": instance_key(settings)}, {"_id": 0})


def public_state(binding: dict | None, settings: dict) -> dict:
    """Was die Person über ihre Bindung sieht - nie Kennungen des Moduls."""
    if settings.get("mode") != "live":
        return {"available": False, "status": "none", "capabilities": []}
    if not binding:
        return {"available": True, "status": "none", "capabilities": []}
    capabilities = [c for c in binding.get("capabilities") or [] if isinstance(c, str)]
    return {
        "available": True, "status": binding.get("status") or "bound", "capabilities": capabilities,
        "capability_labels": [CAPABILITY_LABELS.get(c, c) for c in capabilities],
        "linked_at": binding.get("linked_at"), "revoked_at": binding.get("revoked_at"), "proof": binding.get("proof"),
    }


async def state(db, user: dict) -> dict:
    settings = await load_settings(db)
    return public_state(await binding_for(db, settings, user["id"]), settings)


async def claim(db, user: dict, code: str) -> dict:
    """Einen Einladungscode einlösen. Der Code ist der einzige Nachweis; alles andere sagt das Modul."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        raise ClaimError(409, "Die Mitgliederverwaltung ist nicht live angebunden.")
    code = str(code or "").strip()
    if not code or len(code) > 120:
        raise ClaimError(400, "Bitte den Einladungscode eintragen.")
    existing = await binding_for(db, settings, user["id"])
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        raise ClaimError(503, exc.text) from exc
    if existing and existing.get("status") == "bound":
        # Gilt die Bindung beim Modul noch? Hat der Verein sie widerrufen und neu eingeladen, darf der neue Code durch.
        try:
            await client.identity(existing["subject"])
        except DolibarrError as exc:
            if exc.kind not in ("forbidden", "not_found"):
                raise ClaimError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc
            await mark_revoked(db, existing)
        else:
            raise ClaimError(409, "Dein Konto ist schon mit der Vereinsakte verbunden.")
    try:
        identity = await client.claim_identity(subject_for(user), code)
    except DolibarrError as exc:
        if exc.kind == "forbidden":
            raise ClaimError(403, "Der Code passt nicht: falsch abgetippt, schon eingelöst oder abgelaufen (er gilt eine Stunde). "
                                  "Bitte den Vorstand um einen neuen Code – oder die Website darf im Vereinsmodul noch nicht „für Personen handeln“.") from exc
        if exc.kind in ("not_found", "module_off"):
            raise ClaimError(503, "Das Vereinsmodul kennt den persönlichen Zugriff noch nicht (ab Vereine 0.11).") from exc
        raise ClaimError(503, f"Dolibarr antwortet gerade nicht ({exc.text}).") from exc
    doc = {
        "id": existing["id"] if existing else new_id(), "user_id": user["id"], "instance": instance_key(settings), "subject": subject_for(user),
        "member_id": identity.get("member_id"), "application_id": identity.get("application_id"),
        "capabilities": [c for c in identity.get("capabilities") or [] if isinstance(c, str)],
        "proof": identity.get("proof"), "linked_at": identity.get("linked_at") or now_utc().isoformat(),
        "checked_at": now_utc().isoformat(), "status": "bound",
    }
    await db[COLLECTION].update_one({"user_id": user["id"], "instance": doc["instance"]}, {"$set": doc, "$unset": {"revoked_at": ""}}, upsert=True)
    _LIST_CACHE.pop(f"me:{doc['subject']}", None)
    return public_state(doc, settings)


async def mark_revoked(db, binding: dict) -> None:
    """Das Modul hat Nein gesagt: die Bindung gilt nicht mehr - sofort, nicht erst beim nächsten Abgleich."""
    await db[COLLECTION].update_one({"id": binding["id"]}, {"$set": {"status": "revoked", "revoked_at": now_utc().isoformat()}})
    _LIST_CACHE.pop(f"me:{binding.get('subject')}", None)


def _describe(row: dict) -> str:
    parts = [WHAT_LABELS.get(str(row.get("what") or ""), ""), AUDIENCE_LABELS.get(str(row.get("audience") or ""), "")]
    if row.get("code"):
        parts.append(f"Kennung {row['code']}")
    return " · ".join(part for part in parts if part)


def document_view(row: dict) -> dict:
    """Eine Fassung aus der Akte in der Form der Vereinsdokumente - ohne Prüfsumme, mit derselben Öffnen-Adresse."""
    doc_id = f"{DOC_PREFIX}{int(row['document_id'])}"
    audience = str(row.get("audience") or "")
    return {
        "id": doc_id, "source": "dolibarr", "title": row.get("title") or row.get("code") or "Dokument", "description": _describe(row),
        "category": KIND_CATEGORY.get(str(row.get("kind") or ""), "other"), "kind": row.get("kind"), "what": row.get("what"),
        "audience": audience, "personal": audience == "person", "code": row.get("code"), "revision": row.get("revision"),
        "visibility": "members", "original_filename": f"{row.get('code') or doc_id}.pdf", "mime": "application/pdf",
        "file_size": row.get("size"), "pinned": False, "allow_download": True,
        "view_url": f"/api/documents/{doc_id}/view", "download_url": f"/api/documents/{doc_id}/download",
        "created_at": row.get("date"), "updated_at": row.get("date"),
    }


def parse_doc_id(doc_id: str) -> int | None:
    rest = str(doc_id or "")[len(DOC_PREFIX):] if str(doc_id or "").startswith(DOC_PREFIX) else ""
    return int(rest) if rest.isdigit() else None


async def documents_for(db, user: dict) -> list[dict]:
    """Dokumente aus der Akte für die angemeldete Person: mit Bindung die eigenen, sonst die öffentlichen.
    Nie ein Fehler nach außen - ohne Dolibarr gibt es einfach keine."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return []
    binding = await binding_for(db, settings, user["id"])
    bound = bool(binding and binding.get("status") == "bound")
    key = f"me:{binding['subject']}" if bound else "public"
    cached = _LIST_CACHE.get(key)
    if cached and time.monotonic() - cached[0] < LIST_TTL_SECONDS:
        return [dict(doc) for doc in cached[1]]
    try:
        client = DolibarrClient(settings)
    except DolibarrError:
        return []
    try:
        rows = await client.my_documents(binding["subject"]) if bound else await client.public_documents()
    except DolibarrError as exc:
        if bound and exc.kind == "forbidden":
            await mark_revoked(db, binding)
            return await documents_for(db, user)
        logger.warning("[dolibarr] Dokumente nicht lesbar: %s", exc.kind)
        return []
    docs = [document_view(row) for row in rows if isinstance(row, dict) and row.get("document_id")]
    _LIST_CACHE[key] = (time.monotonic(), docs)
    return [dict(doc) for doc in docs]


async def document_pdf(db, user: dict, document_id: int) -> tuple[bytes, dict]:
    """Das PDF einer Fassung: mit Bindung über die Person (das Modul prüft bei jedem Abruf neu, ob sie es
    sehen darf), sonst das öffentliche. Die Bytes müssen zur mitgeschickten Prüfsumme passen."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        raise DolibarrError("not_configured")
    binding = await binding_for(db, settings, user["id"])
    bound = bool(binding and binding.get("status") == "bound")
    client = DolibarrClient(settings)
    try:
        data = await client.my_document_pdf(binding["subject"], document_id) if bound else await client.public_document_pdf(document_id)
    except DolibarrError as exc:
        if bound and exc.kind == "forbidden":
            await mark_revoked(db, binding)
        raise
    expected = str(data.get("sha256") or "")
    try:
        content = base64.b64decode(str(data.get("content") or ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise DolibarrError("invalid_response", 200) from exc
    if not content or not expected or hashlib.sha256(content).hexdigest() != expected:
        raise DolibarrError("invalid_response", 200)
    return content, data
