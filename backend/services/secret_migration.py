"""Idempotent migration of legacy plaintext integration credentials."""
from __future__ import annotations

from services.secret_store import PREFIX, encrypt_secret

SETTING_FIELDS = {
    "email": ("resend_api_key",),
    "mail": ("smtp_pass", "resend_api_key"),
    "discord": ("bot_token",),
    "branding": ("twitch_client_secret",),
    "twitch_app_token": ("access_token",),
}


async def migrate_plaintext_secrets(db) -> int:
    changed = 0
    for setting_id, fields in SETTING_FIELDS.items():
        doc = await db.settings.find_one({"id": setting_id}, {"_id": 0, **{field: 1 for field in fields}}) or {}
        updates = {
            field: encrypt_secret(doc[field])
            for field in fields
            if doc.get(field) and not str(doc[field]).startswith(PREFIX)
        }
        if updates:
            await db.settings.update_one({"id": setting_id}, {"$set": updates})
            changed += len(updates)

    cursor = db.game_servers.find(
        {"access_secret": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "id": 1, "access_secret": 1},
    )
    async for server in cursor:
        value = str(server.get("access_secret") or "")
        if value and not value.startswith(PREFIX):
            await db.game_servers.update_one(
                {"id": server["id"]},
                {"$set": {"access_secret": encrypt_secret(value)}},
            )
            changed += 1
    return changed
