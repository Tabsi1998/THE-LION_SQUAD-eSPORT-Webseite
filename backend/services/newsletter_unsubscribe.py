"""Newsletter mit einem Klick abbestellen (#2119 ML4).

Jede Newsletter-Mail trägt einen Abmeldelink ohne Login und die Kopfzeilen `List-Unsubscribe` und
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058) - Gmail und Yahoo verlangen das für Massenversand.
Der Schlüssel im Link ist die Kontokennung mit einer Signatur (HMAC mit dem Server-Geheimnis): er läuft nicht ab, taugt
nur zum Abbestellen und lässt sich für ein anderes Konto nicht basteln.

Ein GET ändert nie etwas (Linkvorschau, Virenscanner) - die Seite im Link fragt nach, erst das POST meldet ab.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

from models import new_id, now_utc

PURPOSE = "newsletter-unsubscribe"
API_PATH = "/api/settings/newsletter/unsubscribe"
PAGE_PATH = "/newsletter/abbestellen"


def _secret() -> bytes:
    """Ein eigener, aus dem Server-Geheimnis (JWT_SECRET) abgeleiteter Schlüssel nur für diese Links - wie beim
    Formular-Token (services/spam_guard). Ohne JWT_SECRET gibt es in Produktion keinen Link; lokal und in Tests gilt ein
    fester Ersatz wie beim Schlüsselspeicher (services/secret_store)."""
    configured = os.environ.get("JWT_SECRET", "").strip()
    if not configured:
        if os.environ.get("APP_ENV", "development").strip().lower() in {"production", "prod"}:
            raise RuntimeError("JWT_SECRET is required in production.")
        configured = "tls-local-development-newsletter-unsubscribe"
    return hmac.new(configured.encode("utf-8"), b"newsletter-unsubscribe-key-v1", hashlib.sha256).digest()


def _signature(user_id: str) -> str:
    digest = hmac.new(_secret(), f"{PURPOSE}:{user_id}".encode("utf-8"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")[:32]


def token_for(user_id: str) -> str:
    return f"{user_id}.{_signature(user_id)}"


def user_id_from(token: str | None) -> str | None:
    """Die Kontokennung zu einem gültigen Schlüssel - sonst None."""
    user_id, _, signature = str(token or "").strip().rpartition(".")
    if not user_id or not signature or len(user_id) > 80:
        return None
    # Als Bytes vergleichen: ein Schlüssel mit Umlauten o. Ä. ist einfach ungültig, kein Serverfehler.
    return user_id if hmac.compare_digest(_signature(user_id).encode("utf-8"), signature.encode("utf-8")) else None


def links_for(base: str, user_id: str) -> dict:
    """Seite im Mailtext und Adresse für die Kopfzeile."""
    token = token_for(user_id)
    return {"page": f"{base}{PAGE_PATH}?token={token}", "api": f"{base}{API_PATH}?token={token}"}


def mail_headers(api_url: str) -> dict[str, str]:
    return {"List-Unsubscribe": f"<{api_url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}


async def unsubscribe(db, token: str | None) -> dict | None:
    """Newsletter-Einwilligung zurücknehmen. None bei ungültigem Schlüssel; „already“, wenn sie schon weg war."""
    user_id = user_id_from(token)
    if not user_id:
        return None
    if not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        return None
    now = now_utc()
    # Bedingt und in einem Schritt: zwei gleichzeitige Klicks (Mail-Programm und Seite) widerrufen und protokollieren
    # nur einmal.
    result = await db.users.update_one({"id": user_id, "newsletter_consent": True},
                                       {"$set": {"newsletter_consent": False, "updated_at": now.isoformat()}})
    if getattr(result, "modified_count", 0) != 1:
        return {"ok": True, "already": True}
    # Wie bei der Registrierung: die Entscheidung steht als Einwilligungs-Eintrag, hier als Widerruf.
    await db.consent_records.insert_one({"id": new_id(), "user_id": user_id, "consent_type": "newsletter", "policy_version": "1",
                                         "granted": False, "source": "mail_unsubscribe", "created_at": now})
    await db.audit_logs.insert_one({"id": new_id(), "action": "newsletter.unsubscribe", "actor_id": user_id, "target_id": user_id,
                                    "data": {"source": "mail_link"}, "created_at": now.isoformat()})
    return {"ok": True, "already": False}
