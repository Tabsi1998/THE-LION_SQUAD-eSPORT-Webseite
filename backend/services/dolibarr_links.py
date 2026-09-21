"""Welches Website-Konto ist welches Dolibarr-Mitglied (#316, #295).

Eine Zuordnung gilt erst, wenn sie **bestätigt** ist. E-Mail, Name und
Mitgliedsnummer finden Kandidaten - sie beweisen nichts: Familien teilen sich
Adressen, und eine Nummer kann jeder abschreiben. Bestätigt wird entweder von
der Vereinsverwaltung oder, wenn der Betreiber das ausdrücklich einschaltet,
über die bestätigte E-Mail-Adresse bei genau einem Treffer.

Ein Dokument je Konto und Installation. `member_key` trägt nur eine bestätigte
Zuordnung; der eindeutige Index darauf verhindert, dass zwei Konten dasselbe
Mitglied beanspruchen. Die Geschäftspartner-Nummer (`thirdparty_id`) ist ein
eigenes Feld und bleibt leer, bis die Abrechnung (#314) sie nachweist -
Mitglied und Geschäftspartner sind nicht dasselbe.
"""
from __future__ import annotations

from models import new_id, now_utc
from services.dolibarr_client import instance_key

LINK_STATUSES = ("candidate", "requested", "verified", "conflict", "revoked", "gone")
OPEN_STATUSES = ("candidate", "requested", "conflict")
SOURCES = ("admin", "email_match", "user_request", "preview")


class LinkConflict(Exception):
    """Die Zuordnung würde ein Mitglied oder ein Konto doppelt vergeben."""


def member_key(settings: dict, member_id: int) -> str:
    return f"{instance_key(settings)}:{int(member_id)}"


def public_link(link: dict | None) -> dict | None:
    """Was die betroffene Person selbst über ihre Zuordnung sieht."""
    if not link:
        return None
    return {
        "status": link.get("status"),
        "member_ref": link.get("member_ref") if link.get("status") == "verified" else None,
        "verified_at": link.get("verified_at"),
        "requested_at": link.get("requested_at"),
    }


async def link_for_user(db, settings: dict, user_id: str) -> dict | None:
    if not user_id:
        return None
    return await db.dolibarr_links.find_one({"user_id": user_id, "instance": instance_key(settings)}, {"_id": 0})


async def verified_link(db, settings: dict, user_id: str) -> dict | None:
    link = await link_for_user(db, settings, user_id)
    return link if link and link.get("status") == "verified" else None


async def verified_link_for_member(db, settings: dict, member_id: int) -> dict | None:
    return await db.dolibarr_links.find_one({"member_key": member_key(settings, member_id)}, {"_id": 0})


def _history(actor_id: str | None, status: str, note: str = "") -> dict:
    return {"at": now_utc().isoformat(), "actor_id": actor_id, "to_status": status, "note": note[:300]}


async def note_candidate(db, settings: dict, *, user_id: str, member_id: int | None, member_ref: str | None,
                         source: str, status: str = "candidate", note: str = "") -> dict:
    """Kandidat oder Konflikt festhalten. Eine bestätigte Zuordnung bleibt unangetastet."""
    existing = await link_for_user(db, settings, user_id)
    if existing and existing.get("status") == "verified":
        return existing
    now = now_utc().isoformat()
    fields = {
        "member_id": int(member_id) if member_id is not None else None,
        "member_ref": str(member_ref) if member_ref else None,
        "status": status,
        "source": source,
        "note": note[:300],
        "updated_at": now,
    }
    if status == "requested":
        fields["requested_at"] = now
    if existing:
        await db.dolibarr_links.update_one(
            {"id": existing["id"]},
            {"$set": fields, "$unset": {"member_key": ""}, "$push": {"history": _history(user_id if source == "user_request" else None, status, note)}},
        )
    else:
        await db.dolibarr_links.insert_one({
            "id": new_id(), "user_id": user_id, "instance": instance_key(settings), "thirdparty_id": None,
            "created_at": now, "history": [_history(user_id if source == "user_request" else None, status, note)], **fields,
        })
    return await link_for_user(db, settings, user_id)


async def verify_link(db, settings: dict, *, user_id: str, member_id: int, member_ref: str | None,
                      source: str, actor_id: str | None) -> dict:
    """Zuordnung bestätigen. Wirft LinkConflict, wenn das Mitglied schon einem anderen Konto gehört."""
    key = member_key(settings, member_id)
    taken = await db.dolibarr_links.find_one({"member_key": key}, {"_id": 0, "user_id": 1})
    if taken and taken.get("user_id") != user_id:
        raise LinkConflict("Dieses Mitglied ist schon einem anderen Konto zugeordnet.")
    existing = await link_for_user(db, settings, user_id)
    if existing and existing.get("status") == "verified" and existing.get("member_id") != int(member_id):
        raise LinkConflict("Dieses Konto ist schon einem anderen Mitglied zugeordnet – zuerst lösen.")
    now = now_utc().isoformat()
    fields = {
        "member_id": int(member_id), "member_ref": str(member_ref) if member_ref else None, "member_key": key,
        "status": "verified", "source": source, "verified_at": now, "verified_by": actor_id, "updated_at": now, "note": "",
    }
    if existing:
        await db.dolibarr_links.update_one({"id": existing["id"]}, {"$set": fields, "$push": {"history": _history(actor_id, "verified", source)}})
    else:
        await db.dolibarr_links.insert_one({
            "id": new_id(), "user_id": user_id, "instance": instance_key(settings), "thirdparty_id": None,
            "created_at": now, "history": [_history(actor_id, "verified", source)], **fields,
        })
    return await link_for_user(db, settings, user_id)


async def close_link(db, link: dict, *, status: str, actor_id: str | None, note: str = "") -> None:
    """Zuordnung lösen (`revoked`) oder als verschwunden markieren (`gone`). Der Verlauf bleibt."""
    await db.dolibarr_links.update_one(
        {"id": link["id"]},
        {"$set": {"status": status, "updated_at": now_utc().isoformat(), "note": note[:300]},
         "$unset": {"member_key": ""},
         "$push": {"history": _history(actor_id, status, note)}},
    )
