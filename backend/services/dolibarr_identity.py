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
Ab Vereine 1.4.0 (#531) reicht die bestätigte Zuordnung der Website: die Aufrufe gehen dann mit
``member_id`` statt ``subject`` (siehe ``access_for``); der Code bleibt der Ersatzweg für ältere Module.

Dokumente aus der Akte erscheinen in der gemeinsamen Liste ``GET /api/documents`` mit der Kennung
``dolibarr-<document_id>`` und ``source: dolibarr`` - die Statutenfassungen (``me/statutes`` mit
Bindung, sonst die öffentlichen) als ``dolibarr-statute-<id>`` unter „Statuten“; ihr PDF kommt über denselben Weg
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
from services.dolibarr_links import verified_link

logger = logging.getLogger("tls.dolibarr.identity")

COLLECTION = "dolibarr_identities"
DOC_PREFIX = "dolibarr-"
STATUTE_PREFIX = "dolibarr-statute-"
STATUTE_STATE_LABELS = {"in_force": "gilt", "future": "gilt ab", "repealed": "aufgehoben", "ambiguous": "Geltung unklar"}
LIST_TTL_SECONDS = 60.0
# Welche Dokumentart der Akte welcher Kategorie der Website entspricht (Web und App kennen die Kürzel).
KIND_CATEGORY = {"statute": "statutes", "minutes": "minutes", "resolution": "resolution", "audit_report": "audit_report",
                 "account": "account", "payout": "payout", "letter": "letter", "ballot": "ballot"}
WHAT_LABELS = {"built": "erstellt", "signed": "unterschrieben", "scan": "Scan des unterschriebenen Papiers", "excerpt": "gekürzte Fassung"}
AUDIENCE_LABELS = {"person": "nur für dich", "members": "für Mitglieder", "board": "für den Vorstand", "public": "öffentlich"}
CAPABILITY_LABELS = {"documents": "Dokumente", "consents": "Einwilligungen", "votes": "Abstimmungen", "meetings": "Sitzungen",
                     "profile": "eigene Daten", "events": "Veranstaltungen", "accounts": "Konten", "applications": "Antrag",
                     "website": "Website-Profil"}

# Vereinsakte ohne Einladungscode (#531): ab Vereine 1.4.0 nimmt jeder me/*-Aufruf statt der Bindung (``subject``)
# auch die Mitgliedsnummer (``member_id``). Die bestätigte Zuordnung der Website (``dolibarr_links``) reicht dann
# als Nachweis; dafür braucht der API-Benutzer der Website im Modul das Recht „Über die API im Namen jedes
# Mitglieds handeln“. Ältere Module ignorieren member_id (400 „subject is needed“) - dort bleibt der Code der Weg.
MEMBER_MODE_MIN_VERSION = (1, 4, 0)
MEMBER_MODE_CAPABILITIES = ["documents", "profile", "website"]
MEMBER_RIGHT_LABEL = "Über die API im Namen jedes Mitglieds handeln"
MEMBER_RIGHT_TEXT = ("Die Website darf im Vereinsmodul noch nicht im Namen der Mitglieder handeln – der Vorstand gibt dem "
                     f"API-Benutzer der Website in Dolibarr das Recht „{MEMBER_RIGHT_LABEL}“.")
STATE_ID = "dolibarr_sync_state"

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


def parse_version(text) -> tuple[int, ...]:
    """„1.4.0“ → (1, 4, 0); leer oder unlesbar → () - und das ist kleiner als jede Mindestversion."""
    parts: list[int] = []
    for piece in str(text or "").strip().split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts)


def module_supports_member_id(state: dict | None) -> bool:
    return parse_version((state or {}).get("module_version")) >= MEMBER_MODE_MIN_VERSION


async def _sync_state(db) -> dict:
    return await db.settings.find_one({"id": STATE_ID}, {"_id": 0, "id": 0}) or {}


async def note_member_access(db, ok: bool, text: str = "") -> None:
    """Für Dolibarr → Stand: ging der letzte Aufruf über die Mitgliedsnummer durch, oder fehlt das Recht?"""
    await db.settings.update_one({"id": STATE_ID}, {"$set": {"id": STATE_ID, "member_access": {"ok": ok, "at": now_utc().isoformat(), "text": text}}}, upsert=True)


async def access_for(db, settings: dict, user_id: str) -> dict | None:
    """Wie die Website für diese Person beim Modul auftritt - oder None, wenn es keinen Weg gibt.
    ``member``: bestätigte Zuordnung und Modul ab 1.4.0 (Parameter ``member_id``);
    ``subject``: Bindung per Einladungscode (Parameter ``subject``). ``params`` geht so an den Client."""
    link = await verified_link(db, settings, user_id)
    state = await _sync_state(db)
    if link and link.get("member_id") and module_supports_member_id(state):
        member_id = int(link["member_id"])
        return {"mode": "member", "params": {"member_id": member_id}, "member_id": member_id, "link": link, "binding": None,
                "capabilities": list(MEMBER_MODE_CAPABILITIES), "state": state}
    binding = await binding_for(db, settings, user_id)
    if binding and binding.get("status") == "bound":
        return {"mode": "subject", "params": {"subject": binding["subject"]}, "member_id": binding.get("member_id"), "link": link, "binding": binding,
                "capabilities": [c for c in binding.get("capabilities") or [] if isinstance(c, str)], "state": state}
    return None


