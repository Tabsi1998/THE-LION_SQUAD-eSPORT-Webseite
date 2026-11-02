"""Mail in der Liga (docs/LIGA.md, Abschnitt 12, B.3, #2204): Was jemand tun muss oder was ohne ihn entschieden wurde, kommt nach seinen
Einstellungen auch per Mail. Eine klemmende Mail hält nichts auf: Die Änderung ist dann schon gespeichert."""

from __future__ import annotations

import logging

from services.log_safe import log_safe

logger = logging.getLogger("tls.league_mail")


async def send_league_mail(db, user_id: str | None, title: str, text: str, path: str, dedupe_key: str) -> None:
    from services.match_audience import users_for
    from services.notification_preferences import send_user_template
    from services.user_notifications import build_public_url

    try:
        people = await users_for(db, [user_id]) if user_id else []
        if not people:
            return
        user = people[0]
        await send_user_template(user, "league_notice", title=title, text=text, url=await build_public_url(path), dedupe_key=dedupe_key,
                                 mail_meta={"kind": "league_notice", "user_id": user_id})
    except Exception:  # noqa: BLE001 - siehe oben
        logger.warning("[liga] Mail nicht verschickt: %s", log_safe(dedupe_key), exc_info=True)
