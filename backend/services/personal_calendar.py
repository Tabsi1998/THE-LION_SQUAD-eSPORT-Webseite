"""Persönlicher Kalender-Link (#1189): eine private Abo-Adresse je Konto - nur mit den eigenen Terminen.

- Die Adresse trägt ein zufälliges, langes Token (32 Byte). Gespeichert wird nur sein SHA-256-Hash: wer die Datenbank
  liest, baut daraus keine Adresse. Darum zeigt die Website die Adresse nur einmal, direkt nach dem Erzeugen.
- Je Konto höchstens ein Link. „Neu erzeugen“ ersetzt ihn - die alte Adresse gilt sofort nicht mehr -, „Abschalten“
  löscht ihn. Beim Löschen des Kontos fällt er mit weg (``account_erasure.PURGED``).
- Der Feed enthält nur, wofür die Person (oder ihr Team) dabei ist: dieselbe Liste wie ``GET /api/calendar`` mit ihrem
  Konto, davon nur „angemeldet“ - dazu ihre Vereinstermine (zugesagte Versammlungen, eigene Schichten). Die eigene
  Anmeldung zählt auch ohne Sichtbarkeit (#1830: Vor-Ort-QR, Zugangslink, „Nur Mitglieder“ ohne Mitgliedschaft); ohne
  eigene Anmeldung kommt nichts dazu. Abgesagtes und „Nur intern“ stehen nie darin, auch nicht für die Vereinsverwaltung
  und nicht mit eigener Anmeldung. Ein gesperrtes oder abgeschaltetes Konto bekommt nichts. Ohne Sitzung gilt keine
  bestätigte Zwei-Faktor-Anmeldung: die Ausnahme der Turnierleitung für „Nur Mitglieder“ greift hier nicht.
- Das Token steht nie im Protokoll: ``log_safe.SecretPathFilter`` kürzt es im Zugriffsprotokoll von Uvicorn, nginx
  schreibt für diese Adressen keines (``frontend/nginx.conf``).
"""
from __future__ import annotations

import hashlib
import re
import secrets

from models import now_utc
from services import calendar_items, club_calendar

# Der Hinweis „Deine Termine automatisch im Kalender?“ nach einer Anmeldung (#1788): einmal je Konto, am Konto gemerkt.
HINT_FIELD = "calendar_subscribe_hint_seen_at"

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
    user = await account(db, row["user_id"])
    if not user:
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


async def personal_items(db, user: dict, own: dict[str, dict[str, dict]] | None = None) -> list[dict]:
    """Nur die eigenen Termine: aus der Sicht der Person, davon was „angemeldet“ ist, plus ihre Vereinstermine.

    Vereinstermine sind gewollt (#1189: „nur die eigenen Termine“, `club_calendar.club_items` ist dafür gebaut): zugesagte
    Versammlungen und eigene Helferschichten - ohne Namen anderer, ohne Zugangslink. Abgesagtes und Internes nie.
    Dieselbe Liste zeigt „Mein Kalender“ (#1788) - die Regel steht nur hier.
    """
    # Die eigene Anmeldung zählt auch ohne Sichtbarkeit (#1830) - „Nur intern“ und Abgesagtes bleiben draußen (_allowed).
    items = [item for item in await calendar_items.collect(db, user, own, include_own=True) if _allowed(item)]
    items += [item for item in await club_calendar.club_items(db, user) if _allowed(item)]
    return sorted(items, key=lambda item: (item["start"], item["kind"], item["title"]))


# ---------------------------------------------------------------- „Mein Kalender“ (#1788)

# Vereinstermine tragen keinen Anmeldestand - ihre Plakette sagt, was sie für die Person sind.
_MEETING_STATE = {"state": "accepted", "label": "Zugesagt", "team_name": None}
_SHIFT_LABEL = "Schicht"


async def account(db, user_id: str) -> dict | None:
    """Das Konto so, wie es der Feed sieht (ohne Sitzung, ohne Zwei-Faktor) - gesperrt oder abgeschaltet: keins."""
    user = await db.users.find_one({"id": user_id}, _ACCOUNT_FIELDS)
    if not user or user.get("is_active") is False or user.get("is_banned"):
        return None
    return user


def own_state(item: dict, own: dict[str, dict[str, dict]]) -> dict | None:
    """Der eigene Stand zu einem Termin als Plakette: angemeldet, Warteliste, eingecheckt, dabei mit dem Team, Schicht …"""
    kind = item.get("kind")
    if kind == "club":
        if item.get("club_kind") == "meeting":
            return dict(_MEETING_STATE)
        phase = item.get("phase") or {}
        return {"state": phase.get("state") or "shift", "label": phase.get("label") or _SHIFT_LABEL, "team_name": None}
    if kind == "event":
        state = own.get("events", {}).get(item.get("event_id") or item.get("id"))
    elif kind == "tournament":
        state = own.get("tournaments", {}).get(str(item.get("id") or "").removesuffix("-anmeldeschluss"))
    elif kind == "fastlap":
        state = own.get("fastlaps", {}).get(item.get("id"))
    else:
        state = None
    if not state:
        return None
    return {"state": state.get("state"), "label": state.get("label"), "team_name": state.get("team_name")}


async def hint_due(db, user_id: str, active: bool) -> bool:
    """Der Hinweis nach einer Anmeldung: nur ohne aktiven Link und nur, solange er nicht schon einmal erschienen ist."""
    if active:
        return False
    row = await db.users.find_one({"id": user_id}, {"_id": 0, "calendar_subscribe_hint_seen_at": 1}) or {}
    return not row.get(HINT_FIELD)


async def mark_hint_seen(db, user_id: str) -> None:
    await db.users.update_one({"id": user_id}, {"$set": {HINT_FIELD: now_utc().isoformat()}})


async def my_calendar(db, user_id: str) -> dict:
    """„Mein Kalender“ ohne Abo: genau die Termine des persönlichen Feeds (``personal_items``), je Termin mit Stand,
    dazu der Stand des Abos und ob der Hinweis fällig ist. Das Konto wird wie beim Feed geladen - dieselbe Sicht."""
    subscription = await status(db, user_id)
    user = await account(db, user_id)
    items: list[dict] = []
    if user:
        own = await calendar_items.own_entries(db, user)
        items = [{**item, "own": own_state(item, own)} for item in await personal_items(db, user, own)]
    return {"items": items, "subscription": subscription, "hint_due": await hint_due(db, user_id, subscription["active"])}
