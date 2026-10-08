"""Shared visibility helper used by news, events, gallery and document routes.

The four CMS modules each guard records by a `visibility` field with the same
levels: public / community / members / internal. Centralising the rule keeps
authorisation behaviour consistent.
"""
from services.membership_service import is_active_member, get_membership

# Seit #1350 entscheidet bei „Nur Mitglieder“ der Bereich, nicht die Rolle: aktive Mitglieder und wer die
# Vereinsverwaltung oder System hat (aus Rolle, Freigabe, Vorstandsposten oder Dolibarr-Funktion). Die Rolle
# Turnierleitung allein reicht nicht; Moderatoren sehen Mitglieder-Inhalte als Mitglied.
MEMBER_CONTENT_AREAS = frozenset({"club", "system"})
# Nur noch als Auskunft für ältere Aufrufer - die Prüfung läuft über die Bereiche.
ADMIN_ROLES = {"club_admin", "superadmin"}
INTERNAL_ROLES = {"club_admin", "superadmin"}


async def sees_member_content(user: dict | None, *, look_up_membership: bool = True) -> bool:
    """Mitglieder-Inhalte (News, Events, Galerie, Dokumente mit „Nur Mitglieder“): aktives Mitglied oder Bereich
    Vereinsverwaltung/System.

    ``look_up_membership=False`` für die angemeldete Person einer Anfrage: ``auth.get_current_user`` hat die
    Mitgliedschaft schon nachgesehen (``is_club_member``); nachschlagen braucht es nur bei Konten aus der Datenbank."""
    if not user:
        return False
    if user.get("is_club_member"):
        return True
    from services.permissions import areas_for

    if MEMBER_CONTENT_AREAS & await areas_for(user):
        return True
    if not look_up_membership or not user.get("id"):
        return False
    return is_active_member(await get_membership(user["id"]))


async def user_can_see(user: dict | None, visibility: str | None) -> bool:
    """Return True if `user` is allowed to see a record with the given visibility.

    `user` may be `None` for anonymous visitors. `visibility` is one of
    `public` / `community` / `members` / `internal`. Unknown values are
    treated as `public`.
    """
    visibility = visibility or "public"
    if visibility == "public":
        return True
    if not user:
        return False
    if visibility == "internal":
        # „Nur intern“ heißt Vereinsverwaltung - nach Bereich (#287), nicht nach Rolle: auch ein
        # Vorstandsposten, eine Freigabe oder eine Dolibarr-Funktion lesen es. Dieselbe Regel
        # bestimmt, wer die Meldung dazu bekommt (member_announcements).
        if user.get("role") in INTERNAL_ROLES:
            return True
        from services.permissions import areas_for

        return "club" in await areas_for(user)
    if visibility == "community":
        return True  # any logged-in user passes
    if visibility == "members":
        return await sees_member_content(user)
    return True


async def lead_can_see(user: dict | None, visibility: str | None) -> bool:
    """Für Events, Turniere und Fast Laps: die Turnierleitung (Rolle oder Freigabe) legt sie an, checkt ein und wertet
    aus - sie sieht sie auch mit „Nur Mitglieder“, so wie ihre Verwaltungsseiten sie brauchen. Für News, Galerie,
    Dokumente und alles andere gilt ``user_can_see`` (#1350)."""
    if (visibility or "public") == "members":
        from services.permissions import is_tournament_lead

        if is_tournament_lead(user):
            return True
    return await user_can_see(user, visibility)


async def filter_visible(items: list[dict], user: dict | None) -> list[dict]:
    """Filter a list of dicts by their `visibility` field.

    Je Sichtbarkeit wird einmal entschieden - die Bereiche einer Person brauchen Datenbank-Abfragen, und eine
    Liste mit hundert Mitglieder-News soll sie nicht hundertmal stellen."""
    out: list[dict] = []
    decided: dict[str, bool] = {}
    for it in items:
        visibility = it.get("visibility") or "public"
        if visibility not in decided:
            decided[visibility] = await user_can_see(user, visibility)
        if decided[visibility]:
            out.append(it)
    return out