def access_key(access: dict) -> str:
    return f"me:{access['mode']}:{access['params'].get('member_id') or access['params'].get('subject')}"


async def forbidden(db, access: dict) -> None:
    """Das Modul hat Nein gesagt: über die Bindung heißt das Widerruf, über die Mitgliedsnummer fehlt dem
    API-Benutzer das Recht - beides merkt sich die Website sofort, nicht erst beim nächsten Abgleich."""
    if access["mode"] == "subject":
        await mark_revoked(db, access["binding"])
        return
    _LIST_CACHE.pop(access_key(access), None)
    await note_member_access(db, False, MEMBER_RIGHT_TEXT)


async def member_call_ok(db, access: dict) -> None:
    """Ein Aufruf über die Mitgliedsnummer ging durch - eine gemerkte Störung ist damit vorbei."""
    if access["mode"] == "member" and (access["state"].get("member_access") or {}).get("ok") is False:
        access["state"]["member_access"] = {"ok": True}
        await note_member_access(db, True)


def public_state(binding: dict | None, settings: dict, link: dict | None = None, state: dict | None = None) -> dict:
    """Was die Person über ihre Verbindung zur Vereinsakte sieht - nie Kennungen des Moduls.
    ``via``: „member“ (Zuordnung reicht, #531) oder „code“ (Bindung per Einladungscode)."""
    if settings.get("mode") != "live":
        return {"available": False, "status": "none", "capabilities": []}
    linked = bool(link and link.get("status") == "verified" and link.get("member_id"))
    if linked and module_supports_member_id(state):
        access = (state or {}).get("member_access") or {}
        return {
            "available": True, "status": "bound", "via": "member", "linked": True, "member_ref": link.get("member_ref"),
            "capabilities": list(MEMBER_MODE_CAPABILITIES), "capability_labels": [CAPABILITY_LABELS.get(c, c) for c in MEMBER_MODE_CAPABILITIES],
            "linked_at": link.get("verified_at"), "right_missing": access.get("ok") is False, "module_too_old": False,
        }
    base = {"linked": linked, "member_ref": link.get("member_ref") if linked else None, "module_too_old": linked and not module_supports_member_id(state)}
    if not binding:
        return {"available": True, "status": "none", "capabilities": [], **base}
    capabilities = [c for c in binding.get("capabilities") or [] if isinstance(c, str)]
    return {
        "available": True, "status": binding.get("status") or "bound", "via": "code", "capabilities": capabilities,
        "capability_labels": [CAPABILITY_LABELS.get(c, c) for c in capabilities],
        "linked_at": binding.get("linked_at"), "revoked_at": binding.get("revoked_at"), "proof": binding.get("proof"), **base,
    }


async def state(db, user: dict) -> dict:
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return public_state(None, settings)
    return public_state(await binding_for(db, settings, user["id"]), settings,
                        link=await verified_link(db, settings, user["id"]), state=await _sync_state(db))


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
    _LIST_CACHE.pop(f"me:subject:{doc['subject']}", None)
    return await state(db, user)


async def mark_revoked(db, binding: dict) -> None:
    """Das Modul hat Nein gesagt: die Bindung gilt nicht mehr - sofort, nicht erst beim nächsten Abgleich."""
    await db[COLLECTION].update_one({"id": binding["id"]}, {"$set": {"status": "revoked", "revoked_at": now_utc().isoformat()}})
    _LIST_CACHE.pop(f"me:subject:{binding.get('subject')}", None)


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
    """`dolibarr-12` → 12; Statutenfassungen (`dolibarr-statute-3`) gehören zu `parse_statute_id`."""
    value = str(doc_id or "")
    if value.startswith(STATUTE_PREFIX) or not value.startswith(DOC_PREFIX):
        return None
    rest = value[len(DOC_PREFIX):]
    return int(rest) if rest.isdigit() else None


def parse_statute_id(doc_id: str) -> int | None:
    value = str(doc_id or "")
    rest = value[len(STATUTE_PREFIX):] if value.startswith(STATUTE_PREFIX) else ""
    return int(rest) if rest.isdigit() else None


def _day(value) -> str:
    text = str(value or "")
    return f"{text[8:10]}.{text[5:7]}.{text[0:4]}" if len(text) >= 10 else text


