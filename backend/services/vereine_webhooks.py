"""Signierte Webhooks des Vereinsmoduls empfangen (#1540).

Das Modul „Vereine“ meldet Änderungen als signierten, zeitgebundenen Hinweis (``docs/API.md`` des Moduls,
Abschnitt „Signierte Webhooks“). Der Body nennt nur Objektart, Kennung, Revision, Änderungsart und Zeitpunkt; die
Daten liest die Website danach über die API - mit denselben Abgleich-Funktionen wie der regelmäßige Abgleich.

Geprüft wird in der Reihenfolge der Spezifikation:

1. Kopf ``Vereine-Signature: v1=<hex>,t=<Sekunden>,k=<Schlüssel>,e=<Ereignis>`` lesbar,
2. Schlüssel bekannt (bei einem Schlüsselwechsel zwei),
3. Zeitpunkt höchstens ``TOLERANCE_SECONDS`` neben der Uhr des Servers,
4. HMAC-SHA-256 über ``v1.<t>.<Body-Bytes>`` stimmt - in konstanter Zeit verglichen, über die Bytes, nie über das
   geparste JSON,
5. Ereignis-Kennung noch nicht gesehen. Zustellung ist „mindestens einmal“: eine Wiederholung bekommt 200, wird
   aber nicht noch einmal verarbeitet.

Das Geheimnis kommt aus der Server-Umgebung (``DOLIBARR_WEBHOOK_SECRETS``, ``<Schlüssel>:<Geheimnis>``, mehrere
durch Komma getrennt) oder verschlüsselt aus den Dolibarr-Einstellungen. Ohne Geheimnis bleibt der Empfänger zu.
In die Logs kommen weder Signatur noch Geheimnis noch Mitgliedsnummern.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from models import now_utc
from services.dolibarr_applications import coupled, refresh
from services.dolibarr_client import DolibarrClient, DolibarrError, instance_key
from services.dolibarr_sync import queue_member
from services.secret_store import decrypt_secret

logger = logging.getLogger("tls.dolibarr.webhook")

HEADER = "Vereine-Signature"
VERSION = "v1"
TOLERANCE_SECONDS = 300
# Der Body ist ein paar hundert Bytes groß; alles darüber ist kein Hinweis des Moduls.
MAX_BODY_BYTES = 16 * 1024
# So lange bleibt eine Ereignis-Kennung gemerkt. Das Modul wiederholt höchstens rund elf Stunden lang;
# ein späteres Anstoßen von Hand liest nur noch einmal nach und schadet nicht.
SEEN_DAYS = 7
SECRETS_ENV = "DOLIBARR_WEBHOOK_SECRETS"
MIN_SECRET_LENGTH = 32
PATH = "/api/integrations/dolibarr/vereine-webhook"

KEY_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")
EVENT_ID_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,128}")
# Objektarten des Moduls (Änderungsfeed). Die Kennung bei membership, fee und consent ist das Mitglied.
OBJECT_TYPES = ("membership", "function", "fee", "application", "consent", "document", "ballot", "meeting")
MEMBER_TYPES = ("membership", "fee", "consent")


# ---------------------------------------------------------------- Prüfung

def read_header(value: str | None) -> dict | None:
    """Was der Kopf trägt - None, wenn er nicht vom Modul stammt (wie ``VereineHookRules::readHeader``)."""
    parts: dict[str, str] = {}
    for piece in str(value or "").split(","):
        name, sep, rest = piece.partition("=")
        if not sep:
            return None
        parts[name.strip()] = rest.strip()
    signature, stamp, key_id, event_id = (parts.get(VERSION), parts.get("t"), parts.get("k"), parts.get("e"))
    if signature is None or stamp is None or key_id is None or event_id is None:
        return None
    if not re.fullmatch(r"[0-9a-f]{64}", signature) or not re.fullmatch(r"\d{1,12}", stamp):
        return None
    return {"signature": signature, "timestamp": int(stamp), "key_id": key_id, "event_id": event_id}


def signature(secret: str, body: bytes, timestamp: int) -> str:
    return hmac.new(secret.encode("utf-8"), f"{VERSION}.{int(timestamp)}.".encode("ascii") + body, hashlib.sha256).hexdigest()


def verify(header: str | None, body: bytes, secrets: dict[str, str], now: float) -> str:
    """Leer, wenn die Zustellung echt und frisch ist; sonst, welche Prüfung scheiterte."""
    parts = read_header(header)
    if parts is None:
        return "header"
    secret = secrets.get(parts["key_id"])
    if not secret:
        return "key"
    if abs(int(now) - parts["timestamp"]) > TOLERANCE_SECONDS:
        return "expired"
    expected = signature(secret, body, parts["timestamp"])
    # Konstante Zeit: ein Vergleich, der beim ersten falschen Zeichen aufhört, verrät, wie weit jemand kam.
    return "" if hmac.compare_digest(expected, parts["signature"]) else "signature"


def configured_secrets(settings: dict) -> dict[str, str]:
    """Schlüssel → Geheimnis aus der Server-Umgebung und den verschlüsselten Einstellungen."""
    secrets: dict[str, str] = {}
    raw = os.environ.get(SECRETS_ENV, "").strip()
    if raw:
        parsed: dict[str, str] = {}
        for entry in raw.split(","):
            key_id, sep, secret = entry.strip().partition(":")
            key_id, secret = key_id.strip(), secret.strip()
            if not sep or not KEY_ID_PATTERN.fullmatch(key_id) or len(secret) < MIN_SECRET_LENGTH:
                # Ein kaputter Eintrag öffnet nichts - lieber gar kein Schlüssel als ein halber.
                logger.warning("[dolibarr] %s ist nicht lesbar (erwartet: Schlüssel:Geheimnis, mehrere mit Komma)", SECRETS_ENV)
                parsed = {}
                break
            parsed[key_id] = secret
        secrets.update(parsed)
    key_id = str(settings.get("signed_webhook_key_id") or "").strip()
    try:
        secret = decrypt_secret(settings.get("signed_webhook_secret"))
    except RuntimeError:
        logger.warning("[dolibarr] Geheimnis des signierten Webhooks nicht entschlüsselbar")
        secret = ""
    if key_id and len(secret) >= MIN_SECRET_LENGTH:
        secrets.setdefault(key_id, secret)
    return secrets


def secret_source(settings: dict) -> str | None:
    if os.environ.get(SECRETS_ENV, "").strip() and configured_secrets({}):
        return "env"
    return "settings" if configured_secrets(settings) else None


def legacy_enabled(settings: dict) -> bool:
    """Der ältere Weg (Token in der Adresse) bleibt bis zur Umstellung an, solange ihn niemand abschaltet."""
    return settings.get("legacy_webhook_enabled") is not False


def parse_event(body: bytes, event_id: str) -> dict | None:
    """Der Body des Moduls - None, wenn er nicht dessen Form hat oder eine andere Kennung trägt als der Kopf."""
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or data.get("version") != VERSION or data.get("event_id") != event_id:
        return None
    if not EVENT_ID_PATTERN.fullmatch(event_id):
        return None
    object_type, change, object_id = data.get("object_type"), data.get("change"), data.get("object_id")
    if not isinstance(object_type, str) or not re.fullmatch(r"[a-z_]{1,32}", object_type):
        return None
    if not isinstance(change, str) or not re.fullmatch(r"[a-z_]{1,32}", change):
        return None
    if isinstance(object_id, bool) or not isinstance(object_id, int) or object_id < 1:
        return None
    return {"event_id": event_id, "object_type": object_type, "object_id": object_id, "change": change}


# ---------------------------------------------------------------- Einmal verarbeiten

def _key(settings: dict, event_id: str) -> str:
    return f"{instance_key(settings)}:{event_id}"


async def remember(db, settings: dict, event: dict) -> bool:
    """True, wenn das Ereignis neu ist. Der eindeutige Index entscheidet, auch bei zwei Zustellungen zugleich."""
    now = now_utc()
    try:
        result = await db.dolibarr_webhook_events.update_one({"key": _key(settings, event["event_id"])}, {"$setOnInsert": {
            "event_id": event["event_id"], "object_type": event["object_type"],
            "received_at": now.isoformat(), "expires_at": now + timedelta(days=SEEN_DAYS),
        }}, upsert=True)
    except DuplicateKeyError:
        return False
    return result.upserted_id is not None


async def forget(db, settings: dict, event_id: str) -> None:
    """Die Verarbeitung ist gescheitert: die Wiederholung des Moduls darf es noch einmal versuchen."""
    await db.dolibarr_webhook_events.delete_one({"key": _key(settings, event_id)})


async def refresh_open_applications(db, settings: dict) -> int:
    """Ein Antrag hat sich geändert: offene Anträge gleich nachlesen statt beim nächsten Lauf."""
    if not coupled(settings):
        return 0
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        logger.warning("[dolibarr] Anträge nicht nachlesbar: %s", exc.kind)
        return 0
    checked = 0
    async for doc in db.membership_applications.find({"status": "pending", "external_id": {"$exists": True}}, {"_id": 0}):
        await refresh(db, settings, client, doc, force=True)
        checked += 1
    return checked


async def handle(db, settings: dict, event: dict, later=None) -> str:
    """Gezielt verarbeiten. Liefert ``queued``, ``applications``, ``ignored`` oder ``skipped``.

    ``later(func, *args)`` hängt Arbeit hinter die Antwort (FastAPI ``BackgroundTasks.add_task``), damit das Modul
    nicht auf Dolibarr-Abfragen wartet; ohne ``later`` läuft sie gleich."""
    if settings.get("mode") != "live":
        return "skipped"
    object_type = event["object_type"]
    if object_type in MEMBER_TYPES:
        # Mitglied angelegt, geändert, gelöscht, Beitrag oder Einwilligung: die Zusammenfassung neu lesen.
        # process_pending übernimmt Stand und Verzeichnis-Eintrag (sync_directory_entry) und beendet bei 404.
        await queue_member(db, settings, event["object_id"])
        return "queued"
    if object_type == "application":
        if later is not None:
            later(refresh_open_applications, db, settings)
        else:
            await refresh_open_applications(db, settings)
        return "applications"
    # Funktionen holt der regelmäßige Abgleich, Abstimmungen und Versammlungen ein eigener Job;
    # unbekannte Arten eines neueren Moduls werden angenommen, damit das Modul nicht vergeblich wiederholt.
    return "ignored"
