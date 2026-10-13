"""Persönlicher Kalender-Link (#1189): eine private Abo-Adresse je Konto - nur mit den eigenen Terminen.

- Die Adresse trägt ein zufälliges, langes Token (32 Byte). Gespeichert wird nur sein SHA-256-Hash: wer die Datenbank
  liest, baut daraus keine Adresse. Darum zeigt die Website die Adresse nur einmal, direkt nach dem Erzeugen.
- Je Konto höchstens ein Link. „Neu erzeugen“ ersetzt ihn - die alte Adresse gilt sofort nicht mehr -, „Abschalten“
  löscht ihn. Beim Löschen des Kontos fällt er mit weg (``account_erasure.PURGED``).
- Der Feed enthält nur, was die Person selbst sehen darf und wofür sie (oder ihr Team) dabei ist: dieselbe Liste wie
  ``GET /api/calendar`` mit ihrem Konto, davon nur „angemeldet“ - dazu ihre Vereinstermine (zugesagte Versammlungen,
  eigene Schichten). Abgesagtes und „Nur intern“ stehen nie darin, auch nicht für die Vereinsverwaltung. Ein gesperrtes oder
  abgeschaltetes Konto bekommt nichts. Ohne Sitzung gilt keine bestätigte
  Zwei-Faktor-Anmeldung: die Ausnahme der Turnierleitung für „Nur Mitglieder“ greift hier nicht (eher weniger als mehr).
- Das Token steht nie im Protokoll: ``log_safe.SecretPathFilter`` kürzt es im Zugriffsprotokoll von Uvicorn, nginx
  schreibt für diese Adressen keines (``frontend/nginx.conf``).
"""
from __future__ import annotations

import hashlib
import re
import secrets

from models import now_utc
from services import calendar_items, club_calendar

TOKEN_BYTES = 32
PATH_PREFIX = "/api/calendar/personal/"
# token_urlsafe(32) ergibt 43 Zeichen; alles andere ist sicher kein Token und wird gar nicht erst nachgeschlagen.
_TOKEN_SHAPE = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
# Was aus dem Konto für die Sichtbarkeit gebraucht wird - ohne Passwort, Zwei-Faktor-Geheimnisse und Kontaktdaten.
_ACCOUNT_FIELDS = {"_id": 0, "id": 1, "role": 1, "areas": 1, "is_active": 1, "is_banned": 1}


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def token_hash(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def feed_path(token: str) -> str:
    return f"{PATH_PREFIX}{token}.ics"


def _iso(value) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else (value or None)


async def status(db, user_id: str) -> dict:
    """Ob es einen Link gibt, seit wann und wann ihn zuletzt ein Kalender abgerufen hat - die Adresse selbst nie."""
    row = await db.calendar_feed_tokens.find_one({"user_id": user_id}, {"_id": 0, "created_at": 1, "last_used_at": 1})
    return {"active": bool(row), "created_at": _iso((row or {}).get("created_at")), "last_used_at": _iso((row or {}).get("last_used_at"))}


async def issue(db, user_id: str) -> dict:
    """Ein neuer Link - ersetzt den alten in einem Schritt. Die Adresse gibt es nur in dieser Antwort."""
    token = new_token()
    now = now_utc()
    await db.calendar_feed_tokens.replace_one(
        {"user_id": user_id},
        {"user_id": user_id, "token_hash": token_hash(token), "created_at": now, "last_used_at": None},
        upsert=True,
    )
    return {"active": True, "path": feed_path(token), "created_at": now.isoformat(), "last_used_at": None}


async def revoke(db, user_id: str) -> None:
    await db.calendar_feed_tokens.delete_many({"user_id": user_id})


async def owner_for(db, token: str) -> dict | None:
    """Das Konto zu einem Token - oder None (unbekannt, falsch geformt, Konto gesperrt, abgeschaltet oder gelöscht)."""
    if not _TOKEN_SHAPE.match(str(token or "")):
        return None
    row = await db.calendar_feed_tokens.find_one({"token_hash": token_hash(token)}, {"_id": 0, "user_id": 1})
    if not row or not row.get("user_id"):
        return None
    user = await db.users.find_one({"id": row["user_id"]}, _ACCOUNT_FIELDS)
    if not user or user.get("is_active") is False or user.get("is_banned"):
        return None
    await db.calendar_feed_tokens.update_one({"user_id": user["id"]}, {"$set": {"last_used_at": now_utc()}})
    return user


# Nie im Link, egal mit welcher Rolle (Codex-Prüfung #1473): Abgesagtes und „Nur intern“. Der Link wirkt ohne Sitzung und
# ohne Zwei-Faktor-Anmeldung - was die Vereinsverwaltung über ihre Rolle sieht, gehört nicht in eine Adresse, die in einer
# Kalender-App liegt.
EXCLUDED_STATUS = frozenset({"cancelled"})
EXCLUDED_VISIBILITY = frozenset({"internal"})


def _allowed(item: dict) -> bool:
    return bool(item.get("mine")) and item.get("status") not in EXCLUDED_STATUS and item.get("visibility") not in EXCLUDED_VISIBILITY


async def personal_items(db, user: dict) -> list[dict]:
    """Nur die eigenen Termine: aus der Sicht der Person, davon was „angemeldet“ ist, plus ihre Vereinstermine.

    Vereinstermine sind gewollt (#1189: „nur die eigenen Termine“, `club_calendar.club_items` ist dafür gebaut): zugesagte
    Versammlungen und eigene Helferschichten - ohne Namen anderer, ohne Zugangslink. Abgesagtes und Internes nie.
    """
    items = [item for item in await calendar_items.collect(db, user) if _allowed(item)]
    items += [item for item in await club_calendar.club_items(db, user) if _allowed(item)]
    return sorted(items, key=lambda item: (item["start"], item["kind"], item["title"]))
