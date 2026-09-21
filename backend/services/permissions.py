"""Rechte nach Bereichen statt nach Rangfolge (#287–#291).

Bis hierher galt: eine höhere Rolle darf alles, was die niedrigere darf, und
``require_admin`` schützte Turniere genauso wie News und Sponsoren. Eine
Turnierleitung konnte damit die Startseite umschreiben, und wer nur Vorteile
oder Dokumente pflegen sollte, brauchte den Club-Admin samt Einstellungen.

Jetzt hängen Rechte an **Bereichen**:

- ``tournaments`` – Turniere, Events, Stationen, Fast Lap, Saisons, Gewinne
- ``content``     – News, Galerie, Medien, Sponsoren, Partner, Referenzen,
                    CMS-Seiten, Navigation, Sticker, Achievements
- ``club``        – Mitglieder, Anträge, Dokumente, Vorteile, Vorstand,
                    Kontakt-Inbox, Benutzerliste, Discord-Zähler
- ``system``      – Einstellungen, Game-Server, Betrieb, Logs, Audit,
                    App-Versionen
- ``moderation``  – Chats, Meldungen, Strafen

Die Rollen bleiben als Grundstufe (Superadmin und Club-Admin: alles;
Turnierleitung: Turniere und Moderation; Moderator: Moderation). Dazu kommen
**Freigaben** je Bereich am Benutzer (``areas``), die der Superadmin vergibt,
und der **Vorstand**: wer einen aktiven Vorstandsposten hält oder vertritt,
hat den Bereich ``club`` von selbst (Entscheidung des Betreibers in #287).

Zwei-Faktor gilt für jeden Bereich außer ``moderation`` – vorher galt es nur
für Turnier-Routen, nicht für Mitgliederdaten und Einstellungen (#291).
"""
from __future__ import annotations

from database import get_db

AREAS: tuple[str, ...] = ("tournaments", "content", "club", "system", "moderation")
GRANTABLE_AREAS: tuple[str, ...] = ("tournaments", "content", "club")
MFA_AREAS: frozenset[str] = frozenset({"tournaments", "content", "club", "system"})

AREA_LABELS: dict[str, str] = {
    "tournaments": "Turnierleitung",
    "content": "Redaktion",
    "club": "Vereinsverwaltung",
    "system": "System",
    "moderation": "Moderation",
}

ROLE_AREAS: dict[str, frozenset[str]] = {
    "superadmin": frozenset(AREAS),
    "club_admin": frozenset(AREAS),
    "tournament_admin": frozenset({"tournaments", "moderation"}),
    "moderator": frozenset({"moderation"}),
    "player": frozenset(),
}

ROLE_LABELS: dict[str, str] = {
    "player": "Spieler",
    "moderator": "Moderator",
    "tournament_admin": "Turnierleitung",
    "club_admin": "Club-Admin",
    "superadmin": "Superadmin",
}

MFA_MESSAGE = "Für den Adminbereich ist eine bestätigte Zwei-Faktor-Anmeldung erforderlich."


def clean_grants(values) -> list[str]:
    """Nur bekannte, vergebbare Bereiche, jeder einmal, in fester Reihenfolge."""
    wanted = {str(v).strip() for v in (values or []) if str(v).strip()}
    return [area for area in GRANTABLE_AREAS if area in wanted]


def base_areas(user: dict | None) -> set[str]:
    """Bereiche aus Rolle und Freigaben – ohne Datenbank."""
    if not user:
        return set()
    areas = set(ROLE_AREAS.get(str(user.get("role") or "player"), frozenset()))
    areas.update(clean_grants(user.get("areas")))
    return areas


def area_labels(areas) -> str:
    return ", ".join(AREA_LABELS.get(area, area) for area in AREAS if area in set(areas))


def missing_area_message(areas) -> str:
    wanted = [AREA_LABELS.get(area, area) for area in areas]
    joined = " oder ".join(f"„{label}“" for label in wanted)
    return f"Dafür fehlt der Bereich {joined}. Vergeben kann ihn der Superadmin unter Admin → Alle Benutzer."


async def is_board_holder(db, user_id: str | None) -> bool:
    """Hält oder vertritt diese Person einen aktiven Vorstandsposten?

    Posten zeigen auf ein Mitgliederprofil oder direkt auf den Benutzer; beide
    Wege zählen.
    """
    if not user_id:
        return False
    if db is None:
        db = get_db()
    ids = [user_id]
    async for profile in db.club_member_profiles.find({"user_id": user_id}, {"_id": 0, "id": 1}):
        if profile.get("id"):
            ids.append(profile["id"])
    position = await db.board_positions.find_one(
        {"is_active": {"$ne": False}, "$or": [{"user_id": {"$in": ids}}, {"deputy_user_id": {"$in": ids}}]},
        {"_id": 0, "id": 1},
    )
    return position is not None


async def areas_for(user: dict | None, db=None) -> set[str]:
    """Alle Bereiche einer Person: Rolle, Freigaben, Vorstandsposten.

    Nicht am Nutzer zwischengespeichert: ein Wächter läuft einmal je Anfrage,
    und ein Posten, der gerade ruhend gesetzt wurde, darf nicht nachwirken.
    """
    if not user:
        return set()
    areas = base_areas(user)
    if "club" not in areas:
        if await is_board_holder(db, user.get("id")):
            areas.add("club")
    return areas


async def user_has_area(user: dict | None, *areas: str, db=None) -> bool:
    return bool(set(areas) & await areas_for(user, db))


def needs_mfa(user: dict | None) -> bool:
    return not (user and user.get("mfa_enabled") and user.get("auth_mfa_verified"))
