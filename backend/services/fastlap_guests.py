"""Gäste ohne Konto bei einer Fast Lap (#1585).

Vor Ort fahren auch Leute ohne Konto. Das Fast-Lap-Team legt sie mit einem Anzeigenamen an (``f1_guests``, je
Challenge); ihre Zeiten tragen ``guest_id`` statt ``user_id``. Gäste stehen in der Tabelle, im TV und auf der Urkunde,
aber nie in Gewinnen, Saisonpunkten, Erfolgen oder im Profil - dort reiht ``rank_laps`` nur Konten
(``include_guests`` ist dort aus).

Datenschutz: der Anzeigename ist eine Angabe zur Person ohne Konto - also ohne Auskunft und Löschung über das Konto.
Er läuft deshalb ab: ``GUEST_NAME_DAYS`` nach dem Anlegen wird er zu „Gast <Nummer>“ (``expire_guest_names``, täglich
im Job ``ops_retention``). Die Zeiten bleiben - ohne Namen (sportliche Integrität). Ein Löschwunsch vorher: Gast
umbenennen.
"""
from __future__ import annotations

import unicodedata
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from services.fastlap_standings import GUEST_PREFIX

GUEST_NAME_MAX = 40
GUEST_NAME_DAYS = 90


def clean_guest_name(value) -> str:
    """Der Anzeigename, wie er gespeichert wird - sonst 400. Ein bis 40 Zeichen, ohne Steuerzeichen."""
    text = " ".join(str(value or "").split())
    if not text:
        raise HTTPException(status_code=400, detail="Bitte einen Namen für den Gast angeben.")
    if len(text) > GUEST_NAME_MAX:
        raise HTTPException(status_code=400, detail=f"Der Name ist zu lang - höchstens {GUEST_NAME_MAX} Zeichen.")
    if any(unicodedata.category(char) in ("Cc", "Cf", "Cs", "Co", "Cn") and char not in "‍️" for char in text):
        raise HTTPException(status_code=400, detail="Der Name enthält Zeichen, die sich nicht anzeigen lassen.")
    return text


def guest_participant_id(guest_id: str) -> str:
    return f"{GUEST_PREFIX}{guest_id}"


def guest_payload(guest: dict) -> dict:
    return {
        "id": guest["id"],
        "challenge_id": guest.get("challenge_id"),
        "display_name": guest.get("display_name"),
        "number": guest.get("number"),
        "participant_id": guest_participant_id(guest["id"]),
        "is_guest": True,
        "created_at": guest.get("created_at"),
    }


async def guests_by_id(db, guest_ids) -> dict[str, dict]:
    ids = sorted({gid for gid in guest_ids if gid})
    if not ids:
        return {}
    rows = await db.f1_guests.find({"id": {"$in": ids}}, {"_id": 0}).to_list(len(ids) + 10)
    return {row["id"]: row for row in rows}


async def find_guest(db, challenge_id: str, guest_id: str | None) -> dict:
    guest = await db.f1_guests.find_one({"id": guest_id, "challenge_id": challenge_id}, {"_id": 0}) if guest_id else None
    if not guest:
        raise HTTPException(status_code=400, detail="Gast gehört nicht zu dieser Challenge.")
    return guest


async def ensure_unique_name(db, challenge_id: str, name: str, *, current_id: str | None = None) -> None:
    """Zwei Gäste mit demselben Namen wären in der Tabelle nicht zu unterscheiden."""
    async for row in db.f1_guests.find({"challenge_id": challenge_id}, {"_id": 0, "id": 1, "display_name": 1}):
        if row.get("id") != current_id and (row.get("display_name") or "").casefold() == name.casefold():
            raise HTTPException(status_code=409, detail="Diesen Namen gibt es schon - bitte unterscheidbar machen, z. B. „Max B.“.")


async def expire_guest_names(db, *, now: datetime | None = None) -> int:
    """Gast-Namen nach ``GUEST_NAME_DAYS`` durch „Gast <Nummer>“ ersetzen. Gibt die Zahl der ersetzten Namen zurück."""
    current = now or datetime.now(timezone.utc)
    cutoff = (current - timedelta(days=GUEST_NAME_DAYS)).isoformat()
    changed = 0
    async for row in db.f1_guests.find({"created_at": {"$lt": cutoff}, "name_expired_at": None}, {"_id": 0, "id": 1, "number": 1}):
        await db.f1_guests.update_one({"id": row["id"]}, {"$set": {
            "display_name": f"Gast {row.get('number') or ''}".strip(),
            "name_expired_at": current.isoformat(),
            "updated_at": current.isoformat(),
        }})
        changed += 1
    return changed
