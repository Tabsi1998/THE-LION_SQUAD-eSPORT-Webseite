"""Mail in der Liga (docs/LIGA.md, Abschnitt 12, B.3, #2204): Was jemand tun muss oder was ohne ihn entschieden wurde, kommt nach seinen
Einstellungen auch per Mail. Eine klemmende Mail hält nichts auf: Die Änderung ist dann schon gespeichert."""

from __future__ import annotations

import logging

from services.log_safe import log_safe

logger = logging.getLogger("tls.league_mail")


async def send_league_mail(db, user_id: str | None, title: str, text: str, path: str, dedupe_key: str, *, category: str | None = None) -> bool:
    """``category``: das Thema der Einstellungen, wenn es nicht das der Vorlage ist (die Rundnachricht folgt „Turnier-Updates“ wie Glocke
    und Push). ``True``: Die Mail ist neu eingereiht - nicht bei fehlender Adresse, abgeschalteter Einstellung oder schon eingereiht."""
    from services.match_audience import users_for
    from services.notification_preferences import send_user_template
    from services.user_notifications import build_public_url

    try:
        people = await users_for(db, [user_id]) if user_id else []
        if not people:
            return False
        user = people[0]
        result = await send_user_template(user, "league_notice", category=category, title=title, text=text, url=await build_public_url(path),
                                          dedupe_key=dedupe_key, mail_meta={"kind": "league_notice", "user_id": user_id})
        return bool(result.get("ok")) and not result.get("skipped") and not result.get("deduped")
    except Exception:  # noqa: BLE001 - siehe oben
        logger.warning("[liga] Mail nicht verschickt: %s", log_safe(dedupe_key), exc_info=True)
        return False
