"""Digitale Mitgliedskarte (#346): Karte fürs Mitglied, kurzlebiger Prüfcode für Partner.

Der QR-Code trägt keinen Namen und keine Nummer, nur eine Adresse mit einem zufälligen Code,
der fünf Minuten gilt und sich beim Anzeigen erneuert. Ein abfotografierter Code ist danach
wertlos. Wer ihn scannt, sieht das Minimum: gültiges Mitglied, Vorname mit erstem Buchstaben des
Nachnamens, Mitgliedsart, gültig bis - oder „nicht gültig“. Keine E-Mail, keine Adresse, kein
Beitragsstand.

Gültig ist die Karte, solange die Mitgliedschaft besteht. Ein offener Beitrag ist kein Austritt
(Dolibarr I); ein eingetragener Austritt beendet sie mit dem letzten Tag.

`wallet_model` ist die neutrale Beschreibung der Karte für Apple Wallet und Google Wallet -
Felder, Farben, Barcode - damit die Anbindung später nur noch signieren muss.
"""
from __future__ import annotations

import secrets
from datetime import timedelta

from database import get_db
from models import now_utc

TOKEN_MINUTES = 5
TOKEN_BYTES = 12   # 16 Zeichen - kurz genug für einen kleinen QR-Code, zu lang zum Raten
VERIFY_PATH = "/karte/pruefen"
TYPE_LABELS = {"ordinary": "Ordentliches Mitglied", "supporting": "Unterstützendes Mitglied", "honorary": "Ehrenmitglied",
               "youth": "Jugendmitglied", "guest": "Gastmitglied"}


def _valid_until(membership: dict) -> str | None:
    """Letzter Tag, den die Karte nennt: Austritt aus Dolibarr, sonst bezahlt bis, sonst offen."""
    state = membership.get("dolibarr") or {}
    return state.get("membership_ends") or state.get("paid_until") or None


def card_status(membership: dict | None, today: str | None = None) -> str:
    if not membership or membership.get("member_status") not in ("active", "honorary"):
        return "none"
    ends = (membership.get("dolibarr") or {}).get("membership_ends")
    if ends and ends < (today or now_utc().date().isoformat()):
        return "ended"
    return "valid"


def _short_name(user: dict, membership: dict) -> str:
    """Vorname plus erster Buchstabe des Nachnamens - was ein Partner zum Abgleich mit dem Ausweis braucht."""
    first = (membership.get("first_name") or user.get("first_name") or "").strip()
    last = (membership.get("last_name") or user.get("last_name") or "").strip()
    if first and last:
        return f"{first} {last[0]}."
    return user.get("display_name") or user.get("username") or "Mitglied"


def _type_label(membership: dict) -> str:
    state = membership.get("dolibarr") or {}
    return (state.get("type") or {}).get("label") or TYPE_LABELS.get(membership.get("membership_type") or "", "Mitglied")


async def card_for(user: dict, db=None) -> dict:
    """Die Karte des angemeldeten Mitglieds samt frischem Prüfcode - oder `status: none`."""
    db = db if db is not None else get_db()
    membership = await db.memberships.find_one({"user_id": user["id"]}, {"_id": 0})
    status = card_status(membership)
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1, "primary_color": 1, "logo_url": 1, "domain": 1}) or {}
    club = branding.get("club_name") or "THE LION SQUAD"
    if status != "valid":
        return {"status": status, "club_name": club}
    token = secrets.token_urlsafe(TOKEN_BYTES)
    expires = now_utc() + timedelta(minutes=TOKEN_MINUTES)
    await db.member_card_tokens.insert_one({"token": token, "user_id": user["id"], "created_at": now_utc(), "expires_at": expires})
    base = (branding.get("domain") or "https://lionsquad.at").rstrip("/")
    if not base.startswith("http"):
        base = f"https://{base}"
    return {
        "status": "valid",
        "club_name": club,
        "name": user.get("display_name") or user.get("username"),
        "member_number": membership.get("member_number"),
        "type_label": _type_label(membership),
        "member_since": membership.get("member_since"),
        "valid_until": _valid_until(membership),
        "verify_url": f"{base}{VERIFY_PATH}/{token}",
        "token_expires_at": expires.isoformat(),
        "accent_color": branding.get("primary_color") or "#FFD700",
    }


async def verify_token(token: str, db=None) -> dict:
    """Was ein Partner sieht. Unbekannt, abgelaufen, beendet: alles „nicht gültig“, ohne Unterschied."""
    db = db if db is not None else get_db()
    clean = "".join(ch for ch in str(token or "") if ch.isalnum() or ch in "-_")[:40]
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1}) or {}
    club = branding.get("club_name") or "THE LION SQUAD"
    invalid = {"valid": False, "club_name": club}
    if not clean:
        return invalid
    row = await db.member_card_tokens.find_one({"token": clean, "expires_at": {"$gt": now_utc()}}, {"_id": 0})
    if not row:
        return invalid
    user = await db.users.find_one({"id": row["user_id"], "is_active": True, "is_banned": {"$ne": True}},
                                   {"_id": 0, "id": 1, "username": 1, "display_name": 1, "first_name": 1, "last_name": 1})
    membership = await db.memberships.find_one({"user_id": row["user_id"]}, {"_id": 0})
    if not user or card_status(membership) != "valid":
        return invalid
    return {
        "valid": True,
        "club_name": club,
        "name": _short_name(user, membership),
        "type_label": _type_label(membership),
        "valid_until": _valid_until(membership),
        "checked_at": now_utc().isoformat(),
    }


def wallet_model(card: dict) -> dict:
    """Neutrale Beschreibung für Apple Wallet (pkpass) und Google Wallet (Generic Pass)."""
    return {
        "kind": "membership",
        "organization": card.get("club_name"),
        "title": "Mitgliedskarte",
        "primary": {"label": "Mitglied", "value": card.get("name")},
        "secondary": [
            {"label": "Nummer", "value": card.get("member_number")},
            {"label": "Art", "value": card.get("type_label")},
            {"label": "Gültig bis", "value": card.get("valid_until") or "unbefristet"},
        ],
        "colors": {"background": "#0A0A0A", "foreground": "#FFFFFF", "label": card.get("accent_color") or "#FFD700"},
        "barcode": {"format": "QR", "message": card.get("verify_url"), "rotates": True, "rotation_minutes": TOKEN_MINUTES},
        "needs": {
            "apple": "Apple-Entwicklerkonto, Pass Type ID und Zertifikat (kostenpflichtig); Passes werden signiert ausgeliefert",
            "google": "Google-Pay-Business-Konto, Issuer-ID und Dienstkonto; Klassen und Objekte über die Wallet-API",
        },
    }
