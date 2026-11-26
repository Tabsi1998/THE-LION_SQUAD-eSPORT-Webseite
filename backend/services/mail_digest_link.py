"""Zurück auf Einzelmails mit einem Klick (#1662, Fabians Entscheidung 26.11.).

Jede Sammel-Mail trägt einen Link ohne Login. Wie bei der Newsletter-Abmeldung (services/newsletter_unsubscribe.py): Der
Schlüssel ist die Kontokennung mit einer Signatur (HMAC mit einem eigenen, aus dem Server-Geheimnis abgeleiteten Schlüssel
und eigenem Zweck) - er taugt nur hierfür, lässt sich für ein anderes Konto nicht basteln und wirkt nur auf
``mail_digest = instant``, sonst auf nichts.

Ein GET ändert nie etwas (Linkvorschau, Virenscanner): Die Seite im Link fragt nach, erst das POST stellt um.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

from models import now_utc

PURPOSE = "mail-digest-instant"
API_PATH = "/api/settings/notification-digest/instant"
PAGE_PATH = "/sammel-mail/einzeln"


def _secret() -> bytes:
    """Ein eigener Schlüssel nur für diese Links - wie bei der Newsletter-Abmeldung aus JWT_SECRET abgeleitet, in Produktion
    Pflicht; lokal und in Tests ein fester Ersatz."""
    configured = os.environ.get("JWT_SECRET", "").strip()
    if not configured:
        if os.environ.get("APP_ENV", "development").strip().lower() in {"production", "prod"}:
            raise RuntimeError("JWT_SECRET is required in production.")
        configured = "tls-local-development-mail-digest-instant"
    return hmac.new(configured.encode("utf-8"), b"mail-digest-instant-key-v1", hashlib.sha256).digest()


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
    return user_id if hmac.compare_digest(_signature(user_id).encode("utf-8"), signature.encode("utf-8")) else None


def links_for(base: str, user_id: str) -> dict:
    return {"page": f"{base}{PAGE_PATH}?token={token_for(user_id)}"}


async def switch_to_instant(db, token: str | None) -> dict | None:
    """Rhythmus auf „sofort“. None bei ungültigem Schlüssel; „already“, wenn er schon so stand."""
    user_id = user_id_from(token)
    if not user_id or not await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1}):
        return None
    result = await db.users.update_one({"id": user_id, "mail_digest": {"$ne": "instant"}},
                                       {"$set": {"mail_digest": "instant", "updated_at": now_utc().isoformat()}})
    if getattr(result, "modified_count", 0) != 1:
        return {"ok": True, "rhythm": "instant", "already": True}
    return {"ok": True, "rhythm": "instant"}
