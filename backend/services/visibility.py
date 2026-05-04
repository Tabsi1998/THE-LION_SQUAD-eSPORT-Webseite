"""Shared visibility helper used by news, events, gallery and document routes.

The four CMS modules each guard records by a `visibility` field with the same
levels: public / community / members / internal. Centralising the rule keeps
authorisation behaviour consistent.
"""
from services.membership_service import is_active_member, get_membership

ADMIN_ROLES = {"moderator", "tournament_admin", "club_admin", "superadmin"}
INTERNAL_ROLES = {"club_admin", "superadmin"}


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
        return user.get("role") in INTERNAL_ROLES
    if visibility == "community":
        return True  # any logged-in user passes
    if visibility == "members":
        if user.get("is_club_member"):
            return True
        if user.get("role") in ADMIN_ROLES:
            return True
        m = await get_membership(user["id"])
        return is_active_member(m)
    return True


async def filter_visible(items: list[dict], user: dict | None) -> list[dict]:
    """Filter a list of dicts by their `visibility` field."""
    out: list[dict] = []
    for it in items:
        if await user_can_see(user, it.get("visibility")):
            out.append(it)
    return out
