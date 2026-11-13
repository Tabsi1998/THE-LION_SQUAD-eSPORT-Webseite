"""Browser-Benachrichtigungen (Web-Push, #1163).

Neben dem App-Push (``push_notifications``) gehen Meldungen auch an Browser, die sich angemeldet haben - am PC und im
Handy-Browser, am iPhone nur mit der Website auf dem Home-Bildschirm. Es gelten dieselben Regeln: Themen und Kanäle aus
den Einstellungen der Person, der neue Kanal heißt „Browser“ (``notification_preferences``).

Verschlüsselt wird nach RFC 8291 (``aes128gcm``), angemeldet beim Push-Dienst mit VAPID (RFC 8292) - beides mit
``cryptography`` und ``PyJWT``, die das Backend schon hat; verschickt wird mit ``httpx`` wie beim App-Push.

Die Schlüssel kommen nur aus der Server-Konfiguration (``WEB_PUSH_VAPID_PRIVATE_KEY``, ``WEB_PUSH_VAPID_PUBLIC_KEY``,
``WEB_PUSH_CONTACT``; ``docs/BETRIEB.md``). Fehlen sie, ist Web-Push still aus: kein Fehler, kein Knopf auf der Website.
Schlüssel erzeugen: ``python -m services.web_push --generate`` im Backend-Container.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import struct
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from database import get_db
from models import now_utc
from services.log_safe import log_safe

logger = logging.getLogger("tls.web_push")

# Wie lange ein Push-Dienst eine Meldung für einen ausgeschalteten Rechner aufhebt (``WEB_PUSH_TTL_SECONDS``). Ein Aufruf von
# gestern hilft niemandem.
DEFAULT_TTL_SECONDS = 6 * 60 * 60
RECORD_SIZE = 4096
MAX_SUBSCRIPTIONS_PER_USER = 20
TITLE_LIMIT = 120
BODY_LIMIT = 180
# Nur bekannte Push-Dienste der Browser: Chrome/Edge/Opera (Google), Firefox (Mozilla), Safari (Apple), alte Edge (WNS).
# Weitere Dienste nimmt ``WEB_PUSH_EXTRA_HOSTS`` auf (Komma-Liste, etwa für einen eigenen Dienst).
PUSH_SERVICE_HOSTS = (
    "fcm.googleapis.com",
    "android.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "web.push.apple.com",
    "push.apple.com",
    "notify.windows.com",
)
# Knöpfe in der Meldung (#1163): nur für Arten, deren Ziel die Seite der Handlung ist. Ein Knopf öffnet immer eine Seite -
# im Hintergrund passiert nichts.
ACTION_LABELS = {
    "tournament_checkin": ("checkin", "Jetzt einchecken"),
    "match_call": ("open_match", "Zum Spiel"),
    "match_station": ("open_match", "Zum Spiel"),
    "match_reminder": ("open_match", "Zum Spiel"),
    "direct_message": ("reply", "Antworten"),
}
# Aufrufe dürfen den Rechner wecken; Erfolge und Vereinsnews nicht.
HIGH_URGENCY_KINDS = {"match_call", "match_station", "match_reminder", "tournament_checkin", "team_presence_nudge"}
LOW_URGENCY_KINDS = {"achievement", "level", "prestige", "crown_gained", "crown_changed", "crown_lost", "year_review"}


def _b64url_decode(value: str) -> bytes:
    text = str(value or "").strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _load_private_key(raw: str) -> ec.EllipticCurvePrivateKey | None:
    """Der private VAPID-Schlüssel: 32 Byte base64url (wie ``web-push generate-vapid-keys``) oder PEM."""
    text = str(raw or "").strip().replace("\\n", "\n")
    if not text:
        return None
    try:
        if text.startswith("-----BEGIN"):
            key = serialization.load_pem_private_key(text.encode("ascii"), password=None)
            return key if isinstance(key, ec.EllipticCurvePrivateKey) and isinstance(key.curve, ec.SECP256R1) else None
        data = _b64url_decode(text)
        if len(data) != 32:
            return None
        return ec.derive_private_key(int.from_bytes(data, "big"), ec.SECP256R1())
    except (ValueError, TypeError):
        return None


class VapidConfig:
    def __init__(self, private_key: ec.EllipticCurvePrivateKey, contact: str):
        self.private_key = private_key
        self.public_key = _b64url(_public_bytes(private_key.public_key()))
        self.contact = contact


_warned: set[str] = set()


def _warn_once(key: str, message: str) -> None:
    if key not in _warned:
        _warned.add(key)
        logger.warning(message)


def vapid_config(environ: dict[str, str] | None = None) -> VapidConfig | None:
    """Die Schlüssel aus der Konfiguration - oder ``None``: dann ist Web-Push aus."""
    source = environ if environ is not None else os.environ
    private_key = _load_private_key(source.get("WEB_PUSH_VAPID_PRIVATE_KEY", ""))
    if private_key is None:
        if str(source.get("WEB_PUSH_VAPID_PRIVATE_KEY", "")).strip():
            _warn_once("private", "[web-push] WEB_PUSH_VAPID_PRIVATE_KEY ist nicht lesbar - Browser-Benachrichtigungen bleiben aus")
        return None
    contact = str(source.get("WEB_PUSH_CONTACT") or "").strip()
    if not contact:
        admin = str(source.get("SENDER_EMAIL") or source.get("ADMIN_EMAIL") or "").strip()
        contact = f"mailto:{admin}" if admin else ""
    if contact and not contact.startswith(("mailto:", "https://")):
        contact = f"mailto:{contact}"
    if not contact:
        _warn_once("contact", "[web-push] WEB_PUSH_CONTACT fehlt - Browser-Benachrichtigungen bleiben aus")
        return None
    config = VapidConfig(private_key, contact)
    public = str(source.get("WEB_PUSH_VAPID_PUBLIC_KEY") or "").strip()
    if public and public.rstrip("=") != config.public_key:
        _warn_once("pair", "[web-push] WEB_PUSH_VAPID_PUBLIC_KEY passt nicht zum privaten Schlüssel - Browser-Benachrichtigungen bleiben aus")
        return None
    return config


def public_config() -> dict[str, Any]:
    """Was die Website braucht: ob Web-Push an ist und den öffentlichen Schlüssel für die Anmeldung im Browser."""
    config = vapid_config()
    return {"enabled": bool(config), "public_key": config.public_key if config else None}


def _extra_hosts(environ: dict[str, str] | None = None) -> tuple[str, ...]:
    source = environ if environ is not None else os.environ
    return tuple(part.strip().lower() for part in str(source.get("WEB_PUSH_EXTRA_HOSTS") or "").split(",") if part.strip())


def endpoint_allowed(endpoint: str, environ: dict[str, str] | None = None) -> bool:
    """Nur https zu einem bekannten Push-Dienst, ohne Zugangsdaten und fremden Port in der Adresse."""
    try:
        parts = urlsplit(str(endpoint or ""))
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or parts.username or parts.password or port not in (None, 443):
        return False
    hosts = PUSH_SERVICE_HOSTS + _extra_hosts(environ)
    return any(host == known or host.endswith("." + known) for known in hosts)


def endpoint_hash(endpoint: str) -> str:
    return hashlib.sha256(str(endpoint or "").encode("utf-8")).hexdigest()


def browser_label(user_agent: str | None) -> str:
    """Kurzer Name für die Liste („Chrome unter Windows“) - der ganze User-Agent wird nicht gespeichert."""
    ua = str(user_agent or "").lower()
    browser = next((name for needle, name in (
        ("edg/", "Edge"), ("opr/", "Opera"), ("samsungbrowser", "Samsung Internet"), ("firefox", "Firefox"),
        ("fxios", "Firefox"), ("crios", "Chrome"), ("chrome", "Chrome"), ("safari", "Safari"),
    ) if needle in ua), "Browser")
    system = next((name for needle, name in (
        ("iphone", "iPhone"), ("ipad", "iPad"), ("android", "Android"), ("windows", "Windows"),
        ("mac os", "macOS"), ("cros", "ChromeOS"), ("linux", "Linux"),
    ) if needle in ua), "")
    return f"{browser} unter {system}" if system else browser


def valid_keys(p256dh: str, auth: str) -> bool:
    try:
        public = _b64url_decode(p256dh)
        secret = _b64url_decode(auth)
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
    except (ValueError, TypeError):
        return False
    return len(public) == 65 and len(secret) == 16


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt_payload(plaintext: bytes, p256dh: str, auth: str, *, salt: bytes | None = None,
                    server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """Inhalt für einen Browser verschlüsseln (RFC 8291, ``aes128gcm``, ein Datensatz)."""
    ua_public_bytes = _b64url_decode(p256dh)
    auth_secret = _b64url_decode(auth)
    ua_public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public_bytes)
    as_private = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public_bytes = _public_bytes(as_private.public_key())
    shared = as_private.exchange(ec.ECDH(), ua_public)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public_bytes + as_public_bytes, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    if len(plaintext) + 17 > RECORD_SIZE:
        raise ValueError("Inhalt zu groß für einen Web-Push")
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + struct.pack("!L", RECORD_SIZE) + struct.pack("!B", len(as_public_bytes)) + as_public_bytes
    return header + ciphertext


def vapid_headers(endpoint: str, config: VapidConfig, now: float | None = None) -> dict[str, str]:
    parts = urlsplit(endpoint)
    claims = {"aud": f"{parts.scheme}://{parts.netloc}", "exp": int((now or time.time()) + 12 * 60 * 60), "sub": config.contact}
    token = jwt.encode(claims, config.private_key, algorithm="ES256")
    return {"Authorization": f"vapid t={token}, k={config.public_key}"}


def safe_path(url: Any, base_url: str = "") -> str:
    """Das Ziel einer Meldung als Pfad dieser Website. Fremde Adressen werden zur Startseite des Postfachs."""
    raw = str(url or "").strip()
    if not raw:
        return "/notifications"
    if raw.startswith("/") and not raw.startswith("//") and "\\" not in raw:
        return raw
    try:
        target = urlsplit(raw)
        base = urlsplit(base_url) if base_url else None
    except ValueError:
        return "/notifications"
    if base and target.scheme in ("http", "https") and target.netloc and target.netloc.lower() == base.netloc.lower():
        path = target.path or "/"
        return path + (f"?{target.query}" if target.query else "") + (f"#{target.fragment}" if target.fragment else "")
    return "/notifications"


def build_payload(notification: dict[str, Any], base_url: str = "") -> dict[str, Any]:
    """Was der Browser zeigt: Titel, Text, Ziel und Knöpfe - nur Text, nie HTML."""
    kind = str(notification.get("kind") or "")
    meta = notification.get("meta") or {}
    path = safe_path(notification.get("url"), base_url)
    payload: dict[str, Any] = {
        "title": str(notification.get("title") or "THE LION SQUAD")[:TITLE_LIMIT],
        "body": str(meta.get("push_body") or notification.get("body") or "")[:BODY_LIMIT],
        "url": path,
        "tag": str(notification.get("id") or ""),
        "kind": kind,
    }
    action = ACTION_LABELS.get(kind)
    # Ein Knopf nur mit eigenem Ziel auf dieser Website - ohne Ziel bleibt es beim Tipp auf die Meldung.
    if action and notification.get("url") and path != "/notifications":
        payload["actions"] = [{"action": action[0], "title": action[1], "url": path}]
    return payload


async def _site_base(db) -> str:
    """Die Adresse der Website - um eigene absolute Links als Pfad zu erkennen (wie ``user_notifications.build_public_url``,
    ohne dorthin zu importieren: das gäbe einen Import-Kreis)."""
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    base = (os.environ.get("FRONTEND_URL") or branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    return base or "https://lionsquad.at"


def ttl_seconds(environ: dict[str, str] | None = None) -> int:
    source = environ if environ is not None else os.environ
    try:
        value = int(str(source.get("WEB_PUSH_TTL_SECONDS") or DEFAULT_TTL_SECONDS).strip())
    except ValueError:
        return DEFAULT_TTL_SECONDS
    return max(60, min(value, 7 * 24 * 60 * 60))


def _urgency(kind: str) -> str:
    if kind in HIGH_URGENCY_KINDS:
        return "high"
    if kind in LOW_URGENCY_KINDS:
        return "low"
    return "normal"


async def send_web_push_for_notification(notification: dict[str, Any]) -> int:
    """Eine Meldung an alle angemeldeten Browser der Person. Gibt zurück, wie viele der Push-Dienst angenommen hat."""
    user_id = notification.get("user_id")
    if not user_id:
        return 0
    from services.outbound_guard import outbound_disabled

    if outbound_disabled():
        return 0
    config = vapid_config()
    if not config:
        return 0
    db = get_db()
    rows = await active_subscriptions(db, user_id, {"id": 1, "endpoint": 1, "p256dh": 1, "auth": 1})
    if not rows:
        return 0
    base_url = await _site_base(db)
    body = json.dumps(build_payload(notification, base_url), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    kind = str(notification.get("kind") or "")
    sent = 0
    gone: list[str] = []
    now = now_utc().isoformat()
    async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
        for row in rows:
            endpoint = row.get("endpoint") or ""
            if not endpoint_allowed(endpoint):
                gone.append(row.get("id"))
                continue
            try:
                content = encrypt_payload(body, row.get("p256dh") or "", row.get("auth") or "")
                headers = {
                    **vapid_headers(endpoint, config),
                    "Content-Encoding": "aes128gcm",
                    "Content-Type": "application/octet-stream",
                    "TTL": str(ttl_seconds()),
                    "Urgency": _urgency(kind),
                }
                response = await client.post(endpoint, content=content, headers=headers)
            except Exception:
                logger.warning("[web-push] Versand an einen Browser fehlgeschlagen (Meldung %s)", log_safe(notification.get("id")), exc_info=True)
                continue
            if response.status_code in (404, 410):
                # Der Browser hat sich abgemeldet oder die Anmeldung ist abgelaufen - sie wird nicht mehr gebraucht.
                gone.append(row.get("id"))
                continue
            if 200 <= response.status_code < 300:
                sent += 1
                await db.web_push_subscriptions.update_one(
                    {"id": row.get("id")}, {"$set": {"last_sent_at": now}, "$unset": {"last_error": ""}},
                )
                continue
            logger.warning("[web-push] Push-Dienst antwortet %s (Meldung %s)", response.status_code, log_safe(notification.get("id")))
            await db.web_push_subscriptions.update_one(
                {"id": row.get("id")}, {"$set": {"last_error": f"HTTP {response.status_code}", "last_error_at": now}},
            )
    if gone:
        await db.web_push_subscriptions.delete_many({"id": {"$in": gone}})
    return sent


def _as_utc(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


async def active_subscriptions(db, user_id: str | None, projection: dict | None = None) -> list[dict]:
    """Die Browser-Anmeldungen der Person, deren Sitzung noch gilt - eine beendete oder abgelaufene Sitzung bekommt nichts."""
    if not user_id:
        return []
    fields = {"_id": 0, "session_family": 1, **(projection or {})}
    rows = await db.web_push_subscriptions.find({"user_id": user_id}, fields).to_list(MAX_SUBSCRIPTIONS_PER_USER)
    families = sorted({row.get("session_family") for row in rows if row.get("session_family")})
    if not families:
        return []
    sessions = await db.auth_sessions.find(
        {"user_id": user_id, "family_id": {"$in": families}},
        {"_id": 0, "family_id": 1, "revoked": 1, "expires_at": 1},
    ).to_list(len(families) * 2)
    now = datetime.now(timezone.utc)
    valid = set()
    for session in sessions:
        expires = _as_utc(session.get("expires_at"))
        if not session.get("revoked") and (expires is None or expires > now):
            valid.add(session.get("family_id"))
    return [row for row in rows if row.get("session_family") in valid]


async def has_browser_subscription(db, user_id: str | None) -> bool:
    """Hat die Person einen angemeldeten Browser mit gültiger Sitzung - und ist Web-Push überhaupt eingerichtet?"""
    if not user_id or not vapid_config():
        return False
    try:
        return bool(await active_subscriptions(db, user_id))
    except Exception:
        return False


async def forget_session(db, user_id: str | None, family_id: str | None) -> int:
    """Abmelden (#1163): die Browser-Anmeldung, die in dieser Sitzung entstand, geht mit."""
    if not user_id or not family_id:
        return 0
    result = await db.web_push_subscriptions.delete_many({"user_id": user_id, "session_family": family_id})
    return int(getattr(result, "deleted_count", 0) or 0)


async def forget_other_sessions(db, user_id: str | None, keep_family: str | None = None) -> int:
    """Alle Sitzungen enden (Passwort geändert oder zurückgesetzt, Zwei-Faktor aus, überall abmelden): die Browser-
    Anmeldungen gehen mit - außer der der Sitzung, die bleibt."""
    if not user_id:
        return 0
    query: dict[str, Any] = {"user_id": user_id}
    if keep_family:
        query["session_family"] = {"$ne": keep_family}
    result = await db.web_push_subscriptions.delete_many(query)
    return int(getattr(result, "deleted_count", 0) or 0)


def generate_keys() -> dict[str, str]:
    """Ein neues Schlüsselpaar für ``.env`` - einmal erzeugen und dann nicht mehr wechseln (sonst melden sich alle
    Browser neu an)."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    return {"WEB_PUSH_VAPID_PRIVATE_KEY": _b64url(private), "WEB_PUSH_VAPID_PUBLIC_KEY": _b64url(_public_bytes(key.public_key()))}


if __name__ == "__main__":  # pragma: no cover - Betriebsbefehl
    if "--generate" in sys.argv:
        for name, value in generate_keys().items():
            print(f"{name}={value}")
    else:
        print("Aufruf: python -m services.web_push --generate")
