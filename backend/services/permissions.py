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

# „finance“ (#322): Kosten an Angeboten pflegen, Rechnungsaufträge sehen und freigeben. Kein
# Admin hat das pauschal - Club-Admin und Superadmin bringen es mit, andere per Freigabe.
AREAS: tuple[str, ...] = ("tournaments", "content", "club", "finance", "system", "moderation")
GRANTABLE_AREAS: tuple[str, ...] = ("tournaments", "content", "club", "finance")
MFA_AREAS: frozenset[str] = frozenset({"tournaments", "content", "club", "finance", "system"})

AREA_LABELS: dict[str, str] = {
    "tournaments": "Turnierleitung",
    "content": "Redaktion",
    "club": "Vereinsverwaltung",
    "finance": "Finanzen",
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

# Rollen mit einer Grundstufe im Adminbereich - alle außer Spieler.
ADMIN_ROLES: frozenset[str] = frozenset(role for role, areas in ROLE_AREAS.items() if areas)

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


def holds_area(user: dict | None, *areas: str) -> bool:
    """Ohne Datenbank: ein Bereich aus Rolle oder Freigabe.

    Reicht für Moderation, Turnierleitung, Redaktion, Finanzen und System; die
    Vereinsverwaltung kommt auch aus Vorstandsposten und Dolibarr - dafür ``areas_for``.
    """
    return bool(set(areas) & base_areas(user))


def is_tournament_lead(user: dict | None) -> bool:
    """Turnierleitung über alle Turniere, Fast Laps und Stationen (#1350): der Bereich „Turnierleitung“ -
    aus der Rolle oder einer Freigabe, nicht aus einer Rollenliste. Helfer-Einsätze je Turnier stehen
    daneben (``services.tournament_permissions``)."""
    return holds_area(user, "tournaments")


def tournament_lead_filter() -> dict:
    """Dieselbe Regel als Datenbank-Abfrage: alle Konten mit dem Bereich Turnierleitung (Rolle oder Freigabe)."""
    roles = sorted(role for role, areas in ROLE_AREAS.items() if "tournaments" in areas)
    return {"$or": [{"role": {"$in": roles}}, {"areas": "tournaments"}]}


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
        from_functions = await areas_from_dolibarr(db, user.get("id"))
        if from_functions is not None:
            areas |= from_functions
        elif await is_board_holder(db, user.get("id")):
            areas.add("club")
    return areas


async def areas_from_dolibarr(db, user_id: str | None) -> set[str] | None:
    """Bereiche aus Dolibarr-Funktionen (#297) - oder None, wenn Dolibarr sie nicht führt.

    Ist die Funktions-Freigabe aktiv, zählt nur die dort geführte Funktion; der
    lokal pflegbare Vorstandsposten verleiht dann nichts mehr.
    """
    from services.dolibarr_client import load_settings
    from services.dolibarr_policy import derived_areas, policy_active

    if db is None:
        db = get_db()
    settings = await load_settings(db)
    if not policy_active(settings):
        return None
    return await derived_areas(db, user_id, settings)


async def user_has_area(user: dict | None, *areas: str, db=None) -> bool:
    return bool(set(areas) & await areas_for(user, db))


async def board_holder_ids(db, user_ids) -> set[str]:
    """Wer von diesen Personen einen aktiven Vorstandsposten hält oder vertritt - wie
    ``is_board_holder``, aber für eine ganze Liste in zwei Abfragen."""
    wanted = {user_id for user_id in user_ids if user_id}
    if not wanted:
        return set()
    if db is None:
        db = get_db()
    refs: set[str] = set()
    async for position in db.board_positions.find({"is_active": {"$ne": False}}, {"_id": 0, "user_id": 1, "deputy_user_id": 1}):
        refs.update(ref for ref in (position.get("user_id"), position.get("deputy_user_id")) if ref)
    if not refs:
        return set()
    holders = wanted & refs
    async for profile in db.club_member_profiles.find({"id": {"$in": sorted(refs)}, "user_id": {"$in": sorted(wanted)}}, {"_id": 0, "user_id": 1}):
        holders.add(profile["user_id"])
    return holders


# Sperren (Bannen): Konten mit einer Admin-Rolle oder irgendeinem Bereich - aus Rolle, Freigabe,
# Vorstandsposten oder Dolibarr-Funktion - sperrt und entsperrt nur der Superadmin. Derselbe Schutz gilt
# für Strikes und Chat-Sperren der Moderation (#1350).
async def ban_protected(user: dict | None, db=None) -> bool:
    if not user:
        return False
    return str(user.get("role") or "") in ADMIN_ROLES or bool(await areas_for(user, db))


SUPERADMIN_BAN_DETAIL = "Superadmin-Konten lassen sich nicht bannen. Zuerst die Rolle ändern."
MODERATION_PROTECTED_DETAIL = (
    "Konten mit Adminbereich oder Admin-Rolle bekommen Strikes und Chat-Sperren nur vom Superadmin. "
    "Den Grund bitte an den Superadmin geben."
)


def is_superadmin(user: dict | None) -> bool:
    return bool(user) and str(user.get("role") or "") == "superadmin"


async def moderation_locked(actor: dict | None, target: dict | None, db=None) -> bool:
    """Darf ``actor`` gegen ``target`` keine Maßnahme der Moderation setzen oder zurücknehmen? Wahr bei
    Konten mit Admin-Rolle oder Bereich, außer der Superadmin handelt."""
    if is_superadmin(actor):
        return False
    return await ban_protected(target, db)


async def ban_protected_ids(users: list[dict], db=None) -> set[str]:
    """Dasselbe für die Benutzerliste: dieselben Quellen wie ``areas_for``, mit wenigen Abfragen statt je Person."""
    if db is None:
        db = get_db()
    protected = {u["id"] for u in users if u.get("id") and (str(u.get("role") or "") in ADMIN_ROLES or base_areas(u))}
    rest = [u["id"] for u in users if u.get("id") and u["id"] not in protected]
    if not rest:
        return protected
    from services.dolibarr_client import load_settings
    from services.dolibarr_policy import grants_from_membership, policy_active

    settings = await load_settings(db)
    if policy_active(settings):
        # Ist die Funktions-Freigabe aktiv, zählt nur Dolibarr - wie in ``areas_for``.
        async for membership in db.memberships.find(
            {"user_id": {"$in": rest}, "source": "dolibarr"},
            {"_id": 0, "user_id": 1, "member_status": 1, "dolibarr": 1},
        ):
            if grants_from_membership(membership, settings):
                protected.add(membership["user_id"])
        return protected
    return protected | await board_holder_ids(db, rest)


def needs_mfa(user: dict | None) -> bool:
    return not (user and user.get("mfa_enabled") and user.get("auth_mfa_verified"))
