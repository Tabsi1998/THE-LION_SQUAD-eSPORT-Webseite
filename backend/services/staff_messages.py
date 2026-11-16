"""Nachricht an Helfer (#2111 TA25, #1384): beim Eintragen, beim Aktivieren eines pausiert eingetragenen Einsatzes und beim
Rollenwechsel genau eine - im Postfach, per Push und nach Einstellung „Turnier-Updates“ per Mail, mit dem Satz, was die Rolle
darf, und dem Weg zu „Mein Dienst“. Turnier und Fast Lap nutzen dieselbe Nachricht."""
from __future__ import annotations

import logging

from services.log_safe import log_safe

logger = logging.getLogger("tls.staff_messages")

DUTY_PATH = "/admin/dienst"
KIND = "tournament_staff"
MAIL_TEMPLATE = "tournament_staff"


async def notify_helper(db, assignment: dict, *, event_title: str, role_word: str, rights: str, dedupe_prefix: str,
                        meta: dict, role_changed: bool = False) -> None:
    """Eine Nachricht samt Mail. Eintragen bzw. Aktivieren: je Einsatz einmal (``<prefix>:<id>``). Rollenwechsel: je Wechsel
    einmal - auch zurück zur alten Rolle. Hält nie eine Zuweisung auf."""
    from services.notification_preferences import send_user_template
    from services.user_notifications import build_public_url, create_user_notification

    title = f"{'Neue Rolle' if role_changed else 'Einsatz'}: {event_title}"
    body = f"Du hilfst bei {event_title} als {role_word}. {rights} Unter „Mein Dienst“ siehst du, was du tun kannst."
    dedupe = (f"{dedupe_prefix}:{assignment['id']}:role:{assignment.get('role')}:{assignment.get('updated_at')}"
              if role_changed else f"{dedupe_prefix}:{assignment['id']}")
    try:
        await create_user_notification(
            assignment["user_id"], title, body, url=DUTY_PATH, kind=KIND,
            meta={"category": "tournament_updates", "dedupe_key": dedupe, **meta},
        )
    except Exception as exc:  # noqa: BLE001 - eine Nachricht hält keine Zuweisung auf
        logger.warning("Staff notification failed type=%s", type(exc).__name__)
    try:
        user = await db.users.find_one({"id": assignment["user_id"]}, {"_id": 0, "id": 1, "email": 1, "notification_preferences": 1})
        await send_user_template(
            user, MAIL_TEMPLATE, dedupe_key=f"{dedupe}:mail",
            mail_meta={"kind": KIND, "user_id": assignment["user_id"], **meta},
            tournament_title=event_title, role=role_word, rights=rights, url=await build_public_url(DUTY_PATH),
        )
    except Exception as exc:  # noqa: BLE001 - eine Mail hält keine Zuweisung auf
        logger.warning("Staff mail failed assignment=%s type=%s", log_safe(assignment.get("id")), type(exc).__name__)


def became_active(current: dict, updated: dict | None) -> bool:
    return bool(updated) and current.get("is_active") is False and updated.get("is_active", True) is not False
