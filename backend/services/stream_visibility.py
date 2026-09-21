"""Wer mit seinem Livestream auf die Startseite kommt - und woran es sonst liegt (#310).

Die Regel gab es schon: nur aktive Vereinsmitglieder, deren Mitgliederprofil mit
dem Plattform-Konto verknüpft ist. Sie stand in der Route und sagte niemandem,
woran ein Stream scheitert. Hier steht sie einmal - für die öffentliche Liste
und für die Erklärung im Admin, damit beide nie auseinanderlaufen.
"""
from __future__ import annotations

ACTIVE_STREAM_MEMBER_STATUSES = ("active", "honorary")

REASON_TEXTS = {
    "visible": "erscheint auf der Startseite, sobald der Kanal live ist",
    "account_inactive": "Konto ist deaktiviert oder gesperrt",
    "no_membership": "keine aktive Mitgliedschaft (nötig: aktiv oder Ehrenmitglied)",
    "no_member_profile": "kein aktives Mitgliederprofil mit diesem Konto verknüpft "
                         "(Admin → Mitglieder → Mitgliederprofile → Feld „Plattform-Konto“)",
}
# Mitgliedschaft und Kontostatus sind Vereinsdaten. Wer nur die Redaktion hat,
# erfährt, dass ein Kanal nicht freigeschaltet ist - nicht, warum.
RESTRICTED_REASON_TEXT = "nicht für die Startseite freigeschaltet – den Grund sieht die Vereinsverwaltung"


def reason_text(code: str, *, detailed: bool) -> str:
    if code == "visible" or detailed:
        return REASON_TEXTS.get(code, code)
    return RESTRICTED_REASON_TEXT


async def homepage_visibility(db, user_ids) -> dict[str, dict]:
    """Je Nutzer: sichtbar oder nicht, der Grund, und was die Startseite dazu zeigt."""
    wanted = sorted({user_id for user_id in user_ids if user_id})
    if not wanted:
        return {}

    users = await db.users.find(
        {"id": {"$in": wanted}, "is_active": True, "is_banned": {"$ne": True}},
        {"_id": 0, "id": 1, "username": 1, "privacy_public_profile": 1},
    ).to_list(2000)
    active_users = {user["id"]: user for user in users}

    memberships = await db.memberships.find(
        {"user_id": {"$in": list(active_users)}, "member_status": {"$in": list(ACTIVE_STREAM_MEMBER_STATUSES)}},
        {"_id": 0, "user_id": 1},
    ).to_list(2000)
    member_ids = {membership.get("user_id") for membership in memberships if membership.get("user_id")}

    profiles = await db.club_member_profiles.find(
        {"user_id": {"$in": list(member_ids)}, "is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "user_id": 1, "slug": 1, "display_name": 1, "gamertag": 1, "photo_url": 1},
    ).to_list(2000)
    profile_by_user = {profile.get("user_id"): profile for profile in profiles if profile.get("user_id")}

    verdicts: dict[str, dict] = {}
    for user_id in wanted:
        user = active_users.get(user_id)
        profile = profile_by_user.get(user_id)
        if not user:
            reason = "account_inactive"
        elif user_id not in member_ids:
            reason = "no_membership"
        elif not profile:
            reason = "no_member_profile"
        else:
            reason = "visible"
        verdict = {"visible": reason == "visible", "reason": reason}
        if reason == "visible":
            verdict["member_profile"] = {
                "id": profile.get("id"),
                "slug": profile.get("slug"),
                "display_name": profile.get("display_name"),
                "gamertag": profile.get("gamertag"),
                "photo_url": profile.get("photo_url"),
            }
            public = user.get("username") and user.get("privacy_public_profile") is True
            verdict["public_profile_url"] = f"/u/{user.get('username')}" if public else None
        verdicts[user_id] = verdict
    return verdicts