def statute_view(row: dict) -> dict:
    """Eine Statutenfassung in der Form der Vereinsdokumente (Kategorie „Statuten“, geltende Fassung angepinnt)."""
    doc_id = f"{STATUTE_PREFIX}{int(row['id'])}"
    state = str(row.get("state") or "")
    label = STATUTE_STATE_LABELS.get(state, state)
    if state == "future":
        label = f"gilt ab {_day(row.get('valid_from'))}"
    elif state == "repealed":
        label = f"galt {_day(row.get('valid_from'))} bis {_day(row.get('valid_to'))}"
    elif state == "in_force":
        label = f"gilt seit {_day(row.get('valid_from'))}"
    return {
        "id": doc_id, "source": "dolibarr", "title": f"Statuten – Fassung {row.get('version')}", "description": f"{label} · beschlossen am {_day(row.get('decided_on'))}",
        "category": "statutes", "kind": "statute", "what": row.get("source"), "audience": "members", "personal": False, "revision": row.get("version"),
        "statute_state": state, "visibility": "members", "original_filename": f"Statuten-Fassung-{row.get('version')}.pdf", "mime": "application/pdf",
        "file_size": row.get("size"), "pinned": state == "in_force", "allow_download": True,
        "view_url": f"/api/documents/{doc_id}/view", "download_url": f"/api/documents/{doc_id}/download",
        "created_at": row.get("decided_on"), "updated_at": row.get("valid_from"),
    }


async def _statutes_rows(client: DolibarrClient, access: dict | None) -> list[dict]:
    """Die Fassungen, die die Person sehen darf: verbunden die für Mitglieder freigegebenen, sonst die öffentlichen."""
    try:
        data = await client.my_statutes(access["params"]) if access else await client.statutes()
    except DolibarrError as exc:
        logger.warning("[dolibarr] Statuten nicht lesbar: %s", exc.kind)
        return []
    if not isinstance(data, dict) or data.get("state") == "not_published":
        return []
    return [row for row in data.get("versions") or [] if isinstance(row, dict) and row.get("id")]


async def documents_for(db, user: dict) -> list[dict]:
    """Dokumente aus der Akte für die angemeldete Person: mit Bindung die eigenen, sonst die öffentlichen.
    Nie ein Fehler nach außen - ohne Dolibarr gibt es einfach keine."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        return []
    access = await access_for(db, settings, user["id"])
    key = access_key(access) if access else "public"
    cached = _LIST_CACHE.get(key)
    if cached and time.monotonic() - cached[0] < LIST_TTL_SECONDS:
        return [dict(doc) for doc in cached[1]]
    try:
        client = DolibarrClient(settings)
    except DolibarrError:
        return []
    try:
        rows = await client.my_documents(access["params"]) if access else await client.public_documents()
    except DolibarrError as exc:
        if access and exc.kind == "forbidden":
            await forbidden(db, access)
            if access["mode"] == "subject":
                return await documents_for(db, user)
            # Über die Mitgliedsnummer fehlt das Recht: bis der Vorstand es setzt, gibt es das Öffentliche.
            access = None
            try:
                rows = await client.public_documents()
            except DolibarrError as inner:
                logger.warning("[dolibarr] Dokumente nicht lesbar: %s", inner.kind)
                return []
        else:
            logger.warning("[dolibarr] Dokumente nicht lesbar: %s", exc.kind)
            return []
    else:
        if access:
            await member_call_ok(db, access)
    docs = [document_view(row) for row in rows if isinstance(row, dict) and row.get("document_id")]
    docs.extend(statute_view(row) for row in await _statutes_rows(client, access))
    _LIST_CACHE[key] = (time.monotonic(), docs)
    return [dict(doc) for doc in docs]


async def document_pdf(db, user: dict, document_id: int) -> tuple[bytes, dict]:
    """Das PDF einer Fassung: mit Bindung über die Person (das Modul prüft bei jedem Abruf neu, ob sie es
    sehen darf), sonst das öffentliche. Die Bytes müssen zur mitgeschickten Prüfsumme passen."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        raise DolibarrError("not_configured")
    access = await access_for(db, settings, user["id"])
    client = DolibarrClient(settings)
    try:
        data = await client.my_document_pdf(access["params"], document_id) if access else await client.public_document_pdf(document_id)
    except DolibarrError as exc:
        if access and exc.kind == "forbidden":
            await forbidden(db, access)
        raise
    expected = str(data.get("sha256") or "")
    try:
        content = base64.b64decode(str(data.get("content") or ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise DolibarrError("invalid_response", 200) from exc
    if not content or not expected or hashlib.sha256(content).hexdigest() != expected:
        raise DolibarrError("invalid_response", 200)
    return content, data


async def statute_pdf(db, user: dict, version_id: int) -> tuple[bytes, dict]:
    """Das PDF einer Statutenfassung: mit Bindung über die Person, sonst die öffentliche Freigabe; Bytes gegen
    die mitgeschickte Prüfsumme geprüft."""
    settings = await load_settings(db)
    if settings.get("mode") != "live":
        raise DolibarrError("not_configured")
    access = await access_for(db, settings, user["id"])
    client = DolibarrClient(settings)
    try:
        data = await client.my_statute_pdf(access["params"], version_id) if access else await client.statute_pdf(version_id)
    except DolibarrError as exc:
        if access and exc.kind == "forbidden":
            await forbidden(db, access)
        raise
    expected = str(data.get("sha256") or "")
    try:
        content = base64.b64decode(str(data.get("content") or ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise DolibarrError("invalid_response", 200) from exc
    if not content or not expected or hashlib.sha256(content).hexdigest() != expected:
        raise DolibarrError("invalid_response", 200)
    return content, data
