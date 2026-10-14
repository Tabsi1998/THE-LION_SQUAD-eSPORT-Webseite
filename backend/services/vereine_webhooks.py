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
import time
from datetime import timedelta

from pymongo.errors import DuplicateKeyError

from models import now_utc
from database import get_db
from services.dolibarr_applications import refresh_open
from services.dolibarr_client import DolibarrClient, DolibarrError, instance_key, load_settings
from services import dolibarr_sync
from services.dolibarr_sync import queue_member, retry_or_drop
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
# Eintrag in dolibarr_pending, der statt eines Mitglieds die offenen Beitrittsanträge nachliest.
APPLICATIONS_KIND = "applications"


# ---------------------------------------------------------------- Prüfung

def clock() -> float:
    """Die Uhr des Servers für das Zeitfenster - eine eigene Stelle, damit Tests sie festhalten können."""
    return time.time()


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
                # Fester Name statt Variable: Die Meldung nennt nur die Einstellung, nie einen Wert daraus.
                logger.warning("[dolibarr] DOLIBARR_WEBHOOK_SECRETS ist nicht lesbar (erwartet: Schlüssel:Geheimnis, mehrere mit Komma)")
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


def _applications_key(settings: dict) -> str:
    return f"{instance_key(settings)}:{APPLICATIONS_KIND}"


async def queue_applications(db, settings: dict) -> None:
    """Ein Antrag hat sich geändert. Das Ereignis nennt den Antrag des Moduls, die Website kennt nur ihre external_id -
    also alle offenen Anträge nachlesen. Eingereiht wie ein Mitglied: dauerhaft, mit Versuchen, Abstand und Grenze."""
    now = now_utc()
    await db.dolibarr_pending.update_one(
        {"key": _applications_key(settings)},
        {"$set": {"kind": APPLICATIONS_KIND, "instance": instance_key(settings),
                  "due_at": (now + timedelta(seconds=dolibarr_sync.PENDING_DELAY_SECONDS)).isoformat()},
         "$setOnInsert": {"attempts": 0, "created_at": now.isoformat()}},
        upsert=True,
    )


async def process_pending_applications(db=None) -> dict:
    """Der Job (mit process_pending alle 30 s): eingereihte Anträge nachlesen; was nicht lesbar war, später noch einmal."""
    db = db if db is not None else get_db()
    settings = await load_settings(db)
    if settings["mode"] != "live":
        return {"ok": False, "skipped": settings["mode"]}
    entry = await db.dolibarr_pending.find_one({"key": _applications_key(settings), "due_at": {"$lte": now_utc().isoformat()}}, {"_id": 0})
    if not entry:
        return {"ok": True, "processed": 0}
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        await retry_or_drop(db, entry)
        return {"ok": False, "error": exc.kind}
    result = await refresh_open(db, settings, client)
    if result["failed"]:
        await retry_or_drop(db, entry)
        return {"ok": False, **result}
    await db.dolibarr_pending.delete_one({"key": entry["key"]})
    return {"ok": True, "processed": 1, **result}


async def handle(db, settings: dict, event: dict) -> str:
    """Gezielt verarbeiten. Liefert ``queued``, ``applications``, ``ignored`` oder ``skipped``.

    Verarbeitet wird nie im Request, sondern dauerhaft eingereiht (``dolibarr_pending``, mit Versuchen, Abstand und
    Grenze; der Job läuft alle 30 s). Erst nach dem Einreihen antwortet der Empfänger mit 200. Scheitert schon das
    Einreihen, fliegt die Ausnahme durch: 5xx, die Ereignis-Kennung wird wieder vergessen, das Modul wiederholt."""
    if settings.get("mode") != "live":
        return "skipped"
    object_type = event["object_type"]
    if object_type in MEMBER_TYPES:
        # Mitglied angelegt, geändert, gelöscht, Beitrag oder Einwilligung: die Zusammenfassung neu lesen.
        # process_pending übernimmt Stand und Verzeichnis-Eintrag (sync_directory_entry) und beendet bei 404.
        await queue_member(db, settings, event["object_id"])
        return "queued"
    if object_type == "application":
        # Die Kennung ist die des Moduls; die Website kennt nur ihre external_id - also alle offenen Anträge.
        await queue_applications(db, settings)
        return "applications"
    # Funktionen holt der regelmäßige Abgleich, Abstimmungen und Versammlungen ein eigener Job;
    # unbekannte Arten eines neueren Moduls werden angenommen, damit das Modul nicht vergeblich wiederholt.
    return "ignored"
