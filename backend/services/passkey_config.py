"""Passkeys: ob sie für diese Website gehen, welche App-Herkunft zählt, und das Ticket nach einer Passwort-Anmeldung
in der App (#217, #919; #1420: aus routes/passkey_routes.py herausgelöst).

Die Anmeldung (routes/auth_routes.py) stellt das Ticket aus, ohne die Passkey-Routen zu importieren - die importieren
nämlich die Anmeldung.
"""
from __future__ import annotations

import ipaddress
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from webauthn.helpers import bytes_to_base64url

from auth import hash_token
from models import now_utc

# App-Herkunft (#217 Stufe 2): Android nennt statt einer https-Adresse den SHA-256 des
# Signaturschlüssels der App (base64url, ohne Füllzeichen). Standard sind:
# - der Upload-Schlüssel seit Build 57 (APK vom Vereinsserver),
# - der am 23.09. als Play-Schlüssel eingetragene Fingerabdruck (#394) - bleibt, bis die Play Console
#   zeigt, ob er ein älterer Schlüssel ist,
# - der Schlüssel, mit dem Google Play die App tatsächlich signiert: so meldet ihn ein Handy mit der
#   Play-Fassung (Server-Log vom 05.10., #945).
# Weitere Hashes (etwa ein Debug-Zertifikat auf einem Testserver) kommen über die Umgebung, mit oder
# ohne Doppelpunkte. (Die Fingerabdrücke sind öffentlich - sie stehen in assetlinks.json; die
# Doppelpunkte sind die Schreibweise der Android-Werkzeuge.)
DEFAULT_APK_KEY_HASHES = (
    "6F:69:A2:89:E8:A4:C7:3E:21:53:35:5A:9F:24:90:64:D1:2B:2F:98:E7:8A:30:72:E9:84:D1:18:0E:1D:CB:98,"
    "1D:10:7A:DD:2E:64:AF:1B:04:E4:87:5D:A9:26:6B:F9:65:63:2A:91:F8:54:AF:B8:90:8F:FB:56:A2:EC:BA:26,"
    "C1:A2:FF:35:6C:05:CB:FB:F8:A3:7F:92:6D:A2:6E:DB:4F:E4:61:83:F1:96:08:9C:E2:A1:15:9A:57:D4:2E:A1"
)


APK_ORIGIN_PREFIX = "android:apk-key-hash:"


def mobile_origins() -> list[str]:
    origins = []
    for item in os.environ.get("PASSKEY_APK_KEY_HASHES", DEFAULT_APK_KEY_HASHES).split(","):
        clean = item.strip().lower().replace(":", "")
        if re.fullmatch(r"[0-9a-f]{64}", clean):
            origins.append(APK_ORIGIN_PREFIX + bytes_to_base64url(bytes.fromhex(clean)))
    return origins


def passkey_configuration():
    if os.environ.get("PASSKEY_ENABLED", "true").lower() != "true":
        return None
    try:
        parsed = urlsplit(os.environ.get("FRONTEND_URL", "").strip())
        local = parsed.hostname == "localhost" and os.environ.get("APP_ENV", "development") not in {"production", "prod"}
        if not parsed.hostname or (parsed.scheme != "https" and not (local and parsed.scheme == "http")):
            return None
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
            return None
        if parsed.port and not local and parsed.port != 443:
            return None
        try:
            ipaddress.ip_address(parsed.hostname)
        except ValueError:
            pass
        else:
            return None
        authority = parsed.hostname.lower()
        if parsed.port and not (parsed.scheme == "https" and parsed.port == 443) and not (parsed.scheme == "http" and parsed.port == 80):
            authority += f":{parsed.port}"
        return {"origin": f"{parsed.scheme}://{authority}", "rp_id": parsed.hostname.lower(), "secure": parsed.scheme == "https"}
    except ValueError:
        return None


ENROLL_MINUTES = 10


async def issue_enroll_ticket(db, user_id: str) -> str | None:
    """Nach einer Passwort-Anmeldung in der App (#919): ein Ticket, mit dem die App gleich einen Passkey anlegen darf -
    zehn Minuten, einmal, nur für dieses Konto. Ohne Passkeys für die App gibt es keins."""
    if not passkey_configuration() or not mobile_origins():
        return None
    ticket = secrets.token_urlsafe(32)
    await db.passkey_challenges.insert_one({"_id": hash_token(ticket), "kind": "mobile-enroll", "user_id": user_id,
                                            "expires_at": now_utc() + timedelta(minutes=ENROLL_MINUTES)})
    return ticket
