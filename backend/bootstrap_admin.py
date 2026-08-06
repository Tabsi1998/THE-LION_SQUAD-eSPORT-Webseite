"""Create the first superadmin once; never mutates or reactivates an existing user."""
from __future__ import annotations

import asyncio
import os

from database import close_client
from runtime_config import is_placeholder_secret, resolve_app_environment
from seed import seed_admin


async def main() -> None:
    resolve_app_environment()
    email = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "")
    if not email or "@" not in email:
        raise RuntimeError("BOOTSTRAP_ADMIN_EMAIL must be a valid email address.")
    if len(password) < 12 or is_placeholder_secret(password):
        raise RuntimeError("BOOTSTRAP_ADMIN_PASSWORD must be a real password with at least 12 characters.")
    try:
        created = await seed_admin(email, password)
        if created:
            print(f"[bootstrap] Initial superadmin created: {email}")
        else:
            print("[bootstrap] A superadmin already exists; no account was changed.")
    finally:
        await close_client()


if __name__ == "__main__":
    asyncio.run(main())
