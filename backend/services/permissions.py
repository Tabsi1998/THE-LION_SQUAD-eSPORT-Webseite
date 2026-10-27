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
- ``finance``     – Kosten an Angeboten, Rechnungsaufträge, Freigaben,
                    Prüffälle, Rechnungsangaben (#322, #1358) und der
                    Vereinsshop: Produkte, Preise, Varianten, Bestellungen
                    (#1704, docs/SHOP.md)
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

# „finance“ (#322): Kosten an Angeboten pflegen, Rechnungsaufträge sehen und freigeben, den Vereinsshop
# verwalten (#1704). Kein Admin hat das pauschal - Club-Admin und Superadmin bringen es mit, andere per Freigabe.
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


def is_confirmed_tournament_lead(user: dict | None) -> bool:
    """Turnierleitung über alle Turniere für die angemeldete Person einer Anfrage: wie jeder Adminbereich nur mit
    bestätigter Zwei-Faktor-Anmeldung (#291, docs/ROLLEN.md). Für Konten aus der Datenbank - Empfänger einer
    Nachricht, Filter - gilt ``is_tournament_lead``: die Bestätigung gehört zur Anmeldung, nicht zum Konto.
    Helfer-Einsätze je Turnier brauchen sie nicht (``services.tournament_permissions``)."""
    return is_tournament_lead(user) and not needs_mfa(user)


def is_confirmed_admin_role(user: dict | None, roles) -> bool:
    """Eine Rollenliste für die angemeldete Person einer Anfrage (#1469): Teams, News-Entwürfe, Suche, Erfolge,
    Dokumente, Admin-Medien und die Live-Aktualisierungen fragen nach Rollen. Eine Rolle mit Adminbereich zählt dort
    wie in ``require_area`` nur mit bestätigter Zwei-Faktor-Anmeldung; ohne geht nur eine Rolle, deren Bereiche alle
    ohne Zwei-Faktor gelten (Moderator, ``MFA_AREAS``). Eine unbekannte Rolle braucht sie immer. Für Konten aus der
    Datenbank - Empfänger einer Nachricht, Filter - gilt die Rolle allein, wie bei ``is_tournament_lead``."""
    role = str((user or {}).get("role") or "")
    if not role or role not in roles:
        return False
    role_areas = ROLE_AREAS.get(role)
    if role_areas is not None and not (role_areas & MFA_AREAS):
        return True
    return not needs_mfa(user)


def admin_role_without_second_factor(user: dict | None, roles) -> bool:
    """Die Rolle steht in der Liste, aber die Zwei-Faktor-Anmeldung fehlt - Hinweis darauf statt „keine Berechtigung“."""
    role = str((user or {}).get("role") or "")
    return bool(role) and role in roles and not is_confirmed_admin_role(user, roles)


def lead_without_second_factor(user: dict | None) -> bool:
    """Turnierleitung über alle Turniere, aber noch ohne bestätigte Zwei-Faktor-Anmeldung - sie bekommt den Hinweis
    auf die Zwei-Faktor-Anmeldung statt „keine Berechtigung“."""
    return is_tournament_lead(user) and needs_mfa(user)


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


async def area_refusal(user: dict | None, areas, db=None) -> str | None:
    """Die eine Entscheidung für Bereiche bei einer Anfrage (#287, #291, #1479) - ``None`` heißt erlaubt, sonst der
    Grund. Erlaubt ist, wer einen der verlangten Bereiche hat (Rolle, Freigabe, Vorstand, Dolibarr). Sobald die Liste
    einen Bereich aus ``MFA_AREAS`` enthält, braucht es zusätzlich die bestätigte Zwei-Faktor-Anmeldung - auch wenn die
    Person nur einen Bereich ohne Zwei-Faktor (Moderation) aus der Liste hat. ``require_area`` und ``can_use_area``
    fragen beide hier, damit sie nie auseinanderlaufen."""
    wanted = tuple(areas)
    if not user or not (set(wanted) & await areas_for(user, db)):
        return missing_area_message(wanted)
    if (set(wanted) & MFA_AREAS) and needs_mfa(user):
        return MFA_MESSAGE
    return None


async def can_use_area(user: dict | None, *areas: str, db=None) -> bool:
    """Darf die angemeldete Person einer Anfrage einen der Bereiche jetzt benutzen (#1479)? Genau dann, wenn
    ``require_area`` mit derselben Liste nicht ablehnt (``area_refusal``) - als Frage statt Wächter, für Routen, die
    allen antworten und Verwaltenden mehr zeigen (Kostenangaben, leere Alben). Für Konten aus der Datenbank gilt
    ``user_has_area``. Spiegel von ``canUseArea`` im Web."""
    return await area_refusal(user, areas, db) is None


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
