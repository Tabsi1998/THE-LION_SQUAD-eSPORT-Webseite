"""Centralized authentication/login configuration, editable from the admin area.

Stored as a single settings document (id="auth"). Fail-open to safe defaults so a
missing document never locks the login/registration flows.
"""
from __future__ import annotations

from database import get_db

AUTH_SETTINGS_DEFAULTS = {
    "password_login_enabled": True,
    "registration_enabled": True,
    "google_login_enabled": True,
    "google_linking_enabled": True,
}

AUTH_SETTINGS_KEYS = tuple(AUTH_SETTINGS_DEFAULTS.keys())


async def load_auth_settings(db=None) -> dict:
    if db is None:
        db = get_db()
    doc = await db.settings.find_one({"id": "auth"}, {"_id": 0}) or {}
    result = dict(AUTH_SETTINGS_DEFAULTS)
    for key in AUTH_SETTINGS_KEYS:
        if isinstance(doc.get(key), bool):
            result[key] = doc[key]
    return result
